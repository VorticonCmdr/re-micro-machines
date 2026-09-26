// The level editor's checks: what the game needs of a level's files (the buffer and format limits
// in model.js's LIMITS) and what makes a race playable (its progress plane against the EXE's own
// checkpoint bands, the brake stream's reach, the start point). DOM-free.
//
// Each issue: {level: 'error' | 'warn', file, msg}. An error is something the game would load
// wrongly or not at all; a warning is legal but probably not what was meant.

import { LIMITS, RACES, TILES_PER_SLAB, MAX_BANK_TILES, paths } from './model.js'
import { OVERLAY_RANGES, OVERLAY_TILE_DELTA } from '../formats/race.js'
import { checkpointList } from '../data/engine-tables.js'

export const CHEAT_TYPES = ['lose a life', 'instant win', 'grip threshold', 'grip slew', 'acceleration', 'no fire (flag 2915)', 'flag 2917 (no effect)', 'hazard immune', 'max speed', 'no fire (flag 2919)']

/** Is world point (x, y) on a solid collision cell of this race? */
export function solidAt(model, round, race, x, y) {
  const m = model.bytes(paths.map(round, race))
  if (!m || x < 0 || y < 0 || x >= 3072 || y >= 3072) return false
  const meta = m[((y / 96) | 0) * 32 + ((x / 96) | 0)] & 0x3f
  return model.colBit(round, meta, ((x % 96) / 8) | 0, ((y % 96) / 8) | 0) === 1
}

/**
 * @param {import('./model.js').LevelModel} model
 * @param {number} round
 * @param {{pack?: boolean}} [opts]  pack: also LZ-encode changed PR slabs to check the packed size
 */
export function validateRound(model, round, { pack = false } = {}) {
  const issues = []
  const add = (level, file, msg) => issues.push({ level, file, msg })
  const metaN = model.metaCount(round)
  const bankN = model.bankTileCount(round)
  const ct = paths.ct(round), col = paths.col(round), dir = paths.dir(round), lev = paths.lev(round)

  // Sizes and lockstep.
  if (model.bytes(ct).length % 72) add('error', ct, `${model.bytes(ct).length} bytes is not a whole number of 72-byte meta-tiles`)
  if (metaN > LIMITS.metaTiles) add('error', ct, `${metaN} meta-tiles; a MAP byte can index only ${LIMITS.metaTiles}`)
  for (const [p, per, limit] of [[col, 18, LIMITS.col], [dir, 36, LIMITS.dir], [lev, 1, LIMITS.lev]]) {
    const len = model.bytes(p).length
    if (len > limit) add('error', p, `${len} bytes; the game reads only ${limit} (0x${limit.toString(16)})`)
    if (len < metaN * per) add(p === dir && len > (metaN - 1) * per ? 'warn' : 'error', p, `covers ${Math.floor(len / per)} of ${metaN} meta-tiles${len % per ? ` (ends ${len % per} bytes into meta-tile ${Math.floor(len / per)})` : ''}; the game reads leftover buffer bytes past the end`)
  }
  const palLen = model.bytes(paths.pal(round)).length
  if (palLen !== 768) add('error', paths.pal(round), `${palLen} bytes, not 768`)
  for (const [i, v] of model.bytes(paths.pal(round)).entries()) if (v > 63) { add('error', paths.pal(round), `entry ${(i / 3) | 0} has a value over 63 (${v}); the DAC takes 6 bits`); break }

  // The bank.
  const slabs = model.slabCount(round)
  for (let k = 0; k < slabs; k++) {
    const p = paths.pr(round, k), len = model.bytes(p).length
    if (len > LIMITS.slab) add('error', p, `unpacks to ${len} bytes, over one 0xC000 slab`)
    if (k < slabs - 1 && len !== LIMITS.slab) add('error', p, `unpacks to 0x${len.toString(16)} bytes; every slab but the last must be exactly 0xC000 or later tiles shift`)
    if (len % 256) add('error', p, `${len} bytes is not a whole number of 256-byte tiles`)
    if (pack && model.isDirty(p)) {
      const packed = model.exportFile(p)
      if (packed.length > LIMITS.packed) add('error', p, `packs to ${packed.length} bytes; the game reads a PR file into the last 16 KB (0x4000) of its work segment`)
    }
  }
  if (bankN > MAX_BANK_TILES) add('error', paths.pr(round, 0), `${bankN} tiles; more than ${MAX_BANK_TILES} overwrite the world map arena`)

  // CT words must name real bank tiles (and the overlay variant, in rounds 2 and 3).
  const range = OVERLAY_RANGES[round]
  const badCt = new Set(), badOverlay = new Set()
  for (let m = 0; m < metaN; m++) {
    for (let k = 0; k < 36; k++) {
      const w = model.ctWord(round, m, k % 6, (k / 6) | 0)
      if (w >= bankN) badCt.add(m)
      else if (range && w >= range[0] && w <= range[1] && w + OVERLAY_TILE_DELTA >= bankN) badOverlay.add(m)
    }
  }
  if (badCt.size) add('error', ct, `meta-tile${badCt.size > 1 ? 's' : ''} ${[...badCt].join(', ')} use a bank tile past the bank's ${bankN}`)
  if (badOverlay.size) add('error', ct, `meta-tile${badOverlay.size > 1 ? 's' : ''} ${[...badOverlay].join(', ')} use an overlay-range tile whose +${OVERLAY_TILE_DELTA} variant is past the bank`)

  // Per race.
  for (let race = 1; race <= RACES[round]; race++) issues.push(...validateRace(model, round, race))
  return issues
}

export function validateRace(model, round, race) {
  const issues = []
  const mp = paths.map(round, race)
  const add = (level, file, msg) => issues.push({ level, file, msg })
  const m = model.bytes(mp)
  if (!m) return issues
  if (m.length !== LIMITS.map) add('error', mp, `${m.length} bytes, not 2048`)
  const metaN = model.metaCount(round)
  const bad = new Set()
  let maxP = 0
  const present = new Set()
  for (let i = 0; i < 1024; i++) {
    if ((m[i] & 0x3f) >= metaN) bad.add(m[i] & 0x3f)
    maxP = Math.max(maxP, m[1024 + i])
    present.add(m[1024 + i])
  }
  if (bad.size) add('warn', mp, `cells use meta-tile${bad.size > 1 ? 's' : ''} ${[...bad].join(', ')}, past the round's ${metaN}: the game reads leftover buffer bytes there`)
  if (maxP === 0) add('error', mp, 'the progress plane is all 0: laps can never count (the lap rule works on half the maximum progress)')
  const bands = checkpointList(round, race)
  bands.forEach((b, i) => {
    let hit = false
    for (const v of present) if (v >= b.lo && v < b.hi) { hit = true; break }
    if (!hit) add('error', mp, `no cell's progress falls in checkpoint ${i}'s band [${b.lo}, ${b.hi}) (fixed in MICROU.EXE, DS:2035): the lap can never complete`)
  })

  const bp = paths.brk(round, race)
  const brk = model.bytes(bp)
  if (brk) {
    if (brk.length > LIMITS.brk) add('error', bp, `${brk.length} bytes; the game reads only 0x200`)
    else if (brk.length <= maxP) add('warn', bp, `${brk.length} bytes but progress reaches ${maxP}: drones read leftover bytes of an earlier race's stream past the end (docs/engine.md §9ad)`)
  } else if (round !== 9) add('error', bp, 'missing')

  const s = model.strt(round, race)
  if (s.x >= 3072 || s.y >= 3072) add('error', paths.strt(), `race ${round}${race}'s start (${s.x}, ${s.y}) is outside the 3072×3072 world`)
  else if (solidAt(model, round, race, s.x, s.y)) add('warn', paths.strt(), `race ${round}${race}'s start (${s.x}, ${s.y}) is on a solid collision cell`)

  for (let i = 0; i < model.cheatCount(); i++) {
    const c = model.cheat(i)
    if (c.round !== round || c.race !== race) continue
    if (c.type > 9) add('error', paths.cheats(), `cheat spot ${i}: type ${c.type} is not one of the 10 (0-9)`)
    if (c.x >= 3072 || c.y >= 3072) add('warn', paths.cheats(), `cheat spot ${i} (${c.x}, ${c.y}) is outside the world`)
  }
  return issues
}
