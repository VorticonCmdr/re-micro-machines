// P2's first item (GOAL-DOS-PARITY.md): RunTitleScreenAttractLoop 1000:0100's real per-tick state
// machine, re-derived from a full disassembly (1000:0100-01dd) since the decompiler mis-resolved
// its carry-flag-driven exits into an unreachable infinite loop. Proves:
//  - the 9-class showcase (SPORTSCARS..RUFFTRUX) advances every exactly 280 (0x118) ticks and
//    never times out on its own (no idle cancel, unlike the menu levels below it);
//  - fire (P1's own reader slot, [0x137b] bit 0x08 -- not the combined-both-players byte) exits to
//    the main menu from any tick position;
//  - a released ESC (the global single-key-tracked latch, scancode 1) exits to OPTIONS instead;
//  - any other released key exits to the main menu, same as fire.
//   node tools/check-title.mjs
import { attractInitialState, attractStep, CLASS_ADVANCE_TICKS, CLASS_COUNT } from '../src/frontend/attract.js'
import { TITLE_CLASS_NAMES } from '../src/data/frontend-tables.js'

let bad = 0
function check(name, cond) {
  if (cond) return
  bad++
  console.log(`FAIL: ${name}`)
}

check('TITLE_CLASS_NAMES has exactly CLASS_COUNT (9) entries', TITLE_CLASS_NAMES.length === CLASS_COUNT)

// 1. No input: the class index advances every CLASS_ADVANCE_TICKS (280) ticks, wraps 0..8, and
// the loop never exits on its own (no idle timeout, unlike the menu levels).
{
  const s = attractInitialState()
  check('starts at class 0', s.classIndex === 0)
  let exited = false
  for (let i = 0; i < CLASS_ADVANCE_TICKS - 1; i++) {
    const r = attractStep(s, {})
    if (r.exit) exited = true
  }
  check('tick 279: still class 0 (not yet advanced)', s.classIndex === 0 && !exited)
  attractStep(s, {}) // tick 280
  check('tick 280: advances to class 1', s.classIndex === 1)
  // Run through all 9 classes and confirm the wrap back to 0.
  for (let i = 0; i < CLASS_ADVANCE_TICKS * 8; i++) attractStep(s, {})
  check('after 9 full periods: wraps back to class 0', s.classIndex === 0)
  // A long, uninterrupted run never exits -- there is no idle timeout at this screen.
  let n = 0
  for (; n < 100000; n++) { const r = attractStep(s, {}); if (r.exit) { exited = true; break } }
  check('100000 ticks with no input: never exits (no idle timeout)', !exited)
}

// 2. Fire exits to the menu, from any tick position, regardless of ESC/other state.
for (const stopAt of [0, 1, 100, 279, 280, 1000]) {
  const s = attractInitialState()
  for (let i = 0; i < stopAt; i++) attractStep(s, {})
  const r = attractStep(s, { p1Fire: true })
  check(`fire at tick ${stopAt} exits to 'menu'`, r.exit === 'menu')
}

// 3. A released ESC exits to OPTIONS instead of the menu.
{
  const s = attractInitialState()
  const r = attractStep(s, { escReleased: true })
  check("ESC release exits to 'options'", r.exit === 'options')
}

// 4. Any other released key exits to the menu, same as fire.
{
  const s = attractInitialState()
  const r = attractStep(s, { otherReleased: true })
  check("a non-ESC key release exits to 'menu'", r.exit === 'menu')
}

// 5. Fire takes priority over a simultaneous ESC release (1000:01c1's TEST AL,8 is checked FIRST,
// before [0x107e] is ever read at 01c5).
{
  const s = attractInitialState()
  const r = attractStep(s, { p1Fire: true, escReleased: true })
  check('fire beats a simultaneous ESC release', r.exit === 'menu')
}

console.log(bad ? `${bad} check(s) failed` : 'check-title: the 9-class showcase times every 280 ticks with no idle timeout, and fire/ESC-release/other-release exit exactly as the disassembly routes them')
process.exitCode = bad ? 1 : 0
