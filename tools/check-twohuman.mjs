// Two-human Head to Head's own tournament state (GOAL-DOS-PARITY.md P4, 1st item, step 3 of 4,
// docs/engine.md §9bh). Proves:
//  - H2H_TRACK_TABLE matches DS:09BA exactly, and decodes with the SAME round<<2|race-1 packing
//    DS:043C's own ORDER_TABLE uses;
//  - nextTrack picks the (v+k)&7 slot, marks it used, and never repeats a track across a full
//    7-race (4-3) match -- the realistic worst case within a single H2H match;
//  - nextTrack's own all-used reset (1FBE) actually resets and re-picks, even though a real match
//    can never reach it (ported for fidelity, tested directly here since nothing else exercises it);
//  - reportRace's own win tally, lifetime per-character stats, and first-to-4 champion detection
//    match 1000:2081/208B/256E exactly;
//  - the per-character lifetime stats (session state) SURVIVE a new match (match state), matching
//    the real bytes having no reset site for them anywhere;
//  - skillLabel matches DS:08B0/DS:08CD's own live-read bytes, including the live-captured
//    TOURNAMENT RACE screen's own "ORDINARY" tie case (M3.61, docs/engine.md §9bg);
//  - selectSingleRaceTrack (GOAL-DOS-PARITY.md P4's 2nd item, docs/engine.md §9bi): all 10
//    SINGLE_RACE_TRACK_TABLE entries decode (after the PRO-class remap) to a real, named track;
//    both wrap directions; the two remaps (10->round 3, 11->round 1); delta=0 re-reads the
//    current entry without moving the cursor, matching 2329's own initial CALL 2193;
//  - raceInfoSlideTicks (2216's own tick count, docs/engine.md §9bj) matches the hand-derived
//    formula AND a direct simulation of 226E-22B3's own loop, for all 4 real smoothness values.
//  - RACE_RESULT_SLIDE_TICKS (256E's own icon slide, docs/engine.md §9bl) is a fixed 22, DIFFERENT
//    from raceInfoSlideTicks at every real smoothness value;
//  - raceResultWaitStep (1000:17FF's own bounded dismiss-wait, docs/engine.md §9bl) debounces a
//    fire button already held (matching the real automation pitfall this session hit live,
//    PLAN.md §8), dismisses on a fresh press or any key-release latch, and shares ONE tick BUDGET
//    across both its own phases (release-wait then press-wait) -- NOT a fresh budget per phase,
//    matching [0x2] only ever being reset at 17FF's own entry, never at the 182C transition.
//   node tools/check-twohuman.mjs
import { twoHumanSessionState, twoHumanMatchState, twoHumanSetupState, raceResultScreenInitialState, raceResultScreenStep, singleRaceSelectInitialState, singleRaceSelectStep, twoHumanRosterBytes, commitTwoHumanPick, H2H_P1_START, H2H_P2_START, nextTrack, reportRace, skillLabel, selectSingleRaceTrack, raceInfoSlideTicks, RACE_RESULT_SLIDE_TICKS, RACE_RESULT_WAIT_TICKS, raceResultWaitInitialState, raceResultWaitStep, H2H_TRACK_TABLE, H2H_WINS_TO_CHAMPION, SINGLE_RACE_TRACK_TABLE } from '../src/frontend/twoHuman.js'
import { handicapQuestionApplies } from '../src/frontend/charSelect.js'
import { createRaceIndexRegister, initTournament } from '../src/frontend/tournament.js'
import { CHARACTER_NAMES, H2H_SKILL_INDEX_TABLE, H2H_SKILL_LABELS, trackName } from '../src/data/frontend-tables.js'

let bad = 0
let asserted = 0
const distinct = new Set()
function check(name, cond) {
  asserted++
  distinct.add(name)
  if (cond) return
  bad++
  console.log(`FAIL: ${name}`)
}

check('H2H_TRACK_TABLE matches DS:09BA exactly (8 bytes)', H2H_TRACK_TABLE.join() === [0x04, 0x0a, 0x11, 0x0d, 0x1c, 0x21, 0x14, 0x19].join())
check('H2H_WINS_TO_CHAMPION is 4 (1000:2081/208B, byte compare)', H2H_WINS_TO_CHAMPION === 4)

// 1. nextTrack decodes with the SAME round<<2|race-1 packing DS:043C's own ORDER_TABLE uses --
// checked against every one of the 8 real bytes by hand (round<<2|race-1 -> round, race).
{
  const s = twoHumanMatchState(twoHumanSessionState())
  const expected = [
    [1, 1], [2, 3], [4, 2], [3, 2], [7, 1], [8, 2], [5, 1], [6, 2],
  ]
  for (let v = 0; v < 8; v++) {
    const t = nextTrack(s, v)
    check(`nextTrack(v=${v}): round ${expected[v][0]}, race ${expected[v][1]}`, t.round === expected[v][0] && t.race === expected[v][1])
  }
}

// 2. A full 7-race (4-3) match -- the realistic worst case within one H2H match -- never repeats a
// track, since usedTracks has 8 slots and a match is over by the 7th race at the latest. `v` is
// held FIXED at 0 every call -- the same tick sample every race, worst case for the picker -- so
// this genuinely exercises the used-bitmap's own advance-past-used-slots logic, not just distinct
// input values that happen not to collide.
{
  const s = twoHumanMatchState(twoHumanSessionState())
  const seen = new Set()
  for (let race = 0; race < 7; race++) {
    const t = nextTrack(s, 0) // the SAME v every race -- only the used-bitmap can prevent a repeat
    const key = `${t.round}-${t.race}`
    check(`race ${race + 1}: track not repeated within the match (same v=0 every time)`, !seen.has(key))
    seen.add(key)
  }
  check('a 4-3 match uses exactly 7 distinct tracks', seen.size === 7)
}

// 3. The all-used reset (1FBE) actually resets and re-picks -- ported for fidelity even though a
// real match can never reach it (7 races max, 8 slots) -- reintroduction-proven below.
{
  const s = twoHumanMatchState(twoHumanSessionState())
  for (let v = 0; v < 8; v++) nextTrack(s, v) // exhaust all 8 slots
  check('all 8 slots used before the 9th pick', s.usedTracks.every(Boolean))
  const t = nextTrack(s, 0) // the 9th pick must reset first, then land on slot 0 again
  check('the 9th pick resets the bitmap and lands on v=0 again (round 1, race 1)', t.round === 1 && t.race === 1)
  check('exactly one slot used after the reset-and-pick (not still all 8)', s.usedTracks.filter(Boolean).length === 1)
}

// 4. reportRace's own win tally, lifetime stats, and champion detection.
{
  const session = twoHumanSessionState()
  const s = twoHumanMatchState(session)
  const p1 = 5 // DWAYNE, this session's own live-captured character (M3.61)
  const p2 = 6 // JETHRO
  let r = reportRace(s, p1, p2, true) // P1 wins race 1
  check('raceNumber advances (207A)', s.raceNumber === 2)
  check('P1 win: p1Wins increments', s.p1Wins === 1 && s.p2Wins === 0)
  check('P1 win: p1Character gets a lifetime win', session.lifetimeWins[p1] === 1 && session.lifetimeWins[p2] === 0)
  check('P1 win: p2Character gets a lifetime loss', session.lifetimeLosses[p2] === 1 && session.lifetimeLosses[p1] === 0)
  check('match not over after 1 win', r.matchOver === false && r.champion === null)

  r = reportRace(s, p1, p2, false) // P2 wins race 2
  check('P2 win: p2Wins increments, p1Wins unchanged', s.p2Wins === 1 && s.p1Wins === 1)
  check('P2 win: p2Character gets a lifetime win, p1Character a lifetime loss', session.lifetimeWins[p2] === 1 && session.lifetimeLosses[p1] === 1)

  for (let i = 0; i < 2; i++) r = reportRace(s, p1, p2, true) // P1: 2 more wins (total 3) -- `r` assigned each time, so the check below reads race 4's own return, not race 2's stale one
  check('P1 at 3 wins, not yet champion', s.p1Wins === 3 && r.matchOver === false && r.champion === null)
  r = reportRace(s, p1, p2, true) // P1's 4th win
  check('P1 reaches H2H_WINS_TO_CHAMPION: match over', s.p1Wins === H2H_WINS_TO_CHAMPION && r.matchOver === true)
  check('champion is player 1', r.champion === 1)

  // Reintroduction proof for the champion check: a match ending at P2's own 4th win must report
  // champion 2, not 1 -- proven directly, not just asserted for the P1 case above.
  const s2 = twoHumanMatchState(twoHumanSessionState())
  for (let i = 0; i < 3; i++) reportRace(s2, p1, p2, false)
  const r2 = reportRace(s2, p1, p2, false)
  check('P2 reaches H2H_WINS_TO_CHAMPION: match over, champion is player 2', r2.matchOver === true && r2.champion === 2)
}

// 5. The per-character lifetime stats (session state) survive a NEW match -- the real bytes have
// no reset site for [9A4+c]/[9AF+c] anywhere, unlike the win tally (which DOES reset every
// RunHeadToHeadChooseGameMenu entry, i.e. every match). A twoHumanMatchState created fresh for a
// second match, sharing the SAME session object, must keep the first match's own lifetime counts.
{
  const session = twoHumanSessionState()
  const match1 = twoHumanMatchState(session)
  reportRace(match1, 5, 6, true) // P1 (DWAYNE) wins one race in match 1
  check('after match 1: DWAYNE has a lifetime win', session.lifetimeWins[5] === 1)

  const match2 = twoHumanMatchState(session) // a NEW match -- win tally/tracks reset, session does not
  check('match 2 starts with p1Wins/p2Wins reset to 0 (the real per-match reset)', match2.p1Wins === 0 && match2.p2Wins === 0)
  check('match 2 starts with a fresh used-tracks bitmap', match2.usedTracks.every((u) => u === false))
  check('match 2 does NOT reset the lifetime stats -- DWAYNE still has last match\'s own win', session.lifetimeWins[5] === 1)

  reportRace(match2, 6, 5, true) // P1 (JETHRO this time) wins match 2's own first race
  check('lifetime stats accumulate ACROSS matches, sharing one session', session.lifetimeWins[5] === 1 && session.lifetimeWins[6] === 1)
}

// 6. skillLabel matches DS:08B0/DS:08CD's own live-read bytes -- the tie case (wins===losses,
// index=10) is the live-captured TOURNAMENT RACE screen's own case (M3.61): both players showed
// "WON 0 LOST 0", and H2H_SKILL_INDEX_TABLE[10]===3, H2H_SKILL_LABELS[3].trim()==="ORDINARY".
{
  check('skillLabel(0,0) is ORDINARY (the live-captured tie case, M3.61)', skillLabel(0, 0).trim() === 'ORDINARY')
  check('skillLabel returns the real padded string, not a trimmed one', skillLabel(0, 0) === H2H_SKILL_LABELS[3])
  check('skillLabel: a big positive differential (wins>>losses) clamps to the top tier', skillLabel(50, 0).trim() === 'EXPERT')
  check('skillLabel: a big negative differential (losses>>wins) clamps to the bottom tier', skillLabel(0, 50).trim() === 'GRANNY')
  check('skillLabel(4,4): still a tie (index 10), still ORDINARY', skillLabel(4, 4).trim() === 'ORDINARY')
  // DS:08B0[20]=7 -> DS:08CD's own 8th string, "EXPERT" -- index 20 is the table's own top REAL
  // entry (wins-losses=10, e.g. 10-0), distinct from the clamp case above (wins-losses>10).
  check('skillLabel(10,0): index=20, the table\'s own top real entry (not just the clamp)', skillLabel(10, 0).trim() === 'EXPERT')
}

check('CHARACTER_NAMES has 11 entries (0-10, the valid lifetime-stat index range)', CHARACTER_NAMES.length === 11)
check('H2H_SKILL_INDEX_TABLE has 21 entries (DS:08B0, index range 0-20)', H2H_SKILL_INDEX_TABLE.length === 21)
check('H2H_SKILL_LABELS has 8 entries (DS:08CD)', H2H_SKILL_LABELS.length === 8)

// 7. selectSingleRaceTrack (GOAL-DOS-PARITY.md P4's 2nd item, docs/engine.md §9bi).
{
  check('SINGLE_RACE_TRACK_TABLE has 10 entries (DS:09D9)', SINGLE_RACE_TRACK_TABLE.length === 10)

  // Every one of the 10 real entries decodes (after the PRO-class remap) to a round 1-8/race 1-3
  // pair with a real, non-empty track name -- the byte-order/remap derivation's own proof, not a
  // re-assertion of a hand-typed expectation. The round/race bounds are asserted DIRECTLY (not just
  // "trackName() is non-empty"), because trackName() doesn't bound race itself -- an unbounded race
  // spills into the NEXT round's own TRACK_NAMES slots and can still return a real string, so a
  // swapped [round, race] destructure would only be caught on the entries whose swapped values
  // happen to fall outside 1-8/1-3 (proven below by mutating the destructure order directly).
  const seenClasses = new Set()
  for (let cursor = 0; cursor < 10; cursor++) {
    const t = selectSingleRaceTrack(cursor, 0) // delta=0: read this slot without moving
    check(`SINGLE_RACE_TRACK_TABLE[${cursor}]: round ${t.round} is in range 1-8`, t.round >= 1 && t.round <= 8)
    check(`SINGLE_RACE_TRACK_TABLE[${cursor}]: race ${t.race} is in range 1-3`, t.race >= 1 && t.race <= 3)
    const name = trackName(t.round, t.race)
    check(`SINGLE_RACE_TRACK_TABLE[${cursor}] (round ${t.round}, race ${t.race}) has a real track name`, typeof name === 'string' && name.length > 0)
    seenClasses.add(t.vehicleClass)
  }
  // The 10 vehicleClass values (the PRE-remap roundRaw) are every one of the 11 real vehicle
  // classes EXCEPT 9 (RUFFTRUX) -- single race never offers it.
  const expectedClasses = new Set([1, 2, 3, 4, 5, 6, 7, 8, 10, 11])
  check('vehicleClass covers every class 1-11 except 9 (RUFFTRUX), each exactly once', seenClasses.size === 10 && [...expectedClasses].every((c) => seenClasses.has(c)))
  check('vehicleClass never includes 9 (RUFFTRUX)', !seenClasses.has(9))

  // delta=0 re-reads the CURRENT entry without moving the cursor -- 2329's own initial CALL 2193
  // (23BC: MOV BX,0) -- proven by calling it twice in a row and getting the identical cursor/track.
  const first = selectSingleRaceTrack(3, 0)
  const second = selectSingleRaceTrack(first.cursor, 0)
  check('delta=0 re-reads the current entry: cursor unchanged', first.cursor === 3 && second.cursor === 3)
  check('delta=0 re-reads the current entry: same track both times', first.round === second.round && first.race === second.race)

  // Both wrap directions (21B1: JNS wraps negative to 9; 21B9: JLE 9 wraps past-9 to 0).
  check('wrap: cursor 0, delta -1, wraps to 9 (the LAST slot)', selectSingleRaceTrack(0, -1).cursor === 9)
  check('wrap: cursor 9, delta +1, wraps to 0 (the FIRST slot)', selectSingleRaceTrack(9, 1).cursor === 0)
  check('no wrap: cursor 3, delta +1, lands on 4 (an ordinary step)', selectSingleRaceTrack(3, 1).cursor === 4)

  // The two PRO-class remaps: SINGLE_RACE_TRACK_TABLE[1]=[3,10] and [9]=[3,11] are the ONLY two
  // entries whose raw second byte is 10 or 11 -- both must come out as round 3 / round 1
  // respectively, not literal "round 10"/"round 11" (which don't exist -- CAR_TYPE_INFO has 9 rows).
  check('PRO FORMULA ONE remap: roundRaw 10 -> round 3', selectSingleRaceTrack(1, 0).round === 3)
  check('PRO SPORTSCARS remap: roundRaw 11 -> round 1', selectSingleRaceTrack(9, 0).round === 1)
}

// 8. raceInfoSlideTicks (2216's own tick count, docs/engine.md §9bj): [0xCDD] += smoothness*4 each
// real 70Hz tick until it exceeds 88 -- checked against a direct simulation of that same loop for
// every real smoothness value (1-4), not just the hand-derived constants.
{
  function simulateSlideTicks(smoothness) {
    let cdd = 0
    let ticks = 0
    do { cdd += smoothness * 4; ticks++ } while (cdd <= 0x58) // 226E-22B3's own loop, JLE continues on <=
    return ticks
  }
  const expected = { 1: 23, 2: 12, 3: 8, 4: 6 }
  for (const smoothness of [1, 2, 3, 4]) {
    check(`raceInfoSlideTicks(${smoothness}) === ${expected[smoothness]} (hand-derived)`, raceInfoSlideTicks(smoothness) === expected[smoothness])
    check(`raceInfoSlideTicks(${smoothness}) matches a direct simulation of 226E-22B3's own loop`, raceInfoSlideTicks(smoothness) === simulateSlideTicks(smoothness))
  }
  check('raceInfoSlideTicks is monotonically DECREASING as smoothness rises (n=1 smoothest wants the slowest/longest reveal)', raceInfoSlideTicks(1) > raceInfoSlideTicks(2) && raceInfoSlideTicks(2) > raceInfoSlideTicks(3) && raceInfoSlideTicks(3) > raceInfoSlideTicks(4))
}

// 9. RACE_RESULT_SLIDE_TICKS (256E's own icon slide, docs/engine.md §9bl): a fixed 22, needing its
// OWN constant -- proven DIFFERENT from raceInfoSlideTicks at every real smoothness value, so a
// port that reused raceInfoSlideTicks here would be wrong at every setting except a coincidence.
{
  check('RACE_RESULT_SLIDE_TICKS === 22 (256E: fixed step 4, JZ exact match at 0x58)', RACE_RESULT_SLIDE_TICKS === 22)
  for (const smoothness of [1, 2, 3, 4]) {
    check(`RACE_RESULT_SLIDE_TICKS differs from raceInfoSlideTicks(${smoothness}) (2216's own smoothness-scaled slide)`, RACE_RESULT_SLIDE_TICKS !== raceInfoSlideTicks(smoothness))
  }
}

// 10. raceResultWaitStep (1000:17FF's own bounded dismiss-wait, docs/engine.md §9bl).
{
  // A fire button held CONTINUOUSLY from before the wait begins must NOT dismiss in AWAIT_RELEASE
  // -- this is the exact real automation pitfall this session hit live (PLAN.md §8): holding fire
  // through a carousel commit and into 0B51's own poll swallowed the handicap screen. 17FF's own
  // outer loop debounces this by waiting for a RELEASE first. Held for the WHOLE shared budget
  // (RACE_RESULT_WAIT_TICKS+1 calls), it must time out to 'retoggle', never 'dismiss'.
  {
    const s = raceResultWaitInitialState()
    check('raceResultWaitStep starts in AWAIT_RELEASE', s.phase === 'AWAIT_RELEASE')
    let sawDismiss = false
    let lastResult
    for (let tick = 0; tick < RACE_RESULT_WAIT_TICKS + 1; tick++) {
      lastResult = raceResultWaitStep(s, { fireHeld: true })
      if (lastResult.exit === 'dismiss') sawDismiss = true
    }
    check('a fire button held the whole shared budget never dismisses', !sawDismiss)
    check('a fire button held the whole shared budget times out to retoggle', lastResult.exit === 'retoggle')
    check('a retoggle resets phase back to AWAIT_RELEASE', s.phase === 'AWAIT_RELEASE')
    check('a retoggle resets ticks back to 0', s.ticks === 0)
  }
  // Releasing fire transitions AWAIT_RELEASE -> AWAIT_PRESS on the SAME call (182C: JZ), WITHOUT
  // resetting the tick count -- both phases share ONE budget, matching [0x2] only ever being reset
  // at 17FF's own entry (1809), never at 182C. Then a FRESH press dismisses immediately.
  {
    const s = raceResultWaitInitialState()
    const r1 = raceResultWaitStep(s, { fireHeld: false })
    check('releasing fire transitions to AWAIT_PRESS immediately (same call)', s.phase === 'AWAIT_PRESS' && r1.exit === null)
    check('the transition itself does not dismiss', r1.exit !== 'dismiss')
    check('the transition does NOT reset ticks (shared budget, not per-phase)', s.ticks === 1)
    const r2 = raceResultWaitStep(s, { fireHeld: true })
    check('a fresh press in AWAIT_PRESS dismisses immediately', r2.exit === 'dismiss')
  }
  // THE DISCRIMINATING TEST: fire held for the first 15 ticks (burning down the shared budget in
  // AWAIT_RELEASE), released on tick 16 (transition, budget carries over at 16, not reset to 0),
  // then nothing pressed. The shared-budget model retoggles on tick 21 (16 + 5 more, since
  // RACE_RESULT_WAIT_TICKS=20 and the check is ticks>20); a WRONG per-phase-reset model would
  // retoggle on tick 37 (16 + a FRESH 21-tick budget from the reset). This is the exact bug an
  // earlier same-session port draft had -- caught only by transitioning LATE enough that the two
  // models actually disagree (a transition on tick 1, as the test above does, cannot tell them
  // apart, docs/engine.md §9bl).
  {
    const s = raceResultWaitInitialState()
    for (let tick = 1; tick <= 15; tick++) {
      const r = raceResultWaitStep(s, { fireHeld: true })
      check(`tick ${tick}: still held, no exit yet`, r.exit === null)
    }
    const release = raceResultWaitStep(s, { fireHeld: false }) // tick 16: release, transition
    check('tick 16: transitions to AWAIT_PRESS, no exit', s.phase === 'AWAIT_PRESS' && release.exit === null)
    check('tick 16: ticks carries over to 16, not reset', s.ticks === 16)
    let retoggleTick = null
    for (let tick = 17; tick <= 25 && retoggleTick === null; tick++) {
      const r = raceResultWaitStep(s, { fireHeld: false })
      if (r.exit === 'retoggle') retoggleTick = tick
    }
    check('retoggle arrives on tick 21 (shared budget), not tick 37 (a wrong per-phase reset)', retoggleTick === 21)
  }
  // AWAIT_PRESS's own timeout (no press within the REMAINING shared budget) retoggles too, with a
  // full reset back to AWAIT_RELEASE/ticks=0.
  {
    const s = raceResultWaitInitialState()
    raceResultWaitStep(s, { fireHeld: false }) // tick 1: -> AWAIT_PRESS, ticks=1
    let lastResult
    for (let tick = 2; tick <= RACE_RESULT_WAIT_TICKS + 1; tick++) lastResult = raceResultWaitStep(s, { fireHeld: false })
    check('AWAIT_PRESS times out to retoggle when nothing is pressed', lastResult.exit === 'retoggle')
    check('AWAIT_PRESS timeout also resets phase to AWAIT_RELEASE', s.phase === 'AWAIT_RELEASE')
    check('AWAIT_PRESS timeout also resets ticks to 0', s.ticks === 0)
  }
  // anyKeyReleased ([0x107E] going nonzero -- ANY key's own release latch, not ESC specifically,
  // see this file's own header) dismisses immediately from EITHER phase, even with fire held.
  {
    const s1 = raceResultWaitInitialState()
    check('anyKeyReleased dismisses immediately from AWAIT_RELEASE, even with fire held', raceResultWaitStep(s1, { fireHeld: true, anyKeyReleased: true }).exit === 'dismiss')
    const s2 = raceResultWaitInitialState()
    raceResultWaitStep(s2, { fireHeld: false }) // -> AWAIT_PRESS
    check('anyKeyReleased dismisses immediately from AWAIT_PRESS too', raceResultWaitStep(s2, { anyKeyReleased: true }).exit === 'dismiss')
  }
  // state.ticks at the moment of 'dismiss' must equal the real [0x2] value at that instant (1819/
  // 183B's own tick-wait runs BEFORE 1825/1847's own [0x107E] check) -- this is the value
  // nextTrack's own v parameter should be seeded from. Three held calls (ticks 1-3), then a
  // release-latch dismiss on the 4th: ticks must read 4, not 3.
  {
    const s = raceResultWaitInitialState()
    raceResultWaitStep(s, { fireHeld: true })
    raceResultWaitStep(s, { fireHeld: true })
    raceResultWaitStep(s, { fireHeld: true })
    const r = raceResultWaitStep(s, { fireHeld: true, anyKeyReleased: true })
    check('state.ticks at dismiss equals the real [0x2] value (tick runs before the release check)', r.exit === 'dismiss' && s.ticks === 4)
  }
}

// Two-human setup (1E20, docs/engine.md §9bv): the per-entry roster reset, the two start
// characters, the commit (taken flag, car-slot word, handicap OR) and the session handicap cells.
{
  check('P1 starts on [0x9A0] = 5 (DWAYNE), P2 on [0x9A2] = 6 (JETHRO)', H2H_P1_START === 5 && H2H_P2_START === 6)
  const session = twoHumanSessionState()
  check('session: every handicap answer starts NO (0), CHOOSE GAME starts on nothing ([0x8A0]=0)', session.handicapAnswers.every((a) => a === 0) && session.chooseGameSelection === 0)
  const setup = twoHumanSetupState()
  check('fresh setup (0EBA): nobody taken, both slot words 11', twoHumanRosterBytes(setup).every((b, i) => b === i) && setup.rosterWords[0] === 11 && setup.rosterWords[1] === 11)
  check('WALTER (0) gets the handicap question in two-human play (raceFormat 2, P2 device 4)', handicapQuestionApplies(0, 2, 4))
  check('DWAYNE (5) does not', !handicapQuestionApplies(5, 2, 4))
  const w1 = commitTwoHumanPick(setup, session, 0, 0, 0x80)
  check('P1 WALTER with YES: slot word 0x80 (0B07 + 0B0E, [PROVEN] live in §9bn)', w1 === 0x80 && setup.rosterWords[0] === 0x80)
  check('... WALTER is now taken for P2 (0AC2)', twoHumanRosterBytes(setup)[0] === 0x40)
  check('... and the YES is stored in the session cell [0x1D6]', session.handicapAnswers[0] === 0x80)
  const w2 = commitTwoHumanPick(setup, session, 1, 1, 0)
  check('P2 MIKE with NO: slot word 1 ([PROVEN] live: [0x266A]=0x0001)', w2 === 1 && session.handicapAnswers[1] === 0)
  const again = twoHumanSetupState()
  check('a new TWO PLAYER entry resets the roster but the session keeps WALTER\'s YES', twoHumanRosterBytes(again)[0] === 0 && session.handicapAnswers[0] === 0x80)
  const w3 = commitTwoHumanPick(again, session, 0, 5, null)
  check('a character the question skips: plain index, no session write', w3 === 5 && session.handicapAnswers[5] === 0)
}

// 256E's whole screen (docs/engine.md §9bx): 22 silent slide ticks, then 17FF (CX=20) windows with
// a blink and a latch clear at each, no timeout, and the dismiss tick's [0x2] as the next seed.
{
  const s = raceResultScreenInitialState()
  let first = null
  const resets = []
  for (let t = 1; t <= 200; t++) {
    const r = raceResultScreenStep(s, { anyKeyReleased: t < 22, fireHeld: t < 22 }) // input during the slide
    if (r.exit) { first = t; break }
    if (r.resetLatch) resets.push(t)
  }
  check('256E: input during the 22-tick slide is ignored', first === null || first > 22)
  check('256E: the slide ends, the first blink and 17FF entry come on tick 22', resets[0] === 22)
  check('256E: a new 17FF window (and latch clear) every 21 ticks after that', resets.length >= 4 && resets.slice(1, 4).every((t, i) => t === 22 + 21 * (i + 1)))
  const n = raceResultScreenInitialState()
  let exited = false
  for (let t = 1; t <= 5000; t++) if (raceResultScreenStep(n, {}).exit) exited = true
  check('256E: no timeout -- 5000 idle ticks never leave', !exited)
  check('256E: the blink toggles every window', n.blinks > 200)
  const d = raceResultScreenInitialState()
  for (let t = 1; t <= 22; t++) raceResultScreenStep(d, {})
  for (let t = 1; t <= 6; t++) raceResultScreenStep(d, {})
  const r = raceResultScreenStep(d, { anyKeyReleased: true })
  check('256E: a release in the first window dismisses, seed = that window\'s [0x2] (7)', r.exit === 'dismiss' && r.seed === 7)
  const f = raceResultScreenInitialState()
  for (let t = 1; t <= 22; t++) raceResultScreenStep(f, { fireHeld: true })
  let fx = null
  for (let t = 1; t <= 100 && !fx; t++) { const q = raceResultScreenStep(f, { fireHeld: true }); if (q.exit) fx = q }
  check('256E: a fire held from the race never dismisses (17FF waits for its release)', fx === null)
}

// 2329's select screen (docs/engine.md §9by): the fire release-wait, the slide with no poll, then
// ESC release / fire / LEFT-or-RIGHT +1 with a fresh slide, the session cursor, no timeout.
{
  const session = twoHumanSessionState()
  const st = singleRaceSelectInitialState(session, 1) // HIGH smoothness: slide 23 ticks
  let raced = false
  for (let t = 1; t <= 10; t++) if (singleRaceSelectStep(st, session, () => ({ bits: 0x08, escReleased: false }), () => true).exit) raced = true
  check('2329: a fire held from before never races (23A9-23BA waits for its release)', !raced && st.phase === 'AWAIT_RELEASE')
  singleRaceSelectStep(st, session, () => ({ bits: 0, escReleased: false }), () => false)
  check('2329: the release tick starts 2193\'s slide', st.phase === 'SLIDE' && st.slideLeft === 23)
  const s2 = singleRaceSelectInitialState(session, 1)
  let first = null
  for (let t = 1; t <= 60 && first == null; t++) { const q = singleRaceSelectStep(s2, session, () => { first = t; return { bits: 0, escReleased: false } }, () => false) }
  check('2329: after the release tick, a 23-tick slide with no poll; the first poll is tick 25', first === 25)
  const s3 = singleRaceSelectInitialState(session, 1)
  for (let t = 1; t <= 24; t++) singleRaceSelectStep(s3, session, () => ({ bits: 0, escReleased: false }), () => false)
  const c0 = session.singleRaceCursor
  singleRaceSelectStep(s3, session, () => ({ bits: 0x80, escReleased: false }), () => false)
  check('2329: LEFT steps the cursor +1', session.singleRaceCursor === c0 + 1 && s3.phase === 'SLIDE')
  for (let t = 1; t <= 23; t++) singleRaceSelectStep(s3, session, () => ({ bits: 0, escReleased: false }), () => false)
  singleRaceSelectStep(s3, session, () => ({ bits: 0x40, escReleased: false }), () => false)
  check('2329: RIGHT also steps +1, not -1', session.singleRaceCursor === c0 + 2)
  const s4 = singleRaceSelectInitialState(session, 1)
  check('2329: the cursor persists into the next visit (session [0x8A3])', s4.track.cursor === c0 + 2)
  for (let t = 1; t <= 24; t++) singleRaceSelectStep(s4, session, () => ({ bits: 0, escReleased: false }), () => false)
  const race = singleRaceSelectStep(s4, session, () => ({ bits: 0x08, escReleased: false }), () => true)
  check('2329: fire races the selected track', race.exit === 'race' && race.track.cursor === c0 + 2)
  const s5 = singleRaceSelectInitialState(session, 1)
  for (let t = 1; t <= 24; t++) singleRaceSelectStep(s5, session, () => ({ bits: 0, escReleased: false }), () => false)
  check('2329: an ESC release leaves', singleRaceSelectStep(s5, session, () => ({ bits: 0, escReleased: true }), () => false).exit === 'cancel')
  const s6 = singleRaceSelectInitialState(session, 1)
  let ex = false
  for (let t = 1; t <= 5000; t++) if (singleRaceSelectStep(s6, session, () => ({ bits: 0, escReleased: false }), () => false).exit) ex = true
  check('2329: no timeout (5000 idle ticks)', !ex)
  const m = twoHumanMatchState(session)
  reportRace(m, 0, 1, true, { tournament: false })
  check('single race does not touch [28C1] (no 207A), but the tally and lifetime stats still count', m.raceNumber === 1 && m.p1Wins === 1 && session.lifetimeWins[0] === 1)
}

// [0x28C1] in a two-human single race (docs/engine.md §9dr): 2329 never writes it, so the race
// sees whatever the session's last tournament loop left; its one reader there is the respawn's
// race-0x16 rule (7008). The port used to pass the match's own race number, reset to 1 at 1F09.
{
  const reg = createRaceIndexRegister()
  check('[28C1] before any tournament: the static DS value 1', reg.value() === 1)
  const t = initTournament({ format: 'challenge' })
  reg.bindOnePlayer(t)
  check('the one-player loop starts at 0 (10AF)', reg.value() === 0)
  t.raceIndex = 0x16 // e.g. ESC out of race 0x16, or game over there
  check('the one-player loop leaves its index (0x16) behind', reg.value() === 0x16)
  initTournament({ format: 'challenge' }) // a new ONE PLAYER GAME pick, cancelled at the carousel: no 10A0
  check('a tournament that never started its loop does not touch it', reg.value() === 0x16)
  const session = twoHumanSessionState()
  const single = twoHumanMatchState(session) // CHOOSE GAME (1F09) -- does not write [28C1]
  check('CHOOSE GAME does not reset it: a single race still sees 0x16', reg.value() === 0x16 && single.raceNumber === 1)
  const m = twoHumanMatchState(session)
  reg.bindTwoHuman(m)
  check('the two-human tournament starts at 1 (1FB9)', reg.value() === 1)
  reportRace(m, 0, 1, true, { tournament: true })
  check('and INCs after each race (207A)', reg.value() === 2)
  reportRace(m, 0, 1, true, { tournament: false })
  check('a single race does not INC it', reg.value() === 2)
}

console.log(bad ? `${bad} of ${asserted} executed check(s) failed` : `check-twohuman: ${distinct.size} distinct assertions (${asserted} executed) pass -- two-human H2H's own tournament state (track pick with no repeats, win tally, session-level lifetime per-character stats that survive a new match, first-to-4 champion detection, the skill label formula, single race's own track select, the race-info slide's own tick count, the race-result screen's own fixed slide, and its own bounded dismiss-wait) matches the disassembly (GOAL-DOS-PARITY.md P4, docs/engine.md §9bh/§9bi/§9bj/§9bl)`)
process.exitCode = bad ? 1 : 0
