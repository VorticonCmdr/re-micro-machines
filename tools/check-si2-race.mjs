// Replay the RACE portion of a live capture (tools/refs/si2/live_race_start.txt) through the JS driver
// model: engine sounds (sfx 0x40+car with records patched live), the drop-in sfx 9, and sfx slot
// allocation — the path check-si2-live.mjs does not exercise. From the game's per-frame engine code
// (MICROU.EXE 1000:7B46) the CX/DX logged with every AH=10 / AH=5 call ARE the two bytes it just
// wrote into the driver's engine record: [+0xA] = CL (pitch), [+0xC] = DH (0x98 loop / 0x91 end);
// race init (1000:7AB7) wrote [+2] = 0x70 (POWERBOATS) and [+0xB] = 0.
//
// Three things the capture cannot tell us are fitted/tolerated: (1) the sfx accumulator's fraction at
// the race start (brute-forced; the register CONTENT is not fitted); (2) the OPL shadow inherited
// from the menus — so only the FIRST write to each register is allowed to be absent from the live
// stream (the real driver's shadow compare may have suppressed it); (3) WHEN each command was issued:
// the tracer read the game tick counter late for some commands (e.g. the car-3 AH=5 is logged with
// gt 16912 but sits after tick 16913's writes in the stop-id order), so a command is placed in the
// tick window its file position allows, and the check is on the ORDER of (register, value) writes
// with the tick alignment reported separately (expect 0 for most writes, ±1 around such commands).
//   node tools/check-si2-race.mjs
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Driver, Sequencer } from '../src/formats/si2.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const lines = readFileSync(join(ROOT, 'tools', 'refs', 'si2', 'live_race_start.txt'), 'utf8').split('\n')
const cmds = [], live = []
let lastWriteGt = 0
for (const l of lines) {
  if (l.startsWith('# cmd')) {
    const m = /gt=(\d+) AH=([0-9A-Fa-f]+) AL=([0-9A-Fa-f]+) BX=(\w+) CX=(\w+) DX=(\w+)/.exec(l)
    // AH is logged in decimal, AL/BX/CX/DX in hex. A command logged before the writes of tick T was
    // issued no later than T-1; one logged after them, during T at the earliest
    cmds.push({ gt: Math.max(+m[1], lastWriteGt), ah: parseInt(m[2], 10), al: parseInt(m[3], 16), cx: parseInt(m[5], 16), dx: parseInt(m[6], 16) })
    continue
  }
  if (!l || l.startsWith('#')) continue
  const [gt, , reg, val] = l.split(/\s+/)
  live.push({ gt: +gt, reg: parseInt(reg, 16), val: parseInt(val, 16) })
  lastWriteGt = +gt
}
const START = cmds.find((c) => c.ah === 5 && c.al >= 0x40).gt // first engine start; music already stopped
// After ~tick 17016 the tracer's command log is incomplete (e.g. at 17015 an AH=5 for car 1 appears
// without the AH=10 that always precedes it, and car 0's pitch changes at 17023 with no logged
// command carrying a new CX), so record patches can no longer be reconstructed: the window ends there.
const END = 17020

// The per-frame engine update (1000:7B46) handles cars 0..3 in one call and issues AH=10 (then maybe
// AH=5) for a car ONLY when its pitch byte is non-zero; for a car whose byte is 0 it writes 0 / 0x91
// (END) into the record silently. So a car missing from a batch of engine commands was written
// 0/END at that moment. Batches are runs of engine commands with increasing car index.
const isEngine = (c) => (c.ah === 10 || c.ah === 5) && c.al >= 0x40
{
  let batch = [], prevCar = -1
  const flush = () => {
    if (!batch.length) return
    const present = new Set(batch.map((c) => c.al - 0x40))
    for (let car = 0; car < 4; car++) if (!present.has(car)) batch[0].silent = [...(batch[0].silent || []), car]
    batch = []
  }
  for (const c of cmds) {
    if (!isEngine(c) || c.gt < START) continue
    const car = c.al - 0x40
    if (car <= prevCar && c.ah === 10) flush() // a new batch begins at a non-increasing car index (AH=10 opens each car's update)
    batch.push(c); prevCar = car
  }
  flush()
}
const liveRace = live.filter((w) => w.gt > START && w.gt <= END)
const drv = new Driver(new Uint8Array(readFileSync(join(ROOT, 'game', 'DRIVER1.BIN'))))

function replay(sfxFrac) {
  const seq = new Sequencer(drv, { dedupe: false })
  // Pre-race state as the game left it: tune 4 (5 tracks) was started on the pre-race screen and
  // stopped with AH=7 at race start. The track count (5) survives the stop and matters: the second
  // AH=7 at the end of the round-file load (1000:39F5) frees slots 0..4 regardless of state — which
  // by then hold the four engine sfx — so the live stream shows the engines keyed off and restarted.
  seq.command(4, 4); seq.hostTick(); seq.command(7); seq.hostTick()
  seq.sfxAcc = sfxFrac
  seq.writes.length = 0
  const out = []
  let ci = cmds.findIndex((c) => c.gt >= START)
  const end = liveRace[liveRace.length - 1].gt
  for (let gt = START; gt <= end; gt++) {
    // commands issued during tick gt
    while (ci < cmds.length && cmds[ci].gt === gt) {
      const c = cmds[ci++]
      if (isEngine(c)) {
        for (const car of c.silent || []) seq.patchEngineRecord(car, { bend: 0, loop: false }) // written silently by the game (see above)
        seq.patchEngineRecord(c.al - 0x40, { instrument: 0x70, bend: c.cx & 0xff, delay: 0, loop: (c.dx >> 8) === 0x98 })
      }
      if (c.ah !== 0 && c.ah !== 2 && c.ah !== 3) seq.command(c.ah, c.al)
    }
    const before = seq.writes.length
    seq.hostTick()
    for (const w of seq.writes.slice(before)) out.push({ gt: gt + 1, reg: w[1], val: w[2] })
  }
  return out
}

/** Match model writes against live ones in ORDER (register, value), first-write-per-register tolerance; tick deltas collected. */
function compare(model) {
  const shadow = new Map()
  const deltas = new Map()
  let li = 0, matched = 0, skipped = 0
  for (const w of model) {
    const known = shadow.has(w.reg)
    if (known && shadow.get(w.reg) === w.val) continue // the real driver would have deduplicated this too
    shadow.set(w.reg, w.val)
    const l = liveRace[li]
    if (l && l.reg === w.reg && l.val === w.val) { li++; matched++; const d = w.gt - l.gt; deltas.set(d, (deltas.get(d) || 0) + 1); continue }
    if (!known) { skipped++; continue } // first write to this register: possibly suppressed by the inherited live shadow
    return { matched, li, skipped, deltas, firstMismatch: { model: w, live: l } }
  }
  return { matched, li, skipped, deltas, firstMismatch: null }
}

let best = { matched: -1 }
for (let f = 0; f < 65536; f += 512) { const r = compare(replay(f)); if (r.matched > best.matched) best = { ...r, frac: f } }
for (let f = Math.max(0, best.frac - 512); f < best.frac + 512; f += 16) { const r = compare(replay(f)); if (r.matched > best.matched) best = { ...r, frac: f } }
const fmt = (w) => (w ? `${w.gt} ${w.reg.toString(16).padStart(2, '0')}=${w.val.toString(16).padStart(2, '0')}` : '-')
console.log(`race window: ${liveRace.length} live writes over ticks ${START + 1}..${liveRace.at(-1).gt} (log reliable to ${END}); engine/sfx commands ${cmds.filter((c) => c.gt >= START && c.gt <= END).length}`)
console.log(`best sfx-accumulator fraction ${best.frac}: ${best.matched} of ${liveRace.length} live writes matched in order (${best.skipped} first-writes assumed deduplicated by the inherited shadow)`)
console.log('tick alignment (model tick − live tick: count): ' + [...best.deltas.entries()].sort((a, b) => a[0] - b[0]).map(([d, n]) => `${d >= 0 ? '+' : ''}${d}: ${n}`).join('  '))
if (best.firstMismatch) console.log(`first mismatch: model ${fmt(best.firstMismatch.model)} vs live ${fmt(best.firstMismatch.live)}`)
process.exitCode = best.matched === liveRace.length ? 0 : 1
