// 16-bit integer semantics the physics step relies on literally (PLAN-ENGINE.md D2): 8.8-ish fixed
// point split into a signed "whole" register and an unsigned 0..255 fractional accumulator, 16-bit
// wraparound, the `IMUL; MOV AL,AH; MOV AH,DL; SHL AX,1` idiom, and `SAR` vs `SHR`. No floats.

/** Truncate to a signed 16-bit value (sign-extends bit 15), the way every game register does. */
export const toI16 = (v) => (v << 16) >> 16

/** Truncate to an unsigned 16-bit value. */
export const toU16 = (v) => v & 0xffff

/** Sign-extend an 8-bit value (0..255 or already signed) to a JS number. */
export const sext8 = (b) => { const v = b & 0xff; return v > 127 ? v - 256 : v }

/**
 * `((sin8[SI]*speed) >> 8) << 1` (docs/engine.md §3, sites `52c9, 52ef, 5b0c, 5b1a, 5b9e, 5baa,
 * 6284, 62b6, 71f6, 7212`): `IMUL` computes the full signed product, `MOV AL,AH; MOV AH,DL`
 * reassembles bits 8-23 of that product into a 16-bit register (`= floor(prod/256)` truncated to
 * 16 bits), then `SHL AX,1` doubles it. Net: `2*floor(prod/256)`, LSB always 0.
 */
export function mul2Floor256(a, b) {
  return toI16(2 * Math.floor((a * b) / 256))
}

/** Arithmetic right shift of a 16-bit register value (sign-extends first, like `SAR`). */
export const sar16 = (v, n) => toI16(v) >> n

/** Logical right shift of a 16-bit register value (like `SHR`). */
export const shr16 = (v, n) => toU16(v) >>> n

/** Wrap a world coordinate into `[0, 0xC00)` (the 3072-unit toroidal world, docs/engine.md §3). */
export const WORLD_UNITS = 0xc00
export const wrapWorld = (v) => ((v % WORLD_UNITS) + WORLD_UNITS) % WORLD_UNITS

/**
 * Shortest signed delta `b-a` across the toroidal wrap (docs/engine.md §3 car-car collision:
 * "dx, dy from the next positions, wrapped at ±0xC00, thresholds 0xBF0/0xF410" -- 0xF410 is
 * -0xBF0 as an unsigned 16-bit value, i.e. the same "fold to the nearest copy" this computes).
 */
export const wrapDelta = (d, m = WORLD_UNITS) => { const r = wrapWorld(d); return r > m / 2 ? r - m : r }

/**
 * One axis of the position/frac integrator (docs/engine.md §3 "Integrate"): `t = vel + frac`
 * (16-bit); `next = pos + sext(t >> 8)`; `nextFrac = t & 0xFF`; position wraps into `[0, 0xC00)`.
 * Returns the NEXT (tentative) values -- committing them is the caller's decision (state-gated).
 */
export function integrateAxis(pos, frac, vel) {
  const t = toU16(vel + frac)
  const delta = sext8((t >> 8) & 0xff)
  return { pos: wrapWorld(pos + delta), frac: t & 0xff }
}
