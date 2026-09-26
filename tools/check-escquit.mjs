// The ESC quit from a race (docs/engine.md §9ca, src/engine/raceEnd.js). Proves, against the
// disassembly:
//  - [0x1096] is latched by an ESC key RELEASE only (KeyboardIsr 2F59-2F5E), and only one that gets
//    through the ISR's release gate: [0x107E] already nonzero, or ESC being the tracked [0x107F] key
//    (2F43-2F4E) -- so with [0x107E]=0 and a held key tracked, ESC is ignored until that key's release;
//  - the ESC exit (3067 -> 3115) goes straight into the 327A fade: no hold and no AH=8/AH=6 --
//    nothing is sent to the sound driver at all -- and it still ends ('done');
//  - the normal exit keeps its 100-tick hold, then AH=8/AH=6, then the fade (unchanged).
// The flow side (the loop-head test, the pause ending on the release, an ESC during the normal
// exit still going to the title) is checked live in game.html (§9ca).
//   node tools/check-escquit.mjs
import { createRaceEndState, updateRaceEnd, RACE_END_HOLD_MS } from '../src/engine/raceEnd.js'
import { createMenuReleaseTracker } from '../src/engine/input.js'

let bad = 0
function check(name, cond) {
  if (cond) return
  bad++
  console.log(`FAIL: ${name}`)
}

const key = (type, code) => Object.assign(new Event(type), { code })

// --- the ISR's release gate and [0x1096] (menuReleaseTracker's mirrored cells, 2F41-2F6C)
{
  const target = new EventTarget()
  const t = createMenuReleaseTracker(target)
  const down = (c) => target.dispatchEvent(key('keydown', c))
  const up = (c) => target.dispatchEvent(key('keyup', c))
  const tap = (c) => { down(c); up(c) }

  tap('Escape')
  check('ESC first after a clear: tracked, so its release latches [0x1096]', t.escQuit() === true && t.isrState().latch === 'Escape')
  t.clearEscQuit(); t.reset()

  down('Escape')
  check('the ESC press alone does not latch (2F41: presses take the JNS branch)', t.escQuit() === false)
  up('Escape'); t.clearEscQuit(); t.reset()

  down('ArrowLeft') // tracked in [0x107F]
  tap('Escape')
  check('[0x107E]=0 and another key tracked: the ESC release is ignored (2F4A-2F4E) -- live-proven', t.escQuit() === false && t.isrState().latch === null && t.isrState().tracked === 'ArrowLeft')
  up('ArrowLeft')
  check('the tracked key\'s release latches [0x107E] (2F50-2F55)', t.isrState().latch === 'ArrowLeft' && t.isrState().tracked === null)
  tap('Escape')
  check('once [0x107E] is nonzero, the ESC release latches whatever is tracked (2F43-2F48) -- live-proven', t.escQuit() === true && t.isrState().latch === 'Escape')

  t.clearEscQuit()
  down('ArrowUp'); down('Escape') // Up tracked; [0x107E] still nonzero from before
  up('Escape')
  check('[0x107E] nonzero: an untracked ESC still latches (the ungated branch)', t.escQuit() === true)
  up('ArrowUp')

  t.clearEscQuit(); t.clearIsrLatch() // the pause entry, 377F/3784
  down('ArrowUp') // auto-repeat re-tracks a held key
  tap('Escape')
  check('after the pause entry clear, with a key held, an ESC release does nothing', t.escQuit() === false)
  t.dispose()
}

// --- [107C], the ISR's 16-key word (KeyboardIsr 2F70-2F8D, docs/engine.md §9cn): slot i -> 0x8000>>i,
// the first slot a scancode matches; the order is KEYS1 x5, F1-F3, KEYS2 x5, D/SPACE/V.
{
  const { createIsrKeyWordReader } = await import('../src/engine/input.js')
  const target = new EventTarget()
  const sc = [0x24, 0x26, 0x17, 0x32, 0x25, 0x3b, 0x3c, 0x3d, 0x4b, 0x4d, 0x48, 0x50, 0x1f, 0x20, 0x39, 0x2f] // this copy's SETTINGS.DAT
  const w = createIsrKeyWordReader(sc, target)
  const down = (c) => target.dispatchEvent(key('keydown', c))
  const up = (c) => target.dispatchEvent(key('keyup', c))
  down('F1'); down('F2')
  check('[107C]: F1+F2 is 0x0600 (slots 5/6)', w.read() === 0x0600)
  up('F1'); down('F3')
  check('[107C]: F2+F3 is 0x0300', w.read() === 0x0300)
  down('Space')
  check('[107C]: SPACE (slot 14) is bit 0x0002', w.read() === 0x0302)
  up('F2'); up('F3'); up('Space')
  check('[107C]: all released -> 0', w.read() === 0)
  const dup = createIsrKeyWordReader([0x1f, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x1f, 0, 0, 0], target)
  down('KeyS')
  check('[107C]: a scancode in two slots sets only the first (2F70 stops at the first match)', dup.read() === 0x8000)
  up('KeyS'); w.dispose(); dup.dispose()
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

console.log(bad ? `${bad} check(s) failed` : 'check-escquit: ESC latches on its release only, through the ISR\'s release gate, and the ESC exit skips the jingle, the hold and AH=8/AH=6 but keeps the fade, as 2F59/3067/3115 do')
process.exitCode = bad ? 1 : 0
