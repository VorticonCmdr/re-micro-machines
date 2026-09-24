// App shell: source wiring, the asset sidebar grouped by family, and dispatch to a view per
// catalogue kind. Adding a decoder means writing a view module and adding one line to VIEWS.

import { CATALOG, FAMILY_LABEL, FAMILY_ORDER, KIND, byPath } from '../data/catalog.js'
import { FetchSource, DirectorySource, DropSource } from '../io/source.js'
import { el, clear, fmtBytes } from './dom.js'
import { paletteView } from './views/paletteView.js'
import { probeView } from './views/probeView.js'
import { gfx1View } from './views/gfx1View.js'
import { fontbinView } from './views/fontbinView.js'
import { archiveView } from './views/archiveView.js'
import { mapView, tileTableView } from './views/trackView.js'
import { tileBankView, vehicleView, bitsfileView } from './views/raceGfxView.js'
import { soundView } from './views/soundView.js'
import { levBrkView } from './views/levBrkView.js'
import { globalDataView } from './views/globalDataView.js'
import { engineTablesView } from './views/engineTablesView.js'

/** Views not backed by a catalog file, opened from the sidebar's "Tools" section. */
const TOOLS = {
  'engine-tables': { label: 'Engine tables', render: engineTablesView },
}

const VIEWS = {
  [KIND.PALETTE]: paletteView,
  [KIND.GFX1]: gfx1View,
  [KIND.FONTBIN]: fontbinView,
  [KIND.ARCHIVE]: archiveView,
  [KIND.MAP]: mapView,
  [KIND.TILETABLE]: tileTableView,
  [KIND.TILEBANK]: tileBankView,
  [KIND.VEHICLE]: vehicleView,
  [KIND.BITSFILE]: bitsfileView,
  [KIND.SOUND]: soundView,
  [KIND.LEVBRK]: levBrkView,
  [KIND.GLOBALDATA]: globalDataView,
  [KIND.SETTINGS]: globalDataView,
  [KIND.PROBE]: probeView,
}

const ZOOMS = [1, 2, 3, 4, 5, 6, 8]

export class App {
  constructor(dom) {
    this.dom = dom
    this.source = new FetchSource('/game')
    this.zoom = 2
    this.present = null
    this.selected = null
    this.selectedTool = null
    /** Per-view UI state that should survive switching assets (chosen tab, probe width…). */
    this.state = {}
  }

  async start() {
    this.#initControls()
    await this.#connect()
    this.#openFromHash()
    window.addEventListener('hashchange', () => this.#openFromHash())
  }

  /** Deep link: #GAME1/ROUND1.PAL opens that asset directly; #tools/engine-tables opens a tool page. */
  #openFromHash() {
    const path = decodeURIComponent(location.hash.replace(/^#/, '')).trim()
    if (!path) return
    if (path.startsWith('tools/')) {
      const id = path.slice('tools/'.length)
      if (TOOLS[id] && id !== this.selectedTool) this.openTool(id)
      return
    }
    if (path.toLowerCase() === this.selected?.path.toLowerCase()) return
    const entry = byPath(path)
    if (entry) this.open(entry)
  }

  #initControls() {
    const { zoomSelect, pickButton, dropZone } = this.dom
    for (const z of ZOOMS) zoomSelect.append(el('option', { value: String(z), selected: z === this.zoom || undefined }, `${z}×`))
    zoomSelect.addEventListener('change', () => { this.zoom = Number(zoomSelect.value); this.#rerender() })

    if (DirectorySource.supported) {
      pickButton.hidden = false
      pickButton.addEventListener('click', async () => {
        try { this.source = await DirectorySource.pick() } catch { return }
        await this.#connect()
      })
    }
    for (const ev of ['dragover', 'dragenter']) dropZone.addEventListener(ev, (e) => { e.preventDefault(); dropZone.classList.add('drag') })
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag'))
    dropZone.addEventListener('drop', async (e) => {
      e.preventDefault()
      dropZone.classList.remove('drag')
      const files = [...e.dataTransfer.files]
      if (!files.length) return
      this.source = new DropSource(files)
      await this.#connect()
    })
  }

  async #connect() {
    const { status } = this.dom
    status.textContent = `${this.source.description} — probing…`
    try {
      this.present = await this.source.available(CATALOG.map((e) => e.path))
    } catch (err) {
      status.textContent = `${this.source.description}: ${err.message}`
      this.present = new Set()
    }
    const n = CATALOG.filter((e) => this.present.has(e.path.toLowerCase())).length
    status.textContent = `${this.source.description} — ${n}/${CATALOG.length} catalogued files present`
    this.#renderSidebar()
    if (n === 0) {
      clear(this.dom.view).append(el('p', { class: 'placeholder' },
        'No game files found. In dev, `npm run dev` serves game/ over HTTP; otherwise open your own copy with “Open game folder…” or drop the folder here.'))
    }
  }

  #renderSidebar() {
    const { sidebar } = this.dom
    clear(sidebar)
    const toolList = el('ul', {})
    for (const [id, tool] of Object.entries(TOOLS)) {
      toolList.append(el('li', {
        class: `asset status-decoded${this.selectedTool === id ? ' selected' : ''}`,
        title: tool.label,
        onclick: () => this.openTool(id),
      }, el('span', { class: 'dot' }), tool.label))
    }
    sidebar.append(el('details', { open: true }, el('summary', {}, 'Tools'), toolList))
    for (const family of FAMILY_ORDER) {
      const entries = CATALOG.filter((e) => e.family === family)
      if (!entries.length) continue
      const list = el('ul', {})
      for (const e of entries) {
        const present = this.present?.has(e.path.toLowerCase())
        list.append(el('li', {
          class: `asset status-${e.status}${present ? '' : ' missing'}${this.selected === e ? ' selected' : ''}`,
          title: e.note || e.path,
          onclick: () => present && this.open(e),
        }, el('span', { class: 'dot' }), e.path))
      }
      sidebar.append(el('details', { open: true }, el('summary', {}, FAMILY_LABEL[family], ' ', el('span', { class: 'count' }, `(${entries.length})`)), list))
    }
  }

  async open(entry) {
    this.selected = entry
    this.selectedTool = null
    history.replaceState(null, '', `#${encodeURIComponent(entry.path)}`)
    this.#renderSidebar()
    await this.#rerender()
  }

  /** Open a non-file "Tools" page (src/ui/app.js's TOOLS map), e.g. the Engine tables view. */
  openTool(id) {
    const tool = TOOLS[id]
    if (!tool) return
    this.selected = null
    this.selectedTool = id
    history.replaceState(null, '', `#tools/${id}`)
    this.#renderSidebar()
    const view = clear(this.dom.view)
    view.append(el('div', { class: 'view-head' }, el('h2', {}, tool.label)))
    try {
      tool.render(view, { zoom: this.zoom, state: this.state, source: this.source })
    } catch (err) {
      view.append(el('p', { class: 'error' }, `${tool.label}: ${err.message}`))
      console.error(err)
    }
  }

  async #rerender() {
    const entry = this.selected
    if (!entry) return
    const view = clear(this.dom.view)
    view.append(el('p', { class: 'placeholder' }, `Loading ${entry.path}…`))
    let bytes
    try {
      bytes = await this.source.read(entry.path)
    } catch (err) {
      clear(view).append(el('p', { class: 'error' }, `${entry.path}: ${err.message}`))
      return
    }
    clear(view)
    view.append(el('div', { class: 'view-head' }, el('h2', {}, entry.path), el('span', { class: 'muted' }, ` ${fmtBytes(bytes.byteLength)} · ${entry.status}`)))
    const render = VIEWS[entry.kind] ?? probeView
    try {
      await render(view, { bytes, entry, state: this.state, source: this.source, zoom: this.zoom })
    } catch (err) {
      view.append(el('p', { class: 'error' }, `${entry.kind} view failed: ${err.message}`))
      console.error(err)
    }
  }
}
