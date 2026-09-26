# The level editor (`editor.html`, `src/editor/`)

Evidence tags as in `CLAUDE.md`. Addresses are Ghidra program `MICROU.EXE` (`1000:`-based; `DS = 193C`). Checked by `npm run editor` (`tools/check-editor.mjs`).

## What "binary perfect" means here

- **Unedited files come back byte-identical** `[PROVEN]`. The model (`src/editor/model.js`) holds each level file as its own bytes at its shipped length; every value the editor shows is read from and written to those bytes in place. `npm run editor` exports all 126 level files of the nine rounds with no edits and compares them with `game/`: all identical, and nothing counts as changed. The shipped files' oddities survive: round 2's 63-byte LEV for 60 meta-tiles, round 5's DIR ending 18 bytes into meta-tile 56, the STRT_POS slots of races that don't exist.
- **An edit changes only its own bytes** `[PROVEN]`. Painting a meta-tile writes bits 0–5 of one MAP byte and keeps the attribute bits 6–7; a progress edit writes one byte of the second plane; a collision cell is one bit of COL; a DIR edit one byte; a palette entry three bytes, clamped to 0–63 (6-bit DAC values, never converted to 8 bits); a start point four bytes of STRT_POS; a cheat field one word of CHEATS. The check scripts one of each and diffs the offsets.
- **The tile bank is the exception, by necessity.** PR files are LZ-packed. An unedited slab exports its original packed bytes. An edited slab is re-packed by `src/formats/lzEncode.js`, which is not the original compressor: the packed bytes differ, but the game's decompressor (`DecompressWorkBuffer 1000:3333`, ported byte-identical in `lz.js`) unpacks them to exactly the edited slab. Every export is decompressed and compared before it is offered, and the check round-trips all 41 shipped packed files (`docs/asset-arena-and-lz.md`, "An encoder").

## The files

| File | Layout | Scope |
|---|---|---|
| `ROUNDnm.MAP` | 1024 meta-tile bytes (bits 0–5 index, 6–7 attribute) + a 1024-byte progress plane | per race |
| `ROUNDnmB.BRK` | one brake byte per progress value | per race (none in round 9) |
| `ROUNDnBR.CT` | 72 B per meta-tile: 6×6 little-endian bank tile words | per round |
| `ROUNDn.COL` | 18 B per meta-tile: 12×12 collision bits, MSB first | per round |
| `ROUNDn.DIR` | 36 B per meta-tile: 6×6 bytes, grade<<4 \| direction | per round |
| `ROUNDnBR.LEV` | 1 B per meta-tile | per round |
| `ROUNDn.PAL` | 256 × 3 6-bit DAC values | per round |
| `ROUNDnBR.PR0–2` | LZ-packed tile bank, 256 B per 16×16 tile, 192 per file | per round |
| `STRT_POS.BIN`, `CHEATS.BIN` | 9×4 start points; 30 cheat spots | global |

The per-round files are shared by every race of the round, so the meta-tile editor names the races that use a meta-tile and offers a duplicate to edit for one race only. Formats and consumers: `docs/track-layout.md`, `docs/track-graphics.md`, `docs/engine.md` §3/§6.

Not editable because they live in `MICROU.EXE`, so shown as context: the checkpoint bands (`DS:2035`), the overlay tile ranges of rounds 2 and 3 (`1000:3994`), the heading tables (`DS:18FB`, `DS:191B`), the vehicle tuning.

## The game's limits, as the editor checks them `[STATIC]`

| Limit | Source |
|---|---|
| 64 meta-tiles per round | the MAP byte's 6-bit index (`AND 0x3F`, `1000:58c8`); the COL buffer `DS:3163` is `0x480` = 64×18, DIR `DS:35E3` `0x900` = 64×36. Rounds 3 and 4 already have 64. |
| LEV ≤ `0x80` bytes | read with `CX=0x80` to `DS:1B5B` (`1000:3bba`) |
| BRK ≤ `0x200` bytes | read with `CX=0x200` to `DS:195B` (`1000:3b92`); shorter than the progress plane's maximum means drones read an earlier race's bytes (`docs/engine.md` §9ad, a warning: round 3's shipped races do it) |
| a PR file packs to ≤ `0x4000` | read with `CX=FFFF` to `7D78:C000` (`1000:3581–358E`) |
| every PR slab but the last is `0xC000` | the next file lands 48 KB on (`1000:35A7`) |
| bank ≤ `0x20000` (512 tiles) | slabs load at `2B78`, `3778`, `4378`; the world-map arenas at `4B78` are built before the PR series is read (`3932` → `3c09`/`448c`, then `3952` → `45ef`) |
| CT words < the bank's tile count; in rounds 2/3 an overlay-range word also needs tile+12 | `renderTrack`'s reads, `1000:9214` |
| the progress plane has a maximum > 0 and a cell in every checkpoint band | the lap rule works on half the maximum (`docs/engine.md` §9s), and a lap needs each band (`docs/engine.md` §3) |

Tiles and meta-tiles can only be appended: a download adds or replaces files and cannot delete one from an install, so the PR file count never drops below the shipped one. A new meta-tile grows CT, COL, DIR and LEV together; where DIR stops short (round 5), the missing bytes of the last record are zero-filled first, and where LEV has spare bytes (round 2), the slot is written in place.

## The pieces

- `src/editor/model.js` — the model: raw bytes per file, transactions (a brush stroke is one) with undo/redo as before/after file copies, decoded getters/setters, export, the sparse localStorage diff (`toJSON`/`applyJSON`, only files that differ from the shipped ones; PR entries are unpacked slabs, packed at export).
- `src/editor/validate.js` — the checks above.
- `src/editor/zip.js` — a store-only ZIP writer (CRC-32), checked with `unzip -t`.
- `src/editor/render.js` — bitmap caches for tiles and meta-tiles, dropped when their files change.
- `src/editor/mapTab.js`, `metaTab.js`, `tilesTab.js`, `tablesTab.js`, `filesTab.js`, `app.js` — the UI. The map's flow-field overlay draws the heading a car actually follows: the DIR low nibble (`& 7` in round 2), remapped through the LEV row when attribute bit 1 is set, reversed by bit 0 (`terrain.js` `h6231`, `ai.js`).
- `src/editor/overlaySource.js` — `index.html?round=R&race=N&edited=1` reads through the saved diff, so "Test race" plays the edited track in the port. Round 9 skips the BRK read (it has none).

One real bug the check caught while this was written: Node's `Buffer.slice()` is a view, so undo snapshots aliased the live bytes and every edit looked like no change. The model now copies every loaded file into a plain `Uint8Array`.
