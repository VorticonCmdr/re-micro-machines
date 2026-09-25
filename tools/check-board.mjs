// P3's first item (GOAL-DOS-PARITY.md): the tournament board screen, `DrawTournamentBoard
// 1000:18d8` shown from `SetupTournamentRace 1000:115c` (docs/engine.md §9ay). Proves:
//  - shouldShowBoard's real three-way gate: Challenge format only, never before the qualifier,
//    never before the very last race -- including the pending-bonus-race index correction
//    (`effectiveRaceIndex`, `TriggerBonusRace 1000:1a82` calls `115c` BEFORE `10a0`'s own `INC [28C1]`);
//  - the wait is 17FF's own (docs/engine.md §9br): a fire held at entry never dismisses, but the
//    36-tick windows keep counting while it is held -- the blink keeps going and the board still
//    times out at 720 (the old AWAIT_RELEASE idiom froze both); release then a fresh press dismisses;
//  - the blink toggles every BOARD_BLINK_HALF_PERIOD_TICKS (36, not 35 -- `17ff`'s own `CX+1`-tick
//    loop, the same off-by-one class `frontMenu.js`'s own idle-cancel test already caught once);
//  - any key release exits immediately, and the release latch is cleared at every window start;
//  - the timeout is sampled after every 2nd window (`1921`): tick 720, not 700; the bonus-race
//    reveal samples after every 1st window of a pair (`1971`): tick 756. The two schedules are told
//    apart both by the timeout tick and by the `timeoutChecked` sequence itself.
//   node tools/check-board.mjs
import { boardInitialState, boardStep, BOARD_BLINK_HALF_PERIOD_TICKS, BOARD_TIMEOUT_TICKS } from '../src/frontend/board.js'
import { initTournament, shouldShowBoard, effectiveRaceIndex } from '../src/frontend/tournament.js'
import { ORDER_TABLE_LAST_INDEX, BOARD_ICON_POSITIONS } from '../src/data/frontend-tables.js'

let bad = 0
function check(name, cond) {
  if (cond) return
  bad++
  console.log(`FAIL: ${name}`)
}

check('BOARD_BLINK_HALF_PERIOD_TICKS is 0x24 (36, ~0.5s -- 17ff\'s own CX+1, not CX)', BOARD_BLINK_HALF_PERIOD_TICKS === 0x24)
check('BOARD_TIMEOUT_TICKS is 0x2bc (700, ~10s)', BOARD_TIMEOUT_TICKS === 0x2bc)
check('BOARD_ICON_POSITIONS has 26 entries', BOARD_ICON_POSITIONS.length === 26)

// 1. shouldShowBoard's real gate (115c): Challenge only, never the qualifier, never the last race.
{
  const challenge = initTournament({ format: 'challenge' })
  check('qualifier (raceIndex 0): no board', !shouldShowBoard(challenge))
  challenge.raceIndex = 1
  check('a regular mid-tournament race: board shown', shouldShowBoard(challenge))
  check('effectiveRaceIndex is raceIndex for a regular race', effectiveRaceIndex(challenge) === 1)
  challenge.raceIndex = ORDER_TABLE_LAST_INDEX
  check('the very last race (champion decider): no board', !shouldShowBoard(challenge))

  const twocar = initTournament({ format: 'twocar' })
  twocar.raceIndex = 1
  check('two-car/H2H format: never shown, even mid-tournament', !shouldShowBoard(twocar))
}

// 1b. A pending bonus race uses raceIndex-1 (1a82 calls 115c BEFORE 10a0's own INC [28C1]): the
// port's own reportRaceResult already advanced raceIndex when it set pendingBonusRace, one ahead
// of what DOS's own [28C1] holds at the exact moment 115c/18d8 run for the bonus race itself.
// (There is no "bonus race triggered by the very last regular race" case to test: tournament.js's
// own maybeTriggerBonusRace refuses to trigger once raceIndex>=ORDER_TABLE_LAST_INDEX, so a
// pending bonus race's post-advance raceIndex can never exceed ORDER_TABLE_LAST_INDEX+1 in a way
// that would also require the board to skip -- an earlier draft of this test asserted exactly that
// unreachable combination, caught by an advisor review.)
{
  const s = initTournament({ format: 'challenge' })
  s.raceIndex = 5
  s.pendingBonusRace = { round: 9, race: 1 }
  check('pending bonus race: effectiveRaceIndex is raceIndex-1, not raceIndex', effectiveRaceIndex(s) === 4)
  check('pending bonus race: board still shown (4 is neither 0 nor the last index)', shouldShowBoard(s))
}

const held = { fireHeld: true }
const run = (s, input, max = 2000) => {
  const checks = []
  for (let t = 1; t <= max; t++) {
    const r = boardStep(s, input)
    if (r.timeoutChecked) checks.push(t)
    if (r.exit) return { exit: r.exit, at: t, checks }
  }
  return { exit: null, at: null, checks }
}

// 2. A fire held from before the screen never dismisses, and does not stop the clock.
{
  const s = boardInitialState()
  check('starts blinkOn, in 17FF\'s AWAIT_RELEASE', s.blinkOn === true && s.window.wait.phase === 'AWAIT_RELEASE')
  for (let t = 1; t < BOARD_BLINK_HALF_PERIOD_TICKS; t++) boardStep(s, held)
  check('fire held: still on one tick before the window ends', s.blinkOn === true)
  boardStep(s, held)
  check('fire held: the blink still toggles at tick 36 (17FF times out while waiting for the release)', s.blinkOn === false)
  const r = run(boardInitialState(), held)
  check('fire held the whole time: the board times out at 720, never dismisses', r.exit === 'timeout' && r.at === 720)
}

// 3. Release, then a fresh press, dismisses; the blink period is 36.
{
  const s = boardInitialState()
  boardStep(s, held)
  check('released: no exit', boardStep(s, {}).exit === null)
  check('a fresh fire press exits', boardStep(s, held).exit === 'dismiss')
  const b = boardInitialState()
  for (let i = 0; i < BOARD_BLINK_HALF_PERIOD_TICKS - 1; i++) boardStep(b, {})
  check('one tick before the boundary: still on', b.blinkOn === true)
  boardStep(b, {})
  check('at the boundary: toggles off', b.blinkOn === false)
  for (let i = 0; i < BOARD_BLINK_HALF_PERIOD_TICKS; i++) boardStep(b, {})
  check('one full period later: toggles back on', b.blinkOn === true)
}

// 4. Any key release exits immediately; every window start asks the caller to clear the latch.
{
  const s = boardInitialState()
  for (let i = 0; i < 50; i++) boardStep(s, {})
  check('a release exits mid-blink', boardStep(s, { anyKeyReleased: true }).exit === 'dismiss')
  const r = boardInitialState()
  const resets = []
  for (let t = 1; t <= 200; t++) if (boardStep(r, {}).resetLatch) resets.push(t)
  check('the latch is cleared at every 36-tick window start (36, 72, 108, ...)', resets.length === 5 && resets.every((t, i) => t === 36 * (i + 1)))
}

// 5. The timeout schedule: regular board after every 2nd window (720), bonus reveal after every 1st of a pair (756).
{
  const reg = run(boardInitialState(), {})
  check('regular board: times out on tick 720, not 700', reg.exit === 'timeout' && reg.at === 720)
  check('regular board: [261F] sampled at 72, 144, ... (after every 2nd window, 1921)', reg.checks.every((t, i) => t === 72 * (i + 1)))
  const bonus = run(boardInitialState({ bonusReveal: true }), {})
  check('bonus reveal: times out on tick 756', bonus.exit === 'timeout' && bonus.at === 756)
  check('bonus reveal: [261F] sampled at 36, 108, 180, ... (after the 1st window of each pair, 1971)', bonus.checks.every((t, i) => t === 36 + 72 * i))
}

console.log(bad ? `${bad} check(s) failed` : 'check-board: DrawTournamentBoard\'s real when-shown gate (incl. the pending-bonus-race index) and blink/exit/timeout logic matches the disassembly')
process.exitCode = bad ? 1 : 0
