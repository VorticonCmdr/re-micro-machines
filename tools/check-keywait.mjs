// The shared "wait for a key, with a real timeout" primitive, 1000:179B-17FE, reused by the
// one-player race-intro, the elimination screen, and the H2H race-info screen (docs/engine.md
// §9ba/§9bn). Proves:
//  - the timeout check runs BEFORE that tick's own increment, and is >= not >, so a timeout exit
//    leaves `ticks` at exactly the timeout value, never one past it;
//  - stage 1 (debounce an already-held fire) and stage 2 (wait for a fresh press or release) share
//    ONE tick budget -- the transition between them does not reset it;
//  - stage 1 exits on a held fire staying held (keeps debouncing) or being released (falls into
//    stage 2); stage 2 exits on the OPPOSITE fire condition (a fresh press dismisses);
//  - a release latch dismisses from either stage, checked before the fire-held branch;
//  - the timeout fires identically from either stage.
// And the whole-screen composition flow.js drives for RACE_INTRO/ELIMINATED (waitScreenStep,
// docs/engine.md §9bp):
//  - input during the pre-wait work (the slide hold / the wobble bounce) is ignored entirely;
//  - 179B's own entry (`entered`, the caller's release-latch clear) lands on exactly the tick the
//    pre-wait work finishes, and the wait's own first tick is the NEXT call;
//  - the timeout counts from that entry, not from the screen's own start;
//  - a fire held across the entry is debounced (stage 1), a fresh press after release dismisses;
//  - a zero hold enters the wait immediately.
//   node tools/check-keywait.mjs
import { keyWaitInitialState, keyWaitStep, KEY_WAIT_TIMEOUT_TICKS, waitScreenInitialState, waitScreenStep, holdTicksPreStep } from '../src/frontend/keyWait.js'
import { eliminationInitialState, eliminationStep } from '../src/frontend/elimination.js'
import { raceIntroHoldTicks } from '../src/frontend/tournament.js'

let bad = 0
function check(name, cond) {
  if (cond) return
  bad++
  console.log(`FAIL: ${name}`)
}

check('KEY_WAIT_TIMEOUT_TICKS is 700 (0x2BC)', KEY_WAIT_TIMEOUT_TICKS === 700)

// 1. Fresh state starts in STAGE1 at ticks 0.
{
  const s = keyWaitInitialState()
  check('fresh state starts in STAGE1', s.phase === 'STAGE1')
  check('fresh state starts at ticks 0', s.ticks === 0)
}

// 2. Stage 1: fire held every tick stays in STAGE1 indefinitely (until timeout).
{
  const s = keyWaitInitialState()
  for (let i = 0; i < 50; i++) {
    const r = keyWaitStep(s, { fireHeld: true })
    check(`stage1 tick ${i}: fire held keeps waiting`, r.exit === null && s.phase === 'STAGE1')
  }
  check('50 ticks of held fire: ticks accumulated', s.ticks === 50)
}

// 3. Stage 1: fire released transitions to STAGE2, SAME tick count carries (not reset).
{
  const s = keyWaitInitialState()
  for (let i = 0; i < 15; i++) keyWaitStep(s, { fireHeld: true })
  check('15 ticks in, still STAGE1', s.phase === 'STAGE1' && s.ticks === 15)
  const r = keyWaitStep(s, { fireHeld: false })
  check('releasing fire transitions to STAGE2', s.phase === 'STAGE2' && r.exit === null)
  check('the tick count carries across the transition, not reset', s.ticks === 16)
}

// 4. anyKeyReleased dismisses from STAGE1, even with fire held.
{
  const s = keyWaitInitialState()
  keyWaitStep(s, { fireHeld: true })
  const r = keyWaitStep(s, { fireHeld: true, anyKeyReleased: true })
  check('anyKeyReleased dismisses from STAGE1 even with fire held', r.exit === 'dismiss')
}

// 5. Stage 2: fire not held keeps waiting.
{
  const s = keyWaitInitialState()
  s.phase = 'STAGE2'
  const r = keyWaitStep(s, { fireHeld: false })
  check('stage2 with no fire keeps waiting', r.exit === null && s.phase === 'STAGE2')
}

// 6. Stage 2: a fresh fire press dismisses (the OPPOSITE of stage 1's own exit condition).
{
  const s = keyWaitInitialState()
  s.phase = 'STAGE2'
  const r = keyWaitStep(s, { fireHeld: true })
  check('stage2 with fire held dismisses (fresh press)', r.exit === 'dismiss')
}

// 7. anyKeyReleased dismisses from STAGE2 too.
{
  const s = keyWaitInitialState()
  s.phase = 'STAGE2'
  const r = keyWaitStep(s, { fireHeld: false, anyKeyReleased: true })
  check('anyKeyReleased dismisses from STAGE2', r.exit === 'dismiss')
}

// 8. Timeout from STAGE1: exits with 'timeout' at exactly the timeout tick count, does NOT fall
// through into STAGE2, and does NOT increment past the timeout value.
{
  const s = keyWaitInitialState()
  s.ticks = KEY_WAIT_TIMEOUT_TICKS - 1
  let r = keyWaitStep(s, { fireHeld: true })
  check('one tick before timeout: still waiting', r.exit === null)
  check('ticks incremented to exactly the timeout value', s.ticks === KEY_WAIT_TIMEOUT_TICKS)
  r = keyWaitStep(s, { fireHeld: true })
  check('at the timeout value: exits with timeout', r.exit === 'timeout')
  check('timeout exit leaves ticks at exactly the timeout value, not one past it', s.ticks === KEY_WAIT_TIMEOUT_TICKS)
  check('timeout from STAGE1 does not fall through to STAGE2', s.phase === 'STAGE1')
}

// 9. Timeout from STAGE2: same shape.
{
  const s = keyWaitInitialState()
  s.phase = 'STAGE2'
  s.ticks = KEY_WAIT_TIMEOUT_TICKS
  const r = keyWaitStep(s, { fireHeld: false })
  check('timeout fires identically from STAGE2', r.exit === 'timeout')
  check('timeout exit from STAGE2 does not increment ticks', s.ticks === KEY_WAIT_TIMEOUT_TICKS)
}

// 10. The timeout check runs BEFORE the increment: reaching the timeout mid-STAGE1-debounce still
// requires one more call (at ticks==TIMEOUT already) to actually exit -- the call that reaches
// ticks===TIMEOUT itself still returns null.
{
  const s = keyWaitInitialState()
  let timeoutExitTick = null
  for (let i = 0; i < KEY_WAIT_TIMEOUT_TICKS + 2; i++) {
    const r = keyWaitStep(s, { fireHeld: true })
    if (r.exit === 'timeout') { timeoutExitTick = i; break }
  }
  check('timeout exits on call index === KEY_WAIT_TIMEOUT_TICKS (0-indexed), the call AFTER reaching it', timeoutExitTick === KEY_WAIT_TIMEOUT_TICKS)
}

// 11. waitScreenStep: the real Challenge race-intro hold (121 ticks), input ignored during it.
{
  const HOLD = raceIntroHoldTicks({ raceIndex: 3, format: 'challenge', pendingBonusRace: false })
  check('the Challenge race-intro hold is 121 ticks', HOLD === 121)
  const s = waitScreenInitialState()
  const pre = holdTicksPreStep(HOLD)
  let enteredAt = null
  for (let i = 1; i <= HOLD + 5 && enteredAt == null; i++) {
    const r = waitScreenStep(s, { fireHeld: true, anyKeyReleased: true }, pre)
    check(`hold tick ${i}: never exits, whatever the input`, r.exit === null)
    if (r.entered) enteredAt = i
  }
  check('179B is entered on exactly the last hold tick', enteredAt === HOLD)
  check('entry resets the wait to STAGE1 at 0 ticks (the entry tick itself is not a wait tick)', s.wait.phase === 'STAGE1' && s.wait.ticks === 0)
  const r = waitScreenStep(s, { anyKeyReleased: true }, pre)
  check('after entry, a release latch dismisses on the next call', r.exit === 'dismiss' && r.entered === false)
}

// 12. The timeout counts from 179B's own entry: exit on call HOLD + TIMEOUT + 1, not before.
{
  const HOLD = 121
  const s = waitScreenInitialState()
  const pre = holdTicksPreStep(HOLD)
  let exitAt = null
  for (let i = 1; i <= HOLD + KEY_WAIT_TIMEOUT_TICKS + 5; i++) {
    const r = waitScreenStep(s, {}, pre)
    if (r.exit) { exitAt = i; check('no input: the exit is a timeout', r.exit === 'timeout'); break }
  }
  check('timeout exits on call HOLD + 700 + 1 (hold, entry on its last tick, 700 wait ticks, then the check)', exitAt === HOLD + KEY_WAIT_TIMEOUT_TICKS + 1)
}

// 13. A fire held across the entry is debounced: stays until released, then a fresh press dismisses.
{
  const s = waitScreenInitialState()
  const pre = holdTicksPreStep(10)
  for (let i = 0; i < 10; i++) waitScreenStep(s, { fireHeld: true }, pre)
  for (let i = 0; i < 30; i++) check(`held fire across entry, wait tick ${i}: no exit`, waitScreenStep(s, { fireHeld: true }, pre).exit === null)
  check('still STAGE1 while held', s.wait.phase === 'STAGE1')
  check('release (no latch): no exit, into STAGE2', waitScreenStep(s, { fireHeld: false }, pre).exit === null && s.wait.phase === 'STAGE2')
  check('fresh press: dismiss', waitScreenStep(s, { fireHeld: true }, pre).exit === 'dismiss')
}

// 14. A zero hold (preDone): the very first call is already a wait tick.
{
  const s = waitScreenInitialState(true)
  const r = waitScreenStep(s, {}, () => { throw new Error('preStep must not run') })
  check('zero hold: first call is a wait tick, not an entry', r.entered === false && r.exit === null && s.wait.ticks === 1)
  check('holdTicksPreStep(1) finishes on its first call', holdTicksPreStep(1)() === true)
}

// 15. ELIMINATED's own composition: the real wobble bounce as the pre-wait work.
{
  const e = eliminationInitialState()
  const s = waitScreenInitialState()
  let enteredAt = null
  let bounceTicks = 0
  const probe = eliminationInitialState()
  while (!eliminationStep(probe).done) bounceTicks++
  bounceTicks++ // the call that reports done
  for (let i = 1; i <= 400 && enteredAt == null; i++) {
    const r = waitScreenStep(s, { fireHeld: true, anyKeyReleased: true }, () => eliminationStep(e).done)
    check(`bounce tick ${i}: never exits, whatever the input`, r.exit === null)
    if (r.entered) enteredAt = i
  }
  check('179B is entered on exactly the tick the bounce reports done', enteredAt === bounceTicks && e.done)
}

console.log(bad ? `${bad} check(s) failed` : 'check-keywait: the shared 1000:179B wait -- its combined ~700-tick timeout (checked before each tick, not after), its stage transition sharing one budget, and its opposite stage1/stage2 fire-held exit conditions -- all match the disassembly; and the whole-screen composition flow.js drives for RACE_INTRO/ELIMINATED ignores input before 179B\'s own entry, enters it on the right tick, and times out from there')
process.exitCode = bad ? 1 : 0
