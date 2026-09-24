// M3.9 acceptance test (PLAN-ENGINE.md): the tournament state machine, headless, driven by
// synthetic race results -- no DOSBox needed, the direct analogue of what check-rounds.mjs did
// for M3.8. Exercises every named rule in docs/engine.md §7. Also covers P3's second item
// (docs/engine.md §9az, the qualifier's own fixed JETHRO trio and the real interactive opponent
// picker), P3's third item (docs/engine.md §9ba, the real elimination/replacement rule), and P3's
// 5th item (docs/engine.md §9bc, both of tournament.js's own file-header rules, formerly
// INFERRED, now fully cited).
//   node tools/check-tournament.mjs
import { initTournament, pickPlayerCharacter, pickOpponentCharacter, hasRaceIntro, screenAfterRace, showsOutcomeAfterResults, currentRace, reportRaceResult, reportRaceResultWithOpponentSnapshot, shouldShowBoard, effectiveRaceIndex, opponentCharactersFor, needsOpponentPick, hasEmptyOpponentSlot, applyLivesCheat, applyLivesDelta, QUALIFIER_OPPONENTS, OUTCOME } from '../src/frontend/tournament.js'
import { ORDER_TABLE_LAST_INDEX, MAX_BONUS_RACES } from '../src/data/frontend-tables.js'

let bad = 0
function check(name, cond) {
  if (cond) return
  bad++
  console.log(`FAIL: ${name}`)
}

// Test-harness stand-ins for the real interactive pickers (`FUN_1000_1A4A`, `flow.js`'s
// `enterOpponentPick`/`leaveEliminatedScreen`): fill every currently-empty opponent slot with the
// first untaken, non-eliminated roster character, in roster order. Not a port simplification --
// the real port drives `pickOpponentCharacter` from a live carousel; this is just what a synthetic
// headless test calls instead of a human at the same prompts, for BOTH the initial 3-pick and a
// single elimination replacement (the same helper handles either, since `pickOpponentCharacter`
// itself always fills the first empty slot).
function fillEmptyOpponentSlots(state) {
  while (hasEmptyOpponentSlot(state)) {
    const free = state.roster.find((s) => !s.taken && !s.eliminated)
    pickOpponentCharacter(state, free.index)
  }
}

// Report a race result and, if it triggered an elimination (docs/engine.md §9ba), immediately show
// the SAME "fill the vacancy" step `flow.js`'s own `leaveEliminatedScreen` performs (clear
// `pendingElimination`, then run the replacement picker) -- so a test can drive a whole tournament
// race-by-race without ever leaving a `null` opponent slot for the NEXT race to trip over, exactly
// as the real flow guarantees (the game can't proceed to another race with an unfilled slot).
function passRace(state, finishPosition, extra) {
  reportRaceResult(state, { finishPosition, ...extra })
  if (state.pendingElimination) {
    state.pendingElimination = null
    fillEmptyOpponentSlots(state)
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
  check('the player pick does NOT auto-pick opponents (all 3 slots start empty)', s.opponents.every((o) => o === null))
  check('the qualifier races a fixed JETHRO x3, not a roster pick (1000:102b/10a0, no tuning effect)', opponentCharactersFor(s).join() === QUALIFIER_OPPONENTS.join())
  check('JETHRO\'s own roster slot is NOT marked taken by the qualifier\'s fixed trio', !s.roster[6].taken)
  check('the real picker is not needed yet (still at the qualifier)', !needsOpponentPick(s))
  reportRaceResult(s, { finishPosition: 2 })
  check('qualifier 2nd place passes in Challenge format', s.lastOutcome === OUTCOME.PASSED && !s.over)
  check('passing the qualifier advances raceIndex to 1', s.raceIndex === 1)
  check('the real interactive picker is needed right after the pass', needsOpponentPick(s))
  check('picking the player\'s own (taken) character as an opponent fails', pickOpponentCharacter(s, 0) === false && s.opponents.every((o) => o === null))
  check('picking a free character works, filling the FIRST empty slot', pickOpponentCharacter(s, 1) === true && s.opponents[0] === 1 && s.opponents[1] === null)
  check('one of three still needed', hasEmptyOpponentSlot(s) && !needsOpponentPick(s)) // needsOpponentPick fires ONCE, right after the pass, not "while incomplete"
  pickOpponentCharacter(s, 2)
  pickOpponentCharacter(s, 3)
  check('all 3 opponents picked, distinct, excluding the player', !hasEmptyOpponentSlot(s) && new Set(s.opponents).size === 3 && !s.opponents.includes(0))
  check('race 1 onward now uses the real picked opponents, not the qualifier\'s fixed trio', opponentCharactersFor(s).join() === s.opponents.join())
}

// 1b. A qualifier FAILURE never runs the picker at all -- the real `1A4A` is only ever called on
// the PASS branch (`10EF`/`10F6`); `state.opponents` stays empty for the rest of the (over) run.
{
  const s = initTournament()
  pickPlayerCharacter(s, 0)
  reportRaceResult(s, { finishPosition: 4 })
  check('qualifier failure: opponents were never picked (the picker never runs)', s.opponents.every((o) => o === null))
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

// 3. Two-car format: only 1st passes the qualifier (2nd does not, unlike Challenge format).
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
  fillEmptyOpponentSlots(c)
  check('Challenge: the picker fills all 3 opponent slots', !hasEmptyOpponentSlot(c))
  reportRaceResult(c, { finishPosition: 1 })
  check('Challenge: a regular race shows the results table', screenAfterRace(c, {}) === 'RESULTS')
}

// 4. Challenge: 3rd/4th loses a life, re-runs the SAME race, and resets the streak to 3 (docs:
// "[3fa]=3" on a 3rd/4th result -- explicit, not inferred).
{
  const s = initTournament()
  pickPlayerCharacter(s, 0)
  reportRaceResult(s, { finishPosition: 1 }) // pass the qualifier
  fillEmptyOpponentSlots(s) // the real picker, right after the pass
  const idx = s.raceIndex
  passRace(s, 1) // race 1: burn the streak down to 2
  s.streak = 1 // force the next loss to matter for the streak-reset assertion below
  passRace(s, 4) // race 2: 3rd/4th place
  check('3rd/4th loses a life', s.lives === 2 && s.lastOutcome === OUTCOME.ONE_LIFE_LOST)
  check('3rd/4th re-runs the same race (raceIndex unchanged)', s.raceIndex === idx + 1) // idx+1 from the earlier 1st-place pass; this loss re-runs THAT same index
  check('3rd/4th resets the streak to 3 (docs: "[3fa]=3", explicit)', s.streak === 3)
}

// 5. Lives reaching 0 ends the tournament -- fully re-disassembled and cited, no longer an
// inference (docs/engine.md §9bc): `1000:166D: CMP byte [0x406],0 / JZ` (Challenge), `1000:1403`
// (two-car, the same shared function) both test the lives byte for EXACT zero right after the
// outcome-message call returns.
{
  const s = initTournament()
  pickPlayerCharacter(s, 0)
  reportRaceResult(s, { finishPosition: 1 })
  fillEmptyOpponentSlots(s)
  for (let i = 0; i < 3 && !s.over; i++) passRace(s, 4)
  check('3 straight last-places (starting from 3 lives) exhausts lives and ends the tournament (1000:166D)', s.lives === 0 && s.over === true && !s.champion)
}

// 6. A full 1st-place run reaches the champion screen; bonus races fire on schedule and never
// exceed MAX_BONUS_RACES; the tournament index lands exactly one past the last order-table entry;
// and EXACTLY 7 characters ever get eliminated over a full run: 11 roster slots - 1 player - 3
// initial opponents = 7 free characters, one consumed per eviction check (docs/engine.md §9ba's own
// arithmetic) -- eviction checks land at completedRaceIndex 3,6,9,12,15,18,21,24 (8 checks; 24 is
// the last multiple of 3 not exceeding ORDER_TABLE_LAST_INDEX=25), so the 8th (completedRaceIndex
// 24) is always the no-op once those 7 are used up.
{
  const s = initTournament()
  pickPlayerCharacter(s, 0)
  let iterations = 0
  while (!s.over && iterations < 200) {
    passRace(s, 1, { won: true })
    if (needsOpponentPick(s)) fillEmptyOpponentSlots(s) // right after the qualifier passes, once
    iterations++
  }
  check('a perfect run reaches the champion screen', s.champion === true && s.over === true)
  check('raceIndex lands one past the last order-table entry', s.raceIndex === ORDER_TABLE_LAST_INDEX + 1)
  check('bonus races never exceed MAX_BONUS_RACES', s.bonusRacesTaken <= MAX_BONUS_RACES)
  check('at least one bonus race fired on a perfect run (streak hits 0 well before the end)', s.bonusRacesTaken >= 1)
  const evictionIndices = s.eliminationEvents.map((e) => e.atRaceIndex)
  // A count-only assertion can't tell a correct single-pass run apart from a run that double-fires
  // at one checkpoint (e.g. via a bonus race reaching the gate a second time) and then runs dry one
  // checkpoint early -- both would still total 7 once the 7-character cap is hit. Assert the exact
  // sequence of checkpoints, not just how many fired.
  check('eviction checkpoints are exactly [3,6,9,12,15,18,21] -- one per checkpoint, no double-fire, the 8th (24) a no-op', evictionIndices.join() === [3, 6, 9, 12, 15, 18, 21].join())
  check('exactly 7 eliminations over a full run (11 - 1 player - 3 opponents = 7 free characters)', s.eliminationEvents.length === 7)
}

// 7. Eviction cadence, re-derived this session against the real disassembly (docs/engine.md §9ba):
// the gate is completedRaceIndex%3==0, captured BEFORE advance() runs (the first eviction check
// that can fire is after COMPLETING race 3 -- the qualifier is race 0, so races 1 and 2 pass with
// no eviction first).
{
  const s = initTournament()
  pickPlayerCharacter(s, 0)
  reportRaceResult(s, { finishPosition: 1 }) // pass qualifier -> raceIndex 1
  fillEmptyOpponentSlots(s) // opponents picked (indices 1, 2, 3 -- the first 3 untaken after player=0)
  const lowestOpponent = Math.min(...s.opponents)
  passRace(s, 2) // race 1 (completedRaceIndex=1): raceIndex 1 -> 2, not a multiple of 3
  check('no eviction after completing race 1', s.eliminationEvents.length === 0)
  passRace(s, 2) // race 2 (completedRaceIndex=2): raceIndex 2 -> 3, not a multiple of 3
  check('no eviction after completing race 2 either', s.eliminationEvents.length === 0)
  passRace(s, 2) // race 3 (completedRaceIndex=3): FIRST eviction fires here
  check('first eviction fires after COMPLETING race 3 (completedRaceIndex===3, not raceIndex===3 post-advance)', s.eliminationEvents.length === 1 && s.eliminationEvents[0].atRaceIndex === 3)
  check('the victim is eliminated, but stays taken (1000:1707 is an OR -- 0x40 is never cleared)', s.roster[lowestOpponent].eliminated === true && s.roster[lowestOpponent].taken === true)
  check('a replacement was picked, filling the vacated slot', !hasEmptyOpponentSlot(s) && !s.opponents.includes(lowestOpponent))
}

// 7a. The victim rule, decisively distinguished from "always evict the lowest current index" and
// from a roster-index round robin (docs/engine.md §9ba, GOAL-DOS-PARITY.md's own "not a
// derivation" flag). Test 7 above can't tell the 3-slot cursor apart from "always evict the lowest
// index": `fillEmptyOpponentSlots` always replaces with the next-HIGHER free character (ascending
// roster order), so the lowest-index slot never moves, and the two rules predict the same victim at
// every checkpoint. Here every replacement is picked explicitly and OUT of ascending order, so the
// rules diverge from the second eviction on -- caught by an advisor review of the committed tests,
// which pointed out this exact gap.
{
  const s = initTournament()
  pickPlayerCharacter(s, 10) // keeps low roster indices 0-9 free for opponents/replacements
  reportRaceResult(s, { finishPosition: 2 }) // qualifier pass, 2nd place -- never 1st below, so no bonus race ever interrupts the schedule
  pickOpponentCharacter(s, 3) // slot 0
  pickOpponentCharacter(s, 2) // slot 1
  pickOpponentCharacter(s, 1) // slot 2 -- opponents = [3, 2, 1], deliberately NOT ascending
  check('opponents start [3, 2, 1] (slot order != value order)', s.opponents.join() === '3,2,1')

  reportRaceResult(s, { finishPosition: 2 }) // race 1
  reportRaceResult(s, { finishPosition: 2 }) // race 2
  reportRaceResult(s, { finishPosition: 2 }) // race 3 (completedRaceIndex=3): first eviction
  check('race 3 evicts the lowest-index CURRENT opponent (1, slot 2) -- the FIRST-eviction rule, identical under both hypotheses so far', s.pendingElimination?.victim === 1 && s.pendingElimination?.slot === 2)
  s.pendingElimination = null
  pickOpponentCharacter(s, 0) // explicit replacement for slot 2 -- opponents = [3, 2, 0]
  check('opponents now [3, 2, 0] (the new low-index replacement sits in the SAME slot, 2)', s.opponents.join() === '3,2,0')

  reportRaceResult(s, { finishPosition: 2 }) // race 4
  reportRaceResult(s, { finishPosition: 2 }) // race 5
  reportRaceResult(s, { finishPosition: 2 }) // race 6 (completedRaceIndex=6): second eviction -- the discriminating checkpoint
  // "Always evict the lowest current index" would pick 0 (slot 2, the just-placed replacement).
  // The real 3-slot cursor instead just advances 2->0 and evicts whatever sits in slot 0: 3.
  check('race 6 evicts by ADVANCING THE CURSOR to slot 0 (victim 3), NOT by re-picking the lowest index (which would be 0)', s.pendingElimination?.victim === 3 && s.pendingElimination?.slot === 0)
  s.pendingElimination = null
  pickOpponentCharacter(s, 4) // explicit replacement for slot 0 -- opponents = [4, 2, 0]

  reportRaceResult(s, { finishPosition: 2 }) // race 7
  reportRaceResult(s, { finishPosition: 2 }) // race 8
  reportRaceResult(s, { finishPosition: 2 }) // race 9 (completedRaceIndex=9): third eviction
  // Cursor advances 0->1, evicting slot 1's own long-untouched value (2) -- unaffected by either
  // earlier replacement; not the lowest current index (0) either, so a roster-index computation of
  // any kind could not reproduce this without modelling the slot cursor directly.
  check('race 9 evicts slot 1 (victim 2), untouched by either earlier replacement', s.pendingElimination?.victim === 2 && s.pendingElimination?.slot === 1)
  s.pendingElimination = null
  pickOpponentCharacter(s, 5) // explicit replacement for slot 1 -- opponents = [4, 5, 0]

  reportRaceResult(s, { finishPosition: 2 }) // race 10
  reportRaceResult(s, { finishPosition: 2 }) // race 11
  reportRaceResult(s, { finishPosition: 2 }) // race 12 (completedRaceIndex=12): fourth eviction
  // Cursor advances 1->2, back to the slot the race-3 replacement (0) has sat in, untouched, since
  // race 3 -- it gets RE-EVICTED, the one behaviour neither "lowest index" nor a plain round robin
  // over characters (not slots) can produce: a replacement re-evicted before every other opponent
  // has had a first turn.
  check('race 12 RE-EVICTS the earlier replacement (0, slot 2) once the cursor cycles back to its own slot', s.pendingElimination?.victim === 0 && s.pendingElimination?.slot === 2)
  s.pendingElimination = null
}

// 7b. A bonus-triggering race still evicts (docs/engine.md §9ba): the real `13E4` elimination check
// runs BEFORE `RunTournamentLoop`'s own bonus-trigger check (`1123-113A`) -- the old port's own
// `!bonusTriggered` gate here was wrong, and this is the one test that would have caught it: with
// the default streak=3, the streak hits 0 (triggering a bonus) on the SAME 3rd race that also
// happens to land on completedRaceIndex=3, the very first eviction check.
{
  const s = initTournament()
  pickPlayerCharacter(s, 0)
  reportRaceResult(s, { finishPosition: 1 }) // qualifier pass
  fillEmptyOpponentSlots(s)
  reportRaceResult(s, { finishPosition: 1 }) // race 1 (completedRaceIndex=1): streak 3->2
  reportRaceResult(s, { finishPosition: 1 }) // race 2 (completedRaceIndex=2): streak 2->1
  check('not yet pending a bonus race', s.pendingBonusRace === null)
  reportRaceResult(s, { finishPosition: 1 }) // race 3 (completedRaceIndex=3): streak 1->0 -> bonus AND eviction both trigger here
  check('the streak-out DID trigger a pending bonus race', s.pendingBonusRace !== null)
  check('the SAME race still evicted (the old !bonusTriggered gate would have skipped this)', s.eliminationEvents.length === 1 && s.eliminationEvents[0].atRaceIndex === 3)
}

// 7c. Regression test for the RESULTS-table snapshot-timing bug an advisor review caught in
// flow.js's own advanceRace (docs/engine.md §9ba, bug 3): a live reference to `state.opponents`
// read AFTER `reportRaceResult` can show `null` for the very opponent who was just raced against,
// on an evicting race, because `checkElimination` nulls that slot IN PLACE. `advanceRace` itself has
// no headless test (it is DOM/frame-bound), so this calls `reportRaceResultWithOpponentSnapshot`
// directly -- the EXACT export `advanceRace` now calls, not a hand-rolled equivalent -- so a
// regression in that function's own internal ordering (its snapshot line moved after its
// `reportRaceResult` call) fails HERE, not only by inspection.
{
  const s = initTournament()
  pickPlayerCharacter(s, 0)
  reportRaceResult(s, { finishPosition: 1 }) // qualifier pass
  fillEmptyOpponentSlots(s)
  passRace(s, 2) // race 1 (completedRaceIndex=1): no eviction
  passRace(s, 2) // race 2 (completedRaceIndex=2): no eviction
  const beforeLive = [...opponentCharactersFor(s)] // what a caller would see right before reporting
  const snapshot = reportRaceResultWithOpponentSnapshot(s, { finishPosition: 1 }) // race 3 (completedRaceIndex=3): evicts one of these
  check('reportRaceResultWithOpponentSnapshot returns every opponent named just before the call (none null)', snapshot.join() === beforeLive.join() && snapshot.every((v) => v !== null))
  check('the live array read AFTER that same call shows the evicted slot nulled -- the returned snapshot, not a live read, is what advanceRace must use', opponentCharactersFor(s).includes(null) && snapshot.join() !== opponentCharactersFor(s).join())
  if (s.pendingElimination) { s.pendingElimination = null; fillEmptyOpponentSlots(s) } // leave state consistent for anything appended after this block
}

// 8. shouldShowBoard/effectiveRaceIndex smoke-check from within a real tournament (not synthetic
// state pokes, unlike check-board.mjs's own unit tests): the board DOES show before race 1 (the
// first race after the qualifier), matching its own real gate (Challenge, not the qualifier, not
// the very last race).
{
  const s = initTournament()
  pickPlayerCharacter(s, 0)
  reportRaceResult(s, { finishPosition: 1 })
  fillEmptyOpponentSlots(s)
  check('the board shows before race 1 (effectiveRaceIndex is 1, not the qualifier or the last race)', effectiveRaceIndex(s) === 1 && shouldShowBoard(s))
}

// 9. The final race's 2nd place is a FAIL, every other race's isn't (1000:15B7/1658, fully
// re-disassembled, GOAL-DOS-PARITY.md P3's 4th item, docs/engine.md §9bb): only 1st place passes
// the tournament's very last race (`raceIndex === ORDER_TABLE_LAST_INDEX`); every other race
// accepts 1st OR 2nd, as before. Two freshly-built states (not clones) isolate the 1st-vs-2nd
// comparison at the last race from each other.
function freshAtLastRace() {
  const s = initTournament()
  pickPlayerCharacter(s, 0)
  reportRaceResult(s, { finishPosition: 1 }) // qualifier pass
  fillEmptyOpponentSlots(s)
  s.raceIndex = ORDER_TABLE_LAST_INDEX // synthetic fast-forward, isolating this one rule
  return s
}
{
  const s = initTournament()
  pickPlayerCharacter(s, 0)
  reportRaceResult(s, { finishPosition: 1 }) // qualifier pass
  fillEmptyOpponentSlots(s)
  const idx = s.raceIndex
  passRace(s, 2)
  check('a regular (non-last) race: 2nd place still passes', s.raceIndex === idx + 1 && s.lastOutcome === OUTCOME.PASSED)
}
{
  const s = freshAtLastRace()
  reportRaceResult(s, { finishPosition: 2 })
  check('the LAST race: 2nd place FAILS (ONE_LIFE_LOST, not PASSED)', s.lastOutcome === OUTCOME.ONE_LIFE_LOST && s.lives === 2)
}
{
  const s = freshAtLastRace()
  reportRaceResult(s, { finishPosition: 1 })
  check('the LAST race: 1st place still PASSES', s.lastOutcome === OUTCOME.PASSED)
}

// 10. The bonus-race TRIGGER has no cap (1000:1123-113A, fully re-disassembled, GOAL-DOS-PARITY.md
// P3's 4th item, docs/engine.md §9bb): it keeps firing every time the streak reaches 0 (as long as
// it isn't the last race), well past MAX_BONUS_RACES triggers -- only the COUNTER (`[0x342]`, the
// selected bonus TRACK number) is capped, at `1A9F`, inside `TriggerBonusRace` itself, not the
// trigger condition. `pendingBonusRace.race` must clamp at MAX_BONUS_RACES+1 (repeating the last
// real bonus track) once the counter caps, not stop triggering altogether.
{
  const s = initTournament()
  pickPlayerCharacter(s, 0)
  reportRaceResult(s, { finishPosition: 1 }) // qualifier pass
  fillEmptyOpponentSlots(s)
  const bonusRaces = []
  let iterations = 0
  while (bonusRaces.length < MAX_BONUS_RACES + 2 && iterations < 200) {
    if (s.pendingBonusRace) { bonusRaces.push(s.pendingBonusRace.race); reportRaceResult(s, { won: true }) }
    else passRace(s, 1, { won: true })
    iterations++
  }
  check(`the trigger fires at least ${MAX_BONUS_RACES + 2} times (well past MAX_BONUS_RACES=${MAX_BONUS_RACES}), never gated by the counter`, bonusRaces.length === MAX_BONUS_RACES + 2)
  check('the bonus track number clamps at MAX_BONUS_RACES+1 once the counter caps, repeating the last real track rather than growing unboundedly', bonusRaces.slice(MAX_BONUS_RACES).every((r) => r === MAX_BONUS_RACES + 1))
  check('the FIRST bonus race is track 1, the second track 2 (the counter sequence before it caps)', bonusRaces[0] === 1 && bonusRaces[1] === 2)
}

// 11. The `]` debug key (1000:1DCD, fully re-disassembled, GOAL-DOS-PARITY.md P3's 4th item,
// docs/engine.md §9bb): `applyLivesCheat` zeroes lives always, but only ENDS the tournament
// immediately for ONE_LIFE_LOST -- EXTRA_LIFE's own real caller (TriggerBonusRace) has no
// post-call life check, so the zeroed value there is silent until some later loss.
{
  const s = initTournament()
  pickPlayerCharacter(s, 0)
  reportRaceResult(s, { finishPosition: 1 })
  fillEmptyOpponentSlots(s)
  s.lastOutcome = OUTCOME.ONE_LIFE_LOST
  applyLivesCheat(s)
  check('] on ONE_LIFE_LOST: lives zeroed AND the tournament ends immediately', s.lives === 0 && s.over === true)
}
{
  const s = initTournament()
  pickPlayerCharacter(s, 0)
  reportRaceResult(s, { finishPosition: 1 })
  fillEmptyOpponentSlots(s)
  s.lastOutcome = OUTCOME.EXTRA_LIFE
  applyLivesCheat(s)
  check('] on EXTRA_LIFE: lives zeroed but the tournament does NOT end immediately (no caller-side check in the real bytes)', s.lives === 0 && s.over === false)
}
// applyLivesCheat's own reachability guard (moved into the function itself so it's actually
// tested, an advisor review caught this gap): a no-op for every outcome OTHER than 2/3.
{
  for (const code of [OUTCOME.QUALIFIER_FAILED, OUTCOME.PASSED, OUTCOME.NO_BONUS, OUTCOME.QUALIFIED_FOR_HEAD_TO_HEAD]) {
    const s = initTournament()
    s.lives = 3
    s.lastOutcome = code
    applyLivesCheat(s)
    check(`] on outcome code ${code}: no-op (lives untouched, tournament not ended)`, s.lives === 3 && s.over === false)
  }
}

// 12. The RESULTS -> OUTCOME transition is conditional, not automatic (an advisor review caught a
// real bug here: `flow.js`'s own `confirm()` used to show an OUTCOME screen after EVERY Challenge
// race, including a pass -- docs/engine.md §9bb item 3). `showsOutcomeAfterResults` is the pure
// predicate that transition now checks.
{
  const s = initTournament()
  pickPlayerCharacter(s, 0)
  reportRaceResult(s, { finishPosition: 1 })
  fillEmptyOpponentSlots(s)
  passRace(s, 2) // a PASS
  check('a passed Challenge race does NOT show an OUTCOME screen after RESULTS', !showsOutcomeAfterResults(s))
  s.lastOutcome = OUTCOME.ONE_LIFE_LOST
  check('a failed Challenge race DOES show an OUTCOME screen after RESULTS', showsOutcomeAfterResults(s))
}

// 13. The bonus-race WIN effects are gated on `won`, not unconditional (an advisor review caught
// two real gaps here: the track counter used to advance even on a loss, and a won bonus race never
// actually granted a life -- docs/engine.md §9bb items 2/4, 1000:1A92-1AA5/1CFA-1D02).
{
  const s = initTournament()
  pickPlayerCharacter(s, 0)
  reportRaceResult(s, { finishPosition: 1 })
  fillEmptyOpponentSlots(s)
  passRace(s, 1, { won: true }) // race 1: streak 3->2
  passRace(s, 1, { won: true }) // race 2: streak 2->1
  passRace(s, 1, { won: true }) // race 3: streak 1->0 -> bonus race 1 triggers
  check('bonus race 1 triggered', s.pendingBonusRace?.race === 1)
  const livesBefore = s.lives
  reportRaceResult(s, { won: false }) // LOSE bonus race 1
  check('losing a bonus race grants no life', s.lives === livesBefore)
  check('losing a bonus race does NOT advance the track counter -- the SAME track is offered next time', s.bonusRacesTaken === 0)
  passRace(s, 1, { won: true }) // race 4: streak 3->2 (reset on the bonus resolution, regardless of win/loss)
  passRace(s, 1, { won: true }) // race 5: streak 2->1
  passRace(s, 1, { won: true }) // race 6: streak 1->0 -> the NEXT bonus race triggers
  check('the next bonus race re-offers track 1 (the counter never advanced after the loss)', s.pendingBonusRace?.race === 1)
  const livesBeforeWin = s.lives
  reportRaceResult(s, { won: true }) // WIN this one
  check('winning a bonus race grants exactly one extra life', s.lives === livesBeforeWin + 1)
  check('winning a bonus race DOES advance the track counter', s.bonusRacesTaken === 1)
}

// 14. Lives are a byte, not a signed number (GOAL-DOS-PARITY.md's "two INFERRED tournament rules"
// item, docs/engine.md §9bc): a decrement below 0 wraps to 255, matching `1000:166D`/`1403`'s own
// `CMP byte [0x406],0` test reading a genuinely UNSIGNED byte, not "non-positive". The `]` cheat on
// an `EXTRA_LIFE` screen (zeroing lives with no immediate check) is ONE way to reach the wrap in
// play -- NOT the only one: repeatedly pausing on one of the 5 real CHEATS.BIN type-0 spots
// (`applyLivesDelta`, test 15 below) reaches the exact same wrap through entirely ordinary
// gameplay, no debug key needed (an earlier draft of this comment claimed otherwise).
{
  const s = initTournament()
  pickPlayerCharacter(s, 0)
  reportRaceResult(s, { finishPosition: 1 }) // qualifier pass
  fillEmptyOpponentSlots(s)
  passRace(s, 1, { won: true }) // race 1: streak 3->2
  passRace(s, 1, { won: true }) // race 2: streak 2->1
  passRace(s, 1, { won: true }) // race 3: streak 1->0 -> bonus race triggers
  reportRaceResult(s, { won: true }) // WIN the bonus race
  check('the bonus race win produced EXTRA_LIFE', s.lastOutcome === OUTCOME.EXTRA_LIFE)
  applyLivesCheat(s) // ] pressed on the EXTRA_LIFE screen
  check('] zeroed lives; EXTRA_LIFE has no immediate check, so the tournament is not yet over', s.lives === 0 && s.over === false)
  reportRaceResult(s, { finishPosition: 4 }) // the NEXT loss -- this is where the real byte test runs
  check('the next loss wraps 0 to 255 (byte underflow) instead of ending the tournament, matching the real CMP byte [0x406],0 test', s.lives === 255 && s.over === false)
}

// 15. `applyLivesDelta` (1000:36A0, CHEATS.BIN spot-effect TYPE 0 "lose a life", fully
// re-disassembled, docs/engine.md §9bc): a plain byte-wrapped delta with NO over-check at all --
// `reportRaceResult` uses this (via `applyPostRaceLives`, test 16 below), not a `Math.max(0, ...)`
// signed clamp an earlier draft had, which silently discarded the wrap this export reproduces.
// Confirmed against `GAME1/CHEATS.BIN`: 5 real type-0 spots ship in the game (round 1 race 1/4,
// round 3 race 1/3, round 4 race 3), so this is reachable through entirely ordinary play (pause
// repeatedly on one of those 5 spots), not just the `]` debug key.
{
  const s = initTournament()
  s.lives = 1
  applyLivesDelta(s, -1)
  check('a single decrement to exactly 0 does not wrap (matches decrementLives\' own boundary)', s.lives === 0)
  applyLivesDelta(s, -1)
  check('one more decrement past 0 wraps to 255, with NO over-check (applyLivesDelta never touches state.over)', s.lives === 255 && s.over === false)
  applyLivesDelta(s, -3) // simulating 3 more pause-triggers accumulated in cheats.js's own globalState.lives before this is applied once
  check('a multi-step negative delta (accumulated across several pause-triggers) wraps correctly in one step', s.lives === 252)
  applyLivesDelta(s, 10)
  check('a positive delta (were one ever to exist) also wraps correctly', s.lives === 6)
}

// 16. `reportRaceResult`'s own `applyPostRaceLives(state, lifeDelta, cheatActive)` call, as its
// VERY FIRST statement (`1000:11AF-11BA`, `SetupTournamentRace`, docs/engine.md §9bc): the
// `25011968` cheat's own reset composed with the type-0 delta in the REAL order -- delta, THEN
// reset if the cheat is active, BEFORE any of this function's own branches (including the loss
// check) run. Driven through `reportRaceResult` itself (the function `flow.js` actually calls),
// not a bare `applyPostRaceLives` call, so a regression in the ORDER -- an active cheat's own
// type-0 pause decrements surviving long enough to zero `tournament.lives` and end the run for
// real, the opposite of what DOS does -- is caught here rather than only in an isolated unit test.
{
  const s = initTournament()
  pickPlayerCharacter(s, 0)
  reportRaceResult(s, { finishPosition: 1 }) // qualifier pass, no lives logic, no lifeDelta
  fillEmptyOpponentSlots(s)
  s.lives = 10
  // A single race: 9 pause-triggered type-0 decrements accumulated during the race, cheat active,
  // and a 3rd/4th finish in that SAME race -- exactly what `lifeDelta`/`cheatActive` carry through
  // from `flow.js`'s `finishRace`/`advanceRace` in one `reportRaceResult` call.
  reportRaceResult(s, { finishPosition: 4, lifeDelta: -9, cheatActive: true })
  check('the reset erases this race\'s own type-0 decrements BEFORE the loss check sees them, so the loss decrements from 10 (not the pre-reset 1) and the tournament does not end', s.lives === 9 && s.over === false)
}
{
  // The bonus-race variant, closing the SAME reset's own pre-existing "never re-arms for a bonus
  // race" gap (the old `advanceRace`-only reset skipped round 9 entirely; `reportRaceResult` is
  // shared by every race type, so this now Just Works without any bonus-specific code).
  const s = initTournament()
  s.lives = 10
  s.pendingBonusRace = { round: 9, race: 1 }
  reportRaceResult(s, { won: true, lifeDelta: -9, cheatActive: true })
  check('a bonus race under an active cheat also gets its type-0 decrements erased before the win\'s own +1 life applies', s.lives === 11)
}

console.log(bad ? `${bad} check(s) failed` : 'check-tournament: qualifier pass/fail, the real opponent picker, the real elimination/replacement rule, Challenge/two-car race rules, streak/bonus-race schedule, the last-race 2nd-place fail, the uncapped bonus trigger, the win-gated bonus-race counter/life, the conditional RESULTS->OUTCOME transition, the ] lives cheat, the byte-exact lives wraparound (both the outcome-screen and the cheat-spot paths), and the 25011968 cheat\'s own reset applied in the real order relative to the loss check, for every race type including a bonus race, all match docs/engine.md §7/§9az/§9ba/§9bb/§9bc')
process.exitCode = bad ? 1 : 0
