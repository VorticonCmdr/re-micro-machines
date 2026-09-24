// The drone AI: RunDroneSteeringAi 1000:5429-5531 (docs/engine.md §6, M3.5). Not a separate
// per-frame "AI step" the physics loop calls on its own -- it is one of the pluggable control-byte
// READERS PLAN-ENGINE.md's D3 describes (`BuildInputReaderTable`/`PollAllCarInputs`'s per-slot
// dispatch), so this module exposes one function a caller invokes once per drone per step, exactly
// where a human's keyboard/joystick/mouse reader would otherwise be invoked, before `runStep`.
import { sext8 } from './int16.js'
import { DRONE_HEADING_TABLE, DRONE_DIR_REMAP_TABLE } from '../data/engine-tables.js'

/**
 * Computes and applies this step's drone control byte, mutating `car.controlBits` and (per the
 * .BRK type's own rule) `car.maxSpeedCur` -- both are genuinely written by the real function, not
 * just returned, since `[129C]` must already reflect the AI's decision before the physics step
 * that follows reads it. Returns the same byte for convenience (matches `PollAllCarInputs` storing
 * the reader's return value into `[137B]` right after calling it).
 *
 * `ctx.brk`: this race's `.BRK` byte stream (`src/formats/levbrk.js`'s `parseBrk(...).records`, or
 * any array indexable by `car.progress` whose `.raw` is the byte -- round 9 ships no `.BRK` file at
 * all, "drone-free / different AI for that class" per docs, so pass `null`/`undefined` there and
 * this always takes the type-0 "just accelerate" path). `ctx.round`: stands in for the global
 * `[28BF]` (vehicle-class index), which is usually but not always the round number -- the
 * tournament's "PRO SPORTSCARS"/"PRO FORMULA ONE" substitutions (docs §7) are not modelled here,
 * an approximation, not a captured fact. `ctx.tournamentIndex`: stands in for `[28C1]` (an index
 * into `DroneMaxVelHandicap`, 0..25); defaults to 0 (no handicap bonus/penalty applied) since full
 * tournament-position tracking is out of scope for this milestone -- also an approximation.
 */
export function droneControlByte(car, ctx) {
  let bits = 0

  const dirMask = ctx.round === 2 ? 0x7 : 0xf
  let dir = car.dirByte & dirMask
  if (car.mapAttr & 2) {
    const bucket = (car.levByte >> 5) & 3
    dir = DRONE_DIR_REMAP_TABLE[bucket][dir]
  }
  let target = DRONE_HEADING_TABLE[dir]
  if (car.mapAttr & 1) target ^= 0x80

  const d = sext8((target - car.heading) & 0xff)
  if (d < 0) bits |= 0x80 // steer left
  else if (d >= 3) bits |= 0x40 // steer right

  const raw = ctx.brk?.[car.progress]?.raw ?? 0
  const type = raw >> 4
  const mag = raw & 0xf
  const turning = (bits & 0xc0) !== 0

  if (type === 0 || (type !== 1 && type !== 2 && !turning)) {
    bits |= 0x20
    car.maxSpeedCur = car.maxSpeedBase
  } else if (type === 2) {
    bits |= 0x20
    const lim = ((mag << 8) >> 2) + 0x600
    car.maxSpeedCur = Math.max(car.maxSpeedCur, lim)
  } else {
    // type 1, or type 3+ while turning
    let lim = ((mag << 8) >> 1) + 0x380
    if (ctx.tournamentIndex === 0x17) lim += 0x50
    if (ctx.round === 7) {
      if (ctx.tournamentIndex >= 0x13) lim -= 0x20
      lim -= 0xd0
    }
    if (car.speed <= lim) {
      bits |= 0x20
    } else {
      bits |= 0x10
    }
    car.maxSpeedCur = car.maxSpeedBase
  }

  bits |= 0x08 // fire/select, unconditional for drones
  car.controlBits = bits
  return bits
}
