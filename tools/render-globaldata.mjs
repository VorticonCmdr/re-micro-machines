// Render STRT_POS.BIN and CHEATS.BIN as scatter plots on the 3072×3072 world, for a look-and-check
// of src/formats/globaldata.js (mirrors the colouring in src/ui/views/globalDataView.js).
//   node tools/render-globaldata.mjs
import { readFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseStrtPos, parseCheats } from '../src/formats/globaldata.js'
import { savePng, scale } from './png.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'tools', 'out')
mkdirSync(OUT, { recursive: true })
const WORLD = 3072

function hueOf(n, max) {
  const h = (n / (max || 1)) * 300
  const c = 200, x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
  return [r + 30, g + 30, b + 30]
}

function scatter(points, side = 192) {
  const rgba = new Uint8ClampedArray(side * side * 4)
  for (const { x, y, round } of points) {
    const px = Math.min(side - 1, Math.round((x / WORLD) * side))
    const py = Math.min(side - 1, Math.round((y / WORLD) * side))
    const [r, g, b] = hueOf(round, 9)
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const px2 = px + dx, py2 = py + dy
      if (px2 < 0 || py2 < 0 || px2 >= side || py2 >= side) continue
      const i = (py2 * side + px2) * 4
      rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b; rgba[i + 3] = 255
    }
  }
  return rgba
}

const zoom = 2
const sp = parseStrtPos(readFileSync(join(ROOT, 'game', 'GAME1', 'STRT_POS.BIN')))
savePng(join(OUT, 'STRT_POS_scatter.png'), 192 * zoom, 192 * zoom, scale(scatter(sp), 192, 192, zoom))
console.log(`STRT_POS.BIN: ${sp.length} slots -> STRT_POS_scatter.png`)

const ch = parseCheats(readFileSync(join(ROOT, 'game', 'GAME1', 'CHEATS.BIN')))
savePng(join(OUT, 'CHEATS_scatter.png'), 192 * zoom, 192 * zoom, scale(scatter(ch), 192, 192, zoom))
console.log(`CHEATS.BIN: ${ch.length} records -> CHEATS_scatter.png`)
