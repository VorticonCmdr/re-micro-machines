// The front end's palette fades and the flag that gates them, `[26CE]` (docs/engine.md §9cp).
//
// `[26CE]` is 1 once a `327A` fade-out has left the DAC black, and only the two fade routines touch
// it (a byte scan for disp16 0x26CE: `3284`/`328B` in 327A, `32D8`/`32DF` in 32CE). `327A` runs at
// the race exit (`315A`) and at race setup (`395A`, skipped when the flag is already 1); `32CE` runs
// at the race start (`39F0`) and at the entry of six front-end screens, and fades only while the
// flag is 1, clearing it. After a race, `26C0 -> 26EC` loads INTRO.PAL straight into the DAC over a
// black screen, so the first of those screens fades up (17 ticks, §9co) and every later one doesn't:
// - the title (`01A9`), the race intro (`12B7`/`12DF`), the results (`1546`), the outcome message
//   (`1D82`/`1E01`) and the two-human result (`2641`) present their first frame, then fade up;
// - the champion screen's `1BCF` comes before its first present (`1BD3`), so it holds black, then
//   shows at full palette.
// Each call is a busy loop: the screen's own logic starts after it, while the ISR keeps latching key
// releases. Screens whose port entry did something the original does after the fade pass it as
// `onDone`.

import { createFadeState, updateFade, applyFade } from '../engine/fade.js'

export function createDacFadeState() {
  return { faded: false, screen: null } // faded: [26CE]; screen: { fade, onDone } while a 32CE runs
}

/** 395A: the fade-out of the screen before the race (a fade state), or null when [26CE] is already
 * 1. Either way [26CE] is 1 afterwards. */
export function raceSetupFade(d) {
  const fade = d.faded ? null : createFadeState('out')
  d.faded = true
  return fade
}

/** 39F0: the race start's own 32CE clears [26CE] (its black hold is fade.js's raceStartHold). */
export function raceStartFadeUp(d) { d.faded = false }

/** 315A: the race exit's 327A (the ESC exit's too) sets [26CE]. */
export function raceExitFade(d) { d.faded = true }

/** A screen's own 32CE at its entry: 'up' over the presented screen, 'in' (black) for the champion.
 * A no-op unless [26CE] is 1. Returns whether a fade started. */
export function beginScreenFadeUp(d, kind = 'up', onDone = null) {
  if (!d.faded) return false
  d.faded = false // 32DD
  d.screen = { fade: createFadeState(kind), onDone }
  return true
}

/** Advance a running screen fade by `dtMs`. Returns true while the screen's logic stays frozen; on
 * the call that ends it, runs `onDone` and returns false. */
export function screenFadeStep(d, dtMs) {
  if (!d.screen) return false
  updateFade(d.screen.fade, dtMs)
  if (d.screen.fade.active) return true
  const { onDone } = d.screen
  d.screen = null
  onDone?.()
  return false
}

/** The 6-bit palette to show a front-end screen with right now. */
export function screenPalette(d, dac6) {
  return d.screen ? applyFade(dac6, d.screen.fade) : dac6
}
