// Decompress every LZ-packed file with src/formats/lz.js and report sizes; with --dump DIR,
// also write the unpacked bytes so they can be diffed against another implementation or a
// DOSBox memory dump.
//   node tools/check-lz.mjs [--dump DIR]
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { decompress } from '../src/formats/lz.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const GAME = join(ROOT, 'game')
const dumpDir = process.argv.includes('--dump') ? process.argv[process.argv.indexOf('--dump') + 1] : null
if (dumpDir) mkdirSync(dumpDir, { recursive: true })

const files = [
  ...[0, 1, 2, 3, 4, 5, 6].map((n) => `COMPRESS.PI${n}`),
  'BITSFILE.PH0',
  ...readdirSync(join(GAME, 'GAME1')).filter((f) => /BR\.(PR\d|VH0)$/.test(f)).sort().map((f) => `GAME1/${f}`),
]
let ok = 0
for (const f of files) {
  const packed = new Uint8Array(readFileSync(join(GAME, f)))
  try {
    const out = decompress(packed)
    console.log(`${f.padEnd(24)} ${String(packed.length).padStart(6)} -> ${String(out.length).padStart(6)} (0x${out.length.toString(16)})`)
    if (dumpDir) writeFileSync(join(dumpDir, f.replace('/', '_') + '.bin'), out)
    ok++
  } catch (err) {
    console.log(`${f.padEnd(24)} FAILED: ${err.message}`)
  }
}
console.log(`${ok}/${files.length} decompressed`)
process.exitCode = ok === files.length ? 0 : 1
