// Track layout views.
//   ROUNDnm.MAP  → the 32×32 tile grid, the full 384×384 collision mask (MAP + COL), the 192×192
//                  direction field (MAP + DIR), the CT arena bytes (MAP + CT), and the second plane.
//   ROUNDn.COL / ROUNDn.DIR / ROUNDnBR.CT → per-tile sheets of the raw tables.
// Everything is drawn as false colour: these are not pixel graphics, they are tables.

import { parseMap, colMaskMap, colTile, colTileCount, dirMap, dirTile, dirTileCount, dirGrade, dirIsRamp, dirHeading, ctMap, ctTile, ctTileCount, mapRoundRace, MAP_SIDE, CELLS_PER_TILE, DIR_SIDE, CT_ROWS, CT_ROW_BYTES } from '../../formats/track.js'
import { checkpointList } from '../../data/engine-tables.js'
import { paint } from '../../render/raster.js'
import { toU8, hex } from '../../formats/bytes.js'
import { el, fmtBytes } from '../dom.js'
import { probeView } from './probeView.js'
import { assembledTrackSection } from './raceGfxView.js'

/** Grayscale/false-colour RGBA from a byte image; `scaleTo255` maps max→255 so small ranges are visible. */
function bytesToRgba(img, { max = 255, palette = null } = {}) {
  const out = new Uint8ClampedArray(img.width * img.height * 4)
  for (let i = 0; i < img.indexed.length; i++) {
    const v = img.indexed[i]
    let r, g, b
    if (palette) [r, g, b] = palette(v)
    else { const s = max ? Math.round((v * 255) / max) : 0; r = g = b = s }
    out[i * 4] = r; out[i * 4 + 1] = g; out[i * 4 + 2] = b; out[i * 4 + 3] = 255
  }
  return out
}

const maskPalette = (v) => (v ? [230, 60, 80] : [40, 200, 90]) // solid = red, free = green
const hueOf = (v, max) => { const h = (v / (max || 1)) * 300; const c = 200, x = c * (1 - Math.abs(((h / 60) % 2) - 1)); const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]; return [r + 30, g + 30, b + 30] }

function canvasFor(img, rgba, zoom) {
  const c = el('canvas', { class: 'pixels' })
  paint(c, img.width, img.height, rgba, { zoom })
  return c
}

export async function mapView(container, ctx) {
  const { bytes, entry, source, state, zoom } = ctx
  const rr = mapRoundRace(entry.path)
  const map = parseMap(bytes)
  const files = {}
  for (const [key, name] of [['col', `GAME1/ROUND${rr.round}.COL`], ['dir', `GAME1/ROUND${rr.round}.DIR`], ['ct', `GAME1/ROUND${rr.round}BR.CT`]]) {
    try { files[key] = toU8(await source.read(name)) } catch (err) { files[key] = null; container.append(el('p', { class: 'error' }, `${name}: ${err.message}`)) }
  }
  const nCol = files.col ? colTileCount(files.col) : 0
  const assembled = el('div', {})
  container.append(assembled)
  // Kicked off first so it renders in place above the grids, awaited at the end so a failure is
  // observable by the caller (and by the headless smoke test) rather than swallowed.
  const assembledDone = assembledTrackSection(assembled, { bytes, source, state, zoom, round: rr.round }).catch((err) => assembled.append(el('p', { class: 'error' }, `assembled track: ${err.message}`)))
  container.append(el('p', { class: 'muted' },
    `Round ${rr.round}, race ${rr.race}. 32×32 tiles of 96 world units (12×12 cells of 8). Tile indices 0–${map.maxTile} (bits 0–5); attribute bits 6–7 used: ${[...new Set(map.attrs)].sort().join(', ')}; plane 2 max ${map.maxPlane2}. ` +
    `COL has ${nCol} tiles${map.maxTile >= nCol ? ' — the map references a tile past the table (UNKNOWN_tile_index_overflow)' : ''}.`))

  // Tile grid (index as hue; attribute as a corner dot would need more pixels — use a second grid).
  const tileImg = { width: MAP_SIDE, height: MAP_SIDE, indexed: map.tiles }
  const attrImg = { width: MAP_SIDE, height: MAP_SIDE, indexed: map.attrs }
  const p2Img = { width: MAP_SIDE, height: MAP_SIDE, indexed: map.plane2 }
  const gz = Math.max(4, zoom * 3)
  container.append(el('h3', {}, 'Tile map (index → hue)'), canvasFor(tileImg, bytesToRgba(tileImg, { palette: (v) => hueOf(v, map.maxTile) }), gz))
  container.append(el('h3', {}, 'Attribute bits 6–7 (0 black … 3 white)'), canvasFor(attrImg, bytesToRgba(attrImg, { max: 3 }), gz))
  container.append(el('h3', {}, 'Plane 2 (bytes 1024–2047): per-tile track-progress value, consumed by TestColMaskBitAtWorldXY and used as the .BRK byte offset (docs/track-layout.md)'), canvasFor(p2Img, bytesToRgba(p2Img, { max: map.maxPlane2 }), gz))

  // Checkpoint thresholds (DS:2035, docs/engine.md §3) plotted against this race's own progress
  // plane — the M3.1 acceptance check in PLAN-ENGINE.md ("checkpoint thresholds ... land on the
  // course"). Rounds 2 and 8 have no checkpoints at all (docs/engine.md §8/§9): every tile is grey.
  const checkpoints = checkpointList(rr.round, rr.race)
  const bucketOf = (v) => { for (let i = 0; i < checkpoints.length; i++) if (v >= checkpoints[i].lo && v < checkpoints[i].hi) return i; return -1 }
  const bucketImg = { width: MAP_SIDE, height: MAP_SIDE, indexed: map.plane2 }
  const bucketRgba = bytesToRgba(bucketImg, { palette: (v) => { const b = bucketOf(v); return b < 0 ? [50, 50, 50] : hueOf(b, Math.max(1, checkpoints.length - 1)) } })
  container.append(el('h3', {}, `Checkpoint bands (DS:2035, ${checkpoints.length} for this round/race): hue = checkpoint index, grey = between bands`), canvasFor(bucketImg, bucketRgba, gz))
  if (checkpoints.length) container.append(el('p', { class: 'muted small' }, checkpoints.map((c, i) => `#${i}: [${c.lo},${c.hi})`).join('  ')))

  if (files.col) {
    const mask = colMaskMap(bytes, files.col)
    container.append(el('h3', {}, 'Collision mask (MAP × COL): 384×384 cells, red = solid'), canvasFor(mask, bytesToRgba(mask, { palette: maskPalette }), Math.max(1, Math.min(zoom, 3))))
  }
  if (files.dir) {
    const d = dirMap(bytes, files.dir)
    const dz = Math.max(1, Math.min(zoom * 2, 6))
    // Grade + ramp: hue by grade (0–15), ramp cells (bit 4 of the raw byte) overridden to bright red.
    const gradeRgba = bytesToRgba(d, { palette: (v) => (dirIsRamp(v) ? [230, 40, 40] : hueOf(dirGrade(v), 15)) })
    container.append(el('h3', {}, 'Terrain grade + ramp (MAP × DIR high nibble): 192×192 cells, hue = grade 0–15, bright red = ramp flag (bit 4)'), canvasFor(d, gradeRgba, dz))
    // Direction: the low-nibble → DS:191B/18FB heading chain, bucket 0 (the value ordinary, never-hit cars see).
    const headingRgba = bytesToRgba(d, { palette: (v) => hueOf(dirHeading(v), 255) })
    container.append(el('h3', {}, 'Direction (MAP × DIR low nibble → DS:191B/18FB heading, bucket 0): 192×192 cells, hue = heading angle'), canvasFor(d, headingRgba, dz))
  }
  if (files.ct) {
    const c = ctMap(bytes, files.ct)
    container.append(el('h3', {}, 'CT arena bytes (MAP × CT): 384×192 bytes = the 192×192 word map, low/high bytes interleaved'), canvasFor(c, bytesToRgba(c), Math.max(1, Math.min(zoom, 3))))
  }
  const grid = el('pre', { class: 'mono small' })
  const lines = []
  for (let r = 0; r < MAP_SIDE; r++) lines.push(Array.from(map.tiles.subarray(r * MAP_SIDE, (r + 1) * MAP_SIDE), (v) => hex(v)).join(' '))
  grid.textContent = lines.join('\n')
  container.append(el('h3', {}, 'Tile indices'), grid)
  await assembledDone
}

export function tileTableView(container, ctx) {
  const { bytes, entry, zoom } = ctx
  const data = toU8(bytes)
  const name = entry.name.toUpperCase()
  let kind, count, tileW, tileH, get, palette, max
  if (name.endsWith('.COL')) { kind = 'COL'; count = colTileCount(data); tileW = tileH = CELLS_PER_TILE; get = (t) => ({ width: tileW, height: tileH, indexed: colTile(data, t) }); palette = maskPalette }
  else if (name.endsWith('.DIR')) { kind = 'DIR'; count = dirTileCount(data); tileW = tileH = DIR_SIDE; get = (t) => ({ width: tileW, height: tileH, indexed: dirTile(data, t) }) }
  else {
    // CT: 6×6 words per meta-tile; show the low byte of each word (tile index & 0xFF) as a 6×6 cell.
    kind = 'CT'; count = ctTileCount(data); tileW = 6; tileH = CT_ROWS
    get = (t) => { const raw = ctTile(data, t).indexed; const idx = new Uint8Array(36); for (let i = 0; i < 36; i++) idx[i] = raw[i * 2]; return { width: 6, height: 6, indexed: idx } }
    max = 255
  }
  const perTile = data.length / count
  container.append(el('p', { class: 'muted' }, `${kind}: ${count} tiles × ${perTile} bytes (${fmtBytes(data.length)}${data.length % perTile ? `, ${data.length % perTile} bytes left over` : ''}). ` +
    (kind === 'COL' ? 'Each tile is a 12×12 one-bit collision mask (MSB first). '
      : kind === 'DIR' ? 'Each tile is 6×6 bytes, one per 2×2-cell block. Each byte packs a terrain grade/ramp nibble and a direction nibble feeding a heading lookup (docs/track-layout.md); shown as two sheets below. '
        : 'Each meta-tile is 6×6 little-endian words = 16×16 tile indices into the PR bank (shown: low byte). ')))
  const cols = 16
  const rows = Math.ceil(count / cols)
  const gap = 1
  const sheet = { width: cols * (tileW + gap), height: rows * (tileH + gap), indexed: new Uint8Array(cols * (tileW + gap) * rows * (tileH + gap)) }
  for (let t = 0; t < count; t++) {
    const img = get(t)
    const x0 = (t % cols) * (tileW + gap), y0 = Math.floor(t / cols) * (tileH + gap)
    for (let y = 0; y < tileH; y++) sheet.indexed.set(img.indexed.subarray(y * tileW, (y + 1) * tileW), (y0 + y) * sheet.width + x0)
  }
  if (kind === 'DIR') {
    const gradeRgba = bytesToRgba(sheet, { palette: (v) => (dirIsRamp(v) ? [230, 40, 40] : hueOf(dirGrade(v), 15)) })
    container.append(el('h3', {}, `Tiles 0–${count - 1}, terrain grade + ramp (16 per row; hue = grade, bright red = ramp)`), canvasFor(sheet, gradeRgba, Math.max(2, zoom * 2)))
    const headingRgba = bytesToRgba(sheet, { palette: (v) => hueOf(dirHeading(v), 255) })
    container.append(el('h3', {}, `Tiles 0–${count - 1}, direction (16 per row; hue = heading angle, bucket 0)`), canvasFor(sheet, headingRgba, Math.max(2, zoom * 2)))
  } else {
    const rgba = palette ? bytesToRgba(sheet, { palette }) : bytesToRgba(sheet, { max: max || 255 })
    container.append(el('h3', {}, `Tiles 0–${count - 1} (16 per row)`), canvasFor(sheet, rgba, Math.max(2, zoom * 2)))
  }
  const probe = el('div', {})
  container.append(el('h3', {}, 'Raw'), probe)
  probeView(probe, ctx)
}
