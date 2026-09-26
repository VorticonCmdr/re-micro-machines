// The Tiles tab: the round's 16×16 bank tiles (ROUNDnBR.PR0/1/2, unpacked), pixel-edited in the
// round's palette. An edited slab is re-encoded on export; its packed size is checked against
// the 0x4000 the game can read (Files & checks tab). Tiles can only be appended, never removed
// (a download cannot delete a file from an install): up to 512 (0x20000 bytes).
//
// The Palette tab (ROUNDn.PAL, 256 6-bit DAC entries) is here too.

import { el, clear } from '../ui/dom.js'
import { paths, TILES_PER_SLAB, MAX_BANK_TILES } from './model.js'
import { OVERLAY_RANGES, OVERLAY_TILE_DELTA } from '../formats/race.js'

const PX = 20 // editor pixel size

function swatches(app, onPick, selected) {
  const grid = el('div', { class: 'ed-swatches' })
  for (let i = 0; i < 256; i++) {
    grid.append(el('div', { class: i === selected ? 'active' : '', title: `${i} (0x${i.toString(16)}) = ${app.model.palEntry(app.round, i).join(',')}`, style: { background: app.renderer.css(app.round, i) }, onclick: () => onPick(i), oncontextmenu: (e) => { e.preventDefault(); onPick(i, true) } }))
  }
  return grid
}

export function tilesTab(root, app) {
  const { model, renderer, round } = app
  const st = app.tileState ||= { tool: 'pen', clip: null }
  const scroll = el('div', { class: 'ed-scroll' })
  root.append(scroll)
  const left = el('div', { class: 'ed-pane' }), center = el('div', { class: 'ed-pane' }), right = el('div', { class: 'ed-pane' })
  scroll.append(el('div', { class: 'ed-panes' }, left, center, right))
  const sheet = el('canvas', { class: 'ed-sheet' })
  const sheetWrap = el('div', { class: 'ed-sheet-wrap' }, sheet)
  const big = el('canvas', { class: 'ed-big', width: 16 * PX, height: 16 * PX })
  const g = big.getContext('2d')
  const tile = () => Math.min(app.sel.tile, model.bankTileCount(round) - 1)

  const PER = 12, TS = 32
  function drawSheet() {
    const n = model.bankTileCount(round)
    sheet.width = PER * TS; sheet.height = Math.ceil(n / PER) * TS
    const sg = sheet.getContext('2d')
    sg.imageSmoothingEnabled = false
    const tmp = document.createElement('canvas'); tmp.width = tmp.height = 16
    const tg = tmp.getContext('2d')
    for (let t = 0; t < n; t++) {
      tg.putImageData(renderer.tileImage(round, t), 0, 0)
      sg.drawImage(tmp, (t % PER) * TS, ((t / PER) | 0) * TS, TS, TS)
      if (t % TILES_PER_SLAB === 0) { sg.fillStyle = '#fff'; sg.fillRect((t % PER) * TS, ((t / PER) | 0) * TS, 3, TS) }
    }
    const t = tile()
    sg.strokeStyle = '#fff'; sg.lineWidth = 2; sg.strokeRect((t % PER) * TS + 1, ((t / PER) | 0) * TS + 1, TS - 2, TS - 2)
  }
  sheet.addEventListener('click', (e) => {
    const r = sheet.getBoundingClientRect()
    const t = ((e.clientY - r.top) / TS | 0) * PER + ((e.clientX - r.left) / TS | 0)
    if (t < model.bankTileCount(round)) { app.sel.tile = t; drawSheet(); renderCenter() }
  })

  function drawBig() {
    const px = model.tilePixels(round, tile())
    for (let i = 0; i < 256; i++) { g.fillStyle = renderer.css(round, px[i]); g.fillRect((i & 15) * PX, (i >> 4) * PX, PX, PX) }
    g.strokeStyle = 'rgba(255,255,255,.12)'
    for (let k = 1; k < 16; k++) { g.beginPath(); g.moveTo(k * PX + 0.5, 0); g.lineTo(k * PX + 0.5, 16 * PX); g.moveTo(0, k * PX + 0.5); g.lineTo(16 * PX, k * PX + 0.5); g.stroke() }
  }

  let stroke = null
  const pos = (e) => { const r = big.getBoundingClientRect(); return { x: ((e.clientX - r.left) / r.width * 16) | 0, y: ((e.clientY - r.top) / r.height * 16) | 0 } }
  function paint(p, first) {
    if (p.x < 0 || p.y < 0 || p.x > 15 || p.y > 15) return
    const t = tile(), px = model.tilePixels(round, t).slice()
    if (stroke.button === 2 || st.tool === 'pick') { app.sel.color = px[p.y * 16 + p.x]; renderRight(); return }
    if (st.tool === 'fill') {
      if (!first) return
      const want = px[p.y * 16 + p.x], q = [p.y * 16 + p.x]
      if (want === app.sel.color) return
      while (q.length) {
        const i = q.pop()
        if (px[i] !== want) continue
        px[i] = app.sel.color
        const x = i & 15, y = i >> 4
        if (x > 0) q.push(i - 1); if (x < 15) q.push(i + 1); if (y > 0) q.push(i - 16); if (y < 15) q.push(i + 16)
      }
    } else px[p.y * 16 + p.x] = app.sel.color
    model.setTilePixels(round, t, px)
  }
  big.addEventListener('contextmenu', (e) => e.preventDefault())
  big.addEventListener('mousedown', (e) => { stroke = { button: e.button }; model.begin(`paint tile ${tile()}`); paint(pos(e), true) })
  const onMove = (e) => { if (stroke && st.tool === 'pen' && stroke.button === 0) paint(pos(e), false) }
  const onUp = () => { if (stroke) { stroke = null; model.commit() } }
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)

  const transform = (label, fn) => {
    const src = model.tilePixels(round, tile()), out = new Uint8Array(256)
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) out[y * 16 + x] = src[fn(x, y)]
    model.setTilePixels(round, tile(), out, label)
  }

  function renderLeft() {
    clear(left)
    const n = model.bankTileCount(round)
    const add = (from) => { try { app.sel.tile = model.addTile(round, from); renderAll() } catch (err) { note.textContent = err.message } }
    const note = el('p', { class: 'ed-note bad' })
    left.append(el('h3', {}, `Bank: ${n} of ${MAX_BANK_TILES} tiles in ${model.slabCount(round)} PR files`),
      el('div', { class: 'ed-row' },
        el('button', { type: 'button', disabled: n >= MAX_BANK_TILES, onclick: () => add(tile()) }, `+ Duplicate ${tile()}`),
        el('button', { type: 'button', disabled: n >= MAX_BANK_TILES, onclick: () => add(null) }, '+ Blank')),
      note,
      el('p', { class: 'ed-note' }, `A white bar starts each PR file (192 tiles = one 0xC000 slab). New tiles go at the end of the last file; once a file holds 192, the next one (up to PR2) is started.`),
      sheetWrap)
    drawSheet()
  }

  function renderCenter() {
    clear(center)
    const t = tile()
    const users = model.tileUsers(round, t)
    const k = Math.floor(t / TILES_PER_SLAB)
    const range = OVERLAY_RANGES[round]
    const overlayOf = range ? [t - OVERLAY_TILE_DELTA].filter((b) => b >= range[0] && b <= range[1]) : []
    center.append(el('h3', {}, `Tile ${t} (${paths.pr(round, k).slice(6)}, +0x${((t % TILES_PER_SLAB) * 256).toString(16)})`),
      el('div', { class: 'ed-row' }, el('span', { class: 'ed-seg' }, [['pen', 'Pen'], ['fill', 'Fill'], ['pick', 'Pick']].map(([id, l]) => el('button', { type: 'button', class: st.tool === id ? 'active' : '', onclick: () => { st.tool = id; renderCenter() } }, l)))),
      big,
      el('div', { class: 'ed-row' },
        el('button', { type: 'button', onclick: () => transform('flip tile', (x, y) => y * 16 + 15 - x) }, '⇆ Flip'),
        el('button', { type: 'button', onclick: () => transform('flip tile', (x, y) => (15 - y) * 16 + x) }, '⇅ Flip'),
        el('button', { type: 'button', onclick: () => transform('rotate tile', (x, y) => (15 - x) * 16 + y) }, '↻ Rotate'),
        el('button', { type: 'button', onclick: () => { st.clip = model.tilePixels(round, t).slice(); renderCenter() } }, 'Copy'),
        el('button', { type: 'button', disabled: !st.clip, onclick: () => model.setTilePixels(round, t, st.clip, 'paste tile') }, 'Paste')),
      el('p', { class: 'ed-note' }, `Right-click picks a colour. ${users.length ? `Used by meta-tile${users.length > 1 ? 's' : ''} ${users.join(', ')}.` : 'No meta-tile uses it.'}${overlayOf.length ? ` It is the overlay variant of tile ${overlayOf[0]}: drawn transparently (colour 0) over the cars.` : ''}${t === 0 ? ' Tile 0 is also the parallax/backdrop tile in rounds 1, 3 and 5 (docs/engine.md §9al).' : ''}`))
    drawBig()
  }

  function renderRight() {
    clear(right)
    const c = app.sel.color
    right.append(el('h3', {}, `Colour ${c} (0x${c.toString(16)})`),
      el('div', { style: { width: '64px', height: '24px', background: renderer.css(round, c), border: '1px solid var(--line)' } }),
      el('p', { class: 'ed-note' }, `DAC ${model.palEntry(round, c).join(', ')} (0-63). Edit it in the Palette tab.`),
      swatches(app, (i) => { app.sel.color = i; renderRight() }, c))
  }

  function renderAll() { renderLeft(); renderCenter(); renderRight() }
  renderAll()
  const off = model.onChange((keys, live) => {
    if (![...keys].some((k) => new RegExp(`ROUND${round}(BR\\.(PR\\d|CT)|\\.PAL)$`).test(k))) return
    drawBig()
    if (!live) { drawSheet(); if ([...keys].some((k) => /PAL$/.test(k))) renderRight(); else if ([...keys].some((k) => /CT$/.test(k))) renderCenter() }
  })
  return { destroy() { off(); window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) } }
}

export function paletteTab(root, app) {
  const { model, renderer, round } = app
  const scroll = el('div', { class: 'ed-scroll' })
  root.append(scroll)
  const body = el('div', {})
  scroll.append(body)
  let grid = null, preview = null, inputs = []
  function render() {
    clear(body)
    const c = app.sel.color
    inputs = []
    // A slider drag is one transaction (one undo step); its live writes recolour in place.
    const chan = (k) => {
      const set = (v) => { const rgb = model.palEntry(round, c); rgb[k] = v | 0; model.setPalEntry(round, c, rgb) }
      const range = el('input', { type: 'range', min: 0, max: 63, value: model.palEntry(round, c)[k], onpointerdown: () => { model.begin('set colour'); window.addEventListener('pointerup', () => model.commit(), { once: true }) }, oninput: (e) => set(e.target.value) })
      const num = el('input', { type: 'number', min: 0, max: 63, value: model.palEntry(round, c)[k], onchange: (e) => set(e.target.value) })
      inputs.push([range, num, k])
      return el('div', { class: 'ed-row' }, ['R', 'G', 'B'][k], range, num)
    }
    grid = swatches(app, (i) => { app.sel.color = i; render() }, c)
    preview = el('div', { style: { width: '120px', height: '48px', background: renderer.css(round, c), border: '1px solid var(--line)' } })
    body.append(el('h3', {}, `ROUND${round}.PAL: 256 entries of 6-bit DAC values (shared by every race of round ${round})`),
      el('div', { class: 'ed-panes' },
        el('div', { class: 'ed-pane' }, grid),
        el('div', { class: 'ed-pane', style: { width: '320px' } },
          el('h3', {}, `Entry ${c} (0x${c.toString(16)})`), preview, chan(0), chan(1), chan(2),
          el('p', { class: 'ed-note' }, 'Values go into the file as they are (0-63), exactly what the game sends to the VGA DAC. The palette also colours the cars (the low nibble 0-2 of each 16-colour row is shifted per car, 1000:8C6A) and the HUD.'))))
  }
  function recolour() {
    const c = app.sel.color
    ;[...grid.children].forEach((d, i) => { d.style.background = renderer.css(round, i) })
    preview.style.background = renderer.css(round, c)
    for (const [range, num, k] of inputs) {
      const v = model.palEntry(round, c)[k]
      if (document.activeElement !== range) range.value = v
      if (document.activeElement !== num) num.value = v
    }
  }
  render()
  const off = model.onChange((keys) => { if ([...keys].includes(paths.pal(round))) recolour() })
  return { destroy: off }
}
