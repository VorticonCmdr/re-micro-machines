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
