// COMPRESS.PI? view: the seven files are one memory image cut into 48 KB slabs, so the view
// rebuilds the whole arena (cached on the shared state) and shows every .CHR member with
// INTRO.PAL, highlighting the members that live in the selected slab.

import { buildArena, chrSheet, chrFrame, caseImage, membersInSlab, CHR_TABLE, SLAB_SIZE, SLAB_UNPACKED, ARCHIVES } from '../../formats/chr.js'
import { decodePalette } from '../../formats/pal.js'
import { indexedToRgba, paint, CHECKER_CSS } from '../../render/raster.js'
import { toU8, hexDump } from '../../formats/bytes.js'
import { el, fmtBytes } from '../dom.js'

export async function archiveView(container, { entry, source, state, zoom }) {
  const slab = ARCHIVES.indexOf(entry.name.toUpperCase())
  const status = el('p', { class: 'muted' }, 'Unpacking COMPRESS.PI0–PI6…')
  container.append(status)

  if (!state.arena) {
    try { state.arena = await buildArena((name) => source.read(name)) }
    catch (err) { status.textContent = `arena: ${err.message}`; status.className = 'error'; return }
  }
  const { arena, slabs } = state.arena
  let rgb
  try { rgb = decodePalette(toU8(await source.read('INTRO.PAL')), { bits: state.palBits ?? 6 }).rgb }
  catch (err) { status.textContent = `INTRO.PAL: ${err.message}`; status.className = 'error'; return }

  const s = slabs[slab]
  status.textContent = `${entry.name}: ${s.packed} packed → ${s.unpacked} unpacked bytes (expected 0x${SLAB_UNPACKED[slab].toString(16)}); ` +
    `arena slab ${slab} = bytes 0x${(slab * SLAB_SIZE).toString(16)}–0x${(slab * SLAB_SIZE + s.unpacked).toString(16)} of the 328 KB asset arena (segment 2b78 + ${slab}·0xC00).`
  const here = new Set(membersInSlab(slab).map((r) => r.name))
  container.append(el('p', { class: 'muted' }, 'LZ codec: MICROU.EXE DecompressWorkBuffer 1000:3333 (src/formats/lz.js). Members from chrDescriptorTable DS:0A14; dimensions read as (height, width). Palette: INTRO.PAL. Members overlapping this file are marked ●.'))

  const gallery = el('div', { class: 'members' })
  for (const rec of CHR_TABLE) {
    const mark = here.has(rec.name) ? '● ' : '○ '
    const bytes = rec.width * rec.height * rec.frames
    const head = el('h3', {}, `${mark}${rec.name}`, el('span', { class: 'muted' }, `  ${rec.width}×${rec.height} × ${rec.frames} frame${rec.frames === 1 ? '' : 's'} · ${fmtBytes(bytes)} @ arena 0x${rec.arenaOffset.toString(16).padStart(5, '0')}`))
    gallery.append(head)
    if (rec.raw) {
      if (rec.name === 'CASE.MAP') {
        const img = caseImage(arena)
        const c = el('canvas', { class: 'pixels' })
        paint(c, img.width, img.height, indexedToRgba(img.indexed, rgb), { zoom: Math.min(zoom, 2) })
        gallery.append(el('p', { class: 'muted' }, `CASE.MAP = [cols=${img.cols}][rows=${img.rows}] + ${img.cols * img.rows} indices into CASE.CHR's 100 tiles of 8×8 → the vehicle display case, ${img.width}×${img.height}.`), c)
      } else {
        const blob = chrFrame(arena, rec, 0).indexed
        gallery.append(el('pre', { class: 'mono hexdump small' }, hexDump(blob, 0, Math.min(blob.length, 256)).join('\n') + (blob.length > 256 ? '\n…' : '')))
      }
      continue
    }
    const sheet = chrSheet(arena, rec)
    const c = el('canvas', { class: 'pixels', style: { background: CHECKER_CSS } })
    const z = rec.width >= 96 ? Math.min(zoom, 2) : zoom
    paint(c, sheet.width, sheet.height, indexedToRgba(sheet.indexed, rgb, { transparent: state.chrTransparent ?? null }), { zoom: z })
    gallery.append(c)
  }
  const transparency = el('label', {}, 'transparent index ',
    el('input', { type: 'text', size: 4, value: state.chrTransparent ?? '', placeholder: 'none',
      onchange: (e) => { const v = e.target.value.trim(); state.chrTransparent = v === '' ? null : Number(v); container.replaceChildren(); archiveView(container, { entry, source, state, zoom }) } }))
  container.append(el('div', { class: 'toolbar' }, transparency), gallery)
}
