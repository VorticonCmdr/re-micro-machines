// Race-side graphics: the round's 16×16 tile bank (ROUNDnBR.PR0/1/2), the assembled track,
// the vehicle rotation frames (ROUNDnBR.VH0) and the shared race bank (BITSFILE.PH0).
//
// From MICROU.EXE (Ghidra 1000:-based; docs/track-graphics.md):
//   Tile bank   LoadRoundPrSeries 1000:45ef: PR0, PR1, PR2 LZ-unpacked to 48 KB slabs from segment 2B78
//               (one contiguous image, up to 0x24000 B = 576 tiles). Tile i = 256 bytes = 16 rows × 16
//               opaque 8-bpp pixels (blit at 1000:918e: 16 rows × 8 MOVSW). Palette ROUNDn.PAL.
//   World map   192×192 16-bit entries at 4B78 (row stride 384 B), toroidal, world 3072×3072 px
//               (RenderRaceFrameToBackBuffer 1000:90c5, 913c–9157). Bits 0–14 = tile index, bit 15 =
//               "overlay": after the cars, tile (index+12) is drawn again transparently on top
//               (1000:9214–9237). The map is built before the race by InitRaceCarsFromTables
//               1000:448c–4575: for every .MAP cell (32×32 of 96×96 px) the .CT entry for its tile
//               index — 72 bytes = 6 rows × 12 bytes = 6×6 little-endian words — is copied in place.
//               Bit 15 is then set by 1000:3994–39e4 for words in a round-dependent value range
//               (round 2: 0x40..0x13C, round 3: 1..0x51 — as read by the file-I/O agent; STATIC).
//   Vehicles    LoadRoundVh0AndSplit 1000:4611 + ExpandVehicleRotations24 1000:4696: VH0 unpacks to
//               9 stored frames of 24×24 (576 B; headings 0..90°, 0 = up, 8 = right) followed at
//               0x1440 by a second bank of 12 frames. Frames 9..31 are synthesised by mirroring:
//               f[9+k] = vflip(f[7-k]) k=0..7; f[17+k] = hflip(f[15-k]) k=0..6; f[24+k] = hflip(f[8-k])
//               k=0..7. Heading a (0..255, clockwise from up) → frame a>>3. Round 9 stores 40×40
//               frames (1600 B) with 5 second-bank frames at 0x3840 (1000:46f6).
//               Drawing: colour 0 transparent; body pixels with (p & 0xF) <= 2 get + car colour
//               offset (BlitSpriteCarColourRemapRace 1000:8c6a); shadow = silhouette in colour 0.
//   PH0         BITSFILE.PH0 unpacks to 26048 B (DS:3FE3): 3 × 8 frames of 8×8 puffs at +0/+0x200/+0x400
//               (DrawWheelEffectPuffs 1000:8083). +0x0600–0x1140 (2880 B) is the state-2/0xD knockout/
//               re-appear animation: 5 distinct 24×24 frames (table DS:289D/28AB), drawn from DS:45E3
//               (=PH0+0x600) by the shared state-2/0xD handler (1000:82BE) via 1000:8339. Then
//               +0x1140–0x1380 (576 B) is a sixth knockout slot the frame table 28AB never selects
//               (UNKNOWN_ph0_1140_1380, closed in docs/engine.md §9cf). From +0x1380 to EOF every boundary
//               is accounted for with zero gaps: warning icon (+0x1380, 16×16) / finished flag icon
//               (+0x1C00, 16×16) — DrawCarCheckpointDirectionIcon 1000:903F picks between them by
//               [BX+0x12ED]==0, i.e. the car's LAPS-REMAINING field reaching 0 (not a checkpoint
//               count — see docs/engine.md); digit table +0x1480, 11 glyphs of 8×16 (0–9 + a blinking marker glyph 10,
//               DrawPh0Glyph8x16ByIndex 1000:905F, DX=0x1008=DH:height,DL:width per BlitSpriteAtBufferOffset
//               1000:8D09's loop, CX=0xA confirmed at 1000:9010); two HUD indicator dots +0x1A00/+0x1B00
//               (16×16, red/blue, drawn in a row of ≤8 by DrawRaceHudDigitsAndRankIcons 1000:8DFC);
//               '1st'..'4th' labels +0x1D00 (128 B each); a 5×1024 B slot +0x1F00 shaped like a 32×32
//               sprite strip (DrawSprite32FromDs5EE3 1000:847E) that is DUAL-PURPOSE: during round 2
//               (POWERBOATS) it holds PH0's own bytes and is a boat-landing splash animation, spawned by
//               the round-2-gated trigger at 1000:74A3 and driven by FUN_1000_8386's per-car 5-slot
//               counter; during round 8 only, LoadRoundVh0AndSplit (1000:4676–468F) overwrites this exact
//               DS-relative slot with ROUND8BR.VH0's bank-2 bytes before racing starts (byte-diff
//               confirmed) and a separate, round-8-gated caller (DrawRound8ExtraAnim32) draws a spinning
//               chopper-rotor blade from the VH0 bytes instead — the two effects never coexist. 5×8×8 tail
//               icons +0x3300 (UNKNOWN_ph0_tail_icons consumer); 6×88×24 banners +0x3440–EOF, stride 2112,
//               drawn height 22 (DrawBanner88x22Blinking 1000:9289) reading "Bonus"/"Winner"/"Play Off"/
//               "1 Up!"/"Failed"/"Paused!".

import { decompress } from './lz.js'
import { parseMap, ctTileCount, MAP_SIDE, CT_BYTES_PER_TILE } from './track.js'
import { toU8, u16le } from './bytes.js'

export const SLAB = 0xc000
export const TILE = 16
export const TILE_BYTES = 256
export const WORLD_TILES = 192
export const WORLD_PX = WORLD_TILES * TILE
export const META = 6 // .MAP cell = 6×6 tiles
export const OVERLAY_TILE_DELTA = 12

/** Overlay ranges per round (words in [lo, hi] get bit 15). STATIC from 1000:3994–39e4; other rounds none. */
export const OVERLAY_RANGES = { 2: [0x40, 0x13c], 3: [0x01, 0x51] }

/**
 * Unpack a digit series (PR0, PR1, …) the way LoadCompressedSeries lays it out: 48 KB slabs.
 * The template's LAST character is the digit that gets patched ('ROUND1BR.PR0' → PR0, PR1, …),
 * exactly as 1000:3564–3571 patches the last byte of the name string. Stops at the first
 * missing file, capped at 10 so a bad `read` can never loop forever.
 */
export async function loadSeries(read, template) {
  const chunks = []
  const stem = template.slice(0, -1)
  for (let n = 0; n < 10; n++) {
    let packed
    try { packed = toU8(await read(stem + n)) } catch { break }
    chunks.push(decompress(packed))
  }
  if (!chunks.length) throw new Error(`${template}: no files`)
  const out = new Uint8Array((chunks.length - 1) * SLAB + chunks[chunks.length - 1].length)
  chunks.forEach((c, i) => out.set(c, i * SLAB))
  return { bytes: out, chunks: chunks.map((c) => c.length) }
}

export const loadTileBank = (read, round) => loadSeries(read, `GAME1/ROUND${round}BR.PR0`)

export const tileCount = (bank) => Math.floor(bank.length / TILE_BYTES)

export function tileImage(bank, index) {
  return { width: TILE, height: TILE, indexed: bank.subarray(index * TILE_BYTES, (index + 1) * TILE_BYTES) }
}

/** Sheet of all tiles, `perRow` per row. */
export function tileSheet(bank, perRow = 32) {
  const n = tileCount(bank)
  const rows = Math.ceil(n / perRow)
  const width = perRow * TILE, height = rows * TILE
  const indexed = new Uint8Array(width * height)
  for (let t = 0; t < n; t++) {
    const x0 = (t % perRow) * TILE, y0 = Math.floor(t / perRow) * TILE
    for (let y = 0; y < TILE; y++) indexed.set(bank.subarray(t * TILE_BYTES + y * TILE, t * TILE_BYTES + (y + 1) * TILE), (y0 + y) * width + x0)
  }
  return { width, height, indexed, perRow, count: n }
}

/**
 * The 192×192 word map the game builds from .MAP + .CT (bit 15 = overlay per OVERLAY_RANGES).
 * @returns {Uint16Array} row-major, stride 192
 */
export function buildWordMap(map, ct, round) {
  const { tiles } = parseMap(map)
  const ctb = toU8(ct)
  const n = ctTileCount(ctb)
  const words = new Uint16Array(WORLD_TILES * WORLD_TILES)
  const range = OVERLAY_RANGES[round]
  for (let row = 0; row < MAP_SIDE; row++) {
    for (let col = 0; col < MAP_SIDE; col++) {
      const t = tiles[row * MAP_SIDE + col]
      if (t >= n) continue
      const base = t * CT_BYTES_PER_TILE
      for (let y = 0; y < META; y++) {
        for (let x = 0; x < META; x++) {
          let w = u16le(ctb, base + y * 12 + x * 2)
          if (range && w >= range[0] && w <= range[1]) w |= 0x8000
          words[(row * META + y) * WORLD_TILES + col * META + x] = w
        }
      }
    }
  }
  return words
}

/**
 * Render the whole 3072×3072 track (or a sub-rectangle in tiles) from the word map and bank.
 * Base tiles are opaque; overlay tiles (bit 15) draw tile+12 transparently on top, as the game
 * does after the cars.
 */
export function renderTrack(words, bank, { x0 = 0, y0 = 0, w = WORLD_TILES, h = WORLD_TILES, overlays = true } = {}) {
  const width = w * TILE, height = h * TILE
  const indexed = new Uint8Array(width * height)
  const n = tileCount(bank)
  for (let ty = 0; ty < h; ty++) {
    for (let tx = 0; tx < w; tx++) {
      const word = words[((y0 + ty) % WORLD_TILES) * WORLD_TILES + ((x0 + tx) % WORLD_TILES)]
      const idx = word & 0x7fff
      if (idx < n) {
        const src = idx * TILE_BYTES
        for (let y = 0; y < TILE; y++) indexed.set(bank.subarray(src + y * TILE, src + (y + 1) * TILE), (ty * TILE + y) * width + tx * TILE)
      }
      if (overlays && (word & 0x8000) && idx + OVERLAY_TILE_DELTA < n) {
        const src = (idx + OVERLAY_TILE_DELTA) * TILE_BYTES
        for (let y = 0; y < TILE; y++) {
          const d = (ty * TILE + y) * width + tx * TILE
          for (let x = 0; x < TILE; x++) { const p = bank[src + y * TILE + x]; if (p) indexed[d + x] = p }
        }
      }
    }
  }
  return { width, height, indexed }
}

/** Box-filter downscale of an indexed image is meaningless; downscale after palette lookup instead. */
export function downscaleRgba(rgba, width, height, factor) {
  const w = Math.floor(width / factor), h = Math.floor(height / factor)
  const out = new Uint8ClampedArray(w * h * 4)
  const n = factor * factor
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r = 0, g = 0, b = 0
    for (let dy = 0; dy < factor; dy++) for (let dx = 0; dx < factor; dx++) {
      const o = ((y * factor + dy) * width + x * factor + dx) * 4
      r += rgba[o]; g += rgba[o + 1]; b += rgba[o + 2]
    }
    const o = (y * w + x) * 4
    out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = 255
  }
  return { width: w, height: h, rgba: out }
}

// ---------------------------------------------------------------- vehicles

export function vehicleGeometry(round) {
  return round === 9
    ? { size: 40, frameBytes: 1600, bank2Offset: 0x3840, bank2Frames: 5 }
    : { size: 24, frameBytes: 576, bank2Offset: 0x1440, bank2Frames: 12 }
}

const vflip = (f, s) => { const o = new Uint8Array(s * s); for (let y = 0; y < s; y++) o.set(f.subarray((s - 1 - y) * s, (s - y) * s), y * s); return o }
const hflip = (f, s) => { const o = new Uint8Array(s * s); for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) o[y * s + x] = f[y * s + (s - 1 - x)]; return o }

/**
 * The 32 rotation frames (0 = up, clockwise, frame = heading>>3) from the 9 stored ones.
 * @returns {{size:number, frames: Uint8Array[], bank2: Uint8Array[], rotorFrames: ?Array}}
 */
export function vehicleFrames(vh0, round) {
  const v = toU8(vh0)
  const { size, frameBytes, bank2Offset, bank2Frames } = vehicleGeometry(round)
  const stored = []
  for (let i = 0; i < 9; i++) stored.push(v.subarray(i * frameBytes, (i + 1) * frameBytes))
  const frames = [...stored]
  // Round 9's own loader (`LoadRoundVh0AndSplit 1000:4611` -> `ExpandVehicleRotations40 1000:46f6`)
  // builds this SAME 32-frame mirror table, byte-for-byte the same shape as the 24x24 generator
  // below (`ExpandVehicleRotations24 1000:4696`), just re-parameterized for size=40 -- confirmed by
  // matching anchor arithmetic (`mm-re-player-visible` 2026-09-23, docs/engine.md §9ak). A real,
  // previously-live port bug: this function used to skip the expansion entirely for round 9,
  // leaving only 9 frames -- `carFrame`'s `frames[h8>>3]` then read `undefined` for 23 of the 32
  // heading buckets (headings 72°-360°, ~3/4 of all headings), and both `drawCarBody`/
  // `drawCarShadow` bail out on a falsy frame -- RUFFTRUX's own car (and its shadow) was invisible
  // most of the time it wasn't pointed close to due-north. `vflip`/`hflip` are already generically
  // parameterized by `size`, so no round-9-specific mirror code was needed, only removing the guard
  // that skipped it.
  for (let k = 7; k >= 0; k--) frames.push(vflip(stored[k], size)) // 9..16
  for (let k = 15; k >= 9; k--) frames.push(hflip(frames[k], size)) // 17..23
  for (let k = 8; k >= 1; k--) frames.push(hflip(frames[k], size)) // 24..31
  const bank2 = []
  for (let i = 0; i < bank2Frames; i++) {
    const s = bank2Offset + i * frameBytes
    if (s + frameBytes <= v.length) bank2.push(v.subarray(s, s + frameBytes))
  }
  // CHOPPERS (round 8) only: `LoadRoundVh0AndSplit 1000:4676-468F` reinterprets this SAME byte
  // range (0x1440 on) as 5×32×32 rotor frames instead of `bank2`'s usual 12×24×24 -- see
  // `ph0ChopperRotorFrame`'s own header. Prepared once here, at load time, alongside `bank2`,
  // rather than re-sliced from raw bytes on every render call.
  const rotorFrames = round === 8 ? [0, 1, 2, 3, 4].map((f) => ph0ChopperRotorFrame(v, f)) : null
  return { size, frames, bank2, rotorFrames }
}

export function frameStrip(frames, size) {
  const width = frames.length * size
  const indexed = new Uint8Array(width * size)
  frames.forEach((f, i) => { for (let y = 0; y < size; y++) indexed.set(f.subarray(y * size, (y + 1) * size), y * width + i * size) })
  return { width, height: size, indexed }
}

/** Apply the car-colour remap the body blit does: pixels with (p & 0xF) <= 2 shift by `offset`. */
export function remapCarColours(frame, offset) {
  const out = new Uint8Array(frame.length)
  for (let i = 0; i < frame.length; i++) { const p = frame[i]; out[i] = p && (p & 0xf) <= 2 ? (p + offset) & 0xff : p }
  return out
}

/**
 * BlitSpriteCarColourRemapAtOffset 1000:8dc0 -- the race HUD's OWN recolour, used for the rank-icon
 * (helmet/finish-flag) sprite, docs/engine.md §9o. Deliberately NOT the same mask as `remapCarColours`
 * above: confirmed live at 1000:8dda-8de5 (`AND AH,0xF; CMP AH,1; JZ add; CMP AH,2; JNZ skip`) that
 * only nibble 1 or 2 shifts by `offset` -- nibble 0 (besides the sprite's own colour-0 transparency)
 * passes through untouched, unlike the vehicle body's `(p & 0xF) <= 2`.
 */
export function remapHudIconColours(frame, offset) {
  const out = new Uint8Array(frame.length)
  for (let i = 0; i < frame.length; i++) { const p = frame[i]; const n = p & 0xf; out[i] = p && (n === 1 || n === 2) ? (p + offset) & 0xff : p }
  return out
}

// ---------------------------------------------------------------- BITSFILE.PH0

export const PH0_LAYOUT = {
  puffs: [{ offset: 0x0000 }, { offset: 0x0200 }, { offset: 0x0400 }], // 8 frames of 8×8 each
  knockout: { offset: 0x0600, count: 5, width: 24, height: 24, stride: 576 }, // state-2/0xD overlay, see module comment above and ph0KnockoutFrame
  // 0x1140–0x1380 (576 B): knockout slot 5, never selected (docs/engine.md §9cf).
  icons: { warning: 0x1380, flag: 0x1c00, width: 16, height: 16 }, // DrawCarCheckpointDirectionIcon 1000:903F; flag shown when the drawn car's laps-remaining field ([BX+0x12ED]) reaches 0
  digits: { offset: 0x1480, count: 11, width: 8, height: 16, stride: 128 }, // 0–9 + blink glyph (index 10)
  lights: { red: 0x1a00, blue: 0x1b00, width: 16, height: 16 }, // HUD indicator dots; on/off vs red/blue role UNKNOWN
  positionLabels: { offset: 0x1d00, count: 4, width: 16, height: 8, stride: 128 },
  // +0x1F00 (size 32, 5 frames, stride 1024) is DUAL-PURPOSE, not PH0-only: during round 2 these are
  // PH0's own bytes (a boat-landing splash, see ph0Round2SplashFrames); during round 8 the same
  // DS-relative slot is overwritten with ROUND8BR.VH0 bank-2 bytes (see ph0ChopperRotorFrames).
  round2SplashOrRotor: { offset: 0x1f00, size: 32, frames: 5, stride: 1024 },
  tailIcons: { offset: 0x3300, count: 5, width: 8, height: 8, stride: 64 }, // UNKNOWN_ph0_tail_icons consumer
  banners: { offset: 0x3440, count: 6, width: 88, height: 24, stride: 2112, drawnHeight: 22 }, // DrawBanner88x22Blinking
  bannerText: ['Bonus', 'Winner', 'Play Off', '1 Up!', 'Failed', 'Paused!'],
}

export function ph0Puffs(ph0, set) {
  const b = toU8(ph0)
  const frames = []
  for (let f = 0; f < 8; f++) frames.push(b.subarray(PH0_LAYOUT.puffs[set].offset + f * 64, PH0_LAYOUT.puffs[set].offset + (f + 1) * 64))
  return frameStrip(frames, 8)
}

/** One 8×8 puff frame (0-7) from a given set (0=wet, 1=skid, 2=low-grip/mud -- docs/engine.md §9q). */
export function ph0PuffFrame(ph0, set, frame) {
  const b = toU8(ph0)
  const base = PH0_LAYOUT.puffs[set].offset + frame * 64
  return { width: 8, height: 8, indexed: b.subarray(base, base + 64) }
}

/** One 8×8 tail icon (0-4) -- the flying-projectile icon bank, docs/engine.md §9q (closes the
 * long-open UNKNOWN_ph0_tail_icons: only indices 0/1 are ever actually used by 1000:8712). */
export function ph0TailIcon(ph0, index) {
  const b = toU8(ph0)
  const { offset, stride, width } = PH0_LAYOUT.tailIcons
  const base = offset + index * stride
  return { width, height: width, indexed: b.subarray(base, base + width * width) }
}

/** One 16×16 icon (warning icon, flag icon, or a HUD light) at a given PH0 offset. */
export function ph0Icon16(ph0, offset) {
  const b = toU8(ph0)
  return { width: 16, height: 16, indexed: b.subarray(offset, offset + 256) }
}

/** One 8×16 digit glyph (0-9, or 10 = the blink/separator marker used by the round-9 countdown,
 * docs/engine.md §9o) from the tightly-packed strip -- `stride` (128) already equals `width*height`
 * (8*16), so unlike `ph0Strip` (which de-interleaves a stride that includes inter-frame gaps) this
 * is a direct contiguous slice, same shape as `ph0Icon16` above. */
export function ph0Digit(ph0, index) {
  const b = toU8(ph0)
  const { offset, width, height, stride } = PH0_LAYOUT.digits
  const o = offset + index * stride
  return { width, height, indexed: b.subarray(o, o + width * height) }
}

export function ph0PositionLabels(ph0) {
  return ph0Strip(ph0, PH0_LAYOUT.positionLabels)
}

/** One 24×24 state-2/0xD knockout/reappear overlay frame (0-4, `DrawPh0KnockoutAnimFrame
 * 1000:8339`, `mm-re-player-visible` 2026-09-23, docs/engine.md §9aj). Drawn colour-0-transparent
 * with NO car-colour remap (unlike the states-1/4/5 overlay below) -- confirmed at the instruction
 * level, `BlitSpriteTransparentRace` not `BlitSpriteCarColourRemapRace`. */
export function ph0KnockoutFrame(ph0, frame) {
  const b = toU8(ph0)
  const { offset, width, height, stride } = PH0_LAYOUT.knockout
  const base = offset + frame * stride
  return { width, height, indexed: b.subarray(base, base + width * height) }
}

/** One 16x8 "1st".."4th" label (index 0-3), the sprite `DrawCarRacePositionLabel 1000:9076` blits
 * (SI = 0x5CE3 + (racePosition-1)*128 = PH0 +0x1D00, docs/engine.md §9ah). Contiguous, like `ph0Digit`. */
export function ph0PositionLabel(ph0, index) {
  const b = toU8(ph0)
  const { offset, width, height, stride } = PH0_LAYOUT.positionLabels
  const o = offset + index * stride
  return { width, height, indexed: b.subarray(o, o + width * height) }
}

export function ph0Digits(ph0) {
  return ph0Strip(ph0, PH0_LAYOUT.digits)
}

function ph0Strip(ph0, { offset, count, width, height, stride }) {
  const b = toU8(ph0)
  const out = { width: width * count, height, indexed: new Uint8Array(width * count * height) }
  for (let i = 0; i < count; i++) for (let y = 0; y < height; y++) out.indexed.set(b.subarray(offset + i * stride + y * width, offset + i * stride + (y + 1) * width), y * out.width + i * width)
  return out
}

/**
 * The round-2 (POWERBOATS) boat-landing splash: PH0's own bytes at +0x1F00, 5 frames of 32×32, live
 * and displayed only during round 2 (spawn trigger at 1000:74A3, gated on [0x28BF]==2; animated by
 * FUN_1000_8386's per-car 5-slot counter). During round 8 this exact slot is overwritten instead —
 * see ph0ChopperRotorFrames.
 */
export function ph0Round2SplashFrames(ph0) {
  const b = toU8(ph0)
  const { offset, size, frames, stride } = PH0_LAYOUT.round2SplashOrRotor
  const out = []
  for (let f = 0; f < frames; f++) out.push(b.subarray(offset + f * stride, offset + f * stride + size * size))
  return frameStrip(out, size)
}

/** One 32×32 round-2 splash frame (0-4), docs/engine.md §9q. */
export function ph0Round2SplashFrame(ph0, frame) {
  const b = toU8(ph0)
  const { offset, size, stride } = PH0_LAYOUT.round2SplashOrRotor
  const base = offset + frame * stride
  return { width: size, height: size, indexed: b.subarray(base, base + size * size) }
}

/**
 * The round-8 (CHOPPERS) spinning rotor blade actually drawn by DrawSprite32FromDs5EE3: the first
 * 5×1024 B of ROUND8BR.VH0's bank-2 buffer, copied over BITSFILE.PH0's +0x1F00 slot at load time
 * (LoadRoundVh0AndSplit 1000:4676–468F) and reinterpreted as 5 frames of 32×32 (not the usual
 * 12×24×24 second-bank frames). Pass the LZ-unpacked ROUND8BR.VH0 bytes.
 */
export function ph0ChopperRotorFrames(vh0Unpacked) {
  const b = toU8(vh0Unpacked)
  const offset = 0x1440, size = 32, frames = 5, stride = 1024
  const out = []
  for (let f = 0; f < frames; f++) out.push(b.subarray(offset + f * stride, offset + f * stride + size * size))
  return frameStrip(out, size)
}

/** One rotor frame (0-4, though `DrawRound8ExtraAnim32 1000:843d`'s own selector,
 * `(rotorFrame>>1)&3`, only ever reaches 0-3 -- frame 4 is stored but structurally unreachable,
 * `mm-re-player-visible` 2026-09-23, docs/engine.md §9aj). Same source/offsets as
 * `ph0ChopperRotorFrames` above, single-frame instead of the strip that one builds for the viewer. */
export function ph0ChopperRotorFrame(vh0Unpacked, frame) {
  const b = toU8(vh0Unpacked)
  const offset = 0x1440, size = 32, stride = 1024
  const base = offset + frame * stride
  return { width: size, height: size, indexed: b.subarray(base, base + size * size) }
}

export function ph0TailIcons(ph0) {
  const b = toU8(ph0)
  const { offset, count, width, stride } = PH0_LAYOUT.tailIcons
  const out = []
  for (let i = 0; i < count; i++) out.push(b.subarray(offset + i * stride, offset + i * stride + width * width))
  return frameStrip(out, width)
}

/** One 88×`drawnHeight` banner (0-5, `PH0_LAYOUT.bannerText` names them; 5 = "Paused!",
 * docs/engine.md §9u) -- `DrawBanner88x22Blinking` only ever draws the first `drawnHeight` (22 of
 * the stored 24) rows of each slot. */
export function ph0Banner(ph0, index) {
  const b = toU8(ph0)
  const { offset, width, stride, drawnHeight } = PH0_LAYOUT.banners
  const base = offset + index * stride
  const indexed = new Uint8Array(width * drawnHeight)
  for (let y = 0; y < drawnHeight; y++) indexed.set(b.subarray(base + y * width, base + (y + 1) * width), y * width)
  return { width, height: drawnHeight, indexed }
}

/** The six banner slots stacked vertically (all the same width, so raw blocks concatenate directly). */
export function ph0BannerStack(ph0) {
  const b = toU8(ph0)
  const { offset, count, width, height, stride } = PH0_LAYOUT.banners
  const indexed = new Uint8Array(width * height * count)
  for (let i = 0; i < count; i++) indexed.set(b.subarray(offset + i * stride, offset + i * stride + width * height), i * width * height)
  return { width, height: height * count, indexed }
}
