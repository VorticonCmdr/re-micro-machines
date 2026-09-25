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
for s in catalog lz chrtable tables car intro codecard options title mainmenu charselect board elimination keywait outcomewait windowedwait champion pressanykey step trace ai play sound rounds finish twocar twohuman tournament \
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
- [x] **REGRESSION, found 2026-09-25 (M3.68, docs/engine.md §9bn), FIXED 2026-09-25 (M3.69, docs/engine.md
  §9bo): `1000:179B`'s own real ~700-tick (~10s) auto-advance is ported (the discovery and the
  timeout NUMBER, not the full input model -- see the new, separate P3 bullet below for that).**
  Root cause: `179B`'s own stage-2 timeout compare (`17D7: CMP word ptr
  CS:[0x93C2],0x2BC`) reads a `CS:`-segment-override address that an earlier session's own sweep
  (`UNKNOWN_93c2_writer`, docs/engine.md §9ar item e) concluded was a permanently-zero dead
  constant -- but `CS:[0x93C2]` is the SAME PHYSICAL BYTE as `DS:[0x2]` (the shared tick counter
  with dozens of already-documented writers elsewhere in this file), reached under a segment alias
  the sweep never accounted for (`CS:[X]`≡`DS:[X-0x93C0]` for any `X>=0x93C0`, confirmed both
  statically via `list_segments` and against a live `cpu_read_registers` read; independently
  cross-checked against the ALREADY-correct `CS:[0x9C62]`≡`DS:[0x8A2]` alias, §9bf). `179B` has ONE
  real, combined ~700-tick budget from its own entry-time reset, spanning BOTH its own stages
  (stage 1's own timeout exits the WHOLE function, does NOT fall through into stage 2); it also
  combines both players' own input. `UNKNOWN_a329_writer` (§9ar item f, `docs/track-graphics.md`'s
  F12 screen-dump claim) had the SAME bug: `CS:[0xA329]` is `DS:[0x0F69]`, the real
  `25011968` cheat flag (`[STATIC]`: `1000:2911: MOV byte[0xF69],1`, gate wants
  `==1` -- but the gate ALSO needs `AL==0x58`, the F12 scancode itself, whose own source wasn't
  traced, and no live DOSBox run with the cheat active plus F12 pressed was attempted) -- the F12
  pause screen-dump is likely reachable, probably not dead code, not yet live-confirmed. `FUN_1000_18D8`
  (docs/engine.md §9bl, wrongly called "an undocumented function") is the ALREADY-PORTED tournament
  board (P3's own first item below, §9ay) -- renamed `DrawTournamentBoard` in Ghidra. A held key
  across `179B`'s own entry (`tournament.js` vs `input.js`'s own disagreeing descriptions) is
  resolved -- INFERRED, not itself observed live: DOS's real typematic auto-repeat is ASSUMED to
  re-track a held key after the reset (the ISR's own `[0x107F]==0` re-track gate is `[STATIC]`
  fact; that a real keyboard's own auto-repeat actually triggers it here is the inferred part), and
  `input.js`'s own `onDown` (not filtering `e.repeat`) likely already produces the same effective
  behaviour via the browser's own key-repeat -- correcting `createMenuReleaseTracker`'s own comment
  to match the inference, not its code.
  Written: `keyWaitStep`/`keyWaitInitialState` (`src/frontend/keyWait.js`, a new shared reference
  module -- NOT wired into `flow.js`, same status as `handicapStep` before its own later wiring
  commit), matching `179B`'s own real comparator (`>=`, not `>`), check order (timeout checked
  BEFORE that tick's own increment), and opposite stage1/stage2 fire-held exit conditions --
  deliberately NOT a `raceResultWaitStep` reuse, which differs in all three; `npm run keywait`, 69
  assertions, reintroduction-proven (4 mutations, 4/69, 5/69, 1/69, 2/69 failures, all restored) --
  validates this reference model, not `flow.js` directly. **The actual regression fix shipped is
  simpler: a plain `setTimeout(KEY_WAIT_TIMEOUT_TICKS * INTRO_TICK_MS)`** (the SAME pattern
  `PRESS_ANY_KEY`'s own `pressAnyKeyTimer` already uses) wired into `flow.js`'s `RACE_INTRO` and
  `ELIMINATED` phases (`raceIntroTimer`/`eliminatedTimer` -- **both deleted in M3.70, replaced by
  the real per-tick `179B` wait, see the next bullet**), using only the timeout CONSTANT
  `keyWaitStep` also encodes -- none of that model's other distinctions affect a plain timer. Still
  open, NOT fixed by this commit: neither screen models `179B`'s own real `fireHeld`/
  `anyKeyReleased` release-latch exit or stage-1 debounce at all -- both still dismiss only via the
  existing keydown-edge-triggered path, the SAME release-vs-keydown mismatch already tracked as
  `UNKNOWN_outcome_screen_timeout` elsewhere, now also true here; driving `keyWaitStep` for real
  (per-tick, fed by P1|P2 fire bits and `menuReleaseTracker`) is un-scoped follow-up work. **The
  shipped `setTimeout` fix is `[PROVEN]` live for `RACE_INTRO` specifically, NOT for `ELIMINATED`:**
  a browser session using `window.mmGame`'s own exposed debug hooks (`getPhase`/`confirm`/
  `force*Steps` -- a reusable fast-forward API, not previously documented here) reached a real
  `RACE_INTRO`, sent NO further input, and polled `getPhase()` until it auto-advanced to `RACING` on
  its own, no console errors -- this proves the timer ARMS and FIRES with no input, NOT the ~10s
  duration itself (the measured ~8.6s was taken from a poll that started well after the timer's own
  real arm instant, across separate tool calls, so it bounds nothing; the duration is simply the
  `KEY_WAIT_TIMEOUT_TICKS * INTRO_TICK_MS` code literal). `ELIMINATED` was NOT exercised live at all
  this session. An earlier attempt at this same live test via the `computer` tool's own `key` action
  appeared to fail, for TWO real causes, not one: `computer key` presses intermittently stopped
  reaching the page at all after a reload (confirmed via an empty capture-phase keylog across
  several attempts, cause not identified), AND that attempt separately sent only 2 Enters at
  CODECARD, which needs 3, plus 1 more at OPTIONS (4 total, confirmed by the working JS-dispatch
  retry). H2H race-info's own `179B` use remains unwired
  (that screen isn't reachable from `flow.js` at all yet, P4's own remaining scope).
- [x] **Wait-screen input parity.** `179B`'s own real `fireHeld`/`anyKeyReleased` release-latch exit
  and stage-1 debounce are NOT modelled anywhere in this port -- `RACE_INTRO`/`ELIMINATED` still
  dismiss ONLY via the existing keydown-edge-triggered `onKeydown`->`confirm()` path, the timeout
  fix above adds only the auto-advance NUMBER, not the real input shape (`keyWaitStep`,
  `src/frontend/keyWait.js`, is already written and unit-tested for exactly this, just not wired,
  docs/engine.md §9bo). Scope: (1) drive `keyWaitStep` from a real per-tick loop for `RACE_INTRO`
  and `ELIMINATED`, fed by P1|P2 fire bits and the existing `menuReleaseTracker`, with a real
  `reset()` at `179B`'s own entry point (matching the carousel's own held-fire trap already
  documented elsewhere, §9bk) -- replacing the keydown-only dismiss for these two phases, not just
  adding to it; (2) fold in `UNKNOWN_outcome_screen_timeout` (`1000:1C1B`'s own SEPARATE, already-
  documented (`[STATIC]`) 700-tick timeout and release-vs-keydown mismatch, docs/engine.md §10, under §9bb) while
  touching this same input shape (note: `17FF` is a DIFFERENT function from `179B` -- `keyWaitStep`
  models `179B` only and stays separate regardless of how this decision goes); (3) `17FF` (the
  function `raceResultWaitStep` already models, for its own `256E`/`26BA` call site) turns out to
  have three OTHER simplified callers found this session (`DrawTournamentBoard 1000:18D8`,
  `ShowRaceResultsScreenTune8or6 164B`, the outcome screen's own `CX=0xF` call at `1E0C`) -- settle
  whether a single CX-parameterised `raceResultWaitStep` covering all four `17FF` call sites is
  worth building, replacing each screen's own current simplification -- a decision that fell out of
  GOAL during the M3.69 rewrite and now lives only in docs/engine.md §9bl, recorded here so it isn't
  lost again. Live-verify the release-latch exit and
  the stage-1 debounce specifically (neither was exercised by M3.69's own live pass, which only
  confirmed the timeout number).
  **Scope item (1) DONE 2026-09-25 (M3.70, docs/engine.md §9bp):** `keyWaitStep` is wired into
  `RACE_INTRO` and `ELIMINATED` through a new `waitScreenStep` composition in `keyWait.js` (pre-wait
  work with input ignored, then `179B`'s own entry with the `menuReleaseTracker.reset()`, then the
  real two-stage wait), fed per tick by P1|P2 fire bits (session-lifetime readers, so a fire held
  over from the previous screen is debounced) and the release tracker. The `setTimeout`
  stopgap and the keydown dismiss are deleted. `[PROVEN]` live in the port for both screens: the
  release-latch exit (keydown does nothing, keyup dismisses), the stage-1 debounce (RACE_INTRO,
  including a fire pressed on PRESS_ANY_KEY and held; synthetic events, so the no-auto-repeat
  case), and the ~700-tick timeout, measured from `179B`'s
  entry. Remaining: items (2) and (3). The box stays unticked until they have their own commits.
  **Scope item (2) DONE 2026-09-25 (M3.71, docs/engine.md §9bq), closing
  `UNKNOWN_outcome_screen_timeout`:** both of `1C1B`'s waits are ported (`outcomeWait.js`) and
  wired: SIMPLE (codes 0/1/4/5: repeated `17FF` CX=15 windows, latch cleared at each, timeout at
  tick 704) and LIVES (codes 2/3: a silent 30-iteration slide, then a poll every 6 ticks with the
  `]` release first, any release, then P1-only undebounced fire; timeout at tick 702). `[PROVEN]`
  live in the port for both paths. **Item (3)'s design question is settled by this commit:**
  `raceResultWaitStep` now takes `17FF`'s `CX` as a parameter (default 20, `256E` unchanged), one
  model rather than a copy, and the outcome screen's own `1E0C` call is done. What is left of item
  (3) is wiring the board (`DrawTournamentBoard 18D8`) and the results screen (`164B`) onto it.
  **Scope item (3) DONE 2026-09-25 (M3.72, docs/engine.md §9br), closing this bullet:** a shared
  repeated-`17FF` loop (`windowedWait.js`) now drives the board (CX=0x23, timeout sampled after
  every 2nd window: 720; the bonus-race reveal after every 1st: 756), the results screen (CX=0xF,
  every window: 704) and the outcome screen's SIMPLE path. The board's old `AWAIT_RELEASE` idiom
  froze its blink and timeout on a held fire, which `17FF` does not; the board now also reads the
  session-lifetime readers. `[PROVEN]` live in the port: a fire held into the board still blinks
  and times out at 10.29s; RESULTS times out at 10.05s; a fresh fire press dismisses RESULTS into
  ONE LIFE LOST, which then leaves at its first poll. Every `17FF` call reachable in one-player play
  now runs the real `17FF`; `26BA` (two-human) is P4's, and `2166` has no callers.
  **P3 is not closed by this: see the champion-screen, PRESS ANY KEY and race-skip bullets below,
  added after this one.**
- [x] **Tournament board** (`1000:18d8`): the `CASE.CHR` map with `MINATURE` icons at the
  positions in `DS:0312` (26 words, §9t). It is gated on `[43A]=1`. Find exactly when it is shown
  in `RunTournamentLoop 1000:10a0`.
  **Done, §9ay: shown from `SetupTournamentRace 1000:115c`, not `10a0` directly -- gated on
  Challenge format only (`[3F8]!=1`, `115c`'s own call-site check, before `18d8`'s own internal
  `[28C1]==0`/`[43A]` gates), never before the very last race, and -- caught by advisor review
  before commit -- a pending bonus race's own board call happens BEFORE `[28C1]` advances
  (`tournament.js`'s `effectiveRaceIndex`). Icon positions/frames confirm §9t's own formula
  byte-checked against the live table; for a regular race the newest icon PREVIEWS the upcoming
  race, not a trophy for one just finished. The newest icon blinks (`FUN_1000_17ff`, simplified to
  the existing `AWAIT_RELEASE` idiom; the real tick constants are 36/720, not 35/700).
  `src/frontend/board.js`, `tools/check-board.mjs`. Not ported: the round-9 "reveal" branch (the
  NORMAL path for every bonus race, not a rare one), which reads past `MINATURE.CHR`'s own real
  frame table in the original (a benign OOB read, not pixel-replicated).**
- [x] **Interactive opponent picker** (`FUN_1000_1a4a`, pick 3 after passing the Challenge
  qualifier). This replaces the auto-pick in `tournament.js:131`. Note the known trap in §9k: the
  qualifier itself is a 4-car race and needs 3 opponents *before* the picker exists. Find out
  from the disassembly who the real qualifier drones are.
  **Done, §9az: the qualifier's own drones are a hardcoded JETHRO trio (`102b`/`10a0`'s own raw
  writes to `[266A]`/`[266C]`/`[266E]`, no roster `taken` flag, no tuning effect --
  `tournamentIndex<=0` always discards the character-based `KID_MODIFIER` lookup for the
  qualifier). `ResetTournamentState 0eba` resets all 4 face-preview slots to an "unpicked"
  sentinel the qualifier's own raw writes never clear, so `1a4a`'s own scan, run once right after
  a Challenge PASS, reliably finds exactly 3 unfilled slots. Reuses `tournament.js`'s existing
  `pickOpponentCharacter` (now appending, not replacing) and the existing character-select
  carousel (`charWho='challenge-opponent'`); ESC never exits the picker, it just re-prompts the
  same slot, matching `1a4a`'s own loop. `[0x404]` confirmed write-only/dead -- item 3 should not
  assume it names "which slot to replace". `tools/check-tournament.mjs` rewritten. A second
  advisor review caught a real regression before commit: `confirm()`'s `PRESS_ANY_KEY` branch
  skipped `nextAfterOutcome()`, so the just-shipped tournament board never actually showed before
  race 1 -- fixed and live-tested end to end (screenshots of both the picker and, for the first
  time, a live board render).**
- [x] **Elimination screen plus replacement picker** (`ShowCharacterEliminatedTune6 1000:16de`,
  "IS OUT!!", the wobble curve at `DS:034B`). The player picks the replacement. Verify the
  round-robin victim rule against the bytes: §9k says "roster position modulo opponent count" is
  an interpretation, not a derivation.
  **Done, §9ba: the wobble curve (16 real steps, 9 ticks each, no tone per step -- correcting §9t)
  rebinds the victim's own portrait to `FCSAD.CHR` (confirmed live via `DS:0A3A`'s arena-offset
  arithmetic). The victim rule is a 3-slot descriptor-address cursor (`DS:0346`), NOT "roster
  position modulo opponent count" -- first eviction picks the lowest-index current opponent, every
  later one just advances the cursor unconditionally (even a no-op pass), so a replacement CAN be
  re-evicted; `taken` is never cleared, only `eliminated` OR'd in. The replacement is chosen by the
  PLAYER through the same `1a4a` carousel item 2 ported, not auto-picked (correcting this file's own
  and §9k's prior claim). `1000:179b`'s "press any key" wait has no real timeout past its own
  debounce (`CS:[0x93C2]` is a dead constant, §9ar e) -- ported as a plain keypress wait, matching
  the existing `RACE_INTRO` idiom, not `PRESS_ANY_KEY`'s timer.
  **CORRECTED 2026-09-25, M3.68/docs/engine.md §9bn: `CS:[0x93C2]` is NOT a dead constant -- it is
  `DS:[0x2]` under a segment alias (`CS:[X]`≡`DS:[X-0x93C0]` for `X>=0x93C0`), the same shared tick
  counter this whole file tracks writers for elsewhere. `179B` has a real, combined ~700-tick (~10s)
  timeout across both its own stages. See the new P3 regression bullet below -- this screen's own
  wait needs the same fix as the race-intro hold.**
  `faceFrame` (P2 item 3, §9ax) had
  eliminated/taken priority backwards, fixed against `0DB0`. An advisor review of the synthesized
  plan, before any code was written, caught three real bugs the plan would otherwise have shipped
  with: the eviction trigger would have fired one race early (capturing `raceIndex` after
  `advance()` instead of before -- the third instance this session of the same pre/post-increment
  bug class as §9ay/§9az); a `!bonusTriggered` gate would have wrongly skipped eviction on a race
  that also triggers a bonus; and the RESULTS table would have snapshotted `opponents` after
  eviction had already nulled the just-raced victim's own slot. All three written correctly from
  the start. Further advisor review (two separate passes, docs/engine.md §9ba has the exact split)
  found the proof-of-failure work so far didn't hold up: a whole-`src/` `git stash` only proves
  missing exports exist, not that any assertion catches its own bug; test 7's own round-robin check
  was actually vacuous (the test harness always replaces in ascending order, so "the cursor advances"
  and "always evict the lowest index" predicted the same victim every time); and test 7c exercised
  `tournament.js`'s raw functions directly rather than the code `advanceRace` actually calls. It also
  raised a concrete
  double-eviction question -- could `[0x310]` and `[28C1]` disagree across a bonus race -- settled
  by fresh re-disassembly: they're provably always equal (written together at every site), and
  `TriggerBonusRace`'s own full body never reaches the elimination gate at all, so not a bug either
  way. Fixed: new test 7a picks every replacement explicitly and out of ascending order, driving 4
  checkpoints where "the cursor advances" and "always evict the lowest index" diverge -- including a
  replacement re-evicted once the cursor cycles back to its own slot, which no roster-index rule can
  produce; a new `reportRaceResultWithOpponentSnapshot` export (snapshots opponents BEFORE
  `reportRaceResult`, returns the snapshot) replaces `advanceRace`'s own manual snapshot-then-call,
  and test 7c now calls that SAME export directly. Every regression test here (6, 7a, 7b, 7c, the
  `faceFrame` checks) was individually confirmed by reintroducing its own bug alone and re-running
  the suite: each fails specifically and only its own assertion(s). A third advisor pass also asked
  whether the live-checked "proceeded to PRESS_ANY_KEY" after a replacement pick is real DOS
  behaviour or a port-only extra screen -- resolved, not a bug: `1A4A`'s own trailing `CALL 0C15`
  (fully re-disassembled) IS that wait, the same "PRESS ANY KEY TO START" `RunOnePlayerChallenge`/
  `RunOnePlayerHeadToHeadVsCpu` already call right after the player's own pick, reached identically
  whether `1A4A` fills 3 empty slots or just 1. An advisor pass, prompted to actually render the
  screen (no prior pass had looked at a mid-bounce frame or the exact moment it ends), caught two
  more real bugs: the panel showed the real "unpicked" placeholder (a red "?", frame 11) at the
  victim's own slot throughout the bounce, since `tournament.opponents[slot]` is already `null` by
  the time this screen starts -- fresh disassembly of `19F2` (26 instructions) showed the real panel
  draw happens ONCE, before the bounce, with the victim's own descriptor OR'd `0x40` first
  (`1000:170A`), which renders as genuinely BLANK artwork (confirmed by rendering both to PNG and
  looking), not a visible placeholder or their own portrait -- fixed with a new `eliminatedPanelSlots`
  export in `screens.js`; and the post-bounce frame was wrong, in two stages: a first fix clamped
  `state.step` to 15 (rather than letting it reach 16 and silently falling back to Y-offset 0), but a
  further pass challenged that fix's own unverified assumption that the icon simply stays frozen at
  its own last position -- re-disassembling `1000:1776: CALL 05B4` (`RestoreSpriteBackground`,
  erases the sprite from the work buffer every loop iteration, including the last) and `1000:1790:
  CALL 08BC` (the real game's own next full-screen present, distinct from the loop's own partial-band
  refresh) settled it: the icon vanishes ENTIRELY the instant the bounce finishes, not a beat later
  and not frozen at offset 47. Fixed properly: `drawEliminatedScreen` now takes an explicit `done`
  flag and skips the icon draw entirely. A further pass then settled what had briefly been left as
  `UNKNOWN_elimination_bounce_clip_band`: the icon doesn't get clipped by a narrow VGA-refresh band
  (`089C`'s own partial-band present turned out to be an unrelated, harmless optimization, a red
  herring) -- it SQUASHES. `1000:1767: SUB byte [BX+0x19],AL` shrinks the sprite's own drawn-row
  count (reset to its full height by `0630` every step) by the current offset before each draw, and
  `04BD`'s own row-loop counts down from the sprite's own top, so fewer of the icon's own bottom rows
  draw the deeper it sinks -- down to just 1 (entirely transparent, on this sprite) visible row at
  the deepest point of each dip -- with its own visible bottom edge pinned at the panel row's own
  "floor" throughout, rather than moving as one whole sprite. Ported via a new `cropRows` option on
  `blitChr`/`blitTransparent` (`src/render/menuView.js`/`blit.js`). Every fix confirmed by
  reintroducing its own bug and re-running the suite, and the final behaviour confirmed visually by
  rendering several steps to PNG and looking (the face visibly sinks to a sliver, then resurfaces,
  matching the wobble table's own double-dip shape). `src/frontend/elimination.js`
  (new), `tools/check-elimination.mjs` (new, `npm run elimination`). Also ports item 2's own
  deliberately-deferred `FUN_1000_19F2` 4-face status panel (`drawOpponentPanel`), needed for this
  screen's own row layout and shown for both the initial pick and a replacement. Live-tested end to
  end (bounce screen, vacated-slot replacement picker, screenshots).**
- [x] **The Challenge-rule divergences from §9an 8**, one test each:
  - the final race's 2nd place is a fail (`15B7`, `1658`);
  - the bonus trigger has no cap (`1123-113A`; `[342]` counts wins only, `1A92-1AA5`);
  - a passed Challenge race shows RESULTS only (OUTCOME code 1 is emitted only at `10EC`);
  - OUTCOME code 4 plays tune 6 and shows "NO BONUS" (`1C84` runs before the `1CA3` test);
  - the `]` key zeroes lives on OUTCOME 2/3 (`1DCD`).
  **Done, §9bb: all 5 fully re-disassembled and all 5 fixed -- 2 of them (3 and part of 2) turned
  out to be real bugs a first pass at this item wrongly waved off, caught by later advisor review.
  1: only 1st place passes the very last race (`15B7`/`1658`) -- `reportRaceResult`'s pass
  threshold is now `isLastRace ? 1 : 2`; this ALSO explains an `mm-re-player-visible` pass's own
  "0x19-race exception... could not further explain" in the separate results-tune item (§9ai,
  corrected). 2: the bonus TRIGGER (`1123-113A`) has no cap at all -- only the bonus-TRACK counter
  (`[0x342]`, resolution-time) is capped; the port's own extra trigger-side cap is removed. The
  SAME resolution-time code had two MORE bugs a first draft missed: the counter's own increment
  (and a newly-added life grant, next) must be WIN-gated (`1A92`), not unconditional, and a WON
  bonus race never actually incremented `state.lives` at all (`1CF7-1D08`'s own real `INC [0x406]`
  -- the outcome's own name says "extra life") -- both fixed. 3: **a REAL, currently-shipping bug,
  not "needed no fix" as first concluded** -- checking only `screenAfterRace` (the FIRST screen
  after a race) missed `flow.js`'s own SECOND transition, `confirm()`'s `RESULTS` branch, which
  showed a spurious OUTCOME screen ("QUALIFIED FOR CHALLENGE!") after EVERY passed regular race; a
  new `showsOutcomeAfterResults` predicate (true only on a loss) now gates that transition,
  matching `1650-166A`'s own real "a PASS jumps straight past the outcome-message call" behaviour.
  4: OUTCOME code 4 plays tune 6 like every even code -- corrects a REAL ERROR an earlier
  `mm-re-player-visible` pass made ("code 4 skips the whole real screen... jumps straight past its
  own AH=4"), which a fresh byte-for-byte re-read of `1c6a-1c89` (independently repeated twice)
  found no support for whatsoever; `raceOutcomeMusic`'s wrong early-return removed. 5: the `]` key
  (scancode `0x1B`) zeroes lives on the `ONE_LIFE_LOST`/`EXTRA_LIFE` outcome screens, ending the
  tournament immediately only for the former (a real caller-side asymmetry: the regular-race caller
  checks lives the instant `1C1B` returns; `TriggerBonusRace`'s own caller never does) -- ported as
  a new `applyLivesCheat` export, its own reachability guard living INSIDE the function (moved
  there after an advisor review noted a first draft left it untested in the caller), wired into
  `flow.js`'s `onKeydown`. Every changed/new assertion individually confirmed by reintroducing its
  own bug and re-running the suite.**
- [x] **The two INFERRED tournament rules** in `tournament.js`'s header: what ends the tournament at
  0 lives, and whether the win streak resets to 3 after a bonus race. Re-derive both from `10a0`/`115c`
  and replace the inference with cited code.
  **Done, §9bc: both resolved. The streak-reset half was already settled by an earlier session
  (§9t, `1000:1220`, confirmed-equivalent to the port's own resolution-time reset) -- no code
  change needed, just the header's own stale framing cleaned up now that both halves are settled
  together. The lives half was a genuine gap, now closed by an exhaustive `search_byte_patterns`
  sweep of every `[0x406]` reference in the image: it's a single BYTE (init to 3 at `0ED0`,
  decrement at `1CEA`, increment at `1D00`, the `]` cheat's own zero at `1E12`), tested for EXACT
  zero (not "non-positive") at the two real sites that end a run, `166D` (Challenge) and `1403`
  (two-car), both `CMP byte [0x406],0`. Because it's an UNSIGNED byte, a decrement past 0 WRAPS to
  255 rather than going negative -- the one place this port's own prior `state.lives<=0` inference
  (an ordinary signed number) provably diverged from the real bytes, reachable via the `]` cheat
  (§9bb item 5) zeroing lives on an `EXTRA_LIFE` screen and then losing the next race. Ported as
  `decrementLives`/`incrementLives` (`(lives ∓ 1) & 0xFF`), replacing the two ad hoc `lives--`/`<=0`
  sites. Confirmed by reintroducing the old signed-number logic and re-running the suite: fails
  specifically the one new test that exercises the wrap (win a bonus race, apply the `]` cheat, lose
  the next race, expect `lives===255 && over===false`), passes again once reverted.
  The SAME `[0x406]` sweep surfaced a SECOND, real, currently-shipping bug, found and fixed in this
  same pass rather than left open: `flow.js`'s own `finishRace()` read CHEATS.BIN spot-effect TYPE 0
  (`36A0`, a plain `DEC [0x406]`, genuinely DIFFERENT from `36A7`/type 1's "instant end the race" --
  an earlier draft of this note wrongly merged the two) through a signed `Math.max(0, ...)` clamp
  instead of the same byte-wrap -- found by grepping the actual call sites rather than trusting
  `cheats.js`'s own header comment, which claimed (by then stale) that `lives` "has no reader."
  Confirmed the same way: reintroducing the clamp fails 3 of the new unit test's 4 assertions,
  passes again once reverted.
  A follow-up review then caught a THIRD real bug in the same fix: the `25011968` cheat's own reset
  (`11BA`, inside `SetupTournamentRace`, confirmed to run AFTER `CALL 3039` -- the SAME function
  that calls `CheckCheatSpotsThenPause` -- and BEFORE the results screen) needs to land BETWEEN a
  race's type-0 decrements and its own loss check, not after the loss check as the port's own
  `advanceRace` reset did; getting this backwards let an active cheat's own type-0 pause decrements
  survive long enough to zero `tournament.lives` and genuinely end the tournament, the opposite of
  DOS (an earlier check had only confirmed `cheatActive` can't turn on mid-tournament, which doesn't
  cover a race with both a decrement and a loss in it). Fixed by moving the composition into
  `reportRaceResult` itself (`tournament.js`, the one function that IS unit-tested), not composed at
  the `flow.js` call site (untestable there, since no automated harness covers `flow.js`): a new
  `applyPostRaceLives(state, delta, cheatActive)` export (delta, then reset in DOS's own order) is
  called as `reportRaceResult`'s own very first statement, taking `lifeDelta`/`cheatActive`;
  `flow.js`'s `finishRace` no longer touches `tournament` at all, only carrying `lifeDelta` out in
  its resolve payload for `advanceRace` to forward. Since `reportRaceResult` is shared by every race
  type, this closes the port's separate pre-existing "never re-arms for a bonus race" gap for free.
  This closes `UNKNOWN_25011968_reset_timing` in full. (Two earlier claims in this note's own
  history were checked and corrected in place, not silently dropped: that the gap "could still end
  the tournament on the cheat's very first race" -- false, then that it was reduced to an
  unobservable byte value with "nothing to fix" -- also false, once a type-0 decrement is in the
  same race. Full account, docs/engine.md §9bc.)**
- [x] **The results screen's tune condition.** It uses a pass/fail boolean; the real condition is
  the narrower `word[3FC]`/`[3FE]` test (§9ai). Port it exactly.
  **Done, §9bd: `1000:1439`'s full 242-instruction body re-disassembled fresh. The tune test
  (`1410-1427`) is byte-for-byte IDENTICAL to two other sites in the SAME function: `1650-1667`
  (the outcome-gate) and `15A5-15C7` (a per-row results-label pick) -- BOTH already found and fully
  disassembled by P3's 4th item (§9bb item 1, including a live read confirming the row-label's own
  two strings), which ported the outcome-gate as `reportRaceResult`'s `isLastRace ? 1 : 2` threshold
  and explicitly deferred THIS site (the tune) as the one piece still left on the `lastPassed`
  approximation. One rule, tested three times in the same function, not independently-drifting
  copies. `finishPosition` (`rankOrder.indexOf(0)+1`) confirmed to read the
  SAME order-array slots `[3FC]`/`[3FE]` DOS does, including under the instant-win cheat (`36A7`'s
  own writes, divided by `[0x2662]` -- independently confirmed elsewhere to be P2's own car-record
  pointer, `0x164`/`CAR_RECORD_SIZE` -- at `11D5`, resolve to exactly `[0,2,1,3]`, matching
  `cheats.js`'s own hardcode) -- the specific check this item's own citation warns not to skip,
  echoing §9bb item 3's own earlier shortcut (waving off a call site as "already correct" without
  checking it). New `resultsPassed(state, finishPosition)` export extracts the shared formula (used
  by both `reportRaceResult` and the tune); `flow.js`'s `advanceRace` now computes it directly,
  captured before `raceIndex` advances (same timing as `wasQualifier`), and passes it to
  `raceResultMusic` in place of the old `lastOutcome`-derived `lastPassed`. `lastPassed` itself
  (which also feeds `drawResults`'s "QUALIFY"/"FAILED" text) needed no change and was NOT
  redirected to the new export -- an intermediate draft tried that and was wrong (`resultsPassed`'s
  own Challenge-shaped formula gives a false PASS for a non-last-race H2H loss or a two-car
  qualifier loss), reverted once checked; `lastOutcome` already reflects the byte-exact rule for
  the one case that matters, since `reportRaceResult` now computes `PASSED`/`ONE_LIFE_LOST` via
  `resultsPassed` itself. Confirmed by reintroducing a naive `finishPosition<=2` (no last-race
  narrowing) and re-running the suite: fails both the new pinning test AND a pre-existing one,
  passes again once reverted.**
- [x] **The H2H race-intro variant** (§9an 8, "the H2H race-intro variant").
  **Done, §9be: `1000:11F8`'s full body re-disassembled (162 instructions). "The H2H variant
  (portraits and facing cars)" undersold the gap -- `12BD`'s portrait panel (`19F2`, already
  disassembled by §9az for its opponent-picker call site) plus a 4-slot vehicle-class icon reveal
  is the ONLY race-intro mechanism for a regular race in EITHER format; only the icon-slide's own
  exit condition and count (2 vs 4) are format-specific. H2H converges two icons over 59 ticks
  (`-32->84` at `+2`/tick); Challenge marquees four over 121 (`256->16` at `-2`/tick), both traced
  tick-for-tick -- this is the `131F` slide loop's OWN portion only, not the full real hold: `12BD`
  also runs a one-shot draw (`01DE`, its own 18 instructions show no loop, though its callees
  weren't read instruction-by-instruction) and a palette fade-up (`32CE`) BEFORE the slide loop
  starts, and that fade has NO derivable tick duration at all (already established elsewhere as
  CPU-speed-bound, not tick-paced) -- new open item `UNKNOWN_race_intro_prehold`, this port's own
  hold understates the real delay by that amount. Scoped per an explicit user decision, presented
  with the full-sprite-panel alternative (a full port would duplicate §9az's own declined scope for
  the identical `19F2` function, and would need a DOSBox live capture to verify layout/flip/asset):
  two things ported -- `raceIntroHoldTicks(state)` (the slide loop's own tick count, wired into
  `flow.js` as a `performance.now()` deadline; a confirm during it has no effect because `179B`'s
  own entry clears the key-release latch unconditionally, not merely because the loop itself never
  polls -- checked directly by disassembling `179B`, not inferred from the loop's own silence; this
  also strengthens, not just parallels, `elimination.js`'s own identical claim: `179B` is confirmed
  the SAME shared successor stage for the elimination bounce too (§9ar e, not §9an as an earlier
  draft cited), and the gap between them was checked directly -- `1000:1776-179B` disassembled
  shows the bounce's own exit tail falling straight into `179B`'s own call with no `CALL 2D5B` and
  no read of the release latch anywhere in between. Proven only for a key
  pressed AND released inside the hold -- a key still held when the hold ends is the SAME
  release-vs-keydown mismatch already open as `UNKNOWN_outcome_screen_timeout`, not re-fixed here)
  **-- REGRESSION FOUND 2026-09-25, M3.68/docs/engine.md §9bn: after `raceIntroHoldTicks`'s own
  deadline passes, this port's own `flow.js` waits INDEFINITELY for a real keydown, with no
  fallback -- but `179B` itself has a real, combined ~700-tick (~10s) timeout across its own two
  stages that this port is currently missing entirely (the "no real timeout" premise this
  `performance.now()`-deadline design leaned on was wrong, see the new P3 regression bullet below).**
  and `raceIntroParticipants(state)` (two text rows -- the player's name, then "VS" plus the
  opponents -- standing in for `19F2`'s own face panel; two rows and space-separated, not one row
  with commas, because `drawString`'s own glyph map has no comma/lowercase and an earlier draft's
  single-row, comma-separated version would have silently rendered those as blank gaps, caught by
  rendering both formats to PNG and looking at them). The sprite panel itself stays unported.
  Confirmed by reintroducing an off-by-one on both tick counts (58/120), and separately a version of
  `raceIntroParticipants` with no qualifier/bonus-race guard, and re-running the suite each time:
  the targeted assertions fail, pass again once reverted.**
- [x] **The champion screen's own wait** (`ShowChampionScreenTune3 1000:1AAD`, docs/engine.md
  §9br's closing note). Found 2026-09-25 right after the wait-screen bullet was ticked, so P3 was
  NOT actually closed by M3.72. DOS: the two text lines slide in with no input poll (`1B2B-1BE4`);
  then, every tick, `[0x1080]=0` and the screen leaves when `[0x108B]!=0` (`1C0B`): any control bit
  held, either player; no release latch, no timeout. The port takes a Space/Enter keydown at any
  time (flow.js's CHAMPION branch of `confirm()`), and README.md still says so. Port the slide-in's
  length (the ticks until both lines are in place) and the any-control-bit exit, test it, and
  live-check it. **DONE 2026-09-25 (M3.73, docs/engine.md §9bs).** Correction to this bullet's own
  wording: the slide-in is 108 ITERATIONS, not ticks; its iterations wait on nothing, so its DOS
  duration is CPU-bound and not derivable (`UNKNOWN_champion_slide_duration`, a Part L item); the
  port runs one iteration per tick (~1.54s), a port choice. Then any control bit of either player
  leaves, with no timeout. `npm run champion`; `[PROVEN]` live in the port (a held ArrowLeft
  leaves at 1.548s, Enter does nothing, no timeout after 16s, P2's KeyJ leaves).
- [x] **PRESS ANY KEY's own wait** (`FUN_1000_0C15`, docs/engine.md §9bs's closing note). DOS: the
  release latch cleared at entry, then per tick a `[0x261F] >= 0x2BC` timeout check, a tick, and
  leave on any key RELEASE or on fire HELD (no debounce). The port leaves on any keydown, with a
  `setTimeout(0x2BC ticks)`. Trace which reader `[0x1080]` selects there (the callers are
  `RunOnePlayerHeadToHeadVsCpu`/`RunOnePlayerChallenge`; check whether `0FD4`/`104C` run before
  the call), then port it as a per-tick loop on the session-lifetime readers, test it, live-check it.
  **DONE 2026-09-25 (M3.74, docs/engine.md §9bt):** `[0x1080]=0x137B` (P1) at all three callers;
  release or P1 fire held leaves, timeout on tick 700; `npm run pressanykey`; `[PROVEN]` live in the
  port. §9bt also classifies every input poll in the game (all 18 `2D5B` calls, all `[0x107E]`
  reads); it found one more one-player gap, the next bullet.
- [ ] **The `25011968` cheat's race skip at the race intro** (`UNKNOWN_f6a_reader`, docs/engine.md
  §9bt). With the cheat typed (`[0xF6A]=1`, `2916`), right after the race intro's `179B` ends on a
  key release (`1398-13E0`): keypad `+` (scancode `0x4E`) moves to the next race unless it is the
  last (`[0x28C1]==0x19`), keypad `-` (`0x4A`) to the previous, wrapping 0 to `[0x439]`; round and
  race are re-derived from `ORDER_TABLE` and the race setup (`11F8`) runs again. The port has none
  of it. After this, the §9bt sweep leaves nothing else in one-player play outside P5.

### P4: two-human Head to Head
- [ ] Port `FUN_1000_1e20` → `1ef1` / `RunHeadToHeadTournament 1000:1faf` / `2329` / `256e`: the WON/LOST
  screens, skill labels via `DS:08CD`/`DS:08B0`, the win tally `[98A]`/`[98C]` (first to 4,
  §9y), and the handicap question. Track pick: from `DS:09BA` (`04 0A 11 0D 1C 21 14 19`) by
  `DS:0002 & 7` without repeats. Reproduce `DS:0002` as a 70 Hz tick counter that runs from boot,
  so the choice is as non-deterministic as the original's. P2 input is KEYS 1. The race engine
  already runs two-car races (`twocar.js`). Check what it assumes about car 1 being a drone.
  **In progress, well past the original 4-commit plan (M3.60-M3.68, docs/engine.md §9bf-§9bn):**
  `car.isDrone` reflects real controller type; the alternate tuning path two-human H2H actually uses
  is ported and live-proven; `twoHuman.js` (track pick with no repeats, win tally, session-scoped
  per-character lifetime stats, first-to-4 champion detection, skill labels) is ported and tested;
  `256E`'s own full state (win-tally normalize, portrait blink resolver, bounded dismiss-wait) and
  `0B51`'s own interactive Y/N toggle are both ported and tested too (M3.66/M3.67) -- only the
  pixel-level draws and the actual `flow.js`/`screens.js` wiring remain, see "Remaining" below.
  **`0B51`'s own new findings all `[PROVEN]` live (M3.68, docs/engine.md §9bn):** BRAKE dismisses
  the handicap question exactly like FIRE; LEFT beats RIGHT when both are held; the OTHER player's
  own fire/brake cannot dismiss a question that isn't theirs (both directions confirmed); and a
  character's own answer defaults to whatever it was last set to on a later visit THIS SESSION,
  surviving a full TWO PLAYER re-entry.
  **`DS:0002` correction (docs/engine.md §9bl): it is NOT a from-boot free-running counter** (13
  writers found -- 11 reset it to 0, 2 seed a nonzero value that just forces an immediate first
  blink-toggle -- triggered by nearly every wait-for-input screen in the game) -- the
  intended non-determinism (human reaction time) still holds, just sourced from ticks-since-the-
  result-screen's-own-dismiss-wait-began, not a boot-relative clock.
  **Remaining, now better bounded (docs/engine.md §9bj maps `1E20`/`1EF1`/`2193`'s remaining half,
  ports `2216`'s own tick count as `raceInfoSlideTicks`; §9bl reads `256E` in full and ports its own
  fixed-22-tick slide/dismiss-wait as `RACE_RESULT_SLIDE_TICKS`/`raceResultWaitStep`; §9bm reads
  `0B51` in full and ports its own interactive Y/N toggle as `handicapStep`, finding it exits on
  BRAKE as well as FIRE and that LEFT beats RIGHT when both are held):** the WINNER!/LOSER! DRAW
  itself (`256E` -- its own full logic/timing is now ported, only the
  pixel-level draw remains), `2481`/`240A`'s own draw (formulas already ported, §9bh/§9bi -- a
  suspected persistence bug in `2481`'s own read was investigated and ruled out, §9bl: `240A`
  unconditionally cleans the relevant bits before every real `2481` call), the roster-word-bit-7
  merge for two-human H2H specifically (`handicapStep`'s own boolean result -> a roster word's bit
  7, no two-human H2H roster-word storage exists yet in this port), and `flow.js` wiring --
  confirmed §9bj to need NO new character-select or menu STATE-MACHINE logic
  (P1/P2 picks reuse the already-ported `charSelectStep` twice via its existing `input` parameter;
  the CHOOSE GAME TOURNAMENT/SINGLE RACE picker reuses the already-ported `twoItemMenuStep` a third
  time; the champion screen, `1AAD`, reuses `flow.js`'s own already-wired `CHAMPION` phase/
  `drawChampion`/`championMusic` from the one-player path) -- just a real P2 `createKeyboardReader`,
  `enterSelectGame`'s TWO PLAYER branch, one shared `controllerTypes` array feeding both `spawnCars`
  and `raceCtx.controllerTypes`, and
  new `screens.js` draw functions (where DOS marks a character pick taken is RESOLVED, §9bl: `09E0`
  itself, no new `charSelect.js` logic needed) -- scoped for BOTH two-human modes at
  once, since P4's 2nd item below shares `twoHuman.js`'s own session state (§9bi).
  **Four wiring rules `[STATIC]`-settled this session, docs/engine.md §9bn -- easy to lose at the
  next compaction, so recorded here too:** (1) `handicapStep` must be fed only the PICKING player's
  own reader bits, never P1|P2 ORed together -- `09E0` never touches `[0x1080]`, so it stays at
  whichever single reader block `1E20` set up for that pick. (2) CHOOSE GAME's own cancel/idle-out
  (`1EF1`'s `CX==0`) does NOT return to character select -- `1E20` calls `1EF1` exactly once with no
  loop, returning to `0220`'s own TWO PLAYER branch, which itself returns unconditionally; the actual
  SELECT GAME redraw is `real_entry`'s own top-level loop (`0089-0095`) calling `0220` fresh, not
  `0220` looping internally. (3) `nextTrack`'s own `v` seed differs by race: races 2+ read
  `raceResultWaitStep`'s own `ticks` at dismiss (§9bl); race 1 has no preceding `256E`, so it reads
  `twoItemMenuStep`'s own `idleTicks` at CHOOSE GAME's own fire-confirm instead (`0B51` never writes
  `[0x2]`, only `RunTwoItemMenu`'s own `03BC` does, reset on every LEFT/RIGHT press, not just menu
  entry). (4) Race-info's own exit (`179B`, shared with the one-player race-intro and the
  elimination screen) accepts EITHER player's own fresh fire press or key release (`[0x1080]=0` at
  entry, combining both readers), OR simply times out after a combined ~700 ticks (~10s) from entry
  across both its own internal stages -- a real timeout this session found was previously
  misdiagnosed as a dead constant, see the P3 regression bullet below. Each
  remaining screen still its own commit, per the established one-commit-per-screen pattern.
- [ ] **The single-race select** (`SelectSingleRaceTrack 1000:2193`, the 10-entry list at
  `DS:09D9`; LEFT and RIGHT both step +1). Find where it is reachable from, and port it if it is
  reachable.
  **Logic ported, §9bi; flow wiring in step 4 (same as item 1 above -- nothing in `game.html`
  reaches single race yet, so this stays unticked until that lands).** Reachable from
  `RunHeadToHeadVehicleSelectTune2 1000:2329`, confirmed via `get_xrefs_to 1000:2193` (exactly 2
  callers, no others) -- `2329` turned out to be single race's own COMPLETE gameplay loop (not just
  an entry point), calling the SAME `256E` post-race screen tournament mode uses (`get_xrefs_to`:
  only 2 callers total), crediting the SAME win tally and lifetime stats (though never displaying
  the tally -- `DrawH2HWinRecordDigits`'s own `[0x8A5]` gate skips it in this mode), but with no
  first-to-4/champion condition of its own -- it runs until ESC. `selectSingleRaceTrack` ported:
  the cursor wrap, the two PRO-class round remaps (`roundRaw` 10/11 -> round 3/1, also returned as
  `vehicleClass` for the eventual screen's own class-name draw), `SINGLE_RACE_TRACK_TABLE`
  (`data/frontend-tables.js`, `DS:09D9`, `[PROVEN]` live). GOAL's own "LEFT and RIGHT both step +1"
  confirmed mechanically, not just cited. `tools/check-twohuman.mjs` gained 40 assertions (86
  total), reintroduction-proven. `2193`'s own remaining, undisassembled half (its own `CALL 2216`)
  is now also read (§9bj): every `selectSingleRaceTrack()` call -- not just the screen's first visit
  -- runs the SAME slide-in animation tournament mode uses once per race.

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
- [ ] `UNKNOWN_champion_slide_duration` (docs/engine.md §9bs): how long `1AAD`'s 108 wait-free
  slide iterations take on DOS (for example, `[0x2]` read at `1BF8` minus its value at entry).
- [ ] The outcome screen's LIVES-path timing (docs/engine.md §9bq assumptions a-c): a breakpoint at
  `1000:1DCD` on a real ONE LIFE LOST screen, reading `[0x261F]` at the first poll. The port's
  model predicts 156.
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
