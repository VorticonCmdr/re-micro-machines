// GOAL-DOS-PARITY.md Part F2: every static front-end screen against its live DOSBox frame
// (docs/engine.md §9dm). Each screen is painted from its layout (src/frontend/frontLayouts.js, the
// original's own draw calls) into the 256x200 work buffer and compared with the captured frame's
// columns 32..287 (08BC presents the work buffer at screen X+32; columns 0-31/288-319 are the
// border colour 15). All captures' DACs are INTRO.PAL, so indices are compared directly. The
// captures are tools/refs/front/<name>_a000.bin.gz (64000 B mode-13h frames, gzipped).
//   node tools/check-front.mjs            (writes tools/out/front_<name>_diff.png on a mismatch)
import { readFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'
import { buildArena } from '../src/formats/chr.js'
import { MENU_VIEW, createMenuBuffer } from '../src/render/menuView.js'
import { paintOps } from '../src/frontend/h2hScreens.js'
import { FRONT_SCREENS } from '../src/frontend/frontLayouts.js'
import { parseSettings } from '../src/formats/globaldata.js'
import { savePng, scale } from './png.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const GAME = join(ROOT, 'game')
const REFS = join(ROOT, 'tools', 'refs', 'front')
const OUT = join(ROOT, 'tools', 'out')
const { arena } = await buildArena(async (n) => new Uint8Array(readFileSync(join(GAME, n))))
const intro = readFileSync(join(GAME, 'INTRO.PAL'))
const only = process.argv[2]
const ctx = { settings: parseSettings(new Uint8Array(readFileSync(join(GAME, 'SETTINGS.DAT')))) }

let bad = 0
const report = []
for (const [name, layout] of Object.entries(FRONT_SCREENS)) {
  if (only && name !== only) continue
  const gz = join(REFS, `${name}_a000.bin.gz`), raw = join(REFS, `${name}_a000.bin`)
  if (!existsSync(gz) && !existsSync(raw)) { bad++; report.push(`${name}: capture missing`); continue }
  const ref = existsSync(gz) ? gunzipSync(readFileSync(gz)) : readFileSync(raw)
  const buf = createMenuBuffer()
  paintOps(buf, arena, layout(ctx))
  const { w, h } = MENU_VIEW
  let n = 0, first = null
  const rgba = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = buf[y * w + x], b = ref[y * 320 + x + 32], i = (y * w + x) * 4
      if (a !== b) { n++; first ??= { x, y, port: a, dos: b }; rgba.set([255, 0, 0, 255], i) } else { const v = Math.round(intro[a * 3] * 255 / 63 * 0.4); rgba.set([v, v, v, 255], i) }
    }
  }
  let outside = 0
  for (let y = 0; y < h; y++) for (let x = 0; x < 320; x++) if ((x < 32 || x >= 288) && ref[y * 320 + x] !== 15) outside++
  if (n || outside) {
    bad++
    mkdirSync(OUT, { recursive: true })
    savePng(join(OUT, `front_${name}_diff.png`), w * 3, h * 3, scale(rgba, w, h, 3))
  }
  report.push(`${name}: ${n} px differ${first ? ` (first at ${first.x},${first.y}: port ${first.port}, DOS ${first.dos})` : ''}${outside ? `, ${outside} border px not 15` : ''}`)
}
for (const line of report) console.log(line)
console.log(bad ? `check-front: ${bad} screen(s) differ` : `check-front: all ${report.length} front-end screens are pixel-exact against their DOSBox captures`)
process.exitCode = bad ? 1 : 0
