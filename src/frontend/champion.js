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
// (`1BFE-1C05`), polls (`2D5B`) and leaves when `[0x108B]!=0` (`1C0B`): ANY control bit held
// (left/right/accelerate/brake/fire; `2D5B` writes `[0x108B]` straight from the reader routines'
// control byte), from either player. There is no release-latch test and no timeout.
//
// Line 1 needs (0x28 - -0xB0) / 2 = 108 steps, line 2 (0x100 - 0x68) / 2 = 76, so the 108th
// iteration is the first to find both in place, and its own tick wait and poll are the first ones.
// **The slide's DURATION is not derivable** (`UNKNOWN_champion_slide_duration`): its iterations
// wait on nothing (no `3165`, no `[0x2]` spin, no `0x3DA` poll in any of its calls -- unlike
// `256E`'s 22-iteration slide, which waits a tick per iteration via `3165` at `2685`), so on DOS
// they run as fast as the CPU draws them, plus the first iteration's fade (`UNKNOWN_fade_duration`).
// The port runs one iteration per tick (~1.5s for the slide), a port choice, not a measurement: an
// upper bound under the project's own assumption that each draw fits in a tick. Zero would let a
// held control key skip the screen instantly, which DOS never does.
//
// The blink, the cup, the character's own Y slide (`0x62` down to `0x35`) and both text slides are
// render items, not drawn by the port (it shows a static screen).

export const CHAMPION_LINE1_START = -0xb0 // [0x3AA] = 0xFF50
export const CHAMPION_LINE1_END = 0x28
export const CHAMPION_LINE2_START = 0x100 // [0x3AC]
export const CHAMPION_LINE2_END = 0x68
export const CHAMPION_SLIDE_ITERATIONS = 108 // the iteration whose own poll is the first one

export function championInitialState() {
  return { iteration: 0, line1: CHAMPION_LINE1_START, line2: CHAMPION_LINE2_START }
}

/**
 * One iteration (one tick in the port). `readInput()` is called only when the real code polls; it
 * returns `{ controlBits }`, both players' reader bytes ORed (`[0x108B]` with `[0x1080]=0`).
 * Returns `{ exit: null | 'dismiss', polled }`. No timeout exists.
 */
export function championStep(state, readInput) {
  state.iteration++
  if (state.line1 !== CHAMPION_LINE1_END) state.line1 += 2 // 1B67/1B6E
  if (state.line2 !== CHAMPION_LINE2_END) state.line2 -= 2 // 1BC2/1BC9
  if (state.line1 !== CHAMPION_LINE1_END || state.line2 !== CHAMPION_LINE2_END) return { exit: null, polled: false } // 1BD8-1BF1
  const { controlBits } = readInput() // 1BF8-1C07: [0x1080]=0, one tick, 2D5B
  return { exit: controlBits !== 0 ? 'dismiss' : null, polled: true } // 1C0B
}
