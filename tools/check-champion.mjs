// The champion screen's own wait, ShowChampionScreenTune3 1000:1AAD (docs/engine.md §9bs,
// src/frontend/champion.js). Proves, against the disassembly:
//  - the slide-in length: an independent re-simulation of 1B2B-1BE4's own order (draw, step each
//    line unless already in place, then 1BD8's both-in-place test) gives 108 iterations, the first
//    whose own poll runs;
//  - no input is read during the slide, then every iteration polls;
//  - ANY control bit exits (each of the five alone), 0 never does -- the P1|P2 OR itself happens in
//    flow.js's readChampionInput and is checked live, not here;
//  - there is no timeout (nothing happens over 20000 polling iterations).
// The slide's DURATION is UNKNOWN_champion_slide_duration; the port's one-iteration-per-tick pacing
// is a port choice, not asserted here as a DOS fact.
//   node tools/check-champion.mjs
import { championInitialState, championStep, CHAMPION_SLIDE_ITERATIONS, CHAMPION_LINE1_START, CHAMPION_LINE1_END, CHAMPION_LINE2_START, CHAMPION_LINE2_END } from '../src/frontend/champion.js'

let bad = 0
function check(name, cond) {
  if (cond) return
  bad++
  console.log(`FAIL: ${name}`)
}

check('line 1 starts at 0xFF50 (-176) and stops at 0x28', CHAMPION_LINE1_START === -176 && CHAMPION_LINE1_END === 0x28)
check('line 2 starts at 0x100 and stops at 0x68', CHAMPION_LINE2_START === 0x100 && CHAMPION_LINE2_END === 0x68)

// 1. Independent re-simulation of the real loop order: draw with the current X, step unless in
// place (1B67/1BC2 test equality BEFORE the step), then test both at 1BD8.
{
  let x1 = 0xff50
  let x2 = 0x100
  let n = 0
  for (;;) {
    n++
    if (x1 !== 0x28) x1 = (x1 + 2) & 0xffff
    if (x2 !== 0x68) x2 -= 2
    if (x1 === 0x28 && x2 === 0x68) break
    if (n > 1000) break
  }
  check(`the real loop's first both-in-place iteration is ${n}, and the model agrees`, n === CHAMPION_SLIDE_ITERATIONS && n === 108)
}

// 2. No poll during the slide; the first poll on iteration 108; then every iteration polls.
{
  const s = championInitialState()
  const polls = []
  for (let i = 1; i <= 200; i++) championStep(s, () => { polls.push(i); return { controlBits: 0 } })
  check('no input read during the 107 slide iterations', polls.every((i) => i >= 108))
  check('the first poll is on iteration 108', polls[0] === 108)
  check('then every iteration polls', polls.length === 93 && polls.every((x, k) => x === 108 + k))
}

// 3. Any control bit exits; a control key held from the start exits at the first poll, not before.
{
  for (const [name, bits] of [['fire', 0x08], ['left', 0x80], ['right', 0x40], ['brake', 0x10], ['accelerate', 0x20]]) {
    const s = championInitialState()
    let at = null
    for (let i = 1; i <= 300 && at == null; i++) if (championStep(s, () => ({ controlBits: bits })).exit === 'dismiss') at = i
    check(`${name} held from the start: exits at the first poll (108)`, at === 108)
  }
}

// 4. No timeout: 20000 polling iterations with nothing held never exit.
{
  const s = championInitialState()
  let exited = false
  for (let i = 0; i < 20000; i++) if (championStep(s, () => ({ controlBits: 0 })).exit) exited = true
  check('no timeout: nothing held for 20000 iterations never exits', !exited)
}

console.log(bad ? `${bad} check(s) failed` : 'check-champion: 1AAD\'s own wait -- a 108-iteration silent slide-in (re-simulated independently), then any control bit of either player exits, with no timeout -- matches the disassembly')
process.exitCode = bad ? 1 : 0
