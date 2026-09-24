// Where the original game files come from.
//
// Three implementations behind one interface so views never care which is in play:
//   FetchSource     — dev: Vite serves game/ over HTTP, byte-identical.
//   DirectorySource — shipping: the user points at their own copy (File System Access).
//   DropSource      — fallback for browsers without the directory picker.
//
// Unlike a flat game directory, Micro Machines keeps its per-round data in a "game set"
// subdirectory (game/GAME1/), and MICROU.EXE runs with that subdirectory as its working
// directory (it opens ..\BITSFILE.PH0). Names are therefore paths relative to game/, with
// forward slashes: 'GFX1.GFX', 'GAME1/ROUND1.PAL'. DOS is case-insensitive, so keys are
// lowercased.

/**
 * @typedef {Object} AssetSource
 * @property {(path:string) => Promise<ArrayBuffer>} read
 * @property {(paths:string[]) => Promise<Set<string>>} available  lowercased paths present
 * @property {string} description
 */

const key = (path) => path.replace(/\\/g, '/').replace(/^\.?\//, '').toLowerCase()

export class FetchSource {
  constructor(base = '/game') {
    this.base = base.replace(/\/$/, '')
    this.description = `HTTP (${this.base})`
    this._cache = new Map()
  }

  async read(path) {
    const k = key(path)
    const cached = this._cache.get(k)
    if (cached) return cached
    const res = await fetch(`${this.base}/${path}`)
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`)
    if ((res.headers.get('content-type') ?? '').includes('text/html')) {
      // A dev server with an SPA fallback answers 200 + HTML for missing files.
      throw new Error(`${path}: not a file (got HTML)`)
    }
    const buf = await res.arrayBuffer()
    this._cache.set(k, buf)
    return buf
  }

  /** HTTP can't list a directory, so probe the catalogue with HEAD requests. */
  async available(paths) {
    const found = new Set()
    const queue = [...paths]
    const workers = Array.from({ length: 12 }, async () => {
      while (queue.length) {
        const path = queue.pop()
        try {
          const res = await fetch(`${this.base}/${path}`, { method: 'HEAD' })
          if (!res.ok) continue
          if ((res.headers.get('content-type') ?? '').includes('text/html')) continue
          found.add(key(path))
        } catch { /* absent */ }
      }
    })
    await Promise.all(workers)
    return found
  }
}

export class DirectorySource {
  /** @param {FileSystemDirectoryHandle} handle */
  constructor(handle) {
    this.handle = handle
    this.description = `Folder: ${handle.name}`
    this._indexPromise = null
    this._cache = new Map()
  }

  static get supported() {
    return typeof window !== 'undefined' && 'showDirectoryPicker' in window
  }

  static async pick() {
    const handle = await window.showDirectoryPicker({ id: 'mm-game-data', mode: 'read' })
    return new DirectorySource(handle)
  }

  /**
   * Walk the folder two levels deep (game/ and game/GAME1/, plus any extra game sets).
   * The PROMISE is memoised, not the finished Map: concurrent readers (a view loading a
   * palette and a tileset together) must share one walk or the second one observes a
   * half-built index and throws "not found" for a file that is there.
   */
  async _index() {
    if (!this._indexPromise) {
      this._indexPromise = (async () => {
        const files = new Map()
        const walk = async (dir, prefix, depth) => {
          for await (const [name, entry] of dir.entries()) {
            if (entry.kind === 'file') files.set(key(prefix + name), entry)
            else if (entry.kind === 'directory' && depth < 2) await walk(entry, `${prefix}${name}/`, depth + 1)
          }
        }
        await walk(this.handle, '', 0)
        return files
      })()
    }
    return this._indexPromise
  }

  async read(path) {
    const k = key(path)
    const cached = this._cache.get(k)
    if (cached) return cached
    const files = await this._index()
    const entry = files.get(k)
    if (!entry) throw new Error(`${path}: not found in ${this.handle.name}`)
    const buf = await (await entry.getFile()).arrayBuffer()
    this._cache.set(k, buf)
    return buf
  }

  async available() {
    return new Set((await this._index()).keys())
  }
}

export class DropSource {
  /** @param {File[]} files  dropped files; webkitRelativePath is honoured when present */
  constructor(files) {
    this.files = new Map()
    for (const f of files) {
      // A dropped folder yields 'game/GAME1/ROUND1.PAL' — strip the top-level folder name.
      const rel = f.webkitRelativePath ? f.webkitRelativePath.split('/').slice(1).join('/') : f.name
      this.files.set(key(rel), f)
    }
    this.description = `Dropped files (${files.length})`
    this._cache = new Map()
  }

  async read(path) {
    const k = key(path)
    const cached = this._cache.get(k)
    if (cached) return cached
    const file = this.files.get(k)
    if (!file) throw new Error(`${path}: not among the dropped files`)
    const buf = await file.arrayBuffer()
    this._cache.set(k, buf)
    return buf
  }

  async available() {
    return new Set(this.files.keys())
  }
}

export { key as assetKey }
