// Where the lap line is -- a DEV aid, not an original-game feature (docs/engine.md §9ah). The
// original draws no finish line of its own: a lap counts where a car's `.MAP` plane-2 progress
// value wraps from the race's maximum down to a low value (`checkpoints.js`'s forward crossing,
// d < -[2654]), always at a cell edge crossed going NORTH right at the start grid. Rounds 1/4/5/6/7/9
// happen to paint a line across the lane in their tile art 17-63 px AHEAD of that edge; round 2
// (the bath) and round 3 paint nothing there. This module finds the edge from the map data alone,
// with the same zero-skip rule the engine uses (`collide.js`'s `writeProgress`: a 0 cell never
// updates progress, so a crossing through a row of 0 cells registers on entering the first
// numbered cell beyond it).

import { MAP_SIDE, TILE_UNITS } from '../formats/track.js'

const DIRS = [[0, -1], [0, 1], [-1, 0], [1, 0]]
const MAX_ZERO_GAP = 1 // R22/R23/R24's line runs through one row of 0 cells (the bath rack)

/**
 * @param {{plane2: Uint8Array, maxPlane2: number}} map  `parseMap`'s output (`world.map`)
 * @returns {{x:number, y:number, horizontal:boolean, viaZero:boolean}[]} each a 96-px cell edge in
 *   world pixels: horizontal edges run x..x+95 at y, vertical ones y..y+95 at x.
 */
export function lapLineSegments(map) {
  const { plane2, maxPlane2 } = map
  const half = maxPlane2 >> 1
  const at = (c, r) => plane2[(((r % MAP_SIDE) + MAP_SIDE) % MAP_SIDE) * MAP_SIDE + (((c % MAP_SIDE) + MAP_SIDE) % MAP_SIDE)]
  const wrap = (v) => ((v % (MAP_SIDE * TILE_UNITS)) + MAP_SIDE * TILE_UNITS) % (MAP_SIDE * TILE_UNITS)
  const out = []
  const seen = new Set()
  for (let r = 0; r < MAP_SIDE; r++) {
    for (let c = 0; c < MAP_SIDE; c++) {
      const a = at(c, r)
      if (a === 0 || a === 0xff) continue
      for (const [dc, dr] of DIRS) {
        for (let k = 1; k <= MAX_ZERO_GAP + 1; k++) {
          const b = at(c + dc * k, r + dr * k)
          if (b === 0) continue
          if (b !== 0xff && a - b > half) {
            // the crossing registers on ENTERING cell b: the edge of b facing the way the car came
            const cb = c + dc * k, rb = r + dr * k
            const horizontal = dc === 0
            const x = wrap(horizontal ? cb * TILE_UNITS : (dc < 0 ? cb + 1 : cb) * TILE_UNITS)
            const y = wrap(horizontal ? (dr < 0 ? rb + 1 : rb) * TILE_UNITS : rb * TILE_UNITS)
            const key = `${x},${y},${horizontal}`
            if (!seen.has(key)) { seen.add(key); out.push({ x, y, horizontal, viaZero: k > 1 }) }
          }
          break
        }
      }
    }
  }
  return out
}

/** The palette index nearest (r,g,b), for picking overlay colours out of a round's own palette. */
export function nearestPaletteIndex(rgb, r, g, b) {
  let best = 0, bestD = Infinity
  for (let i = 0; i < 256; i++) {
    const d = (rgb[i * 3] - r) ** 2 + (rgb[i * 3 + 1] - g) ** 2 + (rgb[i * 3 + 2] - b) ** 2
    if (d < bestD) { bestD = d; best = i }
  }
  return best
}
