// The tournament board screen (`DrawTournamentBoard 1000:18d8`, GOAL-DOS-PARITY.md P3's first
// item, docs/engine.md §9ay). Pure step function, same architecture as attract.js/frontMenu.js/
// charSelect.js: `boardInitialState()`/`boardStep(state, input)`.
//
// When it is shown (`SetupTournamentRace 1000:115c`, fully re-disassembled this session): before
// every race's own intro EXCEPT the qualifier (`[28c1]==0`, `18d8`'s own internal early RET) and
// EXCEPT the very last race (`[28c1]==[439]`, the champion decider) -- and ONLY in the Challenge
// (4-car) format; `115c` checks `[3f8]==1` (two-car/H2H) and skips the whole `CALL 18d8` before
// ever reaching it, so the two-car format never shows this screen at all. `tournament.js`'s
// `shouldShowBoard`/`effectiveRaceIndex` are `115c`'s own three-way gate, transcribed directly (not
// `18d8`'s internal one alone), including the pending-bonus-race index correction their own header
// comment explains.
//
// What it shows, once entered (`18d8` -> its helper `FUN_1000_198e`): CASE.CHR/CASE.MAP's "vehicle
// display case" background, then one MINATURE.CHR icon per race in `ORDER_TABLE[1..raceIndex]`,
// where `raceIndex` (`tournament.js`'s `effectiveRaceIndex`) is generally the race ABOUT TO run, not
// one already finished -- so the newest icon is a PREVIEW of the upcoming race's own class, not a
// trophy for the last one (see `screens.js`'s `drawTournamentBoard` for the one exception: a
// pending bonus race, where it genuinely is the just-completed race, since round 9 itself is never
// in `ORDER_TABLE` and gets no icon of its own).
//
// The newest icon blinks, and the screen waits, through `1000:17FF` (docs/engine.md §9br,
// `windowedWait.js`): `1902` present, `CALL 17FF` with CX=0x23 -- CLC leaves the screen, STC erases
// the icon (`RestoreSpriteBackground 05B4`), presents, `CALL 17FF` again -- CLC leaves, STC redraws
// the icon (`ClipAndBlitSpriteTransparent 04B8`), compares `[0x261F]` with 0x2BC (`1921`) and leaves
// if reached, else loops. Each `17FF` window is CX+1 = 36 ticks (`BOARD_BLINK_HALF_PERIOD_TICKS`);
// the timeout is sampled only after every 2nd window, so it lands on tick 720, not 700. `17FF`
// itself (`twoHuman.js` `raceResultWaitStep`): both players' fire combined, the release latch
// cleared at every window's entry, any key release or a FRESH fire press leaves; a fire already
// held keeps it waiting for the release, and the window's ticks keep counting meanwhile, so a held
// fire neither dismisses the board nor stops its blink or its timeout.
//
// **CORRECTED 2026-09-25 (§9br).** This file used to model the wait with its own
// `AWAIT_RELEASE`/`POLL` idiom instead of `17FF`, and said the real routine could "(rarely) skip
// the board" on a fire held from the previous screen. That was wrong: under `17FF` a held fire
// never dismisses. The old idiom also stopped counting ticks while fire was held, freezing the blink
// and the timeout; `17FF` does not.
//
// **The bonus-race reveal (`1000:192B-198B`)**, the ALWAYS-taken path whenever a pending bonus race
// is about to run (`TriggerBonusRace 1000:1a82` calls `115c` with `[28BF]` already forced to 9, so
// `18d8`'s own `CMP [28BF],9/JZ 192b` fires every time): its DRAWING is not ported -- it repeatedly
// draws 8 more MINATURE.CHR icons at two fixed columns across four rows, then redraws the whole
// `ORDER_TABLE[1..raceIndex]` icon list, with frame indices 0x20-0x27 (32-39), the last two of
// which read past `MINATURE.CHR`'s own real 38-frame table (`chr.js`'s `CHR_TABLE`, frames 0-37), a
// genuine benign out-of-bounds read in the shipped game. This port shows the SAME single-icon
// blink for it. Its WAIT is ported: the same two 36-tick `17FF` windows per cycle, but the
// `[0x261F]` check (`1971`) comes after the FIRST window of each pair, not the second, so it times
// out on tick 756, not 720 (`boardInitialState({ bonusReveal: true })`).
import { windowedWaitInitialState, windowedWaitStep } from './windowedWait.js'

export const BOARD_17FF_CX = 0x23 // 1905/1916/1969/1985: MOV CX,0x23
export const BOARD_BLINK_HALF_PERIOD_TICKS = BOARD_17FF_CX + 1 // 36: 17FF's own window is CX+1 ticks
export const BOARD_TIMEOUT_TICKS = 0x2bc // ~10s, [261F] -- sampled after every 2nd window (1921), or after every 1st (1971, the bonus reveal)

export function boardInitialState({ bonusReveal = false } = {}) {
  return { blinkOn: true, window: windowedWaitInitialState({ cx: BOARD_17FF_CX, checkPeriod: 2, checkOffset: bonusReveal ? 1 : 0 }) }
}

/** One tick. `input`: `{ fireHeld, anyKeyReleased }`. Returns `windowedWaitStep`'s own
 * `{ exit, resetLatch, windowEnded, timeoutChecked }`; `state.blinkOn` flips at every window end. */
export function boardStep(state, input = {}) {
  const r = windowedWaitStep(state.window, input)
  if (r.windowEnded && !r.exit) state.blinkOn = !state.blinkOn // 1910 erase / 191E redraw
  return r
}
