// FONT.BIN view: the code-card module's embedded graphics (symbol strip, cursor), the physical
// code card reconstructed from its lookup table, and the patch state of the compare sites.
// The rest of the file is x86 code — the probe view's Hex tab still applies for that.

import { symbolStrip, cursorSprite, fontbinPalette, cardTable, cardImage, patchState, CARD_SIZE } from '../../formats/fontbin.js'
import { indexedToRgba, paint, CHECKER_CSS } from '../../render/raster.js'
import { el } from '../dom.js'
import { probeView } from './probeView.js'

export function fontbinView(container, ctx) {
  const { bytes, zoom } = ctx
  const rgb = fontbinPalette(bytes)
  const strip = symbolStrip(bytes)
  const cursor = cursorSprite(bytes)
  const card = cardImage(bytes)
  const { table, base } = cardTable(bytes)
  const patch = patchState(bytes)

  const show = (img, z, transparent = null) => {
    const c = el('canvas', { class: 'pixels', style: transparent !== null ? { background: CHECKER_CSS } : {} })
    paint(c, img.width, img.height, indexedToRgba(img.indexed, rgb, { transparent }), { zoom: z })
    return c
  }

  const header = ['   ', ...Array.from({ length: CARD_SIZE }, (_, c) => String.fromCharCode(65 + c).padStart(3))].join('')
  const rows = table.map((r, i) => `${String(i + 1).padStart(2)} ` + r.map((v) => String(v).padStart(3)).join(''))

  container.append(
    el('p', { class: 'muted' }, 'Code-card copy-protection module (x86 code + planar EGA graphics, mode 10h). MICROU.EXE far-calls it once at startup and exits to DOS unless it returns 0.'),
    el('p', {}, patch.patched
      ? 'Compare sites +0xAB and +0x13A are PATCHED in this copy (MOV AL,DL + jump/NOPs): any symbol passes both questions.'
      : 'Compare sites look intact — the check is enforced in this copy.',
      el('span', { class: 'mono muted' }, `  [+A8] ${patch.site1}  [+137] ${patch.site2}`)),
    el('h3', {}, 'Symbol strip (208×162, 8×8 grid of 64 symbols) @0x26CA'), show(strip, zoom),
    el('h3', {}, 'Cursor (32×22) @0x256A'), show(cursor, zoom, 0),
    el('h3', {}, `The physical code card (table @0x${base.toString(16).toUpperCase()}, 16 columns A–P × 16 rows 1–16)`),
    show(card, Math.max(1, Math.min(zoom, 2))),
    el('pre', { class: 'mono' }, [header, ...rows].join('\n')),
    el('h3', {}, 'Raw module'),
  )
  const probe = el('div', {})
  container.append(probe)
  probeView(probe, ctx)
}
