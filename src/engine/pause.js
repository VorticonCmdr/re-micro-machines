// CheckCheatSpotsThenPause (1000:35f0), docs/engine.md §9q. SPACE (key slot 14, [107C] bit 1,
// docs/engine.md §6) is a genuine pause, not a UI-only feature: on press it scans for a nearby
// cheat spot and applies its effect once, then freezes the race behind a "Paused!" banner
// (PH0_LAYOUT.bannerText[5]) until a key release gets through the ISR's gate (below). The function's own first two
// instructions are sound-driver commands (docs/sound.md's dispatch table lists both call sites by
// address): `AH=8 CmdStopSfx` then `AH=6 CmdRequestReset` (a full driver reset -- both sfx queues
// cleared, the silence list written, all 16 voice slots freed, current tune reset) -- ported here as
// `sound.stopSfx(0)`/`sound.muteAll()` on the pause-ENTRY edge only (AL is whatever it holds at
// that call site; 0 is a no-op push). Without this, engines would otherwise
// keep droning at their last pitch for the whole pause, since `updateEngines` simply isn't called
// while physics is frozen -- silence, not a frozen last pitch, is what the real game does here.
//
// How it ends (docs/engine.md §9cl, a full re-read of `3753-37FB`, correcting §9q/§9v's "a 140-tick
// minimum AND a key release"):
// - entry (`3074`): SPACE HELD at the loop head (`[107C]` bit 0x2, a level test, not an edge);
// - `377F`/`3784` clear the ISR's release latch `[107E]` and tracked key `[107F]` (the caller does
//   that on the entry edge, `menuReleaseTracker.clearIsrLatch`) -- so a quick SPACE tap's own
//   release does NOT get through the gate; a SPACE held until keyboard auto-repeat re-tracks it
//   does, and so does any later key's press+release;
// - stage 1 (`3789-3796`): until that gate passes (`[107E]!=0`) or `[261F]` reaches 140 ticks;
//   then `[2633]=2`, `[2638]=1`, a render into the back buffer (not presented) and a second
//   `AH=8`/`AH=6`;
// - stage 2 (`37B8`): until the gate passes -- no timeout;
// - only with the `25011968` flag (`37BF`, DS:0F69) and round != 9 (`37C7`), and when the released key
//   isn't F12 (`37CE`, the SCRE0.RAW dump -- cut in this port): poll until `[261F]` >= 140 (`37ED`),
//   i.e. a 140-tick (exactly 2.000 s at the ISR's 70 Hz, §9v) minimum. Without the flag there is no
//   minimum at all: the pause ends at the first gated release.
// Not ported here: that poll's F1+F2 / F2+F3 combos (`37D7-37EA`, GOAL-DOS-PARITY.md P5).

import { findCheatSpot, applyCheatEffect } from './cheats.js'

const CHEAT_MIN_PAUSE_MS = 2000 // 140 ticks of [261F] at 70 Hz (37ED), only with the 25011968 flag
const CHEAT_FLASH_MS = 100 // the real "near-instantaneous" white flash on a cheat-spot match, given a floor a human can actually perceive

export function createPauseState() {
  return { paused: false, elapsedMs: 0, stage1: false, cheatFlashMs: 0 }
}

/**
 * Call once per rendered frame (physics is frozen while paused). `dtMs`: real elapsed time since the
 * last call. `input`: `{ spaceHeld, released, cheatFlag }` -- SPACE's level (the entry test), the key
 * code whose release got through the ISR's gate since the caller's last `clearIsrLatch` (the mirrored
 * `[107E]`, null if none), and DS:0F69. `sound`: optional `{stopSfx(id), muteAll()}` -- `35F0`'s own
 * opening AH=8/AH=6 on entry, and `37AA`/`37B3`'s again at the end of stage 1. Mutates `state`;
 * returns `state.paused`. The caller clears the ISR latch on the entry edge (377F/3784).
 */
export function updatePause(state, dtMs, input, car, cheats, round, race, globalState, sound) {
  const { spaceHeld = false, released = null, cheatFlag = false } = input ?? {}
  if (state.cheatFlashMs > 0) state.cheatFlashMs = Math.max(0, state.cheatFlashMs - dtMs)

  if (!state.paused) {
    if (spaceHeld) { // 3074: TEST [107C],2 -- held, at the loop head
      state.paused = true
      state.elapsedMs = 0
      state.stage1 = true
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
  if (state.stage1 && (released != null || state.elapsedMs >= CHEAT_MIN_PAUSE_MS)) { // 3789-3796
    state.stage1 = false
    sound?.stopSfx(0) // 37AA
    sound?.muteAll() // 37B3
  }
  if (released == null) return true // 37B8: no timeout
  if (cheatFlag && round !== 9 && released !== 'F12' && state.elapsedMs < CHEAT_MIN_PAUSE_MS) return true // 37BF-37F3
  state.paused = false // 37F5
  return false
}
