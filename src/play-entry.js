import { bootRace } from './play.js'
import { applyDevFlag } from './devFlag.js'
import { raceFromQuery } from './editor/overlaySource.js'
import { RACES } from './editor/model.js'
import { trackName, TITLE_CLASS_NAMES } from './data/frontend-tables.js'

applyDevFlag() // before the elements are looked up: without ?dev the dev toggles don't exist

const canvas = document.getElementById('race-canvas')
const statusEl = document.getElementById('race-status')
const pickButton = document.getElementById('pick-folder')
const dropZone = document.getElementById('stage')
const oplStrictCheckbox = document.getElementById('opl-strict')
const smoothnessSelect = document.getElementById('smoothness')
const projectilesToggle = document.getElementById('projectiles-toggle')
const lapLineToggle = document.getElementById('lapline-toggle')
const roundSelect = document.getElementById('round-select')
const raceSelect = document.getElementById('race-select')

// The level picker: `?round=&race=` (also the level editor's "Test race" hook, editor/overlaySource.js)
// drives which of the 29 tracks this page boots into, defaulting to ROUND21 (round 2 race 1).
const { round: initialRound, race: initialRace } = raceFromQuery(location.search, RACES, { round: 2, race: 1 })
for (let round = 1; round <= 9; round++) roundSelect.append(new Option(`Round ${round} — ${TITLE_CLASS_NAMES[round - 1]}`, String(round), false, round === initialRound))
function populateRaces(round, selected) {
  raceSelect.replaceChildren()
  for (let race = 1; race <= RACES[round]; race++) {
    const name = trackName(round, race) || (round === 2 && race === 1 ? 'Qualifier' : `Race ${race}`)
    raceSelect.append(new Option(`${race}. ${name}`, String(race), false, race === selected))
  }
}
populateRaces(initialRound, initialRace)
function navigateToSelection() {
  const params = new URLSearchParams(location.search)
  params.set('round', roundSelect.value)
  params.set('race', raceSelect.value)
  location.search = params.toString()
}
roundSelect.addEventListener('change', () => { populateRaces(Number(roundSelect.value), 1); navigateToSelection() })
raceSelect.addEventListener('change', navigateToSelection)

bootRace({ canvas, statusEl, pickButton, dropZone, oplStrictCheckbox, smoothnessSelect, projectilesToggle, lapLineToggle }).then((session) => {
  globalThis.mmRace = session // handy from the console (session.getTape() for the recorded input)
}).catch((err) => {
  statusEl.textContent = `Failed to start: ${err.message}`
  console.error(err)
})
