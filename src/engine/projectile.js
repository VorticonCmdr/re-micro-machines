// Projectiles -- Fire `1000:4f17`, Flight `1000:51b2`/`87f3`, Hit `1000:79fd` -- docs/engine.md §9q.
// TANKS (round 7) or the `[2919]` cheat flag gate every part of this system: firing, flight's own
// sub-stepping, and the hit test are all no-ops outside that gate in the real game (re-verified
// live: `1000:5e3c-5e48`'s hit-check call site carries the identical gate as Fire's own).
//
// Single-decrement simplification (docs/engine.md §9q). The real game decrements `reloadCooldown`
// TWICE per physics step under some conditions: once in the physics function (`51b2`, every step)
// and again in the per-frame DRAW function (`8712`, only on ticks the smoothness draw-gate lets
// through) -- coupling a shot's real-world flight/reload duration to the player's smoothness
// setting. `8712` is also the ONLY place besides a hit that clears `projActive`, so a skipped draw
// frame could in principle leave a shot's state stuck forever. This port's own smoothness gate
// (`src/engine/smoothness.js`) is a draw-SKIP counter over an always-35Hz physics loop -- a
// different structural split from the original's own render/physics batching -- so reproducing the
// double-decrement literally would import a video-setting dependency this port's physics layer was
// never designed to have, and would inherit the same "state depends on whether a frame drew"
// fragility. Deliberately simplified to ONE decrement, in physics, every step: a fired shot's
// total lifecycle (60 ticks: ~20 visible flight + ~40 reload) is fixed real-world time, not
// smoothness-dependent, unlike the original.
//
// Flight motion simplification. `87f3`'s 6-substep-per-axis 8-bit accumulator (with its own
// "AND AH,0xF0 before every substep, re-OR the frac nibble back in after the group" idiom) was
// re-disassembled live but its exact sub-pixel carry behaviour across ticks was NOT fully pinned
// down (flagged as such by the research itself). Rather than guess a bit-level model, this port
// uses the mathematically-equivalent AVERAGE per-tick pixel drift the same inputs would produce:
// `trunc(6*sine/256)` (the expected net carry from 6 substeps of a fixed signed delta) plus the
// separately-confirmed, once-per-tick "inherited velocity" term `(fracNibble-8)`. Hit detection
// uses a 12px box, and the visual difference is sub-pixel-per-tick, so this is a deliberate,
// documented simplification, not an approximation of something gameplay-relevant.

import { toI16, toU16, sext8, wrapWorld, wrapDelta } from './int16.js'
import { SINE8 } from '../data/engine-tables.js'

const FIRE_SFX = 0x0e
const HIT_SFX = 1
export const RELOAD_TOTAL = 0x3c // 60 -- reloadCooldown's value right after firing
export const FLIGHT_THRESHOLD = 0x28 // 40 -- reloadCooldown >= this = still in visible flight/hittable
const HIT_BOX = 13 // 1000:79fd: |dx|,|dy| < 0xD

/** TANKS (round 7) or the `projectilesForAll` cheat flag (docs/engine.md §6 type 9) -- gates
 * firing (`4F21`) and the hit test (`5E3C`). Flight (`30A9 -> 51B2`) is NOT gated, but only a shot armed on
 * the gated fire path (`4F63`) ever flies, and `updateProjectileFlight` below runs ungated too (docs/engine.md §9cf). */
export function projectilesEnabled(ctx) {
  return ctx.round === 7 || !!ctx.projectilesForAll
}

/** Fire (`1000:4f17`). No-op unless `projectilesEnabled(ctx)` (4F21-4F2F), the car's own reload is
 * done (4F32) and the car was on screen at the last draw (4F3C `[BX+1250]`, `drawn.js`) -- an
 * off-screen tank does not fire (docs/engine.md §9ao). */
export function fireProjectile(car, ctx) {
  if (!projectilesEnabled(ctx) || car.reloadCooldown !== 0 || !car.drawnThisFrame) return
  car.projActive = 1
  car.projFrame = 0
  car.reloadCooldown = RELOAD_TOTAL
  car.projStepsA = 0xa
  car.projStepsB = 0xa

  const si = car.heading & 0xf8
  const s = SINE8[si]
  // 4F81-4F8E: AH = (DH + 8) & 0xF, DH = the HIGH byte of velX + posXfrac (this step's pixel carry).
  const carryX = (toU16(car.velX + car.posXfrac) >> 8) & 0xff
  car.projXsub = (s & 0xff) | (((carryX + 8) & 0xf) << 8) // the "direction word", 13A0
  car.projX = wrapWorld(car.posX + (s >> 3))

  const si2 = (si - 0x40) & 0xff
  const s2 = SINE8[si2]
  const carryY = (toU16(car.velY + car.posYfrac) >> 8) & 0xff // 4FAE-4FBB
  car.projYsub = (s2 & 0xff) | (((carryY + 8) & 0xf) << 8) // 13A2
  car.projY = wrapWorld(car.posY + (s2 >> 3))

  ctx.sound?.playSfx(FIRE_SFX)
}

/** Net per-tick pixel drift for one axis from its packed direction word (see the module comment's
 * "flight motion simplification"). */
function axisDrift(subWord) {
  const sine = sext8(subWord & 0xff)
  const fracNibble = (subWord >> 8) & 0xf
  return Math.trunc((6 * sine) / 256) + (fracNibble - 8)
}

/** Flight (`1000:51b2`). Advances an active shot by one physics tick; call once per car per step,
 * regardless of `projectilesEnabled` (a shot already in flight keeps flying even if the cheat flag
 * that enabled firing it were somehow cleared mid-race -- the real gate is on `reloadCooldown`, not
 * on TANKS/`[2919]`, matching `51b2`'s own unconditional-per-car-slot dispatch). */
export function updateProjectileFlight(car) {
  if (car.reloadCooldown === 0) return
  car.reloadCooldown--
  if (car.reloadCooldown > FLIGHT_THRESHOLD - 1) {
    car.projX = wrapWorld(car.projX + axisDrift(car.projXsub))
    car.projY = wrapWorld(car.projY + axisDrift(car.projYsub))
    if (car.projStepsA !== 0) {
      car.projStepsA = toI16(car.projStepsA - 1)
      car.projStepsB = toI16(car.projStepsB - 1)
    }
  }
  if (car.reloadCooldown === 0) car.projActive = 0
}

/** Hit (`1000:79fd`). Once per step, not per car -- a shot can hit any OTHER present car. No-op
 * unless `projectilesEnabled(ctx)` (the real hit-check call site carries the identical gate). */
export function resolveProjectileHits(cars, ctx) {
  if (!projectilesEnabled(ctx)) return
  for (const shooter of cars) {
    if (!shooter.projActive || shooter.reloadCooldown < FLIGHT_THRESHOLD) continue
    for (const victim of cars) {
      if (victim === shooter || !victim.present) continue
      const dx = Math.abs(wrapDelta(victim.posX - shooter.projX))
      const dy = Math.abs(wrapDelta(victim.posY - shooter.projY))
      if (dx < HIT_BOX && dy < HIT_BOX) {
        shooter.projActive = 0
        victim.knockoutX = victim.posX
        victim.knockoutY = victim.posY
        victim.state = 0xd
        if (victim.drawnThisFrame) ctx.sound?.playSfx(HIT_SFX)
        break // this shot is spent; move on to the next shooter
      }
    }
  }
}
