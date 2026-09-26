// The PC speaker as DRIVER2 drives it (docs/sound.md §4b): PIT channel 2 in mode 3 is a square wave
// at 1193182/count while port 61h has both the gate and the data bit set; the driver changes the
// count only at its 70 Hz tick. Rendered here as a band-limited (polyBLEP) square, silent above
// Nyquist. Shared by the AudioWorklet (si2-worklet.js) and the offline renders (tools/render-tunes.mjs).
import { HOST_HZ } from '../formats/si2.js'

export const SPEAKER_LEVEL = 0.2 // the square wave's amplitude: a port choice (the real one is the speaker's)

/** PolyBLEP correction for a unit step at phase 0 (`t` in [0,1), `dt` the phase increment). */
function blep(t, dt) {
  if (t < dt) { const x = t / dt; return x + x - x * x - 1 }
  if (t > 1 - dt) { const x = (t - 1) / dt; return x * x + x + x + 1 }
  return 0
}

/** `driver`: a BeeperDriver (or NullDriver); its `hostTick()` runs at HOST_HZ inside `render`. */
export function createSpeaker(driver, sampleRate) {
  let tickAcc = 0
  let phase = 0
  return {
    render(out) {
      const dt = 1 / sampleRate
      for (let i = 0; i < out.length; i++) {
        if (tickAcc <= 0) { tickAcc += 1 / HOST_HZ; driver.hostTick() }
        tickAcc -= dt
        const f = driver.frequency
        if (!f || f >= sampleRate / 2) { out[i] = 0; continue }
        const inc = f / sampleRate
        phase = (phase + inc) % 1
        let v = phase < 0.5 ? 1 : -1
        v += blep(phase, inc) - blep((phase + 0.5) % 1, inc)
        out[i] = v * SPEAKER_LEVEL
      }
    },
  }
}
