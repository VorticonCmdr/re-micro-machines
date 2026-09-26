// Puffs and splashes -- `DrawWheelEffectPuffs 1000:8083`, `FUN_1000_8386 1000:8386` (splash),
// docs/engine.md §9q. Both are spawn+cursor-advance+animate systems triggered by flags set
// elsewhere (`terrain.js`'s `puffSrcWet`/`puffSrcSkid`, this file's own low-grip check,
// `airborne.js`'s `splashTrigger`) and consumed here, once per car per physics step.
//
// Cadence (docs/engine.md §9cr): in the real game this spawn/animate logic lives inside the draw
// (`DrawRaceCarLayer 7CE0`, called from the render `90C5`), so it runs once per DRAWN frame -- one
// physics step in N at smoothness N -- while the shared cooldowns are decremented every physics step
// in `UpdateCarAirborneLandingSfx`. `step.js`'s `renderPass` calls this on drawn steps only, before
// the state handlers and before that step's `7429`, as the real order has it.
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
import { toI16 } from './int16.js'

const PUFF_ANIM_FRAMES = 8
const SPLASH_ANIM_FRAMES = 5
export const PUFF_SET = { WET: 0, SKID: 1, MUD: 2 }

/** Heading-relative spawn point, `>>4` scale (`81A8-81C9`): the byte sine table at `DS:10A0`, SAR 4,
 * X from `angle`, Y from `angle-0x40`. The wrap is the bytes' own, asymmetric one (`81CB-81ED`): X
 * gets +0xC00 at <= -1, Y only at <= -0xC; both get -0xC00 at >= 0xC00. */
function spawnPoint(car, offset) {
  const angle = (car.heading + offset + 0x80) & 0xff
  let x = car.posX + (SINE8[angle] >> 4)
  let y = car.posY + (SINE8[(angle - 0x40) & 0xff] >> 4)
  if (x <= -1) x += 0xc00
  if (x >= 0xc00) x -= 0xc00
  if (y <= -0xc) y += 0xc00
  if (y >= 0xc00) y -= 0xc00
  return { x, y }
}

/** The spray angle offset (`8181`/`8186-81A4`, `8221`/`8226-8244`): -0x1E / +0x1E outside round 2;
 * in round 2 the offset BEFORE this spawn's oscillation step (`[128E]`/`[1292]`), which then moves
 * by `[1290]`/`[1294]`, whose sign flips once `|off| >= 0x1E`. */
function sprayOffset(car, ctx, offField, stepField, fixed) {
  if (ctx.round !== 2) return fixed
  const old = car[offField]
  car[offField] = old + car[stepField]
  if (Math.abs(car[offField]) >= 0x1e) car[stepField] = -car[stepField]
  return old
}

function spawnPuff(car, ctx, set) {
  const a = spawnPoint(car, sprayOffset(car, ctx, 'puffOffA', 'puffOffB', -0x1e))
  const b = spawnPoint(car, sprayOffset(car, ctx, 'puffOffC', 'puffOffD', 0x1e))
  const slot = car.puffSlots[car.puffSlotCursor]
  slot.xA = a.x; slot.yA = a.y
  slot.xB = b.x; slot.yB = b.y
  slot.frame = 0
  slot.source = set
  car.puffSlotCursor++
  if (car.puffSlotCursor > 7) car.puffSlotCursor -= 7 // 1000:82ab: skips slot 0 after the first cycle -- bug-for-bug, see docs/engine.md §9q
}

/** Advances every live slot one frame (`80F5-8109` / `83CB-83DF`), frame `max` -> -1. */
function advanceFrames(slots, maxFrame) {
  for (const slot of slots) {
    if (slot.frame === -1) continue
    slot.frame++
    if (slot.frame >= maxFrame) slot.frame = -1
  }
}

/** Call once per car per drawn step, from the render (`step.js` `renderPass`): the cooldowns are the
 * ones the previous step's `7429` (`airborne.js`) left. The real order (`DrawRaceCarLayer 7D01`): the splash `8386` first, then the puffs `8083`
 * (docs/engine.md §9ch). */
export function updatePuffsAndSplashes(car, ctx) {
  // 8386: with the cursor [1298] nonzero (838D), the live splash frames advance on the PUFF
  // cooldown [12B2] (83CB); a spawn needs the trigger and the splash cooldown [12B4] <= 0, and
  // always writes slot 0 (8410-8418) -- the cursor only walks, gating this loop.
  if (car.splashSlotCursor > 0 && toI16(car.puffCooldown) <= 0) advanceFrames(car.splashSlots, SPLASH_ANIM_FRAMES)
  if (car.splashTrigger && toI16(car.splashCooldown) <= 0) {
    car.splashCooldown = 6 // 83FC
    car.splashTrigger = 0 // 8402
    const slot = car.splashSlots[0]
    slot.x = car.posX
    slot.y = car.posY
    slot.frame = 0
    car.splashSlotCursor++
    if (car.splashSlotCursor > 4) car.splashSlotCursor -= 4 // 841E-842A
  }

  // 8083: with the cursor [1296] nonzero (808A), the live puff frames advance when [12B2] <= 0
  // (80F5) -- BEFORE any spawn; then, on an expired cooldown only, [12B2]=3 whether or not anything
  // spawns (8125), and the trigger chain: low grip (a moving car only -- a stopped one spawns
  // nothing and tries no other trigger, 8151), then skid, then wet.
  if (car.puffSlotCursor > 0 && toI16(car.puffCooldown) <= 0) advanceFrames(car.puffSlots, PUFF_ANIM_FRAMES)
  if (toI16(car.puffCooldown) > 0) return // 811B
  car.puffCooldown = 3
  if (car.lowGripTimerA !== 0) {
    if (car.velX === 0 && car.velY === 0) return
    spawnPuff(car, ctx, PUFF_SET.MUD)
  } else if (car.puffSrcSkid) {
    car.puffSrcSkid = 0
    spawnPuff(car, ctx, PUFF_SET.SKID)
  } else if (car.puffSrcWet) {
    car.puffSrcWet = 0
    spawnPuff(car, ctx, PUFF_SET.WET)
  }
}
