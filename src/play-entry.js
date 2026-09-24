import { bootRace } from './play.js'

const canvas = document.getElementById('race-canvas')
const statusEl = document.getElementById('race-status')
const pickButton = document.getElementById('pick-folder')
const dropZone = document.getElementById('stage')
const oplStrictCheckbox = document.getElementById('opl-strict')
const smoothnessSelect = document.getElementById('smoothness')
const projectilesToggle = document.getElementById('projectiles-toggle')
const lapLineToggle = document.getElementById('lapline-toggle')

bootRace({ canvas, statusEl, pickButton, dropZone, oplStrictCheckbox, smoothnessSelect, projectilesToggle, lapLineToggle }).then((session) => {
  globalThis.mmRace = session // handy from the console (session.getTape() for the recorded input)
}).catch((err) => {
  statusEl.textContent = `Failed to start: ${err.message}`
  console.error(err)
})
