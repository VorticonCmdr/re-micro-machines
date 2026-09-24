# Boot chain and runtime environment

Evidence tags as in `CLAUDE.md`: `[PROVEN]` observed live / executed, `[STATIC]` read from bytes or Ghidra disassembly, `[UNKNOWN]` not established. Ghidra addresses are in the `mm` project's `1000:`-based space (image base `1000:0000`, `DS = 193C`).

## Launch chain `[PROVEN]`

1. `MICRO.COM` (472 B) shrinks its memory block (`INT 21h AH=4Ah`), then `EXEC`s `SM.EXE` and, if that returns without an EXEC error, `EXEC`s `MICRO.EXE`. It restores `SS:SP` around each call, sets text mode 3 afterwards and exits. (`ndisasm -b16 -o 0x100 MICRO.COM`; the EXEC parameter block is at `0x24D`, filenames at `0x239`/`0x240`.)
2. `SM.EXE` is the Codemasters **"Absolutely Brilliant!" logo intro** (mode 13h; `GFX1.GFX` + its own tables; ends after a timeout or a mouse click; exit code unread). See `docs/intro-and-codecard.md`.
3. `MICRO.EXE` (PKLITE-packed; analysed as the unpacked `MICROU.EXE`) first loads and runs **`FONT.BIN`, the code-card copy-protection module** (mode 10h): three-language prose ("Look at the symbol where COLUMN B and ROW 5 meet…") above an 8×8 grid of 64 symbols; cursor keys move a frame, ENTER confirms; a correct answer is followed by "Correct. Now one more just to check that it wasn't a fluke." and a second prompt.
   - **In this copy, ENTER on the default (top-left) cell was accepted for both prompts** (COLUMN B/ROW 5, then COLUMN O/ROW 6) `[PROVEN]` — because both compare sites in `FONT.BIN` are byte-patched (`[STATIC]`, `docs/intro-and-codecard.md`). On a genuine failure the module returns 0xFFFF and `real_entry` exits to DOS silently.
4. `MICRO.EXE` then shows **GAME OPTIONS** in VGA mode 13h: `F1 PLAYER 1 CONTROL … KEYS 2`, `F2 PLAYER 2 CONTROL … KEYS 1`, `F3 SOUND … BLASTER`, `F4 SMOOTHNESS … HIGH`, `F5 REDEFINE KEYS`, `F6 CREDITS`, footer "USE ESCAPE TO QUIT GAME / PRESS RETURN TO PLAY GAME / SPACE PAUSES IN GAME". (`F7 CONFIGURE JOYSTICK` exists as a string but was not on screen with this `SETTINGS.DAT`.)

DOSBox recipe: `bridge_start` → `drive_mount C /Users/valentin.pletzer/Downloads/dosgames/mm/game` → `input_type "C:\rMICRO\r"` → wait for the code-card text → ENTER, ENTER → options screen. ESC quits to DOS.

## `MICROU.EXE` entry `[STATIC]`, confirmed by analysis count `[PROVEN]`

- MZ header entry `CS:IP = 1423:000D` (Ghidra `2423:000D`) is a 7-instruction PKLITE leftover:
  `MOV word ptr [0x5C],0x4B50` ("PK" into the PSP's FCB area) · `MOV AX,DS` · `ADD AX,0x10` · `PUSH AX` · `MOV AX,6` · `PUSH AX` · `RETF` — a computed far jump to `<load segment>:0006`.
- Ghidra cannot follow the `RETF`, so auto-analysis produced **1 function**. Creating a function at **`1000:0006`** (`real_entry`) and re-running analysis produced **169 functions**.
- `real_entry` begins: `CALL 1000:31F0` (`LoadAndRunFontBinCodeCard` — the code-card module; non-zero = failed) · `OR AX,AX` · `JZ +3` · `JMP 1000:00C6` (= `MOV AX,4C00; INT 21h`, silent exit) · `MOV AX,0x193C; MOV DS,AX` · `MOV AX,0x8D78; MOV SS,AX; MOV SP,0x3E8` · `CALL 1000:7A75` · `INT 10h AH=0Fh` (query current mode, saved to `DS:[1]`) · **`MOV AX,0x13; INT 10h`** · `CALL 1000:26C0`.
- Segment values in the listing are Ghidra-relocated (`+0x1000`): the file's `SS=7D78` shows as `8D78`, so the file's data segment paragraph is `093C`.

## Video `[STATIC]`

VGA mode 13h, 320×200, 256 colours, linear frame buffer at `A000:0000` unless the video agent finds Mode-X reprogramming (`UNKNOWN_modex`). The 768-byte `.PAL` files have max byte 63 in every file — consistent with 6-bit DAC values (`[STATIC]`, not yet tied to the upload loop).
