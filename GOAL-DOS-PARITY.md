# Goal: `game.html` behaves like the DOS game, and every open item is closed

Written 2026-09-24. Re-read this whole file at the start of every work session and after every
context summary. Tick a checkbox here in the same commit that closes its item; together with
`git log`, this file is your progress log.

## Scope assumptions (the user may edit these three lines)

- IN: the boot chain (SM.EXE logo intro, the code-card screen, the OPTIONS screen) is part of `game.html`.
- IN: two-human Head to Head (both humans on one keyboard: P1 = KEYS 2, P2 = KEYS 1 = `J L I M K`).
- LAST: the SPEAKER driver (`DRIVER2.BIN`) and joystick/mouse input come after everything else.

Do not stop to ask the user about scope. They asked for all of it.

## Start of every session

```bash
git status --short          # must be clean; if it isn't, read `git diff` before doing anything
git log --oneline -15       # what the previous sessions finished
```

Then find the first unticked box below and continue from there. If the tree is dirty with work
you don't recognise, don't discard it: read the diff, find the item it belongs to, and either
finish that item or ask the user.

## What "done" means

`game.html` runs the same sequence as typing `MICRO` in DOSBox, from the logo intro to the champion
screen and back. The same inputs produce the same screens, the same music, the same rules and the
same race outcomes. Every `UNKNOWN_*` in the registries below has one of these outcomes:

- **(a) Parity item** (something a player can see, hear or feel). It is ported, and it has a test
  in `tools/check-*.mjs` that fails without the fix. Prove this once per item before you commit:
  `git stash push -- src/` (the test files stay), run the test and see it fail, then
  `git stash pop` and see it pass. The docs are updated.
- **(b) Needs a live capture.** It was captured under DOSBox and the result is recorded with a
  `[PROVEN]` tag. If the capture failed, the attempt is written up and the item stays open with a
  precise reason.
- **(c) Cannot be resolved from the bytes.** It is closed in the docs with a one-paragraph reason.
  Examples: `UNKNOWN_gfx1_header`, `UNKNOWN_unp_version`, `UNKNOWN_1254_1256`,
  `UNKNOWN_ph0_1140_1380`, `UNKNOWN_lev_round2_size`.

The final acceptance test is the front-end pixel diff in Part F.

## Read these first (once, in this order)

1. `CLAUDE.md`: the evidence rules, the commands, and the Ghidra/DOSBox tooling notes.
2. `PLAN.md` §8, the pitfalls list. Every entry is a real mistake someone made; don't repeat them.
3. `docs/engine.md` §7 (line ~207): the front end and the tournament rules with their addresses.
4. `docs/engine.md` §10 (line ~5848): the authoritative open-items registry.
5. `docs/engine.md` §9an 8 (line ~5279): the Challenge-flow divergences.
6. `docs/engine.md` §9ar (line ~6026): the latest closures.
7. `src/frontend/flow.js`: the whole file. It is the state machine you will be changing.

Don't read `docs/engine.md` from start to finish. It is 6,000 lines. Jump to sections with
`rtk proxy grep -n "^## " docs/engine.md`.

## Stale sources: trust order

`docs/engine.md` §10 overrides every other list. These are known to be stale:

- `README.md` "What's not implemented" says palette fades are missing. They exist; the real
  problem is the reverse: the port fades in at race start and DOS doesn't (see P5).
- The "Still open" list in `docs/track-graphics.md` names items that §10 shows as resolved
  (`UNKNOWN_ph0_tail_icons`, `UNKNOWN_tile_index_overflow`).
- The "superseded" section of `PLAN-ENGINE.md` (line ~149) is historical, not status.
- `docs/engine.md` §7 still calls `UNKNOWN_26B8_polarity` "contested". §9u and §9ag resolved it.
- Many `src/` comments cite IDs that are now closed. Fixing these contradictions is part of the job
  (item D1).

## Hard rules

1. **Evidence.** Tag every claim you write down `[PROVEN]`, `[STATIC]` or `UNKNOWN_<id>`, and cite
   a `1000:xxxx` code address or a `DS:xxxx` data address from `MICROU.EXE`. Never guess a rule;
   disassemble it. The decompiler is for orientation only; cite the disassembly.
2. **Ghidra.** Call `mcp__ghidra__list_instances` first. Always pass `program: "MICROU.EXE"`. Before
   you conclude that an address has "no writers/readers", do a `search_byte_patterns` sweep on
   its disp16 bytes, because `get_xrefs_to` misses DS-relative accesses. Check whether the value is
   a `CS:`-relative constant (see §9ar e/f) before calling it a missed trace.
3. **DOSBox.** There is exactly one instance. Subagents and forks must never call `mcp__dosbox__*`;
   say so explicitly in every subagent prompt. The boot recipe: `bridge_start` →
   `drive_mount C /Users/valentin.pletzer/Downloads/dosgames/mm/game` → type `C:`, then `MICRO` →
   the logo plays → at the code card press ENTER twice (any cell is accepted) → GAME OPTIONS →
   RETURN. `input_key` with `pressed:true` is a tap. To hold a key, use `input_sequence` with an
   explicit press and release, holds of about 300 ms, and about 3 s between a menu pick and fire.
   In menus, LEFT/RIGHT picks an option and fire is `S`. Live CS is `0x23E` and live DS is `0xB7A`.
   Use `debug_map_to_ghidra`/`debug_map_to_live` to translate addresses.
4. **Git.** The repository is on `main`, with a baseline commit of the pre-goal state. There is
   no remote.
   - One commit per checklist item. The commit includes the code, the test, the docs and the
     ticked box in this file. If an item turns out to need two commits, both mention its ID.
   - Commit message: first line `<item>: <what changed>`, for example
     `P5 pause: resume on first key click (1000:37BF)`. The body gives the evidence in two to five
     lines. End every message with these two lines:
     ```
     Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
     Claude-Session: https://claude.ai/code/session_01G6mge15veAgDGJW44DhvdM
     ```
   - Commit only when the regression suite is green. A red suite is never committed. Fix it, or
     `git restore` your change and write down why the item is blocked.
   - Never rewrite history: no `git reset --hard` on commits, no `rebase`, no `commit --amend` on
     an earlier session's commit, no `push --force`. To undo a committed change, use `git revert`.
   - Don't make `.bak` copies. Git is the backup. Before editing, `git status` must be clean.
   - Before every commit, run `git status --short`. Nothing under `game/`, `ghidra/`, `re/`,
     `tools/out/` or `.codegraph/` may appear; `.gitignore` covers them, so if one appears,
     something is wrong. Stop and fix the ignore rule. Never `git add -f`.
   - New live captures that the checks diff against go in `tools/refs/` and are committed, like
     the existing ones. Keep each file small, because they come from commercial software. Commit
     only the frames or bytes a check actually needs.
5. **Files.** `game/` is read-only. `npm run build` must never contain game data.
6. **Grep.** The shell hook rewrites `grep` to `rtk grep`. Use `rtk proxy grep ...` when you need
   the exact output or the exit code.
7. **Browser checks.** A backgrounded Chrome tab pauses `requestAnimationFrame`. Use a foreground
   tab, or the page's `forceSteps` debug hook. Keep the console clean.
8. **One item at a time.** Change one thing, run the regression suite, update the docs, commit.
   Don't batch several fixes into one commit; a regression can hide inside a batch (§9an method
   note 2). When a later item breaks a check, `git bisect` over the per-item commits finds the
   cause.

## Regression suite (run before every commit; all must pass)

```bash
for s in catalog lz chrtable tables car intro codecard options title mainmenu charselect board step trace ai play sound rounds finish twocar tournament \
         menu screens opl-toggle smoothness si2 live smoke; do npm run -s $s || echo "FAIL $s"; done
npm run build
```

Add `front` to the loop once Part F creates it.

Known baselines that are **correct and must not be "fixed"**: `npm run trace` reports 13 of 20
(one torn capture row, §9ab) and `npm run ai` reports 59 of 60. `npm run live` must report 0.

## Docs to update when an item closes (in the same commit)

- `docs/engine.md`: add a new `§9as`, `§9at`, … section for the work, and update the item's entry
  in §10.
- `PLAN-ENGINE.md` §5: add a milestone row, continuing from M3.46 with M3.47 and up. Put the
  commit's short hash in the row once it exists, in the next item's commit.
- `PLAN.md` §9, if the item is listed there.
- The relevant `docs/*.md` "Open items" section.
- `CLAUDE.md`'s summary paragraph about the pages.
- `README.md` "What's implemented / not implemented".
- The placeholder text in `game.html`.
- Add a new `npm run <name>` script to `package.json`, and to CLAUDE.md's Commands list, if you
  create a new check script.

---

## Part P: the parity queue, in the order a DOS session runs

Do these in order. For each item: (1) disassemble the listed routine fresh, (2) if in doubt, watch
it live in DOSBox, (3) port it, (4) add a test and prove it fails without the fix, (5) update the
docs, (6) commit.

### P1: boot chain
- [x] **Logo intro.** `flow.js` has a `LOGO` phase that shows a still frame (`composeLogoScreen`) for
  4 s. DOS plays the animated SM.EXE intro, which ends on a timeout or a mouse click. `src/formats/gfx1.js`
  and `docs/intro-and-codecard.md` already hold the draw tables and the live timing
  (`UNKNOWN_intro_live_timing` was resolved in M3.30). Port the animation with its real timing and
  its real skip input. Check what a key press does in SM.EXE (`re/SM.EXE.lst`); don't assume "any key".
  **Done M3.47 (2026-09-24):** full re-disassembly of `RunIntroMainLoop 1000:097f`; a key never
  skips it (`SM.EXE`'s own `INT 9` hook consumes every keystroke), only a mouse click or the
  314-iteration timeout; holding A+B together is the one real keyboard effect (holds the exit
  open). `src/formats/gfx1.js` (`introInitialState`/`introStep`), `src/frontend/flow.js`,
  `tools/check-intro.mjs` (`npm run intro`), `docs/intro-and-codecard.md`, `docs/engine.md` §9as.
- [x] **Code-card screen.** `FONT.BIN` runs in mode 10h: an 8×8 symbol grid and "COLUMN x and ROW y".
  `src/formats/fontbin.js` decodes it, but the page doesn't show it. Show it after the logo, with
  cursor movement, and accept ENTER on any cell twice (this copy is patched; see
  `docs/intro-and-codecard.md`). Mode 10h is 640×350. Render it at that resolution and scale it into
  the same canvas.
  **Done M3.48 (2026-09-24):** full from-scratch disassembly of `FONT.BIN`, live-confirmed in
  DOSBox (the live target column/row, the RIGHT+DOWN cursor move, the "Correct, now one more"
  interstitial, round 2's no-second-interstitial ending, the UP/DOWN column-major wrap caught and
  fixed after an advisor review). The BIOS 8×14 ROM font was captured live and committed as
  `src/data/bios-font-8x14.js` with the user's explicit approval. `src/formats/fontbin.js`
  (the code-card SCREEN section), `src/frontend/flow.js`'s `CODECARD` phase,
  `tools/check-codecard.mjs` (`npm run codecard`), `docs/intro-and-codecard.md`, `docs/engine.md`
  §9at.
- [x] **GAME OPTIONS screen** (`RunOptionsScreenWithSettingsDat 1000:2770`). It shows first, before the
  title. Implement F1–F7: F1/F2 control device, F3 sound (BLASTER/SPEAKER), F4 smoothness
  (1 HIGH, 2 GOOD, 3 MEDIUM, 4 LOW), F5 redefine keys (`1000:92f0`), F6 credits (`1000:2a82`),
  F7 joystick calibration (`1000:2ab5`). RETURN plays, and ESC quits: show a "quit to DOS" end
  state. The `25011968` cheat code sets `DS:0F69`. DOS reads SETTINGS.DAT on first entry and
  writes it only when something changed (32 bytes, layout in CLAUDE.md). In the browser, persist
  it to `localStorage` in the same 32-byte layout. Seed it from the real `game/SETTINGS.DAT` on
  first run. Move the header's Smoothness select into this screen. Keep the header control only if
  it stays in sync with this screen.
  **Done M3.49 (2026-09-24):** full re-disassembly, live-confirmed in DOSBox (mounted read-only).
  F1/F2's real asymmetric device gate (P1 never reaches JOY2/MOUSE), F4's real 5-value cycle
  including AUTO (a correction to docs/engine.md §9t's own prior wrong claim), F5's cumulative
  redefine-keys layout with SPACE/duplicate rejection, F6's credits, the dirty-flag save rule
  (ESC never writes; RETURN writes only if `[0xF63]` was touched, even by a same-value cycle), the
  25011968 cheat's dumb-reset matcher and its lives-to-10 effect, and `localStorage` persistence
  (seed priority: saved -> `game/SETTINGS.DAT` -> DS-image default) are all ported and live-
  confirmed. F7 (joystick calibration) is gated correctly (never drawn/no real effect without a
  joystick) but its own analog-read body is deferred to P6 with the rest of joystick input, per
  this file's own scope note. `src/frontend/options.js` (new), `src/formats/globaldata.js`
  (`serializeSettings`/`DEFAULT_SETTINGS`), `src/frontend/screens.js`/`src/data/frontend-tables.js`
  (the new screens), `src/frontend/flow.js`'s `OPTIONS` phase, `tools/check-options.mjs`
  (`npm run options`), `docs/engine.md` §9au (also corrects §9t's AUTO claim).

### P2: title and menus
- [x] **Title attract loop** (`RunTitleScreenAttractLoop 1000:0100`). It shows LOGO, the copyright,
  and 9 `INTRO.CHR` showcase frames, one every `0x118` ticks, with the class name. It has **no
  idle timeout**. Exits: fire → main menu, ESC release → OPTIONS, any other key release → main
  menu. Check each one against `flow.js`.
- [x] **Two-level menu.** Replace the flattened 3-item menu (`flow.js` top comment,
  `screens.js:32`). The real structure: `RunMainMenuKeepTitleTune 1000:0220` (SELECT GAME: ONE
  PLAYER / TWO PLAYER) → `FUN_1000_02e0` ONE PLAYER GAME (Head to Head `0fbf` / Challenge `102b`, drawn
  as `WORDS.CHR` slot 11 frames 1/2 plus `SELGAM.CHR` slot 10 frames 2/3, §9t) or `FUN_1000_1e20` TWO
  PLAYER. Both levels use the two-item helper `FUN_1000_0382`: THUMB highlight, **a real persisted
  selection at rest (`[130]`/`[132]` = `1`/`2`, NOT "nothing selected" -- corrected live, §9av/§9aw;
  the earlier "nothing selected" reading here was itself a symptom of the same `input_key`-tap-drop
  issue §9av's own correction names)**, fire ignored only while the selection is genuinely 0, wait
  for fire to be released after each pick, and **cancel after ≥ `0x7D0` idle ticks (about 28.6 s) at
  `1000:03CE`**. Music: the main menu keeps tune 1 (`0220-0237`); tune 2 starts at the select
  (`0A06-0A1D`), §9an 8. Done, §9aw: `src/frontend/frontMenu.js`, `tools/check-mainmenu.mjs`.
- [x] **Character select as a carousel** (`1000:09e0`). It shows 11 `FCNORMAL` faces, names at
  `DS:0258`, skills at `DS:02B1`, and a 13-step eased scroll using `DS:0185`. It replaces the
  list layout at `screens.js:43`. Done, §9ax: `src/frontend/charSelect.js`,
  `tools/check-charselect.mjs`. The handicap question (`1000:0b51`, characters 0–2) appears
  only in two-human H2H -- its own gating logic is closed as `[STATIC]` (§9ax) but not wired
  into any reachable screen, since two-human H2H itself is P4.

### P3: tournament screens and rules
- [x] **Tournament board** (`1000:18d8`): the `CASE.CHR` map with `MINATURE` icons at the
  positions in `DS:0312` (26 words, §9t). It is gated on `[43A]=1`. Find exactly when it is shown
  in `RunTournamentLoop 1000:10a0`.
  **Done, §9ay: shown from `SetupTournamentRace 1000:115c`, not `10a0` directly -- gated on
  Challenge format only (`[3F8]!=1`, `115c`'s own call-site check, before `18d8`'s own internal
  `[28C1]==0`/`[43A]` gates), never before the very last race, and -- caught by advisor review
  before commit -- a pending bonus race's own board call happens BEFORE `[28C1]` advances
  (`tournament.js`'s `boardRaceIndex`). Icon positions/frames confirm §9t's own formula
  byte-checked against the live table; for a regular race the newest icon PREVIEWS the upcoming
  race, not a trophy for one just finished. The newest icon blinks (`FUN_1000_17ff`, simplified to
  the existing `AWAIT_RELEASE` idiom; the real tick constants are 36/720, not 35/700).
  `src/frontend/board.js`, `tools/check-board.mjs`. Not ported: the round-9 "reveal" branch (the
  NORMAL path for every bonus race, not a rare one), which reads past `MINATURE.CHR`'s own real
  frame table in the original (a benign OOB read, not pixel-replicated).**
- [ ] **Interactive opponent picker** (`FUN_1000_1a4a`, pick 3 after passing the Challenge
  qualifier). This replaces the auto-pick in `tournament.js:131`. Note the known trap in §9k: the
  qualifier itself is a 4-car race and needs 3 opponents *before* the picker exists. Find out
  from the disassembly who the real qualifier drones are.
- [ ] **Elimination screen plus replacement picker** (`ShowCharacterEliminatedTune6 1000:16de`,
  "IS OUT!!", the wobble curve at `DS:034B`). The player picks the replacement. Verify the
  round-robin victim rule against the bytes: §9k says "roster position modulo opponent count" is
  an interpretation, not a derivation.
- [ ] **The Challenge-rule divergences from §9an 8**, one test each:
  - the final race's 2nd place is a fail (`15B7`, `1658`);
  - the bonus trigger has no cap (`1123-113A`; `[342]` counts wins only, `1A92-1AA5`);
  - a passed Challenge race shows RESULTS only (OUTCOME code 1 is emitted only at `10EC`);
  - OUTCOME code 4 plays tune 6 and shows "NO BONUS" (`1C84` runs before the `1CA3` test);
  - the `]` key zeroes lives on OUTCOME 2/3 (`1DCD`).
- [ ] **The two INFERRED tournament rules** in `tournament.js`'s header: what ends the tournament at
  0 lives, and whether the win streak resets to 3 after a bonus race. Re-derive both from `10a0`/`115c`
  and replace the inference with cited code.
- [ ] **The results screen's tune condition.** It uses a pass/fail boolean; the real condition is
  the narrower `word[3FC]`/`[3FE]` test (§9ai). Port it exactly.
- [ ] **The H2H race-intro variant** (§9an 8, "the H2H race-intro variant").

### P4: two-human Head to Head
- [ ] Port `FUN_1000_1e20` → `1ef1` / `RunHeadToHeadTournament 1000:1faf` / `2329` / `256e`: the WON/LOST
  screens, skill labels via `DS:08CD`/`DS:08B0`, the win tally `[98A]`/`[98C]` (first to 4,
  §9y), and the handicap question. Track pick: from `DS:09BA` (`04 0A 11 0D 1C 21 14 19`) by
  `DS:0002 & 7` without repeats. Reproduce `DS:0002` as a 70 Hz tick counter that runs from boot,
  so the choice is as non-deterministic as the original's. P2 input is KEYS 1. The race engine
  already runs two-car races (`twocar.js`). Check what it assumes about car 1 being a drone.
- [ ] **The single-race select** (`SelectSingleRaceTrack 1000:2193`, the 10-entry list at
  `DS:09D9`; LEFT and RIGHT both step +1). Find where it is reachable from, and port it if it is
  reachable.

### P5: in-race behaviour that differs from DOS
- [ ] **ESC during a race.** The port quits to the title, which is port-only (`flow.js:424`,
  §9ai). Find what DOS does. Start at `1000:26E4`, which reloads the sound driver after ESC (see the
  §9q header), and at the pause path `CheckCheatSpotsThenPause 1000:37BF`. Match it, and delete the
  port-only path.
- [ ] **The pause minimum.** `src/engine/pause.js` has `MIN_PAUSE_MS = 2000`. DOS resumes on the
  first key click (§9an, "Corrected"). Fix it, and update the comment in `pause.js` that calls
  2000 "the precise real-world duration".
- [ ] **The race-start fade-in.** The port fades the scene in; DOS shows black, then the first
  frame at full palette (§9an 8). Fix it in both `play.js` and `flow.js`.
- [ ] **`UNKNOWN_fade_duration`.** The exit fade is unpaced. Measure it live (Part L) and pace it.
- [ ] **`UNKNOWN_countdown_hud_digit`.** The HUD digit reads 3 during the start countdown and 4
  once racing. Capture the original's value live (Part L) and match it.
- [ ] **`UNKNOWN_round3_bridge_path`.** `1000:5740-57f7` is unported, including the `683c` ramp path
  that stores progress 12. This is round 3 physics. Port it and add a `check-step`/`check-rounds` test.
- [ ] **`DrawRound8ExtraAnim32 1000:843d`** (`DS:5EE3`): the CHOPPERS-only 32×32 extra animation
  (§9d). Disassemble it, find out what it draws, then port it.
- [ ] **`UNKNOWN_conveyor_push_formula`** (`src/engine/terrain.js:85`). Re-derive it byte-exactly.
- [ ] **The smoothness 2–4 state/ranking cadence** (§9ah): only the drawn-flag write honours
  `ctx.drawnTick` today. Port the full cadence.
- [ ] **The BX-quirk garbage carries over between races** in DOS, because car records are not
  fully re-initialised. The port resets it every race (§9an 8). Carry it across races in `flow.js`'s
  session, the same way `createColDirBuffers()` does (§9ad).
- [ ] **`UNKNOWN_exit_hold_855a_pass`** (§9an 8): the non-drawing `855A` pass on iteration 1 of the
  two-car hold. Port it exactly.
- [ ] **`UNKNOWN_rematch_fail_stale_2682`**, the downstream consequence (§9ar c): build a double-fall
  scenario on round 3 in `check-twocar.mjs`, trace `stepExchange` and the commit, and record what
  happens.
- [ ] **The RUFFTRUX banner's looping sfx/tick idiom.** M3.8 simplified it to a one-shot (§9k
  "Deliberately not done").

### P6: input and sound (last)
- [ ] **JOY 1/JOY 2/MOUSE** through the Gamepad API and pointer events. They feed the same 5-bit
  control byte. Joysticks fire only after accelerating (§9an 5a). The joystick thresholds come
  from SETTINGS.DAT.
- [ ] **The SPEAKER driver** (`DRIVER2.BIN`, "Internal Beeper v1.08"): the same command set, played
  through the PC speaker. Add a square-wave backend. `UNKNOWN_drv2_live_fidelity` covers this,
  including what sfx 16 does when queued to DRIVER2, whose bank has only 15 entries. Also port
  StopEngineSounds' beeper branch (`7AF8`, `AH=0x10` for voices 0/1).
- [ ] **NONE** (`DRIVER0.BIN`): silence.

### P7: page chrome
- [ ] When the P1 options screen exists, the header's dev toggles ("Lap line (dev)", "Strict
  OPL2") move behind a `?dev` URL flag. They are off by default, and the default page shows only
  the game canvas and the folder picker. Rewrite `game.html`'s placeholder paragraph to describe the
  real controls.

---

## Part L: live-capture items (one DOSBox session each, done solo)

Each one gets a live capture tagged `[PROVEN]`, or a write-up of the failed attempt. For the
approach, see §9f (a Lua script on the emulation thread, `dosbox.mem_read` once per frame).
Commit each item on its own, including any capture file under `tools/refs/`.

- [ ] `UNKNOWN_twocar_live_cycle`: a full two-car knockout exchange (§9am).
- [ ] `UNKNOWN_0f64_speed_zero`: `car.speed` and the OPL pitch reaching 0 at a real `7AF8` call
  (pause entry, race exit, an exchange) (§9ar a).
- [ ] `UNKNOWN_exit_banner_live`: ES at `30DF` (§9an 8).
- [ ] `UNKNOWN_fade_duration`: the exit fade's length in ticks. This feeds P5.
- [ ] `UNKNOWN_countdown_hud_digit`: the digit shown during the start countdown. This feeds P5.
- [ ] A whole race end: the countdown and the final order. The ROUND21 lead rule firing (§10,
  "Added 2026-09-23 (§9ah)").
- [ ] The rubber band boosting while car 0 genuinely leads mid-race, and the grip ×1.5 site (§9aq 4).
- [ ] The key-press → control-byte leg for car 0 under real input (§10, `UNKNOWN_live_verification`).
  Also sfx 2 on lap completion, and a longer driving/turning/collision trace. Add the trace to
  `tools/refs/` and extend `npm run trace` to use it.
- [ ] `UNKNOWN_race_4th_engine_delay` (`docs/sound.md` §8): a fresh race-start capture that logs
  `AH=3`'s return value.
- [ ] `UNKNOWN_race_live_reverify` (`docs/sound.md` §8).
- [ ] `UNKNOWN_opl_sample_fidelity`/`UNKNOWN_waveform_target`: an audio-level comparison of the JS
  OPL2 core against DOSBox's own output.
- [ ] `UNKNOWN_class8_choppers`, live confirmation (optional; it is already resolved `[STATIC]`).
- [ ] Mouse/joystick fire preempt, live (§9aq 4). Do this after P6.
- [ ] Whether a "drawn but invisible" car is actually absent from the screen (§9ap).

## Part R: remaining static RE items (Ghidra only; can go to subagents, no DOSBox)

Subagents may do the disassembly for these items, but only the main session edits files and
commits.

- [ ] `UNKNOWN_lev_low_bits` (`docs/track-layout.md`): bits 1–0 of the `.LEV` byte. Do an exhaustive
  byte-pattern search for every `.LEV` read.
- [ ] `UNKNOWN_map_attr_bits` (partial): bit 1's physical meaning and round 8's pattern.
- [ ] `UNKNOWN_cheats_type` (narrowed): the downstream consequences of the three flag-set effects
  (§6).
- [ ] `UNKNOWN_pr0_header_use` (`docs/track-graphics.md`).
- [ ] The remaining unnamed race-draw helpers (`8634`, `8386`, `8712`, …; `docs/track-graphics.md`).
  Name them in Ghidra, document them, and check that each is ported.
- [x] The "AUTO" string's purpose (§9t, left unnamed). **Resolved as a byproduct of P1's GAME
  OPTIONS item (M3.49, docs/engine.md §9au):** AUTO is smoothness value 5, reachable via F4 --
  corrects §9t's own prior "proven NOT part of the set" claim, which checked only the display
  side, not F4's own input cycling. Resolves at RETURN to a real 1-4 value via a VGA-retrace
  CPU-speed probe (`AutoDetectSmoothnessByRetraceLoops 1000:3AD0`); the port resolves it to 1
  (HIGH) unconditionally, since any modern machine trivially clears the real threshold.
- [ ] `UNKNOWN_sfx_semantics`: every sfx id is wired to its site; the audible meaning was only
  rendered, never heard. Listen to each through `npm run tunes`-style renders, then close it.
- [ ] `UNKNOWN_microu_runs_standalone`: try `MICROU.EXE` alone in DOSBox once, then close it.
- [ ] Category (c) closures with a reason: `UNKNOWN_gfx1_header`, `UNKNOWN_unp_version`,
  `UNKNOWN_ph0_1140_1380` (three icon shapes with no consumer), `UNKNOWN_1254_1256`.

## Part D: documentation and repository debt

- [ ] D1. Make every open-item list agree with §10: `PLAN.md` §9, `docs/track-graphics.md`,
  `docs/track-layout.md`, `docs/sound.md` §8, the `docs/engine.md` §7 wording on `26B8`, and the
  `UNKNOWN_*` comments in `src/` that cite closed IDs (`rtk proxy grep -rn UNKNOWN_ src`).
- [ ] D2. Rewrite §10 itself as a clean table (ID | status | section | address) instead of one
  run-on paragraph. Keep the history in the §9x sections.
- [ ] D3. Rename the misleading Ghidra function names listed in §7 ("Ghidra names to fix": `0fbf`,
  `102b`). Ghidra isn't in git; save the program with `save_program`.
- [x] D4. Delete the old backup files (`src/engine/race.js.bak2`, `src/engine/sound.js.bak2`,
  `src/render/raceView.js.bak2`, and anything else `git ls-files '*.bak*'` lists). The baseline
  commit keeps them in history. First check that nothing imports them. Do this item first; it is
  a one-commit cleanup.
- [x] D5. Add a line to `CLAUDE.md`'s "Working rules": the project is a git repository, with one
  commit per finished item and no `.bak` copies.

## Part F: the final acceptance test (pixel diff of the front end)

`PLAN-ENGINE.md`'s acceptance line "each static screen pixel-diffs against a DOSBox screenshot"
was carried forward and never met. Meet it now:

- [ ] F1. In DOSBox, capture each static screen with `screen_capture` and read the DAC palette (as
  `tools/refs/race_R21_dac.bin` was done). Capture: code card, OPTIONS, title (first showcase frame),
  SELECT GAME, ONE PLAYER GAME, character select (settled), board, race intro, results, outcome,
  eliminated, champion, and the H2H WON/LOST screens. Save the captures to `tools/refs/front/`
  and commit them.
- [ ] F2. Write `tools/check-front.mjs` (`npm run front`). It renders the same screen through
  `screens.js` with the same inputs and reports the differing-pixel count per screen, the way
  `check-live.mjs` does. Target: 0 for every static screen. Where a screen animates, pin the frame
  using the tick count read live. Add `front` to the regression loop above.
- [ ] F3. Walk one full session side by side: DOSBox and `game.html` in a foreground Chrome tab.
  Take the boot → options → title → Challenge → qualifier → race → results → board → … → a lost
  race → ONE LIFE LOST path, then quit. Write down each difference you see and either fix it (one
  commit each) or add it to §10 as an open item.

## Stop and report to the user (don't guess) when

- A fix would change a result that an existing `[PROVEN]` live capture pins, meaning the capture
  and the new reading disagree.
- The same DOSBox or tool failure repeats three times.
- A rule in DOS depends on hardware timing the browser cannot reproduce. Describe the options.
- Closing an item would need information outside the binary and the data files.
- Something you didn't create shows up in `git status`, or `.gitignore` fails to keep game data
  out.

When all checkboxes are ticked, every `npm run` check (including `front`) passes, and §10 lists
only category-(b) items with a written-up attempt, write a final `docs/engine.md` section
summarising the whole pass. Commit it, and report to the user with `git log --oneline` from the
baseline commit.
