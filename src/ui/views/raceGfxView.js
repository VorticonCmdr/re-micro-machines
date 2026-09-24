// Race graphics views.
//   ROUNDnBR.PR0/1/2 → the round's whole tile bank as a sheet (one view for the three files).
//   ROUNDnBR.VH0     → the 9 stored + 23 mirrored rotation frames, the second bank, colour remaps.
//   BITSFILE.PH0     → puff animations and position labels, plus a raw probe of the rest.
//   ROUNDnm.MAP      → (from trackView) gains the assembled track via `assembledTrackSection`.

import { loadTileBank, tileSheet, tileCount, buildWordMap, renderTrack, downscaleRgba, vehicleFrames, frameStrip, remapCarColours, ph0Puffs, ph0PositionLabels, ph0Icon16, ph0Digits, ph0Round2SplashFrames, ph0ChopperRotorFrames, ph0TailIcons, ph0BannerStack, PH0_LAYOUT, WORLD_TILES, TILE } from '../../formats/race.js'
import { decompress } from '../../formats/lz.js'
import { decodePalette } from '../../formats/pal.js'
import { indexedToRgba, paint, rgbaToCanvas, CHECKER_CSS } from '../../render/raster.js'
import { toU8 } from '../../formats/bytes.js'
import { el, fmtBytes } from '../dom.js'
import { probeView } from './probeView.js'

const roundOf = (path) => Number(/ROUND(\d)/i.exec(path)?.[1])

async function roundPalette(source, round, state) {
  return decodePalette(toU8(await source.read(`GAME1/ROUND${round}.PAL`)), { bits: state.palBits ?? 6 }).rgb
}

/** Tile bank per round, cached on the shared state (three files map to one bank). */
async function bankFor(source, round, state) {
  state.banks ||= {}
  if (!state.banks[round]) state.banks[round] = await loadTileBank((n) => source.read(n), round)
  return state.banks[round]
}

export async function tileBankView(container, { entry, source, state, zoom }) {
  const round = roundOf(entry.path)
  const status = el('p', { class: 'muted' }, `Unpacking ROUND${round}BR.PR0…`)
  container.append(status)
  const { bytes: bank, chunks } = await bankFor(source, round, state)
  const rgb = await roundPalette(source, round, state)
  status.textContent = `Round ${round} tile bank: ${chunks.length} LZ slabs (${chunks.map(fmtBytes).join(' + ')}) → ${tileCount(bank)} tiles of 16×16, 256 B each, opaque 8-bpp, palette ROUND${round}.PAL. ` +
    `This file is slab ${/PR(\d)/.exec(entry.name)[1]}: tiles ${Number(/PR(\d)/.exec(entry.name)[1]) * 192}–${Math.min(tileCount(bank), (Number(/PR(\d)/.exec(entry.name)[1]) + 1) * 192) - 1}.`
  const sheet = tileSheet(bank, 32)
  const c = el('canvas', { class: 'pixels' })
  paint(c, sheet.width, sheet.height, indexedToRgba(sheet.indexed, rgb), { zoom: Math.max(1, Math.min(zoom, 3)) })
  container.append(el('h3', {}, `All ${sheet.count} tiles (32 per row; tile n = row n>>5, column n&31)`), c)
  container.append(el('p', { class: 'muted' }, 'Evidence: LoadRoundPrSeries 1000:45EF loads the series to 48 KB slabs; the tile blit at 1000:918E copies 16 rows × 8 words. Tile index+12 is the transparent "overlay" variant used for bit-15 map entries (1000:9214).'))
}

export async function vehicleView(container, { bytes, entry, source, state, zoom }) {
  const round = roundOf(entry.path)
  const rgb = await roundPalette(source, round, state)
  const unpacked = decompress(toU8(bytes))
  const { size, frames, bank2 } = vehicleFrames(unpacked, round)
  container.append(el('p', { class: 'muted' }, `LZ-unpacked ${fmtBytes(unpacked.length)}. ${round === 9 ? '9 stored frames of 40×40 (round 9 has no mirrored set)' : '9 stored frames of 24×24 (headings 0–90°), 23 more synthesised by mirroring (ExpandVehicleRotations24 1000:4696)'}; frame = heading>>3, 0 = up, clockwise. Second bank at 0x${(round === 9 ? 0x3840 : 0x1440).toString(16)}: ${bank2.length} frames.`))
  const show = (img, z, title) => {
    const c = el('canvas', { class: 'pixels', style: { background: CHECKER_CSS }, title })
    paint(c, img.width, img.height, indexedToRgba(img.indexed, rgb, { transparent: 0 }), { zoom: z })
    return c
  }
  container.append(el('h3', {}, `Rotation frames 0–${frames.length - 1}`), show(frameStrip(frames, size), Math.max(2, zoom)))
  if (round !== 9) {
    const remaps = el('div', { class: 'sprite-sheet' })
    for (const off of [0, 16, 32, 48, 64, 80, 96, 112]) {
      const f = remapCarColours(frames[4], off)
      remaps.append(el('figure', {}, show({ width: size, height: size, indexed: f }, Math.max(2, zoom)), el('figcaption', { class: 'mono' }, `+${off}`)))
    }
    container.append(el('h3', {}, 'Car-colour remap of frame 4 (pixels with (p&0xF)≤2 shifted by the car offset — BlitSpriteCarColourRemapRace 1000:8C6A)'), remaps)
  }
  if (bank2.length) container.append(el('h3', {}, `Second bank (${bank2.length} frames of ${size}×${size} — UNKNOWN_vh0_bank2; used by DrawSprite24FromSecondBank for crash/fall animations)`), show(frameStrip(bank2, size), Math.max(2, zoom)))
  if (round === 8) {
    container.append(el('h3', {}, 'Round-8 chopper rotor blade (first 5×1024 B of the second bank, reread as 5× 32×32)'),
      el('p', { class: 'muted' }, 'LoadRoundVh0AndSplit (1000:4676–468F) copies these same bytes into BITSFILE.PH0’s resident buffer at DS:5EE3; DrawRound8ExtraAnim32/DrawSprite32FromDs5EE3 draws them as a spinning rotor overlay on the car body. Verified: BITSFILE.PH0’s own bytes at that offset differ (byte-diff), so this VH0 data — not PH0’s — is what actually gets shown.'),
      show(ph0ChopperRotorFrames(unpacked), Math.max(2, zoom)))
  }
  const probe = el('div', {})
  container.append(el('h3', {}, 'Raw (packed file)'), probe)
  probeView(probe, { bytes, entry, state, source, zoom })
}

export async function bitsfileView(container, ctx) {
  const { bytes, source, state, zoom } = ctx
  const unpacked = decompress(toU8(bytes))
  const rgb = await roundPalette(source, 1, state)
  container.append(el('p', { class: 'muted' }, `LZ-unpacked ${fmtBytes(unpacked.length)} (0x${unpacked.length.toString(16)}), copied to DS:3FE3 every race (LoadBitsFilePh0 1000:482F). Shared race graphics; shown with ROUND1.PAL.`))
  const show = (img, z) => { const c = el('canvas', { class: 'pixels', style: { background: CHECKER_CSS } }); paint(c, img.width, img.height, indexedToRgba(img.indexed, rgb, { transparent: 0 }), { zoom: z }); return c }
  for (let s = 0; s < 3; s++) container.append(el('h3', {}, `Puff animation set ${s} (8 frames of 8×8 @ +0x${(s * 0x200).toString(16)})`), show(ph0Puffs(unpacked, s), Math.max(4, zoom * 2)))
  container.append(el('h3', {}, 'UNKNOWN_ph0_0600_1380: +0x0600–0x1380 (3456 B, no consumer identified)'), (() => {
    const w = 24, h = Math.floor(0xd80 / w)
    const raw = toU8(unpacked).subarray(0x600, 0x600 + w * h)
    return show({ width: w, height: h, indexed: raw }, Math.max(3, zoom))
  })())
  container.append(el('h3', {}, 'Checkpoint-direction icon pair (16×16): warning @ +0x1380, flag @ +0x1C00 — DrawCarCheckpointDirectionIcon 1000:903F picks the flag once [BX+0x12ED]==0'),
    el('div', { class: 'sprite-sheet' },
      el('figure', {}, show(ph0Icon16(unpacked, PH0_LAYOUT.icons.warning), Math.max(4, zoom * 2)), el('figcaption', {}, 'warning')),
      el('figure', {}, show(ph0Icon16(unpacked, PH0_LAYOUT.icons.flag), Math.max(4, zoom * 2)), el('figcaption', {}, 'flag'))))
  container.append(el('h3', {}, 'Digit table (8×16 @ +0x1480, stride 128, 11 glyphs: 0–9 + a blinking marker glyph at index 10) — DrawPh0Glyph8x16ByIndex 1000:905F'), show(ph0Digits(unpacked), Math.max(4, zoom * 2)))
  container.append(el('h3', {}, 'HUD indicator dots (16×16): red @ +0x1A00, blue @ +0x1B00 — drawn in a row of ≤8 by DrawRaceHudDigitsAndRankIcons 1000:8DFC; red/blue role UNKNOWN'),
    el('div', { class: 'sprite-sheet' },
      el('figure', {}, show(ph0Icon16(unpacked, PH0_LAYOUT.lights.red), Math.max(4, zoom * 2)), el('figcaption', {}, 'red')),
      el('figure', {}, show(ph0Icon16(unpacked, PH0_LAYOUT.lights.blue), Math.max(4, zoom * 2)), el('figcaption', {}, 'blue'))))
  container.append(el('h3', {}, 'Position labels 1st–4th (16×8 @ +0x1D00, stride 128)'), show(ph0PositionLabels(unpacked), Math.max(4, zoom * 2)))
  container.append(el('h3', {}, 'Dual-purpose slot @ +0x1F00 (32×32, 5 frames, stride 1024)'),
    el('p', { class: 'muted' }, 'Round 2 (POWERBOATS): these are PH0’s own bytes, a boat-landing splash animation (spawn trigger 1000:74A3, gated on round==2). Round 8 (CHOPPERS): LoadRoundVh0AndSplit (1000:4676–468F) overwrites this exact DS-relative slot with ROUND8BR.VH0 bank-2 bytes instead, drawn as a spinning rotor blade — open that file’s view to see it. The two effects never coexist; shown below is PH0’s own content (the round-2 splash).'),
    show(ph0Round2SplashFrames(unpacked), Math.max(2, zoom)))
  container.append(el('h3', {}, 'UNKNOWN_ph0_tail_icons: 5× 8×8 icons @ +0x3300, stride 64 (no consumer identified)'), show(ph0TailIcons(unpacked), Math.max(4, zoom * 2)))
  container.append(el('h3', {}, 'Banners (88×24 @ +0x3440, stride 2112, drawn height 22) — DrawBanner88x22Blinking 1000:9289'),
    el('div', {}, ...PH0_LAYOUT.bannerText.map((t) => el('p', { class: 'mono muted' }, t))), show(ph0BannerStack(unpacked), Math.max(2, zoom)))
  const probe = el('div', {})
  container.append(el('h3', {}, 'Unpacked bytes (probe: try width 16 / 88 with a ROUNDn.PAL)'), probe)
  probeView(probe, { ...ctx, bytes: unpacked.buffer.slice(unpacked.byteOffset, unpacked.byteOffset + unpacked.length) })
}

/** Appended to the MAP view: the assembled world at 1/4 scale with a full-scale crop control. */
export async function assembledTrackSection(container, { bytes, source, state, zoom, round }) {
  const head = el('h3', {}, 'Assembled track (MAP × CT → 192×192 tile words × PR bank), 1:4')
  const status = el('p', { class: 'muted' }, 'Unpacking tile bank…')
  container.append(head, status)
  const { bytes: bank } = await bankFor(source, round, state)
  const rgb = await roundPalette(source, round, state)
  const ct = toU8(await source.read(`GAME1/ROUND${round}BR.CT`))
  const words = buildWordMap(bytes, ct, round)
  const full = renderTrack(words, bank)
  const rgba = indexedToRgba(full.indexed, rgb)
  const small = downscaleRgba(rgba, full.width, full.height, 4)
  const overview = rgbaToCanvas(small.width, small.height, small.rgba)
  overview.className = 'pixels'
  overview.style.cursor = 'crosshair'
  let overlays = 0; for (const w of words) if (w & 0x8000) overlays++
  status.textContent = `World 3072×3072 px = 192×192 tiles; ${overlays} overlay entries (bit 15). Click the overview to see that area at 1:1.`
  const cropCanvas = el('canvas', { class: 'pixels' })
  const cropInfo = el('p', { class: 'readout mono' }, 'click the overview')
  const showCrop = (tx, ty) => {
    const w = Math.min(20, WORLD_TILES), h = Math.min(14, WORLD_TILES)
    const x0 = Math.max(0, Math.min(WORLD_TILES - w, tx - (w >> 1)))
    const y0 = Math.max(0, Math.min(WORLD_TILES - h, ty - (h >> 1)))
    const img = renderTrack(words, bank, { x0, y0, w, h })
    paint(cropCanvas, img.width, img.height, indexedToRgba(img.indexed, rgb), { zoom })
    cropInfo.textContent = `tiles (${x0},${y0})–(${x0 + w - 1},${y0 + h - 1}) = world px (${x0 * TILE},${y0 * TILE}); race view is 16×12.5 tiles`
  }
  overview.addEventListener('click', (e) => {
    const r = overview.getBoundingClientRect()
    showCrop(Math.floor(((e.clientX - r.left) / r.width) * WORLD_TILES), Math.floor(((e.clientY - r.top) / r.height) * WORLD_TILES))
  })
  container.append(overview, cropInfo, cropCanvas)
  showCrop(WORLD_TILES >> 1, WORLD_TILES >> 1)
}
