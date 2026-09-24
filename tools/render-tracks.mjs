// Assemble every track from ROUNDnm.MAP + ROUNDnBR.CT + the PR tile bank and write quarter-scale
// PNGs, plus the 32-frame vehicle strip per round. Uses the SAME src/formats modules as the viewer.
//   node tools/render-tracks.mjs [round ...]     # default: all rounds
import { readFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadTileBank, buildWordMap, renderTrack, downscaleRgba, tileCount, vehicleFrames, frameStrip } from '../src/formats/race.js'
import { decodePalette } from '../src/formats/pal.js'
import { decompress } from '../src/formats/lz.js'
import { indexedToRgba } from '../src/render/raster.js'
import { RACES_PER_ROUND } from '../src/data/catalog.js'
import { savePng, scale } from './png.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const GAME = join(ROOT, 'game')
const OUT = join(ROOT, 'tools', 'out')
mkdirSync(OUT, { recursive: true })
const read = async (n) => new Uint8Array(readFileSync(join(GAME, n)))
const rounds = process.argv.slice(2).map(Number).filter(Boolean)
const list = rounds.length ? rounds : [1, 2, 3, 4, 5, 6, 7, 8, 9]

for (const round of list) {
  const { bytes: bank, chunks } = await loadTileBank(read, round)
  const rgb = decodePalette(await read(`GAME1/ROUND${round}.PAL`)).rgb
  const ct = await read(`GAME1/ROUND${round}BR.CT`)
  for (let race = 1; race <= RACES_PER_ROUND[round]; race++) {
    const words = buildWordMap(await read(`GAME1/ROUND${round}${race}.MAP`), ct, round)
    let maxIdx = 0, overlays = 0
    for (const w of words) { const i = w & 0x7fff; if (i > maxIdx) maxIdx = i; if (w & 0x8000) overlays++ }
    const img = renderTrack(words, bank)
    const small = downscaleRgba(indexedToRgba(img.indexed, rgb), img.width, img.height, 4)
    const path = join(OUT, `TRACK_R${round}${race}_quarter.png`)
    savePng(path, small.width, small.height, small.rgba)
    console.log(`round ${round} race ${race}: bank ${tileCount(bank)} tiles (${chunks.join('+')}), max tile ${maxIdx}${maxIdx >= tileCount(bank) ? ' OUT OF RANGE' : ''}, overlay words ${overlays} -> ${path}`)
  }
  const { size, frames } = vehicleFrames(decompress(await read(`GAME1/ROUND${round}BR.VH0`)), round)
  const strip = frameStrip(frames, size)
  const path = join(OUT, `VEHICLE_R${round}.png`)
  savePng(path, strip.width * 2, strip.height * 2, scale(indexedToRgba(strip.indexed, rgb, { transparent: 0 }), strip.width, strip.height, 2))
  console.log(`round ${round}: ${frames.length} vehicle frames of ${size}x${size} -> ${path}`)
}
