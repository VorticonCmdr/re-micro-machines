import { bootGame } from './frontend/flow.js'

const canvas = document.getElementById('game-canvas')
const statusEl = document.getElementById('game-status')
const pickButton = document.getElementById('pick-folder')
const dropZone = document.getElementById('stage')
const oplStrictCheckbox = document.getElementById('opl-strict')
const smoothnessSelect = document.getElementById('smoothness')
const lapLineToggle = document.getElementById('lapline-toggle')

bootGame({ canvas, statusEl, pickButton, dropZone, oplStrictCheckbox, smoothnessSelect, lapLineToggle }).then((session) => {
  globalThis.mmGame = session // handy from the console (session.getPhase()/getTournament() for debugging)
}).catch((err) => {
  statusEl.textContent = `Failed to start: ${err.message}`
  console.error(err)
})
