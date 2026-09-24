// M3.9 acceptance test (PLAN-ENGINE.md): the tournament state machine, headless, driven by
// synthetic race results -- no DOSBox needed, the direct analogue of what check-rounds.mjs did
// for M3.8. Exercises every named rule in docs/engine.md §7 and both places tournament.js itself
// flags an INFERRED (not directly evidenced) behaviour. Also covers P3's second item
// (docs/engine.md §9az): the qualifier's own fixed JETHRO trio, and the real interactive
// opponent picker that fills `state.opponents` once, right after a Challenge qualifier PASS.
//   node tools/check-tournament.mjs
import { initTournament, pickPlayerCharacter, pickOpponentCharacter, hasRaceIntro, screenAfterRace, currentRace, reportRaceResult, shouldShowBoard, effectiveRaceIndex, opponentCharactersFor, needsOpponentPick, QUALIFIER_OPPONENTS, OUTCOME } from '../src/frontend/tournament.js'
import { ORDER_TABLE_LAST_INDEX, MAX_BONUS_RACES } from '../src/data/frontend-tables.js'

let bad = 0
function check(name, cond) {
  if (cond) return
  bad++
  console.log(`FAIL: ${name}`)
}

// Test-harness stand-in for the real interactive picker (`FUN_1000_1A4A`, `flow.js`'s
// `enterOpponentPick`): picks the first `n` untaken, non-eliminated roster slots, in index order.
// Not a port simplification -- the real port drives `pickOpponentCharacter` from a live carousel;
// this is just what a synthetic headless test calls instead of a human at the same three prompts.
function pickFirstUntakenOpponents(state, n = 3) {
  for (const slot of state.roster) {
    if (state.opponents.length >= n) break
    if (!slot.taken && !slot.eliminated) pickOpponentCharacter(state, slot.index)
  }
}

// 1. Qualifier: 1st or 2nd passes in Challenge format; the qualifier itself has no track name, and
// races against a fixed, unpicked JETHRO trio -- the real interactive picker (P3's second item)
// only exists AFTER a Challenge pass, not before the qualifier even runs (docs/engine.md §9az).
{
  const s = initTournament()
  pickPlayerCharacter(s, 0)
  check('qualifier is raceIndex 0', s.raceIndex === 0)
  check('qualifier has no track name (ROUND21)', currentRace(s).name === null)
  check('the player pick does NOT auto-pick opponents (opponents start empty)', s.opponents.length === 0)
  check('the qualifier races a fixed JETHRO x3, not a roster pick (1000:102b/10a0, no tuning effect)', opponentCharactersFor(s).join() === QUALIFIER_OPPONENTS.join())
  check('JETHRO\'s own roster slot is NOT marked taken by the qualifier\'s fixed trio', !s.roster[6].taken)
  check('the real picker is not needed yet (still at the qualifier)', !needsOpponentPick(s))
  reportRaceResult(s, { finishPosition: 2 })
  check('qualifier 2nd place passes in Challenge format', s.lastOutcome === OUTCOME.PASSED && !s.over)
  check('passing the qualifier advances raceIndex to 1', s.raceIndex === 1)
  check('the real interactive picker is needed right after the pass', needsOpponentPick(s))
  check('picking the player\'s own (taken) character as an opponent fails', pickOpponentCharacter(s, 0) === false && s.opponents.length === 0)
  check('picking a free character works', pickOpponentCharacter(s, 1) === true && s.opponents.join() === '1')
  pickOpponentCharacter(s, 2)
  pickOpponentCharacter(s, 3)
  check('all 3 opponents picked, distinct, excluding the player', s.opponents.length === 3 && new Set(s.opponents).size === 3 && !s.opponents.includes(0))
  check('race 1 onward now uses the real picked opponents, not the qualifier\'s fixed trio', opponentCharactersFor(s).join() === s.opponents.join())
}

// 1b. A qualifier FAILURE never runs the picker at all -- the real `1A4A` is only ever called on
// the PASS branch (`10EF`/`10F6`); `state.opponents` stays empty for the rest of the (over) run.
{
  const s = initTournament()
  pickPlayerCharacter(s, 0)
  reportRaceResult(s, { finishPosition: 4 })
  check('qualifier failure: opponents were never picked (the picker never runs)', s.opponents.length === 0)
  check('qualifier failure: the picker is not "needed" either (the tournament is over)', !needsOpponentPick(s))
}

// 2. Qualifier failure ends the tournament outright (no life loss, no re-run).
{
  const s = initTournament()
  pickPlayerCharacter(s, 0)
  reportRaceResult(s, { finishPosition: 3 })
  check('qualifier 3rd place fails', s.lastOutcome === OUTCOME.QUALIFIER_FAILED)
  check('qualifier failure ends the tournament', s.over === true && !s.champion)
  check('qualifier failure does not advance raceIndex', s.raceIndex === 0)
}

// 3. Two-car format: only 1st passes the qualifier (2nd does not, unlike Challenge format). Its
// own opponent (car 1) is picked directly via `pickOpponentCharacter` (0FBF's second 09E0, tested
// in 3b below), never through the Challenge-only fixed-trio/picker pair above.
{
  const s = initTournament({ format: 'twocar' })
  pickPlayerCharacter(s, 0)
  reportRaceResult(s, { finishPosition: 2 })
  check('two-car qualifier: 2nd place fails (Challenge\'s "or 2nd" does not apply)', s.over === true && s.lastOutcome === OUTCOME.QUALIFIER_FAILED)
}
{
  const s = initTournament({ format: 'twocar' })
  pickPlayerCharacter(s, 0)
  reportRaceResult(s, { finishPosition: 1 })
  check('two-car qualifier: 1st place passes with the QUALIFIED_FOR_HEAD_TO_HEAD outcome', s.lastOutcome === OUTCOME.QUALIFIED_FOR_HEAD_TO_HEAD && !s.over)
  reportRaceResult(s, { finishPosition: 2 })
  check('two-car regular race: anything but 1st loses a life and re-runs the same race', s.lastOutcome === OUTCOME.ONE_LIFE_LOST && s.lives === 2 && s.raceIndex === 1)
  reportRaceResult(s, { finishPosition: 1 })
  reportRaceResult(s, { finishPosition: 1 })
  reportRaceResult(s, { finishPosition: 1 })
  check('two-car mode never triggers a bonus race (no streak mechanic)', s.pendingBonusRace === null && s.bonusRacesTaken === 0)
}

// 3b. Head-to-Head vs CPU's own flow (docs/engine.md §9an): the player picks the CPU opponent on a
// second select screen (0FBF -> 09E0 "WHO DO YOU WANT TO RACE ?", [266A]); a taken character can't
// be picked (0AB5-0ABB); the qualifier has no intro screen (126D-127B) and ends on an outcome
// message, never the results table; a won race shows no screen at all (13FB -> 140C); a lost one
// shows "ONE LIFE LOST" and re-runs the same race; no lives left ends the run.
{
  const s = initTournament({ format: 'twocar' })
  pickPlayerCharacter(s, 4)
  check('H2H: picking the player does NOT auto-pick the opponent', s.opponents.length === 0)
  check('H2H: the player\'s own character cannot be picked as the opponent', pickOpponentCharacter(s, 4) === false && s.opponents.length === 0)
  check('H2H: a free character becomes the CPU opponent (car 1\'s KidModifier character)', pickOpponentCharacter(s, 7) === true && s.opponents.join() === '7' && s.roster[7].taken)
  check('H2H: the qualifier has no race intro screen', hasRaceIntro(s) === false)
  reportRaceResult(s, { finishPosition: 1 })
  check('H2H: after the qualifier comes the outcome message, not the results table', screenAfterRace(s, { wasQualifier: true }) === 'OUTCOME' && s.lastOutcome === OUTCOME.QUALIFIED_FOR_HEAD_TO_HEAD)
  check('H2H: race 1 onwards does have an intro screen', hasRaceIntro(s) === true)
  reportRaceResult(s, { finishPosition: 1 })
  check('H2H: a won race shows no screen at all (no results, no outcome)', screenAfterRace(s, {}) === 'NONE' && s.lastOutcome === null && s.raceIndex === 2)
  reportRaceResult(s, { finishPosition: 2 })
  check('H2H: a lost race shows "ONE LIFE LOST" and re-runs the same race', screenAfterRace(s, {}) === 'OUTCOME' && s.lastOutcome === OUTCOME.ONE_LIFE_LOST && s.raceIndex === 2 && s.lives === 2)
  reportRaceResult(s, { finishPosition: 2 })
  reportRaceResult(s, { finishPosition: 2 })
  check('H2H: no lives left ends the run', s.over === true && s.lives === 0 && !s.champion)
}
{
  const c = initTournament()
  pickPlayerCharacter(c, 0)
  check('Challenge: the qualifier has its intro screen', hasRaceIntro(c) === true)
  reportRaceResult(c, { finishPosition: 2 })
  check('Challenge: the qualifier also ends on its outcome message, never the results table (10E4/10EC)', screenAfterRace(c, { wasQualifier: true }) === 'OUTCOME')
  check('Challenge: the real picker is needed right after the qualifier passes', needsOpponentPick(c))
  pickFirstUntakenOpponents(c)
  check('Challenge: the picker fills all 3 opponent slots', c.opponents.length === 3)
  reportRaceResult(c, { finishPosition: 1 })
  check('Challenge: a regular race shows the results table', screenAfterRace(c, {}) === 'RESULTS')
}

// 4. Challenge: 3rd/4th loses a life, re-runs the SAME race, and resets the streak to 3 (docs:
// "[3fa]=3" on a 3rd/4th result -- explicit, not inferred).
{
  const s = initTournament()
  pickPlayerCharacter(s, 0)
  reportRaceResult(s, { finishPosition: 1 }) // pass the qualifier
  pickFirstUntakenOpponents(s) // the real picker, right after the pass
  const idx = s.raceIndex
  reportRaceResult(s, { finishPosition: 1 }) // burn the streak down to 2
  s.streak = 1 // force the next loss to matter for the streak-reset assertion below
  reportRaceResult(s, { finishPosition: 4 })
  check('3rd/4th loses a life', s.lives === 2 && s.lastOutcome === OUTCOME.ONE_LIFE_LOST)
  check('3rd/4th re-runs the same race (raceIndex unchanged)', s.raceIndex === idx + 1) // idx+1 from the earlier 1st-place pass; this loss re-runs THAT same index
  check('3rd/4th resets the streak to 3 (docs: "[3fa]=3", explicit)', s.streak === 3)
}

// 5. Lives reaching 0 ends the tournament (INFERRED floor -- docs never state this explicitly,
// only that a life is lost and the race re-runs; flagged in tournament.js's file header).
{
  const s = initTournament()
  pickPlayerCharacter(s, 0)
  reportRaceResult(s, { finishPosition: 1 })
  pickFirstUntakenOpponents(s)
  for (let i = 0; i < 3 && !s.over; i++) reportRaceResult(s, { finishPosition: 4 })
  check('3 straight last-places (starting from 3 lives) exhausts lives and ends the tournament (INFERRED)', s.lives === 0 && s.over === true && !s.champion)
}

// 6. A full 1st-place run reaches the champion screen; bonus races fire on schedule and never
// exceed MAX_BONUS_RACES; the tournament index lands exactly one past the last order-table entry.
{
  const s = initTournament()
  pickPlayerCharacter(s, 0)
  let iterations = 0
  while (!s.over && iterations < 200) {
    reportRaceResult(s, { finishPosition: 1, won: true })
    if (needsOpponentPick(s)) pickFirstUntakenOpponents(s) // right after the qualifier passes, once
    iterations++
  }
  check('a perfect run reaches the champion screen', s.champion === true && s.over === true)
  check('raceIndex lands one past the last order-table entry', s.raceIndex === ORDER_TABLE_LAST_INDEX + 1)
  check('bonus races never exceed MAX_BONUS_RACES', s.bonusRacesTaken <= MAX_BONUS_RACES)
  check('at least one bonus race fired on a perfect run (streak hits 0 well before the end)', s.bonusRacesTaken >= 1)
  const evictionIndices = s.eliminationEvents.map((e) => e.atRaceIndex)
  check('every eviction happens at a raceIndex that is a nonzero multiple of 3', evictionIndices.every((i) => i > 0 && i % 3 === 0))
  check('at least one eviction fired over a full tournament', evictionIndices.length > 0)
}

// 7. Eviction cadence: the FIRST eviction (raceIndex==3) targets the lowest character index among
// the active opponents; the next one (raceIndex==6) round-robins to a different slot rather than
// re-picking the lowest again.
{
  const s = initTournament()
  pickPlayerCharacter(s, 0)
  reportRaceResult(s, { finishPosition: 1 }) // pass qualifier -> raceIndex 1
  pickFirstUntakenOpponents(s) // opponents picked
  const lowestOpponent = Math.min(...s.opponents)
  reportRaceResult(s, { finishPosition: 2 }) // raceIndex 1 -> 2 (2nd place passes, no eviction check at 2)
  check('no eviction yet at raceIndex 2', s.eliminationEvents.length === 0)
  reportRaceResult(s, { finishPosition: 2 }) // raceIndex 2 -> 3: first eviction tick
  check('first eviction (raceIndex 3) targets the lowest active character index', s.eliminationEvents.length === 1 && s.eliminationEvents[0].victim === lowestOpponent)
  check('the victim is marked eliminated, not just untaken', s.roster[lowestOpponent].eliminated === true)
  const secondVictimCandidate = s.eliminationEvents[0].victim
  reportRaceResult(s, { finishPosition: 2 }) // 4
  reportRaceResult(s, { finishPosition: 2 }) // 5
  reportRaceResult(s, { finishPosition: 2 }) // 6: second eviction tick, round-robin
  check('second eviction (raceIndex 6) round-robins, not re-picking the same victim', s.eliminationEvents.length === 2 && s.eliminationEvents[1].victim !== secondVictimCandidate)
}

// 8. shouldShowBoard/effectiveRaceIndex smoke-check from within a real tournament (not synthetic
// state pokes, unlike check-board.mjs's own unit tests): the board DOES show before race 1 (the
// first race after the qualifier), matching its own real gate (Challenge, not the qualifier, not
// the very last race).
{
  const s = initTournament()
  pickPlayerCharacter(s, 0)
  reportRaceResult(s, { finishPosition: 1 })
  pickFirstUntakenOpponents(s)
  check('the board shows before race 1 (effectiveRaceIndex is 1, not the qualifier or the last race)', effectiveRaceIndex(s) === 1 && shouldShowBoard(s))
}

console.log(bad ? `${bad} check(s) failed` : 'check-tournament: qualifier pass/fail, the real opponent picker, Challenge/two-car race rules, streak/bonus-race schedule, and eviction cadence all match docs/engine.md §7/§9az')
process.exitCode = bad ? 1 : 0
