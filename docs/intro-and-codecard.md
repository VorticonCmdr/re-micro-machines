# The logo intro (`SM.EXE` + `GFX1.GFX`) and the code-card check (`FONT.BIN`)

Evidence tags as in `CLAUDE.md`. `SM.EXE` addresses are Ghidra program `SM.EXE` (image base `1000:0000`; file offset = image offset + 0x200). `FONT.BIN` offsets are file offsets, which equal segment offsets because `MICROU.EXE` loads the module at offset 0 of segment `2424`. Established by the research workflow's `sm-codecard` agent and re-verified here by porting its decoders to `src/formats/gfx1.js` / `src/formats/fontbin.js` and looking at `npm run render` output.

**Corrections to earlier claims.** `SM.EXE` is *not* the copy-protection check and the card screen is *not* text mode; the symbol grid is 8×8, not 9×8; `FONT.BIN` holds no font. The earlier CLAUDE.md attribution came from watching the screens without reading the code.

## `SM.EXE` — the Codemasters "Absolutely Brilliant!" logo `[PROVEN]` by render

- Entry `IntroEntryPoint 1000:0788`: allocates two 64000-byte blocks, loads `gfx1.gfx` (whole file, 54273 B) and `antifont.bin` (asks for 13013 B) with `LoadWholeFileToSegment 1000:0d63` (`INT 21h AX=3D02` / `AH=3F` / `AH=3E`, no error handling), hooks INT 9 with a 13-byte scancode grabber, checks for VGA (`INT 10h AX=1A00`, `BL=7`) and sets **mode 13h** (`SetVideoModeIfVga 1000:0d46`, `VideoModeByte` image 0x36A = 0x13), uploads `DacPalette256` (image 0x36C, 256×RGB 6-bit, via `INT 10h AX=1012h` in `SetDacPaletteBlock 1000:0d32`).
- `RunIntroMainLoop 1000:097f`, once per vsync (`3DA` bit 3): `DrawNextLogoRecord 1000:0bb3` draws one record of `LogoRecordTable` (image 0x1E, **48 records × 14 bytes**: `x = w0 + w1`, `w2` unused sprite index, `y = w3`, `src = w4`, `w = w5`, `h = w6`) per frame and stays on the last; `SlideBannersTogether 1000:0b83` moves banner A (`0xA804`, 176×36, from x = −208) right and banner B (`0xC174`, 176×26, from x = 368) left by 8 px/frame until A reaches `SlideStopX` = 0x48 (35 frames); then a diagonal "shine" band (`BrightenShineBandDiagonal 1000:0a48` / `DimShineTrailDiagonal 1000:09f8`: +0x10 / −0x10 on palette indices along a 70-row diagonal, 8 px/frame from x = 72 to 312); 250 frames after the shine (`TickExitTimeoutAfterShine 1000:0aac`) or on a mouse button (`INT 33h AX=3`) it exits.
- `BlitSpriteToScreen 1000:0ccc`: descriptor `+0 x, +2 y, +4 w, +6 h, +8 seg, +A ofs`; horizontal clipping only (`ClipSpriteHorizontal 1000:0c24`); per row `w/2` words `ES:[SI] → A000:[y*320+x]`, `SI += w` (stride = width), opaque.
- Exit: `MOV AX,0Eh; INT 10h` (mode 0Eh!) then `MOV AH,4Ch; INT 21h` with **AL never set** — the exit code is garbage and nothing reads it (`MICRO.COM` never calls `AH=4Dh`; it only tests CF/BX after each EXEC). There is **no handshake** between `SM.EXE` and `MICRO.EXE`; `UNKNOWN_sm_handshake` is closed. **`UNKNOWN_intro_live_timing` resolved (M3.30, 2026-09-23, `[PROVEN]` live):** a memory-write breakpoint on the BIOS current-video-mode byte (`0040:0049`) plus the BIOS tick counter (`0040:006C`, a fixed 18.2 Hz clock, immune to tool round-trip latency since the CPU is genuinely frozen at each breakpoint hit) timed the real boot chain exactly: mode 13h set (intro start) at tick 574672, mode 0Eh set (`SM.EXE`'s own exit, confirming the byte sequence above fires for real) at tick 574758 — **86 ticks = 4.72 s real intro duration** — then mode 10h (`FONT.BIN`'s code-card screen) at tick 574761, only 3 ticks (~0.16 s) later, confirming `MICRO.EXE`'s own startup and `FONT.BIN`'s load are both effectively instant once `SM.EXE` hands off. The exit-code half of the question needs no live check beyond what's already established above: `AL` is provably never written before the `INT 21h AH=4Ch` call and provably never read by the caller either way, so there is nothing for a live capture to add.
- `antifont.bin` `[STATIC]`: expected to be a proportional 8-bpp font, 91 glyph cells × 143 B (11×13 px), glyph order and advance widths in `CharWidthTable` (image 0x6CF: 91 `(char, width)` pairs, FFFF-terminated, `' ' ! ` 0x9C $ % & ' ( ) * + , - . / 0-9 : ; < = > ? # A-Z [ \ ] ^ _ ` a-z`). It would draw "(c) Codemasters 1994." centred at y = 180 and a hidden A+B build stamp at y = 160. The shipped file is 0 bytes, so the read returns nothing and the uninitialised block is blitted — invisible in practice (`UNKNOWN_antifont_empty` closed: harmless).

### `GFX1.GFX` format `[PROVEN]` (decoder: `src/formats/gfx1.js`)

Uncompressed 8-bpp indexed sprite pack, no palette, no directory; 4-byte header `00 01 6B EC` never read. **`UNKNOWN_gfx1_header`: closed as irrelevant in `docs/engine.md` §9cf (nothing reads the four bytes); what they encode stays unknown.** The M3.30 investigation (2026-09-23): "never read" re-confirmed exhaustively (traced `LoadGfx1File 1000:0bef`'s call to `LoadWholeFileToSegment`, checked every instruction touching the loaded buffer's low offsets, and confirmed `LogoRecordTable`'s own 48 blit-source offsets are all ≥4, so offsets 0–3 are structurally unreachable as a blit source anywhere in `SM.EXE`). Tried and ruled out: a version-number reading (no other asset file format in this project — `.PAL`, the LZ-packed banks, `.CHR` — has a comparable discrete header field to corroborate the pattern against) and several checksum/length hypotheses over the remaining 54269 bytes (byte-sum mod 0x10000, XOR, 16-bit word sum in both byte orders, CRC-16 CCITT/ARC/MODBUS-style, CRC-32, Internet-checksum-style folding, and the body/file length in hex) — none produced `0x6BEC` or `0xEC6B` in either byte order. No consumer, no matching checksum, no comparable external pattern: closes this pass as investigated-and-still-open rather than re-derivable later without new information (e.g. the original asset-packaging tool). Row-major `w×h` blocks, stride = width:

| Offset | Size | Content |
|---|---|---|
| `0x0004 + n·0x400`, n = 0..28 | 32×32 | letter frames of "Codemasters" (3–4 zoom-in frames per letter; n = 0, 1 are thin first-frame slivers shared by several letters) |
| `0x7800`, `0x8400`, `0x9000`, `0x9C00` | 64×48 | swoosh frames (the pink/purple "TM" mark) |
| `0xA804` | 176×36 | banner "Absolutely" (row 37 nearly empty, not drawn) |
| `0xC174` | 176×26 | banner "Brilliant!" |
| `0xD354`–`0xD3FF` | — | zeros; `0xD400` = `0x1A` |

Palette: `SM.EXE` file 0x56C, 256×RGB, 6-bit (`& 0x3F`; entries 1 and 0x19 hold 255 → 63 = white). `composeLogoScreen()` reproduces the finished frame; `npm run render` → `tools/out/GFX1_logo_screen.png` shows "Codemasters ™ / Absolutely / Brilliant!" exactly as in the DOSBox intro.

## `FONT.BIN` — the code-card copy protection `[STATIC]`, graphics `[PROVEN]` by render

- Loaded by `LoadAndRunFontBinCodeCard` (`MICROU.EXE 1000:31f0`): `INT 21h AX=3DC0` on `DS:1241` = `"FONT.BIN"`, read up to 0xFFFF bytes into `2424:0000`, close, `XOR AX,AX; CALLF 2000:4240` (Ghidra's relocated view of `2424:0000`). Returns **AX = 0 on pass, 0xFFFF on fail** after restoring text mode 3 itself. `real_entry 1000:0009 OR AX,AX / 000B JZ / 000D JMP 1000:00C6` → `MOV AX,4C00; INT 21h`: on failure the game silently exits to DOS (`UNKNOWN_startup_check_31f0` closed). The same segment is reused right afterwards by `LoadSoundDriverBinModule 1000:321c` for `DRIVERn.BIN`, so `FONT.BIN` runs exactly once.
- The module sets **mode 10h** (640×350×16), prints the trilingual text with `INT 10h AH=13h` (BIOS 8×14 font — hence the text-mode look), draws the symbol strip into an off-screen page at `A000:8000` with a planar transparent blit (+0x4D4/+0x4F7; GC regs 3/5/8, sequencer map mask), and copies it to the visible page with VGA latches (+0x5B3: write mode 1, 162 rows × 25 bytes to `A000:380B` = pixel (216,179)).
- Question: column = `BDA 40:6C & 0xF` (0..15, shown as `'A'+col`), row = `(40:6C >> 3) & 0xF` (shown as `row+1`) — a direct read of the BIOS tick counter (+0x190), not `INT 1Ah`. Expected symbol = `card[row*16 + col]` from the **16×16 card table at +0x68CC** (selected through an 8-word pointer table at +0x68BA by the entry `AX`; entries 1–7 all point at 0x69CC = end of file, so only card 0 exists). Cursor: arrow keys via `INT 16h`, cell pitch 20×18 px with reading-order wrap (+0x1E9..+0x2F1); ENTER computes `DL = cursor_row*8 + cursor_col` (+0x2F4..+0x33B) and compares with the expected value (`CMP AL,DL`).
- **Why any answer passes in this copy (`UNKNOWN_codecard_neutralised` closed):** both compare sites are byte-patched. `+0xA8..+0xB1` = `E8 E5 00 8A C2 EB 54 90 90 90` (`CALL +0x190; MOV AL,DL; JMP +0x103` → straight to "Correct. Now one more…"); `+0x137..+0x140` = `E8 56 00 8A C2 90 90 90 90 90` (`MOV AL,DL` + NOPs → falls into the success epilogue `XOR AX,AX; RETF` at +0x141). The only intact compare (`3A C2 74 16` at +0xE9) sits inside the now-unreachable "Sorry, that was the wrong symbol" retry block (**+0xB2**..+0x102 — corrected below, not +0xB0), and the second fail epilogue (+0x168..+0x18F) is unreachable too. `patchState()` in `src/formats/fontbin.js` reports this.

  **`UNKNOWN_codecard_pristine_bytes` resolved (M3.30, 2026-09-23), `[STATIC]`, high confidence for both sites, from control-flow inference rather than a recovered original binary:** both sites share the `CALL 0x190; CMP AL,DL; <Jcc rel8>; <padding>` idiom the intact `+0xE9` site still shows byte-for-byte (`E8 xx xx 3A C2 7x xx` + NOPs to a fixed 10-byte window). **Site 1 (+0xA8..+0xB1) pristine: `E8 E5 00 3A C2 74 54 90 90 90`** — the patch only flipped two opcode bytes in place (`3A→8A`, `74→EB`) and kept the original displacement (`0x54`), so the target (`0xAF+2+0x54 = 0x103`) is confirmed twice over: once by the patch's own forced `JMP +0x103`, once independently by the intact `+0xE9` site's own `JZ` to the same `0x103` label ("Correct, now one more..."). Minor correction to the paragraph above: the intact site's own fall-through (compare fails) lands at **`0xB2`**, not `0xB0` — `0xE9`(CALL,3B)+`0xEC`(CMP,2B)+`0xEE`(Jcc,2B)=`0xB2`, with the `+0xB0`/`+0xB1` bytes in this document's own citation actually belonging to the 10-byte window's own trailing NOPs, not patch slack. **Site 2 (+0x137..+0x140) pristine: `E8 56 00 3A C2 75 2A 90 90 90`** — a same-sense `JZ` is impossible here (the patched fall-through already reaches the verified-pass epilogue at `0x141`, so a `JZ` there would make both branches pass, a dead compare nobody would ship); the condition must originally have been inverted (`JNZ`, jump away only on a WRONG answer), landing on the otherwise-completely-unreferenced second fail epilogue at `0x168` (byte-identical sibling of the first, confirmed by a full-file scan to have no other referrer anywhere) — `rel8 = 0x168 − 0x13E = 0x2A`.

### Embedded graphics `[PROVEN]` (decoder: `src/formats/fontbin.js`)

Mode 10h planar bitmaps: 4 consecutive planes of `bytesPerRow × rows`, MSB first, plane p = bit p.

| Offset | Layout | Content |
|---|---|---|
| `0x256A` | 4 B/row × 22 rows → 32×22 | cursor: rounded white frame (index 0 transparent) |
| `0x26CA` | 26 B/row × 162 rows → 208×162 | the framed **8×8 grid of 64 symbols** (ink = index 15, frame = 14, background 13, shadow 15) |
| `0x689A` | 16 B | attribute-controller palette (rgbRGB) in force while the screen shows; `0x68AA` the initial all-dark one |
| `0x68BA` | 8 words | card pointer table (`68CC 69CC 69CC …`) |
| `0x68CC` | 256 B | **the physical code card**: `card[row][col]`, columns A–P, rows 1–16, values 0..63 = row-major symbol index |

Measured from the decoded strip (ink column centres 30, 50, …, 170; row centres 12, 30, …, 138): cell (0,0) starts at strip-relative (20, 3), pitch 20×18. **`UNKNOWN_codecard_cursor_origin` resolved (M3.30, 2026-09-23), `[PROVEN]` live for the practical question, mechanism `[STATIC]`:** booted a fresh DOSBox session to the real code-card screen and screen-captured the cursor around cell (0,0) directly — the white cursor frame visibly and correctly encloses the first symbol (the triangle) with no half-cell offset or straddle onto a neighbour, so whatever the exact numbers are, there is no live rendering bug. Cropping at the naive strip-relative computation (`216+20, 179+3 = 236,182`) lands well inside the cell's own interior (past the cursor's white border entirely), while a series of narrowing crops puts the cursor sprite's own top-left corner at approximately `(220-228, 179-182)` — close to the pre-existing "documented cursor start (226,181)" citation, not the computed `(236,182)`. The likely mechanism, self-consistent with both the live pixel measurement and the embedded-graphics table below: the **cursor sprite itself is 32×22** (see `0x256A` below), strictly larger than the 20×18 cell it highlights, so it is drawn *centred* on the cell rather than corner-aligned — top-left `= cell_top_left − ((32−20)/2, (22−18)/2) = (236−6, 182−2) = (230,180)`, within a few pixels of the documented `(226,181)` and consistent with the live-measured range. The residual few-pixel gap between this centring formula and the live/documented figures is not chased further (would need the cursor-draw call's own exact disassembled offset math, not just its target coordinates) — but the practical question ("does the cursor correctly land on the right symbol") is answered: yes, confirmed live. `cardImage()` renders the whole card (`tools/out/FONT_BIN_codecard.png`).

Card 0, rows 1–16 (top to bottom), columns A–P:

```
 1:  1 39 23 61 19 50 63 55 32 42 13 61 15 43 46 60
 2: 60 56 31 50 17 34 49 29 58 34 60 25 59 59 36 25
 3: 36 12 25 12 31 45  9 19 29 21  4 29 31 60 18 54
 4: 24 21 19 35 13 12 48 14 23 36 28  2 35 19 36 60
 5: 18 62 16  5 30 56 23 30 21 28 …
```
(the full table is in the viewer's FONT.BIN page and in `cardTable()`).

## Consequences for the port

- The intro is fully reproducible from `GFX1.GFX` + `SM.EXE`'s tables (48 records, two sliding banners, the shine). Optional for the port, cheap to include.
- The code-card gate is a startup module with no game state; the port can present the same prompt using the card table and symbol strip, or skip it. Nothing downstream depends on it.
- `SM.EXE` leaves the machine in mode 0Eh; `MICRO.EXE` sets mode 13h itself, so there is no palette or screen state carried over.

## The real per-frame animation and its real skip input (P1, GOAL-DOS-PARITY.md, 2026-09-24) `[STATIC]`

Full re-disassembly of `RunIntroMainLoop 1000:097f` and every function it calls (`re/SM.EXE.lst`),
done for the port's P1 item ("port the animation with its real timing and its real skip input...
don't assume 'any key'"). Ported in `src/formats/gfx1.js` (`introInitialState`/`introStep`, full
derivation in that file's own header comment) and wired into `src/frontend/flow.js`'s `LOGO`
phase; proven in `tools/check-intro.mjs` (`npm run intro`). `flow.js`'s own session object also
exposes `forceIntroSteps(n, input)` (`play.js`'s `forceSteps` precedent, CLAUDE.md rule 7): a
Chrome tab that loses OS focus during an automated `wait` throttles `requestAnimationFrame` down
to a handful of calls a minute (observed live verifying this very item), so a real per-frame
timeout can't be waited out in that environment -- `forceIntroSteps` drives `introStep` directly,
bypassing the real-time accumulator, and was how the 314-iteration timeout, the mouse-click skip,
and the A+B hold were each re-confirmed live in `game.html`, on top of the headless check.

**One iteration = one VGA vertical-retrace wait** (port `0x3DA` bit 3, real mode-13h hardware
vsync, ~70 Hz — a different clock from the 70.06 Hz IRQ0 driver tick this project uses elsewhere;
`SM.EXE` never touches IRQ0). Per iteration, in order:

1. `TickExitTimeoutAfterShine 0aac` — once the shine is done (`[0x6cd]`), increments the post-shine
   hold counter `[0x6ba]`; at 250 (`0xfa`) sets the exit-timeout flag `[0x6b8]`.
2. `DrawNextLogoRecord 0bb3` — blits `LogoRecordTable`'s current 14-byte record (opaque), then
   advances to the next of the 48, staying (and re-blitting) on the last once reached.
3. `SlideBannersTogether 0b83` — while the slide is still active (`[0x6c3]==0`), moves banner A
   +8px and banner B −8px, redraws both, and once A reaches `SlideStopX` (`0x48`=72) sets
   `[0x6c3]`, ending the slide (and its own redraws) for good — banner A starts at x=−208, y=80;
   banner B at x=368, y=120 (both `smDescriptor`-read, not guessed).
4. `FUN_1000_0ac6` — **the one real, if obscure, keyboard effect this intro has.** Reads two
   flags a 13-byte `INT 9` hook (`CS:0xcbf`: `PUSH AX; IN AL,60h; MOV [0x362],AL; MOV AL,0x20;
   OUT 20h,AL; POP AX; IRET`) keeps current from raw scancodes (0x1E/0x9E toggle a held-A flag,
   0x30/0xB0 a held-B flag; `09d0`, folded into a single `abHeld` boolean in the port, which is
   behaviourally identical to the real single-byte-latch-plus-two-flags mechanism it mirrors,
   since both are just a level check sampled once per iteration). **Not both held:** clears screen
   rows 159–177 (`0xc6c0` = row 159 col 0, `0xbe0` words = 19 rows) — checked against this shipped
   `GFX1.GFX`: every one of the 48 records (rows 26–74), both banners (rows 80–145) and the
   shine's own row range (80–149) sit entirely above row 159, so this clear has no visible target
   here and is not reproduced (verified, not assumed). **Both held:** skips that clear, forces the
   250-frame hold counter `[0x6ba]` to 0 on every iteration held (holding A+B through the
   post-shine hold keeps the intro open indefinitely; releasing restarts the 250-frame count from
   0), and draws a "hidden build stamp" from `ANTIFONT.BIN` once — which, being the same 0-byte
   shipped file the copyright text already draws nothing from, draws nothing here either. **Key
   presses otherwise do nothing at all**: the `INT 9` hook sends its own EOI and never chains to
   the BIOS ISR, so a keystroke never reaches the BIOS keyboard buffer, `FONT.BIN`, or anything
   else — it is fully consumed by this one hook. `UNKNOWN_intro_key_effect` closed.
5. The shine (`BrightenShineBandDiagonal 0a48` / `DimShineTrailDiagonal 09f8`), once the slide has
   stopped and the shine itself isn't done: Bright draws an 8-pixel-wide, 70-row diagonal strip
   (row `r`'s strip at column `x−r`, no clipping — the real bytes can bleed a couple of columns
   into the row above at the sweep's own edges, reproduced as-is) at the current x (`[0x6c7]`,
   init 72), then advances x by 8 (done at x=312, 30 calls); Dim repeats the identical diagonal
   formula at `x−32` (4 bands behind), but only once the bright-call counter (`[0x6cb]`, caps at
   8) reaches 6. Because Dim's own x always equals some earlier Bright x exactly, dimmed bands
   cancel their own brightening pixel-for-pixel — except the first 2 bands (x=72,80) and the last
   3 (x=288,296,304), which Dim's `≥6`-gated, `−32`-offset window never reaches (`i∈[2,26]` are
   the only bands Dim ever revisits, of 30 total) — so those 5 bands are left **permanently**
   brightened by `+0x10`, mod 256, every iteration onward, since nothing ever redraws the banners
   after the slide stops. `tools/check-intro.mjs` proves this exactly: it re-derives the shine's
   own net per-pixel delta independently, and requires the real run's final screen to equal
   `composeLogoScreen()` (still fully correct for the pre-shine, at-rest frame) plus that delta,
   mod 256, at every pixel the shine ever touched.
6. The vsync wait itself, then the exit checks — **a mouse click always wins**, checked *before*
   the timeout flag, every single iteration: `INT 33h AX=3` (a level check, not an edge), and only
   if that doesn't fire does `[0x6b8]` get checked.

**Total, no input:** 48-record reveal (1/iteration, holds after) + a 35-iteration banner slide,
with the shine starting on that same 35th iteration and running 30 more (ending iteration 64) +
a 250-iteration post-shine hold = **314 iterations**, `[STATIC]`, directly counted from the
constants above (`-208` to `72` at 8px/iteration = 35; `72` to `312` at 8px/iteration = 30; the
`0xfa`=250 hold). At the real ~70 Hz vsync rate this is ≈4.49 s. `UNKNOWN_intro_live_timing`'s own
existing `[PROVEN]` M3.30 figure (4.72 s, mode-13h-set to mode-0Eh-exit — the *whole* `SM.EXE`
run, not just the loop) is ~0.23 s more: that window also includes the pre-loop setup (VGA/mouse
detection, the two file loads, the one-time copyright-text draw) which this session did not
separately time, so the two figures are not in conflict — one measures a superset of the other's
span — but the gap itself is not chased further this session (a new, narrower, genuinely open
question, `UNKNOWN_intro_loop_vs_total_gap`, not blocking: the port paces the loop at the real
vsync rate, which is the faithful choice regardless of how that pre-loop gap eventually resolves).

## The real code-card screen (P1, GOAL-DOS-PARITY.md, 2026-09-24) `[STATIC]` + `[PROVEN]` (live)

Full re-disassembly of FONT.BIN from scratch (`ndisasm -b16 game/FONT.BIN`, this session -- not
the prior "symbols + cursor + patch sites" pass above), live-confirmed in DOSBox. Ported in
`src/formats/fontbin.js` (the "code-card SCREEN" section, full addresses in its own header
comment) and wired into `src/frontend/flow.js`'s new `CODECARD` phase; proven in
`tools/check-codecard.mjs` (`npm run codecard`).

**Glyphs.** The screen's text is drawn with `INT 10h AH=13h`, letting the BIOS render it with its
own built-in 8x14 ROM font -- FONT.BIN never embeds glyph bitmaps for it. That font isn't in any
shipped game file, so with the user's explicit approval (2026-09-24) it was captured live instead:
once FONT.BIN sets mode 10h, the `INT 43h` vector at `0000:010C` points at the active 8x14 font
(`C000:09F5` this DOSBox session -- read the vector fresh each time, it is not guaranteed fixed
across builds); a `mem_read` of 3584 bytes (256 glyphs x 14 rows) from there is the whole table,
committed as `src/data/bios-font-8x14.js` (platform data, not game data -- the same table sits in
ROM on every real EGA/VGA card of the era).

**Screen layout, `[STATIC]` by disassembly.** Mode 10h, 640x350, entered by `call 0x33c` (which
also blanks the palette to all-black via 16 calls to `AH=10h AL=0`). Two flat colour fills happen
before anything else draws: `0x3bc` (rows 0-167, colour 9 -- `CX=0x1A40` words = 168 scanlines at
80 bytes/row) and `0x3c6` (rows 172-347, colour 10 -- `CX=0x1B80` words = 176 rows from
`DI=0x35C0` = row 172). Rows 168-171 and 348-349 are never explicitly written by either fill;
mode 10h's own `INT 10h AX=0x10` mode-set already zeroes the buffer, so they stay colour 0. Both
fills go through `0x385`, which sets GC5=2 (write mode 2) before `rep stosw` -- with `BH=BL` in
both callers (`0x0909`/`0x0A0A`) this is a plain flat fill, not a pattern.

**Symbol grid.** Drawn once, off-screen (`A000:8000`, via the generic planar blitter `0x4D4`/
`0x4F7`, which computes the VGA byte offset as `Y*80 + X/8 + [page offset]` -- independently
re-derived and cross-checked against the existing `docs/track-graphics.md`-class blit convention),
then copied to the visible page at `(216,179)` by `0x5B3` -- confirmed exactly from the copy's own
target address (`DI=0x380B` linear = row 179, col 216). That copy only moves 25 of the strip's 26
bytes/row (`rep movsb` with `CX=0x19`): **200 of the real 208 pixel columns reach the screen**.
Checked against the actual decoded strip this session (not assumed): columns 200-207 hold 648
non-zero (real ink) pixels, so this crop is a genuine, reproducible original-game effect, not a
safe truncation to skip -- the port crops its own render to the same 200px width. **CORRECTED 2026-09-26 (`docs/engine.md` §9dp):** a pixel-exact live capture shows strip columns **8-207** (not 0-199) at X 216-415, the strip's colour 0 transparent over the off-screen background (colour 10), only 161 of its 162 rows, and the cursor sprite also 8 px left of its nominal X. With these the screen is 0 px off the capture (`npm run front`). The mechanism inside `0x4D4`'s shifted blit is not traced.

**The target column/row (`1000:0190`).** `AL = [0040:006C]` (the BIOS tick counter's own low
byte, free-running, not `INT 1Ah`); `column = AL & 0xF` (0-15, shown as `'A'+column`), `row =
(AL>>3) & 0xF` (0-15, shown as `row+1`, 1-16 -- bit 3 is shared between the two fields, a real
correlation). `0x2F4-033B` looks the answer up: `AL = card[targetRow*16 + targetCol]` (the
expected symbol) and `DL = cursorRow*8 + cursorCol` (the player's own chosen cell -- since the
8x8 on-screen grid is the strip drawn in its natural, unshuffled order, cell `(r,c)` always shows
symbol `r*8+c`). The compare (`CMP AL,DL`) is one of the two patched sites this document's own
"Why any answer passes" section already covers, so it never actually gates anything in this copy
-- but the DISPLAYED "COLUMN x and ROW y" text is genuinely live, re-read fresh every round.
**Live-confirmed** (this session): booting fresh showed "COLUMN A and ROW 15"; a second boot
showed "COLUMN G and ROW 7"; within one boot, round 1 showed "COLUMN G and ROW 7" and round 2
(same boot) showed "COLUMN F and ROW 1" -- a fresh read each round, not cached.

**Text.** Three trilingual paragraphs (English/French/German stacked, CP437, no CR/LF -- the
whole block is a flat 12-row x 80-column, 960-byte teletype write that wraps at column 80, which
is why 960 = 12x80 and the block boundaries abut exactly: welcome `0x67F`, "wrong symbol"
(unreachable in this patched copy) `0xA3F` = `0x67F+0x3C0`, "Correct, now one more" `0xDFF` =
`0xA3F+0x3C0`). `AH=13h`'s `BL` in a graphics mode XOR-combines instead of overwriting when its
top bit is set (a documented real BIOS behaviour): `BL=0xFF` for the paragraph text and `BL=0xF8`
for the target overlay, against background colour 9, give `9^0xF=6` (paragraph ink) and `9^0x8=1`
(overlay ink) -- both colours visually confirmed against the live DOSBox capture (blue background,
lighter-blue/white text, a third shade for the "COLUMN x"/"ROW y" values). The target
column-letter and row-digits get poked into the SAME three fixed slots regardless of language,
once per language (English row1 col7/17/18, French row5 col41/59/60, German row9 col10/22/23) --
the row's tens digit is skipped entirely when `row+1 < 10` (`0x43C`'s own `JZ`), confirmed live
(round 1's "ROW 7" showed one digit; round 2's "ROW 13" showed two).

**Cursor.** Persistent pixel position (`[cs:0x2558]`/`[cs:0x255a]`), never reset between accept
rounds -- **live-confirmed**: moving the cursor during round 1, accepting, and watching the
"Correct, now one more" interstitial and then round 2 both showed the cursor still at round 1's
own position. Starts at `(226,181)` = cell `(0,0)`. The 4-direction wrap (`1000:01E9-02EE`, all
four branches read in full) is NOT uniform: RIGHT/LEFT wrap in reading order (past the last column
of a row moves to the next/previous row's first/last column; past the last/first row wraps to the
first/last row) -- but **UP/DOWN wrap column-major instead** (past the top/bottom row of a column
moves to the bottom/top of the PREVIOUS/NEXT column, and past the first/last column wraps the
column too). **Live-confirmed**: RIGHT then DOWN from `(0,0)` lands on cell `(1,1)`, matching the
reading-order half exactly. The column-major half of UP/DOWN was caught by an advisor review
(a first draft of this section had it wrong, defaulting to the same reading-order wrap as
RIGHT/LEFT) and re-verified directly against the bytes before porting.

**The two-round flow.** `call 0x190` runs the whole draw-target/draw-text/draw-cursor/read-input
sequence and is called twice (`0xA8` for round 1, `0x137` for round 2), both patched to
unconditionally "pass". Round 1's own success (`0x103-0x136`) shows "Correct, now one more just to
check that it wasn't a fluke." (`0x11D`, `bp=0xDFF`) and waits for ANY key (`0x133`, `AH=0;INT
16h` -- not specifically ENTER) before starting round 2. Round 1's own clear (`0x118-0x11A`, the
SAME `0x3bc` plane-fill as the very first screen) only touches rows 0-167 -- **live-confirmed**:
the grid and the round-1 cursor stayed visible under the "Correct" text in the actual DOSBox
capture. Round 2's own success falls straight through to the mode-3/`retf` epilogue (`0x141`) --
no second interstitial, no second wait -- **live-confirmed**: pressing ENTER on round 2 went
straight to GAME OPTIONS.

**Consequences for the port.** `src/formats/fontbin.js` exports `moveCursor`/`targetFromTickByte`/
`expectedSymbolAt`/`cursorCellIndex`/`composeCodeCardScreen`, all pure and DOM-free (matching this
project's engine-module convention); `flow.js`'s `CODECARD` phase owns the two-round state machine
and the 640x350xy canvas resize (painted with `aspect43: true`, `src/render/raster.js`'s own
already-existing-but-previously-unused option, for mode 10h's non-square pixels on a real 4:3
screen). The target's own "BIOS tick counter" non-determinism is reproduced with a real elapsed-
time read (`performance.now()` at ~18.2 Hz), the same "as non-deterministic as the original"
approach this project already uses for `DS:0002`-derived choices elsewhere (tournament.js's own
header, docs/engine.md). Since both compare sites are patched in this copy, the port never
computes or checks the real answer either -- ENTER always advances, matching the shipped binary
exactly (not a simplification -- copying what the bytes actually do).

## Open items

Resolved 2026-09-23 (M3.30, this session — see the sections above for full derivations): `UNKNOWN_codecard_pristine_bytes` (both patch sites' original bytes inferred with high confidence from the intact `+0xE9` site's own idiom and the function's control flow; a minor `+0xB0`→`+0xB2` citation correction found along the way), `UNKNOWN_codecard_cursor_origin` (live capture confirms no rendering bug — the cursor correctly frames cell (0,0); the numeric discrepancy is most likely the cursor sprite being centred on the cell rather than corner-aligned, since the cursor graphic (32×22) is larger than the cell (20×18)), `UNKNOWN_intro_live_timing` (live-timed via a BIOS-tick-counter breakpoint, immune to tool-latency overshoot: 4.72 s real intro duration, mode-13h-set to mode-0Eh-exit; +0.16 s more to the code-card screen; the exit-code half needed no live check, already settled by existing static analysis).

Resolved 2026-09-24 (P1, this session — see "The real per-frame animation" above): `UNKNOWN_intro_key_effect` (no key skips the intro; only a mouse click does, or the 250-iteration post-shine timeout; holding A+B together is the one real keyboard effect, holding the timeout open).

**Closed as irrelevant (`docs/engine.md` §9cf): `UNKNOWN_gfx1_header`, never read; a DOS-time reading (13:31:24) matches no archive stamp either.** Previously: still open, investigated and not further resolvable without new information: `UNKNOWN_gfx1_header` (exhaustively re-confirmed unread; version-number and several checksum hypotheses tested against the real file bytes and ruled out — see the `GFX1.GFX` section above).

New, narrow, not blocking: `UNKNOWN_intro_loop_vs_total_gap` (the ~0.23 s between the loop's own derived 314-iteration/~4.49 s duration and the M3.30 whole-process 4.72 s figure — plausibly the pre-loop setup, not independently timed; would need a fresh live session bracketing the loop itself, e.g. breakpoints at `CS:097F`'s first hit and `CS:07C6`'s own `RET`, reading `0040:006C` at each, the same technique M3.30 used).

Resolved 2026-09-24 (P1, this session — see "The real code-card screen" above, fresh from-scratch disassembly plus a live DOSBox session): the screen layout (background bands, the symbol grid's own 200-of-208-column crop, colours via the `AH=13h` graphics-mode XOR), the target column/row formula and its live non-determinism, the trilingual text block layout and the column-letter/row-digit overlay positions, the exact 4-direction cursor wrap (RIGHT/LEFT reading-order, UP/DOWN column-major — corrected mid-session after an advisor review caught a first draft defaulting UP/DOWN to the same reading-order wrap as RIGHT/LEFT), and the two-round flow (the "Correct, now one more" interstitial only clearing rows 0-167, the cursor persisting across rounds, round 2 having no second interstitial). Also newly closed: the BIOS 8×14 glyph source (captured live from DOSBox's own `INT 43h` vector, committed as `src/data/bios-font-8x14.js` with the user's explicit approval, 2026-09-24).

New, narrow, not blocking: `UNKNOWN_codecard_pixel_diff` (this session's own render was cross-checked visually against several live DOSBox captures — screenshots, not persisted as reference files — and matches exactly to the eye, but a true byte-exact pixel diff needs raw indexed VRAM, which requires reading and combining all 4 of mode 10h's planar bit-planes rather than the single flat `mem_read` that worked for mode 13h's linear framebuffer elsewhere in this project (`tools/refs/race_R21_a000.bin`); left for Part F, which does this properly for every static screen at once).
