// M3.7 acceptance test (PLAN-ENGINE.md): the race engine actually drives the sound driver model
// the way MICROU.EXE does, not just "the driver model works in isolation" (that's `npm run si2`,
// unchanged and still passing). Two parts:
//   1. `createEngineJitter` reproduces the exact 6204-call checkpoint docs/sound.md §6 records
//      (verified live this session, 1000:7cae-7cda) -- the one piece of sound.js with a hard
//      ground-truth number to check.
//   2. A real spawnCars+ai+physics race (reusing check-play.mjs's own setup) run with a raw
//      Sequencer wired in via `asDriver()`: AH=7 fires once at race start, every car's engine
//      record gets a sane (0..0x7FF-ish) pitch byte every step with no exceptions, and at least
//      one of the wired sfx ids actually gets queued over a long-enough drive (this trace's own
//      drone-only window can reach the drop-in cue (id9) and collisions (id1/id3) but not every
//      id -- see docs/engine.md's M3.7 section for exactly which of the 36 sites are wired at all).
//   node tools/check-sound.mjs
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Driver, Sequencer, createEngineJitter } from '../src/formats/si2.js'
import { asDriver, raceStart, updateEngines, raceOverStart, raceOverEnd, raceOverGateCar, createRaceJitter } from '../src/engine/sound.js'
import { parseStrtPos } from '../src/formats/globaldata.js'
import { loadWorld, loadBrk, roundCtx, spawnCars } from '../src/engine/race.js'
import { runStep } from '../src/engine/step.js'
import { droneControlByte } from '../src/engine/ai.js'
import { updateCheckpointsAndLaps } from '../src/engine/checkpoints.js'
import { resolveCarCarCollisions } from '../src/engine/collide.js'
import { checkpointList } from '../src/data/engine-tables.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const GAME = join(ROOT, 'game')
const read = async (n) => new Uint8Array(readFileSync(join(GAME, n)))

let bad = 0
function check(name, cond) {
  if (cond) return
  bad++
  console.log(`FAIL: ${name}`)
}

// 1. The jitter PRNG's own live-verified checkpoint (docs/sound.md §6).
{
  const next = createEngineJitter()
  let last
  for (let i = 0; i < 6204; i++) last = next()
  check('createEngineJitter reaches the documented 6204-call checkpoint (returns 0xb269)', last === 0xb269)
}

// 2. A real race, sound wired via a raw Sequencer.
{
  const ROUND = 2, RACE = 1, N = 1500
  const drv = new Driver(new Uint8Array(readFileSync(join(GAME, 'DRIVER1.BIN'))))
  const seq = new Sequencer(drv)
  const driver = asDriver(seq)
  const jitter = createRaceJitter()

  const strt = parseStrtPos(await read('GAME1/STRT_POS.BIN'))
  const cars = spawnCars(strt, ROUND, RACE)
  const world = await loadWorld(read, ROUND, RACE)
  const ctx = { ...roundCtx(ROUND, RACE), brk: await loadBrk(read, ROUND, RACE), tournamentIndex: 0, world, sound: driver }
  const raceState = {}

  raceStart(driver)
  check('AH=7 (stop music) sets the pending flag at race start', seq.pendingStop === true)
  seq.hostTick()
  // docs/sound.md §2's own documented quirk: DoPendingStopMusic loops over the LAST STARTED tune's
  // track count and skips the whole routine -- including clearing the pending flag -- while that
  // count is 0. This fresh Sequencer never started a tune (a real race always has one live from
  // the pre-race screen, docs/sound.md §7(c)), so trackCount is 0 and the flag staying set is the
  // CORRECT reproduction of the quirk, not a bug -- confirmed by checking trackCount, not assumed.
  check('pendingStop stays set because trackCount is 0 (the documented sticky-stop quirk)', seq.trackCount === 0 && seq.pendingStop === true)

  const sfxSeen = new Set()
  const origCommand = seq.command.bind(seq)
  seq.command = (ah, al) => { if (ah === 5 && al < 0x40) sfxSeen.add(al); return origCommand(ah, al) }

  let engineCallsOk = true
  for (let step = 0; step < N; step++) {
    const controls = cars.map((car, i) => (i === 0 ? 0 : droneControlByte(car, ctx)))
    runStep(world, cars, controls, raceState, ctx)
    updateEngines(driver, cars, ctx, jitter)
    seq.hostTick(); seq.hostTick() // two 70.06 Hz ticks per 35 Hz physics step (D6)
    for (let i = 0; i < 4; i++) {
      const bend = seq.image[0x08 + 16 * i + 0xa]
      if (!Number.isFinite(bend) || bend < 0 || bend > 0xff) engineCallsOk = false
    }
  }
  check(`${N} steps of updateEngines wrote a finite in-range pitch byte every step, all 4 cars`, engineCallsOk)
  check('at least one wired sfx id was queued over the run (id 1/2/3/5/8/9 from checkpoints/collide/velocity/states)', sfxSeen.size > 0)
  if (sfxSeen.size) console.log(`  sfx ids queued: ${[...sfxSeen].sort((a, b) => a - b).join(', ')}`)

  raceOverStart(driver, cars)
  raceOverEnd(driver)
  seq.hostTick()
  check('the race exit (raceOverStart then raceOverEnd) leaves the sequencer in a clean (reset) state', seq.slots.every((s) => s.state === 0))
}

// 2b. The real race exit (docs/engine.md §9an): 30DF queues sfx 16, the 100-tick hold follows, and
// only then 3102/3109 AH=8/AH=6. Sent in the same instant (the old raceOverSequence) the AH=6
// reset clears the start queue first and sfx 16 never plays; 100 ticks apart it plays.
{
  // The old same-instant sequence (sfx 16, engines to pitch 0, AH=8, AH=6), kept here only to show why
  // it was wrong; the port no longer uses it anywhere (the ESC quit sends nothing, docs/engine.md §9ca).
  const oldSameInstant = (driver, cars) => {
    if (cars.some((c) => c.drawnThisFrame)) driver.playSfx(16)
    for (let i = 0; i < cars.length; i++) driver.engine(i, { bend: 0 })
    driver.stopSfx(0)
    driver.muteAll()
  }
  const seqA = new Sequencer(new Driver(new Uint8Array(readFileSync(join(GAME, 'DRIVER1.BIN')))))
  const dA = asDriver(seqA)
  oldSameInstant(dA, [{ drawnThisFrame: 1 }])
  let heardA = false
  for (let t = 0; t < 5; t++) { seqA.hostTick(); if (seqA.slots.some((sl) => sl.sfxId === 16)) heardA = true }
  check('old same-instant race-over sequence: sfx 16 never becomes active (the dropped jingle)', !heardA)

  const seqB = new Sequencer(new Driver(new Uint8Array(readFileSync(join(GAME, 'DRIVER1.BIN')))))
  const dB = asDriver(seqB)
  raceOverStart(dB, [{ drawnThisFrame: 1 }, { drawnThisFrame: 0 }], 0)
  let heardB = 0
  for (let t = 0; t < 100; t++) { seqB.hostTick(); if (seqB.slots.some((sl) => sl.sfxId === 16)) heardB++ }
  raceOverEnd(dB)
  seqB.hostTick()
  check(`race exit: sfx 16 plays during the 100-tick hold (${heardB} ticks active), and AH=6 then clears everything`, heardB > 50 && seqB.slots.every((sl) => sl.state === 0))

  const seqC = new Sequencer(new Driver(new Uint8Array(readFileSync(join(GAME, 'DRIVER1.BIN')))))
  raceOverStart(asDriver(seqC), [{ drawnThisFrame: 1 }, { drawnThisFrame: 0 }], raceOverGateCar({ cameraIndex: 0 }, 2))
  seqC.hostTick()
  check('race exit gate: a two-car race (midpoint camera) reads car 1\'s drawn flag, not car 0\'s (4AEE BX = [2662])', !seqC.slots.some((sl) => sl.sfxId === 16))
}

// 3. Synthetic sfx coverage for the sites a real drone-only drive doesn't reach (same rationale as
// check-ai.mjs's syntheticBranches: a green integration test that only ever sees id9 proves less
// than it looks like -- exercise the checkpoint-penalty/lap/collision sites directly).
{
  function mockSound() {
    const seen = []
    return { calls: seen, playSfx: (id) => seen.push(id) }
  }
  function newCar(fields) {
    return { velX: 0, velY: 0, posXfrac: 0, posYfrac: 0, heading: 0, speed: 0, drawnThisFrame: 1, ...fields }
  }

  const list = checkpointList(1, 1)
  const sound1 = mockSound()
  const skipped = newCar({ progress: 5, progressPrev: 250, progressChanged: 1, checkpointOff: 0, checkpointOffSaved: 0, lapsRemaining: 3, safeX: 0, safeY: 0, safeXPrev: 0, safeYPrev: 0, posX: 0, posY: 0, knockoutX: 0, knockoutY: 0, state: 0 })
  updateCheckpointsAndLaps(skipped, { round: 1, race: 1, raceFormat: 1, halfMaxProgress: 128, sound: sound1 })
  check('checkpoint-skipped penalty plays sfx 1 (drawn car)', sound1.calls.includes(1))

  const sound2 = mockSound()
  const lapCar = (fields) => newCar({ progress: 1, progressPrev: 250, progressChanged: 1, checkpointOff: 2 * list.length, checkpointOffSaved: 0, lapsRemaining: 3, safeX: 0, safeY: 0, safeXPrev: 0, safeYPrev: 0, posX: 0, posY: 0, knockoutX: 0, knockoutY: 0, state: 0, ...fields })
  const completed = lapCar({})
  updateCheckpointsAndLaps(completed, { round: 1, race: 1, raceFormat: 1, halfMaxProgress: 128, sound: sound2 })
  check('lap completion plays sfx 2 (one-player/raceFormat 1)', sound2.calls.includes(2))
  const soundHidden = mockSound()
  updateCheckpointsAndLaps(lapCar({ drawnThisFrame: 0 }), { round: 1, race: 1, raceFormat: 1, halfMaxProgress: 128, sound: soundHidden })
  check('lap sfx 2 is drawn-gated (6014): an undrawn car completing a lap plays nothing', soundHidden.calls.length === 0)
  const soundTwoCar = mockSound()
  updateCheckpointsAndLaps(lapCar({}), { round: 1, race: 1, raceFormat: 2, halfMaxProgress: 128, sound: soundTwoCar })
  check('lap sfx 2 is four-car only (600d)', soundTwoCar.calls.length === 0)

  const sound3 = mockSound()
  const a = newCar({ posX: 100, nextX: 100, posY: 100, nextY: 100, velX: 100, active: 1, state: 0 })
  const b = newCar({ posX: 105, nextX: 105, posY: 100, nextY: 100, velX: -100, active: 1, state: 0 })
  resolveCarCarCollisions([a, b, newCar({ posX: 2000, nextX: 2000, posY: 2000, nextY: 2000, active: 1, state: 0 }), newCar({ posX: 2100, nextX: 2100, posY: 2100, nextY: 2100, active: 1, state: 0 })], { round: 1, sound: sound3 })
  check('a routine car-car collision plays sfx 3', sound3.calls.includes(3))

  const sound4 = mockSound()
  const c = newCar({ posX: 100, nextX: 100, posY: 100, nextY: 100, velX: 1200, active: 1, state: 0 })
  const d = newCar({ posX: 105, nextX: 105, posY: 100, nextY: 100, velX: -1200, active: 1, state: 0 })
  resolveCarCarCollisions([c, d, newCar({ posX: 2000, nextX: 2000, posY: 2000, nextY: 2000, active: 1, state: 0 }), newCar({ posX: 2100, nextX: 2100, posY: 2100, nextY: 2100, active: 1, state: 0 })], { round: 6, sound: sound4 })
  check('a WARRIORS(round 6) hard hit plays sfx 1 (in addition to sfx 3)', sound4.calls.includes(1) && sound4.calls.includes(3))
}

// 4. M3.27's own six new wire-ups (docs/sound.md §9, previously-unwired sites found alongside the
// audit table), each independently reverted and reconfirmed to fail first.
{
  const { dispatchTerrain } = await import('../src/engine/terrain.js')
  const { updateCarAirborneLanding } = await import('../src/engine/airborne.js')
  const statesMod = await import('../src/engine/states.js')

  function mockSound() {
    const seen = []
    return { calls: seen, playSfx: (id) => seen.push(id) }
  }
  function newCar(fields) {
    return { velX: 0, velY: 0, heading: 0, speed: 0, height: 0, zVel: 0, active: 1, state: 0, drawnThisFrame: 1, ...fields }
  }

  // (a) id6 "6210", h61b0's own literal namesake -- the halved (non-exempt) branch only. h61b0
  // sits at round 6 idx 4 (shift5: dirByte>>5==4) and round 5 idx 3 (shift4) per TERRAIN_ROWS --
  // docs/sound.md's own live-confirmed citation ("present in round 5's and round 6's rows").
  {
    const sound = mockSound()
    const car = newCar({ terrainLevel: 0, terrainIdx: 0, dirByte: 0x80, speed: 0 }) // round6 idx = 0x80>>5 = 4
    dispatchTerrain(car, { round: 6, s: 100, sound })
    check('id6 (6210): non-exempt rough surface plays sfx 6', sound.calls.includes(6))

    // dispatchTerrain copies car.terrainIdx (the OLD value) into terrainIdxPrev at its own entry,
    // then overwrites terrainIdx with this call's freshly-computed one -- set terrainIdx, not
    // terrainIdxPrev, to control what h61b0 actually reads.
    const soundExempt = mockSound()
    const exemptCar = newCar({ terrainLevel: 0, terrainIdx: 4, dirByte: 0x80, speed: 0 }) // round!=5, idxPrev becomes 4 -> exempt
    dispatchTerrain(exemptCar, { round: 6, s: 100, sound: soundExempt })
    check('id6 (6210): the exempt case plays no sfx (proves the assertion above has teeth)', !soundExempt.calls.includes(6))
  }

  // (b) id18, both sites -- h6622 ("666e", gated on speed!=0) and h669b ("669b"/"66ac", unconditional).
  // h6622/h669b are private to terrain.js; exercised through dispatchTerrain against round 4 (6622
  // present at idx 2) and round 1 (669b present at idx 5) per TERRAIN_ROWS.
  {
    const sound6622 = mockSound()
    const carWet = newCar({ terrainLevel: 0, dirByte: 0x2a, speed: 5 }) // round4 idx = 0x2a>>4 = 2 -> 0x6622
    dispatchTerrain(carWet, { round: 4, s: 100, sound: sound6622 })
    check('id18 (666e, h6622): a moving car on this tile plays sfx 18', sound6622.calls.includes(18))

    const sound6622Idle = mockSound()
    const carIdle = newCar({ terrainLevel: 0, dirByte: 0x2a, speed: 0 })
    dispatchTerrain(carIdle, { round: 4, s: 100, sound: sound6622Idle })
    check('id18 (666e): speed==0 plays no sfx (proves the assertion above has teeth)', !sound6622Idle.calls.includes(18))

    const sound669b = mockSound()
    const carLowGrip = newCar({ dirByte: 0xa0 }) // round1 idx = 0xa0>>5 = 5 -> 0x669b
    dispatchTerrain(carLowGrip, { round: 1, s: 100, sound: sound669b })
    check('id18 (669b, h669b): unconditional when drawn, plays sfx 18', sound669b.calls.includes(18))
  }

  // (c) id9 "7325" (stepRespawn's own opening) and the accompanying puff/splash reset. Same
  // pre-existing headless-harness limitation `check-play.mjs`'s own state-1/4/5 sfx tests already
  // document (line ~161 there): `runStates` unconditionally zeroes `car.drawnThisFrame` before
  // dispatch, so a call through the real entry point can only prove SUPPRESSION when not drawn,
  // not firing when drawn (no renderer in this harness ever sets it back to 1 for a non-state-0
  // car) -- proven here as "no sfx AT ALL for a not-drawn car", the strongest assertion available
  // through this entry point. The puff/splash reset doesn't depend on drawnThisFrame at all, so
  // it's checked directly as positive proof stepRespawn's new code actually ran.
  {
    const sound = mockSound()
    const car = newCar({
      state: 7, subState: 0, safeX: 480, safeY: 480, drawnThisFrame: 0,
      puffCooldown: 9, splashCooldown: 9, puffSlots: [{ frame: 3 }], splashSlots: [{ frame: 2 }],
    })
    statesMod.runStates([car], {}, { round: 1, sound })
    check('id9 (7325): not-drawn respawn plays no sfx', sound.calls.length === 0)
    check('stepRespawn zeroes puff/splash cooldowns', car.puffCooldown === 0 && car.splashCooldown === 0)
    check('stepRespawn resets puff/splash slot frames to -1', car.puffSlots[0].frame === -1 && car.splashSlots[0].frame === -1)
  }

  // (d) airborne.js Path B (755b-75ba): the decay-bounce restart branch, previously entirely
  // unwired, plus the ramp-jump knockoutX/Y recording (74b0-74bc).
  {
    const sound = mockSound()
    const car = newCar({ height: -5, zVel: 20, bounceOnLand: 1, round: 1 })
    updateCarAirborneLanding(car, { round: 1, sound })
    check('airborne Path B: a restarting decay bounce plays sfx 4 (non-POWERBOATS)', sound.calls.includes(4))

    const soundBoat = mockSound()
    const carBoat = newCar({ height: -5, zVel: 20, bounceOnLand: 1 })
    updateCarAirborneLanding(carBoat, { round: 2, sound: soundBoat })
    check('airborne Path B: POWERBOATS plays sfx 7 instead', soundBoat.calls.includes(7))

    const soundSettled = mockSound()
    const carSettled = newCar({ height: -5, zVel: 0, bounceOnLand: 1 })
    updateCarAirborneLanding(carSettled, { round: 1, sound: soundSettled })
    check('airborne Path B: a fully-settled bounce (zVel<=0) plays no sfx (proves the assertion above has teeth)', soundSettled.calls.length === 0)

    const rampCar = newCar({ height: 2, zVel: -8, rampJumpActive: 1, posX: 777, posY: 888, bounceOnLand: 0 }) // 2 + sar16(-8,2)=-2 -> 0, crosses to <=0 this call
    updateCarAirborneLanding(rampCar, { round: 1, sound: mockSound() })
    check('ramp-jump landing records knockoutX/Y before the state=0xD transition', rampCar.knockoutX === 777 && rampCar.knockoutY === 888 && rampCar.state === 0xd)
  }
}

// Front-end music regression pin (M3.34, docs/engine.md §9ai/§9bb) -- `ShowRaceOutcomeMessageTune8or6
// 1000:1c1b`'s real rule is CX-parity, no exception for any code: tune 8 if odd (1/3/5), tune 6 if
// even (0/2/4). An earlier pass wrongly claimed code 4 (NO_BONUS) skips the tune entirely ("jumps
// straight past its own AH=4") -- corrected this session (GOAL-DOS-PARITY.md P3's 4th item) by a
// fresh byte-for-byte re-read of `1c6a-1c89`: the only branch between the tune choice and the play
// call depends on the driver's own AH=9 "already playing" query, not on CX, so code 4 plays tune 6
// exactly like code 0/2. Pin the corrected, exception-free parity rule for all 6 codes.
{
  const { raceOutcomeMusic } = await import('../src/engine/sound.js')
  function mockDriver() {
    const calls = []
    return { calls, playTune: (n) => calls.push(n) }
  }
  const expected = { 0: 6, 1: 8, 2: 6, 3: 8, 4: 6, 5: 8 }
  for (const [code, tune] of Object.entries(expected)) {
    const driver = mockDriver()
    raceOutcomeMusic(driver, Number(code))
    check(`raceOutcomeMusic(${code}): plays tune ${tune}`, driver.calls.length === 1 && driver.calls[0] === tune)
  }
}

// Race-intro music regression pin (M3.45, docs/sound.md §8, UNKNOWN_tune7_unused write-up,
// 2026-09-24): `ShowNextRaceIntroScreenTune4or5 1000:11f8`'s own `AL=5` branch (`[28c1]==0x1a`) is
// dead -- exhaustively traced every path that can reach it (normal tournament advance `10f9/1104`,
// the `25011968`-cheat race-skip hotkey `13aa/13bf`) and both are capped at `[439]=0x19`, one short
// of the branch's threshold. `raceIntroMusic` used to play tune 5 for the tournament's real final
// race (`isFinalRace`); that was invented port behaviour with no real-bytes counterpart. Pin that
// it now always plays tune 4, with no way to select otherwise.
{
  const { raceIntroMusic } = await import('../src/engine/sound.js')
  const calls = []
  const driver = { playTune: (n) => calls.push(n) }
  raceIntroMusic(driver, true) // the old call site's own "is this the final race?" argument
  check('raceIntroMusic always plays tune 4 even when told it is the final race (tune 5 is unreachable in the real game)', calls.length === 1 && calls[0] === 4)
  check('raceIntroMusic takes no second argument to select a different tune', raceIntroMusic.length === 1)
}

// The banners' keep-alive (docs/engine.md §9cn): states F/0x10 (`8684-8695`/`86A9-86BA`) ask AH=0Ah
// every frame and replay the sfx with AH=5 when it has ended, so it loops for as long as the state
// lasts -- driven here through runStates against the real driver model, ticked 2x per step.
{
  const { runStates } = await import('../src/engine/states.js')
  const drv = new Driver(new Uint8Array(readFileSync(join(GAME, 'DRIVER1.BIN'))))
  const loops = (state, id, steps) => {
    const seq = new Sequencer(drv)
    const base = asDriver(seq)
    let plays = 0
    const driver = { ...base, playSfx: (x) => { if (x === id) plays++; return base.playSfx(x) }, command: (ah, al) => { if (ah === 5 && al === id) plays++; return seq.command(ah, al) } }
    driver.keepAliveSfx = (x) => { if (seq.command(10, x) !== 0) driver.command(5, x) }
    const car = { state, active: 1, speed: 0, heading: 0, posX: 100, posY: 100 }
    const rs = { ruffTruxLatched: 1 }
    for (let i = 0; i < steps; i++) { runStates([car], rs, { round: 9, sound: driver }); seq.hostTick(); seq.hostTick() }
    return plays
  }
  const f = loops(0xf, 16, 350) // 10 s at 35 Hz
  check(`state F keeps sfx 16 looping: replayed each time it ends (${f} plays in 10 s, not 1)`, f >= 5)
  const x = loops(0x10, 15, 350)
  check(`state 0x10 keeps sfx 15 looping (${x} plays in 10 s, not 1)`, x >= 3)
  const seq = new Sequencer(drv)
  const d = asDriver(seq)
  d.keepAliveSfx(16)
  seq.hostTick() // AH=5 queues; the slot is taken on the next tick
  const active = seq.slots.some((sl) => sl.sfxId === 16)
  let n = 0
  const orig = seq.command.bind(seq)
  seq.command = (ah, al) => { if (ah === 5) n++; return orig(ah, al) }
  d.keepAliveSfx(16)
  check('keepAliveSfx: plays when idle, and does not restart a sfx that is still playing (CmdIsSfxActive 08F6)', active && n === 0)
  // 7437-7448: the countdown's own one-shot, gated on the drawn flag of the car the pass is on when
  // [26C8] reaches 0 (it counts down once per car slot).
  const oneShot = (timer, drawn) => {
    const calls = []
    const cs = [0, 1, 2, 3].map((i) => ({ state: 0, active: i === 0 ? 1 : 0, drawnThisFrame: drawn[i] }))
    runStates(cs, { ruffTruxTimer: timer }, { round: 9, sound: { playSfx: (x) => calls.push(x), keepAliveSfx: () => {}, engine: () => {} } })
    return calls.filter((x) => x === 15).length
  }
  check('7448: the countdown hitting 0 on car 0\'s slot plays sfx 15 once if car 0 was drawn', oneShot(1, [1, 0, 0, 0]) === 1)
  check('7448: hitting 0 on an undrawn slot (car 2) plays nothing there -- the state-0x10 loop takes over', oneShot(3, [1, 0, 0, 0]) === 0)
}

console.log(bad ? `${bad} check(s) failed` : 'check-sound: the race engine drives the sound driver model correctly (jitter checkpoint, race-start AH=7, per-step engine pitch, sfx wiring, race-over, synthetic sfx-site coverage, M3.27\'s six new wire-ups); front-end outcome music matches the real CX-parity rule, no exception for NO_BONUS; race-intro music never plays the unreachable tune 5 (M3.45)')
process.exitCode = bad ? 1 : 0
