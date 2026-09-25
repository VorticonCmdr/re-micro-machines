// P3's third item (GOAL-DOS-PARITY.md, docs/engine.md §9ba): ShowCharacterEliminatedTune6
// 1000:16de's own 17-step bounce animation. Pure step function, same architecture as
// attract.js/board.js: `eliminationInitialState()`/`eliminationStep(state)`.
//
// Fully re-disassembled and independently re-verified this session (77 instructions, `1000:16de`-
// `1000:179a`): tune 6 plays ONCE at entry (`1000:16E4`/`16F1`, query-then-play), then the roster's
// own `|0x20` (eliminated) bit is set, the victim's own slot descriptor is REBOUND from FCNORMAL to
// FCSAD.CHR (`1000:173D-1741`, confirmed live this session by reading `DS:0A3A` -- the
// `chrDescriptorTable`'s own record-1 segment field -- against `chr.js`'s own FCSAD `arenaOffset`:
// exact match, and FCSAD's 22 frames = 11 characters x 2 fits the `charIndex*2`/`charIndex*2+1`
// frame math below, where FCNORMAL's 14 frames would not), then the 17-byte wobble curve at
// `DS:034B` (`[2,4,8,16,32,47,32,16,8,4,2,4,8,16,32,47,0]`, 0-terminated) drives 16 REAL steps
// (the 17th byte is only ever read as a "stop" test, `1000:1757/1759`, never drawn or waited on):
// each step adds the table value to a FIXED baseline Y (not cumulative -- the baseline is restored
// after each write, `1000:1755`), toggles the sprite's own frame bit (`1000:175B`, alternating
// `charIndex*2`/`charIndex*2+1`), draws, and waits a LITERAL 9 ticks (`1000:177F/1784: CMP
// [0x2],0x9 / JL`) before the next step -- no input is polled anywhere inside this loop; it always
// runs to completion once started, confirmed by there being no `CALL 2D5B` (the input-poll routine
// every OTHER menu wait in this project calls) anywhere in the loop body.
//
// **Correcting an earlier session's own docs/engine.md §9t claim**: "a short tone plays" per
// wobble step is NOT supported by the bytes -- the only sound-driver calls in the whole function
// are the two at entry (tune 6 query/play); every call inside the per-step loop
// (`ClipSpriteDescToFrontView`/`BlitSpriteTransparentFlipSaveUnder`/`CopyFrontViewRowsToVga`/
// `RestoreSpriteBackground`) is a graphics routine. Each step is silent.
//
// **The icon also SQUASHES, resolved (an earlier `UNKNOWN_elimination_bounce_clip_band` wrongly
// blamed `CopyFrontViewRowsToVga 1000:089C`'s own partial-band present for this -- that function's
// literal params, re-disassembled fully this pass, turned out to be a plain "only present rows
// 32-91 of the WHOLE screen per refresh, for speed" optimization with no visible clipping effect at
// all, since the bounce never reaches row 92 -- a genuine red herring, not the mechanism).** The
// REAL mechanism, independently re-disassembled and cross-checked against three separate functions:
// `1000:1763: CALL 0630` (`ClipSpriteDescToFrontView`) resets the sprite's own drawn-row count
// (`[BX+0x19]`) to its full height (48) every step, since baseline+offset never nears the real
// screen's own 200-row bound; `1000:1767: SUB byte [BX+0x19],AL` (AL = the JUST-READ wobble offset)
// immediately shrinks that count by the current step's own offset, BEFORE the draw; `1000:176A:
// CALL 04BD` (`BlitSpriteTransparentFlipSaveUnder`) then draws exactly `[BX+0x19]` rows counted
// from the sprite's own TOP (`04D2: MOV CH,byte ptr [BX+0x19]`, the draw loop's own outer counter).
// Net effect: the icon's own Y position still moves DOWN each step (baseline+offset, unchanged from
// the original reading), but its VISIBLE bottom edge stays pinned at baseline+48 (the panel row's
// own "floor") throughout -- the icon appears to SINK INTO that floor, squashing down to just 1
// visible row at the deepest point of each dip (offset 47 of 48), rather than moving as one whole
// sprite. Ported in `screens.js`'s `drawEliminatedScreen` via a new `cropRows` option on
// `blitChr`/`blitTransparent` (`src/render/menuView.js`/`blit.js`).
export const WOBBLE_TABLE = [2, 4, 8, 16, 32, 47, 32, 16, 8, 4, 2, 4, 8, 16, 32, 47] // DS:034B's own 16 real steps (the 17th byte is the 0 terminator, never itself drawn)
export const WOBBLE_STEP_TICKS = 9 // 1000:177F/1784, literal, not approximate

export function eliminationInitialState() {
  // `frameOn: true` (not false): the real loop toggles the frame BEFORE every draw, including the
  // first (`1000:175B`, ahead of `0630`/`04BD`) -- so the FIRST rendered frame is already
  // `charIndex*2+1`, not the pre-loop `charIndex*2` (which is set but never itself drawn, 1000:1744).
  // `done: false` is explicit, latched state (not re-derived from `step`/`ticks` each call): without
  // it, calling `eliminationStep` again after done would wait another full `WOBBLE_STEP_TICKS`
  // before re-signalling done, since the tick-counting logic below runs unconditionally. `flow.js`'s
  // own wired usage never actually calls it again once done (the RAF loop stops itself on the same
  // tick `done` first comes back, `eliminationTick`'s own `if (!eliminationBounceDone)` guard) -- so
  // this latch is defensive robustness for any OTHER caller (this file's own test calls it again
  // deliberately, to prove the latch), not a fix for an observed `flow.js` bug.
  return { step: 0, ticks: 0, frameOn: true, done: false }
}

/** No input parameter: the real loop never polls input (see header). Returns `{ done }` -- once
 * `done`, the caller (`flow.js`) waits for a player confirm OR `1000:179B`'s own real ~700-tick
 * timeout (`src/frontend/keyWait.js`, docs/engine.md §9ba/§9bn) before entering the replacement
 * picker.
 *
 * `state.done` latches (checked first, before the tick-counting logic) so a call after the bounce
 * finishes returns `done` immediately rather than waiting another full `WOBBLE_STEP_TICKS`.
 * `state.step` freezes at `WOBBLE_TABLE.length-1` (15), never advances to 16 -- but callers must
 * NOT draw the icon at all once `done` (`screens.js`'s `drawEliminatedScreen` takes its own `done`
 * parameter for exactly this). A first fix attempt froze the icon at its own last bounced position
 * (offset 47) instead -- WRONG, caught by re-disassembling the loop's own per-step drawing
 * sequence: `1763 CALL 0630` (clip) -> `176A CALL 04BD` (blit, saving the pixels it overwrites) ->
 * `1773 CALL 089C` (present a partial row band to real VGA) -> `1776 CALL 05B4`
 * (`RestoreSpriteBackground` -- fully re-disassembled: copies the saved "under" pixels back,
 * genuinely ERASING the sprite from the work buffer) -- run EVERY iteration, including the last, so
 * the icon is already gone from the work buffer the instant the loop exits (`1000:1759`). Nothing
 * between the loop's exit and the real game's own next full-screen present (`1000:1790: CALL 08BC`,
 * a plain, unambiguous 200-row copy -- re-disassembled and NOT the same function as the loop's own
 * partial-band `089C`, despite sharing a copy-loop shape) draws anything new, so that present shows
 * the screen WITHOUT the icon: it vanishes the instant the bounce settles, not a beat later. */
export function eliminationStep(state) {
  if (state.done) return { done: true }
  state.ticks++
  if (state.ticks < WOBBLE_STEP_TICKS) return { done: false }
  state.ticks = 0
  if (state.step >= WOBBLE_TABLE.length - 1) { state.done = true; return { done: true } } // the last real draw (index 15) already happened -- freeze here, don't advance past it
  state.step++
  state.frameOn = !state.frameOn
  return { done: false }
}
