// Render reference PNGs from the SAME modules the browser uses.
//
// The decoders in src/formats are pure and DOM-free, so Node can import them directly.
// When a decoder changes, re-render and LOOK at the output — a decoder that parses without
// throwing is not verified. Currently: every .PAL as a 16×16 swatch sheet.
//
//   npm run render        # writes tools/out/*.png

import { readFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { decodePalette } from '../src/formats/pal.js'
import { composeLogoScreen, gfx1Sprites, gfx1Sprite, smPalette } from '../src/formats/gfx1.js'
import { symbolStrip, cursorSprite, fontbinPalette, cardImage } from '../src/formats/fontbin.js'
import { indexedToRgba } from '../src/render/raster.js'
import { buildArena, chrSheet, caseImage, CHR_TABLE } from '../src/formats/chr.js'
import { CATALOG, KIND } from '../src/data/catalog.js'
import { savePng, scale } from './png.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const GAME = join(ROOT, 'game')
const OUT = join(ROOT, 'tools', 'out')
mkdirSync(OUT, { recursive: true })

const read = (path) => {
  const b = readFileSync(join(GAME, path))
  return new Uint8Array(b.buffer, b.byteOffset, b.length)
}
const outName = (path) => path.replace(/[\/.]/g, '_') + '.png'

function renderPalette(entry, zoom = 12) {
  const pal = decodePalette(read(entry.path), { bits: 6 })
  const rgba = new Uint8ClampedArray(16 * 16 * 4)
  for (let i = 0; i < 256; i++) {
    rgba[i * 4] = pal.rgb[i * 3]; rgba[i * 4 + 1] = pal.rgb[i * 3 + 1]; rgba[i * 4 + 2] = pal.rgb[i * 3 + 2]; rgba[i * 4 + 3] = 255
  }
  const path = join(OUT, outName(entry.path))
  savePng(path, 16 * zoom, 16 * zoom, scale(rgba, 16, 16, zoom))
  return { path, maxRaw: pal.maxRaw }
}

function saveIndexed(name, img, rgb, zoom = 2, transparent = null) {
  const rgba = indexedToRgba(img.indexed, rgb, { transparent })
  const path = join(OUT, name)
  savePng(path, img.width * zoom, img.height * zoom, scale(rgba, img.width, img.height, zoom))
  console.log(`${name.padEnd(28)} ${img.width}x${img.height} -> ${path}`)
}

// GFX1.GFX + SM.EXE: the composed logo screen and a sheet of every sprite block.
{
  const gfx = read('GFX1.GFX')
  const sm = read('SM.EXE')
  const rgb = smPalette(sm)
  saveIndexed('GFX1_logo_screen.png', composeLogoScreen(gfx, sm), rgb, 3)
  const sprites = gfx1Sprites()
  // Sheet: 32×32 frames in a row of 8, then the 64×48 frames, then the banners, stacked.
  const groups = [sprites.slice(0, 29), sprites.slice(29, 33), sprites.slice(33)]
  const cols = 8
  const rowsOf = (g) => Math.ceil(g.length / cols)
  const cellW = (g) => g[0].width, cellH = (g) => g[0].height
  const sheetW = Math.max(...groups.map((g) => Math.min(cols, g.length) * cellW(g)))
  const sheetH = groups.reduce((h, g) => h + rowsOf(g) * cellH(g), 0)
  const sheet = { width: sheetW, height: sheetH, indexed: new Uint8Array(sheetW * sheetH) }
  let yBase = 0
  for (const g of groups) {
    g.forEach((sp, i) => {
      const img = gfx1Sprite(gfx, sp)
      const x0 = (i % cols) * sp.width, y0 = yBase + Math.floor(i / cols) * sp.height
      for (let y = 0; y < sp.height; y++) sheet.indexed.set(img.indexed.subarray(y * sp.width, (y + 1) * sp.width), (y0 + y) * sheetW + x0)
    })
    yBase += rowsOf(g) * cellH(g)
  }
  saveIndexed('GFX1_sprites.png', sheet, rgb, 2)
}

// FONT.BIN: symbol strip, cursor, and the reconstructed code card.
{
  const fb = read('FONT.BIN')
  const rgb = fontbinPalette(fb)
  saveIndexed('FONT_BIN_symbols.png', symbolStrip(fb), rgb, 3)
  saveIndexed('FONT_BIN_cursor.png', cursorSprite(fb), rgb, 6, 0)
  saveIndexed('FONT_BIN_codecard.png', cardImage(fb), rgb, 2)
}

// COMPRESS.PI0–6 → the asset arena → one sheet per .CHR member, with INTRO.PAL.
{
  const { arena, slabs } = await buildArena(async (name) => read(name))
  for (const s of slabs) console.log(`${s.name.padEnd(28)} ${s.packed} -> ${s.unpacked}`)
  const rgb = decodePalette(read('INTRO.PAL'), { bits: 6 }).rgb
  for (const rec of CHR_TABLE) {
    if (rec.raw) continue
    saveIndexed(`CHR_${rec.name.replace('.', '_')}.png`, chrSheet(arena, rec), rgb, rec.width >= 96 ? 1 : 2)
  }
  saveIndexed('CHR_CASE_map.png', caseImage(arena), rgb, 2)
}

let n = 0
for (const entry of CATALOG.filter((e) => e.kind === KIND.PALETTE)) {
  try {
    const { path, maxRaw } = renderPalette(entry)
    console.log(`${entry.path.padEnd(22)} -> ${path}  (max raw ${maxRaw})`)
    n++
  } catch (err) {
    console.log(`${entry.path.padEnd(22)} FAILED: ${err.message}`)
  }
}
console.log(`${n} palette(s) rendered. Now look at them.`)
