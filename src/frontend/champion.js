// The champion screen's own wait, `ShowChampionScreenTune3 1000:1AAD-1C1A` (docs/engine.md §9bs,
// GOAL-DOS-PARITY.md P3's champion-screen bullet). All `[STATIC]`, disassembled in full (127
// instructions).
//
// Setup: tune 3, `[0x3AA]=0xFF50` (-176) and `[0x3AC]=0x100` (256), the two text lines' X, and
// `[0x2]=0x32` so the first iteration blinks at once. Then a loop (`1B2B`): blink the character
// when `[0x2] >= 0xF`; draw it; draw line 1 at `[0x3AA]` and step it +2 unless it is already
// `0x28`; draw the cup; draw line 2 at `[0x3AC]` and step it -2 unless it is already `0x68`;
// `PaletteFadeUpFromBlack 32CE` (it only fades while `[0x26CE]==1` and clears that flag, so in
// practice only on the first iteration); present (`08BC`). While either line is not yet in place
// (`1BD8-1BE4`) it restores the background and loops with NO input poll and NO tick wait. Once both
// are in place it sets `[0x1080]=0` (`1BF8`, both players' readers ORed), waits one tick
// (`1BFE-1C05`), polls (`2D5B`) and leaves when `[0x108B]!=0` (`1C0B`): ANY bit the readers set
// (`2D5B` writes `[0x108B]` straight from the reader routines' byte), from either player: the five
// control bits AND the three extra keys the keyboard readers' byte also carries (`2DFA`/`2DFE`
// return whole bytes of the ISR's key word -- F1/F2/F3 for KEYS 1, D/SPACE/V for KEYS 2, at
// 0x04/0x02/0x01; docs/engine.md §9bt, correcting M3.73's own "five bits" inference). flow.js
// reads them with `createExtraKeysReader`. There is no release-latch test and no timeout.
//
// Line 1 needs (0x28 - -0xB0) / 2 = 108 steps, line 2 (0x100 - 0x68) / 2 = 76, so the 108th
// iteration is the first to find both in place, and its own tick wait and poll are the first ones.
// The slide's iterations wait on nothing (no `3165`, no `[0x2]` spin, no `0x3DA` poll in any of its
// calls -- unlike `256E`'s 22-iteration slide, which waits a tick per iteration via `3165` at
// `2685`), so on DOS they run as fast as the CPU draws them. Measured live (docs/engine.md §9db,
// closing `UNKNOWN_champion_slide_duration`): from the entry `1AAD` to `1BF4`, the end of iteration
// 108, took 148 ticks of `[28F7]` in DOSBox, with no fade (`[26CE]` was 0; the results screen
// before it had taken the fade-up). That is DOSBox's CPU speed, not a constant in the game; the port
// uses it, as it uses the fades' measured 16/17 ticks (§9co). The first poll follows `1BFE`'s
// one-tick wait: tick 149.
//
// The blink, the cup, the character's own Y slide (`0x62` down to `0x35`) and both text slides are
// render items, not drawn by the port (it shows a static screen).

export const CHAMPION_LINE1_START = -0xb0 // [0x3AA] = 0xFF50
export const CHAMPION_LINE1_END = 0x28
export const CHAMPION_LINE2_START = 0x100 // [0x3AC]
export const CHAMPION_LINE2_END = 0x68
export const CHAMPION_SLIDE_ITERATIONS = 108 // the iteration whose own poll is the first one
export const CHAMPION_SLIDE_TICKS = 148 // [PROVEN] live: 1AAD -> 1BF4 ([28F7] 19371 -> 19519), DOSBox's CPU

export function championInitialState() {
  return { tick: 0, iteration: 0, line1: CHAMPION_LINE1_START, line2: CHAMPION_LINE2_START }
}

/** One slide iteration: step each line unless already in place (1B67/1B6E, 1BC2/1BC9). */
function slideIteration(state) {
  state.iteration++
  if (state.line1 !== CHAMPION_LINE1_END) state.line1 += 2
  if (state.line2 !== CHAMPION_LINE2_END) state.line2 -= 2
}

/**
 * One tick. The 108 slide iterations are spread over the measured 148 ticks; once they are done the
 * next tick is `1BFE`'s wait and the poll, and every tick after that polls. `readInput()` is called
 * only when the real code polls; it returns `{ controlBits }`, both players' reader bytes ORed
 * (`[0x108B]` with `[0x1080]=0`). Returns `{ exit: null | 'dismiss', polled }`. No timeout exists.
 */
export function championStep(state, readInput) {
  state.tick++
  const due = Math.min(CHAMPION_SLIDE_ITERATIONS, Math.floor((state.tick * CHAMPION_SLIDE_ITERATIONS) / CHAMPION_SLIDE_TICKS))
  while (state.iteration < due) slideIteration(state)
  if (state.tick <= CHAMPION_SLIDE_TICKS) return { exit: null, polled: false } // 1BD8-1BF1: still sliding
  const { controlBits } = readInput() // 1BF8-1C07: [0x1080]=0, one tick, 2D5B
  return { exit: controlBits !== 0 ? 'dismiss' : null, polled: true } // 1C0B
}
