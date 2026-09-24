// UpdateCarCheckpointsAndSurfaceSfx (1000:5e4e, checkpoint/lap part 5f25-60bf), the corrected rule
// (docs/engine.md §3 -- this is the finding that refuted "decrement laps on any backward wrap",
// which would let players skip checkpoints), re-read against the bytes 2026-09-23 (docs/engine.md
// §9ah): the body only runs for a car in state 0 (5e8f) whose progress was actually written this
// tick ([12E5], 5f1b -- `collide.js`'s `writeProgress` never writes a plane-2 value of 0), outside
// round 3's bridge-level skip (5efe-5f18); a forward wrap is tested against the FIRST checkpoint
// entry's `hi` and otherwise takes the penalty path (5ff4-6006); the lap sfx is drawn-gated (6014);
// and the round-2/race-1 lead rule (6024-6054) can end the qualifier early.
//
// `checkpointOff`/`checkpointOffSaved` ([12E7]/[12E9]) are BYTE offsets into the real list (each
// {lo,hi} entry is one word, the cursor advances by 2 -- 5f7d/5fc5, 7153-7160), matching the car
// record's real memory contents and `dropin.js`'s `minCursor` thresholds (6b6a/6c64 compare the
// same field in bytes). This port used entry indices until 2026-09-23, which made every drop-in
// threshold twice as strict as the real one (docs/engine.md §9ah).
//
// The judge reads `checkpointEntryRaw` (src/data/engine-tables.js): the raw shared blob at this
// race's base + the cursor, exactly like the game, so a two-car cursor the penalty path pushed past
// the 0xFFFF terminator walks on into the next race's list (docs/engine.md §9an). The respawn's
// cursor re-derivation (below) only ever scans the car's own list. [2654] (half max progress) is
// per-race data, `runStep` derives it from `world.map.maxPlane2` (docs/engine.md §9s); the `?? 128`
// fallback only matters for a caller that invokes this function directly, bypassing `runStep`.

import { checkpointList, checkpointEntryRaw, checkpointTerminatorFrom, ROUND3_TILE_FLAGS } from '../data/engine-tables.js'

/** Penalty 5f85-5fcd: one-player -> safe point reverts, knockout at the current position, state
 * 0xD, sfx 1 if drawn; two-car -> the cursor just skips forward one entry (+2 bytes). */
function applyPenalty(car, ctx) {
  if (ctx.raceFormat === 2) {
    car.checkpointOff += 2
  } else {
    car.safeX = car.safeXPrev; car.safeY = car.safeYPrev
    car.knockoutX = car.posX; car.knockoutY = car.posY
    car.state = 0xd
    if (car.drawnThisFrame) ctx.sound?.playSfx(1) // docs/sound.md §3b id1 "5fbd" (M3.7)
  }
}

/**
 * RespawnCarAtSafePoint's cursor recompute (7135-7160): the byte offset of the first list entry
 * whose `lo` is greater than `progress` (unsigned byte compare, `CMP DL,AL / JC`), i.e. 2 x the
 * number of leading entries with `lo <= progress`; the terminator's `lo` (0xFF) stops the scan.
 */
export function cursorForProgress(round, race, progress) {
  const list = checkpointList(round, race)
  const p = progress & 0xff
  const i = list.findIndex((e) => p < e.lo)
  return 2 * (i < 0 ? list.length : i)
}

/**
 * `ctx.round`, `ctx.race`, `ctx.raceFormat` ([2656], 1 = four-car, 2 = two-car),
 * `ctx.halfMaxProgress` ([2654]). `extra` (all optional): `{cars, carIndex, raceState}` for the
 * lead rule (`raceState.raceOverCount` is [26C6]), and `entryState` -- the car's state BEFORE this
 * tick's terrain dispatch, which is what 5e8f actually tests (defaults to `car.state`).
 * Reads/writes car.progress/progressPrev/progressChanged (as `collide.js`'s
 * `updateCarTileCollision` left them this step), checkpointOff, checkpointOffSaved, lapsRemaining,
 * safeX/Y, knockoutX/Y, state.
 */
export function updateCheckpointsAndLaps(car, ctx, { cars, carIndex, raceState, entryState = car.state } = {}) {
  if (entryState !== 0) return // 5e8f (tested before the terrain dispatch, not re-tested after it)
  if (ctx.round === 3 && car.onBridge !== 1 && ROUND3_TILE_FLAGS[car.metaTile] === 1) return // 5efe-5f18
  if (!car.progressChanged) return // 5f1b: no progress written this tick -> nothing to judge

  // Every lookup reads the raw blob at this race's base + the byte cursor (checkpointEntryRaw), so a
  // two-car cursor pushed past the terminator walks into the next race's list, as the game's does.
  const entryAtCursor = () => checkpointEntryRaw(ctx.round, ctx.race, car.checkpointOff)
  const half = ctx.halfMaxProgress ?? 128
  const d = car.progress - car.progressPrev

  if (d > half) {
    // 6078-60ba: backward across the line -- remember the cursor, park it on the first terminator at
    // or after it, +1 lap owed (cap 9).
    car.checkpointOffSaved = car.checkpointOff
    car.checkpointOff = checkpointTerminatorFrom(ctx.round, ctx.race, car.checkpointOff)
    car.lapsRemaining = Math.min(9, car.lapsRemaining + 1)
    return
  }

  if (d >= -half) {
    // 5f41-5f82: ordinary movement, judged against the entry at the cursor using the PREVIOUS
    // progress: before the window -> nothing, inside it -> cursor advances, past it -> penalty.
    const entry = entryAtCursor()
    if (!entry || car.progressPrev < entry.lo) return
    if (car.progressPrev < entry.hi) car.checkpointOff += 2
    else applyPenalty(car, ctx)
    return
  }

  // 5fd0-6076: forward across the start/finish line. Only a lap if every checkpoint was passed (the
  // cursor sits on the terminator) AND the car landed before the end of the FIRST window
  // (list[0].hi; an empty list -- rounds 2/8 -- has the terminator as entry 0, hi 0xFF); anything
  // else is the penalty path (5ff2/6006 JMP 5f85).
  if (entryAtCursor()) { applyPenalty(car, ctx); return }
  // 5FF4-5FFB: back to entry 0 of the car's OWN list (a terminator there -- rounds 2/8 -- gives 0xFF).
  const firstHi = checkpointEntryRaw(ctx.round, ctx.race, 0)?.hi ?? 0xff
  if (car.progress >= firstHi) { applyPenalty(car, ctx); return }

  car.lapsRemaining -= 1
  if (ctx.raceFormat === 1) {
    if (car.drawnThisFrame) ctx.sound?.playSfx(2) // docs/sound.md §3b id2 "601f", 6014 drawn gate
    // 6024-6054, the ROUND21 qualifier's lead rule: car record 0 completing a lap (to <=2 left)
    // while every other car still has STRICTLY more laps remaining ends the race ([26C6]=2).
    // `ctx.round` stands in for the vehicle class [28BF] as everywhere else in this port.
    if (ctx.round === 2 && ctx.race === 1 && carIndex === 0 && car.lapsRemaining <= 2 && cars && raceState &&
        cars.slice(1).every((c) => c.lapsRemaining > car.lapsRemaining)) {
      raceState.raceOverCount = 2
    }
  }
  if (car.lapsRemaining < 0) car.lapsRemaining = 0 // 605a-6062
  car.checkpointOff = car.checkpointOffSaved
  car.checkpointOffSaved = 0
}
