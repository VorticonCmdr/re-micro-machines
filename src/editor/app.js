// The level editor's shell (editor.html): round/race selection, the tabs, undo/redo, the local
// save (a sparse diff in localStorage after every committed change) and downloads.

import { el, clear } from '../ui/dom.js'
import { ROUNDS, RACES, paths, STORE_KEY } from './model.js'
import { Renderer } from './render.js'
import { validateRound } from './validate.js'
import { makeZip } from './zip.js'
import { mapTab } from './mapTab.js'
import { metaTab } from './metaTab.js'
import { tilesTab, paletteTab } from './tilesTab.js'
import { brkTab, globalsTab } from './tablesTab.js'
import { filesTab } from './filesTab.js'

const UI_KEY = 'mm-level-editor-ui'

const TABS = [
  ['map', 'Map', mapTab],
  ['meta', 'Meta-tiles', metaTab],
  ['tiles', 'Tiles', tilesTab],
  ['palette', 'Palette', paletteTab],
  ['brk', 'Brake stream', brkTab],
  ['globals', 'Start & cheats', globalsTab],
  ['files', 'Files & checks', filesTab],
]

const storage = {
  get(k) { try { return localStorage.getItem(k) } catch { return null } },
  set(k, v) { try { localStorage.setItem(k, v); return true } catch { return false } },
}

export function startEditor(model) {
  const renderer = new Renderer(model)
  const $ = (id) => document.getElementById(id)
  const main = $('ed-main'), tabsEl = $('ed-tabs'), saveEl = $('ed-save')

  let restored = 0
  try { const s = storage.get(STORE_KEY); if (s) restored = model.applyJSON(JSON.parse(s)) } catch (err) { console.warn('saved edits unreadable', err) }
  let ui = {}
  try { ui = JSON.parse(storage.get(UI_KEY) ?? '{}') } catch { /* fresh */ }

  const app = {
    model, renderer,
    round: RACES[ui.round] ? ui.round : 2,
    race: 1,
    tab: TABS.some((t) => t[0] === ui.tab) ? ui.tab : 'map',
    sel: { meta: 0, tile: 0, color: 15, cheat: -1 },
    current: null,
    showTab(id) { app.tab = id; mount() },
    showOnMap(round, race, x, y, cheat) {
      if (RACES[round] && race >= 1 && race <= RACES[round]) { app.round = round; app.race = race }
      app.sel.cheat = cheat ?? -1
      if (app.mapState) app.mapState.overlays.cheats = true
      app.tab = 'map'; mount()
      app.current?.centerOn?.(x, y)
    },
    download(name, bytes) {
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }))
      const a = el('a', { href: url, download: name })
      document.body.append(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 5000)
    },
    downloadZip(list, name) {
      try { app.download(name, makeZip(list.filter((p) => model.has(p)).map((p) => ({ name: p, bytes: model.exportFile(p) })))) } catch (err) { saveEl.textContent = `download failed: ${err.message}` }
    },
    storageUsed() { return (storage.get(STORE_KEY) ?? '').length * 2 },
  }
  app.race = ui.race >= 1 && ui.race <= RACES[app.round] ? ui.race : 1

  // Round and race.
  const roundSel = $('ed-round'), raceSel = $('ed-race')
  for (const r of ROUNDS) roundSel.append(el('option', { value: r }, `${r}`))
  const fillRaces = () => { clear(raceSel); for (let n = 1; n <= RACES[app.round]; n++) raceSel.append(el('option', { value: n, selected: n === app.race }, `${n}`)) }
  roundSel.value = app.round; fillRaces()
  roundSel.addEventListener('change', () => { app.round = roundSel.value | 0; app.race = 1; app.sel = { ...app.sel, meta: 0, tile: 0, cheat: -1 }; fillRaces(); mount() })
  raceSel.addEventListener('change', () => { app.race = raceSel.value | 0; app.sel.cheat = -1; mount() })

  // Undo / redo.
  const undoBtn = $('ed-undo'), redoBtn = $('ed-redo')
  const doUndo = () => { const l = model.undo(); if (l) flash(`undid: ${l}`) }
  const doRedo = () => { const l = model.redo(); if (l) flash(`redid: ${l}`) }
  undoBtn.addEventListener('click', doUndo)
  redoBtn.addEventListener('click', doRedo)
  window.addEventListener('keydown', (e) => {
    if (e.target.closest?.('input[type=text], input[type=number], textarea')) return
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? doRedo() : doUndo() }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); doRedo() }
  })
  $('ed-zip').addEventListener('click', () => { const ch = model.changedPaths(); if (ch.length) app.downloadZip(ch, 'mm-levels-changed.zip'); else flash('nothing changed yet') })

  // The local save, after every committed change.
  let saveTimer = 0, flashTimer = 0, flashMsg = ''
  const flash = (msg) => { flashMsg = msg; clearTimeout(flashTimer); flashTimer = setTimeout(() => { flashMsg = ''; status() }, 2500); status() }
  let saveOk = true
  const status = () => {
    const n = model.changedPaths().length
    saveEl.textContent = flashMsg || (!saveOk ? 'NOT SAVED: browser storage is full or blocked, download your files' : n ? `${n} changed file${n > 1 ? 's' : ''}, saved in this browser` : 'no changes')
    saveEl.style.color = saveOk ? '' : 'var(--bad)'
    undoBtn.disabled = !model.canUndo; redoBtn.disabled = !model.canRedo
  }
  const save = () => { saveOk = storage.set(STORE_KEY, JSON.stringify(model.toJSON())); status() }
  model.onChange((keys, live) => {
    if (live) return
    clearTimeout(saveTimer); saveTimer = setTimeout(save, 300)
    status(); badge()
  })

  // Tabs.
  const tabButtons = new Map()
  for (const [id, label] of TABS) {
    const b = el('button', { type: 'button', onclick: () => app.showTab(id) }, label)
    tabButtons.set(id, b); tabsEl.append(b)
  }
  const badgeEl = el('span', { class: 'badge' })
  tabButtons.get('files').append(badgeEl)
  let badgeTimer = 0
  const badge = () => {
    clearTimeout(badgeTimer)
    badgeTimer = setTimeout(() => {
      const iss = validateRound(model, app.round)
      const e = iss.filter((i) => i.level === 'error').length
      badgeEl.textContent = e || iss.length
      badgeEl.className = `badge ${e ? 'bad' : iss.length ? 'warn' : ''}`
      badgeEl.title = `${e} errors, ${iss.length - e} warnings in round ${app.round}`
    }, 150)
  }

  function mount() {
    app.current?.destroy?.()
    clear(main)
    for (const [id, b] of tabButtons) b.classList.toggle('active', id === app.tab)
    roundSel.value = app.round; fillRaces()
    const play = $('ed-play')
    play.href = `index.html?round=${app.round}&race=${app.race}&edited=1`
    const tab = TABS.find((t) => t[0] === app.tab)
    app.current = tab[2](main, app)
    storage.set(UI_KEY, JSON.stringify({ round: app.round, race: app.race, tab: app.tab }))
    badge()
  }

  mount()
  status()
  if (restored) flash(`restored ${restored} edited file${restored > 1 ? 's' : ''} from this browser`)
  return { model, app }
}
