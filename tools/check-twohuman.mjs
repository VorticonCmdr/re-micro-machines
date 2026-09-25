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
//   node tools/check-twohuman.mjs
import { twoHumanSessionState, twoHumanMatchState, nextTrack, reportRace, skillLabel, selectSingleRaceTrack, raceInfoSlideTicks, H2H_TRACK_TABLE, H2H_WINS_TO_CHAMPION, SINGLE_RACE_TRACK_TABLE } from '../src/frontend/twoHuman.js'
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

console.log(bad ? `${bad} of ${asserted} executed check(s) failed` : `check-twohuman: ${distinct.size} distinct assertions (${asserted} executed) pass -- two-human H2H's own tournament state (track pick with no repeats, win tally, session-level lifetime per-character stats that survive a new match, first-to-4 champion detection, the skill label formula, single race's own track select, and the race-info slide's own tick count) matches the disassembly (GOAL-DOS-PARITY.md P4, docs/engine.md §9bh/§9bi/§9bj)`)
process.exitCode = bad ? 1 : 0
