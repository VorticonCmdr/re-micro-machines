// "Sound Images Generation 2" OPL2 driver (DRIVER1.BIN, Tony Williams 1992/93): the embedded music,
// sfx and instrument banks, and a sequencer that reproduces the driver's OPL register writes.
//
// Everything mirrors code in DRIVER1.BIN (Ghidra program "DRIVER1.BIN"; file offset == segment
// offset, the module is loaded at offset 0 of segment 2424). Function names give the routine
// they replicate so this file can be diffed against the disassembly:
//   ReadVarLenDelay 0x0925 · TickAdvanceSlot 0x0273 (event table 0x0327) · EvtSetInstrument 0x0398 /
//   LoadInstrumentOperators 0x03C4 · NoteOnSetFreqKeyOn 0x049E · ComputeFnumBlock 0x0503 (tables
//   0x09D3 block, 0x0A38 fnum[768]) · ComputeBendOffset 0x0551 · SetVolumeRegs 0x0567 (table 0x10CC) ·
//   StartPendingTune 0x0606 / StartTuneTrack 0x0682 · StartSfxOnSlot 0x0722 · DoPendingReset 0x080D
//   (init list 0x104A) · OplWriteIfChanged 0x0175 (shadow 0x114D) · RecomputeTickIncrements 0x098F ·
//   CmdTick 0x021A.
// Established by the sound research pass (docs/sound.md); the Python reference si2.py's predictions
// matched every OPL register in the live race memory dump (fnum/block, levels, operator regs, tick
// increments). tools/check-si2.mjs diffs this port's register stream against that reference.
//
// Hardware caveats a player must honour: MICROU.EXE inits the driver with DX=388h, which skips OPL
// detection and never writes reg 01 (waveform select enable), 08 or BD — so there is no rhythm mode
// (9 melodic channels, music uses 0..7, sfx take the highest free channel from 8 down) and whether the
// E0–F5 waveform bytes are heard depends on the chip: a YM3812 gates them behind reg 01 bit 5 (all
// sines), an OPL3-class card or DOSBox's Nuked core plays them (src/audio/opl2.js, `strictOpl2`).
// Timing: CmdTick runs at the host interrupt rate
// (1193180/0x4287 = 70.06 Hz) and consumes the integer part of a 16.16 accumulator per tick
// (2.7409 sequence ticks per interrupt at division 96 / tempo 120), so real writes cluster on
// 70.06 Hz boundaries. Master volume 0x1256 is 00FF and never written: there is no volume/fade API.

import { toU8, u16le, u32le } from './bytes.js'

export const OFF = {
  ENGINE_RECORDS: 0x0008, // 4 × 16-byte sfx sequences for sfx ids 0x40..0x43 (patched live by MICROU.EXE)
  MAX_COMMAND: 0x00c3,
  COMMAND_TABLE: 0x00c4,
  BLOCK_TABLE: 0x09d3, // block<<2 per semitone
  FNUM_TABLE: 0x0a38, // 768 words: one octave in 1/64-semitone steps
  OP_OFFSETS: 0x1038, // 9 words: (op1, op2) register offsets per OPL channel
  INIT_REGS: 0x104a, // (reg, val) pairs, 00 00 terminated
  VOL_TABLE: 0x10cc, // 129 bytes: loudness index -> total level (attenuation)
  REG_SHADOW: 0x114d, // 256-byte OPL register shadow
  SLEEP_SEQ: 0x124d, // FF FF FF 7F 9A — "sleep forever" sequence for event 0x9A
  OPL_PORT: 0x1252,
  TIMER_DIV: 0x1254,
  MASTER_VOL: 0x1256,
  TRACK_COUNT: 0x1258,
  DIVISION: 0x125e,
  TEMPO: 0x125f,
  INC_MUSIC: 0x1261, // u32 16.16 music increment (frac at +0, int at +2)
  ACC_MUSIC: 0x1265, // u32 16.16 music accumulator
  INC_SFX: 0x1269,
  ACC_SFX: 0x126d,
  SLOTS: 0x1271, // 16 voice slots × 22 bytes
  P_MUSIC: 0x13f0,
  P_SFX: 0x13f2,
  P_INST: 0x13f4,
}
export const SLOT_SIZE = 0x16
export const SFX_TICK_RATE = 96 // 0x1680/60 sfx ticks per second
export const HOST_DIVISOR = 0x4287 // PIT reload MICROU.EXE passes with AH=2
export const HOST_HZ = 1193182 / HOST_DIVISOR

export const EVENT_NAMES = {
  0x90: 'NOTE_OFF_IF', 0x91: 'END_TRACK', 0x92: 'INSTRUMENT', 0x93: 'TEMPO', 0x94: 'NOP', 0x95: 'PITCH_BEND',
  0x96: 'VOLUME', 0x97: 'PERC_MODE', 0x98: 'JUMP_LOOP', 0x99: 'NOTE_OFF', 0x9a: 'SLEEP_FOREVER', 0x9b: 'SKIP1',
  0x9c: 'SET_LOOP', 0x9d: 'SKIP2', 0xff: 'REST',
}
export const EVENT_ARGC = { 0x90: 1, 0x91: 0, 0x92: 1, 0x93: 1, 0x94: 0, 0x95: 1, 0x96: 1, 0x97: 1, 0x98: 0, 0x99: 0, 0x9a: 0, 0x9b: 1, 0x9c: 0, 0x9d: 2, 0xff: 0 }

/** Static tables and bank parsing for one driver image. Nothing here mutates. */
export class Driver {
  /** `bankPointers`: where the three bank-offset words live; DRIVER2.BIN (the beeper) keeps them at 0x749. */
  constructor(data, { bankPointers = OFF.P_MUSIC } = {}) {
    const d = (this.d = toU8(data))
    this.fnum = Array.from({ length: 768 }, (_, i) => u16le(d, OFF.FNUM_TABLE + 2 * i))
    this.opOffsets = Array.from({ length: 9 }, (_, i) => [d[OFF.OP_OFFSETS + 2 * i], d[OFF.OP_OFFSETS + 2 * i + 1]])
    this.initRegs = []
    for (let a = OFF.INIT_REGS; !(d[a] === 0 && d[a + 1] === 0); a += 2) this.initRegs.push([d[a], d[a + 1]])
    this.musicBank = u16le(d, bankPointers)
    this.sfxBank = u16le(d, bankPointers + 2)
    this.instBank = u16le(d, bankPointers + 4)
    this.masterVol = u16le(d, OFF.MASTER_VOL)
  }

  blockByte(semitone) { return this.d[OFF.BLOCK_TABLE + (semitone & 0xff)] }
  volByte(idx) { return this.d[OFF.VOL_TABLE + (idx & 0xff)] }
  opOffWord(ch) { return u16le(this.d, OFF.OP_OFFSETS + 2 * (ch & 0xff)) }

  /** StartPendingTune 0x0606: bank+0 count, word bank+1 = pointer-table offset; header = division, tempo, ntracks, u16 track offsets (bank-relative). */
  tunes() {
    const mb = this.musicBank
    const n = this.d[mb]
    const pt = mb + u16le(this.d, mb + 1)
    const out = []
    for (let i = 0; i < n; i++) {
      const t = mb + u16le(this.d, pt + 2 * i)
      const ntr = this.d[t + 2]
      out.push({ index: i + 1, header: t, division: this.d[t], tempo: this.d[t + 1], tracks: Array.from({ length: ntr }, (_, k) => mb + u16le(this.d, t + 3 + 2 * k)) })
    }
    return out
  }

  /** StartSfxOnSlot 0x0759: bank+0 count, offsets at bank+1+2*(id-1), bank-relative. */
  sfxList() {
    const sb = this.sfxBank
    const n = this.d[sb]
    return Array.from({ length: n }, (_, i) => ({ index: i + 1, start: sb + u16le(this.d, sb + 1 + 2 * i) }))
  }

  /** Sfx ids 0x40..0x43: si = (id-0x40)*16 + 8, absolute in the driver image (0x0743). */
  engineRecords() { return [0, 1, 2, 3].map((i) => ({ index: 0x40 + i, start: OFF.ENGINE_RECORDS + 16 * i })) }

  /** EvtSetInstrument 0x03A9: ptr = [0x13F4] + 0x80 + n*16. 16 bytes. */
  instrument(n) { const p = this.instBank + 0x80 + (n & 0xff) * 16; return this.d.subarray(p, p + 16) }
  instrumentCount() { return Math.floor((this.d.length - this.instBank - 0x80) / 16) }
  percMap() { return this.d.subarray(this.instBank, this.instBank + 0x80) }

  /** ReadVarLenDelay 0x0925: MIDI-style big-endian VLQ, up to 4 continuation bytes; a 5th with bit 7 → 0xFFFFFFFF. */
  readVlq(pos) {
    const d = this.d
    let b = d[pos++]
    if (!(b & 0x80)) return [b, pos]
    let acc = b & 0x7f
    for (let k = 0; k < 4; k++) {
      b = d[pos++]
      if (!(b & 0x80)) return [((acc << 7) + b) >>> 0, pos]
      acc = ((acc << 7) + (b & 0x7f)) >>> 0
    }
    return [0xffffffff, pos]
  }

  /** ComputeBendOffset 0x0551: signed 16-bit (bend-0x40)*range. */
  bendOffset(bend, range) {
    let al = (bend - 0x40) & 0xff
    if (bend >= 0x40) return (al * range) & 0xffff
    al = -al & 0xff
    return -(al * range) & 0xffff
  }

  /** ComputeFnumBlock 0x0503: driver note (after transpose) → [regA0, regB0 without key-on]. */
  fnumBlock(note, bend, range) {
    const bx = ((note & 0xff) << 8) >> 2
    const ax0 = (bx + this.bendOffset(bend, range)) & 0xffff
    let ax = ax0
    while (ax >= 0x300) ax -= 0x300
    const semi = ((ax0 << 2) >> 8) & 0xff
    let bl = this.blockByte(semi)
    let fn = this.fnum[ax]
    if (fn & 0x8000) { fn &= 0x1fff; bl = (bl + 4) & 0xff }
    if (semi < 7) fn >>= 1
    fn &= 0x1fff
    return [fn & 0xff, ((fn >> 8) | bl) & 0xff]
  }

  /** SetVolumeRegs 0x0567 scaling chain → XLAT index (0..128 for sane input). */
  volIndex(level, vel, chvol) {
    let ax = (((level + 1) & 0xff) * ((vel + 1) & 0xff)) & 0xffff
    ax >>= 1
    let prod = ax * 8
    prod >>= 1
    ax = prod & 0xffff
    const cx = (((chvol + 1) & 0xff) << 1) & 0xffff
    let t = ax * cx
    ax = (t >> 8) & 0xffff
    t = ax * ((this.masterVol + 1) & 0xffff)
    return (t >> 16) & 0xff
  }

  /** SetVolumeRegs 0x0567 → [value for reg 40+op2 (carrier), value for reg 40+op1 (modulator)], written in that order. */
  volumeRegs(inst, vel, chvol) {
    const ksl2 = ((inst[0xc] >> 2) | (inst[0xc] << 6)) & 0xc0
    const car = ksl2 | this.volByte(this.volIndex(inst[0xb], vel, chvol))
    const modIdx = inst[9] & 1 ? this.volIndex(inst[0xa], vel, chvol) : inst[0xa]
    const ksl1 = (inst[0xc] << 2) & 0xc0
    return [car, ksl1 | this.volByte(modIdx)]
  }

  /** LoadInstrumentOperators 0x03C4: [reg, val] pairs in write order. */
  instrumentOplRegs(inst, ch, opoff) {
    const o1 = opoff & 0xff, o2 = (opoff >> 8) & 0xff
    return [[0x60 + o1, inst[0]], [0x60 + o2, inst[1]], [0x80 + o1, inst[2]], [0x80 + o2, inst[3]], [0xe0 + o1, inst[6]], [0xe0 + o2, inst[7]], [0xc0 + (ch & 0xff), inst[9]], [0x20 + o1, inst[4]], [0x20 + o2, inst[5]]]
  }

  /** RecomputeTickIncrements 0x098F: 16.16 increments for the host tick at `divisor`. */
  tickIncrements(divisor = HOST_DIVISOR, division = 96, tempo = 120) {
    if (divisor < 0x445) return { music: 1, sfx: 1, ipm: 0 } // driver forces 1/65536 and reports AL=1
    const ipm = Math.floor(0x04446390 / divisor) // interrupts per minute
    const inc = (unitsPerMinute) => {
      const q = Math.floor(unitsPerMinute / ipm), r = unitsPerMinute % ipm
      const frac = Math.floor((r * 65536 + q) / ipm) & 0xffff // second DIV with DX:AX = rem:quot (the driver's quirk)
      return q * 65536 + frac
    }
    return { music: inc(division * tempo), sfx: inc(0x1680), ipm }
  }
}

export const oplFreqHz = (a0, b0) => ((a0 | ((b0 & 3) << 8)) * 49716) / (1 << (20 - ((b0 >> 2) & 7)))
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
/** Driver note n == MIDI note n+12. */
export const noteName = (n) => { const m = n + 12; return `${NOTE_NAMES[m % 12]}${Math.floor(m / 12) - 1}` }

/** Decode one track's byte stream without timing: [{offset, delay, op, kind, args}], stops at END/JUMP_LOOP/SLEEP. */
export function decodeTrack(drv, pos, limit = 100000) {
  const out = []
  const start = pos
  let delay
  ;[delay, pos] = drv.readVlq(pos)
  while (pos - start < limit) {
    const op = drv.d[pos]
    const ev = { offset: pos, delay, op, args: [] }
    pos++
    if (op < 0x80) { ev.kind = 'NOTE_ON'; ev.args = [drv.d[pos]]; pos++ }
    else if (op < 0x90) ev.kind = `CHANNEL(${op & 0xf})`
    else if (op in EVENT_ARGC) { const n = EVENT_ARGC[op]; ev.kind = EVENT_NAMES[op]; ev.args = Array.from(drv.d.subarray(pos, pos + n)); pos += n }
    else ev.kind = 'BAD_OPCODE'
    out.push(ev)
    if (op === 0x91 || op === 0x9a || ev.kind === 'BAD_OPCODE') break
    ;[delay, pos] = drv.readVlq(pos)
    if (op === 0x98) break
  }
  return out
}

/**
 * Structure of one track: where its loop point is and whether anything sounds inside the loop.
 * Tunes 1–3 open with `00 8n 00 9C` and loop their whole body; tunes 4–8 open with `00 8n 00 92 ii`,
 * put `9C` near the END and have no NOTE ON inside the loop — they play once, then loop a silent
 * tail forever while staying the "current" tune (so the game's AH=9 poll does not restart them).
 */
export function trackStats(drv, pos) {
  const evs = decodeTrack(drv, pos)
  const loopIdx = evs.findIndex((e) => e.op === 0x9c)
  const notes = evs.filter((e) => e.kind === 'NOTE_ON').length
  const notesInLoop = loopIdx < 0 ? 0 : evs.slice(loopIdx).filter((e) => e.kind === 'NOTE_ON').length
  const total = evs.reduce((a, e) => a + e.delay, 0)
  const loopLen = loopIdx < 0 ? 0 : evs.slice(loopIdx + 1).reduce((a, e) => a + e.delay, 0)
  return { events: evs.length, notes, notesInLoop, loops: notesInLoop > 0, totalTicks: total, loopTicks: loopLen, endsWith: evs.at(-1)?.kind }
}

class Slot {
  constructor(index) {
    this.index = index; this.pos = 0; this.counter = 0; this.loop = 0; this.channel = index; this.note = 0
    this.state = 0; this.b0 = 0; this.opoff = 0; this.instPtr = -1; this.instNum = 0xff; this.volume = 0x7f
    this.sfxId = 0; this.perc = 0; this.bendRange = 2; this.bend = 0x40; this.loops = 0
  }
}

/**
 * Faithful sequencer. Two clocks are offered:
 *   stepSequenceTick(kind)  — one sequence tick for music ('music') or sfx ('sfx') slots (si2.py's model)
 *   hostTick()              — one 70.06 Hz interrupt as CmdTick does it: 16.16 accumulators, whole
 *                             integer parts handed to every slot, so writes cluster like the real driver.
 * writes = [tick, reg, val] after OplWriteIfChanged dedupe; timeline = human-readable events.
 */
export class Sequencer {
  constructor(drv, { dedupe = true, divisor = HOST_DIVISOR } = {}) {
    this.drv = drv
    // The driver's memory image. MICROU.EXE writes INTO it at run time: the four 16-byte engine
    // sound records at +0x08 (instrument, pitch-bend byte, delay, loop/end opcode — see
    // patchEngineRecord). Sequence and instrument bytes are read from here, not from drv.d.
    this.image = new Uint8Array(drv.d)
    this.dedupe = dedupe
    this.shadow = new Uint8Array(drv.d.subarray(OFF.REG_SHADOW, OFF.REG_SHADOW + 256))
    this.slots = Array.from({ length: 16 }, (_, i) => new Slot(i))
    this.writes = []
    this.timeline = []
    this.tick = 0
    this.currentTune = 0
    // Division/tempo also start as the FILE's [0x125E]/[0x125F] = 192/120, not a tune's 96/120: the
    // AH=2 call computes the increments from these, so idle ticks before the first tune accumulate
    // 5.48 sequence ticks each and that fraction carries into the tune (visible live as a one-tick phase).
    this.division = drv.d[OFF.DIVISION]
    this.tempo = drv.d[OFF.TEMPO]
    this.divisor = divisor
    // The accumulators start with the FILE's values (0x1265 / 0x126D = 01 00 01 00: fraction 1, integer
    // part 1); CmdTick clears only the integer part after each tick, so the fraction seeds the phase.
    // Live: this one-tick phase is visible in the capture (tools/check-si2-live.mjs).
    this.musicAcc = u32le(drv.d, OFF.ACC_MUSIC)
    this.sfxAcc = u32le(drv.d, OFF.ACC_SFX)
    // Driver variables (offsets in DRIVER1.BIN): pending tune [125A], current tune [125B],
    // pending stop-music [125C], pending reset [125D], track count [1258], sfx queues [13D1]/[13D9].
    this.pendingTune = 0
    this.pendingStop = false
    this.pendingReset = false
    this.trackCount = 0
    // The two 8-byte id queues at [13D1] (start) and [13D9] (stop): fixed arrays, 0 = empty, kept as
    // bytes because the insert position (first zero, else a lower-priority victim) decides the
    // processing order and therefore the OPL channel each sfx gets.
    this.sfxStartQueue = new Uint8Array(8)
    this.sfxStopQueue = new Uint8Array(8)
    this.recomputeIncrements()
  }

  /**
   * PushSfxQueue 0x06CB — the shared tail of CmdStopSfx 0x06C3 and CmdPlaySfx 0x06C8:
   *   0x06D0  ids >= 0x40 (the engine loops) that are already queued are a no-op → AL 0
   *   0x06E6  first empty entry takes the id → AL 0
   *   0x06F2  else the first entry whose id < AL (signed) is REPLACED (id doubles as priority) → AL 0
   *   0x06FB  else INT 3 (debug leftover) and AL 1: the new id is dropped
   */
  pushSfxQueue(q, al) {
    al &= 0xff
    const signed = (v) => (v << 24) >> 24
    if (signed(al) >= 0x40 && q.includes(al)) return 0
    const free = q.indexOf(0)
    if (free >= 0) { q[free] = al; return 0 }
    const victim = q.findIndex((e) => signed(e) < signed(al))
    if (victim >= 0) { q[victim] = al; return 0 }
    return 1
  }

  /**
   * The far-call API as MICROU.EXE uses it (DispatchCommand 0x0094, AH = command). Returns AL/AX like
   * the driver. Most commands only set a pending flag or queue an id; the work happens in hostTick().
   */
  command(ah, al = 0) {
    switch (ah) {
      case 0: return 0 // CmdInit (DX=388h path): no OPL writes
      case 1: return 0 // CmdShutdown
      case 2: this.recomputeIncrements(); return this.divisor < 0x445 ? 1 : 0 // CmdSetTimerDivisor
      case 3: this.hostTick(); return 0 // CmdTick
      case 4: if (this.currentTune !== al) this.pendingTune = al; return 0 // CmdPlayTune 0x0492
      case 5: return this.pushSfxQueue(this.sfxStartQueue, al) // CmdPlaySfx 0x06C8 (queue 0x13D1)
      case 6: this.pendingReset = true; return 0 // CmdRequestReset 0x0804
      case 7: this.pendingStop = true; return 0 // CmdStopMusic 0x0841
      case 8: return this.pushSfxQueue(this.sfxStopQueue, al) // CmdStopSfx 0x06C3 (queue 0x13D9)
      case 9: return (al - this.currentTune) & 0xff // CmdIsTunePlaying 0x08F1
      case 10: return this.slots.some((s) => s.sfxId === al) ? 0 : al // CmdIsSfxActive 0x08F6
      case 11: return this.slots.filter((s) => s.state === 2).length // CmdCountSfxVoices
      default: return 0xffff
    }
  }

  /**
   * DoPendingReset 0x080D: clear BOTH sfx queues (ClearSfxStartQueue 0x088F does `REP STOSW` of 8 words
   * at 0x13D1, which spans the start queue 0x13D1 and the stop queue 0x13D9), write the init list
   * unconditionally, free every slot (no key-off writes; b0 is left as is), current tune := 0.
   */
  doPendingReset() {
    if (!this.pendingReset) return
    this.sfxStartQueue.fill(0)
    this.sfxStopQueue.fill(0)
    for (const [r, v] of this.drv.initRegs) this.wrAlways(r, v)
    for (const s of this.slots) { s.state = 0; s.sfxId = 0 }
    this.pendingReset = false
    this.currentTune = 0
  }

  /**
   * DoPendingStopMusic 0x084A. Quirk kept on purpose: it loops over [0x1258] = the track count of the
   * LAST STARTED tune and `JCXZ`-skips everything — including clearing the pending flag — while that
   * count is 0 (fresh driver). Live (title start): the game's AH=7 issued before the first tune start
   * therefore fired one tick AFTER the tune began, keying its notes off again.
   */
  doPendingStopMusic() {
    if (!this.pendingStop) return
    const n = this.trackCount
    if (n === 0 || n > 16) return
    for (let i = 0; i < n; i++) { const s = this.slots[i]; this.keyOff(s); s.state = 0; s.sfxId = 0 }
    this.pendingStop = false
    this.currentTune = 0
  }

  /** StartPendingTune 0x0606 (validated against the disassembly: only the listed slot fields are reset). */
  startPendingTune() {
    const n = this.pendingTune
    if (!n) return
    this.pendingTune = 0
    const tunes = this.drv.tunes()
    if (n > tunes.length) return 1
    for (const s of this.slots) if (s.state) { this.keyOff(s); s.state = 0; s.sfxId = 0 }
    this.currentTune = n
    const t = tunes[n - 1]
    this.division = t.division; this.tempo = t.tempo
    this.trackCount = t.tracks.length
    t.tracks.forEach((tp, k) => {
      const s = this.slots[k]
      s.loop = tp
      ;[s.counter, s.pos] = this.readVlq(tp)
      s.state = 1; s.bendRange = 2; s.bend = 0x40; s.perc = 0; s.instNum = 0xff; s.volume = 0x7f; s.loops = 0
    })
    this.recomputeIncrements()
    this.log(this.slots[0], `TUNE ${n} start: division=${t.division} tempo=${t.tempo} tracks=${t.tracks.length}`)
    return 0
  }

  /** ProcessSfxStopQueue 0x089E → StopQueuedSfx 0x08B4: first slot in state 2 with that sfx id is keyed off and freed. */
  processSfxStopQueue() {
    const q = this.sfxStopQueue
    for (let i = 0; i < 8; i++) {
      const id = q[i]
      if (!id) continue
      q[i] = 0
      const s = this.slots.find((x) => x.state === 2 && x.sfxId === id)
      if (s) { this.keyOff(s); s.state = 0; s.sfxId = 0 }
    }
  }

  /** ProcessSfxStartQueue 0x0704 → StartSfxOnSlot 0x0722 (channel choice: highest free OPL channel from 8 down). */
  processSfxStartQueue() {
    // 0x0704: entries 0..7 are taken in order, each cleared before the attempt; a failed start (CF) ends
    // the drain for this tick — that entry is lost, the rest wait in place.
    const q = this.sfxStartQueue
    for (let i = 0; i < 8; i++) {
      const id = q[i]
      if (!id) continue
      q[i] = 0
      if (!this.startSfx(id)) return
    }
  }

  recomputeIncrements() {
    const t = this.drv.tickIncrements(this.divisor, this.division, this.tempo)
    this.musicInc = t.music
    this.sfxInc = t.sfx
  }

  /** ReadVarLenDelay 0x0925 over the live image. */
  readVlq(pos) {
    const d = this.image
    let b = d[pos++]
    if (!(b & 0x80)) return [b, pos]
    let acc = b & 0x7f
    for (let k = 0; k < 4; k++) {
      b = d[pos++]
      if (!(b & 0x80)) return [((acc << 7) + b) >>> 0, pos]
      acc = ((acc << 7) + (b & 0x7f)) >>> 0
    }
    return [0xffffffff, pos]
  }

  /**
   * What InitOplEngineSfxRecords (MICROU.EXE 1000:7A97) and the per-frame engine update (1000:7B46)
   * write into engine record `car` (0..3) at image+0x08+16*car:
   *   +2 instrument (0x70 or 0x71 by vehicle class), +0xA pitch-bend byte (speed/10, +0x30 airborne),
   *   +0xB delay, +0xC 0x98 (loop) or 0x91 (end). Record: 00 | 92 ii | 00 | 9C | 00 | 23 7F | 01 | 95 bb | dd | 98.
   */
  patchEngineRecord(car, { instrument, bend, delay, loop } = {}) {
    const o = OFF.ENGINE_RECORDS + 16 * (car & 3)
    if (instrument !== undefined) this.image[o + 2] = instrument & 0xff
    if (bend !== undefined) this.image[o + 0xa] = bend & 0xff
    if (delay !== undefined) this.image[o + 0xb] = delay & 0xff
    if (loop !== undefined) this.image[o + 0xc] = loop ? 0x98 : 0x91
  }

  /**
   * The game's per-physics-step engine update for one car, UpdateEngineSoundsPerFrame 1000:7BEE–7C24:
   * poke the pitch byte into record +0xA together with 98h (JUMP_LOOP) at +0xC — or 91h (END) when the
   * pitch is 0, which lets the running loop end by itself with no command — then, for a non-zero pitch
   * only, `AH=0A` asks whether sfx 40h+car is still active and `AH=5` queues it only if it is not
   * (7C0E–7C1F). `instrument` (70h/71h by vehicle class) and `delay` are the bytes 1000:7A97 writes once
   * at race start. Returns the AH=5 result when one was issued, else null.
   */
  engineUpdate(car, { bend = 0x40, instrument, delay } = {}) {
    const id = 0x40 + (car & 3)
    this.patchEngineRecord(car, { instrument, delay, bend, loop: bend !== 0 })
    if (bend === 0) return null
    return this.command(10, id) !== 0 ? this.command(5, id) : null
  }

  wr(reg, val) { // OplWriteIfChanged 0x0175
    reg &= 0xff; val &= 0xff
    if (this.dedupe && this.shadow[reg] === val) return
    this.shadow[reg] = val
    this.writes.push([this.tick, reg, val])
  }
  wrAlways(reg, val) { this.shadow[reg & 0xff] = val & 0xff; this.writes.push([this.tick, reg & 0xff, val & 0xff]) } // OplWriteAlways 0x019D
  log(s, text) { this.timeline.push({ tick: this.tick, slot: s.index, channel: s.channel, text }) }

  reset() { // DoPendingReset 0x080D
    for (const [r, v] of this.drv.initRegs) this.wrAlways(r, v)
    for (const s of this.slots) { s.state = 0; s.sfxId = 0 }
    this.currentTune = 0
  }

  startTune(n) { // StartPendingTune 0x0606 + StartTuneTrack 0x0682
    const t = this.drv.tunes()[n - 1]
    if (!t) throw new Error(`tune ${n} does not exist`)
    for (const s of this.slots) { if (s.state) this.keyOff(s); s.state = 0; s.sfxId = 0 }
    this.currentTune = n
    this.division = t.division; this.tempo = t.tempo
    this.trackCount = t.tracks.length
    this.recomputeIncrements()
    t.tracks.forEach((tp, k) => {
      const s = this.slots[k]
      s.loop = tp
      ;[s.counter, s.pos] = this.readVlq(tp)
      s.state = 1; s.bendRange = 2; s.bend = 0x40; s.perc = 0; s.instNum = 0xff; s.volume = 0x7f; s.loops = 0
    })
    this.log(this.slots[0], `TUNE ${n} start: division=${t.division} tempo=${t.tempo} tracks=${t.tracks.length} -> ${(t.division * t.tempo) / 60} ticks/s`)
    return t
  }

  /**
   * StartSfxOnSlot 0x0722: first free slot (FindFreeSlot 0x0784) and the highest OPL channel not held
   * by any active slot, 8 down to 0 (FindFreeOplChannel 0x07BE, re-disassembled live for M3.28,
   * `docs/sound.md` §3/`UNKNOWN_channel_exhaustion`). With all 9 channels busy (`07D9`), the real
   * driver does NOT simply drop -- it rescans all 16 slots for one already in state 2 (sfx) whose
   * own id is <= 7 (`07DF-07EB`); if one exists, the routine returns SUCCESS with channel `0xFF`
   * (`07FF-0803`, confirmed live: `BL` is decremented past 0 to `0xFF` at `07D5-07D7` and never
   * restored before this success return) -- the new sfx genuinely occupies a real slot (state 2,
   * its own id, so a later `AH=10` correctly reports it playing) but every OPL register write for
   * it lands on `0xA0|0xFF=0xFF`/`0xB0|0xFF=0xFF` (not a real channel register, no audible effect)
   * and its "operator offset" is `opOffWord(0xFF)`, which -- already generic in `ch` with no
   * special-casing needed -- reads 510 bytes past the real 9-word table, into whatever the shipped
   * driver image actually holds there (this port's own `this.d` bytes, the same image the real game
   * would have read from at the same fixed offset). Genuine drop (`07F6-07F8`, INT3/STC) only when
   * NO state-2 low-id slot exists to justify the "success" path. 8 of 9 channels busy was observed
   * live during a race (engines + overlapping drop-in sfx); the shipped game is one voice away from
   * this path, not seen live itself. Returns the slot, or null only on a genuine drop.
   */
  startSfx(sfxId, slotIndex = null) {
    if (slotIndex === null) slotIndex = this.slots.findIndex((s) => s.state === 0)
    if (slotIndex < 0) return null
    const s = this.slots[slotIndex]
    const used = new Set(this.slots.filter((x) => x.state).map((x) => x.channel))
    let ch = 8; while (ch >= 0 && used.has(ch)) ch--
    if (ch < 0) {
      const hasLowIdSfxSlot = this.slots.some((x) => x.state === 2 && x.sfxId <= 7)
      if (!hasLowIdSfxSlot) { this.log(s, `SFX ${sfxId} dropped: no free OPL channel`); return null }
      ch = 0xff
    }
    s.channel = ch; s.sfxId = sfxId; s.opoff = this.drv.opOffWord(ch)
    const start = sfxId >= 0x40 ? OFF.ENGINE_RECORDS + (sfxId - 0x40) * 16 : this.drv.sfxList()[sfxId - 1].start
    ;[s.counter, s.pos] = this.readVlq(start)
    s.state = 2; s.loops = 0
    this.log(s, ch === 0xff
      ? `SFX ${sfxId} start on a "phantom" slot: all 9 channels busy, occupies a slot silently (channel 0xFF)`
      : `SFX ${sfxId} start @0x${start.toString(16)} on channel ${ch}`)
    return s
  }

  keyOff(s) { if (s.b0 & 0x20) { s.b0 &= 0xdf; this.wr(0xb0 | s.channel, s.b0) } } // EvtKeyOff 0x034A

  loadInstrument(s) { // LoadInstrumentOperators 0x03C4
    const inst = this.image.subarray(s.instPtr, s.instPtr + 16)
    for (const [r, v] of this.drv.instrumentOplRegs(inst, s.channel, s.opoff)) this.wr(r, v)
  }

  noteOn(s, note) { // NoteOnSetFreqKeyOn 0x049E
    const d = this.drv
    let eff
    if (s.perc) {
      const instN = this.image[d.instBank + (note < 0x80 ? note & 0x7f : note)]
      if (instN !== s.instNum) { s.instNum = instN; s.instPtr = d.instBank + 0x80 + instN * 16; this.loadInstrument(s) }
      eff = this.image[s.instPtr + 8]; s.note = eff
    } else eff = (note - 0x18 + this.image[s.instPtr + 8]) & 0xff
    const [a0, b0] = d.fnumBlock(eff, s.bend, s.bendRange)
    this.wr(0xa0 | s.channel, a0)
    s.b0 = b0 | 0x20
    this.wr(0xb0 | s.channel, s.b0)
    return [a0, s.b0, eff]
  }

  setVolume(s, vel) { // SetVolumeRegs 0x0567
    const inst = this.image.subarray(s.instPtr, s.instPtr + 16)
    const [car, mod] = this.drv.volumeRegs(inst, vel, s.volume)
    this.wr(0x40 + ((s.opoff >> 8) & 0xff), car)
    this.wr(0x40 + (s.opoff & 0xff), mod)
    return [car, mod]
  }

  /** TickAdvanceSlot 0x0273 with `n` sequence ticks consumed at once (the driver passes the accumulator's integer part). */
  advance(s, n = 1) {
    const d = this.drv
    const img = this.image
    if (s.state === 0) return
    s.counter -= n
    if (s.counter >= 0) return
    for (;;) {
      let pos = s.pos
      const op = img[pos++]
      if (op < 0x80) {
        s.note = op
        if (s.b0 & 0x20 && !(s.state === 2 && s.sfxId >= 0x40)) { s.b0 &= 0xdf; this.wr(0xb0 | s.channel, s.b0) }
        if (s.instPtr < 0) { this.log(s, `NOTE ${op} before any INSTRUMENT (undefined in driver)`); s.instPtr = d.instBank + 0x80 }
        const [a0, b0, eff] = this.noteOn(s, op)
        const vel = img[pos++]
        const [car, mod] = this.setVolume(s, vel)
        this.log(s, `NOTE_ON n=${op} vel=${vel} eff=${eff}(${noteName(eff)}) inst=${s.instNum} -> A0=${a0.toString(16)} B0=${b0.toString(16)} (${oplFreqHz(a0, b0).toFixed(1)} Hz) car=${car.toString(16)} mod=${mod.toString(16)}`)
      } else if (op === 0xff) {
        // rest
      } else if (op >= 0x90 && op <= 0x9d) {
        switch (op) {
          case 0x90: { const nn = img[pos++]; if (nn === s.note) this.keyOff(s); this.log(s, `NOTE_OFF_IF ${nn}`); break }
          case 0x91: {
            const was = s.state
            s.state = 0; s.sfxId = 0
            if (was === 1 && !this.slots.some((x) => x.state === 1)) this.currentTune = 0
            this.keyOff(s); this.log(s, 'END_TRACK'); s.pos = pos
            return
          }
          case 0x92: {
            s.volume = 0x7f; s.bend = 0x40
            s.instNum = img[pos++]; s.instPtr = d.instBank + 0x80 + s.instNum * 16; s.bendRange = img[s.instPtr + 0xf]
            this.loadInstrument(s); this.log(s, `INSTRUMENT ${s.instNum} (bend_range=${s.bendRange})`); break
          }
          case 0x93: this.tempo = img[pos++]; this.recomputeIncrements(); this.log(s, `TEMPO ${this.tempo}`); break
          case 0x94: this.log(s, 'NOP'); break
          case 0x95: {
            s.bend = img[pos++]
            if (s.b0 & 0x20) {
              const eff = (s.note + img[s.instPtr + 8] - 0x18) & 0xff
              const [a0, b0] = d.fnumBlock(eff, s.bend, s.bendRange)
              this.wr(0xa0 | s.channel, a0); s.b0 = b0 | 0x20; this.wr(0xb0 | s.channel, s.b0)
              this.log(s, `PITCH_BEND ${s.bend} -> ${oplFreqHz(a0, s.b0).toFixed(1)} Hz`)
            } else this.log(s, `PITCH_BEND ${s.bend} (stored)`)
            break
          }
          case 0x96: s.volume = img[pos++]; this.log(s, `VOLUME ${s.volume}`); break
          case 0x97: s.perc = img[pos++]; this.log(s, `PERC_MODE ${s.perc}`); break
          case 0x98: pos = s.loop; s.loops++; this.log(s, `JUMP_LOOP -> 0x${pos.toString(16)}`); break
          case 0x99: this.keyOff(s); this.log(s, 'NOTE_OFF'); break
          case 0x9a: pos = OFF.SLEEP_SEQ; this.log(s, 'SLEEP_FOREVER'); break
          case 0x9b: pos += 1; this.log(s, 'SKIP1'); break
          case 0x9c: s.loop = pos; this.log(s, `SET_LOOP @0x${pos.toString(16)}`); break
          case 0x9d: pos += 2; this.log(s, 'SKIP2'); break
        }
      } else if (op < 0x90) {
        s.channel = op & 0xf; s.opoff = d.opOffWord(s.channel)
        this.log(s, `CHANNEL ${s.channel}`)
      } else { // 0x9E..0xFE: bad opcode → end track
        this.log(s, `BAD_OPCODE ${op.toString(16)} -> END_TRACK`)
        s.state = 0; s.sfxId = 0; this.keyOff(s); s.pos = pos
        return
      }
      const [delay, np] = this.readVlq(pos)
      s.counter += delay; s.pos = np
      if (s.counter >= 0) return
    }
  }

  /** One sequence tick for the slots of one kind (music at division*tempo/60 per s, sfx at 96/s). */
  stepSequenceTick(kind = 'music') {
    this.tick++
    const st = kind === 'sfx' ? 2 : 1
    for (const s of this.slots) if (s.state === st) this.advance(s, 1)
  }

  /** CmdTick 0x021A at the host interrupt rate: pending work, then accumulate and hand the integer parts to the slots. */
  hostTick() {
    this.tick++
    this.doPendingReset()
    this.doPendingStopMusic()
    this.startPendingTune()
    this.processSfxStopQueue()
    this.processSfxStartQueue()
    this.musicAcc += this.musicInc; this.sfxAcc += this.sfxInc
    const nm = this.musicAcc >>> 16, ns = this.sfxAcc >>> 16
    this.musicAcc &= 0xffff; this.sfxAcc &= 0xffff
    for (const s of this.slots) {
      if (s.state === 1 && nm) this.advance(s, nm)
      else if (s.state === 2 && ns) this.advance(s, ns)
    }
  }

  get active() { return this.slots.filter((s) => s.state) }

  /** Run sequence ticks until every active track looped `loops` times or nothing is active (si2.py's run()). */
  runSequenceTicks(maxTicks, loops = 1) {
    while (this.tick < maxTicks) {
      this.stepSequenceTick('music')
      const act = this.active
      if (!act.length) break
      if (loops && act.every((s) => s.loops >= loops)) break
    }
  }
}

/**
 * `AdvancePseudoRandom48 1000:7CAE` (docs/sound.md §6): the engine-pitch jitter PRNG, "own it in
 * the sound layer -- it is deterministic given the per-car call order." Three 16-bit words
 * OVERLAPPING one byte apart in a 4-byte buffer (file seed `45 23 56 26`, i.e. `CS:7CDB..7CDE`),
 * each read AFTER the previous word's write has already landed on top of it -- verified byte-exact
 * against the disassembly at `7cae-7cda` (read live this session) and against the doc's own
 * corroboration checkpoint: 6204 calls from the file seed reaches state `45 90 69 B2` here exactly.
 *   w0 = word[0]; w0 = (w0^0x234)+0x2244 (16-bit, sets CF); write word[0]=w0
 *   w1 = word[1] (already sees w0's high byte); w1 = (w1+word[0]+CF)&0xFFFF ^ 0x22AB; write word[1]
 *   w2 = word[2] (already sees w1's high byte); w2 = (w2+0x233)&0xFFFF ^ 0x5345; write word[2]
 *   return w2 (the two XORs above always clear CF, so the final ADC is a plain ADD -- matches docs)
 * `createEngineJitter()` returns a `next()` closure holding its own 4-byte state (one instance per
 * race/session, matching the one shared `CS`-relative buffer the real driver call site uses).
 */
export function createEngineJitter(seed = new Uint8Array([0x45, 0x23, 0x56, 0x26])) {
  const state = Uint8Array.from(seed)
  const rd = (o) => state[o] | (state[o + 1] << 8)
  const wr = (o, v) => { state[o] = v & 0xff; state[o + 1] = (v >> 8) & 0xff }
  return function next() {
    let ax = rd(0) ^ 0x234
    let sum = ax + 0x2244
    const cf = sum > 0xffff ? 1 : 0
    ax = sum & 0xffff
    wr(0, ax)
    sum = rd(1) + rd(0) + cf
    ax = (sum & 0xffff) ^ 0x22ab
    wr(1, ax)
    sum = (rd(2) + 0x233) & 0xffff
    ax = sum ^ 0x5345
    wr(2, ax)
    return ax
  }
}
