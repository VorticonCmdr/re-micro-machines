// ROUNDnBR.LEV and ROUNDnmB.BRK: per-meta-tile placement/safe-respawn data and the per-race AI
// brake/speed-limit-point stream. Both loaded whole and verbatim by ChdirGameSetAndPatchRoundFilenames
// (1000:3b50); see docs/track-layout.md for the full derivation (mm session that decoded these: direct
// disassembly of the two LEV consumers at 1000:5de0 and 1000:70c8, and the one BRK consumer at 1000:5495).
//
// .LEV — one byte per meta-tile (same indexing as .COL/.CT/.DIR), file size == tile count for 8 of 9
// rounds (round 2 is 63 B for 60 tiles, UNKNOWN_lev_round2_size):
//   bit 7        — CORRECTED (docs/engine.md, mm-engine-plan-explore pass): not a projectile line-of-
//                  sight flag. 1000:5de6 (the earlier "1000:5de0 projectile-hit routine" attribution was
//                  wrong: the containing function FUN_1000_5be7 is the per-car integrate/commit routine,
//                  run for every car every physics step) reads LEV[car's own current meta-tile] into
//                  [BX+12E0] on every committed step; bit 7 set there skips only that step's SAFE-
//                  RESPAWN-POINT update (the car's [12F1]/[12F3] are not refreshed) -- projectile hit
//                  detection (CheckProjectileHitsOnCarSfx1 1000:79fd) still runs regardless. Bits 6-5 of
//                  this same byte are also the .DIR heading-remap "bucket" a car's AI reads (was
//                  UNKNOWN_dir_bucket_source, now closed).
//   bits 6–5     — one of 4 base respawn headings, table {0x40, 0x80, 0x60, 0xA0} (1000:7181-719f);
//                  XORed by the car's .MAP attribute bits (not the .DIR byte's low bits, as an earlier
//                  reading had it), see docs/track-layout.md
//   bits 4–2     — one of 8 {dx, dy} spawn-position nudge vectors (an 8-point compass rose using only
//                  {-36, 0, +36} components), table at DS:1FCB, added to the 96px-grid-snapped respawn point
//   bits 1–0     — not exercised by either traced consumer (UNKNOWN_lev_low_bits)
//
// .BRK — a variable-length stream of AI brake/speed-limit records, one file per RACE (not per round);
// round 9 ships none (drone-free / different AI for that class). Indexed not by position-in-file-as-array
// but by a per-car "track progress" value ([BX+12E3], fed from .MAP's second plane) used directly as a
// byte offset (1000:5495) — so parsing it as a flat byte array (this module's `parseBrk`) already matches
// how the game itself walks it. Each byte: high nibble dispatches on exactly 0/1/2 (1000:54A3-54AD);
// EVERY OTHER VALUE falls to the same shared branch (54AF), which then tests a runtime flag, not the
// nibble, so 0/3/4/.../15 are behaviourally identical in this consumer. Tabulated across all 26 files
// the high nibble is only ever 0, 1, 2, 4 or 15 (plus 3 exactly 3 times) — never 5-14 — which rules out a
// bitfield reading (UNKNOWN_brk_nibble_reuse: why the data bothers to distinguish 0/4/15 when the code
// doesn't is open). Low nibble = a 4-bit magnitude feeding a per-type threshold formula for types 1/2.
// UNKNOWN_brk_record_types: the real-world meaning of types 1 vs 2 (both "check a speed limit", scaled
// differently) is not established.

import { toU8 } from './bytes.js'

export const LEV_NUDGE_TABLE = [
  [0, 0], [36, -36], [-36, 36], [-36, 0],
  [36, 36], [-36, -36], [36, 0], [0, -36],
] // DS:1FCB, dumped live (mm session); index = (byte >> 2) & 7

export const LEV_HEADING_TABLE = [0x40, 0x80, 0x60, 0xa0] // 1000:7181-719f; index = (byte >> 5) & 3

/** One decoded .LEV entry. */
function levEntry(byte) {
  const [dx, dy] = LEV_NUDGE_TABLE[(byte >> 2) & 7]
  return {
    raw: byte,
    // Renamed from `blocking`: bit 7 is NOT a projectile line-of-sight flag (that reading was wrong --
    // see docs/engine.md). It is read every physics step, for every car, from FUN_1000_5be7 (1000:5de6),
    // and set means "do not remember this tile as the car's safe respawn point" this step.
    unsafeRespawn: (byte & 0x80) !== 0, // 1000:5de6
    heading: LEV_HEADING_TABLE[(byte >> 5) & 3], // 1000:70c8 / 7181-719f; also the .DIR remap "bucket" (docs/engine.md)
    nudge: { dx, dy },
    lowBits: byte & 3, // UNKNOWN_lev_low_bits
  }
}

/** @returns {{count: number, entries: object[]}} one entry per meta-tile, in file order. */
export function parseLev(data) {
  const b = toU8(data)
  return { count: b.length, entries: Array.from(b, levEntry) }
}

/** One decoded .BRK record (the byte's own two nibbles; see 1000:5495 for the threshold formulas). */
function brkRecord(byte, index) {
  const type = byte >> 4
  const mag = byte & 0xf
  let thresholdNote = ''
  if (type === 1) thresholdNote = `speed limit vs current speed: ((${mag}<<8)>>1)+0x380 = ${((mag << 8) >> 1) + 0x380}`
  else if (type === 2) thresholdNote = `speed limit vs target speed: ((${mag}<<8)>>2)+0x600 = ${((mag << 8) >> 2) + 0x600}`
  else thresholdNote = 'advance target speed ([129E]→[129C]), no limit check'
  return { index, raw: byte, type, magnitude: mag, note: thresholdNote }
}

// `UNKNOWN_tile_index_overflow`'s own sibling case (docs/engine.md §9ad): the real `.BRK` buffer
// (`DS:195B`, its own load site `1000:3b92-3ba8`) is ALSO a fixed-size allocation read with a
// constant `CX=0x200` (512 B) regardless of the real file's own (always-smaller) size, and is
// NEVER cleared between loads -- exactly the same shape as `collide.js`'s `colFileBuf`/
// `dirFileBuf`. Round 3's own progress plane genuinely reaches 255 (confirmed reachable by a car,
// not a dead corner -- see the flood-fill account in docs/engine.md §9ad), and `[BX+12E3]` indexes
// `1000:5495` directly into this buffer with no bounds check, so round 3's own real `.BRK` files
// (134-156 B) are read past their own content -- safely, within the 512 B allocation, but into
// another race's own leftover bytes, not the `type=0` default this port's own `ctx.brk?.[...]`
// fallback (ai.js) produces when unopted-in.
export const BRK_FILE_BUF_SIZE = 0x200

/** A persistent buffer to thread through `loadBrk`/`parseBrk` across a real session's own
 * sequence of race loads -- see the module comment above. Create ONCE per session, matching
 * `collide.js`'s `createColDirBuffers()`. */
export function createBrkBuffer() {
  return new Uint8Array(BRK_FILE_BUF_SIZE)
}

/**
 * @param {Uint8Array} [sharedBuffer] from `createBrkBuffer()` -- when given, `data` is copied into
 *   the front of this persistent buffer (which is then walked instead), leaving its own tail as
 *   whatever a PRIOR call in this same sequence last wrote, replicating the real non-cleared
 *   buffer exactly. `count` still reports the REAL file's own length either way (for the asset
 *   viewer's own display); only `records` grows to the full 512 entries when opted in.
 * @returns {{count: number, records: object[]}} the byte stream as the game walks it — flat, by offset.
 */
export function parseBrk(data, sharedBuffer) {
  const real = toU8(data)
  let b = real
  if (sharedBuffer) {
    sharedBuffer.set(real.subarray(0, BRK_FILE_BUF_SIZE))
    b = sharedBuffer
  }
  return { count: real.length, records: Array.from(b, brkRecord) }
}

/** Round and race/tile context from a GAME1/ROUNDnBR.LEV or GAME1/ROUNDnmB.BRK path. */
export function levBrkRoundRace(path) {
  const lev = /ROUND(\d)BR\.LEV$/i.exec(path)
  if (lev) return { kind: 'lev', round: Number(lev[1]) }
  const brk = /ROUND(\d)(\d)B\.BRK$/i.exec(path)
  if (brk) return { kind: 'brk', round: Number(brk[1]), race: Number(brk[2]) }
  return null
}
