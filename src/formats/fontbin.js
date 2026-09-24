// FONT.BIN — not a font. It is the code-card copy-protection module: x86 code that MICROU.EXE
// loads at startup (LoadAndRunFontBinCodeCard, Ghidra 1000:31f0) into segment 2424 and far-calls
// with AX=0; it returns AX=0 (pass) or 0xFFFF (fail), and real_entry exits to DOS on non-zero.
// Everything the module draws is embedded in it; offsets below are FILE offsets (the module is
// loaded at offset 0 of its segment, so file offset == segment offset). Derived by ndisasm of
// the module and documented in docs/intro-and-codecard.md.
//
// Graphics are EGA/VGA mode 10h (640×350×16) planar bitmaps: 4 consecutive planes, each
// bytesPerRow × rows bytes, MSB-first, plane p contributes bit p of the pixel's 4-bit index.
//   symbol strip  @0x26CA, 26 bytes/row × 162 rows → 208×162 (the framed 8×8 grid of 64 symbols)
//   cursor        @0x256A,  4 bytes/row ×  22 rows →  32×22 (rounded white frame)
//   palette       @0x689A, 16 attribute-controller bytes (rgbRGB) — the one set when the screen shows
//   card table    @0x68CC, 16×16 bytes: expected symbol index (0..63) for [row*16 + column]
//   card pointers @0x68BA, 8 words; entry AX selects a card, only entry 0 points at a real table
// In this copy the two compare sites (+0xAB, +0x13A) are patched to `MOV AL,DL` + jump/NOPs,
// so any answer passes; the card table is still intact and is what the physical code card printed.

import { toU8, u16le } from './bytes.js'
import { BIOS_FONT_8X14, FONT_GLYPH_W, FONT_GLYPH_H } from '../data/bios-font-8x14.js'

export const FONTBIN_SIZE = 27084

export const SYMBOL_STRIP = { offset: 0x26ca, bytesPerRow: 0x1a, rows: 0xa2 }
export const CURSOR = { offset: 0x256a, bytesPerRow: 4, rows: 0x16 }
export const PALETTE_FINAL = 0x689a
export const PALETTE_INIT = 0x68aa
export const CARD_POINTERS = 0x68ba
export const CARD_TABLE = 0x68cc
export const CARD_SIZE = 16

/**
 * Grid geometry. cols/rows and the 20×18 pitch come from the cursor-movement code (+0x1E9..);
 * cellX/cellY are the strip-relative origin of cell (0,0), MEASURED from the decoded bitmap
 * (ink column centres 30,50,…,170 and row centres 12,30,…,138 → cells start at (20,3)).
 * The module blits the strip at screen (216,179) and starts the cursor at (226,181), which
 * would put cell (0,0) at strip (10,2) — 10 px left of where the symbols actually are; how the
 * cursor frame lines up on screen is UNKNOWN_codecard_cursor_origin (needs a live look).
 */
export const GRID = { cols: 8, rows: 8, pitchX: 20, pitchY: 18, cellX: 20, cellY: 3, stripX: 216, stripY: 179, cursorX: 226, cursorY: 181 }

/** Attribute-controller 6-bit rgbRGB → 8-bit RGB (bits: 5=r 4=g 3=b intensity, 2=R 1=G 0=B). */
export function ega6ToRgb(v) {
  const r = ((v >> 2) & 1) * 0xaa + ((v >> 5) & 1) * 0x55
  const g = ((v >> 1) & 1) * 0xaa + ((v >> 4) & 1) * 0x55
  const b = (v & 1) * 0xaa + ((v >> 3) & 1) * 0x55
  return [r, g, b]
}

/** 16-entry palette as a 256×3 table (indices ≥16 unused) so it plugs into indexedToRgba. */
export function fontbinPalette(data, at = PALETTE_FINAL) {
  const bytes = toU8(data)
  const rgb = new Uint8Array(256 * 3)
  for (let i = 0; i < 16; i++) {
    const [r, g, b] = ega6ToRgb(bytes[at + i])
    rgb[i * 3] = r; rgb[i * 3 + 1] = g; rgb[i * 3 + 2] = b
  }
  return rgb
}

/** Decode a 4-plane MSB-first bitmap into 4-bit indices. */
export function decodePlanar(data, { offset, bytesPerRow, rows }) {
  const bytes = toU8(data)
  const width = bytesPerRow * 8
  const indexed = new Uint8Array(width * rows)
  const planeSize = bytesPerRow * rows
  for (let p = 0; p < 4; p++) {
    const base = offset + p * planeSize
    for (let y = 0; y < rows; y++) {
      for (let bx = 0; bx < bytesPerRow; bx++) {
        const byte = bytes[base + y * bytesPerRow + bx]
        if (!byte) continue
        for (let bit = 0; bit < 8; bit++) if (byte & (0x80 >> bit)) indexed[y * width + bx * 8 + bit] |= 1 << p
      }
    }
  }
  return { width, height: rows, indexed }
}

export const symbolStrip = (data) => decodePlanar(data, SYMBOL_STRIP)
export const cursorSprite = (data) => decodePlanar(data, CURSOR)

/** The physical code card: card[row][col] = symbol index 0..63; columns are lettered A–P, rows numbered 1–16. */
export function cardTable(data, card = 0) {
  const bytes = toU8(data)
  const base = u16le(bytes, CARD_POINTERS + card * 2)
  const table = []
  for (let r = 0; r < CARD_SIZE; r++) table.push(Array.from(bytes.subarray(base + r * CARD_SIZE, base + (r + 1) * CARD_SIZE)))
  return { base, table }
}

/** Cut symbol `index` (0..63, row-major over the 8×8 grid — DL = row*8+col in the module) out of the strip. */
export function symbolCell(strip, index) {
  const col = index % GRID.cols
  const row = Math.floor(index / GRID.cols)
  const x0 = GRID.cellX + col * GRID.pitchX
  const y0 = GRID.cellY + row * GRID.pitchY
  const w = GRID.pitchX
  const h = GRID.pitchY
  const indexed = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) indexed.set(strip.indexed.subarray((y0 + y) * strip.width + x0, (y0 + y) * strip.width + x0 + w), y * w)
  return { width: w, height: h, indexed }
}

/** Render the whole card as one indexed image: 16 columns × 16 rows of symbol cells. */
export function cardImage(data) {
  const strip = symbolStrip(data)
  const { table } = cardTable(data)
  const w = CARD_SIZE * GRID.pitchX
  const h = CARD_SIZE * GRID.pitchY
  const indexed = new Uint8Array(w * h)
  for (let r = 0; r < CARD_SIZE; r++) {
    for (let c = 0; c < CARD_SIZE; c++) {
      const cell = symbolCell(strip, table[r][c])
      for (let y = 0; y < cell.height; y++) indexed.set(cell.indexed.subarray(y * cell.width, (y + 1) * cell.width), (r * GRID.pitchY + y) * w + c * GRID.pitchX)
    }
  }
  return { width: w, height: h, indexed }
}

// --- The real code-card SCREEN (P1, GOAL-DOS-PARITY.md), full re-disassembly this session -----
//
// Everything below is `[STATIC]` from a fresh, from-scratch ndisasm of the whole module (not the
// prior "symbols + cursor + patch sites" pass above): the screen layout, the three trilingual
// text blocks, the target column/row mechanism, and the exact 4-direction cursor wrap. See
// docs/intro-and-codecard.md's "The real code-card screen" section for the full account with
// every cited offset. Glyphs come from `../data/bios-font-8x14.js` (the IBM PC BIOS 8x14 ROM
// font, captured live from DOSBox -- see that file's own header; NOT decoded from any game file,
// since the game never embeds it, only calls INT 10h AH=13h and lets the BIOS draw it).

export const CODECARD_W = 640
export const CODECARD_H = 350

// The three trilingual text blocks (English/French/German stacked, CP437, 12 rows x 80 cols,
// exactly 960 bytes each, no CR/LF -- BIOS teletype output just wraps at column 80). File offsets
// confirmed by disassembly (0x3D0's `mov bp,0x67f`, 0xCC's `mov bp,0xa3f`, 0x11D's `mov bp,0xdff`)
// and by the blocks abutting exactly (0x67F+0x3C0=0xA3F, 0xA3F+0x3C0=0xDFF).
export const TEXT_COLS = 80
export const TEXT_ROWS = 12
export const TEXT_BYTES = TEXT_COLS * TEXT_ROWS // 960
export const TEXT_WELCOME = 0x67f
export const TEXT_WRONG_SYMBOL = 0xa3f // unreachable in this patched copy (the compare always "passes")
export const TEXT_CORRECT_AGAIN = 0xdff

// The target column-letter / row-digits overlay: one poke of the SAME computed character into
// three fixed (textRow, textCol) slots, one per language paragraph's own blank in "COLUMN _ and
// ROW _" / "COLONNE _ ... RANGEE _" / "SPALTE _ und ZEILE _" (0x3E6-0x4D3). The row's tens digit
// (0x43C `jz 0x483`) is skipped entirely when target row+1 < 10 (rows 1-9 show one digit).
export const TARGET_OVERLAYS = [
  { letterRow: 1, letterCol: 7, tensRow: 1, tensCol: 17, onesRow: 1, onesCol: 18 }, // English
  { letterRow: 5, letterCol: 41, tensRow: 5, tensCol: 59, onesRow: 5, onesCol: 60 }, // French
  { letterRow: 9, letterCol: 10, tensRow: 9, tensCol: 22, onesRow: 9, onesCol: 23 }, // German
]

// Background bands (0x3bc fills CX=0x1a40 words = 168 rows from row 0; 0x3c6 fills CX=0x1b80
// words = 176 rows from row 172 (DI=0x35c0/80=172); rows 168-171 and 348-349 are never
// explicitly written by either fill, and mode 10h's own INT 10h AX=0x10 mode-set already zeroes
// the buffer, so they stay index 0). `0x385`'s own GC5=2 (write mode 2) makes `rep stosw` of BX
// write colour BH to even-numbered planes and BL to odd ones -- both wrapper calls use BH=BL
// (0x0909 / 0x0A0A), so this is a plain flat fill, colour 9 then colour 10.
export const BG_TOP_ROWS = 168 // rows 0..167, colour 9 (where the text prints)
export const BG_GAP_ROWS = 4 // rows 168..171, colour 0 (untouched)
export const BG_BOTTOM_ROWS = 176 // rows 172..347, colour 10 (where the symbol grid sits)
export const BG_TOP_COLOUR = 9
export const BG_BOTTOM_COLOUR = 10

// AH=13h's BL in a graphics mode: bit 7 set means XOR-combine instead of overwrite (a documented
// real BIOS behaviour, not a game quirk). BL=0xFF (the paragraph text) and BL=0xF8 (the target
// overlay) XORed against the background colour 9 give the two ink colours actually seen on
// screen: 9^0xF=6 (paragraph text), 9^0x8=1 (the overlay letter/digits) -- confirmed against a
// live DOSBox capture this session (docs/intro-and-codecard.md).
export const XOR_TEXT = 0xf
export const XOR_OVERLAY = 0x8

// The symbol strip is drawn into an off-screen work buffer at its full 208px width, but the
// page-copy that brings it onto the visible screen (`0x5b3`) only moves 25 of its 26
// bytes/row (`rep movsb` with CX=0x19) -- 200 of 208 pixel columns. Checked against the real
// decoded strip (this session): columns 200-207 hold real ink (648 non-zero pixels), not padding,
// so the crop is a genuine, confirmed, reproducible original-game effect, not a safe truncation.
export const STRIP_SCREEN_X = 216
export const STRIP_SCREEN_Y = 179
export const STRIP_VISIBLE_W = 200

// The cursor's own persistent position (FONT.BIN `[cs:0x2558]`/`[cs:0x255a]`), pixel coordinates,
// carried across both accept rounds (never reset between them). Bounds and pitch match `GRID`
// above exactly (226..366 by 20, 181..307 by 18) -- re-derived independently here from the
// cursor-movement code itself, not assumed from the existing `GRID` table.
export const CURSOR_X0 = 226
export const CURSOR_Y0 = 181
export const CURSOR_PITCH_X = 20
export const CURSOR_PITCH_Y = 18
export const CURSOR_COLS = 8
export const CURSOR_ROWS = 8

/**
 * One arrow-key step (1000:01E9-02EE, all four branches literally). RIGHT/LEFT wrap in reading
 * order (past the last column of a row moves to the next/previous row's first/last column, and
 * past the last/first row wraps to the first/last row); UP/DOWN wrap COLUMN-major instead (past
 * the top/bottom row of a column moves to the bottom/top of the previous/next column, and past
 * the first/last column wraps the column too) -- confirmed live, moving RIGHT then DOWN from
 * (0,0) lands on cell (1,1) exactly as this function computes.
 */
export function moveCursor({ x, y }, dir) {
  let nx = x, ny = y
  const maxX = CURSOR_X0 + (CURSOR_COLS - 1) * CURSOR_PITCH_X // 366
  const maxY = CURSOR_Y0 + (CURSOR_ROWS - 1) * CURSOR_PITCH_Y // 307
  if (dir === 'right') {
    nx += CURSOR_PITCH_X
    if (nx > maxX) { nx = CURSOR_X0; ny += CURSOR_PITCH_Y; if (ny > maxY) ny = CURSOR_Y0 }
  } else if (dir === 'left') {
    nx -= CURSOR_PITCH_X
    if (nx < CURSOR_X0) { nx = maxX; ny -= CURSOR_PITCH_Y; if (ny < CURSOR_Y0) ny = maxY }
  } else if (dir === 'up') {
    ny -= CURSOR_PITCH_Y
    if (ny < CURSOR_Y0) { ny = maxY; nx -= CURSOR_PITCH_X; if (nx < CURSOR_X0) nx = maxX }
  } else if (dir === 'down') {
    ny += CURSOR_PITCH_Y
    if (ny > maxY) { ny = CURSOR_Y0; nx += CURSOR_PITCH_X; if (nx > maxX) nx = CURSOR_X0 }
  }
  return { x: nx, y: ny }
}

/** The target column/row (1000:0190): AL=[BIOS tick counter low byte]; column = AL&0xF (0-15,
 * shown as 'A'+column), row = (AL>>3)&0xF (0-15, shown as row+1, 1-16) -- bit 3 is shared between
 * the two fields, so they are correlated, not independent. Live-confirmed (this session): the
 * displayed "COLUMN x and ROW y" changes between round 1 and round 2 of the same boot, each read
 * fresh. The port uses a real elapsed-time counter for the same reason `DS:0002`-derived choices
 * elsewhere in this project do (docs/engine.md, tournament.js header): as non-deterministic as
 * the original's own free-running BIOS tick. */
export function targetFromTickByte(tickByte) {
  return { col: tickByte & 0xf, row: (tickByte >> 3) & 0xf }
}

/** The expected symbol at the target (card row-major, 1000:02F4-033B): card[row*16+col]. */
export function expectedSymbolAt(cardTable, target) {
  return cardTable[target.row][target.col]
}

/** cursor pixel position -> the 0-63 cell/symbol index it's sitting on (row*8+col, 1000:0306-0326). */
export function cursorCellIndex({ x, y }) {
  const col = Math.round((x - CURSOR_X0) / CURSOR_PITCH_X)
  const row = Math.round((y - CURSOR_Y0) / CURSOR_PITCH_Y)
  return row * CURSOR_COLS + col
}

/** One glyph, XORed onto the screen (only the ink bits toggle; background bits pass through). */
function blitGlyphXor(screen, ch, textRow, textCol, xorVal) {
  const glyph = BIOS_FONT_8X14.subarray(ch * FONT_GLYPH_H, ch * FONT_GLYPH_H + FONT_GLYPH_H)
  const x0 = textCol * FONT_GLYPH_W
  const y0 = textRow * FONT_GLYPH_H
  for (let r = 0; r < FONT_GLYPH_H; r++) {
    const row = glyph[r]
    if (!row) continue
    const rowBase = (y0 + r) * CODECARD_W
    for (let c = 0; c < FONT_GLYPH_W; c++) {
      if (row & (0x80 >> c)) screen[rowBase + x0 + c] ^= xorVal
    }
  }
}

/** One 12x80 trilingual block (welcome / wrong-symbol / correct-again), BIOS teletype style:
 * every byte prints at its own fixed (row,col) -- DOSBox's own AH=13h wraps at column 80, so
 * there is no embedded CR/LF to interpret, unlike a true teletype stream. Spaces are real
 * padding and are skipped (their glyph is blank anyway; skipping is just an easy win). */
export function blitTextBlock(screen, data, blockOffset, xorVal = XOR_TEXT) {
  const bytes = toU8(data)
  for (let r = 0; r < TEXT_ROWS; r++) {
    for (let c = 0; c < TEXT_COLS; c++) {
      const ch = bytes[blockOffset + r * TEXT_COLS + c]
      if (ch === 0x20 || ch === 0) continue
      blitGlyphXor(screen, ch, r, c, xorVal)
    }
  }
}

/** The target overlay: the SAME computed letter/digit poked into all three languages' blanks. */
export function blitTargetOverlay(screen, target) {
  const letter = 0x41 + target.col // 'A' + column
  const rowNumber = target.row + 1 // displayed 1-16
  const tens = Math.floor(rowNumber / 10)
  const ones = rowNumber % 10
  for (const o of TARGET_OVERLAYS) {
    blitGlyphXor(screen, letter, o.letterRow, o.letterCol, XOR_OVERLAY)
    if (tens > 0) blitGlyphXor(screen, 0x30 + tens, o.tensRow, o.tensCol, XOR_OVERLAY) // 0x43C: suppressed under 10
    blitGlyphXor(screen, 0x30 + ones, o.onesRow, o.onesCol, XOR_OVERLAY)
  }
}

/** Fresh background: colour 9 (rows 0-167), 0 (168-171), colour 10 (172-347), 0 (348-349). */
function paintBackground(screen) {
  for (let y = 0; y < CODECARD_H; y++) {
    const colour = y < BG_TOP_ROWS ? BG_TOP_COLOUR : y < BG_TOP_ROWS + BG_GAP_ROWS ? 0 : y < BG_TOP_ROWS + BG_GAP_ROWS + BG_BOTTOM_ROWS ? BG_BOTTOM_COLOUR : 0
    screen.fill(colour, y * CODECARD_W, (y + 1) * CODECARD_W)
  }
}

/** The symbol grid, cropped to the real 200 (not 208) visible columns per-row (see STRIP_VISIBLE_W). */
function blitSymbolStrip(screen, data) {
  const strip = symbolStrip(data)
  for (let y = 0; y < strip.height; y++) {
    const src = y * strip.width
    const dst = (STRIP_SCREEN_Y + y) * CODECARD_W + STRIP_SCREEN_X
    screen.set(strip.indexed.subarray(src, src + STRIP_VISIBLE_W), dst)
  }
}

/** The cursor sprite (colour-0-transparent) at its current pixel position. */
function blitCursor(screen, data, pos) {
  const cursor = cursorSprite(data)
  for (let y = 0; y < cursor.height; y++) {
    for (let x = 0; x < cursor.width; x++) {
      const idx = cursor.indexed[y * cursor.width + x]
      if (idx === 0) continue
      const py = pos.y + y, px = pos.x + x
      if (py < 0 || py >= CODECARD_H || px < 0 || px >= CODECARD_W) continue
      screen[py * CODECARD_W + px] = idx
    }
  }
}

/**
 * The full code-card screen, indexed 640x350: background + symbol grid + cursor, and EITHER the
 * welcome paragraph with the live target column/row overlay (stage 'prompt') OR the "Correct, now
 * one more" interstitial (stage 'correct', shown with the SAME grid/cursor still underneath --
 * `0x11D`'s own clear only touches rows 0-167, live-confirmed this session).
 */
export function composeCodeCardScreen(data, { stage, target, cursor }) {
  const screen = new Uint8Array(CODECARD_W * CODECARD_H)
  paintBackground(screen)
  blitSymbolStrip(screen, data)
  blitCursor(screen, data, cursor)
  if (stage === 'prompt') {
    blitTextBlock(screen, data, TEXT_WELCOME)
    blitTargetOverlay(screen, target)
  } else if (stage === 'correct') {
    blitTextBlock(screen, data, TEXT_CORRECT_AGAIN)
  }
  return { width: CODECARD_W, height: CODECARD_H, indexed: screen }
}

/** The two patched compare sites, for the viewer's info panel. */
export function patchState(data) {
  const bytes = toU8(data)
  const hex = (o, n) => Array.from(bytes.subarray(o, o + n), (b) => b.toString(16).padStart(2, '0')).join(' ')
  return {
    site1: hex(0xa8, 10), // expected patched: e8 e5 00 8a c2 eb 54 90 90 90
    site2: hex(0x137, 10), // expected patched: e8 56 00 8a c2 90 90 90 90 90
    intactCompare: hex(0xe9, 7), // 3a c2 74 16 ... (inside the unreachable retry block)
    patched: bytes[0xab] === 0x8a && bytes[0xac] === 0xc2 && bytes[0x13a] === 0x8a && bytes[0x13b] === 0xc2,
  }
}
