// The level editor's document model (editor.html), DOM-free so tools/check-editor.mjs can run it
// in Node.
//
// The model is the files' own bytes. Every level file is held as one Uint8Array at its shipped
// length, and every decoded value the editor shows (a MAP cell's meta-tile and attribute bits,
// a COL bit, a DIR nibble, a LEV field, a BRK record, a STRT_POS/CHEATS word, a 6-bit DAC value)
// is read from and written to those bytes in place. So an unedited file exports byte-identical,
// and oddities of the shipped files survive: round 2's 63-byte LEV for 60 meta-tiles, round 5's
// DIR ending 18 bytes into meta-tile 56 (docs/track-layout.md, docs/engine.md §9ac).
//
// The tile banks (ROUNDnBR.PR0/1/2) are LZ-packed, so they are held unpacked, one 48 KB slab per
// file (LoadCompressedSeries 1000:3547 unpacks each file to its own 0xC000 stride). On export an
// unchanged slab gives back its original packed bytes; a changed one is re-encoded
// (src/formats/lzEncode.js), which the game's decompressor turns back into exactly that slab.
//
// Files, formats and the game's own limits (docs/editor.md has the evidence):
//   GAME1/ROUNDnm.MAP   2048 B: 32×32 meta-tile bytes (bits 0-5 index, 6-7 attribute) + a 32×32
//                       track-progress plane
//   GAME1/ROUNDnmB.BRK  the AI brake stream, one byte per progress value (read through a 0x200 buffer)
//   GAME1/ROUNDnBR.CT   72 B per meta-tile: 6×6 little-endian bank tile words
//   GAME1/ROUNDn.COL    18 B per meta-tile: 12×12 collision bits, MSB first
//   GAME1/ROUNDn.DIR    36 B per meta-tile: 6×6 bytes, grade <<4 | direction
//   GAME1/ROUNDnBR.LEV  1 B per meta-tile (read through a 0x80 buffer)
//   GAME1/ROUNDn.PAL    768 B of 6-bit DAC values
//   GAME1/ROUNDnBR.PRk  the LZ-packed tile bank, 256 B per 16×16 tile
//   GAME1/STRT_POS.BIN  9 rounds × 4 race slots × {x, y}
//   GAME1/CHEATS.BIN    30 × {round, race, x, y, type, param}

import { decompress } from '../formats/lz.js'
import { compress } from '../formats/lzEncode.js'

/** localStorage key of the saved edits (app.js writes it, overlaySource.js reads it for the race page). */
export const STORE_KEY = 'mm-level-editor'

export const RACES = { 1: 4, 2: 4, 3: 3, 4: 3, 5: 3, 6: 3, 7: 3, 8: 3, 9: 3 }
export const ROUNDS = [1, 2, 3, 4, 5, 6, 7, 8, 9]

/** The game's own buffer and format limits, each [STATIC] from the disassembly (docs/editor.md). */
export const LIMITS = {
  metaTiles: 64, // the MAP byte's 6-bit index (AND 0x3F at 1000:58c8); COL 0x480/18, DIR 0x900/36
  map: 0x800,
  col: 0x480, // DS:3163
  dir: 0x900, // DS:35E3
  lev: 0x80, // DS:1B5B, read with CX=0x80 (1000:3bba)
  brk: 0x200, // DS:195B, read with CX=0x200 (1000:3b92)
  packed: 0x4000, // each PR file is read to 7D78:C000 (1000:3581-358E), the segment's last 16 KB
  slab: 0xc000, // one file's unpacked size; the loader steps 48 KB per file (1000:35A7)
  bank: 0x20000, // PR slabs land at 2B78.., the word-map arenas (built first) start at 4B78
  tileBytes: 256,
  ctWord: 0x7fff, // bit 15 is the engine's overlay flag, ORed in at race setup (1000:3994)
}
export const TILES_PER_SLAB = LIMITS.slab / LIMITS.tileBytes // 192
export const MAX_BANK_TILES = LIMITS.bank / LIMITS.tileBytes // 512

export const paths = {
  map: (round, race) => `GAME1/ROUND${round}${race}.MAP`,
  brk: (round, race) => `GAME1/ROUND${round}${race}B.BRK`,
  ct: (round) => `GAME1/ROUND${round}BR.CT`,
  col: (round) => `GAME1/ROUND${round}.COL`,
  dir: (round) => `GAME1/ROUND${round}.DIR`,
  lev: (round) => `GAME1/ROUND${round}BR.LEV`,
  pal: (round) => `GAME1/ROUND${round}.PAL`,
  pr: (round, k) => `GAME1/ROUND${round}BR.PR${k}`,
  strt: () => 'GAME1/STRT_POS.BIN',
  cheats: () => 'GAME1/CHEATS.BIN',
}

/** Every level file path of a round (PR files as far as they exist in the model), races included. */
export function roundPaths(model, round) {
  const out = [paths.ct(round), paths.col(round), paths.dir(round), paths.lev(round), paths.pal(round)]
  for (let race = 1; race <= RACES[round]; race++) {
    out.push(paths.map(round, race))
    if (model.has(paths.brk(round, race))) out.push(paths.brk(round, race))
  }
  for (let k = 0; model.has(paths.pr(round, k)); k++) out.push(paths.pr(round, k))
  return out
}

const isPr = (path) => /\.PR\d$/i.test(path)
const eq = (a, b) => {
  if (a === b) return true
  if (!a || !b || a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}
// A plain Uint8Array copy: a Node Buffer's slice() is a view, which would alias the undo snapshots.
const u8 = (x) => (x instanceof Uint8Array && x.constructor === Uint8Array ? x : new Uint8Array(x))

export class LevelModel {
  constructor() {
    this.cur = new Map() // path -> Uint8Array (a PR path holds its UNPACKED slab)
    this.orig = new Map() // the same, as loaded
    this.origPacked = new Map() // PR path -> the shipped packed bytes
    this.undoStack = []
    this.redoStack = []
    this.tx = null
    this.listeners = new Set()
    this.packCache = new Map() // PR path -> {slab, packed}
  }

  /** Load every level file of every round (all small; 23 PR files to unpack). */
  static async load(read, { rounds = ROUNDS } = {}) {
    const m = new LevelModel()
    const tryRead = async (p) => { try { return u8(await read(p)) } catch { return null } }
    const want = [paths.strt(), paths.cheats()]
    for (const r of rounds) {
      want.push(paths.ct(r), paths.col(r), paths.dir(r), paths.lev(r), paths.pal(r))
      for (let race = 1; race <= RACES[r]; race++) want.push(paths.map(r, race), paths.brk(r, race))
    }
    const got = await Promise.all(want.map(tryRead))
    want.forEach((p, i) => { if (got[i]) m._setOrig(p, got[i]) })
    for (const r of rounds) {
      for (let k = 0; k < 10; k++) {
        const packed = await tryRead(paths.pr(r, k))
        if (!packed) break
        m.origPacked.set(paths.pr(r, k), packed)
        m._setOrig(paths.pr(r, k), decompress(packed))
      }
    }
    return m
  }

  _setOrig(path, bytes) {
    this.orig.set(path, bytes.slice())
    this.cur.set(path, bytes.slice())
  }

  has(path) { return this.cur.has(path) }
  /** Current bytes (a PR path: the unpacked slab). Treat as read-only; write through `write`. */
  bytes(path) { return this.cur.get(path) }
  original(path) { return this.orig.get(path) }
  isDirty(path) { return !eq(this.cur.get(path), this.orig.get(path)) }
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn) }
  /** Listeners get (keys, live): live = a write inside an open transaction (a stroke still going). */
  _emit(keys, live = false) { for (const fn of this.listeners) fn(keys, live) }

  // ---- transactions and undo ------------------------------------------------------------------
  // A transaction snapshots each file the first time it touches it; commit keeps the before/after
  // copies of the files that actually changed. A drag (a brush stroke) is one transaction.

  begin(label) {
    if (this.tx) this.tx.depth++
    else this.tx = { label, before: new Map(), depth: 1 }
  }

  commit() {
    const tx = this.tx
    if (!tx || --tx.depth > 0) return
    this.tx = null
    const before = new Map(), after = new Map()
    for (const [p, b] of tx.before) {
      const now = this.cur.get(p)
      if (!eq(b, now)) { before.set(p, b); after.set(p, now ? now.slice() : null) }
    }
    if (!before.size) return
    this.undoStack.push({ label: tx.label, before, after })
    if (this.undoStack.length > 300) this.undoStack.shift()
    this.redoStack.length = 0
    this._emit(new Set(before.keys()))
  }

  _apply(snap) {
    for (const [p, b] of snap) {
      if (b) this.cur.set(p, b.slice())
      else this.cur.delete(p)
    }
    this._emit(new Set(snap.keys()))
  }
  undo() { const e = this.undoStack.pop(); if (!e) return null; this._apply(e.before); this.redoStack.push(e); return e.label }
  redo() { const e = this.redoStack.pop(); if (!e) return null; this._apply(e.after); this.undoStack.push(e); return e.label }
  get canUndo() { return this.undoStack.length > 0 }
  get canRedo() { return this.redoStack.length > 0 }

  _touch(path) {
    if (!this.tx) throw new Error('write outside a transaction')
    if (!this.tx.before.has(path)) this.tx.before.set(path, this.cur.has(path) ? this.cur.get(path).slice() : null)
  }

  /** The one mutation primitive: write `values` at `off`, growing the file with zeros if needed. */
  write(path, off, values, label = 'edit') {
    const own = !this.tx
    if (own) this.begin(label)
    try {
      this._touch(path)
      let b = this.cur.get(path) ?? new Uint8Array(0)
      const end = off + values.length
      if (end > b.length) { const g = new Uint8Array(end); g.set(b); b = g }
      else b = b.slice()
      for (let i = 0; i < values.length; i++) b[off + i] = values[i] & 0xff
      this.cur.set(path, b)
      if (!own) this._emit(new Set([path]), true) // live, mid-stroke: views redraw, nothing saved yet
    } finally { if (own) this.commit() }
  }

  /** Replace a file's whole content (BRK insert/delete, a reset, an import). */
  replace(path, bytes, label = 'replace') {
    const own = !this.tx
    if (own) this.begin(label)
    try { this._touch(path); this.cur.set(path, u8(bytes).slice()) } finally { if (own) this.commit() }
  }

  resetFile(path) {
    if (this.orig.has(path)) this.replace(path, this.orig.get(path), `reset ${path}`)
    else if (this.cur.has(path)) { this.begin(`remove ${path}`); this._touch(path); this.cur.delete(path); this.commit() }
  }

  // ---- export ---------------------------------------------------------------------------------

  /** The bytes to write to disk for `path` (PR: packed). Null if the file does not exist. */
  exportFile(path) {
    const cur = this.cur.get(path)
    if (!cur) return null
    if (!isPr(path)) return cur.slice()
    if (this.origPacked.has(path) && eq(cur, this.orig.get(path))) return this.origPacked.get(path).slice()
    const cached = this.packCache.get(path)
    if (cached && eq(cached.slab, cur)) return cached.packed.slice()
    const packed = compress(cur)
    const back = decompress(packed)
    if (!eq(back, cur)) throw new Error(`${path}: LZ round trip failed`) // never ship a bad stream
    this.packCache.set(path, { slab: cur.slice(), packed })
    return packed.slice()
  }

  /** Paths whose exported bytes differ from the shipped file (or that are new). */
  changedPaths() {
    const out = []
    for (const p of this.cur.keys()) if (this.isDirty(p)) out.push(p)
    return out.sort()
  }

  // ---- persistence: a sparse diff of the changed files ----------------------------------------

  toJSON() {
    const files = {}
    for (const p of this.changedPaths()) files[p] = b64encode(this.cur.get(p))
    return { format: 'mm-level-editor', version: 1, files }
  }

  /** Apply a saved diff on top of the loaded originals (not undoable; clears history). */
  applyJSON(json) {
    if (!json || json.format !== 'mm-level-editor') return 0
    let n = 0
    for (const [p, s] of Object.entries(json.files ?? {})) { this.cur.set(p, b64decode(s)); n++ }
    this.undoStack.length = 0
    this.redoStack.length = 0
    this._emit(new Set(Object.keys(json.files ?? {})))
    return n
  }

  /** Import a file from disk (e.g. a previous export). A PR file is unpacked. */
  importFile(path, bytes) {
    const b = u8(bytes)
    this.replace(path, isPr(path) ? decompress(b) : b, `import ${path}`)
  }

  // ---- decoded accessors ----------------------------------------------------------------------

  metaCount(round) { return Math.floor((this.bytes(paths.ct(round))?.length ?? 0) / 72) }

  mapCell(round, race, idx) {
    const m = this.bytes(paths.map(round, race))
    return { tile: m[idx] & 0x3f, attr: m[idx] >> 6, progress: m[1024 + idx] }
  }
  setMapTile(round, race, idx, tile) {
    const p = paths.map(round, race), m = this.bytes(p)
    this.write(p, idx, [(m[idx] & 0xc0) | (tile & 0x3f)], 'paint meta-tile')
  }
  setMapAttr(round, race, idx, attr) {
    const p = paths.map(round, race), m = this.bytes(p)
    this.write(p, idx, [(m[idx] & 0x3f) | ((attr & 3) << 6)], 'paint attribute')
  }
  setMapProgress(round, race, idx, v) { this.write(paths.map(round, race), 1024 + idx, [v], 'paint progress') }

  ctWord(round, meta, x, y) {
    const b = this.bytes(paths.ct(round)), o = meta * 72 + y * 12 + x * 2
    return o + 1 < b.length ? b[o] | (b[o + 1] << 8) : 0
  }
  setCtWord(round, meta, x, y, w) {
    w = Math.max(0, Math.min(LIMITS.ctWord, w | 0))
    this.write(paths.ct(round), meta * 72 + y * 12 + x * 2, [w & 0xff, w >> 8], 'set tile')
  }

  colBit(round, meta, cx, cy) {
    const b = this.bytes(paths.col(round)), i = cy * 12 + cx
    return ((b[meta * 18 + (i >> 3)] ?? 0) >> (7 - (i & 7))) & 1
  }
  setColBit(round, meta, cx, cy, v) {
    const p = paths.col(round), i = cy * 12 + cx, o = meta * 18 + (i >> 3)
    const old = this.bytes(p)[o] ?? 0, mask = 0x80 >> (i & 7)
    this.write(p, o, [v ? old | mask : old & ~mask], 'paint collision')
  }

  /** DIR byte for a 2×2-cell block (bx, by 0-5), stored [meta*36 + bx + 6*by]. */
  dirByte(round, meta, bx, by) { return this.bytes(paths.dir(round))[meta * 36 + by * 6 + bx] ?? 0 }
  setDirByte(round, meta, bx, by, v) { this.write(paths.dir(round), meta * 36 + by * 6 + bx, [v], 'set direction') }
  /** True where the shipped DIR does not reach (round 5's meta-tile 56): the game reads stale buffer bytes. */
  dirMissing(round, meta) { return (this.bytes(paths.dir(round))?.length ?? 0) < (meta + 1) * 36 }

  levByte(round, meta) { return this.bytes(paths.lev(round))[meta] ?? 0 }
  setLevByte(round, meta, v) { this.write(paths.lev(round), meta, [v], 'set LEV') }

  palEntry(round, i) { const b = this.bytes(paths.pal(round)); return [b[i * 3], b[i * 3 + 1], b[i * 3 + 2]] }
  setPalEntry(round, i, rgb) { this.write(paths.pal(round), i * 3, rgb.map((v) => Math.max(0, Math.min(63, v | 0))), 'set colour') }

  strt(round, race) {
    const b = this.bytes(paths.strt()), o = (round - 1) * 16 + (race - 1) * 4
    return { x: b[o] | (b[o + 1] << 8), y: b[o + 2] | (b[o + 3] << 8) }
  }
  setStrt(round, race, x, y) {
    const o = (round - 1) * 16 + (race - 1) * 4
    this.write(paths.strt(), o, [x & 0xff, (x >> 8) & 0xff, y & 0xff, (y >> 8) & 0xff], 'move start')
  }

  cheatCount() { return Math.floor(this.bytes(paths.cheats()).length / 12) }
  cheat(i) {
    const b = this.bytes(paths.cheats()), o = i * 12, w = (k) => b[o + k] | (b[o + k + 1] << 8)
    return { round: w(0), race: w(2), x: w(4), y: w(6), type: w(8), param: w(10) }
  }
  setCheat(i, rec) {
    const words = [rec.round, rec.race, rec.x, rec.y, rec.type, rec.param]
    this.write(paths.cheats(), i * 12, words.flatMap((v) => [v & 0xff, (v >> 8) & 0xff]), 'edit cheat spot')
  }

  // ---- the tile bank --------------------------------------------------------------------------

  slabCount(round) { let k = 0; while (this.has(paths.pr(round, k))) k++; return k }
  bankTileCount(round) {
    let n = 0
    for (let k = 0; k < this.slabCount(round); k++) n += Math.floor(this.bytes(paths.pr(round, k)).length / 256)
    return n
  }
  /** Where tile t lives: slab k = t / 192 (every slab but the last is a full 0xC000). */
  _tileAt(round, t) { const k = Math.floor(t / TILES_PER_SLAB); return { path: paths.pr(round, k), off: (t % TILES_PER_SLAB) * 256 } }
  tilePixels(round, t) {
    const { path, off } = this._tileAt(round, t)
    const b = this.bytes(path)
    return b && off + 256 <= b.length ? b.subarray(off, off + 256) : null
  }
  setTilePixels(round, t, px, label = 'paint tile') {
    const { path, off } = this._tileAt(round, t)
    this.write(path, off, px, label)
  }

  /** Append a tile (a copy of `from`, or blank). Returns its index or throws at the bank limit. */
  addTile(round, from = null) {
    const n = this.bankTileCount(round)
    if (n >= MAX_BANK_TILES) throw new Error(`the bank is full (${MAX_BANK_TILES} tiles, 0x20000 bytes)`)
    const px = from == null ? new Uint8Array(256) : this.tilePixels(round, from).slice()
    this.setTilePixels(round, n, px, 'add tile')
    return n
  }

  // ---- meta-tiles -----------------------------------------------------------------------------

  /**
   * Append a meta-tile to CT, COL, DIR and LEV together (a copy of `from`, or empty). DIR is first
   * zero-filled up to the new record where the shipped file stops short (round 5); LEV's slot is
   * written even where the file already has a byte there (round 2's three spare bytes).
   */
  addMetaTile(round, from = null) {
    const n = this.metaCount(round)
    if (n >= LIMITS.metaTiles) throw new Error(`round ${round} already has ${LIMITS.metaTiles} meta-tiles, the most a MAP byte can index`)
    const src = (p, size) => (from == null ? new Uint8Array(size) : (() => {
      const b = this.bytes(p), out = new Uint8Array(size)
      for (let i = 0; i < size; i++) out[i] = b[from * size + i] ?? 0
      return out
    })())
    this.begin('add meta-tile')
    try {
      this.write(paths.ct(round), n * 72, src(paths.ct(round), 72))
      this.write(paths.col(round), n * 18, src(paths.col(round), 18))
      this.write(paths.dir(round), n * 36, src(paths.dir(round), 36))
      this.write(paths.lev(round), n, src(paths.lev(round), 1))
    } finally { this.commit() }
    return n
  }

  /** Per meta-tile: [{race, cells}] of the MAP cells that use it, across the round's races. */
  metaUsage(round) {
    const use = Array.from({ length: 64 }, () => [])
    for (let race = 1; race <= RACES[round]; race++) {
      const m = this.bytes(paths.map(round, race))
      if (!m) continue
      const cnt = new Uint16Array(64)
      for (let i = 0; i < 1024; i++) cnt[m[i] & 0x3f]++
      cnt.forEach((c, t) => { if (c) use[t].push({ race, cells: c }) })
    }
    return use
  }

  /** Meta-tiles whose CT uses bank tile `t`. */
  tileUsers(round, t) {
    const out = []
    for (let m = 0; m < this.metaCount(round); m++) {
      for (let k = 0; k < 36; k++) if (this.ctWord(round, m, k % 6, (k / 6) | 0) === t) { out.push(m); break }
    }
    return out
  }

  /** BRK as a whole-file replace (insert/delete change its length). */
  setBrk(round, race, bytes) { this.replace(paths.brk(round, race), bytes, 'edit brake stream') }
}

// ---- base64 without Buffer (runs in the browser and in Node) -----------------------------------
export function b64encode(bytes) {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
  return btoa(s)
}
export function b64decode(str) {
  const s = atob(str), out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}
