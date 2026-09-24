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

// --- The intro's real per-frame animation (RunIntroMainLoop 1000:097f and its callees) --------
//
// Full re-disassembly (re/SM.EXE.lst, this session): one iteration = one VGA vertical-retrace
// wait (port 0x3DA bit 3, ~70Hz on real mode-13h hardware -- not the 70.06Hz IRQ0 driver tick
// used elsewhere in this project, a different clock SM.EXE never touches). Per iteration, in
// order: TickExitTimeoutAfterShine (0aac), DrawNextLogoRecord (0bb3), SlideBannersTogether
// (0b83), FUN_1000_0ac6 (the A/B-key branch below), the scancode sample (09d0, folded into the
// `abHeld` input here since a level-checked "A and B both currently held" is behaviourally
// identical to the real single-byte-scancode latch + flag pair it updates), the shine
// (BrightenShineBandDiagonal 0a48 / DimShineTrailDiagonal 09f8), then the vsync wait and the
// exit checks (a mouse click always wins over the timeout; INT 33h AX=3, a level check).
//
// `UNKNOWN_intro_key_effect` (P1, GOAL-DOS-PARITY.md): a key press does NOT skip the intro --
// only a mouse click does, or the fixed post-shine timeout. The INT9 hook SM.EXE installs
// (13 bytes at CS:0xcbf: PUSH AX; IN AL,60h; MOV [0x362],AL; MOV AL,0x20; OUT 20h,AL; POP AX;
// IRET) sends its own EOI and never chains to the BIOS ISR, so a keystroke never reaches
// FONT.BIN's own keyboard code either -- it is fully consumed here. The ONLY behavioural gate on
// that captured byte (09d0: scancode 0x1E/0x9E toggles a held-A flag, 0x30/0xB0 a held-B flag) is
// FUN_1000_0ac6: normally it clears screen rows 159-177 every frame (real coords 0xc6c0 =
// row*320+0, 0xbe0 words = 19 rows) -- geometrically checked against this shipped GFX1.GFX/SM.EXE
// (all 48 records' and both banners' rectangles, and the shine's own row range, sit entirely
// above row 159), so that clear has no visible target and is not reproduced. Holding A+B
// together instead zeroes the 250-frame post-shine exit counter EVERY iteration it's held (and
// draws a "hidden build stamp" from ANTIFONT.BIN once) -- ANTIFONT.BIN ships 0 bytes (see the
// module header), so the stamp draws nothing, same as the FONT.BIN antifont case, but the
// counter reset is real and observable: holding A+B through the post-shine hold keeps the intro
// up indefinitely, and releasing restarts the 250-frame count from 0. Ported below; the pixel
// clear and the blank stamp draw are not (verified inert, not merely assumed).
const RECORD_ADVANCE = 0xe // DI += 0xe per iteration (14 bytes/record); table has 48 records
const RECORD_LAST = 47
const BANNER_SPEED = 8
const SLIDE_STOP_X = 0x48 // 72 -- SM_SLIDE_STOP_X above, kept local to this block for clarity
const SHINE_Y = 0x50 // 80 -- [0x6c9], never changes after its one-time init
const SHINE_ROWS = 0x46 // 70
const SHINE_X_START = 0x48 // 72 -- [0x6c7]'s one-time init, coincides with SLIDE_STOP_X
const SHINE_X_END = 0x138 // 312
const SHINE_STEP = 8
const SHINE_BRIGHT_DELTA = 0x10
const SHINE_DIM_DELTA = -0x10
const SHINE_DIM_OFFSET = 0x20 // 32 -- Dim trails Bright by this many columns (4 bands)
const SHINE_DIM_GATE = 6 // Dim starts only once the bright-call counter reaches this
const POST_SHINE_HOLD = 250 // 0xfa -- [0x6ba]/[0x6b8], TickExitTimeoutAfterShine

/** Diagonal 70-row band (FUN_1000_0a48/09f8's shared inner loop): row r's 8-pixel strip sits at
 * column `x - r`, row `y + r` -- a raw framebuffer address, no clipping, so a strip can bleed a
 * few columns into the row above it at the sweep's own edges, exactly as the real bytes do. */
function shineBand(screen, x, y, delta) {
  for (let r = 0; r < SHINE_ROWS; r++) {
    const rowStart = (y + r) * SCREEN_W + (x - r)
    for (let c = 0; c < 8; c++) {
      const i = rowStart + c
      if (i >= 0 && i < screen.length) screen[i] = (screen[i] + delta) & 0xff
    }
  }
}

/** Fresh intro state: an all-black 320x200 indexed screen plus every counter RunIntroMainLoop's
 * own entry() setup (FUN_1000_07f1 etc.) zeroes before the loop starts. `sm`/`gfx` are cached so
 * `introStep` never re-decodes the record table or the banner descriptors per tick. */
export function introInitialState(gfx, sm) {
  const g = toU8(gfx)
  const s = toU8(sm)
  return {
    gfx: g,
    records: smLogoRecords(s),
    bannerA: smDescriptor(s, SM_SLIDE_A),
    bannerB: smDescriptor(s, SM_SLIDE_B),
    screen: new Uint8Array(SCREEN_W * SCREEN_H),
    recordIndex: 0,
    bannerAX: smDescriptor(s, SM_SLIDE_A).x, // -208
    bannerBX: smDescriptor(s, SM_SLIDE_B).x, // 368
    slideActive: true, // [0x6c3]==0: the slide (and the record reveal) is still running
    shineX: SHINE_X_START,
    shineDone: false, // [0x6cd]
    brightCount: 0, // [0x6cb], caps at 8
    postShineCounter: 0, // [0x6ba]
    exitTimeoutFlag: false, // [0x6b8]
    iteration: 0,
    exited: false,
  }
}

/** One RunIntroMainLoop iteration (one real vsync wait). `input.abHeld`: A and B are both
 * currently held (see the header comment above -- there is no separate keyboard skip). `input`
 * mouse fields mirror the real INT 33h AX=3 level check: only meaningful when `mousePresent`. */
export function introStep(state, input = {}) {
  const { abHeld = false, mousePresent = false, mouseDown = false } = input
  // 1. TickExitTimeoutAfterShine 1000:0aac
  if (state.shineDone) {
    state.postShineCounter++
    if (state.postShineCounter === POST_SHINE_HOLD) state.exitTimeoutFlag = true
  }
  // 2. DrawNextLogoRecord 1000:0bb3 (stays on the last record once reached, re-blitting it)
  const rec = state.records[state.recordIndex]
  blitOpaque(state.screen, state.gfx, rec.x, rec.y, rec.src, rec.width, rec.height)
  if (state.recordIndex !== RECORD_LAST) state.recordIndex++
  // 3. SlideBannersTogether 1000:0b83 (stops moving, and stops being redrawn, once the slide ends)
  if (state.slideActive) {
    state.bannerAX += BANNER_SPEED
    state.bannerBX -= BANNER_SPEED
    const a = state.bannerA, b = state.bannerB
    blitOpaque(state.screen, state.gfx, state.bannerAX, a.y, a.src, a.width, a.height)
    blitOpaque(state.screen, state.gfx, state.bannerBX, b.y, b.src, b.width, b.height)
    if (state.bannerAX === SLIDE_STOP_X) state.slideActive = false // sets [0x6c3]: shine may now start
  }
  // 4. FUN_1000_0ac6's A+B branch: holds the exit counter at 0 while both are down.
  if (abHeld) state.postShineCounter = 0
  // 5. 09d0's scancode sample is folded into `input.abHeld` itself (see header comment).
  // 6. The shine, once the slide has stopped and the shine hasn't finished.
  if (!state.slideActive && !state.shineDone) {
    shineBand(state.screen, state.shineX, SHINE_Y, SHINE_BRIGHT_DELTA)
    if (state.brightCount < 8) state.brightCount++
    state.shineX += SHINE_STEP
    if (state.shineX === SHINE_X_END) state.shineDone = true
    if (state.brightCount >= SHINE_DIM_GATE) shineBand(state.screen, state.shineX - SHINE_DIM_OFFSET, SHINE_Y, SHINE_DIM_DELTA)
  }
  // 7. vsync wait, then the exit checks: a mouse click always wins over the timeout.
  state.iteration++
  if (mousePresent && mouseDown) state.exited = true
  else if (state.exitTimeoutFlag) state.exited = true
  return state
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
