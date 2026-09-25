// The car state machine (`DS:278F`, docs/engine.md §4). M3.3 covered states 0, A, 2, D and 7;
// M3.6 adds 1 (hazard death), 4 (fall) and 5 (crash) -- the three states PLAN-ENGINE.md's own M3.6
// row names. B/C/F/0x10 (two-car lights and banners) stay out of scope: they need the two-car/
// round-9-specific flows M3.6 doesn't touch. State E (drop-in sequencer) is DELIBERATELY
// SIMPLIFIED, not fully ported: it needs the `DS:22E1` cell-matching table and a 5-phase
// slide/hide/show sequencer, and per docs/engine.md §5 it is reachable as a terrain block only
// from round 3's row index 4 -- ROUND21 (this milestone's playable target, round 2) never
// dispatches into it, so full fidelity there isn't exercisable by this session's own acceptance
// test. What's here instead (`stepDropInSimplified`) exists only so a car that *does* reach state E
// (state 4's own fall animation ends there) doesn't get stuck forever: it skips straight to the
// sequencer's own documented terminal action (drop back in at the current position, state 0).

import { KNOCKOUT_DURATIONS, LEV_NUDGE_TABLE, LEV_HEADING_TABLE, STATE1_ANIM_ROUND2, STATE1_ANIM_DEFAULT, STATE1_ANIM_A, STATE1_ANIM_B, FALL_ANIM, CRASH_ANIM, SINE8 } from '../data/engine-tables.js'
import { wrapWorld, mul2Floor256, toI16 } from './int16.js'
import { queryWorldAt } from './collide.js'
import { stepDropIn, resetDropInSlot } from './dropin.js'
import { cursorForProgress } from './checkpoints.js'
import { markDrawn } from './drawn.js'

/** State 0: normal driving. The physics itself (velocity/collide/terrain/checkpoints) already ran
 * this step for state-0 cars; its handler IS the body draw `7D73` (`DS:278F` entry 0), which writes
 * the drawn flag -- on screen or not (`drawn.js`, docs/engine.md §9ao). */
function stepDriving(car, ctx) {
  markDrawn(car, ctx)
}

/**
 * States 2 and D (`HandleCarState2or0DKnockoutAnim`, 82BE): the shared re-appear/knockout
 * animation, `KNOCKOUT_DURATIONS` walked by `animTimer` until the 0xFFFF sentinel, then transition
 * to `endState` (0 for state 2, 7 for state D). Frame selection (`KNOCKOUT_FRAME_IDS`) is drawing
 * only and not needed for the headless step.
 *
 * Known simplification (flagged by an adversarial review pass, not fixed): in the real game 82BE
 * runs from render (`90c5`), which happens *before* `73e7` bumps `animTimer` for this same
 * iteration (docs/engine.md §2/§4), so a handler call sees last iteration's already-bumped value.
 * This function bumps-then-tests in one call, one tick earlier than that. Reproducing the real
 * order needs `animTimer` bumped in its own pass after `runStates` (mirroring `73e7`'s place in
 * `RunRaceMainLoop`), which isn't worth the restructuring for M3.3's headless-only, no-animation
 * scope -- every duration boundary here is off by at most one 35Hz tick.
 */
function stepKnockoutAnim(car, endState, raceState, ctx) {
  // A car the post-commit 73E7 missed (7429's BX clobber, twocar.js `stepExchange`) tests the value it
  // was reset to, one step behind the other car (docs/engine.md §9an).
  if (car.skipAnimBump) car.skipAnimBump = 0
  else car.animTimer = (car.animTimer ?? 0) + 1
  const idx = KNOCKOUT_DURATIONS.findIndex((t) => car.animTimer <= t)
  if (idx === -1 || KNOCKOUT_DURATIONS[idx] === 0xffff) {
    car.state = endState
    car.animTimer = 0
    // 8321: the end of the state-2 reappear clears [2911] (every format) -- the only thing that
    // re-arms the two-car camera trigger after an exchange (0xD -> 7 -> 2 -> 0). 0xD's own end (832C,
    // -> 7) does not touch it (docs/engine.md §9am).
    if (endState === 0 && raceState) raceState.knockoutRequest = 0
    // 8327: state 2's end draws the body once (now in state 0); 0xD's end does not.
    if (endState === 0) markDrawn(car, ctx)
  } else if (endState === 0 ? idx >= 3 : idx <= 3) {
    // 82DB-82F5: the body is drawn (and the drawn flag written) from index 3 on while re-appearing
    // (state 2), up to index 3 while being knocked out (0xD); the other frames draw only the overlay
    // (8339). The index is this port's own (one tick early, see above), docs/engine.md §9ao.
    markDrawn(car, ctx)
  }
  // 8332 `MOV [BX+12AA],0`: every path through 82BE converges here, so the drone wall-stuck count
  // is cleared on EVERY tick of states 2/0xD, not only when the animation ends in state 0. With the
  // clear only at the end, a drone knocked out by the >=20 rule was re-knocked by the very next
  // bounce (`wallHitPending` persists while its collision query is gated off) and looped 0xD<->7
  // forever -- R82/R83 races could never end (docs/engine.md §9ah).
  car.droneWallStuck = 0
}

/**
 * State 7, `6FEB-73E5` (docs/engine.md §4). Rounds 2/8 count `subState` ([1382]) down from 0x46
 * first; then snap to the safe point's 96px cell centre + LEV nudge, recompute tile/progress for
 * the nudged position, derive heading from the LEV heading bucket XORed by both MAP-attribute
 * bits, and hand off to state 2.
 *
 * Corrected by an adversarial review pass (2026-09-20): the nudge and heading were reading the
 * car's stale levByte/mapAttr (last written at the crash site, not the safe point) instead of
 * doing the doc's own "recompute tile/progress/cursor (7121-7160)" step. Needs `ctx.world` (a
 * `collide.js` world) -- if it isn't provided the old fields are used as a fallback rather than
 * throwing, since the acceptance test can construct cars directly without a world.
 *
 * UNKNOWN_respawn_sideways_offset resolved (docs/engine.md §9v, live disassembly of 1000:71a2-721f):
 * NOT a literal axis-aligned +-12px. It's a 12-unit vector at heading+-90 -- `[BX+1278]` (a
 * per-car scratch word, reused across states for unrelated purposes elsewhere -- here it's just
 * holding the just-computed `heading` value from the LEV_HEADING_TABLE step above) masked to a
 * multiple of 8, then +0x40 (rotate +90 deg) for the camera-target car (`[2660]`, `cars[0]` in
 * this port's one-player convention) or -0x40 (rotate -90 deg) for every other car, wrapped into
 * [0,0x100); the offset itself is `mul2Floor256(12, SINE8[angle])` on X and
 * `mul2Floor256(12, SINE8[(angle-64)&0xff])` on Y (the same sin/cos-from-one-table idiom already
 * used in collide.js's car-car collision), added to the just-nudged safe-point position.
 */
function stepRespawn(car, ctx, raceState) {
  if (ctx.round === 2 || ctx.round === 8) {
    // 6FFA-7005: DEC first, then test -- 0x46 waits 0x45 calls, and 0 becomes -1 and proceeds
    // (subState is zeroed again at 72FC). The port used to test before decrementing (§9an).
    car.subState = (car.subState - 1) & 0xffff
    if (toI16(car.subState) > 0) return
  }
  // 7008-7016: tournament race 0x16 ([28C1]) with the car's pre-respawn meta-tile 4 moves the safe
  // point up by 0x60 -- persistently, before the cell snap below.
  if (ctx.tournamentIndex === 0x16 && car.metaTile === 4) car.safeY -= 0x60
  // Two-car only, 701B-7038: the respawning car's own drop-in slot is zeroed (docs/engine.md §9am).
  if (ctx.raceFormat === 2 && raceState) resetDropInSlot(raceState, car.dropInSlot ?? 0)
  // 703E-708E: the motion/terrain resets (docs/engine.md §9an lists the ones the port was missing).
  car.maxSpeedCur = car.maxSpeedBase
  car.targetVelX = 0
  car.targetVelY = 0
  car.nextXfrac = 0
  car.nextYfrac = 0
  car.terrainIdx = 0
  car.terrainIdxPrev = 0
  // 7302-7389, this function's own opening (re-disassembled live while wiring docs/sound.md §3b
  // id9's remaining "7325" site -- previously the whole function's real body ran well past where
  // this port's own version began): docs/sound.md id9 "world-wrap reposition... fires for ANY
  // car" fires here, drawn-gated, before anything else -- and the same puff/splash cooldown+slot
  // reset `dropin.js`'s own stepReenter already does for its own reappearance case (a car
  // respawning shouldn't carry stale skid/puff/splash animation state from before the crash).
  if (car.drawnThisFrame) ctx.sound?.playSfx(9)
  car.puffCooldown = 0
  car.splashCooldown = 0
  for (const slot of car.puffSlots ?? []) slot.frame = -1
  for (const slot of car.splashSlots ?? []) slot.frame = -1
  car.speed = 0
  car.velX = 0
  car.velY = 0
  const cellX = Math.floor(car.safeX / 96) * 96 + 48
  const cellY = Math.floor(car.safeY / 96) * 96 + 48
  const cellHit = ctx.world ? queryWorldAt(ctx.world, cellX, cellY) : null
  const levAtCell = cellHit ? cellHit.lev.raw : car.levByte
  const [nx, ny] = LEV_NUDGE_TABLE[(levAtCell >> 2) & 7]
  car.posX = wrapWorld(cellX + nx)
  car.posY = wrapWorld(cellY + ny)
  car.posXfrac = 0
  car.posYfrac = 0
  car.nextX = car.posX // 70C4-711B: pos AND next
  car.nextY = car.posY

  const finalHit = ctx.world ? queryWorldAt(ctx.world, car.posX, car.posY) : null
  const mapAttr = finalHit ? finalHit.mapAttr : car.mapAttr
  let heading = LEV_HEADING_TABLE[(levAtCell >> 5) & 3]
  if (mapAttr & 0x2) heading ^= 0x80
  if (mapAttr & 0x1) heading ^= 0x80
  car.heading = heading & 0xff

  const isCameraTarget = ctx.cars ? car === ctx.cars[0] : true
  let angle = (heading & 0xf8) + (isCameraTarget ? 0x40 : -0x40)
  angle = ((angle % 0x100) + 0x100) % 0x100
  car.posX = wrapWorld(car.posX + mul2Floor256(12, SINE8[angle]))
  car.posY = wrapWorld(car.posY + mul2Floor256(12, SINE8[(angle - 64) & 0xff]))
  car.nextX = car.posX // 71B8-724E: pos AND next
  car.nextY = car.posY

  if (finalHit) {
    car.metaTile = finalHit.metaTile
    car.mapAttr = finalHit.mapAttr
    // 7120-7160 (docs/engine.md §9ah): BOTH [12E3] and [12E1] take the respawn cell's plane-2 byte
    // -- unconditionally, even a 0 (unlike the zero-guarded writes in collide.js) -- and the
    // checkpoint cursor [12E7] is re-derived from it. [12E5]/checkpointOffSaved are left alone.
    car.progress = finalHit.progress
    car.progressPrev = finalHit.progress
    car.checkpointOff = cursorForProgress(ctx.round, ctx.race, finalHit.progress)
    car.levByte = finalHit.lev.raw
    car.subCell = (finalHit.subx << 8) | finalHit.suby // [12CE]=CX (7121): CH=subx, CL=suby
    if (finalHit.metaTile === 0x1a) car.onBridge = 0 // 716C
  }

  // `RespawnCarAtSafePoint 1000:7258-7264` snapshots knockoutX/Y from the position it JUST
  // computed above, after the LEV-nudge/heading/sine-offset writes -- the real state-2 overlay
  // anchor is the NEW respawn position, not wherever the car was before crashing (`mm-re-player-
  // visible` 2026-09-23, docs/engine.md §9aj). A real, pre-existing gap this pass closes: every
  // OTHER writer of these two fields (checkpoints.js, collide.js, airborne.js, projectile.js) was
  // already ported; only this one, the most common path into state 2, was missing it.
  car.knockoutX = car.posX
  car.knockoutY = car.posY
  car.state = 2
  car.controlsLocked = 1
  car.cameraFarFlag = 0
  car.animTimer = 0
  // 7258-72EC, the rest of the state-2 hand-off (docs/engine.md §9an): animation cursors, the
  // vertical state, the skid/grip/splash transients, the puff spray offsets, halveOnBounce.
  car.animStep = 0
  car.animStep2 = 0
  car.height = 0
  car.zVel = 0
  car.bounceOnLand = 1
  car.skidding = 0
  car.lowGripTimerA = 0
  car.lowGripTimerB = 0
  car.puffSrcSkid = 0
  car.puffSrcWet = 0
  car.splashTrigger = 0
  car.puffOffA = -30; car.puffOffB = 20; car.puffOffC = 30; car.puffOffD = -20
  car.halveOnBounce = 1
  // 72F6: the drop-in wait counter of this car's slot is zeroed in every format; 72FC subState=0.
  const slot = raceState?.dropInSlots?.[car.dropInSlot ?? 0]
  if (slot) slot.waitTicks = 0
  car.subState = 0
  // 732A-7366: slot cursors, ramp flag, cooldowns (and the slot arrays, cleared at the top).
  car.puffSlotCursor = 0
  car.splashSlotCursor = 0
  car.rampJumpActive = 0
  // 7375/7378: 585B twice -- dirByte AND dirBytePrev take the respawn cell's DIR byte.
  if (finalHit) { car.dirByte = finalHit.dirByte; car.dirBytePrev = finalHit.dirByte }
  // 737B-73B0, rounds 4/5: terrainLevel from the DIR grade: 5..12 -> grade-4, 13 -> -1, 14 -> 4.
  if (ctx.round === 4 || ctx.round === 5) {
    const g = car.dirByte >> 4
    if (g === 0xd) car.terrainLevel = 0xffff
    else if (g === 0xe) car.terrainLevel = 4
    else if (g >= 5) car.terrainLevel = g - 4
  }
  // 7302-7314: [26BC]/[26C2]/[26BE]/[26C0] = 0 on every respawn -- ends the post-exchange "Bonus"
  // slide and restarts a running "Play Off" (the two-car banner globals, docs/engine.md §9am).
  if (raceState?.twoCar) { raceState.twoCar.bannerMode = 0; raceState.twoCar.bannerX = 0; raceState.twoCar.bannerY = 0 }
  // 7369/736F: any car's respawn resets the camera step to 8 -- the camera then creeps back and
  // controls stay locked until it settles (cameraFarFlag needs both steps at 0x32).
  if (ctx.camera) { ctx.camera.stepX = 8; ctx.camera.stepY = 8 }
  // Two-car only, 73B6-73E4: BOTH cars' lapsRemaining become min(P1, P2) on every respawn.
  if (ctx.raceFormat === 2 && ctx.cars?.length >= 2) {
    const [p1, p2] = ctx.cars
    const m = Math.min(toI16(p1.lapsRemaining), toI16(p2.lapsRemaining))
    p1.lapsRemaining = m
    p2.lapsRemaining = m
  }
}

/** Shared {threshold,frames} table walk (KNOCKOUT_DURATIONS' own pattern, generalised): true once
 * animTimer has passed every real threshold and only the 0xFFFF sentinel remains. */
function animTableDone(car, table) {
  car.animTimer = (car.animTimer ?? 0) + 1
  const idx = table.threshold.findIndex((t) => car.animTimer <= t)
  return idx === -1 || table.threshold[idx] === 0xffff
}

/**
 * State 1, `880A HandleCarState1HazardDeath` (docs/engine.md §9w). Speed and velocity pinned to 0
 * for the whole state. Ends in state 7 (respawn), same as every other knockout path.
 *
 * `UNKNOWN_state1_oscillator_port` resolved 2026-09-22 (docs/engine.md §9w), correcting the M3.17
 * deferral: that deferral's own premise -- "no heading field is read anywhere in the real function"
 * and "five currently-unnamed `CarRecord` fields" -- was wrong. `[BX+0x1278]` genuinely IS
 * `car.heading` (the same field `stepRespawn` already uses) and all five fields the real function
 * touches (`heading`, `speed`, `animTimer`, `animStep`, `driftSteps`) were already named in `car.js`
 * -- the M3.17 pass compared raw absolute disassembly offsets against `car.js`'s RELATIVE
 * (CAR_RECORD_BASE-subtracted) FIELDS table and never converted them, so the cross-reference simply
 * wasn't done. A fresh full re-disassembly of 880A-8928 (all 91 instructions) now gives the real
 * mechanism precisely, for rounds 4/9 only: every tick, bucket `heading & 0xf8` into steps of 8; if
 * the bucket is already 0 or 0x80 the car has "arrived" at that waypoint (table A for bucket 0,
 * table B for bucket 0x80 -- selected by WHICH waypoint was reached, not by round as the prior code
 * assumed); otherwise step `heading` by +-4 toward whichever of {0, 0x80} is nearer going around the
 * circle (not the prior code's linear/no-basis "diff" stepping) and return immediately, touching
 * nothing else -- a genuine draw-only tick. All other rounds skip the oscillator and always use the
 * round-2/default table split (already correctly ported, unchanged here).
 *
 * A second gate applies uniformly, after the oscillator (if any): `driftSteps != 0` pauses table
 * advancement for the whole tick (again draw-only) -- the same field `dropin.js`'s
 * `applyScriptedDrift` already owns and decrements elsewhere in the per-step pipeline; the prior code
 * never checked it for state 1 at all, for any round.
 *
 * Inside the real `880A-8928` itself, `animTimer` (`[BX+0x12B0]`) is only ever COMPARED, never
 * incremented -- confirmed by an exhaustive `search_instructions` sweep of every writer of
 * `[BX+0x12B0]` across the whole binary (docs/engine.md §9w). It's bumped unconditionally, once per
 * active car per tick, by the shared `1000:73E7` (`applyScriptedDrift`'s real namesake), independent
 * of state and of this function's own driftSteps gate -- and every entry point into states 1/2/4/5/D
 * (terrain hazard dispatch, airborne landing, `RespawnCarAtSafePoint`, state E's own entries) zeroes
 * it first. An advisor-directed gating check (every writer, every entry/exit site) confirmed this
 * makes the "bump inline, once per handler call, from a zeroed baseline" shape `animTableDone`
 * (states 2/4/5/D, unchanged below) already uses behaviorally equivalent to the real external
 * increment -- so no five-state refactor was needed, and none was done. State 1 gets the same
 * self-contained inline bump here (not a call into `applyScriptedDrift`, which would double-count
 * against `animTableDone`'s own inline bumps for the OTHER four states it doesn't touch) -- placed
 * unconditionally as this function's first statement (gated, see below) so it also covers the
 * heading-oscillation sub-phase, which the real `73E7` keeps ticking through regardless of what
 * `880A`'s own logic is doing that tick (the prior code's bug was an early `return` skipping its OWN
 * inline bump; this version has no such gap because the bump now happens before any branch).
 *
 * `73E7`'s own increment is gated too, not truly unconditional: `73EE-73F3` skips it entirely for
 * every car except the camera-target car (`ctx.cars[0]`) when `round===9` -- the SAME exclusion
 * `dropin.js`'s `applyScriptedDrift` already carries for its own driftSteps/position half of this
 * same real function. Reproduced here exactly: for a round-9 non-car0 car, `animTimer` stays pinned
 * at whatever it was (0, from entry-zeroing) forever, so such a car that reaches the table-walk phase
 * never crosses `threshold[0]` and never reaches state 7 -- confirmed to be the real game's own
 * behavior, not smoothed over into "every car always progresses."
 *
 * `driftSteps` is read here BEFORE its own decrement: `runStates` runs before `applyScriptedDrift` in
 * `step.js`'s per-step order, so this function sees the PREVIOUS tick's already-decremented value,
 * one tick later than the real game (where `880A`, called from render, sees the SAME tick's `73E7`
 * work). The pause this function applies therefore runs one 35Hz tick longer than the real game's --
 * the same class of off-by-one `stepKnockoutAnim`'s own header comment already documents for a
 * similar ordering reason, not a new kind of imprecision.
 *
 * The table-walk here uses `car.animStep` (`[BX+0x12B6]`, the same cursor field states 4/5 use) as an
 * explicit index rather than `animTableDone`'s implicit threshold-rescan, because the real function
 * also fires two already-catalogued sfx ids (docs/sound.md id 7 `88f6` / id 17 `890f`) gated on the
 * POST-increment `animStep` hitting an exact, class-dependent step count -- TURBO WHEELS(4)/
 * RUFFTRUX(9)/POWERBOATS(2) at step 4 (id 17), every other class at step 8 (id 7) -- which
 * `animTableDone`'s opaque scan has no way to expose. `tools/check-play.mjs` now proves both sides
 * (id 7 plays for a car last drawn on screen, nothing for one last drawn off screen): the drawn flag
 * is sticky since docs/engine.md §9ao, where `runStates` used to zero it before every dispatch so
 * this branch could never fire. The id/step mapping is also corroborated by `docs/sound.md`'s
 * independent disassembly of the same two call sites. `animStep` is written only by this function and nothing zeroes it at state-1
 * entry (faithful -- the real entry handlers don't either, see `terrain.js`), which is self-consistent
 * only as long as no OTHER state shares the cursor; `UNKNOWN_state4_5_driftsteps_gate` (below) invites
 * exactly that kind of change, so this invariant would need re-checking if that item is ever worked.
 * The `-2` control word appearing mid-table (not just at the end, e.g. `STATE1_ANIM_DEFAULT.frames`
 * indices 7/13) is correctly NOT special-cased here: in the real tail `CX==-2` only skips the DRAW
 * call and still falls through to the same compare-and-increment every other non-terminal entry does,
 * so this headless port -- which never draws -- treats it identically to any other non-terminal entry
 * by construction, not by an oversight.
 */
function stepHazardDeath(car, ctx) {
  car.speed = 0
  car.velX = 0
  car.velY = 0
  // 73E7 (73EE-73F3): in round 9 the increment itself is skipped for every car except the
  // camera-target car (`ctx.cars[0]`) -- the SAME exclusion `dropin.js`'s `applyScriptedDrift`
  // already carries for its own driftSteps/position piece of this same real function. This gates
  // only the increment; the rest of this function (oscillation, table-walk, transition) still runs
  // for every car every tick -- a round-9 non-car0 car that reaches the table-walk phase sees
  // animTimer permanently pinned at 0, so it never crosses threshold[0] and never reaches state 7.
  // That is the real game's own behavior, not a port artifact: faithfully reproduced, not smoothed
  // over.
  const isCarZero = ctx.cars ? car === ctx.cars[0] : true
  if (!(ctx.round === 9 && !isCarZero)) car.animTimer = (car.animTimer ?? 0) + 1

  let table
  if (ctx.round === 4 || ctx.round === 9) {
    const bucket = car.heading & 0xf8
    if (bucket === 0) {
      table = STATE1_ANIM_A
    } else if (bucket === 0x80) {
      table = STATE1_ANIM_B
    } else {
      // 882c-8839: SUB4 for bucket<0x40 or bucket in (0x80,0xc0]; ADD4 for bucket>0xc0 or bucket
      // in [0x40,0x80) -- i.e. step toward whichever of {0,0x80} is nearer around the circle,
      // wrapping through 0xff->0 rather than walking the long way when that's shorter.
      const subtract4 = bucket < 0x40 || (bucket > 0x80 && bucket <= 0xc0)
      car.heading = (car.heading + (subtract4 ? -4 : 4)) & 0xff
      markDrawn(car, ctx) // 883B/8842 -> 885E: the body is drawn while it turns
      return
    }
  } else {
    table = ctx.round === 2 ? STATE1_ANIM_ROUND2 : STATE1_ANIM_DEFAULT
  }

  if (car.driftSteps) { markDrawn(car, ctx); return } // 8849-885E: drifting draws the body, not a table frame

  const step = car.animStep ?? 0
  if (table.threshold[step] === 0xffff) {
    car.state = 7
    car.animTimer = 0
    car.animStep = 0
    return
  }
  if (car.animTimer < table.threshold[step]) return

  car.animStep = step + 1
  const stepFourClasses = ctx.round === 2 || ctx.round === 4 || ctx.round === 9
  if (car.animStep === (stepFourClasses ? 4 : 8) && car.drawnThisFrame) {
    ctx.sound?.playSfx(stepFourClasses ? 0x11 : 7)
  }
}

/** The `73E7` round-9/non-car0 animTimer-increment exclusion (docs/engine.md §9w/§9z), shared by
 * every state with its own self-contained inline bump (1, 4, 5). States 2/D's own inline bump
 * (`animTableDone`) does NOT need this gate -- already established equivalent to the real external
 * increment without it, docs/engine.md §9w. */
function bumpAnimTimerRound9Gated(car, ctx) {
  const isCarZero = ctx.cars ? car === ctx.cars[0] : true
  if (!(ctx.round === 9 && !isCarZero)) car.animTimer = (car.animTimer ?? 0) + 1
}

/**
 * State 4, `7F62 HandleCarState4FallAnimSfx8` (docs/engine.md §9z): fall animation; ends by
 * hiding the car (`active=0`) and handing off to the drop-in sequencer (state 0xE).
 *
 * `UNKNOWN_state4_5_driftsteps_gate` resolved 2026-09-22 (docs/engine.md §9z), surfaced during
 * M3.18's own state-1 work: the port's prior implementation called the shared `animTableDone`
 * helper unconditionally, with no `driftSteps` gate -- and, independently, a real timing bug: its
 * sfx-8 condition (`animTimer+1===4`) checked the wrong field. The real function's sfx gate
 * (`7FA4`) tests the POST-increment `animStep`, not `animTimer` -- for `FALL_ANIM`'s own thresholds
 * (`[2,4,6,8,...]`) `animStep` reaches 4 only once `animTimer` has crossed `threshold[3]=8`, not
 * the old code's effective ~tick-3 firing. Rewritten here to match `stepHazardDeath`'s own
 * explicit `animStep`-cursor table-walk shape (verified the real table's own raw bytes,
 * `DS:2879`, pair each threshold word with its own control word positionally, so
 * `threshold[step]===0xffff` at index 8 is exactly where the real control word is `-1`).
 *
 * `driftSteps!=0` pauses table advancement (`7F6D-7F77`, draw-only, no table read) -- the gate this
 * item is named for. `animTimer` itself uses the same round-9/non-car0 exclusion state 1 already
 * has (`bumpAnimTimerRound9Gated`) -- a real, if narrow, pre-existing bug this fix closes as a side
 * effect: a round-9 drone previously in state 4 had its `animTimer` bumped where the real `73E7`
 * would have skipped it.
 *
 * Terminal transition (`7FBD-7FE1`) sets FIVE fields, not the two the prior code set: `animStep=0`
 * and `controlsLocked=1`/`cameraFarFlag=0` were missing entirely (harmless for `controlsLocked`/
 * `cameraFarFlag` only insofar as nothing downstream has yet been observed to depend on them at
 * this exact transition, not because the real bytes omit them).
 *
 * `7F62-7F69`: the `[2682]` latch (`raceState.fallLatch`) -- set to this car if it is empty, on
 * every frame the car is in state 4, before the driftSteps gate. It persists until 6E7E (dropin.js),
 * the knockout reset (7764/77FF) or race init, and makes this car the scorer of the next two-car
 * exchange (twocar.js's fall branch, docs/engine.md §9am). State 4 is only ever entered from round
 * 3's shortcut hole (6B73), so this is round-3-only in practice.
 */
function stepFallAnim(car, ctx, raceState) {
  if (raceState && raceState.fallLatch == null) raceState.fallLatch = (ctx.cars ?? []).indexOf(car)
  bumpAnimTimerRound9Gated(car, ctx)
  if (car.driftSteps) { markDrawn(car, ctx); return } // 7F6D-7F74
  const step = car.animStep ?? 0
  if (FALL_ANIM.threshold[step] === 0xffff) {
    car.active = 0
    car.subState = 1
    car.state = 0xe
    car.animTimer = 0
    car.animStep = 0
    car.controlsLocked = 1
    car.cameraFarFlag = 0
    return
  }
  if (car.animTimer < FALL_ANIM.threshold[step]) return
  car.animStep = step + 1
  if (car.animStep === 4 && car.drawnThisFrame) ctx.sound?.playSfx(8)
}

/**
 * State 5, `7EFA HandleCarState5CrashAnimSfx8` (docs/engine.md §9z): crash animation; ends in
 * state 7 (respawn). Same fix shape as `stepFallAnim` above (`UNKNOWN_state4_5_driftsteps_gate`):
 * `driftSteps`-gated pause (`7EFA-7F04`), explicit `animStep`-cursor table-walk against
 * `CRASH_ANIM` (raw bytes at `DS:2855` verified paired the same way as `FALL_ANIM`'s), and the
 * sfx-8 condition corrected to test post-increment `animStep===4` (real gate `7F30`) rather than
 * `animTimer` -- for `CRASH_ANIM`'s own thresholds (`[4,8,12,...]`) that's `animTimer` crossing
 * `threshold[3]=16`, not the old code's ~tick-3 firing. `animTimer` uses the same round-9/car0
 * exclusion as state 1/4.
 *
 * Terminal transition (`7F49-7F61`) differs from state 4's in one real way, not an oversight:
 * `subState=0` here (state 4 sets `subState=1`, since it hands off to state E's own
 * subState-driven sequencer; state 5 hands off to state 7, which doesn't consume subState the same
 * way). Confirmed `HandleCarState1HazardDeath`'s own terminal (`8916-8922`) does NOT set `subState`
 * at all -- checked directly, not assumed, since this function's own docstring speculated state 1
 * might have the same gap; it doesn't, so nothing there needs revisiting.
 */
function stepCrashAnim(car, ctx) {
  bumpAnimTimerRound9Gated(car, ctx)
  if (car.driftSteps) { markDrawn(car, ctx); return } // 7EFA-7F01
  const step = car.animStep ?? 0
  if (CRASH_ANIM.threshold[step] === 0xffff) {
    car.state = 7
    car.animTimer = 0
    car.animStep = 0
    car.subState = 0
    return
  }
  if (car.animTimer < CRASH_ANIM.threshold[step]) return
  car.animStep = step + 1
  if (car.animStep === 4 && car.drawnThisFrame) ctx.sound?.playSfx(8)
}

// State E, `6AE5-6FE9`: round 3's shortcut/warp sequencer, fully ported -- see `engine/dropin.js`'s
// own module header for the complete account (docs §9r). `stepDropIn` here is only the per-tick
// CONTINUATION (subStates 1-4); the terrain-triggered entry (subState 0) lives in `terrain.js`,
// since the same function address serves as both the terrain dispatch's round-3 row-4 handler and
// this state table's own 0xE entry in the original binary.

/** States B/C (docs/engine.md §4/§9am): the two-car exchange -- 0xB is the scorer during its hop,
 * then both cars sit in 0xC for the 64-step blink. Both use state 0's own draw handler (`7D73`) --
 * no physics; the banners and the scorer's spin are `twocar.js`'s post-HUD dispatch. The car
 * `[2621]` names (the non-scorer once "Winner" shows) is not drawn and reads drawnThisFrame 0 --
 * applied in `step.js` after this pass. */
function stepTwoCarIdle(car, ctx) {
  markDrawn(car, ctx)
}

/** State F (docs/engine.md §4, RUFFTRUX-only): fires once on entry (the real loop idiom re-queues
 * every tick via an `AH=0Ah` keep-alive this port doesn't model -- a one-shot sfx is a
 * simplification, not a re-derivation). Pins speed to 0; no documented exit transition. */
function stepRuffTruxOneUp(car, ctx) {
  car.speed = 0
  if (!car._ruffTruxOneUpFired) { ctx.sound?.playSfx(16); car._ruffTruxOneUpFired = true }
  markDrawn(car, ctx) // 86D3
  advanceBannerSlide(car)
}

/** State 0x10 (docs/engine.md §4, RUFFTRUX-only, car 0 only per the documented transition): the
 * countdown-expired "Failed" banner. Same one-shot simplification as state F; also the documented
 * `StopEngineSounds` (pitch 0) for car 0, the only car this state's own transition ever targets. */
function stepRuffTruxFailed(car, ctx) {
  car.speed = 0
  if (!car._ruffTruxFailedFired) {
    ctx.sound?.playSfx(15)
    ctx.sound?.engine(0, { bend: 0 })
    car._ruffTruxFailedFired = true
  }
  markDrawn(car, ctx) // 86D3
  advanceBannerSlide(car)
}

/** The "1 Up!"/"Failed" banner's shared slide-in (`1000:86D2`, `mm-re-player-visible` 2026-09-23,
 * docs/engine.md §9ai): `car._bannerSlideY` is the real `[26C0]` register -- the sprite's own
 * CENTRE-Y, read by `render/raceView.js`'s `drawRuffTruxBanner`. Starts at 0, climbs +8/tick while
 * `<=124` (matching `86FD`'s pre-increment `CMP AX,0x7C;JA skip`), then stops -- the real code has
 * NO clamp here (unlike the two-car-only Winner banner's hard `MOV 0x7C`), so it deliberately
 * overshoots to settle at 128, not 124. */
function advanceBannerSlide(car) {
  const y = car._bannerSlideY ?? 0
  if (y <= 124) car._bannerSlideY = y + 8
}

/**
 * Runs every active car's state-specific step, plus the shared state-A race-start-hold counter.
 * `raceState`: a small object the caller keeps across steps (just `{dropInTimer}` here).
 * `ctx.round`, `ctx.stepIncrement` ([263A], defaults 1), `ctx.world` (for state 7's respawn).
 */
export function runStates(cars, raceState, ctx) {
  let anyStateA = false
  // docs/sound.md §3b id9 "84de": the state-0xA drop-in handler, restricted to the camera-target
  // car ([0x2660], car 0 in this port's one-player scope). Fired once, the first tick any car is
  // in state 0xA -- our port never transitions a car BACK into state 0xA after spawn, so "first
  // tick ever" and "first tick this drop-in" are the same event here (M3.7).
  const firstDropInTick = raceState.dropInTimer === undefined
  // The `[26CF]` blink (state A's own draw gate, above): free-running, so it ticks every physics
  // step regardless of whether any car is actually in state A this tick.
  raceState.blinkOn ??= true
  raceState.blinkTick = (raceState.blinkTick ?? 0) + 1
  if (raceState.blinkTick >= 16) { raceState.blinkTick = 0; raceState.blinkOn = !raceState.blinkOn }
  // stepPartnerWait (dropin.js) needs the full car list to find a two-car partner; stepRespawn
  // needs it to tell whether the respawning car is the camera-target car (docs/engine.md §9v).
  const ctxWithCars = { ...ctx, cars }
  for (const car of cars) {
    // DrawRaceCarLayer's own dispatch gate (docs/engine.md §4): "only if state==0xE or active!=0"
    // -- state 4's own ending sets active=0 specifically so its car becomes invisible while state
    // E's drop-in sequencer still runs; a plain `if (!car.active) continue` here would skip that
    // car forever once it hit state E (caught by check-play.mjs's new state-handler tests, M3.6).
    if (!car.active && car.state !== 0xe) continue
    // drawnThisFrame is NOT cleared here: its only writers are inside 7D73, which each handler
    // below calls under its own conditions (`drawn.js`, docs/engine.md §9ao); a car whose handler
    // does not draw keeps its last value. (It used to be cleared every pass and set only for
    // state 0, which made it mean "state 0" -- and off-screen cars never looked off-screen.)
    switch (car.state) {
      case 0: stepDriving(car, ctxWithCars); break
      case 1: stepHazardDeath(car, ctxWithCars); break
      case 0xa: {
        // 849B/84CA (full decode, 2026-09-23): a drone (any state-A car when not car 0 and not
        // two-car format) draws every tick -- its own gate reads car 0's OWN [12AE] field (a
        // literal address, no base register), which stays 10 until the whole drop-in ends, by
        // which point this port has already moved every state-A car out (below); that branch is
        // therefore unreachable here, same as this section already read from the disassembly.
        // Car 0, and BOTH cars in two-car format, draw only on the `[26CF]` blink's on-phase: a
        // free-running ~50% duty cycle (`48D0-48FB`) toggling every 16 physics ticks (32 ISR ticks
        // at the game's fixed 2-ISR-ticks-per-physics-tick ratio, independent of smoothness). The
        // port has no ISR loop to hang this off, so `raceState.blinkOn` models it as a tick counter
        // (below); its PHASE at race start is unverified -- `[26CF]` free-runs from boot, not from
        // race init, so its alignment when a race begins is effectively arbitrary; only the period
        // and the on/off gating are established. The `[26D5]>=0x60` "draw unconditionally, ignoring
        // the blink" branch is not modelled separately: by the time this port's own `dropInTimer`
        // (below) reaches 0x60, every state-A car has already been moved to state 0 in that same
        // tick's post-loop transition, so no car can still reach this case with an already-expired
        // timer -- a one-tick edge the real per-car dispatch handles synchronously and this port's
        // batched transition does not, the same class of off-by-one `stepKnockoutAnim`'s own header
        // already documents.
        anyStateA = true
        const isCarZero = car === cars[0]
        if (!(isCarZero || ctx.raceFormat === 2) || raceState.blinkOn) markDrawn(car, ctxWithCars)
        break
      }
      case 2: stepKnockoutAnim(car, 0, raceState, ctxWithCars); break
      case 4: stepFallAnim(car, ctxWithCars, raceState); break
      case 5: stepCrashAnim(car, ctxWithCars); break
      case 7: stepRespawn(car, ctxWithCars, raceState); break
      case 0xd: stepKnockoutAnim(car, 7, raceState, ctxWithCars); break
      case 0xe: stepDropIn(car, ctxWithCars, raceState); break
      case 0xb: case 0xc: stepTwoCarIdle(car, ctxWithCars); break
      // Both banner states run 86d2, whose slide-in sets [26C6]=2 (8702): the bonus race then ends
      // through the ordinary four-car 100-step countdown (docs/engine.md §9ah).
      case 0xf: stepRuffTruxOneUp(car, ctxWithCars); raceState.raceOverCount = 2; break
      case 0x10: stepRuffTruxFailed(car, ctxWithCars); raceState.raceOverCount = 2; break
      default: break
    }
  }
  if (anyStateA) {
    if (firstDropInTick && cars[0]?.state === 0xa) ctx.sound?.playSfx(9)
    raceState.dropInTimer = (raceState.dropInTimer ?? 0) + (ctx.stepIncrement ?? 1)
    if (raceState.dropInTimer >= 0x60) {
      for (const car of cars) if (car.state === 0xa) car.state = 0
    }
  }

  // RUFFTRUX (round 9) timer + banner transitions (docs/engine.md §4 transitions list): "0 -> F at
  // 4b13: round 9, [12ED]==2, speed 0" and "car 0 -> 10: round 9 countdown [26C8] hit 0". The
  // countdown itself (`RuffTruckTimes[race-1]`, already embedded, M3.1) isn't otherwise tracked
  // anywhere in this port; kept on `raceState` rather than a global, ticking only for round 9.
  //
  // Corrected 2026-09-21 (docs/engine.md §9p, found while building the HUD's countdown display):
  // `UpdateCarAirborneLandingSfx 1000:7429`'s `[26C8]--` sits at the very top of the function, with
  // no per-car gate at all (its only guards are `[28BF]=='\t'` (round 9) and the `[26CA]` "already
  // expired" latch) -- and that function's own sole caller (`RunRaceMainLoop 1000:309c`) runs it
  // once for EVERY one of the 4 fixed car slots every physics step, unconditionally (confirmed live
  // via `get_function_xrefs`/`disassemble_bytes` on the caller: `MOV BX,0 / loop: CALL 7429 / ... /
  // ADD BX,0x164 / CMP BX,0x42C / JLE loop`, no active check). So `[26C8]` decrements by up to 4 per
  // physics step, not 1 -- this port's original one-per-step decrement ran the countdown 4x too
  // slow. Fixed to decrement up to 4 times per step, stopping the instant it reaches 0 within that
  // same step (matching `[26CA]`'s latch: once zero, no further decrement this step or any later
  // one) rather than plain `-= 4`, since a `RuffTruckTimes` value not a multiple of 4 would
  // otherwise go negative instead of landing exactly on 0. The 4 comes from the real game's own
  // per-car-slot dispatch, not from `ctx.stepIncrement` ([263A], a separate concept -- how much a
  // step itself advances); how the two would compose was not traced, so this is a plain 4, not
  // `4 * stepIncrement` (stepIncrement is hardcoded 1 everywhere this port calls it today).
  //
  // Corrected again 2026-09-23 (docs/engine.md §9ah): the [26CA] latch is real and is ALSO set when
  // the car finishes (4b03, `step.js`'s round-9 control branch -- which now owns the state F
  // transition, 4b13), so finishing stops the clock; expiry (7437 DEC -> 0) latches it too (744d)
  // and sets car 0 to state 0x10 ONCE. The old code had no latch: the countdown kept running after
  // a finish and forced car 0 to "Failed" every step once it hit 0 -- a finished bonus race could
  // be lost.
  if (ctx.round === 9) {
    if (raceState.ruffTruxTimer === undefined) raceState.ruffTruxTimer = ctx.ruffTruxTime ?? 0
    for (let i = 0; i < 4 && !raceState.ruffTruxLatched; i++) {
      raceState.ruffTruxTimer -= 1
      if (raceState.ruffTruxTimer <= 0) {
        raceState.ruffTruxLatched = 1
        if (cars[0]) cars[0].state = 0x10
      }
    }
  }
}
