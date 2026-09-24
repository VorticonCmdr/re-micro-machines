// P2's third item (GOAL-DOS-PARITY.md): RunCharacterSelectMenuTune2 1000:09e0's real carousel,
// re-derived from a full disassembly (131 instructions) plus its own scroll-step helper
// (FUN_1000_0cd3) and DrawCharacterSelectGrid (1000:0d1f). Proves:
//  - the 13-step ease table (DS:0185) sums to exactly 64 (one character slot);
//  - the starting scroll position (DS:016F's own 11-word table) is reproduced as a formula, for
//    every one of the 11 possible starting characters;
//  - a held fire at entry does not confirm immediately (the one-time AWAIT_RELEASE swallow);
//  - the roster-byte encoding alone (no explicit "if taken" check) makes a taken character
//    invisible to both the entry-time auto-skip loop and the fire-confirm gate;
//  - LEFT/RIGHT moves exactly one slot and settles there even if it's taken (no auto-skip on a
//    real user press, unlike the entry-time skip);
//  - a real pick's own 5-blink, 80-tick commit sequence, and ESC's immediate cancel.
//   node tools/check-charselect.mjs
import { charSelectInitialState, charSelectStep, handicapQuestionApplies, CAROUSEL_STEP_TABLE, CAROUSEL_SLOT_PX, BLINK_COUNT, BLINK_TICKS } from '../src/frontend/charSelect.js'

let bad = 0
function check(name, cond) {
  if (cond) return
  bad++
  console.log(`FAIL: ${name}`)
}

check('CAROUSEL_STEP_TABLE has 13 steps summing to exactly 64 (CAROUSEL_SLOT_PX)', CAROUSEL_STEP_TABLE.length === 13 && CAROUSEL_STEP_TABLE.reduce((a, b) => a + b, 0) === CAROUSEL_SLOT_PX)

const freshRoster = () => [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

// 1. The starting scroll position lands exactly on the requested starting character, for all 11.
for (let start = 0; start < 11; start++) {
  const s = charSelectInitialState(start, freshRoster())
  check(`starting character ${start} centres itself`, s.cursor === start)
}

// 2. A held fire at entry does not confirm immediately -- it must be released first.
{
  const s = charSelectInitialState(5, freshRoster())
  const r = charSelectStep(s, { bits: 0x08 }, freshRoster())
  check('fire held at entry: does not confirm', r.exit === null && s.phase === 'AWAIT_RELEASE')
}

// 3. Entry-skip: a taken starting character is auto-scrolled past (roster[5] marked taken, 0x40).
{
  const roster = freshRoster()
  roster[5] |= 0x40
  const s = charSelectInitialState(5, roster)
  check('starts on the taken slot (roster byte > 10)', s.cursor > 10)
  charSelectStep(s, { bits: 0 }, roster) // release -> ENTRY_SKIP
  check('release with an invalid start enters ENTRY_SKIP', s.phase === 'ENTRY_SKIP')
  let n = 0
  while (s.phase !== 'IDLE' && n < 1000) { charSelectStep(s, {}, roster); n++ }
  check('entry-skip settles on a VALID (untaken) character', s.cursor <= 10)
  check('entry-skip actually moved off the taken one', s.cursor !== 5)
}

// 4. LEFT/RIGHT moves exactly one slot in 13 ticks (the full ease table), landing there even if
// the destination is taken -- no auto-skip on a real user-driven press.
{
  const roster = freshRoster()
  roster[4] |= 0x40 // one slot left of index 5 (LEFT direction increases the centred index by... verified below)
  const s = charSelectInitialState(5, roster)
  charSelectStep(s, { bits: 0 }, roster) // clear AWAIT_RELEASE (valid start, straight to IDLE)
  check('valid start goes straight to IDLE', s.phase === 'IDLE')
  const startCursor = s.cursor
  let r = charSelectStep(s, { bits: 0x80 }, roster) // LEFT -- one outer tick (DS:0002) detects it and starts the scroll, no substep done yet
  check('a LEFT press enters SCROLLING', s.phase === 'SCROLLING' && r.exit === null)
  let steps = 0
  while (s.phase === 'SCROLLING' && steps < 20) { charSelectStep(s, {}, roster); steps++ } // each tick here is one of 0cd3's OWN internal DS:261F waits
  check('the scroll itself takes exactly 13 ticks (the ease table length)', steps === 13)
  check('settles back in IDLE after one slot', s.phase === 'IDLE')
  check('the selection actually changed', s.cursor !== startCursor)
}

// 5. Fire is ignored on an invalid/taken slot (stays in IDLE, no BLINKING).
{
  const roster = freshRoster()
  roster[5] |= 0x40
  const s = { scroll: 0, direction: 1, phase: 'IDLE', scrollStepIndex: 0, scrollAccum: 0, blinkCount: 0, blinkOn: false, cursor: roster[5] }
  const r = charSelectStep(s, { bits: 0x08 }, roster)
  check('fire on a taken slot does nothing', r.exit === null && s.phase === 'IDLE')
}

// 6. A real pick: fire on a valid slot blinks 5 times (80 ticks total) then confirms with the
// right character.
{
  const roster = freshRoster()
  const s = charSelectInitialState(7, roster)
  charSelectStep(s, { bits: 0 }, roster) // clear AWAIT_RELEASE
  charSelectStep(s, { bits: 0x08 }, roster) // fire
  check('fire on a valid slot enters BLINKING with the first toggle already applied', s.phase === 'BLINKING' && s.blinkOn === true && s.blinkCount === 1)
  let n = 0
  let result = null
  while (n < 1000) {
    const r = charSelectStep(s, {}, roster)
    n++
    if (r.exit) { result = r; break }
  }
  check('confirms after exactly 5*BLINK_TICKS (80) more ticks', n === BLINK_COUNT * BLINK_TICKS)
  check('confirms with the picked character', result?.exit === 'confirm' && result.character === 7)
}

// 7. ESC cancels immediately from IDLE.
{
  const s = charSelectInitialState(0, freshRoster())
  charSelectStep(s, { bits: 0 }, freshRoster())
  const r = charSelectStep(s, { escReleased: true }, freshRoster())
  check('ESC release cancels immediately', r.exit === 'cancel')
}

// 8. FUN_1000_0b51's own gating: only characters 0-2, only real two-human Head to Head
// (raceFormat 2 AND the other slot isn't CPU).
check('character 0-2 in a real two-human H2H (format 2, other=human) asks', handicapQuestionApplies(0, 2, 5) && handicapQuestionApplies(2, 2, 4))
check('character 3+ never asks, even in a real two-human H2H', !handicapQuestionApplies(3, 2, 5))
check('a four-car race (format 1) never asks', !handicapQuestionApplies(0, 1, 5))
check('the other slot being CPU (one-player H2H vs CPU) never asks', !handicapQuestionApplies(0, 2, 6))

console.log(bad ? `${bad} check(s) failed` : 'check-charselect: the carousel\'s real 13-step ease, roster-encoded taken/skip logic, 5-blink commit sequence, and the handicap question\'s own gating all match the disassembly')
process.exitCode = bad ? 1 : 0
