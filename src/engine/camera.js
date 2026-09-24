// The camera (`5019-51b0`, docs/engine.md §3, resolved as an M3.1 follow-up on request -- ported
// here for M3.6). It is the tail of RunCarPhysicsStep, so `step.js`'s `runStep` calls it (via
// `ctx.camera`) after the commits and before the race-over test and the render.
//
// The target comes from the static table `DS:27B7 = {1, car0, car1, car2, car3}` indexed by
// `[27B5]` (`raceState.cameraIndex`): 1..4 follow that car alone (four-car races and round 9 use 1
// = car 0); 0 selects the table's sentinel 1, the two-car MIDPOINT mode (`5053-5106`, docs/engine.md
// §9am), which is also the head-to-head knockout trigger: when the two cars are more than 0xE8 apart
// in X or 0xB0 in Y it requests a knockout ([2911]=1, unless one is already being processed) and
// leaves the target where it was. The knockout reset points the index at the scorer (7825) and the
// end of the exchange sets it back to 0 (767B).
//
// 2026-09-21 (post-M3.10, docs/engine.md §9m): the X axis was wrong from M3.6 until now. It only
// ever applied `±stepX`, so once the step had settled to 50 the camera overshot a near target by
// up to 50px every physics step and swung straight back -- a ±50px horizontal oscillation at 35 Hz
// that every single screenshot showed as a normal frame (reported by the user as "flickering /
// jumping"). Re-reading `5126-5152` shows X has the SAME three regimes as Y: the `JMP 5152` at
// `5145` skips the `±step` block, so DX still holds the raw delta and `ADD [264A],DX` snaps. The
// two axes are instruction-for-instruction the same code with different operands.
import { toI16, wrapWorld } from './int16.js'

/**
 * `[264A]/[2646] = STRT.x+20-250 = STRT.x-230`; `[264C]/[2648] = STRT.y-10-250 = STRT.y-260`
 * (`1000:3dfc-3e07`/`3e65-3e73`, read live for this fix -- NOT symmetric the way docs/engine.md
 * §1's older "start-230" shorthand for both axes implied; that shorthand undercounted Y by 30px).
 * Takes the RAW `STRT_POS.BIN` entry, not a spawned car's already-grid-offset position.
 *
 * Stored UNWRAPPED after init, exactly as the game keeps `[264A]/[264C]`: nothing in `5019-51b0` folds
 * the camera position into `[0,0xC00)` -- only the *target* is (`5037`/`504a`); init itself wraps a
 * value <= 0 once (3DFF/3E68, docs/engine.md §9an). The position converges
 * onto that wrapped target, so it lives within one step of `[0,0xC00)` and the compositor
 * (`src/render/raceView.js`) wraps every coordinate it derives from it anyway.
 */
export function initCameraState(strt) {
  // 3DFF/3E68: `CMP AX,0 / JG / ADD AX,0xC00` -- a start position <= 0 is wrapped once (ROUND51's
  // grid gives x = -22 -> 3050), the only place the camera position is ever folded.
  const x = strt.x - 230 > 0 ? strt.x - 230 : strt.x - 230 + 0xc00
  const y = strt.y - 260 > 0 ? strt.y - 260 : strt.y - 260 + 0xc00
  return {
    x,
    y,
    targetX: x, // [2646], same init (3E0A); persists: the midpoint mode may skip updating it
    targetY: y, // [2648] (3E73)
    stepX: 8, // [264E], race-start/respawn value (RespawnCarAtSafePoint 7369 re-applies the same 8)
    stepY: 8, // [2650]
  }
}

/** `5053-5106`: the two-car midpoint of P1 (car 0) and P2 (car 1). The delta is folded only near
 * the world seam (|d| >= 0xB18 in X, 0xB50 in Y), so "inside the window" is a toroidal |dx| <= 0xE8
 * and |dy| <= 0xB0. Outside it: request a knockout unless [2911]==2, skip the rest (Y is not even
 * evaluated when X is out) and leave the stored target alone. Returns the new target or null. */
function midpointTarget(p1, p2, raceState) {
  let dx = toI16(p1.posX - p2.posX)
  if (dx >= 0xb18) dx -= 0xc00 // 5065
  if (dx <= -0xb18) dx += 0xc00 // 506D
  if (dx > 0xe8 || dx < -0xe8) { // 5075/507A
    if (raceState && raceState.knockoutRequest !== 2) raceState.knockoutRequest = 1 // 5089
    return null
  }
  let mx = (dx >> 1) + p2.posX - 0x80 // 5091-5095
  let dy = toI16(p1.posY - p2.posY)
  if (dy >= 0xb50) dy -= 0xc00 // 50AA
  if (dy <= -0xb50) dy += 0xc00 // 50B4
  if (dy > 0xb0 || dy < -0xb0) { // 50BE/50C4
    if (raceState && raceState.knockoutRequest !== 2) raceState.knockoutRequest = 1 // 50D1
    return null
  }
  let my = (dy >> 1) + p2.posY - 0x64 // 50D9-50DD
  if (mx <= -1) mx += 0xc00 // 50E0-50ED
  if (mx >= 0xc00) mx -= 0xc00
  if (my <= -1) my += 0xc00 // 50F0-50FF
  if (my >= 0xc00) my -= 0xc00
  return { x: mx, y: my }
}

/**
 * One axis of `5126-5152` (X) / `5156-5186` (Y) -- identical code, different operands. Three
 * regimes on the plain 16-bit `target - cam` (`5129`/`515d`, no toroidal fold):
 *   |delta| > 0x3E8 (1000px)  -> step := 50, cam += delta (unbounded snap: close a huge gap at once)
 *   |delta| <= step           -> step := 50, cam += delta (land exactly on target, no overshoot)
 *   otherwise                 -> cam += sign(delta) * step (bounded creep; step itself unchanged)
 * The snap path (`513f`/`5173`) jumps past the `±step` block with DX still = the raw delta.
 * Returns the new step value; mutates nothing (the caller assigns).
 */
function stepAxis(cam, target, step) {
  const delta = toI16(target - cam)
  const abs = Math.abs(delta)
  if (abs > 1000 || abs <= step) return { cam: cam + delta, step: 50 }
  return { cam: cam + Math.sign(delta) * step, step }
}

/**
 * One call per physics step (`5019-51b0`'s per-frame body). Mutates `camState` in place and sets
 * every car's `cameraFarFlag` (docs/engine.md §3: cleared, then set back to 1 only once BOTH axes'
 * step values have settled to 50).
 */
export function updateCamera(cars, camState, ctx, raceState) {
  // `5019-5023`: the index defaults to the race-init value (3F06-3F13/4146-415A/41D6): midpoint in
  // a two-car race outside round 9, car 0 otherwise.
  const index = raceState?.cameraIndex ?? (ctx?.raceFormat === 2 && ctx?.round !== 9 ? 0 : 1)
  if (index === 0) {
    const mid = midpointTarget(cars[0], cars[1], raceState)
    if (mid) { camState.targetX = mid.x; camState.targetY = mid.y } // 5103/5106
  } else {
    const target = cars[index - 1]
    // `502a-504d`: pos - camHalf, then `ADD 0xC00` if negative (pos is in [0,0xC00) and camHalf is
    // at most 0xE0, so one conditional add is a full wrap here).
    camState.targetX = wrapWorld(target.posX - target.camHalfW)
    camState.targetY = wrapWorld(target.posY - target.camHalfH)
  }
  const targetX = camState.targetX ?? camState.x
  const targetY = camState.targetY ?? camState.y

  for (const car of cars) car.cameraFarFlag = 0

  const x = stepAxis(camState.x, targetX, camState.stepX)
  camState.x = x.cam
  camState.stepX = x.step
  const y = stepAxis(camState.y, targetY, camState.stepY)
  camState.y = y.cam
  camState.stepY = y.step

  if (camState.stepX === 50 && camState.stepY === 50) {
    for (const car of cars) car.cameraFarFlag = 1
  }
  // controlsLocked is NOT cleared here: the real release is `4D0E-4D1F` in the next step's control
  // loop, for a state-0 car whose cameraFarFlag this call left at 1 (step.js, docs/engine.md §9an).
}
