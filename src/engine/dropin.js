// Round 3's shortcut/warp mechanic -- HandleCarState0EDropInSequencer, `1000:6ae5-6fe9`, docs
// §9r -- resolves UNKNOWN_6ae5_round3_sequencer, UNKNOWN_22E1_scope and UNKNOWN_stateE_reach. Fully
// re-disassembled instruction by instruction this session (not decompile-and-trust: an earlier
// pass had already decompiled this function and mis-described its two-car wait as depending on an
// unverified Ghidra-inferred "HumanPlayerCount" global -- direct disassembly shows it's simply
// `ctx.raceFormat===2`, the already-well-understood `[2656]`, and nothing else).
//
// **This is not a generic "cell-matching/slide/hide/show" curiosity -- it's a lap-progress-gated
// shortcut.** The SAME function is both round 3's terrain-dispatch entry for index-4 tiles (state-0
// cars only, `terrain.js`) AND state 0xE's own per-tick continuation handler (`states.js`) -- one
// function serving both roles, because the state table's entry for 0xE and the terrain table's
// row-4 entry for round 3 are the literal same address in the original binary. Confirmed genuinely
// reachable, not dead content: terrain index 4 appears 32 times in round 3's own `.DIR` data.
//
// The mechanic: 5 specific 96px world cells (`ROUND3_DROPIN_TABLE`, `engine-tables.js`) each carry
// a `minCursor` (a `checkpointOff`/lap-progress threshold) and a spawn target. Driving onto one of
// round 3's index-4 terrain tiles while your own `checkpointOff` has passed that cell's threshold
// triggers a scripted disappear (state 4, fall) -> reappear-elsewhere (state 0xE, sliding to the
// target, then driving in at speed) -> resume (state 0) sequence, gated to serialize (only one car
// finishes appearing at a time, globally, via a claim token) and, in two-car races only, to wait
// for a partner sharing the same physical drop point (`dropInSlot`) before proceeding -- with a
// documented ~40-tick timeout that drops the waiting car straight back to normal driving instead.
// **Driving over one of these tiles too early (or a two-car partner-recheck failing) crashes the
// car (state 5) unless `hazardVulnerable` is cleared (cheat type 7) -- confirmed live: the static
// init image has `hazardVulnerable=1` (vulnerable) for every car, so this is the real default
// behaviour, not something a rare cheat state avoids.** The `[28C0]==1` (race 1) check inside both
// scan loops was flagged for a closer look during review and re-confirmed by direct disassembly:
// for round 3's race 1, a MISMATCH on the table's very first entry gives up immediately rather than
// scanning the other 4 -- entries 1-4 are simply never reachable in race 1. This is a real, faithful
// asymmetry between round 3's two races, not a bug to smooth over.
//
// Shared, per-slot bookkeeping (the original's `[DI+0x2684/0x2686/0x2688/0x268a]` per-`dropInSlot`
// globals and its `[2680]`/`[2682]` race-wide tokens) lives on `raceState` (per advisor guidance),
// NOT a module-level singleton -- a singleton would silently leak state between the two independent
// races `check-play.mjs`'s own determinism test runs in one process. `raceState.dropInSlots[slot]`
// is a plain FIFO array of car references standing in for the original's 4-entry ring buffer: with
// at most 4 cars in existence and multi-slot sharing only ever populated in two-car races (which
// cap at 2 cars), the ring can never wrap the way a genuine >4-arrival scenario would, so a plain
// array reproduces the observable ordering exactly with none of the ring's own overwrite quirks.
// `[2682]` (`raceState.fallLatch`, a car index): latched, if empty, by the first car to reach
// subState 1 (6C01-6C08) -- and by state 4's own handler (7F69, states.js) -- and cleared once a
// sliding car has converged on its drop target (6E7E). Nothing in THIS function reads it back; its
// consumer is the two-car knockout reset (7759, twocar.js), whose fall branch makes the latched car
// the exchange's scorer (docs/engine.md §9am, correcting an earlier "no consumer" claim here).
//
// Not ported: the mid-sequence draw call (`CALL 7d73`, subState 4) -- rendering only, a no-op for a
// headless physics port, same treatment as every other draw-interleaved call in this codebase.

import { ROUND3_DROPIN_TABLE } from '../data/engine-tables.js'
import { SINE8 } from '../data/engine-tables.js'
import { mul2Floor256, toU16 } from './int16.js'
import { markDrawn } from './drawn.js'

const CELL_SIZE = 96
const SLIDE_STEP = 8 // *ctx.stepIncrement, per tick, per axis (1000:6df9)
const SETTLE_TOLERANCE = 50 // px, X axis only -- confirmed by disassembly, not a simplification (1000:6f16)
const PARTNER_TIMEOUT = 40 // ticks (1000:6daa)

/** The exact wraparound fold `6bc2-6bd2`/`6f8a-6f9a` uses for a spawn-target delta: corrects only
 * near-the-seam values (within 32px of +-3072), leaving an ordinary delta untouched -- NOT the same
 * as `int16.js`'s `wrapDelta`, which folds at the half-range point instead. */
function nearSeamFold(d) {
  if (d >= 0xbe0) d -= 0xc00
  if (d <= -0xbe0) d += 0xc00
  return d
}

/** `(v & 0xFFF0) + 8`, `1000:6ba6-6bb5`/`6f6e-6f7d`: snap to the centre of the 16px cell containing
 * `v`. `toU16` first, not a bare JS `&` -- `v` is always `nextX`/`nextY`, which `integrateAxis`
 * guarantees is `wrapWorld`-ed into `[0, 0xC00)` before this ever reads it, but the real instruction
 * is an AND on a genuine 16-bit register, and `&` on a JS number is a 32-bit signed op -- matching
 * the register width explicitly here means a stray negative caller can never silently misbehave. */
const snapTo16 = (v) => (toU16(v) & 0xfff0) + 8

function slotState(raceState, slot) {
  if (!raceState.dropInSlots) raceState.dropInSlots = {}
  if (!raceState.dropInSlots[slot]) raceState.dropInSlots[slot] = { queue: [], waitTicks: 0 }
  return raceState.dropInSlots[slot]
}

/** Zero one slot's count/head/tail/wait-timer words (`[2684/2686/2688/268A + DI]`): the two-car
 * knockout reset does it for the scorer's slot (77D9-77EF), a two-car respawn for the respawning
 * car's own slot (701B-7038). */
export function resetDropInSlot(raceState, slot) {
  const st = slotState(raceState, slot)
  st.queue = []
  st.waitTicks = 0
}

/** `1000:6b2e-6b69`/`6c28-6c6d`: scan `ROUND3_DROPIN_TABLE` for the car's current 96px cell (+-1
 * cell tolerance per axis). `ctx.race===1`'s early-bail (see module header) is reproduced exactly:
 * a mismatch on entry 0 gives up without checking entries 1-4. */
function findMatch(car, ctx) {
  const cellX = Math.floor(car.posX / CELL_SIZE)
  const cellY = Math.floor(car.posY / CELL_SIZE)
  for (const entry of ROUND3_DROPIN_TABLE) {
    if (Math.abs(entry.cellX - cellX) <= 1 && Math.abs(entry.cellY - cellY) <= 1) return entry
    if (ctx.race === 1) return null
  }
  return null
}

/** The shared failure path both subState 0's initial scan and subState 1's recheck fall into
 * (`1000:6f58`): no-op if cheat-immune, otherwise a crash (state 5) with the same
 * drift-to-nearby-16px-cell-centre setup state 7's own respawn already documents reusing. */
function crashOrWait(car) {
  if (!car.hazardVulnerable) return
  car.state = 5
  car.animTimer = 0
  const targetX = snapTo16(car.nextX)
  const targetY = snapTo16(car.nextY)
  car.driftDX = Math.floor(nearSeamFold(targetX - car.posX) / 4)
  car.driftDY = Math.floor(nearSeamFold(targetY - car.posY) / 4)
  car.driftSteps = 4
  car.skidding = 0
}

/**
 * Terrain-triggered entry (`1000:6ae5`'s own subState-0 branch, docs/engine.md §5 row index 4),
 * called only while `car.state===0` from round 3's terrain dispatch. On a qualifying match: reserves
 * this car a place in its `dropInSlot`'s queue, sets up a short 4-tick drift toward the nearest 16px
 * cell centre (visible during the state-4 fall animation that follows), and hands off to state 4.
 * On no match, or a match whose `minCursor` hasn't been reached yet: `crashOrWait`.
 */
export function triggerDropIn(car, ctx, raceState) {
  const entry = findMatch(car, ctx)
  if (!entry || car.checkpointOff < entry.minCursor) { crashOrWait(car); return }

  car.state = 4
  car.subState = 1
  car.dropInSlot = entry.dropInSlot
  slotState(raceState, entry.dropInSlot).queue.push(car)

  const targetX = snapTo16(car.nextX)
  const targetY = snapTo16(car.nextY)
  car.driftDX = Math.floor(nearSeamFold(targetX - car.posX) / 4)
  car.driftDY = Math.floor(nearSeamFold(targetY - car.posY) / 4)
  car.driftSteps = 4
}

/** subState 1 (`1000:6c01`): re-entered the instant state 4's fall animation hands off to state
 * 0xE (`states.js`'s `stepFallAnim`). Re-scans the SAME table at the car's (now slightly different)
 * position; on a still-qualifying match, commits the reappearance: spawn position/heading, a
 * max-speed velocity vector in that heading (drives the car in via the ordinary integrate/commit
 * pipeline during subStates 2-4, since `bounceAndCommit` commits `nextX/Y` for state 0xE same as
 * state 0), and a full reset of ~20 transient per-tick fields plus every puff/splash slot -- a car
 * that's about to reappear shouldn't carry stale skid/grip/animation state from before it vanished.
 * On failure: releases this car's own queue reservation, then `crashOrWait`. */
function stepReenter(car, ctx, raceState) {
  // 6c0c `MOV [2680],0xFFFF`: every car starting a re-entry releases the race-wide drop-in owner
  // (the only clear of [2680]; 6ec1/6edc are the only sets) -- before the re-match, so on the failure
  // path too. Without it a four-car round-3 race could deadlock with every car parked in state 0xE
  // (docs/engine.md §9ah; exposed once the checkpoint cursor went to byte units). Before it, 6c01-
  // 6c08 latch [2682] to this car if it is empty (the two-car knockout reset's fall branch reads it).
  if (raceState.fallLatch == null) raceState.fallLatch = (ctx.cars ?? []).indexOf(car)
  raceState.dropInOwner = null
  const entry = findMatch(car, ctx)
  if (!entry || car.checkpointOff < entry.minCursor) {
    const slot = slotState(raceState, car.dropInSlot)
    slot.queue = slot.queue.filter((c) => c !== car)
    crashOrWait(car)
    return
  }

  car.spawnTargetX = entry.spawnTargetX
  car.spawnTargetY = entry.spawnTargetY
  car.heading = entry.heading
  car.speed = car.maxSpeedCur
  const si = car.heading & 0xf8
  car.velX = mul2Floor256(SINE8[si], car.speed)
  car.velY = mul2Floor256(SINE8[(si - 0x40) & 0xff], car.speed)

  car.posXfrac = 0; car.nextXfrac = 0; car.posYfrac = 0; car.nextYfrac = 0
  car.terrainIdx = 0; car.terrainIdxPrev = 0; car.dirByte = 0; car.dirBytePrev = 0
  car.animStep = 0; car.animStep2 = 0; car.animTimer = 0
  car.skidding = 0; car.lowGripTimerA = 0; car.lowGripTimerB = 0
  car.splashTrigger = 0; car.puffSrcSkid = 0; car.puffSrcWet = 0
  car.puffOffA = -30; car.puffOffB = 20; car.puffOffC = 30; car.puffOffD = -20
  car.puffSlotCursor = 0; car.splashSlotCursor = 0; car.puffCooldown = 0; car.splashCooldown = 0
  for (const slot of car.puffSlots ?? []) slot.frame = -1
  for (const slot of car.splashSlots ?? []) slot.frame = -1

  car.subState = 2
  car.active = 0
}

/** subState 2 (`1000:6d94`): the two-car-only partner wait, entirely SKIPPED (falls straight into
 * subState 3, same tick) outside `raceFormat===2` -- confirmed by direct disassembly to be a plain
 * `ctx.raceFormat===2` check, not a separate "human player count" global an earlier decompile-only
 * pass had guessed at. On timeout (`PARTNER_TIMEOUT` ticks with no partner), gives up: drops the
 * car straight back to normal driving at its current position -- NOT a crash. Once a partner is
 * present, also waits for the OTHER two-car car ([2660]/[2662], cars 0 and 1, read
 * unconditionally) to have left state 4 before proceeding.
 *
 * The timeout writes [2911]=1 (6DB4) -- the two-car KNOCKOUT REQUEST, not a banner flag: the next
 * render gate runs the knockout reset (twocar.js), whose fall branch makes the [2682] car (normally
 * this one, latched when it fell) the exchange's scorer (docs/engine.md §9am). The queue entry and
 * the wait timer are deliberately left alone here; the reset (77D9) and the respawn (701B) clear them. */
function stepPartnerWait(car, ctx, raceState) {
  if (ctx.raceFormat !== 2) return stepSlide(car, ctx, raceState)

  const slot = slotState(raceState, car.dropInSlot)
  if (slot.queue.length !== 2) { // 6D9F: [DI+2684] != 2
    slot.waitTicks++
    if (slot.waitTicks < PARTNER_TIMEOUT) return
    raceState.knockoutRequest = 1 // 6DB4
    car.state = 0
    car.active = 1
    car.subState = 0
    return
  }

  const cars = ctx.cars ?? []
  const other = car === cars[0] ? cars[1] : cars[0] // 6DD5-6DE9
  if (other && other.state === 4) return
  stepSlide(car, ctx, raceState)
}

/** subState 3 (`1000:6df3`): slides `posX/posY` toward `spawnTargetX/Y` by `SLIDE_STEP *
 * ctx.stepIncrement` per axis per tick, snapping exactly once within that distance. Once both axes
 * have converged, a per-`dropInSlot` FIFO queue-order check (must be at the front of the queue for
 * THIS physical drop point) gates a further, race-wide "only one car finishes at a time" claim
 * (`raceState.dropInOwner`, gated differently by format -- two-car waits for the current owner to
 * be grounded, four-car waits for it to have returned to normal driving). Once granted: subState 4,
 * `active=1`, `height=1`, `zVel=8` (exactly this port's own pre-existing `stepDropInSimplified`
 * values -- confirmed, not coincidental) and falls straight into subState 4, same tick. */
function stepSlide(car, ctx, raceState) {
  car.subState = 3
  const step = SLIDE_STEP * (ctx.stepIncrement ?? 1)

  const dx = car.spawnTargetX - car.posX
  if (Math.abs(dx) < step) car.posX = car.spawnTargetX
  else car.posX += car.posX < car.spawnTargetX ? step : -step

  const dy = car.spawnTargetY - car.posY
  if (Math.abs(dy) < step) car.posY = car.spawnTargetY
  else { car.posY += car.posY < car.spawnTargetY ? step : -step; return }

  if (Math.abs(car.spawnTargetX - car.posX) >= step) return // 1000:6e77-6e7b
  raceState.fallLatch = null // 6E7E, before the queue-head test

  const slot = slotState(raceState, car.dropInSlot)
  if (slot.queue[0] !== car) return

  const owner = raceState.dropInOwner
  if (owner != null && owner !== car) {
    const ready = ctx.raceFormat === 2 ? (owner.height === 0 && owner.zVel === 0) : owner.state === 0
    if (!ready) return
  }
  raceState.dropInOwner = car

  car.subState = 4
  car.active = 1
  car.height = 1
  car.zVel = 8
  stepFinalize(car, ctx, raceState)
}

/** subState 4 (`1000:6efa`): the mid-sequence draw call is skipped (rendering only). The car is
 * visible and driving in under its own subState-1 velocity vector via the ordinary physics
 * pipeline; this only watches the X-axis distance to `spawnTargetX` (confirmed by disassembly to be
 * X-only, not a simplification -- `1000:6f07-6f19` never reads `spawnTargetY`/`posY` at all) until
 * it's within `SETTLE_TOLERANCE`, then releases the slot/queue bookkeeping and resumes state 0. */
function stepFinalize(car, ctx, raceState) {
  markDrawn(car, ctx) // 6EFF: the body draw writes the drawn flag (docs/engine.md §9ao)
  if (Math.abs(car.spawnTargetX - car.posX) > SETTLE_TOLERANCE) return

  const slot = slotState(raceState, car.dropInSlot)
  slot.queue = slot.queue.filter((c) => c !== car)
  slot.waitTicks = 0
  car.subState = 0
  car.state = 0
}

/** State 0xE's own per-tick continuation (`states.js`), dispatching on `car.subState` exactly as
 * `1000:6af0-6b18` does. */
export function stepDropIn(car, ctx, raceState) {
  switch (car.subState) {
    case 1: stepReenter(car, ctx, raceState); break
    case 2: stepPartnerWait(car, ctx, raceState); break
    case 3: stepSlide(car, ctx, raceState); break
    case 4: stepFinalize(car, ctx, raceState); break
    default: break // subState 0 here would mean state===0xE reached with no active sequence -- not a real reachable case
  }
}

/**
 * The drift-application half of `73e7` (`1000:7414-7424`) -- NOT the whole function: `73e7` also
 * bumps `animTimer` unconditionally, but every state that uses `driftDX/DY/Steps` (1, 4, 5) already
 * increments its own `animTimer` inline via `animTableDone` (states.js) -- porting `73e7`'s own
 * increment too would double-count it every tick. Only ported here: apply `driftDX/DY` and count
 * down `driftSteps` while in states {1, 4, 5}, the exact gate `1000:73f8-740b` checks. Also ports
 * `73e7`'s own round-9 quirk (`1000:73e7-73f3`): non-car-0 cars skip this entirely in round 9.
 */
export function applyScriptedDrift(car, ctx, isCarZero) {
  if (ctx.round === 9 && !isCarZero) return
  if (car.state !== 1 && car.state !== 4 && car.state !== 5) return
  if (!car.driftSteps) return
  car.driftSteps--
  car.posX += car.driftDX
  car.posY += car.driftDY
}
