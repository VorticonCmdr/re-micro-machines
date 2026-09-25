// The shared "wait for a key, with a real timeout" primitive, `1000:179B-17FE` -- reused by THREE
// screens (`get_xrefs_to`): `ShowNextRaceIntroScreenTune4or5`/the one-player race-intro
// (`1000:1395`, `tournament.js`'s own `raceIntroHoldTicks` covers only the SLIDE portion before
// this, not this wait itself), `ShowCharacterEliminatedTune6`/the elimination screen
// (`1000:1793`, `elimination.js`), and `RunHeadToHeadTournament`'s own H2H race-info screen
// (`1000:2071`, `twoHuman.js`, not yet wired into `flow.js`). Lives here, not in any one of those
// three files, since it belongs to none of them more than the others.
//
// Full disassembly (27 instructions, `docs/engine.md` §9ba/§9bn): entry (`179F-17B0`) resets the
// shared tick counter `DS:0002` to `0`, combines BOTH players' own reader bits (`[0x1080]=0`,
// matching `RunTwoItemMenu`'s own convention), and clears the release latch. Two stages then share
// ONE combined ~700-tick (`0x2BC`) timeout budget running from that single reset -- NOT two
// separate budgets, a real bug this port had (GOAL-DOS-PARITY.md P3 regression, closed here): an
// earlier session's own investigation of the timeout compare misread `CS:[0x93C2]` (stage 2's own
// comparand) as a permanently-zero dead constant, missing that it is `DS:[0x2]` itself under a
// segment alias (`CS:[X]`≡`DS:[X-0x93C0]` for `X>=0x93C0`, `docs/engine.md` §9bn).
//
// **Stage 1 (`17B5-17D5`, a debounce): waits for an already-held fire to be released.** Its own
// timeout check (`17B5: CMP [0x2],0x2BC` / `17BB: JNC 17FA`) runs BEFORE that iteration's own tick
// wait -- if it fires, the WHOLE function exits immediately (it does NOT fall through into stage
// 2). Otherwise: wait for the next tick, poll input, exit on a release latch (`17C9`/`17CE`), else
// -- if fire is STILL held -- loop back to the top of stage 1 (`17D0`/`17D5`); once fire is no
// longer held, fall through into stage 2 with the SAME tick budget (not reset).
//
// **Stage 2 (`17D7-17F8`): waits for a FRESH fire press or a release.** Same shape: timeout check
// first (`17D7`/`17DE`, reading `CS:[0x93C2]`≡`DS:[0x2]`), then tick wait, poll, release-latch exit
// (`17EC`/`17F1`), then -- unlike stage 1 -- a HELD fire is what EXITS (`17F3`/`17F8`: `JZ` loops
// back only while fire is NOT held; a fresh press falls through to exit).
//
// A key already HELD when this function is entered is INFERRED (not observed live) to still get a
// correct eventual release, per real PC keyboard typematic auto-repeat re-tracking the key shortly
// after the entry-time `[0x107F]=0` reset (`src/engine/input.js`'s own `createMenuReleaseTracker`,
// corrected the same session this file was added). A synthetic `dispatchEvent` keydown has no
// auto-repeat, so a live test that holds a key across the entry sees the no-repeat behaviour: the
// key is never re-tracked and its release never latches.
//
// Wired into `flow.js` for RACE_INTRO and ELIMINATED via `waitScreenStep` below (docs/engine.md
// §9bp), replacing M3.69's plain-`setTimeout` stopgap and the old keydown-edge dismiss.

export const KEY_WAIT_TIMEOUT_TICKS = 0x2bc // 700 ticks, ~10s at 70Hz -- 1000:17B5/17D7's own shared comparand (DS:0002)

export function keyWaitInitialState() {
  return { phase: 'STAGE1', ticks: 0 }
}

/**
 * One ~1/70s tick. `input`: `{ fireHeld, anyKeyReleased }` -- `fireHeld` is BOTH players' own
 * reader bits ORed together (`[0x1080]=0` at entry, `1000:17A5`), `anyKeyReleased` is the SAME
 * `[0x107E]`-derived release latch `raceResultWaitStep` already reads (named for what `[0x107E]`
 * actually tests, not ESC specifically). Returns `{ exit: null | 'dismiss' | 'timeout' }`; `state`
 * is mutated in place. The real code doesn't distinguish these two exits at its own call sites
 * (neither branches on `179B`'s own return value) -- both are exposed here only for the caller's
 * own UI convenience, not because DOS itself treats them differently.
 *
 * The timeout check runs BEFORE this tick's own increment, matching `17B5`/`17D7` running before
 * their own tick-wait -- NOT after, unlike `raceResultWaitStep`'s own `>` check post-increment; and
 * the comparison is `>=` (`JNC` on `CMP ticks,0x2BC`), not `>`. Do not reuse `raceResultWaitStep`
 * for this -- the comparator, check order, and exit conditions all differ.
 */
export function keyWaitStep(state, input = {}) {
  if (state.ticks >= KEY_WAIT_TIMEOUT_TICKS) return { exit: 'timeout' } // 17B5/17BB or 17D7/17DE
  state.ticks++ // 17BD-17C4 or 17E0-17E7: the wait-for-next-tick idiom
  if (input.anyKeyReleased) return { exit: 'dismiss' } // 17C9/17CE or 17EC/17F1
  if (state.phase === 'STAGE1') {
    if (input.fireHeld) return { exit: null } // 17D0/17D5: JNZ 17B5 -- stay in stage 1, keep debouncing
    state.phase = 'STAGE2' // 17D5 falls through: fire released, same tick budget carries into stage 2
    return { exit: null }
  }
  // STAGE2
  if (input.fireHeld) return { exit: 'dismiss' } // 17F3/17F8: a fresh press exits
  return { exit: null } // 17F8: JZ 17D7 -- stay in stage 2, keep waiting
}

/**
 * A whole `179B`-terminated screen, as `flow.js` drives it (GOAL-DOS-PARITY.md P3 "Wait-screen
 * input parity", docs/engine.md §9bp): some pre-wait work that polls NO input (the race-intro's own
 * slide hold, `raceIntroHoldTicks`; the elimination screen's own wobble bounce, `1000:174D-1789`,
 * `eliminationStep`), then `179B` itself. `preStep()` runs one tick of that pre-wait work and
 * returns `true` on the tick it finishes; input on those ticks is ignored, matching both real loops
 * never polling it. The tick it finishes returns `entered: true` -- the caller's cue to run
 * `179B`'s own entry (`179F-17B0`: the tick counter reset, which `keyWaitInitialState` is, AND the
 * release-latch clear, `[0x107F]=0`/`[0x107E]=0`, which is `menuReleaseTracker.reset()` in the
 * port -- a key released or tracked during the pre-wait work is discarded there, not queued).
 * `179B`'s own first wait tick is the NEXT call, not this one: the real entry falls straight into
 * `17B5`'s timeout check and only then waits for a tick. Pass `preDone = true` for a screen with no
 * pre-wait work at all (a zero-tick hold), so it enters `179B` immediately rather than one tick
 * late. Returns `keyWaitStep`'s own `{ exit }` shape, plus `entered`.
 */
export function waitScreenInitialState(preDone = false) {
  return { wait: preDone ? keyWaitInitialState() : null }
}

export function waitScreenStep(state, input, preStep) {
  if (state.wait == null) {
    if (!preStep()) return { exit: null, entered: false }
    state.wait = keyWaitInitialState() // 179F: [0x2]=0
    return { exit: null, entered: true } // 17AB/17B0: the caller clears the release latch now
  }
  return { ...keyWaitStep(state.wait, input), entered: false }
}

/** `raceIntroHoldTicks`' own pre-wait work as a `preStep`: returns `true` on the `holdTicks`-th
 * call. `holdTicks` must be >= 1 (a zero hold is `waitScreenInitialState(true)` instead). */
export function holdTicksPreStep(holdTicks) {
  let left = holdTicks
  return () => --left <= 0
}
