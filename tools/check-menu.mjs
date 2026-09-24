// M3.9 acceptance test: the front-end render substrate (src/render/menuView.js) against a
// synthetic CHR arena -- transparency, horizontal flip, clipping, glyph mapping, text centring.
// No DOSBox needed; the one live check this milestone attempts is a title-screen pixel-diff,
// tracked separately (docs/engine.md §9k names what was and wasn't attempted).
//   node tools/check-menu.mjs
import { MENU_VIEW, createMenuBuffer, blitChr, glyphFrame, drawString, drawStringCentred } from '../src/render/menuView.js'

let bad = 0
function check(name, cond) {
  if (cond) return
  bad++
  console.log(`FAIL: ${name}`)
}

// A tiny synthetic "arena": one 4x2 record at arenaOffset 0, colour 0 = transparent background,
// asymmetric non-zero pixels so a flip is visually distinguishable from the unflipped original.
//   row0: 1 2 3 0
//   row1: 0 0 4 5
const arena = new Uint8Array([1, 2, 3, 0, 0, 0, 4, 5])
const rec = { width: 4, height: 2, arenaOffset: 0 }

// 1. Plain blit: non-zero pixels copied, colour 0 left as background.
{
  const buf = createMenuBuffer()
  buf.fill(9) // a distinct "background" colour so untouched pixels are visible
  blitChr(buf, arena, rec, 0, 10, 10)
  const at = (x, y) => buf[y * MENU_VIEW.w + x]
  check('row0 col0 copied (1)', at(10, 10) === 1)
  check('row0 col3 (colour 0) left as background', at(13, 10) === 9)
  check('row1 col2 copied (4)', at(12, 11) === 4)
  check('row1 col3 copied (5)', at(13, 11) === 5)
}

// 2. Flip mirrors the SOURCE row, matching BlitSpriteTransparentFlipSaveUnder (blit.js's own
// comment, re-verified live 1000:04bd this session) -- not a destination-side mirror.
{
  const buf = createMenuBuffer()
  buf.fill(9)
  blitChr(buf, arena, rec, 0, 10, 10, { flip: true })
  const at = (x, y) => buf[y * MENU_VIEW.w + x]
  // Unflipped row0 is [1,2,3,0]; flipped it reads right-to-left as [0,3,2,1] at the SAME dest x's.
  check('flip: dest col0 shows the source\'s last pixel (colour 0, background)', at(10, 10) === 9)
  check('flip: dest col1 shows source col2 (3)', at(11, 10) === 3)
  check('flip: dest col3 shows source col0 (1)', at(13, 10) === 1)
}

// 3. Clipping: a sprite hanging off every edge only draws its on-screen portion, no throw.
{
  const buf = createMenuBuffer()
  buf.fill(9)
  blitChr(buf, arena, rec, 0, -2, MENU_VIEW.h - 1) // off the left edge and off the bottom
  const at = (x, y) => buf[y * MENU_VIEW.w + x]
  check('clipped blit does not throw and leaves an in-bounds pixel set', at(0, MENU_VIEW.h - 1) === 3) // source col2 lands at dest x=0
}

// 4. Glyph mapping (BlitGlyph8xH, 1000:0999, already [PROVEN] by an earlier session's render).
check("glyph '0'..'9' map to frames 0..9", glyphFrame('0') === 0 && glyphFrame('9') === 9)
check("glyph 'A'..'Z' map to frames 10..35", glyphFrame('A') === 10 && glyphFrame('Z') === 35)
check("glyph '!' maps to frame 36", glyphFrame('!') === 36)
check("glyph '?' maps to frame 37", glyphFrame('?') === 37)

// 5. Text layout: 8px advance per glyph, spaces skipped (not blitted) but still advance the cursor.
{
  const fontArena = new Uint8Array(64 * 38) // 38 frames of 8x8, all non-zero so placement is visible
  fontArena.fill(7)
  const fontRec = { width: 8, height: 8, arenaOffset: 0 }
  const buf = createMenuBuffer()
  drawString(buf, fontArena, fontRec, 'A B', 0, 0)
  check("'A' drawn at x=0", buf[0] === 7)
  check("space at x=8 left blank (buffer default 0)", buf[8] === 0)
  check("'B' drawn at x=16 (8px advance per glyph, including the space)", buf[16] === 7)
}
{
  const fontArena = new Uint8Array(64 * 38)
  fontArena.fill(7)
  const fontRec = { width: 8, height: 8, arenaOffset: 0 }
  const buf = createMenuBuffer()
  drawStringCentred(buf, fontArena, fontRec, 'AB', 5) // x = 0x7f - 4*2 = 119
  check('centred text lands at x = 0x7F - 4*len', buf[5 * MENU_VIEW.w + 119] === 7)
}

console.log(bad ? `${bad} check(s) failed` : 'check-menu: sprite blit (plain/flip/clip) and text layout match the documented formulas')
process.exitCode = bad ? 1 : 0
