// CheckCheatSpotsThenPause (1000:35f0), docs/engine.md §9q. SPACE (key slot 14, [107C] bit 1,
// docs/engine.md §6) is a genuine pause, not a UI-only feature: on press it scans for a nearby
// cheat spot and applies its effect once, then freezes the race behind a "Paused!" banner
// (PH0_LAYOUT.bannerText[5]) for a minimum hold before it can resume. The function's own first two
// instructions are sound-driver commands (docs/sound.md's dispatch table lists both call sites by
// address): `AH=8 CmdStopSfx` then `AH=6 CmdRequestReset` (a full driver reset -- both sfx queues
// cleared, the silence list written, all 16 voice slots freed, current tune reset) -- ported here as
// `sound.stopSfx(0)`/`sound.muteAll()` on the pause-ENTRY edge only, matching `raceOverSequence`'s
// own "whatever AL holds" precedent for the stopSfx argument. Without this, engines would otherwise
// keep droning at their last pitch for the whole pause, since `updateEngines` simply isn't called
// while physics is frozen -- silence, not a frozen last pitch, is what the real game does here.
//
// UNKNOWN_pause_exact_timing / UNKNOWN_tick_counter_writers resolved 2026-09-22 (docs/engine.md §9v,
// upgraded to [PROVEN]): [0002] and [261F] share ONE incrementer (1000:48D8, inside the timer ISR
// TimerIsrVsyncFallbackAndSoundTick), confirmed running at exactly 70.0 Hz in a race (a pre-existing
// live-verified comment at 1000:48FB this session re-used, not re-derived). The real function busy-
// waits for "≥140 ticks of [261F] AND a key release" (CheckCheatSpotsThenPause 1000:35F0, confirmed
// at 3790/37ED); at the now-confirmed rate, 140 ticks = EXACTLY 2.000 seconds -- this port's own
// chosen MIN_PAUSE_MS=2000 (below) is not a plausible guess, it is the precise real-world duration.
// This port has no busy-wait loop to port -- a browser keyboard is event-driven -- so the two-loop
// structure is still collapsed into one boolean state, just against an exact wall-clock value rather
// than an approximated one. Resumes automatically once BOTH the hold has elapsed AND SPACE is no
// longer held -- matching the real function's own "wait for both" framing, just against a wall-clock
// timer instead of a tick counter this port can't reproduce exactly.
//
// Deliberately cut, not ported (same precedent as M3.10 cutting the F12 SCRE0.RAW dump): the
// debug-only key-combo backdoor this function's caller also gates alongside the real pause path.

import { findCheatSpot, applyCheatEffect } from './cheats.js'

const MIN_PAUSE_MS = 2000
const CHEAT_FLASH_MS = 100 // the real "near-instantaneous" white flash on a cheat-spot match, given a floor a human can actually perceive

export function createPauseState() {
  return { paused: false, elapsedMs: 0, cheatFlashMs: 0 }
}

/**
 * Call once per rendered frame (not per physics step -- pausing must work even though physics is
 * frozen while `state.paused`). `dtMs`: real elapsed time since the last call. `spacePressed`: an
 * edge, true exactly once per fresh SPACE press (`input.js`'s `createPauseKeyReader`).
 * `spaceHeld`: the level, for the release-gate. `sound`: optional, `{stopSfx(id), muteAll()}`
 * (`Si2Player`/`asDriver`'s shape, `engine/sound.js`) -- silences the race on pause entry, matching
 * `35f0`'s own opening AH=8/AH=6 pair (see module header). Mutates `state` in place; returns
 * `state.paused`.
 */
export function updatePause(state, dtMs, spacePressed, spaceHeld, car, cheats, round, race, globalState, sound) {
  if (state.cheatFlashMs > 0) state.cheatFlashMs = Math.max(0, state.cheatFlashMs - dtMs)

  if (!state.paused) {
    if (spacePressed) {
      state.paused = true
      state.elapsedMs = 0
      sound?.stopSfx(0)
      sound?.muteAll()
      const spot = findCheatSpot(cheats ?? [], car, round, race)
      if (spot) {
        applyCheatEffect(car, spot, globalState)
        state.cheatFlashMs = CHEAT_FLASH_MS
      }
    }
    return state.paused
  }

  state.elapsedMs += dtMs
  if (state.elapsedMs >= MIN_PAUSE_MS && !spaceHeld) state.paused = false
  return state.paused
}
