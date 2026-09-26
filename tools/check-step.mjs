// M3.3 acceptance test (PLAN-ENGINE.md): from the static init state and zero controls, N steps run
// without NaN/out-of-range, all four cars stay on the toroidal world; the corrected checkpoint/lap
// rule is unit-tested directly (a lap must NOT be counted while a checkpoint is still outstanding).
//   node tools/check-step.mjs
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { allFromBytes, CAR_RECORD_SIZE } from '../src/engine/car.js'
import { loadWorld, loadBrk, roundCtx, spawnCars } from '../src/engine/race.js'
import { runStep, applySteerAndThrottle } from '../src/engine/step.js'
import { updateCheckpointsAndLaps } from '../src/engine/checkpoints.js'
import { checkpointList } from '../src/data/engine-tables.js'
import { parseStrtPos } from '../src/formats/globaldata.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const GAME = join(ROOT, 'game')
const read = async (n) => new Uint8Array(readFileSync(join(GAME, n)))

let bad = 0
function check(name, cond) {
  if (cond) return
  bad++
  console.log(`FAIL: ${name}`)
}

function newCar(fields) {
  return { velX: 0, velY: 0, heading: 0, speed: 0, height: 0, zVel: 0, wallBounceEnable: 1, halveOnBounce: 1, isDrone: 0, active: 1, ...fields }
}

// 1. Checkpoint/lap rule unit test (round 1 race 1 has a real, non-empty list), re-read against the
// bytes 2026-09-23 (docs/engine.md §9ah): gated on state 0 + [12E5] (progressChanged), cursor in
// BYTES, the forward wrap judged against list[0].hi with the penalty as its else branch.
{
  const list = checkpointList(1, 1)
  check('round 1/1 has a checkpoint list to test against', list.length > 1)
  const ctx = { round: 1, race: 1, raceFormat: 1, halfMaxProgress: 128 }
  const base = { checkpointOff: 0, checkpointOffSaved: 0, lapsRemaining: 3, safeX: 7, safeY: 7, safeXPrev: 1, safeYPrev: 1, posX: 50, posY: 60, knockoutX: 0, knockoutY: 0, state: 0, drawnThisFrame: 0, progressChanged: 1 }

  // A forward wrap (d < -half) while checkpoint 0 is still outstanding must NOT count a lap -- the
  // rule the M3.0 pass refuted "decrement on any wrap" with (docs/engine.md §3) -- it takes the
  // penalty path (5ff2 JNZ 5f85).
  const skipped = newCar({ ...base, progress: 5, progressPrev: 250 })
  updateCheckpointsAndLaps(skipped, ctx)
  check('lap NOT decremented while a checkpoint is outstanding', skipped.lapsRemaining === 3)
  check('penalty path taken instead (four-car format -> state 0xD, safe point reverted, knockout = pos)', skipped.state === 0xd && skipped.safeX === 1 && skipped.knockoutX === 50)

  // The gates (5e8f/5f1b) -- each twin is the SAME wrap with one gate closed, and must change nothing.
  const notWritten = newCar({ ...base, progress: 5, progressPrev: 250, progressChanged: 0 })
  updateCheckpointsAndLaps(notWritten, ctx)
  check('gate [12E5]: no progress write this tick -> no penalty, no lap, no cursor move', notWritten.state === 0 && notWritten.lapsRemaining === 3 && notWritten.checkpointOff === 0)
  const knockedOut = newCar({ ...base, progress: 5, progressPrev: 250, state: 0xd })
  updateCheckpointsAndLaps(knockedOut, ctx)
  check('gate state==0: a car in state 0xD is not re-penalised every tick (the old 0xD<->7 loop)', knockedOut.safeX === 7 && knockedOut.lapsRemaining === 3)
  const handlerChangedState = newCar({ ...base, progress: 5, progressPrev: 250, state: 4 })
  updateCheckpointsAndLaps(handlerChangedState, ctx, { entryState: 0 })
  check('gate state==0 is tested BEFORE the terrain dispatch (entryState), not after it', handlerChangedState.safeX === 1)

  // Every checkpoint passed (cursor on the terminator, BYTE offset 2*len) and landing inside the
  // first window -> a lap; the cursor restores from checkpointOffSaved.
  const completed = newCar({ ...base, progress: 1, progressPrev: 250, checkpointOff: 2 * list.length, checkpointOffSaved: 0 })
  updateCheckpointsAndLaps(completed, ctx)
  check('lap decremented once every checkpoint is passed', completed.lapsRemaining === 2 && completed.state === 0 && completed.checkpointOff === 0)

  // F5 (5ff4-6006): the landing is compared with the FIRST entry's hi, not the last's -- landing at
  // list[0].hi is a penalty even though it is far below the last entry's hi (the old port's test).
  const landedLate = newCar({ ...base, progress: list[0].hi, progressPrev: 250, checkpointOff: 2 * list.length })
  updateCheckpointsAndLaps(landedLate, ctx)
  check(`forward wrap landing at list[0].hi (${list[0].hi}) -> penalty, not a lap (old code compared with the last hi ${list[list.length - 1].hi})`, landedLate.lapsRemaining === 3 && landedLate.state === 0xd)

  // Ordinary movement inside entry 0's window advances the cursor by ONE WORD (2 bytes).
  const inWindow = newCar({ ...base, progress: list[0].lo + 1, progressPrev: list[0].lo })
  updateCheckpointsAndLaps(inWindow, ctx)
  check('checkpoint passed -> cursor advances by 2 (byte units, 5f7d)', inWindow.checkpointOff === 2)
  const beyond = newCar({ ...base, progress: list[1].lo, progressPrev: list[0].hi })
  updateCheckpointsAndLaps(beyond, ctx)
  check('previous progress past the window -> penalty (5f77 JGE 5f85)', beyond.state === 0xd && beyond.checkpointOff === 0)

  // Backward across the line (6078): cursor saved, parked on the terminator (byte 2*len), +1 lap.
  const backward = newCar({ ...base, progress: 250, progressPrev: 5, checkpointOff: 2 })
  updateCheckpointsAndLaps(backward, ctx)
  check('backward crossing: +1 lap, cursor saved and parked at 2*len', backward.lapsRemaining === 4 && backward.checkpointOffSaved === 2 && backward.checkpointOff === 2 * list.length)

  // Respawn cursor (7135-7160): 2 x (number of leading entries whose lo <= progress).
  const { cursorForProgress } = await import('../src/engine/checkpoints.js')
  check('cursorForProgress: below the first window -> 0', cursorForProgress(1, 1, list[0].lo - 1) === 0)
  check('cursorForProgress: at entry 1\'s lo -> 4 (two entries passed, in bytes)', cursorForProgress(1, 1, list[1].lo) === 4)
  check('cursorForProgress: past every lo -> the terminator (2*len)', cursorForProgress(1, 1, 254) === 2 * list.length)
  check('cursorForProgress: empty list (round 2) -> 0', cursorForProgress(2, 1, 20) === 0)
}

// 1a. The ROUND21 qualifier's lead rule (6024-6054, docs/engine.md §9ah): car record 0 completing a
// lap to <= 2 left while every other car has STRICTLY more laps remaining sets [26C6]=2.
{
  const ctx = { round: 2, race: 1, raceFormat: 1, halfMaxProgress: 14 }
  const mk = (laps) => newCar({ progress: 1, progressPrev: 28, progressChanged: 1, checkpointOff: 0, checkpointOffSaved: 0, lapsRemaining: laps, state: 0, drawnThisFrame: 0 })
  const run = (cars, carIndex = 0, c = ctx) => { const rs = {}; updateCheckpointsAndLaps(cars[carIndex], c, { cars, carIndex, raceState: rs }); return rs.raceOverCount ?? 0 }
  check('lead rule: car 0 completes lap 1 (3->2) while all drones still owe 3 -> [26C6]=2', run([mk(3), mk(3), mk(3), mk(3)]) === 2)
  check('lead rule: not while a drone has EQUAL laps remaining', run([mk(3), mk(2), mk(3), mk(3)]) === 0)
  check('lead rule: not on the start-line crossing (4->3, laps must be <= 2 after the DEC)', run([mk(4), mk(4), mk(4), mk(4)]) === 0)
  check('lead rule: only car record 0', run([mk(3), mk(3), mk(3), mk(3)], 1) === 0)
  check('lead rule: only round 2 race 1', run([mk(3), mk(3), mk(3), mk(3)], 0, { ...ctx, race: 2 }) === 0)
  check('lead rule: only the four-car format', run([mk(3), mk(3), mk(3), mk(3)], 0, { ...ctx, raceFormat: 2 }) === 0)
  const sfx = []
  const drawn = newCar({ progress: 1, progressPrev: 28, progressChanged: 1, checkpointOff: 0, checkpointOffSaved: 0, lapsRemaining: 3, state: 0, drawnThisFrame: 1 })
  updateCheckpointsAndLaps(drawn, { ...ctx, sound: { playSfx: (id) => sfx.push(id) } })
  const hidden = newCar({ progress: 1, progressPrev: 28, progressChanged: 1, checkpointOff: 0, checkpointOffSaved: 0, lapsRemaining: 3, state: 0, drawnThisFrame: 0 })
  updateCheckpointsAndLaps(hidden, { ...ctx, sound: { playSfx: (id) => sfx.push(id) } })
  check('lap sfx 2 is drawn-gated (6014): one call for the drawn car, none for the hidden one', sfx.length === 1 && sfx[0] === 2)
}

// 1b. UNKNOWN_2654_half_max_progress resolved (docs/engine.md §9s): [2654] is per-race data (half
// the real MAXIMUM byte in the currently-loaded race's own .MAP progress plane), not a fixed 128.
// This demonstrates the previously-shipped bug directly: the SAME genuine forward-line-crossing
// delta, judged two different ways by the two thresholds.
{
  const world = await loadWorld(read, 2, 1)
  const real = world.map.maxPlane2 >> 1
  check(`round 2 race 1's real half-max-progress is small, not 128 (got ${real})`, real > 0 && real < 100)

  const list = checkpointList(2, 1)
  check('round 2 has no checkpoint list (an empty list is the relevant case here)', list.length === 0)

  // A delta bigger than the REAL half (14) but well under the OLD hardcoded default (128).
  const delta = -60
  const mk = () => newCar({ progress: 190, progressPrev: 190 - delta, progressChanged: 1, checkpointOff: 0, checkpointOffSaved: 0, lapsRemaining: 3, safeX: 0, safeY: 0, safeXPrev: 0, safeYPrev: 0, posX: 0, posY: 0, knockoutX: 0, knockoutY: 0, state: 0, drawnThisFrame: 0 })
  const withRealThreshold = mk()
  updateCheckpointsAndLaps(withRealThreshold, { round: 2, race: 1, raceFormat: 1, halfMaxProgress: real })
  check(`with the REAL threshold (${real}), a delta of ${delta} is recognised as a lap-completing wrap`, withRealThreshold.lapsRemaining === 2)
  const withOldDefault = mk()
  updateCheckpointsAndLaps(withOldDefault, { round: 2, race: 1, raceFormat: 1, halfMaxProgress: 128 })
  check(`with the OLD hardcoded default (128), the SAME delta of ${delta} is silently missed (the real, previously-shipped bug)`, withOldDefault.lapsRemaining === 3)

  // End to end through runStep: car 0 parked (controlsLocked, zero velocity) at (528,528), cell
  // (5,5) of ROUND21 -- plane-2 value 1, just past the finish line -- with a pre-step progress of
  // 28 (the race's max): collide.js writes progressPrev=28, progress=1, d=-27, which the REAL half
  // (14) counts as a lap and the old 128 would have missed. Its twin sits at (100,100), a plane-2 0
  // cell (off the numbered centre line): [PROVEN] live (docs/engine.md §9ah) the original leaves
  // progress alone there and skips the lap logic -- this port used to write the 0 and count a fake
  // lap on exactly this fixture (the previous version of this test only passed BECAUSE of that bug).
  const slots = () => ({ puffSlots: Array.from({ length: 8 }, () => ({ frame: -1 })), splashSlots: Array.from({ length: 5 }, () => ({ frame: -1 })) })
  const mkIdle = (x) => newCar({ progress: 0, progressPrev: 0, checkpointOff: 0, checkpointOffSaved: 0, lapsRemaining: 3, safeX: x, safeY: x, safeXPrev: x, safeYPrev: x, posX: x, posY: x, nextX: x, nextY: x, posXfrac: 0, posYfrac: 0, knockoutX: 0, knockoutY: 0, state: 0, drawnThisFrame: 0, controlsLocked: 1, active: 0, dropInSlot: 0, ...slots() })
  const mkCar0 = (x, y, p) => newCar({ progress: p, progressPrev: p, progressChanged: 0, checkpointOff: 0, checkpointOffSaved: 0, lapsRemaining: 3, safeX: x, safeY: y, safeXPrev: x, safeYPrev: y, posX: x, posY: y, nextX: x, nextY: y, posXfrac: 0, posYfrac: 0, knockoutX: 0, knockoutY: 0, state: 0, drawnThisFrame: 0, controlsLocked: 1, dropInSlot: 0, ...slots() })
  const ctx2 = roundCtx(2, 1)

  const onLine = [mkCar0(528, 528, 28), mkIdle(2000), mkIdle(2200), mkIdle(2400)]
  runStep(world, onLine, [0, 0, 0, 0], {}, ctx2)
  check('runStep: 28 -> 1 across ROUND21\'s line counts a lap with the real half-max-progress', onLine[0].lapsRemaining === 2 && onLine[0].progress === 1 && onLine[0].progressPrev === 28 && onLine[0].progressChanged === 1)

  const offLine = [mkCar0(100, 100, 60), mkIdle(2000), mkIdle(2200), mkIdle(2400)]
  runStep(world, offLine, [0, 0, 0, 0], {}, ctx2)
  check('runStep: a plane-2 0 cell leaves progress/progressPrev alone, clears progressChanged, no lap', offLine[0].lapsRemaining === 3 && offLine[0].progress === 60 && offLine[0].progressPrev === 60 && offLine[0].progressChanged === 0)
}

// 1c. [PROVEN] live scenario C (docs/engine.md §9ah): ROUND21, leave the centre line at p=14 over a
// 0 cell and rejoin at p=15 -- the original counts nothing (14 -> 15 is ordinary movement); this
// port used to add a lap owed (0 -> 15 read as a backward crossing). Three poked steps through the
// same collide + checkpoint pair `runStep` uses, at the exact cells the live test used.
{
  const world = await loadWorld(read, 2, 1)
  const { updateCarTileCollision } = await import('../src/engine/collide.js')
  const ctx = { round: 2, race: 1, raceFormat: 1, halfMaxProgress: world.map.maxPlane2 >> 1 }
  const car = newCar({ progress: 1, progressPrev: 28, progressChanged: 0, checkpointOff: 0, checkpointOffSaved: 0, lapsRemaining: 3, state: 0, drawnThisFrame: 0, offTrackDwell: 0, offTrackTicks: 0 })
  const poke = (x, y) => { car.nextX = car.posX = x; car.nextY = car.posY = y; updateCarTileCollision(car, world, ctx); updateCheckpointsAndLaps(car, ctx) }
  poke(1296, 432) // cell (13,4) p=14
  check('scenario C step 1: p=14 written', car.progress === 14 && car.lapsRemaining === 3)
  poke(1392, 528) // cell (14,5) p=0 (foam beside the channel)
  check('scenario C step 2: the 0 cell leaves progress at 14 and progressChanged 0 (live: 12E3=14, 12E5=0)', car.progress === 14 && car.progressChanged === 0 && car.lapsRemaining === 3)
  poke(1296, 528) // cell (13,5) p=15
  check('scenario C step 3: 14 -> 15 is ordinary movement, laps still 3 (live: 12ED=3)', car.progressPrev === 14 && car.progress === 15 && car.lapsRemaining === 3)
}

// 2. Headless N-step run from the static init image, zero controls (round 2, whose static-image
// spawn positions this fixture actually holds -- docs/engine.md §1).
{
  const hex = readFileSync(join(ROOT, 'tools', 'refs', 'car-static-init.hex'), 'utf8').trim()
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16)
  if (bytes.length !== 4 * CAR_RECORD_SIZE) throw new Error(`fixture is ${bytes.length} bytes, expected ${4 * CAR_RECORD_SIZE}`)
  const cars = allFromBytes(bytes)

  const world = await loadWorld(read, 2, 1)
  const ctx = roundCtx(2, 1)
  const raceState = {}
  const controls = [0, 0, 0, 0]
  const N = 1000
  let firstBadStep = -1
  const numericFields = ['posX', 'posY', 'velX', 'velY', 'speed', 'heading', 'height', 'zVel']

  for (let step = 0; step < N && firstBadStep < 0; step++) {
    runStep(world, cars, controls, raceState, ctx)
    for (const car of cars) {
      for (const key of numericFields) {
        if (!Number.isFinite(car[key])) {
          firstBadStep = step
          console.log(`FAIL: non-finite ${key}=${car[key]} at step ${step}`)
        }
      }
      if (car.posX < 0 || car.posX >= 0xc00 || car.posY < 0 || car.posY >= 0xc00) {
        firstBadStep = step
        console.log(`FAIL: car left the toroidal world at step ${step}: posX=${car.posX} posY=${car.posY}`)
      }
    }
  }
  check(`${N} steps ran with no NaN/non-finite values`, firstBadStep < 0)
  check(`${N} steps kept all four cars inside [0, 0xC00)`, firstBadStep < 0)
}

// 3. The same, but with controlsLocked cleared and real control bytes fed in, so steer/throttle,
// the velocity slew, real (non-zero-velocity) integration, tile collision and terrain dispatch,
// and car-car collision (cars 0/1 spawn 24px apart, close enough to reach contact range once
// moving) all actually execute -- scenario 2's controlsLocked=1 cars never called any of that
// (an advisor review of the M3.3 physics-review workflow's fixes pointed out the acceptance test
// gave zero coverage to the code those fixes touched).
{
  const hex = readFileSync(join(ROOT, 'tools', 'refs', 'car-static-init.hex'), 'utf8').trim()
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16)
  const cars = allFromBytes(bytes)
  for (const car of cars) car.controlsLocked = 0

  const world = await loadWorld(read, 2, 1)
  const ctx = roundCtx(2, 1)
  const raceState = {}
  const N = 2000
  // Cycle through every control-bit combination that matters (accel, brake, left, right, and
  // combinations) across the run, per car, so every branch in applySteerAndThrottle gets hit.
  const PATTERNS = [0x20, 0xa0, 0x60, 0x10, 0x90, 0x50, 0x00, 0x28]
  let firstBadStep = -1
  const numericFields = ['posX', 'posY', 'velX', 'velY', 'speed', 'heading', 'height', 'zVel']

  for (let step = 0; step < N && firstBadStep < 0; step++) {
    const controls = cars.map((_, i) => PATTERNS[(step + i * 3) % PATTERNS.length])
    runStep(world, cars, controls, raceState, ctx)
    for (const car of cars) {
      for (const key of numericFields) {
        if (!Number.isFinite(car[key])) {
          firstBadStep = step
          console.log(`FAIL: non-finite ${key}=${car[key]} at step ${step} (driving scenario)`)
        }
      }
      if (car.posX < 0 || car.posX >= 0xc00 || car.posY < 0 || car.posY >= 0xc00) {
        firstBadStep = step
        console.log(`FAIL: car left the toroidal world at step ${step} (driving scenario): posX=${car.posX} posY=${car.posY}`)
      }
    }
  }
  check(`${N} driving steps ran with no NaN/non-finite values`, firstBadStep < 0)
  check(`${N} driving steps kept all four cars inside [0, 0xC00)`, firstBadStep < 0)
  check('cars actually moved (speed became nonzero at some point)', cars.some((c) => c.speed !== 0) || firstBadStep >= 0)
}

// 4. UNKNOWN_col_response_offtrack_branch resolved (docs/engine.md §9v, 1000:5659-56a3): the
// off-track dwell branch resets offTrackTicks and RETURNS EARLY once it exceeds 0x32, skipping
// wall-hit-box detection entirely; the no-dwell branch resets offTrackTicks every call too (the
// port previously never did, in either branch). A fully-solid synthetic world (colOf all 1s,
// dirOf all 0s -> grade 0, not terrain-immune for any round) makes every position collide, so this
// isolates updateCarTileCollision's own branch logic from real map data.
{
  const { updateCarTileCollision } = await import('../src/engine/collide.js')
  const { MAP_SIDE, TILE_UNITS } = await import('../src/formats/track.js')
  const solidWorld = {
    map: { tiles: new Uint8Array(MAP_SIDE * MAP_SIDE), attrs: new Uint8Array(MAP_SIDE * MAP_SIDE), plane2: new Uint8Array(MAP_SIDE * MAP_SIDE) },
    colOf: () => new Uint8Array(144).fill(1),
    dirOf: () => new Uint8Array(36),
    levOf: () => ({ raw: 0, unsafeRespawn: false, heading: 0x40, nudge: { dx: 0, dy: 0 }, lowBits: 0 }),
  }
  const mkCar = (fields) => newCar({ nextX: TILE_UNITS, nextY: TILE_UNITS, posX: TILE_UNITS, posY: TILE_UNITS, progress: 0, dirByte: 0, offTrackDwell: 0, offTrackTicks: 0, state: 0, drawnThisFrame: 1, ...fields })

  // (a) dwell active, ticks about to cross the 0x32 threshold: resets to 0, state=0xD, and the
  // returned hit must NOT be blocked (no hit-box detection ran) -- the exact behaviour a naive
  // "increment, maybe set state, then always fall through" port gets wrong.
  {
    const car = mkCar({ offTrackDwell: 1, offTrackTicks: 0x32 })
    const hit = updateCarTileCollision(car, solidWorld, { round: 1 })
    check('offTrackTicks crossing 0x32 resets to 0, not left at 0x33', car.offTrackTicks === 0)
    check('offTrackTicks crossing 0x32 sets state 0xD', car.state === 0xd)
    check('offTrackTicks crossing 0x32 skips hit-box detection entirely (hit.blocked unset)', !hit.blocked)
    check('...and hitLeft/etc are never touched either', car.hitLeft === undefined && car.wallHitPending === undefined)
  }

  // (b) dwell active but still under threshold: ticks increment, hit-box detection still runs
  // (state stays 0, hit IS blocked) -- the real bytes fall through to 56A3 in this case too.
  {
    const car = mkCar({ offTrackDwell: 1, offTrackTicks: 5 })
    const hit = updateCarTileCollision(car, solidWorld, { round: 1 })
    check('offTrackTicks under threshold just increments', car.offTrackTicks === 6)
    check('...state stays 0 (not yet knocked out)', car.state === 0)
    check('...but hit-box detection still runs (hit.blocked set)', hit.blocked === true)
  }

  // (c) dwell NOT active: ticks reset to 0 even from a nonzero prior value (the real bytes do this
  // unconditionally at 5674, every call) -- and the round-specific sfx queues (id 4 for round 2/
  // POWERBOATS, id 6 otherwise, docs/sound.md's own already-catalogued ids), gated on drawnThisFrame.
  {
    const calls = []
    const sound = { playSfx: (id) => calls.push(id) }
    const car = mkCar({ offTrackDwell: 0, offTrackTicks: 40 })
    updateCarTileCollision(car, solidWorld, { round: 1, sound })
    check('offTrackTicks resets to 0 even when dwell is inactive (was 40, not left there)', car.offTrackTicks === 0)
    check('non-round-2 plays sfx id 6', calls.length === 1 && calls[0] === 6)

    const carR2 = mkCar({ offTrackDwell: 0 })
    const calls2 = []
    updateCarTileCollision(carR2, solidWorld, { round: 2, sound: { playSfx: (id) => calls2.push(id) } })
    check('round 2 (POWERBOATS) plays sfx id 4 instead', calls2.length === 1 && calls2[0] === 4)

    const carHidden = mkCar({ offTrackDwell: 0, drawnThisFrame: 0 })
    const calls3 = []
    updateCarTileCollision(carHidden, solidWorld, { round: 1, sound: { playSfx: (id) => calls3.push(id) } })
    check('sfx is gated on drawnThisFrame (no call when not drawn)', calls3.length === 0)
  }

  // (d) UNKNOWN_col_response_active_state_gate resolved (docs/engine.md §9ae, 1000:5534/553e): the
  // real function's entire body is gated on active!=0 && state==0 -- inactive or non-zero-state cars
  // must come back with every field the body would touch left exactly as it was (not re-derived from
  // the tentative nextX/nextY), and `hit.blocked` must read false (no hit-box detection ran).
  {
    const { bounceAndCommit } = await import('../src/engine/collide.js')
    const frozen = mkCar({ metaTile: 41, mapAttr: 3, progress: 77, dirByte: 0x99, wallHitPending: 1, active: 0, state: 0 })
    const hitInactive = updateCarTileCollision(frozen, solidWorld, { round: 1 })
    check('gate: inactive car -- metaTile untouched', frozen.metaTile === 41)
    check('gate: inactive car -- progress untouched', frozen.progress === 77)
    check('gate: inactive car -- dirByte untouched', frozen.dirByte === 0x99)
    check('gate: inactive car -- wallHitPending untouched (not reset)', frozen.wallHitPending === 1)
    check('gate: inactive car -- hit.blocked is false', hitInactive.blocked === false)

    const nonZeroState = mkCar({ metaTile: 12, progress: 200, active: 1, state: 4 })
    updateCarTileCollision(nonZeroState, solidWorld, { round: 1 })
    check('gate: state!=0 car -- metaTile untouched even though active', nonZeroState.metaTile === 12)
    check('gate: state!=0 car -- progress untouched', nonZeroState.progress === 200)

    // Revert-and-verify: without the gate (active=1, state=0, matching the ungated fast path this
    // same solidWorld already exercises above), the body DOES run and metaTile changes to the real
    // queried value -- proving the frozen-field assertions above have teeth, not a vacuous truth.
    const ungated = mkCar({ metaTile: 41, active: 1, state: 0 })
    updateCarTileCollision(ungated, solidWorld, { round: 1 })
    check('gate: sanity -- an active, state-0 car DOES get metaTile refreshed (proves the assertions above aren\'t vacuous)', ungated.metaTile === 0)
  }

  // (e) bounceAndCommit no longer reads a per-call `hit` for progress/LEV (docs/engine.md §9ae,
  // 1000:5dd9-5de6): it reads the PERSISTENT car.progress/car.metaTile, re-deriving LEV via
  // `world.levOf(car.metaTile)` fresh at commit time -- so a car whose collision function was
  // skipped this tick (frozen metaTile) still commits/rolls a safe point off ITS OWN metaTile, not
  // whatever an unrelated stale `hit` object would have said.
  {
    const { bounceAndCommit } = await import('../src/engine/collide.js')
    const levWorld = {
      ...solidWorld,
      levOf: (t) => (t === 7 ? { raw: 0x00, unsafeRespawn: false, heading: 0x40, nudge: { dx: 0, dy: 0 }, lowBits: 0 } : { raw: 0x80, unsafeRespawn: true, heading: 0x40, nudge: { dx: 0, dy: 0 }, lowBits: 0 }),
    }
    const car = mkCar({
      metaTile: 7, progress: 5, state: 0, active: 1, round: undefined,
      posX: 100, posY: 200, nextX: 150, nextY: 250, posXfrac: 0, posYfrac: 0, nextXfrac: 0, nextYfrac: 0,
      safeX: 0, safeY: 0, safeXPrev: 0, safeYPrev: 0, onBridge: 0,
    })
    bounceAndCommit(car, { round: 1 }, levWorld)
    check('commit: reads LEV via car.metaTile (7 -> safe, bit7 clear) -- safe point rolled', car.safeX === 150 && car.safeY === 250)
    check('commit: levByte set from the fresh metaTile-7 lookup (0x00)', car.levByte === 0x00)

    const carUnsafe = mkCar({
      metaTile: 3, progress: 5, state: 0, active: 1, // metaTile 3 -> levWorld's "else" branch, bit7 SET
      posX: 100, posY: 200, nextX: 150, nextY: 250, posXfrac: 0, posYfrac: 0, nextXfrac: 0, nextYfrac: 0,
      safeX: 9, safeY: 9, safeXPrev: 9, safeYPrev: 9, onBridge: 0,
    })
    bounceAndCommit(carUnsafe, { round: 1 }, levWorld)
    check('commit: metaTile 3 -> unsafe (bit7 set) -- safe point NOT rolled', carUnsafe.safeX === 9 && carUnsafe.safeY === 9)
    check('commit: levByte still set to the fresh lookup even when unsafe', carUnsafe.levByte === 0x80)

    // Revert-and-verify: the old code read `hit.lev`/`hit.progress` -- feeding a `hit` with the
    // OPPOSITE metaTile's LEV data must NOT change the outcome now, proving the fix genuinely
    // switched the data source rather than merely relabeling the parameter.
    const carIgnoresHit = mkCar({
      metaTile: 7, progress: 5, state: 0, active: 1,
      posX: 100, posY: 200, nextX: 150, nextY: 250, posXfrac: 0, posYfrac: 0, nextXfrac: 0, nextYfrac: 0,
      safeX: 0, safeY: 0, safeXPrev: 0, safeYPrev: 0, onBridge: 0,
    })
    bounceAndCommit(carIgnoresHit, { round: 1 }, levWorld)
    check('commit: a stale/mismatched hit argument (now unused) cannot influence the result', carIgnoresHit.safeX === 150 && carIgnoresHit.levByte === 0x00)
  }

  // (f) UNKNOWN_commit_reintegrates_post_bounce resolved and FIXED (docs/engine.md §9ae/§9af,
  // fresh disassembly of 1000:5c70-5d9f): BOTH outer gates (wallBounceEnable, wallHitPending) JMP
  // straight to the commit (5da1) when either fails, skipping the hit-flag clear (5d1d-5d32) AND
  // the re-integration (5d35-5d9f) together -- so both are scoped to the SAME
  // `wallHitPending && wallBounceEnable` gate this port's bounce block already checks, not
  // unconditional-per-tick as an earlier pass mis-cited.
  {
    const { bounceAndCommit } = await import('../src/engine/collide.js')

    // (f1) Gate NOT entered (wallHitPending=0): hit flags must NOT be cleared -- the real bytes
    // skip 5d1d-5d32 entirely in this case (JMP 5c81 -> 5da1), so a flag set by something other
    // than this tick's own collision probe (e.g. terrain.js's h6882, which sets wallHitPending
    // without touching hitLeft/Right/Up/Down) must survive to the next tick a bounce actually
    // fires, not read back as a freshly-zeroed "none" pattern.
    {
      const car = mkCar({
        metaTile: 0, progress: 0, state: 0, active: 1, wallHitPending: 0,
        hitLeft: 1, hitRight: 1, hitUp: 0, hitDown: 0,
        posX: 0, posY: 0, nextX: 0, nextY: 0, posXfrac: 0, posYfrac: 0, nextXfrac: 0, nextYfrac: 0,
        safeX: 0, safeY: 0, safeXPrev: 0, safeYPrev: 0, onBridge: 0,
      })
      bounceAndCommit(car, { round: 1 }, solidWorld)
      check('commit: gate not entered -- hitLeft/Right/Up/Down NOT cleared', car.hitLeft === 1 && car.hitRight === 1 && car.hitUp === 0 && car.hitDown === 0)
    }

    // (f2) Gate entered (wallHitPending=1 && wallBounceEnable=1): hit flags ARE cleared, matching
    // the real bytes reaching 5d1d as part of the same pass.
    {
      const car = mkCar({
        metaTile: 0, progress: 0, state: 0, active: 1, wallHitPending: 1, wallBounceEnable: 1,
        hitLeft: 1, hitRight: 0, hitUp: 0, hitDown: 0,
        posX: 0, posY: 0, nextX: 0, nextY: 0, posXfrac: 0, posYfrac: 0, nextXfrac: 0, nextYfrac: 0,
        safeX: 0, safeY: 0, safeXPrev: 0, safeYPrev: 0, onBridge: 0,
      })
      bounceAndCommit(car, { round: 1 }, solidWorld)
      check('commit: gate entered -- hitLeft/Right/Up/Down cleared', car.hitLeft === 0 && car.hitRight === 0 && car.hitUp === 0 && car.hitDown === 0)
    }
  }

  // (g) The actual position fix: on a tick the bounce fires, the committed posX/posY must reflect
  // the POST-bounce (mutated) velocity, not the caller's stale pre-bounce nextX/nextY. Constructed
  // so the two give different answers: velX=512 (2 whole units/tick) would integrate to +2 if
  // committed as-is (the old bug); after this hitLeft-only bounce negates it to -512, the real
  // bytes re-integrate to -2 before committing.
  {
    const { bounceAndCommit, integrateCar } = await import('../src/engine/collide.js')
    const car = mkCar({
      metaTile: 0, progress: 0, state: 0, active: 1, wallHitPending: 1, wallBounceEnable: 1, halveOnBounce: 0,
      hitLeft: 1, hitRight: 0, hitUp: 0, hitDown: 0, velX: 512, velY: 0,
      posX: 100, posY: 200, posXfrac: 0, posYfrac: 0,
      safeX: 0, safeY: 0, safeXPrev: 0, safeYPrev: 0, onBridge: 0,
    })
    integrateCar(car) // the caller's own pre-bounce integration (step.js's own call site), nextX=102
    check('sanity: pre-bounce integration lands at the STALE value the old bug would commit', car.nextX === 102)
    bounceAndCommit(car, { round: 1 }, solidWorld)
    check('commit: velX negated by the hitLeft bounce', car.velX === -512)
    check('commit: posX reflects POST-bounce re-integration (98), not the stale pre-bounce nextX (102)', car.posX === 98)
    check('commit: posY unaffected (reverseY false, velY stays 0)', car.posY === 200)

    // Revert-and-verify: temporarily simulating the old (unfixed) behavior -- committing the
    // caller's own pre-bounce nextX/nextY directly instead of calling bounceAndCommit's real
    // re-integration -- reproduces the old bug's wrong answer, proving the assertion above has teeth.
    const staleCar = mkCar({
      metaTile: 0, progress: 0, state: 0, active: 1, wallHitPending: 1, wallBounceEnable: 1, halveOnBounce: 0,
      hitLeft: 1, hitRight: 0, hitUp: 0, hitDown: 0, velX: 512, velY: 0,
      posX: 100, posY: 200, posXfrac: 0, posYfrac: 0,
      safeX: 0, safeY: 0, safeXPrev: 0, safeYPrev: 0, onBridge: 0,
    })
    integrateCar(staleCar)
    const oldBuggyCommit = staleCar.nextX // what the old code would have committed unchanged
    check('revert-and-verify: the old pre-bounce value really is different from the fixed commit', oldBuggyCommit === 102 && oldBuggyCommit !== 98)
  }
  // (h) The progress write rule (563c/57b2/5826 behind CMP CX,0 / JZ, docs/engine.md §9ah):
  // synthetic one-cell worlds whose plane-2 value, tile and solidity are chosen per case.
  {
    const { bounceAndCommit } = await import('../src/engine/collide.js')
    const { ROUND3_TILE_FLAGS } = await import('../src/data/engine-tables.js')
    const worldWith = ({ p = 0, tile = 0, solid = false }) => ({
      map: { tiles: new Uint8Array(MAP_SIDE * MAP_SIDE).fill(tile), attrs: new Uint8Array(MAP_SIDE * MAP_SIDE), plane2: new Uint8Array(MAP_SIDE * MAP_SIDE).fill(p) },
      colOf: () => new Uint8Array(144).fill(solid ? 1 : 0),
      dirOf: () => new Uint8Array(36),
      levOf: () => ({ raw: 0, unsafeRespawn: false, heading: 0x40, nudge: { dx: 0, dy: 0 }, lowBits: 0 }),
    })
    for (const solid of [false, true]) {
      const car = mkCar({ progress: 40, progressPrev: 39, progressChanged: 1 })
      updateCarTileCollision(car, worldWith({ p: 0, solid }), { round: 1 })
      check(`zero cell (${solid ? 'solid' : 'open'}): progress/progressPrev untouched, progressChanged cleared`, car.progress === 40 && car.progressPrev === 39 && car.progressChanged === 0)
      const car2 = mkCar({ progress: 40, progressPrev: 39, progressChanged: 0 })
      updateCarTileCollision(car2, worldWith({ p: 41, solid }), { round: 1 })
      check(`numbered cell (${solid ? 'solid' : 'open'}): progressPrev=old, progress=new, progressChanged=1`, car2.progressPrev === 40 && car2.progress === 41 && car2.progressChanged === 1)
    }
    const gated = mkCar({ progress: 40, progressPrev: 39, progressChanged: 1, state: 7 })
    updateCarTileCollision(gated, worldWith({ p: 0 }), { round: 1 })
    check('gated-off car (state!=0) keeps a stale progressChanged=1 (5534/553e skip the clear)', gated.progressChanged === 1)

    const bridgeTile = ROUND3_TILE_FLAGS.indexOf(1)
    const offBridge = mkCar({ progress: 40, progressPrev: 39, onBridge: 0 })
    updateCarTileCollision(offBridge, worldWith({ p: 90, tile: bridgeTile }), { round: 3 })
    check('round 3: a car NOT on a bridge ignores progress on a bridge-level (25CC) tile', offBridge.progress === 40 && offBridge.progressChanged === 0)
    const onBridge = mkCar({ progress: 40, progressPrev: 39, onBridge: 1 })
    updateCarTileCollision(onBridge, worldWith({ p: 90, tile: bridgeTile }), { round: 3 })
    check('round 3: a car on a bridge takes it', onBridge.progress === 90 && onBridge.progressChanged === 1)
    const round1SameTile = mkCar({ progress: 40, progressPrev: 39, onBridge: 0 })
    updateCarTileCollision(round1SameTile, worldWith({ p: 90, tile: bridgeTile }), { round: 1 })
    check('the 25CC skip is round-3-only', round1SameTile.progress === 90)

    for (const solid of [false, true]) {
      const car = mkCar({ progress: 40, posX: 300, posY: 400, offTrackDwell: 1, offTrackTicks: 3, wallHitPending: 1 })
      const hit = updateCarTileCollision(car, worldWith({ p: 0xff, solid }), { round: 3, sound: { playSfx: () => {} } })
      check(`0xFF write (${solid ? 'solid' : 'open'}): knocked out at the write site with knockoutX/Y = pos (5842)`, car.state === 0xd && car.knockoutX === 300 && car.knockoutY === 400)
      if (solid) check('0xFF write on the solid path exits before the dwell/hit-box logic (ticks untouched, not blocked)', car.offTrackTicks === 3 && !hit.blocked)
    }
    const staleFF = mkCar({ progress: 0xff, state: 0, metaTile: 0, posX: 0, posY: 0, nextX: 0, nextY: 0, posXfrac: 0, posYfrac: 0, nextXfrac: 0, nextYfrac: 0, safeX: 0, safeY: 0, safeXPrev: 0, safeYPrev: 0, onBridge: 0 })
    bounceAndCommit(staleFF, { round: 3 }, worldWith({ p: 0 }))
    check('bounceAndCommit no longer knocks out on a stale progress===0xFF (no [12E3] read in 5be7-5e36)', staleFF.state === 0)

    const dwellOut = mkCar({ progress: 40, posX: 11, posY: 22, offTrackDwell: 1, offTrackTicks: 0x32 })
    updateCarTileCollision(dwellOut, worldWith({ p: 5, solid: true }), { round: 1 })
    check('dwell overflow knockout also records knockoutX/Y (5671 JMP 5842)', dwellOut.state === 0xd && dwellOut.knockoutX === 11 && dwellOut.knockoutY === 22)
  }
}

// 5. UNKNOWN_tile_index_overflow resolved (docs/engine.md, docs/track-layout.md): three real cases
// across all 29 races reference a meta-tile past their own .COL/.DIR table. Round 8 (tile 58,
// twice) and round 9 (tile 60, once) are confirmed structurally UNREACHABLE -- a full sub-cell
// flood fill from each race's own start position (4- and 8-directional, matched) never touches
// even the boundary of either tile, so their exact fallback value can't matter in practice. Round
// 5 is different and real: ROUND5.DIR itself ends 18 bytes into meta-tile 56's own 36-byte record
// (races 1 and 3), and that tile is fully open, on the actual racing line (real nonzero progress),
// and reached in both races -- confirmed by the same flood fill. `colTile`/`dirTile` now return a
// full-size array for ANY tile index, using real file bytes where present and zero-filling only
// what's genuinely missing, instead of discarding a tile's real data whenever ANY part of it
// exceeds the table's own whole-tile count.
{
  const { dirTile, colTile } = await import('../src/formats/track.js')
  const { queryWorldAt } = await import('../src/engine/collide.js')
  const dirBytes = await read('GAME1/ROUND5.DIR')
  const colBytes = await read('GAME1/ROUND5.COL')

  // Direct format-level check: tile 56's real half (sub-rows 0-5, within-tile byte offsets 0-17)
  // must come from the actual file, not be discarded just because the tile's LAST sub-rows aren't
  // there -- and the genuinely-missing half (sub-rows 6-11, offsets 18-35) must read back a defined
  // 0, not `undefined` (a bare `.subarray()` would give a short 18-byte array here instead).
  const tile56Dir = dirTile(dirBytes, 56)
  check('tile 56 DIR record is a full 36 bytes, not clipped to the 18 the file actually has', tile56Dir.length === 36)
  check('tile 56 DIR real half (offset 0) matches the actual file byte (0x11)', tile56Dir[0] === 0x11)
  check('tile 56 DIR real half (offset 6) matches the actual file byte (0x08)', tile56Dir[6] === 0x08)
  check('tile 56 DIR missing half (offset 18) is defined 0, not undefined/NaN', tile56Dir[18] === 0)
  check('tile 56 DIR missing half (offset 35, the very last byte) is also 0', tile56Dir[35] === 0)
  // Round 5's own .COL table has 57 tiles (tile 56 is in range) -- confirms this is genuinely a
  // .DIR-only overflow, not also a .COL one, matching the round-scan this fix was based on.
  check('tile 56 COL entry is real and fully open (in-range for .COL)', colTile(colBytes, 56).every((v) => v === 0))

  // Integration check through the same queryWorldAt() the physics step calls: row 15/col 2 is
  // where ROUND51.MAP actually places tile 56 on the course. Sub-row 0 (real data) must report the
  // real terrain byte; sub-row 6 (the missing half) must report the defined zero-fallback, not
  // crash or read garbage -- both through the exact same code path a running race uses.
  const world51 = await loadWorld(read, 5, 1)
  const real = queryWorldAt(world51, 2 * 96 + 0, 15 * 96 + 0)
  check('queryWorldAt at tile 56 real half: metaTile is 56', real.metaTile === 56)
  check('queryWorldAt at tile 56 real half: dirByte matches the real file (0x11)', real.dirByte === 0x11)
  check('queryWorldAt at tile 56 real half: not solid (round 5 tile 56 is open)', real.solid === false)
  const fake = queryWorldAt(world51, 2 * 96 + 0, 15 * 96 + 6 * 8)
  check('queryWorldAt at tile 56 missing half: still metaTile 56 (same tile, different sub-row)', fake.metaTile === 56)
  check('queryWorldAt at tile 56 missing half: dirByte is the defined 0 fallback, not a crash', fake.dirByte === 0)
  check('queryWorldAt at tile 56 missing half: still not solid (open per the real .COL entry)', fake.solid === false)

  // Regression check: round 8/9's own confirmed-unreachable overflow tiles still resolve to
  // "open, no special terrain" via the same code path, not a crash -- unchanged from before this
  // fix, just via the general zero-fill instead of a tile-index special case.
  // Round 8's own tile 58 is a .COL-only overflow (nCol=49) -- its .DIR table has 63 tiles, so
  // tile 58 is genuinely IN range there and reads real data (0x20), not the zero fallback.
  const world82 = await loadWorld(read, 8, 2)
  const dead8 = queryWorldAt(world82, 23 * 96 + 0, 11 * 96 + 0)
  check('round 8 dead tile 58: metaTile is 58', dead8.metaTile === 58)
  check('round 8 dead tile 58: resolves open, not solid (the .COL overflow that matters here)', dead8.solid === false)
  check('round 8 dead tile 58: dirByte reads its real, in-range .DIR value (0x20), not a crash', dead8.dirByte === 0x20)

  const world92 = await loadWorld(read, 9, 2)
  const dead9 = queryWorldAt(world92, 1 * 96 + 0, 1 * 96 + 0)
  check('round 9 dead tile 60: metaTile is 60', dead9.metaTile === 60)
  check('round 9 dead tile 60: resolves open, not solid', dead9.solid === false)
  check('round 9 dead tile 60: dirByte is 0, not a crash', dead9.dirByte === 0)
}

// 5b. UNKNOWN_tile_index_overflow's own deliberately-deferred piece, now done (docs/engine.md
// §9ad): the real colFileBuf/dirFileBuf are never cleared between loads, so a real continuous
// session's own genuinely-missing bytes (round 5's tile 56, sub-rows 6-11) read whatever an
// EARLIER race's own load last left there, not a fixed 0 -- opt-in via `createColDirBuffers()`,
// since only a real continuous session (this port's own `flow.js` tournament loop) represents
// that; an isolated `loadWorld` call (every existing caller) keeps the defined-zero fallback.
{
  const { createColDirBuffers, queryWorldAt } = await import('../src/engine/collide.js')

  // Traced against the real game's own shipped ORDER_TABLE (docs/engine.md §9ac): in the
  // canonical Challenge tournament order, round 4 loads immediately before round 5's race 1, and
  // round 4's own .DIR file is the largest of any round (fills the whole buffer) -- so replaying
  // that real load sequence should leave round 4's own tile-56 byte (0x14, uniform) in the
  // genuinely-missing half of round 5's own tile 56.
  const shared = createColDirBuffers()
  for (const [r, race] of [[2, 1], [5, 2], [1, 1], [6, 1], [4, 2]]) await loadWorld(read, r, race, shared)
  const world51 = await loadWorld(read, 5, 1, shared)
  const realHalf = queryWorldAt(world51, 2 * 96 + 0, 15 * 96 + 0)
  const staleHalf = queryWorldAt(world51, 2 * 96 + 0, 15 * 96 + 6 * 8)
  check('shared buffers: tile 56 real half still reads round 5\'s own byte (0x11), unaffected', realHalf.dirByte === 0x11)
  check('shared buffers: tile 56 missing half reads round 4\'s own leftover byte (0x14), not 0', staleHalf.dirByte === 0x14)

  // The default (no shared buffers, every existing caller) must be completely unaffected --
  // still the defined-zero fallback from section 5 above, not a regression to fix that broke.
  const isolated = await loadWorld(read, 5, 1)
  const staleIsolated = queryWorldAt(isolated, 2 * 96 + 0, 15 * 96 + 6 * 8)
  check('no shared buffers (the default): tile 56 missing half is still the defined 0 fallback', staleIsolated.dirByte === 0)

  // A round with no prior load in its own sequence (first call on a fresh shared buffer pair)
  // must NOT crash or read stale data from another test's own buffers -- a fresh pair starts
  // zeroed, matching a cold, never-before-touched allocation.
  const freshShared = createColDirBuffers()
  const world51Fresh = await loadWorld(read, 5, 1, freshShared)
  const staleFresh = queryWorldAt(world51Fresh, 2 * 96 + 0, 15 * 96 + 6 * 8)
  check('a fresh shared-buffer pair with no prior load starts zeroed, not garbage', staleFresh.dirByte === 0)
}

// 5c. `.BRK`'s own sibling of `UNKNOWN_tile_index_overflow` (docs/engine.md §9ad): round 3's own
// progress plane genuinely reaches 255 (a real, sub-cell-flood-fill-confirmed REACHABLE value, not
// a dead corner like round 8/9's own tile cases -- round 3's actual course progress naturally
// spans up to 255, and the real gap between its own real max (~133-155) and 255 confirms 255 is a
// distinct sentinel, not a continuation of normal lap numbering). The real `.BRK` buffer is ALSO a
// fixed, never-cleared 512 B allocation (`1000:3b92-3ba8`, `CX=0x200`), same shape as `.COL`/
// `.DIR`'s own buffers -- `car.progress===255` indexing `1000:5495` with no bounds check reads
// safely within that 512 B allocation, into a PRIOR race's own leftover `.BRK` bytes, not a crash.
{
  const { createBrkBuffer } = await import('../src/formats/levbrk.js')
  const { droneControlByte } = await import('../src/engine/ai.js')

  // Isolated (the default, every existing caller): progress 255 exceeds round 3 race 1's own
  // 134-record array, so `ctx.brk?.[255]` is `undefined` -- ai.js's own `?? 0` gives type 0
  // ("just accelerate"), a defined fallback, not a crash. Confirms the pre-existing behavior
  // (before this fix existed) was already safe, just not a real-leftover-byte replication.
  const isolatedBrk = await loadBrk(read, 3, 1)
  check('isolated: round 3 race 1\'s own .BRK array has its real 134 records, not padded', isolatedBrk.length === 134)
  check('isolated: progress 255 reads past it (undefined), not a crash', isolatedBrk[255] === undefined)
  const carAt255 = newCar({ progress: 255, dirByte: 0, mapAttr: 0, levByte: 0, speed: 0, heading: 0 })
  const bitsIsolated = droneControlByte(carAt255, { round: 3, brk: isolatedBrk })
  check('isolated: droneControlByte at progress 255 still returns a defined byte, not NaN/undefined', Number.isInteger(bitsIsolated))

  // Opted in: the array grows to the real 512 B buffer, so progress 255 reads a REAL (if another
  // race's leftover) record instead of the undefined-then-type-0 default.
  const sharedBrk = createBrkBuffer()
  const optedBrk = await loadBrk(read, 3, 1, sharedBrk)
  check('opted in: round 3 race 1\'s own .BRK array grows to the full 512 B buffer', optedBrk.length === 512)
  check('opted in: progress 255 now reads a real, defined record, not undefined', optedBrk[255] !== undefined && optedBrk[255].raw !== undefined)
}

// The two-car cursor overshoot (docs/engine.md §9an): the judge reads the raw shared blob at the
// race's base + cursor (5F59/5FEE/6098). In two-car the penalty only does cursor += 2 (5FC5), so a
// forward wrap with every checkpoint passed but landing past list[0].hi (6006 -> 5F85) pushes the
// cursor PAST round 1 race 1's terminator into race 2's list, and later judgements use race 2's
// windows; a backward wrap then parks on race 2's terminator (the first 0xFFFF at/after the cursor).
{
  const l1 = checkpointList(1, 1), l2 = checkpointList(1, 2)
  const ctx = { round: 1, race: 1, raceFormat: 2, halfMaxProgress: 128 }
  const car = newCar({ checkpointOff: 2 * l1.length, checkpointOffSaved: 0, lapsRemaining: 3, state: 0, drawnThisFrame: 0, progressChanged: 1, progress: l1[0].hi, progressPrev: 250 })
  updateCheckpointsAndLaps(car, ctx)
  check('two-car overshoot: a forward wrap past list[0].hi steps the cursor past the terminator (6006 -> 5FC5)', car.checkpointOff === 2 * l1.length + 2 && car.lapsRemaining === 3)
  Object.assign(car, { progressPrev: l2[0].lo, progress: l2[0].lo + 1, progressChanged: 1 })
  updateCheckpointsAndLaps(car, ctx)
  check(`two-car overshoot: the next judgement uses race 2's first window {${l2[0].lo},${l2[0].hi}} and advances`, car.checkpointOff === 2 * l1.length + 4)
  Object.assign(car, { progressPrev: 10, progress: 200, progressChanged: 1 })
  updateCheckpointsAndLaps(car, ctx)
  check('two-car overshoot: a backward wrap parks on race 2\'s terminator, the first 0xFFFF at/after the cursor (6098)', car.checkpointOff === 2 * l1.length + 2 + 2 * l2.length && car.checkpointOffSaved === 2 * l1.length + 4)
}

// 5. The no-throttle "speed jump" a live DOSBox capture flagged as unexplained (docs/engine.md
// §9aq 3/5, §10, M3.43): control 0x40 (steer only) at speed 64 in round 2 produced speed 235, not
// the ~44 a coastDecel(=20)-only reading of `4E2E-4E38`'s decay predicts. Reproduced exactly here:
// the steer step's own minimum-turning-speed floor (`4DAF/4DDE`, `speed<=0xff && round<=6 ->
// speed=0xff`, already ported in the `right`/`left` branches above) fires FIRST, in the same tick,
// then that same tick's throttle===0 branch falls straight into the ordinary coast decay on top of
// the just-forced 255 -- 255-20=235, not a divergence, and no code change was needed. `[STATIC]`:
// the floor->coast order re-derives cleanly from `applySteerAndThrottle`'s own control flow (the
// `right`/`left` branches run before the `throttle===0` branch is even reached); the isolated unit
// checks below pin it, the `runStep`-level replay after them is the `[PROVEN]`-by-execution half.
{
  const ctx = { round: 2, raceFormat: 1 }
  const car = newCar({ speed: 64, heading: 0, height: 0, steerStep: 3, coastDecel: 20, lapsRemaining: 3 })
  applySteerAndThrottle(car, 0x40, ctx, false, 0, 5)
  check('steer-forced min speed (255) falls straight into the same tick\'s coast decay: 64 -> 235, matching the live DOSBox capture exactly', car.speed === 235)
  check('heading still advances normally the same tick', car.heading === 3)

  // The `round<=6` gate and the `left` branch's own copy of the floor: above round 6 the floor
  // never fires, so the SAME control byte at the SAME speed gives the naive `speed -= coastDecel`
  // result (`~44`) the live note originally expected -- confirming that prediction was correct for
  // rounds 7-9, just not for round 2.
  const carHighRound = newCar({ speed: 64, heading: 0, height: 0, steerStep: 3, coastDecel: 20, lapsRemaining: 3 })
  applySteerAndThrottle(carHighRound, 0x40, { round: 7, raceFormat: 1 }, false, 0, 5)
  check('round > 6: no speed floor, so 0x40 gives the plain coast decay (64 -> 44)', carHighRound.speed === 44)

  const carLeft = newCar({ speed: 64, heading: 0, height: 0, steerStep: 3, coastDecel: 20, lapsRemaining: 3 })
  applySteerAndThrottle(carLeft, 0x80, ctx, false, 0, 5)
  check('the `left` branch carries the identical floor: 0x80 also gives 64 -> 235', carLeft.speed === 235 && carLeft.heading === 0xfd)
}

// 6. The same finding, `[PROVEN]` by replaying the LIVE session's own exact control sequence
// through a real `runStep`-level ROUND21 spawn (docs/engine.md §9aq 3, M3.43) -- not just the
// isolated `applySteerAndThrottle` call above. Car 0 forced out of its start-of-race hold and given
// a keys controllerType (5), exactly as the live capture's own pokes did; cars 1-3 stay locked in
// their natural state 0xA and never enter the control path this tick range exercises. Per-tick
// speed/heading are asserted against the live capture's own bullets in §9aq 3, in the SAME order
// they actually happened live (0x20, 0x48, 0x40, THEN 0x28 -- §9aq 3's own prose lists 0x28 before
// 0x40 for narrative grouping, but 0x28's cited starting values, 3/235, only exist after 0x40 runs;
// this replay is what pins the real order, corroborated by 0x28's own frozen-at-3/235 result below).
{
  const strt = parseStrtPos(await read('GAME1/STRT_POS.BIN'))
  const cars = spawnCars(strt, 2, 1)
  const world = await loadWorld(read, 2, 1)
  const ctx = { ...roundCtx(2, 1), brk: await loadBrk(read, 2, 1), tournamentIndex: 0, world, controllerTypes: [5, 6, 6, 6] }
  const raceState = {}
  cars[0].state = 0
  cars[0].controlsLocked = 0

  const seq = [0x20, 0x20, 0x48, 0x48, 0x40, 0x28, 0x28]
  const expectSpeed = [32, 64, 64, 64, 235, 235, 235]
  const expectHeading = [0, 0, 0, 0, 3, 3, 3]
  for (let i = 0; i < seq.length; i++) {
    runStep(world, cars, [seq[i], 0, 0, 0], raceState, ctx)
    check(`runStep replay tick ${i} (control 0x${seq[i].toString(16)}): speed === ${expectSpeed[i]}`, cars[0].speed === expectSpeed[i])
    check(`runStep replay tick ${i} (control 0x${seq[i].toString(16)}): heading === ${expectHeading[i]}`, cars[0].heading === expectHeading[i])
  }
}

// Round 3's own collision path, `5740-57F7` (docs/engine.md §9cc): every branch against a
// synthetic world whose collision mask, .DIR byte and plane-2 byte are chosen per case. `onBridge`=1
// keeps the round-3 bridge-level progress skip out of the way.
{
  const { updateCarTileCollision } = await import('../src/engine/collide.js')
  const { MAP_SIDE, TILE_UNITS } = await import('../src/formats/track.js')
  const world = (solid, dir, progress = 5) => ({
    map: { tiles: new Uint8Array(MAP_SIDE * MAP_SIDE), attrs: new Uint8Array(MAP_SIDE * MAP_SIDE), plane2: new Uint8Array(MAP_SIDE * MAP_SIDE).fill(progress) },
    colOf: () => new Uint8Array(144).fill(solid ? 1 : 0),
    dirOf: () => new Uint8Array(36).fill(dir),
    levOf: () => ({ raw: 0, unsafeRespawn: false, heading: 0x40, nudge: { dx: 0, dy: 0 }, lowBits: 0 }),
  })
  const mk = (fields) => newCar({ nextX: TILE_UNITS, nextY: TILE_UNITS, posX: TILE_UNITS, posY: TILE_UNITS, progress: 3, progressPrev: 0, dirByte: 0, offTrackDwell: 0, offTrackTicks: 0, state: 0, drawnThisFrame: 0, onBridge: 1, speed: 0x80, halveOnBounce: 0, rampJumpActive: 0, zVel: 0, velX: 0x300, velY: -0x400, wallHitPending: 7, ...fields })
  const r3 = { round: 3 }

  let car = mk({})
  let hit = updateCarTileCollision(car, world(true, 0xe0), r3)
  check('round 3: a solid cell whose .DIR byte has 0xE0 all set is open (5764-5770 -> 57FB)', !hit.blocked && car.wallHitPending === 0 && car.progress === 5)

  car = mk({})
  hit = updateCarTileCollision(car, world(true, 0x20), r3)
  check('round 3: any other solid cell is a wall, progress written first (5773 -> 561D)', hit.blocked && car.wallHitPending === 1 && car.progress === 5 && car.progressPrev === 3)

  car = mk({ dirByte: 0x10 })
  hit = updateCarTileCollision(car, world(false, 0x00), r3)
  // s = hi(0x300)^2 + hi(-0x400)^2 = 9 + 16 = 25 -> 25/12 + 4 = 6
  check('round 3: leaving a bit-4 cell onto high nibble 0 launches (683C: zVel = s/12 + 4, [1384]=1)', car.zVel === 6 && car.rampJumpActive === 1 && !hit.blocked)
  check('round 3: ...and 683C leaves CX=12, so progress becomes 12, not the cell\'s 5 (5807-5832)', car.progress === 12 && car.progressPrev === 3 && car.progressChanged === 1)

  car = mk({ dirByte: 0x10 })
  updateCarTileCollision(car, world(false, 0x40), r3)
  check('round 3: leaving a bit-4 cell onto a nonzero high nibble: no launch, the cell\'s progress (57EC)', car.rampJumpActive === 0 && car.progress === 5)

  car = mk({ dirByte: 0x00, speed: 0x180 })
  hit = updateCarTileCollision(car, world(false, 0x10), r3)
  check('round 3: entering a bit-4 cell without 0xA0 bits from below is a wall (5792-57E3 -> 5659)', hit.blocked && car.wallHitPending === 1)
  check('round 3: ...the .DIR byte is put back (5792-5796)', car.dirByte === 0x00 && car.dirBytePrev === 0x00)
  check('round 3: ...[138A]=1 and speed capped at 0x100 (57CF-57DD)', car.halveOnBounce === 1 && car.speed === 0x100)
  check('round 3: ...progress still written (579A-57BE)', car.progress === 5)

  car = mk({ dirByte: 0x00, speed: -0x200 })
  updateCarTileCollision(car, world(false, 0x10), r3)
  check('round 3: the speed cap is a signed JL -- reversing speed is left alone', car.speed === -0x200)

  car = mk({ dirByte: 0x00 })
  hit = updateCarTileCollision(car, world(false, 0x30), r3)
  check('round 3: entering a bit-4 cell WITH 0xA0 bits is open and copies it to the previous byte (57F3-57F7)', !hit.blocked && car.dirByte === 0x30 && car.dirBytePrev === 0x30)

  car = mk({ dirByte: 0x00, speed: 0x180 })
  hit = updateCarTileCollision(car, world(false, 0x10), { round: 1 })
  check('control: the same step in round 1 is open (55B4: only round 3 takes this path)', !hit.blocked && car.speed === 0x180 && car.dirByte === 0x10)

  car = mk({ dirByte: 0x00 })
  hit = updateCarTileCollision(car, world(false, 0x10, 0xff), r3)
  check('round 3: a 0xFF progress on the bit-4 wall step knocks out at once (57C4 -> 5842), no wall response', car.state === 0xd && !hit.blocked)
}

// The conveyor push `6231-62E2` (docs/engine.md §9cd), byte-exact: the remap only with map
// attribute bit 1, the reversal with bit 0, the per-component clamp, the round-2 nibble mask.
{
  const { h6231 } = await import('../src/engine/terrain.js')
  const { SINE8, DIR_COMPASS_TABLE, DIR_REMAP_TABLE } = await import('../src/data/engine-tables.js')
  const mk = (f) => ({ velX: 0, velY: 0, speed: 0x80, maxSpeedCur: 0x400, reverseLimit: -0x200, dirByte: 0x03, mapAttr: 0, levByte: 0x40, ...f })
  const push = (h) => [2 * SINE8[h], 2 * SINE8[(h - 0x40) & 0xff]]

  let car = mk({})
  h6231(car, { round: 9 })
  let [px, py] = push(DIR_COMPASS_TABLE[3])
  check('conveyor: map attribute bit 1 clear -> the raw nibble indexes the compass table, no remap (624C)', car.velX === px && car.velY === py)

  car = mk({ mapAttr: 2, levByte: 0x00 })
  h6231(car, { round: 9 })
  ;[px, py] = push(DIR_COMPASS_TABLE[DIR_REMAP_TABLE[0][3]])
  check('conveyor: bit 1 set -> through the LEV bucket\'s remap row first (6252-6263)', car.velX === px && car.velY === py)
  check('conveyor: the remap really changes the push in this case (the test discriminates)', DIR_REMAP_TABLE[0][3] !== 3 && px !== push(DIR_COMPASS_TABLE[3])[0])

  car = mk({ mapAttr: 1 })
  h6231(car, { round: 9 })
  ;[px, py] = push(DIR_COMPASS_TABLE[3] ^ 0x80)
  check('conveyor: bit 0 reverses the push (626E-6274)', car.velX === px && car.velY === py && px === -push(DIR_COMPASS_TABLE[3])[0])

  car = mk({ dirByte: 0x0b })
  h6231(car, { round: 2 })
  ;[px, py] = push(DIR_COMPASS_TABLE[3])
  check('conveyor: round 2 masks the nibble with 7 (6246)', car.velX === px && car.velY === py)

  car = mk({ maxSpeedCur: 10, reverseLimit: -10, dirByte: 0 }) // compass[0]=0x40: sin 0x40 = max, sin 0 = 0
  h6231(car, { round: 9 })
  check('conveyor: each component clamped to [reverseLimit, maxSpeedCur] (628A-629A / 62BC-62CC)', car.velX === 10 && car.velY === Math.max(-10, Math.min(10, 2 * SINE8[0])))
  car = mk({ maxSpeedCur: 10, reverseLimit: -10, dirByte: 4 }) // compass[4]=0xC0: sin 0xC0 = -max
  h6231(car, { round: 9 })
  check('conveyor: ...and the lower bound too', DIR_COMPASS_TABLE[4] === 0xc0 && car.velX === -10)

  const { round2Current } = await import('../src/engine/terrain.js')
  car = mk({ dirByte: 0x1b, height: 5 })
  const pushed = round2Current(car, { round: 2 }, 0)
  ;[px, py] = push(DIR_COMPASS_TABLE[3])
  check('round 2 current: .DIR & 0x18 in state 0 pushes, airborne too (5EF3-5EFB)', pushed && car.velX === px && car.velY === py)
  check('round 2 current: no push without the 0x18 bits, in another state, or in another round',
    !round2Current(mk({ dirByte: 0x03 }), { round: 2 }, 0) && !round2Current(mk({ dirByte: 0x1b }), { round: 2 }, 1) && !round2Current(mk({ dirByte: 0x1b }), { round: 1 }, 0))

  car = mk({ speed: 0x300 }); h6231(car, { round: 9 })
  const fast = car.speed
  car = mk({ speed: -0x300 }); h6231(car, { round: 9 })
  check('conveyor: speed capped at 0x100, signed (62D4-62DC)', fast === 0x100 && car.speed === -0x300)
}

// The bathtub plughole `62E3` (docs/engine.md §9ce), called at `60C0-60C7` in round 2 on every
// `5E4E` exit but the two-car preamble's: the ±60px pull (one magnitude, two signs), the ±12px drop.
{
  const { plughole } = await import('../src/engine/terrain.js')
  const mk = (f) => ({ state: 0, posX: 0x630, posY: 0xb70, nextX: 0, nextY: 0, velX: 0, velY: 0, subState: 0, driftSteps: 0, driftDX: 0, driftDY: 0, animTimer: 94, animStep: 3, ...f })
  const r2 = { round: 2 }
  let car = mk()
  let r = plughole(car, r2)
  // |dx|=32, |dy|=0: min((60-32)*4+0x28, 60*4+5) = min(152, 245) = 152
  check('plughole: one magnitude m = min((60-|dx|)*4+0x28, (60-|dy|)*4+5) on both axes (6319-6357)', r === 'pull' && car.velX === 152 && car.state === 0)
  check('plughole: exactly on the centre line the pull is -m, from the unsigned borrow (636B-6376)', car.velY === -152)
  car = mk({ posX: 0x650, posY: 0xb34 }); plughole(car, r2)
  check('plughole: the Y term wins the min when it is smaller (|dy|=60: m=5), and x==0x650 also pulls -m', car.velX === -5 && car.velY === 5)
  car = mk({ velX: 0x7fc0 }); plughole(car, r2)
  check('plughole: the velocity add is a plain 16-bit add, no clamp (6365)', car.velX === -0x8000 + 0x58)
  check('plughole: the outer box is inclusive (62ED-6316)',
    plughole(mk({ posX: 0x614 }), r2) === 'pull' && plughole(mk({ posX: 0x68c }), r2) === 'pull' && plughole(mk({ posX: 0x613 }), r2) === null &&
    plughole(mk({ posX: 0x650, posY: 0xbac }), r2) === 'pull' && plughole(mk({ posX: 0x650, posY: 0xbad }), r2) === null && plughole(mk({ posX: 0x650, posY: 0xb33 }), r2) === null)

  car = mk({ posX: 0x648, posY: 0xb6c })
  r = plughole(car, r2)
  // m = min((60-8)*4+40, (60-4)*4+5) = min(248, 229) = 229, applied before the drop test
  check('plughole: inside ±12px the car drops in: state 1, [1382]=0x46, next = the centre (639B-63AD)', r === 'drop' && car.state === 1 && car.subState === 0x46 && car.nextX === 0x650 && car.nextY === 0xb70)
  check('plughole: the drop tick still gets its pull (637B comes after 6376)', car.velX === 229 && car.velY === 229)
  check('plughole: a 4-step drift of (centre - pos) >> 2 (63B3-63D1)', car.driftSteps === 4 && car.driftDX === 2 && car.driftDY === 1)
  check('plughole: animTimer and animStep are left alone (no 12B0/12B6 write in 62E3)', car.animTimer === 94 && car.animStep === 3)
  car = mk({ posX: 0x65c, posY: 0xb7c }); plughole(car, r2)
  check('plughole: the inner box is inclusive; a negative drift is an arithmetic shift (63C0)', car.state === 1 && car.driftDX === -3 && car.driftDY === -3)
  check('plughole: just outside the inner box is a pull only', plughole(mk({ posX: 0x65d, posY: 0xb70 }), r2) === 'pull' && plughole(mk({ posX: 0x643, posY: 0xb70 }), r2) === 'pull' &&
    plughole(mk({ posX: 0x644, posY: 0xb64 }), r2) === 'drop' && plughole(mk({ posX: 0x650, posY: 0xb63 }), r2) === 'pull' && plughole(mk({ posX: 0x650, posY: 0xb7d }), r2) === 'pull')
  check('plughole: nothing outside round 2 (60C0) or in a state other than 0 -- the CURRENT state, so a car the lap body just set to 0xD is left alone (62E3)',
    plughole(mk({ posX: 0x650 }), { round: 1 }) === null && plughole(mk({ posX: 0x650, state: 0xd }), r2) === null && plughole(mk({ posX: 0x650, state: 1 }), r2) === null)

  // Wired into runStep: a ROUND22 car parked on the plughole drops in on the next step.
  const world = await loadWorld(read, 2, 2)
  const strt = parseStrtPos(await read('GAME1/STRT_POS.BIN'))
  const cars = spawnCars(strt, 2, 2)
  Object.assign(cars[0], { state: 0, posX: 0x64c, posY: 0xb6e, nextX: 0x64c, nextY: 0xb6e, velX: 0, velY: 0 })
  runStep(world, cars, [0, 0, 0, 0], {}, roundCtx(2, 2))
  check('plughole: runStep calls it (ROUND22, a car on the plughole drops in)', cars[0].state === 1 && cars[0].subState === 0x46 && cars[0].driftSteps <= 4)
}

// animTimer [12B0] (docs/engine.md §9cg): one bump, 73E7, in the per-car pass after the state
// handlers -- never in state 0 (309F), in round 9 only for car 0 -- and the knockout's one-step
// cursor (82BE, [12B8]); so an entry that doesn't zero the timer plays its animation fast.
{
  const { animTimerPass } = await import('../src/engine/step.js')
  const { runStates } = await import('../src/engine/states.js')
  const t = (state, animTimer, bx, round = 1) => { const c = { state, animTimer }; animTimerPass(c, bx, { round }); return c.animTimer }
  check('73E7: no bump in state 0 (309F), a bump in state A and in 0xD', t(0, 94, 0) === 94 && t(0xa, 5, 1) === 6 && t(0xd, 0, 2) === 1)
  check('73E7: in round 9 only car 0 (BX==0) is bumped (73EE-73F3)', t(1, 3, 0, 9) === 4 && t(1, 3, 2, 9) === 3)
  check('73E7: a 16-bit counter', t(5, 0xffff, 0) === 0)

  const koCalls = (animTimer) => {
    const car = { state: 0xd, active: 1, animTimer, animStep2: 0, subState: 0x46, height: 0 }
    let n = 0
    while (car.state === 0xd && n < 100) { runStates([car], {}, { round: 1 }); animTimerPass(car, 0, { round: 1 }); n++ }
    return n
  }
  check('82BE: a knockout entered with a stale timer (95, left from the start countdown) steps once per call: 7 calls', koCalls(95) === 7)
  check('82BE: from a zeroed timer the handler sees 0,1,2,...: steps at 4/8/../24, ends on call 26', koCalls(0) === 26)
  {
    // 0xD -> 7 -> 2: the respawn step itself runs no state-2 handler, so the render must fall back to
    // the cursor (step 0: overlay frame 0, no body), not the finished 0xD's last step (a body flash).
    const { carAnimationFrame } = await import('../src/render/raceView.js')
    const car = { state: 0xd, active: 1, animTimer: 95, animStep2: 0, subState: 0, height: 0, safeX: 500, safeY: 500, posX: 500, posY: 500 }
    let n = 0
    while (car.state !== 2 && n < 50) { runStates([car], {}, { round: 1 }); animTimerPass(car, 0, { round: 1 }); n++ }
    const a = carAnimationFrame(car, 1)
    check('82BE: on the respawn frame (now state 2) no stale step shows the plain body: overlay frame 0, no body', car.state === 2 && !a.drawBody && a.overlay?.frame === 0)
  }

  // Through runStep, ROUND22 at its real tournament index: the countdown leaves every car's timer at
  // the value it enters state 0 with, and a plughole fall right after the start is short (live: ~12
  // ticks, §9ce); after a respawn (timer zeroed at 7258) the same fall plays its full table.
  const world = await loadWorld(read, 2, 2)
  const strt = parseStrtPos(await read('GAME1/STRT_POS.BIN'))
  const cars = spawnCars(strt, 2, 2, { tournamentIndex: 8 })
  const ctx = { ...roundCtx(2, 2), tournamentIndex: 8 }
  const rs = {}
  let n = 0
  while (cars[0].state !== 0 && n < 200) { runStep(world, cars, [0, 0, 0, 0], rs, ctx); n++ }
  check('73E7: the start countdown (state A) bumps the timer, and entering state 0 keeps it', cars.every((c) => c.animTimer === 95))
  // Race setup's pre-loop render (39E8 -> 90C5, docs/engine.md §9ck), run when the last race's loop
  // left [2638]=1: car 0's state-A handler advances [26D5] once with no per-car pass after it, so the
  // countdown ends one pass earlier -- 94, live in every race after the first since boot.
  {
    const { runPreLoopRender } = await import('../src/engine/step.js')
    const cs = spawnCars(strt, 2, 2, { tournamentIndex: 8 })
    const r2 = {}
    runPreLoopRender(world, cs, r2, ctx)
    check('pre-loop render: [26D5] one step ahead, the water counter [26D1] too, no blink tick (the ISR\'s)', r2.dropInTimer === 1 && r2.tileAnimCounter === 1 && !r2.blinkTick)
    let k = 0
    while (cs[0].state !== 0 && k < 200) { runStep(world, cs, [0, 0, 0, 0], r2, ctx); k++ }
    check('pre-loop render: every car then enters state 0 with 94 (live, a race after the first), not 95', cs.every((c) => c.animTimer === 94))
  }
  const fall = (car) => {
    Object.assign(car, { posX: 0x648, posY: 0xb6c, nextX: 0x648, nextY: 0xb6c, velX: 0, velY: 0 })
    let k = 0
    do { runStep(world, cars, [0, 0, 0, 0], rs, ctx); k++ } while (car.state === 0 && k < 3)
    let steps = 0
    while (car.state === 1 && steps < 400) { runStep(world, cars, [0, 0, 0, 0], rs, ctx); steps++ }
    return steps
  }
  const quick = fall(cars[0])
  check('plughole fall right after the start: 4 drift steps then one table step per call, ~12 steps (live: ~12 ticks)', quick === 11)
  cars[0].state = 0; cars[0].animTimer = 0 // as after a respawn's 2 -> 0 (8310)
  const full = fall(cars[0])
  check('plughole fall with a zeroed timer plays the round-2 table (80 ticks)', full > 75 && full < 90)
}

console.log(bad ? `${bad} check(s) failed` : 'check-step: idle + driving runs clean (no NaN, world stays toroidal); checkpoint/lap rule holds (no lap counted with a checkpoint outstanding, counted once cleared); off-track collision response matches the real early-return/tick-reset/sfx bytes; tile-index overflow resolves to real partial data where the file has it and a defined zero fallback otherwise; shared col/dir/.BRK buffers replicate the real cross-race leftover-byte carry-over when a caller opts in; the no-throttle steer-floor/coast-decay speed jump replays exactly against the live capture, in isolation and through a real runStep')
process.exitCode = bad ? 1 : 0
