// The 25011968 cheat's race skip, ShowNextRaceIntroScreenTune4or5 1000:1398-13E0 (docs/engine.md
// §9bu, tournament.js's applyRaceSkip). Proves, against the disassembly:
//  - no skip without the cheat ([0xF6A]==0), or for any key but keypad +/-, or with no release;
//  - + moves on by one, but not past 0x19 (the race just runs); - moves back, wrapping 0 to 0x19;
//  - skips chain; the round/race come from ORDER_TABLE;
//  - the loop POSITION does not move with [28C1]: a skip inside the Challenge qualifier's prologue
//    is still judged by the qualifier rule and still leads to the picker; a loop race skipped to 0
//    is judged as a regular race (and keeps that across an H2H loss re-run); a skip from a bonus
//    intro runs a regular race still judged as a bonus (always NO_BONUS: [0x291D] is RUFFTRUX-only);
//  - [0x310] does not move with [28C1], so the elimination schedule follows the race COUNT.
//   node tools/check-raceskip.mjs
import { initTournament, applyRaceSkip, effectiveRaceIndex, isInQualifier, raceCountOf, currentRace, reportRaceResult, needsOpponentPick, raceIntroHoldTicks, hasRaceIntro, OUTCOME } from '../src/frontend/tournament.js'
import { ORDER_TABLE, ORDER_TABLE_LAST_INDEX } from '../src/data/frontend-tables.js'

let bad = 0
function check(name, cond) {
  if (cond) return
  bad++
  console.log(`FAIL: ${name}`)
}
const ADD = 'NumpadAdd'
const SUB = 'NumpadSubtract'
function loopAt(i, format = 'challenge') {
  const s = initTournament({ format })
  s.raceIndex = i
  s.opponents = format === 'challenge' ? [1, 2, 4] : [5]
  s.playerCharacter = 0
  return s
}

check('the last race index is 0x19', ORDER_TABLE_LAST_INDEX === 0x19)

// 1. Gates.
{
  const s = loopAt(5)
  check('no cheat: no skip', applyRaceSkip(s, ADD, false) === false && s.raceIndex === 5)
  check('another key: no skip', applyRaceSkip(s, 'Enter', true) === false && s.raceIndex === 5)
  check('no release (timeout / fire press): no skip', applyRaceSkip(s, null, true) === false && s.raceIndex === 5)
}

// 2. + and -, the 0x19 stop and the 0 wrap, chaining, the track.
{
  const s = loopAt(5)
  check('+ from 5 goes to 6', applyRaceSkip(s, ADD, true) && s.raceIndex === 6)
  check('the track follows ORDER_TABLE', currentRace(s).round === ORDER_TABLE[6].round && currentRace(s).race === ORDER_TABLE[6].race)
  check('+ chains: 6 -> 7', applyRaceSkip(s, ADD, true) && s.raceIndex === 7)
  check('- from 7 goes to 6', applyRaceSkip(s, SUB, true) && s.raceIndex === 6)
  const last = loopAt(ORDER_TABLE_LAST_INDEX)
  check('+ at 0x19: no skip, the race runs', applyRaceSkip(last, ADD, true) === false && last.raceIndex === ORDER_TABLE_LAST_INDEX)
  const one = loopAt(1)
  check('- from 1 goes to 0', applyRaceSkip(one, SUB, true) && one.raceIndex === 0)
  check('- from 0 wraps to 0x19', applyRaceSkip(one, SUB, true) && one.raceIndex === ORDER_TABLE_LAST_INDEX)
}

// 3. A skip inside the Challenge qualifier's prologue: still judged as the qualifier, picker follows.
{
  const s = initTournament({ format: 'challenge' })
  s.playerCharacter = 0
  check('fresh Challenge: in the qualifier, index 0', isInQualifier(s) && s.raceIndex === 0)
  check('+ from the qualifier intro goes to 1', applyRaceSkip(s, ADD, true) && s.raceIndex === 1)
  check('still in the qualifier prologue after the skip', isInQualifier(s))
  check('the intro now held for a regular race (121 ticks, data-keyed [28C1]!=0)', raceIntroHoldTicks(s) === 121)
  reportRaceResult(s, { finishPosition: 2 })
  check('2nd place is judged by the QUALIFIER rule (top 2 pass): PASSED', s.lastOutcome === OUTCOME.PASSED && !s.over)
  check('10F9 increments from the skipped index: now 2', s.raceIndex === 2 && !isInQualifier(s))
  check('the picker still follows the qualifier (10F6)', needsOpponentPick(s))
  const t = initTournament({ format: 'challenge' })
  applyRaceSkip(t, SUB, true)
  check('- from the qualifier intro wraps to the last race, still the qualifier position', t.raceIndex === ORDER_TABLE_LAST_INDEX && isInQualifier(t))
  reportRaceResult(t, { finishPosition: 1 })
  check('passing it: 10F9 goes past 0x19, so the champion follows (1101)', t.champion && t.over)
  check('... but the picker (10F6) still runs first, before 10F9/1101', needsOpponentPick(t))
  const f = initTournament({ format: 'challenge' })
  reportRaceResult(f, { finishPosition: 3 })
  check('a FAILED qualifier never reaches the picker (10E4 -> RET)', f.over && !f.champion && !needsOpponentPick(f))
}

// 4. A loop race skipped to 0 is a regular race, and stays one across an H2H loss re-run.
{
  const s = loopAt(1, 'twocar')
  applyRaceSkip(s, SUB, true)
  check('H2H loop race skipped to 0: not the qualifier position', s.raceIndex === 0 && !isInQualifier(s))
  check('H2H at index 0 has no intro (data-keyed, 126D/1274): the race starts at once', !hasRaceIntro(s))
  reportRaceResult(s, { finishPosition: 2 })
  check('an H2H loss there is ONE_LIFE_LOST (the loop rule), not QUALIFIER_FAILED', s.lastOutcome === OUTCOME.ONE_LIFE_LOST && !s.over)
  check('the re-run keeps the loop position (no advance)', s.raceIndex === 0 && !isInQualifier(s))
  reportRaceResult(s, { finishPosition: 1 })
  check('winning it: 10F9 on to 1', s.raceIndex === 1 && s.lastOutcome === null)
}

// 5. A skip from a bonus race's intro: a regular race, judged as a bonus (NO_BONUS).
{
  const s = loopAt(4)
  s.pendingBonusRace = { round: 9, race: 1 }
  s.raceIndex = 5 // the port's index runs one ahead of [28C1]=4 while the bonus is pending
  const lives = s.lives
  check('bonus intro: [28C1] is 4', effectiveRaceIndex(s) === 4 && currentRace(s).round === 9)
  applyRaceSkip(s, ADD, true)
  check('+ from the bonus intro: [28C1] 5, still pending', effectiveRaceIndex(s) === 5 && !!s.pendingBonusRace)
  check('the race is now ORDER_TABLE[5], a regular one', currentRace(s).round === ORDER_TABLE[5].round && currentRace(s).round !== 9)
  check('its intro is a regular intro (121 ticks, data-keyed [28BF]!=9)', raceIntroHoldTicks(s) === 121)
  reportRaceResult(s, { finishPosition: 1 })
  check('judged inside 1A82 as a bonus: NO_BONUS, no life, no bonus counter', s.lastOutcome === OUTCOME.NO_BONUS && s.lives === lives && s.bonusRacesTaken === 0)
  check('afterwards 10F9 continues from the skipped index: 6', s.raceIndex === 6 && !s.pendingBonusRace)
}

// 6. [0x310] does not move with [28C1]: the elimination schedule follows the race count.
{
  const s = loopAt(2)
  check('before: count 2 at index 2', raceCountOf(s) === 2)
  applyRaceSkip(s, ADD, true)
  check('after + : index 3, count still 2', s.raceIndex === 3 && raceCountOf(s) === 2)
  reportRaceResult(s, { finishPosition: 1 })
  check('race index 3 passed with count 2: NO elimination (1676 reads [0x310], 2 % 3 != 0)', !s.pendingElimination)
  check('both advance together afterwards: index 4, count 3', s.raceIndex === 4 && raceCountOf(s) === 3)
  const t = loopAt(4)
  applyRaceSkip(t, SUB, true); applyRaceSkip(t, SUB, true) // index 2, count 4
  t.raceCountOffset = 3 - t.raceIndex + 0 // put [0x310] at 3: a count that DOES hit the schedule
  reportRaceResult(t, { finishPosition: 1 })
  check('index 2 passed with count 3: an elimination (count 3 % 3 == 0)', !!t.pendingElimination)
  check('with no [28C1]==3 set-up yet, the cursor advances from the session value: 0 (0xC1E) + 1 = slot 1 (16B0-16BE)', t.pendingElimination.slot === 1)
  const u = initTournament({ format: 'challenge', evictionSlotCursor: 2 })
  u.opponents = [1, 2, 4]; u.playerCharacter = 0; u.raceIndex = 2; u.qualifierOverride = false; u.raceCountOffset = 1
  reportRaceResult(u, { finishPosition: 1 })
  check('a later tournament in the session continues from the carried-over cursor: 2 + 1 wraps to slot 0', u.pendingElimination?.slot === 0)
}

console.log(bad ? `${bad} check(s) failed` : 'check-raceskip: the 25011968 cheat\'s keypad +/- race skip (1398-13E0) -- its gates, the 0x19 stop and 0 wrap, and the loop position and [0x310] staying put while [28C1] moves -- matches the disassembly')
process.exitCode = bad ? 1 : 0
