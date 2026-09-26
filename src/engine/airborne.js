// UpdateCarAirborneLandingSfx (1000:7429), docs/engine.md §3. Called for every car every
// RunRaceMainLoop iteration (docs/engine.md §2 "3098-30b5"), NOT gated on state -- unlike the main
// physics step, this always runs.

import { DECAY_BOUNCE } from '../data/engine-tables.js'
import { sar16, toI16 } from './int16.js'
import { isOplDriver } from './sound.js'

/** `ctx.round`. Mutates car.height (z), car.zVel, car.bounceOnLand, car.rampJumpActive,
 * car.splashTrigger, car.state (ramp landings can send the car to state 0xD), car.knockoutX/Y.
 * Returns true when the car took the grounded path (`75C2`: active, height <= 0 and zVel <= 0, so
 * height := 0) -- the only path that reaches the two-car exchange block (twocar.js `stepExchange`). */
export function updateCarAirborneLanding(car, ctx) {
  // Puff/splash cooldown decrement (`1000:7459/7460`/`7464/746b`, docs/engine.md §9q): a guarded
  // (floor-at-0) decrement, unconditional -- confirmed live to happen here, not inside either
  // spawn/animate function, and to run every physics step regardless of airborne state.
  // 745E/7469: signed `> 0` tests (JLE skips), not `!== 0` -- matters once a value is >= 0x8000.
  if (toI16(car.puffCooldown) > 0) car.puffCooldown--
  if (toI16(car.splashCooldown) > 0) car.splashCooldown--
  if (!car.active) return false // 746F: an inactive car's vertical motion is frozen

  if (car.height > 0) {
    car.height = toI16(car.height + sar16(car.zVel, 2))
    car.zVel = toI16(car.zVel - 1)
    if (car.height <= 0) {
      if (ctx.round === 2) car.splashTrigger = 1
      if (car.rampJumpActive) {
        // 74b0-74bc, caught re-deriving this function's full 224-instruction body while wiring
        // the missing Path B sfx below: records the car's own current position BEFORE the state
        // transition -- the same "position before knockout" pattern M3.23 already found and fixed
        // for collide.js's droneWallStuck path, missed here until now.
        car.knockoutX = car.posX
        car.knockoutY = car.posY
        car.state = 0xd
        car.rampJumpActive = 0 // inferred: cleared so the next landing doesn't re-trigger
      }
      if (car.bounceOnLand) {
        car.zVel = toI16(-car.zVel - DECAY_BOUNCE[ctx.round])
      } else {
        car.height = 0
        car.zVel = 0
        car.bounceOnLand = 1
      }
      // docs/sound.md §3b: id7 "7540"/"75a7" (POWERBOATS-only splash, primary + bounce-decay
      // repeat) vs id4 "569e"/"752d"/"7553"/"7594"/"75ba" (every other round's landing thud,
      // including class 5 FOUR BY FOUR at its own separate site 7553 -- same id, same round!=2
      // test) -- one call here covers this function's own touchdown (Path A, "7514") sites.
      if (car.drawnThisFrame && isOplDriver(ctx.sound)) ctx.sound?.playSfx(ctx.round === 2 ? 7 : 4) // 750A: [0F64]!=1 skips the sfx
    }
    return false
  }
  // Lift-off: height <= 0 but zVel > 0 -- either a terrain handler just launched the car, or an
  // ongoing decay-bounce arc restarting upward. Real bytes (`755b-75ba`, "Path B"): this branch
  // ALSO fires the landing sfx every time it runs, the identical id7(POWERBOATS)/id4(other) split
  // as Path A above -- previously entirely unwired (the whole branch was read only for its
  // physics, not its own separate sfx dispatch).
  if (car.zVel > 0) {
    car.height = toI16(car.height + (car.zVel >> 2))
    car.zVel = toI16(car.zVel - 1)
    if (car.drawnThisFrame && isOplDriver(ctx.sound)) ctx.sound?.playSfx(ctx.round === 2 ? 7 : 4) // 7571: [0F64]!=1 skips the sfx
    return false
  }
  car.height = 0 // 75C2
  return true
}
