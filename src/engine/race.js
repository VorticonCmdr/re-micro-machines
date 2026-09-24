// Minimal per-round/race setup for the headless step (M3.3 scope only): load one round/race's
// track files into a `collide.js` world, and derive the per-round constants `step.js` needs from
// `CarTypeInfo` (docs/engine.md §8). Spawning cars from `STRT_POS.BIN`/`CarTypeInfo` the way
// `InitRaceCarsFromTables 1000:3c09-458a` does is NOT here yet -- M3.3's acceptance test runs from
// the static init image (`tools/refs/car-static-init.hex`), and full race spawn/setup naturally
// belongs with M3.6's playable page (or a later increment of this file).

import { buildWorld } from './collide.js'
import { CAR_TYPE_INFO, KID_MODIFIER, DRONE_MAX_VEL_HANDICAP } from '../data/engine-tables.js'
import { parseBrk } from '../formats/levbrk.js'
import { toBytes, fromBytes } from './car.js'
import { toI16, wrapWorld } from './int16.js'

/**
 * @param {(name: string) => Promise<Uint8Array|ArrayBuffer>} read  e.g. a `game/` file reader
 * @param {{col: Uint8Array, dir: Uint8Array}} [sharedBuffers] from `collide.js`'s
 *   `createColDirBuffers()` -- see `buildWorld`'s own doc for what this opts into.
 * @returns {Promise<object>} a `collide.js` world for `GAME1/ROUNDn{race}.MAP` + the round's
 *   `.COL`/`.DIR`/`ROUNDnBR.LEV`
 */
export async function loadWorld(read, round, race, sharedBuffers) {
  const [mapBytes, colBytes, dirBytes, levBytes] = await Promise.all([
    read(`GAME1/ROUND${round}${race}.MAP`),
    read(`GAME1/ROUND${round}.COL`),
    read(`GAME1/ROUND${round}.DIR`),
    read(`GAME1/ROUND${round}BR.LEV`),
  ])
  return buildWorld(mapBytes, colBytes, dirBytes, levBytes, sharedBuffers)
}

/**
 * `GAME1/ROUNDn{race}B.BRK`, for `ai.js`'s `ctx.brk` -- round 9 ships none ("drone-free /
 * different AI for that class", docs/engine.md §6/`levbrk.js`), so callers for round 9 should
 * skip this and leave `ctx.brk` unset rather than call it.
 * @param {Uint8Array} [sharedBuffer] from `levbrk.js`'s `createBrkBuffer()` -- see `parseBrk`'s
 *   own doc for what this opts into.
 */
export async function loadBrk(read, round, race, sharedBuffer) {
  const bytes = await read(`GAME1/ROUND${round}${race}B.BRK`)
  return parseBrk(bytes, sharedBuffer).records
}

/**
 * The per-round constants `step.js`'s `ctx` needs beyond round/race/raceFormat: `gripOverrideA`/
 * `gripOverrideB` are `CarTypeInfo` columns [7]/[8] ([28C2]/[28C4], docs/engine.md §3/§8).
 */
export function roundCtx(round, race, { raceFormat = 1 } = {}) {
  const info = CAR_TYPE_INFO[round - 1]
  return { round, race, raceFormat, gripOverrideA: info[7], gripOverrideB: info[8] }
}

/**
 * `InitRaceCarsFromTables`'s per-car tuning handicap `CX` (`3FBE-4059`, `UNKNOWN_kidmodifier_use`
 * resolved 2026-09-22 -- full live disassembly, `3FBE-4134`, all seven affected fields and both
 * extra adjustment layers, not just the three-field/single-layer account an earlier investigating
 * pass reported -- corrected here after independent re-verification caught three concrete errors
 * in that report: the [28C1]<=0 flat-ramp values for car2/car3 were swapped, a garbled
 * "[28C1]>=8->+8" conflated two separate real rules, and 4 of the 7 affected fields (brakeDecel/
 * coastDecel/slipThreshold/gripStep) were missing entirely).
 *
 * `[BX+0x1278]`-style oscillator note doesn't apply here; this is a one-time per-car RACE-INIT
 * value, computed once in `InitRaceCarsFromTables`, not a per-tick mechanic.
 *
 * `KID_MODIFIER` is the identity table (`KID_MODIFIER[c]===c`, confirmed live), so "look up the
 * selected character's modifier" is equivalent to "use the character index directly" -- kept as an
 * explicit lookup below for fidelity to the real bytes' own indirection, not because the table does
 * anything beyond identity.
 *
 * `carIndex===0` (the human/P1 car, `BX==0` in the real bytes, `3FCE/3FD3`) always gets `CX=0` --
 * confirmed unconditional, independent of character/round/tournament index -- so `character` is
 * only ever consulted for drones (cars 1-3).
 *
 * `tournamentIndex<=0` (no real tournament context, e.g. this port's own `play.js` standalone
 * boot) substitutes a flat per-slot ramp for the KidModifier lookup (`3FE0-3FF2`): car index 1->0,
 * car index 2->12, car index 3->6 (NOT 0/6/12 -- the earlier investigating pass had car2/car3
 * swapped; re-derived directly from the real branch structure, not assumed).
 */
function computeTuningOffset(carIndex, tournamentIndex, round, character) {
  if (carIndex === 0) return 0
  let cx
  if (tournamentIndex > 0) {
    cx = KID_MODIFIER[character ?? 0] ?? 0
  } else {
    cx = carIndex === 1 ? 0 : carIndex === 3 ? 6 : 12
  }
  cx -= 0xf
  cx += tournamentIndex
  // `round` stands in for `[28BF]` (vehicle class) here, the same established approximation
  // `ai.js`/`roundCtx` already use elsewhere in this port -- exact for these three specific
  // classes since TANKS/POWERBOATS/CHOPPERS never coincide with a tournament PRO-class
  // substitution (round 7/2/8 only, `docs/engine.md` §7).
  if (round === 7) cx += 4 // TANKS
  if (round === 8) cx += 8 // CHOPPERS
  if (round === 2) cx += 7 // POWERBOATS
  if (tournamentIndex === 8) cx += 3
  if (tournamentIndex >= 0x13) cx += 8
  if (tournamentIndex === 0x15) cx -= 1
  if (tournamentIndex === 0x16) cx -= 8
  if (tournamentIndex === 0x17) cx += 0x14
  if (tournamentIndex === 0x18) cx -= 5
  return cx
}

/**
 * The seven `CarTypeInfo`-derived tuning fields `InitRaceCarsFromTables` sets per car
 * (`3FBE-4134`, docs/engine.md §9y), as their own export so every caller that needs a car's static
 * tuning -- `spawnCars` below, and `tools/check-trace.mjs`'s trace-replay init -- computes them one
 * way, not two: `check-trace.mjs` used to carry its own separate `CX=0` approximation, which caused
 * a real, since-resolved false divergence (docs/engine.md §9f/§9z-live) once `spawnCars` gained the
 * real per-car `CX` handicap in M3.20 and this file's own duplicate was never updated to match --
 * confirmed live 2026-09-22 (`docs/engine.md`'s live-verification section): a fresh DOSBox capture
 * of `ROUND21`'s four spawned cars matched every one of these seven fields, byte-exact, for all 4
 * cars, against exactly what this function (called with `tournamentIndex=0`, the no-tournament-
 * context branch) predicts.
 * @param {number} carIndex 0-3
 * @param {number} round
 * @param {number} tournamentIndex ([28C1]) defaults to 0 -- no tournament context
 * @param {number} [character] the drone's selected character index, consulted only when
 *   `tournamentIndex>0` (KID_MODIFIER lookup) -- unused otherwise
 * @param {number} [raceFormat] 1 or 2 -- only affects drones' `accel` once `tournamentIndex>=0x12`
 */
export function tuningFieldsFor(carIndex, round, tournamentIndex = 0, character, raceFormat = 1) {
  const info = CAR_TYPE_INFO[round - 1]
  const isDrone = carIndex !== 0
  const gripBase = isDrone ? 0x28 : 20 // drones +0x28, human +GripAdjust(20) (docs/engine.md §1)
  const cx = computeTuningOffset(carIndex, tournamentIndex, round, character)

  let maxSpeedCur = info[0] + 11 * cx
  if (isDrone) maxSpeedCur -= DRONE_MAX_VEL_HANDICAP[tournamentIndex] ?? 0
  let accel = info[2] + cx
  if (isDrone && raceFormat === 2 && tournamentIndex >= 0x12) {
    accel -= accel >> (tournamentIndex === 0x17 ? 2 : 4)
  }
  if (!isDrone && tournamentIndex === 0x17) {
    maxSpeedCur -= 3 * 0x4b
    accel -= 3 * 2
  }

  return {
    maxSpeedCur: toI16(maxSpeedCur), maxSpeedBase: toI16(maxSpeedCur),
    reverseLimit: toI16(info[1] + 4 * cx + 0x32),
    accel: toI16(accel),
    brakeDecel: toI16(info[3] + cx + 0x28),
    coastDecel: info[4],
    slipThreshold: toI16(info[5] + 2 * cx + gripBase),
    gripStep: toI16(info[6] + 3 * cx + gripBase),
    steerStep: round === 6 || round === 7 ? 2 : 3,
  }
}

// [137C] per car index 0-3 (docs/engine.md §2 "per-car [137C] = 3,2,1,0"); bit 0 -> x+26, bit 1 ->
// y+26, forming the 2x2 start grid around STRT_POS.BIN's own {x,y} (docs/engine.md §1).
const START_GRID_SLOT = [3, 2, 1, 0]
// docs/engine.md §1 "Static initial image": car 0-3's own distinct camHalfW before the first
// state-0 velocity update overwrites all of them to 0x80 (53bc/53c2) -- only matters for the
// handful of ticks before a car first leaves state 0xA.
const INIT_CAM_HALF_W = [0x80, 0xa0, 0xc0, 0xe0]

/**
 * `InitRaceCarsFromTables 1000:3c09-458a`, the one-player subset: 4 cars, car 0 human (`isDrone`
 * 0), cars 1-3 drones, from `STRT_POS.BIN`'s grid position and `CAR_TYPE_INFO[round-1]`.
 * `UNKNOWN_kidmodifier_use` resolved 2026-09-22 -- `computeTuningOffset` (above) implements the
 * real per-car `CX` handicap; three further pieces of the same real mechanism (`3FBE-4134`), all
 * applied here too: (1) `DRONE_MAX_VEL_HANDICAP[tournamentIndex]` subtracted from drones' own
 * `maxSpeedCur` (`4070-4084`, car 0 exempt); (2) a two-car-format-only `accel` penalty for drones
 * once `tournamentIndex>=0x12`(18) -- `accel >> 2` at `tournamentIndex===0x17`(23), `accel >> 4`
 * otherwise (`40A0-40CC` -- gated on `[2656]==2`, i.e. `raceFormat===2`, and `BX!=0`); (3) a flat,
 * car-0-only nerf (`maxSpeedCur -= 0xE1`(225), `accel -= 6`) at `tournamentIndex===0x17`(23) --
 * the real code (`4116-4131`) applies `-0x4B`/`-2` once per "advance to the next car" transition
 * inside the per-car loop, which fires exactly 3 times (car0->1, 1->2, 2->3) whenever the
 * condition holds, regardless of `raceFormat`; folded here into one flat `*3` application rather
 * than three identical loop iterations, verified against the loop's own exit structure (`4110`
 * exits BEFORE this check on the 4th car, so it is genuinely 3x, not 4x or 1x).
 *
 * **Two DIFFERENT "isDrone" concepts, confirmed genuinely separate in the real bytes (GOAL-
 * DOS-PARITY.md P4's two-human item, docs/engine.md §9bf).** `tuningFieldsFor`'s own internal
 * `isDrone` (init-time grip/`DRONE_MAX_VEL_HANDICAP`/accel-penalty math, above) is confirmed
 * car-INDEX-based in the real bytes (`4070: CMP BX,0`, the same `BX==0` test `computeTuningOffset`
 * already cites) -- unconditional on controller type, unchanged here. The RUNTIME `car.isDrone`
 * field set below is a SEPARATE flag, `[BX+0x12EB]` in the real bytes, confirmed by disassembling
 * its own writer (`InitRaceCarsFromTables 41D0-421A`: `CMP word[0x2658+2*slot],6 / JNZ skip /
 * MOV [BX+0x12EB],1` -- one check per car SLOT's own controller-type word) and cross-checking FOUR
 * of its readers (the fire-preempt gate `4D3D`, the finished-car-coasts gate `4D2F`, the TANKS
 * steer-mod `4EE7`, and `collide.js`'s own wall-stuck knockout counter `5C84`) -- all four test
 * `[BX+0x12EB]==1`, none test car index. So a human-controlled car 1 (two-human H2H, GOAL P4)
 * needs `car.isDrone=0` for these four RUNTIME mechanics. Its own INIT-time tuning is a THIRD,
 * still-separate question this function does NOT yet answer for two-human H2H specifically: the
 * whole `4070`/`CMP BX,0` block this function implements only runs in the real bytes when a
 * per-RACE mode fork (`1000:3F30`, `CS:[0x9C62]`≡`DS:[0x8A2]`) is `0` -- and two-human H2H's own
 * entry always sets that fork nonzero, taking a SEPARATE, entirely unported per-car computation
 * (`3F3B-3FBD`) instead, symmetric across every car slot. So this function's own tuning is correct
 * for every CURRENT caller (all one-player, all take the `CS:[0x9C62]==0` branch) but is NOT what
 * a two-human H2H race actually uses -- porting `3F3B`'s own formulas is a prerequisite for that
 * mode, tracked as `UNKNOWN_alt_tuning_path` (docs/engine.md §9bf/§10), not yet done here.
 * @param {{x:number,y:number}[]} strtPosEntries  `parseStrtPos`'s output
 * @param {{raceFormat?: number, tournamentIndex?: number, opponentCharacters?: number[], controllerTypes?: number[]}} opts
 *   `raceFormat: 2` (M3.8): cars 2/3 are absent (docs/engine.md §1 "cars 2,3 = 0 in a two-car
 *   race"). `tournamentIndex` ([28C1], the `ORDER_TABLE` position, 0-25) defaults to 0 -- matching
 *   this port's other established `[28C1]`-approximations (`ai.js`) -- which selects the real
 *   game's own `tournamentIndex<=0` flat-ramp branch, not a KidModifier lookup, so a caller with no
 *   tournament context (this port's own `play.js`) never needs `opponentCharacters` either.
 *   `opponentCharacters`: the 3 drones' selected character indices (`tournament.js`'s own
 *   `state.opponents`), consulted only when `tournamentIndex>0`. `controllerTypes`: one word per
 *   slot (`[0x2658..265E]`, 1/2 joystick, 3 mouse, 4/5 keys, 6 CPU), defaults to `[1,6,6,6]` --
 *   every CURRENTLY-reachable caller (flow.js, play.js, every `tools/check-*.mjs`) never passes
 *   this, and car 0's own controller type is never 6 / cars 1-3's are always 6 in every one of
 *   those flows, so this default reproduces the exact same `car.isDrone` values the old
 *   `i !== 0` computation gave -- confirmed behaviour-neutral, not just assumed (the full existing
 *   suite, `tools/check-*.mjs`, passes unchanged with this default).
 */
export function spawnCars(strtPosEntries, round, race, { raceFormat = 1, tournamentIndex = 0, opponentCharacters = [], controllerTypes = [1, 6, 6, 6] } = {}) {
  const start = strtPosEntries.find((s) => s.round === round && s.race === race)
  if (!start) throw new Error(`no STRT_POS entry for round ${round} race ${race}`)

  return Array.from({ length: 4 }, (_, i) => {
    // `[BX+0x12EB]`'s own real writer (`InitRaceCarsFromTables 41D0-421A`) -- see this function's
    // own header for the four confirmed runtime readers this feeds.
    const isDrone = controllerTypes[i] === 6
    // `InitRaceCarsFromTables 1000:41bd-41d2` deactivates cars 1-3 for round 9 (RUFFTRUX) -- NOT
    // `3b50`'s own earlier round-9 zeroing, which this same load sequence's own unconditional
    // 4-car `present=1` init (`4160-4172`) clobbers a few instructions later, making it dead on
    // arrival (`mm-re-player-visible` 2026-09-23, docs/engine.md §9ak). `active` is a genuine,
    // comprehensive "remove from the simulation" flag confirmed at every major per-car physics/
    // collision/draw entry point, not a draw-only gate -- this port's own `active`-gates (states.js/
    // collide.js/terrain.js) already implement that pervasively, so setting it here is the one
    // change needed; nothing downstream needed adjusting to respect it.
    const present = (raceFormat === 2 && i >= 2) || (round === 9 && i >= 1) ? 0 : 1
    const slot = START_GRID_SLOT[i]
    const posX = wrapWorld(start.x + 20 + (slot & 1 ? 26 : 0))
    const posY = wrapWorld(start.y - 10 + (slot & 2 ? 26 : 0))

    const tuning = tuningFieldsFor(i, round, tournamentIndex, opponentCharacters[i - 1], raceFormat)

    const partial = {
      playerSlot: i + 1,
      active: present,
      present,
      colourOffset: i * 2,
      posX, nextX: posX, posY, nextY: posY,
      safeX: posX, safeY: posY, safeXPrev: posX, safeYPrev: posY,
      camHalfW: INIT_CAM_HALF_W[i], camHalfH: 0x64,
      heading: 0,
      state: 0xa,
      lapsRemaining: 3,
      isDrone: isDrone ? 1 : 0,
      startGridSlot: slot,
      controlsLocked: 1, // released by step.js's control loop once the camera has settled (4D0E-4D1F)
      slipEnable: 1, wallBounceEnable: 1, halveOnBounce: 1, hazardVulnerable: 1,
      ...tuning,
      // Static init image: `12FD..137A = 0xFFFF` (docs/engine.md §1) -- the puff/splash slot
      // arrays' own "empty" sentinel (docs/engine.md §9q). Without this, car.js's toBytes()
      // defaults every unset field to 0, which would read back as frame=0 (a spuriously "active"
      // slot at the origin) instead of the real game's genuinely-empty starting state.
      puffSlots: Array.from({ length: 8 }, () => ({ frame: -1 })),
      splashSlots: Array.from({ length: 5 }, () => ({ frame: -1 })),
    }
    return fromBytes(toBytes(partial))
  })
}
