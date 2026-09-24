// M3.10 acceptance test for the OPL waveform toggle (si2Player.js's `strictOpl2` option): the two
// modes must actually produce different audio for an instrument that carries a non-zero waveform
// byte, or the toggle is untested UI wired to a distinction that never bites -- the same "green
// test, no real coverage" trap this project has hit before (see docs/engine.md's account of
// earlier milestones' weak-coverage bugs).
//   node tools/check-opl-toggle.mjs
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Driver } from '../src/formats/si2.js'
import { Opl2 } from '../src/audio/opl2.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const drv = new Driver(new Uint8Array(readFileSync(join(ROOT, 'game', 'DRIVER1.BIN'))))

let bad = 0
function check(name, cond) {
  if (cond) return
  bad++
  console.log(`FAIL: ${name}`)
}

// Find an instrument with a non-zero E0 (waveform) byte on either operator -- docs/engine.md's
// account of this driver says 19 of the 128 carry one.
let target = -1
for (let n = 0; n < drv.instrumentCount(); n++) {
  const inst = drv.instrument(n)
  if (inst[6] !== 0 || inst[7] !== 0) { target = n; break }
}
check('at least one instrument has a non-zero waveform byte', target >= 0)

function render(strictOpl2, inst) {
  const opl = new Opl2({ strictOpl2 })
  const CH = 0, OPOFF = 0x0300 // channel 0, op1 offset 0 / op2 offset 3 (Opl2.slot's own layout)
  for (const [r, v] of drv.instrumentOplRegs(inst, CH, OPOFF)) opl.write(r, v)
  opl.write(0xa0 + CH, 0x57) // an arbitrary mid-range note
  opl.write(0xb0 + CH, 0x21) // freq hi + key-on
  const out = []
  for (let i = 0; i < 2000; i++) out.push(opl.sample())
  return out
}

if (target >= 0) {
  const inst = drv.instrument(target)
  const strict = render(true, inst)
  const loose = render(false, inst)
  const differs = strict.some((v, i) => Math.abs(v - loose[i]) > 1e-6)
  check(`strictOpl2 (forced sine) vs default (honours instrument ${target}'s waveform byte) actually differ`, differs)
}

console.log(bad ? `${bad} check(s) failed` : `check-opl-toggle: strictOpl2 and the default (Nuked/OPL3-style) mode produce audibly different output for a non-zero-waveform instrument`)
process.exitCode = bad ? 1 : 0
