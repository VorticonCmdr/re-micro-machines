// Palette view: 16×16 swatches, hover for index/raw/RGB, and the 6-bit/8-bit reading toggle.

import { decodePalette, cssColor } from '../../formats/pal.js'
import { toU8, hex } from '../../formats/bytes.js'
import { el, clear } from '../dom.js'

export function paletteView(container, { bytes, entry, state }) {
  const data = toU8(bytes)
  let bits = state.palBits ?? 6
  const info = el('div', { class: 'info' })
  const grid = el('div', { class: 'pal-grid' })
  const readout = el('div', { class: 'readout mono' }, 'hover a swatch')

  const render = () => {
    const pal = decodePalette(data, { bits })
    clear(grid)
    for (let i = 0; i < 256; i++) {
      const raw = [data[i * 3], data[i * 3 + 1], data[i * 3 + 2]]
      const sw = el('div', {
        class: 'pal-swatch',
        style: { background: cssColor(pal.rgb, i) },
        title: `${i} (${hex(i)}h)`,
        onmouseenter: () => {
          readout.textContent =
            `index ${i} (${hex(i)}h)  raw ${raw.map((v) => hex(v)).join(' ')}  ` +
            `→ rgb(${pal.rgb[i * 3]}, ${pal.rgb[i * 3 + 1]}, ${pal.rgb[i * 3 + 2]})  ${cssColor(pal.rgb, i)}`
        },
      })
      grid.append(sw)
    }
    clear(info)
    info.append(
      el('p', {},
        `${entry.path} — 768 bytes = 256 × RGB. Max raw byte ${pal.maxRaw} (`,
        pal.maxRaw <= 63 ? 'consistent with 6-bit DAC values' : 'exceeds 63: NOT 6-bit',
        `). Shown as ${bits}-bit.`),
      el('p', { class: 'muted' }, 'PROVEN 6-bit: uploaded verbatim via INT 10h AX=1012h (LoadPalFileToDac 1000:07A0); the live DAC matched ROUND2.PAL byte-for-byte. Status: ', el('b', {}, entry.status), '.'),
    )
  }

  const toggle = el('label', {}, 'Reading ',
    el('select', {
      onchange: (e) => { bits = Number(e.target.value); state.palBits = bits; render() },
    },
      el('option', { value: '6', selected: bits === 6 || undefined }, '6-bit DAC (round(v·255/63))'),
      el('option', { value: '8', selected: bits === 8 || undefined }, '8-bit verbatim'),
    ))

  container.append(el('div', { class: 'toolbar' }, toggle), info, grid, readout)
  render()
}
