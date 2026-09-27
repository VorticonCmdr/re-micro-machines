// M3.6 acceptance test, headless half (the browser half -- an actual human completing ROUND21 --
// isn't automatable from here; verified manually via npm run dev, see docs/engine.md's M3.6
// section for how). This covers what IS headless-verifiable:
//   1. A fresh spawn (race.js's spawnCars/camera.js's initCameraState, the ACTUAL from-scratch
//      race setup M3.6 adds -- M3.3-M3.5's own tests all ran from a captured/synthetic car array,
//      never from a real spawn) runs cleanly for many steps: no NaN, world stays toroidal, the
//      drop-in hold (state 0xA) ends and controls unlock, at least one drone actually moves.
//   2. Determinism: `input.js`'s OWN `recordingReader` wraps car 0's control source for one run;
//      `createTapeReader` replays that exact recording for a second, freshly-spawned run. Using
//      the real recorder/tape-reader pair (not just re-feeding the same array by hand) is the
//      point -- an earlier draft fed both runs from the identical `PATTERNS[step % N]` expression
//      directly, which only proved the engine is a pure function of its inputs and never executed
//      either function in input.js (advisor-caught: that draft's determinism claim was true but
//      the test recorded nothing).
//   3. States 1/4/5/E (M3.6's own new state handlers) actually run to their documented end. None
//      of ROUND21's own terrain dispatches into them (its row has neither hazard handler nor
//      `6ae5`, confirmed against TERRAIN_ROWS[1]), so the play-through above never reaches them --
//      exercised here directly instead of just asserted (advisor-caught: docs/engine.md §9h had
//      claimed this was "exercised" when no test in the repo actually forced these states).
//   node tools/check-play.mjs
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseStrtPos } from '../src/formats/globaldata.js'
import { loadWorld, loadBrk, roundCtx, spawnCars } from '../src/engine/race.js'
import { runStep, computeRanking, recountRaceOver } from '../src/engine/step.js'
import { droneControlByte } from '../src/engine/ai.js'
import { initCameraState, updateCamera } from '../src/engine/camera.js'
import { viewCoord, inClipWindow } from '../src/engine/drawn.js'
import { carAnimationFrame } from '../src/render/raceView.js'
import { animTimerPass } from '../src/engine/step.js'
import { recordingReader, createTapeReader } from '../src/engine/input.js'
import { updateCheckpointsAndLaps } from '../src/engine/checkpoints.js'
import { checkpointList } from '../src/data/engine-tables.js'
import { createSmoothnessGate } from '../src/engine/smoothness.js'
import { updateEngines } from '../src/engine/sound.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const GAME = join(ROOT, 'game')
const read = async (n) => new Uint8Array(readFileSync(join(GAME, n)))

const ROUND = 2, RACE = 1
const N = 2000
// A fixed (not random -- determinism must not depend on a PRNG seed either) cycling pattern
// exercising every control-bit combination, same spirit as check-step.mjs's driving scenario.
const PATTERNS = [0x20, 0xa0, 0x60, 0x10, 0x90, 0x50, 0x00, 0x28]

let bad = 0
function check(name, cond) {
  if (cond) return
  bad++
  console.log(`FAIL: ${name}`)
}

async function setupRace() {
  const strt = parseStrtPos(await read('GAME1/STRT_POS.BIN'))
  const cars = spawnCars(strt, ROUND, RACE)
  const camera = initCameraState(strt.find((s) => s.round === ROUND && s.race === RACE))
  const world = await loadWorld(read, ROUND, RACE)
  const ctx = { ...roundCtx(ROUND, RACE), brk: await loadBrk(read, ROUND, RACE), tournamentIndex: 0, world }
  return { cars, camera, world, ctx, raceState: {} }
}

function runRace(setup, car0Reader) {
  const { cars, camera, world, ctx, raceState } = setup
  ctx.camera = camera
  for (let step = 0; step < N; step++) {
    const controls = cars.map((car, i) => (i === 0 ? car0Reader.read() : droneControlByte(car, ctx)))
    runStep(world, cars, controls, raceState, ctx)

    for (const car of cars) {
      for (const key of ['posX', 'posY', 'velX', 'velY', 'speed', 'heading', 'height', 'zVel']) {
        if (!Number.isFinite(car[key])) throw new Error(`non-finite ${key}=${car[key]} at step ${step}`)
      }
      if (car.posX < 0 || car.posX >= 0xc00 || car.posY < 0 || car.posY >= 0xc00) {
        throw new Error(`car left the toroidal world at step ${step}: posX=${car.posX} posY=${car.posY}`)
      }
    }
  }
}

/**
 * M3.6's new state handlers (1/4/5) directly, since ROUND21's own terrain never reaches them.
 * State E's own resolution is no longer generic (M3.13, docs §9r): it's round 3's real shortcut
 * sequencer, needs a genuine `dropin.js` `triggerDropIn` entry (position/checkpointOff matching a
 * real table cell) to progress past subState 1 -- tested separately in `checkDropIn` below, not
 * here. A car parked in state 4 with no such setup still reaches state 0xE (state 4's own ending
 * is unconditional), but then correctly stalls at subState 0 (not a reachable real-game state, see
 * `dropin.js`'s `stepDropIn` default case) rather than resolving on its own.
 */
function checkNewStates() {
  const car = { state: 4, animTimer: 0, active: 1, subState: 0, height: 0, zVel: 0 }
  return import('../src/engine/states.js').then(({ runStates: runStatesOnly }) => {
    const runStates = (cars, rs, ctx) => { runStatesOnly(cars, rs, ctx); cars.forEach((c, i) => animTimerPass(c, i, ctx)) }
    const raceState = {}
    let sawStateE = false
    for (let i = 0; i < 60 && !sawStateE; i++) {
      runStates([car], raceState, { round: ROUND })
      if (car.state === 0xe) sawStateE = true
    }
    check('state 4 (fall) ends in state 0xE with active=0', sawStateE && car.active === 0)

    // Both animation tables' own threshold lists run past 160 ticks (CRASH_ANIM,
    // STATE1_ANIM_DEFAULT) before their 0xFFFF sentinel -- 200 iterations covers either.
    const crashCar = { state: 5, animTimer: 0, active: 1 }
    for (let i = 0; i < 200 && crashCar.state !== 7; i++) runStates([crashCar], {}, { round: ROUND })
    check('state 5 (crash) ends in state 7 (respawn)', crashCar.state === 7)

    const hazardCar = { state: 1, animTimer: 0, active: 1, speed: 999, heading: 40 }
    for (let i = 0; i < 200 && hazardCar.state !== 7; i++) runStates([hazardCar], {}, { round: ROUND })
    check('state 1 (hazard death, non-4/9 round) ends in state 7, speed pinned to 0', hazardCar.state === 7 && hazardCar.speed === 0)
  })
}

/**
 * `UNKNOWN_state1_oscillator_port` resolved (docs/engine.md §9w): state 1's real heading-realignment
 * (rounds 4/9 only, `880A-8928`) steps `heading` by +-4/tick toward whichever of {0, 0x80} is nearer
 * AROUND THE CIRCLE (wrapping through 0xff->0), not the prior code's linear no-basis "diff" stepping.
 *
 * Case 1 is the actual regression case: heading=200 is 56 units from 0 via wraparound (increasing:
 * 200->204->...->252->0, 14 ticks) but 200 units the long way (decreasing straight to 0, 50 ticks,
 * never wrapping) -- what the prior code's linear stepping would have done instead. 14 ticks and an
 * exact landing on 0 is something only the correct wraparound-aware bucket logic produces.
 */
function checkStateOneOscillator() {
  return import('../src/engine/states.js').then(({ runStates: runStatesOnly }) => {
    const runStates = (cars, rs, ctx) => { runStatesOnly(cars, rs, ctx); cars.forEach((c, i) => animTimerPass(c, i, ctx)) }
    const wrapCar = { state: 1, animTimer: 0, active: 1, heading: 200 }
    for (let i = 0; i < 14; i++) runStates([wrapCar], {}, { round: 4 })
    check('state 1 oscillator (round 4): heading=200 converges to 0 via the short wraparound path in exactly 14 ticks', wrapCar.heading === 0)

    // Case 2: a round-4 car approaching from the OTHER side (heading=100, in [0x40,0x80), steps up)
    // arrives at waypoint 0x80, not 0 -- table selection is by WHICH waypoint, not by round (the
    // prior code always used table A for round 4 regardless of which waypoint was ever reached).
    const otherWaypointCar = { state: 1, animTimer: 0, active: 1, heading: 100 }
    for (let i = 0; i < 7; i++) runStates([otherWaypointCar], {}, { round: 4 })
    check('state 1 oscillator (round 4): heading=100 converges to the OTHER waypoint, 0x80, in 7 ticks', otherWaypointCar.heading === 0x80)

    // driftSteps gate: already at a waypoint (heading=0), but driftSteps!=0 -- table advancement
    // (animStep/state) must stay frozen while animTimer keeps ticking underneath it (73E7's real
    // increment is unconditional, independent of this gate -- docs/engine.md §9w).
    const pausedCar = { state: 1, animTimer: 0, active: 1, heading: 0, animStep: 0, driftSteps: 5 }
    for (let i = 0; i < 30; i++) runStates([pausedCar], {}, { round: 4 })
    check('state 1: driftSteps!=0 freezes animStep/state advancement', pausedCar.state === 1 && pausedCar.animStep === 0)
    check('state 1: driftSteps!=0 does NOT freeze animTimer itself', pausedCar.animTimer === 30)
    pausedCar.driftSteps = 0
    for (let i = 0; i < 20 && pausedCar.state !== 7; i++) runStates([pausedCar], {}, { round: 4 })
    check('state 1: clearing driftSteps lets table advancement resume and reach state 7', pausedCar.state === 7)

    // Round-9 exclusion (73E7 `73EE-73F3`): the animTimer increment itself is skipped for every car
    // except cars[0] -- a non-car0 car that reaches the table-walk phase must get stuck there
    // forever (animTimer pinned, never crosses threshold[0]), reproducing the real game exactly.
    const carZero = { state: 1, animTimer: 0, active: 1, heading: 0 }
    const nonCarZero = { state: 1, animTimer: 0, active: 1, heading: 0 }
    // raceState persisted across the loop (not a fresh {} per call) -- runStates' own RUFFTRUX
    // (round 9) branch otherwise re-defaults raceState.ruffTruxTimer to 0 every single call and
    // immediately hijacks cars[0] into state 0x10, unrelated to what this test is checking.
    const raceState = { ruffTruxTimer: 1000 } // pre-seeded so the unrelated RUFFTRUX countdown (below) never hijacks cars[0] into state 0x10 mid-test
    let carZeroLeftState1 = false
    for (let i = 0; i < 100 && !carZeroLeftState1; i++) {
      runStates([carZero, nonCarZero], raceState, { round: 9 })
      if (carZero.state !== 1) carZeroLeftState1 = true
    }
    check('state 1 (round 9): the camera-target car (cars[0]) progresses normally out of state 1', carZeroLeftState1)
    check('state 1 (round 9): every other car gets no animTimer increment and stays stuck in state 1', nonCarZero.state === 1 && nonCarZero.animTimer === 0)

    // sfx gate (docs/sound.md id 7 `88f6` / id 17 `890f`): non-{2,4,9} classes fire id 7 at animStep
    // 8; classes {2,4,9} fire id 17 at animStep 4 -- both gated on drawnThisFrame. The flag is sticky
    // (its only writers are inside 7D73, docs/engine.md §9ao), and state 1's table frames do not call
    // 7D73, so the value the car brought from its last drawn state decides. (Until §9ao `runStates`
    // zeroed it before every dispatch, so this gate could never fire.)
    for (const [drawn, expect] of [[1, [7]], [0, []]]) {
      const calls = []
      const sound = { playSfx: (id) => calls.push(id) }
      const defaultClassCar = { state: 1, animTimer: 0, active: 1, heading: 40, drawnThisFrame: drawn }
      for (let i = 0; i < 200 && defaultClassCar.state !== 7; i++) runStates([defaultClassCar], {}, { round: 1, sound })
      check(`state 1 sfx: a car last drawn ${drawn ? 'on' : 'off'} screen ${drawn ? 'plays id 7 once' : 'stays silent'} (the sticky flag, §9ao)`, JSON.stringify(calls) === JSON.stringify(expect))
    }
  })
}

/**
 * UNKNOWN_respawn_sideways_offset resolved (docs/engine.md §9v): state 7's respawn applies a
 * 12-unit sideways offset at heading+-90 deg, +90 for the camera-target car (`cars[0]`), -90 for
 * every other car -- confirmed via `runStates`, not `stepRespawn` directly (it's not exported,
 * and the fix specifically depends on `runStates`'s own per-call `ctxWithCars` wiring, so testing
 * through the real entry point is what actually proves the wiring, not just the formula).
 * `ctx.world` deliberately omitted (undefined) -- `stepRespawn`'s own fallback path (`car.levByte`/
 * `car.mapAttr`) keeps this test independent of any real/synthetic map, isolating the offset
 * formula itself. `levByte=0x20` picks LEV_HEADING_TABLE[1]=128, a heading whose +-90 rotation
 * lands on a clean, non-zero-crossing pair of SINE8 values (chosen empirically, not a coincidence
 * of the default fixture -- LEV_HEADING_TABLE[0] degenerates to a zero offset for both cars, which
 * would pass even with the whole mechanism unwired).
 */
/**
 * `UNKNOWN_kidmodifier_use` resolved (docs/engine.md §9y): `InitRaceCarsFromTables`'s per-car
 * tuning handicap `CX` (`3FBE-4134`), applied to 7 `CarRecord` fields, now wired into `spawnCars`
 * (`race.js`'s `computeTuningOffset`). `CAR_TYPE_INFO[1]` (round 2, POWERBOATS) is
 * `[0x067e, 0xfcc1, 0x0020, 0x0030, 0x0014, 0x002f, 0x0028, 0x0007, 0x0006]` -- base
 * maxSpeedCur=1662, reverseLimit=-831 (0xfcc1 as signed 16-bit -- 0x10000-0xfcc1=0x33f=831), accel=32,
 * brakeDecel=48, coastDecel=20, slipThreshold=47, gripStep=40, and `DRONE_MAX_VEL_HANDICAP` is
 * `[560,640,512,215,486,278,321,167,324,...]` (hand-transcribed here, not re-read from the tables,
 * so this test can't be fooled by a coincidentally-matching implementation reading its own inputs
 * back). Every expected value below was independently hand-computed and, on a first pass, caught
 * FOUR of its own arithmetic mistakes against the actual output (a sign-extension slip on
 * `0xfcc1`, indexing `DRONE_MAX_VEL_HANDICAP[0]` instead of `[8]` for the `tournamentIndex=8` case,
 * and an addition error in the race-23 sum) -- corrected by hand-tracing each again, not by
 * adjusting the assertion to match whatever the code produced.
 */
function checkKidModifierTuning() {
  return import('../src/formats/globaldata.js').then(async ({ parseStrtPos }) => {
    const strt = parseStrtPos(await read('GAME1/STRT_POS.BIN'))

    // tournamentIndex=0 (default, no tournament context): the real bytes still apply the flat-ramp
    // CX (car1=0,car2=12,car3=6 pre-adjustment) plus round-2's own POWERBOATS class bonus (+7) and
    // the DRONE_MAX_VEL_HANDICAP[0]=560 subtraction -- car0 (human) stays exactly at the raw
    // CAR_TYPE_INFO base, no adjustment at all.
    const defaultCars = spawnCars(strt, 2, 1)
    check('kidmodifier: car0 (human) gets zero tuning adjustment', defaultCars[0].maxSpeedCur === 1662 && defaultCars[0].accel === 32 && defaultCars[0].reverseLimit === -781 && defaultCars[0].brakeDecel === 88 && defaultCars[0].slipThreshold === 67 && defaultCars[0].gripStep === 60)
    // car1: cx = 0(flat ramp) - 15 + 0(tournamentIndex) + 7(POWERBOATS) = -8
    check('kidmodifier: car1 (drone, flat-ramp cx=-8) maxSpeedCur = 1662+11*-8-560 = 1014', defaultCars[1].maxSpeedCur === 1014)
    check('kidmodifier: car1 accel = 32-8 = 24 (no two-car penalty, raceFormat=1)', defaultCars[1].accel === 24)
    // car2: cx = 12(flat ramp) - 15 + 0 + 7 = 4 -- the flat-ramp value that would be WRONG (-2) if
    // car2/car3 were swapped, as an earlier investigating pass's report had them
    check('kidmodifier: car2 (drone, flat-ramp cx=4, NOT the swapped cx=-2 a wrong ramp would give) maxSpeedCur = 1662+11*4-560 = 1146', defaultCars[2].maxSpeedCur === 1146)
    // car3: cx = 6(flat ramp) - 15 + 0 + 7 = -2
    check('kidmodifier: car3 (drone, flat-ramp cx=-2, NOT the swapped cx=4 a wrong ramp would give) maxSpeedCur = 1662+11*-2-560 = 1080', defaultCars[3].maxSpeedCur === 1080)

    // tournamentIndex=8: a real KidModifier(identity) lookup path, plus the tournamentIndex===8
    // bonus (+3), indexed into DRONE_MAX_VEL_HANDICAP[8]=324 (not [0]=560 -- the handicap table is
    // indexed by tournamentIndex, same as the +3 bonus). Character 5 for car1
    // (opponentCharacters[0]) -- identity table means cx starts at 5, not 0.
    const t8 = spawnCars(strt, 2, 1, { tournamentIndex: 8, opponentCharacters: [5, 0, 0] })
    // car1: cx = 5(identity) - 15 + 8 + 7(POWERBOATS) + 3(tournamentIndex===8) = 8
    check('kidmodifier: car1 at tournamentIndex=8, character=5: cx=8, maxSpeedCur = 1662+11*8-324 = 1426', t8[1].maxSpeedCur === 1426)
    check('kidmodifier: car0 still zero-adjusted at tournamentIndex=8 (character-independent)', t8[0].maxSpeedCur === 1662)

    // tournamentIndex=0x17(23), raceFormat=2 (two-car): the accel SHR-2 penalty for drones (not
    // SHR-4, since 23 skips the second shift, 40C2/40C7) AND the car0-only flat -225/-6 nerf
    // (4116-4131, fires 3x across the per-car loop -- folded into one flat application here).
    const t23 = spawnCars(strt, 2, 1, { tournamentIndex: 0x17, raceFormat: 2 })
    // car0: cx=0 always; maxSpeedCur = 1662 - 3*0x4b(225) = 1437; accel = 32 - 3*2(6) = 26 (no
    // DRONE_MAX_VEL_HANDICAP subtraction, no two-car accel penalty -- car0 is exempt from both)
    check('kidmodifier: car0 gets the race-23 flat nerf (maxSpeedCur -= 225, accel -= 6)', t23[0].maxSpeedCur === 1437 && t23[0].accel === 26)
    // car1 (drone): cx = 0(flat ramp, tournamentIndex>0 so real lookup applies -- character
    // defaults to 0) - 15 + 0x17(23) + 7(POWERBOATS) + 8(tournamentIndex>=0x13) + 0x14(tournamentIndex===0x17)
    // = -15+23+7+8+20 = 43. accel = 32+43 = 75, then SHR-2 penalty (only, not SHR-4): 75-(75>>2)=75-18=57
    check('kidmodifier: car1 (drone, two-car format, race 23) gets the SHR-2-only accel penalty: 75-(75>>2)=57', t23[1].accel === 57)

    // Same tournamentIndex but raceFormat=1 (one-car/four-car): the two-car-only accel penalty
    // must NOT apply, even though tournamentIndex still qualifies (>=0x12).
    const t23oneCar = spawnCars(strt, 2, 1, { tournamentIndex: 0x17, raceFormat: 1 })
    check('kidmodifier: the two-car accel penalty does NOT apply in raceFormat=1 (accel stays 75)', t23oneCar[1].accel === 75)
  })
}

/**
 * Round 9 (RUFFTRUX) deactivates cars 1-3 (`InitRaceCarsFromTables 1000:41bd-41d2`, NOT `3b50`'s
 * own earlier write, which the same load sequence's unconditional 4-car init clobbers a few
 * instructions later -- `mm-re-player-visible` 2026-09-23, docs/engine.md §9ak). `active` is a
 * comprehensive "out of the simulation" flag, not a draw-only one -- confirmed at every major
 * per-car physics/collision/draw entry point.
 */
function checkRound9Deactivation() {
  return import('../src/formats/globaldata.js').then(async ({ parseStrtPos }) => {
    const strt = parseStrtPos(await read('GAME1/STRT_POS.BIN'))
    const r9 = spawnCars(strt, 9, 1)
    check('round 9: car 0 stays active/present', r9[0].active === 1 && r9[0].present === 1)
    check('round 9: cars 1-3 are deactivated (both active and present)', r9.slice(1).every((c) => c.active === 0 && c.present === 0))
    const r1 = spawnCars(strt, 1, 1)
    check('round 1 (not 9): all four cars stay active -- the round-9 gate does not leak into other rounds', r1.every((c) => c.active === 1 && c.present === 1))
    const twoCar = spawnCars(strt, 2, 1, { raceFormat: 2 })
    check('two-car format, round 2 (not 9): cars 2-3 deactivated by the EXISTING raceFormat gate, unaffected by the new round-9 one', twoCar[0].active === 1 && twoCar[1].active === 1 && twoCar[2].active === 0 && twoCar[3].active === 0)
  })
}

/**
 * The three animated-tile mechanisms (docs/engine.md §9al): rounds 1/3/5's tile-0 parallax
 * (camera-derived, no counter), round 2's water-shimmer and round 8's hazard graphic (both
 * counter-driven word-map overwrites). Pinned against exact values, not just "changed" -- a
 * regression here would silently mis-animate `single.html`'s own default ROUND21 (round 2).
 */
async function checkTileAnimations() {
  const { applyTile0Parallax, applyRound2WaterAnim, applyRound8HazardAnim } = await import('../src/render/raceView.js')
  const { WORLD_TILES } = await import('../src/formats/race.js')

  // Tile-0 parallax: pure function of camera position, no persistent state.
  {
    const pristine = new Uint8Array(256)
    for (let i = 0; i < 256; i++) pristine[i] = (i % 250) + 1 // distinct nonzero values, none 0
    const identity = new Uint8Array(256)
    applyTile0Parallax(identity, pristine, 0, 0)
    check('tile-0 parallax: camX=camY=0 is an identity copy', identity.every((v, i) => v === pristine[i]))
    const wrapped = new Uint8Array(256)
    applyTile0Parallax(wrapped, pristine, 32, 0) // 32 & 0x1f = 0 -> same as camX=0
    check('tile-0 parallax: camX=32 wraps back to dx=0 (period 32px)', wrapped.every((v, i) => v === pristine[i]))
    const shifted = new Uint8Array(256)
    applyTile0Parallax(shifted, pristine, 2, 0) // dx = (2&0x1f)>>1 = 1
    check('tile-0 parallax: camX=2 shifts by 1 column (half camera speed)', shifted[0 * 16 + 1] === pristine[0 * 16 + 0])
  }

  // Round 2 water-shimmer: 4x4 patch at row181-184/col99-102, cycling 4 consecutive 16-tile
  // blocks (0-15, 16-31, 32-47, 48-63) every 4 ticks, raster order, no race gate.
  {
    const words = new Uint16Array(WORLD_TILES * WORLD_TILES)
    const patchAt = () => Array.from({ length: 16 }, (_, i) => words[(181 + Math.floor(i / 4)) * WORLD_TILES + (99 + (i % 4))])
    applyRound2WaterAnim(words, 0)
    check('round 2 water anim, tick 0: block 0 (tiles 0-15) in raster order', patchAt().every((v, i) => v === i))
    applyRound2WaterAnim(words, 4)
    check('round 2 water anim, tick 4: block 1 (tiles 16-31)', patchAt().every((v, i) => v === 16 + i))
    applyRound2WaterAnim(words, 12)
    check('round 2 water anim, tick 12: block 3 (tiles 48-63)', patchAt().every((v, i) => v === 48 + i))
    applyRound2WaterAnim(words, 16)
    check('round 2 water anim, tick 16: cycles back to block 0 (16-tick period)', patchAt().every((v, i) => v === i))
  }

  // Round 8 hazard graphic: race-gated (none in race 1), 3x3 patches cycling base 0/9/18.
  {
    const wordsR1 = new Uint16Array(WORLD_TILES * WORLD_TILES) // left all-zero
    applyRound8HazardAnim(wordsR1, 8, 1)
    check('round 8, race 1: no patches at all (the real function returns immediately)', wordsR1.every((v) => v === 0))

    const wordsR2 = new Uint16Array(WORLD_TILES * WORLD_TILES)
    const patchR2 = () => Array.from({ length: 9 }, (_, i) => wordsR2[(68 + Math.floor(i / 3)) * WORLD_TILES + (18 + (i % 3))])
    applyRound8HazardAnim(wordsR2, 0, 2)
    check('round 8, race 2, tick 0: one 3x3 patch, base 0', patchR2().every((v, i) => v === i))
    applyRound8HazardAnim(wordsR2, 4, 2)
    check('round 8, race 2, tick 4: base 9', patchR2().every((v, i) => v === 9 + i))
    applyRound8HazardAnim(wordsR2, 8, 2)
    check('round 8, race 2, tick 8: base 18', patchR2().every((v, i) => v === 18 + i))

    const wordsR3 = new Uint16Array(WORLD_TILES * WORLD_TILES)
    applyRound8HazardAnim(wordsR3, 0, 3)
    const spots = [[62, 90], [68, 90], [80, 90], [86, 90], [104, 90], [110, 90]]
    check('round 8, race 3: all six patches written (not just the first)', spots.every(([row, col]) => wordsR3[row * WORLD_TILES + col] === 0 && wordsR3[(row + 2) * WORLD_TILES + (col + 2)] === 8))
  }

  // round !== {1,3,5}/{2}/{8} gating lives in composeRaceView itself (round === X checks), not in
  // these functions -- covered by the ROUND21 (round 2) npm run live check staying at 0 differing
  // pixels outside the car box after this system was wired in (no separate unit needed here).
}

/**
 * `UNKNOWN_state4_5_driftsteps_gate` resolved (docs/engine.md §9z): states 4/5's real handlers
 * (`7F62`/`7EFA`) pause table advancement while `driftSteps!=0` (draw-only, matching state 1's own
 * gate), and their sfx-8 condition tests the POST-increment `animStep`, not `animTimer` -- the
 * prior code's `animTimer+1===4` fired around tick 3-4 regardless of which table was in play; the
 * real gate fires when `animStep` reaches 4, which for `FALL_ANIM`'s thresholds (`[2,4,6,8,...]`)
 * is `animTimer===8`, and for `CRASH_ANIM`'s (`[4,8,12,16,...]`) is `animTimer===16`. Neither old
 * nor new condition was provable by a fired sound through `runStates` when it zeroed `drawnThisFrame`
 * before dispatch (it no longer does, docs/engine.md §9ao), so these assertions key on `animStep`
 * reaching 4 at the correct tick instead -- the actual observable the real sfx gate depends on.
 */
function checkStateFourFiveDriftGate() {
  return import('../src/engine/states.js').then(({ runStates: runStatesOnly }) => {
    const runStates = (cars, rs, ctx) => { runStatesOnly(cars, rs, ctx); cars.forEach((c, i) => animTimerPass(c, i, ctx)) }
    // driftSteps gate: table advancement frozen while driftSteps!=0, animTimer keeps ticking
    // underneath it (same shape as state 1's own gate, checkStateOneOscillator above). Held for
    // LONGER than the table's own last real threshold (FALL_ANIM=40, CRASH_ANIM=160) so this is
    // genuinely discriminating against the prior `animTableDone`-based code, which ignored
    // driftSteps entirely and would already have reached the terminal state well before this many
    // ticks -- a shorter hold (first draft: 30 ticks) passed against BOTH old and new code, since
    // 30 ticks wasn't enough for the OLD code to finish either, proving nothing about the gate.
    const pausedFall = { state: 4, animTimer: 0, active: 1, animStep: 0, driftSteps: 5, height: 0, zVel: 0 }
    for (let i = 0; i < 60; i++) runStates([pausedFall], {}, { round: 2 })
    check('state 4: driftSteps!=0 freezes animStep/state advancement (held past FALL_ANIM\'s own last threshold, 40)', pausedFall.state === 4 && pausedFall.animStep === 0)
    check('state 4: driftSteps!=0 does NOT freeze animTimer itself', pausedFall.animTimer === 60)
    pausedFall.driftSteps = 0
    for (let i = 0; i < 45 && pausedFall.state === 4; i++) runStates([pausedFall], {}, { round: 2 })
    check('state 4: clearing driftSteps lets table advancement resume and reach state 0xE', pausedFall.state === 0xe)

    const pausedCrash = { state: 5, animTimer: 0, active: 1, animStep: 0, driftSteps: 5, height: 0, zVel: 0 }
    for (let i = 0; i < 200; i++) runStates([pausedCrash], {}, { round: 2 })
    check('state 5: driftSteps!=0 freezes animStep/state advancement (held past CRASH_ANIM\'s own last threshold, 160)', pausedCrash.state === 5 && pausedCrash.animStep === 0)
    pausedCrash.driftSteps = 0
    for (let i = 0; i < 200 && pausedCrash.state === 5; i++) runStates([pausedCrash], {}, { round: 2 })
    check('state 5: clearing driftSteps lets table advancement resume and reach state 7', pausedCrash.state === 7)

    // sfx-timing tick correctness: animStep must reach 4 exactly when animTimer crosses
    // threshold[3] -- 8 for FALL_ANIM, 16 for CRASH_ANIM -- not at the old code's ~tick-3 firing.
    const fallCar = { state: 4, animTimer: 0, active: 1, height: 0, zVel: 0 }
    let fallStep4Tick = -1
    for (let i = 0; i < 20 && fallStep4Tick === -1; i++) {
      runStates([fallCar], {}, { round: 2 })
      if (fallCar.animStep === 4) fallStep4Tick = fallCar.animTimer
    }
    // The handler compares the timer the previous pass left (8) and the pass then bumps it (9): 7F62 runs from render, before 73E7.
    check('state 4: animStep reaches 4 exactly when the handler sees animTimer=8 (not the old ~tick-3/4 firing)', fallStep4Tick === 9)

    const crashCar = { state: 5, animTimer: 0, active: 1, height: 0, zVel: 0 }
    let crashStep4Tick = -1
    for (let i = 0; i < 30 && crashStep4Tick === -1; i++) {
      runStates([crashCar], {}, { round: 2 })
      if (crashCar.animStep === 4) crashStep4Tick = crashCar.animTimer
    }
    check('state 5: animStep reaches 4 exactly when the handler sees animTimer=16 (not the old ~tick-3/4 firing)', crashStep4Tick === 17)

    // Terminal transition completeness: state 4 -> 0xE sets 3 fields the prior code omitted
    // (animStep=0, controlsLocked=1, cameraFarFlag=0), alongside the 4 it already had.
    const fallDone = { state: 4, animTimer: 0, active: 1, height: 0, zVel: 0, controlsLocked: 0, cameraFarFlag: 1 }
    for (let i = 0; i < 45 && fallDone.state === 4; i++) runStates([fallDone], {}, { round: 2 })
    // animTimer: zeroed at 7FBD, then the same tick's 73E7 bumps it (state 0xE is not 0).
    check('state 4 terminal: active=0, subState=1, state=0xE, animTimer=0 (+1 from the pass), animStep=0, controlsLocked=1, cameraFarFlag=0', fallDone.active === 0 && fallDone.subState === 1 && fallDone.state === 0xe && fallDone.animTimer === 1 && fallDone.animStep === 0 && fallDone.controlsLocked === 1 && fallDone.cameraFarFlag === 0)

    // State 5's terminal sets subState=0 (not 1 -- a real, confirmed difference from state 4, not
    // an inconsistency: state 5 hands off to state 7, which doesn't consume subState the same way
    // state E's own sequencer does).
    const crashDone = { state: 5, animTimer: 0, active: 1, height: 0, zVel: 0, subState: 3 }
    for (let i = 0; i < 200 && crashDone.state === 5; i++) runStates([crashDone], {}, { round: 2 })
    check('state 5 terminal: state=7, animTimer=0 (+1 from the pass), animStep=0, subState=0', crashDone.state === 7 && crashDone.animTimer === 1 && crashDone.animStep === 0 && crashDone.subState === 0)

    // Round-9/non-car0 animTimer exclusion (the same real 73E7 gate state 1 already has,
    // docs/engine.md §9w): a round-9 non-car0 car in state 4 gets no animTimer increment at all
    // and stays stuck; the camera-target car progresses normally. The gate lives in step.js's
    // `animTimerPass` (73E7-73F3) for every state, so state 5 is not re-tested separately here.
    const fallCarZero = { state: 4, animTimer: 0, active: 1, height: 0, zVel: 0 }
    const fallNonCarZero = { state: 4, animTimer: 0, active: 1, height: 0, zVel: 0 }
    // raceState persisted across the loop, ruffTruxTimer pre-seeded -- runStates' own RUFFTRUX
    // branch otherwise re-defaults it to 0 every call and hijacks cars[0] into state 0x10 (the same
    // test-authoring pitfall checkStateOneOscillator's own round-9 test already caught).
    const raceState = { ruffTruxTimer: 1000 }
    let carZeroLeftState4 = false
    for (let i = 0; i < 45 && !carZeroLeftState4; i++) {
      runStates([fallCarZero, fallNonCarZero], raceState, { round: 9 })
      if (fallCarZero.state !== 4) carZeroLeftState4 = true
    }
    check('state 4 (round 9): the camera-target car (cars[0]) progresses normally out of state 4', carZeroLeftState4)
    check('state 4 (round 9): every other car gets no animTimer increment and stays stuck in state 4', fallNonCarZero.state === 4 && fallNonCarZero.animTimer === 0)
  })
}

function checkRespawnSidewaysOffset() {
  return import('../src/engine/states.js').then(({ runStates: runStatesOnly }) => {
    const runStates = (cars, rs, ctx) => { runStatesOnly(cars, rs, ctx); cars.forEach((c, i) => animTimerPass(c, i, ctx)) }
    const mk = () => ({ state: 7, subState: 0, active: 1, safeX: 48, safeY: 48, levByte: 0x20, mapAttr: 0 })
    const target = mk() // cars[0] -- the camera-target car, +90 deg rotation
    const other = mk() // not cars[0] -- -90 deg rotation
    runStates([target, other], {}, { round: 1 })
    check('respawn heading matches LEV_HEADING_TABLE[1] for both cars', target.heading === 128 && other.heading === 128)
    check('the camera-target car (cars[0]) gets the +90-degree sideways offset (posX 48-12=36)', target.posX === 36)
    check('every other car gets the -90-degree sideways offset instead (posX 48+10=58)', other.posX === 58)
    check('the two cars end up at DIFFERENT X positions despite identical safe points/headings', target.posX !== other.posX)

    // 7120-7160 (docs/engine.md §9ah): the respawn writes BOTH progress and progressPrev from the
    // respawn cell's plane-2 byte (even a 0) and re-derives the checkpoint cursor (bytes) from it.
    return loadWorld(read, 1, 1).then((world) => {
      const list = checkpointList(1, 1)
      const cellP = (x, y) => world.map.plane2[Math.floor(y / 96) * 32 + Math.floor(x / 96)]
      let found = null
      for (let r = 0; r < 32 && !found; r++) for (let c = 0; c < 32 && !found; c++) {
        const v = world.map.plane2[r * 32 + c]
        if (v > list[1].lo && v < list[2].lo) found = { x: c * 96 + 48, y: r * 96 + 48 }
      }
      const car = { state: 7, subState: 0, active: 1, safeX: found.x, safeY: found.y, levByte: 0, mapAttr: 0, progress: 200, progressPrev: 199, checkpointOff: 0, checkpointOffSaved: 6, progressChanged: 1 }
      runStates([car], {}, { round: 1, race: 1, world })
      const p = cellP(car.posX, car.posY)
      check(`respawn: progress AND progressPrev both take the respawn cell's plane-2 byte (${p})`, car.progress === p && car.progressPrev === p)
      const expectCursor = 2 * list.findIndex((e) => (p & 0xff) < e.lo)
      check(`respawn: checkpoint cursor re-derived from it, in bytes (${expectCursor}); checkpointOffSaved/progressChanged untouched`, car.checkpointOff === expectCursor && car.checkpointOffSaved === 6 && car.progressChanged === 1)
    })
  })
}

/** The controls lock (docs/engine.md §9an): released in the control loop (4D0E-4D1F) -- only for a
 * state-0 car, only while its cameraFarFlag (left by the previous step's camera) is 1 -- and that
 * car steers in the same step. The camera itself no longer clears it. */
async function checkControlLock() {
  const setup = await setupRace()
  const { cars, world, ctx, raceState } = setup
  ctx.camera = setup.camera
  for (let i = 0; i < 120; i++) runStep(world, cars, cars.map((c) => droneControlByte(c, ctx)), raceState, ctx)
  const c0 = cars[0], c1 = cars[1]
  Object.assign(c0, { state: 0, controlsLocked: 1, cameraFarFlag: 1, heading: 0x40 })
  Object.assign(c1, { state: 2, controlsLocked: 1, cameraFarFlag: 1, animTimer: 0, animStep2: 0 })
  Object.assign(setup.camera, { x: setup.camera.targetX, y: setup.camera.targetY, stepX: 50, stepY: 50 })
  runStep(world, cars, [0x80, 0, 0, 0], raceState, ctx)
  check('controls lock: a state-0 car with cameraFarFlag 1 is released in the control loop and steers that same step (4D1F)', c0.controlsLocked === 0 && c0.heading !== 0x40)
  check('controls lock: a car still in state 2 stays locked even with the camera settled (4D04 before 4D0E)', c1.controlsLocked === 1)
}

/**
 * The rest of RespawnCarAtSafePoint 6FEB-73E6 (docs/engine.md §9an): the decrement-first round-2/8
 * hold, the 7008 safe-point quirk, the 703E-708E/7258-72EC resets, next := pos, the 585B DIR byte
 * and rounds 4/5's terrainLevel (737B-73B0).
 */
/**
 * `[BX+1250]`, the drawn flag (docs/engine.md §9ao): 7D73's clip test (`7D83-7E28` + `8BAB`) and its
 * stickiness (only 7D73 writes it; each state handler calls it under its own conditions).
 */
async function checkDrawnFlag() {
  const { markDrawn, inClipWindow } = await import('../src/engine/drawn.js')
  const { runStates: runStatesOnly } = await import('../src/engine/states.js')
  const runStates = (cars, rs, ctx) => { runStatesOnly(cars, rs, ctx); cars.forEach((c, i) => animTimerPass(c, i, ctx)) }
  const { fireProjectile } = await import('../src/engine/projectile.js')
  const clip = (dx, dy) => inClipWindow(dx, dy, -12, 12, 24)
  // View x = dx - 12 is in while -24 < x < 0x100; view y likewise below 0xE0 (the 224-row clip
  // window, of which only 200 rows reach the screen).
  check('drawn clip: x 255 in, x 256 out (8BC4 CMP DI,0x100)', clip(12 + 255, 100) && !clip(12 + 256, 100))
  check('drawn clip: x -23 in (the box still overlaps column 0)', clip(12 - 23, 100))
  check('drawn clip: dx -12 wraps by +0xC00 first (7E0A), so x -24 is out', !clip(-12, 100))
  check('drawn clip: y 223 in, y 224 out (8C02 CMP CX,0xE0)', clip(100, 12 + 223) && !clip(100, 12 + 224))
  check('drawn clip: rows 200-223 count as drawn although 92BC never copies them to the screen', clip(100, 12 + 210))
  check('drawn clip: a car just across the 0xC00 seam from the camera is in (one +0xC00 fold)', clip(100 - 0xc00, 100))
  check('drawn clip: a car half a world away is out', !clip(0x600, 0x600))
  // markDrawn: pos - height - camera; round 8 does not subtract the height (7D85).
  const cam = { x: 0, y: 0 }
  const car = (o) => ({ posX: 100, posY: 12 + 224, height: 20, drawnThisFrame: 9, ...o })
  const a = car({}); markDrawn(a, { round: 1, camera: cam })
  const b = car({}); markDrawn(b, { round: 8, camera: cam })
  check('markDrawn: the height lifts the box (in at y 204), except in round 8 (out at y 224)', a.drawnThisFrame === 1 && b.drawnThisFrame === 0)
  const r9 = [car({ posX: 5000 }), car({ posX: 5000 })]
  r9.forEach((c) => markDrawn(c, { round: 9, camera: cam, cars: r9 }))
  check('markDrawn round 9: car 0 is clip-tested, cars 1-3 are set with no test (7DAD-7DB2)', r9[0].drawnThisFrame === 0 && r9[1].drawnThisFrame === 1)
  const r9edge = [car({ posX: 20 - 3, posY: 100 }), car({ posX: 20 - 4, posY: 100 })] // dx = pos - height = -3 / -4
  r9edge.forEach((c) => markDrawn(c, { round: 9, camera: cam, cars: [c] }))
  check('markDrawn round 9 car 0: the 40x40 box and its -4 wrap threshold (7DC8/7DD5)', r9edge[0].drawnThisFrame === 1 && r9edge[1].drawnThisFrame === 0)
  const noCam = car({ posX: 5000 }); markDrawn(noCam, { round: 1 })
  check('markDrawn with no camera: set (the pure-physics harnesses keep the old meaning)', noCam.drawnThisFrame === 1)
  // Stickiness through runStates: far camera, so every WRITE is a 0.
  const far = { x: 0x600, y: 0x600 }
  const run = (c) => { runStates([c], {}, { round: 1, camera: far }); return c.drawnThisFrame }
  check('sticky: state 0 writes (off screen -> 0)', run({ state: 0, active: 1, posX: 100, posY: 100, height: 0, drawnThisFrame: 1 }) === 0)
  check('sticky: state 7 never calls 7D73 -- the flag keeps its value', run({ state: 7, active: 1, subState: 0x46, posX: 100, posY: 100, safeX: 100, safeY: 100, drawnThisFrame: 1 }) === 1)
  check('sticky: state 2 below index 3 draws only the overlay (82E2), no write', run({ state: 2, active: 1, animTimer: 0, posX: 100, posY: 100, height: 0, drawnThisFrame: 1 }) === 1)
  check('sticky: state 2 from index 3 draws the body (82E9), writes', run({ state: 2, active: 1, animStep2: 3, animTimer: 12, posX: 100, posY: 100, height: 0, drawnThisFrame: 1 }) === 0)
  check('sticky: state 0xD up to index 3 draws the body (82F5), writes', run({ state: 0xd, active: 1, animTimer: 0, posX: 100, posY: 100, height: 0, drawnThisFrame: 1 }) === 0)
  check('sticky: state 0xD past index 3 does not', run({ state: 0xd, active: 1, animStep2: 4, animTimer: 16, posX: 100, posY: 100, height: 0, drawnThisFrame: 1 }) === 1)
  check('sticky: state 5 writes only while drifting (7EFA-7F01)', run({ state: 5, active: 1, driftSteps: 3, animTimer: 0, posX: 100, posY: 100, height: 0, drawnThisFrame: 1 }) === 0 &&
    run({ state: 5, active: 1, driftSteps: 0, animTimer: 0, posX: 100, posY: 100, height: 0, drawnThisFrame: 1 }) === 1)
  // `ctx.drawnTick` (docs/engine.md §9ao 8): smoothness 2-4's draw-gate, threaded into markDrawn
  // itself so it applies no matter which handler called it.
  const stale = car({ posX: 5000, drawnThisFrame: 1 }); markDrawn(stale, { round: 1, camera: cam, drawnTick: false })
  check('markDrawn: ctx.drawnTick===false skips the write entirely (stays sticky)', stale.drawnThisFrame === 1)
  const fresh = car({ posX: 5000, drawnThisFrame: 1 }); markDrawn(fresh, { round: 1, camera: cam, drawnTick: true })
  check('markDrawn: ctx.drawnTick===true writes normally', fresh.drawnThisFrame === 0)
  const implicit = car({ posX: 5000, drawnThisFrame: 1 }); markDrawn(implicit, { round: 1, camera: cam })
  check('markDrawn: ctx.drawnTick unset defaults to drawn (every headless caller, and smoothness 1)', implicit.drawnThisFrame === 0)
  // State A's own `[26CF]` blink gate (docs/engine.md §9ao 8, `849B`/`84CA`): car 0 and two-car
  // cars draw only on the blink's on-phase; a drone draws every tick regardless.
  const stateACar = (o) => ({ state: 0xa, active: 1, posX: 100, posY: 100, height: 0, drawnThisFrame: 1, ...o })
  const offA = stateACar(); runStates([offA], { blinkOn: false, blinkTick: 0 }, { round: 1, camera: far })
  check('state A: car 0 skips the draw on the blink off-phase', offA.drawnThisFrame === 1)
  const onA = stateACar(); runStates([onA], { blinkOn: true, blinkTick: 0 }, { round: 1, camera: far })
  check('state A: car 0 draws on the blink on-phase', onA.drawnThisFrame === 0)
  const droneA = [{ state: 0, active: 1, posX: 100, posY: 100, height: 0 }, stateACar()]
  runStates(droneA, { blinkOn: false, blinkTick: 0 }, { round: 1, camera: far })
  check('state A: a drone (not car 0) draws every tick regardless of the blink phase', droneA[1].drawnThisFrame === 0)
  const twoCarA = [stateACar(), stateACar()]
  runStates(twoCarA, { blinkOn: false, blinkTick: 0 }, { round: 1, camera: far, raceFormat: 2 })
  check('state A: two-car format gates BOTH cars on the blink, not just car 0', twoCarA[0].drawnThisFrame === 1 && twoCarA[1].drawnThisFrame === 1)
  const blinkState = {}
  const blinkFiller = { state: 0, active: 1, posX: 0, posY: 0, height: 0 }
  for (let i = 0; i < 16; i++) runStates([blinkFiller], blinkState, { round: 1, camera: far })
  check('state A blink: a free-running ~50% duty cycle, 16 physics ticks per half-period', blinkState.blinkOn === false)
  // 4F3C: an off-screen tank does not fire.
  const tank = (drawn) => ({ heading: 0, posX: 1000, posY: 1000, velX: 0, velY: 0, posXfrac: 0, posYfrac: 0, reloadCooldown: 0, projActive: 0, drawnThisFrame: drawn })
  const on = tank(1); fireProjectile(on, { round: 7 })
  const off = tank(0); fireProjectile(off, { round: 7 })
  check('fire gate 4F3C: an on-screen tank fires, an off-screen one does not', on.projActive === 1 && off.projActive === 0 && off.reloadCooldown === 0)
}

async function checkRespawnFields() {
  const { runStates: runStatesOnly } = await import('../src/engine/states.js')
  const runStates = (cars, rs, ctx) => { runStatesOnly(cars, rs, ctx); cars.forEach((c, i) => animTimerPass(c, i, ctx)) }
  // Rounds 2/8: DEC then test (6FFA-7005) -- subState 0x46 gives 0x45 held calls, then it proceeds.
  {
    const car = { state: 7, subState: 0x46, active: 1, safeX: 480, safeY: 480, levByte: 0, mapAttr: 0 }
    let calls = 0
    while (car.state === 7 && calls < 200) { runStates([car], {}, { round: 2 }); calls++ }
    check(`respawn (round 2): subState 0x46 holds 0x45 calls, the 0x46th proceeds (${calls})`, calls === 0x46)
  }
  // 7008-7016: tournament race 0x16 on meta-tile 4 moves the safe point up 0x60, persistently.
  {
    const car = { state: 7, subState: 0, active: 1, safeX: 480, safeY: 500, levByte: 0, mapAttr: 0, metaTile: 4 }
    runStates([car], {}, { round: 1, tournamentIndex: 0x16 })
    check('respawn: [28C1]==0x16 on meta-tile 4 -> safeY -= 0x60 (7016)', car.safeY === 500 - 0x60)
  }
  // The resets and next := pos, the DIR byte, on a real world.
  {
    const world = await loadWorld(read, 1, 1)
    const car = { state: 7, subState: 0, active: 1, safeX: 1000, safeY: 1000, levByte: 0, mapAttr: 0, maxSpeedBase: 0x500, maxSpeedCur: 7, height: 9, zVel: 3, targetVelX: 11, nextX: 1, nextY: 1, dirByte: 0x77, animStep: 5, animStep2: 5, halveOnBounce: 0, rampJumpActive: 1, puffOffA: 0 }
    runStates([car], {}, { round: 1, race: 1, world })
    check('respawn: maxSpeedCur := maxSpeedBase (703E), targetVel 0', car.maxSpeedCur === 0x500 && car.targetVelX === 0)
    check('respawn: next := pos (70C4/71B8)', car.nextX === car.posX && car.nextY === car.posY)
    check('respawn: height/zVel 0, bounceOnLand/halveOnBounce 1, anim cursors 0, ramp flag 0, puff offsets (7258-72EC)', car.height === 0 && car.zVel === 0 && car.bounceOnLand === 1 && car.halveOnBounce === 1 && car.animStep === 0 && car.animStep2 === 0 && car.rampJumpActive === 0 && car.puffOffA === -30)
    const subx = car.subCell >> 8, suby = car.subCell & 0xff
    const expect = world.dirOf(car.metaTile)[(subx >> 1) + 3 * (suby & ~1)]
    check(`respawn: dirByte AND dirBytePrev take the respawn cell's DIR byte (585B twice) (${expect})`, car.dirByte === expect && car.dirBytePrev === expect)
  }
  // Rounds 4/5: terrainLevel from the DIR grade (737B-73B0): 5..12 -> g-4, 13 -> -1, 14 -> 4.
  for (const [dir, want] of [[0x63, 2], [0xd3, 0xffff], [0xe3, 4]]) {
    const fake = { map: { tiles: new Uint8Array(1024), attrs: new Uint8Array(1024), plane2: new Uint8Array(1024), maxPlane2: 1 }, colOf: () => new Uint8Array(144), dirOf: () => new Uint8Array(36).fill(dir), levOf: () => ({ raw: 0 }) }
    const car = { state: 7, subState: 0, active: 1, safeX: 480, safeY: 480, levByte: 0, mapAttr: 0, terrainLevel: 0 }
    runStates([car], {}, { round: 4, race: 1, world: fake })
    check(`respawn (round 4): DIR grade ${dir >> 4} -> terrainLevel ${want} (737B-73B0)`, car.terrainLevel === want)
  }
}

/**
 * Round 3's real drop-in/shortcut sequencer (docs/engine.md §9r, M3.13) -- resolves
 * UNKNOWN_6ae5_round3_sequencer/UNKNOWN_22E1_scope/UNKNOWN_stateE_reach. `dropin.js`'s
 * `triggerDropIn` (the terrain-triggered subState-0 entry) and `stepDropIn` (state 0xE's own
 * per-tick continuation, dispatched from `states.js`) are exercised directly against the real
 * `ROUND3_DROPIN_TABLE`, not synthetic data -- a wrong table offset would show up as these tests
 * failing to match any real cell.
 */
async function checkDropIn() {
  const { ROUND3_DROPIN_TABLE } = await import('../src/data/engine-tables.js')
  const { triggerDropIn, stepDropIn, applyScriptedDrift } = await import('../src/engine/dropin.js')
  const { runStates: runStatesOnly } = await import('../src/engine/states.js')
  const runStates = (cars, rs, ctx) => { runStatesOnly(cars, rs, ctx); cars.forEach((c, i) => animTimerPass(c, i, ctx)) }

  check('ROUND3_DROPIN_TABLE has exactly 5 real entries', ROUND3_DROPIN_TABLE.length === 5)

  const cellCenter = (cell) => cell * 96 + 48
  const mkCar = (entry, over) => ({
    state: 0, active: 1, height: 0, zVel: 0, nextX: cellCenter(entry.cellX), nextY: cellCenter(entry.cellY),
    posX: cellCenter(entry.cellX), posY: cellCenter(entry.cellY), checkpointOff: entry.minCursor,
    maxSpeedCur: 500, heading: 0, speed: 0, velX: 0, velY: 0, hazardVulnerable: 1, animTimer: 0,
    puffSlots: Array.from({ length: 8 }, () => ({ frame: -1 })), splashSlots: Array.from({ length: 5 }, () => ({ frame: -1 })),
    ...over,
  })
  const ctx4 = { round: 3, race: 2, raceFormat: 1, stepIncrement: 1 }

  // (a) a full success run: terrain-triggered entry -> state 4 (fall) -> state 0xE's own subStates
  // 1-4 -> back to state 0, landing on (or very near) the table's own spawn target.
  {
    const entry = ROUND3_DROPIN_TABLE[1] // minCursor=4, a real cell away from the world seam
    const car = mkCar(entry, {})
    const raceState = {}
    triggerDropIn(car, ctx4, raceState)
    check('triggerDropIn: a qualifying match enters state 4 (fall), subState 1', car.state === 4 && car.subState === 1)
    check('triggerDropIn: records the table entry\'s own dropInSlot', car.dropInSlot === entry.dropInSlot)
    check('triggerDropIn: reserves a queue slot for this car', !!raceState.dropInSlots?.[entry.dropInSlot]?.queue.includes(car))

    // Drive state 4's fall animation to its documented end (states.js's own FALL_ANIM table).
    // `triggerDropIn` sets a real `driftSteps=4` scripted drift on entry (`UNKNOWN_
    // state4_5_driftsteps_gate` resolved, docs/engine.md §9z): state 4's table-walk is genuinely
    // paused until that drift is decremented, so `applyScriptedDrift` must run alongside
    // `runStates` here, matching `step.js`'s own real per-tick order -- calling `runStates` alone
    // (as this loop did before that fix) would now spin forever, since nothing else decrements it.
    for (let i = 0; i < 60 && car.state === 4; i++) { runStates([car], raceState, ctx4); applyScriptedDrift(car, ctx4, true) }
    check('drop-in: state 4 hands off to state 0xE, still subState 1, active=0', car.state === 0xe && car.subState === 1 && car.active === 0)

    // Continue through subStates 1 (re-match+setup) -> 2 (skipped, 4-car format) -> 3 (slide) -> 4
    // (settle) -> back to state 0.
    let sawSubState3 = false
    for (let i = 0; i < 200 && car.state === 0xe; i++) {
      if (car.subState === 3) sawSubState3 = true
      runStates([car], raceState, ctx4)
    }
    check('drop-in: reaches subState 3 (the slide) along the way', sawSubState3)
    check('drop-in: resolves back to state 0', car.state === 0)
    check(`drop-in: lands on the table's own spawn target (${car.posX},${car.posY} vs ${entry.spawnTargetX},${entry.spawnTargetY})`, car.posX === entry.spawnTargetX && car.posY === entry.spawnTargetY)
    check('drop-in: heading set from the table', car.heading === entry.heading)
    check('drop-in: releases its queue reservation on completion', !raceState.dropInSlots?.[entry.dropInSlot]?.queue.includes(car))
  }

  // (b) race==1's own early-bail scan quirk (1000:6b52/6c4c, confirmed by direct disassembly): only
  // entry 0 is ever checked in race 1 -- a car sitting on entry 1's own cell does NOT match, and
  // (being hazardVulnerable by default, matching the static init image) crashes instead.
  {
    const entry1 = ROUND3_DROPIN_TABLE[1]
    const car = mkCar(entry1, {})
    triggerDropIn(car, { ...ctx4, race: 1 }, {})
    check('triggerDropIn: race 1 does not match entry 1\'s own cell (early-bail quirk)', car.state === 5)
  }
  {
    const entry0 = ROUND3_DROPIN_TABLE[0]
    const car = mkCar(entry0, {})
    triggerDropIn(car, { ...ctx4, race: 1 }, {})
    check('triggerDropIn: race 1 DOES match entry 0\'s own cell', car.state === 4)
  }

  // (c) checkpointOff below the table entry's minCursor -- and hazardVulnerable's real default
  // (confirmed live: the static init image holds 1 for every car) means this is a genuine crash,
  // not a rare cheat-dependent edge case.
  {
    const entry = ROUND3_DROPIN_TABLE[3] // minCursor=14
    const car = mkCar(entry, { checkpointOff: entry.minCursor - 1 })
    triggerDropIn(car, ctx4, {})
    check('triggerDropIn: checkpointOff short of minCursor crashes a hazard-vulnerable car', car.state === 5)
    check('triggerDropIn: the crash sets up a real drift, not a teleport', car.driftSteps === 4 && (car.driftDX !== 0 || car.driftDY !== 0 || car.posX !== car.nextX))
  }
  {
    const entry = ROUND3_DROPIN_TABLE[3]
    const car = mkCar(entry, { checkpointOff: entry.minCursor - 1, hazardVulnerable: 0 })
    triggerDropIn(car, ctx4, {})
    check('triggerDropIn: the same short-of-threshold case is a no-op when hazard-immune (cheat type 7)', car.state === 0)
  }

  // (d) two-car partner timeout (1000:6daa, ~40 ticks): a lone car in raceFormat 2 with no partner
  // ever arriving gives up gracefully -- back to state 0, active=1 -- rather than crashing, and
  // raises the two-car knockout request [2911]=1 (6DB4, docs/engine.md §9am), with [2682] still
  // latched to the car that fell (7F69), so the knockout reset's fall branch will credit it.
  {
    const entry = ROUND3_DROPIN_TABLE[1]
    const car = mkCar(entry, {})
    const raceState = {}
    const ctx2 = { round: 3, race: 2, raceFormat: 2, stepIncrement: 1, cars: [car] }
    triggerDropIn(car, ctx2, raceState)
    for (let i = 0; i < 60 && car.state === 4; i++) { runStates([car], raceState, ctx2); applyScriptedDrift(car, ctx2, true) }
    runStates([car], raceState, ctx2) // one more tick: subState 1's re-match+setup -> subState 2 (raceFormat 2 doesn't skip it)
    check('drop-in (two-car): reaches subState 2 (the partner wait)', car.state === 0xe && car.subState === 2)
    let timedOut = false
    for (let i = 0; i < 45 && !timedOut; i++) {
      runStates([car], raceState, ctx2)
      if (car.state === 0) timedOut = true
    }
    check('drop-in (two-car): a partner that never arrives times out to state 0, active=1 (not a crash)', car.state === 0 && car.active === 1)
    check('drop-in (two-car): the timeout raises the knockout request [2911]=1 (6DB4)', raceState.knockoutRequest === 1)
    check('drop-in (two-car): [2682] is still latched to the car that fell (7F69)', raceState.fallLatch === 0)
  }

  // (e) the per-slot FIFO queue-order gate (1000:6e88-6e98), exercised directly at subState 3 --
  // entries 0 and 1 both share dropInSlot=0 (the real table's own grouping), so two cars converging
  // on the same physical drop point must finish appearing one at a time, in arrival order, even
  // once both have individually reached their own spawn target.
  {
    const e0 = ROUND3_DROPIN_TABLE[0], e1 = ROUND3_DROPIN_TABLE[1]
    check('fixture: entries 0 and 1 really do share one dropInSlot', e0.dropInSlot === e1.dropInSlot)
    const mk = (entry) => ({
      state: 0xe, subState: 3, active: 0, dropInSlot: entry.dropInSlot,
      posX: entry.spawnTargetX, posY: entry.spawnTargetY, spawnTargetX: entry.spawnTargetX, spawnTargetY: entry.spawnTargetY,
      height: 0, zVel: 0,
    })
    const carA = mk(e0), carB = mk(e1)
    const raceState = { dropInSlots: { [e0.dropInSlot]: { queue: [carA, carB], waitTicks: 0 } } }
    const ctx = { round: 3, race: 2, raceFormat: 1, stepIncrement: 1 }

    stepDropIn(carB, ctx, raceState) // B arrived second -- must wait even though it's already at its own target
    check('drop-in queue: the later arrival does not finish out of turn', carB.subState === 3 && carB.active === 0)

    stepDropIn(carA, ctx, raceState) // A is at the front -- proceeds and finishes immediately (already at target)
    check('drop-in queue: the front-of-queue car finishes', carA.state === 0)

    stepDropIn(carB, ctx, raceState) // now B is at the front
    check('drop-in queue: B proceeds once A has released the slot', carB.state === 0)
  }

  // (f) the SEPARATE, race-wide "only one car finishes at a time" claim token (1000:2680, docs
  // §9r), independent of the per-slot queue above -- exercised with two DIFFERENT dropInSlots (so
  // the per-slot queue gate alone can't be what's blocking the second car).
  {
    const e3 = ROUND3_DROPIN_TABLE[3], e4 = ROUND3_DROPIN_TABLE[4]
    check('fixture: entries 3 and 4 have distinct dropInSlots', e3.dropInSlot !== e4.dropInSlot)
    const mk = (entry) => ({
      state: 0xe, subState: 3, active: 0, dropInSlot: entry.dropInSlot,
      posX: entry.spawnTargetX, posY: entry.spawnTargetY, spawnTargetX: entry.spawnTargetX, spawnTargetY: entry.spawnTargetY,
      height: 0, zVel: 0,
    })
    const carA = mk(e3), carB = mk(e4)
    const raceState = {
      dropInSlots: { [e3.dropInSlot]: { queue: [carA], waitTicks: 0 }, [e4.dropInSlot]: { queue: [carB], waitTicks: 0 } },
      dropInOwner: carA, // A already holds the race-wide token, mid-finish
    }
    const ctx = { round: 3, race: 2, raceFormat: 1, stepIncrement: 1 }

    stepDropIn(carB, ctx, raceState) // B is front-of-its-own-queue, but A still owns the global token and hasn't returned to state 0
    check('drop-in token: a different-slot car still waits for the current global-token holder to finish', carB.subState === 3 && carB.state === 0xe)

    carA.state = 0 // A finishes (independently of this call)
    stepDropIn(carB, ctx, raceState)
    check('drop-in token: B claims the token and finishes once A has returned to state 0', carB.state === 0 && raceState.dropInOwner === carB)
  }

  // (g) subState 4's own settle-distance gate (1000:6f16-6f1b, X-axis only -- confirmed by
  // disassembly, not a simplification): a car still far from its spawn target does not finish yet.
  {
    const entry = ROUND3_DROPIN_TABLE[0]
    const raceState = { dropInSlots: { [entry.dropInSlot]: { queue: [], waitTicks: 0 } }, dropInOwner: null }
    const car = {
      state: 0xe, subState: 4, active: 1, dropInSlot: entry.dropInSlot,
      posX: entry.spawnTargetX - 200, posY: entry.spawnTargetY, spawnTargetX: entry.spawnTargetX, spawnTargetY: entry.spawnTargetY,
    }
    raceState.dropInSlots[entry.dropInSlot].queue.push(car)
    stepDropIn(car, { round: 3, race: 2, raceFormat: 1, stepIncrement: 1 }, raceState)
    check('drop-in settle: 200px away (X axis) does not finish yet', car.state === 0xe && car.subState === 4)
    car.posX = entry.spawnTargetX - 10
    stepDropIn(car, { round: 3, race: 2, raceFormat: 1, stepIncrement: 1 }, raceState)
    check('drop-in settle: within tolerance finishes', car.state === 0)
  }

  // (h) applyScriptedDrift (the `1000:73e7` drift-application half, docs §9r): only states {1,4,5}
  // get the drift, and round 9 skips every car but car 0 (the real function's own quirk).
  {
    const { applyScriptedDrift } = await import('../src/engine/dropin.js')
    for (const state of [1, 4, 5]) {
      const car = { state, posX: 100, posY: 100, driftDX: 5, driftDY: -3, driftSteps: 2 }
      applyScriptedDrift(car, { round: 3 }, true)
      check(`applyScriptedDrift: state ${state} moves by driftDX/DY and counts driftSteps down`, car.posX === 105 && car.posY === 97 && car.driftSteps === 1)
    }
    const idleCar = { state: 0, posX: 100, posY: 100, driftDX: 5, driftDY: -3, driftSteps: 2 }
    applyScriptedDrift(idleCar, { round: 3 }, true)
    check('applyScriptedDrift: state 0 is never drifted', idleCar.posX === 100 && idleCar.driftSteps === 2)
    const doneCar = { state: 4, posX: 100, posY: 100, driftDX: 5, driftDY: -3, driftSteps: 0 }
    applyScriptedDrift(doneCar, { round: 3 }, true)
    check('applyScriptedDrift: driftSteps===0 is a no-op', doneCar.posX === 100)
    const droneCar = { state: 4, posX: 100, posY: 100, driftDX: 5, driftDY: -3, driftSteps: 2 }
    applyScriptedDrift(droneCar, { round: 9 }, false) // round 9, not car 0
    check('applyScriptedDrift: round 9 skips every car but car 0', droneCar.posX === 100 && droneCar.driftSteps === 2)
  }
}

/**
 * Camera MOTION, not just camera determinism (added 2026-09-21, docs/engine.md §9m). From M3.6 to
 * M3.10 the X axis only ever applied ±step, so a settled camera (step=50) overshot a target 4px
 * away by 46px and swung back next step: a ±50px oscillation at 35 Hz that every screenshot
 * showed as a normal frame, and that no check here constrained -- the determinism test above
 * happily reproduces an oscillating camera identically. Two layers:
 *   (a) the three regimes of `5126-5152`/`5156-5186` per axis, straight from the disassembly,
 *       run through updateCamera with a synthetic car -- X and Y must give the same answers;
 *   (b) on a real drive, once both steps have settled to 50 the camera must sit EXACTLY on its
 *       target every step the car moves <= 50px (the near regime snaps, it never creeps).
 */
async function checkCameraTracking() {
  const { wrapWorld, wrapDelta } = await import('../src/engine/int16.js')
  const ctx = { clearControlsLockedOnSettle: false }
  // (a) regimes. camHalf=0 so the target is the car position itself; the "other" axis is kept on
  // target so it never disturbs the axis under test.
  const regime = (axis, cam, target, step) => {
    const car = { posX: axis === 'x' ? target : 0, posY: axis === 'y' ? target : 0, camHalfW: 0, camHalfH: 0 }
    const cs = { x: axis === 'x' ? cam : 0, y: axis === 'y' ? cam : 0, stepX: axis === 'x' ? step : 50, stepY: axis === 'y' ? step : 50 }
    updateCamera([car], cs, ctx)
    return axis === 'x' ? { cam: cs.x, step: cs.stepX } : { cam: cs.y, step: cs.stepY }
  }
  for (const axis of ['x', 'y']) {
    let r = regime(axis, 0, 1500, 8)
    check(`${axis}: |delta|>1000 snaps to the target and sets step=50 (513f/5173)`, r.cam === 1500 && r.step === 50)
    r = regime(axis, 0, 100, 8)
    check(`${axis}: step<|delta|<=1000 creeps by +step, step unchanged (5147/517b)`, r.cam === 8 && r.step === 8)
    r = regime(axis, 100, 0, 8)
    check(`${axis}: ... and by -step for a negative delta`, r.cam === 92 && r.step === 8)
    r = regime(axis, 0, 5, 8)
    check(`${axis}: |delta|<=step snaps exactly onto the target and sets step=50`, r.cam === 5 && r.step === 50)
    r = regime(axis, 414, 418, 50)
    check(`${axis}: the regression case -- settled camera 4px off target lands ON it (418), not 50px past it (464)`, r.cam === 418 && r.step === 50)
    r = regime(axis, 414, 414, 50)
    check(`${axis}: on target it stays put`, r.cam === 414 && r.step === 50)
  }

  // (b) a real drive: full throttle, then a held left turn so the target keeps moving.
  const setup = await setupRace()
  const { cars, camera, world, ctx: rctx, raceState } = setup
  let settledAt = -1, offTarget = 0, flipsX = 0, lastSignX = 0, maxStep = 0
  rctx.camera = camera
  let prevX = camera.x, prevCarX = cars[0].posX, prevCarY = cars[0].posY
  for (let step = 0; step < 600; step++) {
    const controls = cars.map((car, i) => (i === 0 ? (step < 200 ? 0x20 : 0xa0) : droneControlByte(car, rctx)))
    runStep(world, cars, controls, raceState, rctx)
    const dCam = wrapDelta(camera.x - prevX)
    prevX = camera.x
    maxStep = Math.max(maxStep, Math.abs(dCam))
    const s = Math.sign(dCam)
    if (s && lastSignX && s !== lastSignX) flipsX++
    if (s) lastSignX = s
    const moved = Math.max(Math.abs(wrapDelta(cars[0].posX - prevCarX)), Math.abs(wrapDelta(cars[0].posY - prevCarY)))
    prevCarX = cars[0].posX; prevCarY = cars[0].posY
    const settled = camera.stepX === 50 && camera.stepY === 50
    if (settled && settledAt < 0) settledAt = step
    if (settled && moved <= 50) {
      const tx = wrapWorld(cars[0].posX - cars[0].camHalfW), ty = wrapWorld(cars[0].posY - cars[0].camHalfH)
      if (wrapWorld(camera.x) !== tx || wrapWorld(camera.y) !== ty) offTarget++
    }
  }
  check(`camera settles (both steps 50) within the spawn hold (at step ${settledAt}, expected < 40)`, settledAt >= 0 && settledAt < 40)
  check(`settled camera sits exactly on its target every step of a 600-step drive (${offTarget} off-target steps)`, offTarget === 0)
  check(`no oscillation: max per-step camera X move is the 8px approach step, not 50 (got ${maxStep})`, maxStep <= 8)
  check(`no oscillation: camera X reverses direction only when the car does (${flipsX} flips in 600 steps, was 559 before the fix)`, flipsX < 40)

  // (c) Round 5 race 1's grid gives a start camera x of 208-230 = -22. InitRaceCarsFromTables wraps
  // it once (3DFF `CMP AX,0 / JG / ADD AX,0xC00`, docs/engine.md §9an) to 3050; the camera is never
  // folded again, so a stored position can still sit just outside [0,0xC00) and raceView.js must
  // treat a negative camera exactly like its wrapped equivalent, and draw something.
  const { loadTileBank, buildWordMap } = await import('../src/formats/race.js')
  const { composeRaceView } = await import('../src/render/raceView.js')
  const strt = parseStrtPos(await read('GAME1/STRT_POS.BIN'))
  const r51 = strt.find((s) => s.round === 5 && s.race === 1)
  const cam51 = initCameraState(r51)
  check(`round 5 race 1's initial camera is wrapped at init, -22 -> 3050 (3DFF) (${cam51.x},${cam51.y})`, cam51.x === 0xc00 - 22 && cam51.targetX === cam51.x)
  cam51.x -= 0xc00 // a stored position just below 0, as the unwrapped smoothing can leave it
  const { bytes: bank } = await loadTileBank(read, 5)
  const words = buildWordMap(await read('GAME1/ROUND51.MAP'), await read('GAME1/ROUND5BR.CT'), 5)
  const raw = composeRaceView({ words, bank, camera: cam51, cars: [] }).indexed
  const wrapped = composeRaceView({ words, bank, camera: { x: wrapWorld(cam51.x), y: wrapWorld(cam51.y) }, cars: [] }).indexed
  check('a negative camera composes byte-identically to its wrapped equivalent', raw.length === wrapped.length && raw.every((v, i) => v === wrapped[i]))
  check('...and that frame is not blank', raw.some((v) => v !== 0))
}

/**
 * Car-car collision (added 2026-09-21, docs/engine.md §9n -- the "two boats glued together in
 * tournament mode" report). Two independent bugs, both confirmed live against `5921`/`5960`:
 *   (a) `dx`/`dy` were computed B-minus-A instead of A-minus-B, feeding the asymmetric 17x17
 *       contact table (`CONTACT_TABLE`) the wrong entry -- two cars closer than the 16px contact
 *       box got a misdirected push and could sit glued together indefinitely instead of
 *       separating (this is what the user saw). Confirmed NOT a natural-AI-driving symptom (a
 *       3000-step multi-round/format sweep with ordinary drone driving never triggered it) but a
 *       100%-reproducible one the instant two cars are placed inside the contact box, which is
 *       exactly what a close pass/ram/knockout-respawn produces in play.
 *   (b) the 6 pairs run in `(0,1)(0,2)(0,3)(1,3)(1,2)(3,2)` order (from `5921`'s own `[27B1]/
 *       [27B3]` assignments), not sorted-index `(i,j)` pairs -- the last one is `(car3,car2)`,
 *       A/B swapped from a naive `i<j` loop, which matters for the state-2 branch's asymmetric
 *       +-0x40 assignment.
 */
async function checkCarCarCollision() {
  const { resolveCarCarCollisions } = await import('../src/engine/collide.js')
  const { wrapDelta } = await import('../src/engine/int16.js')
  const mkInactive = () => ({ active: 0, state: 0, nextX: 0, nextY: 0, posX: 0, posY: 0, posXfrac: 0, posYfrac: 0, velX: 0, velY: 0, carCarHit: 0 })

  // (a) A is to B's left (B.nextX > A.nextX): A must be pushed further left, B further right --
  // the exact asymmetric case the old B-minus-A sign misdirected (a symmetric dx=0 case can't
  // distinguish the two sign conventions, which is why this needs to be off-centre).
  {
    const a = { active: 1, state: 0, nextX: 1000, nextY: 1000, posX: 1000, posY: 1000, posXfrac: 0, posYfrac: 0, velX: 0, velY: 0, carCarHit: 0 }
    const b = { active: 1, state: 0, nextX: 1008, nextY: 1000, posX: 1008, posY: 1000, posXfrac: 0, posYfrac: 0, velX: 0, velY: 0, carCarHit: 0 }
    resolveCarCarCollisions([a, b, mkInactive(), mkInactive()], { round: 2 })
    check('A (to B\'s left) is pushed further left, not toward B', a.velX < 0)
    check('B (to A\'s right) is pushed further right, not toward A', b.velX > 0)
  }

  // (b) pairing identity: the state-2 branch's asymmetric assignment must land on car3 (the real
  // "A" of the last pair) and car2 (the real "B"), not the reverse a sorted (2,3) loop would give.
  {
    const mk = (over) => ({ active: 1, state: 0, nextX: 1000, nextY: 1000, posX: 1000, posY: 1000, posXfrac: 0, posYfrac: 0, velX: 0, velY: 0, carCarHit: 0, ...over })
    const cars = [mk({ active: 0 }), mk({ active: 0 }), mk({ nextX: 1004, posX: 1004 }), mk({ state: 2 })]
    resolveCarCarCollisions(cars, { round: 2 })
    check('last pair is (car3,car2): car3 (real A) gets the +0x40 push', cars[3].velX === 0x40 && cars[3].velY === 0x40)
    check('last pair is (car3,car2): car2 (real B) gets the -0x40 push', cars[2].velX === -0x40 && cars[2].velY === -0x40)
  }

  // (b2) The BX chain (docs/engine.md §9an): 5960 re-integrates the car the PREVIOUS pair left in BX
  // -- car 3 before pair (0,1), then B when A was active and in state 0/2. Cars 0/1 far apart
  // (no contact) with car 1's nextX stale: pair (0,1) exits with BX=car 1, so car 1 is
  // re-integrated (nextX := posX + velX>>8) before pair (0,2). The old always-car-3 rule left it stale.
  {
    const mk = (over) => ({ active: 1, state: 0, nextX: 0, nextY: 0, posX: 1000, posY: 1000, posXfrac: 0, posYfrac: 0, velX: 0, velY: 0, carCarHit: 0, ...over })
    const cars = [mk({ posX: 200, nextX: 200, nextY: 1000 }), mk({ posX: 1500, velX: 0x300, nextX: 7 }), mk({ active: 0, posX: 2500, nextX: 2500 }), mk({ active: 0, posX: 2800, nextX: 2800 })]
    resolveCarCarCollisions(cars, { round: 2 })
    check('BX chain: pair (0,1) leaves car 1 in BX, so car 1 is re-integrated before pair (0,2) (59F3)', cars[1].nextX === 1503)
    const inact = [mk({ active: 0, posX: 200, velX: 0x200, nextX: 5 }), mk({ posX: 1500 }), mk({ active: 0 }), mk({ active: 0 })]
    resolveCarCarCollisions(inact, { round: 2 })
    check('BX chain: an inactive A leaves A in BX (59D7), so car 0 is re-integrated next', inact[0].nextX === 202)
  }

  // (b3) WARRIORS hard hit (5B2E-5B99): only car A has to be drawn; each drawn car gets knockoutX/Y
  // := pos and state 0xD. The port used to require both cars drawn and skipped the snapshot.
  {
    const mk = (over) => ({ active: 1, state: 0, nextX: 1000, nextY: 1000, posX: 1000, posY: 1000, posXfrac: 0, posYfrac: 0, velX: 0, velY: 0, carCarHit: 0, drawnThisFrame: 1, ...over })
    const a = mk({ velX: 0x600 })
    const b = mk({ nextX: 1008, posX: 1008, velX: -0x600, drawnThisFrame: 0 })
    resolveCarCarCollisions([a, b, mk({ active: 0 }), mk({ active: 0 })], { round: 6 })
    check('WARRIORS hit: drawn A is knocked out with a knockout snapshot even though B is not drawn (5B40)', a.state === 0xd && a.knockoutX === 1000)
    check('WARRIORS hit: undrawn B is not knocked out (5B71)', b.state === 0)
  }

  // (c) the reported symptom, driven: force two real, AI-driven cars inside the contact box
  // mid-race and confirm they separate promptly rather than sitting glued for the rest of the run.
  const setup = await setupRace()
  const { cars, world, ctx, raceState } = setup
  for (let step = 0; step < 40; step++) {
    const controls = cars.map((car, i) => (i === 0 ? 0x20 : droneControlByte(car, ctx)))
    runStep(world, cars, controls, raceState, ctx)
  }
  cars[1].posX = cars[0].posX + 8; cars[1].nextX = cars[1].posX
  cars[1].posY = cars[0].posY; cars[1].nextY = cars[1].posY
  let stuckFor = 0, maxStuck = 0
  for (let step = 0; step < 200; step++) {
    const controls = cars.map((car, i) => (i === 0 ? 0x20 : droneControlByte(car, ctx)))
    runStep(world, cars, controls, raceState, ctx)
    const dist = Math.hypot(wrapDelta(cars[1].posX - cars[0].posX), wrapDelta(cars[1].posY - cars[0].posY))
    stuckFor = dist < 20 ? stuckFor + 1 : 0
    maxStuck = Math.max(maxStuck, stuckFor)
  }
  check(`two cars forced into the contact box separate promptly, not glued (longest <20px streak: ${maxStuck} steps, was 200/200 before the fix)`, maxStuck < 60)
}

/**
 * The race HUD (`DrawRaceHudDigitsAndRankIcons 1000:8dfc`), docs/engine.md §9o -- added post-M3.10.
 * The pixel-exact claim (this port's `drawHud` output matches a real captured DOSBox frame
 * byte-for-byte, including which car's colour lands in which row) is `npm run live`'s job, not
 * this one (see check-live.mjs's own header for how that reference-frame match was found). These
 * are the unit-level checks that don't need that reference frame: rank ordering (driven by
 * `racePosition`, not array index), the finish-flag swap, the recolour mask's own narrower nibble
 * set, and `composeRaceView`'s branch gating (the round-9 and two-car branches of `8dfc` aren't
 * ported -- `hud.js`'s own module comment -- so both must be a clean no-op, not a wrong guess).
 */
async function checkHud() {
  const { drawHud } = await import('../src/render/hud.js')
  const { ph0Icon16, ph0Digit, remapHudIconColours, remapCarColours, PH0_LAYOUT } = await import('../src/formats/race.js')
  const { composeRaceView } = await import('../src/render/raceView.js')
  const { decompress } = await import('../src/formats/lz.js')
  const ph0 = decompress(new Uint8Array(readFileSync(join(GAME, 'BITSFILE.PH0'))))

  const W = 24, H = 85
  const mkCar = (over) => ({ colourOffset: 0, lapsRemaining: 3, racePosition: 1, ...over })

  // (0) `ph0Digit` has no bounds check of its own -- it relies on `car.lapsRemaining` staying in
  // [0,9], which `checkpoints.js`'s own clamps (`Math.max(0, ...)` on the lap decrement,
  // `Math.min(9, ...)` on the backward-crossing increment, docs/engine.md §3) already guarantee.
  // Confirm every value in that range yields a real 8×16 glyph slice, not a crash or a short array.
  for (let v = 0; v <= 10; v++) {
    const g = ph0Digit(ph0, v)
    check(`ph0Digit(${v}) is a full 8x16 glyph (${g.indexed.length} bytes)`, g.indexed.length === 128)
  }

  // (a) rank ordering: the car with racePosition===1 lands in row 1 (y=16) regardless of its
  // position in the `cars` array -- rank-driven, not index-driven.
  {
    const dst = new Uint8Array(W * H)
    const cars = [mkCar({ racePosition: 4, colourOffset: 6 }), mkCar({ racePosition: 1, colourOffset: 0 }), mkCar({ racePosition: 3, colourOffset: 4 }), mkCar({ racePosition: 2, colourOffset: 2 })]
    drawHud(dst, W, H, cars, ph0)
    const expectRow1 = remapHudIconColours(ph0Icon16(ph0, PH0_LAYOUT.icons.warning).indexed, 0) // cars[1]'s own offset (racePosition 1)
    let matches = true
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (dst[(16 + y) * W + x] !== expectRow1[y * 16 + x]) matches = false
    check('rank-1 row shows whichever car has racePosition===1, not array index 0', matches)
  }

  // (b) finish-flag swap: a car with lapsRemaining<=0 shows the finish flag, not the helmet.
  {
    const dst = new Uint8Array(W * H)
    drawHud(dst, W, H, [mkCar({ racePosition: 1, lapsRemaining: 0 }), mkCar({ racePosition: 2 }), mkCar({ racePosition: 3 }), mkCar({ racePosition: 4 })], ph0)
    const expectFlag = remapHudIconColours(ph0Icon16(ph0, PH0_LAYOUT.icons.flag).indexed, 0)
    let matches = true
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (dst[(16 + y) * W + x] !== expectFlag[y * 16 + x]) matches = false
    check('a finished car (lapsRemaining<=0) shows the finish-flag icon, not the helmet', matches)
  }

  // (c) recolour mask: confirmed live at 1000:8dda-8de5 that the HUD icon's own mask ({1,2}) is
  // narrower than the vehicle body's (`remapCarColours`, "(p&0xF)<=2" i.e. {0,1,2}) -- a nibble-0
  // pixel must pass through the HUD's remap untouched while the body's remap still shifts it.
  {
    const frame = new Uint8Array([0x10, 0x11, 0x12, 0x00]) // nibble 0, 1, 2, and transparent
    const hud = remapHudIconColours(frame, 0x20)
    const body = remapCarColours(frame, 0x20)
    check('HUD icon recolour leaves a nibble-0 pixel untouched (unlike the vehicle body mask)', hud[0] === 0x10 && body[0] === 0x30)
    check('...but both shift nibble-1/2 pixels the same way', hud[1] === 0x31 && hud[2] === 0x32 && body[1] === 0x31 && body[2] === 0x32)
    check('...and the transparent (0) pixel is untouched by either', hud[3] === 0 && body[3] === 0)
  }

  // (d) composeRaceView gating (docs/engine.md §9p): round 9 now draws the RUFFTRUX countdown
  // (checked FIRST, exactly like `8dfc` itself); two-car format still draws nothing (the light bar
  // isn't wired -- see hud.js). A two-car tournament's bonus race really does reach round 9 with
  // raceFormat===2 (flow.js derives raceFormat from tournament.format, not per-race), so that exact
  // combination must still draw the countdown, not silently fall through to "nothing".
  {
    const cars4 = [mkCar({ racePosition: 1 }), mkCar({ racePosition: 2 }), mkCar({ racePosition: 3 }), mkCar({ racePosition: 4 })]
    const base = { words: new Uint16Array(1), bank: new Uint8Array(1), camera: { x: 0, y: 0 }, cars: cars4, frames: [], view: { w: W, h: H } }
    const twoCar = composeRaceView({ ...base, hud: { ph0, raceFormat: 2, round: 2, twoCar: { score: 4, banners: [] }, rankOrder: [0, 1, 2, 3] } })
    const round9 = composeRaceView({ ...base, hud: { ph0, raceFormat: 1, round: 9, ruffTruxTicks: 5000 } })
    const round9TwoCar = composeRaceView({ ...base, hud: { ph0, raceFormat: 2, round: 9, ruffTruxTicks: 5000 } })
    check('two-car format (raceFormat 2), round != 9, draws the light bar (docs/engine.md §9am)', twoCar.indexed.some((v) => v !== 0))
    check('round 9 (RUFFTRUX) draws the countdown, not nothing', round9.indexed.some((v) => v !== 0))
    check('round 9 takes priority over raceFormat===2 (a two-car bonus race still shows the countdown)', round9TwoCar.indexed.some((v) => v !== 0))
  }

  // (e) drawRuffTruxCountdown (docs/engine.md §9p): value = ticks>>4, decomposed into up to 3
  // decimal digits; the blink glyph (index 10) appears between the tens and ones columns ONLY when
  // the ones digit is non-zero (the byte-level finding that corrected a naive decompiler reading).
  {
    const { drawRuffTruxCountdown } = await import('../src/render/hud.js')
    const RW = 40, RH = 24 // wide/tall enough for RUFFTRUX's own layout (x up to 39, y up to 23) -- a different footprint from branch C's 24x85 column, not reused
    const at = (dst, x, y) => { const g = { width: 8, height: 16, indexed: new Uint8Array(128) }; for (let yy = 0; yy < 16; yy++) for (let xx = 0; xx < 8; xx++) g.indexed[yy * 8 + xx] = dst[(y + yy) * RW + (x + xx)]; return g }
    const eq = (a, b) => a.indexed.length === b.indexed.length && a.indexed.every((v, i) => v === b.indexed[i])

    // ticks=5000 -> 5000>>4=312 -> hundreds=3, tens=1, ones=2 (non-zero -> blink glyph shows)
    let dst = new Uint8Array(RW * RH)
    drawRuffTruxCountdown(dst, RW, RH, 5000, ph0)
    check('RUFFTRUX 5000>>4=312: hundreds digit is 3', eq(at(dst, 8, 8), ph0Digit(ph0, 3)))
    check('RUFFTRUX 5000>>4=312: tens digit is 1', eq(at(dst, 16, 8), ph0Digit(ph0, 1)))
    check('RUFFTRUX 5000>>4=312: ones digit is 2', eq(at(dst, 32, 8), ph0Digit(ph0, 2)))
    check('RUFFTRUX 5000>>4=312: ones digit non-zero -> blink glyph shows', eq(at(dst, 24, 8), ph0Digit(ph0, 10)))

    // ticks=160 -> 160>>4=10 -> hundreds=0, tens=1, ones=0 -> NO blink glyph (background untouched)
    dst = new Uint8Array(RW * RH)
    drawRuffTruxCountdown(dst, RW, RH, 160, ph0)
    check('RUFFTRUX 160>>4=10: ones digit is 0', eq(at(dst, 32, 8), ph0Digit(ph0, 0)))
    check('RUFFTRUX 160>>4=10: ones digit zero -> no blink glyph (gap stays blank)', at(dst, 24, 8).indexed.every((v) => v === 0))

    check('RUFFTRUX: a negative/expired tick value clamps to 0, not a garbage slice', (() => {
      const d = new Uint8Array(RW * RH)
      drawRuffTruxCountdown(d, RW, RH, -1, ph0)
      return eq(at(d, 32, 8), ph0Digit(ph0, 0))
    })())
  }

  // (f) drawTwoCarHud (docs/engine.md §9p/§9am, resolving UNKNOWN_ph0_light_roles): the standalone
  // digit is the lapsRemaining of the record in order slot 0 (8FAB) -- which after the finish
  // block's rewrite (4C6F) can be the absent car 2; the light bar splits with RED (P1's end) on the
  // BOTTOM `lightScore` rows and BLUE (P2's end) on the TOP `8-lightScore` rows.
  {
    const { drawTwoCarHud } = await import('../src/render/hud.js')
    const LW = 16, LH = 16 + 8 * 16 // wide/tall enough for the 8-row light bar (y up to 143) -- a different footprint from branch C's 24x85 column
    const at8 = (dst, x, y) => { const g = { width: 8, height: 16, indexed: new Uint8Array(128) }; for (let yy = 0; yy < 16; yy++) for (let xx = 0; xx < 8; xx++) g.indexed[yy * 8 + xx] = dst[(y + yy) * LW + (x + xx)]; return g }
    const at16 = (dst, x, y) => { const g = { width: 16, height: 16, indexed: new Uint8Array(256) }; for (let yy = 0; yy < 16; yy++) for (let xx = 0; xx < 16; xx++) g.indexed[yy * 16 + xx] = dst[(y + yy) * LW + (x + xx)]; return g }
    const eqIndexed = (a, b) => a.indexed.length === b.indexed.length && a.indexed.every((v, i) => v === b.indexed[i])
    const red = ph0Icon16(ph0, PH0_LAYOUT.lights.red)
    const blue = ph0Icon16(ph0, PH0_LAYOUT.lights.blue)

    const dst = new Uint8Array(LW * LH)
    const cars2 = [mkCar({ racePosition: 2, lapsRemaining: 1 }), mkCar({ racePosition: 1, lapsRemaining: 7 }), mkCar({ lapsRemaining: 3, active: 0, present: 0 })]
    drawTwoCarHud(dst, LW, LH, cars2, ph0, 3, [1, 0, 2, 3]) // lightScore=3 -> bottom 3 rows (6,7,8) red, top 5 (1-5) blue
    check('drawTwoCarHud: standalone digit is order slot 0\'s car, not array index 0', eqIndexed(at8(dst, 8, 0), ph0Digit(ph0, 7)))
    const dst2 = new Uint8Array(LW * LH)
    drawTwoCarHud(dst2, LW, LH, cars2, ph0, 3, [2, 0, 1, 3])
    check('drawTwoCarHud: after 4C6F slot 0 is the absent car 2, and its laps (3) are what shows', eqIndexed(at8(dst2, 8, 0), ph0Digit(ph0, 3)))
    for (let row = 1; row <= 5; row++) check(`drawTwoCarHud: light row ${row}/8 (top) is blue at lightScore=3`, eqIndexed(at16(dst, 0, 16 + (row - 1) * 16), blue))
    for (let row = 6; row <= 8; row++) check(`drawTwoCarHud: light row ${row}/8 (bottom) is red at lightScore=3`, eqIndexed(at16(dst, 0, 16 + (row - 1) * 16), red))
  }

  // (g) The two-car banners through composeRaceView (docs/engine.md §9am): `DrawBanner88x22Blinking
  // 9289` takes a CENTRE and draws at (cx-44, cy-12) -- "Winner" (index 1) at its settled (0x80,0x7C)
  // lands at top-left (84,112); the normal phase copies colour-0-transparent (8CA4), the blink phase
  // [26CF]=1 writes palette 0 exactly where the banner has a pixel (8C3C). A tile background of 7
  // makes both the transparency and the silhouette visible.
  {
    const { ph0Banner } = await import('../src/formats/race.js')
    const VW = 256, VH = 200, BGC = 7
    const bank = new Uint8Array(256).fill(BGC)
    const view = (blink) => composeRaceView({ words: new Uint16Array(1), bank, camera: { x: 0, y: 0 }, cars: [mkCar({ racePosition: 1 }), mkCar({ racePosition: 2 })], frames: [], view: { w: VW, h: VH }, hud: { ph0, raceFormat: 2, round: 2, twoCar: { score: 4, banners: [{ index: 1, cx: 0x80, cy: 0x7c }] }, rankOrder: [0, 1, 2, 3], bannerBlink: blink } }).indexed
    const src = ph0Banner(ph0, 1)
    const normal = view(0)
    const dark = view(1)
    let placed = true, transparent = true, silhouette = true, inked = 0
    for (let y = 0; y < 22; y++) {
      for (let x = 0; x < 88; x++) {
        const sp = src.indexed[y * src.width + x]
        const at = (112 + y) * VW + (84 + x)
        if (sp) { inked++; if (normal[at] !== sp) placed = false; if (dark[at] !== 0) silhouette = false }
        else { if (normal[at] !== BGC) transparent = false; if (dark[at] !== BGC) silhouette = false }
      }
    }
    check('two-car banner: Winner at centre (0x80,0x7C) lands at top-left (84,112) (9289: -44/-12)', inked > 0 && placed)
    check('two-car banner: colour-0 pixels are transparent in the normal phase (8CA4)', transparent)
    check('two-car banner: the blink phase draws a palette-0 silhouette of exactly the banner\'s pixels (8C3C)', silhouette)
  }
}

/**
 * Projectiles (Fire `1000:4f17`, Flight `1000:51b2`, Hit `1000:79fd`), docs/engine.md §9q -- the
 * user's "fire button (S) does nothing" report. Real gameplay verification (a live boat/tank
 * actually firing) hasn't been done -- these are unit-level checks against the byte-verified
 * algorithm, not a pixel-exact reference frame the way the HUD's are.
 */
async function checkProjectiles() {
  const { fireProjectile, updateProjectileFlight, resolveProjectileHits, projectilesEnabled, FLIGHT_THRESHOLD, RELOAD_TOTAL } = await import('../src/engine/projectile.js')
  const { applySteerAndThrottle } = await import('../src/engine/step.js')
  const mk = (over) => ({
    posX: 1000, posY: 1000, posXfrac: 0, posYfrac: 0, velX: 0, velY: 0, heading: 0,
    projActive: 0, projFrame: 0, projX: 0, projY: 0, projStepsA: 0, projStepsB: 0,
    projXsub: 0, projYsub: 0, reloadCooldown: 0, present: 1, drawnThisFrame: 1, ...over,
  })

  // (a) Where fire happens in the control path (4D2F-4F17, docs/engine.md §9an, derived twice): a
  // keyboard/mouse car holding 0x08 is frozen that step (no snap, steer, throttle or coast) and goes
  // to the fire entry; joysticks/drones fire only after accelerating (accel+0x08, 4EFB); the 0x30
  // chord steers, holds speed and fires; [2915] turns the fire entry into a ground coast.
  {
    const drv = (over) => mk({ heading: 0x44, speed: 0x200, steerStep: 3, accel: 16, brakeDecel: 20, coastDecel: 8, maxSpeedCur: 0x600, reverseLimit: -0x200, height: 0, isDrone: 0, lapsRemaining: 3, ...over })
    const kb = drv({})
    applySteerAndThrottle(kb, 0x80 | 0x20 | 0x08, { round: 7 }, false, 0, 5)
    check('keyboard fire preempt: no heading snap, no steering, no throttle (4D4B-4D70)', kb.heading === 0x44 && kb.speed === 0x200)
    check('keyboard fire preempt: in TANKS the shot still fires (4F03 -> 4F17)', kb.projActive === 1)
    const js = drv({})
    applySteerAndThrottle(js, 0x80 | 0x20 | 0x08, { round: 7 }, false, 0, 1)
    check('joystick: steers and accelerates, then fires (4EFB)', js.heading === 0x41 && js.speed === 0x210 && js.projActive === 1)
    const dr = drv({ isDrone: 1 })
    applySteerAndThrottle(dr, 0x10 | 0x08, { round: 7 }, false, 0, 6)
    check('drone: brake + 0x08 brakes and never fires', dr.projActive === 0 && dr.speed === 0x200 - 20)
    const ch = drv({})
    applySteerAndThrottle(ch, 0x40 | 0x30, { round: 7 }, false, 0, 5)
    check('chord 0x30: steers, holds speed, fires (4E24 -> 4F17)', ch.heading === 0x47 && ch.speed === 0x200 && ch.projActive === 1)
    const kc = drv({})
    applySteerAndThrottle(kc, 0x08, { round: 7, fireKeyDisabled: true }, false, 0, 5)
    check('[2915]: keyboard fire becomes the ground coast, no shot (4F0D -> 4E2E)', kc.speed === 0x200 - 8 && kc.projActive === 0)
    const dc = drv({ isDrone: 1 })
    applySteerAndThrottle(dc, 0x28, { round: 7, fireKeyDisabled: true }, false, 0, 6)
    check('[2915]: a drone accel+fire step accelerates, then coasts, no shot', dc.speed === 0x200 + 16 - 8 && dc.projActive === 0)
    const off = drv({})
    applySteerAndThrottle(off, 0x80 | 0x08, { round: 2 }, false, 0, 5)
    check('keyboard fire outside TANKS: frozen, and nothing fires', off.heading === 0x44 && off.speed === 0x200 && off.projActive === 0)
  }
  // The direction word's nibble is the HIGH byte of vel+posFrac (the step's pixel carry) plus 8.
  {
    const dw = mk({ heading: 0, velX: 0x180, posXfrac: 0xa0 })
    fireProjectile(dw, { round: 7 })
    check('fire: direction nibble = (high byte of velX+posXfrac) + 8 (4F81-4F8E)', ((dw.projXsub >> 8) & 0xf) === 10)
  }

  // (b) the TANKS/cheat-flag gate blocks firing outside round 7 without the flag.
  {
    const car = mk({})
    fireProjectile(car, { round: 2 })
    check('fireProjectile: no-op outside TANKS without the projectilesForAll flag', car.projActive === 0)
    fireProjectile(car, { round: 7 })
    check('fireProjectile: fires in round 7 (TANKS)', car.projActive === 1)
  }
  {
    const car = mk({})
    fireProjectile(car, { round: 2, projectilesForAll: true })
    check('fireProjectile: the cheat flag opens the gate in any round', car.projActive === 1)
  }

  // (c) fire sets the documented field values and offsets projX/Y from the car's own position.
  {
    const car = mk({ heading: 0 })
    fireProjectile(car, { round: 7 })
    check(`fireProjectile: reloadCooldown = 0x3C (${car.reloadCooldown})`, car.reloadCooldown === RELOAD_TOTAL)
    check(`fireProjectile: projStepsA/B = 10 (${car.projStepsA},${car.projStepsB})`, car.projStepsA === 10 && car.projStepsB === 10)
    check('fireProjectile: projX/Y offset from the car\'s own position, not left at 0', car.projX !== 0 && car.projY !== 0)
    check('fireProjectile: cannot re-fire while reloading', (() => { const before = car.reloadCooldown; fireProjectile(car, { round: 7 }); return car.reloadCooldown === before })())
  }

  // (d) flight alone (51B2): the shot moves and reloadCooldown counts down; 51B2 never clears
  // projActive -- only 8712 does (docs/engine.md §9cr).
  {
    const car = mk({ heading: 0x40 }) // pointing right, so projX should drift
    fireProjectile(car, { round: 7 })
    const x0 = car.projX
    for (let i = 0; i < RELOAD_TOTAL; i++) {
      check(`updateProjectileFlight: still active at tick ${i} (cooldown=${car.reloadCooldown})`, car.projActive === 1)
      updateProjectileFlight(car)
    }
    check('updateProjectileFlight: reloadCooldown reached exactly 0', car.reloadCooldown === 0)
    check('updateProjectileFlight: 51B2 taking the cooldown to 0 leaves projActive set (only 8712 clears it)', car.projActive === 1)
    check('updateProjectileFlight: the shot actually moved from its fire position', car.projX !== x0)
    check('updateProjectileFlight: projStepsA/B decayed to 0, not left at 10', car.projStepsA === 0 && car.projStepsB === 0)
  }

  // (e) hit: a victim within the 12px box gets knocked out; one outside it, or the gate disabled,
  // does not.
  {
    const shooter = mk({ heading: 0x40, projActive: 1, projX: 1000, projY: 1000, reloadCooldown: FLIGHT_THRESHOLD + 1 })
    const victimNear = { posX: 1005, posY: 1000, present: 1, drawnThisFrame: 1, state: 0, knockoutX: 0, knockoutY: 0 }
    const victimFar = { posX: 1100, posY: 1000, present: 1, drawnThisFrame: 1, state: 0, knockoutX: 0, knockoutY: 0 }
    resolveProjectileHits([shooter, victimNear, victimFar], { round: 7 })
    check('resolveProjectileHits: a victim within the hit box is knocked to state 0xD', victimNear.state === 0xd)
    check("resolveProjectileHits: the shot clears on a hit", shooter.projActive === 0)
    check('resolveProjectileHits: a victim outside the hit box is untouched', victimFar.state === 0)
  }
  {
    const shooter = mk({ projActive: 1, projX: 1000, projY: 1000, reloadCooldown: FLIGHT_THRESHOLD + 1 })
    const victim = { posX: 1005, posY: 1000, present: 1, drawnThisFrame: 1, state: 0 }
    resolveProjectileHits([shooter, victim], { round: 2 }) // no TANKS, no flag
    check('resolveProjectileHits: no-op outside the TANKS/cheat-flag gate', victim.state === 0 && shooter.projActive === 1)
  }
  {
    // A shot past the visible-flight window (reloadCooldown < FLIGHT_THRESHOLD, i.e. into its
    // reload tail) cannot still register a hit, even if a victim sits right on top of its last
    // known projX/Y and projActive hasn't cleared yet.
    const shooter = mk({ projActive: 1, projX: 1000, projY: 1000, reloadCooldown: FLIGHT_THRESHOLD - 1 })
    const victim = { posX: 1005, posY: 1000, present: 1, drawnThisFrame: 1, state: 0 }
    resolveProjectileHits([shooter, victim], { round: 7 })
    check('resolveProjectileHits: a shot past FLIGHT_THRESHOLD cannot hit', victim.state === 0 && shooter.projActive === 1)
  }
  check('projectilesEnabled: true in round 7', projectilesEnabled({ round: 7 }))
  check('projectilesEnabled: true with the cheat flag in any round', projectilesEnabled({ round: 1, projectilesForAll: true }))
  check('projectilesEnabled: false otherwise', !projectilesEnabled({ round: 1 }))
  // The tail icon (docs/engine.md §9cj): 8712 reads [1396]>>2 BEFORE its own count-up (render, before
  // the handlers), and 51B2 counts [1396] up again in the per-car pass while in flight -- icon 0 on the
  // firing frame and the next, then icon 1, which it keeps (the count saturates at 5).
  {
    const { projectileDrawTick } = await import('../src/engine/projectile.js')
    const car = { projActive: 1, projFrame: 0, reloadCooldown: RELOAD_TOTAL, projX: 1000, projY: 1000, projXsub: 0, projYsub: 0, projStepsA: 0, projStepsB: 0 }
    const icons = []
    for (let i = 0; i < 6; i++) { projectileDrawTick(car); icons.push(car._projIcon); updateProjectileFlight(car) }
    check(`projectile tail icon: 0,0 then 1 (871F read before the count-up, 51D8 in flight) -- got ${icons.join(',')}`, icons.join() === '0,0,1,1,1,1' && car.projFrame === 5)
  }
  // Two decrements (docs/engine.md §9cr): 8712 (render, drawn steps only) then 51B2 (every step).
  // Smoothness 1: 2 per step, so the shot moves on 10 steps (58..40, the projStepsA=0xA trail) and
  // the tank can fire again after 30; at smoothness 2 and 4 both last longer. 8712 draws at the value
  // it found, then decrements, and it is the one that clears projActive at 0.
  {
    const { projectileDrawTick } = await import('../src/engine/projectile.js')
    const life = (n) => {
      const car = mk({ heading: 0x40 })
      fireProjectile(car, { round: 7 })
      let steps = 0, moving = 0, drawn = [], drawDecs = 0, flightDecs = 0
      while (car.reloadCooldown !== 0 && steps < 200) {
        if (steps % n === n - 1 || n === 1) { const r = car.reloadCooldown; projectileDrawTick(car); if (car._projDraw) drawn.push(car._projDraw.cooldown); drawDecs += r - car.reloadCooldown }
        const x = car.projX, r = car.reloadCooldown
        updateProjectileFlight(car)
        flightDecs += r - car.reloadCooldown
        if (car.projX !== x) moving++
        steps++
      }
      return { steps, moving, drawn, stepsA: car.projStepsA, drawDecs, flightDecs }
    }
    const l1 = life(1), l2 = life(2), l4 = life(4)
    check(`projectile: smoothness 1 -- moves on 10 steps, reload done after 30, trail counter spent (got ${l1.moving}/${l1.steps}/${l1.stepsA})`, l1.moving === 10 && l1.steps === 30 && l1.stepsA === 0)
    check(`projectile: 8712 draws at the cooldown it found, before its own decrement (first draws ${l1.drawn.slice(0, 3)})`, l1.drawn.slice(0, 3).join() === '60,58,56')
    check(`projectile: smoothness 2 and 4 stretch the flight and the reload (got ${l2.moving}/${l2.steps}, ${l4.moving}/${l4.steps})`, l2.steps === 40 && l4.steps === 48 && l2.moving > 10 && l4.moving > l2.moving)
    // Live (docs/engine.md §9cr): [13A4] poked to 0x3C in a race, hits counted at 4AEE/51BC/87E6 until 0 --
    // smoothness 1: 30 steps, 30 flight and 30 draw decrements; smoothness 2: 40, 40 and 20.
    check(`projectile: the live counts -- s1 30/30/30, s2 40/40/20 (got ${l1.steps}/${l1.flightDecs}/${l1.drawDecs}, ${l2.steps}/${l2.flightDecs}/${l2.drawDecs})`,
      l1.steps === 30 && l1.flightDecs === 30 && l1.drawDecs === 30 && l2.steps === 40 && l2.flightDecs === 40 && l2.drawDecs === 20)
    const last = mk({ projActive: 1, reloadCooldown: 1 })
    projectileDrawTick(last)
    check('projectile: 8712 taking the cooldown to 0 clears projActive (87EC)', last.reloadCooldown === 0 && last.projActive === 0)
    const idle = mk({ projActive: 1, reloadCooldown: 0 })
    projectileDrawTick(idle)
    check('projectile: 7D14 skips 8712 at cooldown 0 (no draw, no underflow)', idle.reloadCooldown === 0 && idle._projDraw === null)
  }
}

/**
 * Puffs and splashes (`DrawWheelEffectPuffs 1000:8083`, `FUN_1000_8386 1000:8386`), docs/engine.md
 * §9q -- resolves UNKNOWN_puff_slot_fields. `engine/puffs.js` is exercised directly with synthetic
 * cars; no reference frame exists for these (cosmetic effects, no live capture available).
 */
async function checkPuffsAndSplashes() {
  const { updatePuffsAndSplashes, PUFF_SET } = await import('../src/engine/puffs.js')
  const mkCar = (over) => ({
    posX: 1000, posY: 1000, heading: 0, velX: 1, velY: 0,
    puffSrcSkid: 0, puffSrcWet: 0, splashTrigger: 0,
    puffOffA: -30, puffOffB: 20, puffOffC: 30, puffOffD: -20,
    puffSlotCursor: 0, splashSlotCursor: 0, puffCooldown: 0, splashCooldown: 0,
    lowGripTimerA: 0, lowGripTimerB: 0,
    puffSlots: Array.from({ length: 8 }, () => ({ frame: -1 })),
    splashSlots: Array.from({ length: 5 }, () => ({ frame: -1 })),
    ...over,
  })

  // (a) wet trigger spawns into slot 0 first, clears the trigger flag, sets source, gives both
  // spawn points real (nonzero-offset) coordinates -- resolving UNKNOWN_puff_slot_fields.
  {
    const car = mkCar({ puffSrcWet: 1 })
    updatePuffsAndSplashes(car, { round: 1 })
    check('puff spawn: uses slot 0 first', car.puffSlots[0].frame === 0)
    check('puff spawn: trigger flag cleared after spawning', car.puffSrcWet === 0)
    check('puff spawn: source recorded as WET', car.puffSlots[0].source === PUFF_SET.WET)
    check('puff spawn: xA/yA and xB/yB are two DIFFERENT points, not both left at the car position', car.puffSlots[0].xA !== car.puffSlots[0].xB || car.puffSlots[0].yA !== car.puffSlots[0].yB)
  }

  // (b) priority: mud (low-grip) beats skid beats wet when multiple triggers are set at once.
  {
    const car = mkCar({ puffSrcWet: 1, puffSrcSkid: 1, lowGripTimerA: 5 })
    updatePuffsAndSplashes(car, { round: 1 })
    check('puff priority: low-grip/mud wins over skid and wet', car.puffSlots[0].source === PUFF_SET.MUD)
    check('puff priority: the OTHER triggers are left set (not consumed this tick)', car.puffSrcWet === 1 && car.puffSrcSkid === 1)
  }
  {
    const car = mkCar({ puffSrcWet: 1, puffSrcSkid: 1 })
    updatePuffsAndSplashes(car, { round: 1 })
    check('puff priority: skid beats wet', car.puffSlots[0].source === PUFF_SET.SKID)
  }

  // (c) the slot-cursor skip-0 quirk (1000:82ab), ported bug-for-bug: after cycling through all 8
  // slots once, the cursor lands on 1, not 0 -- slot 0 is used exactly once, ever.
  {
    const car = mkCar({})
    for (let i = 0; i < 8; i++) {
      car.puffSrcWet = 1
      car.puffCooldown = 0
      updatePuffsAndSplashes(car, { round: 1 })
    }
    check('puff cursor: slot 0 was used on the very first spawn', car.puffSlots[0].frame !== -1)
    check(`puff cursor: after a full 8-slot cycle, it's back on slot 1, not 0 (${car.puffSlotCursor})`, car.puffSlotCursor === 1)
  }

  // (d) animation: frame only advances while cooldown<=0, and expires to -1 at frame 8.
  {
    const car = mkCar({ puffSrcWet: 1 })
    updatePuffsAndSplashes(car, { round: 1 }) // spawns at frame 0, cooldown reset to 3
    check('puff animation: freshly spawned slot does not advance in the same call', car.puffSlots[0].frame === 0)
    for (let i = 1; i < 8; i++) {
      car.puffCooldown = 0 // every expiry re-arms [12B2]=3 (8125); airborne.js counts it back down
      updatePuffsAndSplashes(car, { round: 1 })
      check(`puff animation: frame advances to ${i} while cooldown<=0`, car.puffSlots[0].frame === i)
    }
    car.puffCooldown = 0
    updatePuffsAndSplashes(car, { round: 1 })
    check('puff animation: expires to -1 past frame 8', car.puffSlots[0].frame === -1)
  }

  // (e) splashes: same shape, 5-slot ring, skip-slot-0 quirk (1000:842a), 5-frame expiry.
  {
    const car = mkCar({ splashTrigger: 1 })
    updatePuffsAndSplashes(car, { round: 2 })
    check('splash spawn: uses slot 0 first', car.splashSlots[0].frame === 0)
    check('splash spawn: trigger flag cleared', car.splashTrigger === 0)
    check('splash spawn: records the car\'s own position', car.splashSlots[0].x === car.posX && car.splashSlots[0].y === car.posY)
  }
  {
    const car = mkCar({})
    for (let i = 0; i < 5; i++) {
      car.splashTrigger = 1
      car.splashCooldown = 0
      updatePuffsAndSplashes(car, { round: 2 })
    }
    check(`splash cursor: after a full 5-slot cycle, it's back on slot 1, not 0 (${car.splashSlotCursor})`, car.splashSlotCursor === 1)
    check('splash spawn: always into slot 0 (8410-8418, no cursor); slots 1-4 stay empty', car.splashSlots.slice(1).every((sl) => sl.frame === -1))
  }

  // (f) the real order inside 8083 (docs/engine.md §9ch): on an expired cooldown the live frames
  // advance FIRST (80F5), [12B2]=3 is set whether or not anything spawns (8125), then the spawn.
  {
    const car = mkCar({ puffSrcWet: 1 })
    updatePuffsAndSplashes(car, { round: 1 }) // slot 0 at frame 0
    for (let i = 0; i < 3; i++) { car.puffSrcWet = 1; car.puffCooldown = 0; updatePuffsAndSplashes(car, { round: 1 }) }
    check('puff: a continuous trigger still animates the older puffs (advance before spawn, 80F5)', car.puffSlots[0].frame === 3 && car.puffSlots[3].frame === 0)
    const idle = mkCar({})
    updatePuffsAndSplashes(idle, { round: 1 })
    check('puff: an expired cooldown is re-armed to 3 even when nothing spawns (8125)', idle.puffCooldown === 3 && idle.puffSlots.every((sl) => sl.frame === -1))
    const stopped = mkCar({ lowGripTimerA: 5, velX: 0, velY: 0, puffSrcSkid: 1 })
    updatePuffsAndSplashes(stopped, { round: 1 })
    check('puff: low grip on a stopped car spawns nothing and tries no other trigger (8151)', stopped.puffSlots.every((sl) => sl.frame === -1) && stopped.puffSrcSkid === 1)
  }
  // (g) the splash frames advance on the PUFF cooldown [12B2] (83CB), not [12B4].
  {
    const car = mkCar({ splashTrigger: 1 })
    updatePuffsAndSplashes(car, { round: 2 }) // spawn, [12B4]=6
    car.puffCooldown = 0; car.splashCooldown = 5
    updatePuffsAndSplashes(car, { round: 2 })
    check('splash: advances when [12B2] expires even with [12B4] still running (83CB)', car.splashSlots[0].frame === 1)
    car.puffCooldown = 2; car.splashCooldown = 0
    updatePuffsAndSplashes(car, { round: 2 })
    check('splash: does not advance while [12B2] runs, whatever [12B4] says', car.splashSlots[0].frame === 1)
  }
  // (h) round 2's spray angle uses the offset from BEFORE this spawn's oscillation step (8186-8194).
  {
    const { SINE8 } = await import('../src/data/engine-tables.js')
    const car = mkCar({ puffSrcWet: 1, heading: 0x40, puffOffA: 10, puffOffB: 20 })
    updatePuffsAndSplashes(car, { round: 2 })
    const angle = (0x40 + 10 + 0x80) & 0xff
    check('puff: the round-2 spray uses the pre-step offset, then steps it', car.puffSlots[0].xA === 1000 + (SINE8[angle] >> 4) && car.puffOffA === 30 && car.puffOffB === -20)
    const flat = mkCar({ puffSrcWet: 1, heading: 0x40, puffOffA: 10 })
    updatePuffsAndSplashes(flat, { round: 1 })
    check('puff: outside round 2 the spray is heading-0x1E / +0x1E (8181/8221)', flat.puffSlots[0].xA === 1000 + (SINE8[(0x40 - 0x1e + 0x80) & 0xff] >> 4) && flat.puffOffA === 10)
  }
  // (i) the spawn point's own asymmetric wrap (81CB-81ED): Y wraps only at <= -0xC.
  {
    const car = mkCar({ puffSrcWet: 1, posX: 100, posY: 2, heading: 0x80 })
    updatePuffsAndSplashes(car, { round: 1 })
    const ys = [car.puffSlots[0].yA, car.puffSlots[0].yB]
    check('puff: a spawn point a few px above y=0 stays negative (Y wraps only at <= -0xC)', ys.some((y) => y < 0 && y > -0xc))
  }
}

/**
 * Render-side integration check for projectiles/puffs/splashes (docs/engine.md §9q) -- an
 * advisor-caught gap: `checkProjectiles`/`checkPuffsAndSplashes` above exercise only the ENGINE
 * half (fire/flight/hit, spawn/animate); nothing had ever called `composeRaceView` with an active
 * shot or a live puff/splash slot, so `drawProjectile`/`drawPuffsAndSplashes`/`ph0TailIcon`/
 * `ph0PuffFrame`/`ph0Round2SplashFrame` and the post-rename `xA/yA/xB/yB` field reads had never
 * actually executed. Uses the real BITSFILE.PH0 so a wrong `PH0_LAYOUT` offset reads garbage bytes
 * (still no throw) rather than silently succeeding against a fake buffer -- the pixel-diff check is
 * what would actually catch a wrong-but-in-bounds offset.
 */
async function checkProjectileAndPuffRendering() {
  const { composeRaceView } = await import('../src/render/raceView.js')
  const { decompress } = await import('../src/formats/lz.js')
  const { WORLD_TILES } = await import('../src/formats/race.js')
  const { RELOAD_TOTAL } = await import('../src/engine/projectile.js')
  const ph0 = decompress(new Uint8Array(readFileSync(join(GAME, 'BITSFILE.PH0'))))

  const view = { w: 64, h: 64 }
  const camera = { x: 968, y: 968 } // centres world (1000,1000) in a 64x64 window
  const words = new Uint16Array(WORLD_TILES * WORLD_TILES) // all zero -- tileCount(bank)=0 keeps the tile layer inert, isolating the car-layer effect
  const bank = new Uint8Array(0)

  const bareCar = { posX: 1000, posY: 1000, heading: 0, height: 0 }
  const emptySlots = () => ({ puffSlots: Array.from({ length: 8 }, () => ({ frame: -1 })), splashSlots: Array.from({ length: 5 }, () => ({ frame: -1 })) })
  const quietCar = { ...bareCar, projActive: 0, ...emptySlots() }
  const activeCar = {
    ...bareCar,
    projActive: 1, projX: 1000, projY: 1000, reloadCooldown: 50, projStepsA: 3, projStepsB: -2,
    puffSlots: [
      { frame: 0, source: 0, xA: 995, yA: 1000, xB: 1005, yB: 1000 },
      { frame: 3, source: 1, xA: 990, yA: 995, xB: 1010, yB: 1005 },
      ...Array.from({ length: 6 }, () => ({ frame: -1 })),
    ],
    splashSlots: [{ frame: 2, x: 1000, y: 990 }, ...Array.from({ length: 4 }, () => ({ frame: -1 }))],
  }
  // Isolated per-effect variants: each turns on ONLY one of {projectile, puffs, splash} against an
  // otherwise-quiet car, so a bug confined to one draw path can't hide behind pixels the other two
  // paths still put on the buffer (a real gap the first draft of this check had -- a corrupted puff
  // field went undetected because the projectile's own trail still made the combined buffer differ).
  const projOnlyCar = { ...quietCar, projActive: 1, projX: 1000, projY: 1000, reloadCooldown: 50, projStepsA: 3, projStepsB: -2 }
  const puffsOnlyCar = { ...quietCar, puffSlots: activeCar.puffSlots }
  const splashOnlyCar = { ...quietCar, splashSlots: activeCar.splashSlots }

  const render = (car) => composeRaceView({ words, bank, camera, cars: [car], view, ph0 }).indexed
  const differs = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return true; return false }

  let threw = null
  const quietBuf = render(quietCar)
  try {
    check('composeRaceView: projectile-only draws (differs from quiet)', differs(render(projOnlyCar), quietBuf))
    check('composeRaceView: puffs-only draws (differs from quiet)', differs(render(puffsOnlyCar), quietBuf))
    check('composeRaceView: splash-only draws (differs from quiet)', differs(render(splashOnlyCar), quietBuf))
    check('composeRaceView: all three combined still don\'t throw', !!render(activeCar))
    // 847E: the 32x32 splash is drawn at pos-cam-12 (8486/8489), not -16.
    const { ph0Round2SplashFrame } = await import('../src/formats/race.js')
    const raw = ph0Round2SplashFrame(ph0, 2).indexed
    let fx = 99, fy = 99
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) if (raw[y * 32 + x]) { fx = Math.min(fx, x); fy = Math.min(fy, y) }
    const sb = render(splashOnlyCar)
    let mx = 99, my = 99
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) if (sb[y * 64 + x] !== quietBuf[y * 64 + x]) { mx = Math.min(mx, x); my = Math.min(my, y) }
    check(`composeRaceView: the splash sits at pos-cam-12 (847E), got (${mx - fx},${my - fy})`, mx - fx === 1000 - 968 - 12 && my - fy === 990 - 968 - 12)
  } catch (e) {
    threw = e
  }
  check(`composeRaceView with active effects doesn't throw (${threw?.message ?? 'ok'})`, !threw)

  // Also exercise drawProjectile's other two live branches: the impact-puff tail
  // (IMPACT_FLOOR <= reloadCooldown <= FLIGHT_THRESHOLD) and the tail-icon swap (elapsed >= 2).
  const impactCar = { ...quietCar, projActive: 1, projX: 1000, projY: 1000, reloadCooldown: 0x1e, projStepsA: 0, projStepsB: 0 }
  const lateTailCar = { ...quietCar, projActive: 1, projX: 1000, projY: 1000, reloadCooldown: RELOAD_TOTAL - 3, projStepsA: 1, projStepsB: 1 }
  for (const [label, car] of [['impact-puff branch', impactCar], ['late tail-icon-swap branch', lateTailCar]]) {
    let err = null
    try { composeRaceView({ words, bank, camera, cars: [car], view, ph0 }) } catch (e) { err = e }
    check(`composeRaceView: ${label} doesn't throw (${err?.message ?? 'ok'})`, !err)
  }

  // `drawPauseBanner`: draws the centred "Paused!" banner (slot 5), only when composeRaceView is
  // told `paused: true` and a `ph0` was actually given.
  {
    const unpaused = composeRaceView({ words, bank, camera, cars: [quietCar], view, ph0, paused: false }).indexed
    const pausedBuf = composeRaceView({ words, bank, camera, cars: [quietCar], view, ph0, paused: true }).indexed
    check('composeRaceView: paused=true draws the banner (differs from unpaused)', differs(pausedBuf, unpaused))
    const pausedNoPh0 = composeRaceView({ words, bank, camera, cars: [quietCar], view, paused: true }).indexed
    check('composeRaceView: paused=true with no ph0 is a safe no-op (no throw, matches unpaused)', !differs(pausedNoPh0, unpaused))
  }

  // Regression pin for UNKNOWN_pause_banner_position (resolved 2026-09-23, docs/engine.md §9q): the
  // check just above only proves "some pixel changed", which can't tell y=48 (the disassembly-derived
  // real offset, MICROU.EXE 1000:3766/9293) apart from the old y=89 symmetric-centre guess or any
  // other value -- both would pass it identically. Render at the real 256x200 view and pin the exact
  // row band the banner lands on, so a future revert of that fix fails loudly here instead of only
  // being re-derivable by re-reading the disassembly.
  {
    const realView = { w: 256, h: 200 }
    const unpaused = composeRaceView({ words, bank, camera, cars: [quietCar], view: realView, ph0, paused: false }).indexed
    const pausedBuf = composeRaceView({ words, bank, camera, cars: [quietCar], view: realView, ph0, paused: true }).indexed
    let first = -1, last = -1
    for (let row = 0; row < realView.h; row++) {
      const start = row * realView.w
      for (let i = start; i < start + realView.w; i++) {
        if (unpaused[i] !== pausedBuf[i]) { if (first === -1) first = row; last = row; break }
      }
    }
    check(`composeRaceView: "Paused!" banner draws at real screen rows 48-68 (got ${first}-${last})`, first === 48 && last === 68)
  }
}

/**
 * `UNKNOWN_car_draw_anchor` resolved 2026-09-23 (docs/engine.md §9d/§10, `[STATIC]` by disassembly
 * of `DrawCarBodyRotatedRemapped 1000:7d73` / `DrawCarShadowSilhouette 1000:7e5c`): the anchor
 * formula itself (`dx-half-z` body, `dx-half+z` shadow, half=size>>1) matched this port's prior
 * guess exactly, so there is nothing to pin for that part. Two real, adjacent divergences the same
 * disassembly pass found DO need teeth: round 8 (CHOPPERS) forces z=0 and skips the shadow
 * entirely (`7d85`/`7e77`), and height is never clamped to >=0 in the real draw (a bounce-landing
 * tick can leave it briefly negative, and both functions use the raw signed value). This check
 * renders against a solid background tile (so a shadow's colour-0 paint is visible against it, not
 * indistinguishable from the buffer's own zero-initialised background) and pins exact pixels that
 * only make sense under the NEW formula -- run against `raceView.js` as it stood before this pass
 * (`Math.max(0,height)` unconditionally, no `round` parameter at all), every check below fails.
 */
async function checkCarDrawAnchor() {
  const { composeRaceView } = await import('../src/render/raceView.js')
  const { TILE, TILE_BYTES, WORLD_TILES } = await import('../src/formats/race.js')

  const BG = 9, BODY = 7, SHADOW = 0
  const view = { w: 64, h: 64 }
  const camera = { x: 968, y: 968 } // car at (1000,1000) => dx=dy=32, the view's centre
  const bank = new Uint8Array(TILE_BYTES).fill(BG) // one opaque tile, so shadow-paints-0 is visible
  const words = new Uint16Array(WORLD_TILES * WORLD_TILES) // every cell -> tile 0 (the one above)
  const size = 24
  // `frames[i]` entries are raw indexed Uint8Arrays (formats/race.js's `vehicleFrames`), NOT
  // {width,height,indexed} wrapper objects -- drawCarBody/drawCarShadow build that wrapper
  // themselves around `size` at the blit call site.
  const solidFrame = new Uint8Array(size * size).fill(BODY)
  const frames = Array.from({ length: 32 }, () => solidFrame)
  const px = (buf, x, y) => buf[y * view.w + x]

  // (a) round 8 (CHOPPERS): z forced to 0, shadow never drawn, even though height=8 (airborne).
  {
    const car = { posX: 1000, posY: 1000, heading: 0, height: 8, colourOffset: 0 }
    const buf = composeRaceView({ words, bank, camera, frames, vehicleSize: size, cars: [car], view, round: 8 }).indexed
    // Old formula (z=8 always) would put the body's near-left-corner pixel here; the real,
    // z-suppressed body starts 8px further right/down, so this must be plain background.
    check(`round 8: body z suppressed, (12,12) is background not body (got ${px(buf, 12, 12)})`, px(buf, 12, 12) === BG)
    // Old formula would draw the shadow spanning [28,52); a pixel in that span but outside the
    // real (z=0) body's [20,44) span must stay background if the shadow is truly suppressed.
    check(`round 8: no shadow at all, (46,46) is background not shadow (got ${px(buf, 46, 46)})`, px(buf, 46, 46) === BG)
    // Sanity: the body itself is still drawn, just unshifted.
    check(`round 8: body still drawn at the unshifted anchor, (30,30) is body (got ${px(buf, 30, 30)})`, px(buf, 30, 30) === BODY)
  }

  // (a2) DrawRaceCarLayer 7CE0's four passes (docs/engine.md §9ci): every shadow is painted before
  // any body, so car 1's shadow landing on car 0 does not cover car 0's body.
  {
    const ground = { posX: 1000, posY: 1000, heading: 0, height: 0, colourOffset: 0 }
    const flyer = { posX: 986, posY: 986, heading: 0, height: 14, colourOffset: 0 } // shadow at +z = (1000,1000), body at -z, clear of car 0
    const buf = composeRaceView({ words, bank, camera, frames, vehicleSize: size, cars: [ground, flyer], view, round: 1 }).indexed
    check(`paint order: car 1's shadow does not cover car 0's body (7CE3 before 7D2B), (32,32) is body (got ${px(buf, 32, 32)})`, px(buf, 32, 32) === BODY)
  }

  // (b) a normal round (not 8) with the SAME airborne car: z applies to both layers as before.
  {
    const car = { posX: 1000, posY: 1000, heading: 0, height: 8, colourOffset: 0 }
    const buf = composeRaceView({ words, bank, camera, frames, vehicleSize: size, cars: [car], view, round: 1 }).indexed
    check(`round 1: body shifted by -z, (12,12) is body (got ${px(buf, 12, 12)})`, px(buf, 12, 12) === BODY)
    check(`round 1: shadow shifted by +z, (46,46) is shadow (got ${px(buf, 46, 46)})`, px(buf, 46, 46) === SHADOW)
  }

  // (c) a briefly-negative height (docs/engine.md §3's bounce-landing tick): both functions must
  // use the raw signed value, not clamp to 0 -- and the shadow must still draw (height != 0, not
  // height > 0).
  {
    const car = { posX: 1000, posY: 1000, heading: 0, height: -6, colourOffset: 0 }
    const buf = composeRaceView({ words, bank, camera, frames, vehicleSize: size, cars: [car], view, round: 1 }).indexed
    // Old formula clamped z to 0 (Math.max(0,-6)), so the body sat at the unshifted [20,44) span
    // and the shadow was skipped outright (height<=0 gate) -- (16,16) and (48,48) were background.
    check(`negative z: shadow still drawn (height!=0), (16,16) is shadow (got ${px(buf, 16, 16)})`, px(buf, 16, 16) === SHADOW)
    check(`negative z: body uses the raw (unclamped) height, (48,48) is body (got ${px(buf, 48, 48)})`, px(buf, 48, 48) === BODY)
  }
}

/**
 * `UNKNOWN_car_draw_wrap_asymmetry` fix (docs/engine.md §9d, M3.44): the real `7d73`/`7e5c` fold
 * the camera-relative delta with a ONE-SIDED `+0xC00` correction (only when the raw delta is at or
 * below a small negative threshold), not a symmetric `wrapDelta`. A car whose raw
 * `posX-height-camX` is a large POSITIVE value near `WORLD_PX` (i.e. genuinely adjacent to the
 * camera only via the toroidal wrap, approached from the positive side) never crosses that
 * negative-side threshold in the real game, so it is never folded back on screen -- unlike this
 * port's old `wrapDelta`, which folded ANY value past half the world width, drawing a car the real
 * game leaves off-screen. `camX=0`, `posX=3065` puts the raw delta at 3065, squarely in that
 * disagreement window (the real game's own threshold is -12; `wrapDelta` would fold 3065 to -7).
 */
async function checkCarDrawWrapSeam() {
  const { composeRaceView } = await import('../src/render/raceView.js')
  const { TILE_BYTES, WORLD_TILES } = await import('../src/formats/race.js')

  const BG = 9, BODY = 7, SHADOW = 0
  const view = { w: 64, h: 64 }
  const bank = new Uint8Array(TILE_BYTES).fill(BG)
  const words = new Uint16Array(WORLD_TILES * WORLD_TILES)
  const size = 24
  const solidFrame = new Uint8Array(size * size).fill(BODY)
  const frames = Array.from({ length: 32 }, () => solidFrame)
  const px = (buf, x, y) => buf[y * view.w + x]

  // Body: camX=0 (posY=camY, so only the X axis is near the seam). The old `wrapDelta`-based
  // formula placed the body's visible sliver at x∈[0,5)/y∈[0,12) (dx=-19, dy=-12) -- (2,6) was
  // BODY. The real, unfolded reading leaves the sprite thousands of px off-screen: (2,6) must stay
  // background.
  {
    const car = { posX: 3065, posY: 500, heading: 0, height: 0, colourOffset: 0 }
    const camera = { x: 0, y: 500 }
    const buf = composeRaceView({ words, bank, camera, frames, vehicleSize: size, cars: [car], view, round: 2 }).indexed
    check(`wrap seam, body: real game leaves this off-screen, (2,6) is background not body (got ${px(buf, 2, 6)})`, px(buf, 2, 6) === BG)
  }

  // Shadow, with a genuine nonzero height (z=5) so the shadow's own +z fold is exercised (its body
  // counterpart lands fully off this 64px canvas either way, so it can't interfere with this pixel).
  {
    const car = { posX: 3060, posY: 500, heading: 0, height: 5, colourOffset: 0 }
    const camera = { x: 0, y: 500 }
    const buf = composeRaceView({ words, bank, camera, frames, vehicleSize: size, cars: [car], view, round: 1 }).indexed
    check(`wrap seam, shadow: real game leaves this off-screen too, (2,8) is background not shadow (got ${px(buf, 2, 8)})`, px(buf, 2, 8) === BG)
  }

  // Sanity control: the SAME fold logic still draws a car that is genuinely close to the camera in
  // raw (non-wrapped) terms -- this fix must not have broken the ordinary on-screen case.
  {
    const car = { posX: 500, posY: 500, heading: 0, height: 0, colourOffset: 0 }
    const camera = { x: 468, y: 468 } // dx=dy=32, view centre
    const buf = composeRaceView({ words, bank, camera, frames, vehicleSize: size, cars: [car], view, round: 2 }).indexed
    check(`wrap seam control: an ordinary on-screen car still draws, (32,32) is body (got ${px(buf, 32, 32)})`, px(buf, 32, 32) === BODY)
  }

  // Round 8's rotor (`7e4f`, called only after the body's own clip test passes IN THE SAME CALL,
  // `7e28 JC 7e54` jumps past both together) must not float on its own once the body it rides along
  // with is correctly off-screen. `drawRotor` still computes its own position via the old symmetric
  // wrapDelta (not fixed here, out of this item's scope) at a LARGER 32x32 box (`dx-16`) than the
  // body's own 24x24 clip box (`dx-12`) -- an 8px total / 4px-per-edge difference that lets the
  // rotor's box still overlap the screen for a few px after the body's own clip test has already
  // failed. Gated on a FRESH per-render clip test (`drawCarBody`'s own return value), not the
  // separate, state-gated `car.drawnThisFrame` sticky flag (reusing that flag would itself have been
  // wrong -- a stale value from a tick this state didn't call `markDrawn` at all -- not merely a
  // coincidental mismatch found while re-measuring reachability, docs/engine.md §9d).
  {
    const ROTOR = 3
    const rotorFrames = Array.from({ length: 5 }, () => ({ width: 32, height: 32, indexed: new Uint8Array(32 * 32).fill(ROTOR) }))
    // delta = posX-camX = 9-20 = -11: body's own clip test passes (v=-11-12=-23, axisIn -23+24=1>0)
    // -- the rotor should draw normally alongside it.
    const onCar = { posX: 9, posY: 500, heading: 0, height: 0, colourOffset: 0, state: 0, rotorFrame: 0 }
    const onCamera = { x: 20, y: 500 }
    const onBuf = composeRaceView({ words, bank, camera: onCamera, frames, vehicleSize: size, rotorFrames, cars: [onCar], view, round: 8 }).indexed
    // But 843D's own fold is on pos - camera - 4 (docs/engine.md §9cb): -11 - 4 = -15 <= -12 folds
    // the rotor by +0xC00, 3072px away -- the body draws at the edge, its rotor doesn't. (Corrected:
    // this check used to assert the rotor draws here, from the old symmetric wrapDelta.)
    check('rotor fold, delta=-11: the body draws at the edge but 843D folds the rotor away', onBuf.includes(BODY) && !onBuf.includes(ROTOR))
    const edgeCar = { posX: 13, posY: 500, heading: 0, height: 0, colourOffset: 0, state: 0, rotorFrame: 0 } // delta -7: -11 > -12, no fold
    const edgeBuf = composeRaceView({ words, bank, camera: onCamera, frames, vehicleSize: size, rotorFrames, cars: [edgeCar], view, round: 8 }).indexed
    check('rotor fold, delta=-7: no fold, the rotor draws at the edge with its body', edgeBuf.includes(ROTOR))

    // delta = posX-camX = 6-20 = -14: body's own clip test now fails (v=-14-12=-26, -26+24=-2, not
    // >0) -- but the OLD ungated rotor's own larger box (dx-16=-30, spans [-30,2)) still shows a 2px
    // sliver with no body under it. The fix must suppress this.
    const sliverCar = { posX: 6, posY: 500, heading: 0, height: 0, colourOffset: 0, state: 0, rotorFrame: 0 }
    const sliverCamera = { x: 20, y: 500 }
    const sliverBuf = composeRaceView({ words, bank, camera: sliverCamera, frames, vehicleSize: size, rotorFrames, cars: [sliverCar], view, round: 8 }).indexed
    check('rotor gate, delta=-14: body clip fails, no rotor sliver drawn with no body under it', !sliverBuf.includes(ROTOR) && !sliverBuf.includes(BODY))

    // The two-car hidden-loser car (`[2621]`, `7D74`): 7D73 jumps to 7E54 before the clip test, the
    // body draw, OR the rotor call even run -- an on-screen car hidden this way must show neither.
    const hiddenCar = { posX: 500, posY: 500, heading: 0, height: 0, colourOffset: 0, state: 0, rotorFrame: 0 }
    const hiddenCamera = { x: 468, y: 468 }
    const hiddenBuf = composeRaceView({ words, bank, camera: hiddenCamera, frames, vehicleSize: size, rotorFrames, cars: [hiddenCar], view, round: 8, hud: { twoCar: { hiddenCarLayer: 0 } } }).indexed
    check('rotor gate, hidden two-car loser: neither body nor rotor draws, though on-screen', !hiddenBuf.includes(ROTOR) && !hiddenBuf.includes(BODY))
  }

  // Round 9's own threshold (-4) is a genuinely independent literal from the normal path's (-12),
  // NOT derived from its own 40x40 half (-20) -- confirmed by disassembling `7dc8`/`7e9d` directly.
  // At delta=-10 (still within the normal path's -12 fold-free zone but past round 9's -4), the
  // real round-9 box is already folded away and off-screen; if this port mistakenly reused -12 for
  // round 9 it would still show a 10px strip (delta-20=-30, -30+40=10>0).
  {
    const size9 = 40
    const solidFrame9 = new Uint8Array(size9 * size9).fill(BODY)
    const frames9 = Array.from({ length: 32 }, () => solidFrame9)
    const car = { posX: 0, posY: 500, heading: 0, height: 0, colourOffset: 0 }
    const camera = { x: 10, y: 500 } // delta = posX-camX = -10
    const buf = composeRaceView({ words, bank, camera, frames: frames9, vehicleSize: size9, cars: [car], view, round: 9 }).indexed
    check('round 9 threshold -4 (not -12): delta=-10 is already folded away, no body pixels drawn', !buf.includes(BODY))
  }
}

/**
 * Reachability for `UNKNOWN_car_draw_wrap_asymmetry`'s fix (docs/engine.md §9d, M3.44): does the
 * body fold change ever fire in a real, AI-driven race, and does the round-8 rotor gate? (The
 * shadow shares the identical formula but isn't separately swept here.)
 * Runs every round/race in both formats for 8000 steps each with a real spawn/camera/AI loop,
 * comparing the OLD symmetric-`wrapDelta` formula against the NEW `viewCoord` one directly on each
 * drawn car's real per-tick `posX/posY/height` and the REAL, camera.js-converged `camera.x/y`.
 * Earlier attempts at this were wrong, caught in review or by a self-check, before being trusted:
 * (1) manually calling
 * `updateCamera` after `runStep` double-updated the camera (`runStep` already calls it internally
 * via `ctx.camera`, `step.js:333`), silently halving its real lag and understating how close to the
 * world seam it could get; (2) comparing the OLD formula (hand-computed against a 200-row window)
 * against `car.drawnThisFrame` (the real 224-row window `8bab` uses) produced ~1914 spurious
 * "disagreements" -- first wrongly blamed on `markDrawn`'s own per-state invocation cadence being
 * bypassed by calling it externally, an unverified guess corrected by re-running with the SAME
 * window on both sides (exactly 0): the 200-vs-224 mismatch alone was the whole explanation, not
 * anything about when `markDrawn` runs. (3) The rotor's own OLD visibility was then compared against
 * the REAL 256x224 window instead of the 200-row canvas it actually paints onto, reporting 137 --
 * the SAME 200-vs-224 mistake as (2), just moved to a different pair of formulas; re-deriving the
 * predicate from the real control flow (the gate only decides whether `drawRotor` is CALLED --
 * once called, it still draws at its own unfixed `wrapDelta` position, clipped by the real 200-row
 * canvas exactly as before, so `oldR` must be AND'ed into `newR`, not replaced by a different
 * window) gave 71, self-checked by an `other`-cause bucket that must be exactly 0 if the formula is
 * internally consistent.
 */
/**
 * The exact disagreement windows themselves (docs/engine.md §9d), computed by brute force over
 * every `delta` (not a hand-picked point -- that was the M3.32 counter-example's own mistake) and
 * pinned as regression-tested facts, not just described in prose.
 */
function checkCarDrawWrapWindows() {
  const WORLD_PX = 3072
  const dstW = 256
  const wrap = (v, m) => ((v % m) + m) % m
  const wrapDelta = (d, m) => { const r = wrap(d, m); return r > m / 2 ? r - m : r }
  const oldVis = (delta, half) => { const v = wrapDelta(delta, WORLD_PX) - half; return v + half * 2 > 0 && v < dstW }
  const newVis = (delta, threshold, half) => { const v = viewCoord(delta, threshold, half); return v + half * 2 > 0 && v < dstW }
  function windows(threshold, half) {
    const out = []
    let start = null
    for (let delta = -40; delta <= WORLD_PX - 1; delta++) {
      const disagree = oldVis(delta, half) !== newVis(delta, threshold, half)
      if (disagree && start === null) start = delta
      else if (!disagree && start !== null) { out.push([start, delta - 1]); start = null }
    }
    if (start !== null) out.push([start, WORLD_PX - 1])
    return out
  }
  check('normal (24x24, z=0) disagreement window is exactly [3061,3071]', JSON.stringify(windows(-12, 12)) === '[[3061,3071]]')
  check('round 9 (40x40, z=0) disagreement windows are exactly [-19,-4] and [3053,3071]', JSON.stringify(windows(-4, 20)) === '[[-19,-4],[3053,3071]]')
}

async function checkCarDrawWrapReachability() {
  const ROUNDS = [1, 2, 3, 4, 5, 6, 7, 8, 9]
  const WORLD_PX = 3072
  const dstW = 256, dstH = 200
  const wrapW = (v, m) => ((v % m) + m) % m
  const wrapDelta = (d, m) => { const r = wrapW(d, m); return r > m / 2 ? r - m : r }
  const oldBodyVisible = (car, camX, camY, half, z) => {
    const dx = wrapDelta(car.posX - camX, WORLD_PX) - half - z
    const dy = wrapDelta(car.posY - camY, WORLD_PX) - half - z
    return !(dx + half * 2 <= 0 || dy + half * 2 <= 0 || dx >= dstW || dy >= dstH)
  }
  const newBodyVisible = (car, camX, camY, threshold, half, z) => {
    const dx = viewCoord(car.posX - z - camX, threshold, half)
    const dy = viewCoord(car.posY - z - camY, threshold, half)
    return !(dx + half * 2 <= 0 || dy + half * 2 <= 0 || dx >= dstW || dy >= dstH)
  }
  // The rotor's own OLD visibility: `drawRotor` (unfixed, out of this item's own scope) blits at
  // its own `wrapDelta`-based position with NO gate at all, so its old visibility is exactly whether
  // its 32x32 box overlaps THIS render canvas -- 256x200, the same canvas `oldBodyVisible` uses, not
  // the real 256x224 clip window (that window belongs only to the NEW gate decision below).
  const oldRotorVisible = (car, camX, camY) => {
    const dx = wrapDelta(car.posX - camX, WORLD_PX) - 16
    const dy = wrapDelta(car.posY - camY, WORLD_PX) - 16
    return !(dx + 32 <= 0 || dy + 32 <= 0 || dx >= dstW || dy >= dstH)
  }

  let camMinX = Infinity, camMaxX = -Infinity, camMinY = Infinity, camMaxY = -Infinity
  let bodyChecks = 0, bodyDisagree = 0
  let rotorChecks = 0, rotorDisagree = 0
  const rotorCause = { clip: 0, noDrawBody: 0, hidden: 0, other: 0 }
  // Exposure counters (pitfall: "forcing X off changes nothing" proves nothing if X was never true
  // -- PLAN.md §8, "a hold-state test proves nothing if the held state never actually occurs"):
  // how many round-8 ticks actually had `hidden` or a states-1/4/5 table-tick-only frame at all,
  // split by whether `oldR` was also true (the only way either could have produced a visible
  // disagreement). The states-1/4/5 counter is scoped to states 1/4/5 specifically -- `!anim.drawBody`
  // ALONE also fires for ordinary state-2/0xD knockout ticks (already excluded by `eligible`), which
  // would make this counter measure knockouts instead of the thing it's meant to measure; caught
  // before trusting an early draft that used the unscoped check.
  let hiddenExposure = 0, hiddenExposureOldRTrue = 0, hiddenExposureIneligible = 0
  let noDrawBody145Exposure = 0, noDrawBody145ExposureOldRTrue = 0
  let r9Checks = 0, r9MinAbsDelta = Infinity

  for (const raceFormat of [1, 2]) {
    for (const round of ROUNDS) {
      for (const race of [1, 2, 3]) {
        const strt = parseStrtPos(await read('GAME1/STRT_POS.BIN'))
        const entry = strt.find((s) => s.round === round && s.race === race)
        if (!entry) continue
        const cars = spawnCars(strt, round, race, raceFormat === 2 ? { raceFormat: 2 } : {})
        const camera = initCameraState(entry)
        const world = await loadWorld(read, round, race)
        const ctx = { ...roundCtx(round, race, raceFormat === 2 ? { raceFormat: 2 } : {}), brk: round === 9 ? undefined : await loadBrk(read, round, race), tournamentIndex: 0, world, cars, camera }
        const raceState = {}

        for (let step = 0; step < 8000 && !raceState.raceOver; step++) {
          const controls = cars.map((c) => droneControlByte(c, ctx))
          runStep(world, cars, controls, raceState, ctx) // updates ctx.camera (=== camera) internally, exactly once

          camMinX = Math.min(camMinX, camera.x); camMaxX = Math.max(camMaxX, camera.x)
          camMinY = Math.min(camMinY, camera.y); camMaxY = Math.max(camMaxY, camera.y)

          for (const [i, car] of cars.entries()) {
            if ((car.active ?? 1) === 0 || (car.present ?? 1) === 0) continue
            const z = round === 8 ? 0 : (car.height ?? 0)
            const half = round === 9 ? 20 : 12
            const threshold = round === 9 ? -4 : -12
            const ov = oldBodyVisible(car, camera.x, camera.y, half, z)
            const nv = newBodyVisible(car, camera.x, camera.y, threshold, half, z)
            bodyChecks++
            if (ov !== nv) bodyDisagree++
            if (round === 9 && car === cars[0]) {
              r9Checks++
              r9MinAbsDelta = Math.min(r9MinAbsDelta, Math.abs(car.posX - z - camera.x), Math.abs(car.posY - z - camera.y))
            }
            if (round === 8) {
              rotorChecks++
              const eligible = !(car.state === 2 || car.state === 0xd)
              // Matches the OLD code's own top-level condition exactly: `if (round===8)
              // drawRotor(...)`, no gate at all beyond `drawRotor`'s own internal state-2/0xD
              // exclusion (`eligible`).
              const oldR = eligible && oldRotorVisible(car, camera.x, camera.y)
              // The GATE only controls whether `drawRotor` is even CALLED -- once called, it still
              // draws at its own unfixed `wrapDelta` position, clipped by the real 200-row canvas
              // exactly as `oldR` already checks. So the fix narrows visibility (AND's onto `oldR`),
              // it doesn't replace the check: `oldR && anim.drawBody && !hidden &&` a fresh clip test
              // against the REAL 256x224 window (`inClipWindow`, matching `drawCarBody`'s own
              // returned value). `hidden` mirrors `composeRaceView`'s own `twoCar?.hiddenCarLayer
              // === i` exactly, read from the SAME `raceState.twoCar.hiddenCarLayer` `runStep` (via
              // `step.js`'s own `m.hiddenCarLayer = m.hiddenCar`) already populates every two-car
              // tick -- this sweep DOES run two-car races (`raceFormat` loops over `[1,2]`), so this
              // is measured, not assumed absent. Dropping `oldR` was a real bug in an earlier draft
              // of this exact sweep -- caught by exactly the `other`-bucket self-check below, which
              // is why that bucket exists rather than trusting a raw disagreement count.
              const anim = carAnimationFrame(car, round)
              const hidden = raceState.twoCar?.hiddenCarLayer === i
              const clipOk = inClipWindow(car.posX - z - camera.x, car.posY - z - camera.y, threshold, half, half * 2)
              const newR = oldR && anim.drawBody && !hidden && clipOk
              if (hidden) { hiddenExposure++; if (!eligible) hiddenExposureIneligible++; else if (oldR) hiddenExposureOldRTrue++ }
              const s145 = car.state === 1 || car.state === 4 || car.state === 5
              if (s145 && !anim.drawBody) { noDrawBody145Exposure++; if (oldR) noDrawBody145ExposureOldRTrue++ }
              if (oldR !== newR) {
                rotorDisagree++
                if (hidden) rotorCause.hidden++
                else if (!clipOk) rotorCause.clip++
                else if (!anim.drawBody) rotorCause.noDrawBody++
                else rotorCause.other++
              }
            }
          }
        }
      }
    }
  }

  console.log(`  wrap reachability: camera.x in [${camMinX},${camMaxX}], camera.y in [${camMinY},${camMaxY}] of [0,${WORLD_PX}) across ${bodyChecks} car-ticks`)
  console.log(`  wrap reachability: round 9 car 0's own closest approach to its -4/-20 window over ${r9Checks} ticks: |delta|=${r9MinAbsDelta} (threshold 4)`)
  console.log(`  wrap reachability: round 8 rotor-gate disagreements ${rotorDisagree}/${rotorChecks} round-8 car-ticks (clip=${rotorCause.clip} states-1/4/5-no-body=${rotorCause.noDrawBody} hidden-two-car-loser=${rotorCause.hidden} other=${rotorCause.other})`)
  console.log(`  wrap reachability: hidden-car exposure ${hiddenExposure} ticks (${hiddenExposureIneligible} already state-2/0xD, ${hiddenExposureOldRTrue} eligible with oldR also true); states-1/4/5-no-body exposure ${noDrawBody145Exposure} ticks (${noDrawBody145ExposureOldRTrue} with oldR also true)`)
  check('wrap fix reachability: the body fold change itself fires zero times across every real race in both formats (8000 AI-driven steps each) -- NOT separately measured for the shadow, which shifts the same delta by z and was not swept here', bodyDisagree === 0)
  check('wrap fix reachability: round 9 never gets remotely close to its own -4 threshold in real play', r9Checks === 0 || r9MinAbsDelta > 20)
  check('wrap fix reachability: the round-8 rotor gate DOES change real frames (the screen-edge clip sliver is ordinary and reachable, unlike the seam fold)', rotorDisagree > 0)
  check('wrap fix reachability: every rotor-gate disagreement is explained by the clip test or the drawBody term (the formula is oldR && anim.drawBody && clipOk, so this is a consistency check on the sweep itself, not a new finding)', rotorCause.other === 0)
  check('wrap fix reachability: the hidden-car case is genuinely EXPOSED with eligible (non-2/0xD) states in this sweep, so its own zero-disagreement count is a real finding, not an artifact of never occurring or of only ever coinciding with an already-excluded knockout state', hiddenExposure - hiddenExposureIneligible > 0)
}

/**
 * Regression checks for M3.35's rotor and states-2/0xD/1/4/5 animation overlays (docs/engine.md
 * §9aj) -- an advisor review flagged that M3.34/M3.35 shipped without a single check that would
 * fail on the pre-change code. Uses distinctly-coloured synthetic frames (the same technique
 * `checkCarDrawAnchor` above already uses) so each assertion pins a real pixel outcome, not just
 * "didn't throw". A revert of any one of these (forcing `drawBody=true` unconditionally, or
 * restoring `drawRotor`'s own increment) was hand-checked to make the matching assertion fail
 * before this was considered done.
 */
async function checkAnimationOverlaysAndRotor() {
  const { composeRaceView } = await import('../src/render/raceView.js')
  const { TILE_BYTES, WORLD_TILES } = await import('../src/formats/race.js')
  const { decompress } = await import('../src/formats/lz.js')
  const { markDrawn } = await import('../src/engine/drawn.js')

  const BG = 9, BODY = 7, ROTOR = 5, KNOCKOUT = 3, BANK2 = 6
  const view = { w: 64, h: 64 }
  const camera = { x: 968, y: 968 } // car at (1000,1000) -> view centre (32,32)
  const bank = new Uint8Array(TILE_BYTES).fill(BG)
  const words = new Uint16Array(WORLD_TILES * WORLD_TILES)
  const size = 24
  const solidBody = new Uint8Array(size * size).fill(BODY)
  const frames = Array.from({ length: 32 }, () => solidBody)
  const rotorFrames = Array.from({ length: 5 }, () => ({ width: 32, height: 32, indexed: new Uint8Array(32 * 32).fill(ROTOR) }))
  const bank2 = Array.from({ length: 12 }, () => new Uint8Array(size * size).fill(BANK2))
  // A single non-zero pixel per frame, not a solid fill: the overlay draws ON TOP of the body
  // (real paint order), so a fully-opaque synthetic overlay would completely hide the very body
  // pixels these checks need to see underneath it -- caught by a first draft of this check
  // failing for the wrong reason (body pixels present, but 100% covered by an unrealistic overlay).
  const fakePh0 = new Uint8Array(0x6600)
  for (let f = 0; f < 5; f++) fakePh0[0x600 + f * 576] = KNOCKOUT // PH0_LAYOUT.knockout: 5 frames of 24x24 at +0x600
  const base = { posX: 1000, posY: 1000, heading: 0, height: 0, colourOffset: 0 }
  const contains = (buf, colour) => buf.includes(colour)

  // 1. Rotor: present in round 8 (state 0), absent in round 2 (gated on round===8), absent while
  // state 2/0xD (matching the caller-side gate `7e3a-7e48`).
  {
    const r8 = composeRaceView({ words, bank, camera, frames, vehicleSize: size, rotorFrames, cars: [{ ...base, state: 0, rotorFrame: 0 }], view, round: 8 }).indexed
    check('rotor: round 8, state 0 shows the rotor colour', contains(r8, ROTOR))
    const r2 = composeRaceView({ words, bank, camera, frames, vehicleSize: size, rotorFrames, cars: [{ ...base, state: 0, rotorFrame: 0 }], view, round: 2 }).indexed
    check('rotor: round 2 never shows the rotor colour (gated on round===8)', !contains(r2, ROTOR))
    const r8state2 = composeRaceView({ words, bank, camera, frames, vehicleSize: size, rotorFrames, cars: [{ ...base, state: 2, animTimer: 1, rotorFrame: 0 }], view, round: 8, ph0: fakePh0 }).indexed
    check('rotor: absent while state===2', !contains(r8state2, ROTOR))
    const r8stateD = composeRaceView({ words, bank, camera, frames, vehicleSize: size, rotorFrames, cars: [{ ...base, state: 0xd, animTimer: 1, rotorFrame: 0 }], view, round: 8, ph0: fakePh0 }).indexed
    check('rotor: absent while state===0xD', !contains(r8stateD, ROTOR))
  }

  // 2. Rotor counter: its only INC (8470) is inside 843D, reached only when 7D73's body clip test
  // passed (7E25), in round 8, not in state 2/0xD, and not for the hidden two-car car (7D74) --
  // so `markDrawn` (7D73's model) advances it, and rendering never does (a paused repaint must not
  // spin it, docs/engine.md §9aj/§9cb).
  {
    const car = { ...base, state: 0, rotorFrame: 0 }
    composeRaceView({ words, bank, camera, frames, vehicleSize: size, rotorFrames, cars: [car], view, round: 8 })
    composeRaceView({ words, bank, camera, frames, vehicleSize: size, rotorFrames, cars: [car], view, round: 8 })
    check('rotor: composeRaceView is pure -- rendering the same car twice does not advance rotorFrame', car.rotorFrame === 0)
    const cam = { x: 1000 - 128, y: 1000 - 100 }
    markDrawn(car, { round: 8, camera: cam })
    check('rotor: an on-screen round-8 body draw advances it (8470)', car.rotorFrame === 1)
    markDrawn(car, { round: 2, camera: cam })
    check('rotor: not in any other round (7E3A)', car.rotorFrame === 1)
    markDrawn(car, { round: 8, camera: { x: 1000 + 600, y: 1000 } })
    check('rotor: an off-screen car does not advance it (7E28 JC 7E54 skips 843D)', car.rotorFrame === 1 && car.drawnThisFrame === 0)
    markDrawn(car, { round: 8, camera: cam, drawnTick: false })
    check('rotor: not on a non-drawn tick (843D is render-only)', car.rotorFrame === 1)
    markDrawn(car, { round: 8, camera: cam, hiddenCar: car })
    check('rotor: not for the hidden two-car car (7D74 leaves before the clip test)', car.rotorFrame === 1)
    car.state = 2
    markDrawn(car, { round: 8, camera: cam })
    check('rotor: not in state 2 (7E48)', car.rotorFrame === 1)
    car.state = 0xd
    markDrawn(car, { round: 8, camera: cam })
    check('rotor: not in state 0xD (7E41)', car.rotorFrame === 1)
  }

  // 3. States 2/0xD: body visibility gate (idx = the [12B8] cursor, animStep2), asymmetric between
  // the two states, plus the knockout overlay present whenever a valid frame id applies.
  {
    const early2 = composeRaceView({ words, bank, camera, frames, vehicleSize: size, cars: [{ ...base, state: 2, animStep2: 0 }], view, round: 1, ph0: fakePh0 }).indexed // idx 0
    check('state 2, idx<3: body absent (drawBody=false)', !contains(early2, BODY))
    check('state 2, idx<3: knockout overlay present', contains(early2, KNOCKOUT))
    const late2 = composeRaceView({ words, bank, camera, frames, vehicleSize: size, cars: [{ ...base, state: 2, animStep2: 5 }], view, round: 1, ph0: fakePh0 }).indexed // idx 5
    check('state 2, idx>=3: body present (drawBody=true)', contains(late2, BODY))
    const earlyD = composeRaceView({ words, bank, camera, frames, vehicleSize: size, cars: [{ ...base, state: 0xd, animStep2: 0 }], view, round: 1, ph0: fakePh0 }).indexed // idx 0
    check('state 0xD, idx<=3: body present (drawBody=true)', contains(earlyD, BODY))
    const lateD = composeRaceView({ words, bank, camera, frames, vehicleSize: size, cars: [{ ...base, state: 0xd, animStep2: 5 }], view, round: 1, ph0: fakePh0 }).indexed // idx 5
    check('state 0xD, idx>3: body absent (drawBody=false)', !contains(lateD, BODY))
  }

  // 4. States 1/4/5 with driftSteps=0: overlay INSTEAD of body (mutually exclusive, not both).
  // driftSteps!=0: body only, no overlay.
  {
    for (const [label, state] of [['state 1 (hazard death, non-4/9 round)', 1], ['state 4 (fall)', 4], ['state 5 (crash)', 5]]) {
      const buf = composeRaceView({ words, bank, camera, frames, vehicleSize: size, bank2, cars: [{ ...base, state, animStep: 0, driftSteps: 0 }], view, round: 1 }).indexed
      check(`${label}, driftSteps=0: body absent (overlay instead)`, !contains(buf, BODY))
      check(`${label}, driftSteps=0: bank2 overlay present`, contains(buf, BANK2))
    }
    const paused1 = composeRaceView({ words, bank, camera, frames, vehicleSize: size, bank2, cars: [{ ...base, state: 1, animStep: 2, driftSteps: 5 }], view, round: 1 }).indexed
    check('state 1, driftSteps!=0: body present, no overlay', contains(paused1, BODY) && !contains(paused1, BANK2))
  }

  // 4b. Round 9's own 32-frame mirror expansion (docs/engine.md §9ak): a real, previously-live bug
  // had `vehicleFrames` skip the mirror build for round 9, leaving only the 9 stored frames -- 23
  // of the 32 heading buckets (~3/4 of all headings) then read `undefined` and the car/shadow
  // silently failed to draw. Pinned directly against `vehicleFrames`, not just "doesn't throw".
  {
    const { vehicleFrames } = await import('../src/formats/race.js')
    const vh0R9 = await read('GAME1/ROUND9BR.VH0')
    const { decompress } = await import('../src/formats/lz.js')
    const { frames: framesR9 } = vehicleFrames(decompress(vh0R9), 9)
    check('round 9: vehicleFrames returns all 32 rotation frames, not just the 9 stored ones', framesR9.length === 32 && framesR9.every((f) => f))
  }

  // 5. Round-9 fold: STATE1_ANIM_B's own frame ids (5-9) must fold to the 5-frame round-9 bank2,
  // not silently miss (a broken fold would make the overlay vanish, not throw).
  {
    const bank2R9 = Array.from({ length: 5 }, () => new Uint8Array(40 * 40).fill(BANK2))
    const framesR9 = Array.from({ length: 32 }, () => new Uint8Array(40 * 40).fill(BODY))
    const carR9 = { ...base, heading: 0x80, state: 1, animStep: 0, driftSteps: 0 } // STATE1_ANIM_B, frame id 5 -> folds to bank2[0]
    const bufR9 = composeRaceView({ words, bank, camera, frames: framesR9, vehicleSize: 40, bank2: bank2R9, cars: [carR9], view, round: 9 }).indexed
    check('round 9 fold: STATE1_ANIM_B frame id 5 (folds to 0) renders the overlay, not silently missing', contains(bufR9, BANK2))
  }

  // 6. RUFFTRUX "1 Up!"/"Failed" banner: settled top-left row is 116 (centre 128 - 12), pinned
  // exactly the same way the pause-banner regression check below pins its own row band.
  {
    const ph0Real = decompress(new Uint8Array(readFileSync(join(GAME, 'BITSFILE.PH0'))))
    const realView = { w: 256, h: 200 }
    const quiet = composeRaceView({ words, bank, camera, frames, vehicleSize: size, cars: [{ ...base, state: 0, active: 0 }], view: realView, round: 9, hud: { ph0: ph0Real, round: 9, raceFormat: 1 } }).indexed
    const settled = composeRaceView({ words, bank, camera, frames, vehicleSize: size, cars: [{ ...base, state: 0xf, active: 0, _bannerSlideY: 128 }], view: realView, round: 9, hud: { ph0: ph0Real, round: 9, raceFormat: 1 } }).indexed
    let first = -1, last = -1
    for (let row = 0; row < realView.h; row++) {
      const start = row * realView.w
      for (let i = start; i < start + realView.w; i++) { if (quiet[i] !== settled[i]) { if (first === -1) first = row; last = row; break } }
    }
    check(`RUFFTRUX banner settled top-left row is 116 (got first-differing row ${first}, last ${last})`, first === 116)
  }

  // 7. Knockout overlay anchor: uses car.knockoutX/knockoutY (the real snapshot), not car.posX/Y --
  // a car whose posX/Y has since drifted away from its knockout snapshot must still draw the
  // overlay AT the snapshot, not at the drifted live position.
  {
    const drifted = { ...base, posX: 1000, posY: 1000, knockoutX: 1000, knockoutY: 1000, state: 2, animStep2: 0 }
    const bufAtSnapshot = composeRaceView({ words, bank, camera, frames, vehicleSize: size, cars: [drifted], view, round: 1, ph0: fakePh0 }).indexed
    check('knockout overlay: draws at the snapshot when posX/Y still match it', contains(bufAtSnapshot, KNOCKOUT))
    const stale = { ...base, posX: 1030, posY: 1030, knockoutX: 1000, knockoutY: 1000, state: 2, animStep2: 0 } // posX/Y drifted 30px away
    const bufStale = composeRaceView({ words, bank, camera, frames, vehicleSize: size, cars: [stale], view, round: 1, ph0: fakePh0 }).indexed
    check('knockout overlay: still anchors on knockoutX/Y even once posX/Y has drifted away (not on the live posX/Y)', contains(bufStale, KNOCKOUT))
    // If drawKnockoutOverlay read posX/Y instead, bufStale's overlay would land 30px off-centre
    // from bufAtSnapshot's -- confirm the two buffers actually match pixel-for-pixel, not just
    // "some knockout-coloured pixel exists somewhere".
    let same = true
    for (let i = 0; i < bufAtSnapshot.length; i++) if (bufAtSnapshot[i] !== bufStale[i]) { same = false; break }
    check('knockout overlay: identical buffer whether or not posX/Y drifted, proving the anchor is knockoutX/Y not posX/Y', same)
  }
}

/**
 * The pause state machine (engine/pause.js, docs/engine.md §9q) -- CheckCheatSpotsThenPause
 * (1000:35f0), re-disassembled live this session to confirm it's a genuine SPACE-gated pause
 * (`[107C]` bit 0x2, tested at the call site `1000:3074`), falsifying cheats.js's own now-stale
 * header claim that no pause screen/key exists in this port.
 */
async function checkPause() {
  const { createPauseState, updatePause } = await import('../src/engine/pause.js')
  const car = () => ({ posX: 100, posY: 100 })
  const cheatNear = [{ round: 1, race: 1, x: 105, y: 95, type: 4, param: 0x99 }]
  const cheatFar = [{ round: 1, race: 1, x: 500, y: 500, type: 4, param: 0x99 }]

  const I = (spaceHeld, released = null, cheatFlag = false) => ({ spaceHeld, released, cheatFlag })

  // (a) entry is SPACE held at the loop head (3074, a level test).
  {
    const s = createPauseState()
    check('updatePause: idle, SPACE up -> stays unpaused', updatePause(s, 16, I(false), car(), [], 1, 1, {}) === false)
    check('updatePause: SPACE held enters pause', updatePause(s, 16, I(true), car(), [], 1, 1, {}) === true)
  }

  // (b) a nearby cheat spot's effect applies exactly once, on entry -- not applied at all when out of range.
  {
    const s = createPauseState()
    const c = car()
    updatePause(s, 16, I(true), c, cheatNear, 1, 1, {})
    check('updatePause: entering pause near a cheat spot applies its effect', c.accel === 0x99)
    check('updatePause: applying a cheat effect flashes (cheatFlashMs > 0)', s.cheatFlashMs > 0)
  }
  {
    const s = createPauseState()
    const c = car()
    updatePause(s, 16, I(true), c, cheatFar, 1, 1, {})
    check('updatePause: no cheat spot in range -> no effect, no flash', c.accel === undefined && s.cheatFlashMs === 0)
  }

  // (c) no minimum (docs/engine.md §9cl): the first release through the ISR's gate ends it at once;
  // with no gated release it never ends (37B8 has no timeout).
  {
    const s = createPauseState()
    updatePause(s, 16, I(true), car(), [], 1, 1, {}) // enter
    check('updatePause: SPACE let go but no gated release (a quick tap) -> still paused, however long', updatePause(s, 60000, I(false), car(), [], 1, 1, {}) === true)
    const t = createPauseState()
    updatePause(t, 16, I(true), car(), [], 1, 1, {})
    check('updatePause: a gated release 100ms in ends it -- no 2-second minimum (3789 -> 37B8 -> 37F5)', updatePause(t, 100, I(false, 'KeyX'), car(), [], 1, 1, {}) === false)
  }

  // (d) the 140-tick minimum exists only with the 25011968 flag (37BF), and not in round 9 (37C7) or
  // for an F12 release (37CE).
  {
    const s = createPauseState()
    updatePause(s, 16, I(true, null, true), car(), [], 1, 1, {})
    check('updatePause: cheat flag -> a release at 100ms does not end it yet (37ED)', updatePause(s, 100, I(false, 'KeyX', true), car(), [], 1, 1, {}) === true)
    check('updatePause: cheat flag -> ends once 2000ms (140 ticks) have passed', updatePause(s, 1900, I(false, 'KeyX', true), car(), [], 1, 1, {}) === false)
    const r9 = createPauseState()
    updatePause(r9, 16, I(true, null, true), car(), [], 9, 1, {})
    check('updatePause: cheat flag in round 9 -> no minimum (37C7)', updatePause(r9, 100, I(false, 'KeyX', true), car(), [], 9, 1, {}) === false)
    const f12 = createPauseState()
    updatePause(f12, 16, I(true, null, true), car(), [], 1, 1, {})
    check('updatePause: cheat flag, F12 released -> no minimum (37CE)', updatePause(f12, 100, I(false, 'F12', true), car(), [], 1, 1, {}) === false)
  }

  // (d2) the cheat window's combos (37D7-37EA, docs/engine.md §9cn, live-proven): the ISR's word
  // exactly 0x0600 (F1+F2) applies cheat type 9, exactly 0x0300 (F2+F3) type 1's instant win; either
  // flashes and restarts the pause (3753: the latch cleared again, stage 1, the timer from 0).
  {
    const enter = (flag = true, round = 1) => { const s = createPauseState(); updatePause(s, 16, I(true, null, flag), car(), [], round, 1, {}); s.latchClearPending = false; return s }
    const g9 = {}
    const s9 = enter()
    const still = updatePause(s9, 300, { spaceHeld: false, released: 'KeyX', cheatFlag: true, keyWord: 0x0600 }, car(), [], 1, 1, g9)
    check('combo F1+F2 (0x0600): cheat type 9 (3722), and the pause restarts (3753)', still === true && g9.cheat5 === 1 && g9.projectilesForAll === true && g9.projectileLimit === 4 && s9.elapsedMs === 0 && s9.stage1 && s9.latchClearPending && s9.cheatFlashMs > 0)
    const g1 = {}
    updatePause(enter(), 300, { spaceHeld: false, released: 'KeyX', cheatFlag: true, keyWord: 0x0300 }, car(), [], 1, 1, g1)
    check('combo F2+F3 (0x0300): the instant win (36A7)', g1.raceOverCount === 4 && g1.fixedOrder === true)
    const gx = {}
    updatePause(enter(), 300, { spaceHeld: false, released: 'KeyX', cheatFlag: true, keyWord: 0x0302 }, car(), [], 1, 1, gx)
    check('combo: another mapped key also held (SPACE, 0x0302) -> no match (the compare is exact)', gx.raceOverCount === undefined)
    const gn = {}
    const sn = enter(false)
    check('combo: without the 25011968 flag the release just ends the pause, no combo', updatePause(sn, 300, { spaceHeld: false, released: 'KeyX', cheatFlag: false, keyWord: 0x0300 }, car(), [], 1, 1, gn) === false && gn.raceOverCount === undefined)
    const g9r = {}
    updatePause(enter(true, 9), 300, { spaceHeld: false, released: 'KeyX', cheatFlag: true, keyWord: 0x0300 }, car(), [], 9, 1, g9r)
    check('combo: not in round 9 (37C7)', g9r.raceOverCount === undefined)
    const gb = {}
    const sb = enter()
    updatePause(sb, 300, { spaceHeld: false, released: null, cheatFlag: true, keyWord: 0x0300 }, car(), [], 1, 1, gb)
    check('combo: only after the gated release (the poll starts at 37D7, after 37B8)', gb.raceOverCount === undefined)
  }

  // (e) cheatFlashMs counts down to 0 over real time and never goes negative.
  {
    const s = createPauseState()
    updatePause(s, 16, I(true), car(), cheatNear, 1, 1, {})
    const start = s.cheatFlashMs
    updatePause(s, start + 50, I(true), car(), [], 1, 1, {}) // overshoot the flash duration
    check('updatePause: cheatFlashMs floors at 0, never negative', s.cheatFlashMs === 0)
    check('updatePause: cheatFlashMs actually had a positive duration to count down from', start > 0)
  }

  // (f) sound: 35F0's AH=8/AH=6 on entry, and 37AA/37B3's again when stage 1 ends (a gated release
  // or 140 ticks) -- not on every tick spent paused, not on resume.
  {
    const calls = []
    const sound = { stopSfx: (id) => calls.push(['stopSfx', id]), muteAll: () => calls.push(['muteAll']) }
    const s = createPauseState()
    updatePause(s, 16, I(false), car(), [], 1, 1, {}, sound)
    check('updatePause: no sound calls while idle', calls.length === 0)
    updatePause(s, 16, I(true), car(), [], 1, 1, {}, sound)
    check('updatePause: entering pause calls stopSfx then muteAll, once each', calls.length === 2 && calls[0][0] === 'stopSfx' && calls[1][0] === 'muteAll')
    updatePause(s, 500, I(true), car(), [], 1, 1, {}, sound)
    check('updatePause: nothing more while stage 1 runs', calls.length === 2)
    updatePause(s, 1600, I(false), car(), [], 1, 1, {}, sound) // 140 ticks pass with no release
    check('updatePause: stage 1\'s timeout sends AH=8/AH=6 again (37AA/37B3)', calls.length === 4)
    updatePause(s, 16, I(false, 'KeyX'), car(), [], 1, 1, {}, sound)
    check('updatePause: no further sound calls on resume', calls.length === 4 && s.paused === false)
  }
}

/**
 * The HUD's top digit (car 0's lapsRemaining) around the start countdown, against the live DOSBox
 * capture (docs/engine.md §9co, closing UNKNOWN_countdown_hud_digit): THE BREAKFAST BENDS (ROUND51,
 * Challenge race 1), car 0 left idle. Live: 3 for all four cars through state 0xA and the first
 * state-0 tick (947); two ticks later (949) cars 0 and 1 (the back row) read 4 and cars 2/3 stay 3; car 1 went back to 3 29
 * ticks (~14.5 steps, a change-only sampler, different drone picks) later, and car 0 stayed at 4.
 * The port already did this; this pins it (the 14-step figure is the port's own).
 */
async function checkCountdownHudDigit() {
  const strt = parseStrtPos(await read('GAME1/STRT_POS.BIN'))
  const cars = spawnCars(strt, 5, 1)
  const world = await loadWorld(read, 5, 1)
  const ctx = { ...roundCtx(5, 1), brk: await loadBrk(read, 5, 1), tournamentIndex: 1, world, camera: initCameraState(strt.find((s) => s.round === 5 && s.race === 1)) }
  const rs = {}
  let countdownOk = true, first = -1, car1Back = -1, seenAtFirst = ''
  for (let step = 0; step < 300; step++) {
    runStep(world, cars, cars.map((c, i) => (i > 0 && c.active ? droneControlByte(c, ctx) : 0)), rs, ctx)
    const laps = cars.map((c) => c.lapsRemaining).join('')
    if (first < 0 && cars[0].state === 0xa && laps !== '3333') countdownOk = false
    if (first < 0 && cars[0].state === 0) first = step
    if (first >= 0 && step === first + 1) check(`HUD digit: 3,3,3,3 on the first state-0 step, 4,4,3,3 on the next, as live (got ${laps})`, laps === '4433' && seenAtFirst === '3333')
    if (step === first) seenAtFirst = laps
    if (first >= 0 && step > first + 1 && car1Back < 0 && cars[1].lapsRemaining === 3) car1Back = step
  }
  check('HUD digit: 3 on every car through the whole start countdown (state 0xA), as live', countdownOk && first > 0)
  check(`HUD digit: car 1 back to 3 fourteen steps after reading 4 (port-pinned; live was 29 ticks, ~14.5 steps, with other drone picks) (got ${car1Back - first - 1})`, car1Back - first - 1 === 14)
  check('HUD digit: idle car 0 stays at 4, as live', cars[0].lapsRemaining === 4)
}

/**
 * Palette fade (engine/fade.js, docs/engine.md §9q) -- operates on the palette's own 6-bit DAC
 * bytes, not the converted 8-bit RGBA this port renders with (see the module's own header comment
 * for why: ramping the 8-bit values would be a visibly different curve, not the same algorithm).
 */
async function checkFade() {
  const { createFadeState, updateFade, applyFade } = await import('../src/engine/fade.js')
  const dac6 = new Uint8Array(768).fill(63) // max 6-bit value on every channel

  const TICK = 1000 / 70
  // (a) the race start (39F0 -> 32CE over zeroed VRAM, docs/engine.md §9co): black for the whole
  // 17-tick fade-up, measured live, then the real palette at once -- no ramp over the scene.
  {
    const s = createFadeState('in')
    check('applyFade: the race-start hold starts fully black', applyFade(dac6, s).every((v) => v === 0))
    updateFade(s, 16.9 * TICK)
    check('applyFade: still fully black just before tick 17 (no partial brightness at any point)', s.active && applyFade(dac6, s).every((v) => v === 0))
    updateFade(s, 0.2 * TICK)
    check('applyFade: the real 6-bit values at tick 17 (32CE took 17 ticks live)', !s.active && applyFade(dac6, s).every((v) => v === 63))
  }

  // (b) fade-out starts at the real palette and ends black, over the 16 ticks 327A took live.
  {
    const s = createFadeState('out')
    // PaletteFadeToBlack 327A/32AE (docs/engine.md §9an): the first upload already shows v-1, and
    // every value falls by the same k (a subtraction, not a ratio): 63 -> 62, 10 -> 9, 0 stays 0.
    const mix = new Uint8Array([63, 10, 0, 1])
    const first = applyFade(mix, s)
    check('applyFade: fade-out starts one step down, max(0, v-1) (32C4 DEC if nonzero)', first[0] === 62 && first[1] === 9 && first[2] === 0 && first[3] === 0)
    updateFade(s, 8 * TICK) // half of the 16 ticks
    const mid = applyFade(mix, s)
    check(`applyFade: at tick 8 of 16, k = 32 is subtracted from every channel: 63 -> 31, 10 -> 0 (got ${mid[0]}, ${mid[1]})`, mid[0] === 31 && mid[1] === 0)
    updateFade(s, 7.9 * TICK)
    check('updateFade: the fade-out is still running just before tick 16', s.active)
    updateFade(s, 0.2 * TICK)
    check('applyFade: fade-out fully black at tick 16 (327A took 16 ticks live)', !s.active && applyFade(dac6, s).every((v) => v === 0))
  }

  // (b2) the hold drains the pause key's press edge (3074 tests SPACE's level at the first loop head):
  // a tap over before the hold ends must not pause the first frame; a SPACE still held does.
  {
    const { raceStartHold } = await import('../src/engine/fade.js')
    const { createPauseKeyReader } = await import('../src/engine/input.js')
    const ls = {}
    const target = { addEventListener: (t, f) => { ls[t] = f }, removeEventListener() {} }
    const key = createPauseKeyReader(target)
    const s = createFadeState('in')
    ls.keydown({ code: 'Space', preventDefault() {} })
    ls.keyup({ code: 'Space' })
    let frames = 0
    while (raceStartHold(s, 16, key)) frames++
    const after = key.read()
    check(`raceStartHold: holds ${frames} frames of 16ms (17 ticks), then lets the loop run`, frames === 16 && !s.active)
    check('raceStartHold: a SPACE tap during the hold leaves no press edge for the first frame', !after.pressed && !after.held)
    const s2 = createFadeState('in')
    ls.keydown({ code: 'Space', preventDefault() {} })
    while (raceStartHold(s2, 16, key)) {}
    check('raceStartHold: a SPACE still held at the first frame still reads as held', key.read().held)
    check('raceStartHold: never holds for a fade-out', !raceStartHold(createFadeState('out'), 16, key))
  }

  // (b3) a front-end screen's own 32CE ('up', docs/engine.md §9cp): the presented screen, each value
  // capped at k = floor(c/2) + 1 after call c, over the same 17 ticks.
  {
    const s = createFadeState('up')
    const mix = new Uint8Array([63, 10, 0, 40])
    const first = applyFade(mix, s)
    check('applyFade up: the first upload shows min(v, 1) (3303 on CX=0)', first.join() === '1,1,0,1')
    updateFade(s, 8.5 * TICK)
    const mid = applyFade(mix, s)
    check(`applyFade up: at tick 8.5 of 17, k = 33: 63 -> 33, 10 stays 10 (got ${mid.join()})`, mid.join() === '33,10,0,33')
    updateFade(s, 8.4 * TICK)
    check('applyFade up: still running just before tick 17', s.active)
    updateFade(s, 0.2 * TICK)
    check('applyFade up: the real palette at tick 17', !s.active && applyFade(mix, s).join() === '63,10,0,40')
  }

  // (b4) [26CE]'s own sequencing (src/frontend/dacFade.js, docs/engine.md §9cp).
  {
    const { createDacFadeState, raceSetupFade, raceStartFadeUp, raceExitFade, beginScreenFadeUp, screenFadeStep, screenPalette } = await import('../src/frontend/dacFade.js')
    const d = createDacFadeState()
    check('[26CE]: the boot title does not fade (the flag starts 0)', !beginScreenFadeUp(d) && d.screen === null)
    const setup = raceSetupFade(d)
    check('[26CE]: race setup fades the screen before the race out (395A, 16 ticks) and sets the flag', setup?.direction === 'out' && d.faded)
    raceStartFadeUp(d)
    check('[26CE]: the race start\'s 32CE clears it', !d.faded)
    raceExitFade(d)
    let done = 0
    check('[26CE]: the first screen after the race exit fades up', beginScreenFadeUp(d, 'up', () => done++) && !d.faded)
    let held = 0
    while (screenFadeStep(d, TICK)) held++
    check(`[26CE]: its logic is frozen for 16 whole ticks, released on the 17th (got ${held})`, held === 16 && d.screen === null)
    check('[26CE]: onDone runs exactly once, when the fade ends', done === 1)
    check('[26CE]: the next screen (e.g. the board) does not fade again', !beginScreenFadeUp(d))
    const dac6 = new Uint8Array(768).fill(50)
    check('[26CE]: with no fade running, the screen palette is the real one', screenPalette(d, dac6) === dac6)
    raceExitFade(d)
    check('[26CE]: race setup with the flag still 1 skips its fade-out (327A\'s 3282 test)', raceSetupFade(d) === null && d.faded)
    raceStartFadeUp(d)
    raceExitFade(d)
    beginScreenFadeUp(d, 'in')
    check('[26CE]: the champion screen (1BCF before its present) holds black', screenPalette(d, dac6).every((v) => v === 0))
  }

  // (c) an inactive/absent state is a safe no-op (identity), so a caller can call applyFade unconditionally.
  {
    const s = createFadeState('in')
    updateFade(s, 10000)
    check('applyFade: inactive state returns the palette unchanged (identity)', applyFade(dac6, s) === dac6)
    check('applyFade: no state at all is also a safe identity no-op', applyFade(dac6, null) === dac6)
  }

  // (e) a real, previously-live-only bug: `io/source.js`'s readers all resolve to a raw
  // ArrayBuffer (docs/engine.md §9q), not a Uint8Array -- `.PAL` files reach `play.js` that way.
  // The first version of `applyFade` did `new Uint8Array(dac6.length)`, and `ArrayBuffer` has no
  // `.length` (only `.byteLength`), so `new Uint8Array(undefined)` silently produced a 0-length
  // buffer -- no throw here, but `decodePalette` downstream threw "expected 768 bytes, got 0" the
  // instant the game page tried to render a frame. Every check above used a plain `Uint8Array` and
  // would have missed this entirely; only caught by an actual `npm run dev` browser load.
  {
    const buf = new Uint8Array(768).fill(40).buffer
    const s = createFadeState('out')
    updateFade(s, 100) // mid-fade, so applyFade must actually allocate, not take the identity shortcut
    let threw = null, out
    try { out = applyFade(buf, s) } catch (e) { threw = e }
    check(`applyFade: a raw ArrayBuffer input doesn't throw (${threw?.message ?? 'ok'})`, !threw)
    check(`applyFade: a raw ArrayBuffer input yields the real 768-byte length, not 0 (got ${out?.length})`, out?.length === 768)
  }
}

/**
 * The lap rule over a real 2000-step recorded-tape ROUND21 race (the same scenario `main()`'s own
 * determinism check uses), judged against the REAL rules (docs/engine.md §9ah) rather than a bound
 * calibrated on whatever the port happened to do: a car's `lapsRemaining` may only change on a step
 * where it started in state 0 and `collide.js` actually wrote its progress (`progressChanged`), and
 * the tile query never writes a 0 into `progress` (only a respawn may, 7120-712a). Also replays car
 * 0's real progress WRITES through the checkpoint rule with the real half and with the old 128, as
 * positive evidence the real threshold catches genuine crossings the old default swallowed.
 */
async function checkLapCountSanity() {
  const setup = await setupRace()
  const { cars, world, ctx, raceState } = setup
  ctx.camera = setup.camera
  let i = 0
  const synthetic = { read: () => PATTERNS[i++ % PATTERNS.length] }

  const lapHistory = []
  const writes = [] // car 0's [progressPrev, progress] on every step its progress was written
  let illegalLapChange = null
  let zeroWrite = null
  for (let step = 0; step < N && !raceState.raceOver; step++) {
    const before = cars.map((c) => ({ state: c.state, laps: c.lapsRemaining, progress: c.progress }))
    const controls = cars.map((car, ci) => (ci === 0 ? synthetic.read() : droneControlByte(car, ctx)))
    runStep(world, cars, controls, raceState, ctx)
    cars.forEach((c, ci) => {
      if (c.lapsRemaining !== before[ci].laps && !(before[ci].state === 0 && c.progressChanged === 1)) illegalLapChange ??= { step, car: ci }
      const respawned = before[ci].state === 7 && c.state === 2
      if (c.progress === 0 && before[ci].progress !== 0 && !respawned) zeroWrite ??= { step, car: ci }
    })
    lapHistory.push(cars[0].lapsRemaining)
    if (cars[0].progressChanged) writes.push([cars[0].progressPrev, cars[0].progress])
  }

  check('lapsRemaining stays within [0,9] throughout a real 2000-step drive', lapHistory.every((v) => v >= 0 && v <= 9))
  check(`lapsRemaining only ever changes on a step the car started in state 0 AND had its progress written (5e8f/5f1b)${illegalLapChange ? ` -- first violation step ${illegalLapChange.step}, car ${illegalLapChange.car}` : ''}`, !illegalLapChange)
  check(`the tile query never writes a 0 into progress (561d/579a/5807)${zeroWrite ? ` -- step ${zeroWrite.step}, car ${zeroWrite.car}` : ''}`, !zeroWrite)
  let changes = 0
  for (let k = 1; k < lapHistory.length; k++) if (lapHistory[k] !== lapHistory[k - 1]) changes++
  check(`car 0's lapsRemaining changes only a handful of times over the drive (got ${changes})`, changes > 0 && changes <= 5)

  const real = world.map.maxPlane2 >> 1
  const simulate = (half) => {
    const c = { progress: 0, progressPrev: 0, progressChanged: 1, checkpointOff: 0, checkpointOffSaved: 0, lapsRemaining: 4, safeX: 0, safeY: 0, safeXPrev: 0, safeYPrev: 0, posX: 0, posY: 0, knockoutX: 0, knockoutY: 0, state: 0, drawnThisFrame: 0 }
    let events = 0, last = c.lapsRemaining
    for (const [prev, cur] of writes) {
      c.progressPrev = prev
      c.progress = cur
      updateCheckpointsAndLaps(c, { round: ROUND, race: RACE, raceFormat: 1, halfMaxProgress: half })
      if (c.lapsRemaining !== last) { events++; last = c.lapsRemaining }
    }
    return events
  }
  const eventsReal = simulate(real)
  const eventsOld = simulate(128)
  check(`the real threshold (${real}) detects at least one genuine line-crossing over the real drive`, eventsReal > 0)
  check(`the OLD hardcoded default (128) detects FEWER crossings on the SAME real progress writes (real=${eventsReal}, old=${eventsOld})`, eventsOld < eventsReal)
}

/**
 * `computeRanking`/`recountRaceOver` (step.js, docs/engine.md §9s, corrected §9ah) directly on
 * synthetic cars -- `computeRanking` only ever reads `progress`/`lapsRemaining` and the persistent
 * order in `raceState.rankOrder`.
 */
function checkRanking() {
  const mkCar = (over) => ({ progress: 0, lapsRemaining: 3, racePosition: 0, ...over })
  const four = (over = []) => [0, 1, 2, 3].map((k) => mkCar(over[k] ?? {}))

  // (a) recountRaceOver (1000:4b85-4bde): assigns the finished+stopped tally, forced to 2 when car 0
  // has finished (laps === 0). WHEN it runs (only on a stopped finished car's turn) is runStep's
  // business, tested in checkRaceEnd.
  {
    const s = (over) => ({ lapsRemaining: 3, speed: 100, ...over })
    check('recountRaceOver: nobody finished -> 0', recountRaceOver([s({}), s({}), s({}), s({})]) === 0)
    check('recountRaceOver: one finished+stopped drone -> 1', recountRaceOver([s({}), s({ lapsRemaining: 0, speed: 0 }), s({}), s({})]) === 1)
    check('recountRaceOver: two finished+stopped drones -> 2 (the player has lost)', recountRaceOver([s({}), s({ lapsRemaining: 0, speed: 0 }), s({ lapsRemaining: 0, speed: 0 }), s({})]) === 2)
    check('recountRaceOver: car 0 finished (even still moving) forces 2', recountRaceOver([s({ lapsRemaining: 0, speed: 500 }), s({}), s({}), s({})]) === 2)
    check('recountRaceOver: a finished drone still moving does not count', recountRaceOver([s({}), s({ lapsRemaining: 0, speed: 5 }), s({}), s({})]) === 0)
  }

  // (b) `MUL CL` at `8e2f` is an 8-bit multiply -- only `scale`'s low byte participates: 0x1C8
  // must behave as 0xC8 (200), which makes B (1 lap unit + 250) beat A (2 units + 0); a real 456
  // would not.
  {
    const cars = four([{ lapsRemaining: 7 }, { lapsRemaining: 8, progress: 250 }, { lapsRemaining: 9 }, { lapsRemaining: 9 }])
    computeRanking(cars, { progressScale: 0x1c8 }, {})
    check('computeRanking masks progressScale to its low byte (0x1C8 behaves as 0xC8=200, not 456)', cars[1].racePosition === 1 && cars[0].racePosition === 2)
  }

  // (c) The previously-shipped scale=1 bug vs the real derived scale (28 for ROUND21).
  {
    const mk = () => four([{ lapsRemaining: 7 }, { lapsRemaining: 8, progress: 25 }, { lapsRemaining: 9 }, { lapsRemaining: 9 }])
    const withOldScale = mk()
    computeRanking(withOldScale, { progressScale: 1 }, {})
    check('with the OLD scale=1 default, B (fewer laps done, more raw progress) WRONGLY outranks A', withOldScale[1].racePosition === 1 && withOldScale[0].racePosition === 2)
    const withRealScale = mk()
    computeRanking(withRealScale, { progressScale: 28 }, {})
    check('with the REAL derived scale (28), A (further along) correctly outranks B', withRealScale[0].racePosition === 1 && withRealScale[1].racePosition === 2)
  }

  // (d) The PREFIX freeze (8e16-8e59): only the slots up to the last finished car's slot are pinned;
  // the cars behind are still ranked live. The old port pinned the whole order.
  {
    const scale = 50
    const cars = four([{ lapsRemaining: 0 }, { progress: 100 }, { progress: 50 }, { progress: 10 }])
    const raceState = { rankOrder: [0, 1, 2, 3] }
    cars[3].progress = 1000 // would score 1300 (way ahead of everyone) if NOT frozen
    const order = computeRanking(cars, { progressScale: scale }, raceState)
    check('finished car in slot 0 stays first', order[0] === 0 && cars[0].racePosition === 1)
    check('...but the unfinished cars behind it are still re-ranked live (car 3 overtakes into 2nd)', order[1] === 3 && cars[3].racePosition === 2)

    const cars2 = four([{ lapsRemaining: 0 }, { lapsRemaining: 5 }, { progress: 1000 }, { lapsRemaining: 4 }])
    const rs2 = { rankOrder: [1, 3, 0, 2] } // an unfinished leader, then car 3, then the finished car 0, then car 2
    const order2 = computeRanking(cars2, { progressScale: scale }, rs2)
    check('slots 0..m (m = last finished slot) stay frozen, including unfinished cars ahead of the finisher', order2.slice(0, 3).join(',') === '1,3,0')
    check('...and a car behind the last finisher cannot pass it, however high its score', order2[3] === 2 && cars2[2].racePosition === 4)

    const cars3 = four([{ progress: 5 }, { progress: 90 }, { progress: 60 }, { progress: 30 }])
    const rs3 = { rankOrder: [0, 1, 2, 3], raceOverCount: 2 }
    const order3 = computeRanking(cars3, { progressScale: scale }, rs3)
    check('[26C6] >= 2 freezes everything even with NOBODY finished (the lead rule / cheat case -- refutes the old "provably redundant" argument)', order3.join(',') === '0,1,2,3')

    const cars4 = four()
    const rs4 = { rankOrder: [3, 2, 1, 0] }
    const order4 = computeRanking(cars4, { progressScale: scale }, rs4)
    check('stable sort: equal scores never swap (JGE), the persistent order survives', order4.join(',') === '3,2,1,0')

    cars[0].lapsRemaining = 1 // a backward re-crossing thaws the freeze
    const order5 = computeRanking(cars, { progressScale: scale }, raceState)
    check('once nobody has finished any more, a fresh sort reflects the real scores', order5[0] === 3)
  }

  // (e) Two-car branch (8f03-8fa1): live, no sentinel; both finished and straddling the line ->
  // forced order (8f87/8f95).
  {
    const two = [mkCar({ lapsRemaining: 0, progress: 3 }), mkCar({ lapsRemaining: 1, progress: 20 }), mkCar(), mkCar()]
    computeRanking(two, { raceFormat: 2, progressScale: 28, halfMaxProgress: 14 }, {})
    check('two-car: a finished car 0 still leads on score (9*28+3 > 8*28+20)', two[0].racePosition === 1 && two[1].racePosition === 2)
    two[1].lapsRemaining = 0; two[1].progress = 27
    computeRanking(two, { raceFormat: 2, progressScale: 28, halfMaxProgress: 14 }, { rankOrder: [1, 0, 2, 3] })
    check('two-car: both finished, |p0-p1| >= half, car 1 ahead on progress -> car 0 forced first (8f95)', two[0].racePosition === 1 && two[1].racePosition === 2)
  }

  // (f) Round 9 (8dfc -> 8ff5): no ranking at all.
  {
    const r9 = four([{ racePosition: 7 }])
    computeRanking(r9, { round: 9, progressScale: 28 }, {})
    check('round 9: racePosition untouched', r9[0].racePosition === 7)
  }
}

/**
 * The race end (docs/engine.md §9ah) through `runStep` itself: the finished-car block (4b45-4be4),
 * the per-car control-path rules for finished cars and for [26C6] >= 2 (4d2f/4e07/4e0e), the
 * [26CC] 100-step countdown (3081-3093), and the slot-0 rubber band (4b1c-4b41). Cars sit far apart
 * in a synthetic open, progress-free world so nothing but these rules touches their speed.
 */
async function checkRaceEnd() {
  const strt = parseStrtPos(await read('GAME1/STRT_POS.BIN'))
  const open = {
    map: { tiles: new Uint8Array(1024), attrs: new Uint8Array(1024), plane2: new Uint8Array(1024), maxPlane2: 0 },
    colOf: () => new Uint8Array(144), dirOf: () => new Uint8Array(36),
    levOf: () => ({ raw: 0, unsafeRespawn: false, heading: 0x40, nudge: { dx: 0, dy: 0 }, lowBits: 0 }),
  }
  const setup = (round = 1, race = 1, raceFormat = 1) => {
    const cars = spawnCars(strt, round, race, { raceFormat })
    cars.forEach((c, k) => { c.state = 0; c.controlsLocked = 0; c.posX = c.nextX = c.safeX = 200 + k * 600; c.posY = c.nextY = c.safeY = 1500 })
    return { cars, ctx: { ...roundCtx(round, race, { raceFormat }), world: open }, rs: {} }
  }
  const step = (t, controls = [0, 0, 0, 0]) => runStep(open, t.cars, controls, t.rs, t.ctx)

  // (i) A finished car still moving brakes by brakeDecel and (four-car) coasts by coastDecel; the
  // recount does not run while it moves, so the race is not over yet.
  {
    const t = setup()
    t.cars[0].lapsRemaining = 0; t.cars[0].speed = 1000; t.cars[0].heading = 0
    const expect = 1000 - t.cars[0].brakeDecel - t.cars[0].coastDecel
    step(t, [0x20, 0, 0, 0]) // holding accelerate changes nothing for a finished car
    check(`finished car 0 brakes and coasts (1000 -> ${expect}), throttle ignored`, t.cars[0].speed === expect)
    check('no recount while no finished car is stopped', (t.rs.raceOverCount ?? 0) === 0)
    let n = 0
    while (t.cars[0].speed !== 0 && n++ < 200) step(t)
    check('it comes to a stop', t.cars[0].speed === 0)
    step(t)
    check('the recount runs on the stopped finished car\'s own turn and forces 2 (car 0 finished)', t.rs.raceOverCount === 2)
    let steps = 1
    while (!t.rs.raceOver && steps < 500) { step(t); steps++ }
    check(`...then the race is over after the 100-step [26CC] countdown (got ${steps})`, t.rs.raceOver === true && steps === 100)
    const frozen = t.rs.rankOrder.join(',')
    t.cars[2].speed = 800; t.cars[2].velX = 0x300
    const before = { x: t.cars[2].posX, speed: t.cars[2].speed, linger: t.rs.raceOverLinger }
    step(t, [0, 0, 0x20, 0])
    check('runStep is a no-op once the race is over (nothing moves, the countdown and the frozen order stay put)', t.rs.rankOrder.join(',') === frozen && t.cars[2].posX === before.x && t.cars[2].speed === before.speed && t.rs.raceOverLinger === before.linger)
  }

  // (ii) Two drones finished and stopped end the race with the player still racing -- the lose case.
  {
    const t = setup()
    for (const k of [1, 2]) { t.cars[k].lapsRemaining = 0; t.cars[k].speed = 0 }
    t.rs.rankOrder = [1, 2, 0, 3]
    step(t)
    check('two finished+stopped drones -> [26C6]=2 with the player unfinished', t.rs.raceOverCount === 2)
    let steps = 1
    while (!t.rs.raceOver && steps < 500) { step(t, [0x20, 0, 0, 0]); steps++ }
    check('...the race ends after the countdown; car 0 finishes 3rd (a lost life in the Challenge)', t.rs.raceOver && t.rs.rankOrder.indexOf(0) + 1 === 3)
  }

  // (ii-live) The live ROUND21 end (docs/engine.md §9da, car 0 idle): car 3 has just stopped with
  // laps 0 after car 2; car 1 (laps 1) runs at its 1014 cap. Live, the step that makes [26C6] 2 also
  // takes [26CC] to 99 with car 1 still at 1014 (its own turn ran before car 3's recount); then car 1
  // coasts 20 a step with each [26CC] decrement: (2,99,1014), (2,98,994), (2,97,974). Order 2,3,1,0.
  {
    const t = setup(2, 1)
    const live = [[2, 99, 1014], [2, 98, 994], [2, 97, 974]]
    t.cars[0].lapsRemaining = 4
    t.cars[1].lapsRemaining = 1; t.cars[1].speed = 1014; t.cars[1].maxSpeedCur = 1014; t.cars[1].heading = 0
    for (const k of [2, 3]) { t.cars[k].lapsRemaining = 0; t.cars[k].speed = 0 }
    t.rs.rankOrder = [2, 3, 1, 0]
    t.rs.raceOverCount = 1
    const got = []
    for (let i = 0; i < 3; i++) { step(t, [0, 0x20, 0, 0]); got.push([t.rs.raceOverCount, t.rs.raceOverLinger, t.cars[1].speed]) }
    check(`live race end: [26C6]/[26CC]/car 1 speed per step match the capture (got ${JSON.stringify(got)})`, JSON.stringify(got) === JSON.stringify(live))
    while (!t.rs.raceOver) step(t, [0, 0x20, 0, 0])
    check('live race end: the frozen order is 2,3,1,0 -- car 0 last, the lost qualifier', t.rs.rankOrder.join(',') === '2,3,1,0')
  }

  // (iii) [26C6] >= 2 cuts EVERY car's throttle (4e0e), and the recount ASSIGNS from 0 (a cheat's 4
  // is overwritten once a finished car stops).
  {
    const t = setup()
    t.rs.raceOverCount = 2
    t.cars[3].speed = 600
    step(t, [0, 0, 0, 0x20])
    check('[26C6] >= 2: an unfinished car holding accelerate only coasts', t.cars[3].speed === 600 - t.cars[3].coastDecel)
    const c = setup()
    c.rs.raceOverCount = 4
    c.cars[2].lapsRemaining = 0; c.cars[2].speed = 0
    step(c)
    check('the recount assigns from 0: cheat 4 becomes 1 once a finished drone stops', c.rs.raceOverCount === 1)
  }

  // (iv) A finished DRONE neither steers nor throttles (4d2f-4d44); a finished HUMAN still steers.
  {
    const t = setup()
    t.cars[1].lapsRemaining = 0; t.cars[1].speed = 500; t.cars[1].heading = 0x40
    t.cars[0].lapsRemaining = 0; t.cars[0].speed = 500; t.cars[0].heading = 0x40
    step(t, [0x80, 0x80, 0, 0])
    check('finished drone ignores steering', t.cars[1].heading === 0x40)
    check('finished human still steers', t.cars[0].heading !== 0x40)
  }

  // (v) Two-car format skips the whole finished-car block: a finished car keeps full throttle.
  {
    const t = setup(1, 1, 2)
    t.cars[0].lapsRemaining = 0; t.cars[0].speed = 500
    step(t, [0x20, 0, 0, 0])
    check('two-car: a finished car is not braked and still accelerates', t.cars[0].speed > 500)
  }

  // (vi) The rubber band ([262F]) is only on while car 0 LEADS (slot 0) -- the original's scan never
  // gets past slot 0 (CMP SI,[0x267E], a memory operand). Off-screen drone, accelerate held.
  {
    const leading = setup()
    leading.rs.rankOrder = [0, 1, 2, 3]
    leading.cars[1].drawnThisFrame = 0; leading.cars[1].speed = 0
    step(leading, [0, 0x20, 0, 0])
    const trailing = setup()
    trailing.rs.rankOrder = [2, 0, 1, 3]
    trailing.cars[1].drawnThisFrame = 0; trailing.cars[1].speed = 0
    trailing.cars[2].progress = 50 // keep car 2 ahead after the re-sort
    step(trailing, [0, 0x20, 0, 0])
    check('rubber band on while car 0 leads (accel x6)', leading.cars[1].speed === 6 * leading.cars[1].accel)
    check('rubber band OFF while car 0 is 2nd, even for a drone behind it', trailing.cars[1].speed === trailing.cars[1].accel)
  }
  // (vi-live) The live mid-race lead (docs/engine.md §9dg, ROUND21, tick 2451): order [0,2,3,1], car 1
  // off screen at its 600 cap with accel 24, gripStep 56, slipThreshold 71. Live, 4E95-4EA9 took
  // its speed to 744 (6 x 24) and 4EAD clamped it back to 600; 5308-5312 made the grip 84/106,
  // used as is ([1284]=[1286]=0). A velocity far from its target moves by the rate, 84 (56 unboosted).
  {
    const live = (lead) => {
      const t = setup(2, 1)
      t.rs.rankOrder = lead ? [0, 2, 3, 1] : [2, 0, 3, 1]
      if (!lead) t.cars[2].progress = 50
      const c = t.cars[1]
      Object.assign(c, { drawnThisFrame: 0, speed: 600, maxSpeedCur: 600, accel: 24, gripStep: 56, slipThreshold: 71, velX: 2000, velY: 2000, lowGripTimerA: 0, lowGripTimerB: 0 })
      step(t, [0, 0x20, 0, 0])
      return c
    }
    const on = live(true), off = live(false)
    check(`live rubber band: a boosted car at its cap stays at 600 (744 clamped at 4EAD), got ${on.speed}`, on.speed === 600)
    check(`live rubber band: the grip rate is 84 (x1.5 of 56) while car 0 leads, 56 when not (got ${2000 - on.velX}/${2000 - off.velX})`, 2000 - on.velX === 84 && 2000 - on.velY === 84 && 2000 - off.velX === 56)
  }

  // (vii) TANKS-only steering modifier (4edc-4efa): a fast human's steer step is NOT halved outside
  // round 7.
  {
    const t = setup()
    t.cars[0].speed = 0x400; t.cars[0].heading = 0x40
    step(t, [0x40, 0, 0, 0])
    check('round 1: a fast human steers by the full steerStep (no >>1 outside TANKS)', t.cars[0].heading === 0x40 + t.cars[0].steerStep)
    const tanks = setup(7, 1)
    tanks.cars[0].speed = 0x400; tanks.cars[0].heading = 0x40
    step(tanks, [0x40, 0, 0, 0])
    check('round 7 (TANKS): the same fast human steers by steerStep>>1', tanks.cars[0].heading === 0x40 + (tanks.cars[0].steerStep >> 1))
  }

  // (viii) End to end on the real ROUND21 map, AI driving car 0 with drone tuning: with the drones
  // slowed, car 0 completes lap 1 in the lead and the qualifier's lead rule (6024-6054) ends the race
  // with car 0 first; at normal drone speed two drones finish and stop first and the race ends with
  // car 0 unfinished and third.
  for (const [slow, expectPlace, label] of [[2, 1, 'lead rule win'], [1, 3, 'two drones finished']]) {
    const r = await setupRace()
    for (const k of ['maxSpeedCur', 'maxSpeedBase', 'reverseLimit', 'accel', 'brakeDecel', 'coastDecel', 'slipThreshold', 'gripStep']) r.cars[0][k] = r.cars[1][k]
    for (const c of r.cars.slice(1)) { c.maxSpeedBase = Math.round(c.maxSpeedBase / slow); c.maxSpeedCur = c.maxSpeedBase }
    r.ctx.camera = r.camera
    let steps = 0
    while (!r.raceState.raceOver && steps < 6000) {
      runStep(r.world, r.cars, r.cars.map((c) => droneControlByte(c, r.ctx)), r.raceState, r.ctx)
      steps++
    }
    check(`ROUND21 end to end (${label}): the race ends on its own (${steps} steps) and car 0 places ${expectPlace} (got ${r.raceState.rankOrder.indexOf(0) + 1})`, r.raceState.raceOver && r.raceState.rankOrder.indexOf(0) + 1 === expectPlace)
    if (slow === 2) check('...ended by the lead rule after lap 1 (car 0 still owes 2 laps)', r.cars[0].lapsRemaining === 2)
  }
}

/**
 * The smoothness 2-4 cadence (docs/engine.md §9cr): `90C5` returns unless `[2638]==1`, so the state
 * handlers, the ranking `8DFC`, the puffs and the engine sounds `7B46` run once per N physics steps
 * -- live, 100 steps at smoothness 2 gave 50 renders/51 rankings/51 engine updates, 144 at 4 gave
 * 36 of each. ROUND21 with the drones driving, `ctx.drawnTick` from the pages' own gate.
 */
async function checkSmoothnessCadence() {
  const run = async (n, steps) => {
    const s = await setupRace()
    s.ctx.camera = s.camera
    const gate = createSmoothnessGate(n)
    const out = { countdownSteps: -1, frozenOk: true, rankChanges: 0, puffChanges: 0, engineCalls: 0, jitterCalls: 0 }
    const snap = () => JSON.stringify([s.raceState.dropInTimer, s.raceState.rankOrder, s.cars.map((c) => [c.racePosition, c.puffSlotCursor, c.puffSlots, c.splashSlots])])
    const driver = { kind: 'opl', engine: () => { out.engineCalls++ }, playSfx() {}, keepAliveSfx() {}, command() { return 0 } }
    const jitter = () => { out.jitterCalls++; return 0 }
    for (let step = 0; step < steps; step++) {
      s.ctx.drawnTick = gate.shouldDraw()
      const before = snap(), rankBefore = JSON.stringify(s.raceState.rankOrder)
      const puffBefore = JSON.stringify(s.cars.map((c) => c.puffSlots))
      runStep(s.world, s.cars, s.cars.map((c, i) => (i === 0 ? 0x20 : droneControlByte(c, s.ctx))), s.raceState, { ...s.ctx, sound: driver })
      updateEngines(driver, s.cars, s.ctx, jitter)
      if (!s.ctx.drawnTick && snap() !== before) out.frozenOk = false
      if (JSON.stringify(s.raceState.rankOrder) !== rankBefore) out.rankChanges++
      if (JSON.stringify(s.cars.map((c) => c.puffSlots)) !== puffBefore) out.puffChanges++
      if (out.countdownSteps < 0 && s.cars[0].state !== 0xa) out.countdownSteps = step
    }
    return out
  }
  const r1 = await run(1, 1500), r2 = await run(2, 1500), r4 = await run(4, 1500)
  check(`cadence: the start countdown (state A's own [26D5]) takes N times the steps at smoothness N (got ${r1.countdownSteps}/${r2.countdownSteps}/${r4.countdownSteps})`,
    r1.countdownSteps > 50 && Math.abs(r2.countdownSteps - 2 * r1.countdownSteps) <= 2 && Math.abs(r4.countdownSteps - 4 * r1.countdownSteps) <= 4)
  check('cadence: on a step that is not drawn, no state timer, ranking, race position, puff or splash changes', r2.frozenOk && r4.frozenOk)
  check(`cadence: the ranking and the puffs still run on drawn steps (rank changes ${r2.rankChanges}/${r4.rankChanges}, puff changes ${r2.puffChanges}/${r4.puffChanges})`, r2.rankChanges > 0 && r4.rankChanges > 0 && r2.puffChanges > 0 && r4.puffChanges > 0)
  check(`cadence: the engine sounds (7B46) update once per drawn step, 4 cars each, and the jitter PRNG with them, as live (got ${r1.engineCalls}/${r2.engineCalls}/${r4.engineCalls})`,
    r1.engineCalls === 4 * 1500 && r2.engineCalls === 4 * 750 && r4.engineCalls === 4 * 375 && r2.jitterCalls === r2.engineCalls)
}

async function main() {
  await checkCameraTracking()
  await checkCarCarCollision()
  await checkHud()
  await checkProjectiles()
  await checkPuffsAndSplashes()
  await checkProjectileAndPuffRendering()
  await checkCarDrawAnchor()
  await checkCarDrawWrapSeam()
  checkCarDrawWrapWindows()
  await checkCarDrawWrapReachability()
  await checkAnimationOverlaysAndRotor()
  await checkPause()
  await checkFade()
  await checkCountdownHudDigit()
  await checkSmoothnessCadence()
  checkRanking()
  await checkRaceEnd()
  await checkLapCountSanity()

  const setup1 = await setupRace()
  const spawnPos = setup1.cars.map((c) => ({ x: c.posX, y: c.posY }))
  let i = 0
  const synthetic = { read: () => PATTERNS[i++ % PATTERNS.length] }
  const recorded = recordingReader(synthetic)
  runRace(setup1, recorded)

  check('drop-in hold ended (car 0 reached state 0 or a knockout/respawn state, not still 0xA)', setup1.cars[0].state !== 0xa)
  check('controls unlocked at least once (camera settled)', setup1.cars.every((c) => c.controlsLocked === 0))
  check('at least one drone moved from its own spawn position', setup1.cars.slice(1).some((c, i2) => c.posX !== spawnPos[i2 + 1].x || c.posY !== spawnPos[i2 + 1].y))
  check('the recorder actually captured a full tape', recorded.tape.length === N)

  // Determinism: a FRESH, identically-spawned race, driven by input.js's own createTapeReader
  // replaying run 1's recorded tape -- not the same array expression re-evaluated by hand.
  const setup2 = await setupRace()
  runRace(setup2, createTapeReader(recorded.tape))

  const fields = ['posX', 'posY', 'posXfrac', 'posYfrac', 'velX', 'velY', 'heading', 'speed', 'state', 'progress', 'lapsRemaining']
  let firstDiff = null
  for (let carIdx = 0; carIdx < 4 && !firstDiff; carIdx++) {
    for (const f of fields) {
      if (setup1.cars[carIdx][f] !== setup2.cars[carIdx][f]) { firstDiff = { car: carIdx, field: f, a: setup1.cars[carIdx][f], b: setup2.cars[carIdx][f] }; break }
    }
  }
  check(`replaying the recorded tape reproduces the identical final state (${N} steps, 4 cars, camera)`, !firstDiff)
  if (firstDiff) console.log(`  first difference: car ${firstDiff.car} field '${firstDiff.field}': ${firstDiff.a} vs ${firstDiff.b}`)
  check('camera state also reproduces identically', setup2.camera.x === setup1.camera.x && setup2.camera.y === setup1.camera.y)

  await checkNewStates()
  await checkStateOneOscillator()
  await checkStateFourFiveDriftGate()
  await checkRespawnSidewaysOffset()
  await checkRespawnFields()
  await checkControlLock()
  await checkDrawnFlag()
await checkDropIn()
  await checkKidModifierTuning()
  await checkRound9Deactivation()
  await checkTileAnimations()

  console.log(bad ? `${bad} check(s) failed` : `check-play: camera regimes match 5126-5186 on both axes and a settled camera tracks its target with no oscillation; car-car collision matches 5921/5960's dx sign and pairing order (two cars forced together separate, not glued); the HUD ranks by racePosition (not array index), swaps to the finish flag, uses its own narrower recolour mask, and now draws the RUFFTRUX countdown (wired, real data) and the two-car light bar (drawing proven correct, data source not wired -- docs/engine.md §9p); spawn+camera+ai+physics run clean for ${N} steps; input.js's own recorder/tape-reader reproduce the identical final state; states 1/4/5/E reach their documented end`)
  process.exitCode = bad ? 1 : 0
}

main()
