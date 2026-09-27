// Build favicon.png from MINATURE.CHR frame 0 (the round-1 SPORTSCARS miniature) with INTRO.PAL,
// colour 0 transparent (the front end's ordinary blit, src/render/blit.js). The 32×16 frame is
// centred in a 32×32 square so browsers don't stretch it.
//
//   node tools/make-favicon.mjs    # writes favicon.png at the project root -- then LOOK at it

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { decodePalette } from '../src/formats/pal.js'
import { buildArena, chrFrame, CHR_TABLE } from '../src/formats/chr.js'
import { indexedToRgba } from '../src/render/raster.js'
import { savePng } from './png.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (path) => {
  const b = readFileSync(join(ROOT, 'game', path))
  return new Uint8Array(b.buffer, b.byteOffset, b.length)
}

const { arena } = await buildArena(read)
const rgb = decodePalette(read('INTRO.PAL'), { bits: 6 }).rgb
const frame = chrFrame(arena, CHR_TABLE.find((r) => r.name === 'MINATURE.CHR'), 0)
const sprite = indexedToRgba(frame.indexed, rgb, { transparent: 0 })

const size = 32
const out = new Uint8ClampedArray(size * size * 4)
const y0 = (size - frame.height) >> 1
for (let y = 0; y < frame.height; y++) out.set(sprite.subarray(y * frame.width * 4, (y + 1) * frame.width * 4), ((y0 + y) * size) * 4)
savePng(join(ROOT, 'favicon.png'), size, size, out)
console.log(`favicon.png: MINATURE.CHR frame 0 (${frame.width}x${frame.height}) centred in ${size}x${size}`)
