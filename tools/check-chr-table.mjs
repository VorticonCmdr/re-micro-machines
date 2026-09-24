// The .CHR descriptor table in src/formats/chr.js is a hardcoded copy of MICROU.EXE's
// chrDescriptorTable (DS:0A14, file offset 0xA254). Keep them identical.
//   node tools/check-chr-table.mjs
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CHR_TABLE, parseChrTable } from '../src/formats/chr.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const exe = new Uint8Array(readFileSync(join(ROOT, 'game', 'MICROU.EXE')))
const fromExe = parseChrTable(exe)
let bad = 0
for (let i = 0; i < 18; i++) {
  const a = CHR_TABLE[i], b = fromExe[i]
  const same = a.name === b.name && a.height === b.height && a.width === b.width && a.frames === b.frames && a.arenaOffset === b.arenaOffset
  if (!same) { bad++; console.log('MISMATCH', a, b) }
}
console.log(bad ? `${bad} mismatches` : '18/18 descriptor records match MICROU.EXE')
process.exitCode = bad ? 1 : 0
