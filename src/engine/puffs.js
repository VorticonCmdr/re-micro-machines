// Puffs and splashes -- `DrawWheelEffectPuffs 1000:8083`, `FUN_1000_8386 1000:8386` (splash),
// docs/engine.md §9q. Both are spawn+cursor-advance+animate systems triggered by flags set
// elsewhere (`terrain.js`'s `puffSrcWet`/`puffSrcSkid`, this file's own low-grip check,
// `airborne.js`'s `splashTrigger`) and consumed here, once per car per physics step.
//
// Architecture note: in the real game this spawn/animate logic lives INSIDE the DRAW functions,
// called once per drawn frame -- so a chunkier smoothness setting slows puff/splash animation in
// the original (the shared cooldown, decremented every physics step in
// `UpdateCarAirborneLandingSfx`, is only actually consulted as often as a frame is drawn). This
// port keeps spawn/animate in the engine layer instead, called every physics step regardless of
// smoothness -- consistent with this project's own physics/render split everywhere else (e.g. the
// HUD's rank is computed in step.js, not in hud.js) and avoiding the same smoothness-coupling risk
// flagged for projectiles (docs/engine.md §9q). Documented divergence: puffs/splashes animate at a
// fixed real-world rate in this port, not a smoothness-dependent one.
//
// UNKNOWN_puff_slot_fields resolved (car.js): every trigger spawns a PAIR of 8x8 sprites (xA/yA at
// heading+puffOffA+0x80, xB/yB at heading+puffOffC+0x80 -- the "+0x80" points the spray behind the
// car), sharing one frame counter and one `source` (which PH0 puff set: 0=wet, 1=skid, 2=mud).
//
// Priority (`DrawWheelEffectPuffs`, matches disassembly order exactly): low-grip/mud first (if
// `lowGripTimerA!=0` and the car is moving -- a real trigger source `terrain.js` doesn't set a
// flag for; checked directly here, matching the real function's own inline check), then skid, then
// wet. Only one puff spawns per car per opportunity, even if multiple triggers are set.

import { PH0_LAYOUT } from '../formats/race.js'
import { SINE8 } from '../data/engine-tables.js'
import { wrapWorld } from './int16.js'

const PUFF_SLOT_COUNT = 8
const SPLASH_SLOT_COUNT = 5
const PUFF_ANIM_FRAMES = 8
const SPLASH_ANIM_FRAMES = 5
export const PUFF_SET = { WET: 0, SKID: 1, MUD: 2 }

/** Heading-relative spawn point, `>>4` scale (docs/engine.md §9q) -- the same sin/cos-pair
 * convention every other heading->displacement consumer in this codebase uses (camera, velocity,
 * projectile fire); the research pinned the X-axis formula exactly but not an explicit Y formula,
 * so the Y axis here is inferred by that precedent, not independently disassembled. */
function spawnPoint(car, offset) {
  const angle = (car.heading + offset + 0x80) & 0xff
  const s = SINE8[angle]
  const c = SINE8[(angle - 0x40) & 0xff]
  return { x: wrapWorld(car.posX + (s >> 4)), y: wrapWorld(car.posY + (c >> 4)) }
}

/** Advances `puffOffA/B` (and `C/D`) as a round-2-only sweeping oscillator (`1000:82..`, docs
 * §9q): `off += step`, flip `step`'s sign once `|off| > 29`. Outside round 2 these stay fixed. */
function oscillate(car, ctx, offField, stepField) {
  if (ctx.round !== 2) return
  car[offField] += car[stepField]
  if (Math.abs(car[offField]) > 29) car[stepField] = -car[stepField]
}

function spawnPuff(car, ctx, set) {
  oscillate(car, ctx, 'puffOffA', 'puffOffB')
  oscillate(car, ctx, 'puffOffC', 'puffOffD')
  const a = spawnPoint(car, car.puffOffA)
  const b = spawnPoint(car, car.puffOffC)
  const slot = car.puffSlots[car.puffSlotCursor]
  slot.xA = a.x; slot.yA = a.y
  slot.xB = b.x; slot.yB = b.y
  slot.frame = 0
  slot.source = set
  car.puffSlotCursor++
  if (car.puffSlotCursor > 7) car.puffSlotCursor -= 7 // 1000:82ab: skips slot 0 after the first cycle -- bug-for-bug, see docs/engine.md §9q
  car.puffCooldown = 3
}

function spawnSplash(car) {
  const slot = car.splashSlots[car.splashSlotCursor]
  slot.x = car.posX
  slot.y = car.posY
  slot.frame = 0
  car.splashSlotCursor++
  if (car.splashSlotCursor > 4) car.splashSlotCursor -= 4 // 1000:842a: same skip-slot-0 quirk, 5-slot ring
  car.splashCooldown = 6
}

function advanceFrames(slots, cooldown, maxFrame) {
  if (cooldown > 0) return
  for (const slot of slots) {
    if (slot.frame === -1) continue
    slot.frame++
    if (slot.frame >= maxFrame) slot.frame = -1
  }
}

/** Call once per car per physics step (after `puffCooldown`/`splashCooldown` have already been
 * decremented this step -- `airborne.js`, matching `UpdateCarAirborneLandingSfx`'s own order). */
export function updatePuffsAndSplashes(car, ctx) {
  if (car.puffCooldown <= 0) {
    if (car.lowGripTimerA !== 0 && (car.velX !== 0 || car.velY !== 0)) {
      spawnPuff(car, ctx, PUFF_SET.MUD)
    } else if (car.puffSrcSkid) {
      car.puffSrcSkid = 0
      spawnPuff(car, ctx, PUFF_SET.SKID)
    } else if (car.puffSrcWet) {
      car.puffSrcWet = 0
      spawnPuff(car, ctx, PUFF_SET.WET)
    }
  }
  advanceFrames(car.puffSlots, car.puffCooldown, PUFF_ANIM_FRAMES)

  if (car.splashTrigger && car.splashCooldown <= 0) {
    car.splashTrigger = 0
    spawnSplash(car)
  }
  advanceFrames(car.splashSlots, car.splashCooldown, SPLASH_ANIM_FRAMES)
}
