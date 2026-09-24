// A compact Yamaha YM3812 (OPL2) synthesizer: 9 two-operator FM channels, native rate 49716 Hz.
//
// Written from the chip's documented behaviour (log-sin / exp ROM formulas, 19-bit phase generator,
// the 9-bit envelope generator with its rate table, KSL curve, AM/VIB LFOs, feedback and connection),
// not ported from an existing emulator. Everything runs at the chip's own sample rate; callers
// resample to the audio device rate (see si2-worklet.js). Accuracy target: the register stream the
// game produces (verified against DOSBox to the write) must sound like the game; sample-exactness
// against a particular emulator is not a goal.
//
// What this game never touches (docs/sound.md): reg 01 (waveform select enable), reg 08 (CSM/note-
// select), reg BD (rhythm mode, deep AM/VIB). Waveforms: on a real YM3812, reg 01 bit 5 gates the E0
// waveform bytes, so the game — which never sets it — would play all sines. The DOSBox build the
// live captures came from (dosbox-staging fork, Nuked OPL3 core) ignores reg 01 and honours
// waveforms 0–3 from E0 regardless, as an OPL3 card does in OPL2 mode; 19 of the 128 instruments
// carry non-zero waveform bytes. Default here = Nuked/OPL3 behaviour (what the game sounded like
// under DOSBox); `new Opl2({ strictOpl2: true })` reproduces the YM3812 gate instead.

export const OPL_RATE = 49716

// --- ROM tables ------------------------------------------------------------------------------
// logsin[i] = -log2(sin((i+0.5)/256 * pi/2)) * 256, for the first quarter wave (256 steps).
const LOGSIN = new Uint16Array(256)
for (let i = 0; i < 256; i++) LOGSIN[i] = Math.round(-Math.log2(Math.sin(((i + 0.5) * Math.PI) / 512)) * 256)
// exp[i] = (2^(i/256) - 1) * 1024, the mantissa ROM.
const EXP = new Uint16Array(256)
for (let i = 0; i < 256; i++) EXP[i] = Math.round((Math.pow(2, i / 256) - 1) * 1024)

// Multiplier register → frequency multiple ×2 (0 → 0.5, 11 → 10, 13 → 12, 14/15 → 15).
const MULT2 = [1, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 20, 24, 24, 30, 30]
// KSL attenuation base per fnum high nibble (units of 0.75 dB × 4/32 ... see kslLevel).
const KSL_ROM = [0, 32, 40, 45, 48, 51, 53, 55, 56, 58, 59, 60, 61, 62, 63, 64]
// KSL register value → right shift applied to the KSL base (0 = off, 1 = 3 dB/oct, 2 = 1.5 dB/oct, 3 = 6 dB/oct).
const KSL_SHIFT = [8, 1, 2, 0]

// Envelope increment patterns: 8 sub-steps for each of the 13 (rate class, fine rate) rows.
const EG_INC = [
  [0, 1, 0, 1, 0, 1, 0, 1], // rates 4..51, fine 0
  [0, 1, 0, 1, 1, 1, 0, 1], // fine 1
  [0, 1, 1, 1, 0, 1, 1, 1], // fine 2
  [0, 1, 1, 1, 1, 1, 1, 1], // fine 3
  [1, 1, 1, 1, 1, 1, 1, 1], // rate 52..55 (13.x)
  [1, 1, 1, 2, 1, 1, 1, 2],
  [1, 2, 1, 2, 1, 2, 1, 2],
  [1, 2, 2, 2, 1, 2, 2, 2],
  [2, 2, 2, 2, 2, 2, 2, 2], // rate 56..59 (14.x)
  [2, 2, 2, 4, 2, 2, 2, 4],
  [2, 4, 2, 4, 2, 4, 2, 4],
  [2, 4, 4, 4, 2, 4, 4, 4],
  [4, 4, 4, 4, 4, 4, 4, 4], // rate 60..63 (15.x)
]
const EG_OFF = 511 // envelope floor: -96 dB
const EG_ATTACK = 0, EG_DECAY = 1, EG_SUSTAIN = 2, EG_RELEASE = 3

/** Operator (slot) register file and runtime state. */
class Operator {
  constructor() {
    // registers
    this.am = 0; this.vib = 0; this.egt = 0; this.ksr = 0; this.mult = 0 // 20h
    this.ksl = 0; this.tl = 0 // 40h
    this.ar = 0; this.dr = 0 // 60h
    this.sl = 0; this.rr = 0 // 80h
    this.ws = 0 // E0h
    // state
    this.phase = 0 // 19-bit phase accumulator
    this.env = EG_OFF // 0 (loudest) .. 511 (silent)
    this.state = EG_RELEASE
    this.keyOn = false
    this.out = 0 // last output (for feedback)
    this.prevOut = 0
  }
}

class Channel {
  constructor() {
    this.fnum = 0; this.block = 0; this.fb = 0; this.cnt = 0
    this.keyOn = false
    this.op = [new Operator(), new Operator()]
  }
}

export class Opl2 {
  constructor({ strictOpl2 = false } = {}) {
    this.ch = Array.from({ length: 9 }, () => new Channel())
    this.regs = new Uint8Array(256)
    this.strictOpl2 = strictOpl2
    this.wse = 0 // reg 01 bit 5 (only consulted when strictOpl2)
    this.noteSel = 0 // reg 08 bit 6 (affects KSR key scale value)
    this.dam = 0; this.dvb = 0 // reg BD bits 7/6 (tremolo / vibrato depth)
    this.timer = 0 // sample counter driving the LFOs and the envelope clock
    this.tremPos = 0 // 0..209 triangle position, advances every 64 samples
  }

  /** Channel index (0..8) and operator (0/1) addressed by an operator register offset 0..0x15, or null. */
  static slot(off) {
    // Operator offsets: 00-05 → ch0-2 op1 / ch0-2 op2 interleaved as 00 01 02 = op1 of ch 0 1 2, 03 04 05 = op2 of ch 0 1 2, etc.
    const group = off >> 3, idx = off & 7
    if (idx > 5 || group > 2) return null
    return { ch: group * 3 + (idx % 3), op: idx < 3 ? 0 : 1 }
  }

  write(reg, val) {
    reg &= 0xff; val &= 0xff
    this.regs[reg] = val
    const hi = reg & 0xf0, lo = reg & 0x0f
    if (reg === 0x01) { this.wse = (val >> 5) & 1; return }
    if (reg === 0x08) { this.noteSel = (val >> 6) & 1; return }
    if (reg === 0xbd) { this.dam = (val >> 7) & 1; this.dvb = (val >> 6) & 1; return } // rhythm bits ignored (never used here)
    if (hi >= 0x20 && hi <= 0xf0 && hi !== 0xa0 && hi !== 0xb0 && hi !== 0xc0) {
      const s = Opl2.slot(reg & 0x1f)
      if (!s) return
      const o = this.ch[s.ch].op[s.op]
      switch (hi & 0xe0) {
        case 0x20: o.am = (val >> 7) & 1; o.vib = (val >> 6) & 1; o.egt = (val >> 5) & 1; o.ksr = (val >> 4) & 1; o.mult = val & 15; break
        case 0x40: o.ksl = (val >> 6) & 3; o.tl = val & 63; break
        case 0x60: o.ar = val >> 4; o.dr = val & 15; break
        case 0x80: o.sl = val >> 4; o.rr = val & 15; break
        case 0xe0: o.ws = val & 3; break
      }
      return
    }
    if (lo > 8) return
    const c = this.ch[lo]
    if (hi === 0xa0) c.fnum = (c.fnum & 0x300) | val
    else if (hi === 0xb0) {
      c.fnum = (c.fnum & 0xff) | ((val & 3) << 8)
      c.block = (val >> 2) & 7
      const key = !!(val & 0x20)
      if (key !== c.keyOn) { c.keyOn = key; for (const o of c.op) this.#key(o, key) }
    } else if (hi === 0xc0) { c.fb = (val >> 1) & 7; c.cnt = val & 1 }
  }

  #key(o, on) {
    if (on) {
      if (!o.keyOn) { o.phase = 0; o.state = EG_ATTACK; if (o.ar === 15) { o.env = 0; o.state = EG_DECAY } }
      o.keyOn = true
    } else { o.keyOn = false; o.state = EG_RELEASE }
  }

  // --- per-sample helpers --------------------------------------------------------------------

  /** Effective 6-bit rate (0 = none) for the operator's current envelope state. */
  #rate(o, c) {
    let r
    switch (o.state) {
      case EG_ATTACK: r = o.ar; break
      case EG_DECAY: r = o.dr; break
      case EG_SUSTAIN: r = o.egt ? 0 : o.rr; break
      default: r = o.rr
    }
    if (r === 0) return 0
    let ksv = (c.block << 1) | ((c.fnum >> (this.noteSel ? 8 : 9)) & 1)
    if (!o.ksr) ksv >>= 2
    return Math.min(63, r * 4 + ksv)
  }

  #envelopeStep(o, c) {
    const rate = this.#rate(o, c)
    if (rate === 0) return
    const cls = rate >> 2, fine = rate & 3
    let shift, row
    if (cls < 12) { shift = 12 - cls; row = fine }
    else if (cls === 12) { shift = 0; row = fine }
    else if (cls === 13) { shift = 0; row = 4 + fine }
    else if (cls === 14) { shift = 0; row = 8 + fine }
    else { shift = 0; row = 12 }
    if (shift && (this.timer & ((1 << shift) - 1)) !== 0) return
    let inc = EG_INC[row][(this.timer >> shift) & 7]
    if (o.state === EG_ATTACK) {
      if (cls === 15) inc = 8 // attack is faster than decay at the top rates
      if (inc) o.env += (~o.env * inc) >> 3
      if (o.env <= 0) { o.env = 0; o.state = EG_DECAY }
    } else {
      o.env += inc
      if (o.env >= EG_OFF) o.env = EG_OFF
      if (o.state === EG_DECAY) {
        const sl = o.sl === 15 ? EG_OFF : o.sl << 4 // 3 dB per SL step (16 units of 0.1875 dB)
        if (o.env >= sl) { o.env = Math.min(EG_OFF, sl); o.state = EG_SUSTAIN }
      }
    }
  }

  #kslLevel(o, c) {
    const base = (KSL_ROM[c.fnum >> 6] << 2) - ((8 - c.block) << 5)
    if (base <= 0) return 0
    return base >> KSL_SHIFT[o.ksl]
  }

  /** Operator output for a given modulation input (13-bit signed-ish), total attenuation in 0.1875 dB units. */
  #opOut(o, c, mod, tremolo) {
    let att = o.env + (o.tl << 2) + this.#kslLevel(o, c)
    if (o.am) att += tremolo
    if (att >= EG_OFF) return 0
    const ph = ((o.phase >> 9) + mod) & 0x3ff // 10-bit waveform phase
    let neg = false, ls
    const ws = this.strictOpl2 && !this.wse ? 0 : o.ws
    switch (ws) {
      case 0: // sine
        neg = (ph & 0x200) !== 0
        ls = LOGSIN[(ph & 0x100) ? (~ph & 0xff) : (ph & 0xff)]
        break
      case 1: // half sine (negative half clipped)
        if (ph & 0x200) return 0
        ls = LOGSIN[(ph & 0x100) ? (~ph & 0xff) : (ph & 0xff)]
        break
      case 2: // absolute sine
        ls = LOGSIN[(ph & 0x100) ? (~ph & 0xff) : (ph & 0xff)]
        break
      default: // pulse sine (quarter waves)
        if (ph & 0x100) return 0
        ls = LOGSIN[ph & 0xff]
    }
    const level = ls + (att << 3)
    let out = (EXP[(level & 0xff) ^ 0xff] | 0x400) << 1
    out >>= level >> 8
    return neg ? -out : out
  }

  /** Render one channel sample; also advances its operators' phase/envelope. */
  #channel(c, tremolo, vibPos) {
    const [m, k] = c.op
    // phase increment, with the vibrato LFO applied to operators that enable it
    const fnum = c.fnum
    let vibDelta = 0
    if (vibPos & 3) {
      vibDelta = (fnum >> 7) & 7
      if (!this.dvb) vibDelta >>= 1
      if (vibPos & 1) vibDelta >>= 1
      if (vibPos & 4) vibDelta = -vibDelta
    }
    const incFor = (o) => ((((fnum + (o.vib ? vibDelta : 0)) << c.block) >> 1) * MULT2[o.mult]) >> 1

    // modulator with feedback
    const fb = c.fb ? ((m.out + m.prevOut) >> (9 - c.fb)) : 0
    const mOut = this.#opOut(m, c, fb, tremolo)
    m.prevOut = m.out; m.out = mOut
    let out
    if (c.cnt) { // additive
      const kOut = this.#opOut(k, c, 0, tremolo)
      k.prevOut = k.out; k.out = kOut
      out = mOut + kOut
    } else { // FM: modulator output → carrier phase
      const kOut = this.#opOut(k, c, mOut, tremolo)
      k.prevOut = k.out; k.out = kOut
      out = kOut
    }
    m.phase = (m.phase + incFor(m)) & 0x7ffff
    k.phase = (k.phase + incFor(k)) & 0x7ffff
    this.#envelopeStep(m, c)
    this.#envelopeStep(k, c)
    return out
  }

  /** One mono sample at OPL_RATE, as a float roughly in -1..1 (9 channels summed, /32768 like most emulators). */
  sample() {
    // LFOs: tremolo triangle 0..26 (0.1875 dB units) updated every 64 samples over 210 steps; vibrato 8 positions every 1024 samples.
    if ((this.timer & 63) === 0) { this.tremPos++; if (this.tremPos >= 210) this.tremPos = 0 }
    let trem = this.tremPos < 105 ? this.tremPos : 210 - this.tremPos
    trem >>= this.dam ? 2 : 4
    const vibPos = (this.timer >> 10) & 7
    let acc = 0
    for (const c of this.ch) acc += this.#channel(c, trem, vibPos)
    this.timer = (this.timer + 1) >>> 0
    return acc / 32768
  }

  /** Fill `out` (Float32Array) with `n` samples. */
  render(out, n = out.length) { for (let i = 0; i < n; i++) out[i] = this.sample() }

  /** Snapshot for a UI: per channel fnum/block/key/freq and envelope levels. */
  status() {
    return this.ch.map((c, i) => ({
      ch: i, key: c.keyOn, fnum: c.fnum, block: c.block, fb: c.fb, cnt: c.cnt,
      hz: (c.fnum * OPL_RATE) / (1 << (20 - c.block)),
      env: c.op.map((o) => o.env), tl: c.op.map((o) => o.tl),
    }))
  }
}
