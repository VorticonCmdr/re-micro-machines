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
// port's tape/replay model has nothing to drive it with; the "pick your replacement" screen after
// an elimination (GOAL-DOS-PARITY.md P3's third item, not yet done -- still auto-picks the first
// untaken roster slot, flagged at `checkElimination` below). The interactive "pick your 3
// opponents" screen (`FUN_1a4a`, GOAL-DOS-PARITY.md P3's second item) IS modelled now -- see
// `needsOpponentPick`/`QUALIFIER_OPPONENTS` below, docs/engine.md §9az.

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

/** Head-to-Head vs CPU picks its own opponent on a SECOND select screen right after this
 * (`pickOpponentCharacter`, `0FBF`'s second `09E0` call, docs/engine.md §9an) -- unchanged here.
 * Challenge no longer auto-picks anything: the qualifier's own 3 opponents are the fixed
 * `QUALIFIER_OPPONENTS` (JETHRO x3, `102b`/`10a0`'s own hardcoded writes, not a real pick at all),
 * and races 1+ get whatever the real interactive picker (`needsOpponentPick`, `1A4A`) fills
 * `state.opponents` with, once, right after the qualifier passes. */
export function pickPlayerCharacter(state, charIndex) {
  state.playerCharacter = charIndex
  state.roster[charIndex].taken = true
}

/**
 * "WHO DO YOU WANT TO RACE ?" -- Head-to-Head vs CPU's second select screen (0FBF -> 09E0 with slot
 * 0C1E; the pick lands in [266A], which InitRaceCarsFromTables reads for car 1's KidModifier
 * handicap) AND the Challenge format's real interactive opponent picker (`FUN_1A4A`, the SAME
 * prompt string, `DS:0227`, and the SAME underlying carousel, `09E0`, just called once per each of
 * 3 empty slots -- `1000:0afa-0b50`'s own commit block services all 4 car slots identically). Fire
 * on an already-taken character is ignored (0AB5-0ABB, `charSelectStep`'s own IDLE case already
 * enforces this before this is ever called) -- returns false then. APPENDS to `state.opponents`
 * (not replace): H2H only ever calls this once, so the two are equivalent there, but Challenge
 * calls it 3 times, once per opponent slot.
 */
export function pickOpponentCharacter(state, charIndex) {
  const slot = state.roster[charIndex]
  if (!slot || slot.taken) return false
  slot.taken = true
  state.opponents = [...state.opponents, charIndex]
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
 * The effective `[28C1]` at the moment `SetupTournamentRace 1000:115c` actually sets up and runs
 * the race about to happen -- NOT always `state.raceIndex` itself, and NOT board-specific (despite
 * its origin in the board item, §9ay): this is DOS's own real tournament-position value for
 * whatever race is about to run, and every `[28C1]`-keyed read during that race (the board's own
 * gate/icon count, `ai.js`'s drone speed-limit adjustments, `states.js`'s `7008` respawn nudge, and
 * `spawnCars`/`tuningFieldsFor`'s own `tournamentIndex` handicap) needs the SAME value.
 *
 * For a REGULAR race this IS `state.raceIndex`: DOS's own `[28C1]` was already incremented by the
 * PRIOR race's own `RunTournamentLoop 1000:10a0` loop tail (`1000:10f9`) before `115c` runs again.
 * For a PENDING bonus race it is `state.raceIndex - 1`: `TriggerBonusRace 1000:1a82` calls `115c`
 * (`1000:1a87`, which itself runs the WHOLE bonus race via `115c`'s own `CALL 3039`) BEFORE `10a0`'s
 * own `INC [28C1]` (`1000:10f9`) -- `1a82` is called FROM inside the SAME loop iteration that is
 * about to fall through to that `INC`, so at the exact moment `115c`/`18d8`/the bonus race's own
 * physics run, `[28C1]` still holds the JUST-WON race's own index, one less than this port's own
 * `state.raceIndex` (which `reportRaceResult`'s `advance()` call already incremented
 * unconditionally, in the SAME synchronous call that set `pendingBonusRace` -- matching DOS's own
 * EVENTUAL net effect once the triggering race and its bonus race both resolve, but not DOS's own
 * INTERMEDIATE value while the bonus race is still pending). Every one of the readers named above
 * must use this SAME effective value, not `state.raceIndex` directly.
 */
export function effectiveRaceIndex(state) {
  return state.pendingBonusRace ? state.raceIndex - 1 : state.raceIndex
}

/**
 * Whether the tournament board screen shows before the NEXT race (`SetupTournamentRace 1000:115c`,
 * docs/engine.md §9ay): Challenge format only (`[3f8]==1`, two-car/H2H, skips the `CALL 18d8`
 * entirely), never before the qualifier (`effectiveRaceIndex===0`, `18d8`'s own internal early
 * RET), never before the very last race (`effectiveRaceIndex===ORDER_TABLE_LAST_INDEX`, the
 * champion decider) -- all three checked against `effectiveRaceIndex`, not `state.raceIndex`
 * directly (see its own header for the pending-bonus-race distinction).
 */
export function shouldShowBoard(state) {
  const i = effectiveRaceIndex(state)
  return state.format !== 'twocar' && i !== 0 && i !== ORDER_TABLE_LAST_INDEX
}

/**
 * The Challenge qualifier's own fixed 3 opponents -- NOT auto-picked or player-chosen, hardcoded
 * directly: `RunOnePlayerChallenge 1000:102b`'s own `[266A]=6` (right after PRESS ANY KEY) and
 * `RunTournamentLoop 1000:10a0`'s own tournament-init `[266C]=6`/`[266E]=6` (`1000:10b9/10bf`).
 * All three are JETHRO (character index 6), unconditionally, every Challenge qualifier. This has
 * NO effect on tuning: `tuningFieldsFor`'s own `character` parameter is only consulted when
 * `tournamentIndex>0` (`InitRaceCarsFromTables`'s own branch at `1000:3fd9`), and the qualifier is
 * always `tournamentIndex<=0` -- confirmed by a full re-disassembly of that branch structure (the
 * qualifier uses a flat per-car-slot ramp, 0/12/6, regardless of which character is nominally
 * assigned). JETHRO's own roster slot is NOT marked taken by this: the roster's own `|0x40` bit is
 * set at `1000:0AC2` (`OR byte ptr [SI],0x40`, `SI` pointing at `DS:0164+character`), reached only
 * from INSIDE `09E0`'s own fire-confirm gate (`1000:0AB5-0AC2`, right where a valid pick enters the
 * 5-blink commit sequence -- the SAME "fire on a taken character is ignored" gate docs/engine.md
 * §9ax already names) -- and `102B`'s/`10A0`'s own `[266A]=6`/`[266C]=6`/`[266E]=6` writes are raw
 * `MOV`s with no `CALL 09E0` anywhere near them (confirmed by re-reading `102B`'s own full
 * disassembly), so they never reach `0AC2` at all. So the player can still pick JETHRO for
 * themselves, and the real interactive picker (`needsOpponentPick` below) can still offer JETHRO as
 * a choice for races 1+.
 */
export const QUALIFIER_OPPONENTS = [6, 6, 6]

/**
 * The 3 opponent character indices to pass to `spawnCars`/`tuningFieldsFor` for the CURRENT race:
 * the qualifier's own fixed JETHRO trio (Challenge format only -- H2H's own qualifier already uses
 * the real picked opponent, via `pickOpponentCharacter`, before its own qualifier ever runs), or
 * the player's own interactively-picked opponents (`state.opponents`) for every race after.
 */
export function opponentCharactersFor(state) {
  if (state.format === 'challenge' && state.raceIndex === 0 && !state.pendingBonusRace) return QUALIFIER_OPPONENTS
  return state.opponents
}

/**
 * Whether the interactive opponent picker (`FUN_1000_1A4A`, GOAL-DOS-PARITY.md P3's second item)
 * needs to run before the next race: only once, right after a Challenge qualifier PASS -- DOS's own
 * `RunTournamentLoop 1000:10a0`, `10EF: CMP [3F8],0/JNZ 10F9` then `10F6: CALL 1A4A`, BEFORE the
 * `[28C1]` INC. This port's own `advance()` (inside `reportRaceResult`, below) already ran by the
 * time a caller checks this -- unlike DOS's own pre-INC timing, this is a documented, harmless
 * reordering: `1A4A` never reads `[28C1]` at all (see `effectiveRaceIndex`'s own header for the
 * DIFFERENT class of bug where the pre/post-INC distinction DOES matter -- this isn't one of them),
 * so the trigger condition here is "we just landed on race 1 with nobody picked yet", not "we are
 * about to increment".
 */
export function needsOpponentPick(state) {
  return state.format === 'challenge' && state.raceIndex === 1 && state.opponents.length === 0
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
