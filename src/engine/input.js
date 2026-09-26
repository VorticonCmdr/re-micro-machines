// Human control-byte reader (PLAN-ENGINE.md D3: one pluggable reader among several -- `ai.js` is
// another). Keyboard only this milestone; gamepad/mouse are the same 5-bit-byte interface and are
// not implemented here. Bit order and key roles: docs/engine.md §6 (`KeyboardIsr 2efd`,
// `RunRedefineKeysScreen`'s slot labels) -- LEFT/RIGHT/ACCELERATE/BRAKE/SELECT(fire) map to bits
// 0x80/0x40/0x20/0x10/0x08, the same layout every reader (human or AI) produces.

// Standard PC/XT scancode -> browser KeyboardEvent.code (the same table flow.js's own OPTIONS
// screen uses in the other direction for F5's redefine-keys sub-screen, options.js/1000:ADF0),
// covering every key SETTINGS.DAT's own 1000:106C table or a custom redefine pass can produce:
// letters, the number row, arrows and space.
export const SCANCODE_TO_KEY_CODE = {
  0x02: 'Digit1', 0x03: 'Digit2', 0x04: 'Digit3', 0x05: 'Digit4', 0x06: 'Digit5',
  0x07: 'Digit6', 0x08: 'Digit7', 0x09: 'Digit8', 0x0a: 'Digit9', 0x0b: 'Digit0',
  0x1e: 'KeyA', 0x30: 'KeyB', 0x2e: 'KeyC', 0x20: 'KeyD', 0x12: 'KeyE', 0x21: 'KeyF', 0x22: 'KeyG',
  0x23: 'KeyH', 0x17: 'KeyI', 0x24: 'KeyJ', 0x25: 'KeyK', 0x26: 'KeyL', 0x32: 'KeyM', 0x31: 'KeyN',
  0x18: 'KeyO', 0x19: 'KeyP', 0x10: 'KeyQ', 0x13: 'KeyR', 0x1f: 'KeyS', 0x14: 'KeyT', 0x16: 'KeyU',
  0x2f: 'KeyV', 0x11: 'KeyW', 0x2d: 'KeyX', 0x15: 'KeyY', 0x2c: 'KeyZ',
  0x39: 'Space', 0x48: 'ArrowUp', 0x50: 'ArrowDown', 0x4b: 'ArrowLeft', 0x4d: 'ArrowRight',
}

const BIT_LEFT = 0x80, BIT_RIGHT = 0x40, BIT_ACCEL = 0x20, BIT_BRAKE = 0x10, BIT_FIRE = 0x08

/**
 * `scancodes`: `parseSettings(...).keys2` (or `.keys1`) -- [left, right, accelerate, brake,
 * fire], in that order (docs/engine.md §6). Returns `{ read(): number, dispose(): void }`.
 */
export function createKeyboardReader(scancodes, target = window) {
  const codes = scancodes.map((sc) => SCANCODE_TO_KEY_CODE[sc]).filter(Boolean)
  const held = new Set()
  const onDown = (e) => { if (codes.includes(e.code)) { held.add(e.code); e.preventDefault() } }
  const onUp = (e) => { if (codes.includes(e.code)) held.delete(e.code) }
  const onBlur = () => held.clear()
  target.addEventListener('keydown', onDown)
  target.addEventListener('keyup', onUp)
  target.addEventListener('blur', onBlur)

  return {
    read() {
      const [left, right, accel, brake, fire] = codes
      let bits = 0
      if (left && held.has(left)) bits |= BIT_LEFT
      if (right && held.has(right)) bits |= BIT_RIGHT
      if (accel && held.has(accel)) bits |= BIT_ACCEL
      if (brake && held.has(brake)) bits |= BIT_BRAKE
      if (fire && held.has(fire)) bits |= BIT_FIRE
      return bits
    },
    dispose() {
      target.removeEventListener('keydown', onDown)
      target.removeEventListener('keyup', onUp)
      target.removeEventListener('blur', onBlur)
    },
  }
}

/** SPACE (docs/engine.md §6: key slot 14, a bit of `[107C]` separate from the 5-bit control byte,
 * pause test at `3074`) -- tracked independently since it drives `engine/pause.js`'s own state
 * machine, not `runStep`'s per-car control byte. `read()` returns `{pressed, held}`: `pressed` is
 * an edge, true exactly once per fresh press (consumed on read), `held` is the live level (the
 * pause resume gate needs both). */
export function createPauseKeyReader(target = window) {
  let held = false
  let pressed = false
  const onDown = (e) => { if (e.code === 'Space') { if (!held) pressed = true; held = true; e.preventDefault() } }
  const onUp = (e) => { if (e.code === 'Space') held = false }
  const onBlur = () => { held = false }
  target.addEventListener('keydown', onDown)
  target.addEventListener('keyup', onUp)
  target.addEventListener('blur', onBlur)
  return {
    read() {
      const p = pressed
      pressed = false
      return { pressed: p, held }
    },
    dispose() {
      target.removeEventListener('keydown', onDown)
      target.removeEventListener('keyup', onUp)
      target.removeEventListener('blur', onBlur)
    },
  }
}

/**
 * The front end's global "which key was just released" latch (P2, GOAL-DOS-PARITY.md; the INT9
 * handler's own single-key tracker, 1000:2f43-2f6c, re-disassembled for the title/menu work). Every
 * menu screen that isn't reading a specific player's LEFT/RIGHT/FIRE bits (title's ESC-vs-other
 * test, `attract.js`) reads THIS instead: exactly one key is tracked at a time -- whichever is
 * pressed while nothing is already tracked -- and only THAT key's own release latches a result
 * (`escReleased` if its scancode is 1, `otherReleased` for anything else). **A key already HELD before `reset()`
 * LIKELY eventually gets tracked in the real game, correcting an earlier claim here that it never
 * does (docs/engine.md §9bn, GOAL-DOS-PARITY.md P3 regression) -- but this is an INFERENCE, not
 * itself observed live:** the ISR's own press handler (`2F65: CMP [0x107F],0` / `2F6C: MOV
 * [0x107F],AH`) re-tracks a key into `[0x107F]` on the next make code it sees once that cell is `0`
 * -- STATIC fact, direct from the disassembly -- and a real PC keyboard is ASSUMED to send
 * typematic AUTO-REPEAT make codes for a continuously-held key, which WOULD re-trigger that handler
 * shortly after `[0x107F]` is reset -- neither the auto-repeat timing nor a live capture of this
 * exact sequence was checked. With that inference, `tournament.js`'s own documented claim ("DOS
 * exits `179B` on that key's own later release") is the one that was right. This implementation's
 * own `onDown` below does NOT filter `e.repeat`, so a physically-held key's own OS-level auto-repeat
 * `keydown` events already re-populate `trackedCode` here the same way (once it's `null`), likely
 * matching DOS's real behaviour in practice, though at different timing constants and not itself
 * measured this session either. `reset()` mirrors the real code's many screen-entry
 * `[107e]=0;[107f]=0` writes (title, both menu levels, character select).
 *
 * `read()` also returns `code`, the released key's own `KeyboardEvent.code` (or `null`): the real
 * `[0x107E]` holds the released key's SCANCODE, not just a flag, and the outcome screen's own
 * `]` cheat tests it for `0x1B` (`1000:1DCD`, docs/engine.md §9bq).
 */
export function createMenuReleaseTracker(target = window) {
  let trackedCode = null
  let latch = null
  // The ISR's own cells, mirrored exactly (docs/engine.md §9ca): `[0x107E]` (isrLatch), `[0x107F]`
  // (isrTracked) and `[0x1096]` (escQuit). Unlike `latch` above, `[0x107E]` is never cleared by being
  // read, and once it is nonzero EVERY release latches (2F43-2F48), not only the tracked key's.
  let isrLatch = null
  let isrTracked = null
  let escQuit = false
  const onDown = (e) => {
    if (trackedCode == null) trackedCode = e.code
    if (isrTracked == null) isrTracked = e.code // 2F65-2F6C (auto-repeat makes re-tracking a held key)
  }
  const onUp = (e) => {
    if (isrLatch != null || isrTracked === e.code) { // 2F43-2F4E
      isrTracked = null
      isrLatch = e.code // 2F50-2F55
      if (e.code === 'Escape') escQuit = true // 2F59-2F5E
    }
    if (e.code !== trackedCode) return
    trackedCode = null
    latch = e.code
  }
  const onBlur = () => { trackedCode = null; isrTracked = null }
  target.addEventListener('keydown', onDown)
  target.addEventListener('keyup', onUp)
  target.addEventListener('blur', onBlur)
  return {
    read() {
      const result = { escReleased: latch === 'Escape', otherReleased: latch != null && latch !== 'Escape', code: latch }
      latch = null
      return result
    },
    reset() { trackedCode = null; latch = null; isrLatch = null; isrTracked = null },
    /** `[0x1096]`: an ESC release got through the ISR's gate since the last `clearEscQuit`. */
    escQuit() { return escQuit },
    /** `[0x1096]=0` (`InitRaceCarsFromTables 3CB6`, `0054`, ...). */
    clearEscQuit() { escQuit = false },
    /** `[0x107E]=0;[0x107F]=0` alone (the pause entry, `377F`/`3784`), leaving the port's own `latch`. */
    clearIsrLatch() { isrLatch = null; isrTracked = null },
    /** The mirrored cells, for checks and debugging. */
    isrState() { return { latch: isrLatch, tracked: isrTracked, escQuit } },
    dispose() {
      target.removeEventListener('keydown', onDown)
      target.removeEventListener('keyup', onUp)
      target.removeEventListener('blur', onBlur)
    },
  }
}

/**
 * The low three bits of a player's reader byte (docs/engine.md §9bt): `KeyboardIsr 1000:2EFD`
 * maps its 16-entry scancode table (`DS:106C`, SETTINGS.DAT's own order: KEYS1 x5, F1-F3, KEYS2 x5,
 * D/SPACE/V) onto bit `0x8000 >> slot` of the word `[0x107C]` (`2F70-2F8D`), and the two keyboard
 * reader routines return a whole byte of it (`2DFA`: `[0x107D]`, KEYS1 + F1/F2/F3; `2DFE`:
 * `[0x107C]`, KEYS2 + D/SPACE/V). So a player's reader byte carries, below its five control bits,
 * three more keys at `0x04`/`0x02`/`0x01`. Only the champion screen's whole-byte test (`1C0B`)
 * sees them. `codes`: three `KeyboardEvent.code`s, in slot order. `read()` returns those bits.
 */
export function createExtraKeysReader(codes, target = window) {
  const held = new Set()
  const onDown = (e) => { if (codes.includes(e.code)) held.add(e.code) }
  const onUp = (e) => { held.delete(e.code) }
  const onBlur = () => held.clear()
  target.addEventListener('keydown', onDown)
  target.addEventListener('keyup', onUp)
  target.addEventListener('blur', onBlur)
  return {
    read() {
      let bits = 0
      codes.forEach((c, i) => { if (c && held.has(c)) bits |= 0x04 >> i })
      return bits
    },
    dispose() {
      target.removeEventListener('keydown', onDown)
      target.removeEventListener('keyup', onUp)
      target.removeEventListener('blur', onBlur)
    },
  }
}

/**
 * The ISR's own 16-key word `[107C]` (`KeyboardIsr 2F70-2F8D`, docs/engine.md §9cf 4): slot i of
 * SETTINGS.DAT's 16 scancodes (KEYS1 x5, F1-F3, KEYS2 x5, D/SPACE/V) is bit `0x8000 >> i`; a key sets
 * or clears only the FIRST slot whose scancode matches. `scancodes`: the 16 bytes, in slot order.
 */
export function createIsrKeyWordReader(scancodes, target = window) {
  const fkey = (sc) => (sc >= 0x3b && sc <= 0x44 ? `F${sc - 0x3a}` : sc === 0x57 ? 'F11' : sc === 0x58 ? 'F12' : null)
  const codes = scancodes.map((sc) => SCANCODE_TO_KEY_CODE[sc] ?? fkey(sc))
  let word = 0
  const bitFor = (code) => { const i = codes.indexOf(code); return i < 0 ? 0 : 0x8000 >> i }
  const onDown = (e) => { word |= bitFor(e.code) }
  const onUp = (e) => { word &= ~bitFor(e.code) & 0xffff }
  const onBlur = () => { word = 0 }
  target.addEventListener('keydown', onDown)
  target.addEventListener('keyup', onUp)
  target.addEventListener('blur', onBlur)
  return {
    read: () => word,
    dispose() {
      target.removeEventListener('keydown', onDown)
      target.removeEventListener('keyup', onUp)
      target.removeEventListener('blur', onBlur)
    },
  }
}

/** A reader over a pre-recorded control-byte-per-step array (determinism check / tape replay). */
export function createTapeReader(bytes) {
  let i = 0
  return { read: () => bytes[i++] ?? 0, reset: () => { i = 0 } }
}

/** Records every byte a wrapped reader returns, for later replay via `createTapeReader`. */
export function recordingReader(reader) {
  const tape = []
  return { read: () => { const b = reader.read(); tape.push(b); return b }, tape, dispose: () => reader.dispose?.() }
}
