// Palette fade -- PaletteFadeToBlack (1000:327a) / PaletteFadeUpFromBlack (1000:32ce), docs/engine.md
// §9q/§9co. Both are busy loops around a shared upload (`331F`: the whole 768-byte DAC straight to
// ports 3C8h/3C9h) with no INT 1Ah/vsync/tick wait anywhere, so their length is bound by CPU speed:
// - `327A` (gated on `[26CE]!=1`, sets it): reads the DAC (INT 10h AX=1017h), then 126 calls to
//   `32AE`; on every call with CX even each nonzero byte is decremented (`32C4`), so the shown value
//   is max(0, v - k), k = 1,1,2,2..63,63.
// - `32CE` (gated on `[26CE]==1`, clears it): zeroes the shown buffer, then 128 calls to `3303` (CX
//   0..0x7F), each even one stepping every byte +1 toward the target palette.
//
// Durations: `[PROVEN]` under the project's DOSBox (docs/engine.md §9co), from execute breakpoints on
// the entry and exit of each and the 70 Hz ISR counter `[261F]`: the race setup's `395D` fade-out
// took 16 ticks, the race start's `39F0` fade-up 17. They are that CPU setting's numbers, not a
// constant of the game; the port uses them.
//
// The race start (`39F0 -> 32CE`) runs over VRAM zeroed at `3963-396D`, and every ROUNDn.PAL entry 0
// is black, so the screen stays black for the whole fade-up and the first race frame appears at full
// palette at the loop's first flip (docs/engine.md §9an 8). Nothing steps during it: the main loop
// has not started. So the 'in' state here is a black hold, not a ramp over the scene.
//
// The fade-out works on the palette's own 6-bit DAC bytes (`.PAL` is used verbatim as 6-bit,
// `formats/pal.js`), with k taken from the elapsed fraction rather than stepped per upload: a
// variable-framerate rAF loop has no natural tick to hang a literal per-upload replica on.

import { toU8 } from '../formats/bytes.js'

const TICK_MS = 1000 / 70 // the ISR's [261F] rate (docs/engine.md §9v)
export const FADE_OUT_TICKS = 16 // 327A, [PROVEN] live (§9co)
export const FADE_UP_TICKS = 17 // 32CE at 39F0, [PROVEN] live (§9co)
const durationMs = (direction) => (direction === 'out' ? FADE_OUT_TICKS : FADE_UP_TICKS) * TICK_MS

export function createFadeState(direction = 'in') {
  return { active: true, direction, elapsedMs: 0 }
}

export function updateFade(state, dtMs) {
  if (!state || !state.active) return
  state.elapsedMs += dtMs
  if (state.elapsedMs >= durationMs(state.direction)) state.active = false
}

/**
 * The race start's black hold, for the page loops: while the fade-up runs, advance it and drain the
 * pause key's press edge. `3074` tests SPACE's level at the first loop head, so a tap that is over by
 * then must not pause; a SPACE still held does, through `held`. Returns true while holding.
 */
export function raceStartHold(state, dtMs, pauseKey) {
  if (!state?.active || state.direction !== 'in') return false
  updateFade(state, dtMs)
  pauseKey?.read()
  return true
}

/**
 * `dac6`: the raw 768-byte 6-bit-per-channel palette -- a `.PAL` file's own bytes (`ArrayBuffer` or
 * `Uint8Array`, normalised via `toU8`), NOT `decodePalette(...).rgb`. Returns the 6-bit buffer to pass
 * through `decodePalette`: identity (the normalised `dac6` itself) when there is no fade, or once the
 * race-start hold is over; all zero while that hold runs; max(0, v - k) during a fade-out, settling at
 * all zero (so this does not gate on `state.active` for 'out'). Safe to call every frame.
 */
export function applyFade(dac6, state) {
  const b = toU8(dac6)
  if (!state) return b
  const t = Math.min(1, Math.max(0, state.elapsedMs / durationMs(state.direction)))
  if (state.direction === 'out') {
    const k = Math.min(63, 1 + Math.floor(t * 63))
    const out = new Uint8Array(b.length)
    for (let i = 0; i < b.length; i++) out[i] = Math.max(0, b[i] - k)
    return out
  }
  return t >= 1 ? b : new Uint8Array(b.length) // 39F0: black until the fade-up is over
}
