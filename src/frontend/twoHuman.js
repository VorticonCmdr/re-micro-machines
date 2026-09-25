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
// `get_function_by_address` -- gates the `[0x98A]`/`[0x98C]` DIGIT DRAW behind `CMP [0x8A5],0 /
// JZ 2480` -- so single race draws NO win-tally DIGITS -- **CORRECTED, docs/engine.md §9bl: this
// gate does NOT jump straight to the function's own RET; `240A`'s own body BEFORE this gate
// unconditionally masks and redraws both players' own portrait panels (`AND [0xC16]/[0xC31],0x4F`
// then `CALL 0DB0`/`06CC`/`0F3C` -- the portrait, its outline, and the character's own name),
// regardless of `[0x8A5]` -- single race still gets this portrait panel, only the WON/LOST digit
// sprites specifically are skipped**), `CALL 2193` for the INITIAL track pick
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
// pointers the WINNER!/LOSER! banner logic uses) `-> [BX+0x13] -> &0xF`. (A second inconsistency was
// noted here, NOT modelled: `2481`'s own DISPLAY-only read of the SAME fields masks P1's character
// with `&0x1F` and P2's with `&0xF` -- both are no-ops for any real character index 0-10 on their
// own, but `[0xC16]`/`[0xC31]` are shared portrait-frame fields whose own bit 4 is genuinely
// TOGGLED by `256E`'s own tail (`26A0-26BD`, the WINNER!/LOSER! banner's blink loop), so P1's own
// display index was thought to depend on the blink's own exit parity. **CORRECTED, docs/engine.md
// §9bl: `240A` clears this bit unconditionally before every real `2481` call, including `256E`'s
// own, so the blink's own exit parity never actually reaches a `2481` read -- this is not a real
// divergence.**)
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
// **`2216`'s own tick count (`raceInfoSlideTicks`, docs/engine.md §9bj).** `2216-22B5`'s own slide
// loop increments record 8's own X field (`[0xCDD]`, `0xC03+8*0x1B`) by `smoothness*4` per real ISR
// tick until it exceeds 88 (`0x58`), decrementing record 9's own X field (`[0xCF8]`,
// `0xC03+9*0x1B`) by the same amount -- solving that bound gives
// `ticks = floor(88/step) + 1 = floor(22/smoothness) + 1`, distinguished from the alternate
// "reaches-or-exceeds" reading (`ceil(22/smoothness)`, which coincides with this formula at
// smoothness 3/4 but NOT 1/2 -- 88 divides evenly by `step` there) by a direct reintroduction test,
// below. Called once per race by `RunHeadToHeadTournament` (`206E`) and once per
// `selectSingleRaceTrack()` invocation by `SelectSingleRaceTrack` itself (`2193`'s own internal
// `CALL 2216` at `2200` -- NOT from `2329`'s own top-level body; `234B` does write `[0xCDD]=0x56`
// directly, but the calls between that write and `2200` -- `240A` (skips only its own win-tally
// digit draw when `[0x8A5]==0`, docs/engine.md §9bl -- its own portrait-panel masking/redraw
// still runs, on records 0/1, unrelated to records 8/9), `04B8` on record 4 (`0xC6F`), `2481`
// (records 0/1 only), `0910` (a plain position-argument string draw, `get_function_by_address`-
// confirmed but not itself disassembled) -- touch neither `[0xCDD]`/`[0xCF8]` nor records 8/9 at
// all, so the `0x56` value is simply overwritten
// by `2216`'s own entry-time reset before anything could show it, and single race genuinely DOES
// animate the full slide on every track-select action, not just once per screen visit). Only the
// tick COUNT is ported here, matching the established precedent (`tournament.js`'s own
// `raceIntroHoldTicks`) of not porting the sprite-panel animation itself; also matching that
// precedent's own caveat, NOT stated as a precise duration: `3165` (`WaitNextVsyncTick`, disassembled
// this session) waits for `CS:[0x4ADE]` to CHANGE from whatever value it holds when `3165` is
// entered, so each iteration advances by AT LEAST one real tick, more if the per-iteration draw/
// present work (in between `226E`'s own `CS:[0x4ADE]=0` reset and `3165`'s own call) takes longer
// than one tick on real 1994 hardware -- the reset's own exact purpose is not identified this
// session. Records 8/9's own `+0x13` frame fields (`[0xCEE]`/`[0xD09]`) are set to `round-1` and
// `round-1+8` -- two round-indexed icons, converging (record 8 slides X from 0 toward 88+, record 9
// from 224 down toward 136-, both at Y=0x46) rather than diverging -- and their own RESTING position
// depends on smoothness (`ticks*step`, which overshoots 88): 92/132 (40px apart) at smoothness 1,
// 96/128 (32px apart) at smoothness 2-4 (12*8=8*12=6*16=96, a coincidence of these particular
// smoothness/tick pairs) -- a real constraint for the eventual screens commit, which cannot hardcode
// a single end position.
//
// Deliberately NOT modelled here (docs/engine.md §9bh/§9bj, scoped by an advisor review): porting
// the handicap question screen as interactive UI/state (`1000:0B51`, re-disassembled in FULL already
// in §9bf -- `0B40-0C10`, its own Y/N toggle and answer-cell storage at `DS:[0x1D6+character]` both
// already traced byte-exact there -- called from `RunCharacterSelectMenuTune2`, and CONFIRMED
// REACHABLE in two-human H2H specifically: `handicapQuestionApplies`'s own two skip conditions,
// `raceFormat===1`/`otherDeviceType===6`, both come out FALSE for a real two-human match,
// `[0x2656]=2` and `[0x265A]` = the real P2 control device (never `6`, the AI/drone sentinel) -- so
// this screen genuinely fires for a character 0-2 pick in this mode, same as any other; what's NOT
// done is porting it as actual interactive state/UI, and its still-open link to `altTuningFieldsFor`'s
// own roster-word bit 7, `UNKNOWN_handicap_rosterword_link`); the WINNER!/LOSER! banner draw (`256E`,
// a screen); `2216`'s own sprite-panel animation (only its tick count is ported, above); and the
// source of `v` for `nextTrack` (`DS:0002`'s own value at the real resample site, still open -- see
// docs/engine.md §9bh's own "Not yet done" list). These belong to the screens/flow-wiring commit.
// `1AAD` (`ShowChampionScreenTune3`) itself is NOT new work: `flow.js` already has a `CHAMPION` phase
// wired to `drawChampion`/`championMusic` for the one-player tournament path, and H2H's own champion
// exit (`RunHeadToHeadTournament`'s post-`256E` code) calls the SAME `1AAD` -- the wiring commit
// reuses this, not a new port. What DOES need no new port (§9bj): the character-select and
// CHOOSE-GAME-menu STATE MACHINES -- `RunTwoPlayerHeadToHeadSetup 1000:1E20` calls the ALREADY-PORTED
// `RunCharacterSelectMenuTune2`/`charSelectStep` twice, once per player, via a pointer swap
// (`[0x1080]`) this port's own `charSelectStep(state, input, roster)` already supports by taking
// `input` as a plain parameter -- a wiring commit needs a second `createKeyboardReader` instance for
// P2's own control device, plus `0B51`'s own port (above), not new carousel logic. RESOLVED (from
// `09E0`'s own already-captured disassembly): it marks a pick taken internally, on confirm
// (`0AB5-0AC2`: `OR byte[0x164+[0x160]],0x40`, the SAME "taken" bit `charSelect.js`'s own entry-
// skip/fire-confirm gate already reads) and releases a slot's own old pick on re-entry
// (`0A34-0A3B`) -- P2 genuinely cannot pick P1's own already-confirmed character, no new
// charSelect.js logic needed. `1EF1`
// (`RunHeadToHeadChooseGameMenu`, the "CHOOSE GAME!" TOURNAMENT/SINGLE RACE picker, its own real
// resting selection `[0x8A0]` read `0` in the static image, `[STATIC]` -- nothing pre-selected,
// unlike `SELECT GAME`'s own documented non-zero resting value; its own cancel path, `1FA9`, does
// NOT write `[0x8A0]`, so a prior confirmed pick survives a cancel -- matching `SELECT GAME`'s own
// persisted-pick pattern, not `ONE PLAYER GAME`'s reset-on-cancel one) is likewise a third instance
// of the ALREADY-PORTED `twoItemMenuStep`/`twoItemMenuInitialState` (`frontMenu.js`), needing only a
// new `screens.js` draw function and a `flow.js` entry, not new menu logic.
//
// **`256E`'s own full body (`256E-26BF`, disassembled in full, docs/engine.md §9bl).** Confirms and
// extends the earlier `UNKNOWN_26B8_polarity` writeup: the DIRECT, proximate winner/loser decision
// is `[0x3FC]==0xC03` (car 0/P1), read at `256E`'s own entry (`2574`) and immediately re-normalized
// into `[0x3FC]`(winner)/`[0x3FE]`(loser) (`2587`/`258B`) -- `[0x3FC]`/`[0x3FE]` are themselves
// freshly resolved EVERY race by `11D5` (called from `216C`/`StopMusicRunRaceReloadAssets`'s own
// tail, `218F` -- confirmed by `get_xrefs_to`, exactly 2 callers total, the other being one-player's
// own `SetupTournamentRace`), so this does not go stale across races within a match. `256E` then:
// increments the win tally (`[0x98A]`/`[0x98C]`) and both characters' own lifetime stats; calls
// `240A` (`AX=0x64`) -- its own win-tally DIGIT draw is gated on `[0x8A5]`, but it unconditionally
// masks/redraws both players' own portrait panels first, below -- and the skill labels
// (`CALL 2481`); draws "WINNER!"/"LOSER!" (`DS:0x966`/`DS:096E`) at the winner's/loser's own actual
// SCREEN SLOT (P1's own X=0x1D/29 if `[0x3FC]==0xC03` else "LOSER!" there, and symmetrically for
// P2's own X=0xB1/177) -- i.e. the text always follows whoever actually won, not a fixed per-player
// position; ORs a POSE-SELECT flag into the portrait records' own `+0x13` field (`[0xC16]`/`[0xC31]`,
// `2609`/`260D`): `0x0200` for the winner's own record, `0x0300` for the loser's -- ON TOP OF
// whatever the blink loop (below) later XORs in. **NOT a bug, despite looking like one on its own:**
// `240A` (`DrawH2HWinRecordDigits`) is called UNCONDITIONALLY at the very start of every per-race
// setup (`2037`/`2374`) AND again inside `256E` itself (`25C5`, before THIS OR even runs) -- it
// opens by storing its own Y position, then draws the screen base (`CALL 0400` -- clear, BADGE,
// header bar), THEN (well before its own `[0x8A5]` gate) does `AND word[0xC16],0x4F` / `AND
// word[0xC31],0x4F`, clearing bit 4 (the blink toggle) and bits 8-9 (this exact pose-select tag)
// together. So every
// `2481` call -- both the one inside a race's own per-race setup and the one inside `256E` -- is
// immediately preceded by a `240A` call that just reset these bits; there is no window where `2481`
// can see a stale tag from an earlier race (`2481`'s own `&0x1F`/`&0xF` masks, §9bh, are real but
// not protecting against this -- the one bit BOTH masks strip that `240A`'s own `0x4F` mask KEEPS,
// bit 6, is what `0DB0`'s own CH==0/FCNORMAL path turns into frame 13, the "taken" pose; bit 6's
// own writer is CLOSED, not open -- `1000:170A: OR [BX+0x13],0x40`, the Challenge-only elimination
// screen's own victim marker. The sprite pool's own slots are SHARED across screens, so a leftover
// bit from an earlier Challenge session could in principle survive into H2H -- but `0EBA` (H2H's
// own entry reset, `[0xC16]/[0xC31]=0xB`) and `09E0`'s own clean commit (`0A3B`/`0B37`) together
// guarantee it cannot, so `2481`'s own masks stripping it is simply defensive). Draws
// "RESULTS!!" (`DS:095C`, Y=0x3C) and, below it, "TOURNAMENT RACE"/"SINGLE RACE" (`DS:0975`/`0x93A`,
// picked by `[0x8A5]`, Y=0x4C) -- both via `DrawStringCentred`, font `0xB54`. Fades the palette up
// (`CALL 32CE`, the SAME "no derivable tick duration" `UNKNOWN_race_intro_prehold` class elsewhere
// in this file -- not paced here either). Slides the SAME two round-indexed icons `2216` uses
// (records 8/9, `DS:0x28BF`-indexed frame) into view a SECOND time, but with a FIXED step of 4 (NOT
// `smoothness*4`) and an EXACT-equality exit (`JZ`, not `JLE`) -- so this slide always takes EXACTLY
// 22 iterations, at every smoothness setting, landing on X=88/136 (no overshoot, unlike `2216`'s own
// smoothness-dependent overshoot) at a different Y (`0xB6`/182, vs `2216`'s own `0x46`/70); the FINAL
// iteration's own exit (`JZ`, taken before the loop's own background-restore calls) leaves the icons
// drawn on screen, uniquely among every iteration -- they are never erased again before the blink
// phase begins. Then blinks both portraits' own `+0x13` bit 4 (`XOR ...,0x10`, `26A3`/`26AD`, each
// followed by `CALL 0DB0` -- a non-destructive "resolve bank+frame to an actual bound sprite, blit
// once via `053A`, then restore the field" helper, `0DB0-0E01`, disassembled this session: CH (the
// pose-select flag's own byte) selects among 4 descriptor tables at `DS:0A14`/`0A28`/`0A3C`/`0A50`,
// and BOTH the WINNER's own bank (`CH==2`, from the `0x0200` OR above) AND the LOSER's own bank
// (`CH>=3`, from `0x0300`) apply the SAME 5-bit rotate to the frame nibble before lookup -- the two
// banks differ only in which descriptor table they bind, not in whether the frame rotates (only
// `CH==1`'s own bank passes the frame through unchanged) -- pixel-animation detail, not ported here) until dismissed --
// see `raceResultWaitStep`, below, for the exact bounded-wait mechanism (`1000:17FF`, disassembled
// this session), which both toggles the OUTER `256E` loop's own retry (on a timeout) and the actual
// dismiss condition (a fresh fire press, or any key's own release latch going nonzero).
//
// **`DS:0002`'s own true nature, resolved (closing §9bh's own long-open "source of `v`" item).**
// `search_byte_patterns "C7 06 02 00"` (the `MOV word ptr [0x2],imm16` IMMEDIATE-STORE encoding
// only -- not the ISR's own increment, nor any register-mediated store form, neither swept; the
// reverse `A3 02 00` form has zero hits) finds exactly 13 immediate-store sites. 11 of the 13 reset
// to `0` (confirmed with the narrower "C7 06 02 00 00 00" pattern), inside: the TITLE
// SCREEN's own attract loop (`RunTitleScreenAttractLoop`), `RunTwoItemMenu`, `09E0` (character
// select, `0A75`/`0AE2`), `179B` (the race-intro/elimination-bounce successor wait stage, `179F`),
// `17FF` itself (`1809`, below), `2329` (single race, `23C2`), and THREE MORE one-player screens
// (`ShowRaceResultsScreenTune8or6`, `ShowCharacterEliminatedTune6`, one site each of
// `ShowChampionScreenTune3` and `ShowRaceOutcomeMessageTune8or6`). The OTHER 2 sites -- each
// function's remaining site, `ShowChampionScreenTune3`'s `1B25: MOV [0x2],0x32` (50) and
// `ShowRaceOutcomeMessageTune8or6`'s `1D25: MOV [0x2],0x226` (550) -- seed a nonzero value well
// above that same function's own blink-loop threshold (`>=0xF`/`>0xF`), forcing an immediate
// first toggle on entry; the loop's own reset-to-0 branch (already counted above) takes over from
// there, so the counter still behaves like every other site once the loop is running. NEITHER of
// these is a call into `17FF` -- each is its own short inline loop that only shares the
// toggle-on-threshold idiom, with its own different (and undebounced) dismiss condition; do not
// reuse `raceResultWaitStep` for either screen. `17FF` itself has 8 real call sites across 5
// functions (`get_xrefs_to`, this session), not just `256E`/`ShowRaceOutcomeMessageTune8or6` --
// see docs/engine.md §9bl for the full list; the other 6 sites are unread this session
// (`UNKNOWN_17ff_other_callers`). `DS:0002` is
// therefore NOT a from-boot free-running
// counter as GOAL-DOS-PARITY.md's own P4 item 1 assumes ("Reproduce `DS:0002` as a 70 Hz tick
// counter that runs from boot") -- it is a GENERIC, shared "ticks since the last wait-for-input
// screen began waiting" primitive, reset (or seeded to force an immediate first toggle) by nearly
// every screen in the game that waits for a
// keypress. For `nextTrack`'s own `v` (read at `1FDD`, right after `256E` returns from its own final
// `17FF` call), this means: `v`'s own real source is "ticks elapsed since the WINNER!/LOSER! screen's
// own MOST RECENT blink-wait window began" -- itself bounded by the SAME real human reaction time
// that decides when the screen gets dismissed, so the GOAL file's own INTENT ("non-deterministic as
// the original") survives fully intact even though the literal "runs from boot" mechanism does not.
// The eventual `flow.js` wiring should seed `v` from ticks-since-the-result-screen's-own-wait-began
// (this module's own `raceResultWaitStep`, below, is the natural place to track that), not a
// page-load-relative clock.

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
    // DS:[0x1D6+c]: each character's own stored handicap answer (0 or 0x80), 0B51's default the next
    // time it is asked -- session-lifetime, `[PROVEN]` to survive a full TWO PLAYER re-entry (§9bn)
    handicapAnswers: new Array(CHARACTER_NAMES.length).fill(0),
    chooseGameSelection: 0, // [0x8A0]: 0 in the image (nothing pre-selected), written only on a confirm (1F84)
  }
}

/**
 * `RunTwoPlayerHeadToHeadSetup 1000:1E20`'s own per-entry state (docs/engine.md §9bv). Every entry
 * runs `ResetTournamentState 0EBA`, which resets the roster table `DS:0164..016E` to identity
 * (nobody taken) and the car-slot character words `[0x2668]`/`[0x266A]` to 11 (none picked). P1
 * then picks through `09E0` starting on `[0x9A0]` (5, DWAYNE) and P2 starting on `[0x9A2]` (6,
 * JETHRO) -- both constants in the image, with no writer anywhere (`search_byte_patterns`).
 */
export const H2H_P1_START = 5 // [0x9A0]
export const H2H_P2_START = 6 // [0x9A2]
export function twoHumanSetupState() {
  return {
    roster: CHARACTER_NAMES.map((_, i) => ({ index: i, taken: false })), // DS:0164.. reset to identity (0EBA)
    characters: [null, null], // P1, P2
    rosterWords: [11, 11], // [0x2668]/[0x266A], 11 = none picked (0EBA)
  }
}

/** The roster bytes `charSelectStep` reads (`index | 0x40` once taken, the SAME encoding the
 * one-player roster uses). */
export function twoHumanRosterBytes(setup) {
  return setup.roster.map((s) => s.index | (s.taken ? 0x40 : 0))
}

/**
 * One player's own pick, committed the way `09E0`'s commit block does it (`0AB5-0B25`): mark the
 * character taken (`0AC2`), store the car slot's character word (`0B07`/`0B19`), then -- if
 * `0B51`'s own gate lets the question through -- OR in the answer (`0B0E`/`0B20`; `0B51` returns 0
 * when it doesn't ask). `handicapAnswer` is the question's own final answer (0 or 0x80), or `null`
 * when it wasn't asked; an asked answer is also stored back into the session cell `[0x1D6+c]`
 * (`0C09-0C11`). `slot`: 0 for P1, 1 for P2. Returns the roster word.
 */
export function commitTwoHumanPick(setup, session, slot, character, handicapAnswer) {
  setup.roster[character].taken = true
  setup.characters[slot] = character
  let word = character
  if (handicapAnswer != null) {
    session.handicapAnswers[character] = handicapAnswer
    word |= handicapAnswer
  }
  setup.rosterWords[slot] = word
  return word
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
 * whether `[0x3FC]` (the winner's own car-record pointer) reads `0xC03` (car 0/P1) at `256E`'s own
 * entry (`2574`, docs/engine.md §9bl) -- `256E` itself normalizes/re-stores this into `[0x3FC]`/
 * `[0x3FE]` as winner/loser (`2587`/`258B`), so this is the DIRECT, proximate decision site (an
 * earlier draft of this comment cited `[26B8]` directly, before `256E` was fully disassembled this
 * session -- corrected here; how, or whether, `[26B8]` itself feeds into `[0x3FC]` upstream was not
 * traced and is not claimed). `[0x3FC]`/`[0x3FE]` are themselves freshly resolved every race by
 * `11D5` (called from `216C`'s/`StopMusicRunRaceReloadAssets`'s own tail, `218F`, `get_xrefs_to`-
 * confirmed exactly 2 callers total) FROM THE SHARED FINISH-ORDER ARRAY (`[2678..267E]`), so this
 * does not go stale across races within a match -- this module doesn't own race resolution either
 * way, just reports its outcome. Returns
 * `{ matchOver, champion }` -- `champion` is `1`/`2`/`null`, matching
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

/** `2216-22B5`'s own slide -- see this file's own header for the full derivation. `smoothness`:
 * the resolved 1-4 value (`resolveSmoothnessForPlay`'s own output domain, `data/frontend-tables.js`
 * -- `[0x263A]`'s own real range, AUTO already resolved away). Returns the number of real 70Hz
 * ticks the slide runs for before `[0xCDD]` exceeds 88. */
export function raceInfoSlideTicks(smoothness) {
  return Math.floor(22 / smoothness) + 1 // 226E-22B3: [0xCDD] += smoothness*4 each tick, JLE 0x58
}

/** `256E`'s own icon slide (`2644-269E`) -- see this file's own header for the full derivation.
 * UNLIKE `raceInfoSlideTicks`, this one is smoothness-INDEPENDENT: a fixed step of 4 and an
 * exact-equality exit (`JZ`, not `JLE`) mean it always takes exactly 22 iterations, landing on
 * X=88/136 with no overshoot. Not a function of anything -- exported as a plain constant. */
export const RACE_RESULT_SLIDE_TICKS = 22

/** `1000:17FF`'s own bounded wait -- see this file's own header for the full derivation.
 * **`[0x2]` is zeroed ONCE, at `17FF`'s own entry (`1809`) -- NOT again at the `182C` AWAIT_RELEASE
 * -> AWAIT_PRESS transition.** Both phases poll the SAME running counter against the SAME `CX`, so
 * one real `17FF` call has ONE `RACE_RESULT_WAIT_TICKS`-tick BUDGET shared across both phases, not
 * `RACE_RESULT_WAIT_TICKS` ticks each (a discriminating test transitioning late enough to tell a
 * shared budget apart from a per-phase one lives in `tools/check-twohuman.mjs`, docs/engine.md
 * §9bl). A fire button already held over from an
 * earlier screen does NOT dismiss in AWAIT_RELEASE (`PLAN.md` §8's own live-automation pitfall is
 * this exact mechanism, caught the hard way) -- it just burns down the SAME shared budget until
 * either it's released (moving to AWAIT_PRESS with whatever budget remains) or the whole call times
 * out. Either phase exits immediately on `anyKeyReleased` (the real `[0x107E]` going nonzero -- ANY
 * key's own release latch, not ESC specifically, despite `[0x107E]` being called an "ESC release
 * latch" in other files in this project, where ESC happens to be the only key ever tested against
 * it -- the CALLER is responsible for clearing its own release tracker at the start of each window,
 * matching the real `180F` clear; this state machine cannot enforce that on its own). Timing out
 * (`exit: 'retoggle'`) is `256E`'s own cue to XOR the blink bit and call `17FF` again fresh -- the
 * caller should redraw and call `raceResultWaitStep` again with a freshly re-initialised `state`
 * (`raceResultWaitInitialState()`), NOT the same state object, matching the real `[0x2]`/`[0x107E]`/
 * `[0x107F]` reset every real `17FF` call performs at its own entry. **`state.ticks` at the moment
 * of `'dismiss'` equals the real `[0x2]` value at the exact instant the dismiss check runs** (`1825`/
 * `1847`/`184E` all read `[0x2]`-derived state right after that tick's own wait) -- `1FDD`'s own
 * read happens a few instructions later in the real code (after `256E` returns and the per-race
 * loop restarts), so if a real tick boundary falls in that small gap the two can differ by one;
 * `state.ticks` at dismiss is still the right value to seed `nextTrack`'s own `v` parameter from
 * (docs/engine.md §9bl's own "source of `v`" resolution), just not asserted exact to the tick. */
export const RACE_RESULT_WAIT_TICKS = 20 // the real CX=0x14 256E passes

export function raceResultWaitInitialState() {
  return { phase: 'AWAIT_RELEASE', ticks: 0 }
}

/** `cx`: `17FF`'s own `CX` argument, the per-call tick budget -- `RACE_RESULT_WAIT_TICKS` (20) for
 * `256E`'s own call; the outcome screen passes 15 (`1000:1E09`, docs/engine.md §9bq), and the board
 * (`18D8`) and results screen (`164B`) have their own values, not yet wired (GOAL-DOS-PARITY.md P3
 * "Wait-screen input parity" item (3)). `input`: `{ fireHeld, anyKeyReleased }` -- `fireHeld` is
 * the P1|P2 COMBINED fire bit
 * (`[0x1080]=0` forces this OR-combine for the duration of the real wait, matching `frontMenu.js`'s
 * own already-documented convention for the SAME combined-bits idiom). Returns
 * `{ exit: null | 'dismiss' | 'retoggle' }`; `state` is mutated in place. */
export function raceResultWaitStep(state, input = {}, cx = RACE_RESULT_WAIT_TICKS) {
  state.ticks++ // [0x2]'s own real increment -- ticks BEFORE either check, matching 1819/183B running before 1825/1847
  if (input.anyKeyReleased) return { exit: 'dismiss' } // 1825/1847: CMP [0x107E],0 / JNZ exit
  if (state.phase === 'AWAIT_RELEASE') {
    if (!input.fireHeld) { state.phase = 'AWAIT_PRESS'; return { exit: null } } // 182C: JZ -> inner loop, SAME tick count carries over
    if (state.ticks > cx) { state.phase = 'AWAIT_RELEASE'; state.ticks = 0; return { exit: 'retoggle' } } // 1839: timeout
    return { exit: null } // 1833: CMP [0x2],CX / JLE -- keep waiting for release
  }
  // AWAIT_PRESS
  if (input.fireHeld) return { exit: 'dismiss' } // 184E: TEST AL,8 / JNZ exit
  if (state.ticks > cx) { state.phase = 'AWAIT_RELEASE'; state.ticks = 0; return { exit: 'retoggle' } } // 1859: timeout
  return { exit: null } // 1855: CMP [0x2],CX / JLE -- keep waiting for a fresh press
}
