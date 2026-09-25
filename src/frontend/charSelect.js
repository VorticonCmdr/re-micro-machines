// P2's third item (GOAL-DOS-PARITY.md): RunCharacterSelectMenuTune2 1000:09e0, the character
// select carousel (11 FCNORMAL faces). Fully disassembled (131 instructions, 1000:09e0-0b50) plus
// its own scroll-step helper FUN_1000_0cd3 (the eased-scroll stepper) and DrawCharacterSelectGrid
// (1000:0d1f, which derives the "centred" character from the raw scroll position every frame).
//
// The roster encoding is the real mechanism behind "a taken character is skipped/rejected" --
// there is no explicit "if taken" check anywhere in this function. `tournament.js`'s own roster
// array stores each slot's OWN identity byte (normally == its own index, 0-10), OR'd with 0x40
// once taken (0x20 once eliminated, tournament.js's own later concern). ANY consumer that compares
// the CURRENT roster byte against 10 (>10 = invalid) therefore naturally treats a taken/eliminated
// slot as "out of range": the entry-time auto-skip loop (1000:0a65-73) keeps scrolling past one,
// and the fire-confirm gate (1000:0ab8) silently ignores a fire press landing on one. This port's
// `roster` argument is `tournament.js`'s own roster array (of raw byte values, not booleans),
// read the exact same way.
//
// Also covers `FUN_1000_0b51`, the two-human Head to Head "HANDICAP <name> ?" question `09E0`
// calls unconditionally after every commit (GOAL-DOS-PARITY.md P4, docs/engine.md §9bm): its own
// gate (`handicapQuestionApplies`) and, added this session, its own interactive Y/N toggle
// (`handicapInitialState`/`handicapStep`), fully disassembled (`0B51-0C14`).
export const CAROUSEL_STEP_TABLE = [2, 2, 2, 2, 4, 4, 4, 4, 8, 8, 8, 8, 8] // DS:0185, sums to exactly 64 (one slot)
export const CAROUSEL_SLOT_PX = 64
export const CAROUSEL_SLOT_COUNT = 11
export const CAROUSEL_TOTAL_PX = CAROUSEL_SLOT_COUNT * CAROUSEL_SLOT_PX // 0x2C0 = 704
export const CAROUSEL_CENTER_PX = 0x140 // 320 -- DrawCharacterSelectGrid's own centred position
export const BLINK_COUNT = 5 // 1000:0ad7-0af9: CX=5, XOR the frame's blink bit, redraw, wait, loop
export const BLINK_TICKS = 16 // 1000:0af1-0af6: CMP [0x2],0xF; JLE -- waits until DS:0002 > 15

/**
 * `scroll` for a given starting character index: DS:016F's own 11-word table, re-derived as a
 * closed formula (each entry is `((5 - i) mod 11) * 64` -- confirmed against all 11 live-read
 * words) rather than hardcoded, since it's a pure function of the slot layout already above.
 */
function startScroll(startIndex) {
  return (((5 - startIndex) % CAROUSEL_SLOT_COUNT) + CAROUSEL_SLOT_COUNT) % CAROUSEL_SLOT_COUNT * CAROUSEL_SLOT_PX
}

/** DrawCharacterSelectGrid (1000:0d1f): walks all 11 roster bytes cyclically from `scroll`,
 * advancing by CAROUSEL_SLOT_PX (wrapping at CAROUSEL_TOTAL_PX) for each -- whichever one lands
 * exactly on CAROUSEL_CENTER_PX is the "centred" value written into [0x160]. `scroll` is always a
 * multiple of 64 at the points this is called (slot boundaries only, never mid-scroll), so exactly
 * one roster entry always lands on it. */
function centeredRosterValue(scroll, roster) {
  let pos = scroll
  for (let i = 0; i < roster.length; i++) {
    if (pos === CAROUSEL_CENTER_PX) return roster[i]
    pos += CAROUSEL_SLOT_PX
    if (pos > 0x2bf) pos -= CAROUSEL_TOTAL_PX
  }
  return roster[0] // unreachable in practice -- defensive only
}

/**
 * `startIndex`: the caller's own starting character (0fbf/102b pass DS:016F-derived scroll
 * positions for [3F4]/[3F6]'s own last picks, docs/engine.md §9an). `roster`: tournament.js's
 * roster array (raw byte values).
 */
export function charSelectInitialState(startIndex, roster) {
  const scroll = startScroll(startIndex)
  return {
    scroll,
    direction: 1, // [0x162]'s own real value here is whatever a PRIOR screen last left it (a genuinely stale global) -- this port defaults to LEFT/+1 for the entry-skip loop as a documented simplification (docs/engine.md §9ax)
    phase: 'AWAIT_RELEASE',
    scrollStepIndex: 0,
    scrollAccum: 0,
    blinkCount: 0,
    blinkOn: false,
    cursor: centeredRosterValue(scroll, roster),
  }
}

function stepScrollSubstep(state, roster) {
  const step = CAROUSEL_STEP_TABLE[state.scrollStepIndex]
  if (state.direction > 0) { // LEFT (0x80) -- 1000:0cd3's own "add" branch
    state.scroll += step
    if (state.scroll > 0x2bf) state.scroll -= CAROUSEL_TOTAL_PX
  } else { // RIGHT (0x40) -- 0cd3's own "subtract" branch
    state.scroll -= step
    if (state.scroll < 0) state.scroll += CAROUSEL_TOTAL_PX
  }
  state.scrollAccum += step
  state.scrollStepIndex++
  if (state.scrollAccum < CAROUSEL_SLOT_PX) return false // 0cd3's own exit test: `while (cumulative < 0x40)`
  state.scrollAccum = 0
  state.scrollStepIndex = 0
  state.cursor = centeredRosterValue(state.scroll, roster)
  return true // one full slot crossed
}

/**
 * `FUN_1000_0b51`'s own gating logic (1000:0b51-0b5b), re-disassembled while tracing the pick-
 * commit code above: the "handicap question" (asked only of characters 0-2 -- WALTER/MIKE/ANNE,
 * `KidModifier`'s own first 3 entries, docs/track-layout.md) that two-human Head to Head asks
 * after each of ITS OWN two picks. Gated out entirely whenever `raceFormat` is 1 (four-car, i.e.
 * not Head to Head at all) or the OTHER player's own device is 6 (CPU -- one-player H2H vs CPU,
 * which reaches this same carousel via `0fbf` but never asks). This project's one-player and
 * Challenge flows never satisfy both conditions (P2 in-scope work), so this is real, cited
 * `[STATIC]` logic ported ahead of its own call site rather than a port gap -- the actual
 * question SCREEN (and its own effect on `KidModifier`-adjusted handicap play, docs/track-
 * layout.md) is two-human H2H's own concern, P4.
 */
export function handicapQuestionApplies(character, raceFormat, otherDeviceType) {
  if (raceFormat === 1) return false // [0x2656]==1: four-car, not a Head to Head race at all
  if (otherDeviceType === 6) return false // [0x265a]==6: the other slot is CPU, not a second human
  return character >= 0 && character <= 2
}

/**
 * One ~1/70s tick. `input`: `{ bits, escReleased }` (P1's OWN reader only -- 0fbf/102b set
 * `[0x1080]=0x137b` before calling 09e0, unlike the two-item menu's own combined-both-players
 * byte). Returns `{ exit: null | 'cancel' | 'confirm', character? }`; `state` is mutated in place.
 */
export function charSelectStep(state, input, roster) {
  const bits = input.bits ?? 0
  switch (state.phase) {
    case 'AWAIT_RELEASE':
      // 1000:0a4c-0a5d: swallow a fire press already held from the previous screen, once, at entry.
      if ((bits & 0x08) === 0) state.phase = state.cursor > 10 ? 'ENTRY_SKIP' : 'IDLE'
      return { exit: null }
    case 'ENTRY_SKIP':
    case 'SCROLLING': {
      const wasEntrySkip = state.phase === 'ENTRY_SKIP'
      if (stepScrollSubstep(state, roster)) {
        // 1000:0a65-73: the entry-skip loop keeps going while the landed slot is still invalid;
        // a real LEFT/RIGHT press (SCROLLING) always settles after exactly one slot, valid or not.
        state.phase = wasEntrySkip && state.cursor > 10 ? 'ENTRY_SKIP' : 'IDLE'
      }
      return { exit: null }
    }
    case 'BLINKING': {
      state.blinkTicks++
      if (state.blinkTicks < BLINK_TICKS) return { exit: null }
      state.blinkTicks = 0
      if (state.blinkCount >= BLINK_COUNT) return { exit: 'confirm', character: state.cursor } // 1000:0af9: the 5th wait just completed -- no further toggle, fall into the commit code
      state.blinkOn = !state.blinkOn
      state.blinkCount++
      return { exit: null }
    }
    case 'IDLE':
    default: {
      // 1000:0a8f-0a96: checked every tick, in every state IDLE can be entered from.
      if (input.escReleased) return { exit: 'cancel' }
      if (bits & 0x08) { // fire, 1000:0a9b-0ab5
        if (state.cursor > 10) return { exit: null } // an invalid/taken slot -- ignored, matches 0ab8's own `CMP AX,0xA / JA 0a7b`
        state.phase = 'BLINKING'
        state.blinkOn = true // 1000:0adb: XOR happens BEFORE the loop's first wait -- the first toggle is synchronous with entry, not after 16 ticks
        state.blinkCount = 1
        state.blinkTicks = 0
        return { exit: null }
      }
      const dir = bits & 0x80 ? 1 : bits & 0x40 ? -1 : 0 // 1000:0a9f-0aaa: LEFT(0x80)=+1, RIGHT(0x40)=-1
      if (dir === 0) return { exit: null }
      state.direction = dir
      state.phase = 'SCROLLING'
      return { exit: null }
    }
  }
}

/**
 * `FUN_1000_0b51`'s own interactive Y/N toggle (1000:0b89-0c14, the part AFTER its own gate --
 * `handicapQuestionApplies`, above -- already covers 0b51-0b86). Full disassembly this session
 * (docs/engine.md §9bm). `defaultAnswer`: `DS:[0x1D6+character]`'s own persisted per-character
 * value (`0` the first time a character is asked this session, else whatever it last answered --
 * `0B9D: MOV AL,[BX]`, `BX` selected per-character at `0B68`/`0B73`/`0B7E`). SESSION-scoped, not
 * match-scoped: `search_byte_patterns` confirms `0B51` is the ONLY function in the whole binary
 * that references `DS:0x1D6`/`0x1D7`/`0x1D8` at all, so nothing ever resets them (not even `0EBA`'s
 * own H2H-entry reset) -- the caller owns tracking each character's own last answer across visits,
 * this module has no session storage of its own. `0` = NO, `0x80` = YES
 * (the real byte values, not booleans, so `state.answer` matches `[0x1E0]`'s own scratch cell
 * byte-exact).
 */
export function handicapInitialState(defaultAnswer = 0) {
  return { answer: defaultAnswer }
}

const HANDICAP_LEFT = 0x80 // 1000:0bf9: TEST AL,0x80 -> AH=0 (NO)
const HANDICAP_RIGHT = 0x40 // 1000:0bfd/0bff: TEST AL,0x40 -> AH=0x80 (YES)
const HANDICAP_EXIT_BITS = 0x10 | 0x08 // 1000:0bef/0bf3: BRAKE(0x10) or FIRE(0x08), tested BEFORE LEFT/RIGHT

/**
 * One ~1/70s tick of `0B51`'s own poll loop (`0BAF`/`0BE0`-`0C07`). `input`: `{ bits }`, the
 * PICKING PLAYER's own 5-bit reader ONLY (LEFT/RIGHT/ACCEL/BRAKE/FIRE = 0x80/0x40/0x20/0x10/0x08,
 * `src/engine/input.js`'s own convention) -- NOT P1|P2's OR'd byte: `09E0` never writes `[0x1080]`
 * (confirmed by reading it in full), so `[0x108B]` here is still whichever single reader block its
 * own caller, `1E20`, set up for this character's picking player (docs/engine.md §9bm). Feeding it
 * both players' bits ORed together would let the OTHER player's fire/brake wrongly dismiss the
 * question. Returns
 * `{ exit: null | 'confirm', handicap? }`; `state` is mutated in place. **No release-wait at
 * entry, unlike `charSelectStep`'s own AWAIT_RELEASE -- a real quirk of `0B51`, not a bug: a fire
 * (or brake) already held from the character carousel's own commit press satisfies this loop's
 * exit test on its very first tick, silently resolving the question with whatever answer was
 * already stored (docs/engine.md §9bk, `[PROVEN]` live). This port faithfully does NOT debounce
 * it.** Exit is checked before LEFT/RIGHT every tick, matching `0BEC-0BF5` running before
 * `0BF7-0C01`; if BOTH a toggle bit and an exit bit are held in the same tick, exit wins (`0BEF`/
 * `0BF3` return before ever reaching `0BF9`). LEFT beats RIGHT when both are held (`0BF9`'s own
 * `JNZ 0C03` short-circuits before `0BFD`'s own RIGHT test, matching `0B51` byte-for-byte).
 */
export function handicapStep(state, input) {
  const bits = input.bits ?? 0
  if (bits & HANDICAP_EXIT_BITS) return { exit: 'confirm', handicap: state.answer === 0x80 } // 0C09-0C11
  if (bits & HANDICAP_LEFT) state.answer = 0 // 0BF9/0C03
  else if (bits & HANDICAP_RIGHT) state.answer = 0x80 // 0BFD/0BFF/0C03
  return { exit: null }
}
