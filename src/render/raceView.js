// The race compositor (PLAN-ENGINE.md D5, M3.2): `RenderRaceFrameToBackBuffer 1000:90c5`'s draw
// order — base tiles, then per car: shadow, splash, puff, projectile, body (docs/engine.md §9q,
// `DrawRaceCarLayer 1000:7ce0`'s own 4-pass loop), then overlay tiles, then the HUD
// (docs/track-graphics.md "Race frame composition"). A new module, not a call into
// `formats/race.js`'s `renderTrack()`: that function draws overlays with the base pass and has no
// per-car layer, which is fine for the static `npm run live` check (no car sits under a rack in
// that one reference frame) but wrong for a race in motion.
//
// The tile layer is windowed and toroidal (tile + in-tile-pixel lookup per destination pixel, wrap
// at WORLD_TILES), not a pre-rendered 3072×3072 image — this is the "17×14 tiles at
// (16−(camX&15), 16−(camY&15)), sub-4 remainder applied at VRAM-copy time" of the real game,
// collapsed into direct per-pixel addressing since we have no tile-aligned back buffer to shift.
//
// HUD (`8dfc`/`903f`/`9076`, docs/engine.md §9o/§9p): `./hud.js` implements 8dfc's three branches
// (dispatched below exactly as `8dfc` itself does -- round 9 checked before race format; the
// one-player Head-to-Head never actually reaches the round-9 bonus race, 1A82 is Challenge-only,
// docs/engine.md §9am). All three are wired: `drawHud` (four-car), `drawRuffTruxCountdown` (round 9)
// and `drawTwoCarHud` (the two-car light bar, fed by `src/engine/twocar.js`'s match score, with the
// two-car banners drawn right after it, §9am). `9076` (the in-world floating "1st".."4th" label above a car that
// has finished, docs/engine.md §9ah) is drawn per car by `drawPositionLabel`, from the car layer.

import { TILE, TILE_BYTES, WORLD_TILES, WORLD_PX, OVERLAY_TILE_DELTA, tileCount, remapCarColours, ph0TailIcon, ph0PuffFrame, ph0Round2SplashFrame, ph0Banner, ph0PositionLabel, ph0KnockoutFrame } from '../formats/race.js'
import { blitTransparent, blitSilhouette } from './blit.js'
import { drawHud, drawRuffTruxCountdown, drawTwoCarHud } from './hud.js'
import { RELOAD_TOTAL, FLIGHT_THRESHOLD } from '../engine/projectile.js'
import { KNOCKOUT_DURATIONS, KNOCKOUT_FRAME_IDS, STATE1_ANIM_A, STATE1_ANIM_B, STATE1_ANIM_DEFAULT, STATE1_ANIM_ROUND2, FALL_ANIM, CRASH_ANIM } from '../data/engine-tables.js'
import { viewCoord, inClipWindow, NORMAL_CAR_FOLD, ROUND9_CAR_FOLD } from '../engine/drawn.js'

// The car body/shadow's own real fold parameters (7d73/7e5c, docs/engine.md §9d), shared with
// `engine/drawn.js`'s already-live-proven `markDrawn` so the -12/-4 literals live in one place.
const carFoldParams = (round) => (round === 9 ? ROUND9_CAR_FOLD : NORMAL_CAR_FOLD)

const wrap = (v, m) => ((v % m) + m) % m
/** Shortest signed delta from b to a on a ring of size m (e.g. world-px distance across the wrap). */
const wrapDelta = (d, m) => { const r = wrap(d, m); return r > m / 2 ? r - m : r }

function tileWordAt(words, tx, ty) {
  return words[wrap(ty, WORLD_TILES) * WORLD_TILES + wrap(tx, WORLD_TILES)]
}

/**
 * Rounds 1/3/5 only: tile 0's own bitmap genuinely scrolls at HALF camera speed (`1000:8996`,
 * `mm-re-player-visible` 2026-09-23, docs/engine.md §9al) -- a real per-frame rewrite of the live
 * tile bank's slot 0, not a coordinate offset. `dx`/`dy` advance only every 2 camera pixels and
 * wrap every 32, so the pattern scrolls one full 16px tile-width for every 32px the camera travels.
 * Writes into `bank[0..TILE_BYTES)` **in place**, reading from `pristineTile0` (a copy of that same
 * slot's ORIGINAL bytes, captured once at load before any frame could have shifted it) -- matching
 * the real game's own live buffer rewrite exactly. Safe to call every frame regardless of pause/
 * smoothness cadence: unlike the rotor/banner counters, this has no persistent state of its own --
 * it's a pure function of the current camera position, always idempotent for a given (camX, camY),
 * so it needs no game-loop hook and cannot drift.
 */
export function applyTile0Parallax(bank, pristineTile0, camX, camY) {
  const dx = (camX & 0x1f) >> 1 // camera.x/y are already non-negative world coordinates here
  const dy = (camY & 0x1f) >> 1
  for (let row = 0; row < TILE; row++) {
    const destRow = (row + dy) & 15
    for (let col = 0; col < TILE; col++) {
      const destCol = (col + dx) & 15
      bank[destRow * TILE + destCol] = pristineTile0[row * TILE + col]
    }
  }
}

/**
 * Round 2 only: a fixed-world-position background water-shimmer (`1000:89e0`, docs/engine.md
 * §9al) -- a genuine word-map rewrite, no coordinate trick, at world px (1584-1647, 2896-2959)
 * (grid row 181-184, col 99-102), off the drivable surface. Cycles through 4 consecutive 16-tile
 * blocks of the tile bank (base 0/16/32/48, tiles 0-63) every 4 rendered frames, in raster order
 * within each 4x4 patch. No per-race gate -- fires in all 4 of round 2's races, including ROUND21
 * (index.html's own default race), unconditionally overwriting whatever was baked there. `counter`:
 * the shared per-race tile-anim tick (see `applyTile0Parallax`'s own cadence note -- advanced from
 * the game loop's smoothness draw-gate, not here).
 */
export function applyRound2WaterAnim(words, counter) {
  const base = ((counter >> 2) & 3) * 16
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) words[(181 + r) * WORLD_TILES + (99 + c)] = base + r * 4 + c
  }
}

/**
 * Round 8 (CHOPPERS) only: an animated hazard graphic (spinning fan/gas jet, `1000:8a2b`,
 * docs/engine.md §9al) at map cells the level data reserves for exactly this (`ROUND82`/
 * `ROUND83.MAP` bake the literal placeholder sequence `0 1 2 / 3 4 5 / 6 7 8` at every target
 * spot -- verified against the real files). Race 1 has none at all (the real function returns
 * before even incrementing its counter). Race 2: one 3x3 patch. Race 3: six 3x3 patches (four in
 * one vertical shaft, two more further down -- almost certainly the same graphic repeated up a
 * shaft). All patches share one cycling base (0, 9, 18) over a clean 4-tick-per-phase, 12-tick
 * cycle -- `counter>>2` modulo 3, the same shape `applyRound2WaterAnim` already uses (mod 4
 * there). **Simplified from one real quirk the RE pass found**: the real register self-wraps to 0
 * the instant its own phase reaches 3, adding one single-tick "blip" at base 0 every 13th tick
 * rather than a clean 12-tick repeat -- reproducing that exactly would mean this render-only
 * function writing back into the shared counter the game loop owns, breaking the same
 * render-must-not-mutate-timing-state principle the rotor counter's own earlier bug (docs/engine.md
 * §9aj) was fixed to uphold. Judged not worth that coupling for a one-tick-in-thirteen cosmetic
 * difference on a hazard-graphic animation; flagged here rather than silently matched.
 */
export function applyRound8HazardAnim(words, counter, race) {
  if (race === 1) return
  const base = [0, 9, 18][(counter >> 2) % 3]
  const patch = (row0, col0) => {
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) words[(row0 + r) * WORLD_TILES + (col0 + c)] = base + r * 3 + c
  }
  if (race === 2) {
    patch(68, 18)
  } else if (race === 3) {
    patch(62, 90); patch(68, 90); patch(80, 90); patch(86, 90)
    patch(104, 90); patch(110, 90)
  }
}

/** Base (non-overlay) tile layer for the w×h window whose top-left is world pixel (camX, camY). */
export function drawTileBase(dst, w, h, words, bank, camX, camY) {
  const n = tileCount(bank)
  for (let y = 0; y < h; y++) {
    const wy = camY + y
    const ty = Math.floor(wy / TILE), oy = wrap(wy, TILE)
    const row = y * w
    for (let x = 0; x < w; x++) {
      const wx = camX + x
      const tx = Math.floor(wx / TILE), ox = wrap(wx, TILE)
      const idx = tileWordAt(words, tx, ty) & 0x7fff
      dst[row + x] = idx < n ? bank[idx * TILE_BYTES + oy * TILE + ox] : 0
    }
  }
}

/** Re-draw the `idx+12` variant transparently over whatever's already there (cars included) — 1000:9214. */
export function drawTileOverlay(dst, w, h, words, bank, camX, camY) {
  const n = tileCount(bank)
  for (let y = 0; y < h; y++) {
    const wy = camY + y
    const ty = Math.floor(wy / TILE), oy = wrap(wy, TILE)
    const row = y * w
    for (let x = 0; x < w; x++) {
      const wx = camX + x
      const tx = Math.floor(wx / TILE), ox = wrap(wx, TILE)
      const word = tileWordAt(words, tx, ty)
      if (!(word & 0x8000)) continue
      const idx = (word & 0x7fff) + OVERLAY_TILE_DELTA
      if (idx >= n) continue
      const p = bank[idx * TILE_BYTES + oy * TILE + ox]
      if (p) dst[row + x] = p
    }
  }
}

/**
 * One car's body + airborne shadow (docs/track-graphics.md "Vehicles": shadow at (x+z,y+z), body at
 * (x-z,y-z), airborne only). `frames` is `vehicleFrames(vh0, round).frames` (32 rotation frames, 9
 * for round 9 — round 9's 40×40/no-mirroring case is not specially handled here yet).
 *
 * Screen anchor — **UNKNOWN_car_draw_anchor resolved 2026-09-23, `[STATIC]` by disassembly**
 * (docs/engine.md §9d/§10; `DrawCarBodyRotatedRemapped 1000:7d73`, `DrawCarShadowSilhouette
 * 1000:7e5c`): both share the SAME base anchor `(posX-camX, posY-camY)` (`SUB DI,[264A]`/`SUB
 * AX,[264C]` off `[BX+125C]`(posX)/`[BX+1268]`(posY) — plain subtraction, camera globals hold no
 * extra baked-in offset beyond what `docs/engine.md §3`'s `camHalfW`/`camHalfH` target formula
 * already establishes); the body then subtracts a literal half-box (`7e1f SUB AX,0xc` / `7e22 SUB
 * DI,0xc` = 12 = 24/2, confirmed an independent hand-authored literal, not `width>>1` computed at
 * runtime — same shape as the §9q pause-banner literal) AND the (unclamped, signed) height `z`
 * (`SUB DI,DX`/`SUB AX,DX`); the shadow subtracts the same half-box but ADDS z (`7ede`/`7ee1 SUB
 * ...,0xc` then `7e69/7e6b ADD DI/AX,DX`) — confirming this port's prior `dx-half-z` (body) /
 * `dx-half+z` (shadow) guess exactly, literal-for-literal. Round 9's 40×40 car-0 path (`7db5`
 * body / `7e8a` shadow) uses 20 = 40/2 for the same subtraction (`7ddd/7de0`, `7eb2/7eb5`) — the
 * independent cross-check this item asked for, and it also scales with size.
 *
 * Two real divergences from the port's prior code (not the anchor formula, but the same z/shadow
 * territory this item covers) were found alongside it and fixed here:
 *  - **Round 8 (CHOPPERS)**: the body forces z=0 (`7d85 CMP [28BF],0x8 / JZ 7d90` skips loading DX
 *    from height, leaving it 0) and the shadow function returns immediately without drawing at all
 *    (`7e77 CMP [28BF],0x8 / JZ 7ef8`) — CHOPPERS separately gets a round-8-only 32×32 extra
 *    animation (`7d73`'s own `7e4f CALL 843d` = `DrawRound8ExtraAnim32`, `DS:5EE3` -- confirmed
 *    inside `DrawCarBodyRotatedRemapped` itself, not a separate `DrawRaceCarLayer`, by `get_xrefs_to`
 *    plus an independent whole-image `CALL 843d` search, M3.44 -- see docs/engine.md §9d,
 *    gated on state ∉ {0xD, 2}); what it actually draws is not traced further and it is not
 *    ported here (new, narrower open item, not this one) — nothing in the bytes says it's a
 *    shadow substitute, that would be an inference, not a finding.
 *  - **Height is never clamped to ≥0 in the draw itself**: both `7d83-7d8c` (body) and `7e5d`
 *    (shadow) load the raw signed `[BX+12D6]` height with no sign check anywhere in either
 *    function — a briefly-negative height (docs/engine.md §3's bounce-landing tick, the `[12D8]`
 *    branch of `UpdateCarAirborneLandingSfx 7429` that reflects `zVel` but leaves `z` itself
 *    negative for that one tick) shifts the body the OPPOSITE way for that tick, not clamped to a
 *    flat 0 as this port's old `Math.max(0,height)` assumed. The shadow's own draw gate is
 *    likewise `height != 0` (`7ce3-7cef`'s outer `CMP [BX+12D6],0x0 / JZ`, an exact-zero test), not
 *    `height > 0` — a negative-height tick still shows a (shifted) shadow in the real game.
 * `tools/check-play.mjs`'s `checkCarDrawAnchor` pins all of this (round-8 suppression, unclamped
 * negative z on both body and shadow) against the OLD formula first, so a revert fails loudly.
 */
export function drawCar(dst, w, h, camX, camY, frames, size, car, round) {
  drawCarShadow(dst, w, h, camX, camY, frames, size, car, round)
  drawCarBody(dst, w, h, camX, camY, frames, size, car, round)
}

function carFrame(frames, heading) {
  const h8 = wrap(Math.round(heading ?? 0), 256)
  return frames[h8 >> 3]
}

/** Shadow only (`DrawCarShadowSilhouette 1000:7e5c`) -- split out of `drawCar` so `drawCarLayer`
 * can interleave the splash/puff/projectile passes between shadow and body, matching the real
 * paint order (docs/engine.md §9q): shadow -> splash -> puff -> projectile -> body. `round`:
 * CHOPPERS (round 8) never draws a shadow at all (`7e77`, see `drawCar`'s header). */
function drawCarShadow(dst, w, h, camX, camY, frames, size, car, round) {
  if (round === 8) return
  const frame = carFrame(frames, car.heading)
  const z = car.height ?? 0
  if (!frame || z === 0) return
  // `7e5c`'s own fold: height is ADDED before the camera subtraction and the one-sided +0xC00 fold
  // (opposite sign from the body, same threshold/offset pair) -- not a symmetric wrapDelta
  // (docs/engine.md §9d, `UNKNOWN_car_draw_wrap_asymmetry`).
  const half = size >> 1
  const threshold = carFoldParams(round).threshold
  const dx = viewCoord(car.posX + z - camX, threshold, half)
  const dy = viewCoord(car.posY + z - camY, threshold, half)
  blitSilhouette(dst, w, h, dx, dy, { width: size, height: size, indexed: frame })
}

/** Body only (`DrawCarBodyRotatedRemapped`). `round`: CHOPPERS (round 8) forces z=0 (`7d85`, see
 * `drawCar`'s header) -- every other round uses the raw signed height, unclamped.
 * @returns {boolean} whether `7d73`'s own clip test (`8bab`, the REAL 256x224 window, not this
 * destination canvas's own possibly-narrower one) passed this exact call -- the fresh, per-render
 * signal `drawCarLayer` gates the round-8 rotor on (docs/engine.md §9d): 7D73's real rotor call sits
 * behind this SAME clip test in the SAME function call, using this tick's own camera/position, not
 * behind the separate, state-gated `car.drawnThisFrame` sticky flag `engine/drawn.js` maintains for
 * physics-side readers (sfx/rubber-band/fire-gate) on a different cadence. */
function drawCarBody(dst, w, h, camX, camY, frames, size, car, round) {
  const { posX, posY, heading = 0, height = 0, colourOffset = 0 } = car
  const frame = carFrame(frames, heading)
  if (!frame) return false
  const half = size >> 1
  const z = round === 8 ? 0 : height
  // `7d73`'s own fold: height subtracted BEFORE the camera subtraction and the one-sided +0xC00
  // fold, not a symmetric wrapDelta (docs/engine.md §9d, `UNKNOWN_car_draw_wrap_asymmetry`): a car
  // near the world seam from the positive side never crosses the real threshold, so it stays
  // unfolded and off-screen, matching the real game rather than the torus-shortest-path reading.
  const { threshold, size: foldSize } = carFoldParams(round)
  const visible = inClipWindow(posX - z - camX, posY - z - camY, threshold, half, foldSize)
  const dx = viewCoord(posX - z - camX, threshold, half)
  const dy = viewCoord(posY - z - camY, threshold, half)
  // Round 9's own body blit is `BlitSpriteTransparentRace 8ca4` (plain colour-0-transparent, no
  // remap) not `BlitSpriteCarColourRemapRace 8c6a` -- confirmed by disassembly, and it never loads
  // the colour-offset operand before drawing either (`mm-re-player-visible` 2026-09-23,
  // docs/engine.md §9ak). No visible effect today (car 0's own static colourOffset is 0, so the
  // remap below is already an identity op for the one car round 9 ever draws), but skipped here to
  // match the real bytes exactly rather than rely on that coincidence.
  const body = round === 9 ? frame : remapCarColours(frame, colourOffset)
  blitTransparent(dst, w, h, dx, dy, { width: size, height: size, indexed: body })
  return visible
}

const PUFF_ICON_HALF = 4 // 8x8 puffs are centred on their spawn point (1000:8712/8cd0 both do AX-=4/DI-=4)

/** One car's puffs + splash (`DrawWheelEffectPuffs 1000:8083`, `FUN_1000_8386 1000:8386`), docs
 * §9q. Reads `car.puffSlots`/`car.splashSlots` (already spawned/animated by `engine/puffs.js`
 * every physics step) -- this function only draws, it never mutates trigger/slot state. */
function drawPuffsAndSplashes(dst, w, h, camX, camY, ph0, car) {
  for (const slot of car.splashSlots ?? []) {
    if (slot.frame === -1) continue
    const dx = wrapDelta(slot.x - camX, WORLD_PX)
    const dy = wrapDelta(slot.y - camY, WORLD_PX)
    const frame = ph0Round2SplashFrame(ph0, slot.frame)
    blitTransparent(dst, w, h, dx - 16, dy - 16, frame)
  }
  for (const slot of car.puffSlots ?? []) {
    if (slot.frame === -1) continue
    const frame = ph0PuffFrame(ph0, slot.source ?? 0, slot.frame)
    const ax = wrapDelta(slot.xA - camX, WORLD_PX), ay = wrapDelta(slot.yA - camY, WORLD_PX)
    blitTransparent(dst, w, h, ax - PUFF_ICON_HALF, ay - PUFF_ICON_HALF, frame)
    const bx = wrapDelta(slot.xB - camX, WORLD_PX), by = wrapDelta(slot.yB - camY, WORLD_PX)
    blitTransparent(dst, w, h, bx - PUFF_ICON_HALF, by - PUFF_ICON_HALF, frame)
  }
}

const IMPACT_FRAME_TABLE = [0, 1, 2, 3, 4, 5, 4, 3, 2, 1, 0] // CS:8780, keyed by (reloadCooldown-0x1e)
const IMPACT_FLOOR = 0x1e // 30

/** One car's active shot (`FUN_1000_8712 1000:8712`), docs §9q. Two phases keyed on the single,
 * physics-only `reloadCooldown` this port uses (see engine/projectile.js's own header): while
 * cooldown is still in the flight window, a small flying icon (2 of PH0's 5 tail icons, plus a
 * black shadow-trail silhouette offset by the decaying projStepsA/B); for the ~10 ticks after,
 * a symmetric grow-then-shrink impact puff reusing the skid-dust bank; below that, nothing. */
function drawProjectile(dst, w, h, camX, camY, ph0, car) {
  if (!car.projActive) return
  const dx = wrapDelta(car.projX - camX, WORLD_PX)
  const dy = wrapDelta(car.projY - camY, WORLD_PX)
  if (car.reloadCooldown > FLIGHT_THRESHOLD) {
    const elapsed = RELOAD_TOTAL - car.reloadCooldown
    const icon = ph0TailIcon(ph0, elapsed >= 2 ? 1 : 0)
    const sx = wrapDelta(car.projX + car.projStepsA - camX, WORLD_PX)
    const sy = wrapDelta(car.projY + car.projStepsB - camY, WORLD_PX)
    blitSilhouette(dst, w, h, sx - 4, sy - 4, icon)
    blitTransparent(dst, w, h, dx - 4, dy - 4, icon)
  } else if (car.reloadCooldown >= IMPACT_FLOOR) {
    const frame = IMPACT_FRAME_TABLE[car.reloadCooldown - IMPACT_FLOOR]
    blitTransparent(dst, w, h, dx - 4, dy - 4, ph0PuffFrame(ph0, 1, frame))
  }
}

/**
 * Per-tick body-visibility + overlay-frame decision for the state-2/0xD/1/4/5 animation family
 * (`82BE`/`880A`/`7F62`/`7EFA`, `mm-re-player-visible` 2026-09-23, docs/engine.md §9aj). Pure and
 * read-only: `animStep`/`animTimer`/`driftSteps` are already owned and advanced by
 * `engine/states.js`'s own physics-side handlers (`stepKnockoutAnim`/`stepHazardDeath`/
 * `stepFallAnim`/`stepCrashAnim`) -- this only re-derives, from those same fields, the identical
 * per-tick draw decision the real functions make every render, without mutating `car`. Returns
 * `{drawBody, overlay}`, `overlay` either `null` or `{source: 'knockout'|'bank2', frame}`.
 */
export function carAnimationFrame(car, round) {
  const state = car.state
  if (state === 2 || state === 0xd) {
    // 82BE: the step this tick's handler drew (states.js `stepKnockoutAnim` keeps it before its own
    // advance), else the cursor [12B8] itself.
    const idx = car._koDrawStep ?? car.animStep2 ?? 0
    if (KNOCKOUT_FRAME_IDS[idx] === undefined || KNOCKOUT_FRAME_IDS[idx] === 0xffff) return { drawBody: true, overlay: null } // already transitioned; safe fallback
    const drawBody = state === 2 ? idx >= 3 : idx <= 3 // state 2: last 3 of 6 steps; state 0xD: first 4
    const frame = KNOCKOUT_FRAME_IDS[idx]
    return { drawBody, overlay: frame >= 0 && frame <= 4 ? { source: 'knockout', frame } : null }
  }
  if (state === 1) {
    // 880A's own heading-oscillation sub-phase (rounds 4/9 only): a pure body-only tick, no table
    // lookup at all, and -- matching the real bytes -- NOT gated on driftSteps (re-derived from the
    // same heading/bucket test `states.js`'s stepHazardDeath uses to decide whether to even reach
    // the table, read-only here).
    if (round === 4 || round === 9) {
      const bucket = (car.heading ?? 0) & 0xf8
      if (bucket !== 0 && bucket !== 0x80) return { drawBody: true, overlay: null }
      if (car.driftSteps) return { drawBody: true, overlay: null }
      return tableOverlay(bucket === 0 ? STATE1_ANIM_A : STATE1_ANIM_B, car.animStep ?? 0)
    }
    if (car.driftSteps) return { drawBody: true, overlay: null }
    return tableOverlay(round === 2 ? STATE1_ANIM_ROUND2 : STATE1_ANIM_DEFAULT, car.animStep ?? 0)
  }
  if (state === 4) {
    if (car.driftSteps) return { drawBody: true, overlay: null }
    return tableOverlay(FALL_ANIM, car.animStep ?? 0)
  }
  if (state === 5) {
    if (car.driftSteps) return { drawBody: true, overlay: null }
    return tableOverlay(CRASH_ANIM, car.animStep ?? 0)
  }
  return { drawBody: true, overlay: null }
}

/** States 1/4/5's shared table-walk draw rule (`7FE8`/`8034`'s own dispatch): the body is NEVER
 * drawn on this path -- only the table-selected VH0-second-bank overlay, or nothing at all for a
 * `-2` ("tick only, no draw this frame") table entry. The body-only branches in
 * `carAnimationFrame` above are the sole place these three states draw the car's own body sprite. */
function tableOverlay(table, step) {
  const frame = table.frames[step] ?? -1
  if (frame < 0) return { drawBody: false, overlay: null } // -2 (tick-only) or -1 (terminal, shouldn't render)
  return { drawBody: false, overlay: { source: 'bank2', frame } }
}

/** `DrawPh0KnockoutAnimFrame 1000:8339` -- states 2/0xD's overlay, composited ON TOP of the body
 * (drawn first, when `carAnimationFrame` says to). Anchor is `car.knockoutX`/`knockoutY`
 * (`[BX+0x12BA]`/`[0x12BC]`) -- the position SNAPSHOTTED at the moment this state was entered, an
 * already-existing, already-tested `CarRecord` field pair (`car.js`, written by every real
 * transition site: `checkpoints.js`, `collide.js`, `airborne.js`, `projectile.js`, and now
 * `states.js`'s own `stepRespawn`, a real gap this pass closed alongside adding the draw -- NOT
 * `car.posX`/`posY` directly, which can drift after entry (a state-2 car can still be pushed by a
 * car-car hit, `mm-re-player-visible` 2026-09-23, docs/engine.md §9aj). Anchor includes the SAME
 * z/height offset the body draw applies (`[BX+0x12D6]`, read unconditionally here -- no round-8
 * z-zeroing exception: that's specific to `7d73`'s own body anchor, a different function), unlike
 * the states-1/4/5 overlay below which has no z term at all. Colour-0-transparent, NO car-colour
 * remap (confirmed at the instruction level: `BlitSpriteTransparentRace`, not the
 * `...ColourRemap...` variant). */
function drawKnockoutOverlay(dst, w, h, camX, camY, ph0, car, frame) {
  const z = car.height ?? 0
  const dx = wrapDelta((car.knockoutX ?? car.posX) - camX, WORLD_PX) - z
  const dy = wrapDelta((car.knockoutY ?? car.posY) - camY, WORLD_PX) - z
  blitTransparent(dst, w, h, dx - 12, dy - 12, ph0KnockoutFrame(ph0, frame))
}

/** `DrawSprite24FromSecondBank 1000:7FE8` / `DrawSprite40FromSecondBank 1000:8034` -- states 1/4/5's
 * overlay, read from the round's own VH0 "second bank" (`vehicleFrames`'s `bank2`, already the same
 * buffer segment `6D78` is split into at load time -- no new file parsing needed). No z offset.
 * Round 9's 5-frame second bank folds frame ids >4 back into 0-4 (`8034`'s own `if SI>4: SI-=5`);
 * every other round indexes its 12-frame bank2 directly. Car-colour remap DOES apply here (nibbles
 * 1/2 only, `remapCarColours`'s existing rule -- confirmed at the instruction level to be the exact
 * same mask the body's own `8C6A` blitter uses), unlike the knockout overlay above. */
function drawBank2Overlay(dst, w, h, camX, camY, bank2, size, round, car, frame) {
  const folded = round === 9 && frame > 4 ? frame - 5 : frame
  const buf = bank2?.[folded]
  if (!buf) return
  const dx = wrapDelta(car.posX - camX, WORLD_PX)
  const dy = wrapDelta(car.posY - camY, WORLD_PX)
  const half = size >> 1
  const body = remapCarColours(buf, car.colourOffset ?? 0)
  blitTransparent(dst, w, h, dx - half, dy - half, { width: size, height: size, indexed: body })
}

/** `DrawRound8ExtraAnim32 1000:843d` -- CHOPPERS (round 8) only. Read-only: `car.rotorFrame` is
 * advanced by `engine/drawn.js`'s `markDrawn` (its real `INC` at `8470` runs only when this car's
 * body passed `7D73`'s clip test that render, docs/engine.md §9cb) -- never here, so a paused
 * repaint doesn't spin it (docs/engine.md §9aj).
 * Gated on state NOT in {2, 0xD} (the body still draws through the knockout/reappear animation's
 * OTHER steps; the rotor specifically doesn't). No z/height offset at all -- round 8's body already
 * forces z=0 (`drawCar`'s own header) -- centred 32×32 on the car's raw world position, 8px larger
 * than the 24×24 body on every edge. Frame = `(rotorFrame>>1)&3` -- only 4 of the 5 stored frames
 * are ever reachable this way. */
function drawRotor(dst, w, h, camX, camY, rotorFrames, car) {
  if (!rotorFrames || car.state === 2 || car.state === 0xd) return
  // 843D-8464 + 8486-8489: v = pos - camera - 4, folded by +0xC00 when <= -12, then -12 -- its own
  // fold, 4px later than the body's (docs/engine.md §9cb): at pos - camera = -11..-8 the body draws at
  // the edge but the rotor is folded 3072px away and doesn't.
  const x = viewCoord(car.posX - camX - 4, -12, 12)
  const y = viewCoord(car.posY - camY - 4, -12, 12)
  const frame = rotorFrames[((car.rotorFrame ?? 0) >> 1) & 3]
  blitTransparent(dst, w, h, x, y, frame)
}

/** Shadow -> splash -> puff -> projectile -> body/overlay -> rotor, the real paint order (docs
 * §9q/§9aj). `ph0`: the unpacked BITSFILE.PH0 bytes, needed for puffs/splashes/projectiles and the
 * states-2/0xD overlay -- omit to skip all four, which still draws the car body/shadow exactly as
 * before. `round`: CHOPPERS (round 8) z/shadow special-case, see `drawCar`'s header, also needed
 * for the states-1/4/5 overlay's table/fold selection. `rotorFrames`: round 8's own 5×32×32 rotor
 * frames (`vehicleFrames`'s return, null for every other round) -- omit to skip the rotor. `bank2`:
 * the round's own VH0 second bank (`vehicleFrames`'s return), needed for the states-1/4/5 overlay
 * -- omit to skip it, drawing (or not, per `carAnimationFrame`'s own body-visibility call) only the
 * body/shadow for those states, same as before this system existed. */
function drawCarLayer(dst, w, h, camX, camY, frames, size, ph0, car, round, rotorFrames, bank2, hideBody = false) {
  drawCarShadow(dst, w, h, camX, camY, frames, size, car, round)
  if (ph0) {
    drawPuffsAndSplashes(dst, w, h, camX, camY, ph0, car)
    drawProjectile(dst, w, h, camX, camY, ph0, car)
  }
  const anim = carAnimationFrame(car, round)
  // 7D74: the two-car car [2621] names gets no body (only 7D73's body draw is gated; shadow, puffs,
  // projectiles and overlays still draw). `bodyDrawnNow`: false whenever this state doesn't call
  // 7D73 at all this tick (no fresh clip test ran, matching the real bytes -- neither the body nor
  // the rotor can draw then) or the clip test it ran failed.
  let bodyDrawnNow = false
  if (anim.drawBody && !hideBody) bodyDrawnNow = drawCarBody(dst, w, h, camX, camY, frames, size, car, round)
  if (anim.overlay) {
    if (anim.overlay.source === 'knockout' && ph0) drawKnockoutOverlay(dst, w, h, camX, camY, ph0, car, anim.overlay.frame)
    else if (anim.overlay.source === 'bank2' && bank2) drawBank2Overlay(dst, w, h, camX, camY, bank2, size, round, car, anim.overlay.frame)
  }
  // `7d73`'s own rotor call (`7e4f`) is reached only by falling through the SAME body clip test in
  // the SAME function call (`7e28 JC 7e54` jumps clean past the body draw AND the rotor call
  // together when the clip fails) -- confirmed by the same fresh disassembly as the wrap-fold fix
  // above. Gated on `bodyDrawnNow` (computed fresh, this call, this tick's camera/position) rather
  // than the separate, state-gated `car.drawnThisFrame` sticky flag `engine/drawn.js` maintains for
  // physics-side readers on a different cadence -- reusing that flag here would have been wrong in
  // its own right (a stale value from a tick where this state didn't call `markDrawn` at all), not
  // just a coincidental mismatch found while re-measuring reachability (docs/engine.md §9d).
  if (round === 8 && bodyDrawnNow) drawRotor(dst, w, h, camX, camY, rotorFrames, car)
}

/**
 * `DrawCarRacePositionLabel 1000:9076` (docs/engine.md §9ah): the floating "1st".."4th" label the
 * original shows over a car once it has finished -- the game's own "you finished" cue. Called from
 * `DrawRaceCarLayer` (7d49-7d65) right after that car's body, only when the class is not 9, the
 * race is four-car, and either [26C6] >= 2 or this car's own `lapsRemaining` is exactly 0. Placed at
 * (posX - height - 8, posY - height - 20) relative to the camera with the raw signed height
 * (9084-9097, no round-8 z override), wrapped like the car body, and blitted colour-0-transparent
 * (8ca4). Reads `racePosition` as the last ranking left it (one frame stale in the original too).
 */
export function drawPositionLabel(dst, w, h, camX, camY, ph0, car) {
  const pos = car.racePosition
  if (!(pos >= 1 && pos <= 4)) return
  const z = car.height ?? 0
  const dx = wrapDelta(car.posX - camX, WORLD_PX)
  const dy = wrapDelta(car.posY - camY, WORLD_PX)
  blitTransparent(dst, w, h, dx - z - 8, dy - z - 20, ph0PositionLabel(ph0, pos - 1))
}

/**
 * DEV overlay, not original-game art (docs/engine.md §9ah): marks where a lap counts with a 4-px
 * chequered strip centred on each `engine/lapLine.js` segment (a 96-px cell edge), 4x4 squares
 * alternating `lapLine.colours[0]`/`[1]` (palette indices the caller picked from the round's own
 * palette). A crossing that registers through a row of 0-progress cells (`viaZero`) is drawn dashed.
 */
export function drawLapLine(dst, w, h, camX, camY, lapLine) {
  const [light, dark] = lapLine.colours
  for (const seg of lapLine.segments) {
    const ox = wrapDelta(seg.x - camX, WORLD_PX)
    const oy = wrapDelta(seg.y - camY, WORLD_PX)
    for (let along = 0; along < 96; along++) {
      const square = along >> 2
      if (seg.viaZero && (square & 1)) continue
      for (let across = -2; across < 2; across++) {
        const x = seg.horizontal ? ox + along : ox + across
        const y = seg.horizontal ? oy + across : oy + along
        if (x < 0 || y < 0 || x >= w || y >= h) continue
        dst[y * w + x] = ((square + (across < 0 ? 0 : 1)) & 1) ? dark : light
      }
    }
  }
}

/**
 * `camera`: {x,y} world-pixel top-left of the view. `frames`: shared vehicle rotation frames for
 * this round (all cars recolour the same graphic via `colourOffset` — `formats/race.js` `vehicleFrames`).
 * `rotorFrames`: CHOPPERS' (round 8) own 5×32×32 rotor frames, same source (`vehicleFrames`'s
 * `rotorFrames` field, null for every other round) -- omit to skip the rotor overlay, drawing round
 * 8 like any other round (docs/engine.md §9aj).
 * `bank2`: the round's own VH0 "second bank" (`vehicleFrames`'s `bank2` field) -- needed to draw
 * the states-1/4/5 (hazard-death/fall/crash) animation overlay; omit to skip just that overlay
 * (states 2/0xD's own PH0 overlay only needs `ph0`, independent of this) (docs/engine.md §9aj).
 * `pristineTile0`: rounds 1/3/5 only, tile 0's own ORIGINAL 256-byte bitmap, captured once at load
 * (before any frame could have shifted it) -- needed for the half-camera-speed parallax scroll
 * (`applyTile0Parallax`, docs/engine.md §9al); omit to draw tile 0 static, like every other round.
 * **Mutates `bank`'s own tile-0 slot in place** when given (matching the real game's own live
 * tile-bank rewrite) -- pass a bank you're fine seeing tile-0 overwritten in, same as the real
 * `2B78:0000` buffer.
 * `race`/`tileAnimCounter`: round 2's water-shimmer and round 8's hazard-graphic word-map
 * animations (`applyRound2WaterAnim`/`applyRound8HazardAnim`, docs/engine.md §9al) -- `race` picks
 * round 8's own per-race patch count/positions (defaults to `hud?.race`), `tileAnimCounter` is the
 * shared per-race tick driving both (the caller's own `raceState.tileAnimCounter`, advanced once
 * per rendered frame at the SAME game-loop smoothness draw-gate hook the rotor counter uses --
 * never advanced in here, keeping this function itself free of any timing-state mutation). Omit
 * `race` (or leave `tileAnimCounter` at its default 0) to draw either round static at its own
 * baked map values, like every round did before this system existed. **Also mutates `words` in
 * place** when `round` is 2 or 8, for the same reason `bank` gets mutated above.
 * `WORLD_TILES` (`formats/race.js`): the word-map's own row/column stride these two draw functions
 * index by, independent of `view`'s own pixel size.
 * `cars`: [{posX, posY, heading, height, colourOffset, active, present}], drawn in array order.
 * `view`: {w,h} of the output window (default the real 256×200 race view).
 * `hud`: optional `{ph0, raceFormat, round, ruffTruxTicks, raceOverCount}` -- when given, draws the
 * per-car "1st".."4th" finish labels from the car layer (`drawPositionLabel`, needs `raceOverCount`
 * = [26C6]; BEFORE the overlay tiles, like `7d65` inside `7ce0`, so a bath rack can cover one) and
 * the HUD last, over
 * the finished tile+car+overlay composite, exactly where `RenderRaceFrameToBackBuffer` does (step 5
 * of 5), dispatched in `8dfc`'s own priority order (docs/engine.md §9p): `round===9` draws the
 * RUFFTRUX countdown (needs `ruffTruxTicks`, the live `[26C8]` analogue -- `states.js`'s
 * `raceState.ruffTruxTimer`) regardless of race format; otherwise `raceFormat===2` draws the light
 * bar and this frame's two-car banners (needs `twoCar` = `raceState.twoCar`, `rankOrder` and the
 * banner blink phase `bannerBlink`, docs §9am -- and skips the body of the car `twoCar.hiddenCarLayer`
 * names); otherwise the default four-car HUD. Omit `hud` for callers
 * that don't have `cars` in HUD-ready shape (racePosition set, etc.) or don't want it (e.g. the
 * M3.2 non-regression guard `tools/check-live.mjs` used to run before gaining its own HUD
 * comparison).
 * `ph0`: optional unpacked BITSFILE.PH0 bytes for the car-LAYER effects (puffs, splashes,
 * projectiles -- docs §9q), independent of the HUD (defaults to `hud?.ph0` so a caller that
 * already loaded PH0 for the HUD doesn't need to pass it twice); omit entirely to draw only the
 * car body/shadow, exactly as before this system existed.
 * `round`: the current round number, needed only for CHOPPERS' (round 8) z/shadow special-case
 * (see `drawCar`'s header, `UNKNOWN_car_draw_anchor`'s resolution) -- defaults to `hud?.round` so
 * a caller that already passes it for the HUD doesn't need to pass it twice; omit entirely (both
 * `hud` and `round`) to draw every round like a non-CHOPPERS one, exactly as before this fix.
 * `paused`: draws the "Paused!" banner last, over everything (docs §9q, `engine/pause.js`) --
 * needs `ph0` too, a no-op without it.
 * `lapLine`: optional DEV overlay `{segments, colours}` (`drawLapLine`), drawn over the overlay tiles
 * and under the HUD; null/omitted draws nothing, leaving the frame byte-identical.
 */
export function composeRaceView({ words, bank, camera, frames = [], vehicleSize = 24, rotorFrames = null, bank2 = null, pristineTile0 = null, cars = [], view = { w: 256, h: 200 }, hud = null, ph0 = hud?.ph0 ?? null, round = hud?.round ?? null, race = hud?.race ?? null, tileAnimCounter = 0, paused = false, lapLine = null }) {
  const { w, h } = view
  const indexed = new Uint8Array(w * h)
  if (pristineTile0 && (round === 1 || round === 3 || round === 5)) applyTile0Parallax(bank, pristineTile0, camera.x, camera.y)
  if (round === 2) applyRound2WaterAnim(words, tileAnimCounter)
  else if (round === 8 && race != null) applyRound8HazardAnim(words, tileAnimCounter, race)
  drawTileBase(indexed, w, h, words, bank, camera.x, camera.y)
  const twoCar = hud?.twoCar ?? null
  cars.forEach((car, i) => {
    // car.active/present come from src/engine/car.js's fromBytes() as u16 (0 or 1), not booleans --
    // compare numerically. Absent means "draw it" (the eyeball tool passes bare test cars).
    if ((car.active ?? 1) === 0 || (car.present ?? 1) === 0) return
    drawCarLayer(indexed, w, h, camera.x, camera.y, frames, vehicleSize, ph0, car, round, rotorFrames, bank2, twoCar?.hiddenCarLayer === i)
    if (hud?.ph0 && hud.round !== 9 && hud.raceFormat !== 2 && ((hud.raceOverCount ?? 0) >= 2 || car.lapsRemaining === 0)) {
      drawPositionLabel(indexed, w, h, camera.x, camera.y, hud.ph0, car)
    }
  })
  drawTileOverlay(indexed, w, h, words, bank, camera.x, camera.y)
  if (lapLine) drawLapLine(indexed, w, h, camera.x, camera.y, lapLine)
  if (hud) {
    if (hud.round === 9) {
      drawRuffTruxCountdown(indexed, w, h, hud.ruffTruxTicks ?? 0, hud.ph0)
      if (hud.ph0 && cars[0]) drawRuffTruxBanner(indexed, w, h, hud.ph0, cars[0])
    } else if (hud.raceFormat !== 2) drawHud(indexed, w, h, cars, hud.ph0)
    else if (hud.ph0 && twoCar) {
      // 8F03-8FF3 (the light bar), then the post-HUD two-car banners (9241-9281), both per frame.
      drawTwoCarHud(indexed, w, h, cars, hud.ph0, twoCar.score, hud.rankOrder)
      for (const b of twoCar.banners ?? []) drawBanner(indexed, w, h, hud.ph0, b.index, b.cx, b.cy, hud.bannerBlink ?? 0)
    }
  }
  if (paused && ph0) drawPauseBanner(indexed, w, h, ph0)
  return { width: w, height: h, indexed }
}

/** The banner blink phase `[26CF]` for a real-time clock in ms: the 70 Hz IRQ0 ISR flips it every
 * 32 ticks (48DC-48EC), independent of the game logic (it keeps running while paused). */
export function bannerBlinkPhase(ms) {
  return Math.floor((ms * 70) / 1000 / 32) & 1
}

/**
 * `DrawBanner88x22Blinking 1000:9289`, the shared banner blit: (cx, cy) is the banner's CENTRE,
 * converted to top-left by (cx-44, cy-12); 88 wide, 22 rows (21 for "Paused!", index 5), clipped to
 * the view. `silhouette` is the blink phase `[26CF]` (flipped every 32 ticks of the 70 Hz ISR,
 * 48DC-48EC): on, every non-zero pixel is written as palette index 0 (8C3C); off, a plain
 * colour-0-transparent copy (8CA4). Banner indices: 0 Bonus, 1 Winner, 2 Play Off, 3 1 Up!,
 * 4 Failed, 5 Paused!.
 */
export function drawBanner(dst, w, h, ph0, index, cx, cy, silhouette = 0) {
  const banner = ph0Banner(ph0, index)
  const rows = index === 5 ? 21 : 22
  const src = { width: banner.width, height: rows, indexed: banner.indexed.subarray(0, banner.width * rows) }
  if (silhouette) blitSilhouette(dst, w, h, cx - 44, cy - 12, src)
  else blitTransparent(dst, w, h, cx - 44, cy - 12, src)
}

/**
 * `CheckCheatSpotsThenPause`'s "Paused!" banner (`PH0_LAYOUT.bannerText[5]`, docs §9q), drawn last
 * (over the HUD, matching the real "white screen behind the banner while paused" priority -- this
 * port skips the white-screen wipe itself, a deliberate scope cut, see engine/pause.js's header).
 * Horizontal centring is derivable (`(w-88)/2` = 84) and matches the disassembly exactly.
 *
 * **UNKNOWN_pause_banner_position resolved [PROVEN via disassembly], docs/engine.md §9q**: the real
 * vertical offset is NOT the symmetric `(h-22)/2`. `CheckCheatSpotsThenPause` (1000:35f0) sets up its
 * one call into the shared banner-position helper `DrawBanner88x22Blinking` (1000:9289, xrefs confirm
 * it is reused by 3 other banner-draw sites) with `1000:3763 MOV DI,0x80` (128, CENTRE-X) and
 * `1000:3766 MOV AX,0x3c` (60, CENTRE-Y) -- the helper converts centre to top-left by subtracting
 * half of the sprite's STORED 88x24 box (`1000:9290 SUB DI,0x2c` = 44 = 88/2, `1000:9293 SUB AX,0xc`
 * = 12 = 24/2, NOT half of drawnHeight 22). X: 128-44=84, exactly the already-known value -- this
 * cross-check is what confirms the same conversion applies to Y. Y: 60-12=**48**, not 89. The other
 * banner drawn through this same helper (the race-over "Winner" banner, 1000:85ac/862d) uses a
 * different literal centre-Y (0x7c=124), proving each banner's screen position is a hand-authored
 * constant, not a formula derived from view height -- so 89 was never a safe assumption for this one.
 * `1000:3771`'s `SI=0x9d63` identifies this specific call as banner index 5 by arithmetic (PH0 loads
 * at `DS:3FE3`; `0x3FE3 + banners.offset(0x3440) + 5*banners.stride(0x840) = 0x9D63` exactly), not by
 * inference from the caller's identity alone.
 *
 * Same call site also feeds a clip height of 21 rows into `ClipSpriteToRaceView`, not the usual 22:
 * `1000:929c CMP SI,0x9d63` / `1000:92a2 MOV DX,0x15` (21) fires only for this SI, vs. `1000:9296
 * MOV DX,0x16` (22) for every other banner. Reproduced below instead of `ph0Banner`'s generic
 * `drawnHeight` -- though only the *clip* height was disassembled, not confirmed against the actual
 * pixel-copy loop inside the blit itself (`1000:8ca4`, below), so "21" is what the real call site
 * hands the pipeline, not independently re-derived from the copy loop's own row count.
 *
 * The real path through `92aa CMP [26cf],0x1 / JZ 92b6` selects `1000:8ca4` for this call (`[26cf]`
 * is set to 0 at `1000:376c`, just before) -- confirmed by disassembling it, not by its pre-existing
 * name alone, to be a genuine colour-0-transparent copy (`8cb5 LODSB` / `8cb6 OR AL,AL` / `8cb8 JZ`
 * skip-the-write), not `1000:8c3c`'s black-silhouette variant. This port now matches that with
 * `blitTransparent`'s default `colorKey: 0` (previously an opaque `dst.set` row copy -- a real, if
 * minor, fidelity gap this pass also closed while it was already looking at this call site).
 */
export function drawPauseBanner(dst, w, h, ph0) {
  const banner = ph0Banner(ph0, 5)
  const x = Math.floor((w - banner.width) / 2)
  const y = 48
  const drawnHeight = 21
  const src = { width: banner.width, height: drawnHeight, indexed: banner.indexed.subarray(0, banner.width * drawnHeight) }
  blitTransparent(dst, w, h, x, y, src)
}

/**
 * State F ("1 Up!", `PH0_LAYOUT.bannerText[3]`) / state 0x10 ("Failed", index 4) -- RUFFTRUX
 * (round 9) only, drawn for `car0` since both states are car-0-only in this port (matching the
 * real game, `mm-re-player-visible` 2026-09-23, docs/engine.md §9ai). Unlike the Pause banner
 * (fixed Y=48) or the two-car-only Winner banner (clamped to centre-Y 124, top-left 112), this one
 * genuinely SLIDES: `engine/states.js`'s `advanceBannerSlide` tracks the real `[26C0]` register
 * (car's own `_bannerSlideY`, the sprite's centre-Y) climbing from 0 in +8/tick steps with no
 * clamp, so it overshoots and settles at centre-Y **128** (top-left **116**), not 124/112 --
 * verified against the disassembly, not assumed symmetric with Winner's own settled position. Uses
 * the full 22-row `drawnHeight` (not the Pause banner's special-cased 21).
 */
export function drawRuffTruxBanner(dst, w, h, ph0, car0) {
  if (car0.state !== 0xf && car0.state !== 0x10) return
  const banner = ph0Banner(ph0, car0.state === 0xf ? 3 : 4)
  const x = Math.floor((w - banner.width) / 2)
  const y = (car0._bannerSlideY ?? 0) - 12 // 9289's own centre-Y -> top-left-Y conversion (-half of 24)
  blitTransparent(dst, w, h, x, y, banner)
}
