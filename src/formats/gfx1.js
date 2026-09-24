// GFX1.GFX — the Codemasters "Absolutely Brilliant!" logo intro's sprite pack, drawn by SM.EXE.
//
// Everything here comes from SM.EXE's own tables and blit routine (Ghidra program SM.EXE,
// image base 1000:0000; file offset = image offset + 0x200 because the MZ header is 32
// paragraphs): LoadGfx1File 1000:0bef reads the whole 54273-byte file; DrawNextLogoRecord
// 1000:0bb3 walks LogoRecordTable (image 0x1E, 48 records × 14 bytes); BlitSpriteToScreen
// 1000:0ccc copies width/2 words per row with source stride = width, horizontal clipping only;
// SetDacPaletteBlock 1000:0d32 uploads DacPalette256 (image 0x36C) with INT 10h AX=1012h.
// See docs/intro-and-codecard.md. Status: rendered and looked at (PROVEN for the asset layout).
//
// The file is an uncompressed 8-bpp indexed sprite pack: 4-byte header (00 01 6B EC, never
// read), then row-major width×height blocks, opaque, stride = width.

import { u16le, i16le, toU8 } from './bytes.js'
import { dac6ToRgb8 } from './pal.js'

export const GFX1_SIZE = 54273
export const SCREEN_W = 320
export const SCREEN_H = 200

const SM_HEADER = 0x200
const SM_RECORD_TABLE = 0x1e
const SM_RECORD_COUNT = 48
const SM_RECORD_SIZE = 14
const SM_PALETTE = 0x36c
const SM_SLIDE_A = 0x2e6
const SM_SLIDE_B = 0x2f6
const SM_SLIDE_STOP_X = 0x48 // SlideStopX (image 0x2C0) — banner A stops when x == 0x48

/** The fixed sprite layout (offset, width, height); block n of the 29 letter frames is at 4 + n*0x400. */
export function gfx1Sprites() {
  const sprites = []
  for (let n = 0; n < 29; n++) sprites.push({ name: `letter frame ${n}`, offset: 4 + n * 0x400, width: 32, height: 32 })
  for (let n = 0; n < 4; n++) sprites.push({ name: `swoosh frame ${n}`, offset: 0x7800 + n * 0xc00, width: 64, height: 48 })
  sprites.push({ name: 'banner "Absolutely"', offset: 0xa804, width: 176, height: 36 })
  sprites.push({ name: 'banner "Brilliant!"', offset: 0xc174, width: 176, height: 26 })
  return sprites
}

/** Extract one sprite as an indexed image. */
export function gfx1Sprite(gfx, { offset, width, height }) {
  const bytes = toU8(gfx)
  return { width, height, indexed: bytes.subarray(offset, offset + width * height) }
}

/**
 * The intro's palette lives in SM.EXE, not in GFX1.GFX: 256 × (R,G,B) at file offset 0x56C.
 * Stored bytes are 6-bit DAC values; two entries hold 255, which the DAC masks to 63 (white).
 */
export function smPalette(sm) {
  const bytes = toU8(sm)
  const rgb = new Uint8Array(256 * 3)
  for (let i = 0; i < 768; i++) {
    rgb[i] = dac6ToRgb8(bytes[SM_HEADER + SM_PALETTE + i])
  }
  return rgb
}

/** The 48 draw records (x = w0 + w1 signed, y = w3, src = w4, w = w5, h = w6; w2 unused). */
export function smLogoRecords(sm) {
  const bytes = toU8(sm)
  const out = []
  for (let i = 0; i < SM_RECORD_COUNT; i++) {
    const o = SM_HEADER + SM_RECORD_TABLE + i * SM_RECORD_SIZE
    out.push({
      x: (i16le(bytes, o) + i16le(bytes, o + 2)),
      spriteIndex: u16le(bytes, o + 4),
      y: u16le(bytes, o + 6),
      src: u16le(bytes, o + 8),
      width: u16le(bytes, o + 10),
      height: u16le(bytes, o + 12),
    })
  }
  return out
}

/** Sprite descriptor as SM.EXE stores it: +0 x, +2 y, +4 w, +6 h, +8 seg, +A ofs. */
function smDescriptor(bytes, imageOffset) {
  const o = SM_HEADER + imageOffset
  return { x: i16le(bytes, o), y: u16le(bytes, o + 2), width: u16le(bytes, o + 4), height: u16le(bytes, o + 6), src: u16le(bytes, o + 10) }
}

/**
 * BlitSpriteToScreen semantics: horizontal clipping only (x<0 skips source columns, x+w>320
 * shrinks), rows copied as width/2 words so an odd width loses its last pixel, no transparency,
 * rows past 200 are simply not drawn here (the original would write past the frame buffer).
 */
export function blitOpaque(screen, gfx, x, y, src, width, height) {
  let skip = 0
  let w = width
  if (x < 0) { w = width + x; if (w <= 0) return; skip = -x; x = 0 }
  else w = Math.min(width, SCREEN_W - x)
  const wordsW = w & ~1
  for (let row = 0; row < height; row++) {
    const yy = y + row
    if (yy >= SCREEN_H) break
    const s = src + row * width + skip
    screen.set(gfx.subarray(s, s + wordsW), yy * SCREEN_W + x)
  }
}

/**
 * The finished logo screen: all 48 records in table order (nothing is erased between them),
 * then the two banners at their resting positions (A slides +8/frame from x=-208 to 0x48;
 * B slides -8/frame from x=368 over the same number of frames).
 */
export function composeLogoScreen(gfx, sm) {
  const g = toU8(gfx)
  const s = toU8(sm)
  const screen = new Uint8Array(SCREEN_W * SCREEN_H)
  for (const r of smLogoRecords(s)) blitOpaque(screen, g, r.x, r.y, r.src, r.width, r.height)
  const a = smDescriptor(s, SM_SLIDE_A)
  const b = smDescriptor(s, SM_SLIDE_B)
  const steps = (SM_SLIDE_STOP_X - a.x) / 8
  blitOpaque(screen, g, SM_SLIDE_STOP_X, a.y, a.src, a.width, a.height)
  blitOpaque(screen, g, b.x - 8 * steps, b.y, b.src, b.width, b.height)
  return { width: SCREEN_W, height: SCREEN_H, indexed: screen, steps }
}
