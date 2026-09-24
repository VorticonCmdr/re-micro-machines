// Palette fade -- PaletteFadeToBlack (1000:327a) / PaletteFadeUpFromBlack (1000:32ce), docs/engine.md
// §9q. Both re-disassembled live this session (1000:327a-3332): each is a busy loop of 126 calls to
// a shared per-tick routine that OUTs the whole 768-byte DAC straight to ports 3C8h/3C9h with no
// INT 1Ah/vsync wait anywhere in either function -- so the loop's real-world duration is bound
// purely by 1994 CPU speed and has no derivable value to port. The per-tick routine itself only
// touches the DAC bytes (±1 per channel, floor/ceil at 0/max) on every OTHER call (a `SHR CX,1; JC`
// halving trick), so a 126-call loop is 63 real DAC steps wrapped in 126 VGA uploads -- confirms the
// "no vsync pacing, ~63 real steps" reading from this session's earlier research pass.
//
// The fade-OUT (the race end, docs/engine.md §9an) now follows the bytes' own arithmetic: each 6-bit
// value minus k, k = 1..63 over the chosen duration. The fade-IN keeps the older ratio ramp over the
// race scene; in the original the race-start fade-up (39F0) runs over a black screen, so the first
// race frame simply appears at full palette -- an open item, not reproduced here.
//
// Reimplemented as a per-frame incremental state machine with a CHOSEN, documented duration (no
// derivable one exists to copy) operating on the palette's own 6-bit DAC bytes, not the 8-bit RGBA
// this port renders with (`.PAL` is used verbatim as 6-bit, `formats/pal.js`) -- ramping the
// converted 8-bit values would be a visibly different (smoother) curve, not the same algorithm at a
// different rate. The continuous per-frame interpolation below (rather than literally stepping by
// fixed byte decrements on a fixed tick) is the same kind of mathematically-equivalent, documented
// simplification already used for the projectile's flight motion (engine/projectile.js) -- a
// variable-framerate rAF loop has no natural "tick" to hang a literal ±1-per-tick replica on.

import { toU8 } from '../formats/bytes.js'

const FADE_MS = 800 // chosen -- shorter than the pause's own chosen 2000ms hold (engine/pause.js), since a fade is a transition, not a deliberate pause

export function createFadeState(direction = 'in') {
  return { active: true, direction, elapsedMs: 0 }
}

export function updateFade(state, dtMs) {
  if (!state || !state.active) return
  state.elapsedMs += dtMs
  if (state.elapsedMs >= FADE_MS) state.active = false
}

/**
 * `dac6`: the raw 768-byte 6-bit-per-channel palette -- a `.PAL` file's own bytes (`ArrayBuffer` or
 * `Uint8Array`, same as every other raw-file consumer in this codebase, normalised via `toU8` like
 * `formats/race.js`/`decodePalette` do), NOT `decodePalette(...).rgb`. Returns a new scaled 6-bit
 * buffer to pass through `decodePalette` -- identity (the normalised `dac6` itself) only when
 * there's no fade at all, or a finished fade-IN (settled at the real palette); a finished fade-OUT
 * still needs to compute (settled at all-zero, not `dac6`), so this deliberately does NOT gate on
 * `state.active` -- `elapsedMs` alone, clamped, is what decides the output; `active` is purely a
 * signal for the CALLER to stop bothering to call `updateFade`. Safe to call unconditionally every
 * frame, active or not.
 */
export function applyFade(dac6, state) {
  const b = toU8(dac6)
  if (!state) return b
  const t = Math.min(1, Math.max(0, state.elapsedMs / FADE_MS))
  if (state.direction === 'out') {
    // PaletteFadeToBlack 327A/32AE: 126 uploads, and on every other one each nonzero DAC byte is
    // decremented (32C4) -- shown value = max(0, v - k), k = 1,1,2,2..63,63 (docs/engine.md §9an).
    const k = Math.min(63, 1 + Math.floor(t * 63))
    const out = new Uint8Array(b.length)
    for (let i = 0; i < b.length; i++) out[i] = Math.max(0, b[i] - k)
    return out
  }
  const progress = t
  if (progress >= 1) return b
  const out = new Uint8Array(b.length)
  for (let i = 0; i < b.length; i++) out[i] = Math.floor(b[i] * progress)
  return out
}
