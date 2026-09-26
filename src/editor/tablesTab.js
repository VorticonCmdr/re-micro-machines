// Table editors: the race's brake stream (ROUNDnmB.BRK), the start points (STRT_POS.BIN) and the
// cheat spots (CHEATS.BIN).

import { el, clear } from '../ui/dom.js'
import { paths, RACES, LIMITS, ROUNDS } from './model.js'
import { CHEAT_TYPES } from './validate.js'

/** What a drone does with brake byte b (1000:5495; docs/track-layout.md). */
function brkMeaning(b) {
  const t = b >> 4, n = b & 15
  if (t === 0) return 'accelerate (n unread)'
  if (t === 1) return `brake above speed ${896 + 128 * n}`
  if (t === 2) return `raise the target speed to at least ${1536 + 64 * n}`
  return `brake above ${896 + 128 * n}, but only while steering (else accelerate)` // types 3-15, ai.js
}

export function brkTab(root, app) {
  const { model, round, race } = app
  const scroll = el('div', { class: 'ed-scroll' })
  root.append(scroll)
  const p = paths.brk(round, race)
  function render() {
    clear(scroll)
    const brk = model.bytes(p)
    if (!brk) { scroll.append(el('p', { class: 'muted' }, `Round ${round} has no brake stream: RUFFTRUX races have no drones.`)); return }
    const map = model.bytes(paths.map(round, race))
    const cells = new Uint16Array(256)
    for (let i = 0; i < 1024; i++) cells[map[1024 + i]]++
    let maxP = 0; for (let v = 0; v < 256; v++) if (cells[v]) maxP = v
    const set = (bytes) => model.setBrk(round, race, bytes)
    const chart = el('canvas', { class: 'ed-brk-chart', width: Math.max(512, (maxP + 1) * 4), height: 90 })
    const cg = chart.getContext('2d')
    for (let v = 0; v <= Math.max(maxP, brk.length - 1); v++) {
      const b = v < brk.length ? brk[v] : null, t = b == null ? -1 : b >> 4
      cg.fillStyle = b == null ? '#555' : t === 1 ? '#f7768e' : t === 2 ? '#9ece6a' : t === 0 ? '#3b3f58' : '#e0af68'
      const h = b == null ? 80 : t === 0 ? 10 : 20 + (b & 15) * 4
      cg.fillRect(v * 4, 85 - h, 3, h)
      if (cells[v]) { cg.fillStyle = '#7aa2f7'; cg.fillRect(v * 4, 86, 3, 4) }
    }
    scroll.append(
      el('h3', {}, `${p.slice(6)}: ${brk.length} bytes (the game reads 0x${LIMITS.brk.toString(16)}); progress on the map reaches ${maxP}`),
      el('p', { class: 'ed-note' }, 'A drone reads the byte at its cell\'s progress value (1000:5495). Red: brake, green: raise the target speed, dark: accelerate, grey: past the end of the file (an earlier race\'s bytes, docs/engine.md §9ad). Blue ticks: progress values that some MAP cell has.'),
      chart,
      el('div', { class: 'ed-row' },
        el('button', { type: 'button', onclick: () => set([...brk, 0]) }, '+ Append 0x00'),
        el('button', { type: 'button', disabled: brk.length > maxP, onclick: () => set([...brk, ...new Array(maxP + 1 - brk.length).fill(0)]) }, `Extend to cover progress ${maxP}`),
        el('button', { type: 'button', disabled: !brk.length, onclick: () => set(brk.slice(0, -1)) }, '− Remove last')))
    const rows = []
    for (let i = 0; i < brk.length; i++) {
      const b = brk[i]
      rows.push(el('tr', { class: model.original(p)?.[i] !== b ? 'dirty' : '' },
        el('td', {}, String(i)),
        el('td', {}, String(cells[i] || '')),
        el('td', {}, el('input', { type: 'text', value: b.toString(16).padStart(2, '0'), size: 3, onchange: (e) => { const v = parseInt(e.target.value, 16); if (v >= 0 && v < 256) model.write(p, i, [v], 'edit brake byte'); else render() } })),
        el('td', {}, el('select', { onchange: (e) => model.write(p, i, [((e.target.value | 0) << 4) | (b & 15)], 'edit brake byte') },
          Array.from({ length: 16 }, (_, k) => k).map((t) => el('option', { value: t, selected: b >> 4 === t }, `${t}`)))),
        el('td', {}, el('input', { type: 'number', min: 0, max: 15, value: b & 15, onchange: (e) => model.write(p, i, [(b & 0xf0) | ((e.target.value | 0) & 15)], 'edit brake byte') })),
        el('td', { class: 'muted' }, brkMeaning(b)),
        el('td', {}, el('button', { type: 'button', title: 'insert a byte before', onclick: () => set([...brk.slice(0, i), b, ...brk.slice(i)]) }, '+'),
          el('button', { type: 'button', title: 'delete', onclick: () => set([...brk.slice(0, i), ...brk.slice(i + 1)]) }, '−'))))
    }
    scroll.append(el('table', { class: 'ed-table' }, el('thead', {}, el('tr', {}, ['progress', 'cells', 'hex', 'type', 'n', 'meaning', ''].map((h) => el('th', {}, h)))), el('tbody', {}, rows)))
  }
  render()
  const off = model.onChange((keys) => { if (keys.has(p) || keys.has(paths.map(round, race))) render() })
  return { destroy: off }
}

export function globalsTab(root, app) {
  const { model } = app
  const scroll = el('div', { class: 'ed-scroll' })
  root.append(scroll)
  function render() {
    clear(scroll)
    const strtRows = []
    for (const r of ROUNDS) {
      for (let race = 1; race <= 4; race++) {
        const s = model.strt(r, race)
        const real = race <= RACES[r]
        const cur = r === app.round && race === app.race
        const num = (k) => el('input', { type: 'number', min: 0, max: 65535, value: s[k], onchange: (e) => { const v = model.strt(r, race); v[k] = Math.max(0, Math.min(65535, e.target.value | 0)); model.setStrt(r, race, v.x, v.y) } })
        strtRows.push(el('tr', { class: cur ? 'current' : '' }, el('td', {}, `${r}${race}`), el('td', {}, num('x')), el('td', {}, num('y')), el('td', { class: 'muted' }, real ? (cur ? 'current race' : '') : 'no such race (slot kept, never read)')))
      }
    }
    const cheatRows = []
    for (let i = 0; i < model.cheatCount(); i++) {
      const c = model.cheat(i)
      const num = (k, max = 65535) => el('input', { type: 'number', min: 0, max, value: c[k], onchange: (e) => model.setCheat(i, { ...model.cheat(i), [k]: Math.max(0, Math.min(max, e.target.value | 0)) }) })
      cheatRows.push(el('tr', { class: c.round === app.round && c.race === app.race ? 'current' : '' },
        el('td', {}, String(i)), el('td', {}, num('round', 9)), el('td', {}, num('race', 4)), el('td', {}, num('x')), el('td', {}, num('y')),
        el('td', {}, el('select', { onchange: (e) => model.setCheat(i, { ...model.cheat(i), type: e.target.value | 0 }) }, CHEAT_TYPES.map((t, k) => el('option', { value: k, selected: c.type === k }, `${k} ${t}`)).concat(c.type > 9 ? [el('option', { value: c.type, selected: true }, `${c.type} ?`)] : []))),
        el('td', {}, num('param')),
        el('td', {}, el('button', { type: 'button', onclick: () => app.showOnMap(c.round, c.race, c.x, c.y, i) }, 'show'))))
    }
    scroll.append(el('div', { class: 'ed-panes' },
      el('div', { class: 'ed-pane' },
        el('h3', {}, 'STRT_POS.BIN: start points (world px)'),
        el('p', { class: 'ed-note' }, 'Car 0 spawns at (x+20, y−10); the others at +26 on either axis (InitRaceCarsFromTables 1000:3d9f).'),
        el('table', { class: 'ed-table' }, el('thead', {}, el('tr', {}, ['race', 'x', 'y', ''].map((h) => el('th', {}, h)))), el('tbody', {}, strtRows))),
      el('div', { class: 'ed-pane' },
        el('h3', {}, 'CHEATS.BIN: 30 cheat spots'),
        el('p', { class: 'ed-note' }, 'Checked when the game is paused: the camera car within 24 px of (x, y) in that round and race gets the effect (docs/engine.md §6). Param: the grip/slew/acceleration/max-speed value for types 2, 3, 4 and 8.'),
        el('table', { class: 'ed-table' }, el('thead', {}, el('tr', {}, ['#', 'round', 'race', 'x', 'y', 'type', 'param', ''].map((h) => el('th', {}, h)))), el('tbody', {}, cheatRows)))))
  }
  render()
  const off = model.onChange((keys) => { if (keys.has(paths.strt()) || keys.has(paths.cheats())) render() })
  return { destroy: off }
}
