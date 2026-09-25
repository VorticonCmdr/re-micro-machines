// The real race exit after `RunRaceMainLoop`'s last physics step (docs/engine.md §9an): `30DF` sfx 16
// (`sound.js` `raceOverStart`), then `30F2-3100` holds for 100 IRQ0 ticks (`3165` waits one 70 Hz tick
// per iteration, ~1.43 s) re-copying the LAST presented frame to the screen -- nothing is re-rendered,
// and no banner shows (855A's blit goes through ES, which is not the back buffer there) -- then
// `3102`/`3109` AH=8/AH=6 (`raceOverEnd`), and `315A` fades the frozen frame to black (327A). Input,
// ESC is not tested during the hold, but the keyboard ISR still latches an ESC release into
// `[0x1096]`, and nothing clears it before the caller's own test (`11CA`/`2185`), so an ESC released
// during the hold or the fade still ends at the title screen (docs/engine.md §9ca). The page keeps the
// last canvas and drives this state machine off real time; `fade` is the fade-out to apply to the
// frozen frame's palette.
//
// The ESC quit (docs/engine.md §9ca): `KeyboardIsr 2F59-2F5E` sets `[0x1096]=1` on an ESC key RELEASE
// (never on the press); `RunRaceMainLoop`'s loop head (`3067`) then jumps straight to `3115`, past
// `30DF-3113` -- no sfx 16, no 100-tick hold, no AH=8/AH=6 -- into the same `327A` fade to black. The
// engine voices keep their last pitch through it (nothing updates or stops them) until the title's
// own entry silences the driver.

import { createFadeState, updateFade } from './fade.js'
import { raceOverEnd } from './sound.js'

export const RACE_END_HOLD_MS = (100 * 1000) / 70

/** `esc`: the ESC quit's own exit (`3067 -> 3115`): straight into the fade, no hold. */
export function createRaceEndState({ esc = false } = {}) {
  if (esc) return { phase: 'fade', elapsedMs: 0, fade: createFadeState('out'), esc: true }
  return { phase: 'hold', elapsedMs: 0, fade: null, esc: false }
}

/** `[0x1096]`, the ESC-release latch (`KeyboardIsr 2F59-2F5E`), for one race: set by an ESC keyup
 * only, cleared only by creating a new one (`InitRaceCarsFromTables 3CB6` clears it at race setup). */
export function createEscQuitLatch(target) {
  const latch = { latched: false, dispose }
  function onUp(e) { if (e.code === 'Escape') latch.latched = true }
  target.addEventListener('keyup', onUp)
  function dispose() { target.removeEventListener('keyup', onUp) }
  return latch
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
