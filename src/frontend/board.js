// The tournament board screen (`DrawTournamentBoard 1000:18d8`, GOAL-DOS-PARITY.md P3's first
// item, docs/engine.md §9ay). Pure step function, same architecture as attract.js/frontMenu.js/
// charSelect.js: `boardInitialState()`/`boardStep(state, input)`.
//
// When it is shown (`SetupTournamentRace 1000:115c`, fully re-disassembled this session): before
// every race's own intro EXCEPT the qualifier (`[28c1]==0`, `18d8`'s own internal early RET) and
// EXCEPT the very last race (`[28c1]==[439]`, the champion decider) -- and ONLY in the Challenge
// (4-car) format; `115c` checks `[3f8]==1` (two-car/H2H) and skips the whole `CALL 18d8` before
// ever reaching it, so the two-car format never shows this screen at all. `tournament.js`'s
// `shouldShowBoard`/`boardRaceIndex` are `115c`'s own three-way gate, transcribed directly (not
// `18d8`'s internal one alone), including the pending-bonus-race index correction their own header
// comment explains.
//
// What it shows, once entered (`18d8` -> its helper `FUN_1000_198e`): CASE.CHR/CASE.MAP's "vehicle
// display case" background, then one MINATURE.CHR icon per race in `ORDER_TABLE[1..raceIndex]`,
// where `raceIndex` (`tournament.js`'s `boardRaceIndex`) is generally the race ABOUT TO run, not
// one already finished -- so the newest icon is a PREVIEW of the upcoming race's own class, not a
// trophy for the last one (see `screens.js`'s `drawTournamentBoard` for the one exception: a
// pending bonus race, where it genuinely is the just-completed race, since round 9 itself is never
// in `ORDER_TABLE` and gets no icon of its own).
//
// The newest icon blinks -- `18d8`'s own loop erases it (`RestoreSpriteBackground`), flips, waits;
// redraws (`ClipAndBlitSpriteTransparent`), flips, waits -- every `BOARD_BLINK_HALF_PERIOD_TICKS`
// (36 ticks, ~0.5s -- `FUN_1000_17ff`'s own `CMP [0x2],CX/JLE` loop runs for CX+1 ticks, not CX,
// since the loop's own [2]<=CX continue-test still re-enters on the CX-th tick; the SAME off-by-one
// class `frontMenu.js`'s own idle-cancel test already caught once), for up to
// `BOARD_TIMEOUT_TICKS` (0x2BC=700 ticks, ~10s, `[261F]`) or until any input. `[261F]`'s own
// threshold is sampled only ONCE per full blink cycle (`1000:1921`, right after the redraw half,
// not continuously) -- so the REAL timeout lands on the next 72-tick cycle boundary at or past 700,
// i.e. 720 ticks (~10.3s), not exactly 700; `boardStep` reproduces this by checking the timeout
// only at the same off->on transition, not every tick. Exit test (`FUN_1000_17ff`, the SAME
// combined-P1|P2 "wait for fire or any key release" helper `frontMenu.js`'s idle-cancel path also
// drives): fire pressed OR ESC/other key released. SIMPLIFIED here (not byte-for-byte `17ff`): the
// real routine treats an ALREADY-held fire button as "wait for it to be released, THEN wait for a
// fresh press" within the SAME ~0.5s budget, so a fire button still held from confirming the
// previous screen can (rarely) skip the board on its very first tick. This port instead reuses the
// established `AWAIT_RELEASE` idiom already used by `frontMenu.js`/`charSelect.js` for the same
// "ignore an already-held button" concern -- ignore fire entirely until it is released once, then
// treat the next press as the real one. Behaviourally equivalent for every case except that one
// rare already-held-at-entry edge, and consistent with every other menu screen in this file rather
// than re-deriving `17ff`'s own dual-phase-shared-budget logic a second time for a screen with no
// live capture and no gameplay rule riding on it.
//
// NOT ported: the round-9 "reveal" branch (`1000:192b-198d`), the ALWAYS-taken path whenever a
// pending bonus race is about to run (`TriggerBonusRace 1000:1a82` calls `115c` with `[28BF]`
// already forced to 9, so `18d8`'s own `CMP [28BF],9/JZ 192b` fires every time, not rarely). It
// skips the single-icon blink entirely and instead repeatedly draws 8 more MINATURE.CHR icons at
// two fixed columns across four rows, then redraws the whole `ORDER_TABLE[1..raceIndex]` icon list,
// with the SAME wait/exit/timeout shape as the regular blink (still `FUN_1000_17ff`, still gated on
// the SAME `[261F]` threshold) -- but frame indices 0x20-0x27 (32-39), the last two of which read
// past `MINATURE.CHR`'s own real 38-frame table (`chr.js`'s `CHR_TABLE`, frames 0-37), a genuine
// benign out-of-bounds read in the shipped game. This port shows the SAME single-icon blink for a
// pending-bonus-race board too, a documented simplification of a real, always-taken (not rare)
// code path that draws past its own asset's real bounds in the original.
export const BOARD_BLINK_HALF_PERIOD_TICKS = 0x24 // 36 (not 0x23=35 -- 17ff's own CX+1 tick loop)
export const BOARD_TIMEOUT_TICKS = 0x2bc // ~10s, [261F] -- sampled once per 72-tick cycle, see above

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
  state.phaseTicks++
  if (state.phaseTicks >= BOARD_BLINK_HALF_PERIOD_TICKS) {
    state.phaseTicks = 0
    state.blinkOn = !state.blinkOn
    // 1000:1921: [261F] is only compared right after the redraw half (the off->on transition), not
    // continuously -- so a 700-tick crossing mid-cycle doesn't exit until the NEXT sample point.
    if (state.blinkOn && state.totalTicks >= BOARD_TIMEOUT_TICKS) return { exit: true }
  }
  return { exit: false }
}
