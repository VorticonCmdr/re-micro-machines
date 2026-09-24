// Plot the DS:2035 checkpoint-list thresholds against ROUND21's own progress plane (.MAP's
// second byte-plane, docs/engine.md §3 "checkpoint list pointer..."), so the buckets can be
// looked at and checked that they trace a sensible path around the course instead of being
// scattered noise -- the M3.1 acceptance test in PLAN-ENGINE.md ("checkpoint thresholds plotted
// on ROUND21 land on the course"). Not part of `npm run render`; run directly:
//   node tools/render-checkpoints.mjs [round] [race]   (defaults to round 2 race 1, the qualifier)
import { readFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseMap, MAP_SIDE } from '../src/formats/track.js'
import { checkpointList } from '../src/data/engine-tables.js'
import { savePng, scale } from './png.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'tools', 'out')
mkdirSync(OUT, { recursive: true })

const round = Number(process.argv[2]) || 2
const race = Number(process.argv[3]) || 1

const map = readFileSync(join(ROOT, 'game', 'GAME1', `ROUND${round}${race}.MAP`))
const { plane2, maxPlane2 } = parseMap(map)
const list = checkpointList(round, race)
console.log(`round ${round} race ${race}: ${list.length} checkpoint(s), max progress value on this map = ${maxPlane2}`)
list.forEach((cp, i) => console.log(`  checkpoint ${i}: lo=${cp.lo} hi=${cp.hi}`))

// Bucket index for a progress value: the checkpoint whose [lo,hi) it falls in, else -1 (gap).
function bucketOf(v) {
  for (let i = 0; i < list.length; i++) if (v >= list[i].lo && v < list[i].hi) return i
  return -1
}

// Same hue helper as render-dir.mjs / trackView.js's hueOf.
function hueOf(v, max) {
  const h = (v / (max || 1)) * 300
  const c = 200, x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
  return [r + 30, g + 30, b + 30]
}

const side = MAP_SIDE
const progressRgba = new Uint8ClampedArray(side * side * 4)
const bucketRgba = new Uint8ClampedArray(side * side * 4)
for (let i = 0; i < side * side; i++) {
  const v = plane2[i]
  const [pr, pg, pb] = hueOf(v, maxPlane2 || 255)
  progressRgba[i * 4] = pr; progressRgba[i * 4 + 1] = pg; progressRgba[i * 4 + 2] = pb; progressRgba[i * 4 + 3] = 255
  const b = bucketOf(v)
  const [br, bg, bb] = b < 0 ? [40, 40, 40] : hueOf(b, Math.max(1, list.length - 1))
  bucketRgba[i * 4] = br; bucketRgba[i * 4 + 1] = bg; bucketRgba[i * 4 + 2] = bb; bucketRgba[i * 4 + 3] = 255
}

const zoom = 8 // 32x32 tiles -> 256x256, big enough to read by eye
savePng(join(OUT, `CHECKPOINTS_ROUND${round}${race}_progress.png`), side * zoom, side * zoom, scale(progressRgba, side, side, zoom))
savePng(join(OUT, `CHECKPOINTS_ROUND${round}${race}_buckets.png`), side * zoom, side * zoom, scale(bucketRgba, side, side, zoom))
console.log(`-> CHECKPOINTS_ROUND${round}${race}_progress.png (raw .MAP plane-2 value, false colour)`)
console.log(`-> CHECKPOINTS_ROUND${round}${race}_buckets.png (checkpoint index each tile falls in, false colour per band; grey = between bands)`)
