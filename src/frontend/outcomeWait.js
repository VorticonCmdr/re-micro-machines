// The outcome-message screen's own wait, `ShowRaceOutcomeMessageTune8or6 1000:1C1B-1E17`
// (docs/engine.md §9bq, GOAL-DOS-PARITY.md P3 "Wait-screen input parity" item (2), closing
// `UNKNOWN_outcome_screen_timeout`). All `[STATIC]`, re-disassembled in full (187 instructions).
//
// Entry (`1C1B`/`1C30`/`1C35`): `[0x261F]=0` (a tick counter the timer ISR increments at `48D8`,
// alongside `[0x2]` at `48D4`) and the release latch cleared (`[0x107E]=0`/`[0x107F]=0`). Then the
// message is drawn and, by outcome code `CX`, one of two waits runs:
//
// **SIMPLE (CX 0/1/4/5, `1DE5-1E0F`).** Loop: if `[0x261F] >= 0x2BC` return (the timeout); XOR the
// blink bit, redraw, present, then `CALL 17FF` with `CX=0xF` -- `twoHuman.js`'s own
// `raceResultWaitStep` with `cx = 15`, BOTH players' fire combined (`17FF` sets `[0x1080]=0`), and
// its entry clears the release latch AGAIN (`180F`/`1814`), every call. `17FF` returns CLC on a
// release or a fresh fire press (leave the screen), STC after 16 ticks (loop). So the timeout is
// checked only between `17FF` windows, every 16 ticks: the first check at or past 700 is at 704.
//
// **LIVES (CX 2 ONE_LIFE_LOST / 3 EXTRA_LIFE, `1D0D-1DE2`).** `1D1F` re-zeroes `[0x261F]`. Each
// loop iteration: the same timeout check (`1D2B`), a blink/draw, then five `CALL 3165` (each waits
// for the one-byte counter `CS:[0x4ADE]` to change, which the timer ISR increments at `48CB`: one
// tick each), a present, the lives digits drawn at the next X. The first 30 iterations slide the
// digits 2px each (`BX` from `0x8C` to `0xC8`, or back) and loop straight back to `1D2B` with NO
// input poll at all. The 31st and every later iteration also waits one more tick (`1DBF-1DC6`) and
// then polls, in this order: `[0x107E]==0x1B` (the `]` key's own release) zeroes lives and returns
// (`1E12`, the developer cheat, both codes); any other release returns; P1's fire HELD returns --
// no debounce, and P1 ONLY: `[0x1080]` is not touched here, and inside a one-player tournament it
// is `0x137B` (P1's own reader block, `RunOnePlayerHeadToHeadVsCpu 0FD4`/`RunOnePlayerChallenge
// 104C`; a sweep of every `80 10` store found nothing else between those and `1C1B` except the
// `179B`/`17FF` push/pop pairs). The latch is NOT cleared again after entry, so a key released
// during the silent slide is still latched at the first poll and acted on then. First poll at tick
// 156, then every 6 ticks; the first iteration start at or past 700 is at 702.
//
// Live (docs/engine.md §9de, `[PROVEN]`): a real ONE LIFE LOST screen, with no fade (the results
// screen before it took it), read `[0x261F]`=156 at `1DCD`, the first poll -- so (a) and (c) held
// there. The assumptions as first written, `[STATIC]`: (a) `CS:[0x4ADE]` is also incremented by the INT 0Ah
// (vertical retrace) handler (`4AC5`); a slide iteration is 5 ticks only if that handler is not
// installed during this screen. (b) Both budgets include the first iteration's palette fade-up
// (`32CE`: 17 ticks when it runs, i.e. when this is the first screen after a race, docs/engine.md
// §9co/§9cp -- `flow.js` adds them to `ticks` after the fade) and the entry draws (not modelled). (c) Each iteration's draw
// work finishes inside one tick. None of the draw helpers waits on anything (`08BC` is a plain
// 51 KB `REP MOVSD`; `0DB0`/`0823`/`0929` and their blitters `053A`/`0999` contain no `0x3DA`
// retrace poll, no `CALL 3165` and no `[0x2]` spin -- byte sweeps for all three), but on slow
// hardware or low DOSBox cycles a 64000-byte present can exceed 14 ms, stretching each period by
// a tick. The exact tick numbers below hold under (a)-(c). The blink and the sliding lives digits
// themselves are render items, not modelled here.

import { OUTCOME } from './tournament.js'
import { windowedWaitInitialState, windowedWaitStep } from './windowedWait.js'

export const OUTCOME_TIMEOUT_TICKS = 0x2bc // 1D2B/1DE5's own comparand, against [0x261F]
export const OUTCOME_17FF_CX = 0xf // 1E09: MOV CX,0xF
export const OUTCOME_SLIDE_ITERATIONS = 30 // BX 0x8C..0xC8 step 2: 31 draws, the last of which polls
export const OUTCOME_SLIDE_ITERATION_TICKS = 5 // 1D6D: five CALL 3165
export const OUTCOME_CHEAT_KEY = 'BracketRight' // scancode 0x1B, 1DCD

export function outcomeWaitInitialState(code) {
  const lives = code === OUTCOME.ONE_LIFE_LOST || code === OUTCOME.EXTRA_LIFE
  // SIMPLE: the first 1DE5 check (0 < 700) passes at entry, so the first 17FF window is already open.
  if (!lives) return { path: 'SIMPLE', ticks: 0, window: windowedWaitInitialState({ cx: OUTCOME_17FF_CX }) }
  return { path: 'LIVES', ticks: 0, iteration: 0, left: OUTCOME_SLIDE_ITERATION_TICKS }
}

/**
 * One tick. `readInput()` is called only when the real code polls (so a release latched while it
 * doesn't poll stays latched, exactly like `[0x107E]`); it returns
 * `{ p1FireHeld, anyFireHeld, releasedCode }` -- `releasedCode` is the tracked key's own released
 * `KeyboardEvent.code`, or `null`. Returns `{ exit, resetLatch }`: `exit` is `null`, `'dismiss'`,
 * `'timeout'` or `'livesCheat'` (the caller zeroes lives, `applyLivesCheat`, then leaves the screen
 * -- `1E12` returns for both codes); `resetLatch` is the caller's cue to clear the release tracker
 * (a fresh `17FF` call's own `180F`/`1814`).
 */
export function outcomeWaitStep(state, readInput) {
  state.ticks++ // [0x261F], 48D8
  if (state.path === 'SIMPLE') {
    // 1DE5: the timeout check before every 17FF call (windowedWait.js, checkPeriod 1); CLC -> 1E0F
    // falls to RET, STC -> blink, redraw, the check, a fresh 17FF call
    const inp = readInput()
    const r = windowedWaitStep(state.window, { fireHeld: inp.anyFireHeld, anyKeyReleased: inp.releasedCode != null })
    return { exit: r.exit, resetLatch: r.resetLatch }
  }
  // LIVES
  if (--state.left > 0) return { exit: null, resetLatch: false }
  const polls = state.iteration >= OUTCOME_SLIDE_ITERATIONS
  if (polls) {
    const inp = readInput()
    if (inp.releasedCode === OUTCOME_CHEAT_KEY) return { exit: 'livesCheat', resetLatch: false } // 1DCD/1E12
    if (inp.releasedCode != null) return { exit: 'dismiss', resetLatch: false } // 1DD4
    if (inp.p1FireHeld) return { exit: 'dismiss', resetLatch: false } // 1DDB
  }
  state.iteration++
  if (state.ticks >= OUTCOME_TIMEOUT_TICKS) return { exit: 'timeout', resetLatch: false } // 1D2B, the next iteration's own start
  state.left = state.iteration >= OUTCOME_SLIDE_ITERATIONS ? OUTCOME_SLIDE_ITERATION_TICKS + 1 : OUTCOME_SLIDE_ITERATION_TICKS
  return { exit: null, resetLatch: false }
}
