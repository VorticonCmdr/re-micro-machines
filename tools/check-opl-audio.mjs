// The JS OPL2 core against DOSBox's own audio (docs/engine.md §9dj, UNKNOWN_opl_sample_fidelity).
// tools/refs/si2/dosbox_tune4_intro_features.json holds features of 5.5 s of DOSBox's real output
// (its Nuked OPL3 core, captured with the bridge's video recorder, 48 kHz, mixed to mono): the
// Challenge race intro playing tune 4 from silence. Stored are the 10 ms RMS envelope and the log
// magnitude spectra (0-5 kHz, 2048-sample Hann frames) at 40 positions, not the audio itself.
//
// This check renders tunes through the driver model and src/audio/opl2.js, resamples to 48 kHz,
// aligns each by cross-correlating envelopes (within ±1.5 s), and takes the median correlation of
// the 40 spectra. The core was written independently and sample-exactness is not a goal (opl2.js),
// so the claim is spectral: the right tune must match DOSBox's audio clearly (live: 0.84) and much
// better than any other tune (live: 0.63 at best). Measured on all 8 tunes when written; this
// check renders tune 4 and three others to stay quick.
//   node tools/check-opl-audio.mjs
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Driver, Sequencer, HOST_HZ } from '../src/formats/si2.js'
import { Opl2, OPL_RATE } from '../src/audio/opl2.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const R = 48000, HOP = 480, N = 2048, FRAMES = 40
const WIN = Float32Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N))
const K = Math.floor((5000 * N) / R)

function spectrum(s, at) {
  const m = new Float32Array(K)
  for (let k = 1; k < K; k++) {
    let re = 0, im = 0
    for (let i = 0; i < N; i++) { const v = (s[at + i] ?? 0) * WIN[i], ph = (2 * Math.PI * k * i) / N; re += v * Math.cos(ph); im -= v * Math.sin(ph) }
    m[k] = Math.log(1e-6 + Math.hypot(re, im))
  }
  return m
}
function envelope(s) {
  const e = []
  for (let i = 0; i + HOP <= s.length; i += HOP) { let a = 0; for (let j = 0; j < HOP; j++) a += s[i + j] * s[i + j]; e.push(Math.sqrt(a / HOP)) }
  return e
}
/** The stored features of a live segment: envelope, frame positions and their spectra. */
export function features(s) {
  const frames = Array.from({ length: FRAMES }, (_, f) => Math.floor(((f + 0.5) * (s.length - N)) / FRAMES))
  return { env: envelope(s), frames, spectra: frames.map((at) => spectrum(s, at)) }
}
const corr = (a, b) => {
  let ma = 0, mb = 0
  for (let i = 1; i < a.length; i++) { ma += a[i]; mb += b[i] }
  ma /= a.length - 1; mb /= b.length - 1
  let c = 0, na = 0, nb = 0
  for (let i = 1; i < a.length; i++) { c += (a[i] - ma) * (b[i] - mb); na += (a[i] - ma) ** 2; nb += (b[i] - mb) ** 2 }
  return c / Math.sqrt(na * nb)
}

function render(drv, tune, secs, opts = {}) {
  const seq = new Sequencer(drv)
  const opl = new Opl2(opts)
  seq.command(6); seq.hostTick(); seq.command(4, tune)
  const total = Math.floor(secs * OPL_RATE), out = new Float32Array(total), spt = OPL_RATE / HOST_HZ
  let next = 0, wi = 0
  for (let i = 0; i < total; i++) {
    if (i >= next) { next += spt; seq.hostTick(); for (; wi < seq.writes.length; wi++) opl.write(seq.writes[wi][1], seq.writes[wi][2]) }
    out[i] = opl.sample()
  }
  const res = new Float32Array(Math.floor((total * R) / OPL_RATE))
  for (let i = 0; i < res.length; i++) { const x = (i * OPL_RATE) / R, k = Math.floor(x), f = x - k; res[i] = out[k] * (1 - f) + (out[k + 1] ?? 0) * f }
  return res
}

export function score(ref, model) {
  let best = -Infinity, lag = 0
  const menv = envelope(model)
  for (let L = -150; L <= 150; L++) {
    let c = 0, na = 0, nb = 0
    for (let i = 0; i < ref.env.length; i++) { const j = i + L; if (j < 0 || j >= menv.length) continue; c += ref.env[i] * menv[j]; na += ref.env[i] ** 2; nb += menv[j] ** 2 }
    const r = c / Math.sqrt(na * nb || 1)
    if (r > best) { best = r; lag = L }
  }
  const vals = []
  ref.frames.forEach((at, f) => { const bt = at + lag * HOP; if (bt >= 0 && bt + N <= model.length) vals.push(corr(ref.spectra[f], spectrum(model, bt))) })
  vals.sort((x, y) => x - y)
  return { median: vals[vals.length >> 1], lagMs: lag * 10 }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const ref = JSON.parse(readFileSync(join(ROOT, 'tools', 'refs', 'si2', 'dosbox_tune4_intro_features.json'), 'utf8'))
  const drv = new Driver(new Uint8Array(readFileSync(join(ROOT, 'game', 'DRIVER1.BIN'))))
  const secs = ref.samples / R + 2
  const res = {}
  for (const t of [4, 1, 6, 8]) res[t] = score(ref, render(drv, t, secs))
  const others = Math.max(res[1].median, res[6].median, res[8].median)
  const ok = res[4].median >= 0.8 && res[4].median - others >= 0.15
  console.log(`check-opl-audio: DOSBox's tune-4 audio vs the JS core -- tune 4 ${res[4].median.toFixed(3)} (lag ${res[4].lagMs} ms), tunes 1/6/8 ${[1, 6, 8].map((t) => res[t].median.toFixed(3)).join('/')}: ${ok ? 'the right tune matches clearly' : 'FAIL'}`)
  process.exitCode = ok ? 0 : 1
}
