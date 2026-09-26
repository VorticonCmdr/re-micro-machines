// STRT_POS.BIN, CHEATS.BIN and SETTINGS.DAT — three small, fixed-layout global files whose formats
// were established from their consumers in an earlier session; this module is the first decoder for
// them (docs/track-layout.md has the full derivation and address citations).
//
// STRT_POS.BIN (144 B): 9 rounds x 4 race-slots x {x:u16, y:u16}, world coordinates 0..3071.
//   SI = 1EAB + (round-1)*16 + (race-1)*4                    (InitRaceCarsFromTables 1000:3d9f-3e0e)
//   Every round reserves 4 slots even where that round has only 3 real races.
// CHEATS.BIN (360 B): 30 x 12-byte records {round:u16, race:u16, x:u16, y:u16, type:u16 (0-9), param:u16}.
//   Matched by round/race and car position in FUN_1000_35f0 (1000:3601-3652). All 10 effects of `type`
//   0-9 are now decoded (docs/engine.md §6, CheckCheatSpotsThenPause 1000:35f0): 0 lose a life, 1 instant
//   win, 2/3/4 override grip threshold/grip slew/accel, 5/6/9 set flag words (downstream use not traced),
//   7 hazard-immune, 8 max speed. Was UNKNOWN_cheats_type; narrowed, not fully closed.
// SETTINGS.DAT (32 B): read by RunOptionsScreenWithSettingsDat (1000:2770).
//   8 words: P1 control, P2 control, smoothness, sound driver (0 DRIVER0/1 DRIVER1/2 DRIVER2),
//   joystick1 {L,R}, joystick2 {L,R}. Control words are a 1-based enum: 1 JOY1, 2 JOY2, 3 MOUSE,
//   4 KEYS1, 5 KEYS2. Then 16 PC scancodes: KEYS1 x5, F1-F3 (fixed), KEYS2 x5, D/SPACE/V (fixed) --
//   the 5 KEYS1/KEYS2 slots are LEFT, RIGHT, ACCELERATE, BRAKE, SELECT(fire), in that order
//   (UNKNOWN_settings_key_slots, closed: docs/engine.md §6 -- RunRedefineKeysScreen 1000:92f0 labels them
//   and KeyboardIsr 1000:2efd maps slot i to bit 0x8000>>i of [107C]); scancode->name here is still the
//   standard PC/XT set -- CONTROL_NAME below could gain the per-slot role labels.

import { toU8, u16le } from './bytes.js'

// The DS image's own static defaults (193C:0F5F/0F61/263A/106C), used ONLY when SETTINGS.DAT
// can't be read at all (RunOptionsScreenWithSettingsDat 1000:2778-27E0's own fall-through when
// the file open/read fails) -- re-read live this session, not guessed. In practice the shipped
// game/SETTINGS.DAT always loads successfully (P1=KEYS2, P2=KEYS1, matching flow.js's own
// DEFAULT_KEYS2), so this fallback is the rare "file genuinely missing" path, not the common one.
// [0xF64] (sound) is set separately, unconditionally, BEFORE the file read even attempts (2782-
// 278C): 1 (BLASTER) only if Sound Blaster autodetection succeeded, else 2 (SPEAKER) -- this port
// never models SB autodetection, so its own fallback is always 2.
export const DEFAULT_SETTINGS = {
  p1Control: 4, // KEYS1
  p2Control: 5, // KEYS2
  smoothness: 1, // HIGH
  soundDriver: 2, // SPEAKER
  // [28FD]..[2907]'s static values: with the file missing, 2798 JC 27E0 skips the load at 27C5-27D1
  // and they stay (read live, docs/engine.md §9cu). 0/0 here made JOY 1 read right on every poll.
  joystick1: { left: 10, right: 200 },
  joystick2: { left: 10, right: 200 },
  keys1: [0x2c, 0x2d, 0x10, 0x1e, 0x2e], // Z, X, Q, A, C
  f1f3: [0x3b, 0x3c, 0x3d],
  keys2: [0x4b, 0x4d, 0x48, 0x50, 0x52], // arrows + Insert
  dSpaceV: [0x20, 0x39, 0x2f], // D, SPACE, V
}

/** A deep copy of DEFAULT_SETTINGS: the options screen (F1-F7, F5's keys, F7's thresholds) edits the
 * session's settings in place, which must never reach the shared defaults. */
export function freshDefaultSettings() {
  return structuredClone(DEFAULT_SETTINGS)
}

/** The inverse of parseSettings: packs the same fields back into a 32-byte buffer, the exact
 * layout RunOptionsScreenWithSettingsDat writes at RETURN (1000:2A32-2A67, only when dirty --
 * see flow.js's OPTIONS phase). `settings` is parseSettings's own shape (raw is ignored; every
 * other field is re-packed, so callers can hand back a mutated copy of a parsed settings object). */
export function serializeSettings(settings) {
  const b = new Uint8Array(32)
  const words = [
    settings.p1Control, settings.p2Control, settings.smoothness, settings.soundDriver,
    settings.joystick1.left, settings.joystick1.right, settings.joystick2.left, settings.joystick2.right,
  ]
  words.forEach((w, i) => { b[i * 2] = w & 0xff; b[i * 2 + 1] = (w >> 8) & 0xff })
  b.set([...settings.keys1, ...settings.f1f3, ...settings.keys2, ...settings.dSpaceV], 16)
  return b
}

export const CONTROL_NAME = { 1: 'JOY 1', 2: 'JOY 2', 3: 'MOUSE', 4: 'KEYS 1', 5: 'KEYS 2' }
export const SOUND_DRIVER_NAME = { 0: 'DRIVER0 (none)', 1: 'DRIVER1 (BLASTER/OPL2)', 2: 'DRIVER2 (SPEAKER)' }

// Standard IBM PC/XT scancode set 1 — mechanical lookup, not game-specific.
const SCANCODE_NAME = {
  0x1e: 'A', 0x30: 'B', 0x2e: 'C', 0x20: 'D', 0x12: 'E', 0x21: 'F', 0x22: 'G', 0x23: 'H', 0x17: 'I',
  0x24: 'J', 0x25: 'K', 0x26: 'L', 0x32: 'M', 0x31: 'N', 0x18: 'O', 0x19: 'P', 0x10: 'Q', 0x13: 'R',
  0x1f: 'S', 0x14: 'T', 0x16: 'U', 0x2f: 'V', 0x11: 'W', 0x2d: 'X', 0x15: 'Y', 0x2c: 'Z',
  0x39: 'SPACE', 0x48: 'UP', 0x50: 'DOWN', 0x4b: 'LEFT', 0x4d: 'RIGHT',
  0x3b: 'F1', 0x3c: 'F2', 0x3d: 'F3', 0x3e: 'F4', 0x3f: 'F5',
}
export const scancodeName = (b) => SCANCODE_NAME[b] ?? `0x${b.toString(16).padStart(2, '0')}`

export const RACES_PER_ROUND_SLOT = 4 // STRT_POS reserves 4 slots/round even for 3-race rounds

/** @returns {{round: number, race: number, x: number, y: number}[]} 36 entries, round-major. */
export function parseStrtPos(data) {
  const b = toU8(data)
  if (b.length !== 144) throw new Error(`STRT_POS.BIN: expected 144 bytes, got ${b.length}`)
  const out = []
  for (let round = 1; round <= 9; round++) {
    for (let race = 1; race <= RACES_PER_ROUND_SLOT; race++) {
      const o = (round - 1) * 16 + (race - 1) * 4
      out.push({ round, race, x: u16le(b, o), y: u16le(b, o + 2) })
    }
  }
  return out
}

/** @returns {{round: number, race: number, x: number, y: number, type: number, param: number}[]} 30 records. */
export function parseCheats(data) {
  const b = toU8(data)
  if (b.length % 12) throw new Error(`CHEATS.BIN: ${b.length} bytes is not a multiple of 12`)
  const out = []
  for (let i = 0; i < b.length; i += 12) {
    out.push({ round: u16le(b, i), race: u16le(b, i + 2), x: u16le(b, i + 4), y: u16le(b, i + 6), type: u16le(b, i + 8), param: u16le(b, i + 10) })
  }
  return out
}

/** @returns {object} decoded SETTINGS.DAT: controls, smoothness, sound driver, joystick thresholds, key bindings. */
export function parseSettings(data) {
  const b = toU8(data)
  if (b.length !== 32) throw new Error(`SETTINGS.DAT: expected 32 bytes, got ${b.length}`)
  const words = Array.from({ length: 8 }, (_, i) => u16le(b, i * 2))
  const [p1Control, p2Control, smoothness, soundDriver, joy1L, joy1R, joy2L, joy2R] = words
  const scancodes = Array.from(b.subarray(16, 32))
  return {
    raw: words,
    p1Control, p2Control, smoothness, soundDriver,
    p1ControlName: CONTROL_NAME[p1Control] ?? `unknown (${p1Control})`,
    p2ControlName: CONTROL_NAME[p2Control] ?? `unknown (${p2Control})`,
    soundDriverName: SOUND_DRIVER_NAME[soundDriver] ?? `unknown (${soundDriver})`,
    joystick1: { left: joy1L, right: joy1R },
    joystick2: { left: joy2L, right: joy2R },
    keys1: scancodes.slice(0, 5),
    f1f3: scancodes.slice(5, 8),
    keys2: scancodes.slice(8, 13),
    dSpaceV: scancodes.slice(13, 16),
  }
}
