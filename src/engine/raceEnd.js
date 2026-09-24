// The real race exit after `RunRaceMainLoop`'s last physics step (docs/engine.md §9an): `30DF` sfx 16
// (`sound.js` `raceOverStart`), then `30F2-3100` holds for 100 IRQ0 ticks (`3165` waits one 70 Hz tick
// per iteration, ~1.43 s) re-copying the LAST presented frame to the screen -- nothing is re-rendered,
// and no banner shows (855A's blit goes through ES, which is not the back buffer there) -- then
// `3102`/`3109` AH=8/AH=6 (`raceOverEnd`), and `315A` fades the frozen frame to black (327A). Input,
// ESC included, is not read during the hold. The page keeps the last canvas and drives this state
// machine off real time; `fade` is the fade-out to apply to the frozen frame's palette.

import { createFadeState, updateFade } from './fade.js'
import { raceOverEnd } from './sound.js'

export const RACE_END_HOLD_MS = (100 * 1000) / 70

export function createRaceEndState() {
  return { phase: 'hold', elapsedMs: 0, fade: null }
}

/** Advance by `dtMs` of real time: 'hold' -> (AH=8/AH=6) 'fade' -> 'done'. */
export function updateRaceEnd(state, dtMs, sound) {
  if (state.phase === 'hold') {
    state.elapsedMs += dtMs
    if (state.elapsedMs >= RACE_END_HOLD_MS) {
      if (sound) raceOverEnd(sound)
      state.phase = 'fade'
      state.fade = createFadeState('out')
    }
  } else if (state.phase === 'fade') {
    updateFade(state.fade, dtMs)
    if (!state.fade.active) state.phase = 'done'
  }
  return state
}
