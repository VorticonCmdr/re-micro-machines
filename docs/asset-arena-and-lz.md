# The LZ codec, the asset arena and the `.CHR` members

Evidence tags as in `CLAUDE.md`. Addresses are Ghidra program `MICROU.EXE` (`1000:`-based; `DS = 193C`). Established by the research workflow's `file-io-map` agent from disassembly, ported to `src/formats/lz.js` / `src/formats/chr.js` and verified by decoding every packed file and looking at the renders.

## Memory model `[STATIC]` (every segment immediate checked against the MZ relocation table)

`MICROU.EXE` never allocates memory: among its 87 `CD 21` sites there is no `AH=48h/49h/4Ah` (alloc/free/resize), no `4Bh` (exec) and no `42h` (lseek). Every file is read whole (`CX=FFFF`) or as one or two fixed-size sequential blocks into segments hard-wired by relocations:

| Ghidra segment | Role |
|---|---|
| `1000:0000–93BF` | code |
| `193C:0000–AE6F` | data; file buffers inside DS (labelled in Ghidra): `0DA8` settings, `195B` BRK (0x200), `1B5B` LEV (0x80), `1BDB` CHEATS (360), `1EAB` STRT_POS (144), `2963` MAP (0x800), `3163` COL (0x480), `35E3` DIR (0x900), `3EE3` 256-byte copy of the PR0 header, `3FE3` BITSFILE (0x6E00) |
| `2424:0000` | loadable-module slot: `FONT.BIN` first (far-called once), then overwritten by `DRIVERn.BIN` |
| `2B78:0000–7D78:0000` | the **328 KB asset arena** (`0x52000` bytes) |
| `7D78:0000–FFFF` | 64 KB work segment: packed input staged at `C000`, unpacked output at `0000`; palettes at `0000`/`0300`; `.CT` staging |
| `8D78:03E8` | stack |

## The codec — `DecompressWorkBuffer 1000:3333..3531` `[PROVEN]`

Byte-flag LZ. A control byte gives 8 flag bits, MSB first: 0 = one literal byte, 1 = an opcode. Opcodes (`v`, then any operand bytes `b`):

| `v` | Meaning |
|---|---|
| `80–FE` | short copy: `len = ((v>>5)&3)+2`, `dist = (v&0x1F)+len` |
| `FF` | end of stream |
| `70–7E` | incrementing run: `len = v-0x70+2` (`7F`: `b+2`, 0 → 256); each byte = previous + 1 |
| `60–6F` | reversed copy: `len = v-0x60+3` bytes read backwards starting at `out[n-b-1]` |
| `50–5E` | long copy: `dist = ((v-0x50)<<8) | b1` (`5F`: high byte from the stream), `len = b2+4`, source `n-dist-1` |
| `20–4F` | medium copy: `len = ((v-0x20)&0xF)+3`, `dist = (((v-0x20)&0x30)>>4)<<8 | b`, source `n-dist-2` |
| `10–1E` | RLE of the previous byte: `len = v-0x10+2` (`1F`: `b+0x11`) |
| `00–0E` | literal run: `len = v+8` (`0F`: `b+0x1E`, or `b==FF` → 16-bit length); **another opcode follows immediately**, no flag bit consumed |

Register stash via self-modifying `XCHG` at `CS:3544/3545`. `LoadCompressedSeries 1000:3547` (`SI` = name template, `DX` = destination segment) patches the last name character with `'0'+n`, opens (`AX=3DC0`), reads the whole file to `7D78:C000`, closes, decompresses to `7D78:0000`, copies `BX` bytes to `DX:0000`, advances `DX` by `0xC00` paragraphs (48 KB) and repeats until an open fails. Callers: `COMPRESS.PI0` → `2B78` (`InitLoadAssets 26c0`), `ROUNDnBR.PR0` → `2B78` (`LoadRoundPrSeries 45ef`), `ROUNDnBR.VH0` → `2B78` (`LoadRoundVh0AndSplit 4611`), `..\BITSFILE.PH0` → `2B78` (`LoadBitsFilePh0 482f`).

Verification: `npm run lz` decompresses all 41 packed files; the JS output is byte-identical to the workflow's independent Python transcription for all 41 (`[PROVEN]`), and the slab sizes are exactly what the memory layout predicts.

| File | Packed → unpacked |
|---|---|
| `COMPRESS.PI0–PI5` | → `0xC000` each; `PI6` → `0xA000` (total `0x52000` = the whole arena) |
| `BITSFILE.PH0` | 3611 → `0x65C0` (26048), copied to `DS:3FE3` every race |
| `ROUNDnBR.PR0` | → `0xC000`; `PR1` → `0xC000` or less; `PR2` the remainder — one contiguous per-round image placed at `2B78/3778/4378`, at most `0x20000` bytes (512 tiles): the world-map arenas at `4B78`/`5478` are built first (`InitRaceCarsFromTables 1000:448c`, called at `3932`) and the PR series loads after them (`3952` → `45ef`), so a longer bank would overwrite the map `[STATIC]`. (This row used to say `0x27D00`, which the layout does not allow; the largest shipped bank is round 1's `0x1FD00`.) |
| `ROUNDnBR.VH0` | `0x2400..0x3600` (round 9: `0x5DC0`), then split to `5D78:0000` / `6D78:0000` (`0x1440` / `0x1B00`; round 9 `0x3840` / `0x1F40`) |

## The arena and `chrDescriptorTable` `[PROVEN]` by render

`COMPRESS.PI0–PI6` are the arena `2B78..7D78` cut into 48 KB slabs and compressed — the dead dev tool `DumpAssetArenaToPaulDat 1000:2736` writes exactly that range to `Paul.dat`. The 18 members are described by `chrDescriptorTable` at `DS:0A14` (file offset `0xA254`): 20-byte records `{name[13], +0xD u16, +0xF u16, +0x11 frames u8, +0x12 segment u16}`, bound to sprite objects by `BindSpriteObjToChrDescriptor 1000:049c`. The "byte before each name" seen in `strings` output was the previous record's segment high byte.

**Dimension order is (height, width)**: `MINATURE.CHR` (16, 32, 38 frames) renders as clean 32×16 vehicle miniatures and `LOGO.CHR` (96, 248) as the 248×96 Micro Machines logo; the opposite reading shears both. Frames are consecutive row-major 8-bpp blocks; palette `INTRO.PAL`. `CASE.CHR` (6400 B) is 100 8×8 tiles and `CASE.MAP` (674 B) a 32×21 tile map of them, the vehicle display case (`UNKNOWN_case_chr_format`, closed in `docs/engine.md` §9ay, `[PROVEN]` by render).

| Member | w×h × frames | Arena offset | Content (looked at) |
|---|---|---|---|
| `FCHAPPY.CHR` | 48×48 × 22 | `0x00000` | 11 characters × 2 frames, happy |
| `FCSAD.CHR` | 48×48 × 22 | `0x0C600` | same, sad |
| `FCFROWN.CHR` | 48×48 × 11 | `0x18C00` | frowning |
| `FCNORMAL.CHR` | 48×48 × 14 | `0x1EF00` | neutral (+3 extra) |
| `THUMB.CHR` | 48×32 × 3 | `0x26D00` | fist, pointing hand, thumbs-up |
| `MINATURE.CHR` | 32×16 × 38 | `0x27F00` | vehicle miniatures in 4 colour sets |
| `BADGE.CHR` | 72×32 × 1 | `0x2CB00` | small winged badge |
| `CASE.CHR` | 8×8 × 100 tiles | `0x2D400` | the vehicle display case's tiles |
| `CASE.MAP` | 674 B: cols, rows, 32×21 tile indices | `0x2ED00` | the display case's tile map |
| `CUP.CHR` | 96×8 × 10 | `0x2EFB0` | the trophy in 10 horizontal strips (stack them: 96×80) |
| `INTRO.CHR` | 96×64 × 9 | `0x30D70` | nine vehicle-class vignettes |
| `WORDS.CHR` | 96×16 × 3 | `0x3E570` | "MicroMachines", "Head to Head", "Challenge" |
| `SELGAM.CHR` | 96×64 × 6 | `0x3F770` | select-game panels |
| `LOGO.CHR` | 248×96 × 1 | `0x48780` | the Micro Machines logo |
| `NOS.CHR` | 24×32 × 4 | `0x4E480` | numerals 1–4 |
| `FONT1.CHR` | 8×8 × 38 | `0x4F080` | `0-9 A-Z ! ?` small |
| `FONT2.CHR` | 8×16 × 38 | `0x4FA00` | `0-9 A-Z ! ?` tall |
| `FRAME.CHR` | 8×8 × 4 | `0x51630` | frame corner pieces |

`npm run chrtable` re-derives the table from `MICROU.EXE` and checks it against the hardcoded copy. `npm run render` writes one sheet per member to `tools/out/CHR_*.png`.

## Race-time reuse

Race loading (`SetupRaceLoadAllRoundFiles 1000:37fc`) overwrites the arena with `BITSFILE.PH0`, `VH0` and `PR0–2`; therefore `InitLoadAssets` (COMPRESS series + `DRIVERn.BIN` + `INTRO.PAL`) runs again after every race (callers `1000:11c7`, `1000:2182`). A port must treat the menu assets and the race assets as two loads of the same memory, not as one resident set.

## An encoder, for the level editor `[PROVEN]`

`src/formats/lzEncode.js` writes streams for this codec (the original compressor is not in the release). It emits only the opcode forms that occur in the 41 shipped files — a histogram of all of them found flag-0 literals, `80–FE`, `20–4F`, `50–5E`, `5F`, `10–1E`, `1F`, `60–6F` and the `FF` end byte, but no incrementing runs (`70–7F`) and only six short literal runs — and picks the cheapest parse by dynamic programming. Two edge cases are excluded by construction: a short copy of length 5 at distance 36 would encode as `FF`, the end marker, and a medium copy's high distance bits stop at 2 (`0x50` up is the long copy), so its reach is `0x301`, not `0x401`. `npm run editor` checks that it round-trips all 41 files through the decompressor (191,763 bytes against the shipped 216,137); it is not byte-identical to the shipped streams, which the editor passes through untouched when a slab is unedited.

Limits on a packed file the loader imposes (`LoadCompressedSeries 1000:3547`) `[STATIC]`: it is read with `CX=FFFF` to `7D78:C000`, so it must fit the segment's last `0x4000` bytes; it unpacks to `7D78:0000` and is copied to its slab with `SHR CX,1; REP MOVSW` (`35AB–35AF`), so its unpacked length should be even (256-byte tiles always are); and every slab but the last must be a full `0xC000`, since the next file's destination is always 48 KB further on (`35A7`).

