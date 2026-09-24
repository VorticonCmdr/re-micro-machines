// The front-end asset arena and its .CHR members.
//
// COMPRESS.PI0–PI6 are not seven archives: they are one 328 KB memory image (segments
// 2b78..7d78 in Ghidra's view) cut into 48 KB slabs and compressed. InitLoadAssets
// (MICROU.EXE 1000:26c0) calls LoadCompressedSeries 1000:3547 with the name template
// COMPRESS.PI0 and destination 2b78: each file is unpacked and copied to 2b78 + n·0xC00
// paragraphs until an open fails (PI7). PI0–PI5 unpack to exactly 0xC000 bytes, PI6 to 0xA000,
// so the members land exactly where the descriptor table says. The dead dev tool
// DumpAssetArenaToPaulDat (1000:2736) writes exactly that 2b78..7d78 range — the arena is the
// developers' asset heap, dumped and compressed.
//
// The 18 members are described by chrDescriptorTable at DS:0A14 (193c:0a14; file offset
// 0xA254 in MICROU.EXE): 20-byte records {name[13], +0xD u16, +0xF u16, +0x11 frames u8,
// +0x12 segment u16}. BindSpriteObjToChrDescriptor 1000:049c copies segment, the two dimension
// words and their product into the sprite objects. The order of the two dimension words is
// (height, width): rendering MINATURE.CHR as 32 wide × 16 tall gives clean vehicle miniatures
// and LOGO.CHR as 248×96 gives the Micro Machines logo, while the other reading shears both.
// Frames are consecutive row-major 8-bpp blocks of width×height bytes; the menu palette is
// INTRO.PAL. CASE.CHR and CASE.MAP are raw blobs (their descriptors say 6400×1 and 674×1).
//
// The table is hardcoded here (it lives inside the game binary, not in an asset file);
// tools/check-chr-table.mjs re-derives it from MICROU.EXE to keep this copy honest.

import { decompress } from './lz.js'
import { toU8 } from './bytes.js'

export const ARENA_SIZE = 0x52000
export const SLAB_SIZE = 0xc000
export const ARENA_SEGMENT = 0x2b78 // Ghidra-relocated; 0x1b78 in the file's own segment values
export const ARCHIVES = [0, 1, 2, 3, 4, 5, 6].map((n) => `COMPRESS.PI${n}`)

/** Expected unpacked size of each slab (PROVEN by decoding all seven). */
export const SLAB_UNPACKED = [0xc000, 0xc000, 0xc000, 0xc000, 0xc000, 0xc000, 0xa000]

export const CHR_TABLE_FILE_OFFSET = 0xa254
export const CHR_TABLE = [
  { name: 'FCHAPPY.CHR', height: 48, width: 48, frames: 22, arenaOffset: 0x00000 },
  { name: 'FCSAD.CHR', height: 48, width: 48, frames: 22, arenaOffset: 0x0c600 },
  { name: 'FCFROWN.CHR', height: 48, width: 48, frames: 11, arenaOffset: 0x18c00 },
  { name: 'FCNORMAL.CHR', height: 48, width: 48, frames: 14, arenaOffset: 0x1ef00 },
  { name: 'THUMB.CHR', height: 32, width: 48, frames: 3, arenaOffset: 0x26d00 },
  { name: 'MINATURE.CHR', height: 16, width: 32, frames: 38, arenaOffset: 0x27f00 },
  { name: 'BADGE.CHR', height: 32, width: 72, frames: 1, arenaOffset: 0x2cb00 },
  { name: 'CASE.CHR', height: 6400, width: 1, frames: 1, arenaOffset: 0x2d400, raw: true }, // 100 tiles of 8×8 (see caseImage)
  { name: 'CASE.MAP', height: 674, width: 1, frames: 1, arenaOffset: 0x2ed00, raw: true }, // [cols=32][rows=21] + tile indices
  { name: 'CUP.CHR', height: 8, width: 96, frames: 10, arenaOffset: 0x2efb0 },
  { name: 'INTRO.CHR', height: 64, width: 96, frames: 9, arenaOffset: 0x30d70 },
  { name: 'WORDS.CHR', height: 16, width: 96, frames: 3, arenaOffset: 0x3e570 },
  { name: 'SELGAM.CHR', height: 64, width: 96, frames: 6, arenaOffset: 0x3f770 },
  { name: 'LOGO.CHR', height: 96, width: 248, frames: 1, arenaOffset: 0x48780 },
  { name: 'NOS.CHR', height: 32, width: 24, frames: 4, arenaOffset: 0x4e480 },
  { name: 'FONT1.CHR', height: 8, width: 8, frames: 38, arenaOffset: 0x4f080 },
  { name: 'FONT2.CHR', height: 16, width: 8, frames: 38, arenaOffset: 0x4fa00 },
  { name: 'FRAME.CHR', height: 8, width: 8, frames: 4, arenaOffset: 0x51630 },
]

/** Parse the descriptor table out of MICROU.EXE bytes (for the check tool and the viewer's info). */
export function parseChrTable(exe) {
  const b = toU8(exe)
  const out = []
  for (let k = 0; k < 18; k++) {
    const o = CHR_TABLE_FILE_OFFSET + k * 20
    let name = ''
    for (let i = 0; i < 13 && b[o + i]; i++) name += String.fromCharCode(b[o + i])
    const height = b[o + 0xd] | (b[o + 0xe] << 8)
    const width = b[o + 0xf] | (b[o + 0x10] << 8)
    const frames = b[o + 0x11]
    const seg = b[o + 0x12] | (b[o + 0x13] << 8)
    out.push({ name, height, width, frames, arenaOffset: (seg - 0x1b78) * 16 })
  }
  return out
}

/**
 * Rebuild the arena from the seven packed files, exactly as LoadCompressedSeries lays it out.
 * @param {(name:string)=>Promise<ArrayBuffer|Uint8Array>} read
 * @returns {Promise<{arena: Uint8Array, slabs: {name:string, packed:number, unpacked:number}[]}>}
 */
export async function buildArena(read) {
  const arena = new Uint8Array(ARENA_SIZE)
  const slabs = []
  for (let n = 0; n < ARCHIVES.length; n++) {
    const packed = toU8(await read(ARCHIVES[n]))
    const unpacked = decompress(packed)
    if (unpacked.length > SLAB_SIZE) throw new Error(`${ARCHIVES[n]}: unpacked ${unpacked.length} > slab`)
    arena.set(unpacked, n * SLAB_SIZE)
    slabs.push({ name: ARCHIVES[n], packed: packed.length, unpacked: unpacked.length })
  }
  return { arena, slabs }
}

/** One frame of a member as an indexed image. */
export function chrFrame(arena, rec, frame) {
  const size = rec.width * rec.height
  const start = rec.arenaOffset + frame * size
  return { width: rec.width, height: rec.height, indexed: arena.subarray(start, start + size) }
}

/** All frames of a member laid out in a sheet, `columns` per row. */
export function chrSheet(arena, rec, columns = Math.min(rec.frames, 11)) {
  const rows = Math.ceil(rec.frames / columns)
  const width = rec.width * columns
  const height = rec.height * rows
  const indexed = new Uint8Array(width * height)
  for (let f = 0; f < rec.frames; f++) {
    const fr = chrFrame(arena, rec, f)
    const x0 = (f % columns) * rec.width
    const y0 = Math.floor(f / columns) * rec.height
    for (let y = 0; y < rec.height; y++) indexed.set(fr.indexed.subarray(y * rec.width, (y + 1) * rec.width), (y0 + y) * width + x0)
  }
  return { width, height, indexed, columns, rows }
}

/**
 * CASE.CHR + CASE.MAP: the vehicle display case behind the SELECT VEHICLE screen, as an 8×8 tile
 * map. CASE.CHR is 100 tiles of 64 bytes; CASE.MAP is [cols][rows] then rows×cols tile indices
 * (BlitTileMap8x8, MICROU.EXE — the descriptor's "6400×1" / "674×1" are just byte counts).
 * 674 = 2 + 32×21 exactly; every index is < 100. Renders as the shelf case (256×168).
 */
export function caseImage(arena) {
  const tiles = chrFrame(arena, CHR_TABLE.find((r) => r.name === 'CASE.CHR'), 0).indexed
  const map = chrFrame(arena, CHR_TABLE.find((r) => r.name === 'CASE.MAP'), 0).indexed
  const cols = map[0], rows = map[1]
  const width = cols * 8, height = rows * 8
  const indexed = new Uint8Array(width * height)
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const t = map[2 + r * cols + c]
    for (let y = 0; y < 8; y++) indexed.set(tiles.subarray(t * 64 + y * 8, t * 64 + y * 8 + 8), (r * 8 + y) * width + c * 8)
  }
  return { width, height, indexed, cols, rows }
}

/** Which members overlap a given slab (for the per-file view). */
export function membersInSlab(n) {
  const lo = n * SLAB_SIZE
  const hi = lo + SLAB_SIZE
  return CHR_TABLE.filter((r) => {
    const end = r.arenaOffset + r.width * r.height * r.frames
    return r.arenaOffset < hi && end > lo
  })
}
