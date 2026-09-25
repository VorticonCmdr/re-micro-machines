// PRESS ANY KEY's own wait, FUN_1000_0C15 (docs/engine.md §9bt, src/frontend/pressAnyKey.js).
// Proves, against the disassembly:
//  - any key release leaves on its tick (0C4E), a key merely held does not;
//  - P1's fire HELD leaves at once, with no debounce (0C55-0C5A) -- a fire held from the previous
//    screen leaves on the very first tick;
//  - the timeout is checked right after each tick's poll, so it lands on tick 700 exactly (0C37);
//  - a release on the timeout tick itself wins (the poll comes first).
// P2's fire not counting is a property of the caller ([0x1080]=0x137B, flow.js reads P1's reader
// only), checked live, not here.
//   node tools/check-pressanykey.mjs
import { pressAnyKeyInitialState, pressAnyKeyStep, PRESS_ANY_KEY_TIMEOUT_TICKS } from '../src/frontend/pressAnyKey.js'

let bad = 0
function check(name, cond) {
  if (cond) return
  bad++
  console.log(`FAIL: ${name}`)
}
function run(input, max = 2000) {
  const s = pressAnyKeyInitialState()
  for (let t = 1; t <= max; t++) {
    const r = pressAnyKeyStep(s, typeof input === 'function' ? input(t) : input)
    if (r.exit) return { exit: r.exit, at: t }
  }
  return { exit: null, at: null }
}

check('timeout comparand is 0x2BC', PRESS_ANY_KEY_TIMEOUT_TICKS === 700)

const idle = run({})
check('no input: times out on tick 700 exactly', idle.exit === 'timeout' && idle.at === 700)

const rel = run((t) => ({ anyKeyReleased: t === 50 }))
check('a release leaves on its own tick', rel.exit === 'dismiss' && rel.at === 50)

const held = run({ p1FireHeld: true })
check('P1 fire held from before the screen: leaves on the first tick, no debounce', held.exit === 'dismiss' && held.at === 1)

const late = run((t) => ({ p1FireHeld: t >= 300 }))
check('P1 fire pressed at tick 300: leaves at 300', late.exit === 'dismiss' && late.at === 300)

const onTimeout = run((t) => ({ anyKeyReleased: t === 700 }))
check('a release on tick 700 itself is a dismiss, not a timeout (the poll runs first)', onTimeout.exit === 'dismiss' && onTimeout.at === 700)

console.log(bad ? `${bad} check(s) failed` : 'check-pressanykey: 0C15\'s own wait -- any release or P1 fire held (no debounce) leaves, timeout on tick 700 -- matches the disassembly')
process.exitCode = bad ? 1 : 0
