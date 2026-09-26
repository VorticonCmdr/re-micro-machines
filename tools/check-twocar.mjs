// The two-car match (one-player Head-to-Head vs CPU, raceFormat 2) -- docs/engine.md §9am, all
// [STATIC]: every expected value below is read off the disassembly cited next to it, not off this
// port's own output. Part 1 checks each routine in isolation; part 2 runs real races through the
// full `runStep` pipeline (camera trigger -> knockout reset -> hop -> blink -> commit -> 0xD -> 7 ->
// 2 -> 0 -> re-arm) and checks how each kind of race ends and what the tournament would read.
//   node tools/check-twocar.mjs
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseStrtPos } from '../src/formats/globaldata.js'
import { loadWorld, loadBrk, roundCtx, spawnCars } from '../src/engine/race.js'
import { runStep, applySteerAndThrottle, animTimerPass } from '../src/engine/step.js'
import { droneControlByte } from '../src/engine/ai.js'
import { initCameraState, updateCamera } from '../src/engine/camera.js'
import { initTwoCarMatch, resetCarsAfterKnockout, lineUpBothCars, stepExchange, twoCarFinishedCar, twoCarBanners, twoCarFinalOrder, applyScoreSlotGarbage, exitHold855a } from '../src/engine/twocar.js'
import { toI16 } from '../src/engine/int16.js'
import { toBytes } from '../src/engine/car.js'
import { STATE1_ANIM_DEFAULT } from '../src/data/engine-tables.js'
import { runStates } from '../src/engine/states.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = async (n) => new Uint8Array(readFileSync(join(ROOT, 'game', n)))

let bad = 0
let asserted = 0
const distinct = new Set()
function check(name, cond) {
  asserted++
  distinct.add(name)
  if (cond) return
  bad++
  console.log(`FAIL: ${name}`)
}

const mk = (o = {}) => ({ active: 1, present: 1, state: 0, racePosition: 0, posX: 1000, posY: 1000, safeX: 0, safeY: 0, onBridge: 0, speed: 0x300, velX: 5, velY: 5, targetVelX: 5, targetVelY: 5, heading: 0, drawnThisFrame: 1, height: 0, zVel: 0, bounceOnLand: 0, terrainIdx: 0, dropInSlot: 0, lapsRemaining: 3, subState: 0, animTimer: 9, animStep2: 9, camHalfW: 0x80, camHalfH: 0x64, ...o })
const pair = (a = {}, b = {}) => [mk({ playerSlot: 1, ...a }), mk({ playerSlot: 2, ...b }), mk({ playerSlot: 3, active: 0, present: 0 }), mk({ playerSlot: 4, active: 0, present: 0 })]
const fresh = () => { const rs = {}; initTwoCarMatch(rs); rs.rankOrder = [0, 1, 2, 3]; return rs }
const sfxLog = () => { const log = []; return { log, playSfx: (id) => log.push(['play', id]), stopSfx: (id) => log.push(['stop', id]) } }

// ---------------------------------------------------------------------------------------------
// Part 1: each routine against the bytes.
// ---------------------------------------------------------------------------------------------

// Camera midpoint + separation trigger (5053-5106).
{
  const cars = pair({ posX: 1000, posY: 800 }, { posX: 1100, posY: 900 })
  const cam = { x: 900, y: 700, targetX: 0, targetY: 0, stepX: 50, stepY: 50 }
  const rs = fresh()
  updateCamera(cars, cam, { raceFormat: 2, round: 1 }, rs)
  // dx = -100 -> (dx SAR 1) + P2.x - 0x80 = -50 + 1100 - 128; dy likewise with 0x64.
  check('camera: two-car midpoint target (5091-50DD)', cam.targetX === 1100 - 50 - 0x80 && cam.targetY === 900 - 50 - 0x64)
  check('camera: no knockout while inside the window', rs.knockoutRequest === 0)
  cars[1].posX = 1000 + 0xe9
  updateCamera(cars, cam, { raceFormat: 2, round: 1 }, rs)
  check('camera: |dx| > 0xE8 requests a knockout (5089)', rs.knockoutRequest === 1)
  check('camera: ...and leaves the target where it was (JMP 510A)', cam.targetX === 1100 - 50 - 0x80)
  cars[1].posX = 1000 + 0xe8
  cars[1].posY = 800 - 0xb1
  rs.knockoutRequest = 2
  updateCamera(cars, cam, { raceFormat: 2, round: 1 }, rs)
  check('camera: |dx| == 0xE8 is inside; |dy| > 0xB0 is out, but [2911]==2 is not overwritten (507F/50CA)', rs.knockoutRequest === 2)
  // Across the world seam: 10 and 0xC00-10 are 20 apart.
  const seam = pair({ posX: 10, posY: 500 }, { posX: 0xc00 - 10, posY: 500 })
  const rs2 = fresh()
  updateCamera(seam, cam, { raceFormat: 2, round: 1 }, rs2)
  // Folded dx = 20, so the midpoint is 0x0BF6 + 10 = 0xC00 -> 0, minus 0x80 -> -0x80 -> +0xC00 (50E5).
  check('camera: the fold at 0xB18 makes the window toroidal (5065), the midpoint wraps (50E0)', rs2.knockoutRequest === 0 && cam.targetX === 0xc00 - 0x80)
  // [27B5] = 2 follows car 1 alone (the scorer during an exchange, 7825).
  const rs3 = fresh()
  rs3.cameraIndex = 2
  const far = pair({ posX: 100 }, { posX: 900 })
  updateCamera(far, cam, { raceFormat: 2, round: 1 }, rs3)
  check('camera: [27B5]=2 follows car 1 alone, no trigger', cam.targetX === 900 - 0x80 && rs3.knockoutRequest === 0)
}

// Knockout reset, no-fall branch (7778-77D7 + tail).
{
  const snd = sfxLog()
  const cars = pair({ racePosition: 1, safeX: 11, safeY: 12 }, { racePosition: 2, safeX: 21, safeY: 22 })
  const rs = fresh()
  rs.knockoutRequest = 1
  const cam = { stepX: 50, stepY: 50 }
  resetCarsAfterKnockout(cars, rs, { round: 1, camera: cam, sound: snd })
  check('reset: leader P1 scores', rs.twoCar.spotlight === 0 && cars[0].state === 0xb && cars[1].state === 0xc)
  check('reset: both knockoutX/Y snapshot the positions (7786/77A8)', cars[0].knockoutX === 1000 && cars[1].knockoutY === 1000)
  check('reset: [2911]=2 (77B8), camera on the scorer, steps 4 (7825-7832)', rs.knockoutRequest === 2 && rs.cameraIndex === 1 && cam.stepX === 4 && cam.stepY === 4)
  check('reset: the other car takes the scorer\'s safe point (7864)', cars[1].safeX === 11 && cars[1].safeY === 12 && cars[0].safeX === 11)
  check('reset: motion zeroed on both, speed zeroed on all 4 (7840/7864/7AF8)', cars.every((c) => c.speed === 0) && cars[0].velX === 0 && cars[1].targetVelY === 0 && cars[2].velX === 5)
  check('reset: the scorer hops (7805-7813)', cars[0].zVel === 0x14 && cars[0].height === 0 && cars[0].bounceOnLand === 1)
  check('reset: AH=8 AL=0..8, then sfx 10 because the scorer is drawn (7893-78E7)', snd.log.filter((e) => e[0] === 'stop').length === 9 && snd.log.at(-1)[1] === 0x0a)

  const tie = pair({ racePosition: 1 }, { racePosition: 1 })
  const rsT = fresh(); rsT.knockoutRequest = 1
  resetCarsAfterKnockout(tie, rsT, { round: 1 })
  check('reset: a racePosition tie goes to P1 (77CA JG)', rsT.twoCar.spotlight === 0)

  const notRacing = pair({ racePosition: 1, state: 5 }, { racePosition: 2, state: 0 })
  const rsN = fresh(); rsN.knockoutRequest = 1
  resetCarsAfterKnockout(notRacing, rsN, { round: 1 })
  check('reset: a leader not in state 0 hands the point to the other car (77D0)', rsN.twoCar.spotlight === 1 && notRacing[1].state === 0xb && notRacing[0].state === 0xc)

  const early = pair({ state: 0xb, posX: 7 }, { state: 0xc })
  const rsE = fresh(); rsE.knockoutRequest = 1
  resetCarsAfterKnockout(early, rsE, { round: 1 })
  check('reset: returns early when P2 is already 0xC, after refreshing P1\'s knockoutX (779E)', rsE.knockoutRequest === 1 && rsE.twoCar.spotlight === null && early[0].knockoutX === 7)

  const noHop = pair({ racePosition: 1, terrainIdx: 5 }, { racePosition: 2 })
  const rsH = fresh(); rsH.knockoutRequest = 1
  resetCarsAfterKnockout(noHop, rsH, { round: 2 })
  check('reset: no hop in round 2 on terrain 5 (7805)', noHop[0].zVel === 0)
}

// Knockout reset, fall branch (7759-7776): the [2682] car scores, [2911] stays 1.
{
  const cars = pair({ racePosition: 1 }, { racePosition: 2, state: 0 })
  const rs = fresh()
  rs.knockoutRequest = 1
  rs.fallLatch = 1
  resetCarsAfterKnockout(cars, rs, { round: 3 })
  check('reset (fall): the latched car scores even when trailing', rs.twoCar.spotlight === 1 && cars[1].state === 0xb && cars[0].state === 0xc)
  check('reset (fall): [2911] left at 1, [2682] cleared, no knockoutX snapshot', rs.knockoutRequest === 1 && rs.fallLatch === null && cars[0].knockoutX === undefined)
}

// The exchange block (75C2-7758): arm, blink cadence, commit.
{
  const cars = pair({ racePosition: 1 }, { racePosition: 2 })
  const rs = fresh()
  rs.twoCar.spotlight = 0
  const ctx = { round: 1 }
  stepExchange(1, cars, rs, ctx)
  check('exchange: only the scorer\'s slot runs the block (75DC)', rs.twoCar.blink === 0)
  stepExchange(0, cars, rs, ctx)
  check('exchange: arm -- [26BA]=0x40, both cars 0xC, shadow = score+1 for P1 (75EC-762D)', rs.twoCar.blink === 0x40 && cars[0].state === 0xc && cars[1].state === 0xc && rs.twoCar.shadow === 5)
  const shown = []
  for (let i = 0; i < 64; i++) { stepExchange(0, cars, rs, ctx); shown.push(rs.twoCar.score) }
  const expect = []
  for (let i = 0; i < 63; i++) expect.push(Math.floor(i / 8) % 2 === 0 ? 5 : 4)
  check('exchange: the bar flashes new/old every 8 steps (763A-7650)', shown.slice(0, 63).every((v, i) => v === expect[i]))
  check('exchange: commit -- P1 scores, 4 -> 5 (76E3)', rs.twoCar.score === 5 && rs.twoCar.spotlight === null)
  check('exchange: commit -- both cars 0xD, animTimer/animStep2 0, [2911]=2, camera back to midpoint (7684-76BC/767B)', cars.slice(0, 2).every((c) => c.state === 0xd && c.animTimer === 0 && c.animStep2 === 0) && rs.knockoutRequest === 2 && rs.cameraIndex === 0)
  check('exchange: commit -- P1 still racing, so the post-exchange Bonus slide arms (7669-7675)', rs.twoCar.bannerMode === 1 && rs.twoCar.bannerX === 0x80 && rs.twoCar.bannerY === 0x7c)
  check('exchange: commit -- the race goes on', rs.raceOverCount === undefined && rs.twoCar.matchOpen)
}
for (const [scorer, from, to] of [[0, 7, 8], [1, 1, 0]]) {
  const cars = pair({ racePosition: 1 }, { racePosition: 2 })
  const rs = fresh()
  rs.twoCar.score = from
  rs.twoCar.spotlight = scorer
  for (let i = 0; i < 65; i++) stepExchange(scorer, cars, rs, { round: 1 })
  check(`exchange: P${scorer + 1} scores ${from} -> ${to} and the match ends ([26C4] taken, [26C6]=2)`, rs.twoCar.score === to && !rs.twoCar.matchOpen && rs.raceOverCount === 2)
}
{
  // The scorer has already finished its laps: the match ends on this point, no INC (76D6 JLE 76EE).
  const cars = pair({ lapsRemaining: 0 }, {})
  const rs = fresh()
  rs.twoCar.score = 5
  rs.twoCar.spotlight = 0
  for (let i = 0; i < 65; i++) stepExchange(0, cars, rs, { round: 1 })
  check('exchange: a scorer with no laps left ends the match without moving the bar (76EE)', rs.twoCar.score === 5 && rs.raceOverCount === 2 && rs.twoCar.bannerMode === 0)
}

// The finished-car block (4BE7-4CFE).
{
  const rs = fresh(); rs.twoCar.score = 5
  check('finish block: bar 5 credits P1 and skips control', twoCarFinishedCar(rs) === true && rs.twoCar.spotlight === 0 && rs.rankOrder.join() === '0,2,1,3' && rs.twoCar.bannerMode === 0xc8 && !rs.twoCar.matchOpen)
  rs.twoCar.spotlight = null
  check('finish block: one-shot -- a second finished car only skips control (4BF9 JNZ)', twoCarFinishedCar(rs) === true && rs.twoCar.spotlight === null)
  const rs2 = fresh(); rs2.twoCar.score = 3
  twoCarFinishedCar(rs2)
  check('finish block: bar 3 credits P2, order [2,0,1,3] (4C54-4C84)', rs2.twoCar.spotlight === 1 && rs2.rankOrder.join() === '2,0,1,3')
  const rs3 = fresh()
  const xs = []
  let modes = new Set()
  for (let i = 0; i < 160 && rs3.twoCar.bannerMode !== 0xc8; i++) { check('finish block: a tied bar keeps the car in the control path', twoCarFinishedCar(rs3) === false); xs.push(rs3.twoCar.bannerX); modes.add(rs3.twoCar.bannerMode) }
  const holdSteps = xs.filter((x) => x === 0x80).length
  check('Play Off: enters at 0x158 and slides left 8 per step (4CBE/4CDF)', xs[0] === 0x150 && xs[1] === 0x148)
  check('Play Off: holds at centre while [26C2] counts 3..0x64 (4CE6)', holdSteps === 0x64 - 3)
  check('Play Off: parks at 0xC8 once past -0x58 (4CFE), never touching the score', rs3.twoCar.bannerMode === 0xc8 && rs3.twoCar.score === 4 && rs3.twoCar.matchOpen)
}

// Post-HUD banners (851F/855A/8634).
{
  const cars = pair({}, {})
  const rs = fresh()
  rs.twoCar.spotlight = 0
  cars[0].state = 0xb; cars[1].state = 0xc
  twoCarBanners(cars, rs, { round: 1 })
  check('851F: the scorer spins +8 and a non-deciding point shows Bonus at (0x80,0x7C)', cars[0].heading === 8 && rs.twoCar.banners.length === 1 && rs.twoCar.banners[0].index === 0 && rs.twoCar.banners[0].cy === 0x7c)
  check('851F/855A: 7AF8 zeroes all four speeds', cars.every((c) => c.speed === 0))
  // A deciding point: P1 from 7, blink running (score+shadow == 15).
  const d = pair({}, {})
  const rsD = fresh()
  rsD.twoCar.spotlight = 0; rsD.twoCar.score = 7; rsD.twoCar.shadow = 8
  d[0].state = 0xc; d[1].state = 0xc
  const ys = []
  for (let i = 0; i < 22; i++) { twoCarBanners(d, rsD, { round: 1 }); ys.push(rsD.twoCar.banners[0]?.cy) }
  check('855A: a deciding point slides Winner down from -16 by 8 to 124 (85C1-85E5)', ys[0] === -16 && ys[1] === -8 && ys[17] === 120 && ys[18] === 124 && ys[21] === 124 && rsD.twoCar.banners[0].index === 1)
  check('855A: [2630]=1 (P1) and [2621] hides P2 (8606-8620)', rsD.twoCar.winnerSide === 1 && rsD.twoCar.hiddenCar === 1)
  check('855A: P2 in 0xC skips 8634 even though [26C2]!=0', rsD.twoCar.banners.length === 1)
  // The finish block already decided the match ([26C2]=0xC8): the next exchange's 855A slides Winner.
  const f = pair({}, {})
  const rsF = fresh()
  rsF.twoCar.spotlight = 1; rsF.twoCar.score = 3; rsF.twoCar.shadow = 2; rsF.twoCar.bannerMode = 0xc8
  f[0].state = 0xc; f[1].state = 0xc
  twoCarBanners(f, rsF, { round: 1 })
  check('855A: [26C2]==0xC8 goes straight to the Winner slide for P2 ([2630]=2)', rsF.twoCar.winnerSide === 2 && rsF.twoCar.hiddenCar === 0 && rsF.twoCar.banners[0].index === 1)
  // After an exchange, 8634 slides Bonus out to the left.
  const b = pair({ state: 0xd }, { state: 0xd })
  const rsB = fresh()
  rsB.twoCar.bannerMode = 1; rsB.twoCar.bannerX = 0x80; rsB.twoCar.bannerY = 0x7c
  twoCarBanners(b, rsB, { round: 1 })
  twoCarBanners(b, rsB, { round: 1 })
  check('8634: the post-exchange Bonus slides left 8 per frame (863B)', rsB.twoCar.banners[0].index === 0 && rsB.twoCar.banners[0].cx === 0x70)
}

// The re-line-up (78F8) and the exit fix-up (3115-3156).
{
  const cars = pair({ state: 1 }, { state: 7 })
  const rs = fresh(); rs.bothDown = 1
  lineUpBothCars(cars, rs)
  check('78F8: P1 still dying -> the recovered P2 is hidden (791E)', cars[1].active === 0 && rs.bothDown === 1)
  cars[0].state = 7
  cars[0].racePosition = 2; cars[1].racePosition = 1
  cars[1].safeX = 55; cars[1].safeY = 66; cars[1].onBridge = 1
  lineUpBothCars(cars, rs)
  check('78F8: both recovered -> the trailing car takes the leader\'s safe point, both respawn (797A-79F6)', cars[0].safeX === 55 && cars[0].onBridge === 1 && cars.slice(0, 2).every((c) => c.state === 7 && c.active === 1) && rs.bothDown === 0 && rs.knockoutRequest === 0)

  const rs2 = fresh()
  rs2.rankOrder = [0, 2, 1, 3]
  rs2.twoCar.winnerSide = 2
  check('exit fix-up: [2630]=2 forces slots 0/1 to [2,0] (3150)', twoCarFinalOrder(rs2).join() === '2,0,1,3')
  rs2.twoCar.winnerSide = 1; rs2.rankOrder = [2, 0, 1, 3]
  check('exit fix-up: [2630]=1 forces [0,2] (3146)', twoCarFinalOrder(rs2).join() === '0,2,1,3')
  rs2.twoCar.winnerSide = 0; rs2.rankOrder = [1, 0, 2, 3]
  check('exit fix-up: [2630]=0 leaves the order alone', twoCarFinalOrder(rs2).join() === '1,0,2,3')
}

// A two-car respawn (6FEB) sets both cars' laps to min(P1, P2) (73B6-73E4), zeroes its own drop-in
// slot (701B), ends the banner slide (7302-7314) and resets the camera step to 8 (7369).
{
  const cars = pair({ state: 7, lapsRemaining: 3, safeX: 500, safeY: 500 }, { state: 0, lapsRemaining: 1 })
  const rs = fresh()
  rs.twoCar.bannerMode = 1; rs.twoCar.bannerX = 0x70
  rs.dropInSlots = { 0: { queue: [cars[0]], waitTicks: 30 } }
  const cam = { stepX: 50, stepY: 50 }
  runStates(cars, rs, { round: 1, race: 1, raceFormat: 2, camera: cam })
  check('respawn: laps := min(P1, P2) on both cars (73B6)', cars[0].lapsRemaining === 1 && cars[1].lapsRemaining === 1)
  check('respawn: the car\'s drop-in slot is zeroed (701B), the banner slide ends (7302), camera step 8 (7369)', rs.dropInSlots[0].queue.length === 0 && rs.dropInSlots[0].waitTicks === 0 && rs.twoCar.bannerMode === 0 && cam.stepX === 8 && cam.stepY === 8)
}

// ---------------------------------------------------------------------------------------------
// Part 2: real races through the full runStep pipeline.
// ---------------------------------------------------------------------------------------------

const strt = parseStrtPos(await read('GAME1/STRT_POS.BIN'))
async function setup(round, race) {
  const cars = spawnCars(strt, round, race, { raceFormat: 2 })
  const world = await loadWorld(read, round, race)
  const camera = initCameraState(strt.find((s) => s.round === round && s.race === race))
  const ctx = { ...roundCtx(round, race, { raceFormat: 2 }), brk: await loadBrk(read, round, race), tournamentIndex: 0, world, camera, stepIncrement: 1 }
  return { cars, world, camera, ctx, rs: {} }
}
const aiControls = (r) => r.cars.map((c) => (c.active ? droneControlByte(c, r.ctx) : 0))
const step = (r, controls = aiControls(r)) => runStep(r.world, r.cars, controls, r.rs, r.ctx)
const slow = (car, k) => { car.maxSpeedBase = Math.round(car.maxSpeedBase / k); car.maxSpeedCur = car.maxSpeedBase }
const sep = (r) => ({ dx: Math.abs(toI16(((r.cars[0].posX - r.cars[1].posX + 0x600) % 0xc00 + 0xc00) % 0xc00 - 0x600)), dy: Math.abs(toI16(((r.cars[0].posY - r.cars[1].posY + 0x600) % 0xc00 + 0xc00) % 0xc00 - 0x600)) })

// (a) One full exchange, then the whole match, on ROUND11 with the CPU slowed so car 0 pulls away.
{
  const r = await setup(1, 1)
  slow(r.cars[1], 2)
  const events = []
  let prev = { req: 0, s0: r.cars[0].state, score: 4 }
  let firstCycle = null
  let steps = 0
  while (!r.rs.raceOver && steps < 20000) {
    step(r)
    steps++
    const m = r.rs.twoCar
    const cur = { req: r.rs.knockoutRequest, s0: r.cars[0].state, score: m.score }
    if (cur.req !== prev.req) events.push(`${steps}:req${prev.req}->${cur.req}`)
    if (cur.s0 !== prev.s0) events.push(`${steps}:s0 ${prev.s0.toString(16)}->${cur.s0.toString(16)}`)
    if (!firstCycle && prev.req === 2 && cur.req === 0 && m.score === 5) firstCycle = { steps, sep: sep(r), laps: [r.cars[0].lapsRemaining, r.cars[1].lapsRemaining] }
    prev = cur
  }
  const firstEvents = events.slice(0, 12).join(' ')
  // The camera arms [2911]=1 at the tail of physics and the SAME step's render gate consumes it
  // (7759 -> 77B8 =2), so step granularity only ever shows 0 -> 2.
  check(`(a) the first exchange runs the full cycle, req 0->(1)->2->0 and car 0 B->C->D->7->2->0 [${firstEvents}]`, /req0->2 \S+:s0 0->b.*s0 b->c.*s0 c->d.*s0 d->7.*s0 7->2.*req2->0/.test(firstEvents) && firstCycle)
  check('(a) after the exchange the cars are back inside the camera window, laps equalised (73B6)', firstCycle && firstCycle.sep.dx <= 0xe8 && firstCycle.sep.dy <= 0xb0 && firstCycle.laps[0] === firstCycle.laps[1])
  check('(a) the faster car 0 wins the match: the bar reaches 8, Winner decided it ([2630]=1)', r.rs.raceOver && r.rs.twoCar.score === 8 && r.rs.twoCar.winnerSide === 1)
  check('(a) the tournament reads a win: order slot 0 is car 0 after the exit fix-up', r.rs.rankOrder[0] === 0)
  check('(a) the absent car 2 keeps its race-init record (laps 3, progress 0 -- 4371/4359)', r.cars[2].lapsRemaining === 3 && r.cars[2].progress === 0)
  console.log(`  (a) ROUND11: first point after ${firstCycle?.steps} steps; match over after ${steps} steps, bar ${r.rs.twoCar.score}, [2630]=${r.rs.twoCar.winnerSide}`)
}

// (b) The mirror: car 0 heavily handicapped (a halved top speed alone is not enough on ROUND11's
// twisty opening -- car 0's human acceleration 32 vs the CPU's 17 still wins it the early points),
// so the CPU takes the points and the bar reaches 0 -- a loss.
{
  const r = await setup(1, 1)
  slow(r.cars[0], 3)
  r.cars[0].accel = r.cars[1].accel >> 1
  let steps = 0
  while (!r.rs.raceOver && steps < 20000) { step(r); steps++ }
  check('(b) the faster CPU wins: the bar reaches 0 and [2630]=2', r.rs.raceOver && r.rs.twoCar.score === 0 && r.rs.twoCar.winnerSide === 2)
  check('(b) the tournament reads a loss: order slot 0 is not car 0', r.rs.rankOrder[0] !== 0)
  console.log(`  (b) ROUND11 (car 0 slowed): match over after ${steps} steps, bar ${r.rs.twoCar.score}, order ${r.rs.rankOrder.join('')}`)
}

// A settled race to force finishes into: both cars through the start hold (state A, 0x60 steps) and
// racing, with no exchange in flight -- a finish forced mid-blink would see the transient 3/5 score.
async function settled(round, race) {
  const r = await setup(round, race)
  for (let i = 0; i < 110; i++) step(r)
  const m = r.rs.twoCar
  check(`settled ROUND${round}${race}: racing, no exchange in flight`, r.cars[0].state === 0 && r.cars[1].state === 0 && m.spotlight === null && m.blink === 0 && r.rs.knockoutRequest === 0 && m.score === 4)
  return r
}

// (c) The CPU finishes first while P1 leads on the bar: the bar, not the finish, decides (4BF1).
{
  const r = await settled(1, 1)
  r.rs.twoCar.score = 5
  r.cars[1].lapsRemaining = 0
  let steps = 0
  while (!r.rs.raceOver && steps < 3000) { step(r); steps++ }
  check('(c) CPU finished, bar 5: P1 is credited and the race ends through the deciding blink (7742)', r.rs.raceOver && r.rs.twoCar.winnerSide === 1 && r.rs.rankOrder[0] === 0)
  console.log(`  (c) CPU finished while P1 led 5-3: over after ${steps} steps, order ${r.rs.rankOrder.join('')}`)
}

// (d) P1 finishes first while the CPU leads on the bar: a loss despite finishing first.
{
  const r = await settled(1, 1)
  r.rs.twoCar.score = 3
  r.cars[0].lapsRemaining = 0
  let steps = 0
  while (!r.rs.raceOver && steps < 3000) { step(r); steps++ }
  check('(d) P1 finished, bar 3: the CPU is credited -- a loss, and order slot 0 is car 2 (3150)', r.rs.raceOver && r.rs.twoCar.winnerSide === 2 && r.rs.rankOrder[0] === 2)
  check('(d) slot 0\'s car 2 still holds laps 3, progress 0 (the HUD digit and the [2630]==0 fallback read it)', r.cars[2].lapsRemaining === 3 && r.cars[2].progress === 0)
  console.log(`  (d) P1 finished while the CPU led 3-5: over after ${steps} steps, order ${r.rs.rankOrder.join('')}`)
}

// (e) P1 finishes on a tied bar: Play Off, racing goes on, and the next exchange decides.
{
  const r = await settled(1, 1)
  slow(r.cars[1], 2)
  r.cars[0].lapsRemaining = 0
  let steps = 0
  let sawPlayOff = false
  let raceWentOn = false
  while (!r.rs.raceOver && steps < 20000) {
    step(r)
    steps++
    if (r.rs.twoCar.banners.some((b) => b.index === 2)) sawPlayOff = true
    if (steps === 50 && !r.rs.raceOver && r.cars[0].speed !== 0) raceWentOn = true
  }
  check('(e) tied at the finish: "Play Off" shows and the finished car keeps racing (4CB0-4D04)', sawPlayOff && raceWentOn)
  check('(e) ...then the next exchange decides the match, and car 0 (faster) wins it', r.rs.raceOver && r.rs.twoCar.winnerSide === 1 && r.rs.rankOrder[0] === 0 && r.rs.twoCar.score === 4)
  console.log(`  (e) tied finish: Play Off, sudden death decided after ${steps} steps, order ${r.rs.rankOrder.join('')}`)
}

// (f) Both cars down at once (5E4E/78F8): no point, the first to recover waits hidden, both respawn.
{
  const r = await settled(1, 1)
  const before = r.rs.twoCar.score
  for (const c of r.cars.slice(0, 2)) { c.state = 1; c.animTimer = 0; c.animStep = 0; c.speed = 0; c.velX = 0; c.velY = 0; c.driftSteps = 0 }
  // Car 1 starts on the table's last real frame, so it recovers first.
  r.cars[1].animStep = STATE1_ANIM_DEFAULT.threshold.indexOf(0xffff) - 1
  r.cars[1].animTimer = 0xfff0
  let hiddenWhileWaiting = false
  let bothRespawned = false
  for (let i = 0; i < 400 && !bothRespawned; i++) {
    step(r)
    if (r.cars[1].active === 0 && r.cars[0].state === 1) hiddenWhileWaiting = true
    if (r.cars[0].state === 0 && r.cars[1].state === 0) bothRespawned = true
  }
  check('(f) both down: [2913] hides the car that recovered first (78F8 791E)', hiddenWhileWaiting)
  check('(f) ...then both respawn together, with no point scored', bothRespawned && r.rs.twoCar.score === before && r.rs.bothDown === 0)
}

// (g) The instant-win cheat (type 1, 36A7-36AD: [26C6]=4, [2635]=1) as game.html now applies it:
// a two-car race exits at once (3081-3088, no [26CC] countdown) and the exit fix-up (3115-313A)
// forces car0/car2/car1/car3 -- unless a Winner pass had already set [2630] (3143-3156 runs after).
{
  const r = await settled(1, 1)
  r.rs.raceOverCount = 4
  r.rs.rankOrder = [0, 2, 1, 3]
  r.rs.cheatWin = true
  step(r)
  check('(g) instant-win cheat: a two-car race ends on the very next step, player first', r.rs.raceOver && r.rs.rankOrder.join() === '0,2,1,3')
  const rs = fresh(); rs.cheatWin = true; rs.rankOrder = [1, 0, 2, 3]; rs.twoCar.winnerSide = 2
  check('(g) ...but a [2630]=2 left by a Winner pass still wins over it (3150 runs after 313A)', twoCarFinalOrder(rs).join() === '2,0,1,3')
}

// (g4) The same cheat in a FOUR-car race: 3115-313A is not format-gated, so even if the ranking moves
// during the [26CC] countdown (the 4B85 recount can drop [26C6] below 2), the exit re-forces
// car0/car2/car1/car3.
{
  const cars = spawnCars(strt, 1, 1)
  const world = await loadWorld(read, 1, 1)
  const ctx = { ...roundCtx(1, 1), brk: await loadBrk(read, 1, 1), tournamentIndex: 0, world, camera: initCameraState(strt.find((e) => e.round === 1 && e.race === 1)) }
  const rs = { raceOverCount: 4, rankOrder: [0, 2, 1, 3], cheatWin: true }
  let n = 0
  while (!rs.raceOver && n < 300) { if (n === 50) rs.rankOrder = [3, 2, 1, 0]; runStep(world, cars, [0, 0, 0, 0], rs, ctx); n++ }
  check('(g4) instant-win cheat, four-car: the exit re-forces car0/car2/car1/car3 (3115-313A)', rs.raceOver && rs.rankOrder.join() === '0,2,1,3')
}

// (g5) the exit hold's 855A (30F2-3100, docs/engine.md §9cm): BX drifts (92BC clears BL), so the gate passes on iteration 1 when the exit's camera car is the
// scorer, and on all 100 when that car is P1 (BX 0 == [26B8] 0). A deciding point writes [2630].
{
  const setup = (spotlight, score, shadow) => { const rs = fresh(); Object.assign(rs.twoCar, { spotlight, score, shadow }); return rs }
  let rs = setup(1, 7, 8)
  check('(g5) natural end, P2 scoring the deciding point, camera car 1: one pass, [2630]=2', exitHold855a(pair(), rs, { round: 1 }, 1) === 1 && rs.twoCar.winnerSide === 2)
  rs = setup(0, 8, 7)
  check('(g5) P1 scoring but the camera car is 1 (the midpoint): no pass at all (0x164, then 0x100)', exitHold855a(pair(), rs, { round: 1 }, 1) === 0 && !rs.twoCar.winnerSide)
  rs = setup(0, 8, 7)
  const cs = pair({ heading: 0x10 })
  check('(g5) camera car 0 and P1 the scorer: all 100 iterations pass (BX stays 0)', exitHold855a(cs, rs, { round: 8 }, 0) === 100 && rs.twoCar.winnerSide === 1)
  check('(g5) ...and in round 8 the scorer spins 8/256 on each (8573)', cs[0].heading === ((0x10 + 800) & 0xff))
  rs = setup(1, 4, 5)
  check('(g5) a non-deciding point takes the "Bonus" path: one pass, [2630] untouched', exitHold855a(pair(), rs, { round: 1 }, 1) === 1 && !rs.twoCar.winnerSide)
  rs = setup(null, 7, 8)
  check('(g5) no exchange ([26B8]="none", the literal 1): never passes', exitHold855a(pair(), rs, { round: 1 }, 0) === 0)
}
{
  // Through runStep: the instant-win cheat ends the race while P2's deciding point blinks with the
  // camera on P2 ([27B5]=2) -- the exit's 855A pass writes [2630]=2 and the fix-up turns the cheat
  // into a loss (slot 0 = car 2).
  const strt = parseStrtPos(await read('GAME1/STRT_POS.BIN'))
  const cars = spawnCars(strt, 1, 1, { raceFormat: 2 })
  const world = await loadWorld(read, 1, 1)
  const ctx = { ...roundCtx(1, 1, { raceFormat: 2 }), brk: await loadBrk(read, 1, 1), tournamentIndex: 0, world, camera: initCameraState(strt.find((e) => e.round === 1 && e.race === 1)) }
  const rs = {}
  runStep(world, cars, [0, 0, 0, 0], rs, ctx)
  Object.assign(rs.twoCar, { spotlight: 1, score: 7, shadow: 8 })
  rs.cameraIndex = 2
  rs.raceOverCount = 4
  rs.cheatWin = true
  runStep(world, cars, [0, 0, 0, 0], rs, ctx)
  check(`(g5) cheat exit during P2's deciding blink, camera on P2: the exit hold's 855A makes it a loss (slot 0 = ${rs.rankOrder?.[0]})`, rs.raceOver && rs.rankOrder[0] === 2 && rs.twoCar.winnerSide === 2)
}

// (g6) A double fall (UNKNOWN_rematch_fail_stale_2682, docs/engine.md §9cm), forced through the real
// per-step pipeline on two-car ROUND31: P1's fall exchange, then [2682]=P2 and [2911]=1 again.
// Mid-blink the fall branch (no 0xC guard) re-targets the exchange -- [26B8]=P2, states C/B -- but
// the blink is not re-armed: it resumes where it was, swapping P1's shadow (score+1), makes its 8
// swaps in all and commits the CURRENT scorer's point, so P1's point is lost and P2 gains one. During
// the re-appear it is a clean second exchange. (Neither window is reachable in play: see §9cm.)
{
  const strt = parseStrtPos(await read('GAME1/STRT_POS.BIN'))
  const world = await loadWorld(read, 3, 1)
  const brk = await loadBrk(read, 3, 1)
  const run = (when) => {
    const cars = spawnCars(strt, 3, 1, { raceFormat: 2 })
    const ctx = { ...roundCtx(3, 1, { raceFormat: 2 }), brk, tournamentIndex: 0, world, camera: initCameraState(strt.find((e) => e.round === 3 && e.race === 1)) }
    const rs = {}
    for (let i = 0; i < 120; i++) runStep(world, cars, [0, 0, 0, 0], rs, ctx)
    const start = rs.twoCar.score
    rs.fallLatch = 0; rs.knockoutRequest = 1
    let fired = null
    for (let t = 0; t < 800; t++) {
      if (fired == null && when(rs, cars)) { fired = rs.twoCar.blink; rs.fallLatch = 1; rs.knockoutRequest = 1 }
      runStep(world, cars, [0, 0, 0, 0], rs, ctx)
      if (fired != null && cars[0].state === 0 && cars[1].state === 0 && rs.knockoutRequest === 0) break
    }
    return { start, end: rs.twoCar.score, fired, states: cars.slice(0, 2).map((c) => c.state), spot: rs.twoCar.spotlight }
  }
  const mid = run((rs) => rs.twoCar.blink === 40)
  check(`(g6) mid-blink double fall: the blink resumes (not re-armed) and only P2's point counts (${mid.start} -> ${mid.end})`, mid.fired === 40 && mid.end === mid.start - 1 && mid.states.join() === '0,0')
  const late = run((rs, cars) => cars[0].state === 2)
  check(`(g6) double fall during the re-appear: a clean second exchange, both points count (${late.start} -> ${late.end})`, late.end === late.start && late.states.join() === '0,0' && late.spot === null)
}

// (h) 7429's BX clobber (docs/engine.md §9an): the BX each exchange tick leaves for the pass's
// 73E7/51B2 -- P1 on the arm and plain blink ticks, the bar value on the 8 swap ticks, then P1/P2 per
// commit path -- and the one-step lag of the car the post-commit 73E7 misses.
{
  const cars = pair({}, {})
  const rs = fresh()
  rs.twoCar.spotlight = 1 // P2 scores
  const seq = []
  for (let i = 0; i < 65; i++) seq.push(stepExchange(1, cars, rs, { round: 1 }))
  const swaps = seq.map((b, i) => (typeof b === 'object' ? i : -1)).filter((i) => i >= 0)
  check('BX: arm returns P1 (75F2) even when P2 scores', seq[0] === 0)
  check('BX: the 8 swap ticks return the bar value just shown (7645), at A+1+8j', swaps.join() === '1,9,17,25,33,41,49,57' && seq[1].scoreSlot === 3 && seq[9].scoreSlot === 4)
  check('BX: plain blink ticks return P1 (7633)', seq[2] === 0 && seq[63] === 0)
  check('BX: the P2 commit returns P2 (770A)', seq[64] === 1)
  // The lag, through the pass's own 73E7 on cars[bx] (step.js animTimerPass): the commit zeroes both
  // timers inside car 1's iteration, after car 0's own bump already ran.
  const commitPass = (spot) => {
    const cs = pair({}, {}); const r = fresh(); r.twoCar.spotlight = spot
    for (let i = 0; i < 64; i++) stepExchange(spot, cs, r, { round: 1 })
    for (let i = 0; i < 2; i++) { const bx = i === spot ? stepExchange(i, cs, r, { round: 1 }) : i; animTimerPass(cs[bx], bx, { round: 1 }) }
    return cs.slice(0, 2).map((c) => c.animTimer)
  }
  check('BX: after the P2 commit car 0 -- whose own pass already ran -- lags car 1 by a step', commitPass(1).join() === '0,1')
  check('BX: after the P1 commit (76D2, in car 0\'s own iteration) both cars are bumped once and nobody lags', commitPass(0).join() === '1,1')
}
{
  // The swap-tick pass on BX = k, byte-exact on car 0's record (73E7 + 51B2 transcription).
  const c0 = pair({ state: 0xc, animTimer: 4, puffCooldown: 0, hitLeft: 1, driftDY: 7, driftSteps: 3, nextX: 100, nextY: 200 })[0]
  applyScoreSlotGarbage(c0, 2, { round: 1 })
  check('swap-tick k=2: guard = animTimer, INC lands on puffCooldown, the "drift" clears hitLeft and moves nextX/nextY by driftDY/driftSteps', c0.puffCooldown === 1 && c0.hitLeft === 0 && c0.nextX === 107 && c0.nextY === 203 && c0.animTimer === 4 && c0.state === 0xc)
  const k7a = pair({ state: 0xc, offTrackTicks: 0 })[0]
  const before = toBytes(k7a)
  applyScoreSlotGarbage(k7a, 7, { round: 8 })
  const after = toBytes(k7a)
  check('swap-tick k=7 with offTrackTicks 0: 51B2\'s gate word is 0, the record is byte-identical', before.every((v, i) => v === after[i]))
  const k7b = pair({ state: 0xc, offTrackTicks: 5 })[0]
  applyScoreSlotGarbage(k7b, 7, { round: 8 })
  check('swap-tick k=7 with offTrackTicks 5: 51B2 decrements the misaligned gate word, offTrackTicks 5 -> 4 and pad byte 0x161 -> 0xFF', k7b.offTrackTicks === 4 && k7b.pad13A6[5] === 0xff)
}
{
  // Integration: the lag and the projectile redirect in real runStep exchanges.
  // Run to the first commit of a point scored by `wantScorer` (the bar moves toward its end).
  const firstExchange = async (handicapCar0, wantScorer) => {
    const r = await setup(1, 1)
    if (handicapCar0) { slow(r.cars[0], 3); r.cars[0].accel = r.cars[1].accel >> 1 } else slow(r.cars[1], 2)
    let n = 0
    let bothD = false
    let prevScore = 4
    for (; n < 20000 && !r.rs.raceOver; n++) {
      const scoreBefore = r.rs.twoCar?.score ?? 4
      step(r)
      const nowBothD = r.cars[0].state === 0xd && r.cars[1].state === 0xd
      if (nowBothD && !bothD) {
        const moved = r.rs.twoCar.score - prevScore
        prevScore = r.rs.twoCar.score
        if ((wantScorer === 0 && moved === 1) || (wantScorer === 1 && moved === -1)) break
      } else if (!nowBothD && !r.rs.twoCar.blink) prevScore = scoreBefore
      bothD = nowBothD
    }
    const leftD = [null, null]
    for (let i = 1; i < 100 && (leftD[0] === null || leftD[1] === null); i++) {
      step(r)
      for (const c of [0, 1]) if (leftD[c] === null && r.cars[c].state !== 0xd) leftD[c] = i
    }
    return { scorer: r.rs.twoCar.score, leftD }
  }
  const p2 = await firstExchange(true, 1)
  check(`lag: after a point scored by P2 (bar now ${p2.scorer}), car 0 leaves 0xD exactly one step after car 1 (${p2.leftD})`, p2.leftD[0] !== null && p2.leftD[0] === p2.leftD[1] + 1)
  const p1 = await firstExchange(false, 0)
  check(`lag: after a point scored by P1 (bar now ${p1.scorer}), both cars leave 0xD on the same step (${p1.leftD})`, p1.leftD[0] !== null && p1.leftD[0] === p1.leftD[1])

  const r = await setup(1, 1)
  slow(r.cars[0], 3); r.cars[0].accel = r.cars[1].accel >> 1
  let n = 0
  while (!(r.rs.twoCar?.blink === 0x3e && r.rs.twoCar?.spotlight === 1) && n < 5000) { step(r); n++ }
  r.cars[0].reloadCooldown = 50; r.cars[1].reloadCooldown = 50
  step(r)
  // Each also loses one to the render's own 8712 (docs/engine.md §9cr), which the redirect doesn't touch.
  check('redirect: while P2 scores, car 1\'s projectile flight is frozen and car 0\'s runs twice (51B2 on BX=P1)', r.cars[1].reloadCooldown === 49 && r.cars[0].reloadCooldown === 47)
}

// `ctx.drawnTick` (docs/engine.md §9ap 3, 4): 7d74's own [2621] hidden-car write is inside 7D73, so
// like every other write of this flag it only happens on a drawn tick -- step.js gates it the same
// way markDrawn gates its own write.
{
  const r = await setup(1, 1)
  initTwoCarMatch(r.rs)
  r.rs.twoCar.hiddenCar = 0
  r.cars[0].drawnThisFrame = 1
  r.ctx.drawnTick = false
  step(r)
  check('ctx.drawnTick===false: the hidden-car write (7d74) is skipped, stays sticky', r.cars[0].drawnThisFrame === 1)
  r.cars[0].drawnThisFrame = 1
  r.ctx.drawnTick = true
  step(r)
  check('ctx.drawnTick===true: the hidden-car write (7d74) runs, forces 0', r.cars[0].drawnThisFrame === 0)
}

// Two-human Head to Head (GOAL-DOS-PARITY.md P4, docs/engine.md §9bf): `spawnCars`'s own
// `car.isDrone` field now reflects `controllerTypes[i]===6` (the real `[BX+0x12EB]` flag,
// `InitRaceCarsFromTables 41D0-421A`), not car index. FOUR real readers were checked against
// `DS:09BA`'s own H2H track list (`04 0A 11 0D 1C 21 14 19` decodes, `round<<2|race-1` like
// `DS:043C`, to rounds 1,2,4,3,7,8,5,6 -- rounds 1-8, NOT round 9, so round 7 IS reachable in H2H):
//  - `4D3D` fire-preempt: reachable and REAL (a human car 1 is not exempt; proven below).
//  - `4EE7` TANKS steer-mod ([28BF]==7 only, no format gate at 4ee0): reachable, since round 7
//    is H2H track index 4 (byte 0x1C). A human car 1 at speed>=0x320 halves its steer step; a
//    drone always adds 1. Proven below with ctx.round=7.
//  - `collide.js`'s own `5C84` wall-stuck counter: checked, no format gate at all (5c70-5c89
//    tests only [BX+12a8]/[BX+12eb]) -- reachable in every race, one and two-car alike.
//  - `4D2F` finished-coast: NOT reachable in H2H -- `applySteerAndThrottle`'s own
//    `fourCar = ctx.raceFormat!==2` gates it off for every car regardless of drone status, and
//    two-human H2H is always raceFormat 2.
// All four test `[BX+0x12EB]`, none test car index -- confirming the fix is the right one for
// every REACHABLE consumer, not just the fire-preempt.
//
// Separately (docs/engine.md §9bf, left UNCHANGED, recorded not fixed): `tuningFieldsFor`'s own
// `CMP BX,0` block at `4070` (and everything else in `3FBE-4134`: the already-ported `40A0` accel
// cut, the `4116` race-23 nerf) IS car-INDEX based with no `[2656]` raceFormat check inside it --
// but the WHOLE `3FBE-4134` region only runs when a per-RACE mode fork (`1000:3F30`,
// `CS:[0x9C62]`==`DS:[0x8A2]`) is 0, and two-human H2H's own entry (`1F80`'s `JZ 1FA9` rejecting
// `CX==0` before `[0x8A2]` is ever stored) means that mode ALWAYS takes the fork's OTHER branch,
// `3F3B-3FBD` -- never `4070` at all. So a human P2 does NOT get car slot 1's usual drone tuning
// in two-human H2H; instead every car gets a symmetric alternate tuning (`3F3B`'s own
// per-character-roster-byte formulas) -- now ported and live-DOSBox-proven, `altTuningFieldsFor`,
// see the test section below and docs/engine.md §9bg (was `UNKNOWN_alt_tuning_path`, resolved).
// The rubber band (`4B1C`/`528D`) was checked and is ALSO car-INDEX based, matching `tuningFieldsFor`'s
// own shape; it CANNOT be gated by `[0x8A2]` (that cell's only 2 readers, 3F33/40AF, are both
// inside init-time tuning, nowhere near this per-step physics code) -- whether `4B1C-4B41` has its
// own separate `[2656]` test is the real open question, not checked here.
{
  // [5,4,6,6]: P1 on KEYS2 (fire is P1's own KEYS2 key S, CLAUDE.md), P2 on KEYS1 (GOAL-DOS-
  // PARITY.md P4: "P2 input is KEYS 1") -- the real H2H control assignment, not an arbitrary pick.
  const cars = spawnCars(strt, 1, 1, { raceFormat: 2, controllerTypes: [5, 4, 6, 6] })
  check('spawnCars: two humans on KEYS2/KEYS1 (5,4,6,6) -- car 0 is not a drone', cars[0].isDrone === 0)
  check('spawnCars: two humans on KEYS2/KEYS1 (5,4,6,6) -- car 1 is ALSO not a drone (the real fix)', cars[1].isDrone === 0)
  const defaultCars = spawnCars(strt, 1, 1, { raceFormat: 2 }) // no controllerTypes -- the default (1,6,6,6)
  check('spawnCars: unchanged default (no controllerTypes passed) -- car 1 is still a drone, behaviour-neutral for every existing caller', defaultCars[1].isDrone === 1)

  // applySteerAndThrottle's own `exempt` test (4D4B-4D69/4D3D): a human KEYS car (isDrone=0,
  // controllerType 4 or 5) is NOT exempt from the keyboard fire-preempt -- holding fire alone
  // (0x08, no accelerate) freezes it (4D70, speed/steering untouched this step). A CPU car
  // (isDrone=1) IS exempt -- the SAME control byte falls through to ordinary throttle handling
  // (0x00 = no throttle = ground-gated coast, 4E2E) instead.
  const human = spawnCars(strt, 1, 1, { raceFormat: 2, controllerTypes: [5, 4, 6, 6] })[1]
  const ai = spawnCars(strt, 1, 1, { raceFormat: 2 })[1] // isDrone=1 by default
  const ctx = { raceFormat: 2, round: 1 }
  human.speed = 100; human.height = 0
  applySteerAndThrottle(human, 0x08, ctx, false, 0, 4) // fire held alone, KEYS1 (4)
  check('a human P2 (isDrone=0, KEYS1) holding fire alone gets the real keyboard fire-preempt: speed frozen', human.speed === 100)
  ai.speed = 100; ai.height = 0; ai.coastDecel = 10
  applySteerAndThrottle(ai, 0x08, ctx, false, 0, 6) // fire held alone, CPU (6) -- but isDrone is what actually gates `exempt`
  check('the SAME control byte on an AI car 1 (isDrone=1) is exempt from the fire-preempt: falls through to the ground-gated coast instead (decays, not frozen)', ai.speed === 90)

  // 4EE7's own TANKS ([28BF]==7) steer-mod: no raceFormat gate, and round 7 is H2H track index 4
  // (DS:09BA byte 0x1C) -- reachable in two-human H2H. A human car 1 at speed>=0x320 halves its
  // steer step (SAR CX,1); a drone always adds 1 (INC CX) regardless of speed.
  const tanksCtx = { raceFormat: 2, round: 7 }
  const humanTanks = spawnCars(strt, 7, 1, { raceFormat: 2, controllerTypes: [5, 4, 6, 6] })[1]
  humanTanks.heading = 0; humanTanks.steerStep = 0x10; humanTanks.speed = 0x320; humanTanks.height = 1
  applySteerAndThrottle(humanTanks, 0x80, tanksCtx, false, 0, 4) // LEFT only, KEYS1, no fire
  check('TANKS (round 7): a human car 1 at speed>=0x320 halves its steer step (cx 0x10->8)', humanTanks.heading === ((0 - 8) & 0xff))
  const aiTanks = spawnCars(strt, 7, 1, { raceFormat: 2 })[1] // isDrone=1 by default
  aiTanks.heading = 0; aiTanks.steerStep = 0x10; aiTanks.speed = 0; aiTanks.height = 1
  applySteerAndThrottle(aiTanks, 0x80, tanksCtx, false, 0, 6) // LEFT only, CPU
  check('TANKS (round 7): a drone car always adds 1 to its steer step regardless of speed (cx 0x10->0x11), NOT the human halving rule', aiTanks.heading === ((0 - 0x11) & 0xff))
}

// Two-human H2H's own alternate tuning path (GOAL-DOS-PARITY.md P4, docs/engine.md §9bg):
// `spawnCars`'s new `altTuning` option selects `altTuningFieldsFor` (the real `3F3B-3FBD`) over
// `tuningFieldsFor` (the real `4070`/`3FBE-4134`) -- the mode two-human H2H's own entry ALWAYS
// takes, `[PROVEN]` live this session (round 7 TANKS, raceFormat 2, P1=KEYS2/P2=KEYS1,
// `DS:[0x8A2]==1` read live at the real `1000:3F30` fork). `rosterWords: [5,6,11,11]` is the LIVE
// capture's own exact input (a `DS:0x2668` read, characters DWAYNE/JETHRO/11/11 -- 11/11 for the
// unused two-car-format slots), all four with bit 7 clear (5/6 well under 0x80). Both spawned
// cars' tuning matched `CAR_TYPE_INFO[6]`'s own raw row (plus the formula's own unconditional
// `+0x32`/`+20`/`+20` terms) EXACTLY, byte-identical between car 0 and car 1 -- this is the bit7=0
// case, and passing the REAL character indices (not 0) also proves the low 7 bits are genuinely
// ignored while bit 7 is clear, not just untested; the bit7=1 arithmetic is `[STATIC]` only (see
// `altTuningFieldsFor`'s own header). These values are the LIVE CAPTURE's own ground truth, not
// re-derived from the same formula the port implements -- the non-tautological check the
// project's own evidence discipline requires.
{
  const cars = spawnCars(strt, 7, 1, { raceFormat: 2, controllerTypes: [5, 4, 6, 6], altTuning: true, rosterWords: [5, 6, 11, 11] })
  for (const [i, car] of [[0, cars[0]], [1, cars[1]]]) {
    check(`altTuning round 7 car ${i}: maxSpeedCur matches the live capture (931)`, car.maxSpeedCur === 931)
    check(`altTuning round 7 car ${i}: maxSpeedBase matches maxSpeedCur (931)`, car.maxSpeedBase === 931)
    check(`altTuning round 7 car ${i}: reverseLimit matches the live capture (-781)`, car.reverseLimit === -781)
    check(`altTuning round 7 car ${i}: accel matches the live capture (16)`, car.accel === 16)
    check(`altTuning round 7 car ${i}: brakeDecel matches the live capture (16)`, car.brakeDecel === 16)
    check(`altTuning round 7 car ${i}: coastDecel matches the live capture (30)`, car.coastDecel === 30)
    check(`altTuning round 7 car ${i}: slipThreshold matches the live capture (80)`, car.slipThreshold === 80)
    check(`altTuning round 7 car ${i}: gripStep matches the live capture (79)`, car.gripStep === 79)
  }
  check('altTuning: car 0 and car 1 get IDENTICAL tuning -- no isDrone/car-index distinction in this path, matching the live capture exactly', cars[0].maxSpeedCur === cars[1].maxSpeedCur && cars[0].accel === cars[1].accel && cars[0].reverseLimit === cars[1].reverseLimit)

  // The default (altTuning omitted/false) must be untouched -- the normal 4070/tuningFieldsFor
  // path, which for the SAME round/format gives DIFFERENT values (car 0 human, no cx ramp reason
  // to coincide with the alt path's own raw-table numbers except where the formulas happen to
  // agree by construction) -- proven by checking the normal path is still reachable and distinct.
  const normalCars = spawnCars(strt, 7, 1, { raceFormat: 2, controllerTypes: [5, 4, 6, 6] })
  check('altTuning defaults to false: the normal tuningFieldsFor path is untouched (car 1, a drone by default tuning math, keeps its own DRONE_MAX_VEL_HANDICAP-adjusted maxSpeedCur, not the alt path\'s raw 931)', normalCars[1].maxSpeedCur !== 931 || normalCars[1].accel !== 16)
}

console.log(bad ? `${bad} of ${asserted} executed check(s) failed` : `check-twocar: ${distinct.size} distinct assertions (${asserted} executed) pass -- the two-car match matches the disassembly -- camera trigger, knockout reset (both branches), 64-step blink and commit, finish block and Play Off, banners, double death, and the exit fix-up; real races end at 8, at 0, on a finish while ahead or behind, and in sudden death after a tied finish; car.isDrone now reflects controllerType, not car index, proven against the real keyboard fire-preempt (GOAL-DOS-PARITY.md P4, docs/engine.md §9bf); two-human H2H's own alternate tuning path (altTuning) is ported and live-DOSBox-proven byte-exact against a real race's own car 0/car 1 tuning (docs/engine.md §9bg)`)
process.exitCode = bad ? 1 : 0
