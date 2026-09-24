// The front-end render substrate (docs/engine.md §7, PLAN-ENGINE.md M3.9): a plain 256x200
// indexed back buffer, the sprite blit `chr.js`'s CHR members already decode into (reused from
// `blit.js`, not duplicated), and 8px-font text. Field layout and blit semantics re-verified live
// this session against `BindSpriteObjToChrDescriptor 1000:049c` and `ClipSpriteDescToFrontView
// 1000:0630` (docs/engine.md §7's sprite-descriptor paragraph) -- this module does not replicate
// the original's packed 27-byte descriptor record or its `0x888` VRAM-offset arithmetic (that
// offset is `row 8 * 272 + column 8`, i.e. purely an artifact of the original's own absolute
// addressing): every screen here just gets a 256x200 canvas and draws at ordinary (x,y).
import { chrFrame } from '../formats/chr.js'
import { blitTransparent } from './blit.js'

export const MENU_VIEW = { w: 256, h: 200 }

export function createMenuBuffer() {
  return new Uint8Array(MENU_VIEW.w * MENU_VIEW.h)
}

/** Draw one frame of a CHR member at (x,y). `flip` mirrors horizontally (the descriptor's `+0xA`
 * flip flag); colour 0 is transparent (`BlitSpriteTransparentFlipSaveUnder`, confirmed live).
 * `cropRows`: draw only the sprite's own first N rows (see `blit.js`'s own `blitTransparent`
 * header -- the elimination screen's own bounce "squash" effect, docs/engine.md §9ba). */
export function blitChr(buf, arena, rec, frame, x, y, { flip = false, cropRows = Infinity } = {}) {
  blitTransparent(buf, MENU_VIEW.w, MENU_VIEW.h, x, y, chrFrame(arena, rec, frame), { flip, cropRows })
}

// BlitGlyph8xH (1000:0999), already [PROVEN] in this project's own Ghidra comments (by rendering
// FONT1/FONT2.CHR.png) before this session: '!' -> 36, '?' -> 37, '0'-'9' -> 0-9, 'A'-'Z' -> 10-35.
export function glyphFrame(ch) {
  if (ch === '!') return 36
  if (ch === '?') return 37
  const c = ch.charCodeAt(0)
  if (c >= 0x30 && c <= 0x39) return c - 0x30 // '0'-'9'
  if (c >= 0x41 && c <= 0x5a) return c - 0x37 // 'A'-'Z'
  return null // unsupported glyph -- caller should uppercase/sanitize first
}

/** DrawString8pxFont (0929): 8px advance per glyph, spaces skipped (not blitted, still advance). */
export function drawString(buf, arena, fontRec, text, x, y) {
  let cx = x
  for (const ch of text.toUpperCase()) {
    if (ch !== ' ') {
      const f = glyphFrame(ch)
      if (f !== null) blitChr(buf, arena, fontRec, f, cx, y)
    }
    cx += 8
  }
}

/** DrawStringCentred: `x = 0x7F - 4*len` (docs/engine.md §7), against this substrate's 256-wide
 * buffer (0x7F=127 is that buffer's own centre-ish point in the original's coordinate space). */
export function drawStringCentred(buf, arena, fontRec, text, y) {
  const x = 0x7f - 4 * text.length
  drawString(buf, arena, fontRec, text, x, y)
}
