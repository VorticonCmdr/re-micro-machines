// The one-player tournament state machine (`RunTournamentLoop 1000:10a0`, `SetupTournamentRace
// 1000:115c`, docs/engine.md §7, PLAN-ENGINE.md M3.9). Pure logic, no rendering -- this is the
// part of the front end with real rules and the part this milestone's own acceptance test
// ("a full Challenge tournament is playable to the champion screen") can actually verify
// headlessly, the direct analogue of what `checkpoints.js`/`cheats.js` are to their own milestones.
//
// Source discipline: every rule below is transcribed from docs/engine.md §7, an EARLIER session's
// live disassembly pass (`[STATIC]`) -- this module does not re-disassemble `RunTournamentLoop`
// itself, except where noted below.
//
// GOAL-DOS-PARITY.md's own "two INFERRED tournament rules" item (docs/engine.md §9bc) is now FULLY
// resolved, neither one left as a guess:
// - **What closes the loop when lives reach 0**: `[0x406]` (lives) is a single BYTE (confirmed by
//   an exhaustive `search_byte_patterns` sweep of every reference: init to 3 at `1000:0ED2`, the
//   `25011968` cheat's own write of 10 at `1000:11BA`, the decrement at `1000:1CEA`, the increment
//   at `1000:1D00`, all byte-sized `MOV`/`DEC`/`INC` forms). It is tested for EXACT zero, not
//   "non-positive," at the two real post-outcome-message sites: `1000:166D` (Challenge, inside
//   `ShowRaceResultsScreenTune8or6`) and `1000:1403` (two-car, the analogous site in the same
//   function) -- both `CMP byte [0x406],0 / JZ <tournament-over>`. Because `[0x406]` is an
//   UNSIGNED byte, a decrement that would go below 0 WRAPS to 255, not a negative value -- this
//   port now matches that exactly (`decrementLives`/`incrementLives`, below), replacing the earlier
//   `state.lives<=0` guess (an ordinary signed JS number) that could never observe a wrap. Ordinary
//   play never reaches the wrap (lives only ever reach exactly 0 through the normal decrement path,
//   which this now-byte-exact test still ends the run on, same as the port's own prior behaviour);
//   the wrap is reachable only via the `]` debug key's own `applyLivesCheat` (docs/engine.md §9bb
//   item 5), zeroing lives on an `EXTRA_LIFE` screen (no immediate check) and THEN losing again.
// - **Whether the win streak resets to 3 after a bonus race**: settled, not inferred (docs/engine.md
//   §9t, 2026-09-22): live disassembly of `ShowNextRaceIntroScreenTune4or5` (1000:1220) shows
//   `[3fa]=3` written at the bonus race's own INTRO screen, gated on `[28bf]==9` -- i.e. before the
//   bonus race runs, not after it resolves as this file previously guessed. Checked against this
//   module's own `reportRaceResult` (below) and confirmed the timing difference is NOT observable
//   here: nothing reads `state.streak` while `pendingBonusRace` is set, so resetting at resolution
//   time (this file) or at intro time (the real game) produce the identical state by the time
//   anything downstream looks at `streak` again. Kept as resolution-time for simplicity -- this is
//   a confirmed-equivalent finding, not a bug.
//
// Deliberately not modelled: two-HUMAN head-to-head (`RunHeadToHeadTournament 1faf`) -- its track
// selection is `DS:0002 & 7`, the vsync tick counter, so it is not input-deterministic and this
// port's tape/replay model has nothing to drive it with. The interactive "pick your 3 opponents"
// screen (`FUN_1a4a`, GOAL-DOS-PARITY.md P3's second item) and the elimination/replacement-pick
// screen (P3's third item) are BOTH modelled now -- see `needsOpponentPick`/`QUALIFIER_OPPONENTS`/
// `checkElimination` below, docs/engine.md §9az/§9ba. The replacement is chosen by the player
// through the SAME interactive picker, not auto-picked -- an earlier draft of this file (and of
// docs/engine.md §9k) said the original auto-picks the first untaken roster slot; that was wrong
// about the ORIGINAL game (right only as a description of THIS file's own now-superseded
// simplification) -- `1000:16de`'s own disassembly calls `FUN_1000_1a4a` directly, the identical
// function the initial 3-opponent pick uses.

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
    bonusRacesTaken: 0, // [342], the COUNTER is capped at MAX_BONUS_RACES (1A9F) -- the TRIGGER itself is not (see maybeTriggerBonusRace's own header, docs/engine.md §9bb)
    pendingBonusRace: null, // {round: 9, race} once a streak-out triggers one, cleared on report
    roster: CHARACTER_NAMES.map((name, i) => ({ index: i, name, taken: false, eliminated: false })),
    playerCharacter: null,
    // Challenge: 3 FIXED slots (the real game's own 0xC1E/0xC39/0xC54 face descriptors), `null` =
    // that slot's own "unpicked" sentinel (the real 0xB frame value) -- filled in order by
    // `pickOpponentCharacter`, vacated (set back to `null`) by `checkElimination`. H2H: a plain
    // single-entry array, unchanged (see `pickOpponentCharacter`'s own header).
    opponents: format === 'challenge' ? [null, null, null] : [],
    over: false,
    champion: false,
    lastOutcome: null,
    eliminationEvents: [],
    // {victim, slot} once `checkElimination` evicts someone -- `flow.js` shows the "IS OUT!!" bounce
    // screen for `victim`, then re-runs the interactive picker to fill `state.opponents[slot]`, then
    // clears this. Never set for a no-op eviction check (docs/engine.md §9ba).
    pendingElimination: null,
    _evictionSlotCursor: null, // 1000:0346: which of the 3 opponent slots (0-2) is next up for eviction
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
 * handicap), the Challenge format's real interactive INITIAL opponent picker (`FUN_1A4A`, called
 * once per empty slot right after a qualifier PASS), AND the elimination REPLACEMENT picker (the
 * SAME `FUN_1A4A`, called again with exactly one slot empty -- `1000:16de`'s own trailing
 * `CALL 1A4A`, docs/engine.md §9ba). All three reach the SAME `09E0` commit block
 * (`1000:0afa-0b50`), which services all 4 car slots identically. Fire on an already-taken
 * character is ignored (0AB5-0ABB, `charSelectStep`'s own IDLE case already enforces this before
 * this is ever called) -- returns false then. Fills the FIRST empty (`null`) slot in
 * `state.opponents`, in order -- matching `1A4A`'s own fixed scan order (`0xC1E,0xC39,0xC54`) --
 * for Challenge; APPENDS for H2H, whose own `opponents` starts `[]` and is filled exactly once, so
 * append and "fill first empty slot" are equivalent there too.
 */
export function pickOpponentCharacter(state, charIndex) {
  const slot = state.roster[charIndex]
  if (!slot || slot.taken) return false
  slot.taken = true
  const emptyIndex = state.opponents.indexOf(null)
  if (emptyIndex === -1) state.opponents = [...state.opponents, charIndex]
  else state.opponents[emptyIndex] = charIndex
  return true
}

/** Whether ANY of the Challenge format's 3 opponent slots is still unfilled -- the real game's own
 * `FUN_1000_1A4A` re-scans for this after every pick (`1000:1A80: JMP 1A53`), and `flow.js` uses
 * this the same way to decide whether to loop the picker again, for BOTH the initial 3-pick and a
 * single elimination replacement. */
export function hasEmptyOpponentSlot(state) {
  return state.opponents.includes(null)
}

/** Whether the next race gets its intro screen: every race except the Head-to-Head qualifier, whose
 * intro routine (11F8) starts tune 4 and returns without drawing anything (126D-127B). */
export function hasRaceIntro(state) {
  return !(state.format === 'twocar' && state.raceIndex === 0 && !state.pendingBonusRace)
}

/**
 * `ShowNextRaceIntroScreenTune4or5 1000:11F8`'s own mandatory hold on the SLIDE-LOOP portion of
 * the screen, before the shared `179B` "wait for a key" stage is reached (GOAL-DOS-PARITY.md's
 * "H2H race-intro variant" item, docs/engine.md §9be has the full derivation). Not the WHOLE
 * hold -- see the "What this does NOT cover" paragraph below.
 *
 * The tick loop's own exact shape (`131F-1393`: `132C` draw -> `134B` VRAM present -> `1354`
 * format branch -> test -> move-or-stop -> `1375`/`1393` loop back), traced tick-for-tick:
 * - **H2H** (`1354-1375`, "the two cars slide in and face each other," §9an 8): car 0's icon
 *   starts at `X=-32` (`0xFFE0`, set once at `130E`) and moves `+2`/tick; car 1's starts at
 *   `X=0x100`(256) and moves `-2`/tick; each tick draws the CURRENT position, then tests
 *   `car0.X==0x54`(84) BEFORE moving -- so the position sequence drawn is `-32,-30,...,84`
 *   inclusive, `(84-(-32))/2+1 = 59` ticks total.
 * - **Challenge** (`1377-1393`): all 4 icons start at `X=0x100`(256) and move `-2`/tick together;
 *   each tick draws, then tests `car0.X<=0x10`(16) before moving -- position sequence
 *   `256,254,...,16` inclusive, `(256-16)/2+1 = 121` ticks total.
 *
 * "59/121 ticks" means 59/121 loop ITERATIONS, each resetting `[0x261F]` and waiting for the next
 * tick edge -- an iteration is exactly one 70Hz tick only if its own draw/restore/`089C` present
 * work finishes inside that 1/70s window; on slower hardware (or Challenge's own 4-icon iteration,
 * doing twice H2H's own per-tick work), an iteration can round up to two real ticks, the same
 * family of CPU-speed dependence the `32CE` fade already has, just smaller in degree.
 *
 * **Why a press during this window has no effect isn't just "the loop never polls input"** (true --
 * no `CALL 2D5B` anywhere in `131F-1393` -- but not, on its own, proof a press is DISCARDED rather
 * than buffered by the keyboard ISR that maintains `[0x107E]`/`[0x107F]` in the background
 * regardless of whether any code explicitly polls it). The real mechanism, confirmed by
 * disassembling `179B` itself: its own entry (`17AB: MOV byte[0x107F],0` / `17B0: MOV
 * byte[0x107E],0`) unconditionally CLEARS the release latch before its own wait loop ever runs --
 * so whatever the ISR latched during the slide loop is wiped the instant `179B` starts, and only a
 * release that happens AFTER that point can register. This is provable for a key PRESSED AND
 * RELEASED entirely inside the hold. It does NOT cover a key still HELD when the hold ends: DOS
 * exits `179B` on that key's own later release (`17C9`), while this port's own `confirm()` needs a
 * fresh `keydown` -- the same release-vs-keydown mismatch already recorded as
 * `UNKNOWN_outcome_screen_timeout` (docs/engine.md §10, under the §9bb registry entry), not
 * re-fixed here.
 *
 * **What this does NOT cover.** `12BD` runs three things BEFORE this tick loop even starts: the
 * portrait panel (`19F2`), a one-shot decorative draw (`01DE` -- its OWN 18 instructions show no
 * loop or wait, but its three callees weren't themselves read instruction-by-instruction, so
 * "contributes ~0 ticks" isn't as airtight as a full disassembly of everything it touches would
 * be), and a palette fade-up (`32CE`,
 * `PaletteFadeUpFromBlack`) -- already established elsewhere (docs/engine.md, the palette-fade
 * finding) to have **no derivable tick duration at all**: it is a busy loop with no `INT 1Ah`/vsync
 * wait anywhere in it, paced purely by 1994 CPU speed, "no derivable value to port." So the REAL
 * total hold (screen-appears to input-accepted) is `raceIntroHoldTicks`'s own count PLUS an
 * unknown, non-zero, non-tick-expressible amount for that fade -- new, narrower open item
 * `UNKNOWN_race_intro_prehold`, matching the SAME open-endedness the palette-fade finding already
 * has elsewhere, not a new kind of gap.
 *
 * Only reached for a REGULAR race: NOT the qualifier (`[28C1]==0`, `12BD` is never reached -- H2H
 * shows no intro at all, `hasRaceIntro` above; Challenge's own qualifier banner at `127E` is a
 * separate, unported mechanism, out of this item's scope) and NOT a bonus race (`[28BF]==9` takes
 * its own, entirely separate `01DE`/`32CE` reveal at `1220`, `JMP 1395` straight past `12BD`, also
 * out of scope) -- both of those paths ALSO run their own `01DE`/`32CE` pair before `1395`, so
 * returning 0 here means "this port's own hold is unchanged from before this item," not "DOS has
 * no delay there either."
 *
 * This function ports ONLY the slide-loop's own tick count, not the sprite panel itself (the
 * portraits from `19F2`, or the sliding/marquee vehicle icons) -- matching the established
 * precedent for the SAME `19F2` function's other call site (the opponent picker, docs/engine.md
 * §9az): this project's own `screens.js` is hand-drawn text/graphics, not full sprite-panel
 * parity, and a persistent sprite panel is a real new feature, not a bug fix -- a scope this
 * session's user explicitly chose over the full sprite port after being shown the tradeoff.
 */
export function raceIntroHoldTicks(state) {
  if (state.pendingBonusRace) return 0
  if (state.raceIndex === 0) return 0
  return state.format === 'twocar' ? 59 : 121
}

/**
 * The intro screen's own participant list, as character indices `[player, ...opponents]` -- text
 * equivalent of `19F2`'s own face-preview panel (one face per active car, 2 in H2H / 4 in
 * Challenge, docs/engine.md §9be), gated the SAME way as `raceIntroHoldTicks` above (only a
 * regular race reaches `12BD`/`19F2` at all -- `null` for the qualifier or a bonus race, neither
 * of which shows a participant panel in the original either). `opponentCharactersFor` already
 * returns the right thing for both formats once past the qualifier (`state.opponents`: a 1-entry
 * array for H2H, 3 for Challenge), so this needs no format branch of its own.
 */
export function raceIntroParticipants(state) {
  if (state.pendingBonusRace) return null
  if (state.raceIndex === 0) return null
  return [state.playerCharacter, ...opponentCharactersFor(state)]
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

/**
 * Whether an OUTCOME screen follows RESULTS for a regular Challenge race (the SECOND of two
 * transitions `screenAfterRace` alone doesn't cover -- an advisor review caught this real gap,
 * GOAL-DOS-PARITY.md P3's 4th item, docs/engine.md §9bb item 3). `1000:1650-166A`, re-disassembled:
 * a PASS (1st place, or 2nd on any race but the last) jumps straight from `13E4`'s own decision
 * site to the elimination-check tail (`1676`) WITHOUT ever calling `ShowRaceOutcomeMessageTune8or6
 * 1C1B` -- ONLY a FAIL (`1667: MOV CX,2 / CALL 1C1B`) does. So after RESULTS, a regular Challenge
 * race shows an OUTCOME screen ONLY on a loss ("ONE LIFE LOST"); a pass goes straight to whatever's
 * next (elimination check / opponent picker / board / bonus trigger / the next race's own intro),
 * no message screen at all. `flow.js`'s own `confirm()` must call this before transitioning
 * RESULTS -> OUTCOME, not do so unconditionally.
 */
export function showsOutcomeAfterResults(state) {
  return state.lastOutcome === OUTCOME.ONE_LIFE_LOST
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
  return state.format === 'challenge' && state.raceIndex === 1 && state.opponents.every((o) => o === null)
}

/**
 * `1000:1676-16DB`, fully re-disassembled and independently re-verified this session
 * (docs/engine.md §9ba) -- inside `ShowRaceResultsScreenTune8or6`, NOT `RunTournamentLoop`/`1A82`
 * as this file previously assumed without having actually traced it. Gate: `[0x310] % 3 == 0`.
 * `completedRaceIndex` MUST be the race just completed, captured BEFORE `reportRaceResult`'s own
 * `advance()` call runs -- `13E4`'s own elimination check (called from `RunTournamentLoop` at
 * `110D`) runs BEFORE that loop's own `[28C1]` INC (`10F9`), the same pre/post-increment class of
 * bug `effectiveRaceIndex`'s own header already names for the board and `tournamentIndex`.
 *
 * Victim selection is a 3-SLOT DESCRIPTOR-ADDRESS CURSOR (`state._evictionSlotCursor`, 0-2, mapping
 * to `state.opponents[0..2]` -- the real `0xC1E`/`0xC39`/`0xC54`), NOT a roster-index computation
 * (an earlier draft of this file, and of docs/engine.md §9k, called this "roster position modulo
 * opponent count" -- an interpretation the goal file itself flagged as unverified, and it was
 * wrong): on the FIRST eviction (`completedRaceIndex===3`, a literal equality in the real bytes,
 * not "the first time this runs"), the cursor is set to whichever of the 3 CURRENT opponent slots
 * holds the lowest character index; on every LATER eviction the cursor just advances by 1, wrapping
 * 2->0 -- UNCONDITIONALLY, even when the pass below turns out to be a no-op, so a slot's own
 * replacement CAN be evicted again once the cursor returns to it.
 *
 * No-op: scan the 11-entry roster for one with neither `taken` nor `eliminated` set; if none
 * exists, skip the visible eviction (no roster write, no `pendingElimination`) -- but the cursor
 * above has ALREADY moved, a state-preserving skip, not a true no-op.
 *
 * On a real eviction: the victim's `eliminated` flag is set, but `taken` is NOT cleared (the real
 * `1000:1707` is an `OR`, adding `0x20` without ever clearing `0x40` -- an eliminated character
 * stays permanently excluded from the free-roster count; the free-slot scan itself tests
 * `byte & 0x60`, either bit disqualifying, so this has no OTHER observable effect, but the byte
 * value itself now matches the real game's, not the port's own earlier guess). The vacated slot is
 * set to `null` and `state.pendingElimination` records who was evicted, for `flow.js` to show the
 * "IS OUT!!" bounce screen before re-running the SAME interactive picker (`1A4A`,
 * `needsOpponentPick`'s own sibling, `hasEmptyOpponentSlot`) to fill the vacancy -- the replacement
 * is chosen by the PLAYER, not auto-picked.
 */
function checkElimination(state, completedRaceIndex) {
  if (completedRaceIndex % 3 !== 0) return // completedRaceIndex is never 0 here (only reached past the qualifier), so no separate ===0 guard is needed
  if (completedRaceIndex === 3) {
    let bestSlot = 0
    for (let i = 1; i < 3; i++) {
      if (state.opponents[i] < state.opponents[bestSlot]) bestSlot = i
    }
    state._evictionSlotCursor = bestSlot
  } else {
    state._evictionSlotCursor = (state._evictionSlotCursor + 1) % 3
  }
  const free = state.roster.find((s) => !s.taken && !s.eliminated)
  if (!free) return // the cursor above has already moved -- a state-preserving skip, not a true no-op
  const victimIndex = state.opponents[state._evictionSlotCursor]
  state.roster[victimIndex].eliminated = true // taken stays true -- 1000:1707 is an OR, never cleared
  state.opponents[state._evictionSlotCursor] = null
  state.pendingElimination = { victim: victimIndex, slot: state._evictionSlotCursor }
  state.eliminationEvents.push({ atRaceIndex: completedRaceIndex, victim: victimIndex })
}

function advance(state) {
  state.raceIndex++
  if (state.raceIndex > ORDER_TABLE_LAST_INDEX) {
    state.champion = true
    state.over = true
  }
}

/**
 * `[0x406]` (lives) as an unsigned BYTE, matching the real bytes exactly (see the file header,
 * GOAL-DOS-PARITY.md's "two INFERRED tournament rules" item, docs/engine.md §9bc): a decrement
 * below 0 wraps to 255, an increment above 255 wraps to 0. Returns whether the decrement landed on
 * EXACTLY 0 -- the real test (`1000:166D`/`1403`, both `CMP byte [0x406],0`), not "non-positive".
 */
function decrementLives(state) {
  state.lives = (state.lives - 1) & 0xff
  return state.lives === 0
}
function incrementLives(state) {
  state.lives = (state.lives + 1) & 0xff
}

/**
 * The general form: apply an arbitrary signed delta with the SAME byte wraparound, no over-check
 * at all -- matching `1000:36A0: DEC byte ptr [0x406]` (CHEATS.BIN spot-effect TYPE 0, "lose a
 * life", `1000:3652-3656`'s own dispatch, `CheckCheatSpotsThenPause`), which re-scans on EVERY
 * pause with no once-only guard and no life check anywhere nearby -- so repeatedly pausing on one
 * of the 5 real shipped type-0 spots (`GAME1/CHEATS.BIN`, confirmed live: round 1 race 1, round 1
 * race 4, round 3 race 1, round 3 race 3, round 4 race 3) genuinely wraps `[0x406]` through 0 to
 * 255 in the ORIGINAL game too, with no debug key needed at all (GOAL-DOS-PARITY.md's "two
 * INFERRED tournament rules" item, docs/engine.md §9bc -- corrects that section's own first draft,
 * which wrongly claimed the wrap was reachable only via the `]` debug cheat). `flow.js`'s own
 * `finishRace` accumulates `cheats.js`'s own `applyCheatEffect` type-0 output across however many
 * times the player paused on the spot during the race, and carries it out as `lifeDelta`;
 * `reportRaceResult` (via `applyPostRaceLives`, below) applies it with this function instead of the
 * `Math.max(0, ...)` signed clamp an earlier draft had, which silently discarded the wrap.
 */
export function applyLivesDelta(state, delta) {
  state.lives = (state.lives + delta) & 0xff
}

/**
 * The `25011968` cheat's own reset composed with `applyLivesDelta`, in the REAL order
 * (`1000:11AF-11BA`, `SetupTournamentRace`, re-disassembled: `11AF CALL 3039` (`RunRaceMainLoop`,
 * confirmed by `analyze_call_graph` to be the SAME function that calls `CheckCheatSpotsThenPause`
 * -- i.e. any type-0 CHEATS.BIN spot decrement happens INSIDE this call) / `11B3 CMP [0xF69],1` /
 * `11BA MOV [0x406],0xA` -- the reset fires right after the race returns, gated only on the cheat
 * flag, BEFORE the results/outcome screen chain (`11C4`/`11C7`) ever runs, for EVERY race
 * (qualifier, regular, bonus alike -- `115C` has exactly the three callers `10C8`/`110A`/`1A87`).
 * An earlier draft of GOAL-DOS-PARITY.md's "two INFERRED tournament rules" item applied the delta
 * and reset in the WRONG order (`flow.js`'s `advanceRace` reset landed AFTER the loss check, not
 * before it), which let an active cheat's own type-0 pause decrements survive long enough to zero
 * `tournament.lives` and end the run. Called from `reportRaceResult` itself, as its own very first
 * statement, rather than composed at the `flow.js` call site: `flow.js` has no automated test, so a
 * call-site composition can't be regression-tested.
 */
export function applyPostRaceLives(state, delta, cheatActive) {
  applyLivesDelta(state, delta)
  if (cheatActive) state.lives = 10
}

/**
 * `1000:1123-113A`, fully re-disassembled (GOAL-DOS-PARITY.md P3's 4th item, docs/engine.md §9bb):
 * the TRIGGER itself has NO cap on `[0x342]`/`bonusRacesTaken` -- only three conditions gate it
 * (`1123`: player won; `112B/112F`: streak reaches 0; `1131/1138`: not the last race), and none of
 * them read `[0x342]` at all. `[0x342]`'s own cap (`MAX_BONUS_RACES`, `[0x43B]`) lives entirely
 * INSIDE `TriggerBonusRace 1A82`'s own resolution-time increment (`1A9F: CMP [0x342],[0x43B] / JZ`,
 * already correctly ported as the `Math.min(...)` in `reportRaceResult`'s own `pendingBonusRace`
 * branch below) -- once `[0x342]` reaches that cap it simply STOPS incrementing, so `race:
 * bonusRacesTaken+1` (`1169: MOV AH,[0x342]` before the increment) naturally clamps at
 * `MAX_BONUS_RACES` (repeating the LAST bonus track, ROUND9-`MAX_BONUS_RACES`, forever) without the
 * TRIGGER itself ever needing to stop firing. A port draft that gated the trigger on the SAME cap
 * (removed here) was wrong -- confirmed by a full re-disassembly finding no `[0x342]`/`[43B]` read
 * anywhere in `1123-113A`.
 */
function maybeTriggerBonusRace(state) {
  state.streak--
  if (state.streak > 0) return false
  if (state.raceIndex >= ORDER_TABLE_LAST_INDEX) return false // "not the last race"
  // No cap here (see the header above) -- state.bonusRacesTaken is itself already clamped at
  // MAX_BONUS_RACES by reportRaceResult's own resolution-time Math.min below, so this naturally
  // repeats race MAX_BONUS_RACES+1 (the last real bonus track) on every trigger past the 3rd,
  // matching 1169's own pre-increment read of the SAME already-capped [0x342].
  state.pendingBonusRace = { round: 9, race: state.bonusRacesTaken + 1 }
  return true
}

/**
 * `1000:1439`'s own pass/fail test, fully re-disassembled -- it appears at THREE separate sites in
 * the SAME function, byte-for-byte identical (the second, up to one register substitution): the
 * results screen's own tune select (`1410-1427`, this item's own scope); a per-row results-label
 * pick inside the standings-drawing loop (`15A5-15C7`, for the row identified as the player's own);
 * and whether to show the `ONE_LIFE_LOST` outcome message at all (`1650-1667`). The latter two were
 * already found and fully disassembled by GOAL-DOS-PARITY.md P3's 4th item (docs/engine.md §9bb
 * item 1) -- including a LIVE read confirming the row-label's own two strings, `DS:039A`="QUALIFY"/
 * `DS:03A2`="FAILED", and already establishing `drawResults`'s own text needs no separate wiring --
 * which explicitly deferred THIS site (the tune) as the one piece still left on the `lastPassed`
 * approximation. Confirms all three are ONE rule, not independently-drifting copies (docs/engine.md
 * §9bd has the full derivation). The player passes iff they finished 1st (`word[0x3FC]==0xC03`), or
 * finished 2nd AND this is NOT the tournament's very last race (`byte[0x28C1]!=0x19`,
 * `ORDER_TABLE_LAST_INDEX`). `[3FC]`/`[3FE]`
 * are the order array's own first two of four slots (`11D5`'s own `[2678..267E]->[3FC..402]` copy,
 * each slot holding the finishing car's own descriptor address); `finishPosition<=passThreshold` reads
 * the identical thing via `rankOrder.indexOf(0)+1` (`flow.js`'s own citation of `[3FC..402]`) --
 * confirmed byte-exact even under the instant-win cheat: `36A7`'s own `[2678..267E]` writes (`0,
 * 0x2C8, 0x164, 0x42C`) divide by `[0x2662]` (independently confirmed elsewhere, §9am, to be P2's
 * own car-record pointer, written only as `0x164` -- i.e. `CAR_RECORD_SIZE`, `src/engine/car.js`)
 * then scale by `0x1B` in `11D5`'s own transform to exactly car indices `[0,2,1,3]`, matching
 * `cheats.js`'s own `fixedOrder` hardcode exactly. GOAL-DOS-PARITY.md's "results screen tune
 * condition" item: this single predicate now drives BOTH the PASSED/ONE_LIFE_LOST outcome below
 * AND `raceResultMusic`'s own tune argument (`flow.js`'s `advanceRace`) -- `lastOutcome` itself
 * (read by `flow.js`'s own `lastPassed` for the RESULTS screen's "QUALIFY"/"FAILED" text) needed
 * no change, since it's now DERIVED FROM this same predicate for the one case that matters.
 */
export function resultsPassed(state, finishPosition) {
  const isLastRace = state.raceIndex === ORDER_TABLE_LAST_INDEX
  return finishPosition <= (isLastRace ? 1 : 2)
}

/**
 * Report the result of the race `currentRace()` just named. `finishPosition` is the player's
 * 1..4 finishing place for a Challenge race, 1..2 for a two-car race, or (only when
 * `pendingBonusRace` is set) ignored in favour of the explicit `won` flag `[291D]`'s reading
 * feeds in the real game (docs/engine.md §7: "outcome 3 EXTRA LIFE if `[291D]==1` else 4").
 * `activeDroneIndices` (the 3 opponents' character indices) is only consulted on an eviction tick.
 *
 * `lifeDelta`/`cheatActive` apply `applyPostRaceLives` (the CHEATS.BIN type-0 delta accumulated
 * during the race, composed with the `25011968` cheat's own reset) as the VERY FIRST thing this
 * function does, matching `1000:11AF-11BA`'s own real position -- right after the race itself
 * (`CALL 3039`, which is also what calls `CheckCheatSpotsThenPause`), BEFORE any of the branches
 * below (the qualifier/twocar/bonus/Challenge fail paths) run their own loss check. This lives
 * HERE rather than being composed by the caller (`flow.js`'s `advanceRace`) so it's covered by
 * this file's own test suite -- `flow.js` has no automated test (GOAL-DOS-PARITY.md's "two
 * INFERRED tournament rules" item, docs/engine.md §9bc).
 */
export function reportRaceResult(state, { finishPosition, won, lifeDelta = 0, cheatActive = false } = {}) {
  if (state.over) return
  applyPostRaceLives(state, lifeDelta, cheatActive)
  if (state.pendingBonusRace) {
    state.lastOutcome = won ? OUTCOME.EXTRA_LIFE : OUTCOME.NO_BONUS
    if (won) {
      // Both effects are gated on the SAME `1000:1A92: CMP [0x291D],1 / JNZ 1AA9` branch, fully
      // re-disassembled (GOAL-DOS-PARITY.md P3's 4th item, docs/engine.md §9bb items 2/4): a LOST
      // bonus race skips straight to `1AA9: CALL 1C1B` with neither ever happening. An advisor
      // review caught both real gaps in an earlier draft of this fix, which incremented the
      // counter unconditionally and never granted a life at all.
      incrementLives(state) // 1000:1CFA-1D02: INC [0x406], CX=3 (EXTRA_LIFE) only -- the outcome screen's OWN name says "extra life"
      state.bonusRacesTaken = Math.min(state.bonusRacesTaken + 1, MAX_BONUS_RACES) // 1000:1A99-1AA5: [0x342]'s own cap, WIN-gated -- a lost bonus race re-offers the SAME track next time, it does not advance to the next one
    }
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
    else { state.lastOutcome = OUTCOME.ONE_LIFE_LOST; if (decrementLives(state)) state.over = true }
    return
  }

  if (!resultsPassed(state, finishPosition)) {
    state.lastOutcome = OUTCOME.ONE_LIFE_LOST
    const outOfLives = decrementLives(state)
    // docs/engine.md §7: "[3fa]=3" on a 3rd/4th result, explicit -- the real site is
    // `RunTournamentLoop`'s own `1000:113F-114E` (re-disassembled: `1144: JZ 114E` resets the
    // streak UNCONDITIONALLY once `[28C1]==0x19`/the last race, regardless of 2nd vs 3rd/4th place,
    // so this applies to the last-race-2nd-place case too), NOT `1000:1667` (that address is
    // `ShowRaceOutcomeMessageTune8or6`'s own CX=2 outcome-message/life-decrement call, a different
    // function for a different purpose that merely happens to fire on the same losing race).
    state.streak = 3
    if (outOfLives) state.over = true // 1000:166D: CMP byte [0x406],0 / JZ -- exact zero, byte-wrapped (decrementLives's own header)
    return
  }

  state.lastOutcome = OUTCOME.PASSED
  // Captured BEFORE advance(): 13E4's own elimination check (called from RunTournamentLoop at
  // 110D) runs BEFORE that loop's own [28C1] INC (10F9) -- see checkElimination's own header.
  const completedRaceIndex = state.raceIndex
  // Unconditional, and BEFORE the bonus-trigger check: 13E4 runs before RunTournamentLoop's own
  // 1123-113A -- a bonus-triggering race still evicts. The old `!bonusTriggered` gate here was
  // wrong (this file had never actually traced RunTournamentLoop's own call order) and is removed.
  checkElimination(state, completedRaceIndex)
  let bonusTriggered = false
  if (finishPosition === 1) bonusTriggered = maybeTriggerBonusRace(state)
  advance(state)
}

/**
 * `reportRaceResult`, but returns a COPY of `opponentCharactersFor(state)` taken BEFORE the call --
 * the only correct way to build a results table's own driver names (`flow.js`'s `advanceRace`), since
 * an evicting race's own `reportRaceResult` can null a slot of the SAME array IN PLACE
 * (`checkElimination`, above) -- reading it live, or snapshotting it AFTER this call, can show the
 * very opponent who was just raced against as missing. An advisor review of the committed code
 * caught that this ordering hazard had no test of its own (`advanceRace` itself has no headless
 * harness); `tools/check-tournament.mjs`'s test 7c calls this export directly to prove it.
 */
export function reportRaceResultWithOpponentSnapshot(state, result) {
  const opponents = [...opponentCharactersFor(state)]
  reportRaceResult(state, result)
  return opponents
}

/**
 * `1000:1DCD`'s own `]` debug key (GOAL-DOS-PARITY.md P3's 4th item, docs/engine.md §9bb, full
 * derivation in `flow.js`'s own `onKeydown`). The reachability guard lives HERE, not in the caller
 * (an advisor review caught that leaving it in `flow.js` alone meant it was never actually tested):
 * reachable only while `state.lastOutcome` is `ONE_LIFE_LOST` or `EXTRA_LIFE` (the only two outcome
 * codes whose own message screen reaches the shared wait loop `1DCD` lives in) -- every other code
 * is a no-op, matching the real key having no effect at all on any other outcome screen. Zeroes
 * lives unconditionally once reachable; ends the tournament immediately ONLY for `ONE_LIFE_LOST` --
 * that outcome's own caller (`166A`'s call site) checks `[0x406]==0` the instant `1C1B` returns and
 * exits right there, while `EXTRA_LIFE`'s own caller (`TriggerBonusRace`'s `1AA9`) has no such
 * check at all, so the zeroed value there is silent until some LATER race loss.
 *
 * `state.lives` is now a byte-wrapped value (`decrementLives`/`incrementLives`, GOAL-DOS-PARITY.md's
 * "two INFERRED tournament rules" item, docs/engine.md §9bc), so this DOES reproduce the real
 * byte-underflow consequence: zeroing lives here (via this cheat, on `EXTRA_LIFE` specifically,
 * where nothing checks it immediately) means the NEXT 3rd/4th-place loss's own `decrementLives`
 * wraps `0` to `255`, not to a negative value, and `outOfLives` (its own return value) is
 * correctly `false` -- the tournament does NOT end at that next loss, matching `166D`/`1403`'s own
 * real `CMP byte [0x406],0` test reading 255. This was flagged as a known, unfixed divergence when
 * this item was first written; it's now closed.
 */
export function applyLivesCheat(state) {
  if (state.lastOutcome !== OUTCOME.ONE_LIFE_LOST && state.lastOutcome !== OUTCOME.EXTRA_LIFE) return
  state.lives = 0
  if (state.lastOutcome === OUTCOME.ONE_LIFE_LOST) state.over = true
}
