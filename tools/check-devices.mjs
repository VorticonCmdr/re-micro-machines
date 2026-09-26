// P6: JOY 1, JOY 2 and MOUSE (docs/engine.md §9cu). The readers against hand transcriptions of
// 2E6C/2EB3/2E02, the game-port model, 3A12's count, the F7 calibration against its live run, the
// mouse driver's default state as the live game saw it, the per-device fire preempt the live test
// showed, and the options/F7 screens against three live frames.
//   node tools/check-devices.mjs
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  JOY_COUNT_TIMEOUT, padToPort, readGamePort, joystickByte, countSticks, calibrationThreshold,
  createMouseDriver, mouseByte, createControlReader,
} from '../src/engine/devices.js'
import { createJoyCal, joyCalStep } from '../src/frontend/joyCal.js'
import { cycleControl } from '../src/frontend/options.js'
import { applySteerAndThrottle } from '../src/engine/step.js'
import { buildArena } from '../src/formats/chr.js'
import { createMenuBuffer } from '../src/render/menuView.js'
import { drawOptionsScreen, drawJoystickCalibrationScreen } from '../src/frontend/screens.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
let bad = 0
const check = (name, cond) => { if (!cond) { bad++; console.log(`FAIL: ${name}`) } }

const pad = (x = 0, y = 0, pressed = []) => ({ connected: true, axes: [x, y], buttons: Array.from({ length: 16 }, (_, i) => ({ pressed: pressed.includes(i) })) })
const SHIPPED = { left: 87, right: 252 } // this copy's SETTINGS.DAT, stick 1

// 2E6C / 2EB3, transcribed by hand from the listing: JG/JL on X, AH = the stick's two button bits.
function hand(x, ah, t) {
  let al = ah ? 8 : 0
  if (!(x > t.left)) al |= 0x80
  if (!(x < t.right)) al |= 0x40
  if (ah === 0x20) al |= 0x20
  if (ah === 0x10) al |= 0x10
  if (ah === 0x30) al |= 0x30
  return al
}
{
  let ok = true
  for (const x of [0, 86, 87, 88, 170, 251, 252, 253, 30000]) for (const ah of [0, 0x10, 0x20, 0x30]) {
    const port1 = { ax: x, ay: 0, bx: 0, by: 0, buttons: ah }
    const port2 = { ax: 0, ay: 0, bx: x, by: 0, buttons: ah << 2 }
    if (joystickByte(port1, 1, SHIPPED) !== hand(x, ah, SHIPPED) || joystickByte(port2, 2, SHIPPED) !== hand(x, ah, SHIPPED)) ok = false
  }
  check('2E6C/2EB3: every X around the thresholds x every button pair matches the hand transcription; stick 2 reads bits 6/7', ok)
  check('buttons: button 2 alone 0x28 (accelerate), button 1 alone 0x18 (brake), both 0x38', hand(170, 0x20, SHIPPED) === 0x28 && hand(170, 0x10, SHIPPED) === 0x18 && hand(170, 0x30, SHIPPED) === 0x38)
}
{
  const none = readGamePort([])
  check('no stick: the port loop times out, both axes 30000 (live: F7 with no stick stored 30000)', none.ax === JOY_COUNT_TIMEOUT && none.bx === JOY_COUNT_TIMEOUT && (none.buttons & 0xf0) === 0)
  check('no stick: JOY 1 reads right (0x40) every poll with the shipped thresholds', joystickByte(none, 1, SHIPPED) === 0x40)
  const c = readGamePort([pad(0, 0)])
  check('a centred pad reads no direction with the shipped calibration (count 170)', c.ax === 170 && joystickByte(c, 1, SHIPPED) === 0)
  check('full left / full right cross the shipped thresholds', joystickByte(readGamePort([pad(-1)]), 1, SHIPPED) === 0x80 && joystickByte(readGamePort([pad(1)]), 1, SHIPPED) === 0x40)
  check('d-pad left/right steer like the stick', joystickByte(readGamePort([pad(0, 0, [14])]), 1, SHIPPED) === 0x80 && joystickByte(readGamePort([pad(0, 0, [15])]), 1, SHIPPED) === 0x40)
  check('A (or RT) is button 2 = 0x28, B (or LT) button 1 = 0x18', joystickByte(readGamePort([pad(0, 0, [0])]), 1, SHIPPED) === 0x28 && joystickByte(readGamePort([pad(0, 0, [7])]), 1, SHIPPED) === 0x28 && joystickByte(readGamePort([pad(0, 0, [1])]), 1, SHIPPED) === 0x18)
  const two = readGamePort([pad(0), pad(-1, 0, [0])])
  check('the second pad is stick B: its X and its buttons in bits 6/7 (JOY 2)', two.bx === 5 && joystickByte(two, 2, SHIPPED) === 0xa8 && joystickByte(two, 1, SHIPPED) === 0)
  check('a disconnected pad counts as absent', padToPort({ connected: false }).x === JOY_COUNT_TIMEOUT)
}
check('3A12: 0, 1 or 2 sticks', countSticks([]) === 0 && countSticks([pad()]) === 1 && countSticks([pad(), pad()]) === 2 && countSticks([null, pad()]) === 1)
check('the calibration arithmetic: (centre + extreme) >> 1 on 16 bits', calibrationThreshold(170, 5) === 87 && calibrationThreshold(30000, 30000) === 30000 && calibrationThreshold(40000, 40000) === ((80000 & 0xffff) >> 1))

// F7: stages, the release wait, the prompt only while waiting, ENTER or the stick's own buttons.
{
  const t = { 1: { left: 1, right: 2 }, 2: { left: 3, right: 4 } }
  const cal = createJoyCal(1, t)
  const none = readGamePort([])
  check('F7: stage 1 starts with CENTRE drawn and no prompt until the buttons are up', cal.columns[0].join() === 'CENTRE' && cal.phase === 'release')
  joyCalStep(cal, none, false)
  check('F7: buttons up -> the prompt', cal.phase === 'wait')
  joyCalStep(cal, none, false)
  check('F7: nothing pressed, no ENTER -> still waiting', cal.step === 0)
  joyCalStep(cal, none, true)
  joyCalStep(cal, none, false); joyCalStep(cal, none, true)
  joyCalStep(cal, none, false); joyCalStep(cal, none, true)
  check('F7 with no stick, ENTER through: both thresholds 30000, as live', cal.done && t[1].left === 30000 && t[1].right === 30000 && t[2].left === 3)
  const t2 = { 1: {}, 2: {} }
  const c2 = createJoyCal(2, t2)
  const at = (x, press) => readGamePort([pad(x, 0, press ? [0] : [])])
  const seq = [[0, true], [0, false], [0, true], [-1, false], [-1, true], [1, false], [1, true]]
  joyCalStep(c2, at(0, true), false)
  check('F7: a button still held from before keeps the stage in its release wait', c2.phase === 'release')
  for (const [x, p] of seq) joyCalStep(c2, at(x, p), false)
  check('F7: the stick\'s own button accepts; centre 170, left 5, right 335 -> 87 / 252', t2[1].left === 87 && t2[1].right === 252)
  check('F7: with [2625]=2 stick 2 follows, its column beside stick 1\'s', !c2.done && c2.stick === 2 && c2.columns[0].length === 3 && c2.columns[1].join() === 'CENTRE')
  const b = (x, press) => readGamePort([pad(), pad(x, 0, press ? [0] : [])])
  for (const [x, p] of [[0, false], [0, true], [0, false], [-1, true], [-1, false], [1, true]]) joyCalStep(c2, b(x, p), false)
  check('F7: stick 2 reads B\'s X and B\'s buttons (0xC0)', c2.done && t2[2].left === 87 && t2[2].right === 252)
}

// The mouse: 3A44 never runs, so the driver keeps its mode-13h defaults. Live: x=600 accepted, the
// first read gave 0x40, and the reader put the cursor back at (160,100).
{
  const m = createMouseDriver()
  check('mouse: the driver starts at (320,100) on a 640-wide range', m.position().x === 320 && m.position().y === 100)
  m.setPosition(600, 100)
  check('mouse: x=600 is in range (live)', m.position().x === 600)
  check('mouse: right of the dead zone reads 0x40 and recentres to (160,100), as live', mouseByte(m) === 0x40 && m.position().x === 160 && m.position().y === 100)
  check('mouse: centred, nothing', mouseByte(m) === 0)
  m.buttons = 1
  check('mouse: left button 0x28, no recentre without a direction bit... (0x28 has 0x20)', mouseByte(m) === 0x28)
  m.buttons = 2
  check('mouse: right button 0x10', mouseByte(m) === 0x10)
  m.buttons = 0
  m.move(-3, 0)
  check('mouse: 3 mickeys left = x 157 = 160-3 -> left (JG)', mouseByte(m) === 0x80)
  m.move(-2, 0)
  check('mouse: 2 left stays in the dead zone', mouseByte(m) === 0)
  m.setPosition(160, 100); m.move(0, -6)
  check('mouse: 6 mickeys up = 3 pixels (16 per 8) -> accelerate', mouseByte(m) === 0x20)
  m.setPosition(160, 100); m.move(0, 6)
  check('mouse: 6 down -> brake', mouseByte(m) === 0x10)
}

// With SETTINGS.DAT missing the thresholds keep their static values (2798 JC 27E0), read here from
// the DS image itself; and the session's copy of the defaults is a deep one.
{
  const { DEFAULT_SETTINGS, freshDefaultSettings } = await import('../src/formats/globaldata.js')
  const exe = readFileSync(join(ROOT, 'game', 'MICROU.EXE'))
  const ds = exe.readUInt16LE(8) * 16 + (0x193c - 0x1000) * 16
  const w = (o) => exe.readUInt16LE(ds + o)
  check(`no SETTINGS.DAT: the thresholds are [28FD]..[2907]'s static ${w(0x28fd)}/${w(0x28ff)}, ${w(0x2905)}/${w(0x2907)}`,
    DEFAULT_SETTINGS.joystick1.left === w(0x28fd) && DEFAULT_SETTINGS.joystick1.right === w(0x28ff) && DEFAULT_SETTINGS.joystick2.left === w(0x2905) && DEFAULT_SETTINGS.joystick2.right === w(0x2907))
  check('no SETTINGS.DAT: a centred pad reads no direction, a full deflection does', joystickByte(readGamePort([pad(0)]), 1, DEFAULT_SETTINGS.joystick1) === 0 && joystickByte(readGamePort([pad(-1)]), 1, DEFAULT_SETTINGS.joystick1) === 0x80)
  const a = freshDefaultSettings(); a.joystick1.left = 99; a.keys1[0] = 0
  check('freshDefaultSettings: a deep copy -- F7 and F5 editing it leave the defaults alone', DEFAULT_SETTINGS.joystick1.left === w(0x28fd) && DEFAULT_SETTINGS.keys1[0] === 0x2c)
}

// 2D00's reader per control word.
{
  const kb = (sc) => ({ read: () => sc[0], dispose() {} })
  const env = { keyboard: kb, keys1: [1], keys2: [2], getGamepads: () => [pad(-1, 0, [0])], thresholds: () => SHIPPED, mouse: createMouseDriver() }
  check('2D00: 4 KEYS 1, 5 KEYS 2, 1 JOY 1, 2 JOY 2 (no second pad: timed out, right), 3 MOUSE (first read right), 6 nothing',
    createControlReader(4, env).read() === 1 && createControlReader(5, env).read() === 2 && createControlReader(1, env).read() === 0xa8 &&
    createControlReader(2, env).read() === 0x40 && createControlReader(3, env).read() === 0x40 && createControlReader(6, env).read() === 0)
}

// The options gates with the detected count; MOUSE never (the static [2627]=0).
{
  const avail = (n) => ({ joy1: n !== 0, joy2: n === 2, mouse: false })
  const cycleAll = (start, other, p1, n) => { const seen = []; let v = start; for (let i = 0; i < 6; i++) { v = cycleControl(v, other, p1, avail(n)); seen.push(v) } return [...new Set(seen)].sort().join() }
  check('F1 with one stick: KEYS 1, KEYS 2, JOY 1 -- never JOY 2 or MOUSE', cycleAll(5, 6, true, 1) === '1,4,5')
  check('F2 with two sticks: adds JOY 2; MOUSE still never', cycleAll(4, 6, false, 2) === '1,2,4,5')
  check('F1 with no stick: KEYS only', cycleAll(5, 6, true, 0) === '4,5')
}

// The fire preempt by device (4D4B-4D70), as the live test showed: 0xA8 held -- a mouse car neither
// steers nor accelerates, a joystick car turns and speeds up.
{
  const car = () => ({ heading: 0, speed: 0, steerStep: 3, accel: 16, maxSpeedCur: 900, brakeDecel: 16, reverseLimit: -200, coastDecel: 8, height: 0, lapsRemaining: 3, isDrone: 0, drawnThisFrame: 1, reloadCooldown: 0 })
  const ctx = { round: 2, raceFormat: 1 }
  const mouse = car(); applySteerAndThrottle(mouse, 0xa8, ctx, false, 0, 3)
  const joy = car(); applySteerAndThrottle(joy, 0xa8, ctx, false, 0, 1)
  check('preempt: mouse (3) with 0xA8 -- heading and speed unchanged (live: 4D70 taken, 4DB4 never reached)', mouse.heading === 0 && mouse.speed === 0)
  check('preempt: JOY 1 (1) with 0xA8 -- turns left and accelerates (live: 4DB4 reached, heading 253, speed rising)', joy.heading === 253 && joy.speed > 0)
}

// The screens against the live frames, rows 30-199 (above is the menu background 0400, Part F).
{
  const { arena } = await buildArena(async (n) => new Uint8Array(readFileSync(join(ROOT, 'game', n))))
  const ref = (name) => readFileSync(join(ROOT, 'tools', 'refs', 'front', `${name}_a000.bin`))
  const diff = (buf, r) => { let n = 0; for (let y = 30; y < 200; y++) for (let x = 0; x < 256; x++) if (buf[y * 256 + x] !== r[y * 320 + x + 32]) n++; return n }
  const settings = { p1Control: 5, p2Control: 4, soundDriver: 1, smoothness: 1 }
  let buf = createMenuBuffer(); drawOptionsScreen(buf, arena, { settings, joystick: true })
  const n1 = diff(buf, ref('options_f7'))
  check(`options with F7 (a stick detected): ${n1} pixels differ from the live frame below the header`, n1 === 0)
  buf = createMenuBuffer(); drawOptionsScreen(buf, arena, { settings, joystick: false })
  check('options without a stick: no F7 line', diff(buf, ref('options_f7')) > 0)
  buf = createMenuBuffer(); drawJoystickCalibrationScreen(buf, arena, { columns: [['CENTRE'], null], prompt: true })
  const n2 = diff(buf, ref('joycal_centre'))
  check(`F7 CENTRE: ${n2} pixels differ from the live frame below the header`, n2 === 0)
  buf = createMenuBuffer(); drawJoystickCalibrationScreen(buf, arena, { columns: [['CENTRE', 'LEFT', 'RIGHT'], null], prompt: true })
  const n3 = diff(buf, ref('joycal_right'))
  check(`F7 RIGHT: ${n3} pixels differ from the live frame below the header`, n3 === 0)
}

console.log(bad ? `${bad} check(s) failed` : 'check-devices: JOY 1/JOY 2/MOUSE readers, the port model, 3A12, the F7 calibration, the mouse driver defaults, the per-device fire preempt and the options/F7 screens all match the disassembly and the live captures')
process.exitCode = bad ? 1 : 0
