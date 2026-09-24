// The world point-query (TestColMaskBitAtWorldXY 1000:589c), the .COL wall-collision response
// (UpdateCarTileCollisionSfx6or4 1000:5532, gated active!=0 && state==0 at 5534/553e), the
// bounce+commit tail of the per-car integrate routine (FUN_1000_5be7, 5c70-5e36, commit itself
// 5da1-5e36, state 0/2/0xE only), and the 6-pair car-car collision (5921/5960).
// docs/engine.md §3/§9ae. `buildWorld()` loads one round/race's .MAP/.COL/.DIR/.LEV whole and
// verbatim (CLAUDE.md "Working rules"), matching `PLAN.md`'s "load once, query directly" approach.

import { integrateAxis, wrapWorld, wrapDelta, mul2Floor256, sar16 } from './int16.js'
import { colTile, dirTile, parseMap, MAP_SIDE, TILE_UNITS, CELL_UNITS } from '../formats/track.js'
import { parseLev } from '../formats/levbrk.js'
import { contactAngle, ROUND3_TILE_FLAGS } from '../data/engine-tables.js'
import { SINE8 } from '../data/engine-tables.js'
import { toU8 } from '../formats/bytes.js'

const EMPTY_LEV = { raw: 0, unsafeRespawn: false, heading: 0x40, nudge: { dx: 0, dy: 0 }, lowBits: 0 }

// `UNKNOWN_tile_index_overflow` (docs/engine.md §9ac/§9ad): the real `colFileBuf`/`dirFileBuf`
// (`1000:3163`/`35e3`, LoadRoundColAndDir `1000:458b`) are fixed-size and NEVER cleared between
// loads -- sized for the largest round's own file (round 3/4's 64-tile `.COL` = 0x480 B; round
// 3/4's 64-tile `.DIR` = 0x900 B), so any SMALLER round's own file leaves its buffer's tail
// holding whichever earlier race's own load last wrote there. `createColDirBuffers()` gives a
// caller a persistent pair to opt into replicating this exactly across a real, continuous
// sequence of race loads (see `bootGame`'s own use in `src/frontend/flow.js`); omitted (the
// default), `buildWorld` behaves exactly as before -- a fresh, independent world per call, with
// any out-of-file-range tile byte reading a defined 0 rather than another race's leftover data.
export const COL_FILE_BUF_SIZE = 0x480
export const DIR_FILE_BUF_SIZE = 0x900

/** A persistent pair of buffers to thread through `loadWorld`/`buildWorld` across a real session's
 * own sequence of race loads -- see the module comment above. Create ONCE per session (e.g. once
 * per `bootGame` call), not once per race. */
export function createColDirBuffers() {
  return { col: new Uint8Array(COL_FILE_BUF_SIZE), dir: new Uint8Array(DIR_FILE_BUF_SIZE) }
}

/**
 * Build the per-round/race "world" collide.js and terrain.js read from.
 *
 * `UNKNOWN_tile_index_overflow` resolved (docs/engine.md, docs/track-layout.md): three real cases
 * across all 29 races reference a meta-tile past their own `.COL`/`.DIR` table -- `ROUND82.MAP`
 * (tile 58, .COL only, twice), `ROUND92.MAP` (tile 60, .COL+.DIR, once), and `ROUND5.DIR` itself
 * ending 18 bytes into meta-tile 56's own 36-byte record (races 1 and 3, .DIR only). A full
 * sub-cell-level flood fill from each race's own start position (4-directional AND 8-directional,
 * matched) found the round-8/round-9 cells structurally UNREACHABLE -- not even their boundary is
 * touched by the connected open region a car can actually drive in, confirming the same
 * "toggle exists, unreachable state" pattern already found elsewhere in this project. Round 5's
 * case is different and real: tile 56 is fully open, sits on the actual racing line (genuine
 * nonzero progress values), and is reached in both affected races. `colTile`/`dirTile`
 * (`src/formats/track.js`) now return a full-size array for ANY tile index, zero-filling only the
 * bytes a file genuinely doesn't have -- round 5's own real bytes for tile 56 (offsets 0-17 of the
 * 36, i.e. sub-rows 0-5) are now used instead of being discarded by a whole-tile gate; only the
 * genuinely-missing tail (sub-rows 6-11) reads as 0, UNLESS a `sharedBuffers` (below) is given,
 * in which case that tail reads whatever an earlier call in the same sequence last left there --
 * see `docs/engine.md` §9ad for the full account and why this is opt-in, not the default.
 * @param {{col: Uint8Array, dir: Uint8Array}} [sharedBuffers] from `createColDirBuffers()` --
 *   when given, `colBytes`/`dirBytes` are copied into the FRONT of these persistent buffers (which
 *   are then queried instead), leaving each buffer's own tail as whatever a PRIOR call in this
 *   same sequence last wrote -- exactly replicating the real, non-cleared, fixed-size buffers a
 *   continuous game session shares across every race it loads.
 */
export function buildWorld(mapBytes, colBytes, dirBytes, levBytes, sharedBuffers) {
  const map = parseMap(mapBytes)
  const lev = parseLev(levBytes)
  let colSrc = colBytes
  let dirSrc = dirBytes
  if (sharedBuffers) {
    sharedBuffers.col.set(toU8(colBytes).subarray(0, COL_FILE_BUF_SIZE))
    sharedBuffers.dir.set(toU8(dirBytes).subarray(0, DIR_FILE_BUF_SIZE))
    colSrc = sharedBuffers.col
    dirSrc = sharedBuffers.dir
  }
  const colCache = new Map()
  const dirCache = new Map()
  const colOf = (t) => {
    if (!colCache.has(t)) colCache.set(t, colTile(colSrc, t))
    return colCache.get(t)
  }
  const dirOf = (t) => {
    if (!dirCache.has(t)) dirCache.set(t, dirTile(dirSrc, t))
    return dirCache.get(t)
  }
  const levOf = (t) => lev.entries[t] ?? EMPTY_LEV
  return { map, colOf, dirOf, levOf }
}

/** TestColMaskBitAtWorldXY 1000:589c. */
export function queryWorldAt(world, x, y) {
  x = wrapWorld(x)
  y = wrapWorld(y)
  const col = Math.floor(x / TILE_UNITS) % MAP_SIDE
  const row = Math.floor(y / TILE_UNITS) % MAP_SIDE
  const cellIndex = row * MAP_SIDE + col
  const metaTile = world.map.tiles[cellIndex]
  const mapAttr = world.map.attrs[cellIndex]
  const progress = world.map.plane2[cellIndex]
  const subx = Math.floor((x % TILE_UNITS) / CELL_UNITS)
  const suby = Math.floor((y % TILE_UNITS) / CELL_UNITS)
  const solid = world.colOf(metaTile)[suby * 12 + subx] === 1
  // docs/track-layout.md ".DIR 36 B per tile ... [tile*36 + (subx>>1) + 3*(suby&~1)]" -- indexed
  // here relative to the tile's own 36-byte slice, so no `tile*36` term.
  const dirByte = world.dirOf(metaTile)[(subx >> 1) + 3 * (suby & ~1)]
  const lev = world.levOf(metaTile)
  return { metaTile, mapAttr, progress, subx, suby, solid, dirByte, lev }
}

/** TANKS grade 1-7 and TURBO WHEELS/FOUR BY FOUR grade >= 5 don't collide with rough terrain. */
export function classImmune(round, grade) {
  if (round === 7) return grade >= 1 && grade <= 7
  if (round === 4 || round === 5) return grade >= 5
  return false
}

/**
 * UpdateCarTileCollisionSfx6or4 1000:5532, called on the car's tentative next position. Mutates
 * car.metaTile/mapAttr/dirByte/dirBytePrev/progressChanged (always) and progress/progressPrev
 * (only on a nonzero plane-2 cell, see `writeProgress`), hitLeft.../wallHitPending/offTrackTicks/
 * state/knockoutX/knockoutY. Returns the query result mainly for direct callers/tests (`check-step.mjs`'s
 * own `hit.blocked` assertions) -- `step.js`'s own per-car loop discards it (see `bounceAndCommit`'s
 * own docstring for why it no longer needs it).
 *
 * `UNKNOWN_col_response_active_state_gate` resolved (docs/engine.md §9ae): the real function gates
 * its ENTIRE body on `active!=0 && state==0` (1000:5534/553e), jumping straight to its own epilogue
 * (5858) and leaving every field it would touch -- metaTile/mapAttr/progress/dirByte/wallHitPending/
 * hitLeft.../offTrackTicks -- untouched otherwise. A first attempt at this gate (M3.23) broke round
 * 3's drop-in sequencer test because `bounceAndCommit`'s own commit runs for state 0/2/0xE while
 * this function's gate is state==0 only, so a gated-off state-0xE car fed `bounceAndCommit` a stale/
 * undefined `hit`. Fixed the other way round instead: `bounceAndCommit` (below) no longer reads the
 * returned `hit` at all, only the PERSISTENT `car.progress`/`car.metaTile` fields (freshly re-derived
 * via `world.levOf` at commit time, exactly matching the real 5dd9-5de6 commit-tail LEV read,
 * confirmed live), so it no longer matters whether this function ran this tick. The returned `hit`
 * when gated off carries the car's own last-known metaTile/progress/dirByte (for any other caller
 * inspecting it) with `blocked: false`.
 *
 * Also newly gated by the same fix, real and confirmed live (5548-5576): the real function ALSO
 * computes `nextX`/`nextY` itself (the same integration `int16.js`'s `integrateAxis` implements)
 * under this identical `active!=0 && state==0` gate -- but this is NOT the car's only integration:
 * the commit tail (5d35-5d67, unconditional, no gate at all) re-derives `nextX`/`nextY` a SECOND
 * time, from whatever velocity the intervening bounce block left it at, wraps it (5d6b-5d9f, the
 * same `wrapWorld` `integrateAxis` already applies), and THAT is what 5da1's state-gated commit
 * actually writes to `posX`/`posY` -- so velocity-driven movement does NOT stop when a car leaves
 * state 0; this gated computation is only ever a PRE-bounce value the unconditional second one goes
 * on to overwrite. The real, narrower divergence: this port's `integrateCar` (below) integrates
 * ONCE, pre-bounce, and `bounceAndCommit` commits that same value -- on a tick a bounce doesn't fire,
 * this matches the real second (unconditional) integration exactly (same velocity either way); on a
 * tick a bounce DOES fire, the real game re-integrates from the POST-bounce velocity before
 * committing and this port doesn't, committing the stale pre-bounce position instead. Logged as
 * `UNKNOWN_commit_reintegrates_post_bounce` (docs/engine.md §9ae) rather than folded into this fix:
 * narrow (only a bounce-tick divergence), but reconciling it changes wall-bounce behaviour on every
 * such tick game-wide, a separately-verifiable change.
 */
export function updateCarTileCollision(car, world, ctx) {
  if (!car.active || car.state !== 0) {
    return {
      metaTile: car.metaTile, mapAttr: car.mapAttr, progress: car.progress,
      dirByte: car.dirByte, solid: false, blocked: false,
    }
  }

  const hit = queryWorldAt(world, car.nextX, car.nextY)

  car.metaTile = hit.metaTile
  car.mapAttr = hit.mapAttr
  car.dirBytePrev = car.dirByte
  car.dirByte = hit.dirByte
  car.progressChanged = 0 // 55d5/5757: cleared on every gated query, before any write

  const grade = hit.dirByte >> 4
  const solidHit = hit.solid && !classImmune(ctx.round, grade)
  if (!solidHit) {
    // 1000:57fb, reached from the "not solid" and "class-immune" branches of the real
    // UpdateCarTileCollisionSfx6or4 -- resets wallHitPending every tick it isn't (re-)set. The
    // port previously only ever set this field (never cleared it), and bounceAndCommit read a
    // freshly-computed local instead of this persistent one, silently masking the missing reset.
    // Now correctly reached only when active/state==0 (the outer gate above), matching the real
    // bytes exactly.
    car.wallHitPending = 0
  }
  // The progress write comes BEFORE the dwell/hit-box logic on the solid path (563c vs 5659) and
  // after the wallHitPending reset on the open path (5807 vs 57fb); a freshly written 0xFF exits
  // through 5842 straight away, skipping everything below (docs/engine.md §9ah).
  if (writeProgress(car, hit, ctx)) {
    knockOut(car)
    return hit
  }

  if (solidHit) {
    // UNKNOWN_col_response_offtrack_branch resolved (docs/engine.md §9v, live disassembly of
    // 1000:5659-56a3): the dwell branch is NOT "increment, maybe knock out, then always continue
    // into hit-box detection" -- once offTrackTicks exceeds 0x32 the real function resets the
    // counter to 0, sets state 0xD, and RETURNS EARLY (5671: JMP 5842, the function's own
    // epilogue), skipping wall-hit-box detection (hitLeft/Right/Up/Down, wallHitPending,
    // hit.blocked) entirely for that tick -- so a car knocked out this way does NOT also get
    // bounceAndCommit's velocity-halving wall-bounce applied on the same tick, which the port's
    // previous unconditional fall-through incorrectly did. The dwell==0 "rough" branch also resets
    // offTrackTicks to 0 every call in the real bytes (the port never did, so ticks accumulated
    // across intermittent dwell/no-dwell ticks instead of restarting each time dwell dropped), and
    // plays a real, already-catalogued sfx (docs/sound.md id 6 default, id 4 for POWERBOATS/round
    // 2 -- 1000:568c/569e, both drawn-gated) rather than being sound-only-and-out-of-scope.
    if (car.offTrackDwell) {
      car.offTrackTicks = (car.offTrackTicks + 1) & 0xff
      if (car.offTrackTicks > 0x32) {
        car.offTrackTicks = 0
        knockOut(car) // 5671 JMP 5842: also records knockoutX/Y, not just the state
        return hit
      }
    } else {
      car.offTrackTicks = 0
      if (car.drawnThisFrame) ctx.sound?.playSfx(ctx.round === 2 ? 4 : 6)
    }
    const l = queryWorldAt(world, car.posX - CELL_UNITS, car.posY).solid
    const r = queryWorldAt(world, car.posX + CELL_UNITS, car.posY).solid
    const u = queryWorldAt(world, car.posX, car.posY - CELL_UNITS).solid
    const d = queryWorldAt(world, car.posX, car.posY + CELL_UNITS).solid
    if (!l && !r && !u && !d) {
      car.hitLeft = 1; car.hitUp = 1; car.hitRight = 0; car.hitDown = 0
    } else {
      car.hitLeft = l ? 1 : 0; car.hitRight = r ? 1 : 0; car.hitUp = u ? 1 : 0; car.hitDown = d ? 1 : 0
    }
    car.wallHitPending = 1
    hit.blocked = true
  }
  return hit
}

/**
 * The three guarded progress writes of UpdateCarTileCollisionSfx6or4 (563c-5648, 57b2-57be,
 * 5826-5832), each behind `CMP CX,0 / JZ` (561d/579a/5807) where CX is the plane-2 byte `589c`
 * returns in ES. `[PROVEN]` live (docs/engine.md §9ah): on a plane-2 == 0 cell -- everything off a
 * track's numbered centre line, 991 of ROUND21's 1024 cells -- the real game leaves BOTH
 * `progress` and `progressPrev` untouched and `progressChanged` ([12E5]) at the 0 the caller just
 * wrote, so `updateCheckpointsAndLaps` skips the tick entirely (5f1b). Writing the 0 through (as
 * this port did until 2026-09-23) turned every excursion off the centre line into a fake line
 * crossing: a lap counted, a lap owed, or a checkpoint penalty.
 *
 * Round 3 adds a skip (5622-563a/579f-57b0/580c-5824): a car NOT on a bridge ignores progress on a
 * tile `ROUND3_TILE_FLAGS` ([25CC]) marks as bridge-level, keyed by the NEW meta-tile (written at
 * 55c9 before the test). Not ported: the round-3-only bridge path 5740-57f7 (its own 57b2 write and
 * the 683c ramp-launch path that stores CX=12 instead of the plane-2 byte, docs/engine.md §9ah).
 * @returns {boolean} true when the value just written is 0xFF (the 564e/57c4/5838 knockout test)
 */
function writeProgress(car, hit, ctx) {
  if (hit.progress === 0) return false
  if (ctx.round === 3 && car.onBridge !== 1 && ROUND3_TILE_FLAGS[hit.metaTile] === 1) return false
  car.progressPrev = car.progress
  car.progress = hit.progress
  car.progressChanged = 1
  return car.progress === 0xff
}

/** 1000:5842-5852: knockout position = the car's current committed position, state 0xD. */
function knockOut(car) {
  car.knockoutX = car.posX
  car.knockoutY = car.posY
  car.state = 0xd
}

/**
 * "Not a safe respawn tile" test (docs/engine.md §3): LEV bit 7 set blocks it everywhere. Round 3
 * additionally gates on `ROUND3_TILE_FLAGS[metaTile]` XNORed against `onBridge` ([1388], set by
 * terrain.js's `h6ac2` from `.DIR` bit 4) -- confirmed by reading the live disassembly at
 * 1000:5dee-5e14 (an adversarial review pass flagged the polarity as an unverified guess, which
 * prompted checking it directly rather than leaving it a guess): off a bridge, the roll is
 * allowed only when the flag is 0 (`CMP AL,1 / JZ` skips the roll when the flag is 1); on a bridge
 * (`[1388]==1`), allowed only when the flag is nonzero (`CMP AL,0 / JZ` skips it when the flag is
 * 0). So the flag must match the car's current bridge state to count as safe. `[STATIC]`, not
 * `[PROVEN]` -- read from the disassembly, not a live execution trace.
 */
function canRollSafePoint(car, ctx, lev) {
  if (!lev || lev.raw & 0x80) return false
  if (ctx.round === 3) {
    const tileIsBridgeFlag = ROUND3_TILE_FLAGS[car.metaTile] !== 0
    return tileIsBridgeFlag === (car.onBridge === 1)
  }
  return true
}

/**
 * The 5c70-5d1d bounce (gated on `wallBounceEnable` THEN `wallHitPending` -- `[BX+0x12fb]`/
 * `[BX+0x12a8]`, both checked live) and the 5da1-5e36 commit (state 0/2/0xE only, else skip straight
 * to the epilogue at 5e36). The bounce gate reads the PERSISTENT `car.wallHitPending` field, not a
 * value scoped to this call, matching the real bytes (a car whose collision function was skipped
 * entirely this tick -- inactive, or state != 0 -- carries over whatever `wallHitPending` was left
 * at).
 *
 * `bounceAndCommit` no longer takes `updateCarTileCollision`'s return value (docs/engine.md §9ae):
 * live disassembly of the real commit tail (5da1-5e36) shows the LEV read uses the car's OWN
 * PERSISTENT fields, not a per-call result (the 0xFF-knockout check this sentence used to cite here
 * is not in the commit tail at all -- corrected docs/engine.md §9ah) -- `[BX+0x12ae]==0xE/2/0`
 * gates the whole block exactly as `car.state` does here, and the LEV byte comes from `SI =
 * car.metaTile(&0x3f) + roundLevTableBase; AL = LEV[SI]` (5dd9-5de6), i.e. a FRESH lookup keyed by
 * the car's own current `metaTile`, run again every committed step regardless of whether
 * `updateCarTileCollision` itself ran this tick. Reading the old per-call `hit.progress`/`hit.lev`
 * instead was only ever safe because `updateCarTileCollision` used to run unconditionally every tick
 * for every car; now that it's correctly gated (active/state==0, see its own docstring), that value
 * can be a stale/placeholder value for a gated-off car, so this function reads `car.progress` and
 * re-derives LEV via `world.levOf(car.metaTile)` instead -- exactly what the real bytes do either
 * way.
 *
 * `UNKNOWN_commit_reintegrates_post_bounce` resolved and FIXED (docs/engine.md §9ae/§9af): a fresh
 * disassembly of 5c70-5d9f (re-derived from the bytes, not trusted from the citation above) confirms
 * BOTH outer gate checks (5c75/5c7f, `wallBounceEnable`/`wallHitPending`) `JMP` straight to 5da1 (the
 * commit) when either fails -- skipping 5c84-5d9f entirely, which is the hit-flag clear (5d1d-5d32)
 * AND the re-integration (5d35-5d9f) alike, not just the bounce-velocity mutation. So both are scoped
 * to this SAME `if`, not unconditional-per-tick: on a tick the gate isn't entered, `nextX`/`nextY`
 * keep whatever the caller's own pre-bounce `integrateCar(car)` (in `step.js`) already computed --
 * matching the real bytes exactly, since that's the only integration that ran there either way. On a
 * tick the gate IS entered, the real bytes re-derive `nextX`/`nextY` a SECOND time (5d35-5d67, byte-
 * confirmed identical to `integrateAxis`) from the car's still-uncommitted `posX`/`posXfrac` and the
 * velocity this block just mutated above, then re-wrap (5d6b-5d9f, `wrapWorld`) -- this port's prior
 * code never re-ran that second integration, so it committed the stale PRE-bounce position on any
 * tick a bounce actually fired. Fixed below by calling `integrateCar(car)` again once the velocity
 * mutations above are done, inside the gate. The hit-flag clear moved inside the same gate to match
 * (previously unconditional in this port) -- confirmed NOT a separate behavioral bug even though it
 * was mis-cited as "unconditional" before: `hitLeft`/`Right`/`Up`/`Down` have exactly one reader
 * anywhere in this codebase (the `reverseX`/`reverseY` block immediately above), and every writer
 * that sets `wallHitPending=1` either sets fresh flag values in the same write (`updateCarTileCollision`'s
 * solid branch, `terrain.js`'s `h6674`) or, when it doesn't (`terrain.js`'s `h6882`), relies on
 * whatever the flags were last legitimately set to -- exactly what leaving the clear ungated-in-the-
 * outer-scope was silently breaking (a stale-but-real flag pattern would read as freshly-zeroed
 * "none" instead), so this is a second real fix, not just a citation correction.
 */
export function bounceAndCommit(car, ctx, world) {
  if (car.wallHitPending && car.wallBounceEnable) {
    const none = !car.hitLeft && !car.hitRight && !car.hitUp && !car.hitDown
    const reverseX = car.hitLeft || car.hitRight || none
    const reverseY = car.hitUp || car.hitDown || none
    const halve = (v) => (car.halveOnBounce ? sar16(-v, 1) : -v)
    if (reverseX) car.velX = halve(car.velX)
    if (reverseY) car.velY = halve(car.velY)
    if (car.isDrone) {
      car.droneWallStuck++
      // 5c96-5ca6: alongside state=0xD, the real bytes also record the car's own current position
      // into knockoutX/knockoutY (already-named car.js fields) -- not just the state transition.
      if (car.droneWallStuck >= 20) {
        car.knockoutX = car.posX
        car.knockoutY = car.posY
        car.state = 0xd
      }
    }
    // 5d1d-5d32, reached only from inside this same gate (see the docstring above).
    car.hitLeft = 0; car.hitRight = 0; car.hitUp = 0; car.hitDown = 0
    // 5d35-5d9f: re-integrate from the still-uncommitted posX/posXfrac using the velocity this
    // block just mutated -- the fix for UNKNOWN_commit_reintegrates_post_bounce (see docstring).
    integrateCar(car)
  }

  // No 0xFF-progress knockout here: the only [12E3]==0xFF tests are at the write sites inside
  // UpdateCarTileCollisionSfx6or4 (564e/57c4/5838 -> 5842, now `writeProgress`/`knockOut` above);
  // a byte search finds no [12E3] reference anywhere in 5be7-5e36 (docs/engine.md §9ah).

  // Commit AND the "every committed step" LEV bit-7 safe-respawn roll share the same state gate
  // (docs/engine.md §3: "[12E0] = LEV[...] every committed step" -- "committed" is the operative
  // word; an adversarial review pass caught this running unconditionally in an earlier draft).
  if (car.state === 0 || car.state === 2 || car.state === 0xe) {
    car.posX = car.nextX; car.posXfrac = car.nextXfrac
    car.posY = car.nextY; car.posYfrac = car.nextYfrac
    const lev = world.levOf(car.metaTile)
    if (canRollSafePoint(car, ctx, lev)) {
      car.safeXPrev = car.safeX; car.safeYPrev = car.safeY
      car.safeX = car.posX; car.safeY = car.posY
    }
    car.levByte = lev ? lev.raw : 0
  }
}

/** Re-integrate both axes from the car's current committed position + velocity (5548-55b4 etc). */
export function integrateCar(car) {
  const nx = integrateAxis(car.posX, car.posXfrac, car.velX)
  const ny = integrateAxis(car.posY, car.posYfrac, car.velY)
  car.nextX = nx.pos; car.nextXfrac = nx.frac
  car.nextY = ny.pos; car.nextYfrac = ny.frac
}

/**
 * The 6 pair collisions (`RunCarPairCollisions 1000:5921` running `ResolveCarToCarCollisionSfx1and3
 * 5960`), docs/engine.md §3/§9n. `cars` is the 4-car array; `ctx.round`, `ctx.sound` (optional,
 * `src/engine/sound.js`'s driver shape -- sfx ids 1/3).
 *
 * 2026-09-21 (docs/engine.md §9n, the "glued cars" report): re-read live. Two things this session's
 * earlier draft got wrong, both now byte-verified:
 *
 * 1. The 6 calls are NOT `(i,j)` for `i<j`: `5921`'s own disassembly sets `[27B1]/[27B3]` from
 *    `[2660]/[2662]/[2664]/[2666]` (confirmed car-index-ordered offsets 0/0x164/0x2C8/0x42C, both by
 *    a live `read_memory 193C:2660` and by finding their own `MOV word ptr [26xx], imm` writers in
 *    `InitRaceCarsFromTables`) in the order (0,1)(0,2)(0,3)(1,3)(1,2)(3,2) -- note the last pair is
 *    (car3, car2), not (car2, car3): a genuine A/B swap, not just a reordering.
 * 2. `5960`'s top block (`5960-59CB`) re-integrates whichever car the CALLER left in `BX`, not car
 *    A. `5921` pushes/pops BX only once around all six calls, and `5960` itself reloads BX from
 *    `[27B1]`/`[27B3]` as it runs (`59CC`, `59F3`, `5A12`, `5A95`, `5AA0`, `5AAB`, `5AC1`, `5ADA`,
 *    `5AE6`, `5BB2`, `5BC4`), so the car re-integrated before each pair is the one the PREVIOUS
 *    pair left in BX: car 3 before the first pair (`4FF3 MOV BX,[2666]` for the last velocity call),
 *    then A if A was inactive or not in state 0/2 (`59D7`/`59F0` return with BX=A), otherwise B
 *    (every path from `59F3` on returns with BX=B). Corrected docs/engine.md §9an -- an earlier
 *    version of this comment said `5960` never writes BX and re-integrated car 3 before every pair.
 */
export function resolveCarCarCollisions(cars, ctx) {
  const PAIRS = [[0, 1], [0, 2], [0, 3], [1, 3], [1, 2], [3, 2]]
  let bx = cars[3]
  for (const [i, j] of PAIRS) {
    const a = cars[i]
    const b = cars[j]
    integrateCar(bx)
    const exitWithA = !a.active || (a.state !== 0 && a.state !== 2) // read before the pair can change A
    resolvePair(a, b, ctx)
    bx = exitWithA ? a : b
  }
}

function resolvePair(a, b, ctx) {
  // "if A is in state 2 the code skips B's test [including its active flag]" -- confirmed live:
  // `5960`'s branch is `A.state==2 OR (A.state==0 AND B.active AND (B.state==0 OR B.state==2))`,
  // not a symmetric "both active" guard.
  if (!a.active) return
  if (!(a.state === 2 || (a.state === 0 && b.active && (b.state === 0 || b.state === 2)))) return

  // dx/dy = A.next - B.next (NOT B.next - A.next): confirmed live at `5960` (`iVar3 =
  // *(iVar6+0x125e) - *(*0x27b3+0x125e)`, iVar6 from [27B1]=A). The 17x17 contact table
  // (`CONTACT_TABLE`) is NOT symmetric under negation, so the earlier B-minus-A version looked up
  // the wrong entry -- the bug behind the reported "glued together" cars: two cars closer than the
  // contact box got a misdirected (sometimes near-canceling) push instead of a clean separation.
  const dx = wrapDelta(a.nextX - b.nextX)
  const dy = wrapDelta(a.nextY - b.nextY)
  if (Math.abs(dx) > 16 || Math.abs(dy) > 16) return
  const angle = contactAngle(dx, dy)
  if (!angle && !(dx === 0 && dy === 0)) return

  if (a.state === 2 || b.state === 2) {
    a.velX = 0x40; a.velY = 0x40
    b.velX = -0x40; b.velY = -0x40
    a.carCarHit = 1; b.carCarHit = 1
    return
  }

  const s = SINE8[angle]
  const c = SINE8[(angle - 64) & 0xff]
  const relX = a.velX - b.velX
  const relY = a.velY - b.velY
  let imp = mul2Floor256(relX, s) - mul2Floor256(relY, c)
  imp = Math.max(imp, 500)

  // 5B2E-5B99, WARRIORS hard hit: nothing happens unless car A is drawn (5B40); then A, and B only if
  // B is drawn too (5B71), each snapshot knockoutX/Y := pos, go to state 0xD and play sfx 1
  // (docs/sound.md §3b id1 "5b63"/"5b94"). The port used to require both cars drawn and skipped the
  // knockoutX/Y snapshot (docs/engine.md §9an).
  if (ctx.round === 6 && imp > 500 && a.drawnThisFrame) {
    for (const car of b.drawnThisFrame ? [a, b] : [a]) {
      car.knockoutX = car.posX
      car.knockoutY = car.posY
      car.state = 0xd
      ctx.sound?.playSfx(1)
    }
  }
  const dvx = mul2Floor256(imp, s)
  const dvy = mul2Floor256(imp, c)
  a.velX -= dvx; a.velY -= dvy
  b.velX += dvx; b.velY += dvy
  a.carCarHit = 1; b.carCarHit = 1
  // docs/sound.md §3b id3 "5be1": every resolved impulse, any class, gated only on car B (M3.7).
  if (b.drawnThisFrame) ctx.sound?.playSfx(3)
}
