// Two-human Head to Head's own tournament state (GOAL-DOS-PARITY.md P4, 1st item, step 3 of 4:
// `RunHeadToHeadTournament 1000:1faf`, docs/engine.md §9bh). Pure state, no rendering -- same
// architecture as `tournament.js`/`elimination.js`.
//
// Source discipline: every rule below is transcribed from a fresh disassembly pass this session
// (`[STATIC]` unless noted), building on the ALREADY-ESTABLISHED win-tally/WINNER!-LOSER! polarity
// chain in docs/engine.md's own `UNKNOWN_26B8_polarity` writeup (an earlier session, `1000:256E`'s
// own general shape) and `UNKNOWN_2p_p2_record` (`docs/engine.md`, resolving `[98A]`/`[98C]` as the
// live win tally and flagging `2099-216B` -- `ShowHeadToHeadResultUnreferenced` -- as confirmed dead
// code, zero callers). This module does NOT model that dead function's own `[989]`/`[98B]`
// counters, or anything it calls (`get_xrefs_to 22B6`, one of its own callees, confirms its only
// caller is `2106`, inside the same dead function -- dead code calling more dead code).
//
// `RunHeadToHeadTournament`'s own body is `1FAF-2098` (NOT `1FAF-2170` -- `2099` onward is the
// separate, dead `ShowHeadToHeadResultUnreferenced`, above). It: sets `[0x988]`/`[0x8A5]`/`[0x28C1]`
// =1 at entry; zeroes the used-track bitmap; picks a track and draws the round/skill/lifetime-stat
// screen (`CALL 2481`, `CALL 2216`); RUNS THE RACE (`2074: CALL 216C`, `StopMusicRunRaceReloadAssets`,
// already documented elsewhere in this file to call `RunRaceMainLoop()`); THEN, after the race
// returns, calls `256E` (`ShowHeadToHeadRaceWinnerTune8`, the post-race WINNER!/LOSER!/tally screen
// -- NOT the race itself); increments `[0x28C1]`; checks `[0x98A]`/`[0x98C]` against 4 -- if either
// has reached 4, exits to `ShowChampionScreenTune3 1000:1AAD`; otherwise loops back to pick the
// next track. `[0x8A5]` (1 here, 0 at `RunHeadToHeadVehicleSelectTune2`'s own entry, below) is a
// genuine tournament-vs-single-race mode flag, confirmed by BOTH of its own real readers
// (`search_byte_patterns "A5 08"`, 4 hits total: the 2 writers, plus `256E`'s own outcome-message
// picker at `2621` and `DrawH2HWinRecordDigits`'s own gate at `2447`) -- not modelled as explicit
// state here (nothing in this module's own exported functions needs to branch on it), but see
// `selectSingleRaceTrack`'s own header for single race's own genuinely different shape.
//
// **Single race (`selectSingleRaceTrack`, `SelectSingleRaceTrack 1000:2193`, docs/engine.md §9bi,
// GOAL-DOS-PARITY.md P4's 2nd item).** Reachable from `RunHeadToHeadVehicleSelectTune2 1000:2329`
// via its own exactly 2 call sites (`get_xrefs_to 1000:2193`: `23BF`, the initial draw with
// `BX=0`; `23F4`, reached from either LEFT or RIGHT, both with `BX=1` -- no other caller anywhere,
// so `delta=-1`'s own wrap is real but genuinely never sent by this binary). `2329` is NOT merely
// "the single-race entry point" -- its own FULL body, `2329-2409`, is a complete, self-contained
// two-human racing loop with player-chosen tracks: `[0x8A5]`/`[0x988]`=0 at entry, draw the skill/
// lifetime-stat screen (`CALL 2481`, unconditional -- but NOT the win-tally digits: `2371: CALL
// 240A` is `DrawH2HWinRecordDigits`, whose own body -- `240A-2480`, confirmed by
// `get_function_by_address` -- gates the ENTIRE `[0x98A]`/`[0x98C]` read behind `CMP [0x8A5],0 /
// JZ 2480`, i.e. jumps straight to its own RET when `[0x8A5]==0` -- so single race draws NO win
// tally at all, only the skill label and lifetime WON/LOST), `CALL 2193` for the INITIAL track pick
// (`BX=0`, a delta of 0 -- re-reads the current cursor without moving it), wait for fire/LEFT/
// RIGHT/ESC, LEFT/RIGHT both re-call `2193` with `BX=1` -- confirmed by reading the bytes between
// the two tests, `23E9-23F4`: `BX=1` is set ONCE, before either test, and neither branch changes it
// before reaching `2193` -- matching this GOAL item's own "LEFT and RIGHT both step +1" note
// exactly, not just citing it -- fire runs the race (`216C`) then calls `256E` -- THE SAME post-race
// screen `RunHeadToHeadTournament` uses, confirmed by `get_xrefs_to 1000:256E`: exactly 2 callers,
// `2077` (tournament) and `2402` (here) -- so single race credits the SAME `[0x98A]`/`[0x98C]`
// tally and the SAME per-character lifetime stats as tournament mode (even though it never DISPLAYS
// the tally, above), sharing ONE `twoHumanSessionState`. Then loops back to redraw (`2405: JMP
// 234B`) -- `[STATIC]`, `256E`'s own TRUE full body (`256E-26BF`, confirmed by
// `get_function_by_address`, re-disassembled in full this session) has NO `[0x98A]`/`[0x98C]`-vs-4
// comparison anywhere in it (that check is exclusively inside `RunHeadToHeadTournament`'s own
// post-`256E` code, `2081-2098`, which single race's own loop never reaches), so single race has
// NO first-to-4/champion end condition of its own -- it runs until ESC (`23DC: CMP [0x107E],1 / JZ
// 2409`), not modelled here since this module has no "end the session" concept; the flow commit
// should NOT apply `reportRace`'s own `matchOver`/`champion` return value in single-race mode, only
// its tally/lifetime-stat side effects.
//
// `SelectSingleRaceTrack` itself (`2193-2215`) is small and pure: `cursor=[0x8A3]` (0-9, wrapping
// both ways -- `21B1: JNS` wraps a negative result to 9, `21B9: JLE 9` wraps past-9 to 0) plus a
// `delta` parameter (the real `BX`) selects a `SINGLE_RACE_TRACK_TABLE` entry (`data/frontend-
// tables.js`, `DS:09D9`); the entry's own `roundRaw` gets remapped (10 -> round 3, 11 -> round 1,
// the two PRO-class sentinels CLAUDE.md's own "four sites" note already flags) before becoming the
// real round the race engine uses. `roundRaw` ITSELF (pre-remap, 1-11) is returned too as
// `vehicleClass` -- `2216` (the shared slide, below) draws the vehicle-CLASS name from `DS:002F`
// indexed by `[0x9D8]-1` (`225A`, confirmed by disassembly), the PRE-remap value, so the two PRO
// entries (`roundRaw` 10/11) need their own distinct class name ("PRO FORMULA ONE"/"PRO
// SPORTSCARS", not plain "FORMULA ONE"/"SPORTSCARS") for the eventual screens commit -- without
// `vehicleClass` in the return value that distinction would be lost. The table's own 10 `roundRaw`
// values are confirmed to be every vehicle class 1-11 EXCEPT 9 (RUFFTRUX) -- single race never
// offers RUFFTRUX, tested directly. `[0x8A3]` has no reset site anywhere this session found
// (`search_byte_patterns "A3 08"`: exactly 2 hits, both `SelectSingleRaceTrack`'s own
// read-modify-write of it) and its own default is `0` -- `[PROVEN]`: a live DOSBox `mem_read` of
// the real WORD-sized field (`[0x8A3]` is read/written as a 16-bit `AX`, not a byte) matched the
// static Ghidra read, both `0` -- so the cursor persists across single races for as long as the
// game runs, the SAME session-lifetime shape the lifetime win/loss counters already have, not
// reset per-match like the tournament's own win tally.
//
// `2216` (called from BOTH `1FAF` and here, `2200`) is a SHARED slide-into-view UI primitive, not
// race-intro-specific presentation.
//
// **Track pick (`nextTrack`, `1000:1FBE-1FF9`).** `H2H_TRACK_TABLE` (`data/frontend-tables.js`,
// `DS:09BA`) packs `round<<2|race-1` per slot, the SAME encoding `DS:043C`'s own one-player
// `ORDER_TABLE` uses. `[0x9C2..0x9C9]` (8 bytes) is a per-slot "used" bitmap, zeroed once at
// tournament entry (`1FBE`) and again whenever every slot has been used (the SAME zero-and-retry
// loop, `1FDB: JMP 1FBE`) -- this can never actually fire within one match, since a match is over
// by 7 races at the latest (first to 4 wins is at most a 4-3 finish) and the bitmap has 8 slots,
// but it is ported for fidelity anyway. The real pick (`1FDD-1FE9`) reads `v=[0x2]&7` and
// RE-SAMPLES it in a tight loop (re-reading the live 70Hz tick counter, not incrementing a local
// copy) until landing on an unused slot -- functionally the SAME as a cyclic scan `(v+k)&7` for
// `k=0,1,2,...` starting from the FIRST sampled `v`, since `[0x2]` increments by exactly 1 every
// real 70Hz tick (docs/engine.md §9v's own shared-incrementer finding) and nothing else runs
// between resamples. Modelled here as the scan (pure, testable, no tick source needed) rather than
// the resample loop; `v` is the caller's own responsibility to supply (this port's
// `DS:0002`-as-a-random-seed convention, matching `tournament.js`'s own deliberate non-modelling of
// two-human H2H's non-determinism -- see that file's own header).
//
// **Win tally (`reportRace`, `1000:2081/208B` compare, `1000:1F09/1F0E` reset, `1000:207A`
// increment).** `[0x98A]`/`[0x98C]` (P1/P2 match-win tally, 0-4) reset to 0 at
// `RunHeadToHeadChooseGameMenu`'s own entry (`1F09`/`1F0E` -- once per CHOOSE GAME visit, not once
// per race -- single race loops straight back through this SAME entry, `1FA6: JMP 1EF1`, so it
// resets them too), first to 4 wins the match and is sent to `ShowChampionScreenTune3 1000:1AAD`
// (not modelled here -- a screen, this module only reports the fact). `[0x28C1]` (tournament index)
// is set to 1 at `1FB9` and incremented once per race at `207A` -- read by `altTuningFieldsFor`'s
// own `3F3B` path as `[STATIC]`-confirmed to be UNUSED (`3F3B-3FBD` never reads `[0x28C1]` at all,
// per docs/engine.md §9bg), so it is tracked here (`raceNumber`) purely for fidelity/display, not
// because anything in the engine consults it in this mode.
//
// **Session vs. match lifetime (`twoHumanSessionState`/`twoHumanMatchState`).** The win tally and
// used-track bitmap reset every time `RunHeadToHeadChooseGameMenu` is entered (i.e. once per
// MATCH), but the per-character LIFETIME win/loss counters (below) have no direct writer and no
// REP-fill covering them anywhere this session's own exhaustive sweep found (docs/engine.md §9bh --
// not a proof against every possible write shape, e.g. an indexed store or a file load), so they
// persist across matches for as long as the game runs -- this module splits state
// into a small SESSION object (the lifetime counters, created once) and a MATCH object (everything
// else, created fresh per match, holding a reference to the session object it credits).
//
// **Lifetime per-character stats + skill label (`reportRace`/`skillLabel`, `1000:256E`/`2481`).**
// `[0x9A4+c]`/`[0x9AF+c]` (one BYTE per character, 0-10 -- `CHARACTER_NAMES.length`) are the
// character's own LIFETIME win/loss counts, genuinely incremented by LIVE code -- confirmed this
// session by disassembling `256E` (`ShowHeadToHeadRaceWinnerTune8`) itself: `25A6-25BE` increments
// the WINNER's own character record's lifetime wins and the LOSER's lifetime losses, reading the
// character index via `[0x3FC]`/`[0x3FE]` (the SAME order-array-derived WINNER/LOSER record
// pointers the WINNER!/LOSER! banner logic uses) `-> [BX+0x13] -> &0xF`. (A second, NOT-hypothetical
// inconsistency noted, not modelled: `2481`'s own DISPLAY-only read of the SAME fields masks P1's
// character with `&0x1F` and P2's with `&0xF` -- both are no-ops for any real character index 0-10
// on their own, but `[0xC16]`/`[0xC31]` are shared portrait-frame fields whose own bit 4 is
// genuinely TOGGLED by `256E`'s own tail (`26A0-26BD`, the WINNER!/LOSER! banner's blink loop:
// `XOR 0x10` once per `17FF` timeout iteration, until a keypress), and BOTH tournament's and single
// race's own re-entries into `2481` happen after that blink has already run -- so P1's own display
// index genuinely depends on the blink's own exit parity, not modelled here, a concrete note for
// the screens commit's own `2481` port.)
// `DS:09A4` (22 bytes) is `[PROVEN]` this session (both a static Ghidra read and a live DOSBox read
// on the SAME running session, byte-identical): all zero, confirming these start at 0 and only grow
// through real play.
//
// `skillLabel(wins, losses)` is `1000:2481`'s own formula. Its own PUSH/POP discipline around two
// `CALL 0929` draw calls (`248F` pushes wins, `2497` pushes losses, and the register pushes/pops
// immediately around each `CALL 0929` are exactly balanced) means `24C7`/`24C8`'s own final pops
// recover the ORIGINAL wins/losses bytes, giving a clean formula: `index = clamp(wins - losses + 10,
// 0, 20)`, `label = H2H_SKILL_LABELS[H2H_SKILL_INDEX_TABLE[index]]` (`data/frontend-tables.js`,
// `DS:08B0`/`DS:08CD`, both `[PROVEN]` this session the same way as `DS:09A4` above). Cross-checked
// against this session's own M3.61 live capture (docs/engine.md §9bg): the TOURNAMENT RACE screen
// showed "WON 0 LOST 0" for BOTH players -- a tie, `index=10` -- and `H2H_SKILL_INDEX_TABLE[10]
// ===3`, `H2H_SKILL_LABELS[3].trim()==="ORDINARY"`, matching a tied 0-0 record's own intuitive
// "neutral" label; the LABEL TEXT itself was not read off that screen (only the 0-0 tie inputs
// were), so this cross-check confirms the formula's OWN output on a live-confirmed input, not an
// independently-read label.
//
// Deliberately NOT modelled here (docs/engine.md §9bh, scoped by an advisor review): the handicap
// question screen (`1000:0B51`, called only from `RunCharacterSelectMenuTune2` -- character select,
// not this module's own per-race loop) and its still-open link (if any) to `altTuningFieldsFor`'s
// own roster-word bit 7 (`UNKNOWN_handicap_rosterword_link`); the WINNER!/LOSER! banner draw and the
// champion screen themselves (`256E`/`1AAD`, screens); the race-intro slide (`2216`); and the
// source of `v` for `nextTrack` (`DS:0002`'s own value at the real resample site, still open -- see
// docs/engine.md §9bh's own "Not yet done" list). These belong to the screens/flow-wiring commit.

import { CHARACTER_NAMES, H2H_TRACK_TABLE, H2H_SKILL_INDEX_TABLE, H2H_SKILL_LABELS, SINGLE_RACE_TRACK_TABLE } from '../data/frontend-tables.js'

export { H2H_TRACK_TABLE, SINGLE_RACE_TRACK_TABLE }
export const H2H_WINS_TO_CHAMPION = 4 // 1000:2081/208B, byte[98A]/[98C] compared against 4

/** `DS:09BA`'s own `round<<2|race-1` decode, the SAME packing `DS:043C`'s own `ORDER_TABLE` uses. */
function decodeTrack(byte) {
  return { round: byte >> 2, race: (byte & 3) + 1 }
}

/** `SelectSingleRaceTrack 1000:2193`'s own pure logic -- see this file's own header for the full
 * derivation. `cursor`: the caller's own `[0x8A3]`-analogue (0-9, this function's own return value
 * is the NEW cursor -- callers own persisting it, matching `[0x8A3]`'s own session-lifetime, no
 * reset). `delta`: the real `BX` (`0` re-reads the current entry with no move, matching `2329`'s
 * own initial `CALL 2193` at `23BF`; `+1` is what LEFT and RIGHT both actually send in the real UI,
 * `-1` is supported by the real wrap logic but never sent by anything in this binary). Returns
 * `vehicleClass` (the PRE-remap `roundRaw`, 1-11) alongside `round` (the race engine's own
 * post-remap value) -- the screens commit needs the class name distinction the remap loses (see
 * this file's own header, `2216`'s own `DS:002F` class-name draw). */
export function selectSingleRaceTrack(cursor, delta) {
  let next = cursor + delta
  if (next < 0) next = 9 // 21B1: JNS -- wraps a negative result to the LAST slot
  else if (next > 9) next = 0 // 21B9: JLE 9 -- wraps past the last slot back to the FIRST
  const [race, roundRaw] = SINGLE_RACE_TRACK_TABLE[next]
  const round = roundRaw === 10 ? 3 : roundRaw === 11 ? 1 : roundRaw // 21D3-21DD, the two PRO-class remaps
  return { cursor: next, round, race, vehicleClass: roundRaw }
}

/** The per-character lifetime win/loss counters (`[9A4+c]`/`[9AF+c]`) -- created ONCE per game
 * session (no direct writer or covering REP-fill found, docs/engine.md §9bh), shared across every
 * match a `twoHumanMatchState`
 * is created for. */
export function twoHumanSessionState() {
  return {
    lifetimeWins: new Array(CHARACTER_NAMES.length).fill(0), // [9A4+c]
    lifetimeLosses: new Array(CHARACTER_NAMES.length).fill(0), // [9AF+c]
  }
}

/** One MATCH's own state (`session`: the `twoHumanSessionState()` this match credits -- required,
 * not optional, since real lifetime stats always persist across matches). */
export function twoHumanMatchState(session) {
  return {
    session,
    p1Wins: 0, p2Wins: 0, // [98A]/[98C], reset at RunHeadToHeadChooseGameMenu 1F09/1F0E
    raceNumber: 1, // [28C1], 1FB9
    usedTracks: new Array(H2H_TRACK_TABLE.length).fill(false), // [9C2..9C9]
  }
}

/** Picks and marks-used the next track for `v` (the caller's own `DS:0002`-analogue sample --
 * see this file's own header for why a raw tick value, not a pre-masked one, is expected: this
 * function does its own `&7`, matching `1000:1FE1`). Resets the whole used-bitmap first if every
 * slot is already used (`1FBE`, never actually reachable within one real match -- see header --
 * but ported for fidelity and tested directly, below). */
export function nextTrack(state, v) {
  if (state.usedTracks.every(Boolean)) state.usedTracks.fill(false) // 1FBE-1FDB
  let slot = v & 7 // 1FDD-1FE1
  for (let k = 0; k < state.usedTracks.length && state.usedTracks[slot]; k++) slot = (slot + 1) & 7
  state.usedTracks[slot] = true // 1FEB
  return decodeTrack(H2H_TRACK_TABLE[slot])
}

/** Reports one race's own outcome. `p1Character`/`p2Character` are each player's own selected
 * character index (0-10, `CHARACTER_NAMES`), needed only to credit the right character's own
 * lifetime stats (in `state.session`) -- this module doesn't own character selection. `p1Won`:
 * whether P1's own car was `[26B8]` at `256E`'s own read (the already-established WINNER!/LOSER!
 * polarity chain, docs/engine.md's `UNKNOWN_26B8_polarity` writeup) -- this module doesn't own race
 * resolution either. Returns `{ matchOver, champion }` -- `champion` is `1`/`2`/`null`, matching
 * `1000:2081/208B`'s own real "first to reach 4 wins" ordering (P1 checked first, but only one
 * side's own tally can possibly be 4 after any single race, since exactly one increments per
 * call). */
export function reportRace(state, p1Character, p2Character, p1Won) {
  state.raceNumber++ // 207A
  if (p1Won) {
    state.p1Wins++ // 2583
    state.session.lifetimeWins[p1Character]++ // 25B0
    state.session.lifetimeLosses[p2Character]++ // 25BE
  } else {
    state.p2Wins++ // 257D
    state.session.lifetimeWins[p2Character]++
    state.session.lifetimeLosses[p1Character]++
  }
  const matchOver = state.p1Wins === H2H_WINS_TO_CHAMPION || state.p2Wins === H2H_WINS_TO_CHAMPION
  return { matchOver, champion: matchOver ? (p1Won ? 1 : 2) : null }
}

/** `1000:2481`'s own formula -- see this file's own header for the full derivation. Returns the
 * label WITH its own real leading-space padding (`H2H_SKILL_LABELS`'s own layout) -- trim if a
 * caller wants the bare word. */
export function skillLabel(wins, losses) {
  const index = Math.max(0, Math.min(H2H_SKILL_INDEX_TABLE.length - 1, wins - losses + 10))
  return H2H_SKILL_LABELS[H2H_SKILL_INDEX_TABLE[index]]
}
