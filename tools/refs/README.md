# Live reference captures

Raw captures from the real game under the DOSBox bridge, used by `tools/check-live.mjs` to pixel-diff
the decoders against what the game actually drew. Not game data files; small enough to keep.

| File | What | How captured |
|---|---|---|
| `race_R21_a000.bin` | 64000 B mode-13h frame buffer (`A000:0000`), POWERBOATS round 2 race 1, one-player Challenge, a few seconds into the race | `mem_read` A000:0000 via `mcp__dosbox__*` during the research workflow's live boot trace |
| `race_R21_dac.bin` | 768 B DAC read back through port 3C9h at the same moment | `port_read` 3C7←0 then 768 × 3C9 |
| `trace-R52-drive.bin.gz` | 400 physics steps of a Challenge race (round 5 race 2), car 0 driven with real DOSBox keys: per step the four car records, the key word `[107C]`, the order array, `[261F]`, `[262F]`, `[26C6]`, `[26CC]` (1441 B a row, gzipped to 38 KB); used by `tools/check-trace.mjs` (`docs/engine.md` §9dh) | REST reads at an execute breakpoint on `023E:30B7`, once per step |
| `setup_marker_records.bin` | 1424 B, the four car records (`DS:124A`) after race setup, having been filled with 0xA5 at `RunRaceMainLoop`'s entry `3039` and read at `304B`: the bytes still 0xA5 are the ones setup never writes; used by `tools/check-twocar.mjs` (`docs/engine.md` §9cs) | REST `/api/v1/memory` at the two breakpoints, first Challenge qualifier after boot |
| `front/options_f7_a000.bin`, `front/joycal_centre_a000.bin`, `front/joycal_right_a000.bin` | GAME OPTIONS with the F7 line, and F7's calibration at its CENTRE and RIGHT stages, `[2625]` poked to 1 (no joystick in DOSBox); used by `tools/check-devices.mjs` below row 30 (`docs/engine.md` §9cu) | REST `/api/v1/memory` A000:0000 on a settled screen (no DAC: the front end runs on INTRO.PAL) |
| `front/h2h_*_a000.bin` + `_dac.bin` | Two-human Head to Head's screens (race info, result before and after a blink, SELECT VEHICLE plain/PRO/PRO-blink, CHOOSE GAME), DWAYNE vs JETHRO; DAC == INTRO.PAL in each; used by `tools/check-h2hscreens.mjs` (`docs/engine.md` §9bz) | REST `/api/v1/memory` A000:0000 and the DAC via ports, at an execute breakpoint (race info: `023E:179B`) or a settled screen |

The race view occupies screen x = 32..287 (256×200); columns 0..31 hold the HUD, 288..319 are black.
Best-fit camera for the frame: world (414, 500) px, found by exhaustive search — see `check-live.mjs`.

Why these are kept although `game/` is never committed: they are 64 KB of *rendered output* and a
768-byte DAC state, not distributable game files — nothing can be extracted from them beyond one
screenful of an already-decoded scene. They exist so the exactness claim is reproducible.
