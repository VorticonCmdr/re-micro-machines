// The race page's "Test race" hook (single.html?round=&race=&edited=1, opened from editor.html):
// reads go through the level editor's saved diff first (localStorage, src/editor/app.js), so the
// race runs on the edited files. A saved PR entry is an unpacked slab; it is packed here with the
// editor's encoder, since the loader (formats/race.js loadSeries) expects the file as shipped.

import { b64decode, STORE_KEY } from './model.js'
import { compress } from '../formats/lzEncode.js'

/** The page's round/race from `?round=&race=`, or the defaults (only rounds 1-9, their own races). */
export function raceFromQuery(search, races, fallback) {
  const q = new URLSearchParams(search)
  const round = Number(q.get('round')), race = Number(q.get('race'))
  if (races[round] && race >= 1 && race <= races[round]) return { round, race, edited: q.has('edited') }
  return { ...fallback, edited: q.has('edited') }
}

/** Wrap `read` with the saved edits (no-op when there are none). */
export function withSavedEdits(read) {
  let files = {}
  try { files = JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}').files ?? {} } catch { /* none */ }
  const keys = new Map(Object.keys(files).map((k) => [k.toUpperCase(), k]))
  const count = keys.size
  const wrapped = async (path) => {
    const k = keys.get(path.replace(/\\/g, '/').toUpperCase())
    if (!k) return read(path)
    const bytes = b64decode(files[k])
    return /\.PR\d$/i.test(k) ? compress(bytes) : bytes
  }
  return { read: wrapped, count }
}
