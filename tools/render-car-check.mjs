// M3.2 eyeball check: render a car sprite (body + colour remap + airborne shadow) through the new
// compositor at the boat's approximate position/frame in the one live reference frame, and put it
// next to the real boat crop so a human can compare.
//
// This is NOT a pixel-diff like npm run live: we have no live CarRecord dump for
// tools/refs/race_R21_a000.bin (no per-step trace exists yet, that's M3.4), so the boat's exact
// world position/heading/z are unknown. What IS known: the camera (414,500) that makes the track
// pixel-exact (tools/check-live.mjs), and the boat's screen bbox in that frame (x116-138,y86-113).
// The draw anchor (sprite centred at car pos, docs/engine.md §9d, src/render/raceView.js) puts
// the followed car at screen centre (128,100) — this script renders candidate headings there and
// crops the same region from the real frame so the two can be eyeballed side by side.
//
//   node tools/render-car-check.mjs   # writes tools/out/CAR_CHECK_R21.png
import { readFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { decompress } from '../src/formats/lz.js'
import { vehicleFrames } from '../src/formats/race.js'
import { composeRaceView } from '../src/render/raceView.js'
import { decodePalette } from '../src/formats/pal.js'
import { savePng, scale } from './png.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const GAME = join(ROOT, 'game')
const OUT = join(ROOT, 'tools', 'out')
mkdirSync(OUT, { recursive: true })
const read = (n) => new Uint8Array(readFileSync(join(GAME, n)))

const ROUND = 2, CAM = { x: 414, y: 500 }
const VIEW_X = 32, VIEW_W = 256, VIEW_H = 200
const CROP = { x0: 96, y0: 66, size: 64 } // 64x64 around the boat's screen box (116-138,86-113)

const pal = decodePalette(read(`GAME1/ROUND${ROUND}.PAL`))
const a000 = new Uint8Array(readFileSync(join(ROOT, 'tools', 'refs', 'race_R21_a000.bin')))

function cropReal() {
  const out = new Uint8Array(CROP.size * CROP.size)
  for (let y = 0; y < CROP.size; y++) {
    const srcRow = (CROP.y0 + y) * 320 + VIEW_X + CROP.x0
    out.set(a000.subarray(srcRow, srcRow + CROP.size), y * CROP.size)
  }
  return { width: CROP.size, height: CROP.size, indexed: out }
}

// A flat (transparent-colour) tile bank + all-zero word map: composeRaceView's tile layer draws
// colour 0 everywhere, so only the car layer shows -- lets us render just the sprite at an exact
// screen position without needing the real ROUND2 track assembled underneath.
const blankBank = new Uint8Array(256).fill(60) // a mid palette index, so the colour-0 shadow shows up against it
const blankWords = new Uint16Array(192 * 192) // real-sized so drawTileBase/Overlay never index out of bounds

function renderCarAt(heading, height, colourOffset, frames) {
  // World position matching screen centre (128,100) at the live camera (414,500); the crop's own
  // "camera" is just CAM shifted by the crop's own top-left, so the car lands at the same relative
  // spot inside the 64x64 crop as it would inside the full 256x200 view.
  const carScreenX = CAM.x + 128, carScreenY = CAM.y + 100
  return composeRaceView({
    words: blankWords, bank: blankBank, camera: { x: CAM.x + CROP.x0, y: CAM.y + CROP.y0 },
    frames, cars: [{ posX: carScreenX, posY: carScreenY, heading, height, colourOffset }],
    view: { w: CROP.size, h: CROP.size },
  })
}

const vh0 = decompress(read(`GAME1/ROUND${ROUND}BR.VH0`))
const { frames, size } = vehicleFrames(vh0, ROUND)
console.log(`ROUND${ROUND}BR.VH0: ${frames.length} rotation frames of ${size}x${size}`)

const headings = [0, 32, 64, 96, 128, 160, 192, 224] // every 4th frame (0,4,8,...,28) -> 8 of the 32 headings
const panels = [{ label: 'real (boat crop)', img: cropReal() }, ...headings.map((h) => ({ label: `heading ${h} (frame ${h >> 3})`, img: renderCarAt(h, 0, 0, frames) }))]
panels.push({ label: 'z=10 shadow demo', img: renderCarAt(64, 10, 0, frames) })

// Composite: one row, panels side by side, each upscaled 3x with a 4px gutter and a caption row below.
const Z = 3, GUT = 4, CAP_H = 12
const cellW = CROP.size * Z + GUT
const totalW = cellW * panels.length
const totalH = CROP.size * Z + CAP_H
const rgba = new Uint8ClampedArray(totalW * totalH * 4)
rgba.fill(30) // dark grey background, alpha channel fixed below
for (let i = 0; i < rgba.length; i += 4) rgba[i + 3] = 255

function drawPanel(px0, img) {
  const up = scale(indexedToRgba(img.indexed, pal.rgb), img.width, img.height, Z)
  for (let y = 0; y < img.height * Z; y++) {
    for (let x = 0; x < img.width * Z; x++) {
      const so = (y * img.width * Z + x) * 4
      const d = (y * totalW + (px0 + x)) * 4
      rgba[d] = up[so]; rgba[d + 1] = up[so + 1]; rgba[d + 2] = up[so + 2]; rgba[d + 3] = 255
    }
  }
}
function indexedToRgba(indexed, rgb) {
  const out = new Uint8ClampedArray(indexed.length * 4)
  for (let i = 0, o = 0; i < indexed.length; i++, o += 4) {
    const p = indexed[i] * 3
    out[o] = rgb[p]; out[o + 1] = rgb[p + 1]; out[o + 2] = rgb[p + 2]; out[o + 3] = 255
  }
  return out
}

panels.forEach((p, i) => drawPanel(i * cellW, p.img))

savePng(join(OUT, 'CAR_CHECK_R21.png'), totalW, totalH, rgba)
console.log(`wrote ${join(OUT, 'CAR_CHECK_R21.png')}`)
console.log(panels.map((p) => p.label).join(' | '))
