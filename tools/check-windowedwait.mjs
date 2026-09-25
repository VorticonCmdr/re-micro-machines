// The shared "call 17FF until something happens" loop (src/frontend/windowedWait.js, docs/engine.md
// §9br), and the results screen that now runs on it (ShowRaceResultsScreenTune8or6 1000:1618-164E,
// CX=0xF, the [0x261F] check before every 17FF call). Proves:
//  - the results screen's windows are 16 ticks, the latch is cleared at each, [261F] is sampled at
//    every window end and the timeout lands on tick 704;
//  - checkPeriod/checkOffset place the samples exactly (every window; every 2nd; the 1st of each pair);
//  - a fire held from before the screen keeps it waiting through window after window, and still
//    times out; release then a fresh press, or any release, dismisses;
//  - the per-window state is fresh after every window: a press that is down at a new window's first
//    poll counts as already held there, and only its release (via the latch) dismisses.
//   node tools/check-windowedwait.mjs
import { windowedWaitInitialState, windowedWaitStep, WINDOWED_WAIT_TIMEOUT_TICKS, RESULTS_17FF_CX } from '../src/frontend/windowedWait.js'

let bad = 0
function check(name, cond) {
  if (cond) return
  bad++
  console.log(`FAIL: ${name}`)
}
function run(s, input, max = 2000) {
  const checks = []
  const resets = []
  for (let t = 1; t <= max; t++) {
    const r = windowedWaitStep(s, typeof input === 'function' ? input(t) : input)
    if (r.timeoutChecked) checks.push(t)
    if (r.resetLatch) resets.push(t)
    if (r.exit) return { exit: r.exit, at: t, checks, resets }
  }
  return { exit: null, at: null, checks, resets }
}

check('timeout comparand is 0x2BC', WINDOWED_WAIT_TIMEOUT_TICKS === 700)
check('the results screen calls 17FF with CX=0xF', RESULTS_17FF_CX === 15)

// 1. The results screen: 16-tick windows, a sample at every window end, timeout on tick 704.
{
  const r = run(windowedWaitInitialState({ cx: RESULTS_17FF_CX }), {})
  check('results: times out on tick 704', r.exit === 'timeout' && r.at === 704)
  check('results: [261F] sampled at every window end (16, 32, ..., 704)', r.checks.length === 44 && r.checks.every((t, i) => t === 16 * (i + 1)))
  check('results: the latch is cleared at every new window (16, ..., 688)', r.resets.length === 43 && r.resets.every((t, i) => t === 16 * (i + 1)))
}

// 2. checkPeriod/checkOffset place the samples: every 2nd window, or the 1st of each pair.
{
  const two = run(windowedWaitInitialState({ cx: 15, checkPeriod: 2 }), {})
  check('checkPeriod 2: samples at 32, 64, ...; timeout at 704', two.checks.every((t, i) => t === 32 * (i + 1)) && two.at === 704)
  const off = run(windowedWaitInitialState({ cx: 15, checkPeriod: 2, checkOffset: 1 }), {})
  check('checkPeriod 2, offset 1: samples at 16, 48, 80, ...; timeout at 720', off.checks.every((t, i) => t === 16 + 32 * i) && off.at === 720)
}

// 3. A fire held from before the screen: never dismisses, still times out.
{
  const r = run(windowedWaitInitialState({ cx: RESULTS_17FF_CX }), { fireHeld: true })
  check('fire held throughout: times out on tick 704, never dismisses', r.exit === 'timeout' && r.at === 704)
}

// 4. Release then a fresh press dismisses -- also across a window boundary.
{
  const r = run(windowedWaitInitialState({ cx: RESULTS_17FF_CX }), (t) => ({ fireHeld: t <= 5 || t >= 8 }))
  check('held to tick 5, released, pressed again at 8 (same window): dismisses at 8', r.exit === 'dismiss' && r.at === 8)
  // A press that is down at a NEW window's first poll counts as already held there (17FF's first
  // poll, 182C, sends a held fire to its release-wait stage): no dismiss on the press itself. The same key's release -- it was pressed
  // after that window's latch clear, so the tracker holds it -- is what dismisses.
  const w = run(windowedWaitInitialState({ cx: RESULTS_17FF_CX }), (t) => ({ fireHeld: t <= 15 || (t >= 18 && t < 30), anyKeyReleased: t === 30 }))
  check('held to 15, pressed again at 18 (a new window started at 17): no dismiss on the press; its release at 30 dismisses', w.exit === 'dismiss' && w.at === 30)
  const q = run(windowedWaitInitialState({ cx: RESULTS_17FF_CX }), (t) => ({ anyKeyReleased: t === 40 }))
  check('any release dismisses on its tick', q.exit === 'dismiss' && q.at === 40)
}

console.log(bad ? `${bad} check(s) failed` : 'check-windowedwait: the repeated-17FF wait loop (16-tick results windows, latch cleared at each, [261F] sampled on the screen\'s own schedule, timeout at 704 for the results screen) matches the disassembly')
process.exitCode = bad ? 1 : 0
