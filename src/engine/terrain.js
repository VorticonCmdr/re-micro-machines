// Per-round terrain dispatch (`DS:26D7`, docs/engine.md §5) and its ~24 handler blocks. State-0
// cars only; `TERRAIN_ROWS` (src/data/engine-tables.js) already carries every round's row of
// handler addresses in the exact order they sit in memory, so a short row's "overflow reads the
// next row's words" (§5) is reproduced here by dispatching through one flattened array instead of
// bounds-checking each row independently -- a real quirk of the original code, not a bug to hide.
//
// Every handler's formula is quoted from §5 in its own comment. Several are genuinely terse
// ("hop", "leave-level hop" with no numbers of their own); those share `defaultHop` (s/15+4, the
// one fully-specified case, from `60CB`) rather than inventing per-handler numbers docs/engine.md
// doesn't give. Anything inferred beyond a literal reading is flagged `UNKNOWN_*` inline.

import { TERRAIN_ROWS, DIR_REMAP_TABLE, DIR_COMPASS_TABLE, SINE8 } from '../data/engine-tables.js'
import { toI16, sar16 } from './int16.js'
import { triggerDropIn } from './dropin.js'

const FLAT_TERRAIN = TERRAIN_ROWS.flat()
const ROW_START = (() => {
  const starts = []
  let acc = 0
  for (const row of TERRAIN_ROWS) { starts.push(acc); acc += row.length }
  return starts
})()

const SHIFT5_ROUNDS = new Set([1, 2, 3, 6])
/** idx = dirByte >> 5 (rounds 1/2/3/6, 0..7) or >> 4 (4/5/7/8/9, 0..15). */
export const terrainIdxOf = (round, dirByte) => dirByte >>> (SHIFT5_ROUNDS.has(round) ? 5 : 4)

function defaultHop(car, s) {
  car.terrainLevel = 0
  car.zVel = Math.floor(s / 15) + 4
}

// --- Handlers, one per TERRAIN_HANDLER_NAMES entry (address in the comment) -------------------

function h35be() {} // RET (unused)

function h60cb(car, ctx) { // 0x60cb HandleTerrainNormalOrLeaveLevel
  car.offTrackDwell = 0
  if (car.terrainLevel !== 0) { // 60d1-6101
    car.terrainLevel = 0
    car.zVel = Math.floor(ctx.s / 15) + 4
  }
  // 6105-6164 runs OUTSIDE the [138E] block (60d6 JZ 6105 skips only the block above), overwriting
  // the /15 value: round 1's ramp lips launch a car straight off the ramp tile (prev idx 4 -> s/7+4,
  // prev idx 3 -> s/12+8). This port had it nested inside the leave-level gate, so no car could
  // ever clear round 1's jump and no round-1 race could be finished (docs/engine.md §9ah).
  if (ctx.round === 1 && car.terrainIdxPrev === 4) car.zVel = Math.floor(ctx.s / 7) + 4
  else if (ctx.round === 1 && car.terrainIdxPrev === 3) car.zVel = Math.floor(ctx.s / 12) + 8
}

function h6169(car) { // HandleTerrainKnockoutTile
  car.state = 0xd
  car.subState = 0x46
}

// UNKNOWN: docs/engine.md §5 doesn't say what sets offTrackDwell to 1 in the first place; read as
// this handler itself ramping it 0->1->2 across repeated ticks on this terrain.
function h618c(car) { // HandleTerrainOffTrackDwell
  if (!car.offTrackDwell) car.offTrackDwell = 1
  else if (car.offTrackDwell === 1) car.offTrackDwell = 2
  if (car.velX >= 0) car.velX = toI16(car.velX + 0xc8)
}

function h61b0(car, ctx) { // HandleTerrainRoughSurfaceSfx6
  // The speed cap runs unconditionally after either branch, matching every sibling "leave-level
  // hop; <tail>" handler in this file (657e/6622/66b2/6768/67d8), which all apply their tail
  // regardless of which branch fired -- an earlier draft returned early on the hop branch, skipping
  // the cap for it (an adversarial review pass flagged the asymmetry).
  if (car.terrainLevel !== 0) {
    defaultHop(car, ctx.s)
  } else {
    const exempt = (ctx.round === 5 && car.terrainIdxPrev === 3) || (ctx.round !== 5 && car.terrainIdxPrev === 4)
    if (!exempt) {
      car.velX = sar16(car.velX, 1); car.velY = sar16(car.velY, 1)
      // 6205-6210, this function's own literal namesake ("Sfx6"): fires only on the halved
      // (non-exempt) branch, drawn-gated. Re-disassembled live confirming the exact site inside
      // this already-ported function -- docs/sound.md §3b id6's second real site ("6210"),
      // previously unwired.
      if (car.drawnThisFrame) ctx.sound?.playSfx(6)
    }
  }
  car.speed = Math.min(car.speed, 0x200)
}

// UNKNOWN_conveyor_push_formula: "push v along the .DIR heading x2" isn't a fully specified
// formula; read as adding 2x the heading's sine/cosine to velX/velY (the same table the rest of
// the engine uses for heading->vector), not verified against a trace.
function h6231(car, ctx) { // FUN_1000_6231 (conveyor/current)
  const bucket = (car.levByte >> 5) & 3
  const lowNibble = car.dirByte & (ctx.round === 2 ? 7 : 15)
  const heading = DIR_COMPASS_TABLE[DIR_REMAP_TABLE[bucket][lowNibble]]
  car.velX = toI16(car.velX + 2 * SINE8[heading])
  car.velY = toI16(car.velY + 2 * SINE8[(heading - 0x40) & 0xff])
  car.speed = Math.min(car.speed, 0x100)
}

function h63d6(car) { car.puffSrcWet = 1 } // HandleTerrainWetPuffTrigger

function h63dd(car, ctx) { // HandleTerrainGroundedZVel
  car.zVel = Math.floor(Math.max(ctx.s, 0x1c) / 8) + 5
  car.bounceOnLand = 0
}

function h641a(car, ctx) { // HandleTerrainAirborneZVelBoost
  if (car.terrainIdxPrev !== 6 && ctx.s >= 0xe) car.zVel = Math.floor(Math.max(ctx.s, 0x1c) / 10) + 5
}

// State 1's own glide-to-cell-centre animation (HandleCarState1HazardDeath, `880a`) is not ported
// in M3.3 (states.js only covers 0/A/2/D/7) -- this handler only performs the documented
// transition + immediate velocity effect.
// Both real functions also zero [BX+0x12B0] (animTimer) a few bytes into their own body (`6466`,
// `6505` -- docs/engine.md §9w) -- redundant in practice here (every state that reads animTimer
// already zeroes it on its own terminal exit, and `InitRaceCarsFromTables` zeroes it at spawn, so
// it's already 0 by the time either handler runs) but matched anyway for exact fidelity.
function h6456(car) { if (car.hazardVulnerable) { car.state = 1; car.subState = 0; car.velX = 0; car.velY = 0; car.animTimer = 0 } } // HandleTerrainHazardFallSnapStop
function h64f5(car) { if (car.hazardVulnerable) { car.state = 1; car.subState = 0; car.animTimer = 0 } } // HandleTerrainHazardFallKeepVel

function h657e(car, ctx) { // HandleTerrainLeaveLevelHop
  if (car.terrainLevel !== 0) defaultHop(car, ctx.s)
  if (car.skidding) car.puffSrcSkid = 1
}

function h6622(car, ctx) { // HandleTerrainLeaveLevelWetPuff
  if (car.terrainLevel !== 0) defaultHop(car, ctx.s)
  if (car.speed !== 0) {
    car.puffSrcWet = 1
    // 6663-666e, drawn-gated, re-disassembled live: docs/sound.md §3b id18's own "666e" site,
    // inside this already-ported function -- previously unwired.
    if (car.drawnThisFrame) ctx.sound?.playSfx(18)
  }
}

function h6674(car) { // HandleTileResetSteerFlags
  if (car.terrainIdxPrev === 0 || car.terrainIdxPrev === 2) {
    car.terrainIdx = 0
    car.wallHitPending = 1
    car.hitLeft = 1
    car.hitUp = 1
  }
}

function h669b(car, ctx) { // HandleTileLowGripSfx12
  car.lowGripTimerA = 0x14
  // 66a1-66ac, drawn-gated, unconditional otherwise (not class-gated -- docs/sound.md §3b id18):
  // this function's own literal namesake ("Sfx12" = 0x12 = 18), previously unwired despite being
  // named for it.
  if (car.drawnThisFrame) ctx.sound?.playSfx(18)
}

function h66b2(car, ctx) { // HandleTerrainLeaveLevelMudPuff
  if (car.terrainLevel !== 0) defaultHop(car, ctx.s)
  car.lowGripTimerB = 0x14
}

function h66ed(car, ctx) { // HandleTerrainLeaveLevelHopVariant -- "hop (+6)" read as defaultHop's divisor with a +6 constant
  if (car.terrainLevel !== 0) { car.terrainLevel = 0; car.zVel = Math.floor(ctx.s / 15) + 6 }
  if (car.terrainIdxPrev !== 6) car.zVel = Math.floor(ctx.s / 9) + (ctx.round === 2 ? 0xb : 2)
}

function h6768(car, ctx) { // HandleTerrainLeaveLevelHighHop
  if (car.terrainLevel !== 0) defaultHop(car, ctx.s)
  if (ctx.s >= 0xe) car.zVel = Math.floor(Math.max(ctx.s, 0x1c) / 7) + (ctx.round === 2 ? 7 : 0)
}

function h67d8(car, ctx) { // HandleTerrainLeaveLevelLowHop
  if (car.terrainLevel !== 0) defaultHop(car, ctx.s)
  if (car.terrainIdxPrev !== 6) car.zVel = Math.floor(ctx.s / 5) + 4
}

/** Also called directly by round 3's own collision path (`57EE`, collide.js, docs/engine.md §9cc). */
export function h683c(car, ctx) { // ramp launch (unnamed); docs/engine.md §3 "Jump / airborne / Launch sources"
  if (car.dirBytePrev & 0x10) {
    car.zVel = Math.floor(ctx.s / 12) + 4
    car.rampJumpActive = 1
    // docs/sound.md §3b id1 "687c": ramp-jump launch, not a collision, gated on drawn (M3.7).
    if (car.drawnThisFrame) ctx.sound?.playSfx(1)
  }
}

function h6882(car, ctx) { // HandleTerrainSteppedLevels (rounds 4/5)
  let level = car.terrainIdx - 4
  let launch = false
  if (car.terrainIdx === 0xd) level = -1
  else if (car.terrainIdx === 0xe) { level = 4; launch = true }
  if (launch) car.zVel = Math.floor(ctx.s / 7) + 4
  const delta = level - car.terrainLevel
  if (delta > 2) {
    car.wallHitPending = 1 // "wall probes" -- the 4-point probe itself lives in collide.js, not wired from here
  } else if (Math.abs(delta) > 1) {
    car.zVel = Math.floor(ctx.s / 18) + 4 // drop
  }
  car.terrainLevel = level
}

function h69c5(car, ctx) { // HandleTerrainTankLevels
  car.terrainLevel = car.terrainIdx === 8 ? 2 : car.terrainIdx
  car.zVel = Math.floor(ctx.s / 15) + 4
  h6ac2(car)
}

function h6ac2(car) { // HandleTerrainDirRampBridgeFlag
  if (car.dirByte & 0x10) { car.onBridge = 1; car.unk1386 = 0 }
  else { car.onBridge = 0; car.unk1386 = 1 }
}

// HandleCarState0EDropInSequencer's terrain-triggered entry (docs §9r): round 3's own shortcut/warp
// mechanic, fully ported in engine/dropin.js (resolves UNKNOWN_stateE_reach/UNKNOWN_6ae5_round3_
// sequencer/UNKNOWN_22E1_scope). `ctx.raceState` is threaded in by step.js's dispatchTerrain call
// specifically for this one handler (the other 23 don't need it).
function h6ae5(car, ctx) { triggerDropIn(car, ctx, ctx.raceState) }

const HANDLERS = {
  0x35be: h35be, 0x683b: h35be,
  0x60cb: h60cb, 0x6169: h6169, 0x618c: h618c, 0x61b0: h61b0, 0x6231: h6231,
  0x63d6: h63d6, 0x63dd: h63dd, 0x641a: h641a, 0x6456: h6456, 0x64f5: h64f5,
  0x657e: h657e, 0x6622: h6622, 0x6674: h6674, 0x669b: h669b, 0x66b2: h66b2,
  0x66ed: h66ed, 0x6768: h6768, 0x67d8: h67d8, 0x683c: h683c, 0x6882: h6882,
  0x69c5: h69c5, 0x6ac2: h6ac2, 0x6ae5: h6ae5,
}

/**
 * `5e4e`'s terrain-dispatch half (docs/engine.md §5), state-0 cars only. `ctx.round`, `ctx.s`
 * (`vxi^2+vyi^2`, computed by step.js from velX/velY before calling this). Mutates
 * car.terrainIdx/terrainIdxPrev and whatever the dispatched handler touches.
 */
export function dispatchTerrain(car, ctx) {
  if (car.state !== 0) return
  const idx = terrainIdxOf(ctx.round, car.dirByte)
  car.terrainIdxPrev = car.terrainIdx
  car.terrainIdx = idx

  const airborne = car.height !== 0
  const exemptAirborneGate = (ctx.round === 4 || ctx.round === 5) && idx >= 5
  if (airborne && !exemptAirborneGate) return

  const i = ROW_START[ctx.round - 1] + idx
  if (i >= FLAT_TERRAIN.length) return // beyond even the next rows' overflow -- no-op, not a crash
  const handler = HANDLERS[FLAT_TERRAIN[i]]
  if (handler) handler(car, ctx)
}
