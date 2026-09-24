// fromBytes(toBytes(x)) round-trips the static DS car-record image, and a handful of named
// fields match the values docs/engine.md §1 records for the static init image (read live from
// DS:124A this session, tools/refs/car-static-init.hex, 4 x 0x164 bytes).
//   node tools/check-car.mjs
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fromBytes, toBytes, carBase, CAR_RECORD_SIZE } from '../src/engine/car.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const hex = readFileSync(join(ROOT, 'tools', 'refs', 'car-static-init.hex'), 'utf8').trim()
const bytes = new Uint8Array(hex.length / 2)
for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16)
if (bytes.length !== 4 * CAR_RECORD_SIZE) throw new Error(`fixture is ${bytes.length} bytes, expected ${4 * CAR_RECORD_SIZE}`)

let bad = 0

// Round-trip a non-degenerate byte pattern first: the static init image is ~90% zeros, so a
// field missing from car.js's FIELDS table would round-trip "successfully" against it (toBytes
// starts from a zeroed buffer) without this catching it.
{
  const synth = new Uint8Array(CAR_RECORD_SIZE).map((_, i) => (i * 7 + 13) & 0xff)
  const back = toBytes(fromBytes(synth, 0))
  let diff = -1
  for (let b = 0; b < CAR_RECORD_SIZE; b++) if (back[b] !== synth[b]) { diff = b; break }
  if (diff >= 0) {
    bad++
    console.log(`MISMATCH synthetic round-trip: byte +0x${diff.toString(16)} expected ${synth[diff]} got ${back[diff]} -- a field/offset is missing from car.js's FIELDS table`)
  }
}

// Round-trip: fromBytes -> toBytes must reproduce the exact same bytes, for all 4 cars.
for (let i = 0; i < 4; i++) {
  const base = carBase(i)
  const car = fromBytes(bytes, base)
  const back = toBytes(car)
  const original = bytes.subarray(base, base + CAR_RECORD_SIZE)
  let diff = -1
  for (let b = 0; b < CAR_RECORD_SIZE; b++) if (back[b] !== original[b]) { diff = b; break }
  if (diff >= 0) {
    bad++
    console.log(`MISMATCH car ${i} round-trip: byte +0x${diff.toString(16)} expected ${original[diff]} got ${back[diff]}`)
  }
}

// Spot-check named fields against docs/engine.md §1's static-image paragraph (car 0).
const car0 = fromBytes(bytes, carBase(0))
const expected0 = {
  playerSlot: 1, active: 1, present: 1, colourOffset: 0, unk1254: 0x2400,
  posX: 0x5c4, camHalfW: 0x80, posY: 0x8ca, camHalfH: 0x64,
  slipThreshold: 0x32, gripStep: 0x31, slipEnable: 1,
  puffOffA: -30, puffOffB: 20, puffOffC: 30, puffOffD: -20, steerStep: 4,
  maxSpeedCur: 0x800, maxSpeedBase: 0x800, reverseLimit: -1024,
  accel: 0x40, brakeDecel: 0x40, coastDecel: 0x20,
  lapsRemaining: 3, hazardVulnerable: 1, wallBounceEnable: 1, controlsLocked: 1,
}
for (const [name, val] of Object.entries(expected0)) {
  if (car0[name] !== val) {
    bad++
    console.log(`MISMATCH car0.${name}: expected ${val}, got ${car0[name]}`)
  }
}

// Cars 1-3 differ in playerSlot, colourOffset, unk1254/1256, posX and camHalfW/posY (docs/engine.md §1).
const car1 = fromBytes(bytes, carBase(1))
const car2 = fromBytes(bytes, carBase(2))
const car3 = fromBytes(bytes, carBase(3))
const perCar = [
  { car: car1, playerSlot: 2, colourOffset: 2, posX: 0x5dc, camHalfW: 0xa0, posY: 0x8ca },
  { car: car2, playerSlot: 3, colourOffset: 4, posX: 0x5c4, camHalfW: 0xc0, posY: 0x8e2 },
  { car: car3, playerSlot: 4, colourOffset: 6, posX: 0x5dc, camHalfW: 0xe0, posY: 0x8e2 },
]
perCar.forEach(({ car, ...fields }, i) => {
  for (const [name, val] of Object.entries(fields)) {
    if (car[name] !== val) {
      bad++
      console.log(`MISMATCH car${i + 1}.${name}: expected ${val}, got ${car[name]}`)
    }
  }
})

console.log(bad ? `${bad} mismatch(es)` : 'car.js: round-trip exact for all 4 cars, static fields match docs/engine.md §1')
process.exitCode = bad ? 1 : 0
