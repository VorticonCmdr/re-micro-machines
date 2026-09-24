// Cross-implementation check of the Sound Images sequencer port: src/formats/si2.js must emit
// exactly the (sequence_tick, reg, val) OPL register stream the independent Python transcription
// of DRIVER1.BIN (research pass, si2.py) emits for every tune, one loop of every track.
//   node tools/check-si2.mjs        # tools/refs/si2/tune{1..8}_writes.txt are the reference
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Driver, Sequencer } from '../src/formats/si2.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const drv = new Driver(new Uint8Array(readFileSync(join(ROOT, 'game', 'DRIVER1.BIN'))))
const refs = readdirSync(join(ROOT, 'tools', 'refs', 'si2')).filter((f) => /^tune\d_writes\.txt$/.test(f)).sort()
let bad = 0
for (const f of refs) {
  const n = Number(f.match(/tune(\d)/)[1])
  const ref = readFileSync(join(ROOT, 'tools', 'refs', 'si2', f), 'utf8').split('\n').filter((l) => l && !l.startsWith('#'))
  const seq = new Sequencer(drv)
  seq.reset(); seq.tick = 0; seq.startTune(n); seq.runSequenceTicks(200000, 1)
  const mine = seq.writes.map(([t, r, v]) => `${t} ${r.toString(16).toUpperCase().padStart(2, '0')} ${v.toString(16).toUpperCase().padStart(2, '0')}`)
  let first = -1
  for (let i = 0; i < Math.max(ref.length, mine.length); i++) if (ref[i] !== mine[i]) { first = i; break }
  if (first < 0) console.log(`tune ${n}: ${mine.length} writes identical to the Python reference`)
  else { bad++; console.log(`tune ${n}: MISMATCH at write ${first}: ref=${ref[first]} js=${mine[first]} (ref ${ref.length}, js ${mine.length})`) }
}
// Also: the banks parse and every stream is well-formed.
const tunes = drv.tunes(), sfx = drv.sfxList()
console.log(`${tunes.length} tunes (${tunes.map((t) => t.tracks.length).join(',')} tracks), ${sfx.length} sfx, ${drv.instrumentCount()} instruments, host tick ${(1193182 / 0x4287).toFixed(2)} Hz, increments music=${drv.tickIncrements().music} sfx=${drv.tickIncrements().sfx} (expect ${2 * 65536 + 48555} / ${65536 + 24277})`)

// The sfx queue and the game's engine idiom, against the disassembly (PushSfxQueue 0x06CB,
// UpdateEngineSoundsPerFrame 1000:7BEE–7C24). A wrong queue model is invisible to the tune diff above
// and to the title replay (no sfx there); it showed up as five engine slots for one car in the viewer.
function expect(name, cond, detail = '') { if (!cond) bad++; console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`) }
{
  const seq = new Sequencer(drv); seq.command(6); seq.hostTick()
  // engine ids >= 0x40 are de-duplicated against the pending queue (0x06D0–0x06DB)
  expect('AH=5 0x40 twice in one tick queues it once', seq.command(5, 0x40) === 0 && seq.command(5, 0x40) === 0 && [...seq.sfxStartQueue].filter((x) => x === 0x40).length === 1)
  // ordinary ids are not: eight of them fill the queue, a ninth of higher priority replaces the lowest (0x06F2), a lower one is dropped with AL=1 (0x06FB)
  seq.sfxStartQueue.fill(0)
  for (let id = 1; id <= 8; id++) expect(`AH=5 ${id} queued`, seq.command(5, id) === 0)
  expect('AH=5 9 on a full queue replaces the first lower id → AL 0', seq.command(5, 9) === 0 && seq.sfxStartQueue[0] === 9 && seq.sfxStartQueue[1] === 2)
  expect('AH=5 1 on a full queue of higher ids is dropped → AL 1', seq.command(5, 1) === 1)
  // an engine id (0x40+) outranks every ordinary id: on a full queue of 1..8 it evicts the lowest-ranked entry it meets first
  seq.sfxStartQueue.set([1, 2, 3, 4, 5, 6, 7, 8])
  expect('AH=5 0x41 on a full queue of ordinary ids evicts entry 0 → AL 0', seq.command(5, 0x41) === 0 && seq.sfxStartQueue[0] === 0x41 && seq.sfxStartQueue[1] === 2)
  // the drain takes entries 0..7 in order, first-zero insert decides the order (0x0704)
  seq.sfxStartQueue.fill(0); seq.sfxStartQueue[3] = 5; seq.command(5, 2)
  expect('first empty entry takes the id', seq.sfxStartQueue[0] === 2 && seq.sfxStartQueue[3] === 5)
  seq.hostTick()
  const chans = seq.slots.filter((x) => x.state === 2).map((x) => [x.sfxId, x.channel])
  expect('drain order = queue order → sfx 2 gets channel 8, sfx 5 channel 7', JSON.stringify(chans) === '[[2,8],[5,7]]', JSON.stringify(chans))
}
{
  // five engine updates for car 0 with ticks between them keep exactly one looping slot (AH=0A gate)
  const seq = new Sequencer(drv); seq.command(6); seq.hostTick()
  for (let k = 0; k < 5; k++) { seq.engineUpdate(0, { instrument: 0x70, delay: 0, bend: 0x20 + k }); seq.hostTick(); seq.hostTick() }
  const eng = seq.slots.filter((x) => x.state === 2 && x.sfxId === 0x40)
  expect('5 engine updates → 1 engine slot', eng.length === 1, `${eng.length} slots on channels ${eng.map((x) => x.channel)}`)
  // pitch 0 writes 91h (END) and issues no command; the loop ends by itself
  const before = seq.writes.length
  const r = seq.engineUpdate(0, { bend: 0 })
  expect('pitch 0 → record END, no command', r === null && seq.image[0x08 + 0xc] === 0x91 && seq.image[0x08 + 0xa] === 0 && seq.writes.length === before)
  for (let k = 0; k < 40; k++) seq.hostTick()
  expect('engine slot freed after the loop ended', !seq.slots.some((x) => x.state === 2 && x.sfxId === 0x40))
  // a non-zero pitch after that restarts it through AH=0A → AH=5
  seq.engineUpdate(0, { bend: 0x30 }); seq.hostTick()
  expect('pitch back → engine re-queued', seq.slots.filter((x) => x.state === 2 && x.sfxId === 0x40).length === 1)
}

// M3.28: UNKNOWN_channel_exhaustion (FindFreeOplChannel 07BE-0803, re-disassembled live) -- with
// all 9 OPL channels busy, the real driver does NOT just drop: it rescans for a state-2 slot whose
// own id is <= 7 and, if found, "succeeds" with channel 0xFF (a real slot occupation, AH=10 sees
// it, but every register write for it lands on a garbage register -- nothing audible). Only when
// NO such slot exists does it genuinely drop.
{
  const seq = new Sequencer(drv); seq.command(6); seq.hostTick()
  // Fill all 9 real channels (8 down to 0) with ids 1..9 -- id 1..7 qualify as "low id", 8 and 9 don't.
  for (let id = 1; id <= 9; id++) seq.startSfx(id)
  const used = new Set(seq.slots.filter((s) => s.state === 2).map((s) => s.channel))
  expect('setup: all 9 real channels (0..8) are busy', [0, 1, 2, 3, 4, 5, 6, 7, 8].every((c) => used.has(c)), [...used].sort().join(','))

  const phantom = seq.startSfx(10)
  expect('exhaustion + a low-id (<=7) slot exists → "succeeds" on a phantom channel 0xFF, not dropped', phantom !== null && phantom.channel === 0xff)
  expect('the phantom slot genuinely occupies state 2 with its own id (AH=10 will see it)', seq.command(10, 10) === 0)
  const before = seq.writes.length
  seq.noteOn(phantom, 60)
  expect('the phantom slot\'s own register writes never touch a real OPL channel (0..8)', seq.writes.slice(before).every(([, r]) => (r & 0x0f) !== (r & 0xff) || ![0xa0, 0xb0].includes(r & 0xf0) || (r & 0x0f) > 8))

  // Revert-and-verify: replace every low-id (<=7) slot with a high-id one (8/9/engine ids) -- now
  // NO slot qualifies, so the SAME exhaustion must genuinely drop, matching the old behaviour.
  const seq2 = new Sequencer(drv); seq2.command(6); seq2.hostTick()
  const highIds = [8, 9, 0x40, 0x41, 0x42, 0x43, 14, 15, 16]
  for (const id of highIds) seq2.startSfx(id)
  const used2 = new Set(seq2.slots.filter((s) => s.state === 2).map((s) => s.channel))
  expect('setup 2: all 9 real channels busy again, none with a low id', [0, 1, 2, 3, 4, 5, 6, 7, 8].every((c) => used2.has(c)) && !seq2.slots.some((s) => s.state === 2 && s.sfxId <= 7))
  expect('exhaustion + no low-id slot exists → genuinely dropped (null), proving the phantom path above has teeth', seq2.startSfx(17) === null)
}

// M3.28: UNKNOWN_engine_high_bend -- ComputeBendOffset 0x0551 re-disassembled live: `SUB AL,0x40`
// (8-bit, unsigned) then `JC` on borrow (bend<0x40) selects the negative-offset path; bend>=0x40
// (never captured live -- routine for a drawn car at speed >= 640) is the POSITIVE-offset,
// no-borrow fall-through, `(bend-0x40)*range` -- confirmed byte-exact against the disassembly, not
// just re-read from the prose, and exercised past the never-live-captured 0x0B ceiling.
{
  const seq = new Sequencer(drv)
  // Byte-exact against 0551-0566 for a spread including the documented "+8.9 semitones at range 3"
  // ceiling (bend=0x7f, the max unsigned byte -> (0x7f-0x40)=0x3f -> 0x3f*3=189) and the never-live
  // boundary bend=0x40 itself (offset 0, the centre).
  const cases = [
    { bend: 0x0b, range: 2, expect: (0x0b - 0x40) * 2 }, // the max the live capture ever saw -- still negative
    { bend: 0x40, range: 3, expect: 0 }, // centre, no offset either way
    { bend: 0x41, range: 3, expect: 3 }, // just past centre, first positive step
    { bend: 0x50, range: 3, expect: (0x50 - 0x40) * 3 }, // routine high-speed bend, well past the live ceiling
    { bend: 0x7f, range: 3, expect: (0x7f - 0x40) * 3 }, // the documented "+8.9 semitones at range 3" max
  ]
  for (const { bend, range, expect: want } of cases) {
    const got = seq.drv.bendOffset(bend, range)
    const signed = got >= 0x8000 ? got - 0x10000 : got
    expect(`bendOffset(0x${bend.toString(16)}, ${range}) = ${want} (signed 16-bit)`, signed === want, `got ${signed}`)
  }
  // engineUpdate's own real formula (sound.js's updateEngines) reaches bend>=0x40 at speed>=640;
  // confirm fnumBlock doesn't throw or produce a NaN/out-of-range register pair up there.
  const [a0, b0] = seq.drv.fnumBlock(60, 0x50, 2) // note 60, bend 0x50 (>=0x40), range 2 -- routine high-speed case
  expect('fnumBlock at a high (>=0x40) bend returns two finite byte-range registers', Number.isInteger(a0) && a0 >= 0 && a0 <= 0xff && Number.isInteger(b0) && b0 >= 0 && b0 <= 0xff, `a0=${a0} b0=${b0}`)
}

process.exitCode = bad ? 1 : 0
