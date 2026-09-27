import { bootGame } from './frontend/flow.js'
import { applyDevFlag } from './devFlag.js'

applyDevFlag() // before the elements are looked up: without ?dev the dev toggles don't exist

const canvas = document.getElementById('game-canvas')
const statusEl = document.createElement('p') // page has no visible status line; flow.js writes to this detached sink
const pickButton = document.getElementById('pick-folder')
const dropZone = document.getElementById('stage')
const oplStrictCheckbox = document.getElementById('opl-strict')
const lapLineToggle = document.getElementById('lapline-toggle')
const zoomSelect = document.getElementById('zoom')

const BASE_W = 256, BASE_H = 200 // MENU_VIEW's native size -- the page's old fixed 512x400 display was already 2x of this
canvas.style.boxSizing = 'content-box' // override the page's `* { box-sizing: border-box }`, so the 1px .race-canvas border doesn't eat into the sizes below and throw off integer-pixel zoom
const BORDER = 2 // .race-canvas's 1px border, both sides
const topbar = document.querySelector('.topbar')
const STAGE_PAD = 32 // .stage's padding, both sides
function applyZoom() {
  if (zoomSelect.value === 'max') {
    const availW = window.innerWidth - STAGE_PAD - BORDER
    const availH = window.innerHeight - topbar.getBoundingClientRect().height - STAGE_PAD - BORDER
    const scale = Math.min(availW / BASE_W, availH / BASE_H)
    canvas.style.width = `${Math.floor(BASE_W * scale)}px`
    canvas.style.height = `${Math.floor(BASE_H * scale)}px`
  } else {
    const n = Number(zoomSelect.value)
    canvas.style.width = `${BASE_W * n}px`
    canvas.style.height = `${BASE_H * n}px`
  }
}
zoomSelect.addEventListener('change', applyZoom)
window.addEventListener('resize', () => { if (zoomSelect.value === 'max') applyZoom() })
applyZoom()

bootGame({ canvas, statusEl, pickButton, dropZone, oplStrictCheckbox, lapLineToggle }).then((session) => {
  globalThis.mmGame = session // handy from the console (session.getPhase()/getTournament() for debugging)
}).catch((err) => {
  statusEl.textContent = `Failed to start: ${err.message}`
  console.error(err)
})
