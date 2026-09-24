// P3's third item (GOAL-DOS-PARITY.md): ShowCharacterEliminatedTune6 1000:16de's own 17-step
// bounce animation (docs/engine.md §9ba). Proves:
//  - the wobble table matches DS:034B exactly (16 real steps, the 17th byte is a terminator only);
//  - each step holds for exactly WOBBLE_STEP_TICKS (9) ticks, not one early or late;
//  - the frame alternates every step, starting frameOn=true on the very first rendered step (the
//    real loop toggles BEFORE every draw, including the first);
//  - the animation always runs to completion in exactly 16*9=144 ticks and never asks for input.
//   node tools/check-elimination.mjs
import { eliminationInitialState, eliminationStep, WOBBLE_TABLE, WOBBLE_STEP_TICKS } from '../src/frontend/elimination.js'

let bad = 0
function check(name, cond) {
  if (cond) return
  bad++
  console.log(`FAIL: ${name}`)
}

check('WOBBLE_TABLE has 16 real steps (DS:034B\'s own 17 bytes minus the 0 terminator)', WOBBLE_TABLE.length === 16)
check('WOBBLE_TABLE matches DS:034B exactly', WOBBLE_TABLE.join() === [2, 4, 8, 16, 32, 47, 32, 16, 8, 4, 2, 4, 8, 16, 32, 47].join())
check('WOBBLE_STEP_TICKS is 9 (1000:177F/1784, literal)', WOBBLE_STEP_TICKS === 9)

// 1. The initial state already represents the FIRST rendered frame (frameOn=true, step=0) -- the
// real loop toggles the frame BEFORE every draw, including the first (1000:175B, ahead of the
// 0630/04BD blit pair), so the pre-loop frame (charIndex*2) is set but never itself drawn.
{
  const s = eliminationInitialState()
  check('starts at step 0', s.step === 0)
  check('starts with frameOn=true (the first toggle has already conceptually happened)', s.frameOn === true)
}

// 2. Each step holds for exactly WOBBLE_STEP_TICKS ticks, not one early or late, and the frame
// toggles exactly on the step boundary.
{
  const s = eliminationInitialState()
  for (let i = 0; i < WOBBLE_STEP_TICKS - 1; i++) {
    const r = eliminationStep(s)
    check(`tick ${i + 1}: not yet advanced`, r.done === false && s.step === 0 && s.frameOn === true)
  }
  const r = eliminationStep(s) // the boundary tick
  check('at the boundary: advances to step 1 and toggles the frame', r.done === false && s.step === 1 && s.frameOn === false)
}

// 3. The animation runs to completion in exactly 16*9=144 ticks (16 steps, each held 9 ticks), and
// signals `done` on the tick that would have started a 17th step -- matching the real loop reading
// the table's own 17th (terminator) byte and exiting without a draw or a wait for it.
{
  const s = eliminationInitialState()
  let done = false
  let ticks = 0
  while (!done && ticks < 1000) {
    const r = eliminationStep(s)
    ticks++
    if (r.done) done = true
  }
  check('the bounce completes in exactly 144 ticks (16 steps x 9 ticks)', done && ticks === 144)
  // Regression for a real bug (docs/engine.md §9ba): `state.step` must freeze at 15
  // (WOBBLE_TABLE.length-1, the last real draw), never advance to 16 -- the real loop's own exit
  // reads the table's 17th/terminator byte WITHOUT a 17th draw, so nothing past index 15 is ever
  // drawn or should ever be indexed. An earlier draft let step reach 16, which made screens.js's
  // own `WOBBLE_TABLE[step] ?? 0` silently fall back to Y-offset 0.
  check('state.step freezes at 15 once done, never reaches 16', s.step === WOBBLE_TABLE.length - 1)
  check('WOBBLE_TABLE[state.step] is defined (47) once done -- no ?? 0 fallback ever needed', WOBBLE_TABLE[s.step] === 47)
  check('state.done is true once the bounce finishes', s.done === true)
  // Calling eliminationStep again after done stays latched (idempotent), matching the real screen
  // simply sitting there through the whole indefinite 179B wait -- not waiting another 9 ticks.
  const rAfterDone = eliminationStep(s)
  check('calling eliminationStep again after done keeps signalling done immediately, without waiting another 9 ticks', rAfterDone.done === true && s.step === WOBBLE_TABLE.length - 1)
}

// 4. eliminationStep takes no input parameter at all -- the real loop never polls input inside the
// bounce (no CALL 2D5B anywhere in 1000:174D-1789, unlike every other menu wait in this project).
// This is really just documentation: calling it with an extra argument has no effect, since the
// function's own signature never reads a second parameter.
{
  const s = eliminationInitialState()
  const r1 = eliminationStep(s)
  const s2 = eliminationInitialState()
  const r2 = eliminationStep(s2, { escReleased: true, bits: 0xff })
  check('an (ignored) input argument changes nothing', r1.done === r2.done && s.step === s2.step && s.frameOn === s2.frameOn)
}

console.log(bad ? `${bad} check(s) failed` : 'check-elimination: ShowCharacterEliminatedTune6\'s real 16-step/144-tick wobble bounce matches the disassembly')
process.exitCode = bad ? 1 : 0
