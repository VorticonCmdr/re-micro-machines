// Render the game's tunes (and optionally sfx) to WAV through the JS driver model + OPL2 core, at the
// chip's native 49716 Hz, ticking the sequencer at the game's 70.06 Hz. Then LISTEN — and let the
// tool check what it can: that the strongest spectral peaks in the first second sit at the pitches
// the sequencer reports (a wrong phase-increment or table bug shows up here as an off-pitch peak).
//   node tools/render-tunes.mjs [tune ...] [--seconds N] [--sfx id ...]
import { readFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Driver, Sequencer, HOST_HZ, oplFreqHz } from '../src/formats/si2.js'
import { Opl2, OPL_RATE } from '../src/audio/opl2.js'
import { saveWav } from './wav.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'tools', 'out')
mkdirSync(OUT, { recursive: true })
const args = process.argv.slice(2)
const secIdx = args.indexOf('--seconds')
const seconds = secIdx >= 0 ? Number(args[secIdx + 1]) : 12
const sfxIdx = args.indexOf('--sfx')
// stop at the next --flag so `--sfx 1 2 --seconds 3` doesn't swallow "--seconds 3" as more ids
let sfxEnd = args.findIndex((a, i) => i > sfxIdx && a.startsWith('--'))
if (sfxEnd < 0) sfxEnd = args.length
const sfxIds = sfxIdx >= 0 ? args.slice(sfxIdx + 1, sfxEnd).map(Number) : []
const tunes = args.filter((a, i) => /^\d+$/.test(a) && i !== secIdx + 1 && (sfxIdx < 0 || i < sfxIdx)).map(Number)
const list = tunes.length ? tunes : [1, 2, 3, 4, 5, 6, 7, 8]

const drv = new Driver(new Uint8Array(readFileSync(join(ROOT, 'game', 'DRIVER1.BIN'))))

function render(setup, secs) {
  const seq = new Sequencer(drv)
  const opl = new Opl2() // Nuked/OPL3 waveform behaviour, as the game sounded under the user's DOSBox
  seq.command(6) // the game always mutes-all before starting a tune
  // doPendingReset() (which zeroes BOTH sfx queues) and processSfxStartQueue() run in the same
  // hostTick(), in that order. Queuing an sfx via setup() before the reset has actually been
  // ticked once means the very first hostTick() call below would wipe the id straight back out
  // of the queue it was just pushed into, before ever starting it — 0 audible writes, only the
  // reset's init-register writes. Tick the pending reset through now, before setup() queues
  // anything, so a subsequently-queued sfx survives to be started. Harmless for tunes (pendingTune
  // isn't set yet, so this tick is a no-op beyond the reset).
  seq.hostTick()
  setup(seq)
  const total = Math.floor(secs * OPL_RATE)
  const out = new Float32Array(total)
  const samplesPerTick = OPL_RATE / HOST_HZ
  let nextTick = 0, wi = 0
  const notes = [] // (sample, hz) for the spectral check
  for (let i = 0; i < total; i++) {
    if (i >= nextTick) {
      nextTick += samplesPerTick
      const before = seq.writes.length, tlBefore = seq.timeline.length
      seq.hostTick()
      for (; wi < seq.writes.length; wi++) opl.write(seq.writes[wi][1], seq.writes[wi][2])
      for (const e of seq.timeline.slice(tlBefore)) {
        const m = /NOTE_ON .*?inst=(\d+) .*?\(([\d.]+) Hz\)/.exec(e.text)
        // pitch heard = channel frequency × the carrier's MULT (instrument byte 5 → reg 20 low nibble)
        if (m && e.tick === seq.tick) notes.push([i, Number(m[2]) * MULT[drv.instrument(Number(m[1]))[5] & 15]])
      }
    }
    out[i] = opl.sample()
  }
  return { out, seq, notes }
}

const MULT = [0.5, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 12, 12, 15, 15] // OPL reg 20 bits 0-3

/** Peak frequencies of a window via a plain DFT on 8192 samples (6 Hz bins; no deps). */
function peaks(buf, start, n = 8192, top = 8) {
  const re = new Float64Array(n / 2)
  for (let k = 1; k < n / 2; k++) {
    let sr = 0, si = 0
    for (let i = 0; i < n; i++) { const v = buf[start + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n)); const a = (2 * Math.PI * k * i) / n; sr += v * Math.cos(a); si -= v * Math.sin(a) }
    re[k] = Math.hypot(sr, si)
  }
  const idx = Array.from(re.keys()).filter((k) => k > 2 && re[k] > re[k - 1] && re[k] >= re[k + 1]).sort((a, b) => re[b] - re[a]).slice(0, top)
  return idx.map((k) => ({ hz: (k * OPL_RATE) / n, mag: re[k] }))
}

for (const t of list) {
  const { out, seq, notes } = render((s) => s.command(4, t), seconds)
  const path = join(OUT, `TUNE${t}.wav`)
  saveWav(path, out, OPL_RATE)
  const rms = Math.sqrt(out.reduce((a, v) => a + v * v, 0) / out.length)
  const peak = out.reduce((a, v) => Math.max(a, Math.abs(v)), 0)
  // spectral check on the first sounding window: the notes of the first tick that keyed anything on
  const firstNote = notes[0]
  let report = ''
  if (firstNote) {
    const pk = peaks(out, firstNote[0] + 2000)
    const bin = OPL_RATE / 8192
    const expected = [...new Set(notes.filter((n) => Math.abs(n[0] - firstNote[0]) < 200).map((n) => n[1]))]
    const hit = expected.filter((hz) => pk.some((p) => Math.abs(p.hz - hz) < bin * 0.75 || Math.abs(p.hz - 2 * hz) < bin * 0.75))
    report = ` | first chord ${expected.map((h) => h.toFixed(0)).join('/')} Hz → peaks ${pk.slice(0, 6).map((p) => p.hz.toFixed(0)).join(', ')} Hz (${hit.length}/${expected.length} matched)`
  }
  console.log(`tune ${t}: ${seconds}s, ${seq.writes.length} OPL writes, rms ${rms.toFixed(3)} peak ${peak.toFixed(2)} -> ${path}${report}`)
}
for (const id of sfxIds) {
  const { out, seq } = render((s) => s.command(5, id), 3)
  const path = join(OUT, `SFX${id}.wav`)
  saveWav(path, out, OPL_RATE)
  console.log(`sfx ${id}: ${seq.writes.length} writes -> ${path}`)
}
