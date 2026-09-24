// Indexed pixels + palette -> RGBA -> canvas.
//
// Zoom is integer nearest-neighbour only. 320x200 mode 13h art was displayed at 4:3 on the
// original hardware (a 6:5 vertical stretch); nearest-neighbour 4:3 at small zooms gives
// uneven scanlines, and only multiples of 5 come out uniform. So: 1:1 pixels by default and
// aspect correction only where it stays clean.

/**
 * @param {Uint8Array} indexed  one palette index per pixel, row-major
 * @param {Uint8Array} rgb      256×3 palette (8-bit per channel)
 * @param {{transparent?: number|null}} [opts]  index rendered as alpha 0, or null for none
 * @returns {Uint8ClampedArray} RGBA, width*height*4
 */
export function indexedToRgba(indexed, rgb, { transparent = null } = {}) {
  const out = new Uint8ClampedArray(indexed.length * 4)
  for (let i = 0, o = 0; i < indexed.length; i++, o += 4) {
    const idx = indexed[i]
    const p = idx * 3
    out[o] = rgb[p]
    out[o + 1] = rgb[p + 1]
    out[o + 2] = rgb[p + 2]
    out[o + 3] = idx === transparent ? 0 : 255
  }
  return out
}

/** @returns {HTMLCanvasElement} */
export function rgbaToCanvas(width, height, rgba) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  canvas.getContext('2d').putImageData(new ImageData(rgba, width, height), 0, 0)
  return canvas
}

/** Draw RGBA into `canvas` at integer zoom, keeping pixels crisp. */
export function paint(canvas, width, height, rgba, { zoom = 1, aspect43 = false } = {}) {
  const vScale = aspect43 ? 1.2 : 1
  canvas.width = width * zoom
  canvas.height = Math.round(height * zoom * vScale)
  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(rgbaToCanvas(width, height, rgba), 0, 0, canvas.width, canvas.height)
  return canvas
}

export const aspectIsClean = (zoom) => zoom % 5 === 0

/** Checkerboard behind transparent art (CSS, not baked into pixels — the decode stays honest). */
export const CHECKER_CSS = 'repeating-conic-gradient(#2a2a33 0% 25%, #23232b 0% 50%) 50% / 16px 16px'
