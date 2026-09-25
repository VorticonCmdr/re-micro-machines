# Micro Machines — an HTML + vanilla JS port

An in-browser port of **Micro Machines** (Codemasters, 1994) that decodes and plays the original
DOS game's own files at runtime — no extraction step, no converted assets, nothing generated at
build time. It ships no game data of its own; you provide your own legally-owned copy of the game.

This is a from-scratch reverse-engineering project: every format, physics formula and game rule
here was recovered from the shipped files and the disassembled executable (`MICROU.EXE`), not
copied from another port or from source code (none exists). `PLAN.md` and `PLAN-ENGINE.md` are the
full working plans; `docs/` holds the subsystem-by-subsystem evidence, each claim tagged
`[PROVEN]` (verified by running something), `[STATIC]` (read from the bytes) or `[UNKNOWN]`
(not established) — see `CLAUDE.md` for that convention in full.

## Playing it

You need your own copy of the game's files (an `.exe`/`.com`/data-file set from the original
install, commonly named things like `MICRO.COM`, `MICRO.EXE`, `GAME1/`, etc.) — this repository
does not include or link to a copy.

```bash
npm install
npm run dev
```

Open the URL Vite prints. Three pages:

- **`index.html`** — a single race (round 2 qualifier), one player vs. 3 AI drones. The
  simplest way to see the physics and rendering work.
- **`game.html`** — the full flow: title → menu → character select → a one-player Challenge or
  Head-to-Head-vs-CPU tournament → champion screen. Two-human head-to-head is not implemented
  (its own track selection isn't deterministic — see `docs/engine.md`'s tournament section).
- **`viewer.html`** — a developer asset viewer: every decoded format (tracks, sprites, sound,
  palettes…) browsable directly, useful for seeing what a file *is* independent of the game.

In dev, Vite serves a local `game/` folder (see below) over HTTP automatically. A **production
build** (`npm run build && npm run preview`, or any static host) has no `game/` to serve — every
page then offers "Open game folder…" (or a drag-and-drop zone) to read your own copy directly from
disk via the File System Access API, without ever uploading it anywhere.

Controls: arrow keys to steer/throttle, Space (or S) to fire — remappable in `game.html`'s own
GAME OPTIONS screen (F5), matching the original's real redefine-keys screen. `game.html`'s entire
boot chain through character select — the title screen, SELECT GAME / ONE PLAYER GAME, and the
character-select carousel — reads the same LEFT/RIGHT/FIRE keys your copy's `SETTINGS.DAT`
configures (both players' own bindings work at every menu level except character select, which is
P1 only, exactly as the original does — see `docs/engine.md` §9av-§9ax); everything after the
character picks mostly still uses plain Space/Enter, until `GOAL-DOS-PARITY.md`'s remaining P3
items land. The exceptions are the race-intro and "IS OUT!!" screens, which now run the original's
own key wait: any key moves on when you RELEASE it, a fire key held into the screen must be let go
first, and after ~10 s they move on by themselves (`docs/engine.md` §9bp).

## Setting up the game files for development

Put your copy's files in `game/` at the repository root (case doesn't matter; the per-round data
belongs in `game/GAME1/`, matching the original install layout). `game/` is git-ignored and is
never bundled into a build (`vite.config.js` sets `publicDir: false`) — it is commercial software
and stays local to your machine.

## What's implemented

- **Every shipped asset format**: palettes, sprites/fonts (the `.CHR` arena), tile banks, vehicle
  rotation frames, track layout (`.MAP`/`.CT`/`.COL`/`.DIR`/`.LEV`), the LZ codec, the OPL2/AdLib
  music-and-sfx driver (`DRIVER1.BIN`) reimplemented as a from-scratch YM3812 synthesizer, the logo
  intro (a real per-frame animation on `game.html` -- the 48-record reveal, banner slide and
  diagonal shine, timed and skippable exactly as the original: a mouse click, not a key), and the
  code-card copy-protection screen (also wired into `game.html`'s own boot sequence now -- the
  live target column/row, the symbol grid, cursor movement, and the two-round accept flow; both
  real compares are patched in this copy, so ENTER always advances, exactly as it does in DOS),
  the real title attract loop (a 9-class `INTRO.CHR` showcase, no idle timeout), the real
  two-level SELECT GAME / ONE PLAYER GAME menu, and the real character-select carousel (11
  `FCNORMAL.CHR` faces on a real eased scroll, a taken character skipped/rejected purely through
  the roster's own shared byte encoding, a real 5-blink commit animation) -- closing out the
  entire boot chain from `game.html`'s own launch to the character picks, all cross-checked live
  against real DOSBox captures (`GOAL-DOS-PARITY.md` P1/P2, `docs/engine.md` §9as-§9ax), and the
  real tournament board screen between Challenge races (the `CASE.CHR` "vehicle display case" with
  one `MINATURE.CHR` icon per race, at the real per-icon positions, the newest one blinking as a
  preview of the class of the race about to run), and the real elimination/replacement screen (the
  evicted character's own 16-step silent bounce on their `FCSAD.CHR` portrait, then the same
  interactive carousel re-prompting only the vacated slot -- the real victim rule is a 3-slot
  descriptor-address cursor, not a roster-index computation) -- `GOAL-DOS-PARITY.md` P3,
  `docs/engine.md` §9ay/§9az/§9ba.
- **The race engine**: 35 Hz fixed-timestep physics (steering, velocity, collisions, terrain
  hazards per round, checkpoints/laps, airborne/ramps, the full car state machine), the drone AI,
  and per-round camera — all reproduced from the disassembly, not approximated.
- **A full one-player tournament**: the Challenge (4-car) and Head-to-Head-vs-CPU (2-car) formats,
  win-streak bonus races (round 9, "RUFFTRUX"), lives, and driver elimination/replacement, including
  the real interactive opponent picker (pick your 3 Challenge opponents yourself, right after
  passing the qualifier — the qualifier's own drones are a hardcoded trio in the original itself,
  not a real pick) and the real elimination/replacement rule (every third Challenge race — won or
  2nd place, never the last — a real 3-slot descriptor-address cursor picks the victim, who can be
  re-evicted once the cursor returns to their slot; you then pick the replacement yourself, through
  the same carousel) — see `docs/engine.md`'s front-end section for exactly which parts are still
  simplified and why.
- **Sound**: real OPL2 synthesis running in an `AudioWorklet`, ticked off the audio clock the way
  the original driver was, with an optional strict-YM3812 mode (see below).
- **The real GAME OPTIONS screen** (`game.html`, shown after the code card, before the title): F1/
  F2 cycle the control device (P1 can never reach JOY2/MOUSE, a real, live-confirmed asymmetry —
  both currently only ever reach KEYS1/KEYS2, since no joystick/mouse input is wired up yet), F3
  the sound driver, F4 the smoothness (1–4, plus a real 5th value, AUTO, that resolves to the
  smoothest setting at RETURN — the original's own hardware-speed probe has no meaningful browser
  equivalent), F5 redefines the KEYS1/KEYS2 keyboard bindings, F6 shows the credits; RETURN plays
  and persists SETTINGS.DAT's own 32-byte layout to `localStorage` (seeded from the real
  `game/SETTINGS.DAT`, written only when something was actually touched, matching the original's
  own dirty-flag rule exactly), ESC quits for real, immediately, no confirmation. The
  `25011968` cheat code works too (10 lives after every race).
- **Two "polish" settings**, both faithful to the original rather than added for their own sake:
  - **Smoothness** (1–4, or AUTO on `game.html`'s own OPTIONS screen): the original's own
    display-vs-physics-rate tradeoff — physics always runs at 35 Hz, this only controls how often
    the screen redraws. On modern hardware there's no performance reason to use anything but 1
    (the smoothest); it's here for parity with the original's own options screen, not because the
    browser needs it. (`index.html`'s single-race page keeps a header select instead, since it has
    no boot chain of its own to host a real OPTIONS screen.)
  - **Strict OPL2**: the shipped game never enables the real YM3812's waveform-select register, so
    a real AdLib card would have played every voice as a plain sine wave. The DOSBox build this
    port's audio was verified against emulates an OPL3 chip in OPL2 mode instead, which (like most
    real Sound Blaster/AWE cards of the era) ignores that and plays each instrument's own waveform
    regardless — a richer, "not strictly accurate" sound that is what the game actually sounded
    like on real, common hardware. This checkbox switches to the stricter, sine-only behaviour.

## What's not implemented

- Two-human head-to-head — named explicitly in `docs/engine.md`'s front-end sections, with the
  reason it was cut (the tournament board screen, the interactive opponent picker, and the
  elimination/replacement screen are now all implemented — see above). Palette fades exist (the
  README previously said otherwise); see `docs/engine.md` §9an for the one real difference (the
  port fades in at race start, the original doesn't).
- Gamepad/mouse input during a race (keyboard only) -- mouse input elsewhere (the logo intro's
  click-to-skip) is implemented. The GAME OPTIONS screen's own F7 (joystick calibration) is gated
  correctly (never shown without a joystick) but its analog-read body isn't ported, same reason.
- A handful of narrow, explicitly-tagged `[UNKNOWN]` items remain — grep `docs/engine.md` and
  `docs/sound.md` for `UNKNOWN_` to see exactly what and why.

## Verifying it

There is no conventional test runner; verification is either an exact match against values read
live from the disassembly, or "render it and look." The check scripts:

```bash
npm run catalog     # decoded-format catalogue matches the real game/ directory
npm run tables       # every embedded engine/front-end constant matches MICROU.EXE
npm run car          # car record round-trips the static memory image byte-exact
npm run step         # headless physics sanity + the lap/checkpoint rule
npm run trace        # replay a live-captured DOSBox trace through the physics
npm run ai           # drone AI against the same trace, and a full AI+physics loop
npm run rounds       # all 9 rounds x every race x both race formats run clean
npm run tournament   # the one-player tournament state machine's rules
npm run elimination  # the real elimination-screen bounce animation matches the disassembly
npm run sound        # the sound driver model, engine pitch, sfx wiring
npm run opl-toggle   # the two OPL2 waveform modes actually sound different
npm run si2          # the JS OPL2 core reproduces every register write DOSBox made
npm run live         # pixel-diffs an assembled track against a real DOSBox frame
npm run smoke        # every viewer view against the real files, headless
```

`npm run render` / `npm run tracks` / `npm run tunes` decode assets to `tools/out/` to be looked at
or listened to by a person — that inspection *is* the check for anything visual or audible that a
byte-for-byte comparison can't cover on its own.

## Project layout

```
game/            your own copy of the game files (git-ignored, never bundled)
src/formats/     decoders for every shipped file format
src/engine/      the race physics, state machine, drone AI, camera, input, sound wiring
src/frontend/    the tournament rules and the menu/race/results flow (game.html)
src/render/      indexed-buffer compositing and sprite blitting
src/audio/       the from-scratch OPL2 synthesizer and its AudioWorklet host
src/data/        engine/front-end constants read live from MICROU.EXE, checked against it
src/ui/          the developer asset viewer (viewer.html)
tools/           check-*.mjs verification scripts, render-*.mjs asset dumpers
docs/            subsystem-by-subsystem reverse-engineering findings, with evidence tags
```

See `PLAN.md` (asset formats) and `PLAN-ENGINE.md` (the engine/front-end port) for the full,
milestone-by-milestone account of how this was built.
