// The Files & checks tab: the round's validation, every level file's state with per-file
// download/reset, the .zip downloads, importing edited files, and the local save.

import { el, clear, fmtBytes } from '../ui/dom.js'
import { paths, roundPaths } from './model.js'
import { validateRound } from './validate.js'

const isPr = (p) => /\.PR\d$/.test(p)

export function filesTab(root, app) {
  const { model, round } = app
  const scroll = el('div', { class: 'ed-scroll' })
  root.append(scroll)
  let packChecked = false

  function render() {
    clear(scroll)
    const issues = validateRound(model, round, { pack: packChecked })
    const errs = issues.filter((i) => i.level === 'error').length
    scroll.append(el('h3', {}, `Checks for round ${round}: ${errs} error${errs === 1 ? '' : 's'}, ${issues.length - errs} warning${issues.length - errs === 1 ? '' : 's'}`),
      issues.length ? el('ul', { class: 'ed-issues' }, issues.map((i) => el('li', { class: i.level }, el('span', { class: 'file' }, i.file.replace('GAME1/', '')), ' ', i.msg)))
        : el('p', { class: 'ed-note' }, 'No problems found.'),
      el('div', { class: 'ed-row' },
        el('button', { type: 'button', onclick: (e) => { e.target.disabled = true; e.target.textContent = 'Encoding…'; setTimeout(() => { packChecked = true; render() }, 20) } }, packChecked ? 'Re-check packed sizes' : 'Check packed sizes of edited PR files'),
        el('span', { class: 'ed-note' }, 'Errors are things the game would load wrongly; warnings are legal but probably unintended. Some shipped races already have warnings.')))

    const rows = []
    const list = [paths.strt(), paths.cheats(), ...roundPaths(model, round)]
    for (const p of list) {
      const orig = model.original(p), cur = model.bytes(p)
      const dirty = model.isDirty(p)
      let diff = 0
      if (orig && cur) for (let i = 0; i < Math.max(orig.length, cur.length); i++) if (orig[i] !== cur[i]) diff++
      const state = !orig ? 'new' : dirty ? `modified (${diff} byte${diff === 1 ? '' : 's'})` : 'unchanged'
      const size = isPr(p)
        ? `${fmtBytes(cur.length)} unpacked${!dirty && model.origPacked.has(p) ? `, ${model.origPacked.get(p).length} B packed` : ''}`
        : `${cur.length} B${orig && orig.length !== cur.length ? ` (was ${orig.length})` : ''}`
      rows.push(el('tr', { class: dirty ? 'dirty' : '' },
        el('td', {}, p.replace('GAME1/', '')), el('td', {}, size), el('td', { class: dirty ? '' : 'muted' }, state),
        el('td', {},
          el('button', { type: 'button', onclick: () => app.download(p.split('/').pop(), model.exportFile(p)) }, '⬇'),
          ' ',
          el('button', { type: 'button', disabled: !dirty, onclick: () => model.resetFile(p) }, 'Reset'))))
    }
    scroll.append(el('h3', {}, `Files of round ${round} (and the two shared tables)`),
      el('table', { class: 'ed-table' }, el('thead', {}, el('tr', {}, ['file', 'size', 'state', ''].map((h) => el('th', {}, h)))), el('tbody', {}, rows)),
      el('p', { class: 'ed-note' }, 'Every file is written back at its own length and layout; an unchanged file downloads byte-identical to the shipped one. A changed PR file is re-encoded with this editor\'s LZ encoder (not the original compressor, so its packed bytes differ) and checked to unpack to exactly the edited tiles before it is offered.'))

    const changed = model.changedPaths()
    scroll.append(el('h3', {}, 'Download'),
      el('div', { class: 'ed-row' },
        el('button', { type: 'button', disabled: !changed.length, onclick: () => app.downloadZip(changed, 'mm-levels-changed.zip') }, `⬇ All changed files (${changed.length}) .zip`),
        el('button', { type: 'button', onclick: () => app.downloadZip([paths.strt(), paths.cheats(), ...roundPaths(model, round)], `mm-round${round}.zip`) }, `⬇ Every file of round ${round} .zip`)),
      el('p', { class: 'ed-note' }, 'The .zip holds GAME1/… paths: unpack it over the game folder (keep a copy of the originals). Changed files: ' + (changed.length ? changed.map((p) => p.replace('GAME1/', '')).join(', ') : 'none') + '.'))

    const input = el('input', { type: 'file', multiple: true, style: { display: 'none' }, onchange: (e) => importFiles([...e.target.files]) })
    const drop = el('div', { class: 'ed-drop' }, 'Drop edited level files here (ROUND*.MAP, .BRK, .CT, .COL, .DIR, .LEV, .PAL, .PR*, STRT_POS.BIN, CHEATS.BIN), or ', el('a', { href: '#', onclick: (e) => { e.preventDefault(); input.click() } }, 'choose files'), '.', input)
    for (const ev of ['dragover', 'dragenter']) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('drag') })
    drop.addEventListener('dragleave', () => drop.classList.remove('drag'))
    drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('drag'); importFiles([...e.dataTransfer.files]) })
    scroll.append(el('h3', {}, 'Import'), drop, importNote)

    const used = app.storageUsed()
    scroll.append(el('h3', {}, 'Local save'),
      el('p', { class: 'ed-note' }, `Edits are saved in this browser (localStorage) after every change: ${changed.length} changed file${changed.length === 1 ? '' : 's'}, ${fmtBytes(used)}. The game folder itself is never written.`),
      el('div', { class: 'ed-row' }, el('button', { type: 'button', disabled: !changed.length, onclick: () => {
        model.begin('discard all edits')
        for (const p of model.changedPaths()) model.resetFile(p)
        model.commit()
      } }, 'Discard all edits (undoable)')))
  }

  const importNote = el('p', { class: 'ed-note' })
  async function importFiles(files) {
    const done = [], skipped = []
    model.begin('import files')
    try {
      for (const f of files) {
        const name = f.name.toUpperCase()
        const p = `GAME1/${name}`
        if (!model.has(p) && !/^ROUND\dBR\.PR\d$/.test(name)) { skipped.push(f.name); continue }
        model.importFile(p, new Uint8Array(await f.arrayBuffer()))
        done.push(name)
      }
    } catch (err) { skipped.push(`(${err.message})`) } finally { model.commit() }
    importNote.textContent = `Imported ${done.length ? done.join(', ') : 'nothing'}${skipped.length ? `; skipped ${skipped.join(', ')} (not a level file)` : ''}.`
  }

  render()
  const off = model.onChange((keys, live) => { if (!live) render() })
  return { destroy: off }
}
