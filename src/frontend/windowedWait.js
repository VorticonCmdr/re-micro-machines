// A screen that waits by calling `1000:17FF` over and over (docs/engine.md §9bq/§9br): each call is
// one "window" of `CX+1` ticks (`twoHuman.js`'s `raceResultWaitStep`, with `17FF`'s own entry
// clearing the release latch every time, `180F`/`1814`); CLC (a release, or a fresh fire press)
// leaves the screen, STC (the window ran out) does that screen's own per-window work (a blink) and
// calls `17FF` again. Between some windows the screen also compares `[0x261F]` (a tick counter the
// timer ISR increments at `48D8`, zeroed by the screen itself) against `0x2BC` and leaves if it has
// reached it. Where that check sits in the loop is per-screen:
// - every window: the results screen (`ShowRaceResultsScreenTune8or6 1618-164E`, CX=0xF) and the
//   outcome screen's SIMPLE path (`1DE5-1E0F`, CX=0xF): `checkPeriod 1`;
// - after every 2nd window: the tournament board's regular blink (`DrawTournamentBoard 1902-1929`,
//   CX=0x23): `checkPeriod 2, checkOffset 0`;
// - after the 1st window of every pair: the board's bonus-race reveal (`192B-198B`, CX=0x23):
//   `checkPeriod 2, checkOffset 1`.
// All `[STATIC]`. Tick counts assume the per-window draw work fits inside one tick and that the
// screen zeroes `[0x261F]` at phase entry (on DOS it is zeroed only after the entry draws/fade).

import { raceResultWaitInitialState, raceResultWaitStep } from './twoHuman.js'

export const WINDOWED_WAIT_TIMEOUT_TICKS = 0x2bc // [0x261F]'s own comparand, every caller

export function windowedWaitInitialState({ cx, checkPeriod = 1, checkOffset = 0 }) {
  return { cx, checkPeriod, checkOffset, ticks: 0, windows: 0, wait: raceResultWaitInitialState() }
}

/**
 * One tick. `input`: `{ fireHeld, anyKeyReleased }` (both players' fire combined -- `17FF` sets
 * `[0x1080]=0`). Returns `{ exit, resetLatch, windowEnded, timeoutChecked }`: `exit` is `null`,
 * `'dismiss'` or `'timeout'`; `windowEnded` is the caller's cue for its per-window work (the
 * blink) and `resetLatch` for clearing the release tracker (the next `17FF` call's own clear);
 * `timeoutChecked` says whether `[0x261F]` was compared on this tick.
 */
export function windowedWaitStep(state, input = {}) {
  state.ticks++ // [0x261F], 48D8
  const r = raceResultWaitStep(state.wait, input, state.cx)
  if (r.exit === 'dismiss') return { exit: 'dismiss', resetLatch: false, windowEnded: false, timeoutChecked: false }
  if (r.exit !== 'retoggle') return { exit: null, resetLatch: false, windowEnded: false, timeoutChecked: false }
  state.windows++
  const timeoutChecked = (state.windows - state.checkOffset) % state.checkPeriod === 0
  if (timeoutChecked && state.ticks >= WINDOWED_WAIT_TIMEOUT_TICKS) return { exit: 'timeout', resetLatch: false, windowEnded: true, timeoutChecked }
  state.wait = raceResultWaitInitialState()
  return { exit: null, resetLatch: true, windowEnded: true, timeoutChecked }
}

export const RESULTS_17FF_CX = 0xf // ShowRaceResultsScreenTune8or6 1648: MOV CX,0xF (checkPeriod 1, 1640's check before every call)
