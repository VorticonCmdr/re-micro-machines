// M3.10: the smoothness draw-gate. n=1 draws every step (smoothest); n=4 draws every 4th.
//   node tools/check-smoothness.mjs
import { createSmoothnessGate } from '../src/engine/smoothness.js'

let bad = 0
function check(name, cond) {
  if (cond) return
  bad++
  console.log(`FAIL: ${name}`)
}

{
  const g = createSmoothnessGate(1)
  const draws = Array.from({ length: 6 }, () => g.shouldDraw())
  check('n=1 draws every step', draws.every(Boolean))
}
{
  const g = createSmoothnessGate(4)
  const draws = Array.from({ length: 8 }, () => g.shouldDraw())
  check('n=4 draws on steps 4 and 8 only', JSON.stringify(draws) === JSON.stringify([false, false, false, true, false, false, false, true]))
}
{
  const g = createSmoothnessGate(1)
  g.shouldDraw()
  g.n = 3 // changing n resets the counter, so the new period starts clean
  const draws = Array.from({ length: 3 }, () => g.shouldDraw())
  check('setting n resets the counter', JSON.stringify(draws) === JSON.stringify([false, false, true]))
}
{
  const g = createSmoothnessGate(9)
  check('n is clamped to the documented 1..4 range', g.n === 4)
}

// Regression for the advisor-caught lifetime bug: src/frontend/flow.js's runOneRace used to share
// ONE gate across every race in a tournament, so a race ending mid-period left the next race's
// draws phase-shifted (its first draw landing early or late relative to a clean n-step period).
// The fix is a FRESH gate per race, not a reset method on a shared one -- confirm a fresh gate
// really does start clean regardless of how a differently-configured prior one ended.
{
  const raceOneGate = createSmoothnessGate(4)
  raceOneGate.shouldDraw(); raceOneGate.shouldDraw() // race 1 ends mid-period, at counter=2 of 4
  const raceTwoGate = createSmoothnessGate(4) // flow.js's fix: a new gate, not the same instance
  const draws = Array.from({ length: 4 }, () => raceTwoGate.shouldDraw())
  check('a fresh per-race gate is unaffected by a previous race ending mid-period', JSON.stringify(draws) === JSON.stringify([false, false, false, true]))
}

// [2638] (docs/engine.md §9ck): `countdown` is the value the next loop iteration finds -- n after a
// present (3064/30DA), 1 on the iteration that draws (90C5) -- and the pause's `[2638]=1` (37A0)
// makes the next step draw.
{
  const g = createSmoothnessGate(3)
  const seen = []
  for (let i = 0; i < 6; i++) { seen.push(g.countdown); g.shouldDraw() }
  check('[2638]: 3,2,1,3,2,1 at n=3, drawing on the 1s', seen.join() === '3,2,1,3,2,1')
  const one = createSmoothnessGate(1)
  one.shouldDraw()
  check('[2638]: always 1 at n=1 (so every race after the first gets the pre-loop render)', one.countdown === 1)
  const p = createSmoothnessGate(4)
  p.shouldDraw()
  p.forceNextDraw()
  check('[2638]: after the pause (37A0) the countdown is 1 and the next step draws', p.countdown === 1 && p.shouldDraw() === true && p.countdown === 4)
}

console.log(bad ? `${bad} check(s) failed` : 'check-smoothness: draw gate matches the documented n=1..4 (smoothest..chunkiest) semantics')
process.exitCode = bad ? 1 : 0
