// The two-car match (raceFormat 2, one-player Head-to-Head vs CPU): the tug-of-war light bar, the
// knockout exchange, the finish/"Play Off" branch and the race end -- docs/engine.md §9am, all
// [STATIC] (disassembly only; no live two-car capture exists yet). P1 = [2660] = car 0 and P2 =
// [2662] = car 1 in every format (4152 is the only writer of [2660]/[2662]). The match globals live
// on `raceState.twoCar`; the three request/latch globals the other modules also touch live on
// `raceState` itself: `knockoutRequest` [2911] (0 idle, 1 requested, 2 processing), `bothDown`
// [2913], `fallLatch` [2682] (a car index, or null for -1) and `cameraIndex` [27B5].
//
// One exchange, in the real per-step order:
//   1. physics tail, camera (5053-50D7): the cars are more than 0xE8 apart in X or 0xB0 in Y while
//      the camera is in midpoint mode -> knockoutRequest = 1 (camera.js). Round 3's drop-in partner
//      timeout (6DB4, dropin.js) is the only other writer of 1.
//   2. render gate (91F2-9205, `twoCarRenderGate`): `resetCarsAfterKnockout` (7759) picks the
//      scorer, parks it in state 0xB with a hop and the other car in 0xC, points the camera at it.
//   3. per-car pass (7429's 75C2-7758, `stepExchange`): once the scorer is grounded, both cars go to
//      0xC and a 64-step blink runs, then the point is committed ([26B4] +1 for P1, -1 for P2), both
//      cars go 0xD -> 7 (respawn side by side at the shared safe point) -> 2 -> 0, and the end of
//      state 2 re-arms the camera trigger (8321, states.js).
// The race ends ONLY at an exchange end ([26C6]=2 at 76F2/772A/7742) -- completing the laps never
// ends a two-car race by itself (4BE7 only credits the car ahead on the light bar, or runs "Play
// Off" on a tied bar). The tournament result is order slot 0 after the 3115-3156 exit fix-up.

import { toI16 } from './int16.js'
import { resetDropInSlot } from './dropin.js'
import { toBytes, fromBytes } from './car.js'

const NONE = null // the literal 1 in [26B8]

/** Race-init seeds, `InitRaceCarsFromTables 3C22-3C86` plus [2621]=-1 (3055) and [2630]=0 (38FB). */
export function initTwoCarMatch(raceState) {
  raceState.twoCar = {
    score: 4, // [26B4], 8 = P1 has won the match, 0 = P2 has
    shadow: 4, // [26B6], the blink's other value
    spotlight: NONE, // [26B8], the exchange's scorer (car index)
    blink: 0, // [26BA], 64-step exchange countdown
    matchOpen: true, // [26C4]==1, the one-shot "match not yet decided" token
    bannerMode: 0, // [26C2]
    bannerX: 0, // [26BE], banner centre-X (int16)
    bannerY: 0, // [26C0], banner centre-Y (int16)
    hiddenCar: NONE, // [2621], the non-scorer once the Winner banner shows (its body is not drawn)
    hiddenCarLayer: NONE, // [2621] as the car layer saw it this frame (it runs before the banners)
    winnerSide: 0, // [2630], 1 = P1 won, 2 = P2 won, written only by the Winner banner (8620)
    banners: [], // this frame's draw list, {index, cx, cy} (PH0 banner strip index)
  }
  raceState.knockoutRequest = 0 // [2911], 3C28
  raceState.bothDown = 0 // [2913], 3C2E
  return raceState.twoCar
}

/** `StopEngineSounds 7AF8` on the OPL driver path ([0F64]==1, the only driver this port models):
 * it zeroes the speed of all four car records directly (7B18-7B3D, confirmed at [BX+0x127A] == the
 * struct's `speed` field) rather than issuing a driver command -- the beeper/NONE path instead calls
 * the driver's own AH=0x10 "engine off" (docs/engine.md §9ar a). The engine pitch follows speed, so
 * this is how the OPL2 engines fall silent. `UNKNOWN_0f64_speed_zero`: mechanism re-derived from fresh
 * disassembly 2026-09-24, still not confirmed live. */
export function stopEngineSounds(cars) {
  for (const car of cars) car.speed = 0
}

function zeroMotion(car) {
  car.speed = 0
  car.velX = 0
  car.velY = 0
  car.targetVelX = 0
  car.targetVelY = 0
}

/**
 * `ResetCarsAfterKnockoutSfxA 7759-78F7`, called from the render gate while [2911]==1.
 *
 * Fall branch ([2682] set -- only round 3's shortcut hole ever sets it, 7F69/6C08): the latched car
 * scores, whatever its position or state, and [2911] is left at 1 (so this re-runs every frame and
 * returns early through the 0xC guards below until the exchange ends it at 7684).
 * No-fall branch (the ordinary point): returns at once if either car is already 0xC, snapshots both
 * cars' knockoutX/Y, sets [2911]=2, and picks the leader by racePosition (a tie goes to P1) --
 * unless the leader is not in state 0, in which case the other car scores whatever ITS state.
 *
 * Two round-3-only quirks, both closed at the mechanism level (docs/engine.md §9ar b/c):
 * `UNKNOWN_fallbranch_stale_fields` -- the fall branch never snapshots knockoutX/Y (unlike the
 * no-fall branch above), so the non-falling car's later 0xD reappearance can draw its knockout
 * overlay (`drawKnockoutOverlay`) at a stale position; already faithfully reproduced (`?? car.posX`
 * fallback), no port bug. `UNKNOWN_rematch_fail_stale_2682` -- the fall branch has no "already 0xC"
 * re-entry guard, so a fall can force a new exchange to start while a previous one is still mid
 * blink/respawn, unconditionally overwriting that in-flight state (matches the bytes exactly); the
 * downstream consequence of that collision is not traced.
 */
export function resetCarsAfterKnockout(cars, raceState, ctx) {
  const m = raceState.twoCar
  const [p1, p2] = cars
  let bx, si
  if (raceState.fallLatch != null) {
    bx = raceState.fallLatch // 7760
    raceState.fallLatch = null // 7764
    si = bx === 0 ? 1 : 0 // 776A-7772
  } else {
    if (p1.state === 0xc) return // 777C
    p1.knockoutX = p1.posX // 7786
    p1.knockoutY = p1.posY
    const cx = toI16(p1.racePosition)
    if (p2.state === 0xc) return // 779E
    p2.knockoutX = p2.posX // 77A8
    p2.knockoutY = p2.posY
    raceState.knockoutRequest = 2 // 77B8
    const dx = toI16(p2.racePosition)
    if (cx > dx) { bx = 1; si = 0 } else { bx = 0; si = 1 } // 77BE-77CA (JG keeps BX=P2)
    if (cars[bx].state !== 0) [bx, si] = [si, bx] // 77D0-77D7
  }
  const scorer = cars[bx]
  const other = cars[si]
  resetDropInSlot(raceState, scorer.dropInSlot ?? 0) // 77D9-77EF
  m.spotlight = bx // 77F5
  scorer.active = 1 // 77F9 (the other car's `active` is not written)
  raceState.fallLatch = null // 77FF
  if (!(ctx.round === 2 && scorer.terrainIdx === 5)) { // 7805-7813: the scorer hops
    scorer.zVel = 0x14
    scorer.height = 0
    scorer.bounceOnLand = 1
  }
  raceState.cameraIndex = scorer.playerSlot // 7825: the camera follows the scorer alone
  if (ctx.camera) { ctx.camera.stepX = 4; ctx.camera.stepY = 4 } // 782C/7832
  const { safeX, safeY } = scorer // 7838
  zeroMotion(scorer)
  scorer.state = 0xb // 785E
  other.safeX = safeX // 7864
  other.safeY = safeY
  zeroMotion(other)
  other.state = 0xc // 788A
  stopEngineSounds(cars) // 7890
  for (let al = 0; al <= 8; al++) ctx.sound?.stopSfx?.(al) // 7893-78DF, AH=8 AL=0..8
  if (scorer.drawnThisFrame) ctx.sound?.playSfx(0x0a) // 78E7 (after a one-tick 3165 wait, real time only)
}

/**
 * `78F8` (unnamed in the original; the two-car re-line-up). Reached from the render gate while
 * [2913] is set (both cars down in state 1, or both in 5) and from the end of an exchange (7681).
 * While either car is still in state 1/5, the car that recovered first is hidden (active=0, which
 * freezes its state-7 handler) until the other one also leaves; then the trailing car takes the
 * leader's safe point (a racePosition tie copies P1's onto P2) and both respawn in state 7.
 */
export function lineUpBothCars(cars, raceState) {
  const [p1, p2] = cars
  if (p1.state === 1) { if (p2.state !== 1) p2.active = 0; return } // 78FC/791E-7932
  if (p1.state === 5) { if (p2.state !== 5) p2.active = 0; return } // 7903/794C-7960
  if (p2.state === 1 || p2.state === 5) { p1.active = 0; return } // 790E-7977
  const [lead, trail] = toI16(p1.racePosition) > toI16(p2.racePosition) ? [p2, p1] : [p1, p2] // 798A JLE
  trail.safeX = lead.safeX // 798E-79CC
  trail.safeY = lead.safeY
  trail.onBridge = lead.onBridge
  p1.active = 1; p1.state = 7 // 79D4-79EA
  p2.active = 1; p2.state = 7
  raceState.bothDown = 0 // 79F0
  raceState.knockoutRequest = 0 // 79F6
}

/** The render gate, `90C5`'s 91F2-9205: runs before the per-car state handlers. */
export function twoCarRenderGate(cars, raceState, ctx) {
  if (raceState.bothDown) lineUpBothCars(cars, raceState)
  else if (raceState.knockoutRequest === 1) resetCarsAfterKnockout(cars, raceState, ctx)
}

/** `5E4E-5E8E`, at the top of every ACTIVE car's commit-time checkpoint call: both cars in state 1,
 * or both in state 5, sets [2913] (and that car skips its terrain/lap body this step). */
export function checkBothDown(cars, raceState) {
  const [p1, p2] = cars
  if ((p1.state === 1 && p2.state === 1) || (p1.state === 5 && p2.state === 5)) {
    raceState.bothDown = 1
    return true
  }
  return false
}

/** The "Play Off" sequencer, `4CB0-4CFE` -- advanced once per finished car per step while the bar
 * is tied (so twice per step once both cars have finished). The banner enters from the right,
 * holds at centre for 97 steps, leaves to the left, then parks at 0xC8 ("nothing drawn"). */
function stepPlayOff(m) {
  if (m.bannerMode === 2) return // 4CB0
  if (m.bannerMode === 0) { m.bannerMode = 3; m.bannerX = 0x158; m.bannerY = 0x7c } // 4CBE-4CCA
  if (m.bannerX === 0x80) { // 4CD0
    m.bannerMode++ // 4CE6
    if (m.bannerMode === 0x64) { m.bannerMode = 3; m.bannerX = toI16(m.bannerX - 8) } // 4CF1-4CF7
  } else if (m.bannerX <= -0x58) m.bannerMode = 0xc8 // 4CD8/4CFE
  else m.bannerX = toI16(m.bannerX - 8) // 4CDF
}

/**
 * `RunCarPhysicsStep 4BE7-4CFE`, the two-car finished-car block: runs for each car with
 * lapsRemaining <= 0 every step, BEFORE the state/lock/active gates, and keys on the light bar,
 * NOT on which car finished. Tied bar: "Play Off", and the car carries on into the control path
 * (sudden death -- the next exchange decides). Otherwise the car ahead on the bar is credited once
 * ([26B8] = P1 if [26B4] > 4, else P2; its own next grounded step starts the deciding blink), the
 * order array is rewritten with (absent) car 2 in the loser's slot, and the finished car skips its
 * control path from now on. Returns true when the car skips its control path this step.
 */
export function twoCarFinishedCar(raceState) {
  const m = raceState.twoCar
  if (m.score === 4) { stepPlayOff(m); return false }
  if (m.matchOpen) { // 4BF9/4C55
    const p1Leads = m.score > 4
    m.spotlight = p1Leads ? 0 : 1 // 4C08/4C64
    m.matchOpen = false // 4C0F/4C6B
    raceState.rankOrder = p1Leads ? [0, 2, 1, 3] : [2, 0, 1, 3] // 4C13-4C28/4C6F-4C84
    m.bannerMode = 0xc8 // 4C44/4CA0 (the 0x7D00 score cells and [26BC] are dead in two-car)
  }
  return true // 4C51/4CAD JMP 4FD1
}

/**
 * `UpdateCarAirborneLandingSfx`'s two-car block, `75C2-7758`: per car per step, after that car's
 * landing update, only for the scorer and only while it is active and grounded (height <= 0 and
 * zVel <= 0 -- `updateCarAirborneLanding` returns that). Arms a 64-step blink with both cars in
 * 0xC, swaps the light bar with its shadow every 8 steps (so the bar flashes old/new), then commits
 * the point and sends both cars to 0xD.
 *
 * Returns the BX this block leaves (docs/engine.md §9an): 7429 does not save BX, and the pass then
 * runs its 73E7 (animTimer/drift) and 51B2 (projectile flight) on THAT, not on the slot car -- the
 * slot's own index on every early exit; P1 (0) on the arm (75F2), a plain blink tick (7633) and the
 * 7742/76D2 commits; P2 (1) on the 770A commit; and on a swap tick `{ scoreSlot }`, the bar value
 * just loaded from [26B6] (7645), which the pass then uses as a "car base" 0..8 bytes into car 0's
 * record (`applyScoreSlotGarbage`). The pass bumps `animTimer` on `cars[bx]` (step.js), so the car
 * the post-commit 73E7 misses runs its 0xD animation one step behind the other's.
 */
export function stepExchange(carIndex, cars, raceState, ctx) {
  const m = raceState.twoCar
  if (m.spotlight === NONE || m.spotlight !== carIndex) return carIndex // 75D2/75DC
  const [p1, p2] = cars
  if (m.blink === 0) { // 75E5: arm
    m.blink = 0x40
    p1.state = 0xc
    p2.state = 0xc
    if (ctx.round === 2 || ctx.round === 8) { p1.subState = 0; p2.subState = 0 } // 7606-761A
    m.shadow = m.spotlight === 0 ? m.score + 1 : m.score - 1 // 7620-762D
    return 0 // 75F2 BX=P1
  }
  let bx = 0 // 7633 BX=P1
  if ((m.blink & 7) === 0) { [m.score, m.shadow] = [m.shadow, m.score]; bx = { scoreSlot: m.score } } // 763A-764D (7645 BX=[26B6])
  m.blink-- // 7650
  if (m.blink !== 0) return bx

  if (toI16(p1.lapsRemaining) > 0) m.bannerMode = 1 // 7662-7669
  m.bannerX = 0x80 // 766F
  m.bannerY = 0x7c // 7675
  raceState.cameraIndex = 0 // 767B: back to the midpoint
  lineUpBothCars(cars, raceState) // 7681
  raceState.knockoutRequest = 2 // 7684
  for (const car of [p1, p2]) { car.active = 1; car.state = 0xd; car.animStep2 = 0; car.animTimer = 0; car._koDrawStep = undefined } // 7692-76BC

  if (!m.matchOpen) { // 76C2 JNZ 7742: the finish block already decided the match
    raceState.raceOverCount = 2 // 7742
    if (p1.drawnThisFrame) ctx.sound?.playSfx(0x10) // 7748 (BX is P1 here)
    // BX=P1 (768A): the post-commit 73E7 goes to car 0, so car 1 misses it -- the pass bumps cars[bx]
    return 0
  }
  const p1Scored = m.spotlight === 0 // 76CC
  const scorer = p1Scored ? p1 : p2
  // 770A BX=P2: car 0's own pass already ran before this commit reset it, so it starts one behind
  if (toI16(scorer.lapsRemaining) > 0) { // 76D6/770E
    m.spotlight = NONE // 76DD/7715
    m.score += p1Scored ? 1 : -1 // 76E3 INC / 771B DEC
    if (m.score !== (p1Scored ? 8 : 0)) return p1Scored ? 0 : 1 // 76E7/771F
  }
  m.matchOpen = false // 76EE/7726 ([26C4] = the scorer's base, never 1)
  raceState.raceOverCount = 2 // 76F2/772A
  if (scorer.drawnThisFrame) ctx.sound?.playSfx(0x10) // 76F8/7730
  return p1Scored ? 0 : 1 // 76D2 BX=P1 / 770A BX=P2
}

const rw = (m, o) => m[o] | (m[o + 1] << 8)
const ww = (m, o, v) => { m[o] = v & 0xff; m[o + 1] = (v >> 8) & 0xff }

/** `87F3`: one fixed-point step of a projectile's packed direction word (AH high nibble + AL). */
function step87F3(ax, cx) {
  let ah = (ax >> 8) & 0xf0
  const al = ax & 0xff
  if (al & 0x80) {
    const r = ah - ((-al) & 0xff)
    if (r < 0) cx = (cx - 1) & 0xffff
    ah = r & 0xff
  } else {
    const r = ah + al
    if (r > 0xff) cx = (cx + 1) & 0xffff
    ah = r & 0xff
  }
  return [(ah << 8) | al, cx]
}

/** One axis of 51B2 (`51DC-5210` / `5214-5248`) on raw record bytes. */
function flightAxis(m, dir, pos) {
  let ax = rw(m, dir)
  let cx = rw(m, pos)
  for (let i = 0; i < 6; i++) [ax, cx] = step87F3(ax, cx)
  ax = (ax & 0xf0ff) | (rw(m, dir) & 0x0f00)
  ww(m, dir, ax)
  const d = ((((ax >> 8) & 0xf) - 8) << 24) >> 24
  ww(m, pos, cx + d)
}

/**
 * A blink swap tick's pass on BX = k, the bar value (0..8): 309F-30A9 treat k as a car base, so
 * 73E7's and 51B2's `[BX+disp]` land 0..8 bytes into car 0's record (docs/engine.md §9an,
 * `UNKNOWN_h2h_bx_clobber_effects`). Emulated on car 0's raw bytes via `car.js`'s toBytes/fromBytes,
 * exactly as transcribed from 73E7-7428 / 51B2-525D / 87F3: the guard word 0x64+k; if non-zero,
 * 73E7's INC of word 0x66+k and its drift (words 0x64+k as a state in {1,4,5}, 0x78+k as the count,
 * 0x74+k/0x76+k added to 0x12+k/0x1E+k); then 51B2 gated on word 0x15A+k. Most of this is erased by
 * the exchange end and the respawn; what survives is a hit flag cleared by a k=2/4/6 drift, and --
 * with car 0's offTrackTicks set (round 8) -- the k=7 corruption of the reload/pad words. Not
 * reproduced here: the original never re-inits those words between races, and this port spawns
 * fresh car records every race, so that corruption cannot carry into a later race's firing.
 */
export function applyScoreSlotGarbage(car0, k, ctx) {
  const m = toBytes(car0)
  if (rw(m, 0x64 + k) !== 0 && !(ctx.round === 9 && k !== 0)) { // 309F guard, 73E7-73F3
    ww(m, 0x66 + k, rw(m, 0x66 + k) + 1) // 73F4
    const st = rw(m, 0x64 + k)
    if ((st === 1 || st === 4 || st === 5) && rw(m, 0x78 + k) !== 0) { // 73F8-7412
      ww(m, 0x78 + k, rw(m, 0x78 + k) - 1) // 7414
      ww(m, 0x12 + k, rw(m, 0x12 + k) + rw(m, 0x74 + k)) // 7418-741C
      ww(m, 0x1e + k, rw(m, 0x1e + k) + rw(m, 0x76 + k)) // 7420-7424
    }
  }
  if (rw(m, 0x15a + k) !== 0) { // 51B2
    ww(m, 0x15a + k, rw(m, 0x15a + k) - 1) // 51BC
    if (rw(m, 0x15a + k) >= 0x28) { // 51C0 JNC
      if (rw(m, 0x14c + k) < 5) ww(m, 0x14c + k, rw(m, 0x14c + k) + 1) // 51D1-51D8
      flightAxis(m, 0x156 + k, 0x14e + k)
      flightAxis(m, 0x158 + k, 0x152 + k)
      const a = rw(m, 0x150 + k)
      if (a !== 0) { ww(m, 0x150 + k, a - 1); ww(m, 0x154 + k, rw(m, 0x154 + k) - 1) } // 524C-5259
    }
  }
  Object.assign(car0, fromBytes(m))
}

/**
 * The post-HUD two-car dispatch, `9241-9281` (per drawn frame, after the car layer and the HUD):
 * P1 then P2 -- state 0xC runs 855A, state 0xB runs 851F; P2 in 0xC also skips 8634 -- then 8634
 * while [26C2] != 0. Mutates game state exactly where those routines do (the spin, the all-cars speed
 * zero of 7AF8, [2621]/[2630], the banner slide) and leaves this frame's draw list in `m.banners`.
 */
export function twoCarBanners(cars, raceState, ctx) {
  const m = raceState.twoCar
  const draws = []
  const [p1, p2] = cars
  if (p1.state === 0xc) scorerBanner(0, cars, m, ctx, draws)
  else if (p1.state === 0xb) spinBanner(cars, m, ctx, draws)
  let skipSlide = false
  if (p2.state === 0xc) { scorerBanner(1, cars, m, ctx, draws); skipSlide = true }
  else if (p2.state === 0xb) spinBanner(cars, m, ctx, draws)
  if (!skipSlide && m.bannerMode !== 0) slideBanner(m, draws)
  m.banners = draws
}

/** `851F`, a state-0xB car: the scorer spins in place (+8/256 per frame) and, on a non-deciding
 * point, "Bonus" shows at centre (0x80,0x7C). The car it was called for is ignored ([26B8] is read). */
function spinBanner(cars, m, ctx, draws) {
  stopEngineSounds(cars) // 851F CALL 7AF8
  if (ctx.round === 9 || m.spotlight === NONE) return // 8526
  const s = cars[m.spotlight]
  s.heading = (s.heading + 8) & 0xff // 852D
  if (m.score >= 7 || m.score <= 1 || toI16(s.lapsRemaining) <= 0) return // 8538-8546
  draws.push({ index: 0, cx: 0x80, cy: 0x7c }) // 854D-8556
}

/**
 * `855A` (Ghidra: DrawRaceOverBannerSfx10), a state-0xC car: only the scorer's call does anything
 * beyond 7AF8. A deciding point ([26B4]+[26B6] is 15 or 1 during the blink) or a match already
 * decided by the finish block ([26C2]==0xC8) slides "Winner" down from centre-Y -24 by 8 per frame
 * to 124, hides the other car's body ([2621]) and records the result side ([2630]); any other point
 * shows a static "Bonus". Every Winner frame keeps sfx 16 going (AH=0Ah "still playing?" then AH=5),
 * the keep-alive the driver answers synchronously in its worklet (docs/engine.md §9cn).
 */
function scorerBanner(carIndex, cars, m, ctx, draws) {
  stopEngineSounds(cars) // 855D
  if (ctx.round === 9 || m.spotlight !== carIndex) return // 8560/856A
  const car = cars[carIndex]
  if (ctx.round === 8) car.heading = (car.heading + 8) & 0xff // 8573
  const sum = m.score + m.shadow // 8585
  let init
  if (sum === 0xf || sum === 1) init = m.bannerMode === 0 // 85BA
  else if (m.bannerMode === 0xc8) init = true // 859D
  else if (m.bannerMode === 2) init = false // 85A5
  else { draws.push({ index: 0, cx: 0x80, cy: 0x7c }); return } // 85AC
  if (init) { // 85C1
    m.bannerX = 0x80
    m.bannerY = -24
    m.bannerMode = 2
  }
  m.bannerX = 0x80 // 85D3
  m.bannerY = Math.min(m.bannerY + 8, 0x7c) // 85D9-85E5
  ctx.sound?.keepAliveSfx?.(0x10) // 85EB-85FF: AH=0Ah, then AH=5 if sfx 16 isn't playing (docs/engine.md §9cn)
  stopEngineSounds(cars) // 8603
  m.hiddenCar = carIndex === 0 ? 1 : 0 // 8606-861C
  m.winnerSide = carIndex === 0 ? 1 : 2 // 8620
  draws.push({ index: 1, cx: m.bannerX, cy: m.bannerY }) // 8623-862D
}

/**
 * The race exit's 100-tick hold (`30F2-3100`, docs/engine.md §9cm): each iteration is `3165` (a tick),
 * `855A` with whatever BX holds, then `92BC`, which clears BL (`92D3`). (`855A` doesn't save BX, but its
 * Winner path only sets it to `[26B8]` (`8606`), the value that passed.) Iteration 1's BX is 4AEE's
 * camera-table car (`gateCar`, the same one `30DF`'s sfx gate reads); the later ones see it with BL
 * cleared: 0, 0x100, 0x200 or 0x400. So the gate `BX == [26B8]` (`856A`) passes on iteration 1 when
 * the gate car is the scorer, and on all 100 when BX is 0 and P1 is the scorer (`[26B8]` = 0; "none"
 * is the literal 1, never matched). A passing call is the ordinary `855A` body: on a deciding point
 * it writes `[2630]`/`[2621]` and slides the banner globals, and in round 8 spins the scorer 8/256.
 * Its drawing goes through ES=DS (`193C`, `3053`) into the reloaded-per-race PH0 art, never
 * presented. The sfx-16 keep-alive is left to `raceOverStart` (the port's driver has no query).
 * Returns how many iterations passed the gate.
 */
export function exitHold855a(cars, raceState, ctx, gateCar) {
  const m = raceState.twoCar
  if (!m) return 0
  const base = (i) => i * 0x164
  let bx = base(gateCar)
  let passes = 0
  for (let i = 0; i < 100; i++) {
    if (m.spotlight !== NONE && bx === base(m.spotlight)) {
      passes++
      scorerBanner(m.spotlight, cars, m, { ...ctx, sound: null }, []) // (8606's BX = [26B8] is the value that passed)
    }
    bx &= 0xff00 // 92BC: 92D3 MOV BL,0xC8 ... 92E4 DEC BL to 0
  }
  return passes
}

/** `8634`: after an exchange "Bonus" slides out to the left (bannerMode 1/2), "Play Off" shows while
 * the finish-block sequencer holds 3..99, nothing at 100 and above. (864F-866D is unreachable.) */
function slideBanner(m, draws) {
  if (m.bannerMode < 3) { // 8634
    m.bannerX = toI16(m.bannerX - 8) // 863B
    draws.push({ index: 0, cx: m.bannerX, cy: m.bannerY })
    return
  }
  if (m.bannerMode >= 100) return // 866F
  draws.push({ index: 2, cx: m.bannerX, cy: m.bannerY })
}

/**
 * `RunRaceMainLoop`'s exit fix-ups, `3115-3156`, which the tournament's 11D5 then reads: the
 * instant-win cheat ([2635]) forces [0,2,1,3], then [2630] (set by the Winner banner) forces slots
 * 0/1 to [0,2] (P1 won) or [2,0] (P2 won). The player won the race iff slot 0 holds car 0.
 */
export function twoCarFinalOrder(raceState) {
  let order = (raceState.rankOrder ?? [0, 1, 2, 3]).slice()
  if (raceState.cheatWin) order = [0, 2, 1, 3] // 3115-313A
  const w = raceState.twoCar?.winnerSide ?? 0
  if (w === 1) { order[0] = 0; order[1] = 2 } // 3143-3156
  else if (w === 2) { order[0] = 2; order[1] = 0 }
  return order
}
