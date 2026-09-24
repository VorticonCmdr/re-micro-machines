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

console.log(bad ? `${bad} check(s) failed` : 'check-smoothness: draw gate matches the documented n=1..4 (smoothest..chunkiest) semantics')
process.exitCode = bad ? 1 : 0
