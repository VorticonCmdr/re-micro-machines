// GFX1.GFX view: the composed logo screen (what SM.EXE leaves on screen after the animation),
// the draw-record table, and every sprite block with the palette SM.EXE uploads.

import { composeLogoScreen, gfx1Sprites, gfx1Sprite, smPalette, smLogoRecords } from '../../formats/gfx1.js'
import { indexedToRgba, paint } from '../../render/raster.js'
import { el } from '../dom.js'

export async function gfx1View(container, { bytes, source, zoom }) {
  let sm
  try { sm = await source.read('SM.EXE') } catch (err) {
    container.append(el('p', { class: 'error' }, `Needs SM.EXE for the palette and draw list: ${err.message}`))
    return
  }
  const rgb = smPalette(sm)
  const screen = composeLogoScreen(bytes, sm)
  const canvas = el('canvas', { class: 'pixels' })
  paint(canvas, screen.width, screen.height, indexedToRgba(screen.indexed, rgb), { zoom })
  container.append(
    el('p', { class: 'muted' }, 'Uncompressed 8-bpp sprite pack; palette and draw list come from SM.EXE (offsets 0x56C and 0x21E). Composed here: all 48 draw records in order, then both banners at their final positions.'),
    el('h3', {}, `Composed logo screen (banners slide ${screen.steps} frames)`),
    canvas,
  )

  const sheet = el('div', { class: 'sprite-sheet' })
  for (const s of gfx1Sprites()) {
    const img = gfx1Sprite(bytes, s)
    const c = el('canvas', { class: 'pixels', title: `${s.name} @ 0x${s.offset.toString(16)} ${s.width}×${s.height}` })
    paint(c, img.width, img.height, indexedToRgba(img.indexed, rgb), { zoom: Math.max(1, Math.min(zoom, 3)) })
    sheet.append(el('figure', {}, c, el('figcaption', { class: 'mono' }, `${s.name} ${s.width}×${s.height} @${s.offset.toString(16)}`)))
  }
  container.append(el('h3', {}, 'Sprite blocks'), sheet)

  const recs = smLogoRecords(sm)
  container.append(el('h3', {}, 'Draw records (SM.EXE LogoRecordTable)'),
    el('pre', { class: 'mono' }, recs.map((r, i) => `rec${String(i).padStart(2)}  x=${String(r.x).padStart(4)} y=${String(r.y).padStart(3)}  src=0x${r.src.toString(16).padStart(4, '0')}  ${r.width}×${r.height}`).join('\n')))
}
