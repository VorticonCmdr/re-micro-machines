// STRT_POS.BIN, CHEATS.BIN and SETTINGS.DAT — see src/formats/globaldata.js for the format.

import { parseStrtPos, parseCheats, parseSettings, scancodeName, CONTROL_NAME } from '../../formats/globaldata.js'
import { toU8 } from '../../formats/bytes.js'
import { paint } from '../../render/raster.js'
import { el, fmtBytes } from '../dom.js'
import { probeView } from './probeView.js'

const WORLD = 3072
const hueOf = (n, max) => { const h = (n / (max || 1)) * 300; const c = 200, x = c * (1 - Math.abs(((h / 60) % 2) - 1)); const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]; return [r + 30, g + 30, b + 30] }

/** A `side`×`side` scatter of world-coordinate points, one dot (3×3) per entry, hue = round. */
function worldScatter(points, side = 192) {
  const rgba = new Uint8ClampedArray(side * side * 4)
  for (const { x, y, round } of points) {
    const px = Math.min(side - 1, Math.round((x / WORLD) * side))
    const py = Math.min(side - 1, Math.round((y / WORLD) * side))
    const [r, g, b] = hueOf(round, 9)
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const px2 = px + dx, py2 = py + dy
      if (px2 < 0 || py2 < 0 || px2 >= side || py2 >= side) continue
      const i = (py2 * side + px2) * 4
      rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b; rgba[i + 3] = 255
    }
  }
  const c = el('canvas', { class: 'pixels' })
  paint(c, side, side, rgba, { zoom: 2 })
  return c
}

function strtPosView(container, { bytes }) {
  const entries = parseStrtPos(bytes)
  container.append(el('p', { class: 'muted' },
    `144 B: 9 rounds × 4 race-slots × {x, y} world coordinates (0..${WORLD - 1}) — every round reserves 4 slots even where it only races 3 (InitRaceCarsFromTables 1000:3d9f-3e0e). This is where a car is placed at the start of a race, before the checkpoint system (docs/track-layout.md) takes over.`))
  container.append(el('h3', {}, 'All 36 slots plotted on the 3072×3072 world (hue = round 1–9)'), worldScatter(entries))
  const pre = el('pre', { class: 'mono small' })
  pre.textContent = entries.map((e) => `round ${e.round}  race-slot ${e.race}  (${String(e.x).padStart(4)}, ${String(e.y).padStart(4)})`).join('\n')
  container.append(el('h3', {}, 'All slots'), pre)
}

const CHEAT_TYPE_NOTE = 'UNKNOWN_cheats_type: matched by round/race/position in FUN_1000_35f0 (1000:3601–3652), but what each numbered type actually does at that spot has not been decoded.'

function cheatsView(container, { bytes }) {
  const entries = parseCheats(bytes)
  container.append(el('p', { class: 'muted' },
    `360 B: 30 × 12-byte records {round, race, x, y, type 0–9, param}, world coordinates 0..${WORLD - 1}. ${CHEAT_TYPE_NOTE}`))
  container.append(el('h3', {}, 'All 30 cheat spots plotted on the 3072×3072 world (hue = round 1–9)'), worldScatter(entries))
  const byType = {}
  for (const e of entries) (byType[e.type] ??= []).push(e)
  const pre = el('pre', { class: 'mono small' })
  pre.textContent = entries.map((e) => `round ${e.round}  race ${e.race}  (${String(e.x).padStart(4)}, ${String(e.y).padStart(4)})  type ${e.type}  param ${e.param}`).join('\n')
  container.append(el('h3', {}, `All 30 records (types seen: ${Object.keys(byType).sort((a, b) => a - b).join(', ')})`), pre)
}

// Slot order for the 5-key KEYS1/KEYS2 blocks, resolved from RunRedefineKeysScreen's own labels
// (1000:92f0, DS:AE4B) and KeyboardIsr's scancode-slot-to-bit mapping (1000:2efd) — docs/engine.md §6.
// Was UNKNOWN_settings_key_slots; closed.
const ACTION_ROLES = ['LEFT', 'RIGHT', 'ACCELERATE', 'BRAKE', 'SELECT (fire)']

function keyRow(label, codes, roles = null) {
  return el('div', { class: 'mono small' }, `${label}: `,
    codes.map((c, i) => `${roles ? `${roles[i]}=` : ''}${scancodeName(c)} (0x${c.toString(16).padStart(2, '0')})`).join('  '))
}

function settingsView(container, { bytes }) {
  const s = parseSettings(bytes)
  container.append(el('p', { class: 'muted' },
    `32 B, read/written by RunOptionsScreenWithSettingsDat (1000:2770). Control words are a 1-based enum: ${Object.entries(CONTROL_NAME).map(([k, v]) => `${k} ${v}`).join(', ')}. Live-confirmed: ESC-quit and RETURN-to-play write nothing back when no option changed (docs/track-layout.md).`))
  container.append(
    el('h3', {}, 'Controls & driver'),
    el('div', { class: 'mono small' }, `Player 1 control: ${s.p1ControlName} (${s.p1Control})`),
    el('div', { class: 'mono small' }, `Player 2 control: ${s.p2ControlName} (${s.p2Control})`),
    el('div', { class: 'mono small' }, `Smoothness: ${s.smoothness}`),
    el('div', { class: 'mono small' }, `Sound driver: ${s.soundDriverName}`),
    el('div', { class: 'mono small' }, `Joystick 1 thresholds: left ${s.joystick1.left}, right ${s.joystick1.right}`),
    el('div', { class: 'mono small' }, `Joystick 2 thresholds: left ${s.joystick2.left}, right ${s.joystick2.right}`),
  )
  container.append(
    el('h3', {}, 'Key bindings (16 PC scancodes; slot order is LEFT/RIGHT/ACCELERATE/BRAKE/SELECT, resolved in docs/engine.md §6 — was UNKNOWN_settings_key_slots)'),
    keyRow('KEYS 1 (5 keys)', s.keys1, ACTION_ROLES),
    keyRow('F1–F3 (fixed)', s.f1f3),
    keyRow('KEYS 2 (5 keys)', s.keys2, ACTION_ROLES),
    keyRow('D / SPACE / V (fixed)', s.dSpaceV),
  )
  container.append(el('h3', {}, 'Raw words'), el('pre', { class: 'mono small' }, s.raw.map((w, i) => `[${i}] ${w} (0x${w.toString(16)})`).join('\n')))
}

export function globalDataView(container, ctx) {
  const { bytes, entry } = ctx
  const name = entry.name.toUpperCase()
  container.append(el('p', { class: 'muted small' }, `${entry.path} — ${fmtBytes(toU8(bytes).length)}`))
  if (name === 'STRT_POS.BIN') strtPosView(container, ctx)
  else if (name === 'CHEATS.BIN') cheatsView(container, ctx)
  else if (name === 'SETTINGS.DAT') settingsView(container, ctx)
  else container.append(el('p', { class: 'error' }, `globalDataView: unrecognised file ${entry.path}`))
  const raw = el('div', {})
  container.append(el('h3', {}, 'Raw'), raw)
  probeView(raw, ctx)
}
