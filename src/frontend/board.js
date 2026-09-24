// The tournament board screen (`DrawTournamentBoard 1000:18d8`, GOAL-DOS-PARITY.md P3's first
// item, docs/engine.md §9ay). Pure step function, same architecture as attract.js/frontMenu.js/
// charSelect.js: `boardInitialState()`/`boardStep(state, input)`.
//
// When it is shown (`SetupTournamentRace 1000:115c`, fully re-disassembled this session): before
// every race's own intro EXCEPT the qualifier (`[28c1]==0`, `18d8`'s own internal early RET) and
// EXCEPT the very last race (`[28c1]==[439]`, the champion decider) -- and ONLY in the Challenge
// (4-car) format; `115c` checks `[3f8]==1` (two-car/H2H) and skips the whole `CALL 18d8` before
// ever reaching it, so the two-car format never shows this screen at all. `shouldShowBoard` below
// is `115c`'s own three-way gate, transcribed directly (not `18d8`'s internal one alone).
//
// What it shows, once entered (`18d8` -> its helper `FUN_1000_198e`): CASE.CHR/CASE.MAP's "vehicle
// display case" background, then one MINATURE.CHR icon per race completed so far (`ORDER_TABLE[1]`
// through `ORDER_TABLE[raceIndex]` -- the qualifier, entry 0, never gets its own icon; the
// pre-increment is `198e`'s own, not an off-by-one here), each at `frontend-tables.js`'s
// `BOARD_ICON_POSITIONS[i]`, frame `(round-1) + (race-1)*8` (a MINATURE.CHR class icon: class by
// round, colour variant by race -- `198e`'s own `SHR AL,2; DEC AL` + `AND AL,3; SHL 3`).
//
// The newest icon (the one for the race that was JUST reported) blinks -- `18d8`'s own loop erases
// it (`RestoreSpriteBackground`), flips, waits; redraws (`ClipAndBlitSpriteTransparent`), flips,
// waits -- every ~0x23 ticks (~0.5s), for up to ~0x2BC ticks (~10s, `[261F]`) total, or until any
// input. Exit test (`FUN_1000_17ff`, the SAME combined-P1|P2 "wait for fire or any key release"
// helper `frontMenu.js`'s idle-cancel path also drives): fire pressed OR ESC/other key released.
// SIMPLIFIED here (not byte-for-byte `17ff`): the real routine treats an ALREADY-held fire button
// as "wait for it to be released, THEN wait for a fresh press" within the SAME ~0.5s budget, so a
// fire button still held from confirming the previous screen can (rarely) skip the board on its
// very first tick. This port instead reuses the established `AWAIT_RELEASE` idiom already used by
// `frontMenu.js`/`charSelect.js` for the same "ignore an already-held button" concern -- ignore
// fire entirely until it is released once, then treat the next press as the real one. Behaviourally
// equivalent for every case except that one rare already-held-at-entry edge, and consistent with
// every other menu screen in this file rather than re-deriving `17ff`'s own dual-phase-shared-
// budget logic a second time for a screen with no live capture and no gameplay rule riding on it.
export const BOARD_BLINK_HALF_PERIOD_TICKS = 0x23 // ~0.5s
export const BOARD_TIMEOUT_TICKS = 0x2bc // ~10s, [261F]

export function boardInitialState() {
  return { phase: 'AWAIT_RELEASE', blinkOn: true, phaseTicks: 0, totalTicks: 0 }
}

export function boardStep(state, input = {}) {
  const bits = input.bits ?? 0
  if (state.phase === 'AWAIT_RELEASE') {
    if ((bits & 0x08) === 0) state.phase = 'POLL'
    return { exit: false }
  }
  if (input.escReleased || input.otherReleased || bits & 0x08) return { exit: true }
  state.totalTicks++
  if (state.totalTicks >= BOARD_TIMEOUT_TICKS) return { exit: true }
  state.phaseTicks++
  if (state.phaseTicks >= BOARD_BLINK_HALF_PERIOD_TICKS) {
    state.phaseTicks = 0
    state.blinkOn = !state.blinkOn
  }
  return { exit: false }
}
