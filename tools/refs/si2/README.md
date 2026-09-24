# Sound reference captures

Committed captures from the DOSBox bridge that `npm run si2` replays against the JS driver model (`docs/sound.md` §7). Nothing here is game data; every file was produced by tracing `MICRO.EXE` + `DRIVER1.BIN` live.

| File | What | Used by |
|---|---|---|
| `tune{1..8}_writes.txt` | `(sequence tick, register, value)` stream of one loop of every track of each tune, from the independent Python transcription of the driver (`si2.py`, research agent) | `check-si2.mjs` — the JS sequencer must emit the identical stream |
| `live_title_start.txt` | Title tune start, session 1: ESC from a race → GAME OPTIONS → RETURN. Driver reload at game tick 53051, 1500 OPL writes over ticks 53053–54307. The model needs one gated (in-load) timer tick here — consistent with the counter moving 53051→53052 during the load; the cause of the difference from session 2 is not established. | `check-si2-live.mjs` |
| `live_title_cold.txt` | Title tune start, session 2 (`live-verify` phase): ESC from the title → GAME OPTIONS → RETURN. Reload at 56402, 1600 writes over 56404–57750, 19 commands including six attract re-polls (`AH=9` every 4.00 s). The model needs no gated tick here (the game's first post-load `AH=9` is logged on the load's own tick). | `check-si2-live.mjs` |
| `live_race_start.txt` | Race start, session 1: the four engine records with their live-patched bytes, pitch updates, the race-load `AH=7`, restarts, drop-in sfx 9; ticks 16913–17016, 60 commands, 258 writes. | `check-si2-race.mjs` |

Line format of the `live_*` files: `# cmd gt=<game tick> AH=<decimal> AL=<hex> BX= CX= DX= from <caller> ret=<AX>` for commands captured at the driver's far entry, interleaved with data lines `gtick bios reg val route caller_near_ret dx` for the OPL writes captured at the driver's two `OUT` instructions (`route` S = `OplWriteIfChanged`, U = `OplWriteAlways`). `gt` is `DS:28F7` read at the breakpoint; commands with tick `gt` were issued after tick `gt` ran.
