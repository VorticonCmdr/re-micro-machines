// Sprite blit primitives used by the race compositor (docs/track-graphics.md "Vehicles"/"Front-end
// blits"): the colour-0 transparent blit, the silhouette shadow, and the clip the game applies
// before either. All operate on flat indexed (palette-index) buffers. The car body colour remap
// itself (BlitSpriteCarColourRemapRace 1000:8c6a) is `remapCarColours` in `formats/race.js` — reused
// as-is (PLAN-ENGINE.md §3), not duplicated here.
//
// From MICROU.EXE: BlitSpriteSilhouetteBlack 1000:8c3c (shadow: every non-zero source pixel drawn as
// colour 0), ClipSpriteToRaceView 1000:8bab (clips to 256×224 — the `AtXY` variants only reject
// sprites wholly off-screen and rely on the buffer's 16-px margins).

/** Reject a sprite that doesn't overlap [0,dstW)x[0,dstH) at all — the `AtXY` "wholly off-screen" test. */
function offScreen(x, y, w, h, dstW, dstH) {
  return x + w <= 0 || y + h <= 0 || x >= dstW || y >= dstH
}

/** Clip an intended draw at (x,y) size (w,h) into a dst of (dstW,dstH); returns null if nothing survives. */
export function clipRect(x, y, w, h, dstW, dstH) {
  if (offScreen(x, y, w, h, dstW, dstH)) return null
  const sx0 = Math.max(0, -x), sy0 = Math.max(0, -y)
  const sx1 = Math.min(w, dstW - x), sy1 = Math.min(h, dstH - y)
  if (sx1 <= sx0 || sy1 <= sy0) return null
  return { sx0, sy0, sx1, sy1, dx0: x + sx0, dy0: y + sy0 }
}

/**
 * Draw `src` (indexed, {width,height,indexed}) into `dst` at (x,y), colour 0 transparent.
 * This is the game's ordinary sprite blit (car bodies already colour-remapped, HUD icons, etc).
 */
export function blitTransparent(dst, dstW, dstH, x, y, src, { colorKey = 0, flip = false } = {}) {
  const c = clipRect(x, y, src.width, src.height, dstW, dstH)
  if (!c) return
  for (let sy = c.sy0; sy < c.sy1; sy++) {
    const srow = sy * src.width
    const drow = (c.dy0 + (sy - c.sy0)) * dstW + c.dx0
    for (let sx = c.sx0; sx < c.sx1; sx++) {
      // BlitSpriteTransparentFlipSaveUnder (1000:04bd, re-verified live M3.9): flip mirrors the
      // SOURCE row (reads from the far end), not the destination -- so a clipped-off-the-left
      // sprite still mirrors correctly rather than mirroring the visible slice.
      const srcX = flip ? src.width - 1 - sx : sx
      const p = src.indexed[srow + srcX]
      if (p !== colorKey) dst[drow + (sx - c.sx0)] = p
    }
  }
}

/**
 * The airborne shadow: every non-zero pixel of `src` drawn as flat `color` (0 in-game — the shadow
 * IS colour 0, "black" in every race palette). Used at (x+z, y+z) while the body draws at (x-z, y-z).
 */
export function blitSilhouette(dst, dstW, dstH, x, y, src, { color = 0, colorKey = 0 } = {}) {
  const c = clipRect(x, y, src.width, src.height, dstW, dstH)
  if (!c) return
  for (let sy = c.sy0; sy < c.sy1; sy++) {
    const srow = sy * src.width
    const drow = (c.dy0 + (sy - c.sy0)) * dstW + c.dx0
    for (let sx = c.sx0; sx < c.sx1; sx++) {
      if (src.indexed[srow + sx] !== colorKey) dst[drow + (sx - c.sx0)] = color
    }
  }
}
