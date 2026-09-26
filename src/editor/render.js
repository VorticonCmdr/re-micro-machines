// Bitmap caches for the level editor: a round's 16×16 bank tiles and its 96×96 meta-tiles, drawn
// from the model's current bytes and dropped when the files they come from change (the palette:
// everything; a PR slab: tiles and meta-tiles; CT: meta-tiles; COL: collision masks).
//
// A meta-tile is drawn the way race.js's renderTrack draws the world: each CT word's bank tile,
// and in rounds 2 and 3 (the only rounds with an overlay pass, 1000:3994) a word inside the
// overlay range also gets tile+12 drawn transparently on top.

import { decodePalette } from '../formats/pal.js'
import { OVERLAY_RANGES, OVERLAY_TILE_DELTA } from '../formats/race.js'
import { paths } from './model.js'

const roundOfKey = (k) => Number(/ROUND(\d)/.exec(k)?.[1])

export class Renderer {
  constructor(model) {
    this.model = model
    this.rounds = new Map()
    model.onChange((keys) => {
      for (const k of keys) {
        const r = roundOfKey(k), c = this.rounds.get(r)
        if (!c) continue
        if (/\.PAL$/.test(k)) this.rounds.delete(r)
        else if (/\.PR\d$/.test(k)) { c.tiles.clear(); c.metas.clear() }
        else if (/\.CT$/.test(k)) c.metas.clear()
        else if (/\.COL$/.test(k)) c.cols.clear()
      }
    })
  }

  _round(r) {
    let c = this.rounds.get(r)
    if (!c) {
      c = { rgb: decodePalette(this.model.bytes(paths.pal(r))).rgb, tiles: new Map(), metas: new Map(), cols: new Map() }
      this.rounds.set(r, c)
    }
    return c
  }

  /** 8-bit RGB for palette index i of round r. */
  rgb(r, i) { const p = this._round(r).rgb; return [p[i * 3], p[i * 3 + 1], p[i * 3 + 2]] }
  css(r, i) { const [a, b, c] = this.rgb(r, i); return `rgb(${a},${b},${c})` }

  /** The tile's pixels as RGBA ImageData (null past the bank). */
  tileImage(r, t) {
    const c = this._round(r)
    let img = c.tiles.get(t)
    if (img === undefined) {
      const px = this.model.tilePixels(r, t)
      img = null
      if (px) {
        img = new ImageData(16, 16)
        for (let i = 0; i < 256; i++) {
          const v = px[i]
          img.data[i * 4] = c.rgb[v * 3]; img.data[i * 4 + 1] = c.rgb[v * 3 + 1]; img.data[i * 4 + 2] = c.rgb[v * 3 + 2]; img.data[i * 4 + 3] = 255
        }
      }
      c.tiles.set(t, img)
    }
    return img
  }

  /** A 96×96 canvas of meta-tile m (a missing bank tile is drawn as a red cross). */
  metaCanvas(r, m) {
    const c = this._round(r)
    let cv = c.metas.get(m)
    if (!cv) {
      cv = document.createElement('canvas')
      cv.width = cv.height = 96
      const g = cv.getContext('2d')
      const img = g.createImageData(96, 96)
      const range = OVERLAY_RANGES[r]
      const exists = m < this.model.metaCount(r)
      for (let y = 0; y < 6; y++) {
        for (let x = 0; x < 6; x++) {
          const w = exists ? this.model.ctWord(r, m, x, y) : -1
          const base = w >= 0 ? this.model.tilePixels(r, w) : null
          const over = base && range && w >= range[0] && w <= range[1] ? this.model.tilePixels(r, w + OVERLAY_TILE_DELTA) : null
          for (let py = 0; py < 16; py++) {
            for (let px = 0; px < 16; px++) {
              const o = ((y * 16 + py) * 96 + x * 16 + px) * 4
              let v = base ? base[py * 16 + px] : -1
              if (over && over[py * 16 + px]) v = over[py * 16 + px]
              if (v < 0) {
                const cross = px === py || px === 15 - py
                img.data[o] = cross ? 255 : 40; img.data[o + 1] = cross ? 60 : 20; img.data[o + 2] = cross ? 60 : 30
              } else { img.data[o] = c.rgb[v * 3]; img.data[o + 1] = c.rgb[v * 3 + 1]; img.data[o + 2] = c.rgb[v * 3 + 2] }
              img.data[o + 3] = 255
            }
          }
        }
      }
      g.putImageData(img, 0, 0)
      c.metas.set(m, cv)
    }
    return cv
  }

  /** A 12×12 canvas, translucent red where meta-tile m's collision bit is set. */
  colCanvas(r, m) {
    const c = this._round(r)
    let cv = c.cols.get(m)
    if (!cv) {
      cv = document.createElement('canvas')
      cv.width = cv.height = 12
      const g = cv.getContext('2d')
      const img = g.createImageData(12, 12)
      for (let i = 0; i < 144; i++) {
        if (!this.model.colBit(r, m, i % 12, (i / 12) | 0)) continue
        img.data[i * 4] = 255; img.data[i * 4 + 1] = 40; img.data[i * 4 + 2] = 60; img.data[i * 4 + 3] = 130
      }
      g.putImageData(img, 0, 0)
      c.cols.set(m, cv)
    }
    return cv
  }
}

/** Draw an arrow for a byte-angle heading (0 = up, clockwise, 256 per turn) centred at (x, y). */
export function arrow(g, x, y, heading, len) {
  const a = (heading / 256) * Math.PI * 2
  const dx = Math.sin(a), dy = -Math.cos(a)
  const tx = x + dx * len / 2, ty = y + dy * len / 2
  g.beginPath()
  g.moveTo(x - dx * len / 2, y - dy * len / 2)
  g.lineTo(tx, ty)
  const h = Math.max(3, len * 0.35)
  g.moveTo(tx, ty); g.lineTo(tx - h * Math.sin(a - 0.5), ty + h * Math.cos(a - 0.5))
  g.moveTo(tx, ty); g.lineTo(tx - h * Math.sin(a + 0.5), ty + h * Math.cos(a + 0.5))
  g.stroke()
}

/** A hue for value v of n, as CSS. */
export const hue = (v, n, a = 1) => `hsla(${Math.round((v / Math.max(1, n)) * 300)}, 80%, 55%, ${a})`
