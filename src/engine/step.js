// One 35 Hz physics step: `RunRaceMainLoop`'s `4aee` physics call, the state-handler dispatch that
// in the real game runs from the render call `90c5` (docs/engine.md §4's dispatch condition), and
// the per-car airborne pass `7429` (docs/engine.md §2/§3). Rendering and input capture are out of
// scope here; sfx are wired where the underlying modules already trigger them
// (checkpoints.js/collide.js/velocity.js/terrain.js/states.js/projectile.js), gated per
// docs/sound.md §3b, via `ctx.sound` (optional, `src/engine/sound.js`'s driver shape) -- M3.7.
// Projectiles (`fireProjectile`/`updateProjectileFlight`/`resolveProjectileHits`) and puffs/
// splashes (`updatePuffsAndSplashes`) were added post-M3.10 -- docs/engine.md §9q. The ranking
// score's scale/threshold constants ([2652]/[2654]) were added post-M3.13 (docs/engine.md §9s);
// the real prefix-freeze ranking, the finished-car block, [26C6]/[26CC] race-over detection and the
// slot-0 rubber band were ported 2026-09-23 (docs/engine.md §9ah) -- see `computeRanking`,
// `recountRaceOver`, `finishedCarBlock` and `checkRaceOver`. The two-car match (the light bar, the
// knockout exchange, "Play Off" and the only real two-car race end) is `twocar.js`, hooked in below
// at each routine's real position (docs/engine.md §9am).

import { updateCarVelocityTowardHeading } from './velocity.js'
import { integrateCar, updateCarTileCollision, bounceAndCommit, resolveCarCarCollisions } from './collide.js'
import { dispatchTerrain, round2Current, plughole } from './terrain.js'
import { updateCheckpointsAndLaps } from './checkpoints.js'
import { updateCarAirborneLanding } from './airborne.js'
import { updatePuffsAndSplashes } from './puffs.js'
import { fireProjectile, updateProjectileFlight, resolveProjectileHits } from './projectile.js'
import { applyScriptedDrift } from './dropin.js'
import { runStates } from './states.js'
import { updateCamera } from './camera.js'
import { initTwoCarMatch, twoCarFinishedCar, checkBothDown, twoCarRenderGate, twoCarBanners, stepExchange, twoCarFinalOrder, applyScoreSlotGarbage } from './twocar.js'
import { sar16 } from './int16.js'

const bit = (controlBits, mask) => (controlBits & mask) !== 0

/**
 * The control path after the lock/active gates, `4D2F-4F02` (docs/engine.md §3/§9an, re-derived
 * twice from the bytes). `controllerType` is this car's word `[2658+2*(playerSlot-1)]`: 1/2 joystick,
 * 3 mouse, 4/5 keys, 6 CPU. `rubberBand`: this car's flag ([262F], 4B1C-4B41). `raceOverCount`: [26C6].
 *
 * - A four-car finished DRONE only coasts (4D2F-4D44 -> 4E38).
 * - A non-drone that is not on a joystick (keys, mouse) with fire (0x08) held skips everything --
 *   no heading snap, no steering, no throttle, no coast -- and goes to the fire entry (4D4B-4D70 ->
 *   4F03). Drones and joysticks carry 0x08 on every step / every button, so they are exempt.
 * - Otherwise: heading snap when neither L nor R (4D73-4DA4), steer (4DAF/4DDE, the +/-0xFF minimum
 *   speed in rounds <= 6), then four-car: [26C6] >= 2 or finished -> coast (4E07); the accel+brake
 *   chord 0x30 goes straight to the fire gates (4E24 -> 4F17: no throttle, no coast); no throttle
 *   bit -> the ground-gated coast (4E2E); accelerate (x6 with the rubber band, 4E85-4EB7) and, with
 *   0x08, the fire entry after it (4EFB); brake (4EBB-4ED5).
 * The fire entry 4F03 diverts to the ground coast while [26C6]==2 or [2915] (`ctx.fireKeyDisabled`,
 * cheats 5/9); the gates 4F17 are in `fireGates`/`fireProjectile`.
 */
export function applySteerAndThrottle(car, controlBits, ctx, rubberBand, raceOverCount = 0, controllerType = 6) {
  const left = bit(controlBits, 0x80)
  const right = bit(controlBits, 0x40)
  const fourCar = ctx.raceFormat !== 2
  const finished = car.lapsRemaining <= 0
  if (fourCar && finished && car.isDrone === 1) { coastToZero(car); return } // 4D2F-4D44
  const exempt = car.isDrone === 1 || controllerType === 1 || controllerType === 2 // 4D4B-4D69
  if (!exempt && bit(controlBits, 0x08)) { fireEntry(car, ctx, raceOverCount); return } // 4D70

  if (!left && !right) { // 4D73-4DA4
    const lo = car.heading & 0xf
    if (lo <= 4) car.heading = car.heading & 0xf0
    else if (lo >= 0xc) car.heading = ((car.heading & 0xf0) + 0x10) & 0xff
    else car.heading = (car.heading & 0xf0) | 8
  }
  // 4EDC-4EFA: the steer step is modified for TANKS ([28BF]==7) ONLY -- drones +1, a human at
  // speed >= 0x320 (signed: forward only) halved -- and returned untouched for every other class.
  let cx = car.steerStep
  if (ctx.round === 7) {
    if (car.isDrone) cx += 1
    else if (car.speed >= 0x320) cx >>= 1
  }
  // 4DE6 adds without masking (heading can briefly read 0x100-0x103), but no reader observes bit 8
  // (docs/engine.md §9an), so the port masks.
  if (left) { car.heading = (car.heading - cx) & 0xff; if (Math.abs(car.speed) <= 0xff && ctx.round <= 6) car.speed = 0xff }
  if (right) { car.heading = (car.heading + cx) & 0xff; if (Math.abs(car.speed) <= 0xff && ctx.round <= 6) car.speed = 0xff }

  if (fourCar && (raceOverCount >= 2 || finished)) { coastToZero(car); return } // 4E07-4E1A

  const throttle = controlBits & 0x30
  if (throttle === 0x30) { fireGates(car, ctx, raceOverCount); return } // 4E24 -> 4F17
  if (throttle === 0) { if (car.height <= 0) coastToZero(car); return } // 4E29 -> 4E2E
  if (throttle === 0x20) { // 4E85-4EB7
    const accelAmt = rubberBand ? car.accel * 6 : car.accel
    car.speed = Math.min(car.speed + accelAmt, car.maxSpeedCur)
    if (bit(controlBits, 0x08)) fireEntry(car, ctx, raceOverCount) // 4EBB -> 4EFB -> 4F03
    return
  }
  car.speed = Math.max(car.speed - car.brakeDecel, car.reverseLimit) // 4EBB-4ED5
}

/** The fire entry `4F03`: [26C6]==2 or [2915] (`ctx.fireKeyDisabled`) turn it into the ground-gated
 * coast (4E2E); otherwise the fire gates. */
function fireEntry(car, ctx, raceOverCount) {
  if (raceOverCount === 2 || ctx.fireKeyDisabled) { if (car.height <= 0) coastToZero(car); return }
  fireGates(car, ctx, raceOverCount)
}

/** The fire gates `4F17`: [26C6] != 2, then `fireProjectile`'s own (TANKS or [2919], reload done). */
function fireGates(car, ctx, raceOverCount) {
  if (raceOverCount === 2) return
  fireProjectile(car, ctx)
}

/** The car's controller type word (see `applySteerAndThrottle`). Defaults: car 0 is a joystick
 * (exempt from the keyboard fire preempt -- the headless harnesses drive it with the drone AI, which
 * ORs 0x08 every step), every other car the CPU. The pages pass the human's real type. */
function controllerTypeOf(ctx, i) {
  return ctx.controllerTypes?.[i] ?? (i === 0 ? 1 : 6)
}

/**
 * `[26C6]`'s recount (`1000:4b85-4bde`, docs/engine.md §9ah): ASSIGNS (from 0) the number of cars
 * with `lapsRemaining===0 AND speed===0`, then forces 2 if the camera-target car (`cars[0]`, this
 * port's one-player `[2660]`) has `lapsRemaining===0`. It is NOT a per-step snapshot: the real game
 * only runs it from the finished-car block of the per-car control loop, on the turn of a finished
 * car (four-car format, not round 9) whose speed is exactly 0 -- see `runStep`. Everything else that
 * sets [26C6] writes it directly: the ROUND21 lead rule (`checkpoints.js`, 6054 =2), the instant-win
 * cheat (36a7 =4), the two-car exchange end (76f2/772a/7742, `twocar.js`) and the RUFFTRUX
 * "Failed" handler (8702). The old "[26C6]>=2 is provably redundant for the freeze" argument is
 * refuted by those writers -- the lead rule and the cheat set it with no car finished.
 */
export function recountRaceOver(cars) {
  let n = cars.filter((c) => c.lapsRemaining === 0 && c.speed === 0).length
  if (cars[0].lapsRemaining === 0) n = 2
  return n
}

const FINISH_SENTINEL = 0x7d00

/**
 * `DrawRaceHudDigitsAndRankIcons 1000:8dfc` -- the only writer of `racePosition` ([12EF]) and of
 * the persistent order array `[2678..267E]` in one-player play (`raceState.rankOrder`, car indices,
 * seeded [0,1,2,3] by `InitRaceCarsFromTables` 423a/445e). Three branches, all `[STATIC]`
 * (docs/engine.md §9s, corrected §9ah):
 *
 * - **Round 9** (8dfc -> 8ff5): no ranking at all; order and racePosition left untouched.
 * - **Four-car** (8e10-8eeb): walk the order SLOTS 0..3; a slot whose car has `lapsRemaining<=0`,
 *   or any slot while `[26C6]>=2`, writes 0x7D00 into ALL FOUR score cells, otherwise the slot's own
 *   cell = `(9-laps)*lo8([2652]) + progress` (`MUL CL`). Later live slots overwrite their own cells,
 *   so the net effect is a PREFIX freeze: slots 0..m (m = the last slot holding a finished car) keep
 *   their order, the cars behind them are still ranked live, and `[26C6]>=2` freezes everything.
 *   Then a 3x3 bubble sort over (cells, order), swapping only on strictly-less (JGE = stable). The
 *   port used to freeze the WHOLE order the moment any car finished -- a player who finished
 *   second behind a drone could never pass the others still racing.
 * - **Two-car** (8f03-8fa1): slots 0-1 scored live, no sentinel, one compare; if records 0 AND 1
 *   have both finished and their progress differs by >= [2654], the order is forced (8f87/8f95:
 *   car 0 first when car 1's progress is greater, else car 1 first).
 *
 * The real routine runs from the render `90c5`, which returns at once unless `[2638]==1` -- i.e.
 * once per DRAWN frame, every [263A] (smoothness, SETTINGS.DAT word 2) physics steps, AFTER that
 * step's physics. At the shipped smoothness 1 that is every step, which this port matches (it ranks
 * at the top of the next `runStep`, reading the same state); at smoothness 2-4 the real game samples
 * the ranking (and runs the state handlers) only every n-th step, a cadence this port does not
 * reproduce -- a known divergence for n > 1 (docs/engine.md §9ah). On the exiting iteration the real
 * game skips the render (3081 -> 30df), so the final order is the last one computed -- exactly
 * `raceState.rankOrder` when `runStep` reports `raceState.raceOver`.
 */
export function computeRanking(cars, ctx, raceState) {
  const order = raceState.rankOrder ?? cars.map((_, i) => i)
  if (ctx.round === 9) {
    raceState.rankOrder = order
    return order.slice()
  }
  const scale = (ctx.progressScale ?? 1) & 0xff
  const score = (c) => ((9 - c.lapsRemaining) & 0xff) * scale + c.progress

  if (ctx.raceFormat === 2) {
    const cells = [score(cars[order[0]]), score(cars[order[1]])]
    if (cells[0] < cells[1]) order.splice(0, 2, order[1], order[0])
    const [c0, c1] = cars
    if (c0.lapsRemaining <= 0 && c1.lapsRemaining <= 0 && Math.abs(c0.progress - c1.progress) >= (ctx.halfMaxProgress ?? 0)) {
      order.splice(0, 2, ...(c1.progress > c0.progress ? [0, 1] : [1, 0]))
    }
    raceState.rankOrder = order
    cars[order[0]].racePosition = 1
    cars[order[1]].racePosition = 2
    return order.slice()
  }

  const frozenAll = (raceState.raceOverCount ?? 0) >= 2
  const cells = [0, 0, 0, 0]
  for (let slot = 0; slot < 4; slot++) {
    const car = cars[order[slot]]
    if (car.lapsRemaining <= 0 || frozenAll) cells.fill(FINISH_SENTINEL)
    else cells[slot] = score(car)
  }
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < 3; i++) {
      if (cells[i] < cells[i + 1]) {
        ;[cells[i], cells[i + 1]] = [cells[i + 1], cells[i]]
        ;[order[i], order[i + 1]] = [order[i + 1], order[i]]
      }
    }
  }
  raceState.rankOrder = order
  order.forEach((carIndex, position) => { cars[carIndex].racePosition = position + 1 })
  return order.slice() // a defensive copy -- `order` IS raceState.rankOrder, persistent across calls
}

/**
 * The finished-car block at the top of `RunCarPhysicsStep`'s per-car loop (`4b45-4be4`,
 * docs/engine.md §9ah) -- four-car format, not round 9 (4af2 sends round 9 elsewhere), BEFORE the
 * state/lock/active gates of the control path. Speed > 0: brake by `brakeDecel` (clamp 0), then
 * the normal control path. Speed < 0: straight to the control path. Speed === 0: the [26C6]
 * recount, then this car skips the control path entirely (JMP 4fd1).
 * @returns {boolean} true if the control path is skipped for this car this step
 */
function finishedCarBlock(car, cars, raceState) {
  if (car.speed > 0) {
    car.speed = Math.max(0, car.speed - car.brakeDecel)
    return false
  }
  if (car.speed < 0) return false
  raceState.raceOverCount = recountRaceOver(cars)
  return true
}

/** `1000:4e38-4e67`: speed toward 0 by `coastDecel`, clamped at 0. Unlike the no-input coast at
 * 4e2e, NOT gated on the car being on the ground. */
function coastToZero(car) {
  if (car.speed >= -1) {
    car.speed -= car.coastDecel
    if (car.speed < 0) car.speed = 0
  } else {
    car.speed += car.coastDecel
    if (car.speed >= 0) car.speed = 0
  }
}

/** `RunRaceMainLoop` 3081-3093: once [26C6] >= 2 the two-car format exits at once, the four-car
 * format counts [26CC] (100 at race init, 3c98, never reset) down one per physics step and exits
 * at 0. Sets and returns `raceState.raceOver`. */
function checkRaceOver(raceState, ctx) {
  if ((raceState.raceOverCount ?? 0) < 2) return false
  if (ctx.raceFormat === 2) return (raceState.raceOver = true)
  raceState.raceOverLinger = (raceState.raceOverLinger ?? 100) - 1
  if (raceState.raceOverLinger === 0) raceState.raceOver = true
  return !!raceState.raceOver
}

/**
 * `world`: `collide.buildWorld(...)`. `cars`: the 4-car array (`src/engine/car.js` shape).
 * `controls`: 4 control bytes, one per car (0 for an idle car). `raceState`: small persistent
 * per-race object -- `states.js`'s state-A counter (`{dropInTimer}`), the order array
 * (`rankOrder`, [2678..267E]), `raceOverCount` ([26C6], 0 at race init, 3c22), `raceOverLinger`
 * ([26CC], 100 at race init, 3c98) and `raceOver` (set once the real main loop would jump to its
 * 30df exit; `runStep` is a no-op afterwards and `raceState.rankOrder` holds the final order the
 * tournament reads at 11d5). Start every race with a fresh `{}`. `ctx`: `{round, race, raceFormat, gripOverrideA,
 * gripOverrideB, stepIncrement?, sound?}` (`gripOverrideA`/`B` = `CarTypeInfo` columns [7]/[8] for
 * this round, i.e. [28C2]/[28C4]; `sound` = `src/engine/sound.js`'s driver shape, optional --
 * M3.7). `ctx.progressScale`/`halfMaxProgress` ([2652]/[2654], docs/engine.md §9s) are derived
 * HERE from `world.map.maxPlane2` every call, unconditionally overriding anything the caller
 * passed in -- the real values are per-race data baked into the currently-loaded `.MAP` file
 * itself, not a tunable the original ever exposes a caller-override for.
 */
export function runStep(world, cars, controls, raceState, ctx) {
  const progressScale = world.map.maxPlane2
  ctx = { ...ctx, progressScale, halfMaxProgress: progressScale >> 1 }
  if (raceState.raceOver) return
  const twoCar = ctx.raceFormat === 2 && ctx.round !== 9
  if (twoCar && !raceState.twoCar) initTwoCarMatch(raceState)

  const order = computeRanking(cars, ctx, raceState)
  // [262F], computed per car at 4b1c-4b41 (throttle x6) and again at 5286-52ab (velocity grip x1.5):
  // an off-screen car other than car 0 is boosted when car 0 is found in the order array before the
  // car itself. The scan's loop test is `CMP SI,[0x267E]` -- a MEMORY operand holding the car
  // offset stored in slot 3 (<= 0x42C), always below SI (>= 0x267A) -- so only slot 0 is ever
  // looked at: the boost applies exactly while car 0 LEADS the race (docs/engine.md §9ah). This port
  // previously boosted every off-screen car ranked anywhere behind car 0.
  const rubberBand = cars.map((car, i) => ctx.round !== 9 && i !== 0 && car.drawnThisFrame === 0 && order[0] === 0)

  for (let i = 0; i < cars.length; i++) {
    const car = cars[i]
    if (ctx.round === 9 && car.lapsRemaining === 2) {
      // 4af2-4b19, RUFFTRUX's finish: latch the countdown ([26CA]=1), then coast (4e38, no steering
      // or throttle) until stopped, and at speed 0 enter state F ("1 Up!", 4b13).
      raceState.ruffTruxLatched = 1
      if (car.speed !== 0) coastToZero(car)
      else car.state = 0xf
      continue
    }
    if (ctx.round !== 9 && ctx.raceFormat !== 2 && car.lapsRemaining <= 0 && finishedCarBlock(car, cars, raceState)) continue
    if (twoCar && car.lapsRemaining <= 0 && twoCarFinishedCar(raceState)) continue // 4b4f -> 4be7
    // 4D04-4D25: the state gate first, then the lock -- released HERE, for a state-0 car whose
    // cameraFarFlag the previous step's camera left at 1 (4D1F) -- then `active` (docs/engine.md §9an).
    if (car.state !== 0) continue
    if (car.controlsLocked) {
      if (car.cameraFarFlag !== 1) continue
      car.controlsLocked = 0
    }
    if (!car.active) continue
    applySteerAndThrottle(car, controls[i] ?? 0, ctx, rubberBand[i], raceState.raceOverCount ?? 0, controllerTypeOf(ctx, i))
  }

  for (let i = 0; i < cars.length; i++) {
    const car = cars[i]
    if (car.active && car.state === 0 && car.height <= 0 && !car.controlsLocked) {
      updateCarVelocityTowardHeading(car, { rubberBand: rubberBand[i], gripOverrideA: ctx.gripOverrideA, gripOverrideB: ctx.gripOverrideB })
      // docs/sound.md §3b id5 "5423": car slot 0 only, class not POWERBOATS(2)/CHOPPERS(8) (M3.7).
      // WARRIORS(6)'s own ~1/50-frame decay throttle ([28FB]) is not modelled -- an unthrottled
      // approximation, not the exact rate.
      if (i === 0 && car.skidding && ctx.round !== 2 && ctx.round !== 8) ctx.sound?.playSfx(5)
    }
  }

  resolveCarCarCollisions(cars, ctx)

  cars.forEach((car, carIndex) => {
    integrateCar(car)
    updateCarTileCollision(car, world, ctx)
    const s = sar16(car.velX, 8) ** 2 + sar16(car.velY, 8) ** 2
    // 5e4e checks state==0 (5e8f) BEFORE the terrain dispatch and does not re-check it before the
    // lap body, so a handler that changes state this tick doesn't stop this tick's lap judgement.
    const entryState = car.state
    // 5e4e's two-car preamble (only reached for ACTIVE cars, 5be7): both cars in state 1, or both in
    // 5, sets [2913] and returns before the terrain/lap body (twocar.js `lineUpBothCars` resolves it).
    if (!(twoCar && car.active && checkBothDown(cars, raceState))) {
      // `raceState` threaded in only for round 3's terrain-triggered drop-in entry (`terrain.js`'s
      // `h6ae5`, docs §9r) -- the other 23 terrain handlers ignore it.
      dispatchTerrain(car, { ...ctx, s, raceState })
      round2Current(car, ctx, entryState) // 5EEC-5EFB, after the dispatch
      updateCheckpointsAndLaps(car, ctx, { cars, carIndex, raceState, entryState })
      plughole(car, ctx) // 60C0-60C7: every 5E4E exit but the two-car preamble's, current state
    }
    bounceAndCommit(car, ctx, world)
    car.carCarHit = 0
  })
  // Hit (`79fd`, called from `5be7`'s tail once per committing car -- docs §9q): checked once here
  // over the whole array, using this step's now-committed positions, rather than per-car inline,
  // since a shot can hit any OTHER car regardless of iteration order.
  resolveProjectileHits(cars, ctx)

  // The camera (5019-51B0) is the tail of RunCarPhysicsStep itself: after the four commits, BEFORE
  // the 3081 race-over test, the render (state handlers) and the 7429 per-car pass. Callers pass
  // their camera state as `ctx.camera` (docs/engine.md §9am); the two-car midpoint branch arms the
  // knockout request here, which the render gate below consumes the same step.
  if (ctx.camera) updateCamera(cars, ctx.camera, ctx, raceState)

  // `RunRaceMainLoop` 3081-3093 tests [26C6] right after the physics call and, on the exiting
  // iteration, jumps to 30df WITHOUT running the render (state handlers) or the per-car pass below.
  if (checkRaceOver(raceState, ctx)) {
    // The exit fix-ups (3115-3156) the tournament then reads at 11d5. 3115-313A is not format-gated:
    // the instant-win cheat's [2635] re-forces car0/car2/car1/car3 in a four-car race too (the
    // [26C6] recount at 4B85 can un-freeze the ranking after the cheat, docs/engine.md §9an); two-car
    // then also applies the [2630] Winner fix-up (3143-3156), and slot 0 decides.
    if (twoCar) raceState.rankOrder = twoCarFinalOrder(raceState)
    else if (raceState.cheatWin) raceState.rankOrder = [0, 2, 1, 3]
    return
  }

  // The render's two-car gate (91f2-9205) runs before the car layer's state handlers.
  if (twoCar) twoCarRenderGate(cars, raceState, ctx)
  // `hiddenCar`: 7D74's car, which 7D73 leaves before its clip test and rotor call (drawn.js).
  const hiddenCar = twoCar && raceState.twoCar.hiddenCar != null ? cars[raceState.twoCar.hiddenCar] : null
  runStates(cars, raceState, { ...ctx, world, hiddenCar }) // the state-handler dispatch the real game runs from render (90c5)
  if (twoCar) {
    // 7d74: the car [2621] names is not drawn (so its drawnThisFrame stays 0) -- as the car layer
    // saw [2621] this frame, before the post-HUD dispatch (9241-9281) below can change it. 7d74 is
    // itself inside 7D73, so like every other write of this flag it only happens on a drawn tick
    // (docs/engine.md §9ap 3) -- gated the same way `markDrawn` gates its own write.
    const m = raceState.twoCar
    m.hiddenCarLayer = m.hiddenCar
    if (m.hiddenCar != null && ctx.drawnTick !== false) cars[m.hiddenCar].drawnThisFrame = 0
    twoCarBanners(cars, raceState, ctx)
  }

  // `RunRaceMainLoop`'s own per-car pass (`3098-30b5`, docs §2), in its documented order: airborne/
  // landing (`7429`), THEN the scripted-drift/animTimer pass (`73e7`, docs §9r -- runs AFTER the
  // state dispatch above, matching the real order; states 1/4/5 only), THEN projectile flight
  // (`51b2`). Puffs (not part of this real per-car pass, an M3.12 addition) run after airborne too,
  // since their cooldowns are decremented there.
  cars.forEach((car, i) => {
    const grounded = updateCarAirborneLanding(car, ctx)
    // 7429 does not save BX: its two-car block (75c2-7758) can leave another car's base in BX, and
    // the pass's 309F guard / 73E7 / 51B2 then act on THAT car (docs/engine.md §9an).
    const bx = twoCar && grounded ? stepExchange(i, cars, raceState, ctx) : i
    if (typeof bx === 'number') {
      const t = cars[bx]
      // 73F4's animTimer bump for a car in 0xB/0xC (the port's own handlers bump states 1/2/4/5/0xD
      // inline, so only these need it here -- their animTimer is read by nothing but the swap-tick
      // guard below).
      if (t.state === 0xb || t.state === 0xc) t.animTimer = (t.animTimer + 1) & 0xffff
      applyScriptedDrift(t, ctx, bx === 0)
      updateProjectileFlight(t)
    } else applyScoreSlotGarbage(cars[0], bx.scoreSlot, ctx) // a blink swap tick: BX = the bar value
    updatePuffsAndSplashes(car, ctx)
  })
}
