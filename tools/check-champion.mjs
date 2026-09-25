// The champion screen's own wait, ShowChampionScreenTune3 1000:1AAD (docs/engine.md §9bs,
// src/frontend/champion.js). Proves, against the disassembly:
//  - the slide-in length: an independent re-simulation of 1B2B-1BE4's own order (draw, step each
//    line unless already in place, then 1BD8's both-in-place test) gives 108 iterations, the first
//    whose own poll runs;
//  - no input is read during the slide, then every iteration polls;
//  - ANY control bit exits (each of the five alone), 0 never does -- the P1|P2 OR itself happens in
//    flow.js's readChampionInput and is checked live, not here;
//  - there is no timeout (nothing happens over 20000 polling iterations);
//  - the reader byte's own low three bits (docs/engine.md §9bt): the ISR's slot -> bit rule
//    (0x8000 >> slot over [0x107C]) puts F1/F2/F3 (slots 5-7) at [0x107D]'s 0x04/0x02/0x01 and
//    D/SPACE/V (slots 13-15) at [0x107C]'s, consistent with the race's own SPACE pause test
//    (3074: [0x107C] & 2); createExtraKeysReader reports them there, and SPACE alone exits.
// The slide's DURATION is UNKNOWN_champion_slide_duration; the port's one-iteration-per-tick pacing
// is a port choice, not asserted here as a DOS fact.
//   node tools/check-champion.mjs
import { championInitialState, championStep, CHAMPION_SLIDE_ITERATIONS, CHAMPION_LINE1_START, CHAMPION_LINE1_END, CHAMPION_LINE2_START, CHAMPION_LINE2_END } from '../src/frontend/champion.js'
import { createExtraKeysReader } from '../src/engine/input.js'

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

// 5. The ISR's slot -> bit rule, and the extra keys it puts in each reader byte.
{
  const bitOf = (slot) => 0x8000 >> slot // 2F73/2F7B: CX=0x8000, SHR per table entry
  const lo = (slot) => bitOf(slot) & 0xff // [0x107C]
  const hi = (slot) => bitOf(slot) >> 8 // [0x107D]
  check('KEYS1 fire (slot 4) is [0x107D] 0x08, the fire bit', hi(4) === 0x08)
  check('KEYS2 fire (slot 12) is [0x107C] 0x08', lo(12) === 0x08)
  check('F1/F2/F3 (slots 5-7) are [0x107D] 0x04/0x02/0x01', hi(5) === 0x04 && hi(6) === 0x02 && hi(7) === 0x01)
  check('D/SPACE/V (slots 13-15) are [0x107C] 0x04/0x02/0x01', lo(13) === 0x04 && lo(14) === 0x02 && lo(15) === 0x01)
  check('SPACE is [0x107C] & 2, the race\'s own pause test at 3074', lo(14) === 0x02)

  const target = new EventTarget()
  const key = (type, code) => { const e = new Event(type); e.code = code; target.dispatchEvent(e) }
  const r = createExtraKeysReader(['KeyD', 'Space', 'KeyV'], target)
  check('extra keys reader: nothing held reads 0', r.read() === 0)
  key('keydown', 'Space')
  check('extra keys reader: SPACE held reads 0x02', r.read() === 0x02)
  key('keyup', 'Space'); key('keydown', 'KeyD')
  check('extra keys reader: D (slot 13) held reads 0x04', r.read() === 0x04)
  key('keydown', 'Space'); key('keydown', 'KeyV')
  check('extra keys reader: D+SPACE+V read 0x07', r.read() === 0x07)
  key('keyup', 'Space'); key('keyup', 'KeyD'); key('keyup', 'KeyV')
  check('extra keys reader: all released reads 0', r.read() === 0)
  r.dispose()

  const s = championInitialState()
  let at = null
  for (let i = 1; i <= 300 && at == null; i++) if (championStep(s, () => ({ controlBits: 0x02 })).exit === 'dismiss') at = i
  check('SPACE alone (0x02 in a KEYS2 reader byte) exits at the first poll', at === 108)
}

console.log(bad ? `${bad} check(s) failed` : 'check-champion: 1AAD\'s own wait -- a 108-iteration silent slide-in (re-simulated independently), then any control bit of either player exits, with no timeout -- matches the disassembly')
process.exitCode = bad ? 1 : 0
