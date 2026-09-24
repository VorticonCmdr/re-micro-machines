// Render a track's assembled .DIR flow field (terrain grade+ramp, and direction/heading) to PNG —
// the look-and-check for the bit-field model in docs/track-layout.md. Mirrors the colouring in
// src/ui/views/trackView.js's mapView. Not part of `npm run render`; run directly:
//   node tools/render-dir.mjs [round ...]   (defaults to one race per round, 1-9)
import { readFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirMap, dirGrade, dirIsRamp, dirHeading } from '../src/formats/track.js'
import { savePng, scale } from './png.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'tools', 'out')
mkdirSync(OUT, { recursive: true })
const rounds = process.argv.slice(2).map(Number).filter(Boolean)
const list = rounds.length ? rounds : [1, 2, 3, 4, 5, 6, 7, 8, 9]

// Same false-colour hue helper as trackView.js's hueOf, reproduced here so this script has no DOM deps.
function hueOf(v, max) {
  const h = (v / (max || 1)) * 300
  const c = 200, x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
  return [r + 30, g + 30, b + 30]
}

for (const r of list) {
  const map = readFileSync(join(ROOT, 'game', 'GAME1', `ROUND${r}1.MAP`))
  const dir = readFileSync(join(ROOT, 'game', 'GAME1', `ROUND${r}.DIR`))
  const d = dirMap(map, dir)
  const gradeRgba = new Uint8ClampedArray(d.width * d.height * 4)
  const headRgba = new Uint8ClampedArray(d.width * d.height * 4)
  for (let i = 0; i < d.indexed.length; i++) {
    const v = d.indexed[i]
    const [gr, gg, gb] = dirIsRamp(v) ? [230, 40, 40] : hueOf(dirGrade(v), 15)
    gradeRgba[i * 4] = gr; gradeRgba[i * 4 + 1] = gg; gradeRgba[i * 4 + 2] = gb; gradeRgba[i * 4 + 3] = 255
    const [hr, hg, hb] = hueOf(dirHeading(v), 255)
    headRgba[i * 4] = hr; headRgba[i * 4 + 1] = hg; headRgba[i * 4 + 2] = hb; headRgba[i * 4 + 3] = 255
  }
  const zoom = 2
  savePng(join(OUT, `DIR_ROUND${r}_grade.png`), d.width * zoom, d.height * zoom, scale(gradeRgba, d.width, d.height, zoom))
  savePng(join(OUT, `DIR_ROUND${r}_heading.png`), d.width * zoom, d.height * zoom, scale(headRgba, d.width, d.height, zoom))
  console.log(`round ${r}: ${d.width}x${d.height} -> DIR_ROUND${r}_grade.png, DIR_ROUND${r}_heading.png`)
}
