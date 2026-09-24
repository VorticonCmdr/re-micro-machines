// Headless smoke test of the viewer: a minimal DOM shim, then every view is called the way
// src/ui/app.js calls it, against the real files in game/. One representative asset per
// (kind, round) plus every probe entry. A view fails if it throws, appends an .error element,
// appends nothing, or (for graphical kinds) produces no canvas with a non-zero width.
//   npm run smoke
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
class Node { constructor(tag){ this.tagName=tag; this.children=[]; this.attributes={}; this.style={}; this.dataset={}; this.classList={ _s:new Set(), add:(c)=>this.classList._s.add(c), toggle:(c,f)=>f?this.classList._s.add(c):this.classList._s.delete(c), remove:(c)=>this.classList._s.delete(c) } }
  append(...cs){ for (const c of cs.flat()) this.children.push(typeof c==='object'?c:{text:String(c)}) } appendChild(c){ this.children.push(c); return c }
  setAttribute(k,v){ this.attributes[k]=v } addEventListener(){} removeChild(c){ this.children=this.children.filter(x=>x!==c) } get firstChild(){ return this.children[0] }
  replaceChildren(){ this.children=[] } querySelectorAll(){ return [] } getContext(){ return { putImageData(){}, drawImage(){}, fillRect(){}, set fillStyle(v){}, set imageSmoothingEnabled(v){} } }
  set textContent(v){ this.children=[{text:v}] } get textContent(){ return this.children.map(c=>c.text||c.textContent||'').join('') } set className(v){ this.attributes.class=v } set hidden(v){}
  get width(){ return this._w||0 } set width(v){ this._w=v } get height(){ return this._h||0 } set height(v){ this._h=v } }
globalThis.document = { createElement:(t)=>new Node(t), createTextNode:(t)=>({text:t}) }
globalThis.ImageData = class { constructor(d,w,h){ this.data=d; this.width=w; this.height=h } }
globalThis.window = {}
globalThis.Node = Node
const { CATALOG, KIND } = await import('../src/data/catalog.js')
// VIEWS is not exported; import the views directly
const V = {
  [KIND.PALETTE]: (await import('../src/ui/views/paletteView.js')).paletteView,
  [KIND.GFX1]: (await import('../src/ui/views/gfx1View.js')).gfx1View,
  [KIND.FONTBIN]: (await import('../src/ui/views/fontbinView.js')).fontbinView,
  [KIND.ARCHIVE]: (await import('../src/ui/views/archiveView.js')).archiveView,
  [KIND.MAP]: (await import('../src/ui/views/trackView.js')).mapView,
  [KIND.TILETABLE]: (await import('../src/ui/views/trackView.js')).tileTableView,
  [KIND.TILEBANK]: (await import('../src/ui/views/raceGfxView.js')).tileBankView,
  [KIND.VEHICLE]: (await import('../src/ui/views/raceGfxView.js')).vehicleView,
  [KIND.BITSFILE]: (await import('../src/ui/views/raceGfxView.js')).bitsfileView,
  [KIND.PROBE]: (await import('../src/ui/views/probeView.js')).probeView,
  [KIND.SOUND]: (await import('../src/ui/views/soundView.js')).soundView,
  [KIND.LEVBRK]: (await import('../src/ui/views/levBrkView.js')).levBrkView,
  [KIND.GLOBALDATA]: (await import('../src/ui/views/globalDataView.js')).globalDataView,
  [KIND.SETTINGS]: (await import('../src/ui/views/globalDataView.js')).globalDataView,
}
const source = { read: async (p) => { const b = readFileSync(join(ROOT, 'game', p)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length) } }
const state = {}
let ok = 0, fail = 0
const seen = new Set()
for (const e of CATALOG) {
  // One representative per kind+round+extension to keep it quick — dedup only ever exists to skip
  // "8 more of the same round-numbered file", so files with no ROUND in their name (globals like
  // STRT_POS.BIN/CHEATS.BIN, which previously also collided on kind+extension with each other) are
  // never deduped at all: each is its own key. See the pitfall in PLAN.md about this dedup key.
  const roundMatch = e.path.match(/ROUND\d/)?.[0]
  const key = roundMatch ? e.kind + roundMatch + (e.path.match(/\.\w+$/)?.[0] || '') : e.path
  if (seen.has(key) && e.kind !== KIND.PROBE) continue
  seen.add(key)
  const container = new Node('div')
  try {
    const bytes = await source.read(e.path)
    await V[e.kind](container, { bytes, entry: e, state, source, zoom: 2 })
    const walk = (n, out) => { if (!n || typeof n !== 'object') return out; if (n.tagName) out.nodes.push(n); if (n.text) out.texts.push(n.text); for (const c of n.children || []) walk(c, out); return out }
    const { nodes, texts } = walk(container, { nodes: [], texts: [] })
    const errs = nodes.filter(n => (n.attributes.class || '').includes('error'))
    const canvases = nodes.filter(n => n.tagName === 'canvas').map(n => n._w || 0)
    const expectsCanvas = e.kind !== KIND.PROBE && e.kind !== KIND.PALETTE && e.kind !== KIND.SOUND && e.kind !== KIND.SETTINGS
    const emptyCanvas = expectsCanvas && !canvases.some(w => w > 0)
    if (errs.length) { fail++; console.log('VIEW ERROR', e.path, texts.filter(t => /failed|rror/.test(t)).slice(0,2)) }
    else if (!container.children.length) { fail++; console.log('EMPTY VIEW', e.path) }
    else if (emptyCanvas) { fail++; console.log('NO NON-EMPTY CANVAS', e.path, e.kind, canvases) }
    else ok++
  } catch (err) { fail++; console.log('THROW', e.path, e.kind, err.message) }
}
console.log(`views ok ${ok}, failed ${fail}`)
process.exitCode = fail ? 1 : 0
