// Probe view: what the viewer offers for a file whose format is not (fully) decoded yet.
//
// Tabs: Info (catalogue notes), Hex, Stats (histogram, entropy profile, word histogram),
// Strings, and the Image probe — interpret the bytes as raw 8/4/1-bpp pixels at a chosen
// width and offset with any shipped .PAL applied. The image probe is the fastest way to find
// out whether a region is pixel data (glyphs, tiles, sprites) before the format is known:
// the right width makes a picture snap into focus.

import { toU8, hex, hexDump, histogram, entropy, entropyProfile, strings, u16le } from '../../formats/bytes.js'
import { decodePalette, grayPalette } from '../../formats/pal.js'
import { indexedToRgba, paint, CHECKER_CSS } from '../../render/raster.js'
import { PALETTES } from '../../data/catalog.js'
import { el, clear, fmtBytes } from '../dom.js'

const HEX_PAGE = 4096

export function probeView(container, { bytes, entry, state, source, zoom }) {
  const data = toU8(bytes)
  const tabs = el('div', { class: 'tabs' })
  const body = el('div', { class: 'tab-body' })
  const TABS = {
    Info: () => infoTab(data, entry),
    Hex: () => hexTab(data),
    Stats: () => statsTab(data),
    Strings: () => stringsTab(data),
    Image: () => imageTab(data, entry, state, source, zoom),
  }
  let active = state.probeTab ?? 'Info'
  const show = (name) => {
    active = name
    state.probeTab = name
    for (const b of tabs.children) b.classList.toggle('active', b.textContent === name)
    clear(body).append(TABS[name]())
  }
  for (const name of Object.keys(TABS)) tabs.append(el('button', { type: 'button', onclick: () => show(name) }, name))
  container.append(tabs, body)
  show(active)
}

function infoTab(data, entry) {
  const words = data.length >= 4 ? Array.from({ length: Math.min(8, data.length >> 1) }, (_, i) => hex(u16le(data, i * 2), 4)).join(' ') : ''
  return el('div', { class: 'info' },
    el('h2', {}, entry.path),
    el('dl', {},
      el('dt', {}, 'Size'), el('dd', {}, `${data.length} bytes (${fmtBytes(data.length)})`),
      el('dt', {}, 'Family'), el('dd', {}, entry.family),
      el('dt', {}, 'Decoder status'), el('dd', {}, el('b', {}, entry.status)),
      el('dt', {}, 'Notes'), el('dd', {}, entry.note || '—'),
      el('dt', {}, 'First bytes'), el('dd', { class: 'mono' }, hexDump(data, 0, Math.min(32, data.length))[0] ?? ''),
      el('dt', {}, 'First LE words'), el('dd', { class: 'mono' }, words),
      el('dt', {}, 'Entropy'), el('dd', {}, `${entropy(data).toFixed(2)} bits/byte (8.0 = random/compressed, low = tables/sparse)`),
    ),
    el('p', { class: 'muted' }, 'No decoder yet — use Hex / Stats / Strings / Image to investigate. Findings belong in docs/ with disassembly evidence, then in a src/formats/ decoder.'),
  )
}

function hexTab(data) {
  const pre = el('pre', { class: 'mono hexdump' })
  let shown = 0
  const more = el('button', { type: 'button' }, 'Show more')
  const page = () => {
    const n = Math.min(HEX_PAGE, data.length - shown)
    pre.append(hexDump(data, shown, n).join('\n') + '\n')
    shown += n
    more.hidden = shown >= data.length
    more.textContent = `Show more (${fmtBytes(data.length - shown)} left)`
  }
  more.addEventListener('click', page)
  page()
  return el('div', {}, pre, more)
}

function statsTab(data) {
  const h = histogram(data)
  const max = Math.max(1, ...h)
  const hist = el('canvas', { width: 512, height: 120, class: 'chart', title: 'byte value histogram (0..255)' })
  const ctx = hist.getContext('2d')
  ctx.fillStyle = '#7aa2f7'
  for (let i = 0; i < 256; i++) {
    const bar = Math.round((h[i] / max) * 118)
    ctx.fillRect(i * 2, 120 - bar, 2, bar)
  }
  const prof = entropyProfile(data, 256)
  const pc = el('canvas', { width: Math.max(256, prof.length * 4), height: 80, class: 'chart', title: 'entropy per 256-byte window' })
  const pctx = pc.getContext('2d')
  pctx.fillStyle = '#e0af68'
  prof.forEach((e, i) => pctx.fillRect(i * 4, 80 - e * 10, 4, e * 10))

  const top = Array.from(h, (n, v) => [v, n]).sort((a, b) => b[1] - a[1]).slice(0, 16)
  const wh = new Map()
  for (let o = 0; o + 1 < data.length; o += 2) { const w = u16le(data, o); wh.set(w, (wh.get(w) ?? 0) + 1) }
  const topWords = [...wh.entries()].sort((a, b) => b[1] - a[1]).slice(0, 16)
  const distinct = h.reduce((n, c) => n + (c ? 1 : 0), 0)

  return el('div', { class: 'info' },
    el('p', {}, `${data.length} bytes · ${distinct} distinct byte values · entropy ${entropy(data).toFixed(2)} · zero bytes ${h[0]} (${((h[0] / data.length) * 100).toFixed(1)}%)`),
    el('h3', {}, 'Byte histogram'), hist,
    el('h3', {}, 'Entropy profile (256-byte windows)'), pc,
    el('div', { class: 'cols' },
      el('div', {}, el('h3', {}, 'Top bytes'), el('pre', { class: 'mono' }, top.map(([v, n]) => `${hex(v)}  ${String(v).padStart(3)}  ×${n}`).join('\n'))),
      el('div', {}, el('h3', {}, 'Top LE words'), el('pre', { class: 'mono' }, topWords.map(([v, n]) => `${hex(v, 4)}  ${String(v).padStart(5)}  ×${n}`).join('\n'))),
    ),
  )
}

function stringsTab(data) {
  const found = strings(data, 4)
  return el('div', { class: 'info' },
    el('p', {}, `${found.length} printable runs ≥ 4 chars`),
    el('pre', { class: 'mono' }, found.map((s) => `${hex(s.offset, 6)}  ${s.text}`).join('\n')),
  )
}

function imageTab(data, entry, state, source, zoom) {
  const p = (state.probe ||= { width: 320, offset: 0, bpp: 8, pal: PALETTES[0]?.path ?? '', transparent: '', nibble: 'hi', lengthCap: 0 })
  const canvas = el('canvas', { class: 'pixels', style: { background: CHECKER_CSS } })
  const status = el('div', { class: 'readout mono' })
  let palRgb = grayPalette().rgb

  const num = (key, min, max, step = 1) => el('input', {
    type: 'number', value: p[key], min, max, step,
    onchange: (e) => { p[key] = Number(e.target.value); draw() },
  })
  const palSelect = el('select', { onchange: async (e) => { p.pal = e.target.value; await loadPal(); draw() } },
    el('option', { value: '', selected: !p.pal || undefined }, 'grayscale'),
    ...PALETTES.map((e) => el('option', { value: e.path, selected: e.path === p.pal || undefined }, e.path)),
  )
  const bppSelect = el('select', { onchange: (e) => { p.bpp = Number(e.target.value); draw() } },
    ...[8, 4, 1].map((b) => el('option', { value: String(b), selected: b === p.bpp || undefined }, `${b} bpp`)))
  const nibbleSelect = el('select', { onchange: (e) => { p.nibble = e.target.value; draw() } },
    el('option', { value: 'hi', selected: p.nibble === 'hi' || undefined }, 'high nibble / MSB first'),
    el('option', { value: 'lo', selected: p.nibble === 'lo' || undefined }, 'low nibble / LSB first'))
  const transparent = el('input', { type: 'text', value: p.transparent, placeholder: 'none', size: 4,
    onchange: (e) => { p.transparent = e.target.value.trim(); draw() } })

  async function loadPal() {
    if (!p.pal) { palRgb = grayPalette().rgb; return }
    try { palRgb = decodePalette(toU8(await source.read(p.pal)), { bits: state.palBits ?? 6 }).rgb }
    catch (err) { palRgb = grayPalette().rgb; status.textContent = `palette: ${err.message}` }
  }

  function unpack() {
    const start = Math.max(0, Math.min(p.offset, data.length))
    const src = data.subarray(start)
    const pixelsPerByte = 8 / p.bpp
    const width = Math.max(1, p.width | 0)
    const bytesPerRow = Math.ceil(width / pixelsPerByte)
    const height = Math.max(0, Math.floor(src.length / bytesPerRow))
    const out = new Uint8Array(width * height)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const bi = y * bytesPerRow + Math.floor(x / pixelsPerByte)
        const b = src[bi]
        let v
        if (p.bpp === 8) v = b
        else if (p.bpp === 4) v = (x & 1) === (p.nibble === 'hi' ? 0 : 1) ? b >> 4 : b & 0x0f
        else { const bit = x & 7; v = (p.nibble === 'hi' ? (b >> (7 - bit)) : (b >> bit)) & 1 }
        out[y * width + x] = v
      }
    }
    return { width, height, indexed: out, bytesPerRow, start }
  }

  function draw() {
    const { width, height, indexed, bytesPerRow, start } = unpack()
    if (!height) { status.textContent = 'nothing to show at this offset/width'; canvas.width = canvas.height = 0; return }
    // 1-bpp and 4-bpp indices are tiny; spread them over the palette so they are visible.
    let idx = indexed
    if (p.bpp === 1 && !p.pal) idx = indexed.map((v) => (v ? 255 : 0))
    else if (p.bpp === 4 && !p.pal) idx = indexed.map((v) => v * 17)
    const t = p.transparent === '' ? null : Number(p.transparent)
    const rgba = indexedToRgba(idx, palRgb, { transparent: Number.isFinite(t) ? t : null })
    paint(canvas, width, height, rgba, { zoom })
    status.textContent = `${width}×${height} px from offset ${hex(start, 6)} (${bytesPerRow} B/row, ${p.bpp} bpp) — ${fmtBytes(height * bytesPerRow)} of ${fmtBytes(data.length)} shown`
  }

  const nudge = (delta) => () => { p.offset = Math.max(0, p.offset + delta); offsetInput.value = p.offset; draw() }
  const offsetInput = num('offset', 0, data.length)
  const toolbar = el('div', { class: 'toolbar' },
    el('label', {}, 'width ', num('width', 1, 4096)),
    el('label', {}, 'offset ', offsetInput,
      el('button', { type: 'button', onclick: nudge(-1) }, '−1'), el('button', { type: 'button', onclick: nudge(1) }, '+1'),
      el('button', { type: 'button', onclick: nudge(-16) }, '−16'), el('button', { type: 'button', onclick: nudge(16) }, '+16')),
    el('label', {}, 'depth ', bppSelect), el('label', {}, 'order ', nibbleSelect),
    el('label', {}, 'palette ', palSelect), el('label', {}, 'transparent index ', transparent),
  )
  loadPal().then(draw)
  return el('div', {}, toolbar, status, el('div', { class: 'canvas-wrap' }, canvas))
}
