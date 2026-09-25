// The outcome-message screen's own wait, ShowRaceOutcomeMessageTune8or6 1000:1C1B (docs/engine.md
// §9bq, src/frontend/outcomeWait.js). Proves, against the disassembly:
//  - codes 2/3 (ONE_LIFE_LOST/EXTRA_LIFE) take the LIVES path, every other code the SIMPLE path;
//  - SIMPLE: 16-tick 17FF(CX=15) windows, the release latch cleared at every window's start, the
//    ~700-tick timeout checked only between windows (exit at tick 704), BOTH players' fire combined,
//    a fire held into a window debounced (release first, then a fresh press dismisses);
//  - LIVES: no input read at all during the 30-iteration x 5-tick silent slide, so a release made
//    then is still latched at the first poll (tick 156) and acted on there; polls every 6 ticks
//    after; P1's fire HELD dismisses at once (no debounce) but P2's does not; ']' released is the
//    lives cheat, checked before the generic release; timeout at tick 702;
//  - raceResultWaitStep's new `cx` parameter: default unchanged (20), 15 gives a 16-tick window.
// The exact tick numbers hold under outcomeWait.js's own assumptions (a)-(c): only the timer ISR
// advances CS:[0x4ADE], the port has no entry draw/fade time, and each draw group fits in a tick.
//   node tools/check-outcomewait.mjs
import { outcomeWaitInitialState, outcomeWaitStep, OUTCOME_TIMEOUT_TICKS, OUTCOME_17FF_CX, OUTCOME_CHEAT_KEY } from '../src/frontend/outcomeWait.js'
import { raceResultWaitInitialState, raceResultWaitStep, RACE_RESULT_WAIT_TICKS } from '../src/frontend/twoHuman.js'
import { OUTCOME } from '../src/frontend/tournament.js'

let bad = 0
function check(name, cond) {
  if (cond) return
  bad++
  console.log(`FAIL: ${name}`)
}
const none = () => ({ p1FireHeld: false, anyFireHeld: false, releasedCode: null })

check('timeout comparand is 0x2BC', OUTCOME_TIMEOUT_TICKS === 700)
check('17FF CX is 0xF', OUTCOME_17FF_CX === 15)
check("the cheat key is ']' (scancode 0x1B)", OUTCOME_CHEAT_KEY === 'BracketRight')

// 1. Path selection.
for (const [name, code] of Object.entries(OUTCOME)) {
  const lives = code === 2 || code === 3
  check(`${name} (${code}) takes the ${lives ? 'LIVES' : 'SIMPLE'} path`, outcomeWaitInitialState(code).path === (lives ? 'LIVES' : 'SIMPLE'))
}

// 2. raceResultWaitStep's cx: default 20 (256E unchanged), 15 retoggles on the 16th tick.
for (const [cx, expect] of [[undefined, RACE_RESULT_WAIT_TICKS + 1], [15, 16]]) {
  const s = raceResultWaitInitialState()
  let at = null
  for (let i = 1; i <= 40 && at == null; i++) if (raceResultWaitStep(s, {}, cx).exit === 'retoggle') at = i
  check(`raceResultWaitStep cx=${cx ?? 'default'} retoggles on tick ${expect}`, at === expect)
}

// 3. SIMPLE: timeout exactly at tick 704, latch reset at every window boundary (every 16 ticks).
{
  const s = outcomeWaitInitialState(OUTCOME.PASSED)
  const resets = []
  let exitAt = null
  for (let t = 1; t <= 800; t++) {
    const r = outcomeWaitStep(s, none)
    if (r.resetLatch) resets.push(t)
    if (r.exit) { check('SIMPLE, no input: the exit is a timeout', r.exit === 'timeout'); exitAt = t; break }
  }
  check('SIMPLE timeout lands on tick 704 (the first 16-tick boundary at or past 700)', exitAt === 704)
  check('SIMPLE resets the latch at every 17FF window start (16, 32, ..., 688)', resets.length === 43 && resets.every((t, i) => t === 16 * (i + 1)))
}

// 4. SIMPLE: any release dismisses on that tick; P2's fire counts (combined).
{
  const s = outcomeWaitInitialState(OUTCOME.QUALIFIER_FAILED)
  for (let t = 0; t < 5; t++) outcomeWaitStep(s, none)
  check('SIMPLE: a release dismisses', outcomeWaitStep(s, () => ({ ...none(), releasedCode: 'Enter' })).exit === 'dismiss')
  const s2 = outcomeWaitInitialState(OUTCOME.NO_BONUS)
  outcomeWaitStep(s2, none) // fire not held: into AWAIT_PRESS
  check('SIMPLE: a fresh P2-only fire press dismisses (17FF combines both players)', outcomeWaitStep(s2, () => ({ ...none(), anyFireHeld: true })).exit === 'dismiss')
}

// 5. SIMPLE: fire held into the screen is debounced across window boundaries, then release + press.
{
  const s = outcomeWaitInitialState(OUTCOME.QUALIFIED_FOR_HEAD_TO_HEAD)
  const held = () => ({ p1FireHeld: true, anyFireHeld: true, releasedCode: null })
  let exited = false
  for (let t = 0; t < 100; t++) if (outcomeWaitStep(s, held).exit) exited = true
  check('SIMPLE: a fire held from before the screen never dismisses while held (100 ticks)', !exited)
  check('SIMPLE: releasing it does not dismiss', outcomeWaitStep(s, none).exit === null)
  check('SIMPLE: a fresh press then dismisses', outcomeWaitStep(s, held).exit === 'dismiss')
}

// 6. LIVES: input is read only when the real code polls -- first at tick 156, then every 6.
{
  const s = outcomeWaitInitialState(OUTCOME.ONE_LIFE_LOST)
  const reads = []
  let t = 0
  let exitAt = null
  while (t < 800) {
    t++
    const r = outcomeWaitStep(s, () => { reads.push(t); return none() })
    if (r.exit) { check('LIVES, no input: the exit is a timeout', r.exit === 'timeout'); exitAt = t; break }
  }
  check('LIVES: first poll at tick 156 (30 silent 5-tick slide iterations, then 5 + 1)', reads[0] === 156)
  check('LIVES: then a poll every 6 ticks', reads.every((x, i) => i === 0 || x - reads[i - 1] === 6))
  check('LIVES: no poll at all during the slide', reads.every((x) => x >= 156))
  check('LIVES timeout lands on tick 702 (the first iteration start at or past 700)', exitAt === 702)
  check('LIVES: the last poll before the timeout is at tick 702', reads[reads.length - 1] === 702)
}

// 7. LIVES: a release made during the slide is acted on at the first poll, not discarded.
{
  const s = outcomeWaitInitialState(OUTCOME.EXTRA_LIFE)
  let latched = null
  let exitAt = null
  for (let t = 1; t <= 200 && exitAt == null; t++) {
    if (t === 35) latched = 'Enter' // released mid-slide; the latch just holds it
    const r = outcomeWaitStep(s, () => { const c = latched; latched = null; return { ...none(), releasedCode: c } })
    if (r.exit) { check('LIVES: that release dismisses', r.exit === 'dismiss'); exitAt = t }
  }
  check('LIVES: a mid-slide release is acted on at the first poll (tick 156)', exitAt === 156)
}

// 8. LIVES: P1 fire held dismisses at the first poll (no debounce); P2 fire does not.
{
  const s = outcomeWaitInitialState(OUTCOME.ONE_LIFE_LOST)
  let exitAt = null
  for (let t = 1; t <= 200 && exitAt == null; t++) if (outcomeWaitStep(s, () => ({ ...none(), p1FireHeld: true, anyFireHeld: true })).exit === 'dismiss') exitAt = t
  check('LIVES: P1 fire held from the start dismisses at the first poll, no debounce', exitAt === 156)
  const s2 = outcomeWaitInitialState(OUTCOME.ONE_LIFE_LOST)
  let exited = false
  for (let t = 1; t <= 400; t++) if (outcomeWaitStep(s2, () => ({ ...none(), anyFireHeld: true })).exit) exited = true
  check('LIVES: P2-only fire never dismisses (the fire test reads P1 only, [0x1080]=0x137B)', !exited)
}

// 9. LIVES: ']' released is the cheat, checked before the generic release; SIMPLE treats it as a plain release.
{
  const s = outcomeWaitInitialState(OUTCOME.EXTRA_LIFE)
  let r
  for (let t = 1; t <= 156; t++) r = outcomeWaitStep(s, () => ({ ...none(), p1FireHeld: true, releasedCode: 'BracketRight' }))
  check("LIVES: ']' released -> livesCheat, ahead of the release and fire exits", r.exit === 'livesCheat')
  const s2 = outcomeWaitInitialState(OUTCOME.PASSED)
  check("SIMPLE: ']' released is an ordinary dismiss", outcomeWaitStep(s2, () => ({ ...none(), releasedCode: 'BracketRight' })).exit === 'dismiss')
}

console.log(bad ? `${bad} check(s) failed` : 'check-outcomewait: 1C1B\'s two real waits -- SIMPLE (16-tick 17FF CX=15 windows, latch cleared each, timeout at 704, combined fire, held fire debounced) and LIVES (silent slide, first poll at 156 then every 6, a slide-time release kept, P1-only undebounced fire, the \']\' cheat first, timeout at 702) -- match the disassembly, under outcomeWait.js\'s assumptions (a)-(c)')
process.exitCode = bad ? 1 : 0
