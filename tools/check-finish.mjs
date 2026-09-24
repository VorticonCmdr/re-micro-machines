// Can every race actually be finished, and does it resolve? (docs/engine.md §9ah) -- the check that
// would have caught the round-1 ramp (no car could clear the jump), the round-3 drop-in owner
// deadlock and the round-8 wall-stuck loop, all of which left races running forever. All 29 races,
// four-car one-player format, drones on the AI, car 0 driven by the SAME AI with its own (human)
// tuning, until the real race-over path (`raceState.raceOver`: [26C6] >= 2 plus the [26CC]
// countdown) fires. Reports the steps taken and car 0's place.
//   node tools/check-finish.mjs
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseStrtPos } from '../src/formats/globaldata.js'
import { loadWorld, loadBrk, roundCtx, spawnCars } from '../src/engine/race.js'
import { runStep } from '../src/engine/step.js'
import { droneControlByte } from '../src/engine/ai.js'
import { initCameraState } from '../src/engine/camera.js'
import { RACES_PER_ROUND } from '../src/data/catalog.js'
import { RUFF_TRUCK_TIMES, checkpointList } from '../src/data/engine-tables.js'
import { lapLineSegments } from '../src/engine/lapLine.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = async (n) => new Uint8Array(readFileSync(join(ROOT, 'game', n)))
const CAP = 40000

let bad = 0
const strt = parseStrtPos(await read('GAME1/STRT_POS.BIN'))
for (let round = 1; round <= 9; round++) {
  for (let race = 1; race <= RACES_PER_ROUND[round]; race++) {
    const cars = spawnCars(strt, round, race)
    const world = await loadWorld(read, round, race)
    const ctx = { ...roundCtx(round, race), brk: round === 9 ? undefined : await loadBrk(read, round, race), tournamentIndex: 0, world }
    if (round === 9) ctx.ruffTruxTime = RUFF_TRUCK_TIMES[race - 1]
    const camera = initCameraState(strt.find((s) => s.round === round && s.race === race))
    ctx.camera = camera
    const rs = {}
    let steps = 0
    while (!rs.raceOver && steps < CAP) {
      runStep(world, cars, cars.map((c) => (c.active ? droneControlByte(c, ctx) : 0)), rs, ctx)
      steps++
    }
    const result = round === 9 ? (cars[0].state === 0xf ? '1 Up!' : 'Failed') : `car 0 ${rs.rankOrder?.indexOf(0) + 1}`
    const line = `ROUND${round}${race}: ${rs.raceOver ? `ended after ${steps} steps (${(steps / 35).toFixed(0)} s), ${result}` : `NEVER ENDED in ${CAP} steps (laps ${cars.map((c) => c.lapsRemaining).join('')}, states ${cars.map((c) => c.state.toString(16)).join(',')})`}`
    console.log(`  ${line}`)
    if (!rs.raceOver) { bad++; console.log(`FAIL: ROUND${round}${race} never resolves`) }
  }
}
// The same for the two-car format (one-player Head-to-Head vs CPU, docs/engine.md §9am), rounds 1-8
// (the H2H never reaches the round-9 bonus race): a two-car race ends ONLY at the end of a knockout
// exchange ([26C6]=2 at 76F2/772A/7742), so this catches a match that could never be decided. Car 0
// is AI-driven with its own (human) tuning, car 1 by the drone AI, exactly as above.
for (let round = 1; round <= 8; round++) {
  for (let race = 1; race <= RACES_PER_ROUND[round]; race++) {
    const cars = spawnCars(strt, round, race, { raceFormat: 2 })
    const world = await loadWorld(read, round, race)
    const camera = initCameraState(strt.find((s) => s.round === round && s.race === race))
    const ctx = { ...roundCtx(round, race, { raceFormat: 2 }), brk: await loadBrk(read, round, race), tournamentIndex: 0, world, camera }
    const rs = {}
    let steps = 0
    let points = 0
    while (!rs.raceOver && steps < CAP) {
      const before = rs.twoCar?.score
      runStep(world, cars, cars.map((c) => (c.active ? droneControlByte(c, ctx) : 0)), rs, ctx)
      if (before !== undefined && rs.twoCar.blink === 0 && rs.twoCar.score !== before) points++
      steps++
    }
    const m = rs.twoCar
    const line = rs.raceOver
      ? `ended after ${steps} steps (${(steps / 35).toFixed(0)} s), ${rs.rankOrder[0] === 0 ? 'won' : 'lost'} -- bar ${m.score}, laps ${cars[0].lapsRemaining}/${cars[1].lapsRemaining}, [2630]=${m.winnerSide}`
      : `NEVER ENDED in ${CAP} steps (bar ${m.score}, laps ${cars[0].lapsRemaining}/${cars[1].lapsRemaining}, states ${cars[0].state.toString(16)},${cars[1].state.toString(16)}, [2911]=${rs.knockoutRequest}, spotlight ${m.spotlight})`
    console.log(`  two-car ROUND${round}${race}: ${line}`)
    if (!rs.raceOver) { bad++; console.log(`FAIL: two-car ROUND${round}${race} never resolves`) }
  }
}

// The RUFFTRUX bonus race's AI-driven runs above always end "Failed": the drone AI (which the real
// game never runs in round 9 -- there is no .BRK and only the player drives) cuts a corner into a
// pond on every map. So prove the WIN path on the real maps directly: car 0 on its last lap (3 left,
// every checkpoint passed: cursor on the terminator, 2*len bytes) parked on the numbered cell just
// behind the start/finish edge, driving north across it with accelerate held throughout. The
// crossing (3 -> 2) must latch the clock, the car must coast to a stop and reach state F ("1 Up!"),
// and the race must then end through the countdown as a win -- before the clock would have expired.
for (let race = 1; race <= 3; race++) {
  const world = await loadWorld(read, 9, race)
  const edge = lapLineSegments(world.map).find((e) => e.horizontal && !e.viaZero)
  const cars = spawnCars(strt, 9, race)
  const c0 = cars[0]
  Object.assign(c0, { state: 0, controlsLocked: 0, heading: 0, speed: 0x300, posX: edge.x + 48, nextX: edge.x + 48, posY: edge.y + 12, nextY: edge.y + 12 })
  c0.progress = c0.progressPrev = world.map.plane2[Math.floor((edge.y + 12) / 96) * 32 + Math.floor((edge.x + 48) / 96)]
  c0.lapsRemaining = 3
  c0.checkpointOff = 2 * checkpointList(9, race).length
  for (const c of cars.slice(1)) { c.state = 0; c.controlsLocked = 0 }
  const ctx = { ...roundCtx(9, race), tournamentIndex: 0, world, ruffTruxTime: RUFF_TRUCK_TIMES[race - 1] }
  const rs = {}
  let steps = 0
  while (!rs.raceOver && steps < 2000) { runStep(world, cars, [0x20, 0, 0, 0], rs, ctx); steps++ }
  const won = rs.raceOver && c0.state === 0xf && rs.ruffTruxLatched === 1 && rs.ruffTruxTimer > 0
  console.log(`  ROUND9${race} bonus win path: ${won ? `crossed, latched with ${rs.ruffTruxTimer} ticks left, stopped in state F, race over after ${steps} steps` : `FAILED (state ${c0.state.toString(16)}, laps ${c0.lapsRemaining}, latched ${rs.ruffTruxLatched}, timer ${rs.ruffTruxTimer})`}`)
  if (!won) { bad++; console.log(`FAIL: ROUND9${race}'s bonus race cannot be won even when the lap is completed`) }
}

console.log(bad ? `${bad} race(s) never resolve` : 'check-finish: every one of the 29 races resolves through the real race-over path with an AI-driven car 0, all 26 two-car races (rounds 1-8) end through a decided match, and the RUFFTRUX bonus race is winnable on all 3 real maps')
process.exitCode = bad ? 1 : 0
