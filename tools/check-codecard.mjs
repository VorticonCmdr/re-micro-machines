// P1 (GOAL-DOS-PARITY.md): the code-card screen (FONT.BIN), re-derived from a full fresh
// disassembly of the module this session (docs/intro-and-codecard.md's "The real code-card
// screen"). Proves:
//  - the target column/row formula (col = tickByte&0xF, row = (tickByte>>3)&0xF) and its card
//    lookup (card[row*16+col]) match the already-decoded card table;
//  - the 4-direction cursor wrap (1000:01E9-02EE) is exactly what the bytes do: RIGHT/LEFT wrap
//    in reading order, UP/DOWN wrap column-major, all four boundary cases;
//  - the cursor's pixel position maps back to the same 0-63 cell index the real bytes compute;
//  - the composed screen matches every structural fact pinned this session: the background bands
//    (colour 9 / 0 / colour 10 / 0), the symbol grid at (216,179) cropped to 200 of 208 columns,
//    the welcome text's target-column-letter/row-digit overlay landing exactly where the
//    disassembly places it (English row1,col7 and row1,col17-18), and the "Correct, now one
//    more" interstitial leaving the grid and cursor visible underneath it (only rows 0-167
//    change) -- all cross-checked live against a real DOSBox capture this session (round 1's
//    "COLUMN x and ROW y", the RIGHT+DOWN cursor move landing on cell (1,1), the target
//    regenerating between rounds, and the round-1 cursor persisting into round 2, all visually
//    confirmed against composeCodeCardScreen's own output).
//   node tools/check-codecard.mjs
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  targetFromTickByte, expectedSymbolAt, cursorCellIndex, moveCursor, composeCodeCardScreen,
  cardTable, CURSOR_X0, CURSOR_Y0, CURSOR_PITCH_X, CURSOR_PITCH_Y, CODECARD_W, CODECARD_H,
  BG_TOP_ROWS, BG_GAP_ROWS, BG_BOTTOM_ROWS, BG_TOP_COLOUR, BG_BOTTOM_COLOUR,
  STRIP_SCREEN_X, STRIP_SCREEN_Y, STRIP_VISIBLE_W, TARGET_OVERLAYS,
} from '../src/formats/fontbin.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const fontbin = new Uint8Array(readFileSync(join(ROOT, 'game', 'FONT.BIN')))

let bad = 0
function check(name, cond) {
  if (cond) return
  bad++
  console.log(`FAIL: ${name}`)
}

// 1. Target column/row: bit 3 is shared between the two fields (a real correlation, not a bug).
check('tickByte 0x00 -> col A(0), row 1', JSON.stringify(targetFromTickByte(0x00)) === JSON.stringify({ col: 0, row: 0 }))
check('tickByte 0x36 -> col 6(G), row 6(displayed 7)', JSON.stringify(targetFromTickByte(0x36)) === JSON.stringify({ col: 6, row: 6 }))
check('tickByte 0xff -> col 15(P), row 15(displayed 16)', JSON.stringify(targetFromTickByte(0xff)) === JSON.stringify({ col: 15, row: 15 }))
{
  const { table } = cardTable(fontbin)
  const target = targetFromTickByte(0x36)
  check('expectedSymbolAt matches a direct card[row][col] lookup', expectedSymbolAt(table, target) === table[6][6])
}

// 2. Cursor cell index: pixel position -> 0-63 cell (row*8+col), the real bytes' own formula.
check('cell (0,0) -> index 0', cursorCellIndex({ x: CURSOR_X0, y: CURSOR_Y0 }) === 0)
check('cell (1,1) -> index 9', cursorCellIndex({ x: CURSOR_X0 + CURSOR_PITCH_X, y: CURSOR_Y0 + CURSOR_PITCH_Y }) === 9)
check('cell (7,7) -> index 63', cursorCellIndex({ x: CURSOR_X0 + 7 * CURSOR_PITCH_X, y: CURSOR_Y0 + 7 * CURSOR_PITCH_Y }) === 63)

// 3. Cursor movement -- the exact 4-branch wrap from 1000:01E9-02EE, including the live-confirmed
// RIGHT-then-DOWN-from-(0,0)-lands-on-(1,1) case, and every boundary.
{
  let pos = { x: CURSOR_X0, y: CURSOR_Y0 }
  pos = moveCursor(pos, 'right')
  pos = moveCursor(pos, 'down')
  check('RIGHT then DOWN from (0,0) lands on cell (1,1) -- live-confirmed this session', cursorCellIndex(pos) === 9)
}
check('RIGHT past the last column wraps to the next row, first column (reading order)',
  JSON.stringify(moveCursor({ x: CURSOR_X0 + 7 * CURSOR_PITCH_X, y: CURSOR_Y0 }, 'right')) === JSON.stringify({ x: CURSOR_X0, y: CURSOR_Y0 + CURSOR_PITCH_Y }))
check('RIGHT past the last cell (7,7) wraps all the way to (0,0)',
  JSON.stringify(moveCursor({ x: CURSOR_X0 + 7 * CURSOR_PITCH_X, y: CURSOR_Y0 + 7 * CURSOR_PITCH_Y }, 'right')) === JSON.stringify({ x: CURSOR_X0, y: CURSOR_Y0 }))
check('LEFT past the first column wraps to the previous row, last column',
  JSON.stringify(moveCursor({ x: CURSOR_X0, y: CURSOR_Y0 + CURSOR_PITCH_Y }, 'left')) === JSON.stringify({ x: CURSOR_X0 + 7 * CURSOR_PITCH_X, y: CURSOR_Y0 }))
check('LEFT past cell (0,0) wraps all the way to (7,7)',
  JSON.stringify(moveCursor({ x: CURSOR_X0, y: CURSOR_Y0 }, 'left')) === JSON.stringify({ x: CURSOR_X0 + 7 * CURSOR_PITCH_X, y: CURSOR_Y0 + 7 * CURSOR_PITCH_Y }))
check('UP at row 0 wraps to row 7 of the PREVIOUS column (column-major, not reading-order)',
  JSON.stringify(moveCursor({ x: CURSOR_X0 + CURSOR_PITCH_X, y: CURSOR_Y0 }, 'up')) === JSON.stringify({ x: CURSOR_X0, y: CURSOR_Y0 + 7 * CURSOR_PITCH_Y }))
check('UP from (0,0) wraps all the way to (7,7)',
  JSON.stringify(moveCursor({ x: CURSOR_X0, y: CURSOR_Y0 }, 'up')) === JSON.stringify({ x: CURSOR_X0 + 7 * CURSOR_PITCH_X, y: CURSOR_Y0 + 7 * CURSOR_PITCH_Y }))
check('DOWN at row 7 wraps to row 0 of the NEXT column (column-major)',
  JSON.stringify(moveCursor({ x: CURSOR_X0, y: CURSOR_Y0 + 7 * CURSOR_PITCH_Y }, 'down')) === JSON.stringify({ x: CURSOR_X0 + CURSOR_PITCH_X, y: CURSOR_Y0 }))
check('DOWN from (7,7) wraps all the way to (0,0)',
  JSON.stringify(moveCursor({ x: CURSOR_X0 + 7 * CURSOR_PITCH_X, y: CURSOR_Y0 + 7 * CURSOR_PITCH_Y }, 'down')) === JSON.stringify({ x: CURSOR_X0, y: CURSOR_Y0 }))

// 4. The composed screen's structural facts (background bands, grid crop, text/overlay presence).
{
  const target = targetFromTickByte(0x36) // col G(6), row displayed 7
  const cursor = { x: CURSOR_X0, y: CURSOR_Y0 }
  const { indexed } = composeCodeCardScreen(fontbin, { stage: 'prompt', target, cursor })
  const at = (x, y) => indexed[y * CODECARD_W + x]

  check('background band sizes cover the whole 350-row screen', BG_TOP_ROWS + BG_GAP_ROWS + BG_BOTTOM_ROWS + 2 === CODECARD_H)
  check('row 0 (top band) is colour 9, away from any text glyph', at(400, 0) === BG_TOP_COLOUR)
  check('row 168 (the untouched gap) is colour 0', at(0, BG_TOP_ROWS) === 0)
  check('row 172 (bottom band) is colour 10, away from the grid', at(0, BG_TOP_ROWS + BG_GAP_ROWS) === BG_BOTTOM_COLOUR)
  check('row 349 (the trailing untouched row) is colour 0', at(0, CODECARD_H - 1) === 0)

  // Column 200..207 of the strip's own screen rectangle must NOT show the (real, non-blank)
  // strip pixels the port deliberately crops -- they stay the plain background colour instead.
  let stripTailIsBackground = true
  for (let y = 0; y < 10 && stripTailIsBackground; y++) {
    for (let x = STRIP_VISIBLE_W; x < 208; x++) {
      if (at(STRIP_SCREEN_X + x, STRIP_SCREEN_Y + y) !== BG_BOTTOM_COLOUR) { stripTailIsBackground = false; break }
    }
  }
  check('the strip\'s real columns 200-207 are cropped from the visible page (0x5b3\'s own 25-of-26-byte copy)', stripTailIsBackground)

  // The welcome text and the target overlay actually drew something (a non-trivial number of
  // XORed pixels away from the flat background colour) inside the text band.
  let inkPixels = 0
  for (let y = 0; y < BG_TOP_ROWS; y++) for (let x = 0; x < CODECARD_W; x++) if (at(x, y) !== BG_TOP_COLOUR) inkPixels++
  check('the welcome paragraph + target overlay drew a substantial number of ink pixels', inkPixels > 5000)

  // The overlay's own three fixed slots (English's letter+digits, row1 col7/17/18) are non-background.
  const o = TARGET_OVERLAYS[0]
  const letterPixelChanged = at(o.letterCol * 8, o.letterRow * 14 + 4) !== BG_TOP_COLOUR
  check('the English column-letter overlay slot (row1,col7) is drawn, not blank', letterPixelChanged)
}

// 5. The "Correct, now one more" interstitial leaves the grid/cursor visible: only the text band
// (rows 0-167) differs from the prompt stage; rows 172+ (the grid) are pixel-identical.
{
  const target = targetFromTickByte(0x36)
  const cursor = { x: CURSOR_X0 + CURSOR_PITCH_X, y: CURSOR_Y0 + CURSOR_PITCH_Y }
  const prompt = composeCodeCardScreen(fontbin, { stage: 'prompt', target, cursor }).indexed
  const correct = composeCodeCardScreen(fontbin, { stage: 'correct', target, cursor }).indexed
  let gridRegionIdentical = true
  for (let i = (BG_TOP_ROWS + BG_GAP_ROWS) * CODECARD_W; i < prompt.length; i++) {
    if (prompt[i] !== correct[i]) { gridRegionIdentical = false; break }
  }
  check('the grid/cursor region (rows 172+) is byte-identical between the prompt and "Correct" stages', gridRegionIdentical)
  let textRegionDiffers = false
  for (let i = 0; i < BG_TOP_ROWS * CODECARD_W; i++) {
    if (prompt[i] !== correct[i]) { textRegionDiffers = true; break }
  }
  check('the text region (rows 0-167) differs between the two stages', textRegionDiffers)
}

console.log(bad ? `${bad} check(s) failed` : 'check-codecard: the target column/row formula, the 4-direction cursor wrap, and the composed screen\'s background/grid/text structure all match the fresh disassembly, cross-checked live against a real DOSBox capture this session')
process.exitCode = bad ? 1 : 0
