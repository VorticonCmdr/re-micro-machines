// The race HUD (`DrawRaceHudDigitsAndRankIcons 1000:8dfc`), docs/engine.md §9o/§9p.
//
// Layout (all re-derived live from 8dfc/903f/905f, in VIEW coordinates -- i.e. (0,0) is the
// visible race view's own top-left, screen x=32): a standalone lap-count digit for the
// human/tracked car (car slot 0, `[0x2660]`, never re-sorted) at (8,0); then one row per rank 1-4
// at y=16,32,48,64, each pairing that rank's car's recoloured 16×16 helmet icon (or the finish-flag
// icon once that car's own lapsRemaining reaches 0) at x=0 with the LITERAL rank digit (never a car
// field) at x=16 -- both digit draws use the same plain (non-recoloured) 8×16 font, confirmed live
// at DrawPh0Glyph8x16ByIndex 1000:905f -> BlitSpriteAtBufferOffset 1000:8d09.
//
// Ranking: this draws `car.racePosition` as `step.js`'s `computeRanking` leaves it -- the same
// scoring, persistent bubble sort and PREFIX freeze (slots up to the last finished car pinned, the
// rest still ranked live; everything pinned once [26C6] >= 2) that 8e10-8e8c computes in the real
// game, run once per physics step exactly as the real render is (docs/engine.md §9ah, correcting the
// "uniform freeze, not ported" account this comment used to give).

import { ph0Icon16, ph0Digit, PH0_LAYOUT, remapHudIconColours } from '../formats/race.js'
import { blitTransparent } from './blit.js'

const ROW_Y = [16, 32, 48, 64] // 1000:8ea6/8ebf/8ed8/8ef1 minus the buffer's (16,16) origin
const ICON_X = 0
const DIGIT_X = 16
const TOP_DIGIT_X = 8 // shared by branch C (8e92) and branch B (8fab) -- both are literally `DI=0x1118`
const TOP_DIGIT_Y = 0

function blitPlainDigit(dst, w, h, x, y, ph0, value) {
  blitTransparent(dst, w, h, x, y, ph0Digit(ph0, value))
}

/** `cars`: the 4-car array (car 0 = the fixed HUD "top digit" car, `[0x2660]`, never re-sorted). */
export function drawHud(dst, w, h, cars, ph0) {
  blitPlainDigit(dst, w, h, TOP_DIGIT_X, TOP_DIGIT_Y, ph0, cars[0].lapsRemaining)

  for (let rank = 1; rank <= 4; rank++) {
    const car = cars.find((c) => c.racePosition === rank)
    if (!car) continue
    const y = ROW_Y[rank - 1]
    const iconOffset = car.lapsRemaining <= 0 ? PH0_LAYOUT.icons.flag : PH0_LAYOUT.icons.warning
    const icon = ph0Icon16(ph0, iconOffset)
    const recoloured = { width: icon.width, height: icon.height, indexed: remapHudIconColours(icon.indexed, car.colourOffset ?? 0) }
    blitTransparent(dst, w, h, ICON_X, y, recoloured)
    blitPlainDigit(dst, w, h, DIGIT_X, y, ph0, rank)
  }
}

// --------------------------------------------------------------------------------------- Branch A
// Round 9 (RUFFTRUX) countdown, `8ff5-903e` (docs/engine.md §9p). A completely different, unrelated
// display: no rank icons at all, just a 3-digit counter with an odd "blinking colon" glyph. Its own
// layout, NOT the 24px column above (own named constants, on purpose -- see docs/engine.md §9p's
// method note: conflating the three branches' layouts under one shared constant is exactly the kind
// of mistake this project's evidence discipline exists to catch).
const RUFFTRUX_Y = 8
const RUFFTRUX_HUNDREDS_X = 8 // 1000:9037, DI=0x1998
const RUFFTRUX_TENS_X = 16 // 1000:9025, DI=0x19a0
const RUFFTRUX_BLINK_X = 24 // 1000:9013, DI=0x19a8 -- drawn only when the ones digit is non-zero
const RUFFTRUX_ONES_X = 32 // 1000:9005, DI=0x19b0
const RUFFTRUX_BLINK_GLYPH = 10 // PH0_LAYOUT.digits' 11th glyph

/**
 * `ticks`: the live analogue of `[26C8]` -- this port's `raceState.ruffTruxTimer` (`states.js`,
 * docs/engine.md §9p), decremented up to 4× per physics step to match the real game's per-car-slot
 * dispatch. The displayed value is `ticks >> 4` (`1000:8ff8`), decomposed into up to 3 decimal
 * digits (only the last 3 are ever shown, `1000:8ffb-9037` -- three chained `DIV 10`s, the 4th
 * quotient is computed and discarded); the "blink" glyph (index 10) sits between the tens and ones
 * columns and is drawn only when the ones digit is non-zero -- confirmed live by tracing
 * `905f`'s own CX clobber past the naive decompiler reading (docs/engine.md §9p): `CMP CX,5` at
 * `900b` is testing `(ones_digit<<7)`, not the ones digit itself, so the real predicate is
 * "ones digit != 0", not "≥5".
 */
export function drawRuffTruxCountdown(dst, w, h, ticks, ph0) {
  let v = Math.max(0, ticks) >> 4
  const ones = v % 10
  v = (v / 10) | 0
  const tens = v % 10
  v = (v / 10) | 0
  const hundreds = v % 10

  blitPlainDigit(dst, w, h, RUFFTRUX_ONES_X, RUFFTRUX_Y, ph0, ones)
  if (ones !== 0) blitPlainDigit(dst, w, h, RUFFTRUX_BLINK_X, RUFFTRUX_Y, ph0, RUFFTRUX_BLINK_GLYPH)
  blitPlainDigit(dst, w, h, RUFFTRUX_TENS_X, RUFFTRUX_Y, ph0, tens)
  blitPlainDigit(dst, w, h, RUFFTRUX_HUNDREDS_X, RUFFTRUX_Y, ph0, hundreds)
}

// --------------------------------------------------------------------------------------- Branch B
// Two-car (head-to-head) format, `8f03-8ff3` (docs/engine.md §9p). Standalone digit = the leading
// car's own lapsRemaining (same slot as branch C, `DI=0x1118`); an 8-light vertical bar at the
// SAME column branch C's rank-1 icon uses (x=0, first light y=16, step 16 -- one light per row,
// branch B has no per-rank icons to compete for that space).
//
// `[26B4]` is the persistent 0-8 tug-of-war match score (seeded 4 = tied, 3C3A): +1 when P1 (car 0)
// scores an exchange, -1 for P2 (car 1), 8 or 0 ends the match -- the match machine is
// `src/engine/twocar.js` (docs/engine.md §9am). The bottom `[26B4]` lights are RED (`PH0+0x1A00`,
// P1's end) and the top `8-[26B4]` are BLUE (`PH0+0x1B00`, P2's end). The bar reads `[26B4]` only;
// during an exchange's 64-step blink `[26B4]` itself is swapped with its shadow `[26B6]` every 8
// steps, which is what makes the bar flash between the old and new score. Neither colour is
// recoloured per car -- both are plain blits straight off `8d09`.
const LIGHT_X = 0
const LIGHT_Y0 = 16
const LIGHT_Y_STEP = 16
const LIGHT_COUNT = 8

/**
 * `lightScore`: `raceState.twoCar.score` ([26B4]). `rankOrder`: the order array -- the top digit is
 * the lapsRemaining of whatever record sits in slot 0 (8FAB), which after the finish block's
 * rewrite (4C6F) can be the absent car 2 (laps 3), faithfully.
 */
export function drawTwoCarHud(dst, w, h, cars, ph0, lightScore = 4, rankOrder = [0, 1, 2, 3]) {
  const leading = cars[rankOrder[0]] ?? cars[0]
  blitPlainDigit(dst, w, h, TOP_DIGIT_X, TOP_DIGIT_Y, ph0, leading.lapsRemaining)

  for (let row = 1; row <= LIGHT_COUNT; row++) {
    const cx = LIGHT_COUNT + 1 - row // 8,7,...,1 -- the real loop's own countdown register
    const offset = cx > lightScore ? PH0_LAYOUT.lights.blue : PH0_LAYOUT.lights.red
    blitTransparent(dst, w, h, LIGHT_X, LIGHT_Y0 + (row - 1) * LIGHT_Y_STEP, ph0Icon16(ph0, offset))
  }
}
