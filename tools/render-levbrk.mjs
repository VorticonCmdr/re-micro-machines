// Render a sample ROUNDnBR.LEV and ROUNDnmB.BRK through the decoder to PNG, for a look-and-check
// (mirrors the colouring in src/ui/views/levBrkView.js). Not part of `npm run render` (that script
// only covers palette-driven graphics); run directly: node tools/render-levbrk.mjs
import { readFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseLev, parseBrk } from '../src/formats/levbrk.js'
import { savePng } from './png.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'tools', 'out')
mkdirSync(OUT, { recursive: true })

function renderLev(path, out) {
  const { count, entries } = parseLev(readFileSync(join(ROOT, 'game', path)))
  const cell = 16, cols = 16, rows = Math.ceil(count / cols)
  const w = cols * cell, h = rows * cell
  const rgba = new Uint8ClampedArray(w * h * 4)
  const headingColor = [[80, 140, 255], [255, 140, 80], [140, 255, 80], [255, 80, 200]]
  for (let t = 0; t < count; t++) {
    const e = entries[t]
    const x0 = (t % cols) * cell, y0 = Math.floor(t / cols) * cell
    const [r, g, b] = headingColor[(e.raw >> 5) & 3]
    for (let y = 0; y < cell; y++) for (let x = 0; x < cell; x++) {
      const border = e.unsafeRespawn && (x < 2 || y < 2 || x >= cell - 2 || y >= cell - 2)
      const nx = cell / 2 + Math.sign(e.nudge.dx) * 4, ny = cell / 2 + Math.sign(e.nudge.dy) * 4
      const dot = Math.abs(x - nx) <= 1.5 && Math.abs(y - ny) <= 1.5
      const i = ((y0 + y) * w + (x0 + x)) * 4
      if (border) { rgba[i] = 230; rgba[i + 1] = 40; rgba[i + 2] = 40 } else if (dot) { rgba[i] = 255; rgba[i + 1] = 255; rgba[i + 2] = 255 } else { rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b }
      rgba[i + 3] = 255
    }
  }
  savePng(out, w, h, rgba)
  console.log(`${path}: ${count} tiles, ${entries.filter((e) => e.unsafeRespawn).length} not-safe-respawn -> ${out}`)
}

function renderBrk(path, out) {
  const { count, records } = parseBrk(readFileSync(join(ROOT, 'game', path)))
  const colW = Math.max(2, Math.min(8, Math.floor(600 / Math.max(1, count))))
  const h = 64, w = count * colW
  const rgba = new Uint8ClampedArray(w * h * 4)
  const typeColor = { 1: [230, 140, 40], 2: [60, 140, 230] } // everything else (0, 3-15) hits the shared default branch (1000:54AF) -> gray
  const colorFor = (type) => typeColor[type] ?? [120, 120, 120]
  for (let i = 0; i < count; i++) {
    const r = records[i]
    const [cr, cg, cb] = colorFor(r.type)
    const barH = Math.round((r.magnitude / 15) * (h - 1)) + 1
    for (let y = 0; y < barH; y++) for (let x = 0; x < colW - 1; x++) {
      const i4 = ((h - 1 - y) * w + i * colW + x) * 4
      rgba[i4] = cr; rgba[i4 + 1] = cg; rgba[i4 + 2] = cb; rgba[i4 + 3] = 255
    }
  }
  savePng(out, w, h, rgba)
  const byType = {}; for (const r of records) byType[r.type] = (byType[r.type] || 0) + 1
  console.log(`${path}: ${count} records, by type ${JSON.stringify(byType)} -> ${out}`)
}

for (let r = 1; r <= 9; r++) renderLev(`GAME1/ROUND${r}BR.LEV`, join(OUT, `LEV_ROUND${r}.png`))
renderBrk('GAME1/ROUND31B.BRK', join(OUT, 'BRK_ROUND31.png')) // round 3 race 1: the largest / most complex
renderBrk('GAME1/ROUND21B.BRK', join(OUT, 'BRK_ROUND21.png')) // round 2 race 1: the smallest
