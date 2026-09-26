// P1's third boot item (GOAL-DOS-PARITY.md): the GAME OPTIONS screen, RunOptionsScreenWithSettingsDat
// 1000:2770, full re-disassembly this session, live-confirmed in DOSBox (docs/engine.md §9au).
// Proves:
//  - F1/F2's real, asymmetric device-cycling gate: P1 can never reach JOY2 or MOUSE, regardless of
//    hardware; P2 can, gated on real presence -- live-confirmed (no joystick/mouse: one F1 press
//    and one F2 press each cycle all the way back to their own starting value);
//  - F3's NONE/BLASTER/SPEAKER wrap, live-confirmed;
//  - F4's HIGH..LOW..AUTO wrap -- AUTO (value 5) is genuinely reachable, live-confirmed on a real
//    DOSBox GAME OPTIONS screen (4 presses from HIGH shows "AUTO"), correcting docs/engine.md
//    §9t's prior "AUTO proven NOT part of the set" claim;
//  - the 25011968 cheat's own cursor logic, including the real "a mismatch resets to 0 without
//    re-testing the mismatched key" behaviour (typing "225011968" does not trigger it);
//  - the redefine-keys screen's SPACE rejection and same-pass duplicate rejection, live-confirmed;
//  - SETTINGS.DAT's 32-byte round-trip (parseSettings . serializeSettings = identity);
//  - which keys set the dirty flag [0xF63], in the original's dispatch order: F1-F5 and F7 do,
//    the cheat's completing digit does not (live, docs/engine.md §9dq), and F1-F4 reset a
//    half-typed cheat while F5-F7 don't.
//   node tools/check-options.mjs
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cycleControl, cycleSound, cycleSmoothness, advanceCheatCursor, optionsKeyStep, redefineKeyAccepted, redefineGroupOf, redefineSlotInGroup, CHEAT_CODE_DIGITS, CONTROL_JOY1, CONTROL_JOY2, CONTROL_MOUSE, CONTROL_KEYS1, CONTROL_KEYS2 } from '../src/frontend/options.js'
import { parseSettings, serializeSettings, DEFAULT_SETTINGS } from '../src/formats/globaldata.js'
import { SMOOTHNESS_LABELS, SMOOTHNESS_AUTO, resolveSmoothnessForPlay, REDEFINE_SLOT_LABELS } from '../src/data/frontend-tables.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

let bad = 0
function check(name, cond) {
  if (cond) return
  bad++
  console.log(`FAIL: ${name}`)
}

const NO_HARDWARE = { joy1: false, joy2: false, mouse: false }

// 1. F1/F2 device cycling, live-confirmed asymmetry.
check('P1 KEYS2, no hardware, P2=KEYS1: F1 is a no-op (live-confirmed)', cycleControl(CONTROL_KEYS2, CONTROL_KEYS1, true, NO_HARDWARE) === CONTROL_KEYS2)
check('P2 KEYS1, no hardware, P1=KEYS2: F2 is a no-op (live-confirmed)', cycleControl(CONTROL_KEYS1, CONTROL_KEYS2, false, NO_HARDWARE) === CONTROL_KEYS1)
check('P1 can never reach JOY2 even with full hardware present', cycleControl(CONTROL_KEYS1, CONTROL_KEYS2, true, { joy1: true, joy2: true, mouse: true }) !== CONTROL_JOY2)
check('P1 can never reach MOUSE even with a mouse present', cycleControl(CONTROL_KEYS1, CONTROL_KEYS2, true, { joy1: false, joy2: false, mouse: true }) !== CONTROL_MOUSE)
check('P2 CAN reach MOUSE when one is present', cycleControl(CONTROL_KEYS1, CONTROL_KEYS2, false, { joy1: false, joy2: false, mouse: true }) === CONTROL_MOUSE || cycleControl(cycleControl(CONTROL_KEYS1, CONTROL_KEYS2, false, { joy1: false, joy2: false, mouse: true }), CONTROL_KEYS2, false, { joy1: false, joy2: false, mouse: true }) === CONTROL_MOUSE)
check('P2 JOY2 needs BOTH sticks (one alone is not enough)', cycleControl(CONTROL_KEYS1, CONTROL_KEYS2, false, { joy1: true, joy2: false, mouse: false }) !== CONTROL_JOY2)
{
  // Players can never share one device: P1 and P2 both starting at adjacent values must each end
  // up somewhere that isn't the other's value.
  const p1 = cycleControl(CONTROL_JOY1, CONTROL_KEYS1, true, NO_HARDWARE)
  check('the cycle never lands P1 on P2\'s own current value', p1 !== CONTROL_KEYS1)
}

// 2. F3 sound cycle.
check('sound cycles BLASTER->SPEAKER->NONE->BLASTER (live-confirmed)', cycleSound(1) === 2 && cycleSound(2) === 0 && cycleSound(0) === 1)

// 3. F4 smoothness cycle, AUTO live-confirmed reachable.
check('smoothness cycles HIGH..LOW..AUTO..HIGH (1..5..1)', [1, 2, 3, 4, 5].map(cycleSmoothness).join(',') === '2,3,4,5,1')
check('SMOOTHNESS_LABELS has exactly 5 entries, AUTO last', SMOOTHNESS_LABELS.length === 5 && SMOOTHNESS_LABELS[4] === 'AUTO')
check('AUTO (5) resolves to HIGH (1) at RETURN -- no browser equivalent to the real CPU-speed probe', resolveSmoothnessForPlay(SMOOTHNESS_AUTO) === 1)
check('a non-AUTO value resolves to itself', resolveSmoothnessForPlay(3) === 3)

// 4. The 25011968 cheat: full sequence completes; a mismatch resets to 0 WITHOUT re-testing the
// mismatched key against digit 0 (typing "225011968" must NOT trigger it).
{
  let cursor = 0
  for (const d of CHEAT_CODE_DIGITS) ({ cursor } = advanceCheatCursor(cursor, d))
  check('the full sequence completes', CHEAT_CODE_DIGITS.split('').reduce((c, d) => advanceCheatCursor(c, d).cursor, 0) === 0 &&
    CHEAT_CODE_DIGITS.split('').reduce((acc, d) => { const r = advanceCheatCursor(acc.cursor, d); return { cursor: r.cursor, completed: acc.completed || r.completed } }, { cursor: 0, completed: false }).completed)
}
{
  const withExtraLeadingDigit = '2' + CHEAT_CODE_DIGITS // "225011968"
  const completed = withExtraLeadingDigit.split('').reduce((acc, d) => { const r = advanceCheatCursor(acc.cursor, d); return { cursor: r.cursor, completed: acc.completed || r.completed } }, { cursor: 0, completed: false }).completed
  check('a leading extra "2" breaks the match (dumb reset, not a smart re-scan)', !completed)
}
check('a mismatch resets to cursor 0', advanceCheatCursor(3, '2').cursor === 0) // cursor 3 expects '1', typed '2'

// 4b. The dispatch order and the dirty flag (1000:28B7-29D0, docs/engine.md §9dq).
{
  const typeAll = (codes) => codes.reduce((acc, c) => { const r = optionsKeyStep(c, acc.cursor); return { cursor: r.cheatCursor, completed: acc.completed || r.cheatCompleted, dirty: acc.dirty || r.dirty } }, { cursor: 0, completed: false, dirty: false })
  const digits = CHEAT_CODE_DIGITS.split('').map((d) => `Digit${d}`)
  const t = typeAll(digits)
  check('the cheat completes through the options dispatch', t.completed)
  check('typing the cheat does not set [0xF63] (live: 0 after the code, nothing saved)', !t.dirty)
  for (const k of ['F1', 'F2', 'F3', 'F4', 'F5', 'F7']) check(`${k} sets [0xF63]`, optionsKeyStep(k, 0).dirty)
  for (const k of ['F6', 'Escape', 'Enter', 'KeyA', 'Digit5']) check(`${k} does not set [0xF63]`, !optionsKeyStep(k, 0).dirty)
  check('F1 mid-code resets the cheat cursor (it goes through the matcher, 2943 after 28FE)', optionsKeyStep('F1', 4).cheatCursor === 0)
  check('ENTER goes through the matcher too (2938)', optionsKeyStep('Enter', 4).cheatCursor === 0 && optionsKeyStep('Enter', 4).action === 'confirm')
  for (const k of ['F5', 'F6', 'F7', 'Escape']) check(`${k} leaves the cheat cursor alone (tested before 28FE)`, optionsKeyStep(k, 4).cheatCursor === 4)
  check('"2501" F1 "1968" does not complete the cheat', !typeAll([...digits.slice(0, 4), 'F1', ...digits.slice(4)]).completed)
  check('"2501" F6 "1968" still completes it', typeAll([...digits.slice(0, 4), 'F6', ...digits.slice(4)]).completed)
}

// 5. Redefine-keys: SPACE rejected, same-pass duplicates rejected, a fresh scancode accepted.
check('SPACE (0x39) is always rejected', !redefineKeyAccepted(0x39, []))
check('a duplicate within this pass is rejected', !redefineKeyAccepted(0x1e, [0x1e, 0x20]))
check('a fresh scancode is accepted', redefineKeyAccepted(0x1e, [0x20, 0x2e]))
check('redefineGroupOf/SlotInGroup split 0-9 into KEYS1 (0-4) / KEYS2 (5-9)', redefineGroupOf(0) === 0 && redefineGroupOf(4) === 0 && redefineGroupOf(5) === 1 && redefineGroupOf(9) === 1 && redefineSlotInGroup(7) === 2)
check('REDEFINE_SLOT_LABELS matches SETTINGS.DAT\'s documented key-slot order', REDEFINE_SLOT_LABELS.join(',') === 'LEFT,RIGHT,ACCELERATE,BRAKE,SELECT')

// 6. SETTINGS.DAT 32-byte round-trip, against both the real shipped file and the DS-image default.
for (const [name, bytes] of [
  ['the real shipped game/SETTINGS.DAT', new Uint8Array(readFileSync(join(ROOT, 'game', 'SETTINGS.DAT')))],
  ['the DS-image default, serialized fresh', serializeSettings(DEFAULT_SETTINGS)],
]) {
  const parsed = parseSettings(bytes)
  const roundTripped = serializeSettings(parsed)
  check(`${name}: parseSettings . serializeSettings round-trips byte-exact`, roundTripped.every((b, i) => b === bytes[i]) && roundTripped.length === 32)
}

console.log(bad ? `${bad} check(s) failed` : 'check-options: F1-F4\'s real cycling logic (including P1\'s live-confirmed JOY2/MOUSE exclusion and AUTO smoothness), the 25011968 cheat\'s dumb-reset matcher, the redefine-keys screen\'s SPACE/duplicate rejection, and a byte-exact SETTINGS.DAT round-trip all match the fresh disassembly, cross-checked live against a real DOSBox capture this session')
process.exitCode = bad ? 1 : 0
