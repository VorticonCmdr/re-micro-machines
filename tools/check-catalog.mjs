// The catalogue is hand-maintained; this keeps it honest against the real game/ directory.
//   npm run catalog
import { readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CATALOG } from '../src/data/catalog.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const GAME = join(ROOT, 'game')

const onDisk = new Set()
const walk = (dir, prefix) => {
  for (const name of readdirSync(dir)) {
    if (name === '.DS_Store') continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, `${prefix}${name}/`)
    else onDisk.add(`${prefix}${name}`)
  }
}
walk(GAME, '')

const inCatalog = new Set(CATALOG.map((e) => e.path))
const missing = [...inCatalog].filter((p) => !onDisk.has(p))
const uncatalogued = [...onDisk].filter((p) => !inCatalog.has(p))
console.log(`${onDisk.size} files on disk, ${inCatalog.size} in catalogue`)
if (missing.length) console.log('In catalogue but NOT on disk:\n  ' + missing.join('\n  '))
if (uncatalogued.length) console.log('On disk but NOT in catalogue:\n  ' + uncatalogued.join('\n  '))
if (!missing.length && !uncatalogued.length) console.log('Catalogue matches the directory exactly.')
process.exitCode = missing.length || uncatalogued.length ? 1 : 0
