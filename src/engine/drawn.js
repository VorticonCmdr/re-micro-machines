// `[BX+1250]`, the car's "drawn" flag (`drawnThisFrame`), as `DrawCarBodyRotatedRemapped 7D73` writes
// it (docs/engine.md §9ao). The flag has exactly three writers in the whole image (byte search for
// every `[BX+1250]`/absolute-car-address form): race init `440C` (0), `7D7D` (1) and `7E54` (0), both
// inside 7D73. So it is STICKY: a car keeps the value from the last time a state handler drew its
// body. 7D73 is state 0/B/C's own handler and is also called from states 1, 2/D, 4, 5, A, E and
// F/0x10 under their own conditions (`states.js`, `dropin.js`); state 7 and the RET-stub states never
// call it. It runs from the render (`90C5`), so on drawn frames only (this port: every step).
//
// What it means: "the body's box was inside the clip window at the last draw" -- NOT "state 0" (the
// port's old meaning) and not "visible": the window is the back buffer's 256x224, and only 200 rows
// are ever copied to the screen (`92BC`), so a car in rows 200-223 counts as drawn. Readers include
// the fire gate (`4F3C`), the rubber band (`4B23`, `528D`), the engine pitch (`7B90`/`7BCE`/`7C85`)
// and every drawn-gated sfx site.

import { toI16 } from './int16.js'

// The two real fold/clip parameter sets (`7d73`/`7e5c`, docs/engine.md §9d), shared with
// `render/raceView.js`'s own body/shadow/rotor draw so the literals live in exactly one place
// (pitfall: a second copy of a formula drifts once the first is fixed and the second isn't).
export const NORMAL_CAR_FOLD = { threshold: -12, offset: 12, size: 24 }
export const ROUND9_CAR_FOLD = { threshold: -4, offset: 0x14, size: 0x28 }

/**
 * `7D83-7E28` + `8BAB`: the sprite's top-left in view coordinates is `pos - height - camera` (height
 * `[12D6]` is not subtracted in round 8, `7D85`), wrapped once by +0xC00 when <= -12 (`7E0A`/`7E17`),
 * minus 12 for the 24x24 box. Round 9: car 0 uses its 40x40 box (threshold -4, offset 0x14,
 * `7DC4-7DE6`); cars 1-3 get the flag set with no clip test and no draw (`7DAD-7DB2`).
 * `8BAB`: an axis is in when `v >= 0 ? v < limit : v + size > 0` -- limit 0x100 for X (`8BC4`), 0xE0
 * for Y (`8C02`). The hidden car `[2621]` (`7D74`) is applied by `step.js` after the state pass.
 * With no `ctx.camera` (the pure-physics harnesses) the flag is simply set, the port's old meaning.
 */
export function markDrawn(car, ctx) {
  // 7D73 runs only from the render pass (`90C5`), so at smoothness 2-4 it does not execute every
  // physics tick -- `ctx.drawnTick`, set once per tick by `play.js`/`flow.js` from the very
  // `smoothGate.shouldDraw()` call that already gates rendering, reproduces that cadence for the
  // flag write specifically (docs/engine.md §9ao 8). Left unset (every headless harness, and the
  // browser pages at their smoothness===1 default) every physics tick is a drawn tick, unchanged
  // from before. This does NOT gate anything else in `states.js`/`dropin.js` -- the state machine's
  // OWN cadence (durations, transitions, ranking) is a separate, larger, still-open divergence
  // (docs/engine.md §9ah), deliberately not restructured here.
  if (ctx.drawnTick === false) return
  const cam = ctx.camera
  if (!cam) { car.drawnThisFrame = 1; return }
  const height = car.height ?? 0
  if (ctx.round === 9) {
    const isCarZero = ctx.cars ? car === ctx.cars[0] : true
    if (!isCarZero) { car.drawnThisFrame = 1; return }
    const f = ROUND9_CAR_FOLD
    car.drawnThisFrame = inClipWindow(car.posX - height - cam.x, car.posY - height - cam.y, f.threshold, f.offset, f.size) ? 1 : 0
    return
  }
  const h = ctx.round === 8 ? 0 : height
  const f = NORMAL_CAR_FOLD
  car.drawnThisFrame = inClipWindow(car.posX - h - cam.x, car.posY - h - cam.y, f.threshold, f.offset, f.size) ? 1 : 0
}

/** Exported for `render/raceView.js`'s own body/shadow draw position (docs/engine.md §9d,
 * `UNKNOWN_car_draw_wrap_asymmetry` fix): the real one-sided `+0xC00` fold (never a symmetric
 * `wrapDelta`), on `pos ± height - camera` (height folded in BEFORE the threshold test, per a fresh
 * disassembly of both `7d73`/`DrawCarBodyRotatedRemapped` and `7e5c`/`DrawCarShadowSilhouette`:
 * body `7d98/7d9a SUB DI/AX,height` then `7e06/7e13 SUB DI/AX,camera` then `7e0a/7e17` the fold, X
 * and Y using the identical threshold both times; shadow is the same shape with height ADDED
 * (`7e69/7e6b`) instead, and shares the SAME threshold/offset pair as the body in both the normal
 * (-12/12) and round-9 (-4/20) cases -- confirmed by disassembling `7e5c` itself, not assumed from
 * the body). */
export function viewCoord(delta, threshold, offset) {
  let v = toI16(delta)
  if (v <= threshold) v = toI16(v + 0xc00)
  return toI16(v - offset)
}

function axisIn(v, limit, size) {
  return v < 0 ? v + size > 0 : v < limit
}

/** The clip test alone, exported for the tests: world deltas (pos - height - camera) in, in/out out. */
export function inClipWindow(dx, dy, threshold, offset, size) {
  return axisIn(viewCoord(dx, threshold, offset), 0x100, size) && axisIn(viewCoord(dy, threshold, offset), 0xe0, size)
}
