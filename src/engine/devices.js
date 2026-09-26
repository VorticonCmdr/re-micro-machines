// JOY 1, JOY 2 and MOUSE: the game's own readers, fed by the Gamepad API and pointer events
// (GOAL-DOS-PARITY.md P6, docs/engine.md §9cu). Every routine here is a transcription of
// MICROU.EXE; the browser side only supplies what the hardware would have: game-port counts and
// buttons, and mouse mickeys.
//
// The game port (0x201). `2F9E`/`2FCC`/`2FFE` fire the one-shots and count, per axis, the loop
// passes its bit stays high, up to `CX=0x7530`; a missing stick never drops, so its axes read
// 30000. Then `IN AL,DX` / `NOT AL` gives `[1095]`: stick A's buttons in bits 4/5, stick B's in 6/7.
// A browser has no resistance timing, so a pad's axis `a` in [-1, 1] becomes a count
// `JOY_COUNT_CENTRE + a * JOY_COUNT_RANGE` -- a port choice. 170/165 puts the shipped SETTINGS.DAT's
// own calibration (87/252, stick 1) at a = -0.5/+0.5, as a symmetric stick would give. The game
// only ever compares counts against thresholds from the same scale (its F7 calibration, below).

export const JOY_COUNT_TIMEOUT = 0x7530
export const JOY_COUNT_CENTRE = 170
export const JOY_COUNT_RANGE = 165
export const MOUSE_DEAD_ZONE = 3 // [290D], static; no writer

const BIT_LEFT = 0x80, BIT_RIGHT = 0x40, BIT_ACCEL = 0x20, BIT_BRAKE = 0x10, BIT_FIRE = 0x08

/** One pad as the game port sees it: `{x, y, b1, b2}` -- counts, and DOS button 1 (0x10, brake) and
 * button 2 (0x20, accelerate). Mapping (a port choice): the left stick or the d-pad steer; the
 * face button A (0) or the right trigger (7) is button 2, B (1) or the left trigger (6) button 1.
 * `null` pad = nothing connected: timed-out axes, no buttons. */
export function padToPort(pad) {
  if (!pad || pad.connected === false) return { x: JOY_COUNT_TIMEOUT, y: JOY_COUNT_TIMEOUT, b1: false, b2: false }
  const pressed = (i) => !!pad.buttons?.[i]?.pressed
  let ax = pad.axes?.[0] ?? 0, ay = pad.axes?.[1] ?? 0
  if (pressed(14)) ax = -1
  if (pressed(15)) ax = 1
  if (pressed(12)) ay = -1
  if (pressed(13)) ay = 1
  const count = (a) => Math.round(JOY_COUNT_CENTRE + Math.max(-1, Math.min(1, a)) * JOY_COUNT_RANGE)
  return { x: count(ax), y: count(ay), b1: pressed(1) || pressed(6), b2: pressed(0) || pressed(7) }
}

/** The first two connected pads, in index order, are sticks A and B. */
export function sticksFrom(gamepads) {
  const pads = [...(gamepads ?? [])].filter((p) => p && p.connected !== false)
  return [pads[0] ?? null, pads[1] ?? null]
}

/** `2D5B`'s pre-read (the `2F9E`/`2FCC`/`2FFE` call it makes): `[108D]/[108F]` stick A x/y,
 * `[1091]/[1093]` stick B x/y, and `[1095]` = NOT of the port byte, i.e. pressed buttons set: A's
 * button 1/2 in bits 4/5, B's in bits 6/7 (the axis bits 0-3 read 1 too, after the timeout). */
export function readGamePort(gamepads) {
  const [a, b] = sticksFrom(gamepads).map(padToPort)
  const buttons = 0x0f | (a.b1 ? 0x10 : 0) | (a.b2 ? 0x20 : 0) | (b.b1 ? 0x40 : 0) | (b.b2 ? 0x80 : 0)
  return { ax: a.x, ay: a.y, bx: b.x, by: b.y, buttons }
}

/** `2E6C` (JOY 1) and `2EB3` (JOY 2): any of the stick's two buttons gives 0x08; X <= left
 * threshold 0x80 (`JG` skips), X >= right 0x40 (`JL` skips); button 2 alone 0x20, button 1 alone
 * 0x10, both 0x30. The Y compares (`2E96`, `2EA3`, `2EE0`, `2EED`) set no bit. */
export function joystickByte(port, stick, thresholds) {
  const ah = (stick === 2 ? port.buttons >> 2 : port.buttons) & 0x30
  const x = stick === 2 ? port.bx : port.ax
  let al = ah ? BIT_FIRE : 0
  if (x <= thresholds.left) al |= BIT_LEFT
  if (x >= thresholds.right) al |= BIT_RIGHT
  if (ah === 0x20) al |= BIT_ACCEL
  if (ah === 0x10) al |= BIT_BRAKE
  if (ah === 0x30) al |= BIT_ACCEL | BIT_BRAKE
  return al
}

/** `JoystickCountSticks 3A12` (every GAME OPTIONS entry, `2775`), `[2625]`: BIOS `INT 15h AH=84h
 * DX=1` gives both sticks' counts (0 for an absent one); stick A counts if X > 5 or Y >= 5, and
 * stick B adds one the same way -- so B alone also gives 1. */
export function countSticks(gamepads) {
  const [a, b] = sticksFrom(gamepads)
  const bios = (pad) => (pad ? padToPort(pad) : { x: 0, y: 0 })
  const pa = bios(a), pb = bios(b)
  let n = pa.x > 5 || pa.y >= 5 ? 1 : 0
  if (pb.x > 5 || pb.y >= 5) n++
  return n
}

/** The F7 calibration's arithmetic (`2AFE-2B1C`, `2B63-2B82`): each threshold is the 16-bit sum of
 * the centre reading and the extreme, shifted right once. */
export function calibrationThreshold(centre, extreme) {
  return ((centre + extreme) & 0xffff) >> 1
}

/**
 * The INT 33h driver as the game leaves it. `DetectMouseInt33Dead 3A44` -- the only routine that
 * resets it, limits it to 320x200 and centres it, and the only writer of `[2627]` -- is never
 * called, so the driver keeps its mode-13h defaults: a 640x200 virtual screen, the cursor at its
 * centre (320,100), 8 mickeys per 8 pixels across and 16 per 8 down. `[2627]` stays 0, so the
 * options screen never offers MOUSE; a SETTINGS.DAT that already holds 3 still gets this reader.
 * Browser pointer movement is taken as mickeys, one per CSS pixel (`UNKNOWN_mouse_host_scale`).
 */
export function createMouseDriver() {
  let x = 320, y = 100, fx = 0, fy = 0
  const clamp = (v, hi) => Math.max(0, Math.min(hi, v))
  return {
    buttons: 0, // bit 0 left, bit 1 right (INT 33h AX=3 BX)
    move(mickeysX, mickeysY) {
      fx += mickeysX; fy += mickeysY / 2
      const dx = Math.trunc(fx), dy = Math.trunc(fy)
      fx -= dx; fy -= dy
      x = clamp(x + dx, 639); y = clamp(y + dy, 199)
    },
    position() { return { x, y } }, // AX=3 CX/DX
    setPosition(nx, ny) { x = clamp(nx, 639); y = clamp(ny, 199); fx = 0; fy = 0 }, // AX=4
  }
}

/** `ReadMouseDirections 2E02`: left button 0x28, right 0x10; x <= 160-3 0x80, x >= 160+3 0x40;
 * y <= 100-3 0x20, y >= 100+3 0x10; and when any of 0xF0 is set, AX=4 puts the cursor back at
 * (160,100). */
export function mouseByte(driver, deadZone = MOUSE_DEAD_ZONE) {
  const { x, y } = driver.position()
  let si = 0
  if (driver.buttons & 1) si |= 0x28
  if (driver.buttons & 2) si |= BIT_BRAKE
  if (x <= 0xa0 - deadZone) si |= BIT_LEFT
  else if (x >= 0xa0 + deadZone) si |= BIT_RIGHT
  if (y <= 0x64 - deadZone) si |= BIT_ACCEL
  else if (y >= 0x64 + deadZone) si |= BIT_BRAKE
  if (si & 0xf0) driver.setPosition(0xa0, 0x64)
  return si
}

/**
 * `2D00`'s reader for one control word, as `{read(), dispose()}`: 4 KEYS 1 and 5 KEYS 2 (the
 * keyboard reader the caller supplies), 3 MOUSE, 1 JOY 1, 2 JOY 2; anything else reads 0 (`2DED`,
 * which runs the drone AI only in a race). `env`: `{ keyboard(scancodes), keys1, keys2,
 * getGamepads(), thresholds(stick), mouse }`.
 */
export function createControlReader(control, env) {
  if (control === 4 || control === 5) return env.keyboard(control === 4 ? env.keys1 : env.keys2)
  if (control === 1 || control === 2) {
    return { read: () => joystickByte(readGamePort(env.getGamepads()), control, env.thresholds(control)), dispose() {} }
  }
  if (control === 3) return { read: () => mouseByte(env.mouse), dispose() {} }
  return { read: () => 0, dispose() {} }
}
