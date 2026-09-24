// UpdateCarVelocityTowardHeadingSfx5 (1000:525e), docs/engine.md §3. Slews velX/velY toward the
// heading-derived target at a grip-limited rate. Caller (step.js) owns the skip gate (!active,
// state != 0, airborne, car.controlsLocked) -- this function assumes it should run.

import { SINE8 } from '../data/engine-tables.js'
import { mul2Floor256, toI16 } from './int16.js'

const dirIndex = (h) => h & 0xf8

function slewAxis(target, current, thr, rate) {
  const diff = target - current
  if (Math.abs(diff) > thr) return { value: toI16(current + (diff > 0 ? rate : -rate)), skid: true }
  return { value: target, skid: false }
}

/**
 * `ctx.rubberBand`: this step's rubber-band flag for this car (docs/engine.md §3, computed per
 * car per step -- not stored on the car record itself). `ctx.gripOverrideA`/`ctx.gripOverrideB`:
 * `CarTypeInfo` columns [7]/[8] for this round ([28C2]/[28C4]).
 *
 * Grip logic corrected by an adversarial review pass (2026-09-20) that read the live disassembly
 * at 1000:52f9-533b, not just this doc's prose:
 *  - the rubber-band x1.5 scales BOTH thr and rate (docs' "grip threshold/slew x1.5" was literal:
 *    a single gate at 1000:52fd feeds two identical `x += x>>1` blocks, one per value), and does
 *    so as exact integer floor(1.5*x) (`SHR 1; ADD`), never a float multiply -- `rate*1.5` in JS
 *    leaves a .5 fraction for odd rate values that then truncates inconsistently by sign.
 *  - the low-grip override replaces BOTH thr:=[28C2] and rate:=[28C4] together, gated on EITHER
 *    timer being active (checked B-then-A, i.e. 1000:5314 tests [1286] first) -- not two
 *    independent alternative rates as first read; only the checked-and-taken timer decrements.
 *  - [1282] (skidding) is a plain overwrite in both the X and Y sub-blocks (5356/5362 then
 *    5396/53a2), with the Y block running last and unconditionally clobbering the X result -- not
 *    an OR of the two axes.
 */
export function updateCarVelocityTowardHeading(car, ctx) {
  const tvx = mul2Floor256(SINE8[dirIndex(car.heading & 0xff)], car.speed)
  const tvy = mul2Floor256(SINE8[dirIndex((car.heading - 0x40) & 0xff)], car.speed)
  car.targetVelX = tvx
  car.targetVelY = tvy

  let rate = car.gripStep
  let thr = car.slipThreshold
  if (ctx.rubberBand) {
    rate = rate + (rate >> 1) // exact floor(1.5*rate): MOV AX,CX; SHR AX,1; ADD CX,AX
    thr = thr + (thr >> 1)
  }
  if (car.lowGripTimerB > 0) {
    thr = ctx.gripOverrideA // [28C2]
    rate = ctx.gripOverrideB // [28C4]
    car.lowGripTimerB--
  } else if (car.lowGripTimerA > 0) {
    thr = ctx.gripOverrideA
    rate = ctx.gripOverrideB
    car.lowGripTimerA--
  }

  const sx = slewAxis(tvx, car.velX, thr, rate)
  const sy = slewAxis(tvy, car.velY, thr, rate)
  car.velX = sx.value
  car.velY = sy.value
  car.skidding = sy.skid ? 1 : 0 // the Y-axis sub-block's write is the one that survives

  // "Also writes [1262]=0x80, [126E]=0x64" -- camHalfW/camHalfH, re-asserted every call.
  car.camHalfW = 0x80
  car.camHalfH = 0x64
}
