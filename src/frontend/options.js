// P1's third boot item (GOAL-DOS-PARITY.md): RunOptionsScreenWithSettingsDat 1000:2770, full
// re-disassembly this session, live-confirmed in DOSBox (docs/engine.md §9au). Pure, DOM-free
// state transitions; flow.js wires this to the keyboard and to screens.js's own draw functions,
// matching this project's existing engine/frontend split.
//
// The real screen's own structure: a 6-line static menu (F1-F6; F7 only when a joystick is
// detected, 1000:2822 -- always false in this port today, no joystick input yet, P6) with the
// current P1/P2 control device, sound driver and smoothness shown after each label, redrawn after
// every key. F1-F4 CYCLE a value (with real availability gating, not simply "next"); F5 opens the
// redefine-keys sub-screen; F6 the credits; ENTER commits and plays; ESC quits (to DOS, for real
// -- live-confirmed: an immediate, silent drop to the C:\> prompt, no confirmation). Also live-
// confirmed: ESC from a SUB-screen (redefine keys) returns to the options screen instead (a
// plain `RET`, 1000:93BB, not the top-level `STC;RET` "quit" signal at 1000:2A80).
import { CONTROL_NAME } from '../formats/globaldata.js'
import { SMOOTHNESS_AUTO } from '../data/frontend-tables.js'

export const CONTROL_JOY1 = 1
export const CONTROL_JOY2 = 2
export const CONTROL_MOUSE = 3
export const CONTROL_KEYS1 = 4
export const CONTROL_KEYS2 = 5

/** Whether `value` is selectable for `isP1` given device availability (1000:2948-296B for P1,
 * 1000:2977-29A4 for P2) -- NOT symmetric: P1 can never choose JOY2 or MOUSE, regardless of
 * hardware (only JOY1, KEYS1, KEYS2 are ever reachable for P1); P2 can choose any of the five,
 * gated on real presence (JOY1 needs >=1 stick, JOY2 needs exactly 2, MOUSE needs a detected
 * mouse). `avail` is `{joy1,joy2,mouse}`, all `false` in this port today (no joystick/mouse input
 * is wired up yet -- P6), so in practice both players currently only ever reach KEYS1/KEYS2 --
 * live-confirmed: with no joystick or mouse present, one F1 press and one F2 press each cycled
 * all the way back to their own starting value. */
export function controlAvailable(value, isP1, avail) {
  if (value === CONTROL_JOY1) return avail.joy1
  if (value === CONTROL_JOY2) return isP1 ? false : avail.joy1 && avail.joy2 // real bytes: [2625]==2, both sticks
  if (value === CONTROL_MOUSE) return isP1 ? false : avail.mouse
  return true // KEYS1/KEYS2
}

/** One F1/F2 press: cycle from `current`, skipping unavailable devices and the other player's own
 * current choice (players can't share one device), wrapping KEYS2 -> JOY1 (1000:2943-296B for P1,
 * 1000:296E-29A8 for P2). */
export function cycleControl(current, otherPlayerValue, isP1, avail) {
  let v = current
  do { v = v === CONTROL_KEYS2 ? CONTROL_JOY1 : v + 1 }
  while (!controlAvailable(v, isP1, avail) || v === otherPlayerValue)
  return v
}

/** F3: NONE(0) -> BLASTER(1) -> SPEAKER(2) -> NONE (1000:29AA-29C3). */
export const cycleSound = (current) => (current + 1) % 3

/** F4: HIGH(1)..LOW(4)..AUTO(5) -> HIGH (1000:29CC-29D8 -- `CMP CH,5`/`JLE`, not `JLE 4`: AUTO is
 * genuinely reachable, see frontend-tables.js's own SMOOTHNESS_LABELS header, live-confirmed). */
export const cycleSmoothness = (current) => (current >= SMOOTHNESS_AUTO ? 1 : current + 1)

// The "25011968" cheat (DS:0F6B-0F72, matched against [0x107E] as raw number-row SCANCODES, not
// ASCII -- 03 06 0B 02 02 0A 07 09 decodes via the standard PC/XT set to digits 2,5,0,1,1,9,6,8).
// A mismatch resets the cursor to 0 WITHOUT re-testing the mismatched key against digit 0
// (1000:291E: `MOV word[0xF73],0xF6B`, an unconditional reset, not a re-entrant matcher) -- typing
// "225011968" does NOT trigger it; the whole sequence must be typed cleanly from the start.
export const CHEAT_CODE_DIGITS = '25011968'

/** One non-menu keypress on the main options screen (1000:28FE-2924): `digit` is the character
 * typed if it's a plain digit 0-9, else null. Returns the next cursor position (0 if reset). */
export function advanceCheatCursor(cursor, digit) {
  if (digit != null && digit === CHEAT_CODE_DIGITS[cursor]) {
    const next = cursor + 1
    return { cursor: next % CHEAT_CODE_DIGITS.length, completed: next === CHEAT_CODE_DIGITS.length }
  }
  return { cursor: 0, completed: false }
}

/** SPACE (0x39) is rejected outright; a scancode already collected earlier in this SAME 10-key
 * pass is rejected too (1000:936E-9373 -- checked only against this pass's own keys, not any
 * previous SETTINGS.DAT). Returns true if `scancode` may be assigned. `collectedSoFar` is the
 * flat array of scancodes assigned so far this pass (both KEYS1 and KEYS2 slots). */
export function redefineKeyAccepted(scancode, collectedSoFar) {
  return scancode !== 0x39 && !collectedSoFar.includes(scancode)
}

export const REDEFINE_SLOTS_PER_GROUP = 5
export const REDEFINE_TOTAL_SLOTS = 10 // KEYS1 x5, KEYS2 x5 -- F1-F3 and D/SPACE/V are untouched (1000:93AC-93BB)

/** Which redefine slot `index` (0-9) belongs to: group 0 = KEYS1, 1 = KEYS2, matching
 * SETTINGS.DAT's own layout (globaldata.js: keys1 = bytes 0-4, keys2 = bytes 8-12). */
export const redefineGroupOf = (index) => Math.floor(index / REDEFINE_SLOTS_PER_GROUP)
export const redefineSlotInGroup = (index) => index % REDEFINE_SLOTS_PER_GROUP

export { CONTROL_NAME }
