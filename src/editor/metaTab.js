// The Meta-tiles tab: one 96×96 meta-tile's four per-round records, edited in place --
//   graphics  (CT: 6×6 words naming bank tiles)
//   collision (COL: 12×12 bits of 8×8 px)
//   flow      (DIR: 6×6 bytes of 16×16 px, low nibble = direction 0-15, high nibble = grade)
//   LEV       (1 byte: respawn-memo bit 7, heading row bits 6-5, nudge bits 4-2, unread bits 1-0)
// These files are shared by every race of the round: the header says which races use the
// meta-tile, and "duplicate" makes a copy to edit for one race only.

import { el, clear } from '../ui/dom.js'
import { paths, LIMITS } from './model.js'
import { arrow, hue } from './render.js'
import { metaPalette } from './mapTab.js'
import { DRONE_HEADING_TABLE } from '../data/engine-tables.js'
import { LEV_HEADING_TABLE, LEV_NUDGE_TABLE } from '../formats/levbrk.js'
import { OVERLAY_RANGES } from '../formats/race.js'

const SCALE = 4 // 384 px
const MODES = [['gfx', 'Graphics (CT)'], ['col', 'Collision (COL)'], ['dir', 'Flow (DIR)'], ['grade', 'Grade (DIR)']]

export function metaTab(root, app) {
  const { model, renderer, round } = app
  const st = app.metaState ||= { mode: 'gfx', dir: 0, grade: 0, solid: 1 }
  const scroll = el('div', { class: 'ed-scroll' })
  root.append(scroll)
  const big = el('canvas', { class: 'ed-big', width: 96 * SCALE, height: 96 * SCALE })
  const g = big.getContext('2d')
  const bankWrap = el('div', { class: 'ed-sheet-wrap', style: { maxHeight: '520px' } })
  const bank = el('canvas', { class: 'ed-sheet' })
  bankWrap.append(bank)
  const left = el('div', { class: 'ed-pane', style: { width: '330px' } })
  const center = el('div', { class: 'ed-pane' })
  const right = el('div', { class: 'ed-pane' })
  scroll.append(el('div', { class: 'ed-panes' }, left, center, right))

  const meta = () => Math.min(app.sel.meta, model.metaCount(round) - 1)

  function drawBig() {
    const m = meta()
    g.imageSmoothingEnabled = false
    g.drawImage(renderer.metaCanvas(round, m), 0, 0, 96 * SCALE, 96 * SCALE)
    if (st.mode === 'gfx') {
      g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 1
      g.font = '11px ui-monospace, Menlo, monospace'
      for (let y = 0; y < 6; y++) {
        for (let x = 0; x < 6; x++) {
          const s = 16 * SCALE
          g.strokeRect(x * s + 0.5, y * s + 0.5, s, s)
          const w = model.ctWord(round, m, x, y)
          g.fillStyle = '#000a'; g.fillRect(x * s + 1, y * s + 1, 30, 13)
          g.fillStyle = w >= model.bankTileCount(round) ? '#f77' : '#fff'
          g.fillText(String(w), x * s + 3, y * s + 11)
        }
      }
    }
    if (st.mode === 'col') {
      const s = 8 * SCALE
      for (let y = 0; y < 12; y++) {
        for (let x = 0; x < 12; x++) {
          if (model.colBit(round, m, x, y)) { g.fillStyle = 'rgba(255,40,60,.5)'; g.fillRect(x * s, y * s, s, s) }
          g.strokeStyle = 'rgba(255,255,255,.2)'; g.strokeRect(x * s + 0.5, y * s + 0.5, s, s)
        }
      }
    }
    if (st.mode === 'dir' || st.mode === 'grade') {
      const s = 16 * SCALE
      for (let y = 0; y < 6; y++) {
        for (let x = 0; x < 6; x++) {
          const d = model.dirByte(round, m, x, y)
          if (st.mode === 'grade') {
            if (d >> 4) { g.fillStyle = hue(d >> 4, 15, 0.5); g.fillRect(x * s, y * s, s, s) }
            g.fillStyle = '#fff'; g.font = 'bold 16px system-ui'; g.fillText(String(d >> 4), x * s + s / 2 - 5, y * s + s / 2 + 6)
          } else {
            g.fillStyle = '#0006'; g.fillRect(x * s, y * s, s, s)
            g.strokeStyle = '#fff'; g.lineWidth = 3
            arrow(g, x * s + s / 2, y * s + s / 2, DRONE_HEADING_TABLE[d & (round === 2 ? 7 : 15)], s * 0.6)
            g.fillStyle = '#fff'; g.font = '11px ui-monospace'; g.fillText(String(d & 15), x * s + 3, y * s + 12)
          }
          g.strokeStyle = 'rgba(255,255,255,.3)'; g.lineWidth = 1; g.strokeRect(x * s + 0.5, y * s + 0.5, s, s)
        }
      }
      if (model.dirMissing(round, m)) { g.fillStyle = '#f77'; g.font = '13px system-ui'; g.fillText('DIR file ends inside this meta-tile: the game reads leftover bytes', 6, 96 * SCALE - 8) }
    }
  }

  // Painting the big canvas.
  let stroke = null
  const at = (e) => { const r = big.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width * 96, y: (e.clientY - r.top) / r.height * 96 } }
  function paint(p, first, button) {
    const m = meta()
    if (p.x < 0 || p.y < 0 || p.x >= 96 || p.y >= 96) return
    if (st.mode === 'gfx') {
      const x = (p.x / 16) | 0, y = (p.y / 16) | 0
      if (button === 2) { app.sel.tile = model.ctWord(round, m, x, y); drawBank(); renderRight(); return }
      model.setCtWord(round, m, x, y, app.sel.tile)
    } else if (st.mode === 'col') {
      const x = (p.x / 8) | 0, y = (p.y / 8) | 0
      if (first) stroke.value = button === 2 ? 0 : st.solid
      model.setColBit(round, m, x, y, stroke.value)
    } else {
      const x = (p.x / 16) | 0, y = (p.y / 16) | 0
      const d = model.dirByte(round, m, x, y)
      if (button === 2) { if (st.mode === 'dir') st.dir = d & 15; else st.grade = d >> 4; renderRight(); return }
      model.setDirByte(round, m, x, y, st.mode === 'dir' ? (d & 0xf0) | st.dir : (st.grade << 4) | (d & 15))
    }
  }
  big.addEventListener('contextmenu', (e) => e.preventDefault())
  big.addEventListener('mousedown', (e) => { stroke = { button: e.button }; model.begin(`edit meta-tile ${meta()}`); paint(at(e), true, e.button) })
  const onMove = (e) => { if (stroke && st.mode !== 'gfx') paint(at(e), false, stroke.button) }
  const onUp = () => { if (stroke) { stroke = null; model.commit() } }
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)

  // The bank sheet: click to choose the tile the graphics mode paints.
  const PER = 12, TS = 32
  function drawBank() {
    const n = model.bankTileCount(round)
    bank.width = PER * TS; bank.height = Math.ceil(n / PER) * TS
    const bg = bank.getContext('2d')
    bg.imageSmoothingEnabled = false
    const tmp = document.createElement('canvas'); tmp.width = tmp.height = 16
    const tg = tmp.getContext('2d')
    for (let t = 0; t < n; t++) {
      tg.putImageData(renderer.tileImage(round, t), 0, 0)
      bg.drawImage(tmp, (t % PER) * TS, ((t / PER) | 0) * TS, TS, TS)
    }
    const t = app.sel.tile
    bg.strokeStyle = '#fff'; bg.lineWidth = 2; bg.strokeRect((t % PER) * TS + 1, ((t / PER) | 0) * TS + 1, TS - 2, TS - 2)
  }
  bank.addEventListener('click', (e) => {
    const r = bank.getBoundingClientRect()
    const t = ((e.clientY - r.top) / TS | 0) * PER + ((e.clientX - r.left) / TS | 0)
    if (t < model.bankTileCount(round)) { app.sel.tile = t; drawBank(); renderRight() }
  })

  function renderLeft() {
    clear(left)
    const n = model.metaCount(round)
    const add = (from) => { try { app.sel.meta = model.addMetaTile(round, from); renderAll() } catch (err) { alertNote(err.message) } }
    left.append(el('h3', {}, `Meta-tiles (${n} of ${LIMITS.metaTiles})`),
      el('div', { class: 'ed-row' },
        el('button', { type: 'button', disabled: n >= 64, onclick: () => add(meta()) }, `+ Duplicate ${meta()}`),
        el('button', { type: 'button', disabled: n >= 64, onclick: () => add(null) }, '+ Blank')),
      n >= 64 ? el('p', { class: 'ed-note' }, 'Full: a MAP byte indexes 64 meta-tiles (bits 0-5), and the COL/DIR buffers hold exactly 64.') : '',
      noteEl,
      metaPalette(app, () => renderAll()))
  }
  const noteEl = el('p', { class: 'ed-note bad' })
  const alertNote = (msg) => { noteEl.textContent = msg }

  function renderCenter() {
    clear(center)
    const m = meta()
    const usage = model.metaUsage(round)[m]
    center.append(
      el('h3', {}, `Meta-tile ${m}`),
      el('p', { class: 'ed-note' }, usage.length ? `Used in ${usage.map((u) => `race ${round}${u.race} (${u.cells} cells)`).join(', ')}. CT, COL, DIR and LEV are shared by the whole round: an edit here changes every one of those cells.` : 'Not used by any race of this round yet.'),
      el('div', { class: 'ed-row' }, el('span', { class: 'ed-seg' }, MODES.map(([id, label]) => el('button', { type: 'button', class: st.mode === id ? 'active' : '', onclick: () => { st.mode = id; renderCenter(); renderRight() } }, label)))),
      big,
      el('p', { class: 'ed-note' }, {
        gfx: 'Click a 16×16 cell to put the selected bank tile there; right-click to pick the cell\'s tile.',
        col: 'Paint solid cells with the left button, free cells with the right (8×8 px each).',
        dir: 'Click a 16×16 block to set its direction; right-click picks. The arrow is the raw heading (DS:18FB); on the map, attribute bits and the LEV row can mirror or reverse it.',
        grade: 'Click a block to set its terrain grade (the DIR high nibble); right-click picks. Grade bit 0 marks a ramp (1000:687c).',
      }[st.mode]),
      levEditor(m))
    drawBig()
  }

  function levEditor(m) {
    const lv = model.levByte(round, m)
    const set = (v) => model.setLevByte(round, m, v)
    const past = model.bytes(paths.lev(round)).length <= m
    return el('div', {},
      el('h3', {}, `LEV byte 0x${lv.toString(16).padStart(2, '0')}${past ? ' (past the file: the game reads a leftover byte)' : ''}`),
      el('div', { class: 'ed-row' }, el('label', {}, el('input', { type: 'checkbox', checked: !!(lv & 0x80), onchange: (e) => set((lv & 0x7f) | (e.target.checked ? 0x80 : 0)) }), ' bit 7: never remember as a respawn point (1000:5de6)')),
      el('div', { class: 'ed-row' }, 'Respawn heading / flow row (bits 6-5)', el('select', { onchange: (e) => set((lv & 0x9f) | ((e.target.value | 0) << 5)) },
        LEV_HEADING_TABLE.map((h, k) => el('option', { value: k, selected: ((lv >> 5) & 3) === k }, `${k}: heading 0x${h.toString(16)}`)))),
      el('div', { class: 'ed-row' }, 'Respawn nudge (bits 4-2)', el('select', { onchange: (e) => set((lv & 0xe3) | ((e.target.value | 0) << 2)) },
        LEV_NUDGE_TABLE.map(([dx, dy], k) => el('option', { value: k, selected: ((lv >> 2) & 7) === k }, `${k}: (${dx}, ${dy})`)))),
      el('div', { class: 'ed-row' }, 'Bits 1-0 (read by nothing)', el('input', { type: 'number', min: 0, max: 3, value: lv & 3, onchange: (e) => set((lv & 0xfc) | ((e.target.value | 0) & 3)) })))
  }

  function renderRight() {
    clear(right)
    if (st.mode === 'gfx') {
      const t = app.sel.tile, range = OVERLAY_RANGES[round]
      right.append(el('h3', {}, `Bank tile ${t} of ${model.bankTileCount(round)}`),
        el('div', { class: 'ed-row' }, 'Tile', el('input', { type: 'number', min: 0, max: model.bankTileCount(round) - 1, value: t, onchange: (e) => { app.sel.tile = Math.max(0, Math.min(model.bankTileCount(round) - 1, e.target.value | 0)); drawBank(); renderRight() } }),
          el('button', { type: 'button', onclick: () => app.showTab('tiles') }, 'Edit pixels…')),
        range ? el('p', { class: 'ed-note' }, `Round ${round}: CT words ${range[0]}-${range[1]} are overlay tiles; the game also draws tile+12 over the cars (1000:3994, 9214).`) : '',
        bankWrap)
      drawBank()
    } else if (st.mode === 'col') {
      right.append(el('h3', {}, 'Left button paints'), el('span', { class: 'ed-seg' }, [[1, 'Solid'], [0, 'Free']].map(([v, l]) => el('button', { type: 'button', class: st.solid === v ? 'active' : '', onclick: () => { st.solid = v; renderRight() } }, l))))
    } else if (st.mode === 'dir') {
      const pick = el('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(4, 56px)', gap: '4px' } })
      for (let d = 0; d < 16; d++) {
        const c = el('canvas', { width: 56, height: 56, style: { cursor: 'pointer', outline: st.dir === d ? '2px solid #fff' : '1px solid #444' }, title: `direction ${d} → heading 0x${DRONE_HEADING_TABLE[d].toString(16)}`, onclick: () => { st.dir = d; renderRight() } })
        const cg = c.getContext('2d'); cg.fillStyle = '#1f2030'; cg.fillRect(0, 0, 56, 56); cg.strokeStyle = round === 2 && d > 7 ? '#666' : '#fff'; cg.lineWidth = 2
        arrow(cg, 28, 30, DRONE_HEADING_TABLE[d & (round === 2 ? 7 : 15)], 34)
        cg.fillStyle = '#aaa'; cg.font = '10px ui-monospace'; cg.fillText(String(d), 3, 11)
        pick.append(c)
      }
      right.append(el('h3', {}, 'Direction'), pick, round === 2 ? el('p', { class: 'ed-note' }, 'Round 2 (POWERBOATS) reads only the low 3 bits (AND 7, 1000:624C).') : '')
    } else {
      right.append(el('h3', {}, 'Grade'), el('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(4, 48px)', gap: '4px' } },
        Array.from({ length: 16 }, (_, v) => el('button', { type: 'button', style: { background: v ? hue(v, 15, 0.6) : '#333', color: '#fff', height: '32px', outline: st.grade === v ? '2px solid #fff' : '' }, onclick: () => { st.grade = v; renderRight() } }, String(v)))),
      el('p', { class: 'ed-note' }, 'The grade is a terrain class whose effect depends on the vehicle (docs/track-layout.md); copy it from similar ground.'))
    }
  }

  function renderAll() { renderLeft(); renderCenter(); renderRight() }
  renderAll()
  const off = model.onChange((keys, live) => {
    const mine = [...keys].some((k) => new RegExp(`ROUND${round}(BR\\.(CT|LEV|PR\\d)|\\.(COL|DIR|PAL))$`).test(k))
    if (!mine) return
    drawBig()
    if (!live) { renderLeft(); if ([...keys].some((k) => /LEV$/.test(k))) renderCenter(); if (st.mode === 'gfx' && [...keys].some((k) => /PR\d|PAL/.test(k))) drawBank() }
  })
  return { destroy() { off(); window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) } }
}
