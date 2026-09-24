// The one-player tournament state machine (`RunTournamentLoop 1000:10a0`, `SetupTournamentRace
// 1000:115c`, docs/engine.md §7, PLAN-ENGINE.md M3.9). Pure logic, no rendering -- this is the
// part of the front end with real rules and the part this milestone's own acceptance test
// ("a full Challenge tournament is playable to the champion screen") can actually verify
// headlessly, the direct analogue of what `checkpoints.js`/`cheats.js` are to their own milestones.
//
// Source discipline: every rule below is transcribed from docs/engine.md §7, an EARLIER session's
// live disassembly pass (`[STATIC]`) -- this module does not re-disassemble `RunTournamentLoop`
// itself. One genuine gap in that prose is filled by inference, not evidence, and is called out
// at its point of use below (search "INFERRED"): what closes the loop when lives reach 0 (the
// prose never states it, only that a life is lost and the SAME race re-runs). It is implemented the
// way the surrounding rules read most naturally and is exercised by name in
// `tools/check-tournament.mjs`, so a future live check has a single, named claim to confirm or
// refute -- not a silent assumption.
//
// The OTHER gap this file used to carry ("whether the win streak resets to 3 after a bonus race
// resolves") is now settled, not inferred (docs/engine.md §9t, 2026-09-22): live disassembly of
// `ShowNextRaceIntroScreenTune4or5` (1000:1220) shows `[3fa]=3` written at the bonus race's own
// INTRO screen, gated on `[28bf]==9` -- i.e. before the bonus race runs, not after it resolves as
// this file previously guessed. Checked against this module's own `reportRaceResult` (below) and
// confirmed the timing difference is NOT observable here: nothing reads `state.streak` while
// `pendingBonusRace` is set, so resetting at resolution time (this file) or at intro time (the real
// game) produce the identical state by the time anything downstream looks at `streak` again. Kept
// as resolution-time for simplicity -- this is a confirmed-equivalent finding, not a bug, and the
// next session should not re-chase it.
//
// Deliberately not modelled: two-HUMAN head-to-head (`RunHeadToHeadTournament 1faf`) -- its track
// selection is `DS:0002 & 7`, the vsync tick counter, so it is not input-deterministic and this
// port's tape/replay model has nothing to drive it with; the interactive "pick your 3 opponents"
// (`FUN_1a4a`) and "pick your replacement" (after an elimination) screens -- both auto-pick the
// first untaken roster slot(s) instead, flagged at their call site; the tournament board screen.

import { ORDER_TABLE, ORDER_TABLE_LAST_INDEX, MAX_BONUS_RACES, CHARACTER_NAMES, trackName } from '../data/frontend-tables.js'

export const OUTCOME = {
  QUALIFIER_FAILED: 0,
  PASSED: 1,
  ONE_LIFE_LOST: 2,
  EXTRA_LIFE: 3,
  NO_BONUS: 4,
  QUALIFIED_FOR_HEAD_TO_HEAD: 5,
}

/** `format: 'challenge'` (4-car, the default) or `'twocar'` (2-car races throughout, NOT the
 * two-human H2H mode -- see the file header). */
export function initTournament({ format = 'challenge' } = {}) {
  return {
    format,
    raceIndex: 0, // index into ORDER_TABLE; 0 = the qualifier (docs/engine.md §7: "Qualifier = entry 0")
    lives: 3, // DS:0406 -- only the player's own counter is modelled (docs: "only [406] is used")
    streak: 3, // [3fa], counts down from 3 to trigger a bonus race
    bonusRacesTaken: 0, // [342], capped at MAX_BONUS_RACES
    pendingBonusRace: null, // {round: 9, race} once a streak-out triggers one, cleared on report
    roster: CHARACTER_NAMES.map((name, i) => ({ index: i, name, taken: false, eliminated: false })),
    playerCharacter: null,
    opponents: [], // 3 character indices, picked once the qualifier passes
    over: false,
    champion: false,
    lastOutcome: null,
    eliminationEvents: [],
    _evictionRoundRobinNext: 0, // next roster slot to consider once the counter's first (==3) eviction has run
  }
}

export function pickPlayerCharacter(state, charIndex) {
  state.playerCharacter = charIndex
  state.roster[charIndex].taken = true
  // Head-to-Head vs CPU: the player picks the CPU opponent on a second select screen instead
  // (`pickOpponentCharacter`, 0FBF's second 09E0 call, docs/engine.md §9an).
  if (state.format === 'twocar') return
  // The qualifier itself is a 4-car race, so *some* 3 opponents must exist before it can even be
  // run -- the real game's `FUN_1a4a` picker only runs after a Challenge PASS (docs/engine.md
  // §7), which would leave this port's qualifier racing against nameless opponents (a real bug an
  // advisor review caught: the results screen showed "UNDEFINED" for cars 1-3 on a qualifier
  // failure, since `state.opponents` was empty until a pass). Simplified here: opponents are
  // auto-picked once, at character-select time, and reused as-is for the qualifier and every race
  // after -- not re-picked on a pass, unlike the real game's per-Challenge-entry picker.
  pickOpponents(state)
}

/**
 * Head-to-Head vs CPU's second select screen, "WHO DO YOU WANT TO RACE ?" (0FBF -> 09E0 with slot
 * 0C1E; the pick lands in [266A], which InitRaceCarsFromTables reads for car 1's KidModifier
 * handicap). Fire on an already-taken character is ignored (0AB5-0ABB) -- returns false then.
 */
export function pickOpponentCharacter(state, charIndex) {
  const slot = state.roster[charIndex]
  if (!slot || slot.taken) return false
  slot.taken = true
  state.opponents = [charIndex]
  return true
}

/** Whether the next race gets its intro screen: every race except the Head-to-Head qualifier, whose
 * intro routine (11F8) starts tune 4 and returns without drawing anything (126D-127B). */
export function hasRaceIntro(state) {
  return !(state.format === 'twocar' && state.raceIndex === 0 && !state.pendingBonusRace)
}

/**
 * The screen after a race (`13E4` results / `1C1B` outcome message, docs/engine.md §9an):
 * - the qualifier, in either format, never shows the results table -- straight to the outcome
 *   message (qualified / failed to qualify, `10E4`/`10EC`);
 * - a Head-to-Head race never shows the results table either: a win shows nothing at all (on to
 *   the next race's intro, or the champion screen, `13FB -> 140C`), a loss shows "ONE LIFE LOST";
 * - a bonus race goes straight to its outcome message;
 * - every other Challenge race shows the results table.
 * Returns 'RESULTS', 'OUTCOME' or 'NONE'. Call after `reportRaceResult`.
 */
export function screenAfterRace(state, { wasQualifier = false, wasBonus = false } = {}) {
  if (wasBonus || wasQualifier) return 'OUTCOME'
  if (state.format === 'twocar') return state.lastOutcome === null ? 'NONE' : 'OUTCOME'
  return 'RESULTS'
}

/** The race (or bonus race) the player must run next, as `{round, race}` plus its display name. */
export function currentRace(state) {
  const r = state.pendingBonusRace ?? ORDER_TABLE[state.raceIndex]
  return { ...r, name: trackName(r.round, r.race) || null }
}

/**
 * The effective `[28C1]` at the moment `SetupTournamentRace 1000:115c`/`DrawTournamentBoard
 * 1000:18d8` actually run for the race about to be set up -- NOT always `state.raceIndex` itself.
 * For a regular race this IS `state.raceIndex`: DOS's own `[28C1]` was already incremented by the
 * PRIOR race's own `RunTournamentLoop 1000:10a0` loop tail (`1000:10f9`) before `115c` runs again.
 * For a PENDING bonus race it is `state.raceIndex - 1`: `TriggerBonusRace 1000:1a82` calls `115c`
 * (`1000:1a87`) BEFORE `10a0`'s own `INC [28C1]` (`1000:10f9`) -- `1a82` is called FROM inside the
 * SAME loop iteration that is about to fall through to that `INC`, so at the exact moment `115c`/
 * `18d8` run for a bonus race, `[28C1]` still holds the JUST-WON race's own index, one less than
 * this port's own `state.raceIndex` (which `reportRaceResult`'s `advance()` call already
 * incremented unconditionally, in the SAME synchronous call that set `pendingBonusRace` -- matching
 * DOS's own EVENTUAL net effect once the triggering race and its bonus race both resolve, but not
 * DOS's own INTERMEDIATE value while the bonus race is still pending). Both `shouldShowBoard` and
 * the icon count `screens.js`'s `drawTournamentBoard` draws must use this SAME effective value.
 */
export function boardRaceIndex(state) {
  return state.pendingBonusRace ? state.raceIndex - 1 : state.raceIndex
}

/**
 * Whether the tournament board screen shows before the NEXT race (`SetupTournamentRace 1000:115c`,
 * docs/engine.md §9ay): Challenge format only (`[3f8]==1`, two-car/H2H, skips the `CALL 18d8`
 * entirely), never before the qualifier (`boardRaceIndex===0`, `18d8`'s own internal early RET),
 * never before the very last race (`boardRaceIndex===ORDER_TABLE_LAST_INDEX`, the champion
 * decider) -- all three checked against `boardRaceIndex`, not `state.raceIndex` directly (see its
 * own header for the pending-bonus-race distinction).
 */
export function shouldShowBoard(state) {
  const i = boardRaceIndex(state)
  return state.format !== 'twocar' && i !== 0 && i !== ORDER_TABLE_LAST_INDEX
}

function firstUntaken(state, n) {
  const picks = []
  for (const slot of state.roster) {
    if (picks.length >= n) break
    if (!slot.taken && !slot.eliminated) { slot.taken = true; picks.push(slot.index) }
  }
  return picks
}

/** `FUN_1a4a`, simplified (file header): auto-picks the first `n` untaken roster slots rather
 * than letting the player choose. */
function pickOpponents(state) {
  state.opponents = firstUntaken(state, 3)
}

/**
 * `[310] % 3 == 0` after an advancing result (docs/engine.md §7). The counter here is the
 * post-increment `raceIndex` (this port does not distinguish `[310]` from `[28C1]` -- the prose
 * has them incrementing together on every main-loop race with no daylight between them, so one
 * counter serves both roles; see the file header for what that choice means for a future live
 * check). At counter value 3 the victim is the active drone with the lowest character index; every
 * later multiple of 3 round-robins to the next roster slot instead. No-op if no untaken,
 * non-eliminated roster slot remains to replace the victim with.
 */
function checkElimination(state, activeDroneIndices) {
  if (state.raceIndex === 0 || state.raceIndex % 3 !== 0) return
  const free = state.roster.find((s) => !s.taken && !s.eliminated)
  if (!free) return
  let victimIndex
  if (state.raceIndex === 3) {
    victimIndex = activeDroneIndices.reduce((a, b) => (a < b ? a : b))
  } else {
    const order = state.roster.map((s) => s.index).filter((i) => activeDroneIndices.includes(i))
    victimIndex = order[state._evictionRoundRobinNext % order.length]
    state._evictionRoundRobinNext++
  }
  const victim = state.roster[victimIndex]
  victim.eliminated = true
  victim.taken = false
  free.taken = true
  state.opponents = state.opponents.map((i) => (i === victimIndex ? free.index : i))
  state.eliminationEvents.push({ atRaceIndex: state.raceIndex, victim: victimIndex, replacement: free.index })
}

function advance(state) {
  state.raceIndex++
  if (state.raceIndex > ORDER_TABLE_LAST_INDEX) {
    state.champion = true
    state.over = true
  }
}

function maybeTriggerBonusRace(state) {
  state.streak--
  if (state.streak > 0) return false
  if (state.raceIndex >= ORDER_TABLE_LAST_INDEX) return false // "not the last race"
  if (state.bonusRacesTaken >= MAX_BONUS_RACES) return false
  state.pendingBonusRace = { round: 9, race: state.bonusRacesTaken + 1 }
  return true
}

/**
 * Report the result of the race `currentRace()` just named. `finishPosition` is the player's
 * 1..4 finishing place for a Challenge race, 1..2 for a two-car race, or (only when
 * `pendingBonusRace` is set) ignored in favour of the explicit `won` flag `[291D]`'s reading
 * feeds in the real game (docs/engine.md §7: "outcome 3 EXTRA LIFE if `[291D]==1` else 4").
 * `activeDroneIndices` (the 3 opponents' character indices) is only consulted on an eviction tick.
 */
export function reportRaceResult(state, { finishPosition, won } = {}) {
  if (state.over) return
  if (state.pendingBonusRace) {
    state.lastOutcome = won ? OUTCOME.EXTRA_LIFE : OUTCOME.NO_BONUS
    state.bonusRacesTaken = Math.min(state.bonusRacesTaken + 1, MAX_BONUS_RACES)
    state.streak = 3 // confirmed-equivalent timing, not the real game's own moment -- see the file header (docs/engine.md §9t)
    state.pendingBonusRace = null
    return
  }

  if (state.raceIndex === 0) {
    const passed = state.format === 'twocar' ? finishPosition === 1 : finishPosition <= 2
    if (!passed) { state.lastOutcome = OUTCOME.QUALIFIER_FAILED; state.over = true; return }
    state.lastOutcome = state.format === 'twocar' ? OUTCOME.QUALIFIED_FOR_HEAD_TO_HEAD : OUTCOME.PASSED
    advance(state)
    return
  }

  if (state.format === 'twocar') {
    // A win shows no screen at all (13FB -> 140C, lastOutcome null); a loss is "ONE LIFE LOST" and
    // the SAME race again, and no lives left ends the run (1403-140A STC -> 1110) -- docs/engine.md §9an.
    if (finishPosition === 1) { state.lastOutcome = null; advance(state) }
    else { state.lastOutcome = OUTCOME.ONE_LIFE_LOST; state.lives--; if (state.lives <= 0) state.over = true }
    return
  }

  if (finishPosition >= 3) {
    state.lastOutcome = OUTCOME.ONE_LIFE_LOST
    state.lives--
    state.streak = 3 // docs/engine.md §7: "[3fa]=3" on a 3rd/4th result, explicit
    if (state.lives <= 0) state.over = true // INFERRED floor, file header
    return
  }

  state.lastOutcome = OUTCOME.PASSED
  let bonusTriggered = false
  if (finishPosition === 1) bonusTriggered = maybeTriggerBonusRace(state)
  advance(state)
  if (!bonusTriggered && !state.over) checkElimination(state, state.opponents)
}
