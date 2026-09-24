// Engine tables that live inside MICROU.EXE's data segment, not tied to any one asset file
// (docs/engine.md §8, src/data/engine-tables.js). Not part of the file-driven catalog; opened
// from the "Tools" section of the sidebar. `npm run tables` is the real check against
// MICROU.EXE -- this page is for looking at what the numbers mean.

import {
  SINE8, CONTACT_TABLE, CONTACT_TABLE_SIDE, CAR_TYPE_INFO, KID_MODIFIER, RUFF_TRUCK_TIMES,
  DRONE_MAX_VEL_HANDICAP, GRIP_ADJUST, DECAY_BOUNCE, TERRAIN_ROWS, TERRAIN_HANDLER_NAMES,
  STATE_TABLE, STATE_HANDLER_NAMES, CAR_CAMERA_TABLE,
} from '../../data/engine-tables.js'
import { paint } from '../../render/raster.js'
import { el } from '../dom.js'

const CAR_TYPE_COLUMNS = ['maxSpeedBase', 'reverseLimit', 'accel', 'brakeDecel', 'coastDecel', 'slipThreshold', 'gripStep', '[28C2]', '[28C4]']
const ROUND_NAMES = ['1 Sportscars', '2 Powerboats', '3 Formula One', '4 Turbo Wheels', '5 Four by Four', '6 Warriors', '7 Tanks', '8 Choppers', '9 Rufftrux']

function hueOf(v, max) {
  const h = (v / (max || 1)) * 300
  const c = 200, x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
  return [r + 30, g + 30, b + 30]
}

function sineCanvas() {
  const w = 256, h = 128
  const rgba = new Uint8ClampedArray(w * h * 4).fill(0)
  for (let i = 0; i < w * h; i++) rgba[i * 4 + 3] = 255
  for (let x = 0; x < 256; x++) {
    const y = Math.round(h / 2 - (SINE8[x] / 127) * (h / 2 - 2))
    for (let dy = -1; dy <= 1; dy++) {
      const yy = Math.min(h - 1, Math.max(0, y + dy))
      const i = (yy * w + x) * 4
      rgba[i] = 120; rgba[i + 1] = 220; rgba[i + 2] = 255
    }
  }
  const c = el('canvas', { class: 'pixels' })
  paint(c, w, h, rgba, { zoom: 1 })
  return c
}

function contactCanvas() {
  const side = CONTACT_TABLE_SIDE
  const rgba = new Uint8ClampedArray(side * side * 4)
  for (let i = 0; i < side * side; i++) {
    const v = CONTACT_TABLE[i]
    const [r, g, b] = v === 0 ? [40, 40, 40] : hueOf(v, 255)
    rgba[i * 4] = r; rgba[i * 4 + 1] = g; rgba[i * 4 + 2] = b; rgba[i * 4 + 3] = 255
  }
  const c = el('canvas', { class: 'pixels' })
  paint(c, side, side, rgba, { zoom: 12 })
  return c
}

export function engineTablesView(container) {
  container.append(el('p', { class: 'muted' }, 'Constants read out of MICROU.EXE\'s data segment (docs/engine.md §8), verified byte-for-byte by `npm run tables` and `npm run car`. Everything here is [STATIC].'))

  container.append(el('h3', {}, 'Sine table, DS:10A0 (256 signed bytes, round(127·sin(2πi/256)))'), sineCanvas())

  container.append(el('h3', {}, 'Car-car contact angle table, DS:17DA (17×17, centre = dx=dy=0)'),
    el('p', { class: 'muted small' }, 'hue = the A→B heading byte at that (dx,dy); dark grey = 0 = no contact.'),
    contactCanvas())

  container.append(el('h3', {}, 'CarTypeInfo, DS:252A (9 rounds × 9 words, InitRaceCarsFromTables 3c09)'))
  const carTypeTable = el('table', { class: 'mono small' },
    el('tr', {}, el('th', {}, 'round'), ...CAR_TYPE_COLUMNS.map((c) => el('th', {}, c))),
    ...CAR_TYPE_INFO.map((row, i) => el('tr', {}, el('td', {}, ROUND_NAMES[i]), ...row.map((v) => el('td', {}, '0x' + v.toString(16))))))
  container.append(carTypeTable)

  container.append(el('h3', {}, 'Tuning tables'))
  container.append(el('pre', { class: 'mono small' },
    `KidModifier (DS:23DC, 12w, identity):        ${KID_MODIFIER.join(', ')}\n` +
    `RuffTruckTimes (DS:2419, 7w) -> [26C8]:      ${RUFF_TRUCK_TIMES.join(', ')}\n` +
    `GripAdjust (DS:24E0):                        ${GRIP_ADJUST}\n` +
    `DecayBounce (DS:24FF, 10w, by round, [0] unused): ${DECAY_BOUNCE.join(', ')}\n` +
    `DroneMaxVelHandicap (DS:2462, 26w, by [28C1]):\n  ${DRONE_MAX_VEL_HANDICAP.join(', ')}`))

  container.append(el('h3', {}, 'Per-round terrain dispatch, DS:26D7-278F (docs/engine.md §5)'))
  const terrainPre = el('pre', { class: 'mono small' })
  terrainPre.textContent = TERRAIN_ROWS.map((row, i) =>
    `${ROUND_NAMES[i]}:\n` + row.map((addr, idx) => `  [${idx}] 0x${addr.toString(16)}  ${TERRAIN_HANDLER_NAMES[addr] ?? ''}`).join('\n')
  ).join('\n')
  container.append(terrainPre)

  container.append(el('h3', {}, 'Car state dispatch, DS:278F (17 words, docs/engine.md §4)'))
  const statePre = el('pre', { class: 'mono small' })
  statePre.textContent = STATE_TABLE.map((addr, state) => `state 0x${state.toString(16).padStart(2, '0')}  0x${addr.toString(16)}  ${STATE_HANDLER_NAMES[addr] ?? ''}`).join('\n')
  container.append(statePre)

  container.append(el('h3', {}, 'Camera target table, DS:27B7 (5 words, docs/engine.md §3)'))
  container.append(el('pre', { class: 'mono small' },
    CAR_CAMERA_TABLE.map((v, i) => i === 0 ? `[0] 0x${v.toString(16)}  sentinel -> two-car midpoint branch` : `[${i}] 0x${v.toString(16)}  car ${i - 1}'s CarRecord base`).join('\n') +
    '\n(selected by DS:27B5, a runtime index, not table data)'))

  container.append(el('p', { class: 'muted small' },
    'Checkpoint lists (DS:2035) are plotted per race on that race\'s own .MAP view (open a ROUNDnm.MAP file) rather than here, since they need that race\'s progress plane.'))
}
