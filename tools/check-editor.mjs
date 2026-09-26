// npm run editor -- the level editor's byte-level core (editor.html, src/editor/):
//   1. with no edits, every level file of all 9 rounds exports byte-identical to the shipped file
//      (PR files: the original packed bytes), and nothing counts as changed;
//   2. the LZ encoder round-trips all 41 packed files through the game's decompressor, and every
//      re-encoded PR slab fits the 0x4000 packed limit;
//   3. scripted edits change exactly the bytes they should (a MAP cell's index keeps its attribute
//      bits, one COL bit, one DIR byte, a LEV field, a palette entry, a start point, a cheat spot),
//      one tile pixel re-encodes only its own PR file, meta-tiles grow CT/COL/DIR/LEV in lockstep
//      (round 2's spare LEV bytes, round 5's short DIR, round 3 full at 64), undo restores the
//      shipped bytes;
//   4. the localStorage diff round-trips into a fresh model;
//   5. the .zip passes `unzip -t` and extracts the exported bytes;
//   6. the validator passes the shipped rounds with no errors and catches broken edits.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { LevelModel, ROUNDS, RACES, paths, roundPaths, LIMITS, TILES_PER_SLAB } from '../src/editor/model.js'
import { compress } from '../src/formats/lzEncode.js'
import { decompress } from '../src/formats/lz.js'
import { makeZip } from '../src/editor/zip.js'
import { validateRound } from '../src/editor/validate.js'
import { raceFromQuery, withSavedEdits } from '../src/editor/overlaySource.js'
import { STORE_KEY } from '../src/editor/model.js'

const GAME = new URL('../game/', import.meta.url).pathname
const read = (p) => fs.readFileSync(path.join(GAME, p))
let fails = 0
const check = (ok, msg) => { if (!ok) { fails++; console.log(`FAIL ${msg}`) } }
const eq = (a, b) => a && b && a.length === b.length && a.every((v, i) => v === b[i])
const diffOffsets = (a, b) => { const out = []; for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) out.push(i); return out }

// 1. Unedited export == shipped.
const model = await LevelModel.load(read)
let nFiles = 0
const allPaths = [paths.strt(), paths.cheats(), ...ROUNDS.flatMap((r) => roundPaths(model, r))]
for (const p of allPaths) {
  nFiles++
  check(eq(model.exportFile(p), read(p)), `${p}: unedited export differs from the shipped file`)
}
check(model.changedPaths().length === 0, `unedited model reports changes: ${model.changedPaths().join(', ')}`)
check(nFiles === 2 + 9 * 5 + 29 + 26 + 24, `expected 126 level files, got ${nFiles}`)
console.log(`1. ${nFiles} level files export byte-identical with no edits`)

// 2. The encoder against every packed file.
const packedFiles = [...fs.readdirSync(GAME).filter((f) => /\.(PI\d|PH0)$/i.test(f)), ...fs.readdirSync(path.join(GAME, 'GAME1')).filter((f) => /\.(PR\d|VH0)$/i.test(f)).map((f) => `GAME1/${f}`)]
let shipped = 0, ours = 0
for (const f of packedFiles) {
  const packed = read(f), slab = decompress(packed), re = compress(slab)
  check(eq(decompress(re), slab), `${f}: encoder round trip`)
  if (/\.PR\d$/.test(f)) check(re.length <= LIMITS.packed, `${f}: re-encoded to ${re.length} > 0x4000`)
  shipped += packed.length; ours += re.length
}
check(packedFiles.length === 41, `expected 41 packed files, got ${packedFiles.length}`)
console.log(`2. encoder round-trips all ${packedFiles.length} packed files (${ours} B vs the shipped ${shipped} B)`)

// 3. Scripted edits.
{
  const m = await LevelModel.load(read, { rounds: [2, 3, 5] })
  const mp = paths.map(2, 1), before = m.bytes(mp).slice()
  const idx = 5 * 32 + 7
  const attr = before[idx] >> 6
  m.setMapTile(2, 1, idx, (before[idx] & 0x3f) === 3 ? 4 : 3)
  let d = diffOffsets(before, m.bytes(mp))
  check(d.length === 1 && d[0] === idx, `MAP tile edit changed offsets ${d}`)
  check(m.bytes(mp)[idx] >> 6 === attr, 'MAP tile edit lost the attribute bits')
  m.setMapProgress(2, 1, idx, 77)
  d = diffOffsets(before, m.bytes(mp))
  check(d.length === 2 && d[1] === 1024 + idx && m.bytes(mp)[1024 + idx] === 77, `progress edit changed offsets ${d}`)
  m.undo(); m.undo()
  check(eq(m.exportFile(mp), read(mp)), 'undo of the MAP edits does not restore the shipped file')
  m.redo()
  check(m.bytes(mp)[idx] !== before[idx], 'redo does not re-apply the MAP edit')
  m.undo()

  const col = paths.col(2), cb = m.bytes(col).slice()
  m.setColBit(2, 10, 5, 7, m.colBit(2, 10, 5, 7) ^ 1)
  d = diffOffsets(cb, m.bytes(col))
  const bitIdx = 7 * 12 + 5
  check(d.length === 1 && d[0] === 10 * 18 + (bitIdx >> 3) && (cb[d[0]] ^ m.bytes(col)[d[0]]) === (0x80 >> (bitIdx & 7)), `COL bit edit changed ${d}`)
  const dir = paths.dir(2), db = m.bytes(dir).slice()
  m.setDirByte(2, 4, 3, 2, 0x5a)
  d = diffOffsets(db, m.bytes(dir))
  check(d.length === 1 && d[0] === 4 * 36 + 2 * 6 + 3, `DIR byte edit changed ${d}`)
  const pal = paths.pal(2), pb = m.bytes(pal).slice()
  m.setPalEntry(2, 17, [63, 99, -4])
  d = diffOffsets(pb, m.bytes(pal))
  check(eq(m.palEntry(2, 17), [63, 63, 0]) && d.every((o) => o >= 51 && o < 54), 'palette edit is not clamped to 6 bits in place')
  const sb = m.bytes(paths.strt()).slice()
  m.setStrt(3, 2, 1234, 2345)
  d = diffOffsets(sb, m.bytes(paths.strt()))
  check(d.every((o) => o >= 2 * 16 + 4 && o < 2 * 16 + 8) && m.strt(3, 2).x === 1234 && m.strt(3, 2).y === 2345, `STRT_POS edit changed ${d}`)
  const chb = m.bytes(paths.cheats()).slice()
  m.setCheat(4, { ...m.cheat(4), x: 999 })
  d = diffOffsets(chb, m.bytes(paths.cheats()))
  check(d.every((o) => o >= 4 * 12 + 4 && o < 4 * 12 + 6), `CHEATS edit changed ${d}`)
  for (let k = 0; k < 7; k++) m.undo()
  check(m.changedPaths().length === 0, `undoing everything leaves changes: ${m.changedPaths()}`)

  // One tile pixel: only that PR file changes, re-encoded, and decodes to the edited slab.
  const t = 200 // slab 1
  const px = m.tilePixels(2, t).slice(); px[17] ^= 0x0f
  m.setTilePixels(2, t, px)
  check(eq(m.changedPaths(), [paths.pr(2, 1)]), `tile edit changed ${m.changedPaths()}`)
  for (const k of [0, 2]) check(eq(m.exportFile(paths.pr(2, k)), read(paths.pr(2, k))), `PR${k} not passed through after a PR1 edit`)
  const re = m.exportFile(paths.pr(2, 1))
  const want = decompress(read(paths.pr(2, 1))); want[(t - TILES_PER_SLAB) * 256 + 17] ^= 0x0f
  check(eq(decompress(re), want), 're-encoded PR1 does not decode to the edited slab')
  check(re.length <= LIMITS.packed, 're-encoded PR1 over 0x4000')
  m.undo()
  check(eq(m.exportFile(paths.pr(2, 1)), read(paths.pr(2, 1))), 'undo of a tile edit does not give back the shipped packed bytes')

  // Meta-tiles in lockstep.
  const n2 = m.metaCount(2) // 60, LEV 63
  const levLen = m.bytes(paths.lev(2)).length
  const nt = m.addMetaTile(2, 7)
  check(nt === n2 && m.metaCount(2) === n2 + 1, 'addMetaTile index')
  check(m.bytes(paths.col(2)).length === (n2 + 1) * 18 && m.bytes(paths.dir(2)).length === (n2 + 1) * 36, 'COL/DIR did not grow with CT')
  check(m.bytes(paths.lev(2)).length === levLen && m.levByte(2, n2) === m.levByte(2, 7), "round 2's spare LEV byte was not reused in place")
  check(eq(m.bytes(paths.ct(2)).subarray(n2 * 72), m.bytes(paths.ct(2)).subarray(7 * 72, 8 * 72)), 'meta-tile copy: CT')
  const n5 = m.metaCount(5), dir5 = m.bytes(paths.dir(5)).length // 57 meta-tiles, DIR ends 18 bytes into 56
  check(dir5 === 56 * 36 + 18, `round 5 DIR length ${dir5}`)
  m.addMetaTile(5)
  check(m.bytes(paths.dir(5)).length === (n5 + 1) * 36 && eq(m.bytes(paths.dir(5)).subarray(0, dir5), read(paths.dir(5))), "round 5's DIR is not zero-extended in place")
  let threw = false
  try { m.addMetaTile(3) } catch { threw = true }
  check(threw && m.metaCount(3) === 64, 'round 3 (64 meta-tiles) accepted a 65th')
  m.undo(); m.undo()
  check(m.changedPaths().length === 0, 'undo of addMetaTile')

  // A tile appended past a full slab opens a new PR file.
  const m8 = await LevelModel.load(read, { rounds: [8] })
  const start = m8.bankTileCount(8) // 285: slab 1 holds 93
  m8.begin('fill')
  for (let i = start; i < TILES_PER_SLAB * 2 + 1; i++) m8.addTile(8, 0)
  m8.commit()
  check(m8.slabCount(8) === 3 && m8.bytes(paths.pr(8, 1)).length === LIMITS.slab && m8.bytes(paths.pr(8, 2)).length === 256, 'appending past slab 1 did not open PR2')
  check(eq(m8.exportFile(paths.pr(8, 0)), read(paths.pr(8, 0))), 'PR0 not passed through')
  check(eq(decompress(m8.exportFile(paths.pr(8, 2))), m8.bytes(paths.pr(8, 2))), 'the new PR2 does not round-trip')
  console.log('3. scripted edits change exactly their bytes; undo restores the shipped files; meta-tiles and tiles append correctly')

  // 4. The saved diff.
  m.setMapTile(2, 3, 100, 9); m.setTilePixels(2, 3, new Uint8Array(256).fill(4)); m.setBrk(2, 2, [1, 2, 3])
  const json = JSON.parse(JSON.stringify(m.toJSON()))
  const fresh = await LevelModel.load(read, { rounds: [2, 3, 5] })
  fresh.applyJSON(json)
  check(eq(fresh.changedPaths(), m.changedPaths()), 'saved diff: changed set differs')
  for (const p of m.changedPaths()) check(eq(fresh.exportFile(p), m.exportFile(p)), `saved diff: ${p} differs`)
  console.log(`4. the saved diff (${Object.keys(json.files).length} files, ${JSON.stringify(json).length} chars) restores the same exports`)

  // 4b. The race page's "Test race" reads through the saved diff: raw files as saved, PR files packed.
  globalThis.localStorage = { getItem: (k) => (k === STORE_KEY ? JSON.stringify(json) : null) }
  const { read: overlay, count } = withSavedEdits(async (p) => read(p))
  check(count === Object.keys(json.files).length, 'overlay file count')
  for (const p of m.changedPaths()) {
    const got = new Uint8Array(await overlay(p))
    check(eq(/\.PR\d$/.test(p) ? decompress(got) : got, m.bytes(p)), `overlay: ${p}`)
  }
  check(eq(new Uint8Array(await overlay(paths.col(2))), read(paths.col(2))), 'overlay: an unedited file is not passed through')
  delete globalThis.localStorage
  const q = (s) => raceFromQuery(s, RACES, { round: 2, race: 1 })
  check(q('').round === 2 && q('').race === 1 && !q('').edited, 'raceFromQuery default')
  check(q('?round=9&race=3&edited=1').round === 9 && q('?round=9&race=3&edited=1').edited, 'raceFromQuery 93')
  check(q('?round=3&race=4').round === 2, 'raceFromQuery accepted race 34, which does not exist')
  console.log('4b. the race page reads the saved edits (PR files packed on the fly) and only real races')

  // 5. The zip.
  const entries = m.changedPaths().map((p) => ({ name: p, bytes: m.exportFile(p) }))
  const dirTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-editor-'))
  const zipPath = path.join(dirTmp, 'level.zip')
  fs.writeFileSync(zipPath, makeZip(entries))
  try {
    execFileSync('unzip', ['-tq', zipPath])
    execFileSync('unzip', ['-q', zipPath, '-d', path.join(dirTmp, 'x')])
    for (const e of entries) check(eq(fs.readFileSync(path.join(dirTmp, 'x', e.name)), e.bytes), `zip: ${e.name} extracted differently`)
    console.log(`5. the .zip passes unzip -t and extracts ${entries.length} exact files`)
  } catch (err) { check(false, `unzip: ${err.message}`) }
  fs.rmSync(dirTmp, { recursive: true, force: true })
}

// 6. The validator.
for (const r of ROUNDS) {
  const errs = validateRound(model, r, { pack: true }).filter((i) => i.level === 'error')
  check(errs.length === 0, `round ${r} shipped files fail validation: ${errs.map((e) => `${e.file}: ${e.msg}`).join('; ')}`)
}
{
  const m = await LevelModel.load(read, { rounds: [1] })
  const hasErr = (re) => validateRound(m, 1).some((i) => i.level === 'error' && re.test(i.msg))
  m.begin('zero'); for (let i = 0; i < 1024; i++) m.setMapProgress(1, 2, i, 0); m.commit()
  check(hasErr(/all 0/) && hasErr(/checkpoint 0/), 'an all-zero progress plane passes')
  m.undo()
  m.setCtWord(1, 3, 0, 0, 5000)
  check(hasErr(/past the bank/), 'a CT word past the bank passes')
  m.undo()
  m.setBrk(1, 1, new Uint8Array(0x201))
  check(hasErr(/0x200/), 'a BRK over 0x200 passes')
  m.undo()
  check(validateRound(m, 1).filter((i) => i.level === 'error').length === 0, 'undo does not clear the errors')
}
console.log('6. the shipped rounds validate with no errors; broken edits are caught')

// The page is in the build.
check(/editor:\s*'editor\.html'/.test(fs.readFileSync(new URL('../vite.config.js', import.meta.url), 'utf8')), 'vite.config.js does not build editor.html')

if (fails) { console.log(`${fails} failure(s)`); process.exit(1) }
console.log('editor: all checks passed')
