// The Map tab: the race's 32×32 MAP (meta-tile index, attribute bits, progress plane) drawn from
// the meta-tile bitmaps, with overlays for the collision mask, the DIR flow field (as the car
// reads it: the attribute's bit 1 remaps it through the tile's LEV row, bit 0 reverses it --
// terrain.js h6231, ai.js), the progress plane, the EXE's checkpoint bands, the brake stream,
// the LEV fields, the start grid and the cheat spots. Tools paint the MAP bytes and move the
// STRT_POS/CHEATS points.

import { el, clear } from '../ui/dom.js'
import { paths, RACES } from './model.js'
import { arrow, hue } from './render.js'
import { CHEAT_TYPES } from './validate.js'
import { checkpointList, DRONE_HEADING_TABLE, DRONE_DIR_REMAP_TABLE } from '../data/engine-tables.js'
import { LEV_HEADING_TABLE, LEV_NUDGE_TABLE } from '../formats/levbrk.js'
import { spawnCars } from '../engine/race.js'
import { parseStrtPos } from '../formats/globaldata.js'

const ZOOMS = [0.125, 0.25, 0.5, 1, 1.5, 2, 3, 4]
const TOOLS = [
  ['tile', 'Meta-tile', 'Paint the selected meta-tile (keeps the attribute bits)'],
  ['tilefill', 'Tile fill', 'Flood-fill a same-meta-tile area'],
  ['attr', 'Attribute', 'Paint attribute bits 6-7'],
  ['prog', 'Progress', 'Paint a progress value'],
  ['progfill', 'Prog. fill', 'Flood-fill a same-progress area'],
  ['progpath', 'Prog. path', 'Drag along the track: each new cell gets the next value'],
  ['pick', 'Pick', 'Take a cell\'s meta-tile, attribute and progress (Alt+click in any tool)'],
  ['start', 'Start', 'Place this race\'s start point (STRT_POS.BIN)'],
  ['cheat', 'Cheat spot', 'Select and drag this race\'s cheat spots (CHEATS.BIN)'],
]
const OVERLAYS = [
  ['grid', 'Grid'], ['col', 'Collision'], ['dir', 'Flow field'], ['grade', 'Terrain grade'],
  ['prog', 'Progress'], ['bands', 'Checkpoints'], ['brk', 'Brake stream'], ['attr', 'Attributes'],
  ['lev', 'LEV fields'], ['start', 'Start grid'], ['cheats', 'Cheat spots'],
]

/** The heading a car or drone on this DIR byte actually follows (terrain.js h6231 / ai.js). */
export function effectiveHeading(round, dirByte, attr, levByte) {
  let idx = dirByte & (round === 2 ? 7 : 15)
  if (attr & 2) idx = DRONE_DIR_REMAP_TABLE[(levByte >> 5) & 3][idx]
  let h = DRONE_HEADING_TABLE[idx]
  if (attr & 1) h ^= 0x80
  return h
}

export function mapTab(root, app) {
  const { model, renderer } = app
  const st = app.mapState ||= {
    z: 0.25, ox: 0, oy: 0, tool: 'tile', size: 1, attr: 0, prog: 1, step: 1,
    overlays: { grid: true, col: false, dir: false, grade: false, prog: false, bands: false, brk: false, attr: false, lev: false, start: true, cheats: true },
  }
  const round = app.round, race = app.race
  const mapPath = paths.map(round, race)

  const viewport = el('div', { class: 'ed-viewport' })
  const canvas = el('canvas')
  const hud = el('div', { class: 'ed-hud' }, '')
  viewport.append(canvas, hud)
  const side = el('div', { class: 'ed-side' })
  root.append(viewport, side)
  const g = canvas.getContext('2d')

  let W = 0, H = 0, hover = null, drag = null, spaceDown = false
  const dpr = () => window.devicePixelRatio || 1
  const resize = () => {
    const r = viewport.getBoundingClientRect()
    W = r.width; H = r.height
    canvas.width = Math.max(1, Math.round(W * dpr())); canvas.height = Math.max(1, Math.round(H * dpr()))
    canvas.style.width = `${W}px`; canvas.style.height = `${H}px`
    clampView(); redraw()
  }
  const ro = new ResizeObserver(resize)
  ro.observe(viewport)

  const clampView = () => {
    const vw = W / st.z, vh = H / st.z
    st.ox = vw >= 3072 ? (3072 - vw) / 2 : Math.max(0, Math.min(3072 - vw, st.ox))
    st.oy = vh >= 3072 ? (3072 - vh) / 2 : Math.max(0, Math.min(3072 - vh, st.oy))
  }
  const toWorld = (e) => {
    const r = canvas.getBoundingClientRect()
    return { x: st.ox + (e.clientX - r.left) / st.z, y: st.oy + (e.clientY - r.top) / st.z }
  }
  const cellAt = (w) => (w.x < 0 || w.y < 0 || w.x >= 3072 || w.y >= 3072 ? null : { c: (w.x / 96) | 0, r: (w.y / 96) | 0 })

  // ---- drawing --------------------------------------------------------------------------------
  let pending = false
  const redraw = () => { if (!pending) { pending = true; Promise.resolve().then(() => { pending = false; draw() }) } }

  function draw() {
    if (!canvas.isConnected) return
    const map = model.bytes(mapPath)
    const z = st.z
    g.setTransform(dpr(), 0, 0, dpr(), 0, 0)
    g.imageSmoothingEnabled = false
    g.fillStyle = '#0b0b10'; g.fillRect(0, 0, W, H)
    const cs = 96 * z
    const c0 = Math.max(0, Math.floor(st.ox / 96)), c1 = Math.min(31, Math.floor((st.ox + W / z) / 96))
    const r0 = Math.max(0, Math.floor(st.oy / 96)), r1 = Math.min(31, Math.floor((st.oy + H / z) / 96))
    const sx = (wx) => (wx - st.ox) * z, sy = (wy) => (wy - st.oy) * z
    const ov = st.overlays
    let maxP = 0
    for (let i = 0; i < 1024; i++) maxP = Math.max(maxP, map[1024 + i])
    const bands = checkpointList(round, race)
    const brk = model.bytes(paths.brk(round, race))
    const metaN = model.metaCount(round)

    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const i = r * 32 + c, meta = map[i] & 0x3f, attr = map[i] >> 6, p = map[1024 + i]
        const x = sx(c * 96), y = sy(r * 96)
        g.drawImage(renderer.metaCanvas(round, meta), x, y, cs, cs)
        if (ov.col && meta < metaN) g.drawImage(renderer.colCanvas(round, meta), x, y, cs, cs)
        if (ov.grade || ov.dir) {
          const lev = model.levByte(round, meta)
          const bs = cs / 6
          for (let by = 0; by < 6; by++) {
            for (let bx = 0; bx < 6; bx++) {
              const d = model.dirByte(round, meta, bx, by), grade = d >> 4
              if (ov.grade && grade) { g.fillStyle = hue(grade, 15, 0.45); g.fillRect(x + bx * bs, y + by * bs, bs, bs) }
              if (ov.dir && bs >= 7) {
                g.strokeStyle = grade & 1 ? '#ffd24a' : '#fff'
                g.lineWidth = bs >= 20 ? 1.5 : 1
                arrow(g, x + (bx + 0.5) * bs, y + (by + 0.5) * bs, effectiveHeading(round, d, attr, lev), bs * 0.7)
              }
            }
          }
        }
        if (ov.prog) { g.fillStyle = hue(p, maxP, 0.4); g.fillRect(x, y, cs, cs) }
        if (ov.bands) {
          const b = bands.findIndex((bd) => p >= bd.lo && p < bd.hi)
          g.fillStyle = b < 0 ? 'rgba(0,0,0,.45)' : hue(b, Math.max(1, bands.length - 1), 0.45)
          g.fillRect(x, y, cs, cs)
        }
        if (ov.brk && brk) {
          const v = p < brk.length ? brk[p] : null, t = v == null ? -1 : v >> 4
          g.fillStyle = v == null ? 'rgba(128,128,128,.5)' : t === 1 ? `rgba(255,60,60,${0.25 + (v & 15) / 30})` : t === 2 ? `rgba(80,220,120,${0.25 + (v & 15) / 30})` : t === 0 ? 'rgba(0,0,0,0)' : 'rgba(255,170,40,.45)'
          g.fillRect(x, y, cs, cs)
        }
        if (ov.lev && meta < metaN) {
          const lv = model.levByte(round, meta)
          if (lv & 0x80) { g.fillStyle = 'rgba(255,0,0,.18)'; g.fillRect(x, y, cs, cs) }
          if (cs >= 24) {
            g.strokeStyle = '#0ff'; g.lineWidth = 2
            arrow(g, x + cs / 2, y + cs / 2, LEV_HEADING_TABLE[(lv >> 5) & 3], cs * 0.4)
            const [ndx, ndy] = LEV_NUDGE_TABLE[(lv >> 2) & 7]
            g.fillStyle = '#0ff'; g.beginPath(); g.arc(x + cs / 2 + ndx * z, y + cs / 2 + ndy * z, Math.max(2, cs / 24), 0, 7); g.fill()
          }
        }
        if (ov.attr && attr) {
          g.strokeStyle = ['', '#f7768e', '#7aa2f7', '#e0af68'][attr]; g.lineWidth = 2
          g.strokeRect(x + 2, y + 2, cs - 4, cs - 4)
        }
        if (cs >= 22 && (ov.prog || ov.bands || ov.brk || ov.attr)) {
          g.font = `${Math.min(14, Math.max(9, cs / 6))}px ui-monospace, Menlo, monospace`
          g.fillStyle = '#fff'; g.strokeStyle = '#000'; g.lineWidth = 3
          const parts = []
          if (ov.prog || ov.bands) parts.push(String(p))
          if (ov.brk && brk && p < brk.length) parts.push(`b${brk[p].toString(16).padStart(2, '0')}`)
          if (ov.attr && attr) parts.push(`a${attr}`)
          const t = parts.join(' ')
          g.strokeText(t, x + 3, y + Math.min(14, Math.max(9, cs / 6)) + 1); g.fillText(t, x + 3, y + Math.min(14, Math.max(9, cs / 6)) + 1)
        }
        if (ov.grid) { g.strokeStyle = 'rgba(255,255,255,.18)'; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, cs, cs) }
      }
    }
    if (ov.cheats) {
      for (let i = 0; i < model.cheatCount(); i++) {
        const ch = model.cheat(i)
        if (ch.round !== round || ch.race !== race) continue
        const sel = app.sel.cheat === i
        g.strokeStyle = sel ? '#fff' : '#e0af68'; g.lineWidth = sel ? 3 : 2
        g.strokeRect(sx(ch.x - 24), sy(ch.y - 24), 48 * z, 48 * z)
        g.font = '11px system-ui'; g.fillStyle = sel ? '#fff' : '#e0af68'
        g.fillText(`#${i} ${CHEAT_TYPES[ch.type] ?? ch.type}`, sx(ch.x - 24), sy(ch.y - 24) - 3)
      }
    }
    if (ov.start) {
      const s = model.strt(round, race)
      let cars = []
      try { cars = spawnCars(parseStrtPos(model.bytes(paths.strt())), round, race).filter((cr) => cr.present) } catch { /* bad file */ }
      cars.forEach((car, k) => {
        g.strokeStyle = ['#fff', '#7aa2f7', '#9ece6a', '#f7768e'][k]; g.lineWidth = 2
        g.strokeRect(sx(car.posX - 12), sy(car.posY - 12), 24 * z, 24 * z)
      })
      g.fillStyle = '#fff'; g.beginPath(); g.arc(sx(s.x), sy(s.y), 4, 0, 7); g.fill()
      g.font = '11px system-ui'; g.fillText('start', sx(s.x) + 6, sy(s.y) - 4)
    }
    if (hover?.cell && ['tile', 'attr', 'prog'].includes(st.tool)) {
      const h = (st.size - 1) >> 1
      g.strokeStyle = '#fff'; g.lineWidth = 2
      g.strokeRect(sx((hover.cell.c - h) * 96), sy((hover.cell.r - h) * 96), st.size * cs, st.size * cs)
    } else if (hover?.cell) {
      g.strokeStyle = '#fff8'; g.lineWidth = 1; g.strokeRect(sx(hover.cell.c * 96), sy(hover.cell.r * 96), cs, cs)
    }
  }

  // ---- the readout ----------------------------------------------------------------------------
  function readout(w) {
    const cell = cellAt(w)
    if (!cell) { hud.textContent = `zoom ${st.z}×`; return }
    const i = cell.r * 32 + cell.c, { tile, attr, progress } = model.mapCell(round, race, i)
    const subx = ((w.x % 96) / 8) | 0, suby = ((w.y % 96) / 8) | 0
    const bx = subx >> 1, by = suby >> 1
    const d = model.dirByte(round, tile, bx, by), lv = model.levByte(round, tile)
    const brk = model.bytes(paths.brk(round, race))
    const b = brk && progress < brk.length ? brk[progress] : null
    hud.textContent = `world (${w.x | 0}, ${w.y | 0})  cell (${cell.c}, ${cell.r}) = byte ${i}   zoom ${st.z}×\n` +
      `meta-tile ${tile}  attr ${attr}  progress ${progress}  brk ${b == null ? '—' : `0x${b.toString(16).padStart(2, '0')} (type ${b >> 4}, ${b & 15})`}\n` +
      `collision ${model.colBit(round, tile, subx, suby) ? 'SOLID' : 'free'}  DIR 0x${d.toString(16).padStart(2, '0')} grade ${d >> 4} dir ${d & 15} → heading 0x${effectiveHeading(round, d, attr, lv).toString(16)}\n` +
      `LEV 0x${lv.toString(16).padStart(2, '0')}: ${lv & 0x80 ? 'no respawn memo' : 'respawn ok'}, heading 0x${LEV_HEADING_TABLE[(lv >> 5) & 3].toString(16)}, nudge ${LEV_NUDGE_TABLE[(lv >> 2) & 7].join(',')}`
  }

  // ---- editing --------------------------------------------------------------------------------
  const footprint = (cell) => {
    const out = [], h = (st.size - 1) >> 1
    for (let dy = 0; dy < st.size; dy++) {
      for (let dx = 0; dx < st.size; dx++) {
        const c = cell.c - h + dx, r = cell.r - h + dy
        if (c >= 0 && r >= 0 && c < 32 && r < 32) out.push(r * 32 + c)
      }
    }
    return out
  }
  const flood = (start, keyOf, apply) => {
    const want = keyOf(start), seen = new Uint8Array(1024), q = [start]
    seen[start] = 1
    while (q.length) {
      const i = q.pop()
      apply(i)
      const c = i & 31, r = i >> 5
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nc = c + dc, nr = r + dr
        if (nc < 0 || nr < 0 || nc > 31 || nr > 31) continue
        const n = nr * 32 + nc
        if (!seen[n] && keyOf(n) === want) { seen[n] = 1; q.push(n) }
      }
    }
  }
  const pick = (cell) => {
    const { tile, attr, progress } = model.mapCell(round, race, cell.r * 32 + cell.c)
    app.sel.meta = tile; st.attr = attr; st.prog = progress
    renderSide()
  }

  function applyTool(w, first) {
    const cell = cellAt(w)
    if (st.tool === 'start') {
      model.setStrt(round, race, Math.max(0, Math.min(3071, Math.round(w.x))), Math.max(0, Math.min(3071, Math.round(w.y))))
      return
    }
    if (st.tool === 'cheat') {
      if (first) {
        let best = -1, bd = 1e9
        for (let i = 0; i < model.cheatCount(); i++) {
          const ch = model.cheat(i)
          if (ch.round !== round || ch.race !== race) continue
          const dd = Math.max(Math.abs(ch.x - w.x), Math.abs(ch.y - w.y))
          if (dd < 40 / Math.min(1, st.z) && dd < bd) { bd = dd; best = i }
        }
        app.sel.cheat = best
        drag.cheatOff = best < 0 ? null : { dx: model.cheat(best).x - w.x, dy: model.cheat(best).y - w.y }
        renderSide(); redraw()
        return
      }
      if (app.sel.cheat >= 0 && drag.cheatOff) {
        const ch = model.cheat(app.sel.cheat)
        model.setCheat(app.sel.cheat, { ...ch, x: Math.max(0, Math.min(3071, Math.round(w.x + drag.cheatOff.dx))), y: Math.max(0, Math.min(3071, Math.round(w.y + drag.cheatOff.dy))) })
      }
      return
    }
    if (!cell) return
    const idx = cell.r * 32 + cell.c
    if (drag && !first && drag.lastIdx === idx) return
    // A fast drag skips cells between mouse events: fill them in along the line (not for fills).
    if (drag && !first && drag.last && !/fill|pick/.test(st.tool)) {
      const steps = Math.max(Math.abs(cell.c - drag.last.c), Math.abs(cell.r - drag.last.r))
      const from = drag.last
      for (let k = 1; k < steps; k++) {
        const mid = { c: Math.round(from.c + (cell.c - from.c) * k / steps), r: Math.round(from.r + (cell.r - from.r) * k / steps) }
        drag.last = mid; drag.lastIdx = mid.r * 32 + mid.c
        paintCell(mid)
      }
    }
    if (drag) { drag.lastIdx = idx; drag.last = cell }
    paintCell(cell, first)
  }

  function paintCell(cell, first = false) {
    const idx = cell.r * 32 + cell.c
    const m = () => model.bytes(mapPath)
    switch (st.tool) {
      case 'tile': for (const i of footprint(cell)) model.setMapTile(round, race, i, app.sel.meta); break
      case 'attr': for (const i of footprint(cell)) model.setMapAttr(round, race, i, st.attr); break
      case 'prog': for (const i of footprint(cell)) model.setMapProgress(round, race, i, st.prog); break
      case 'tilefill': if (first) flood(idx, (i) => m()[i] & 0x3f, (i) => model.setMapTile(round, race, i, app.sel.meta)); break
      case 'progfill': if (first) flood(idx, (i) => m()[1024 + i], (i) => model.setMapProgress(round, race, i, st.prog)); break
      case 'progpath':
        if (!first) st.prog = (st.prog + st.step + 256) & 0xff
        model.setMapProgress(round, race, idx, st.prog)
        syncProgInput()
        break
      case 'pick': pick(cell); break
    }
  }

  canvas.addEventListener('contextmenu', (e) => e.preventDefault())
  canvas.addEventListener('mousedown', (e) => {
    const w = toWorld(e)
    if (e.button === 1 || e.button === 2 || spaceDown) {
      drag = { pan: true, x: e.clientX, y: e.clientY, ox: st.ox, oy: st.oy }
      return
    }
    if (e.button !== 0) return
    if (e.altKey) { const cell = cellAt(w); if (cell) pick(cell); return }
    drag = { pan: false, lastIdx: -1 }
    model.begin(TOOLS.find((t) => t[0] === st.tool)[1])
    applyTool(w, true)
  })
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
  function onMove(e) {
    if (!canvas.isConnected) return
    if (drag?.pan) {
      st.ox = drag.ox - (e.clientX - drag.x) / st.z; st.oy = drag.oy - (e.clientY - drag.y) / st.z
      clampView(); redraw(); return
    }
    const w = toWorld(e)
    const r = canvas.getBoundingClientRect()
    const inside = e.clientX >= r.left && e.clientX < r.right && e.clientY >= r.top && e.clientY < r.bottom
    const prevCell = hover?.cell
    hover = inside ? { w, cell: cellAt(w) } : null
    if (inside) readout(w)
    if (drag && !drag.pan) applyTool(w, false)
    if (prevCell?.c !== hover?.cell?.c || prevCell?.r !== hover?.cell?.r) redraw()
  }
  function onUp() {
    if (!drag) return
    const wasEdit = !drag.pan
    drag = null
    if (wasEdit) model.commit()
  }
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault()
    if (e.ctrlKey || e.metaKey) {
      const w = toWorld(e)
      const k = ZOOMS.indexOf(st.z)
      const nk = Math.max(0, Math.min(ZOOMS.length - 1, k + (e.deltaY < 0 ? 1 : -1)))
      setZoom(ZOOMS[nk], w, e)
    } else {
      st.ox += (e.shiftKey ? e.deltaY : e.deltaX) / st.z
      st.oy += (e.shiftKey ? 0 : e.deltaY) / st.z
      clampView(); redraw()
    }
  }, { passive: false })
  const setZoom = (z, anchor, e) => {
    if (anchor && e) {
      const r = canvas.getBoundingClientRect()
      st.z = z
      st.ox = anchor.x - (e.clientX - r.left) / z; st.oy = anchor.y - (e.clientY - r.top) / z
    } else {
      const cx = st.ox + W / st.z / 2, cy = st.oy + H / st.z / 2
      st.z = z; st.ox = cx - W / z / 2; st.oy = cy - H / z / 2
    }
    clampView(); redraw(); renderSide()
  }
  const onKey = (e) => {
    if (e.target.closest?.('input, select, textarea')) return
    if (e.code === 'Space') { spaceDown = e.type === 'keydown'; if (spaceDown) e.preventDefault() }
    if (e.type !== 'keydown' || e.metaKey || e.ctrlKey) return
    if (e.key === '+' || e.key === '=') setZoom(ZOOMS[Math.min(ZOOMS.length - 1, ZOOMS.indexOf(st.z) + 1)])
    if (e.key === '-') setZoom(ZOOMS[Math.max(0, ZOOMS.indexOf(st.z) - 1)])
    if (e.key === '[') { st.size = Math.max(1, st.size - 2); renderSide() }
    if (e.key === ']') { st.size = Math.min(7, st.size + 2); renderSide() }
  }
  window.addEventListener('keydown', onKey)
  window.addEventListener('keyup', onKey)

  // ---- the side panel -------------------------------------------------------------------------
  let progInput = null
  const syncProgInput = () => { if (progInput) progInput.value = st.prog }

  function renderSide() {
    clear(side)
    const tools = el('div', { class: 'ed-tools' }, TOOLS.map(([id, label, tip]) =>
      el('button', { type: 'button', title: tip, class: st.tool === id ? 'active' : '', onclick: () => { st.tool = id; renderSide(); redraw() } }, label)))
    side.append(el('h3', {}, 'Tool'), tools)

    const opts = el('div', {})
    if (['tile', 'attr', 'prog'].includes(st.tool)) {
      opts.append(el('div', { class: 'ed-row' }, 'Brush',
        el('span', { class: 'ed-seg' }, [1, 3, 5].map((s) => el('button', { type: 'button', class: st.size === s ? 'active' : '', onclick: () => { st.size = s; renderSide() } }, `${s}×${s}`))),
        el('span', { class: 'ed-kbd' }, '[ ]')))
    }
    if (st.tool === 'tile' || st.tool === 'tilefill') opts.append(el('p', { class: 'ed-note' }, `Painting meta-tile ${app.sel.meta}; pick one below. Only bits 0-5 of each MAP byte change.`))
    if (st.tool === 'attr') {
      opts.append(el('div', { class: 'ed-row' }, 'Value', el('span', { class: 'ed-seg' }, [0, 1, 2, 3].map((a) => el('button', { type: 'button', class: st.attr === a ? 'active' : '', onclick: () => { st.attr = a; renderSide() } }, String(a))))),
        el('p', { class: 'ed-note' }, 'Bit 0 reverses the cell\'s flow field (heading ^ 0x80); bit 1 mirrors it through the meta-tile\'s LEV heading row (DS:191B). Both act on AI steering and conveyor/current pushes (docs/engine.md §9cf).'))
    }
    if (['prog', 'progfill', 'progpath'].includes(st.tool)) {
      progInput = el('input', { type: 'number', min: 0, max: 255, value: st.prog, onchange: (e) => { st.prog = Math.max(0, Math.min(255, e.target.value | 0)) } })
      opts.append(el('div', { class: 'ed-row' }, 'Value', progInput,
        st.tool === 'progpath' ? ['Step', el('input', { type: 'number', min: -16, max: 16, value: st.step, onchange: (e) => { st.step = e.target.value | 0 } })] : null))
      opts.append(el('p', { class: 'ed-note' }, 'Progress is the per-cell track position: the lap rule works on half its maximum, the checkpoint bands (fixed in MICROU.EXE) must each be crossed, and drones read the brake stream at this offset.'))
    }
    if (st.tool === 'start') {
      const s = model.strt(round, race)
      opts.append(el('p', { class: 'ed-note' }, `Start (${s.x}, ${s.y}). The cars spawn at +20/+46 x, −10/+16 y from it (InitRaceCarsFromTables 1000:3d9f).`))
    }
    if (st.tool === 'cheat') opts.append(cheatEditor())
    side.append(opts)

    side.append(el('h3', {}, 'View'),
      el('div', { class: 'ed-row' }, 'Zoom', el('span', { class: 'ed-seg' }, ZOOMS.map((z) => el('button', { type: 'button', class: st.z === z ? 'active' : '', onclick: () => setZoom(z) }, `${z}`)))),
      el('div', { class: 'ed-checks' }, OVERLAYS.map(([id, label]) => el('label', {}, el('input', { type: 'checkbox', checked: st.overlays[id], onchange: (e) => { st.overlays[id] = e.target.checked; redraw() } }), ` ${label}`))),
      el('p', { class: 'ed-note' }, 'Drag with the right mouse button (or Space) to pan, wheel to scroll, Ctrl+wheel or + / − to zoom.'))

    const map = model.bytes(mapPath)
    let maxP = 0
    for (let i = 0; i < 1024; i++) maxP = Math.max(maxP, map[1024 + i])
    const bands = checkpointList(round, race)
    side.append(el('h3', {}, `Race ${round}${race}`),
      el('p', { class: 'ed-note' }, `Max progress ${maxP} (half: ${maxP >> 1}). Checkpoint bands from DS:2035: ${bands.length ? bands.map((b) => `[${b.lo},${b.hi})`).join(' ') : 'none for this race'}.`))

    side.append(el('h3', {}, `Meta-tiles (${model.metaCount(round)} of 64)`), metaPalette(app, () => { renderSide() }))
  }

  function cheatEditor() {
    const i = app.sel.cheat
    if (i < 0) return el('p', { class: 'ed-note' }, 'Click a cheat spot to select it, drag to move it. All 30 records are in use; to put one on this race, change its round/race in the Start & cheats tab.')
    const ch = model.cheat(i)
    const num = (k, max = 65535) => el('input', { type: 'number', min: 0, max, value: ch[k], onchange: (e) => model.setCheat(i, { ...model.cheat(i), [k]: Math.max(0, Math.min(max, e.target.value | 0)) }) })
    return el('div', {},
      el('div', { class: 'ed-row' }, `Spot #${i}`, 'x', num('x', 3071), 'y', num('y', 3071)),
      el('div', { class: 'ed-row' }, 'Type', el('select', { onchange: (e) => model.setCheat(i, { ...model.cheat(i), type: e.target.value | 0 }) },
        CHEAT_TYPES.map((t, k) => el('option', { value: k, selected: ch.type === k }, `${k} ${t}`))), 'Param', num('param')),
      el('p', { class: 'ed-note' }, 'Triggers when the camera car is within 24 px on both axes as the game is paused (CheckCheatSpotsThenPause 1000:35f0).'))
  }

  renderSide()
  const off = model.onChange((keys, live) => {
    redraw()
    if (!live && [...keys].some((k) => /\.(CT|PR\d|PAL)$|STRT_POS|CHEATS/.test(k) || k === mapPath)) renderSide()
  })
  return {
    destroy() { ro.disconnect(); off(); window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onKey) },
    centerOn(x, y) { st.ox = x - W / st.z / 2; st.oy = y - H / st.z / 2; clampView(); redraw() },
  }
}

/** A clickable grid of the round's meta-tiles (thumbnails, usage-dimmed), selecting app.sel.meta. */
export function metaPalette(app, onPick) {
  const { model, renderer, round } = app
  const usage = model.metaUsage(round)
  const grid = el('div', { class: 'ed-palette' })
  for (let m = 0; m < model.metaCount(round); m++) {
    const c = el('canvas', { width: 48, height: 48 })
    c.getContext('2d').drawImage(renderer.metaCanvas(round, m), 0, 0, 48, 48)
    const used = usage[m].map((u) => `race ${u.race}: ${u.cells}`).join(', ')
    grid.append(el('figure', { class: `${app.sel.meta === m ? 'active' : ''} ${usage[m].length ? '' : 'unused'}`, title: `meta-tile ${m}${used ? ` — ${used} cells` : ' — unused'}`, onclick: () => { app.sel.meta = m; onPick(m) } },
      c, el('figcaption', {}, String(m))))
  }
  return grid
}

export const racesOf = (round) => Array.from({ length: RACES[round] }, (_, i) => i + 1)
