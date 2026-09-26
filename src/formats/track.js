// Track layout: ROUNDnm.MAP, ROUNDn.COL, ROUNDn.DIR, ROUNDnBR.CT.
//
// World model (from the consumers in MICROU.EXE; see docs/track-layout.md):
//   The world is 3072×3072 units = 32×32 tiles of 96 units; a tile is 12×12 cells of 8 units.
//   .MAP  2048 B: bytes 0..1023 = 32×32 tile map, [row*32 + col]; bits 0–5 = tile index into the
//         per-round tables, bits 6–7 = a 2-bit attribute; bytes 1024..2047 = a parallel 32×32
//         byte plane holding a per-tile TRACK-PROGRESS value (read at 1000:58d8, max-scanned at
//         1000:3d32): consumed by TestColMaskBitAtWorldXY and fed into a car's [BX+12E3]/[12E1]
//         fields, which the wrong-way check (1000:5f25) and the .BRK byte offset (1000:5495,
//         src/formats/levbrk.js) both use. There is no transform: TestColMaskBitAtWorldXY returns
//         the raw byte (UNKNOWN_589c_progress_transform, closed, docs/engine.md §3).
//                                                                (TestColMaskBitAtWorldXY 1000:589c)
//   .COL  18 B per tile = 12×12 one-bit collision mask, MSB first, bit index suby*12+subx.
//         SI = tile*18 + (suby*12+subx)/8, mask 0x80 >> ((suby*12+subx) % 8).      (1000:589c)
//   .DIR  36 B per tile = 6×6 bytes, one per 2×2-cell block: [tile*36 + (subx>>1) + 3*(suby&~1)].
//         Each byte packs two fields (LookupDirByteForCar 1000:585b; see docs/track-layout.md):
//           high nibble (>>4) = terrain roughness/ramp grade 0-15 (class-based immunity; bit 4
//             alone = "this tile is a ramp", 1000:687c/6ac2)
//           low nibble (0-15, or 0-7 for POWERBOATS) = a direction index feeding a two-stage
//             heading lookup (remap table DS:191B, then a verified 16-point-compass table DS:18FB)
//             that drives AI steering — a genuine flow field.
//   .CT   72 B per tile = 6 rows × 12 bytes, copied per MAP cell into two 384×96-byte arenas
//         (row stride 0x180) before the race; each cell is a 16-bit tile index, not pixels
//         (UNKNOWN_ct_tile_pixel_layout, closed, docs/track-layout.md).
//                                                                   (InitRaceCarsFromTables 1000:448c)
// All four are read whole and verbatim (PROVEN live for round 2). Tile counts: COL/18.

import { toU8 } from './bytes.js'

export const MAP_SIDE = 32
export const TILE_UNITS = 96
export const CELL_UNITS = 8
export const CELLS_PER_TILE = 12
export const COL_BYTES_PER_TILE = 18
export const DIR_BYTES_PER_TILE = 36
export const DIR_SIDE = 6
export const CT_BYTES_PER_TILE = 72
export const CT_ROWS = 6
export const CT_ROW_BYTES = 12

/** @returns {{tiles: Uint8Array, attrs: Uint8Array, plane2: Uint8Array, maxTile: number, maxPlane2: number}} */
export function parseMap(data) {
  const b = toU8(data)
  if (b.length !== 2048) throw new Error(`map: expected 2048 bytes, got ${b.length}`)
  const tiles = new Uint8Array(1024)
  const attrs = new Uint8Array(1024)
  let maxTile = 0
  for (let i = 0; i < 1024; i++) {
    tiles[i] = b[i] & 0x3f
    attrs[i] = b[i] >> 6
    if (tiles[i] > maxTile) maxTile = tiles[i]
  }
  const plane2 = b.subarray(1024, 2048)
  let maxPlane2 = 0
  for (let i = 0; i < 1024; i++) if (plane2[i] > maxPlane2) maxPlane2 = plane2[i]
  return { tiles, attrs, plane2, maxTile, maxPlane2 }
}

export const colTileCount = (col) => Math.floor(toU8(col).length / COL_BYTES_PER_TILE)

/** One tile's 12×12 collision mask as 0/1 bytes. */
export function colTile(col, tile) {
  const b = toU8(col)
  const out = new Uint8Array(CELLS_PER_TILE * CELLS_PER_TILE)
  for (let i = 0; i < out.length; i++) {
    const byte = b[tile * COL_BYTES_PER_TILE + (i >> 3)]
    out[i] = (byte >> (7 - (i & 7))) & 1
  }
  return out
}

/**
 * The whole track's collision mask: 384×384 cells (0/1), from MAP tile indices + COL.
 * `UNKNOWN_tile_index_overflow` (docs/engine.md §9ac): no `t >= nTiles` gate needed -- `colTile`
 * is safe for any tile index (currently a no-op simplification, since no round ships a partial
 * trailing `.COL` tile the way round 5's own `.DIR` does, but keeps this in step with `dirMap`
 * below rather than leaving two different patterns for the same underlying situation).
 */
export function colMaskMap(map, col) {
  const { tiles } = parseMap(map)
  const side = MAP_SIDE * CELLS_PER_TILE
  const out = new Uint8Array(side * side)
  const cache = new Map()
  for (let row = 0; row < MAP_SIDE; row++) {
    for (let c = 0; c < MAP_SIDE; c++) {
      const t = tiles[row * MAP_SIDE + c]
      let tileMask = cache.get(t)
      if (!tileMask) { tileMask = colTile(col, t); cache.set(t, tileMask) }
      for (let y = 0; y < CELLS_PER_TILE; y++) {
        out.set(tileMask.subarray(y * CELLS_PER_TILE, (y + 1) * CELLS_PER_TILE), (row * CELLS_PER_TILE + y) * side + c * CELLS_PER_TILE)
      }
    }
  }
  return { width: side, height: side, indexed: out }
}

// DS:191B (4 rows x 16 cols) and DS:18FB (16-entry compass), dumped live from MICROU.EXE this session.
// Row = ([BX+12E0]>>5)&3 (the AI's current "heading bucket" — only ever nonzero right after a
// projectile hit, UNKNOWN_dir_bucket_source); the .DIR low nibble picks the column. Table 18FB is
// verified to hold exactly the 16 multiples of 16 (0..240), i.e. a genuine 16-point compass in the
// same 0-255 byte-angle convention used by DRIVER1.BIN's engine-bend math (docs/sound.md).
export const DIR_REMAP_TABLE = [
  [4, 3, 2, 1, 0, 7, 6, 5, 11, 10, 9, 8, 15, 14, 13, 12],
  [0, 7, 6, 5, 4, 3, 2, 1, 15, 14, 13, 12, 11, 10, 9, 8],
  [6, 5, 4, 3, 2, 1, 0, 7, 13, 12, 11, 10, 9, 8, 15, 14],
  [2, 1, 0, 7, 6, 5, 4, 3, 9, 8, 15, 14, 13, 12, 11, 10],
]
export const DIR_COMPASS_TABLE = [64, 96, 128, 160, 192, 224, 0, 32, 80, 112, 144, 176, 208, 240, 16, 48]

/** Terrain roughness/ramp grade (0-15) — the .DIR byte's high nibble. */
export const dirGrade = (byte) => byte >> 4
/** "This sub-block is a ramp" — grade's low bit (1000:687c/6ac2). */
export const dirIsRamp = (byte) => (byte & 0x10) !== 0
/** Direction index (0-15, or 0-7 for POWERBOATS — the game ANDs with 7 only for that class). */
export const dirLowNibble = (byte, { powerboats = false } = {}) => byte & (powerboats ? 0x7 : 0xf)
/** Full heading chain: .DIR low nibble -> DS:191B remap (bucket 0-3) -> DS:18FB compass byte-angle. */
export const dirHeading = (byte, { bucket = 0, powerboats = false } = {}) => DIR_COMPASS_TABLE[DIR_REMAP_TABLE[bucket & 3][dirLowNibble(byte, { powerboats })]]

export const dirTileCount = (dir) => Math.floor(toU8(dir).length / DIR_BYTES_PER_TILE)

/**
 * One tile's 6×6 direction bytes (row-major as stored: index (subx>>1) + 3*(suby&~1) = x + 6*(suby>>1)).
 * Always returns a full 36-byte array, zero-filling any byte the file doesn't actually have --
 * `UNKNOWN_tile_index_overflow` (docs/engine.md, docs/track-layout.md): round 5's own `ROUND5.DIR`
 * ends 18 bytes into meta-tile 56's own 36-byte record (a genuine, reachable case -- see the
 * collide.js caller), so a tile can be PARTIALLY present, not just fully in- or out-of-range. A
 * bare `.subarray()` clips to whatever the buffer actually has, silently returning a SHORT array
 * (18 bytes here) whose missing indices read back `undefined`, not 0, when a caller indexes past
 * the end -- this used to force `collide.js` to gate on the WHOLE tile being in-range, discarding
 * real, present bytes along with the genuinely-missing ones. `colTile` already produces this same
 * zero-for-missing-bytes result, but only by relying on `undefined >> n` coercing through `NaN` to
 * 0 in a bitwise op -- correct, but accidental; this does the same thing explicitly.
 */
export function dirTile(dir, tile) {
  const b = toU8(dir)
  const out = new Uint8Array(DIR_BYTES_PER_TILE)
  const start = tile * DIR_BYTES_PER_TILE
  for (let i = 0; i < DIR_BYTES_PER_TILE; i++) out[i] = b[start + i] ?? 0
  return out
}

/**
 * The whole track's direction field: 192×192 bytes.
 * `UNKNOWN_tile_index_overflow` (docs/engine.md §9ac/§9ad): no longer gated on `t >= nTiles` --
 * `dirTile` is safe for any tile index now (real bytes where the file has them, 0 where it
 * doesn't), so this debug view shows round 5's own real partial data for meta-tile 56 (races 1/3)
 * instead of leaving that grid cell blank, matching the engine's own now-fixed behavior.
 */
export function dirMap(map, dir) {
  const { tiles } = parseMap(map)
  const side = MAP_SIDE * DIR_SIDE
  const out = new Uint8Array(side * side)
  for (let row = 0; row < MAP_SIDE; row++) {
    for (let c = 0; c < MAP_SIDE; c++) {
      const t = tiles[row * MAP_SIDE + c]
      const tb = dirTile(dir, t)
      for (let y = 0; y < DIR_SIDE; y++) out.set(tb.subarray(y * DIR_SIDE, (y + 1) * DIR_SIDE), (row * DIR_SIDE + y) * side + c * DIR_SIDE)
    }
  }
  return { width: side, height: side, indexed: out }
}

export const ctTileCount = (ct) => Math.floor(toU8(ct).length / CT_BYTES_PER_TILE)

/** One tile's 72 bytes as the game lays them out: 6 rows × 12 bytes. */
export function ctTile(ct, tile) {
  const b = toU8(ct)
  return { width: CT_ROW_BYTES, height: CT_ROWS, indexed: b.subarray(tile * CT_BYTES_PER_TILE, (tile + 1) * CT_BYTES_PER_TILE) }
}

/** The two CT arenas the game builds (32 tiles × 12 B per row, 6 rows per tile row): 384 × 192 bytes. */
export function ctMap(map, ct) {
  const { tiles } = parseMap(map)
  const width = MAP_SIDE * CT_ROW_BYTES
  const height = MAP_SIDE * CT_ROWS
  const out = new Uint8Array(width * height)
  const nTiles = ctTileCount(ct)
  for (let row = 0; row < MAP_SIDE; row++) {
    for (let c = 0; c < MAP_SIDE; c++) {
      const t = tiles[row * MAP_SIDE + c]
      if (t >= nTiles) continue
      const tb = ctTile(ct, t).indexed
      for (let y = 0; y < CT_ROWS; y++) out.set(tb.subarray(y * CT_ROW_BYTES, (y + 1) * CT_ROW_BYTES), (row * CT_ROWS + y) * width + c * CT_ROW_BYTES)
    }
  }
  return { width, height, indexed: out }
}

/** Round and race from a GAME1/ROUNDnm.MAP path. */
export function mapRoundRace(path) {
  const m = /ROUND(\d)(\d)\.MAP$/i.exec(path)
  return m ? { round: Number(m[1]), race: Number(m[2]) } : null
}
