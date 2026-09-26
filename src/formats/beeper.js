// DRIVER2.BIN, "Sound Images Generation 2 ... Internal Beeper v1.08" (docs/sound.md §4), and
// DRIVER0.BIN, the null driver -- modelled on the driver's own image as memory, so the state can be
// compared byte for byte with a live read of segment 2424. Every routine below is a transcription of
// the listed DRIVER2.BIN offsets (`ndisasm -b16`, docs/sound.md §4b).
//
// Layout (DRIVER2.BIN file offsets = segment offsets):
//   0x06E  the "sleep forever" stream FF FF FF 7F 9A (opcode 9A points a slot here)
//   0x073  w  host PIT divisor (AH=2)            0x075  w  track count of the last started tune
//   0x077  b  pending tune (AH=4)                0x078  b  current tune
//   0x079  b  pending stop-music (AH=7)          0x07A  b  pending reset (AH=6)
//   0x07B  b  division   0x07C  b  tempo         0x07D  b  re-entry guard of the tick
//   0x07E  dw music increment (16.16)            0x082  dw music accumulator (0x084 = whole ticks)
//   0x086  dw sfx increment                      0x08A  dw sfx accumulator (0x08C = whole ticks)
//   0x08E  w  last period written to PIT channel 2
//   0x090  b  round-robin counter, 0x091 4 words: the slot addresses
//   0x099  b  engine alternation counter, 0x09A b engine voice mask, 0x09B/0x09D w their periods
//   0x09F  4 slots x 0x12: +0 stream, +2 dw counter, +6 loop point, +8 channel, +9 note,
//          +A state (0 free, 1 music, 2 sfx), +B sounding, +C instrument ptr, +E sfx id,
//          +F w period, +11 gate countdown
//   0x0E7  8-byte sfx start queue (AH=5), 0x0EF 8-byte stop queue (AH=8)
//   0x124  b  highest accepted command (0 until AH=0, then 0x10); 0x125 the handler table
//   0x689  96 PIT periods, by (note + transpose - 0x18)
//   0x749/0x74B/0x74D  offsets of the music bank, the sfx bank, the instrument bank (16 B each; only
//          +8 transpose and +9 gate are read)
//
// Output: PIT channel 2 in mode 3 (0x43 <- 0xB6 at init) and port 0x61's bits 0 (gate) and 1
// (speaker data). One period per tick: the two engine voices (AH=0E/0F/10) alternate tick by tick
// while no sfx is running; otherwise one sounding slot per tick, round-robin (chords arpeggiate at
// 70 Hz). A note sounds for its instrument's gate (+9) in ticks, then the slot goes quiet.

export const BEEPER_PIT_HZ = 1193182
const SLOT0 = 0x9f
const SLOT_SIZE = 0x12
const NSLOTS = 4

export class BeeperDriver {
  /** `image`: DRIVER2.BIN's bytes (copied). */
  constructor(image) {
    this.m = new Uint8Array(image) // a fresh copy: LoadSoundDriverBinModule reads the whole file
    this.port61 = 0 // bits 0/1 of port 0x61 as the driver leaves them
    this.pit = 0 // the count last programmed into PIT channel 2 (hi byte masked to 5 bits, 037E-0382)
    this.pitMode = null // 0x43 <- 0xB6 at init
    this.tick = 0
  }

  b(a) { return this.m[a & 0xffff] }
  w(a) { return this.m[a & 0xffff] | (this.m[(a + 1) & 0xffff] << 8) }
  sb(a, v) { this.m[a & 0xffff] = v & 0xff }
  sw(a, v) { this.m[a & 0xffff] = v & 0xff; this.m[(a + 1) & 0xffff] = (v >> 8) & 0xff }

  /** True while the speaker sounds: the PIT gate and the speaker data bit are both set. */
  get sounding() { return (this.port61 & 3) === 3 }
  /** The tone the speaker plays now, in Hz (0 when silent). A count of 0 is 65536. */
  get frequency() { return this.sounding ? BEEPER_PIT_HZ / (this.pit || 0x10000) : 0 }

  /** The far entry `+0x04 -> +0xF7`: AH = command. Returns AX. `cx` is only read by AH=2/0E/0F. */
  command(ah, al = 0, cx = 0) {
    if (ah > this.b(0x124)) return 0xffff // 0101: CMP AH,[0x124]; JA
    const ax = (ah << 8) | (al & 0xff)
    switch (ah) {
      case 0x0: return this.init(ax)
      case 0x1: this.port61 &= 0xfc; this.sb(0x124, 0); return ax & 0xff00 // 016E
      case 0x2: { this.sw(0x73, cx); return this.recompute() } // 017A (under CLI)
      case 0x3: return this.hostTick()
      case 0x4: this.sb(0x77, al); return ax & 0xff00 // 0392
      case 0x5: return this.queue(0xe7, al, ax) // 0431
      case 0x6: this.sb(0x7a, 1); return ax & 0xff00 // 04B3
      case 0x7: this.sb(0x79, 1); return ax & 0xff00 // 04E8
      case 0x8: return this.queue(0xef, al, ax) // 042C
      case 0x9: return (ax & 0xff00) | ((al - this.b(0x78)) & 0xff) // 0561: AL - current tune
      case 0xa: { // 0566: 0 if some slot holds this sfx id (any state), else the id
        for (let i = 0; i < NSLOTS; i++) if (((al - this.b(SLOT0 + i * SLOT_SIZE + 0xe)) & 0xff) === 0) return ax & 0xff00
        return ax
      }
      case 0xb: { let n = 0; for (let i = 0; i < NSLOTS; i++) if (this.b(SLOT0 + i * SLOT_SIZE + 0xa) === 2) n++; return 0x200 | n } // 057B
      case 0xc: return 0x57 // 0591
      case 0xd: return 0x67 // 0595
      case 0xe: // 0647: engine voice on, period CX
        if (al) { this.sw(0x9d, cx); this.sb(0x9a, this.b(0x9a) | 2) } else { this.sw(0x9b, cx); this.sb(0x9a, this.b(0x9a) | 1) }
        return ax & 0xff00
      case 0xf: if (al) this.sw(0x9d, cx); else this.sw(0x9b, cx); return ax & 0xff00 // 0663: period only
      case 0x10: this.sb(0x9a, this.b(0x9a) & (al ? 0xfd : 0xfe)); return ax & 0xff00 // 0675: voice off
      default: return 0xffff
    }
  }

  /** 0147: PIT channel 2 to mode 3, the slots cleared and numbered, the increments, max command 0x10. */
  init(ax) {
    this.pitMode = 0xb6
    for (let i = 0; i < NSLOTS; i++) {
      const di = SLOT0 + i * SLOT_SIZE
      this.sb(di + 0xa, 0); this.sb(di + 0xe, 0); this.sb(di + 0x8, i)
    }
    this.recompute()
    this.sb(0x124, 0x10)
    return ax & 0xff00
  }

  /** 0603: interrupts/min = 0x04446390 / [73]; music = division*tempo/ipm, sfx = 0x1680/ipm, as 16.16. */
  recompute() {
    const div = this.w(0x73)
    if (div < 0x445) { this.sw(0x80, 0); this.sw(0x7e, 1); return 1 } // 063C (AX = 1)
    const ipm = Math.floor(0x04446390 / div) & 0xffff
    // 061E-0636: the second DIV divides DX:AX = remainder:quotient (AX still holds the quotient), the
    // same quirk as DRIVER1's RecomputeTickIncrements (si2.js tickIncrements)
    const inc = (hiAt, loAt, units) => {
      const q = Math.floor(units / ipm), r = units % ipm
      this.sw(hiAt, q); this.sw(loAt, Math.floor((r * 0x10000 + q) / ipm))
    }
    inc(0x80, 0x7e, this.b(0x7b) * this.b(0x7c))
    inc(0x88, 0x86, 0x1680)
    return 0
  }

  /** 0431/042C: the first empty byte of the 8-byte queue takes the id; AL=1 when full. */
  queue(base, al, ax) {
    for (let i = 0; i < 8; i++) if (this.b(base + i) === 0) { this.sb(base + i, al); return ax & 0xff00 }
    return (ax & 0xff00) | 1
  }

  /** 0185 CmdTick. Returns AX (0xFFFE when re-entered). */
  hostTick() {
    if (this.b(0x7d)) return 0xfffe
    this.sb(0x7d, 1)
    this.doReset() // 04BB
    this.doStopMusic() // 04F0
    this.startPendingTune() // 0398
    this.processStartQueue() // 0446
    this.processStopQueue() // 0529
    this.accumulate(0x7e) // 019F: [82..85] += [7E..81]
    this.accumulate(0x86) // 01AD: [8A..8D] += [86..89]
    for (let i = 0; i < NSLOTS; i++) this.advanceSlot(SLOT0 + i * SLOT_SIZE)
    this.sw(0x84, 0); this.sw(0x8c, 0) // 01CB/01CF: CX is 0 after the loop
    this.output() // 0307
    this.sb(0x7d, 0)
    this.tick++
    return 0
  }

  accumulate(si) {
    const lo = this.w(si + 4) + this.w(si)
    this.sw(si + 4, lo)
    this.sw(si + 6, this.w(si + 6) + this.w(si + 2) + (lo > 0xffff ? 1 : 0))
  }

  clearSlots(withSounding) {
    for (let i = 0; i < NSLOTS; i++) {
      const di = SLOT0 + i * SLOT_SIZE
      if (withSounding) this.sb(di + 0xb, 0)
      this.sb(di + 0xa, 0); this.sb(di + 0xe, 0)
    }
  }

  doReset() { // 04BB
    if (!this.b(0x7a)) return
    for (let i = 0; i < 16; i++) this.sb(0xe7 + i, 0) // 051A: both queues
    this.clearSlots(true)
    this.sb(0x7a, 0); this.sb(0x78, 0)
    this.port61 &= 0xfc
  }

  doStopMusic() { // 04F0: every slot, sfx included
    if (!this.b(0x79)) return
    this.clearSlots(true)
    this.sb(0x79, 0); this.sb(0x78, 0)
    this.port61 &= 0xfc
  }

  startPendingTune() { // 0398
    const al = this.b(0x77)
    if (!al) return
    this.sb(0x77, 0)
    const bank = this.w(0x749)
    const count = this.b(bank)
    if (!count || al > count) return // 03AC/03B0
    for (let i = 0; i < NSLOTS; i++) { const di = SLOT0 + i * SLOT_SIZE; this.sb(di + 0xa, 0); this.sb(di + 0xe, 0); this.sb(di + 0xb, 0) }
    this.sb(0x78, al)
    let si = (this.w(bank + 1) + (((al - 1) & 0xff) << 1)) & 0xffff
    if (si === ((((al - 1) & 0xff) << 1) & 0xffff)) return // 03DA: CMP SI,AX -- a zero table offset
    si = (this.w((si + bank) & 0xffff) + bank) & 0xffff
    this.sw(0x7b, this.w(si)); si += 2 // division, tempo
    const tracks = this.b(si); si += 1
    this.sw(0x75, tracks)
    for (let i = 0; i < Math.min(tracks, NSLOTS); i++) { // 03F8: at most 4
      const di = SLOT0 + i * SLOT_SIZE
      const start = (this.w(si) + bank) & 0xffff; si += 2
      this.sw(di + 6, start)
      const [delay, pos] = this.readVlq(start)
      this.sw(di + 2, delay & 0xffff); this.sw(di + 4, delay >>> 16)
      this.sw(di, pos)
      this.sb(di + 0xa, 1)
    }
    this.recompute()
  }

  processStartQueue() { // 0446
    for (let i = 0; i < 8; i++) {
      const id = this.b(0xe7 + i)
      if (!id) continue
      this.sb(0xe7 + i, 0)
      const bank = this.w(0x74b)
      if (id > this.b(bank)) continue // 0459: an id past the bank (16-18 here) is dropped
      let di = -1
      for (let k = 0; k < NSLOTS; k++) if (this.b(SLOT0 + k * SLOT_SIZE + 0xa) === 0) { di = SLOT0 + k * SLOT_SIZE; break }
      if (di < 0) return // 0460: no free slot -- the rest of the queue waits for the next tick
      this.sb(di + 0xe, id)
      const start = (this.w((bank + 1 + ((id - 1) << 1)) & 0xffff) + bank) & 0xffff
      this.sw(di + 6, start)
      const [delay, pos] = this.readVlq(start)
      this.sw(di + 2, delay & 0xffff); this.sw(di + 4, delay >>> 16)
      this.sw(di, pos)
      this.sb(di + 0xa, 2)
    }
  }

  processStopQueue() { // 0529/053F: the first sfx slot with that id
    for (let i = 0; i < 8; i++) {
      const id = this.b(0xef + i)
      if (!id) continue
      this.sb(0xef + i, 0)
      for (let k = 0; k < NSLOTS; k++) {
        const di = SLOT0 + k * SLOT_SIZE
        if (this.b(di + 0xa) === 2 && this.b(di + 0xe) === id) { this.sb(di + 0xb, 0); this.sb(di + 0xa, 0); this.sb(di + 0xe, 0); break }
      }
    }
  }

  /** 0599: a VLQ; the high word is carried, not shifted, on each continuation (MUL CX on AX only). */
  readVlq(si) {
    let b0 = this.b(si++)
    if (!(b0 & 0x80)) return [b0, si]
    let bx = ((b0 & 0x7f) << 8) >> 1
    let dx = 0
    for (let k = 0; k < 3; k++) {
      const b = this.b(si++)
      if (!(b & 0x80)) { const lo = bx + b; return [(((dx + (lo >> 16)) & 0xffff) * 0x10000 + (lo & 0xffff)) >>> 0, si] }
      const s = bx + (b & 0x7f)
      const hi = (dx + (s >> 16)) & 0xffff
      const prod = (s & 0xffff) * 0x80
      bx = prod & 0xffff
      dx = (hi + Math.floor(prod / 0x10000)) & 0xffff
    }
    const b = this.b(si++)
    if (!(b & 0x80)) { const lo = bx + b; return [(((dx + (lo >> 16)) & 0xffff) * 0x10000 + (lo & 0xffff)) >>> 0, si] }
    return [0xffffffff, si] // 05F2
  }

  /** 01E0: one slot's tick. */
  advanceSlot(di) {
    const state = this.b(di + 0xa)
    if (!state) return
    const gate = this.b(di + 0x11)
    if (gate) { this.sb(di + 0x11, gate - 1); if (gate === 1) this.sb(di + 0xb, 0) } // 01E7-01F1
    const n = state === 2 ? this.w(0x8c) : this.w(0x84)
    let cnt = ((this.w(di + 4) << 16) | this.w(di + 2)) >>> 0
    if (cnt >= n) { cnt -= n; this.sw(di + 2, cnt & 0xffff); this.sw(di + 4, cnt >>> 16); return } // 0208 JNC
    cnt = (cnt - n) >>> 0
    this.sw(di + 2, cnt & 0xffff); this.sw(di + 4, cnt >>> 16)
    let si = this.w(di)
    for (;;) {
      const op = this.b(si++)
      if (op < 0x80) { // 0211: NOTE
        this.sb(di + 9, op)
        const bx = this.w(di + 0xc)
        this.setPitch(di, (op + this.b(bx + 8)) & 0xff, bx)
        si++ // 021D: the velocity byte
        this.sb(di + 0x11, this.b(bx + 9)) // 021E: the gate, whether or not the pitch changed
      } else if (op === 0xff) { // 0232: REST
      } else if (op > 0x9d) { this.endTrack(di); return } // 0251 -> 028B, SI not saved
      else if (op < 0x90) { this.sb(di + 8, op & 0x0f) } // 0255: SET CHANNEL
      else {
        si = this.event(di, op, si)
        if (!this.b(di + 0xa)) return // 024A
      }
      const [d, pos] = this.readVlq(si) // 0224
      si = pos
      const c = ((this.w(di + 4) << 16) | this.w(di + 2)) >>> 0
      const sum = (c + d) >>> 0
      this.sw(di + 2, sum & 0xffff); this.sw(di + 4, sum >>> 16)
      if (!(sum & 0x80000000)) { this.sw(di, si); return } // 022D JS
    }
  }

  /** 02DD: the period for driver note `al` (after transpose); out of range (>0x5F after -0x18) keeps
   * the old tone. The gate (+9) starts the note sounding. */
  setPitch(di, al, bx) {
    const e = (al - 0x18) & 0xff
    if (e > 0x5f) return
    this.sb(di + 0xb, 0)
    this.sw(di + 0xf, this.w(0x689 + e * 2))
    const g = this.b(bx + 9)
    if (g) { this.sb(di + 0x11, g); this.sb(di + 0xb, 1) }
  }

  /** The 0x90-0x9D table at 0x25D. Returns the new stream position. */
  event(di, op, si) {
    switch (op) {
      case 0x90: { const n = this.b(si++); if (n === this.b(di + 9)) this.noteOff(di); return si } // 0279
      case 0x91: this.endTrack(di); return si // 028B
      case 0x92: this.sw(di + 0xc, (this.b(si++) << 4) + this.w(0x74d)); return si // 02B5
      case 0x93: this.sb(0x7c, this.b(si++)); this.recompute(); return si // 02C4
      case 0x94: case 0x95: case 0x96: case 0x97: return si + 1 // 02CC
      case 0x98: return this.w(di + 6) // 02CE: JUMP LOOP
      case 0x99: this.noteOff(di); return si // 027F
      case 0x9a: return 0x6e // 02D6: SLEEP FOREVER
      case 0x9b: return si + 1 // 02DB
      case 0x9c: this.sw(di + 6, si); return si // 02D2: SET LOOP
      case 0x9d: return si + 2 // 02DA
      default: return si
    }
  }

  noteOff(di) { this.sb(di + 9, 0); this.sb(di + 0xb, 0); this.sb(di + 0x11, 0) } // 027F

  endTrack(di) { // 028B
    const state = this.b(di + 0xa)
    this.sb(di + 0xa, 0); this.sb(di + 0xe, 0)
    if (state === 1) {
      let any = false
      for (let i = 0; i < NSLOTS; i++) if (this.b(SLOT0 + i * SLOT_SIZE + 0xa) === 1) any = true
      if (!any) this.sb(0x78, 0)
    }
    this.noteOff(di)
  }

  /** 0307: this tick's tone. */
  output() {
    let ax
    const engines = this.b(0x9a)
    const sfx = [0, 1, 2, 3].some((i) => this.b(SLOT0 + i * SLOT_SIZE + 0xa) === 2)
    if (engines && !sfx) {
      this.sb(0x99, this.b(0x99) + 1)
      const odd = this.b(0x99) & 1
      if (odd ? !(engines & 2) : !(engines & 1)) { this.port61 &= 0xfe; return } // 038B
      ax = this.w(odd ? 0x9d : 0x9b)
    } else {
      let any = 0
      for (let i = 0; i < NSLOTS; i++) any |= this.b(SLOT0 + i * SLOT_SIZE + 0xb)
      if (!any) { this.port61 &= 0xfe; return }
      let slot
      do {
        this.sb(0x90, this.b(0x90) + 1)
        slot = this.w(0x91 + (this.b(0x90) & 3) * 2)
      } while (!this.b(slot + 0xb))
      ax = this.w(slot + 0xf)
    }
    if (ax !== this.w(0x8e)) { this.sw(0x8e, ax); this.pit = (ax & 0xff) | (((ax >> 8) & 0x1f) << 8) }
    this.port61 |= 3
  }
}

/** DRIVER0.BIN: `MOV AX,0; RETF` at both entries -- every command answers 0 and nothing sounds. So
 * `AH=0Ah` says every sfx is playing and `AH=9` that every tune is current: nothing is ever re-queued. */
export class NullDriver {
  command() { return 0 }
  hostTick() { return 0 }
  get sounding() { return false }
  get frequency() { return 0 }
}
