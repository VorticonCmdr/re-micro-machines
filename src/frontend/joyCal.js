// F7 on GAME OPTIONS: `JoystickCalibration 1000:2AB5` (docs/engine.md §9cu). For stick 1, then --
// only when `[2625]==2` (`2B20`) -- stick 2: draw the label, then `2B93`'s stage. A stage clears the
// key latches (`2B98`), waits until that stick's buttons are all up (`2BA6`: mask 0x30 for stick 1,
// 0xC0 for stick 2, against the inverted port byte), then loops -- the prompt on screen -- until one
// of them is down or ENTER has been released (`[107E]==0x1C`), and reads the counts (`2FFE`: stick 1's
// X, or stick 2's). CENTRE is kept; LEFT and RIGHT each store `(centre + reading) >> 1` as that
// stick's threshold straight away (`2B02`/`2B1C`, `2B67`/`2B82`). Live: with no stick present the
// readings time out, so both thresholds become 30000.

import { calibrationThreshold } from '../engine/devices.js'
import { JOYCAL_LABELS } from '../data/frontend-tables.js'

/** `sticks`: `[2625]`. `thresholds`: `{1: {left,right}, 2: {left,right}}`, written in place. */
export function createJoyCal(sticks, thresholds) {
  return { sticks, thresholds, stick: 1, step: 0, phase: 'release', centre: 0, columns: [[JOYCAL_LABELS[0]], null], done: false }
}

/** One pass of the current stage's loop. `port`: `devices.js` `readGamePort()`; `enterReleased`:
 * an ENTER release since the stage began (the caller clears its latch when `stageStarted` comes
 * back true). Returns `{ stageStarted }`. */
export function joyCalStep(cal, port, enterReleased) {
  if (cal.done) return { stageStarted: false }
  const mask = cal.stick === 1 ? 0x30 : 0xc0
  const down = (port.buttons & mask) !== 0
  if (cal.phase === 'release') {
    if (!down) cal.phase = 'wait'
    return { stageStarted: false }
  }
  if (!down && !enterReleased) return { stageStarted: false }
  const reading = cal.stick === 1 ? port.ax : port.bx
  const t = cal.thresholds[cal.stick]
  if (cal.step === 0) cal.centre = reading
  else if (cal.step === 1) t.left = calibrationThreshold(cal.centre, reading)
  else t.right = calibrationThreshold(cal.centre, reading)
  cal.step++
  if (cal.step < 3) {
    cal.columns[cal.stick - 1].push(JOYCAL_LABELS[cal.step])
  } else if (cal.stick === 1 && cal.sticks >= 2) {
    cal.stick = 2
    cal.step = 0
    cal.columns[1] = [JOYCAL_LABELS[0]]
  } else {
    cal.done = true
    return { stageStarted: false }
  }
  cal.phase = 'release'
  return { stageStarted: true }
}
