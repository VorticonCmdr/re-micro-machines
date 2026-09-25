// The ESC quit from a race (docs/engine.md §9ca, src/engine/raceEnd.js). Proves, against the
// disassembly:
//  - [0x1096] is latched by an ESC key RELEASE only (KeyboardIsr 2F59-2F5E): not by the press, not
//    by any other key's release, and a disposed latch (a new race, 3CB6's clear) ignores later ones;
//  - the ESC exit (3067 -> 3115) goes straight into the 327A fade: no hold and no AH=8/AH=6 --
//    nothing is sent to the sound driver at all -- and it still ends ('done');
//  - the normal exit keeps its 100-tick hold, then AH=8/AH=6, then the fade (unchanged).
// The flow side (the loop-head test, the pause ending on the release, an ESC during the normal
// exit still going to the title) is checked live in game.html (§9ca).
//   node tools/check-escquit.mjs
import { createRaceEndState, updateRaceEnd, createEscQuitLatch, RACE_END_HOLD_MS } from '../src/engine/raceEnd.js'

let bad = 0
function check(name, cond) {
  if (cond) return
  bad++
  console.log(`FAIL: ${name}`)
}

const key = (type, code) => Object.assign(new Event(type), { code })

// --- the latch
{
  const target = new EventTarget()
  const latch = createEscQuitLatch(target)
  check('a fresh latch is clear', latch.latched === false)
  target.dispatchEvent(key('keydown', 'Escape'))
  check('the ESC press alone does not latch (2F41: presses take the JNS branch)', latch.latched === false)
  target.dispatchEvent(key('keyup', 'KeyA'))
  check('another key\'s release does not latch (2F59: CMP AH,1)', latch.latched === false)
  target.dispatchEvent(key('keyup', 'Escape'))
  check('the ESC release latches (2F5E: MOV [0x1096],1)', latch.latched === true)
  latch.dispose()
  const next = createEscQuitLatch(target)
  target.dispatchEvent(key('keydown', 'Escape'))
  check('the next race starts clear (3CB6), and a disposed latch stops listening', next.latched === false)
  next.dispose()
}

// --- the exits
function run(state, maxMs = 10000) {
  const calls = []
  const sound = { stopSfx: (a) => calls.push(`stopSfx(${a})`), muteAll: () => calls.push('muteAll') }
  const phases = [state.phase]
  let t = 0
  while (state.phase !== 'done' && t < maxMs) {
    updateRaceEnd(state, 10, sound)
    t += 10
    if (phases[phases.length - 1] !== state.phase) phases.push(state.phase)
  }
  return { calls, phases, t }
}

const esc = run(createRaceEndState({ esc: true }))
check('ESC exit: straight into the fade, no hold (3067 -> 3115 -> 327A)', esc.phases.join('>') === 'fade>done')
check('ESC exit: nothing sent to the driver (30DF-3113 skipped: no AH=8, no AH=6)', esc.calls.length === 0)

const normal = run(createRaceEndState())
check('normal exit: hold, then fade, then done', normal.phases.join('>') === 'hold>fade>done')
check('normal exit: AH=8 then AH=6 after the hold (3102/3109)', normal.calls.join() === 'stopSfx(120),muteAll')
check('normal exit takes the 100-tick hold longer than the ESC exit', normal.t - esc.t >= RACE_END_HOLD_MS - 10)

console.log(bad ? `${bad} check(s) failed` : 'check-escquit: ESC latches on its release only, and the ESC exit skips the jingle, the hold and AH=8/AH=6 but keeps the fade, as 2F59/3067/3115 do')
process.exitCode = bad ? 1 : 0
