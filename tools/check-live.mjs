// Pixel-diff the track renderer (and, since 2026-09-21, the HUD) against a real frame captured
// from the game under DOSBox.
//
// The frame (tools/refs/race_R21_a000.bin) shows POWERBOATS round 2 race 1 with the camera at
// world (414, 500) — found by an exhaustive 1-px search over the 3072×3072 toroidal world on the
// static top part of the view. At that camera every TRACK pixel matches the assembled MAP×CT×PR
// render, and (docs/engine.md §9o) every HUD pixel matches `drawHud`'s output byte-for-byte; the
// only remaining excluded region is the boat itself with its wake (M3.6's own trace-diff is the
// real test for car position/sprite, not this static frame). This is the "does this look like the
// real game" check for the track+HUD pipeline: if either regresses, the mismatch count outside the
// boat box jumps from 0.
//
// Scope: ONE frame of ONE round. It proves the round-2 base-tile chain and the default (four-car)
// HUD branch; other rounds' tiles are covered only by npm run tracks + looking, and the HUD's
// round-9/two-car branches aren't ported at all (docs/engine.md §9o). The overlay pass (bit 15 →
// tile+12) is NOT exercised here: the +12 tiles in this view are the base graphic with the water
// cut out, so drawing them over an empty track changes no pixel (they matter only over cars). The
// camera and the boat box are tuned to this capture; a new reference frame needs both re-derived
// (see the search in git history / docs/track-graphics.md).
//
// The HUD car array below (colourOffset/lapsRemaining/racePosition per slot) is this specific
// capture's own actual state, reverse-engineered from the reference frame itself (not assumed):
// found by rendering each of the 4 possible colourOffsets' recoloured icon and matching it
// pixel-for-pixel against each of the 4 HUD rows (scratch script, not kept — the result is this
// table), then confirming car-slot-0's own lapsRemaining (the standalone top digit) the same way.
// A car's *identity* (which STRT_POS grid slot it is) doesn't matter for this static check, only
// its HUD-visible fields.
//
//   node tools/check-live.mjs           # prints counts, writes tools/out/LIVE_vs_render_R21.png
import { readFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadTileBank, buildWordMap } from '../src/formats/race.js'
import { composeRaceView } from '../src/render/raceView.js'
import { decodePalette, dac6ToRgb8 } from '../src/formats/pal.js'
import { decompress } from '../src/formats/lz.js'
import { savePng, scale } from './png.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const GAME = join(ROOT, 'game')
const OUT = join(ROOT, 'tools', 'out')
mkdirSync(OUT, { recursive: true })
const read = async (n) => new Uint8Array(readFileSync(join(GAME, n)))

const ROUND = 2, RACE = 1, CAM = { x: 414, y: 500 }
const VIEW_X = 32, VIEW_W = 256, VIEW_H = 200
const BOAT = { x0: 116, x1: 138, y0: 86, y1: 113 } // the player's boat + wake in this frame (24×24 sprite)
// This capture's own HUD state (see the header comment above for how it was found): car 0 is 4th
// with a lap-count of 4 (the standalone top digit reads car 0's own lapsRemaining, docs/engine.md
// §9o), car 1 is 3rd, car 2 is 1st, car 3 is 2nd.
const HUD_CARS = [
  { colourOffset: 0, lapsRemaining: 4, racePosition: 4 },
  { colourOffset: 2, lapsRemaining: 1, racePosition: 3 },
  { colourOffset: 4, lapsRemaining: 1, racePosition: 1 },
  { colourOffset: 6, lapsRemaining: 1, racePosition: 2 },
]

const a000 = new Uint8Array(readFileSync(join(ROOT, 'tools', 'refs', 'race_R21_a000.bin')))
const dac = new Uint8Array(readFileSync(join(ROOT, 'tools', 'refs', 'race_R21_dac.bin')))
const pal = await read(`GAME1/ROUND${ROUND}.PAL`)

// 1. The live DAC must equal the round palette file (6-bit values verbatim).
let dacDiff = 0
for (let i = 0; i < 768; i++) if (dac[i] !== pal[i]) dacDiff++
console.log(`DAC vs ROUND${ROUND}.PAL: ${dacDiff} differing bytes`)

// 2. Assemble the world and compare the view window, through the M3.2 race compositor (D5): base
// tiles -> cars (none here: this frame's boat is excluded below, not modelled) -> overlay tiles ->
// HUD (docs/engine.md §9o; `frames: []` keeps the vehicle-body layer off, so HUD_CARS above only
// ever drives drawHud, never a body sprite -- the boat itself stays excluded, see BOAT above).
// This is the same tile/overlay/HUD path RenderRaceFrameToBackBuffer takes, just windowed instead
// of pre-rendering the whole 3072x3072 world; a 0-pixel regression here is `composeRaceView`'s own
// non-regression guard, not a claim about the (unrendered) car body layer.
const { bytes: bank } = await loadTileBank(read, ROUND)
const words = buildWordMap(await read(`GAME1/ROUND${ROUND}${RACE}.MAP`), await read(`GAME1/ROUND${ROUND}BR.CT`), ROUND)
const ph0 = decompress(await read('BITSFILE.PH0'))
const view = new Uint8Array(VIEW_W * VIEW_H)
for (let y = 0; y < VIEW_H; y++) view.set(a000.subarray(y * 320 + VIEW_X, y * 320 + VIEW_X + VIEW_W), y * VIEW_W)
const composed = composeRaceView({ words, bank, camera: CAM, cars: HUD_CARS, frames: [], view: { w: VIEW_W, h: VIEW_H }, hud: { ph0, raceFormat: 1, round: ROUND } })
const rendered = (x, y) => composed.indexed[y * VIEW_W + x]

let total = 0, outside = 0
const mask = new Uint8Array(VIEW_W * VIEW_H)
for (let y = 0; y < VIEW_H; y++) for (let x = 0; x < VIEW_W; x++) {
  if (rendered(x, y) === view[y * VIEW_W + x]) continue
  total++; mask[y * VIEW_W + x] = 1
  const inBoat = x >= BOAT.x0 && x <= BOAT.x1 && y >= BOAT.y0 && y <= BOAT.y1
  if (!inBoat) outside++
}
console.log(`view pixels differing: ${total} of ${VIEW_W * VIEW_H} (${((100 * total) / (VIEW_W * VIEW_H)).toFixed(2)}%)`)
console.log(`differing OUTSIDE the boat box (HUD now included): ${outside}  ${outside === 0 ? 'OK — track+HUD pipeline matches the game' : 'REGRESSION'}`)

// 3. Side-by-side PNG: live | rendered | diff.
const rgb = decodePalette(pal).rgb
const out = new Uint8ClampedArray(VIEW_W * 3 * VIEW_H * 4)
for (let y = 0; y < VIEW_H; y++) for (let x = 0; x < VIEW_W; x++) {
  const put = (x0, r, g, b) => { const o = (y * VIEW_W * 3 + x0 + x) * 4; out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = 255 }
  let p = view[y * VIEW_W + x] * 3; put(0, rgb[p], rgb[p + 1], rgb[p + 2])
  p = rendered(x, y) * 3; put(VIEW_W, rgb[p], rgb[p + 1], rgb[p + 2])
  const d = mask[y * VIEW_W + x]; put(VIEW_W * 2, d ? 255 : 0, d ? 0 : 40, d ? 0 : 40)
}
const path = join(OUT, 'LIVE_vs_render_R21.png')
savePng(path, VIEW_W * 3 * 2, VIEW_H * 2, scale(out, VIEW_W * 3, VIEW_H, 2))
console.log(`wrote ${path}  (live | rendered | diff)`)
process.exitCode = dacDiff === 0 && outside === 0 ? 0 : 1
