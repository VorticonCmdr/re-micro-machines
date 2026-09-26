// ROUNDnBR.LEV (per-meta-tile placement/safe-respawn bytes) and ROUNDnmB.BRK (per-race AI
// brake/speed-limit stream). See src/formats/levbrk.js and docs/track-layout.md for the derivation.

import { parseLev, parseBrk, levBrkRoundRace } from '../../formats/levbrk.js'
import { toU8, hex } from '../../formats/bytes.js'
import { paint } from '../../render/raster.js'
import { el, fmtBytes } from '../dom.js'
import { probeView } from './probeView.js'

function canvasFromRgba(width, height, rgba, zoom) {
  const c = el('canvas', { class: 'pixels' })
  paint(c, width, height, rgba, { zoom })
  return c
}

function levView(container, ctx) {
  const { bytes, entry, zoom } = ctx
  const rr = levBrkRoundRace(entry.path)
  const { count, entries } = parseLev(bytes)
  container.append(el('p', { class: 'muted' },
    `Round ${rr?.round ?? '?'}: ${count} meta-tiles (${fmtBytes(toU8(bytes).length)}), one byte each — same indexing as .COL/.CT/.DIR. `,
    'bit 7 = "not a safe respawn tile" (skips the safe-point update for a car whose current tile this is — not a projectile line-of-sight flag, docs/engine.md); bits 6–5 = one of 4 respawn headings (also a car\'s .DIR remap row, docs/engine.md); bits 4–2 = one of 8 spawn-nudge vectors (compass rose, ±36 units); bits 1–0 unused by any traced consumer.'))

  // One 16×16 px cell per tile: hue = heading, red border = blocking, small dot = nudge direction.
  const cell = 16, cols = 16, rows = Math.ceil(count / cols)
  const w = cols * cell, h = rows * cell
  const rgba = new Uint8ClampedArray(w * h * 4)
  const headingColor = [[80, 140, 255], [255, 140, 80], [140, 255, 80], [255, 80, 200]]
  for (let t = 0; t < count; t++) {
    const e = entries[t]
    const x0 = (t % cols) * cell, y0 = Math.floor(t / cols) * cell
    const [r, g, b] = headingColor[(e.raw >> 5) & 3]
    for (let y = 0; y < cell; y++) {
      for (let x = 0; x < cell; x++) {
        const border = e.unsafeRespawn && (x < 2 || y < 2 || x >= cell - 2 || y >= cell - 2)
        const nx = cell / 2 + Math.sign(e.nudge.dx) * 4, ny = cell / 2 + Math.sign(e.nudge.dy) * 4
        const dot = Math.abs(x - nx) <= 1.5 && Math.abs(y - ny) <= 1.5
        const i = ((y0 + y) * w + (x0 + x)) * 4
        if (border) { rgba[i] = 230; rgba[i + 1] = 40; rgba[i + 2] = 40 }
        else if (dot) { rgba[i] = 255; rgba[i + 1] = 255; rgba[i + 2] = 255 }
        else { rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b }
        rgba[i + 3] = 255
      }
    }
  }
  container.append(el('h3', {}, `${count} meta-tiles (red border = not a safe respawn tile; dot = spawn-nudge direction; hue = respawn heading)`), canvasFromRgba(w, h, rgba, Math.max(1, zoom)))

  const pre = el('pre', { class: 'mono small' })
  pre.textContent = entries.map((e, i) => `tile ${String(i).padStart(2)}  raw ${hex(e.raw)}  unsafeRespawn=${e.unsafeRespawn ? 'Y' : 'n'}  heading=0x${e.heading.toString(16)}  nudge=(${e.nudge.dx.toString().padStart(3)},${e.nudge.dy.toString().padStart(3)})  low2=${e.lowBits}`).join('\n')
  container.append(el('h3', {}, 'Per-tile decode'), pre)
}

function brkView(container, ctx) {
  const { bytes, entry, zoom } = ctx
  const rr = levBrkRoundRace(entry.path)
  const { count, records } = parseBrk(bytes)
  container.append(el('p', { class: 'muted' },
    `Round ${rr?.round ?? '?'} race ${rr?.race ?? '?'}: ${count} bytes (${fmtBytes(toU8(bytes).length)}). `,
    "AI brake/speed-limit-point stream, indexed by a car's track-progress value (from .MAP's second plane) — not a fixed per-tile table, so this is shown as a flat sequence in file order, the way the game itself walks it. High nibble = record type: 0 = advance the target speed; 1 = brake if the current speed is over 896+128n; 2 = raise the target speed to at least 1536+64n (never brakes); 3/4/15 = the type-1 check, but only while the drone is correcting its heading (1000:54AF). Low nibble = n (docs/track-layout.md)."))

  // A strip: one column per byte, height ~ magnitude, colour = type.
  const colW = Math.max(2, Math.min(8, Math.floor(600 / Math.max(1, count))))
  const h = 64
  const w = count * colW
  const rgba = new Uint8ClampedArray(w * h * 4).fill(0)
  const typeColor = { 1: [230, 140, 40], 2: [60, 140, 230] } // everything else (0, 3-15) hits the shared default branch (1000:54AF) -> gray
  const colorFor = (type) => typeColor[type] ?? [120, 120, 120]
  for (let i = 0; i < count; i++) {
    const r = records[i]
    const [cr, cg, cb] = colorFor(r.type)
    const barH = Math.round((r.magnitude / 15) * (h - 1)) + 1
    for (let y = 0; y < barH; y++) {
      for (let x = 0; x < colW - 1; x++) {
        const i4 = ((h - 1 - y) * w + i * colW + x) * 4
        rgba[i4] = cr; rgba[i4 + 1] = cg; rgba[i4 + 2] = cb; rgba[i4 + 3] = 255
      }
    }
  }
  container.append(el('h3', {}, `${count} records (gray = advance-target-speed, orange = type 1 limit, blue = type 2 limit; bar height = magnitude 0–15)`), canvasFromRgba(w, h, rgba, Math.max(1, zoom)))

  const pre = el('pre', { class: 'mono small' })
  pre.textContent = records.map((r) => `${String(r.index).padStart(3)}  raw ${hex(r.raw)}  type ${r.type}  mag ${String(r.magnitude).padStart(2)}  ${r.note}`).join('\n')
  container.append(el('h3', {}, 'Records'), pre)
}

export function levBrkView(container, ctx) {
  const { entry } = ctx
  const rr = levBrkRoundRace(entry.path)
  if (rr?.kind === 'lev') levView(container, ctx)
  else if (rr?.kind === 'brk') brkView(container, ctx)
  else container.append(el('p', { class: 'error' }, `levBrkView: could not tell .LEV from .BRK for ${entry.path}`))
  const raw = el('div', {})
  container.append(el('h3', {}, 'Raw'), raw)
  probeView(raw, ctx)
}
