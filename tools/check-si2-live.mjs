// Replay the driver commands MICRO.EXE issued in a live DOSBox session ("# cmd gt=… AH=… AL=…" lines,
// captured at the driver's far entry) through the JS driver model, one hostTick() per game tick, and
// diff the resulting OPL register stream against the writes captured at the driver's OUT instructions
// in the same session (data lines: gtick bios reg val route …).
//
// This is the sound counterpart of check-live.mjs: same input (the shipped DRIVER1.BIN + the game's
// commands), the model must produce the same register writes on the same ticks as the real driver.
// Two independent title-screen captures are replayed, taken in different sessions through different
// code paths into the driver load (tools/refs/si2/README):
//   live_title_start.txt  ESC from a race → GAME OPTIONS → RETURN   (1500 writes)
//   live_title_cold.txt   ESC from the title → GAME OPTIONS → RETURN (1600 writes)
//   node tools/check-si2-live.mjs
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Driver, Sequencer } from '../src/formats/si2.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const image = new Uint8Array(readFileSync(join(ROOT, 'game', 'DRIVER1.BIN')))

function replay(file) {
  const lines = readFileSync(join(ROOT, 'tools', 'refs', 'si2', file), 'utf8').split('\n')
  const cmds = [], live = []
  for (const l of lines) {
    if (l.startsWith('# cmd')) { const m = /gt=(\d+) AH=([0-9A-Fa-f]+) AL=([0-9A-Fa-f]+)/.exec(l); cmds.push({ gt: +m[1], ah: parseInt(m[2], 10), al: parseInt(m[3], 16) }); continue }
    if (!l || l.startsWith('#')) continue
    const [gt, , reg, val] = l.split(/\s+/)
    live.push({ gt: +gt, reg: parseInt(reg, 16), val: parseInt(val, 16) })
  }
  // The driver is (re)loaded at the AH=0 commands: start the model there, with a fresh file image.
  // The game's IRQ0 ISR (1000:489C) increments the tick counter DS:28F7 and then calls the driver's
  // AH=3 only while CS:3279 == 1 — a flag LoadSoundDriverBinModule clears on entry and sets on exit.
  // A tick whose counter increment lands inside the load (28 KB of INT 21h reads with interrupts
  // enabled) therefore skips the driver. Whether such a tick exists differs between sessions: in
  // live_title_start the counter moved 53051→53052 during the load (one gated tick; modelling it as
  // a driver tick diverges after 183 writes), in live_title_cold it did not (AH=9 is logged on the
  // load's own tick 56402 and the next tick, 56403, ran the driver). Both are covered by one rule:
  // the first driver tick is the one after the game's first post-load command, because the game
  // issues that command (AH=9 at 1000:0073) straight after the load returns.
  const firstInit = cmds.findIndex((c) => c.ah === 0)
  const firstGameCmd = cmds.findIndex((c, i) => i > firstInit && c.ah !== 0 && c.ah !== 2)
  const start = cmds[firstInit].gt
  const firstTick = cmds[firstGameCmd].gt + 1
  const end = live[live.length - 1].gt
  const seq = new Sequencer(new Driver(image))
  const mine = []
  let ci = firstInit
  for (let gt = start; gt <= end; gt++) {
    // commands logged with tick counter == gt were issued after tick gt ran and before tick gt+1
    const before = seq.writes.length
    if (gt >= firstTick) seq.hostTick()
    for (const w of seq.writes.slice(before)) mine.push({ gt, reg: w[1], val: w[2] })
    while (ci < cmds.length && cmds[ci].gt === gt) { const c = cmds[ci++]; if (c.ah !== 0 && c.ah !== 2) seq.command(c.ah, c.al) }
  }
  const key = (w) => `${w.gt} ${w.reg.toString(16).padStart(2, '0')}=${w.val.toString(16).padStart(2, '0')}`
  let i = 0
  while (i < live.length && i < mine.length && key(live[i]) === key(mine[i])) i++
  console.log(`${file}: live writes ${live.length} over ticks ${live[0].gt}..${end}; model writes ${mine.length}`)
  console.log(`  exact match (tick, register, value) for the first ${i} writes${i === live.length ? ' — the whole capture' : ''}`)
  if (i < live.length) {
    console.log('  first divergence:')
    for (let k = Math.max(0, i - 2); k < i + 6; k++) console.log(`    live ${live[k] ? key(live[k]) : '-'}    model ${mine[k] ? key(mine[k]) : '-'}`)
  }
  return i === live.length
}

let ok = true
for (const file of ['live_title_start.txt', 'live_title_cold.txt']) ok = replay(file) && ok
process.exitCode = ok ? 0 : 1
