// P2's second item (GOAL-DOS-PARITY.md): RunTwoItemMenu 1000:0382, the shared two-item menu
// helper behind SELECT GAME (0220) and ONE PLAYER GAME (02e0), re-derived from a full
// disassembly (1000:0382-03ff). Proves:
//  - a selection already persisted from the last visit (SELECT GAME's own real resting value,
//    docs/engine.md §9av) is confirmable by fire with no LEFT/RIGHT press at all, but only once
//    any already-held fire key has been released first;
//  - fire is ignored while nothing is selected (selection 0), looping back to re-wait;
//  - LEFT/RIGHT pick an item, redraw and re-wait for release; picking the SAME direction again
//    only resets the idle timer, no redraw/re-wait;
//  - the idle cancel fires at exactly 2000 (0x7D0) ticks, and a released ESC cancels immediately;
//  - a direction press resets the idle timer even when it doesn't change the selection.
//   node tools/check-mainmenu.mjs
import { twoItemMenuInitialState, twoItemMenuStep, MENU_IDLE_CANCEL_TICKS } from '../src/frontend/frontMenu.js'

let bad = 0
function check(name, cond) {
  if (cond) return
  bad++
  console.log(`FAIL: ${name}`)
}

check('MENU_IDLE_CANCEL_TICKS is 0x7D0 (2000, ~28.6s)', MENU_IDLE_CANCEL_TICKS === 2000)

// 1. A persisted selection (1, "ONE PLAYER") confirms on fire alone, but only after any
// already-held fire is released (the entry AWAIT_RELEASE phase).
{
  const s = twoItemMenuInitialState(1)
  check('starts in AWAIT_RELEASE with the persisted selection', s.phase === 'AWAIT_RELEASE' && s.selection === 1)
  let r = twoItemMenuStep(s, { bits: 0x08 }) // fire still held from before entry
  check('fire held at entry: does not confirm yet', r.exit === null && s.phase === 'AWAIT_RELEASE')
  r = twoItemMenuStep(s, { bits: 0 }) // released
  check('release clears AWAIT_RELEASE', r.exit === null && s.phase === 'POLL' && s.idleTicks === 0)
  r = twoItemMenuStep(s, { bits: 0x08 }) // a fresh fire press
  check('a fresh fire press confirms the persisted selection', r.exit === 'confirm' && r.selection === 1)
}

// 2. Fire is ignored while nothing is selected (selection 0) -- loops back to AWAIT_RELEASE.
{
  const s = twoItemMenuInitialState(0)
  twoItemMenuStep(s, { bits: 0 }) // clear AWAIT_RELEASE
  const r = twoItemMenuStep(s, { bits: 0x08 })
  check('fire with nothing selected is ignored (no confirm)', r.exit === null)
  check('ignored fire re-enters AWAIT_RELEASE (redraw + re-wait)', s.phase === 'AWAIT_RELEASE')
}

// 3. LEFT/RIGHT pick an item; picking the SAME direction again only resets the idle timer.
{
  const s = twoItemMenuInitialState(0)
  twoItemMenuStep(s, { bits: 0 })
  twoItemMenuStep(s, { bits: 0x80 }) // LEFT -> selection 1, re-enters AWAIT_RELEASE
  check('LEFT picks item 1 and re-enters AWAIT_RELEASE', s.selection === 1 && s.phase === 'AWAIT_RELEASE')
  twoItemMenuStep(s, { bits: 0 }) // release, back to POLL
  check('back in POLL after the release', s.phase === 'POLL')
  for (let i = 0; i < 50; i++) twoItemMenuStep(s, { bits: 0 }) // idle a bit
  check('idle ticks accumulated', s.idleTicks === 50)
  twoItemMenuStep(s, { bits: 0x80 }) // LEFT again -- same direction, a repeat
  check('repeating the SAME direction stays in POLL (no redraw/re-wait)', s.phase === 'POLL' && s.selection === 1)
  check('repeating the same direction resets the idle timer', s.idleTicks === 0)
}

// 4. The idle cancel fires at exactly 2000 ticks, not 1999 or 2001.
{
  const s = twoItemMenuInitialState(1)
  twoItemMenuStep(s, { bits: 0 })
  let exited = false
  for (let i = 0; i < MENU_IDLE_CANCEL_TICKS - 1; i++) {
    const r = twoItemMenuStep(s, {})
    if (r.exit) exited = true
  }
  check('tick 1999: not yet cancelled', !exited && s.idleTicks === MENU_IDLE_CANCEL_TICKS - 1)
  const r = twoItemMenuStep(s, {}) // tick 2000
  check('tick 2000: cancels', r.exit === 'cancel')
}

// 5. A released ESC cancels immediately, regardless of idle ticks or the current selection.
{
  const s = twoItemMenuInitialState(2)
  twoItemMenuStep(s, { bits: 0 })
  const r = twoItemMenuStep(s, { escReleased: true })
  check('ESC release cancels immediately', r.exit === 'cancel')
}

// 6. A direction press resets the idle timer even when it does NOT change the selection outcome
// differently from a repeat (covered above) -- and a DIFFERENT direction also redraws/re-waits.
{
  const s = twoItemMenuInitialState(1)
  twoItemMenuStep(s, { bits: 0 })
  for (let i = 0; i < 100; i++) twoItemMenuStep(s, {})
  const r = twoItemMenuStep(s, { bits: 0x40 }) // RIGHT -- a real change from 1 to 2
  check('a real direction change re-enters AWAIT_RELEASE', s.phase === 'AWAIT_RELEASE' && s.selection === 2 && r.exit === null)
}

console.log(bad ? `${bad} check(s) failed` : 'check-mainmenu: RunTwoItemMenu\'s real selection/confirm/idle-cancel/ESC-cancel logic matches the disassembly')
process.exitCode = bad ? 1 : 0
