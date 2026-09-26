// SETTINGS.DAT's "smoothness" word (M3.10, docs/track-graphics.md, docs/sound.md §2/§8):
// `RunRaceMainLoop` always runs physics at 35 Hz, but only DRAWS every `n`th physics step
// (n = 1..4, AUTO=5 measures loops-per-retrace at startup and isn't modelled here) -- so display
// is 35/n fps while the simulation itself never slows down. This copy's `SETTINGS.DAT` holds
// n=1, and the options screen showed "SMOOTHNESS ... HIGH" for it (docs/boot-and-runtime.md) --
// i.e. the UI label is the INVERSE of the stored word (n=1 is the smoothest, most-often-redrawn
// setting, not the choppiest one a naive reading of "higher number = smoother" would suggest).
// `UNKNOWN_smoothness_label_map`, closed (docs/engine.md §9t, §9au): 1 HIGH, 2 GOOD, 3 MEDIUM, 4 LOW,
// and AUTO a fifth value that resolves at RETURN.
//
// On modern hardware there is no performance reason to skip draws -- this exists for parity with
// the original's own user-facing setting, not because the browser needs it.

export function createSmoothnessGate(initialN = 1) {
  let n = Math.max(1, Math.min(4, initialN | 0))
  let counter = 0
  return {
    get n() { return n },
    set n(value) { n = Math.max(1, Math.min(4, value | 0)); counter = 0 },
    /** Call once per physics step; returns true on the step that should be drawn. */
    shouldDraw() {
      counter++
      if (counter >= n) { counter = 0; return true }
      return false
    },
    /** `[2638]` as the next loop iteration will find it: `n` right after a present (3064/30DA),
     * counting down to 1 on the step that draws (90C5 draws only at 1, 30B7 decrements after it). */
    get countdown() { return n - counter },
    /** The pause's `MOV [2638],1` (37A0): the step after a pause always draws (docs/engine.md §9ck). */
    forceNextDraw() { counter = n - 1 },
  }
}
