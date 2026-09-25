// PRESS ANY KEY's own wait, `FUN_1000_0C15-0C5C` (docs/engine.md §9bt, GOAL-DOS-PARITY.md P3's PRESS
// ANY KEY bullet). All `[STATIC]`, disassembled in full.
//
// Called from three places: `RunOnePlayerHeadToHeadVsCpu 101B` and `RunOnePlayerChallenge 108A`
// (after the player's own pick, before the qualifier) and the opponent picker `1A4A`'s own tail
// (`1A65`, once every opponent slot is filled) -- the port's two PRESS_ANY_KEY entries. Each of the
// two setup functions sets `[0x1080]=0x137B` (P1's own reader block, `0FD4`/`104C`) before any of
// this, and nothing in between leaves it changed, so the fire test below reads P1 ONLY.
//
// Entry: `[0x261F]=0` (`0C15`), the release latch cleared (`0C2D`/`0C32`). Loop: `[0x261F] >= 0x2BC`
// leaves (`0C37`); draw the text, blinking with the ISR's own `[0x26CF]` (`0C96`, no wait); one
// tick (`0C42-0C49`); `2D5B`; leave on any key RELEASE (`0C4E`, `[0x107E]!=0`) or on P1's fire HELD
// (`0C55-0C5A`, `[0x108B]&8` -- no debounce, so a fire still held from the previous screen leaves at
// the first tick); else back to the timeout check. The check runs right after each tick's poll, so
// the screen leaves at tick 700 exactly.

export const PRESS_ANY_KEY_TIMEOUT_TICKS = 0x2bc // 0C37's own comparand, against [0x261F]

export function pressAnyKeyInitialState() {
  return { ticks: 0 }
}

/** One tick. `input`: `{ p1FireHeld, anyKeyReleased }`. Returns `{ exit: null | 'dismiss' | 'timeout' }`. */
export function pressAnyKeyStep(state, input = {}) {
  state.ticks++ // 0C42-0C49 (and [0x261F], 48D8)
  if (input.anyKeyReleased) return { exit: 'dismiss' } // 0C4E
  if (input.p1FireHeld) return { exit: 'dismiss' } // 0C55-0C5A
  if (state.ticks >= PRESS_ANY_KEY_TIMEOUT_TICKS) return { exit: 'timeout' } // 0C5A -> 0C37/0C3D, no tick between
  return { exit: null }
}
