// P3's first item (GOAL-DOS-PARITY.md): the tournament board screen, `DrawTournamentBoard
// 1000:18d8` shown from `SetupTournamentRace 1000:115c` (docs/engine.md §9ay). Proves:
//  - shouldShowBoard's real three-way gate: Challenge format only, never before the qualifier,
//    never before the very last race -- including the pending-bonus-race index correction
//    (`boardRaceIndex`, `TriggerBonusRace 1000:1a82` calls `115c` BEFORE `10a0`'s own `INC [28C1]`);
//  - board.js's own AWAIT_RELEASE debounce (an already-held fire button at entry doesn't confirm);
//  - the blink toggles every BOARD_BLINK_HALF_PERIOD_TICKS (36, not 35 -- `17ff`'s own `CX+1`-tick
//    loop, the same off-by-one class `frontMenu.js`'s own idle-cancel test already caught once);
//  - a fresh fire press, or an ESC/other-key release, exits immediately;
//  - the idle timeout fires at the next 72-tick cycle boundary at or past BOARD_TIMEOUT_TICKS
//    (720, not exactly 700 -- `[261F]` is sampled only once per full blink cycle, `1000:1921`).
//   node tools/check-board.mjs
import { boardInitialState, boardStep, BOARD_BLINK_HALF_PERIOD_TICKS, BOARD_TIMEOUT_TICKS } from '../src/frontend/board.js'
import { initTournament, shouldShowBoard, boardRaceIndex } from '../src/frontend/tournament.js'
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
  check('boardRaceIndex is raceIndex for a regular race', boardRaceIndex(challenge) === 1)
  challenge.raceIndex = ORDER_TABLE_LAST_INDEX
  check('the very last race (champion decider): no board', !shouldShowBoard(challenge))

  const twocar = initTournament({ format: 'twocar' })
  twocar.raceIndex = 1
  check('two-car/H2H format: never shown, even mid-tournament', !shouldShowBoard(twocar))
}

// 1b. A pending bonus race uses raceIndex-1 (1a82 calls 115c BEFORE 10a0's own INC [28C1]): the
// port's own reportRaceResult already advanced raceIndex when it set pendingBonusRace, one ahead
// of what DOS's own [28C1] holds at the exact moment 115c/18d8 run for the bonus race itself.
{
  const s = initTournament({ format: 'challenge' })
  s.raceIndex = 5
  s.pendingBonusRace = { round: 9, race: 1 }
  check('pending bonus race: boardRaceIndex is raceIndex-1, not raceIndex', boardRaceIndex(s) === 4)
  check('pending bonus race: board still shown (4 is neither 0 nor the last index)', shouldShowBoard(s))
  // The edge the real gate implies: a bonus race triggered one race before the end (raceIndex-1
  // lands on the last regular entry) skips the board too, exactly like a regular race would there.
  s.raceIndex = ORDER_TABLE_LAST_INDEX + 1
  check('pending bonus race whose trigger WAS the last regular race: no board', !shouldShowBoard(s))
}

// 2. AWAIT_RELEASE: fire already held at entry does not exit; releasing it, then a fresh press, does.
{
  const s = boardInitialState()
  check('starts in AWAIT_RELEASE', s.phase === 'AWAIT_RELEASE')
  let r = boardStep(s, { bits: 0x08 }) // fire still held from confirming the previous screen
  check('fire held at entry: does not exit yet', r.exit === false && s.phase === 'AWAIT_RELEASE')
  r = boardStep(s, { bits: 0 }) // released
  check('release clears AWAIT_RELEASE', r.exit === false && s.phase === 'POLL')
  r = boardStep(s, { bits: 0x08 }) // a fresh press
  check('a fresh fire press exits', r.exit === true)
}

// 3. The blink toggles every BOARD_BLINK_HALF_PERIOD_TICKS ticks, starting blinkOn=true.
{
  const s = boardInitialState()
  boardStep(s, { bits: 0 }) // clear AWAIT_RELEASE
  check('blinkOn starts true', s.blinkOn === true)
  for (let i = 0; i < BOARD_BLINK_HALF_PERIOD_TICKS - 1; i++) boardStep(s, {})
  check('one tick before the boundary: still on', s.blinkOn === true)
  boardStep(s, {}) // the boundary tick
  check('at the boundary: toggles off', s.blinkOn === false)
  for (let i = 0; i < BOARD_BLINK_HALF_PERIOD_TICKS; i++) boardStep(s, {})
  check('one full period later: toggles back on', s.blinkOn === true)
}

// 4. An ESC or other-key release exits immediately, mid-blink, regardless of elapsed ticks.
{
  const s = boardInitialState()
  boardStep(s, { bits: 0 })
  for (let i = 0; i < 50; i++) boardStep(s, {})
  const r = boardStep(s, { escReleased: true })
  check('ESC release exits', r.exit === true)
}
{
  const s = boardInitialState()
  boardStep(s, { bits: 0 })
  const r = boardStep(s, { otherReleased: true })
  check('any other key release also exits (17ff has no ESC-specific branch)', r.exit === true)
}

// 5. The idle timeout fires at the next full-cycle boundary at or past BOARD_TIMEOUT_TICKS (720,
// the smallest multiple of a 72-tick full cycle >= 700), not at 700 itself and not one cycle early.
{
  const CYCLE = BOARD_BLINK_HALF_PERIOD_TICKS * 2 // 72: erase-wait + redraw-wait, 1000:1902-1929
  const realTimeout = Math.ceil(BOARD_TIMEOUT_TICKS / CYCLE) * CYCLE
  check('the real timeout lands on tick 720, not 700', realTimeout === 720)
  const s = boardInitialState()
  boardStep(s, { bits: 0 })
  let exited = false
  for (let i = 0; i < realTimeout - 1; i++) {
    const r = boardStep(s, {})
    if (r.exit) exited = true
  }
  check(`tick ${realTimeout - 1}: not yet timed out`, !exited)
  const r = boardStep(s, {}) // the boundary tick
  check(`tick ${realTimeout}: times out`, r.exit === true)
}

console.log(bad ? `${bad} check(s) failed` : 'check-board: DrawTournamentBoard\'s real when-shown gate (incl. the pending-bonus-race index) and blink/exit/timeout logic matches the disassembly')
process.exitCode = bad ? 1 : 0
