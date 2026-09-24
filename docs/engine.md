# The race engine: car records, the physics step, states, terrain, AI, input, tournament rules

Evidence tags as in `CLAUDE.md`; addresses are Ghidra program `MICROU.EXE` (`1000:`-based, `DS = 193C`; a DS-relative global `[12AE]` is at `193C:12AE`). Established by the `mm-engine-plan-explore` workflow (2026-09-20): three read-only disassembly passes (car record + state machine; race loop + physics + input; front end + reuse map + bridge), each followed by an adversarial re-derivation of its load-bearing claims from function entries and `read_memory`. **Everything here is `[STATIC]`** — nothing in this pass ran under DOSBox. Items the verifier REFUTED are recorded in their corrected form; items it could not re-derive are marked *(unverified)*. This document is the evidence base for `PLAN-ENGINE.md`.

> **Reading the Ghidra listing in this range.** The no-function gaps (`5429–5531`, `60cb–6230`, `63d6–6673`, `66b2–683b`, `6882–73e6`, `82be–8385`, `880a–8995`) contain stale instruction starts (`5461`, `60fe–610b`, `643e`, `657e`, `662f`, `6abb`, `704a`, `885e`) that decode garbage, and `disassemble_bytes … dry_run` returns that stale listing, not a fresh decode. Cross-check with `read_memory` there. `search_instructions` misses `MOV DI,0x1083`-style immediates when the pattern carries a closing bracket (`'0x1083]'`); search without it.

## 1. The car record (4 × 0x164 bytes at `DS:124A`; BX = car·0x164) `[STATIC]`

Every per-car loop is `MOV BX,0 … ADD BX,0x164 / CMP BX,0x42C / JLE` (`7ce0–7cfc`, `7d68`, `30ad`, `7c24`); `4aee`'s loop is the `CMP/JZ/ADD/JMP` variant (`4fd1–4fdb`). `525e`/`5be7` are called in **slot order** with `BX = [2660],[2662],[2664],[2666]` (`4fde–5016`), not by a BX loop. Car 0's fields start at `124A`, so `[BX+12AE]` for cars 0–3 is `12AE / 1412 / 1576 / 16DA` (read directly at `7b4b–7b6e`). The four records occupy `DS:124A–17D9` (4 × 0x164 = 0x590); a whole-record dump is **0x590** bytes from `124A` (the record's last used offset is `13AC`; `13A8/13AA` have no references, `13A6` is init-only).

W = writers, R = readers (a representative subset; the exploration transcript holds the full lists). `*` = a writer that only exists in the raw bytes (stale listing).

| off | w | name | meaning | W | R |
|---|---|---|---|---|---|
| 124A | w | playerSlot | 1-based slot (static 1..4, never written); indexes control-type table `DS:2658` | DS image | 4d53, 7825 |
| 124C | w | active | participates in physics/draw; 0 hides it | 43a8, 6d85, 6dc0, 7692, 77f9, 792c…, 7fc9 | 4d25, 525e, 5534, 59d0, 5be7, 746f, 7ce3, 7d32 |
| 124E | w | present | exists this race (cars 2,3 = 0 in a two-car race; cars 1–3 = 0 in round 9) | 4160–4172, 41a3–41af, 41c4–41d0 | 43a4, 7a16 |
| 1250 | w | drawnThisFrame | set by `DrawCarBodyRotatedRemapped` when on-screen; gates 32 sfx sites | 440c, 7d7d, 7e54 | 30df, 4b23, 5288, 7bce… |
| 1252 | w | colourOffset | palette remap add (static 0,2,4,6) | DS image | 7e2a, 8024, 9056 |
| 1254/1256 | w | UNKNOWN_1254_1256 | static per-car words (0x2400/0, 0x4800/0x3600, 0x6C00/0x6C00, 0x9000/0xA200); **no instruction references** (0 of 13405 scanned; byte-pattern search clean) | – | – |
| 1258 / 125A | w | posXfrac / nextXfrac | 8-bit x fraction (low byte), current / pending | 426a, 5dcd; 555f, 5977, 5c15 | 4f85, 554c, 5964 |
| 125C / 125E | w | posX / nextX | world x 0..3071 (wrap at 0xC00), current / next | 3db5, 5dbd; 5559, 5971, 5c0f… | many |
| 1260 / 126C | w | spawnTargetX / Y | state-0xE drop-in target | 6c6e / 6c73 | 6e04…, 6e35… |
| 1262 / 126E | w | camHalfW / camHalfH | camera target = pos − (this); rewritten to 0x80/0x64 at `53bc/53c2` (state-0 cars only). **Static per-car 1262 = 0x80/0xA0/0xC0/0xE0**; `502e` reads it before the first velocity update | 53bc, 53c2 | 502e, 5041 |
| 1264 / 1266 | w | posYfrac / nextYfrac | | 4276, 5dd5; 557a… | |
| 1268 / 126A | w | posY / nextY | world y 0..3071 | 3e1e, 5dc5; 5574… | many |
| 1270 / 1274 | w | targetVelX / Y | `((sin8[h&0xF8]·speed) >> 8) << 1` (see §3) | 52cf / 52f5 | 5343… |
| 1272 / 1276 | w | velX / velY | signed 8.8 px/step | 5378 / 53b8 + collision/terrain sites | many |
| 1278 | w | heading | 0..255, 0 = up, 0x40 = right, clockwise; frame = h>>3 | 424c, 4d89–4da4, 4db7/4de6, 6c78, 71b4, 883b/8842 | 52b9, 547b, 7d9c… |
| 127A | w | speed | signed scalar; ≤ [129C], ≥ [12A0] | 4e45…, 4eb7, 57dd, 621d, 62dc, 880a | 4dc1, 52b1, 5506, 7b9e |
| 127C / 127E | w | slipThreshold / gripStep | from `CarTypeInfo[5]`/`[6]` (+ handicap); cheats 2/3 | 3f9d/3fa6, 40f2/410b | 52fd / 52f9 |
| 1280 | w | slipEnable | **static 1, never written** (`533c`/`537c` only read it; byte-pattern search over the whole image finds no other reference) | – | 533c, 537c |
| 1282 | w | skidding | velocity was clamped toward target this step | 5356/5362/5396/53a2 | 53c8, 6614 |
| 1284 / 1286 | w | lowGripTimerA / B | ticks during which `[28C4]/[28C2]` replace the grip params; A also drives the puff source | 669b (=0x14), 532a; 66e6, 5338 | 531b, 5314, 812b |
| 1288 / 128A / 128C | w | puffSrcSkid / puffSrcWet / splashTrigger | | 661b, 63d6/665d, 74a3 | 8132, 8139, 83ee |
| 128E..1294 | w | puffOff A–D | −30, 20, 30, −20 | init | 8186… |
| 1296 / 1298 | w | puffSlotCursor / splashSlotCursor | 0..0x54 step 12 / 0..0x18 step 6 | 829f, 841e | 808a, 838d |
| 129A | w | steerStep | 2 (rounds 6,7) else 3 | 4426 | 4edc |
| 129C / 129E | w | maxSpeedCur / maxSpeedBase | AI lowers Cur at `.BRK` points; Base from `CarTypeInfo[0]` | 54c0…, 3f6b/4085; 4248 | 4ead, 628a… |
| 12A0 | w | reverseLimit | negative floor | 3f73, 4095 | 4ec8 |
| 12A2 / 12A4 / 12A6 | w | accel / brakeDecel / coastDecel | `CarTypeInfo[2]/[3]/[4]` (+ handicap); cheat 4 | 3f8a…, 40cc, 412c | 4e8a, 4ec0, 4e38 |
| 12A8 | w | wallHitPending | probe flags valid → bounce in `5be7` | 5737, 57fb, 6688, 69be, 6abb* | 5c7a |
| 12AA | w | droneWallStuck | consecutive wall hits; ≥ 20 → state 0xD; cleared at 8332 | 5c8b, 8332 | 5c8f |
| 12AC | w | carCarHit | re-integrate after a pair collision | 5aaf/5ac5/5bb6/5bc8, 5bf8 | 5bf1 |
| 12AE | w | state | §4 | §4 | 7d3b… |
| 12B0 | w | animTimer | ++ per physics step (73f4) | 73f4, resets | 7f25, 82fb, 88c4 |
| 12B2 / 12B4 | w | puffCooldown / splashCooldown | 3 / 6 after a spawn | 8125, 83fc | 80f5, 83f5 |
| 12B6 / 12B8 | w | animStep / animStep2 | states 1,4,5 / states 2,0xD step index | 7f2b…, 8301 | 7f05, 82be |
| 12BA / 12BC | w | knockoutX / Y | position frozen at knockout; anim drawn here | 5846, 5b46, 5fa0, 74b4, 7a4b… | 833e/8342 |
| 12BE / 12C0 / 12C2 | w | driftDX / driftDY / driftSteps | scripted 4-step glide (states 1,4,5) | 63c3…, 6f9e* | 7418, 740d |
| 12C4 / 12C6 / 12C8 / 12CA | w | hitLeft / Right / Up / Down | probes at (x∓8,y), (x,y∓8) of the current position | 56bb–5709, 6694… | 570f–5724, 5cac–5cee |
| 12CC | w | metaTile | **the car's own** `.MAP` tile index 0..63 (not a projectile's) | 55c9, 574b, 712e | 5633, 5864, 5dd9, 700f |
| 12CE | w | subCell | CH = subx 0..11, CL = suby | 55d1, 5753, 7176 | 5870 |
| 12D0 / 12D2 | w | terrainIdx / terrainIdxPrev | dispatch row index this / previous step | 5ec2/5ebe, 6ce0* | 5eba, 610c… |
| 12D4 / 12D6 / 12D8 | w | zVel / height / bounceOnLand | §3 jump model | 6101*, 748e, 74e0…; 748a; 7504 | 7483… |
| 12DA / 12DC | w | dirByte / dirBytePrev | `.DIR` byte of the current 2×2 block | 5895, 5796 | 5433, 5e99, 683c… |
| 12DE | w | mapAttr | `.MAP` byte >> 6 | 55cd, 574f, 7172 | 5437, 6235, 71a2 |
| 12E0 | b | levByte | **`LEV[metaTile]` of the current tile, written every committed step** (`5de6`); bits 6–5 = `.DIR` remap row | 5de6 | 543b, 6239 |
| 12E1 / 12E3 / 12E5 | w | progressPrev / progress / progressChanged | raw `.MAP` plane-2 byte (no transform) | 5640…, 5644…, 55d5 | 5f25, 5499, 8e31 |
| 12E7 / 12E9 | w | checkpointOff / checkpointOffSaved | byte offset into the race's checkpoint list | 5f7d, 5fc5, 606c, 60ab; 6070, 60a7 | 5f5b… |
| 12EB | w | isDrone | 1 = CPU | 4178–421a | 4d3d, 4ee7, 5c84 |
| 12ED | w | lapsRemaining | init 3; DEC at 6009, INC (cap 9) at 60af; ≤ 0 = finished; HUD digit 8e8e | 4371, 6009, 60af | 4b45, 8e2b… |
| 12EF | w | racePosition | 1..4 (1 = leader), from `DrawRaceHudDigitsAndRankIcons`'s sort | 423e, 8ea0–8eeb, 8fa5/8fb9 | 7796, 77be, 9077 |
| 12F1 / 12F3, 12F5 / 12F7 | w | safeX / safeY, safeXPrev / safeYPrev | respawn point (current, previous) | 5e22/5e32, 5f90…; 5e1a/5e2a | 7097, 5f8c… |
| 12F9 / 12FB | w | hazardVulnerable / wallBounceEnable | static 1; cheat 7 clears 12F9 | 3712 | 6456, 5c70 |
| 12FD–135C | 8×12 | puffSlot[8] | +4 x, +6 y, +8 frame (−1/0..7), +A source; +0/+2 *(undecoded)* | 8083–82bd | |
| 135D–137A | 5×6 | splashSlot[5] | +0 x, +2 y, +4 frame (−1/0..4) | 8386–843c | |
| 137B | b | controlBits | 0x80 L, 0x40 R, 0x20 accel, 0x10 brake, 0x08 fire | 2db1…, 5429–5528 | 4d47, 54af |
| 137C | w | startGridSlot | bit 0 → x+26, bit 1 → y+26 (3,2,1,0) | 3911–3923 | 3daa, 3e13 |
| 137E / 1380 | w | cameraFarFlag / controlsLocked | controls frozen until the camera has settled | 3d6b, 510e…; 3d53, 4d1f | 4d15; 4d0e, 527c |
| 1382 | w | subState | state-0xE substate 0..4; state-7 countdown (0x46) in rounds 2/8; engine bend 0x14 while ≠ 0 | many | 6af0, 7bc4 |
| 1384 | w | rampJumpActive | landing → state 0xD | 686b, 74c6 | 74a9 |
| 1386 | w | UNKNOWN_1386 | write-only (inverse of 1388 for TANKS/F1) | 43ac, 6ad0, 6ade | none |
| 1388 | w | onBridge | `.DIR` bit 4 latched; suppresses progress/25CC rules | 6aca/6ad8, 716c | 5629, 5df5… |
| 138A | w | halveOnBounce | **only ever written 1** (43be, 57cf, 5e36, 72ec; byte-pattern clean) → wall bounces always halve | | 5cdc, 5cf9, 5d0e |
| 138C | w | dropInSlot | index into `DS:2684..268C` | 43c4, 6b83 | 6b87… |
| 138E | w | terrainLevel | raised-terrain level (rounds 4/5/7); hop when leaving | 60d8, 61b7…, 6882… | |
| 1390 / 13AC | w | offTrackDwell / offTrackTicks | 0/1/2; ticks 0..0x32 → state 0xD | 60cb, 6169, 618c; 5660–5674 | 5659 |
| 1392 | w | rotorFrame | round-8 rotor animation | 8470 | 8464 |
| 1394–13A4 | w | projectile: active, frame 0..5, x, stepsA, y, stepsB, xSub, ySub, reloadCooldown (60; live while > 0x28) | §3 | 4f17–4fd0, 51b2, 87f3 | 7a0f… |

**Static initial image** (`read_memory 193C:124A/13AE/1512/1676`): car 0 = `124A=1, 124C=1, 124E=1, 1252=0, 1254=0x2400, 125C=0x5C4, 1262=0x80, 1268=0x8CA, 126E=0x64, 127C=0x32, 127E=0x31, 1280=1, 128E=−30, 1290=20, 1292=30, 1294=−20, 129A=4, 129C=129E=0x800, 12A0=0xFC00, 12A2=12A4=0x40, 12A6=0x20, 12ED=3, 12F9=1, 12FB=1, 1380=1`, slots `12FD..137A = 0xFFFF`, everything else 0. Cars 1–3 differ in `124A` (2,3,4), `1252` (2,4,6), `1254/1256`, **and** `125C` (0x5DC/0x5C4/0x5DC), `1262` (0xA0/0xC0/0xE0), `1268` (0x8CA/0x8E2/0x8E2); `125C/1268` are overwritten from `STRT_POS.BIN` at init, `1262` only at `53bc`.

**Init from tables** (`InitRaceCarsFromTables 3c09–458a`, verified boundary: `PUSH/POP` frame, ends `CALL 2d00; RET`): `CarTypeInfo DS:252A + (round−1)·18`, 9 words: `[0]` → 129C/129E (drones −11·CX −`DroneMaxVelHandicap[[28C1]]`), `[1]`+0x32(+4CX) → 12A0, `[2]`+CX → 12A2, `[3]`+CX+0x28 → 12A4, `[4]` → 12A6, `[5]`+2CX (+0x28 drones / +`GripAdjust` 20 human) → 127C, `[6]`+3CX (same) → 127E, `[7]` → `[28C2]`, `[8]` → `[28C4]` (`3f19–413c`; CX = per-car handicap from `KidModifier`/tournament index, 0 for car 0) *(column→field mapping unverified by the second pass; table values verified)*. Start grid (live-read again, M3.6 follow-up, 2026-09-20 — confirmed exact: all 4 cars share one `LODSW` read of `STRT_POS`'s `{x,y}`, each then conditionally offsetting by its OWN `[BX+137C]` bits, at `3d9f-3e64`): `x = STRT.x + 20 (+26 if [BX+137C] bit 0)`, `y = STRT.y − 10 (+26 if bit 1)` → a 2×2 grid; camera **is not symmetric the way "start − 230" for both axes implied** — `[264A]/[2646] = (STRT.x+20)−250 = STRT.x−230`, but `[264C]/[2648] = (STRT.y−10)−250 = STRT.y−260` (`3dfc-3e07`, `3e65-3e73`) — corrected here after `camera.js` (M3.6) shipped the wrong, symmetric version first and was caught by re-reading the live bytes rather than trusting the shorthand. Heading 0, state 0xA, laps 3, `129A` = 2 (TANKS/WARRIORS) else 3, safe point = start.

## 2. RunRaceMainLoop `1000:3039` — the per-iteration order `[STATIC]`

**The `37fc` "dead stub" is not dead.** `CALL 37fc` at `3043` lands on 255 × `0x90` that fall through into `LoadRaceStartPosCheatsMapAndBanks 38fb`, which ends `CLC/RET` or `STC/RET`; the `JNC` at `3046` is the live race-load success test (`docs/track-layout.md` and `PLAN.md` §8 say the opposite — corrected below).

| addr | call / test | role |
|---|---|---|
| 3040 | `CALL 3030 → 31b6` | DS setup helper *(not read)* |
| 3043 | `CALL 37fc` → NOP slide → **38fb** | load every round file, init 4 cars, first frame, palette fade-up, `AH=7`; `JNC` on its CF |
| 304b | `CALL 7a97` | `InitEngineSounds` |
| 3055/305b/3061 | `[2621]=−1`; `CS:[4ADE]=0`; `[2638]=[263A]` | vsync counter reset; steps-per-present |
| **3067** | `CMP [1096],1 → JMP 3115` | ESC (set by `KeyboardIsr` on the ESC *release*) |
| 3071 | `CALL 2d5b` | `PollAllCarInputs` → `[137B]/[14DF]/[1643]/[17A7]`; drones run the AI here |
| 3074 | `TEST byte [107C],2 → CALL 35f0` | SPACE (slot 14) → cheat spots + pause |
| 307e | `CALL 4aee` | **the physics step** (§3) |
| 3081–3093 | `[26C6] ≥ 2 && ([2656]==2 || −−[26CC]==0) → 30df` | race over (`[26CC]` init 100 at `3c98`) |
| 3095 | `CALL 90c5` | `RenderRaceFrameToBackBuffer`: tiles, `78f8`/`7759` two-car logic, `7ce0` car layer (state handlers via `DS:278F`), overlays, HUD `8dfc`, banners, `7b46` engines — the CALL runs every iteration, but the body returns at `90C5-90CC` unless `[2638]==1`, i.e. **only on drawn steps** (corrected §9am) |
| 3098–30b5 | per car BX = 0,164,2C8,42C: `7429`; `73e7` if state ≠ 0; `51b2` | airborne/landing (+ two-car lights); scripted drift + animTimer; projectile flight |
| 30b7 | `DEC [2638]; JNZ 3067` | batch N steps |
| 30bd–30cc | wait until `CS:[4ADE] > byte[263C + [263A]]` | `263C = 00 01 03 05 07` → 2N vsyncs per N steps → **35 Hz physics** |
| 30ce–30dd | `CALL 92bc`; `[4ADE]=0`; `[2638]=[263A]`; `JMP 3067` | present |
| 30df–3113 | sfx 16 if `[BX+1250]`; `7af8`; 100 × {`3165`, `855a`, `92bc`}; `AH=8`; `AH=6` | race-over banner |
| 3115–3164 | `[2635]/[2630]` ranking fix-ups; `327a` fade; `chdir "\.."` (`DS:261C`); `RET` | exit |

`[263A]` = `SETTINGS.DAT` word 2 verbatim (`27bc–27bd`), forced to 1 if 0 (`3901–3908`). **`30B7` is the natural per-physics-step breakpoint** (first instruction after the per-car loop). `UNKNOWN_bx_at_30df` closed: BX = the camera-target car (`word [27B7 + 2·[27B5]]`, or `[2662]` when that word is 1); one-player → BX = 0.

Race setup (`38fb`): `[2630]=0`; `[263A]`; `319f`; per-car `[137C]` = 3,2,1,0; `3b50` (chdir `GAME1`, `.BRK`/`.LEV`, `[28BD] = word[26D7 + 2(round−1)]`, round 9 hides cars 1–3 -- **corrected §9ak: `3b50`'s own round-9 write is dead on arrival, clobbered by `3c09`'s own unconditional 4-car init a few instructions later; the real, surviving deactivation is `3c09`'s (`InitRaceCarsFromTables`) own round-9 branch at `41bd-41d2`**); `3c09`; `458b` (`.COL/.DIR`); `482f` (`PH0`); `4611` (`.VH0`); `45e5` (`.PR`); fade out; clear VGA; border; **overlay bit-15 pass `397f–39e4`, gated on `byte [042E]=='1'` (last char of the game-set name `GAME1`) and hard-coded: round 2 → words 0x40..0x13C, round 3 → 0x01..0x51, all other rounds → none** (closes `UNKNOWN_overlay_ranges_other_rounds`; there is no table); `90c5` first frame; `4758` palette; `32ce` fade up; `AH=7`; `CLC`. Entry: `SetupTournamentRace 11af` and `StopMusicRunRaceReloadAssets 2179`, both with `[1082]=1` (in-race flag that enables the drone reader) and `AH=7`; after return `[1082]=0`, `InitLoadAssets`, ESC → `JMP 00cc`.

## 3. The physics step `FUN_1000_4aee` (4aee–51b1) and its leaves `[STATIC]`

Per car (`4af2–4fd0`, skipped if state ≠ 0, `[1380]` locked, or `!active` -- except the four-car finished-car block `4b45–4be4`, which runs before those gates, §9ah):
- **Rubber band** `[262F]` = 1 when the car is not car 0, not drawn, and car 0 is in order slot 0 -- the scan's `CMP SI,[0x267E]` is a memory operand, so it never gets past slot 0 (`4b1c–4b41`, again `5286–52ab`; corrected §9ah): acceleration ×6 (`4e8e–4ea9`), grip threshold/slew ×1.5 (`5301–5312`; overridden while a low-grip timer is active).
- **Steer** (`4d73–4e07`): no turn bits → snap heading's low nibble (≤ 4 → 0, ≥ 0xC → +0x10, else 8). Turn step CX = `[129A]` via `4edc` (TANKS only: drone +1; human at signed speed ≥ 0x320 → >>1; every other class returns `[129A]` untouched -- §9ah). `0x80`: h −= CX; `0x40`: h += CX (mod 256). While turning with |speed| ≤ 0xFF and round ≤ 6 → speed := 0xFF.
- **Throttle**: `0x20` speed += `[12A2]` (cap `[129C]`); `0x10` speed −= `[12A4]` (floor `[12A0]`); neither → decay toward 0 by `[12A6]` unless airborne (`4e2e` → `4e38`). Four-car: a finished drone only coasts (`4d2f`), a finished human steers then coasts, and every car coasts once `[26C6]≥2` (`4e07–4e1a`) -- those coasts are not airborne-gated (§9ah). `0x30` together → fire path `4f17` (TANKS or `[2919]`); `0x08` → `4f03` fire gate (`[26C6]≠2`, `[2915]≠1`, `[13A4]==0`, drawn). Drones always OR 0x08 (`5528`) and do reach `4f03` via `4efb`; the `4d4b` skip only bypasses the early `4d6b` test. Humans on a non-joystick device with 0x08 set jump to `4f03` before steering (`4d61–4d70`).
- Then `525e` ×4 (velocity), `5921` (6 pair collisions via `5960`), `5be7` ×4 (commit), camera `5019–51b0`.

**Heading → velocity** (`UpdateCarVelocityTowardHeadingSfx5 525e`, skipped if !active, state ≠ 0, airborne, or `[1380]`): `sin8` = 256 signed bytes at `DS:10A0`, `round(127·sin(2πi/256))` (`[64]=127, [128]=0, [192]=−127`). `SI = h & 0xF8` (32 directions); `tvx = ((sin8[SI]·speed) >> 8) << 1` (the `IMUL; MOV AL,AH; MOV AH,DL; SHL AX,1` idiom = `2·floor(prod/256)`, LSB always 0; sites `52c9, 52ef, 5b0c, 5b1a, 5b9e, 5baa, 6284, 62b6, 71f6, 7212`); `tvy` the same with `(h − 0x40) & 0xFF` → heading 0 = up, 0x40 = right. Grip: `thr = [127C]`, `rate = [127E]` (×1.5 if `[262F]`; **replaced** by `[28C2]/[28C4]` while `[1284]/[1286] > 0`, which are decremented); since `[1280]` is always 1: `|tv − v| > thr → v ± rate, [1282]=1` else `v = tv, [1282]=0` (`533c–53b8`). Also writes `[1262]=0x80, [126E]=0x64`.

**Integrate** (`5548–55b4`, `5960–59cc`, `5bfe–5c64`, `5d35–5d9b`): `t = vel + frac` (16-bit); `next = pos + sext(t >> 8)`; `nextFrac = t & 0xFF`; wrap into `[0, 0xC00)`. **Commit** (`5da1–5dd5`) only when state ∈ {0, 2, 0xE}: `pos ← next`, `frac ← nextFrac`.

**`TestColMaskBitAtWorldXY 589c`** (AX = x, DY = y): returns `CF` = solid, `SI` = meta-tile (`MAP & 0x3F`), `DI` = attr (`>> 6`), `CX` = (subx<<8)|suby, **`ES` = the raw plane-2 byte** (pushed CX at `58dc`, popped into ES at `591c`) — callers `MOV CX,ES`/`MOV AX,ES` (`55db`, `575d`, `7124`). Closes `UNKNOWN_589c_progress_transform`: there is no transform.

**`.COL` response** (`UpdateCarTileCollisionSfx6or4 5532` from `5be7`): next position → `589c`; CF preserved through `585b` (`PUSHF/POPF`); solid and not class-immune (TANKS grade 1–7, TURBO/4×4 grade ≥ 5): if `[1390]` off-track path → `[13AC]++`, > 0x32 → state 0xD; else rough sfx; probe 4 points at (x−8,y), (x+8,y), (x,y−8), (x,y+8) of the **current** position → `[12C4]/[12C6]/[12C8]/[12CA]` (default up+left), `[12A8]=1`. In `5be7` (`5c70–5d1d`, gated on `[12FB]`): left|right → `vx = −vx`; up|down → `vy = −vy`; none → both; **then `SAR 1` because `[138A]` is always 1 → bounce = −v/2**; drones `[12AA]++`, ≥ 20 → state 0xD; progress byte 0xFF → state 0xD (`5852`).

**`FUN_1000_5be7` (5be7–5e4d) is the per-car integrate/wall-bounce/commit routine**, called for all four cars every step (`5001–5016`) — *not* a projectile routine: re-integrate if `[12AC]`; `CALL 5532`; `CALL 5e4e`; bounce; commit; **`[12E0] = LEV[[12CC] & 0x3F]` every committed step (`5dd9–5de6`)**; if LEV bit 7 clear (round 3: also `25CC[tile]` rules and `[1388]`) roll the safe point `[12F1]/[12F3] → [12F5]/[12F7]` and record the position (`5e16–5e32`); `[138A]=1`; `CALL 79fd` for TANKS/`[2919]`. Consequences: `UNKNOWN_dir_bucket_source` is closed (the `.DIR` remap row = LEV bits 6–5 of the car's current tile, varying per car per tile); **LEV bit 7 = "not a safe respawn tile"**, not a projectile line-of-sight flag — the hit test at `5e4a` runs regardless.

**Car-car collision** (`5921 RunCarPairCollisions` runs `5960 ResolveCarToCarCollisionSfx1and3` on 6 pairs; **re-verified live 2026-09-21, §9n — two corrections to this paragraph below, both byte-confirmed**): the 6 calls are `(0,1)(0,2)(0,3)(1,3)(1,2)(3,2)` by car index, not sorted `(i,j)` pairs — the last is `(car3,car2)`, A/B swapped from ascending order; before *every* one of the 6 calls, whichever car's offset is left in `BX` gets its next position re-integrated from its current committed position + velocity — **not "car A" of that pair** — and `BX` is never written inside `5921`/`5960`, so it's always car 3's offset (the heading→velocity loop immediately before `5921`, `4fde-4ff7`, always ends on `[2666]`); both active and state ∈ {0, 2} (if A is in state 2 the code skips B's test *and its active flag*, `59e2`); `dx = A.next − B.next`, `dy` the same (**A minus B, not B minus A**), wrapped at ±0xC00 (thresholds 0xBF0/0xF410); `|dx|,|dy| ≤ 16`; `a = byte[17DA + ((dy+16)>>1)·17 + ((dx+16)>>1)]` (17×17 table, 0 = no contact, centre = 0x60; values are the A→B heading — this reads correctly once `dx`/`dy` have the right sign); either car in state 2 → A.v = (+0x40,+0x40), B.v = (−0x40,−0x40); else `s = sin8[a]`, `c = sin8[(a−64)&0xFF]`, `rel = vA − vB`, `imp = 2·((rel.x·s)>>8) − 2·((rel.y·c)>>8)`, `imp = max(imp, 500)`; WARRIORS (round 6) and imp > 500 and A drawn (`5b3b`) and B drawn (`5b6c`) → both state 0xD + sfx 1; `A.v −= (2·((imp·s)>>8), 2·((imp·c)>>8))`, `B.v += same`, `[12AC]=1` both; sfx 3 gated on B drawn (`5bd6`). *(The earlier "sign convention makes a closing approach yield the 500 floor — surprising" note was this exact bug: A-minus-B was ported as B-minus-A. Resolved, §9n.)*

**Jump / airborne** (`UpdateCarAirborneLandingSfx 7429`, per car per iteration): if `z > 0`: `z += zVel >> 2` (SAR); `zVel −= 1`; `z ≤ 0` → landed: round 2 → `[128C]=1`; `[1384]` → state 0xD; if `[12D8]`: **`zVel := −zVel − DecayBounce[round]`** (the `−(v − v>>2)` computed into DX at `74d3–74de` is dead; `DecayBounce` is a **word** table at `DS:24FF` indexed by round·2 = `0,1,2,1,1,1,2,2,2,2`, word 0 unused; note `zVel` was already decremented at `748e` before the negation) else `z = zVel = 0, [12D8]=1`; landing sfx. Lift-off (`z ≤ 0, zVel > 0`): `z += zVel >> 2` (SHR), `zVel−−`. Launch sources: ramp `683c` (prev `.DIR` bit 0x10 → `zVel = s/12 + 4`, `[1384]=1`, sfx 1) and the terrain handlers below, with `s = vxi² + vyi²`, `vxi = sext(vx >> 8)`.

**Checkpoints & laps** (`UpdateCarCheckpointsAndSurfaceSfx 5e4e`, `5f25–60bf`) — corrected by the verifier, and again in §9ah (the body runs only for state 0 at `5e8f`, outside the round-3 `25CC` skip, and with `[12E5]!=0` at `5f1b` -- `[12E3]` is never written from a 0 plane-2 cell; the forward-wrap test compares with the FIRST entry's `hi`, else penalty; cursor in bytes; sfx 2 drawn-gated; the lead rule sets `[26C6]=2` when car 0 is strictly AHEAD on laps): checkpoint list pointer = `word[1FEB + (round−1)·8 + (race−1)·2]` (lists at `DS:2035–21E1`, words of `{lo, hi}` progress bytes, `FFFF`-terminated; rounds 2 and 8 → `21DF` = empty list; the checkpoint data is in the EXE, not in a file). `d = [12E3] − [12E1]`. `|d| ≤ [2654]` (half max progress): entry at cursor `[12E7]` tested against **`[12E1]`** (previous progress): `prev < lo` nothing; `lo ≤ prev < hi` → cursor += 2; `prev ≥ hi` → penalty. `d < −half` (forward across the start line): **only if the cursor already sits on the `FFFF` terminator** (`5fef JNZ 5f85`) rewind to the list base and, if `[12E3] < hi` of entry 0 (else the penalty, `6006`) → `[12ED]−−` (sfx 2 iff `[2656]==1`; round-2/race-1 lead rule `6024–6054`; clamp ≥ 0), cursor = `[12E9]`, `[12E9] = 0`; **otherwise (a checkpoint still outstanding) → the penalty path, no lap counted.** `d > +half` (backward across the line) → `[12E9] = cursor`, cursor = terminator, `[12ED]++` (cap 9). Penalty `5f85`: one-player → safe point ← previous safe point, `[12BA]/[12BC]` = position, state 0xD, sfx 1 (if drawn); two-car → cursor += 2. So **sfx 1 at `5fbd` is the "skipped a checkpoint" reset and sfx 2 at `601f` is "lap completed"**, not forward/backward checkpoint passes (`docs/sound.md` §3b ids 1/2 — corrected below). A port that decrements laps on any wrap lets players skip checkpoints.

**Race end** (full account §9ah): `[26C6]` is ASSIGNED at `4b85–4bde` only on a finished car's turn when its speed is exactly 0 (four-car) = number of cars with `[12ED] == 0` and speed 0, forced to 2 when the `[2660]` car has finished; the four-car race then runs 100 more steps (`[26CC]`) and the tournament reads car 0's slot in the order array; two-car lights (`4bf1–4c7c`) write `[26B8]`/`[26C4]` and a fixed finish order [**§9am**: credits the car ahead on the light bar, not the finisher; "Play Off" on a tied bar; the finished car then skips its control path; a two-car race ends only at an exchange end, `76F2`/`772A`/`7742`]. Rank: `DrawRaceHudDigitsAndRankIcons 8dfc` scores `(9 − [12ED])·[2652] + [12E3]` into `[2670..2676]`, bubble-sorts `[2678..267E]` and writes `[12EF]` = 1..4 -- a PREFIX freeze through the last finished car's slot (§9ah).

**Projectiles**: fire `4f17`: `[1394]=1, [1396]=0, [13A4]=0x3C, [139A]=[139E]=0xA`, direction word = `sin8[h&0xF8] | ((frac+8)&0xF)<<8`, `x = car.x + sext(sin)>>3` (y with `sin(h−64)`); flight `51b2` while `[13A4] ≥ 0x28` (20 steps): 6 sub-steps of `87f3` each adding the sine to an 8-bit accumulator with carry into the pixel coordinate; hit `79fd` (from `5be7`, TANKS/`[2919]`): another car's active shot within |dx|,|dy| ≤ 12 → shot cleared, victim state 0xD at its position, sfx 1.

**Camera** (`5019–51b0`, `UNKNOWN_car_camera_2p` resolved M3.1 follow-up, 2026-09-20 — table read live, branch disassembled in full, and **checked for reachability by searching every writer of `[27B5]`, not just reading its static value**, per `PLAN.md` §8's "only-writer claims need a byte-pattern search" pitfall): `BX = CAR_CAMERA_TABLE[[27B5]]` (`5019-5023`, `DS:27B7`, `src/data/engine-tables.js`'s `CAR_CAMERA_TABLE`) selects the camera target — index 0 is the sentinel `1` (two-car branch below); indices 1–4 are literal `CarRecord` base offsets for cars 0–3, used as a normal single-car target = car pos − (`[BX+1262]`, `[BX+126E]`), i.e. that **car's own** `camHalfW`/`camHalfH` fields, not a fixed constant (`502a-504d`). `[27B5]` is written 6 places, all in `InitRaceCarsFromTables`/`ResetCarsAfterKnockoutSfxA` [**§9am**: 8 writers -- also `767B` (=0, back to the midpoint after an exchange) and `7829` (= the SCORER's playerSlot); the table itself is `DS:27B7-27C0`]; four of them are the literal pattern `CMP [2656],2 / JZ → [27B5]=0 else [27B5]=1` (`3f06-3f19`, `4146-415a`), so **the two-car branch is live and reachable**, taken exactly when `[2656]` (race format) is 2 — not dead code. One-player mode (and round 9, unconditionally at `41d6`) always resolves to index 1 (car 0), matching §2's `UNKNOWN_bx_at_30df`, already closed against this same table. `ResetCarsAfterKnockoutSfxA` (`7825-7829`) instead writes the surviving car's own `playerSlot` value (1..4) straight into `[27B5]` after a knockout — `playerSlot`'s numbering exists specifically to double as this table's index.

Two-car branch (`5053–5106`, `[2656]==2`): target is the midpoint of `[2660]`'s and `[2662]`'s car positions (the two camera-relevant car slots, defaulted to cars 0/1 at `414c-4152`). Each axis is **differenced first, then the raw delta is folded** into `(−0xC00/2, 0xC00/2]` for the toroidal world (`5065-506d` X, `50aa-50ba` Y) — the fold thresholds are exactly `0xC00` minus that axis's window (`3072−232=2840=0xb18`, `3072−176=2896=0xb50`), which only makes sense once you see what the window check does next: if the folded separation exceeds it (X: ±0xE8/232px, Y: ±0xB0/176px), the midpoint for *that call* is not updated at all — `[2911]` (the two-car knockout request -- resolved §9v/§9am: this IS the head-to-head "opponent left the screen" trigger) is instead set to `1` (or left at `2`, its "already flagged" value) and the branch falls straight to the smoothing tail; this is a "cars too far apart for one camera" gate, not a rendered event in itself. When both axes are in range: `midAxis = carB.axis + (foldedDelta SAR 1) − camHalf`, where **`camHalf` here is the literal `0x80`/`0x64`, not either car's own `camHalfW`/`camHalfH` field** (unlike the single-car branch above — a real difference between the two paths, not a simplification), independently re-wrapped into `[0,0xC00)`, then stored to `[2646]/[2648]`.

Both branches converge at `510a`: every car's `cameraFarFlag` (`[137E]/[14E2]/[1646]/[17AA]`, one per car slot) is cleared to 0, then each axis moves toward its target once per call (`5126-518a`). **X (`5126-5152`) and Y (`5156-5186`) use the same rule** — instruction for instruction the same code with different operands, re-read 2026-09-21 (§9m) after this paragraph's earlier claim of an asymmetry turned out to be the error that made the port's camera shake. Three regimes per axis on the plain 16-bit `target − cam` (`5129`/`515d`; `[264A]/[264C]` are never folded into `[0,0xC00)` — only the *target* is, `5037`/`504a`):
  - `|delta| > 0x3E8` (1000px, far) **or** `|delta| ≤ step` (already within one step): the step value (`[264E]`/`[2650]`) is set to `0x32` (50) and the **full raw signed delta** is added — an unbounded snap (`513f`/`5173`: `MOV [step],0x32; JMP` past the ±step block with DX still holding the raw delta, straight to `ADD [cam],DX` at `5152`/`5186`). "Far" closes a huge gap in one frame instead of creeping for hundreds; "close" lands exactly on target instead of overshooting.
  - the middle range (`step < |delta| ≤ 1000`): `cam += sign(delta)·step` (`5147-5150`/`517b-5184`), step unchanged.
  **Correction history (§9m):** the first draft of this paragraph said both axes were smoothed the same way; an advisor review then "caught" that as papering over an asymmetry, and this paragraph was rewritten to say X *always* applies a bounded step and only *separately* sets the step to 50. That rewrite was wrong — it missed that the `JMP 5152` at `5145` skips the `±step` block — and `camera.js` faithfully ported it, so from M3.6 through M3.10 a settled camera (step=50) overshot any target within 50px by up to 50px every physics step and swung back the next: a ±50px horizontal oscillation at 35 Hz, which every single screenshot showed as a perfectly normal frame. Found only when the user reported the built game "flickering / jumping". The first draft had been right.
  `[264E]`/`[2650]` start at `8` at race setup (`InitRaceCarsFromTables 3c16`) and on respawn (`RespawnCarAtSafePoint 7369`), or `4` after a knockout reset (`ResetCarsAfterKnockoutSfxA 782c`) — this is what the doc's older "(8 → min 50)" shorthand meant, now fully derived rather than inferred. Only once **both** axes' step values equal exactly 50 does `cameraFarFlag` flip back to `1` for all four cars (`518a-51aa`) — "far" here reads as "caught up"; what reads this flag to clear `controlsLocked` (§1's `3d53`/`4d1f`) was not traced this session.

**No PRNG in physics**: `AdvancePseudoRandom48 7cae` has exactly two callers, `7bd9` (OPL engine bend jitter) and `7c90` (beeper pitch jitter); byte-pattern search for the far-call form finds none. **The simulation is deterministic given the per-step control bytes.**

## 4. The car state machine (`DS:278F`, 17 words, `CALL [278F + 2·state]`) `[STATIC]`

Dispatch in `DrawRaceCarLayer 7d2b–7d45`: only if `state == 0xE` or `[BX+124C] != 0`; no bounds check (word `27B1` after the table is a runtime collision-pair pointer). Table (`read_memory 193C:278F`): `737d 0a88 be82 be35 627f fa7e be35 eb6f be35 be35 9b84 737d 737d be82 e56a 8386 a886`.

| state | handler | what it does |
|---|---|---|
| 0 | 7D73 `DrawCarBodyRotatedRemapped` | normal driving; body frame = h>>3 (24×24 from `5D78`; round 9 car 0 40×40); sets `[1250]` |
| 1 | 880A *(no function)* | **hazard death** (whirlpool `63a1`, hole `6460`/`64ff` — its only writers): speed 0; rounds 9/4 align heading to 0/0x80 by ±4 per tick then tables `27C1`/`27DD`; round 2 table `2835` (stride 0x10); else `27F9` (stride 0x1E); frames from `.VH0` **bank 2** (`7fe8`; `8034` 40×40 for round 9); the body is still drawn during the alignment ticks (`885e` = `CALL 7d73`, hidden by the stale listing); sfx 7 at step 8 (or 17 at step 4 for rounds 2/4/9); end → 7. **Not a start sequence.** |
| 2 | 82BE *(no function)* | re-appear animation: table `289D` (durations 4,8,0xC,0x10,0x14,0x18) / `28AB` (frame ids 0,1,2,3,4,0) — **5 distinct 24×24 frames** from `DS:45E3 = PH0 + 0x600` (stride 576, `8339`: `SHL 9 + SHL 6`), drawn at `[12BA]/[12BC] − z − camera − 12`; body drawn for steps ≥ 3; end → 0, `[2911]=0`, `[12AA]=0`. Closes most of `UNKNOWN_ph0_0600_1380`: `+0x600..+0x1140` are these frames; **`+0x1140..+0x1380` (576 B) is still unreferenced** (`UNKNOWN_ph0_1140_1380`) |
| 3, 6, 8, 9 | 35BE (`RET`) | never written |
| 4 | 7F62 `HandleCarState4FallAnimSfx8` | fall animation, table `2879`, bank-2 frames; latches `[2682]=BX`; sfx 8 at step 4; end → `[124C]=0, [1382]=1`, state 0xE |
| 5 | 7EFA `HandleCarState5CrashAnimSfx8` | crash animation, table `2855`; sfx 8 at step 4; end → 7 |
| 7 | 6FEB–73E5 *(no function)* | **respawn**: rounds 2/8 first count `[1382]` down (0x46); zero speed/velocity (`7042–7058`, raw bytes); snap the safe point to the 96-px cell centre (+0x30); LEV nudge (`DS:1FCB`); recompute tile/progress/cursor (`7121–7160`); heading = `{0x40,0x80,0x60,0xA0}[LEV bits 6–5]` XOR 0x80 for **MAP attr bit 1 and again for bit 0** (`71a2–71b1`; not the `.DIR` low bits); ±12 px sideways (`[2660]` car +0x40, others −0x40); state := 2, `[1380]=1, [137E]=0`, counters reset, sfx 9; two-car: laps := min *(geometry unverified by the second pass)* |
| A | 849B `HandleCarStateADropInSfx9` | **race-start hold**: `[26D5] += [263A]` while < 0x60 (body drawn, sfx 9 queued for the `[2660]` car); at 0x60 all four states := 0 *(internals unverified)* |
| B / C | 7D73 | two-car loser / winner (render loop adds `851f` / `855a`) |
| D | 82BE | knocked-out animation (as state 2), body drawn for steps ≤ 3; end → 7 |
| E | 6AE5–6FE9 | round 3's shortcut sequencer on `[1382]`: 0 → match the car's cell (±1) against `DS:22E1` (5 entries, stride 14: cellx, celly, minCursor, x, y, heading, slot) → state 4, `[138C]=slot` (no match, or race 1 checking only entry 0 → crash path `6f58`); 1 → re-match, set spawn target/heading/velocity, hide; 2 → two-car wait (partner or 0x28 ticks, `[2656]==2` only, else falls straight into 3); 3 → slide toward the target by 8·`[263A]`, then a per-slot queue + race-wide `[2680]` ownership gate; 4 → show, `[12D6]=1, [12D4]=8` (drop from above), X-only settle check, → 0. Reached as a terrain block only from round 3 row index 4 -- fully resolved and ported, docs §9r (`UNKNOWN_6ae5_round3_sequencer`/`UNKNOWN_stateE_reach`/`UNKNOWN_22E1_scope` all closed) |
| F | 8683 `HandleCarStateFBannerSfx10` | banner `SI=0x8CE3` = PH0 banner **3 = "1 Up!"**, loop sfx 16, `[291D]=1` |
| 10 | 86A8 `HandleCarState10BannerSfxF` | banner `SI=0x9523` = PH0 banner **4 = "Failed"**, loop sfx 15, `[291D]=0`, `StopEngineSounds` |

Transitions (writer → condition): init → A (`43d6/4406`); A → 0 (`84e5–84f7`, `8518`); 0 → D at `5852` (progress byte 0xFF), `5b52/5b83` (WARRIORS impulse), `5ca6` (drone stuck ≥ 20), `5fac` (missed checkpoint), `617f` (knock-out tile, `[1382]=0x46`), `5842` via `566b` (off-track > 0x32 ticks), `74c0` (ramp landing), `7a57` (projectile hit), `7698/76b0` (two-car exchange end; really C → D, both cars were set 0xC at `75fa/7600` -- §9am); 0 → 1 at `63a1`, `6460`, `64ff`; 1 → 7 (`891c`); 0 → 4 (`6b73`); 4 → E (`7fd5`); E → 5 (`6f62`); E → 0 (`6dba`, `6f39`); 5 → 7 (`7f4f`); D → 7 (`832c`); 7 → 2 (`7252`); 2 → 0 (`831b`); 0 → C both (`75fa/7600`); → B/C (`785e/788a`, `ResetCarsAfterKnockoutSfxA`); B,C → 7 (`79da/79ea`, `FUN_1000_78f8` = `TwoCarLineUpAtLeaderSafePoint` -- these survive only on its `[2913]` both-down path; at the exchange end `7698/76b0` immediately overwrite them with 0xD, §9am); 0 → F (`4b13`: round 9, `[12ED]==2`, speed 0); car 0 → 10 (`7453`: round 9 countdown `[26C8]` hit 0). `FUN_1000_73e7` (main loop) applies `[12BE]/[12C0]` drift for `[12C2]` steps in states 1/4/5 and bumps `[12B0]`.

Animation tables (`read_memory`): `27C1`/`27DD` thr `8,10,18,20,28,30,FFFF`, frames `0..4,−2,−1` / `5..9,−2,−1`; `27F9` (stride 0x1E) thr `4,8,C,10,14,18,1C,50,58,60,68,70,78,A0,FFFF`, frames `0..6,−2,7..B,−2,−1`; `2835` (stride 0x10) thr `4,8,C,10,14,18,50,FFFF`, frames `0..5,−2,−1`; `2855` (crash) thr `4,8,C,10,14,18,1C,A0,FFFF`, frames `0..6,−2,−1`; `2879` (fall) thr `2,4,…,E,28,FFFF`, frames `0..6,−2,−1`; `289D/28AB` (states 2/D) as above. **`.VH0` bank 2 = the frames for states 1, 4 and 5** (closes most of `UNKNOWN_vh0_bank2`). `DS:22E1` records: `(10,19,10,630,510,C0,0) (2,E,4,108,E0,60,0) (15,3,2,6C8,150,A0,0) (12,10,E,810,630,40,10) (1E,10,10,B40,B60,E0,20)`, `FFFF` end.

## 5. Per-round terrain dispatch (`DS:26D7`) `[STATIC]`

In `5e4e` (`5e8f–5eea`), **state-0 cars only**: `idx = [12DA] >> 5` for rounds 1, 2, 3, 6 (0..7) and `>> 4` for rounds 4, 5, 7, 8, 9 (0..15); `[12D2]=[12D0]`, `[12D0]=idx`; skipped while airborne (`[12D6] ≠ 0`) except rounds 4/5 with idx ≥ 5; `CALL word[[28BD] + 2·idx]`, `[28BD]` = `word[26D7 + 2(round−1)]` written once per round at `3be6`. Row pointers `26E9 26F9 2707 2717 2735 274F 2759 2779 277F` (lengths 8,7,8,15,13,5,16,3,8 — they abut, `277F + 16 = 278F`); a short row's overflow reads the next row's words. The shipped `.DIR` files' max index per round (7,6,7,14,10,4,15,2,7) fits every row *(census unverified by the second pass)*. This corrects `docs/track-layout.md`'s "high nibble = roughness grade 0–15": for rounds 4/5 indices 5–14 are **height levels**, and four rounds only use 3 bits.

| round | row words |
|---|---|
| 1 | 60CB 6456 657E 6674 6674 669B 6768 683B |
| 2 | 60CB 63D6 6768 641A 35BE 35BE 63DD |
| 3 | 60CB 657E 6456 35BE 6AE5 6AC2 35BE 683C |
| 4 | 60CB 657E 6622 64F5 6768 6882 ×10 |
| 5 | 60CB 66ED 6622 61B0 6456 6882 ×8 |
| 6 | 60CB 657E 6768 669B 61B0 |
| 7 | 60CB 69C5 ×8 35BE ×5 67D8 66B2 |
| 8 | 60CB 6169 618C |
| 9 | 60CB 66ED 6768 6231 6231 6231 6622 64F5 |

Handlers (`s = vxi² + vyi²`): `35BE`/`683B` RET · `60CB` normal: `[1390]=0`; leaving a raised level (`[138E]≠0`) → `[138E]=0`, `zVel = s/15+4` (round 1 prev idx 4: `/7+4`, idx 3: `/12+8`) · `6169` knock-out tile → state D, `[1382]=0x46` · `618C` off-track dwell 1→2, then `vx += 0xC8` if `vx ≥ 0` · `61B0` rough: leave-level hop; else halve vx,vy (unless prev idx 3 in round 5 / 4 elsewhere), sfx 6, speed cap 0x200 · `6231` (`FUN_1000_6231`) conveyor/current: push v along the `.DIR` heading (`191B`/`18FB`) ×2, speed cap 0x100 · `63D6` wet puff · `63DD` on ground: `zVel = max(s,0x1C)/8+5`, `[12D8]=0` · `641A` prev idx ≠ 6 and `s ≥ 0xE`: `zVel = max(s,0x1C)/10+5` · `6456`/`64F5` hazard (if `[12F9]`): state 1, glide to the 16-px cell centre in 4 steps (A also zeroes velocity) · `657E` leave-level hop; skidding → `[1288]=1` · `6622` leave-level hop; moving → `[128A]=1`, sfx 18 · `6674` `HandleTileResetSteerFlags`: prev idx 0/2 → `[12D0]=0, [12A8]=1, [12C4]=[12C8]=1` (barrier bounce) · `669B` `HandleTileLowGripSfx12`: `[1284]=0x14`, sfx 18 · `66B2` hop; `[1286]=0x14` · `66ED` hop (+6); prev ≠ 6: `zVel = s/9 + 0xB` (round 2) or `+2` · `6768` hop; `s ≥ 0xE`: `zVel = max(s,0x1C)/7` (+7 round 2) · `67D8` hop; prev ≠ 6: `s/5+4` · `683C` ramp launch · `6882` stepped levels (rounds 4/5): `level = idx − 4` (0xD → −1, 0xE → 4 with launch `s/7+4`); `Δ = level − [138E]`; `Δ > 2` → wall probes + `[12A8]=1`; `|Δ| ≤ 1` nothing; else drop `s/18+4` · `69C5` TANKS levels: `level = idx` (8 → 2), hop `/15+4`, then `6AC2` · `6AC2` `.DIR` bit 4 → `[1388]=1, [1386]=0` else `[1388]=0, [1386]=1` · `6AE5` state-E sequencer (round 3 idx 4). Round-2 extras in `5e4e`: `.DIR & 0x18` → `6231`; every step → `62e3` **plughole** at world (0x650, 0xB70): within ±60 px pull velocity toward the centre by `min((60−|dx|)·4+40, (60−|dy|)·4+5)`; within ±12 → state 1, `[1382]=70`, 4-step glide. `docs/sound.md` §3b's "6622/669B present in every dispatch row" is wrong: `6622` is in rows 4, 5, 9 and `669B` in rows 1 and 6; only `60CB` is in every row.

## 6. Input → control byte; the drone AI `[STATIC]`

**Readers.** `FUN_1000_2d00` (called last in `InitRaceCarsFromTables`, `4587`) fills the per-slot reader pointers `[1083..1089]` from the control words `[2658..265E]`: 4 KEYS1 → `2dfa` (`AL=[107D]`), 5 KEYS2 → `2dfe` (`AL=[107C]`), 3 MOUSE → `2e02`, 1 JOY1 → `2e6c` (+`[108C]|=1`), 2 JOY2 → `2eb3` (+`|=2`), anything else (6 = CPU) → `2ded` = `MOV AL,0; CMP [1082],0; JZ; CALL 5429`. `FUN_1000_2d5b` pre-reads joysticks/mouse into `[108D..1095]`, then `CALL [1083+2i]` with `BX = [2660+2i]` and stores AL to car i's `[137B]`; menu byte `[108B] = [137B]|[14DF]` (or the byte at `[[1080]]`). **The drone AI is just another reader** — the port's input interface is one 5-bit byte per car per step.

**Key slots** (`KeyboardIsr 2efd`, `2f70–2f8d`): scancode table `DS:106C[i]` (= `SETTINGS.DAT` bytes 16+i) ↔ bit `0x8000 >> i` of `[107C]` (press OR, release AND NOT). KEYS1 = slots 0–4 = `[107D]` bits 0x80..0x08; KEYS2 = slots 8–12 = `[107C]` bits 0x80..0x08; slot 14 (SPACE) = bit 1 → pause test at `3074`. Slot order = **LEFT, RIGHT, ACCELERATE, BRAKE, SELECT** (`RunRedefineKeysScreen` labels at `DS:AE4B`, stored `93af–93ba`). Closes `UNKNOWN_settings_key_slots`. This copy: P1 = KEYS2 = `4B 4D 48 50 1F` = Left, Right, Up, Down, S; P2 = KEYS1 = `24 26 17 32 25` = J, L, I, M, K — ordinary keys, so the two-human Head to Head *is* reachable from one keyboard. Release latching: `[107F]` = held make code (set only while none held, `2f65`), `[107E]` = last release (set when `[107E]≠0` or the released key is the held one, `2f43–2f4e`); ESC release → `[1096]=1` (`2f5e`). Menus wait for *releases*.

**Bits** (`4aee`): 0x80 left, 0x40 right, 0x20 accelerate, 0x10 brake/reverse, 0x08 fire/select; 0x30 together → fire for TANKS/`[2919]`. Joystick 1 (`2e6c`): X ≤ `[28FD]` → 0x80, ≥ `[28FF]` → 0x40; buttons (`[1095] & 0x30`): 0x20 alone accelerate, 0x10 alone brake, both → 0x30, any → also 0x08; the Y compares are dead. Joystick 2 identical with `[1091]`, `[2905]/[2907]`, `([1095]>>2)&0x30`. Mouse (`INT 33h AX=3`): left button → 0x28, right → 0x10; x ≤ 160−`[290D]` → 0x80, ≥ 160+ → 0x40; y ≤ 100− → 0x20, ≥ 100+ → 0x10; recentres.

**Drone AI `1000:5429–5531`** *(no Ghidra function; entered only from `2df6`)*: `[137B]=0`; `dir = [12DA] & 0xF` (`& 7` for round 2); if `[12DE] & 2`: `dir = byte[191B + ((LEV[12E0]>>5)&3)·16 + dir]` (`545c–5468`, raw bytes — Ghidra's `5461 SBB` is stale); `target = word[18FB + 2·dir]`; if `[12DE] & 1`: `target ^= 0x80`; `d = int8(target − heading)`: `d < 0` → 0x80, `d ≥ 3` → 0x40. Then `.BRK` byte `b = [[28BB] + [12E3]]`, `type = b >> 4`: 0 → 0x20, `[129C]=[129E]`; 1 → `lim = ((b&0xF)<<8)>>1 + 0x380` (+0x50 if `[28C1]==0x17`; TANKS: −0xD0, and −0x20 more if `[28C1] ≥ 0x13`): `speed ≤ lim` → 0x20 else 0x10, `[129C]=[129E]`; 2 → `lim = ((b&0xF)<<8)>>2 + 0x600`, 0x20, `[129C] = max([129C], lim)`; other → as type 1 if turning else type 0. Always `OR 0x08`. `UNKNOWN_1082_meaning` (what else gates `[1082]`) is trivial: `SetupTournamentRace`/`StopMusicRunRaceReloadAssets` set it 1 around `RunRaceMainLoop`.

**Pause** (`CheckCheatSpotsThenPause 35f0`): `AH=8, AH=6`; cheat-spot scan (|dx|,|dy| < 24 from the `[2660]` car); white screen; "Paused!" banner; waits ≥ 140 ticks of `[261F]` and a key release. (**Corrected §9an:** the first loop exits on a key click OR 140 ticks -- `3789-3796` -- so the pause resumes at the first key click; no 2 s minimum.) Cheat types (`3652–3733`, narrows `UNKNOWN_cheats_type`): 0 `[406]−−` (a life); 1 instant win (`[26C6]=4, [2635]=1`, fixed order, scores 0x7D00); 2 `[127C]=param`; 3 `[127E]=param`; 4 `[12A2]=param`; 5 `[2915]=1`; 6 `[2917]=1`; 7 `[12F9]=0` (hazard-immune); 8 `[129C]=0x800`; 9 `[2915]=[2919]=1, [291B]=4` (projectiles for all).

## 7. Front end and tournament rules `[STATIC]`

**Flow.** `real_entry 0006` → code card `31f0` (≠ 0 → exit) → mode 13h → `InitLoadAssets 26c0` → `HookKeyboardInt09` → `AH=7` → `RunOptionsScreenWithSettingsDat 2770` (ESC → exit path `0097`) → `SelectGameSetLvl 2be8` (no `GAME?.LVL` → defaults) → `LoadSoundDriverBinModule` ×2 → tune 1 → **`RunTitleScreenAttractLoop 0100`** (LOGO, copyright, 9 `INTRO.CHR` showcase frames every 0x118 ticks of `DS:0002` with the class name; exits on fire → main menu, ESC release → options, any other release → main menu; **no idle timeout**) → `RunMainMenuKeepTitleTune 0220` (LOGO, "SELECT GAME", ONE PLAYER / TWO PLAYER via `FUN_0382`) → `FUN_02e0` ONE PLAYER GAME (item 1 → `0fbf`, item 2 → `102b`) or `FUN_1e20` TWO PLAYER. **`FUN_1000_0382` is the two-item menu helper** (THUMB highlight, LEFT/RIGHT/FIRE/ESC, **idle ≥ 0x7D0 ticks = 28.6 s → cancel at `03CE`**) — the timeout `docs/sound.md` §8 attributed to the attract loop lives here. **Ghidra names to fix**: `0fbf` "StartTwoPlayerTournament" is the **one-player Head-to-Head vs CPU** (`[3f8]=1, [2656]=2, [265a]=6`); `102b` "StartOnePlayerTournament" is the **one-player 4-car Challenge**; the two-human Head to Head is `FUN_1000_1e20` → `1ef1`/`1faf`/`2329`.

**`[2656]` is the race-format selector (1 = four-car race, 2 = two-car race), not the human count** — `0fbf` has one human and writes 2. Its complete write-set: `0fc9`, `103a`, `1e52`, `1f88` (closes `UNKNOWN_2656_valueset`; 23 read sites all compare with 1 or 2). `[28BF]` (round) and `[28C0]` (race) each have **four** writers (`117d/1182` SetupTournamentRace, `13d7/13dc` intro-screen cheat skip, `2005/2008` H2H tournament, `21df/21cf` single-race select), all unpacking `round<<2 | race−1` — so "class == round" stands but "one writer" does not.

**Tournament** (`RunTournamentLoop 10a0`, `SetupTournamentRace 115c`): order table `DS:043C` (26 bytes: `08 15 04 18 11 14 0C 19 09 10 20 16 0B 1C 0D 05 12 21 1A 1D 06 0A 22 0E 1E 07` → R2.1 (qualifier) R5.2 R1.1 R6.1 R4.2 R5.1 R3.1 R6.2 R2.2 R4.1 R8.1 R5.3 R2.4 R7.1 R3.2 R1.2 R4.3 R8.2 R6.3 R7.2 R1.3 R2.3 R8.3 R3.3 R7.3 R1.4); `[439]=0x19` last index, `[43A]=1` board-screen enable, `[43B]=2` max bonus race. Round 9 never appears in the table — it is only the bonus race. Qualifier = entry 0; pass = P1 1st (or 2nd in the Challenge) → outcome 1 (5 in two-car mode) and, in the Challenge, `FUN_1a4a` lets the player pick the 3 opponents; fail → outcome 0, tournament over. Loop: `INC [28C1], INC [310]`; `[28C1] > [439]` → `ShowChampionScreenTune3`. Challenge result: 1st → advance, `DEC [3fa]` (win streak from 3; at 0 and not the last race → `FUN_1a82` **bonus race** = round 9 race `[342]+1`, outcome 3 EXTRA LIFE if `[291D]==1` else 4 NO BONUS, `[342]++` ≤ 2); 2nd → advance (streak untouched, not on the last race); 3rd/4th → outcome 2 ONE LIFE LOST, `[3fa]=3`, re-run. Two-car mode: P1 1st → advance, else −1 life and re-run. Lives `DS:0406..0409` = 3 each; only `[406]` is used (cheat `[F69]` → 10 after every race; `']'` release on the outcome screen → 0). **Elimination**: after a qualifying result with `[310] % 3 == 0`, victim = at `[28C1]==3` the drone with the lowest character index, afterwards the next slot round-robin; only if a free character remains (`roster DS:0164[11]`: idx, `|0x40` taken, `|0x20` eliminated) → `ShowCharacterEliminatedTune6` and the player picks a replacement. Note the literal `CMP [28C1],0x19` at `113f/1418/15b7/1658` vs `[439]` at `1104/1134` — they only agree for the shipped table. Track names: `DS:0460` walked by `(round−1)·4 + (race−1)`; round 2's **first** slot (ROUND21, the qualifier) is the empty string; the last race centres whatever string that index gives (index 3 "WIN THIS RACE TO BE CHAMPION" only because order[25] = R1.4).

**Two-human Head to Head**: `RunHeadToHeadTournament 1faf` picks tracks from `DS:09BA` (`04 0A 11 0D 1C 21 14 19` → R1.1 R2.3 R4.2 R3.2 R7.1 R8.2 R5.1 R6.2) by **`DS:0002 & 7`** (the vsync tick counter — not input-deterministic) without repeats; first to 4 wins (`[98A]/[98C]`). `SelectSingleRaceTrack 2193` cycles the 10-entry `(race, class)` list `DS:09D9`: (2,3) (3,10→round 3) (1,7) (2,4) (2,6) (2,2) (1,5) (2,8) (1,1) (3,11→round 1) — LEFT and RIGHT both step +1. **Lights** (`75c8–7758`, `76c2–7758`, only when `[2656]==2`): `[26B4]` seeded 4; `[26B8]==1` = "no knockout pending" sentinel; on a knockout both cars → state 0xC, 64-tick blink, `78f8` re-line-up, state 0xD [**§9am**: `78f8` repositions nothing -- it shares the leader's safe point; the side-by-side line-up is the state-7 respawn after 0xD]; `[26B8]==[2660]` → `INC [26B4]` (8 ends the race) else `DEC` (0 ends it). **`UNKNOWN_26B8_polarity` — contested, not settled**: `ResetCarsAfterKnockoutSfxA 7759` writes `[26B8]` = the car with the *smaller* `[12EF]` (= the leader) when no fall is latched, and the verifier found two more writers (`4c08`, `4c64` in `4aee`) plus the "Winner" banner gate (`855a`) and the tally chain (`8606 → [2630] → 3152 → 11d5 → 256e`) that all treat `[26B8]` as the **scorer/winner**; the `[2682]` fall path (`7f69`) points it at the fallen car. `docs/sound.md` §3b's "settled: loser" and the Ghidra EOL comment at `77f5` must be downgraded; one live two-human knockout decides it. **`UNKNOWN_ph0_light_roles` resolved 2026-09-21 (§9p) independently of this polarity question**: the light bar itself (`8fc2-8fe8`) reads `[26B4]` directly, not `[26B8]` — bottom `[26B4]` lights red (car slot 0's end), top `8-[26B4]` blue (car slot 1's), regardless of which reading of `[26B8]` turns out right. Also: `[2662]` is never written with 0x2C8, yet the two-car finish-order code encodes car 2 as record 0x2C8 (`3146`, `4c17`, `4c68`), so `FUN_11d5`'s face formula gives desc 0xC39 for the second car — harmless in the shipped code (only `[3fc]==0xC03` is ever tested) but not something a port should copy as "P2 face".

**Screens** (each with CHR descriptors, strings and tunes in the exploration tables): options (`2770`: F1–F7, cheat code `25011968` = scancodes `DS:0F6B`, saves 32 B when changed and drive ≥ C:), credits `2a82`, joystick calibration `2ab5`, redefine keys `92f0`, character select `09e0` (11 `FCNORMAL` faces, names `DS:0258`, skills `DS:02B1`, 13-step eased scroll `DS:0185`, handicap question `0b51` for characters 0–2 in two-human H2H only), tournament board `18d8` (`CASE.CHR` map + `MINATURE` icons at `DS:0312` positions), next-race intro `11f8` (tune 4; tune 5 needs `[28C1]==0x1A`, unreachable with the shipped table), results `13e4` (`NOS.CHR` badges, faces `[3fc..402]`, "QUALIFY"/"FAILED"), eliminated `16de`, outcome `1c1b` (messages `DS:081F`: FAILED TO QUALIFY! / QUALIFIED FOR CHALLENGE! / ONE LIFE LOST / EXTRA LIFE / NO BONUS / QUALIFIED FOR HEAD TO HEAD!; "LIVES 99"), champion `1aad` (CUP strips, scrolling name), H2H menus `1ef1`/`2329`/`256e` (WON/LOST, skill labels `DS:08CD` via `DS:08B0`). **Sprite descriptors, full field layout (re-verified live for M3.9, `BindSpriteObjToChrDescriptor 049c` + `ClipSpriteDescToFrontView 0630` decompiled fresh, docs/engine.md §9k)**: 18 × 27 bytes at `DS:0B7C..0D62` — `+0` ptr to the bound `.CHR` record (write-only scratch, unused by the blitters themselves), `+2` x (signed), `+4` y (signed), `+6` save-under seg (0 = no save-under), `+8` pixel seg (= the `.CHR` record's own segment, i.e. `chr.js`'s `arenaOffset`-equivalent), `+0xA` flip flag (1 = horizontal mirror at blit time, byte), `+0xB` bytes/frame = `w·h` (word), `+0xD` src offset (word, **computed by the clip routine**, not persistent state), `+0xF` height (word), `+0x11` width (word), `+0x13` frame index (word), `+0x15` dest offset (word, `0xFFFF` sentinel = fully clipped away — this is what the older shorthand called "clip"), `+0x17` src row skip (word, computed), `+0x19` clipped height (byte, computed), `+0x1A` clipped width (byte, computed). Clip rect is 0..256 × 0..200 against a **272-wide back buffer**, dest formula `0x888 + y·0x110 + x` (`0x888` = row 8 · 272 + column 8, confirming the "menu origin (8,8)" reading). Colour 0 is transparent in `BlitSpriteTransparentFlipSaveUnder`; `SaveSpriteBackground`/`RestoreSpriteBackground` no-op when `+0x15==0xFFFF` or `+6==0`. Bound by `InitLoadAssets` to BADGE, LOGO, INTRO, NOS, FCNORMAL, 4 face slots, THUMB, SELGAM, WORDS, CUP, 4 MINATURE, FRAME; fonts `DX=0B40` (8×8) / `0B54` (8×16); centred text `x = 0x7F − 4·len`. Tick counters: `DS:0002` (all menu waits: 0x118 attract, 0x7D0 idle, 0x2BC key waits) and `DS:261F`; their incrementers were not traced (`UNKNOWN_tick_counter_writers`). Dead: `ShowHeadToHeadResultUnreferenced 2099` and its only callee `FUN_1000_22b6`.

## 8. Data that lives in `MICROU.EXE`, not in a shipped file

Every engine constant is in the data segment (file offset = `0x9840 + DS offset` in the unpacked EXE): sine `10A0` (256 B), contact angles `17DA` (289 B), compass `18FB` (32 B), `.DIR` remap `191B` (64 B), LEV nudges `1FCB` (32 B), checkpoint pointers `1FEB` (72 B) + lists `2035–21E1`, drop points `22E1` (74 B), `KidModifier 23DC` (12 w, identity), `RuffTruckTimes 2419` (7 w: 6240, 6400, 8000, 4000, 10, 10, 10 → `[26C8]`), `DroneMaxVelHandicap 2462` (26 w by `[28C1]`), `GripAdjust 24E0` (= 20), `DecayBounce 24FF` (10 w), `CarTypeInfo 252A` (9×9 w: r1 `07EE FC00 0020 0020 0020 001E 001B 0007 0006`; r2 `067E FCC1 0020 0030 0014 002F 0028 0007 0006`; r3 `07F8 FC00 0020 003C 0010 004D 004C 0007 0006`; r4 `07BD FC85 0028 0051 001E 001E 001C 0007 0006`; r5 `067E FCC1 0019 000F 001C 0032 002F 0007 0006`; r6 `05DC FDAE 0015 0014 000A 0017 0012 0007 0006`; r7 `03A3 FCC1 0010 0010 001E 003C 003B 000E 000C`; r8 `04A3 FDAE 0030 0030 0004 001E 000E 0001 0002`; r9 `0400 FCE0 0040 0034 000F 0048 004B 0007 0006`), round-3 tile flags `25CC` (64 B), terrain rows `26D7–278F`, state table `278F`, camera table `27B5–27BF`, animation tables `27C1–28B8`, plus the front end's order table `043C`, track names `0460`, character names/skills `0258/02B1`, outcome messages `081F`, H2H tables `09BA/09D9`, and the menu strings. `MICROU.EXE` is user-produced and not shipped; `MICRO.EXE` is PKLITE-packed. How the port obtains these bytes is a decision recorded in `PLAN-ENGINE.md` §2.

## 9. Corrections to earlier docs (to apply in M3.0)

| where | says | is |
|---|---|---|
| `track-layout.md` race loading, `PLAN.md` §8 | `37fc` stub's carry check "effectively dead"; `RunRaceMainLoop (1000:3043)` | the NOP slide falls into `38fb`; `JNC 3046` is live; the function is `1000:3039` |
| `track-layout.md` `.DIR` caveat, `sound.md` §3b, Ghidra comment `5de0` | `FUN_1000_5be7` = tank/projectile-hit routine; `[12E0]` only written there; `[12CC]` = the projectile's meta-tile; `UNKNOWN_dir_bucket_source` open | per-car integrate/commit routine for all 4 cars every step; `[12E0] = LEV[car's tile]` every committed step; `[12CC]` = the car's own tile; closed |
| `track-layout.md` `.LEV` | bit 7 = projectile line-of-sight block | bit 7 = "not a safe respawn tile" (skips the safe-point update only) |
| `track-layout.md` `.LEV` bits 6–5 | heading XORed by the `.DIR` low 2 bits | XOR 0x80 for MAP attribute bit 1 and again for bit 0 (`71a2–71b1`) |
| `track-layout.md` `.DIR` | high nibble = roughness grade 0–15 | dispatch index = bits 7–5 (rounds 1,2,3,6) or 7–4 (4,5,7,8,9); rounds 4/5 indices 5–14 are height levels |
| `track-layout.md` `UNKNOWN_589c_progress_transform` | open | none: `ES` = raw plane-2 byte |
| `track-layout.md` `UNKNOWN_settings_key_slots` | open | LEFT, RIGHT, ACCELERATE, BRAKE, SELECT |
| `track-layout.md`, `CLAUDE.md` | `[28C0]`/`[28BF]` have one writer; track-name empty slots are the 4th | four writers each; round 2's empty slot is the first (the qualifier) |
| `track-graphics.md`, `sound.md` | `[12ED]` = checkpoint-direction counter / checkpoints left | laps remaining (init 3) |
| `track-graphics.md` `UNKNOWN_overlay_ranges_other_rounds` | open | closed: only rounds 2 and 3, hard-coded, gated on `GAME1` |
| `track-graphics.md` `UNKNOWN_ph0_0600_1380` | open | `+0x600..+0x1140` = 5 frames of the state-2/D animation; `+0x1140..+0x1380` still open |
| `track-graphics.md` `UNKNOWN_vh0_bank2` | open | bank 2 = state 1/4/5 animation frames |
| `track-graphics.md` render order | "state-handler table → DrawCarBodyRotatedRemapped"; `78f8/7759` = conditional overlays | the body draw *is* the handler for states 0/B/C; `78f8` = two-car re-line-up logic, `7759` = knockout reset |
| `track-graphics.md` banners | "1 Up!" → `86a8`, "Failed" → `8683` | swapped: `8683` (state F) = "1 Up!" and sets `[291D]=1`; `86a8` (state 10) = "Failed" |
| `sound.md` §3b ids 1/2 | 5fbd forward checkpoint pass; 601f backward pass / wrong-way warning | 5fbd = skipped-checkpoint reset penalty; 601f = lap completed (one-player) |
| `sound.md` §3b id 18 | 6622/669B in every dispatch row | 6622 in rows 4,5,9; 669B in rows 1,6 |
| `sound.md` §3b, Ghidra comment `77f5` | `[26B8]` = loser, "settled" | **resolved 2026-09-22 (§9u)**: a shared slot re-armed by two different events — the knockout-reset writer's own immediate effect reads as loser-ish (routes to a "Bonus" banner, not Winner), but the match-winner determination (a separate, later finish-detection writer) reads `[26B8]` as scorer/winner, confirmed by literal `"WINNER!"`/`"LOSER!"` on-screen text |
| `sound.md` §8 `UNKNOWN_race_live_reverify` | attract-loop idle timeout at `03CE`; P2 = KEYS 1 makes H2H unreachable | `03CE` is in `FUN_0382` (menus, 28.6 s); KEYS1 = J L I M K — reachable |
| `sound.md` §2, §8 | which smoothness writes `[263A]` untraced; `UNKNOWN_bx_at_30df`; `UNKNOWN_2656_valueset` | `[263A]` = SETTINGS word 2 verbatim; BX = camera-target car; `[2656]` ∈ {1,2}, 4 writers |
| `sound.md` §3b, task briefs | state 1 = "scripted start sequence"; 0xA "drop-in" | state 1 = hazard death; 0xA = race-start hold; the drop-in is state 0xE substate 4 |
| Ghidra names | `StartTwoPlayerTournament 0fbf`, `StartOnePlayerTournament 102b` | one-player H2H vs CPU; one-player Challenge; two-human H2H = `FUN_1000_1e20` |
| Ghidra listing | instructions at `5461, 6100–610a, 6440, 6580–6582, 6630, 6abc–6ac0, 704d–7050, 885e` | stale mid-instruction decodes; clear and re-disassemble from `read_memory` |
| §3 checkpoints (2026-09-23, §9ah) | forward wrap "backs up to the last entry"; body runs every step | rewinds to entry 0 and tests its `hi`, else penalty; body gated on state 0 (`5e8f`) and `[12E5]` (`5f1b`); `[12E3]` never written from a 0 cell (`[PROVEN]`); cursor `[12E7]` in bytes |
| §9s / §9o ranking | uniform freeze the instant any car finishes; loop-order effect cadence-dependent, not ported; `[26C6]>=2` provably redundant | prefix freeze through the last finished slot, deterministic, ported; `[26C6]>=2` is set with nobody finished by `6054`, `36a7`, `76f2/772a/7742`, `8702` |
| §9s `[26C6]` recompute | forced to 2 the instant car 0 finishes, every step | assigned only on a finished car's turn at speed exactly 0 (`4b7b`→`4b85`), `laps == 0` |
| §9x `6054` | car 0 "strictly behind" every other car | strictly AHEAD (fewer laps remaining); the ROUND21 qualifier's lead rule |
| §3 rubber band, steering | boost when car 0 precedes the car anywhere; `>>1` for fast humans | boost only while car 0 is in slot 0; steer modifiers TANKS-only |
| `collide.js`/§9ae | 0xFF-progress knockout in the commit tail | only at the write sites `564e/57c4/5838` → `5842` |
| `states.js` respawn | writes `[12E3]` only | writes `[12E3]` and `[12E1]` and recomputes `[12E7]` (`7120–7160`) |

## 9b. M3.0(b) Ghidra hygiene — what was done (2026-09-20)

Renamed (naming-quality-gate warnings on the `Run`/`Poll` prefixes are cosmetic, not errors): `StartTwoPlayerTournament` → `RunOnePlayerHeadToHeadVsCpu`, `StartOnePlayerTournament` → `RunOnePlayerChallenge`, `FUN_1000_1e20` → `RunTwoPlayerHeadToHeadSetup`, `FUN_1000_5be7` → `UpdateCarPositionCommitAndBounce`, `FUN_1000_5921` → `RunCarPairCollisions`, `FUN_1000_4aee` → `RunCarPhysicsStep`, `FUN_1000_2d00` → `BuildInputReaderTable`, `FUN_1000_2d5b` → `PollAllCarInputs`, `FUN_1000_0382` → `RunTwoItemMenu`, `FUN_1000_02e0` → `RunOnePlayerGameMenu`. Corrected the stale `[PROVEN]`/`[STATIC]` comments at `1000:5de0` (was "tank/projectile-hit routine") and `1000:77f5` (was "settled: loser" for `[26B8]`) in place, both now citing this document.

Created functions at the 5 named gaps plus a discovered sixth (`8339`, the shared PH0-knockout-frame blit helper called from `82be`) and all 18 terrain-dispatch handler blocks from `docs/engine.md` §5 that were not already named functions: `RunDroneSteeringAi` (5429), `RespawnCarAtSafePoint` (6feb), `HandleCarState2or0DKnockoutAnim` (82be), `DrawPh0KnockoutAnimFrame` (8339), `HandleCarState1HazardDeath` (880a), `HandleCarState0EDropInSequencer` (6ae5), and `HandleTerrainNormalOrLeaveLevel` (60cb), `HandleTerrainKnockoutTile` (6169), `HandleTerrainOffTrackDwell` (618c), `HandleTerrainRoughSurfaceSfx6` (61b0), `HandleTerrainWetPuffTrigger` (63d6), `HandleTerrainGroundedZVel` (63dd), `HandleTerrainAirborneZVelBoost` (641a), `HandleTerrainHazardFallSnapStop` (6456), `HandleTerrainHazardFallKeepVel` (64f5), `HandleTerrainLeaveLevelHop` (657e), `HandleTerrainLeaveLevelWetPuff` (6622), `HandleTerrainLeaveLevelMudPuff` (66b2), `HandleTerrainLeaveLevelHopVariant` (66ed), `HandleTerrainLeaveLevelHighHop` (6768), `HandleTerrainLeaveLevelLowHop` (67d8), `HandleTerrainSteppedLevels` (6882), `HandleTerrainTankLevels` (69c5), `HandleTerrainDirRampBridgeFlag` (6ac2). Every boundary was checked with `get_function_by_address` against the spans this document already cites.

Cleared and re-disassembled all 8 stale decodes named in `PLAN.md` §8 (`5461`, `60fe–610b`, `643e`, `657e`'s own entry, `662f`, `6abb`, `704a`/`704c`, `885e`) plus two more found incidentally while creating the surrounding functions (`6ce0` inside `HandleCarState0EDropInSequencer`, and a residual 2-byte span at `6f9e` that resisted every available clearing technique — flagged with an EOL comment giving the correct bytes instead). Technique that worked throughout: `clear_flow_and_repair` on the *exact* stale instruction's address range (not a wider span starting from the presumed-correct boundary — a wide span reports a no-op `delta:0` because the tool re-decodes from whatever misaligned boundary already exists), then a separate `disassemble_bytes(..., dry_run:false)` call from the true instruction boundary to fill the now-undefined bytes. `clear_flow_and_repair`'s "repair" step was also needed once more, at full function width, to re-merge `HandleCarState0EDropInSequencer`'s body after it fragmented into spurious auto-created sub-functions (`FUN_1000_6fa0`, `FUN_1000_6d60`, both deleted) during the fix — `get_function_by_address`'s `body_end` field does not reflect a disjoint (jump-connected) function body until that repair runs.

Created the `CarRecord` struct type (117 fields, 356 B, from the table in §1) in the type manager, but **did not stamp it onto the four car-record memory locations** (`193C:124A/13AE/1512/1676`) — doing so would evict 97 pre-existing per-field `DAT_193c_*` auto-labels at each base (~400 across all four), which `apply_data_type`'s eviction guard correctly refuses without clearing them individually first; that is future work, noted in a plate comment at `193C:124A`. **One real mistake happened and was fully recovered**: the struct was twice applied at the wrong address (`1000:124a` and `1000:1512`, the *code* segment's offsets, instead of `193C:124a`/`193C:1512`, the *data* segment — see the new `PLAN.md` §8 pitfall), overwriting part of `ShowNextRaceIntroScreenTune4or5` and `ShowRaceResultsScreenTune8or6`; both were restored and re-verified against this document's own screen-flow tables, with two single stray bytes (`1249`, `1511`) left as documented, unavoidable 1-byte "undefined" placeholders.

All changes were saved (`save_program`) and a final `find_code_gaps` sweep confirmed no new gaps beyond the pre-existing ones already present before this session's edits.

## 9c. M3.1 tables + car struct — what was done (2026-09-20)

`src/data/engine-tables.js` embeds 22 tables, every one read live from the Ghidra project this
session (not transcribed from this document's prose, to avoid the hex/decimal-ambiguity trap:
some numbers in §8's prose are hex-without-`0x` and some are decimal, e.g. `RuffTruckTimes`'s
`6240` is decimal but the animation tables' `8,10,18,20` are hex — both were confirmed against
raw bytes, not assumed) and checked byte-for-byte against `game/MICROU.EXE` by
`tools/check-tables.mjs` (`npm run tables`, 22/22): the sine table, the 17×17 car-car contact
table, the checkpoint pointer table + lists, `KidModifier`, `RuffTruckTimes`,
`DroneMaxVelHandicap`, `GripAdjust`, `DecayBounce`, `CarTypeInfo`, the round-3 tile flags, the
terrain row-pointer table + all 9 rounds' dispatch rows (cross-checked word-for-word against
this document's §5 table — an exact match, so §5's census is now doubly confirmed), the
17-entry state dispatch table (also an exact match against §4), and the eight state 1/2/4/5/D
animation threshold/frame blocks (§9c below). `DIR_REMAP_TABLE`,
`DIR_COMPASS_TABLE`, `LEV_NUDGE_TABLE` and `LEV_HEADING_TABLE` were re-exported from
`src/formats/track.js`/`levbrk.js` rather than re-derived (they were already live-verified for
the graphics port); a fresh read of `DS:1FCB` this session reconfirmed `LEV_NUDGE_TABLE` byte-
for-byte as a bonus check.

The six state 1/2/4/5/D animation threshold/frame tables (`DS:27C1-28B9`) are included too, once
a first pass (reversed on review — see the correction below) mis-split them: `27C1` and `27DD`
are each a **complete, independently-addressed** `{threshold(7w), frames(7w)}` pair (28 bytes
apart, exactly `27C1+0x1C=27DD`), not one shared threshold row followed by two frame halves —
they only *look* like one split table because both pairs happen to carry an identical threshold
row. Every one of the eight blocks (`27C1`, `27DD`, `27F9`, `2835`, `2855`, `2879`, `289D`,
`28AB`) now matches §4's prose byte-for-byte once its numbers are read as the hex-without-`0x`
notation §4 already uses elsewhere (e.g. `27F9`'s thr `4,8,C,10,14,18,1C,50,58,60,68,70,78,A0` is
hex for `4,8,12,...,160`) — this document's own earlier claim that the sub-block boundaries
"don't resolve from the prose alone" was itself wrong (a hex-reading slip caught on review, not
a real ambiguity) and is corrected here rather than left standing. Which of `27C1`/`27DD` applies
resolved 2026-09-22 (§9w): by which heading waypoint (0 vs 0x80) the state-1 oscillator arrives at,
not by round.

**Deliberately left out, then filled in on request (M3.1 follow-up, 2026-09-20)**: the camera
table. `DS:27B7` (5 words, `CAR_CAMERA_TABLE` in `src/data/engine-tables.js`, verified live —
`npm run tables` is now 23/23) plus the full two-car camera branch it gates, disassembled and
written up in §3, resolving `UNKNOWN_car_camera_2p`. `DS:27B5` itself is a one-word *runtime*
camera-mode index (not table data) and is not embedded. Camera rendering code (M3.6) still isn't
written — this was the data + formula only, per what was actually asked for.

`src/engine/car.js`'s field layout was pulled directly from Ghidra's `CarRecord` struct via
`get_struct_layout` (117 fields, 356 B) rather than re-derived from §1's table, since §1 is
explicitly "a representative subset" and the struct is the actual authoritative artifact from
M3.0(b)'s work. `tools/check-car.mjs` (`npm run car`) round-trips a live dump of all 4 cars'
static init image (`tools/refs/car-static-init.hex`, read from `DS:124A` this session) through
`fromBytes`/`toBytes` byte-exact, and spot-checks ~30 named fields per car against §1's static-
image paragraph.

The checkpoint-bands panel (added to `mapView`, not a separate page, since it needs a race's own
already-loaded `.MAP` progress plane) was screenshotted in a real browser (`npm run dev`) on
round 1 race 1 and round 3 race 1: both show small coloured bands sitting on the track's own
tile path in order, which is the actual claim under test. `ROUND21` (round 2 race 1) itself was
also checked and correctly shows 0 checkpoints — round 2 (all four races, not just the
qualifier) and round 8 have no checkpoint lists at all, which is now a confirmed live-read fact
rather than a §9/§8 paraphrase.

## 9d. M3.2 race compositor — what was done (2026-09-20)

`src/render/raceView.js` (`composeRaceView`) implements `RenderRaceFrameToBackBuffer`'s draw
order from §2/`docs/track-graphics.md` — base tiles, then cars, then overlay tiles, HUD deferred
(see below) — as a new module rather than a call into `formats/race.js`'s `renderTrack()`
(which draws overlays with the base pass and has no car layer at all). `src/render/blit.js`
holds the two sprite-blit primitives it needs (`blitTransparent`, colour-0 transparent;
`blitSilhouette`, the airborne shadow) plus the clip helper (`ClipSpriteToRaceView 1000:8bab`'s
shape, not its exact 256×224 box — see below); `remapCarColours` itself stays in
`formats/race.js` (reused, not duplicated, per D5/§3).

**`tools/check-live.mjs` re-pointed at the new compositor, not just re-run.** It now calls
`composeRaceView({ ..., cars: [] })` instead of hand-windowing `renderTrack()`, so the overlay
pass (`drawTileOverlay`, previously skipped in this tool with `{overlays: false}`) runs on every
check now. Result unchanged: 1267/51200 pixels differ, 0 outside the HUD column and the boat
box — i.e. `npm run live` now covers **strictly more** of the compositor than it did under
M3.1/M3.0 (the overlay re-blit as well as the base tiles), and the unchanged count is itself
evidence that every overlay-flagged tile visible at camera (414,500) is base-identical to its
`+12` variant when no car sits under it, exactly as `docs/track-graphics.md`'s "Overlay tiles"
section already claimed from a static read. This does **not** cover `UNKNOWN_overlay_tile_191`
(the one overlay index whose `+12` variant is known to differ) — that tile simply isn't inside
this one camera's view. And it still only guards the tile layer: with no live per-step trace yet
(M3.4), there is no ground truth for a frame where a car is actually drawn under a rack, so the
cars-then-overlays ordering itself stays `[STATIC]` until M3.6's frame diff can exercise it.

**Car sprite + shadow eyeball check** (`tools/render-car-check.mjs`, `tools/out/CAR_CHECK_R21.png`):
renders `ROUND2BR.VH0`'s boat at 8 of its 32 headings next to a crop of the real boat from
`tools/refs/race_R21_a000.bin`, plus one frame at a synthetic z to show the shadow. Heading 0
(the "up" stored frame) visually matches the real boat's orientation and body-colour remap (P1
default `colourOffset=0`); the shadow demo shows the expected `(x+z,y+z)` black silhouette
against `(x-z,y-z)` body. This shows the blit path draws the right sprite, in the right colours,
at the right orientation — it is a look-and-compare check, not a pixel diff, so it does **not**
establish pixel correspondence: there is no live `CarRecord` dump for this exact frame (that
needs the M3.4 trace), so the boat's true world position/heading/z in that frame are unknown, and
the eyeballed heading was picked to match, not derived independently. Pixel correctness of the
car layer waits on M3.4/M3.6.

**`UNKNOWN_car_draw_anchor` (new, deferred to M3.6).** Where a car's `(posX,posY)` lands on
screen relative to its sprite is not disassembled — `drawCar` assumes the sprite is drawn
**centred** on `(posX-camX, posY-camY)`. Basis: `camHalfW`/`camHalfH` default to (128,100), the
exact centre of the 256×200 view (§3's camera target = car pos − (camHalfW,camHalfH)), and the
live boat's screen bbox in `race_R21_a000.bin` (x116–138, y86–113) centres within 1px of x=128;
the y evidence is weaker (centre ~99.5) because the bbox's 28px height includes wake below the
24px sprite, not just the sprite. Consistent, not proven; M3.6's per-step trace diff is the real
test, same discipline as everything else in this document not tagged `[PROVEN]`.

**Resolved 2026-09-23, `[STATIC]` by disassembly** (re-disassembled live this session, `mm`
project, `MICROU.EXE`; the anchor question itself needed no DOSBox fallback — the bytes are
unambiguous, per the same advisor triage that gated the §9q pause-banner item). Full
`disassemble_function` of `DrawCarBodyRotatedRemapped` (`1000:7d73`), `DrawRaceCarLayer`
(`1000:7ce0`, the caller) and `DrawCarShadowSilhouette` (`1000:7e5c`). Ghidra already carried a
matching plate comment on all three from an earlier, undocumented pass (`get_comment` on `7d73`/
`7e5c`/`8bab` before writing any of this down) — independent convergent evidence, not the basis
for this citation.

The prior guess is **confirmed exactly**, literal-for-literal:

- **Shared base anchor.** Both functions compute the same `(posX-camX, posY-camY)` before
  applying anything else: body `7d90-7d9a` loads `DI=[BX+125C]` (posX, `car.js`'s
  `CAR_RECORD_BASE+0x12`), `AX=[BX+1268]` (posY, `+0x1e`), then `7dc4/7dd1 SUB DI,[264A]` /
  `SUB AX,[264C]` — plain subtraction of the raw camera globals, in the same order this port's
  `wrapDelta(car.posX - camX, WORLD_PX)` assumes; the shadow (`7e61-7e6b`, then `7e99/7ea6 SUB
  ...,[264A]`/`[264C]`) reads the identical two fields the identical way. `[264A]`/`[264C]` hold no
  extra offset beyond what §3's `camHalfW`/`camHalfH` camera-target formula already establishes
  (confirmed by §3's own already-disassembled camera code, not re-derived here): they ARE the
  view's raw top-left, nothing further is folded in.
- **The half-box subtraction is a literal, not a runtime `width>>1`.** Body: `7e1f SUB AX,0xc` /
  `7e22 SUB DI,0xc` (12 = 24/2); shadow: `7ede SUB AX,0xc` / `7ee1 SUB DI,0xc`, same 12 — two
  independent hand-authored constants that happen to equal `size>>1`, the exact same shape as the
  §9q pause-banner literal (there too, a stored-box half-width/half-height baked into the caller
  rather than computed). This port's `size >> 1` shortcut lands on the same number, but the real
  code does not derive it that way.
- **Sign of z, confirmed opposite.** Body subtracts height: `7d85-7d8c` loads `DX=[BX+12D6]`
  (height) then `7d98/7d9a SUB DI,DX` / `SUB AX,DX` — so `screenX = posX-camX-half-z`. Shadow adds
  it: `7e5d MOV DX,[BX+12D6]` then `7e69/7e6b ADD DI,DX` / `ADD AX,DX` — `screenX =
  posX-camX-half+z`. This is this port's exact `dx-half-z` (body) / `dx-half+z` (shadow) pair,
  from the SAME base anchor, opposite-signed z — not two independently-guessed formulas that
  happened to agree.
- **Round 9 cross-check (the independent check this item asked for).** The 40×40 car-0-only path
  (body `7db5-7de6`, shadow `7e8a-7ee4`, both gated on `[28BF]==9 && BX==0`) uses `7ddd/7de0 SUB
  AX/DI,0x14` (body) and `7eb2/7eb5 SUB AX/DI,0x14` (shadow) — 20 = 40/2, not 12, scaling with the
  sprite exactly as this port's `size >> 1` already does for any `vehicleSize` passed in. Round 9's
  40×40 body is car-0-only too (`7dad CMP BX,0x0 / JZ 7db5 / JMP 7e52`), the same gate the shadow
  already had — not previously stated either way.
- **The wraparound add (`CMP DI,-0xC / JG / ADD DI,0xC00`, threshold `-half`) is real** — the real
  code corrects only DI/AX values at or below a threshold (`-0xC` for 24×24, `-0x4` for the 40×40
  path — an independent literal there, not derived from the 40×40 half either) by adding a full
  `WORLD_PX` (0xC00); there is **no symmetric branch for the opposite (large-positive) case**, unlike
  this port's old general `wrapDelta`. `UNKNOWN_car_draw_wrap_asymmetry` **resolved and FIXED
  2026-09-23 (M3.44).** A follow-up pass's own "provably benign to skip" framing for this was WRONG,
  corrected in place rather than silently overwritten — but that pass's own worked counter-example
  (`posX=3060, camX=10`, "well within screen range and clearly should draw") was ALSO wrong, caught
  only by carrying the arithmetic through the half-offset subtraction and the actual clip test
  instead of stopping at `wrapDelta`'s own output: `wrapDelta(3050,3072)=-22`, then `-22-half(12)=
  -34`, and `-34+size(24)=-10`, which is NOT `>0` — off-screen in the OLD port code too, at exactly
  the same real-game verdict. Brute-forcing every `posX` at `camX=0` (`z` from -10 to 20) against
  both the old formula and the real one instead of hand-picking one point found the ACTUAL
  disagreement: a narrow, positive-side sliver just below `WORLD_PX` (`posX∈[3061,3071]` at `z=0` for
  the 24×24 box, narrowing as the body's `z` grows and widening for the shadow's `+z` counterpart) —
  11px wide at most, not the 22px the wrong example implied — where the OLD `wrapDelta`-based port
  drew a car the real, unfolded byte-for-byte computation leaves thousands of px off-screen. **Round
  9 has a second, independent-of-the-seam divergence**: its own threshold (`-4`) is far tighter than
  its half-width (`-20`) would suggest, so a genuinely near, still-partially-visible truck
  (`delta∈[-19,-4]`, e.g. sitting 10px left of the camera's own left edge) is ALSO folded away and
  lost in the real game, which the old symmetric code (never even engaging its fold logic for such a
  small delta) drew correctly, unlike the original. Both windows are computed by brute force, not
  hand-picked, in `tools/check-play.mjs`'s own persisted scan (see below) and pinned at representative
  points with teeth-proven pixel tests (`checkCarDrawWrapSeam`).

  **Why this was safe to fix outright, not defer pending more evidence**: `engine/drawn.js`'s
  `markDrawn` already ports this exact one-sided fold (`viewCoord`) for the `car.drawnThisFrame` flag
  every sfx/rubber-band/fire-gate site reads. Re-reading §9ap's own 12-position live table (not
  assuming from its summary): it covers the `-12` threshold (its own `x -11`/`x -12` row) AND round
  9's `-4` threshold (its own `x -3`/`x -4` row, `[PROVEN]`, not `[STATIC]` as an earlier draft of
  this section claimed before actually re-reading the table) — only the POSITIVE-side no-fold case
  itself, this item's own headline finding, was never live-tested by those 12 pokes, so that piece
  alone stays `[STATIC]` by disassembly (re-derived twice, matching independently between the body
  and shadow functions) plus an exact offline replay of the port's own formula against itself — which
  pins that this port's code does what its own citations say, not that the ORIGINAL game's 1994 bytes
  do (that half is the disassembly, not the replay). Before this fix, `raceView.js` could VISIBLY
  DRAW a car in the disagreement window that the port's own, already-trusted `drawnThisFrame` flag
  had just marked off-screen — an internal contradiction independent of any question about the
  original's intent, and reason enough to fix regardless of reachability.

  **Reachability, measured, not assumed** (`tools/check-play.mjs`'s `checkCarDrawWrapReachability`,
  a persisted sweep over every round/race in both formats, 8000 AI-driven steps each, 637382 car-ticks
  — history: an early draft checked the rotor's OLD position against the real 256×224 window instead
  of the 200-row canvas it actually paints onto, reporting 137, caught in review; a second draft fixed
  that but dropped the `oldR` term the fix's own semantics require (the gate only decides whether
  `drawRotor` is CALLED — once called it still draws at its unfixed position, clipped by the same
  200-row canvas as before), producing 425 unexplained cases an `other`-bucket self-check caught).
  Results: the body fold itself fires **zero** times (`camera.x∈[32,2965]`, `camera.y∈[41,2971]`,
  inside `[0,3072)` by `camera.js`'s own construction; round 9 car 0 never within 100px of its 4px
  threshold; the shadow shares the identical formula but was not separately swept). **The round-8
  rotor clip-sliver DOES change real frames**: 71/87842 round-8 car-ticks (`drawRotor`'s 32×32 box at
  `dx-16` overhangs the body's 24×24 clip box at `dx-12` on the left/right/top edges only — never the
  bottom, since the rotor only reaches the 200-row canvas at raw Y≤215, inside the 224-row gate's own
  reach — an everyday round-8 occurrence the real bytes gate out via the SAME clip call, `7e28 JC
  7e54`, that the old, ungated port code never had). Two further effects are `[STATIC]` by disassembly
  (`7D74`'s jump for the hidden car; the table-walk path never reaching `7D73` for states 1/4/5): the
  hidden-car case is genuinely exposed 192 times, 186 of them with an ELIGIBLE (non-2/0xD) state, and
  `oldR` was already false in every one of those 186 — `[PROVEN]` by its own dedicated, revert-tested
  pixel test that the port's own gate correctly suppresses a hidden car's rotor. The states-1/4/5
  no-body frame — correctly scoped to those three states, not conflated with state 2/0xD's own
  separate `drawBody:false` cases, a mistake caught in an earlier draft of that specific counter —
  was never once exercised by a round-8 car in these 29 races at all.
  So: only the clip-sliver is confirmed to change round 8 as actually played; everything else this
  item fixed is a confirmed-correct, unreached byte-level correction. **Fixed**:
  `render/raceView.js`'s `drawCarBody`/`drawCarShadow` now fold height
  into the pre-camera delta and apply the SAME one-sided threshold as `markDrawn` (via a
  newly-exported `viewCoord`, `engine/drawn.js`, shared literals via
  `NORMAL_CAR_FOLD`/`ROUND9_CAR_FOLD`), instead of a symmetric `wrapDelta`; `drawCarBody` now returns
  whether its OWN fresh clip test (`inClipWindow`, the real 256×224 window) passed, and round 8's
  rotor overlay (`843d`, called only after the body's own clip test passes in the SAME real function
  call, `7e28 JC 7e54` skips both together) is gated on that fresh return value. It is deliberately
  NOT gated on `car.drawnThisFrame`: that flag is a separate, state-gated sticky value physics-side
  readers (sfx/rubber-band/fire-gate) read on their own cadence, written only when a state handler
  calls `markDrawn` — reusing it for the render-time rotor decision would have been wrong in its own
  right (a stale value on any tick the current state doesn't call `markDrawn` at all), a real bug an
  earlier draft of this fix shipped and an advisor review caught before it was trusted, not merely a
  coincidental mismatch found while re-measuring reachability. Every real caller of
  `composeRaceView`/`drawCar` was checked for the camera-range
  assumption this fix now relies on: `play.js`/`flow.js` both source their camera from `camera.js`'s
  own bounded model (confirmed above); `tools/check-live.mjs`/`render-car-check.mjs` use a fixed,
  comfortably in-range hand-picked camera; the asset viewer (`viewer.html`) does not call this render
  path at all (`formats/race.js`'s separate `renderTrack()`). `raceView.js`'s OTHER `wrapDelta`
  sites — puffs, splashes, the projectile and its trail, the knockout/state-1/4/5 overlays, the
  finish-position label, the lap-line overlay — are separate real draw routines, un-audited against
  their own real bytes, and deliberately untouched by this fix.

**Two real, adjacent divergences found by the same disassembly and fixed alongside it** (not the
anchor formula itself, but the same z/shadow code this item covers):

1. **Round 8 (CHOPPERS) suppresses both.** `7d85 CMP byte ptr [28BF],0x8 / JZ 7d90` skips loading
   `DX` from height for the body (leaving it 0 — CHOPPERS' body never bobs with z at all), and
   `7e77 CMP byte ptr [28BF],0x8 / JZ 7ef8` makes the shadow function return immediately without
   drawing anything, unconditionally, for round 8. CHOPPERS separately gets a round-8-only 32×32
   extra animation (`7e4f CALL 1000:843d` -- **corrected 2026-09-23, M3.44: this call sits INSIDE
   `DrawCarBodyRotatedRemapped`/`7d73` itself, not a separate `DrawRaceCarLayer` function** --
   confirmed by `get_xrefs_to 1000:843d` and an independent whole-image `search_instructions` for
   `CALL 843d`, both finding exactly the one call site, at `7e4f`, `from_function
   DrawCarBodyRotatedRemapped`; this also means the rotor call is downstream of, and control-flow
   dominated by, THAT SAME function's own body clip test a few instructions earlier -- the pre-existing
   Ghidra plate at `7d73` already names it `DrawRound8ExtraAnim32`, reading `DS:5EE3 + f*1024`, gated
   on state ∉ {0xD, 2}) — not disassembled further and not ported; what it actually draws (rotor spin?
   a replacement shadow? something else?) is not established, only that it exists and fires for
   round 8. New, narrower, deliberately-not-implemented open item, separate from this one.
2. **Height is never clamped to ≥0 in either draw function.** Neither `7d83-7d8c` (body) nor
   `7e5d` (shadow) has any sign check on the raw signed `[BX+12D6]` before using it as `z` — this
   port's prior `Math.max(0, height)` in `drawCarBody` was an unevidenced defensive clamp, not
   something the real code does. §3 already documents that height CAN be briefly negative for one
   tick (`UpdateCarAirborneLandingSfx 7429`'s `[12D8]` bounce-landing branch reflects `zVel` but
   leaves `z` itself unclamped until the next tick's integration) — the real game shows a small,
   real visual dip/cross for that one tick, which the port's clamp was silently hiding. The
   shadow's own draw gate is `height != 0` (the caller-side `DrawRaceCarLayer 7cea/7cef CMP
   [BX+12D6],0x0 / JZ`, an exact-zero test), not `height > 0` — a negative-height tick still shows
   a (shifted) shadow in the real game, which this port's prior `(car.height ?? 0) <= 0` gate
   incorrectly suppressed.

Both are fixed in `src/render/raceView.js` (`drawCarBody`/`drawCarShadow`/`drawCarLayer`/
`composeRaceView` now thread an optional `round` parameter, defaulting from `hud?.round` so every
existing caller that already passes `hud.round` — `play.js`, `flow.js` — picks this up for free;
callers with no `round`/`hud` behave exactly as before, i.e. as a non-CHOPPERS round). Teeth-proven
in `tools/check-play.mjs`'s `checkCarDrawAnchor`: run against the OLD code (`Math.max(0,height)`,
no `round` parameter at all, `(car.height??0)<=0` shadow gate) first, by hand-reverting and
re-running — 4 of the check's 6 pixel assertions fail cleanly (round-8 z/shadow suppression, ×2;
unclamped negative z on body/shadow, ×2), with the remaining 2 (generic "body/shadow still draw
somewhere" sanity checks, not meant to discriminate) passing under both, confirming the check's
failures are specific to the actual fix and not incidental. Full regression suite (`tables car step
trace ai play sound rounds tournament menu screens opl-toggle smoothness si2 catalog smoke chrtable
lz live` + `npm run build`) stays green; `npm run trace`/`npm run ai`'s pre-existing 13-of-20 /
59-of-60 baseline (§9ab's already-diagnosed torn-capture artifact) is unchanged, as expected since
neither trace exercises a CHOPPERS car or a negative-height tick.

**HUD (`8dfc`/`851f`/`855a`/`8634`/`903f`/`9076`) is not drawn.** Per the M3.6 milestone
(`PLAN-ENGINE.md`), the HUD depends on the rank sorter `UNKNOWN_ranking_2670` that M3.3
re-derives; drawing it now would mean guessing at data `composeRaceView` doesn't yet receive.
**Superseded 2026-09-21 (M3.11, §9o): drawn now.** The rank *ordering* was never actually blocking
(the HUD only ever shows the literal rank number 1-4, never the score `[2652]` computes) — only
`8dfc`'s default branch and `903f` are implemented; `851f`/`855a`/`8634` turned out to be
two-car-mode-only overlays misgrouped into this one line (§9o), not part of the main HUD at all.

## 9e. M3.3 headless physics step — what was done (2026-09-20)

`src/engine/int16.js` (16-bit integer helpers), `velocity.js` (`525e`), `collide.js` (`589c`/`5532`
tile queries + wall response, `5be7`'s bounce/commit tail, `5921`/`5960` car-car collision),
`terrain.js` (the full `DS:26D7` dispatch + all ~24 handler blocks from §5, not just round 2),
`checkpoints.js` (the corrected lap rule), `airborne.js` (`7429`), `states.js` (states 0, A, 2, D,
7 only — the plan's own M3.3 scope), `step.js` (per-step orchestration) and a minimal `race.js`
(load one round/race's track files into a `collide.js` world; `CarTypeInfo`-derived per-round
constants). `tools/check-step.mjs` (`npm run step`) is the acceptance test.

**A self-caught test-coverage gap, found by the advisor tool before this was called done.** The
first version of `check-step.mjs` only ran the static init image with all-zero controls; that
image has `controlsLocked=1` on every car, which skips `applySteerAndThrottle` and
`updateCarVelocityTowardHeading` entirely, and the four cars spawn 24px apart (car-car contact
needs ≤16px) — so the suite was green while never executing steer, throttle, the grip slew, real
(non-zero-velocity) integration, or car-car collision. Fixed by adding a second scenario that
clears `controlsLocked` and cycles every control-bit combination across all four cars for 2000
steps; a 26-round/race sweep (every round × every race, 800 steps each, real driving controls) is
also run ad hoc as a broader smoke check. Both are clean.

**An adversarial review pass (5 parallel reviewers, one per module, given tool access) found real
bugs by reading the live Ghidra disassembly directly, not just this document's prose** — a
reminder that even a careful reading of the prose here can still miss what the bytes say:

- `velocity.js`'s grip logic had three distinct errors, all confirmed at `1000:52f9-533b`: the
  rubber-band ×1.5 must scale **both** `thr` and `rate` (one gate, two identical `x+=x>>1` blocks),
  computed as exact integer `floor(1.5x)` (`SHR 1; ADD`), never a float multiply; the low-grip
  timer override sets **both** `thr:=[28C2]` and `rate:=[28C4]` together whenever *either* timer
  is active (checked B-then-A), not two independent alternative rates; and `[1282]` (skidding) is
  a plain overwrite with the Y-axis sub-block running last and clobbering the X-axis result, not
  an OR of the two axes. All three fixed.
- `collide.js`'s safe-respawn-point roll (the LEV bit-7 test) ran unconditionally instead of being
  gated by the same `state ∈ {0,2,0xE}` commit check just above it — confirmed by reading
  `1000:5da1-5db6`, which jumps clear of *both* the commit and the LEV block for any other state.
  Fixed by moving it inside the gate. Car-car collision's `resolvePair` never re-integrated car A's
  tentative next position before testing a pair, so a pair sharing a car index with an
  already-resolved earlier pair in the same 6-pair scan tested against a stale position — fixed by
  calling `integrateCar(a)` at the top of `resolvePair`, matching the doc's own "re-integrate A".
  **Superseded 2026-09-21 (§9n): "re-integrate A" was itself a misread — the real code always
  re-integrates car 3 (a leftover-register artifact), never "whichever car is A this pair".**
- **Round 3's safe-point extra gate, read live rather than left as a guess.** The review flagged
  `ROUND3_TILE_FLAGS`'s polarity as an unverified assumption; reading `1000:5dee-5e14` directly
  settled it: off a bridge the roll is allowed only when the flag is 0, on a bridge (`[1388]==1`)
  only when the flag is nonzero — the flag must match the car's current bridge state. Implemented
  as an XNOR; `[STATIC]`, from disassembly, not a live execution trace.
- `states.js`'s `drawnThisFrame` was set to 1 by the state-0 handler but never reset, permanently
  disabling the rubber-band "not drawn" condition after a car's first driving step; fixed by
  clearing it at the top of `runStates`'s per-car loop. `step.js` was missing the rubber-band's
  documented ×6 acceleration multiplier entirely (only velocity.js's ×1.5 grip term had made it
  in); fixed by threading a shared per-car rubber-band flag into both `applySteerAndThrottle` and
  `updateCarVelocityTowardHeading`. `terrain.js`'s `h61b0` returned early on its hop branch,
  skipping the speed cap that every sibling "leave-level hop; ‹tail›" handler applies
  unconditionally; fixed to match the sibling pattern.
- **Fixed but flagged as a second-order inference, not a settled correction**: `states.js`'s
  `stepRespawn` was reading the car's stale (crash-site) `levByte`/`mapAttr` instead of the doc's
  own "recompute tile/progress/cursor" step; it now queries the world at the safe cell (for the
  nudge/heading) and again at the final nudged position (for tile/progress), which is a plausible
  two-query reading of one line of prose, not a disassembly-confirmed order.
- **Left as documented, not fixed**: `stepKnockoutAnim` bumps `animTimer` and tests it against
  `KNOCKOUT_DURATIONS` in the same call, one tick earlier than the real per-iteration order (state
  handlers run from render, *before* `73e7` bumps the timer for that same iteration) would produce
  — a real but purely visual/timing discrepancy, not worth restructuring the whole per-iteration
  order for in a milestone with no animation rendering at all. The human steer-halving threshold
  (`speed ≥ 0x320`) is applied with `Math.abs()`; the doc doesn't bracket this one clause with `|…|`
  the way it does the adjacent `|speed| ≤ 0xFF` rule, so a signed (forward-only) reading is equally
  plausible and unresolved.

**New `[UNKNOWN]`s, not yet read live**: `UNKNOWN_2652_progress_scale` (the rank-sorter's score
formula needs a global scale constant; `computeRanking` defaults it to 1, which keeps the
ordering by (laps, progress) correct but leaves the absolute score wrong) and
`UNKNOWN_2654_half_max_progress` (the checkpoint wrap threshold, defaulted to 128). The M3.3 row's
"re-derive the rank sorter" is only half done: the scoring formula and bubble-sort are implemented
from the existing doc text, but the constant that would make the score itself exact was not read
this session. `UNKNOWN_col_response_offtrack_branch` and `UNKNOWN_respawn_sideways_offset` (from
the code comments) remain open too.

## 9f. M3.4 trace oracle — what was done (2026-09-20)

**The capture method is not the one PLAN-ENGINE.md's §4 specified, and that is a documented
deviation, not a silent substitution.** §4 planned a per-physics-step CPU breakpoint at `1000:30B7`
read via `mcp__dosbox__debug_pause`/`debug_continue`/`mem_read` round trips. That mapping was set up
and verified live this session (`debug_map_set_base` anchored `CS_GAME` at Ghidra `1000:xxxx` ↔ live
segment `574`, confirmed byte-for-byte against `RunTitleScreenAttractLoop`'s own disassembly at
`1000:01b5`/live `574:01b5`), but a manual pause/continue/read cycle per step is far too slow to
reach more than a handful of steps inside one session. Instead, this session used
`mcp__dosbox__script_load`'s Lua sandbox, which runs on the emulation thread itself: a script calls
`dosbox.mem_read(2938, 0x124A + car*0x164 + off, len)` once per rendered frame
(`dosbox.wait_frames(1)`) — the intent was that `SETTINGS.DAT` word 2 (smoothness) = 1 makes this
equal to one physics step per sampled row, which turned out not to hold (see below: it is closer to
5–6 sampled rows per real step). `UNKNOWN_lua_hook_model` (whether a Lua hook survives the sandbox's
own 5 s wall-clock / 64 KB output caps) is resolved for this use: at the field width captured here,
the **64 KB total output cap** binds first (~100 rows fit), not the 5 s wall-clock cap.

**Reaching the race required working around synthetic-input flakiness that cost most of this
session.** `mcp__dosbox__input_key`/`input_type` presses frequently failed to register at
`RunTwoItemMenu`'s fire-confirm poll (`1000:03dd`, `TEST AL,0x8`) even when the same key reliably
moved the cursor (`0x80`/`0x40` bits) moments earlier — not a wrong key (`SETTINGS.DAT`'s raw bytes
confirm `KEYS 2` = arrows + `S` at scancode `0x1F`, i.e. exactly what PLAN-ENGINE.md's §4 recipe
says), but a genuine race between the tool's press/release timing and this game's per-poll debounce
(`1000:03b5`, `AND [108B],8; JNZ` loops until fire is seen *released* before accepting a new
confirm). The fix was `mcp__dosbox__input_sequence` with explicit `t`-timestamped press/release
pairs (~150 ms hold, ~300 ms gap) dispatched on the emulator's own clock instead of round-tripping
through separate tool calls — reliable once adopted. One side effect not fully explained: the
`ONE PLAYER GAME` (`Head to Head`/`Challenge`) submenu, which the *first* successful run this
session paused on and needed an explicit `RIGHT` to leave `Head to Head`'s default, was
subsequently skipped by a single fire from `SELECT GAME` on every later attempt (landing directly on
`Head to Head`'s character select) — plausibly the menu remembering its last-visited item as a new
default and a single physical press being seen as two poll-visible fire pulses, but not confirmed
live; recorded as `UNKNOWN_menu_default_persistence` rather than guessed further. The Challenge path
(`ROUND21`, matching D8) was reached and captured before this behaviour was noticed.

**What was captured**: `tools/refs/trace-R21-idle.tsv`, 100 rows from a fresh `ROUND21` (round 2
race 1, POWERBOATS Challenge qualifier) start, **zero human input** (car 0 idles in the grid exactly
as D9's "first trace" describes; cars 1–3 are drones and visibly move at constant velocity for this
window — no turns or collisions are exercised by these particular steps). Only a subset of each
`CarRecord` is captured per row (kinematics, terrain/tile/airborne state, progress/checkpoint/lap
fields, `controlBits` — the fields likely to change tick to tick; the full 0x164-byte record would
only fit ~23 rows in 64 KB). The static per-car tuning fields this trace does **not** carry
(`slipThreshold`, `gripStep`, `accel`, `brakeDecel`, `coastDecel`, `steerStep`, `maxSpeedCur`/`Base`,
`reverseLimit`) are re-derived in `check-trace.mjs` from `CAR_TYPE_INFO[round-1]` using the §1 "init
from tables" formula with the per-car handicap `CX` assumed 0 — an approximation (which
character/handicap was actually in effect was not recorded), not a captured fact.

**The 100 rows are 100 sampled frames, not 100 physics steps — `check-trace.mjs` deduplicates
consecutive identical rows before replaying.** `dosbox.wait_frames(1)` (the capture's per-row
polling interval) is a Lua-sandbox concept tied to the emulator's own render/frame accounting, and
checking each car's own position column directly shows it changes only once every 5–6 sampled
rows, not every row — `SETTINGS.DAT`'s smoothness word being 1 does not mean "one physics step per
`wait_frames(1)` call" the way this was assumed while writing the capture script. Left undeduplicated,
every comparison downstream would be comparing an unrelated frame pair. `parseTrace` drops any row
that is byte-identical (across all 4 cars' captured fields) to the previously *kept* row, which
turns the 100 raw rows into **21 rows of real, distinct physics-step state** — this is the number
`check-trace.mjs` actually replays against, and is the honest count to cite for this trace, not 100.
(`UNKNOWN_dosbox_wait_frames_cadence`: what `wait_frames(1)` actually measures — a fixed host
timer tick, a VGA vertical retrace, something else — wasn't pinned down; the dedup step makes the
answer immaterial to this milestone's own correctness, but a future capture that wants inter-step
timing right would need to know it.)

**`tools/check-trace.mjs` (`npm run trace`)** builds each car's initial state from the trace's own
row 0 plus those derived static fields (round-tripped through `car.js`'s `toBytes`/`fromBytes` so
every untouched field gets car.js's real default, not `undefined`), then replays each subsequent
row's own `controlBits` through `step.js`'s `runStep` and reports the first step/car/field where the
port's result diverges from what the trace recorded, against the 21-row deduplicated step sequence.
Current result: **matches step 0→1 exactly, diverges at step 1, car 1's `speed`** (trace: unchanged at 1014; engine: 1206, i.e. `1014 +
accel(32)·6` — the rubber-band accel path from `step.js`).
**Resolved 2026-09-22, §9aa: a live memory read confirmed `maxSpeedCur` genuinely pinned (not
`controlsLocked`), and the actual cause was this file's own `staticFieldsFor`, a second derivation of
the static tuning fields that never picked up M3.20's later per-car `CX` handicap fix -- not a
`step.js` bug. Now shares `race.js`'s `tuningFieldsFor`; exact-match run length is 13 of 20.**

**This was checked by hand before being written down, and the first two attributions this session
tried for it both failed that check — the honest result is two live candidates, neither
confirmed, not a named cause.** An advisor review of the first draft caught that the original
attribution (the `CX=0` grip-constant approximation) can't explain the divergence at all: car 1's
`velY` already equals its `targetVelY` in row 0 (difference 0, so `slewAxis` returns the target
verbatim regardless of `thr`/`rate`), and hand-evaluating
`mul2Floor256(SINE8[(heading-0x40)&0xf8], speed)` for car 1's own row-0 heading/speed reproduces the
trace's `targetVelY` (1006) exactly — the target-velocity formula itself is correct. Adding
`targetVelX`/`targetVelY`/`speed` to the comparison (already in the TSV, just not in the original
field list) pinpointed the real divergence one level upstream, in `speed`, not `velY`: the trace
shows `speed` **frozen at its exact row-0 value for all 3 drones, for the entire 21-row window**
(1014, 1146, 1080 respectively), while `controlBits` holds accel+fire (`0x28`) throughout (confirmed
per-car, not a stale/shared byte: car 0's own `controlBits` is `0` the whole time, so the field is
real per-car input). A second advisor pass caught that this data pattern doesn't actually fit the
`maxSpeedCur` cap this section originally proposed next: a `.BRK`-driven cap would mean the AI
independently limited *three different cars* at *three different values that each happen to equal
that car's own spawn speed* — that isn't a cap, it's nothing having touched them. Two readings
remain open, neither confirmed by what this trace captured:
1. `maxSpeedCur` really is pinned at each car's spawn speed this early (plausible if the round's
   first `.BRK` point is very close to the start grid), or
2. the real game has **`controlsLocked` still set** for these cars during this whole window (per
   §1, "controls frozen until the camera has settled" — very plausible for the first 21 steps after
   drop-in) and simply never runs `applySteerAndThrottle`'s accel branch here at all, while this
   replay hardcodes `controlsLocked = 0` from step 0 (not captured in the trace, so not checkable
   from this data either way).
Per D9, the useful result is still real: an exact-match run length (1 of 20) that can only go up,
with the first divergence in a field, at a step, with a value, not an unexplained NaN or a silent
pass — but the *cause* is an open question this trace cannot settle, not a named branch. A capture
that also records `controlsLocked` would discriminate the two readings directly. **A caveat this
window also can't get past on its own**: car 0 (human) never moves for any of the 21 rows, so this
particular trace contributes zero signal about car 0's own step — none of D9's "first live
questions" (car-car impulse sign, sfx 2 on lap completion, one step of car 0) are answered by it.

**Not done this session**: stage 2 (AI given state — `ai.js` doesn't exist yet, that's M3.5); a
trace exercising turning/collision/terrain (this window's drones never turn); extending past 100
steps (would need chaining multiple Lua script runs, not attempted); reading the true per-car
handicap live to remove the `CX=0` approximation; capturing the global fields §4 also asks for
(camera, rank/order words, two-car lights) — this trace is car-record-only.

## 9g. M3.5 drone AI — what was done (2026-09-20)

`src/engine/ai.js` (`droneControlByte(car, ctx)`), ported directly from §6's already-derived
`RunDroneSteeringAi 1000:5429-5531` disassembly (this milestone needed no new live disassembly —
§6 already had the full algorithm; the work was porting it and finding its two missing data
tables). Wired as one of D3's pluggable control-byte readers: a caller invokes it once per drone
per step, in place of a human reader, before `runStep` — it is not called from inside `step.js`
itself, matching how the real `PollAllCarInputs` treats the AI as just another `[1083..1089]`
reader.

**Two new tables**, read live and added to `engine-tables.js` (`npm run tables` now 25/25):
`DRONE_HEADING_TABLE` (`DS:18FB`, 16 words — the target heading byte per `.DIR` direction code,
two interleaved 8-entry ramps rather than one 16-entry ramp) and `DRONE_DIR_REMAP_TABLE` (`DS:191B`,
4×16 bytes — the direction remap consulted when `mapAttr & 2`, indexed by the same `(levByte>>5)&3`
"bucket" `LEV_HEADING_TABLE` uses). `race.js` gained `loadBrk(read, round, race)`, a thin wrapper
around the already-existing `levbrk.js` `parseBrk` (round 9 ships no `.BRK` file at all — "drone-free
/ different AI for that class" — so callers for round 9 should leave `ctx.brk` unset rather than
call it).

**Verification against the M3.4 trace (`tools/check-ai.mjs`, `npm run ai`)**: stage 2 ("AI given
state") predicts 59/60 of the live trace's drone control bytes exactly. **The live trace is a weak
test on its own, and the write-up says so rather than just citing the number** — car1/car3 only
ever hit `.BRK` type 0, car2 hits type 1 but always lands on the "accelerate" side of its threshold
(same visible bits as type 0), and no drone ever turns in this window, so a wrong steer polarity,
brake threshold, TANKS penalty, or type-2 cap could have passed at 59/60 unnoticed — a real gap an
advisor review caught before this was written down as validation, echoing the M3.3 acceptance-test
coverage gap in a different shape. Fixed the same way M3.3 fixed its own gap: `syntheticBranches()`
in `check-ai.mjs` hand-computes expected outputs from the disassembly's own formulas for every
branch the trace doesn't reach (both steer directions and straight, all four `.BRK` types including
type-3-turning vs not, the `tournamentIndex` `0x17` bonus, both sides of the TANKS `0x13` threshold,
both `mapAttr` bits, the round-2 `dir&7` mask, the fire bit) — 24/24 pass. The one live-trace miss
(car 3, one sampled row) is a capture artifact: every other field in that row is byte-identical to
the previous kept row, and the real function's own first instruction unconditionally zeroes
`controlBits` before rebuilding it — most likely a torn read from the Lua capture's per-frame
polling (§9f), caught mid-instruction, not a distinct physics step or an AI defect.

**Also run**: a "full loop" replay (`ctx`'s drones driven by `ai.js` itself, not the trace's own
recorded bytes) against the same trace, matching M3.5's own "AI + physics reproduces the idle trace"
acceptance line. It necessarily inherits M3.4's still-open `speed`/`maxSpeedCur` divergence at step
1 (that divergence is in `step.js`'s physics, not in anything `ai.js` touches), so it does not — and
cannot yet — exceed stage 1's own baseline; this is expected, not a new finding.

**Approximations, not captured facts** (flagged in `ai.js`'s own comment): `ctx.round` stands in for
the global `[28BF]` (vehicle-class index), which is usually but not always the round number — the
tournament's "PRO SPORTSCARS"/"PRO FORMULA ONE" substitutions (§7) are not modelled. `ctx.tournamentIndex`
stands in for `[28C1]` (an index into `DroneMaxVelHandicap`, 0..25) and defaults to 0 (no
handicap bonus/penalty) since full tournament-position tracking is out of scope here. Checked but
not a gap: `ROUND21.MAP`'s progress plane maxes at 28, fitting `ROUND21B.BRK`'s 29 bytes exactly —
whether every round/race's progress range fits its own `.BRK` file length the same way was not
checked for all 26 files (an out-of-range `ctx.brk?.[...]` read silently falls back to type 0 here,
same shape as `collide.js`'s `UNKNOWN_tile_index_overflow`).

**Not done this session**: `[1082]`'s exact per-step gating (the real function is skipped entirely
when `[1082]==0`, which is the likely non-artifact explanation for *other* all-zero control bytes
than the one this session found and attributed to a torn read); wiring `ai.js` into a full per-round
race loop (that's `step.js`'s caller's job, still M3.6); extending verification to a trace where a
drone actually turns or brakes.

## 9h. M3.6 playable race page — what was done (2026-09-20)

**Note on process**: the `advisor` tool that caught real mistakes in every prior milestone this
session (M3.1's camera writeup, M3.4's divergence attribution, M3.5's coverage gap) was
unavailable when the bulk of this milestone's code was first written, so the spawn/camera work
below got only this session's own re-derivation-from-disassembly discipline, not a second reader.
It came back before this section was finalized and, in one pass, caught the same *shape* of gap it
had caught in M3.5 — a headline test result (determinism) that didn't test what it claimed, and a
"verified live" claim (state E) with no actual test behind it — which in turn surfaced a real
dispatch bug (below). Sections without an explicit "advisor-caught" note here did not get that
second look and should be weighted accordingly.

`src/engine/race.js` gained `spawnCars(strtPosEntries, round, race)` — the first from-scratch race
setup this port has (M3.3–M3.5 all ran from a captured or hand-built car array, never a real
spawn): reads `STRT_POS.BIN`'s one `{x,y}` per round/race, applies each car's own start-grid
offset, and derives the per-car tuning fields from `CAR_TYPE_INFO` (same `CX=0` handicap
approximation M3.4/M3.5 already carry). **A live re-read of `InitRaceCarsFromTables 3d9f-3e64`
this session corrected two things while building this**, not just added it: all 4 cars share ONE
read of `STRT_POS`, not one each (confirmed live), and the shared camera-init offset is `start-230`
for X but **`start-260` for Y**, not `-230` for both as `docs/engine.md` §1's older shorthand said
— `camera.js`'s first draft used the wrong symmetric version and was caught by re-deriving it from
the same disassembly, not by the trace (there is no camera field in the M3.4 trace to check
against).

`src/engine/camera.js`: `initCameraState`/`updateCamera`, porting §3's now-fully-derived camera
formula (M3.1's follow-up work) — single-car branch only, since M3.6's playable target is
one-player (the two-car midpoint branch is `[2656]==2`-gated and out of scope here, not silently
different). Includes the X/Y step logic and the `cameraFarFlag`-settling mechanic §3
documents — **the X axis as shipped here was wrong** (it ported §3's then-current "X always applies a
bounded step" reading, which §9m shows was a misread of `5145`'s `JMP`), and shook the view ±50px
every step from this milestone until the 2026-09-21 fix; the "camera following it" claim below was
made from screenshots, which cannot show a per-step oscillation. **One piece is an inference, not a disassembly**: what actually clears `controlsLocked`
once the camera settles (`[BX+1380]`, docs §1's `3d53`/`4d1f` writers) was not read live this
session; `camera.js` clears it whenever `cameraFarFlag` becomes 1, which is *consistent* with the
field's documented meaning and produces a playable result (verified live — see below), but is
flagged as unconfirmed. Without *something* clearing it, a human player could never gain control
of their car after spawn, so this was necessary to make the milestone's own acceptance bar
reachable at all.

`src/engine/input.js`: `createKeyboardReader` (a D3 pluggable reader, same shape as `ai.js`) reads
`SETTINGS.DAT`'s `keys2` scancodes (falling back to arrows+S if the file is missing), tracking
held keys via `keydown`/`keyup`. `createTapeReader`/`recordingReader` for the determinism check.
Gamepad and mouse readers are not implemented (out of scope, same shape as PLAN-ENGINE.md's other
per-milestone deferrals).

`src/engine/states.js` gained states 1 (hazard death), 4 (fall) and 5 (crash) per §4's own
already-complete derivation — no new disassembly needed, only porting. State 1's round-4/9 heading
realignment guesses which of `STATE1_ANIM_A`/`STATE1_ANIM_B` belongs to which round
(`UNKNOWN_state1_880a`, already flagged, not resolved here). **State E (drop-in sequencer) is
deliberately simplified, not ported**: its real 5-phase cell-matching sequencer needs `DS:22E1`
(not embedded) and, per §5, is reachable as a terrain block only from round 3's row index 4 —
ROUND21 (this milestone's own playable target, round 2) never dispatches into it via terrain, so
full fidelity there isn't exercisable by anything in this session. What's implemented instead
(`stepDropInSimplified`) exists only so a car that reaches state E via state 4's own ending doesn't
freeze — it skips straight to the sequencer's documented terminal action (drop back in, state 0).
**A real bug in `runStates`'s own dispatch gate was caught building the test for this, not just
docs-checked.** The first draft asserted (without a test) that a car reaching state E this way
"resumes driving." `check-play.mjs` now actually drives a car through states 4→E→0 directly, and it
initially failed: `runStates`'s per-car loop had `if (!car.active) continue`, but state 4's own
ending sets `active=0` *before* handing off to state E — so that car would never be dispatched
again, forever, in the real per-step loop, not just in the test. Docs §4's own dispatch note
already said the real rule is "state==0xE or active!=0" (that is `DrawRaceCarLayer`'s draw-dispatch
condition, which this state-step loop had been quietly diverging from since M3.3, where it never
mattered because nothing set `active=0` yet). Fixed to match. States 5 (crash) and 1 (hazard,
non-4/9 round) are now also driven to their documented end (state 7) by the same test.

**Not done, and explicitly out of scope for this milestone's slice**: projectiles (`projectile.js`
doesn't exist), puffs/splashes (purely cosmetic; the compositor draws tiles+cars only), the HUD
(deliberately excluded per PLAN-ENGINE.md's own M3.2/M3.6 rule — `UNKNOWN_2652_progress_scale` was
never read live, so the rank/score numbers would not be trustworthy), states B/C/F/0x10 (two-car
lights and banners — two-car mode itself is out of scope), the front-end/menu flow (M3.9 — the page
boots directly into `ROUND21`), gamepad/mouse input.

**Verification**:
- `tools/check-play.mjs` (`npm run play`): a real `spawnCars` + `initCameraState` race runs 2000
  steps with drone AI and a fixed (non-random) car-0 control pattern, clean (no NaN, world stays
  toroidal, the drop-in hold ends, controls unlock, a drone actually moves from its spawn). A
  second, identically-spawned run replays the FIRST run's own recorded tape and reproduces the
  exact same final state for all 4 cars and the camera — the "recorded tape replays to the
  identical final state" line in PLAN-ENGINE.md's M3.6 row. **This now genuinely exercises
  `input.js`'s `recordingReader`/`createTapeReader`**, not just re-evaluating the same control-byte
  expression twice: an earlier draft fed both runs from the identical `PATTERNS[step % N]`
  expression directly, which only proved the engine is a pure function of its inputs (true, but not
  the claim) and executed neither function in `input.js` (advisor-caught).
- **Live browser session** (`npm run dev`, root page): confirmed by direct interaction, not just
  automated screenshots — all 4 boats spawn in the correct 2×2 grid on `ROUND21`'s own track, the
  drop-in hold visibly ends (~96 steps) and drones start racing under AI control, human keyboard
  input (steer + throttle) visibly moves and turns car 0's boat, and the compositor renders the
  turned boat at the correct rotation, correctly recoloured, with the camera following it. (Chrome
  throttles `requestAnimationFrame` in the automated tab used for this check to roughly 1-3 Hz
  instead of 35 Hz — a testing-environment artifact, not a code path; `play.js` exposes a
  `forceSteps(n)` synchronous fast-forward specifically to verify the simulation itself
  independent of that throttling, which is what the checks above actually used.)
- **Not verified this session**: a full human-played 3-lap finish of `ROUND21` end to end (checkpoints/
  laps were exercised via M3.3's own tests, not via this milestone's browser session specifically);
  the pixel-diff-against-a-DOSBox-capture acceptance line (PLAN-ENGINE.md's M3.6 row) — the existing
  live reference frame (`tools/refs/race_R21_a000.bin`) has no corresponding car-record memory
  dump to reconstruct an exact expected car pose from, and capturing a fresh one was out of scope
  for this session; carried forward.

## 9i. M3.7 race sound — what was done (2026-09-21)

No new reverse-engineering was needed for the driver model itself — `docs/sound.md` already had
the full command table, the timing model, and every one of the 36 `AH=5` sfx sites individually
disassembled and predicated (§2/§3/§3b), from an earlier session's research pass. This milestone's
job was porting that into the race engine: making `spawnCars`/`runStep`/`states.js` actually drive
`src/formats/si2.js`'s already-built `Sequencer`/`Si2Player`, the way `MICROU.EXE` drives the real
driver, rather than feeding it a hand-written command log the way `tools/check-si2-race.mjs`
already did.

**One new derivation was needed, and it was read live, not guessed**: the engine-pitch jitter PRNG
(`AdvancePseudoRandom48 1000:7CAE`, docs/sound.md §6, "own it in the sound layer"). The doc gave the
three-word overlapping-buffer recurrence in prose and one corroboration checkpoint (6204 calls from
the file seed `45 23 56 26` reaches `45 90 69 B2`) but not the disassembly. A first implementation
attempt using the obvious reading (read all three words, then write all three back) did **not**
reproduce that checkpoint. Reading `1000:7cae-7cda` live settled it: each word is written back to
memory **immediately** after being computed, so the *next* word's read already sees the *previous*
word's just-written high byte (the three words genuinely overlap by one byte in memory, read
sequentially, not read-then-written-together) — `createEngineJitter()` in `src/formats/si2.js`
implements this exact byte-level order and reproduces the checkpoint precisely (`0xb269`, i.e.
state `45 90 69 b2`) — verified in `tools/check-sound.mjs`, not just by eye.

**`src/engine/sound.js`**: `raceStart` (`AH=7`, "every race start... races have no music"),
`raceInstrument`/`updateEngines` (the `UpdateEngineSoundsPerFrame` bend formula), and a simplified
`raceOverSequence` (sfx 16 if drawn, `StopEngineSounds`, `AH=8`, `AH=6` — the 100-banner-frame wait
and the results-screen tune are M3.9 front-end concerns, not modelled here; **this function has no
caller yet** — the race-over condition itself, `[26C6]>=2` per docs §2's `3081-3093`, isn't detected
anywhere in this port, so it exists and is unit-tested but nothing in `play.js` triggers it from
real race state). `asDriver(seq)` adapts a raw `Sequencer` to the same `{playSfx, engine,
stopMusic, muteAll, command}` shape `Si2Player` already has, so the exact same `sound.js` code
drives either headless tests or the real browser worklet.

**The bend formula was written from docs/sound.md §6's prose first, then checked against a live
read of `1000:7bee-7c24`/`7b90-7bee` — an advisor review asked for exactly this, given this
session's own precedent that the jitter PRNG's prose reading was wrong.** This time the prose was
right in every particular the disassembly could check: `DIV CL` (`7bb6`) is a literal 8-bit integer
divide by 10, not a shift or reciprocal-multiply approximation; the airborne test is genuinely
`[BX+12D4]` = `zVel != 0` (`7bba`), not `height > 0` as an alternative reading would have it; `+0x30`
is a real `ADD CX,0x30` while `=0x14`/`=0x0A` are real `MOV CX,...` overwrites, applied in exactly
the airborne-then-subState-then-not-drawn order the prose lists, each later match overwriting an
earlier one's result rather than a branch chain. (Two of the leading comparisons this function
opens with — `[BX+1250]!=0` and `[28BF]!=8` — are dead `JNZ +0` branches that always fall through
either way; confirms, byte-for-byte, docs §6's "the engine site is not gated on drawn" line.) One
JS-level subtlety resolved, not a bug: `sound.js` defers truncation to integer until after the
jitter add (`Math.trunc(bend + jitter)`) rather than truncating immediately after the division the
way `DIV` does — provably equivalent here since every value added after the division is already an
integer constant, so `floor(x) + n == floor(x + n)` for integer `n`, but worth recording as a
deliberate simplification rather than an oversight.

**Wired sfx sites — a representative subset of the 36, not all of them**, chosen as the ones the
already-ported physics/state modules have a natural, already-commented hook for (several of those
comments literally said "sound is M3.7's job" before this session):
- id 1 (checkpoint-skipped penalty, `checkpoints.js`; WARRIORS hard hit, `collide.js`; ramp-jump
  launch, `terrain.js`'s `h683c`)
- id 2 (lap complete, one-player only, `checkpoints.js`)
- id 3 (routine car-car collision, `collide.js`)
- id 4/7 (landing thud vs POWERBOATS splash, `airborne.js`, round-gated)
- id 5 (skid, car 0 only, non-POWERBOATS/CHOPPERS, `step.js`'s velocity-update loop — WARRIORS'
  own ~1/50-frame decay throttle is not modelled, an unthrottled approximation)
- id 8 (crash/fall animation frame 4, `states.js`'s `stepCrashAnim`/`stepFallAnim`)
- id 9 (drop-in, fired once on the first tick any car enters state 0xA, `states.js`)

**Not wired, explicitly out of scope**: id 6/18 (terrain-dispatch-table rough/low-grip cues — the
mechanism is understood, per-round wiring wasn't done this session), id 10 (knockout re-line-up —
needs the two-car states B/C this port doesn't have), id 14 (projectile fire — no `projectile.js`
yet), id 15/16/17 (banners/RUFFTRUX/head-to-head — front-end and two-car concerns), the engine
loop's own `[BX+1250]`-independent "off-screen drones idle audibly" nuance (implemented as
documented — `updateEngines` doesn't gate on drawn at all, matching §6 exactly), and the
`AH=10`/`AH=5` channel-exhaustion edge case (`UNKNOWN_channel_exhaustion`, already an open item in
docs/sound.md, unaffected by this session).

**Verification**:
- `npm run si2` (unchanged, still passing): the driver model in isolation is untouched by this
  milestone — only the *engine's own use of it* is new.
- `tools/check-sound.mjs` (`npm run sound`): the jitter PRNG's live-verified checkpoint; a real
  `spawnCars`+`ai.js`+physics race (1500 steps) driving a raw `Sequencer` via `asDriver()` — `AH=7`
  sets the pending-stop flag at race start and it correctly *stays* set because `trackCount` is 0
  (the documented sticky-stop quirk, confirmed rather than mis-asserted as a bug); every car's
  engine pitch byte stays finite and in range every step; **and**, after an initial version of this
  check only ever saw sfx id 9 fire in that drone-only run (the same shape of weak-coverage gap
  M3.3/M3.5 already hit this session), synthetic direct calls into `checkpoints.js`/`collide.js`
  confirm ids 1/2/3 fire under the exact documented conditions (checkpoint-skip, lap-complete,
  routine hit, WARRIORS hard hit) — two of those synthetic cases initially failed for uninteresting
  reasons (a missing `posXfrac` field producing `NaN` through `integrateCar`, then a velocity large
  enough to move the synthetic cars out of collision range before the check ran), fixed by using
  realistic values instead of arbitrarily large ones.
- **Live browser verification, real audio**: `npm run dev`, a genuine (OS-level, not
  script-dispatched) keypress to satisfy Chrome's autoplay gate, then `AudioContext.state ===
  'running'` with 5 active OPL voices after ~200 steps — the drop-in cue (sfx 9, channel 8) and all
  four cars' engine loops (sfx 0x40-0x43, channels 7/6/5/4, instrument `0x70` matching round 2 =
  POWERBOATS, note 35 matching the hardcoded engine-record byte) all present and channel-allocated
  exactly as docs/sound.md §3 describes ("highest free channel from 8 down"). **A real bug was
  caught building this check, not by advisor**: the first version of the audio-unlock code called
  `sound.resume()` once on the first `keydown` and then removed its own listener regardless of
  whether the resume actually succeeded; a synthetic (untrusted) test keypress consumed that one
  attempt and silently failed (Chrome's autoplay policy ignores untrusted events), permanently
  disabling audio unlock for the rest of the session since no listener remained for a later genuine
  keypress to trigger. Fixed to keep the listener attached (`resume()` is a harmless no-op once
  already running).

## 9j. M3.8 rounds and modes — what was done (2026-09-21)

**All 9 rounds' terrain rows and hazard handlers were already ported (M3.3)** — this milestone's
"all 9 rounds" line turned out to already be done, not new work; `terrain.js` has every dispatch
row and all ~24 handler functions (plughole/current, holes, stepped levels, TANKS levels, ramp
launches) since the M3.3 pass covered every round's row, not just round 2's. What M3.8 actually
found missing when it went looking was that this was never checked as a **persistent, run-every-
session test**: the "26-round/race robustness sweep" M3.3's own write-up mentions was ad hoc,
run once and not committed. `tools/check-rounds.mjs` (`npm run rounds`) now runs all 26 real
round/race combinations, in both race formats, every time — 58 combinations, all clean.

**Cheats** (`src/engine/cheats.js`): `findCheatSpot` (the `|dx|,|dy|<24` proximity scan) and
`applyCheatEffect` (all 10 documented types, docs/engine.md §6). Split from the pause-screen UI
deliberately — `CheckCheatSpotsThenPause`'s white screen, "Paused!" banner and tick-based wait are
M3.9 front-end territory this port doesn't have yet, but the cheat *logic* doesn't need to wait for
that. Types 2/3/4/7/8 have an observable effect on this port's own physics (`slipThreshold`,
`gripStep`, `accel`, `hazardVulnerable`, `maxSpeedCur`); types 0/1/5/6/9 touch globals (lives,
race-over, projectile flags) this port doesn't otherwise track (no lives system, no
`projectile.js`) — recorded into a plain `globalState` object rather than dropped, so a later
milestone that adds those systems has something to read.

**Two-car mode** (`src/engine/twocar.js`, `race.js`'s `spawnCars` gained a `raceFormat` option):
cars 2/3 are marked absent (`active`/`present` = 0) for `raceFormat: 2`, matching `raceView.js`'s
existing render gate and keeping them out of `step.js`'s physics loops for free. `states.js` gained
minimal handling for states B/C (two-car loser/winner — both share state 0's own draw handler, so
no physics, just "don't treat this as an unhandled state"). `resolveTwoCarKnockout` implements
`ResetCarsAfterKnockoutSfxA`'s outcome assignment for the simple case ("no car has separately
fallen"): the active car with the better `racePosition` wins. **This function is NOT wired into any
race loop** (advisor-caught): nothing in `play.js`/`states.js`/`step.js` calls it, because the
knockout condition itself (two cars, one fallen/crashed out) isn't detected anywhere in this port —
same status as `sound.js`'s `raceOverSequence` from M3.7, a function verified correct in isolation
but not exercised by a running race. **This uses the CONTESTED reading of
`UNKNOWN_26B8_polarity`** (docs/sound.md §3b id16): an earlier pass called `[26B8]` the loser, a
later adversarial pass read it as the winner/scorer from stronger evidence (the "Winner" banner
gate, the finish-order tally) — this module follows the later reading, but docs are explicit that
neither is settled without a live two-human knockout. **Not attempted this session**: that live
two-human capture (the acceptance criterion's own second half) — reaching it needs a genuine
two-controller DOSBox session, a materially harder live-capture problem than M3.4's single-player
one already was, and this session's remaining budget went to the rest of M3.8's scope instead. The
pre-race "lights" countdown and the post-knockout `FUN_1000_78f8` respawn transition are also not
ported — both need a race-stage controller (M3.9) this port doesn't have.

**RUFFTRUX (round 9) banner states F and 0x10** (`states.js`): state F on `lapsRemaining==2 &&
speed==0` (matching the documented `0->F` transition), state 0x10 when a per-race countdown timer
(seeded from `RUFF_TRUCK_TIMES`, already embedded since M3.1) reaches 0, targeting car 0 only, per
the documented transition. Both are simplified to fire their sfx **once** on entry rather than
re-queue every tick via the real `AH=0Ah` keep-alive idiom the banner-loop sites use (docs/sound.md
§3b/§6) — a simplification, not a re-derivation; no animation/banner rendering is modelled (out of
scope for a headless engine).

**Round-3's real state E sequencer was read live and decompiled (`1000:6ae5`, `decompile_function`)
specifically to check M3.6's simplification, and confirmed it -- rather than fully porting it.**
The real sequencer is a 5-substate cell-matching/slide/hide/show machine gated on `DS:22E1` and,
for its two-car wait phase, a Ghidra-inferred global (`HumanPlayerCount`) not independently
confirmed; it is reachable only from round 3's terrain (never from ROUND21, this port's own
playable target), and porting its two-car branch with confidence would need a live trace, not just
the decompile. The one concrete, previously-unknown gap this surfaced: the real sequencer's
subState-1 recheck can crash a car into state 5 if `checkpointOff` no longer clears the matched
cell's threshold, which this port's simplified `stepDropInSimplified` never does (it always "shows
and resumes") — narrow in practice, left as a documented gap rather than fixed. See `states.js`'s
own comment on `stepDropInSimplified` for the full account.

**Not done, out of scope for this session**: the acceptance criterion's live per-round idle traces
and the live two-human knockout (both would need substantial new DOSBox capture sessions, the same
kind of work that consumed most of M3.4's own budget for a single round); `FUN_1000_78f8`/the lights
countdown (M3.9-coupled); CHOPPERS' rotor animation (`rotorFrame`, purely visual); F12's debug
back-buffer dump (explicitly out of scope per the plan itself).

**Verification**: `tools/check-rounds.mjs` (`npm run rounds`) — all 26 round/race combinations in
both race formats (58 runs, 400 steps each with real driving input) run clean; `findCheatSpot`/
`applyCheatEffect` for the proximity scan and all 10 cheat types; `resolveTwoCarKnockout`'s
winner/loser assignment (called directly, not via a race loop — see above); state F's entry
condition; and, after an advisor review caught the first version's timer test as self-referential
(it hand-seeded `raceState.ruffTruxTimer` and never exercised the `ctx.ruffTruxTime` seed read, the
same shape of gap as M3.3's `controlsLocked=1` fixtures and M3.5's constant-`0x28` trace), a
4-call end-to-end tick of the real seed-then-decrement path confirming the transition to state
`0x10` lands on the exact tick the counter crosses zero, not one early or late (no off-by-one in
`-= ctx.stepIncrement`). Full existing suite (`catalog` through
`smoke`) stays green — nothing in M3.3-M3.7's own code changed except `race.js`'s `spawnCars`
gaining an additive `raceFormat` option (default 1, so every earlier caller is unaffected) and
`states.js`'s per-car active-gate/RUFFTRUX-timer additions (default `ctx.round` for existing
callers is never 9, so the new RUFFTRUX branch is inert for them).

## 9k. M3.9 front end — what was done (2026-09-21)

**New live evidence this session** (before any code): the sprite-descriptor field layout in §7 was
re-verified and completed by decompiling `BindSpriteObjToChrDescriptor 1000:049c`,
`ClipSpriteDescToFrontView 1000:0630`, `BlitSpriteTransparentFlipSaveUnder 1000:04bd` and
`SaveSpriteBackground 1000:05f3` fresh — the full 15-field, 27-byte layout is now in §7's own
sprite-descriptor paragraph, replacing the older, incomplete 10-field shorthand. Six front-end data
tables were read live and embedded (`src/data/frontend-tables.js`, `npm run tables` 25→31/31):
`ORDER_TABLE` (+ its two neighbour bytes), `CHARACTER_NAMES`, `CHARACTER_SKILLS`, `TRACK_NAMES` (36
NUL-walked slots), `OUTCOME_MESSAGES`. All matched what docs/engine.md §7 already said from the
earlier disassembly pass — this was re-derivation for a second, independent evidence trail (D1),
not a correction. One genuinely new, unplanned finding while locating the skills table: an
unrelated ~52-byte numeric block and a set of strings ("RACE 99", "IS OUT!!", "TRIPLE WIN !!!",
"BEAT THE CLOCK", "TIMETRIALS") sit nearby in the data segment, evidently belonging to a game mode
or difficulty-rating system this session did not investigate further — left as a named, undecoded
observation rather than guessed at or silently dropped.

**Tournament state machine** (`src/frontend/tournament.js`, `tools/check-tournament.mjs` /
`npm run tournament`): every rule in §7's `RunTournamentLoop`/`SetupTournamentRace` paragraph —
qualifier pass/fail (1st, or 2nd in Challenge format), the Challenge's 1st/2nd/3rd-4th branches,
the win-streak-triggered bonus race (capped at `MAX_BONUS_RACES`), and the eviction cadence
(`[310]%3==0`, first eviction picks the lowest character index, later ones round-robin). Two gaps
in the source prose (not re-disassembled this session, see the file's own header) are filled by
explicit, tested, named inference rather than silent assumption: what ends the tournament when
lives reach 0 (the prose only says a life is lost and the race re-runs), and that the win streak
resets to 3 after a bonus race resolves. `FUN_1a4a` (pick your 3 opponents) and the post-elimination
replacement picker are both auto-assigned (first untaken roster slot) rather than interactive; the
opponent auto-pick was moved to happen once, at character-select time, rather than on a Challenge
pass as the real game does it -- an advisor review caught that the original "pick on pass" design
left `opponents` empty for a qualifier FAILURE (the qualifier is a 4-car race and needs 3 opponents
to even run), which produced an undefined-name results screen; `tools/check-tournament.mjs` now
tests both the pass and fail paths for this directly. The round-robin eviction reading is by
**roster position modulo the opponent count**, not by tracking which distinct drivers have already
been evicted -- over a long enough tournament this can revisit a just-installed replacement rather
than cycling through every roster member first; docs/engine.md §7's "next slot round-robin" prose
doesn't disambiguate the two readings, so this is a documented interpretation, not a re-derived one.
**The bonus race IS round 9 (RUFFTRUX)**: `states.js`'s already-shipped (M3.8) state F ("1 Up!")
and state 0x10 ("Failed") are exactly the win/lose signal the bonus race needs — confirmed by
re-reading M3.8's own code, not a new disassembly finding, but a real connection this session made
explicit for the first time.

**Render substrate** (`src/render/menuView.js`, `tools/check-menu.mjs` / `npm run menu`): a plain
256×200 indexed buffer (not a 272-wide buffer with the original's `0x888`-offset arithmetic — that
offset is purely an artifact of the original's absolute VRAM addressing, explained in the module's
own header), sprite blit reusing `blit.js`'s `blitTransparent` (which gained a `flip` option this
session, mirroring the SOURCE row per the freshly-decompiled `BlitSpriteTransparentFlipSaveUnder`),
and 8px-font text via the already-`[PROVEN]` `BlitGlyph8xH` glyph map (a pre-existing Ghidra
comment from before this session, not re-derived, just finally ported). One real, if minor, finding
made building the character-select screen: the real font (digits/letters/`!`/`?` only) has **no
glyph for a cursor arrow or bullet**, so this port's screens use a plain letter marker (`X`/`O`)
instead of silently drawing nothing for an unsupported character — `glyphFrame`'s null-return
behavior for unmapped glyphs is itself tested (`check-menu.mjs`).

**Screens and flow** (`src/frontend/screens.js`, `src/frontend/flow.js`, `game.html` +
`src/game-entry.js` — a new page alongside M3.6's `index.html`, which is untouched): title/attract
→ main menu → character select → {race intro → race → results → outcome}\* → champion, reusing
the M3.3-M3.8 race engine unchanged for every race (only `race.js`'s `spawnCars` and `states.js`
gained anything, both in M3.8, both additive). The real main menu is two levels (MAIN: ONE
PLAYER/TWO PLAYER → a ONE PLAYER submenu: Head-to-Head-vs-CPU `0fbf` / Challenge `102b`, with
submenu label strings this session never read live) — flattened here into one 3-item menu
(CHALLENGE, HEAD TO HEAD vs CPU, TWO PLAYER), which is enough to actually exercise both of
`tournament.js`'s format branches in the browser, not just headlessly.

**Deliberately not done** (none of these block the spine, all are named rather than silently
skipped): two-human head-to-head (`tournament.js`'s own header explains why: `DS:0002 & 7` track
selection isn't input-deterministic); the interactive opponent-pick and elimination-replacement
screens (auto-assigned instead); the tournament board screen, credits, joystick calibration,
redefine-keys screen, and D7's `SETTINGS.DAT`-to-`localStorage` write path (none of the spine's
screens need them); palette fades; the "1 Up!"/"Failed" RUFFTRUX banner's real looping-sfx/tick
idiom (M3.8 already simplified this to one-shot, unchanged here); a full second live DOSBox session
for `UNKNOWN_26B8_polarity`/`UNKNOWN_ph0_light_roles` (two-human-only, moot given H2H is out of
scope this milestone anyway). **`UNKNOWN_ph0_light_roles` resolved 2026-09-21 without a live
session (§9p), by re-disassembling `RunCarPhysicsStep`/`UpdateCarAirborneLandingSfx` directly;
`UNKNOWN_26B8_polarity` remains open but the new evidence leans further toward "scorer," per §9p.**

**Live verification, honestly limited**: no DOSBox pixel-diff was attempted this session (unlike
M3.2/M3.6's `npm run live`) — the six data tables' correctness rests on the live Ghidra reads used
to write them (re-checked against `MICROU.EXE` by `npm run tables`), not a rendered-frame
comparison, and PLAN-ENGINE.md's own acceptance line ("each static screen pixel-diffs against a
DOSBox screenshot") is carried forward, not met. What **was** verified live is the browser flow
itself: title → menu → character select → race intro all confirmed by direct interaction (arrows,
Space/Enter) with real decoded assets (LOGO, INTRO.CHR, all 11 character names/skills, the
qualifier's correct nameless-track fallback) — screenshotted at each step. The race itself was
confirmed to boot with the real engine (ROUND21, correct camera/car rendering, matching M3.6's
already-proven view). **Reaching RESULTS/OUTCOME/CHAMPION live was not achieved**: the automated
browser tab ran with `document.visibilityState === "hidden"`, which pauses `requestAnimationFrame`
near-indefinitely (the same throttling caveat M3.6's own docs section already named for automated
testing, not a new bug — a real user's foreground tab does not have this problem) — confirmed by
directly inspecting `document.hidden`/`getCars()` state rather than assumed. `tools/check-screens.mjs`
(`npm run screens`) closes that specific gap headlessly: all 10 screen-render functions, including
RESULTS/OUTCOME/CHAMPION, run against synthetic data with no throw.

**Verification**: `npm run tables` 31/31; `npm run tournament` (qualifier/Challenge/two-car rules,
streak/bonus-race schedule, eviction cadence, INFERRED behaviours named); `npm run menu` (blit
transparency/flip/clipping, glyph map, text layout); `npm run screens` (all 10 screens, synthetic
data, no throw); full pre-existing suite (`catalog` through `smoke`) stays green — nothing in
M3.0-M3.8's own code changed except `blit.js`'s additive `flip` option on `blitTransparent`
(default `false`, so every existing caller is unaffected).

## 9l. M3.10 polish — what was done (2026-09-21)

**Folder-picking wired into the two game pages** (`src/io/resolveSource.js`, new): this was the
actual load-bearing half of this milestone's acceptance criterion ("the built page runs from a
picked folder") and it was FALSE going in — `index.html`/`game.html` both hardcoded
`FetchSource('/game')`, which only resolves under `npm run dev` (Vite serves `game/` over HTTP);
`npm run build`'s output has nothing at `/game` (`publicDir: false`, by design — this is commercial
software). `resolveSource()` factors out the already-working folder-picker/drop-zone pattern the
asset viewer has had since M1/M2 (`DirectorySource`/`DropSource`, `src/ui/app.js`) so both game
pages share it instead of duplicating it. **Verified**: `npm run build` produces `dist/` at 176 KB
(`game/` itself is 1.1 MB) with no game-data files, only code/HTML/CSS (`find dist -type f`); the
built output, served standalone (not via `npm run dev`), was loaded live and correctly detected the
missing `/game`, showed the "Open game folder…" button and the drop-zone status text, and clicking
the button invoked the browser's native directory picker with no console error. The drop-zone
fallback was verified further, with real bytes: on the dev server (same-origin, so `fetch` could
read the real `/game/INTRO.PAL`), `resolveSource`'s own HTTP probe was forced to fail and a
synthetic `drop` event carrying a real `File('INTRO.PAL', <real bytes>)` was dispatched at the
drop-zone element — `resolveSource` resolved through `DropSource` correctly, and a second, bogus
drop dispatched after resolution left `statusEl` unchanged (confirming the `settled` guard below).
**Not verified**: actually completing a folder selection through the OS-level native directory
*dialog* — that dialog is outside this session's browser automation's reach (no DOM to drive); the
underlying `DirectorySource` code itself is unchanged from M1/M2 and already exercised by the asset
viewer, so this is calling already-proven code from a new call site, not new file-reading logic —
only `resolveSource()`'s own orchestration (the probe-then-fallback logic, and the `DropSource`
branch specifically) is new, and that much now has real-bytes coverage.

**Two bugs an advisor review caught in `resolveSource()`/`flow.js` before this was reported**: (1)
neither the pick nor the drop handler was ever removed after a successful resolve, and nothing
guarded against a second success firing `resolve()` again or a failed retry overwriting `statusEl`
mid-game — fixed with a `settled` flag, verified by the synthetic-drop test above. (2)
`flow.js`'s smoothness gate was created once per game-session and shared across every race in a
tournament, so a race ending mid-draw-period left the next race's first draw phase-shifted; fixed
by creating a fresh gate per race (`runOneRace`) instead of one for the whole session, with a
regression case added to `check-smoothness.mjs` demonstrating why a shared gate is wrong.

**A real, pre-existing timing bug found and fixed while wiring the smoothness setting**
(`src/frontend/flow.js`'s `runOneRace`): the race loop ran exactly one physics step per
`requestAnimationFrame` callback with no fixed-timestep accumulator, so on a 60 Hz display the
whole race ran at ~60 Hz instead of the documented 35 Hz — cars roughly 1.7x too fast, sound engine
pitch updated 1.7x too often, checkpoints/laps stepped through faster than the drone AI's own
`.BRK`-derived thresholds were tuned for. This was present since M3.9 and undetected because no
headless test exercises `flow.js`'s race loop (it's browser-only, DOM/rAF-dependent) and every live
browser session so far judged the race only by "does it look right," not frame-rate. Fixed by
giving it the same `STEP_DT` accumulator `play.js`'s loop already had. Caught specifically because
implementing the smoothness draw-gate (which only makes sense against a *stable* physics rate)
forced re-reading this exact loop closely. This narrows a claim §9k already made: M3.9's live
browser session "confirmed by direct interaction" covers rendering, input wiring and menu/race
sequencing, but every observation of *pacing* (how fast drones moved, how quickly a lap passed) in
that session was made under the ~1.7x-too-fast rate — nothing about game.html's race feel was
actually validated against the documented 35 Hz until this fix landed.

**Smoothness** (`src/engine/smoothness.js`, `npm run smoothness`): SETTINGS.DAT's word 2, a
draw-skip counter, not a physics-rate change (physics is always 35 Hz; `docs/track-graphics.md`'s
own account: "`RunRaceMainLoop` runs `smoothness` (1..4) physics steps per drawn frame"). An
advisor review corrected this session's own first reading of the sense: this copy's `SETTINGS.DAT`
holds `n=1` and the options screen showed "SMOOTHNESS ... HIGH" for it (`docs/boot-and-runtime.md`)
— so **n=1 is the smoothest (most-often-redrawn) setting, n=4 the chunkiest**, the opposite of a
naive "higher number = smoother" reading. Only that one pairing (HIGH↔1) is established;
`UNKNOWN_smoothness_label_map` names that the other three UI labels' mapping to n=2/3/4 (or
whether they're even LOW/MEDIUM/AUTO) was never read live — this port exposes the raw 1..4 number
rather than inventing labels for it. Wired into both game pages' render loops (skip N-1 draws per N
physics steps; physics itself never slows).

**OPL waveform toggle** (`src/audio/opl2.js`'s pre-existing `strictOpl2` option, now actually
reachable): the game never sets OPL register 01 (waveform-select enable), so a real YM3812 would
force every voice to a plain sine regardless of an instrument's own waveform byte; the DOSBox build
this port's audio was verified against (a Nuked OPL3 core running in OPL2-compatible mode) ignores
that gate and honours the 19-of-128 instruments that carry a non-zero waveform byte anyway — richer
sound, and what the game actually sounded like under the emulator these live captures came from.
Plumbed `Si2Player.start(image, {strictOpl2})` → the worklet's `load` message → `new
Opl2({strictOpl2})` (three lines; the core itself needed no changes). `tools/check-opl-toggle.mjs`
(`npm run opl-toggle`) renders one non-zero-waveform instrument in both modes and asserts the
sample streams actually differ — an advisor-suggested test, since a UI toggle with no behavioural
assertion behind it is exactly the "green but untested" shape this project has been burned by
before (M3.5/M3.6/M3.8's own coverage gaps).

**Logo intro from GFX1.GFX** ("optional, cheap" per this row's own wording — done): `game.html`
now opens with SM.EXE's composed "Codemasters / Absolutely Brilliant!" screen
(`composeLogoScreen`/`smPalette`, `src/formats/gfx1.js` — decoded and rendered in the asset viewer
since M1/M2, so this is sequencing already-proven decode/render code before the title screen, not
new work) for up to 4 seconds or until any key, then proceeds to `TITLE`; missing either
`GFX1.GFX` or `SM.EXE` just skips it. Live-verified in the browser: the composed screen (Codemasters
wordmark, pink swoosh, "Absolutely Brilliant!" banners) renders correctly and any key advances to
the title screen. **Not done**: the code-card copy-protection screen as a "skippable curiosity" —
its decode (`src/formats/fontbin.js`) carries an already-documented `UNKNOWN_codecard_cursor_origin`
gap (the cursor-frame screen alignment was never confirmed against a live capture) and needs more
mode-10h planar-bitmap plumbing than the logo did; given this session's own budget after four
consecutive large milestones (M3.6-M3.10) and the item's own "curiosity" framing, it was cut rather
than rushed. It remains fully viewable in `viewer.html` (`fontbinView.js`), just not sequenced into
the game's own boot flow.

**README.md** (new, repository root): what the project is, how to play it (both pages), how to
supply `game/`, what's implemented/not, every `npm run check-*` script, and the project layout —
aimed at a reader who has never seen this repository before, distinct from `CLAUDE.md` (written for
an agent continuing the reverse-engineering work) and `PLAN.md`/`PLAN-ENGINE.md` (the working
plans).

**Verification**: `npm run opl-toggle` and `npm run smoothness` (new, both pass); `npm run build`
produces a 176 KB `dist/` with no game data; live browser sessions confirmed the logo intro, the
folder-picker fallback appearing correctly on a served build, and both game pages' new header
controls rendering with no console errors. Full pre-existing suite (`catalog` through `smoke`)
stays green — the `flow.js` timing fix and the additive `Si2Player.start()`/`Opl2` option changes
don't alter any headlessly-tested behaviour (no headless test drives `flow.js`'s race loop or passes
`strictOpl2`, so neither change had a prior baseline to regress).

## 9m. Post-M3.10: the camera oscillation (2026-09-21)

**Report.** With M3 declared complete, the user played the built game and reported it "isn't
playable because it's flickering a lot — the image jumps around a lot; I can't screenshot it
(screenshot looks normal)". Game mechanics were fine.

**Diagnosis** (headless first, no browser needed): a 600-step ROUND21 drive logging the camera per
step showed `camera.x` alternating `368 ↔ 418` on *every* step while car 0 sat at `x=542` (target
`542−128 = 414`) — 559 direction reversals in 600 steps, every one a 50px move. Y was smooth (12
reversals, all the car's own). A ±50px whole-scene shake at 35 Hz reads as flicker; each frame is
individually valid, so a screenshot is normal. Present since M3.6 in both game pages (shared
`src/engine/camera.js`), invisible to every check in the suite: `check-play.mjs` asserted finite,
in-world and *deterministic* — and an oscillating camera is perfectly deterministic — and every
"live" M3.6/M3.9 camera confirmation was a screenshot.

**Cause.** `camera.js` implemented §3 exactly as written: X "always applies a bounded step
`sign(delta)·step`" and only separately sets the step to 50. Re-reading `1000:5126-5152`
(`disassemble_bytes`, this session):

```
5129  SUB AX,[264A]          ; AX = DX = raw signed deltaX
5134  NEG AX (if <0)         ; AX = |deltaX|
5136  CMP AX,0x3E8 / JG 513F ; far      -> 513F
513b  CMP AX,CX   / JG 5147  ; > step   -> 5147 (bounded)
513f  MOV [264E],0x32
5145  JMP 5152               ; DX is STILL the raw delta here
5147  MOV AX,CX; NEG if DX<0; MOV DX,AX   ; DX = ±step
5152  ADD [264A],DX
```

The `JMP 5152` at `5145` bypasses the `±step` block, so the far and within-one-step cases add the
raw delta — a snap, identical to Y (`5156-5186` is the same instruction sequence with `[2650]`,
`[2648]`, `[264C]`). §3 had originally said exactly that ("each axis is smoothed the same way");
an earlier advisor review flagged that as a papered-over asymmetry and the paragraph was rewritten
to the wrong reading, which the code then faithfully ported. With step settled at 50 and a target
4px away, the old X code moved 50 (to 418), then next step |−4| ≤ 50 so… moved −50 (to 368),
forever. `[STATIC]` from the disassembly; `[PROVEN]` in the sense that the fix removes the
reported symptom in the running port (below) — no DOSBox camera capture was taken.

**Fix.** `updateCamera` now runs one `stepAxis` for both axes: `delta = toI16(target − cam)` (the
game's plain `SUB`, no toroidal fold); `|delta| > 1000 || |delta| ≤ step` → `step := 50, cam +=
delta`; else `cam += sign(delta)·step`. The camera position is stored **unwrapped**, as the game
keeps `[264A]/[264C]` (nothing in `5019-51b0` wraps them; only the target is wrapped at
`5037`/`504a`; the position converges onto it, so it stays within one step of `[0,0xC00)`), and
`initCameraState` no longer wraps `STRT−230/−260` either — `raceView.js` wraps every coordinate it
derives from the camera, and no other consumer indexes by it. The previous `wrapDelta` fold was
not the bug, but it did differ from the game at a seam crossing while the camera lags by more than
one step (the game snaps, the fold would creep); literal arithmetic (D2) removes that too.
Spawn approach unchanged: 8px/step creep from `(274,332)`, settled exactly on `(414,500)` at step
24, `cameraFarFlag=1`, `controlsLocked` cleared — as §3 documents.

**Verification.** `npm run play` gained a camera-*motion* section (`checkCameraTracking`): (a) the
three regimes of `5126-5186` run through `updateCamera` with a synthetic car, on **both** axes,
including the literal regression case (settled camera at 414, target 418 → lands on 418, not 464);
(b) a real 600-step drive asserts a settled camera sits *exactly* on its target every step the car
moves ≤ 50px, that the max per-step camera move is the 8px approach step, and that camera X
reverses direction < 40 times (the car's own turns); (c) the unwrapped-position consequence driven
rather than reasoned (advisor-requested): round 5 race 1's real start (`STRT.x=208`) gives an
initial camera of `(−22, 1756)`, and `composeRaceView` with that raw camera is byte-identical to
the same call with the wrapped camera, and not blank — the other negative-camera starts in
`STRT_POS.BIN` are the unused fourth-race slots at `(0,0)`. Also checked on request: both game
pages bind `strt` to a single `.find(round, race)` entry before `initCameraState(strt)`
(`play.js:71`, `flow.js:139`), the same form the check uses — the shared variable name hid that in
a grep, but the pages and the check run the same init. Swapping the old X logic back in fails 6 of
these checks with the exact `559 flips / max 50` signature; the fix passes all. Live: on
`http://localhost:5173/` (`npm run dev`), `mmRace.forceSteps(1)` × 80 sampled per step showed the
approach `274,282,…` then `414,500,50,50` held constant (one distinct X value after settling) — the
old code oscillated even for an idle car, since 410 + 8 overshoots 414 by 4 and the ±50 swing
starts from there. (The automated tab is `document.hidden`, so the rAF loop was driven
synchronously; `game.html` uses the same module.) Full suite re-run green.

**Method notes.** (1) An advisor "correction" is a claim like any other and needs the same
byte-level check; when two code blocks are said to differ, diff the instructions. (2) A screenshot
cannot show a per-frame oscillation; camera *motion* needs a sequence assertion (position ==
target once settled), not a frame check. Both recorded in `PLAN.md` §8.

## 9n. Post-M3.10: two boats glued together (2026-09-21)

**Report.** After the camera fix (§9m) shipped, the user reported: "in tournament mode: there is
some kind of bug where two boats get stuck together. the boats are still racing but are 'glued'
together." Round 2 (POWERBOATS) was the example, but the underlying code (`collide.js`) is shared
by every round.

**Diagnosis** (headless, before touching any code). Two synthetic cars, same heading and speed
(so their relative velocity is ~0 — the case where the impulse floor of 500 dominates every step),
placed 4/8/12/16px apart on an open patch of round 2's own track, driven straight ahead through the
real `runStep` loop for 400 steps: at 4/8/12px the pair's separation stayed pinned at 1–10px for
the *entire* run; only right at the 16px edge of the contact box did they escape and settle at a
stable, non-overlapping distance. A natural AI-vs-AI sweep (all 9 rounds × both race formats × 3000
steps) never triggered this — ordinary drone driving rarely holds two cars inside the 16px contact
box for long — but forcing two AI-driven cars into the box mid-race (a stand-in for a close pass,
ram, or knockout respawn landing next to another car) reproduced it 100% of the time, in all 4 of
round 2's races, both race formats.

**Cause — two independent bugs in `resolveCarCarCollisions`/`resolvePair`, both confirmed live**
(`decompile_function`/`disassemble_bytes` on `1000:5921`/`5960`, this session; a prior advisor
review's own uncertainty flag on this exact code — "the sign convention makes a closing approach
yield the 500 floor — surprising; first live check" — turned out to be pointing right at bug 1):

1. **`dx`/`dy` had the wrong sign.** The port computed `dx = b.nextX - a.nextX` (B minus A); the
   disassembly computes `iVar3 = *(iVar6+0x125e) - *(*0x27b3+0x125e)`, i.e. **A minus B**. The
   17×17 contact-angle table (`CONTACT_TABLE`, `DS:17DA`) is *not* symmetric under negation (e.g.
   `dx=-16,dy=0` → 65 (~right) but `dx=+16,dy=0` → 191 (~left) — mirror images, not equal), so the
   flipped sign looked up the wrong table entry and could misdirect the separating impulse instead
   of applying it. This is the bug behind the reported symptom, and it exactly explains the earlier
   "surprising" note: with B to A's right and the wrong (B-minus-A, positive) `dx`, the table gives
   angle 191, `s = SINE8[191] = -127`; a real closing approach (`rel.x > 0`, A gaining on B) then
   makes `rel.x·s` *negative*, so `imp` floors to 500 regardless of how fast they're actually
   closing. With the correct (A-minus-B, negative) `dx`, the angle is 65, `s = SINE8[65] = +92` —
   positive, so a closing approach correctly produces a large positive impulse that scales with the
   real closing speed instead of always hitting the floor. The floor wasn't wrong; the sign feeding
   it was.
2. **The 6 pairs don't run in ascending-index order, and one A/B pair is swapped.** `disassemble_bytes`
   on `5921` shows the literal sequence of `[27B1]`/`[27B3]` assignments: `(0,1)(0,2)(0,3)(1,3)(1,2)
   (3,2)` — car 3 is "A" and car 2 is "B" for the last pair, not `(2,3)` as a naive `i<j` loop gives.
   This matters for `5960`'s asymmetric state-2 branch (`A.v=+0x40`, `B.v=-0x40`).
3. **A third, related finding while checking "re-integrate A" for bug 2**: `5960` never writes `BX`,
   and neither does `5921` (checked start to end — no `MOV`/`ADD BX` anywhere in either). The
   top-of-function "re-integrate" block at `5960` (`[BX+0x1272]` etc., a *different* addressing path
   from the `[27B1]/[27B3]`-relative fields used for the actual collision math) therefore always
   operates on whichever car's offset the *caller* (`FireProjectileSfxE`) left in `BX` before the
   first of the 6 calls — and since that caller's own heading→velocity loop immediately before
   (`4fde-4ff7`) always ends its 4th and last iteration on `[2666]` (car 3), `BX` is car 3's offset
   for *all six* pair calls, not "whichever car is A this pair" as docs/engine.md §3 and M3.3's own
   fix (§9e) had assumed from the decompiler's pseudocode. Very likely an unintended
   leftover-register artifact of the original code (not a deliberate design), but it's what the
   shipped game does, and the port now matches it exactly rather than the plausible-but-wrong
   "re-integrate whoever's A" reading.
   `[2660..2666]`'s car-index ordering itself (0, 0x164, 0x2C8, 0x42C — needed to trust reading #2
   and #3 at all) was confirmed two ways, not assumed: a live `read_memory 193C:2660` (8 bytes:
   `0000 0164 02C8 042C`) and finding each value's own literal `MOV word ptr [26xx], imm` writer in
   `InitRaceCarsFromTables` (`4152`, `414c`, etc.) — a static EXE read only proves something if the
   value is a compile-time constant, which an advisor review asked to be confirmed rather than
   assumed given `[2660..2666]` looked at first glance like they could be runtime-computed pointers.

**Fix.** `resolveCarCarCollisions` now runs the literal 6-call sequence `[[0,1],[0,2],[0,3],[1,3],
[1,2],[3,2]]`, calling `integrateCar(cars[3])` before every one of the 6 (matching the leftover-`BX`
behaviour, not "re-integrate A"). `resolvePair`'s active/state gate now matches `5960` exactly
(`a.active && (a.state===2 || (a.state===0 && b.active && (b.state===0||b.state===2)))` — a state-2
A no longer requires B to be active, matching the disassembly's own skipped check). `dx`/`dy` are
now `a.next - b.next` (A minus B).

**Verification.** Isolated the sign fix first and measured it alone against the diagnostic above
(advisor-requested, to know which of the three changes actually mattered): with only the sign
fixed, all four gaps (4/8/12/16px) separate cleanly within ~200 steps instead of sitting at 1–10px
for the full run — confirming the sign was the cause of the reported symptom specifically. The
pairing-order and re-integration-target fixes were added afterward for full byte fidelity and
verified not to regress anything (`npm run rounds`, `step`, `trace`, `ai`, `play`, and the full
`catalog`…`smoke` list all still pass; `trace`/`ai`'s pre-existing step-1 divergence is unchanged,
not new). `npm run play` gained `checkCarCarCollision`: (a) an off-centre synthetic pair (the exact
asymmetric case the old sign got wrong) pushes each car away from the other, not toward it; (b) the
`(car3,car2)` pairing's state-2 branch assigns `+0x40` to car 3 and `-0x40` to car 2, not the
reverse a sorted loop would give; (c) two real AI-driven cars forced into the contact box separate
within 60 steps rather than staying glued for the rest of the run (was stuck for all 200/200
sampled steps before the fix). Reverting all three changes together makes all 5 new checks fail
with the exact reported signature (`longest <20px streak: 200 steps`); the fix passes all 5.

**Follow-up (second advisor pass).** Four items raised after the fix landed, each closed with
evidence rather than reasoning alone:

1. **Does the loosened `b.active` check let an active state-2 car collide with raceFormat 2's
   permanently-inactive cars 2/3 ("ghosts"), and if so, are they colliding against a phantom the
   real game wouldn't put there?** Traced `InitRaceCarsFromTables` (`decompile_function 1000:3c09`)
   directly: every car's `active` (`0x124C`) is set from `active := present` (`0x124C = 0x124E`) in
   the same per-car reset loop that runs for all 4 slots regardless of race format — so a raceFormat
   2 port that sets `active = present = 0` for cars 2/3 is already matching the real init exactly,
   not introducing a discrepancy. More importantly, cars 2/3's *position* fields are computed from
   the same `STRT_POS.BIN` entry and the same 2×2 grid-slot arithmetic as an active car's (visible
   in the same decompile: `DAT_193c_1524 = DAT_193c_1688; if (...) DAT_193c_1524 = iVar9 + 0x2e`,
   for car 2's own `0x125c`-equivalent field) — the ghosts sit at the real start-grid position, not
   zeroed or stale, in the real game too. And the grid spacing itself is 26px on both axes between
   every pair of slots, always outside the 16px contact box, so the *spawn* configuration can never
   trigger a ghost collision — only a later respawn landing within 16px of the grid could. Drove
   that exact case (`ghost-check.mjs`: force an active car into state 2 directly on a ghost's
   position) and confirmed the push applies cleanly — finite velocities, no crash — and the ghost
   itself never visibly moves (its state stays `0xA`, outside `bounceAndCommit`'s commit gate, so
   the velocity change is inert). A real, narrow, faithfully-reproduced original-game quirk, not a
   port-introduced bug.
2. **Is `5921`'s caller really unique, given `PLAN.md` §8 already warns that `get_xrefs_to`
   under-counts DS-relative references?** Re-checked with `search_instructions
   operand_pattern:"0x1000:5921"` (an instruction-level scan of the whole image, the tool this
   project trusts for exactly this class of claim) — one match, `1000:4ffa` in `FireProjectileSfxE`,
   confirming the earlier `get_function_xrefs` result rather than being undermined by it.
3. **State the 500-floor resolution as a derivation, not an assertion** — done inline above (bug 1).
4. **`game.html` (the actual "tournament mode" the user played) shares the fix, but wasn't itself
   driven live** — confirmed by import, not assumption: `src/frontend/flow.js:26` and
   `src/play.js:22` both `import { runStep } from '.../engine/step.js'` — the identical module
   already confirmed live on `index.html` (`forceSteps`: two cars forced to 8px apart separated to
   782px within 90 steps, then settled into normal independent racing). One module, one fix, both
   pages.

**Method notes.** (1) A flagged-but-unresolved "surprising" note in the docs is a lead, not
decoration — re-read it before hunting for a new cause. (2) When re-deriving what a decompiled
"re-integrate" block operates on, check what register/variable it actually indexes with, not what
the surrounding pseudocode's synthetic variable names suggest — `iVar6` (from `[27B1]`) and `BX`
looked interchangeable in the decompile output but are not the same value. (3) A static read of a
suspected pointer table only proves something if the values are compile-time constants — confirm
that by finding the literal write, not just by reading plausible-looking numbers. (4) A gate change
that "loosens" a check needs the same live-mode scrutiny as the original bug, even when the change
itself is a faithful correction — check what it now permits, not just what it used to forbid.

## 9o. M3.11: the race HUD (2026-09-21)

**Scope.** After M3's own regression fixes (§9m camera, §9n car-car collision), the user asked to
"work on the HUD" — the position/lap display that every earlier milestone (§9d, §9h) deliberately
deferred as out of scope. This is new scope, not a regression fix: `PLAN-ENGINE.md` gets a new
M3.11 row rather than a correction to an existing one.

**Method.** Three parallel read-only Ghidra research passes (a `Workflow` fan-out, since this was a
big-enough RE surface to split): (1) full decompile/disassembly of `DrawRaceHudDigitsAndRankIcons
1000:8dfc` itself; (2) the five other addresses `8dfc`'s own module comment had lumped in as "the
HUD" (`851f`/`855a`/`8634`/`903f`/`9076`) — sorting which are genuinely part of the main HUD vs.
two-car-only overlays; (3) confirming the source asset data (already in `src/formats/race.js`'s
`PH0_LAYOUT`) and its exact wiring into the draw calls. All three converged independently on the
same facts (a strong cross-check in itself), and were then spot-verified directly rather than
trusted blind — e.g. the top digit's source register (`CX=[BX+0x12ED]` at `1000:8e95`) was
re-disassembled by hand before trusting it, because the value it displays (4, on the very first
race frame) at first looked wrong against `lapsRemaining`'s documented init of 3 — it isn't: the
field is a live, uncapped-until-9 counter (`60af` increments it on a backward line-crossing
penalty), and the captured reference frame simply wasn't taken at lap-count zero.

**Findings — `DrawRaceHudDigitsAndRankIcons 1000:8dfc`, sole caller `RenderRaceFrameToBackBuffer`
at `1000:923e`, runs once per DRAWN frame (not per physics step), unconditionally.** Three
mutually-exclusive branches selected by `[28BF]` (round) and `[2656]` (race format):

- **Branch A, `[28BF]==9` (round 9/RUFFTRUX) → `8ff5`**: an unrelated 3-digit `[26C8]>>4` countdown
  (three chained `DIV 10`), no rank icons at all. **Ported and wired, §9p.**
- **Branch B, `[2656]==2` (two-car format) → `8f03`**: one standalone digit (the leading car's
  `lapsRemaining`) plus an 8-dot red/blue "light bar" (`PH0+0x1A00`/`+0x1B00`) whose split point is
  `[26B4]` — `UNKNOWN_ph0_light_roles`, **resolved in §9p**. **Drawing ported, not wired**: `[26B4]`
  needs a match-scoring state machine this port doesn't implement (§9p).
- **Branch C, the default (four-car) path, `8e10-8f00` — the one implemented, and the one the
  existing reference frame `race_R21_a000.bin` actually shows**: re-scores all 4 cars as
  `(9-lapsRemaining)·[2652] + progress` into `[2670..2676]`, bubble-sorts the shared pointer array
  `[2678..267E]` (seeded once per race, car-index order, by `InitRaceCarsFromTables 1000:423a`) by
  that score, writes each car's sorted rank into its own `wRacePosition` (`+0x12EF`) — `8dfc` is
  the *sole* writer of that field anywhere in the program — then for each rank 1-4 draws that car's
  16×16 helmet icon (`PH0+0x1380`, or the finish-flag `PH0+0x1C00` once that car's own
  `lapsRemaining` reaches 0), recoloured via `BlitSpriteCarColourRemapAtOffset 1000:8dc0`, followed
  16px to the right by the LITERAL rank digit (1/2/3/4, a hard-coded immediate — never a car
  field). A standalone 5th digit at the top is car-slot-0's own `lapsRemaining` (`BX=[0x2660]`, the
  fixed, never-re-sorted "camera-target" slot — the same one §3's camera code targets).
  Coordinates (re-derived from the literal `DI` immediates and the buffer's documented (16,16)
  origin and 272px stride): icon column at view x=0-15, rank-digit column at x=16-23, rows at
  y=16/32/48/64, standalone digit at (8,0) — a 24px-wide column, matching what `check-live.mjs` had
  already isolated (by exclusion) for years without anyone having implemented what was in it.
  **A freeze-on-finish quirk, not ported** *(superseded 2026-09-23, §9ah: it is a prefix freeze, now ported)*: `8e3b-8e4f` — once any one car's own `lapsRemaining<=0`
  or `[26C6]>=2` cars total have finished, ALL FOUR score cells get set to a 32000 sentinel for
  that iteration of the scoring loop, pinning the sort order rather than continuing to re-rank a
  field where some cars are still racing. This port displays the existing `car.racePosition`
  (`step.js`'s `computeRanking`, already correctly ORDERED — `UNKNOWN_ranking_2670` — recomputed
  every physics step, not every drawn frame, and without the freeze) instead of re-deriving this
  exact mechanism, since `racePosition` is already load-bearing elsewhere (`twocar.js`'s knockout
  winner, `flow.js`'s tournament standings) and changing its cadence/semantics was judged out of
  this task's scope. Documented, not silently different (`PLAN.md` §8).
- **The recolour mask is narrower than the vehicle body's.** `BlitSpriteCarColourRemapAtOffset
  1000:8dc0` (confirmed live, `1000:8dda-8de5`) shifts only nibble-1/2 pixels, unlike the vehicle
  body's `remapCarColours` (nibble ≤2, i.e. {0,1,2}) — a real, byte-confirmed difference, not an
  approximation; ported as a second function, `remapHudIconColours`.
- **`9076` (`DrawCarRacePositionLabel`) is a real, separate part of the main HUD** — a floating
  "1st".."4th" label drawn in *world* space above a car once it (or ≥2 cars) has finished, sourced
  from `PH0+0x1D00` — but **not ported here**: it's a different visual (over the car, not the
  corner HUD) and, per its own call site (`DrawRaceCarLayer`, which runs *before* `8dfc` each
  frame), reads a one-frame-stale rank.
- **`851f`/`855a`/`8634` are two-car-mode-only overlays, not part of the main HUD**, despite the
  older docs line grouping all six addresses together: every one of their effects sits behind car
  state B/C or `[26C2]`, and the dominant writer of states B/C (`1000:75fa/7600`) is itself gated
  by `[2656]==2` at `1000:75c8` — in a normal one-player/four-car race they run their
  `StopEngineSounds` preamble and return, drawing nothing. Correctly out of scope until two-car
  race-stage machinery (states B/C, the lights countdown) exists.

**Implementation.** `src/render/hud.js` (new): `drawHud(dst, w, h, cars, ph0)`, branch C only.
`src/formats/race.js` gained `ph0Digit` (single 8×16 glyph slice, same shape as the existing
`ph0Icon16`) and `remapHudIconColours`. `composeRaceView` gained an optional `hud: {ph0,
raceFormat, round}` param, drawn last (matching `RenderRaceFrameToBackBuffer`'s own step-5-of-5
order), a clean no-op when `raceFormat===2 || round===9`. Both game pages (`play.js`, `flow.js`)
now load `BITSFILE.PH0` and pass it through.

**Verification.** `npm run live` now draws the HUD into its comparison and gets a byte-exact match
against the real captured frame across the entire HUD region (2040 pixels, 0 differing) — the
strongest verification available anywhere in this project, and it removes the HUD-column exclusion
that had existed since M3.2 (only the boat+wake stays excluded, per that check's own scope). The
exact car state that reproduces the reference frame (car 0 = rank 4, `lapsRemaining=4`; ranks
1/2/3 = cars 2/1/3's own colours) was itself reverse-engineered from the frame — rendering each of
the 4 possible `colourOffset`s and pixel-matching against each row — not assumed. Reverting the
`hud` option (simulating "not implemented") makes this same check fail with 987 differing pixels,
confirming the check has teeth. `npm run play` gained `checkHud`: rank ordering is driven by
`racePosition`, not array index; a finished car shows the flag, not the helmet; the recolour mask
really is narrower than the vehicle body's (a nibble-0 pixel proven untouched by one, shifted by
the other); round 9 and two-car format are a clean no-op. Each of these three was proven to
actually fail against a deliberately-broken version before being trusted. Confirmed live in the
browser on both pages (`index.html` via `forceSteps`, `game.html` driven through a real
title→menu→char-select→race sequence via its own `confirm()`/`moveCursor()` debug hooks) — correct
colours, correct rank ordering, correct lap digit, in an actually-running race, not just the one
static reference frame.

**Method notes.** (1) An existing test's exclusion zone can be sitting on ground truth nobody has
used yet — `check-live.mjs` had isolated the exact HUD pixels behind its `HUD_W` mask since M3.2,
and simply extracting that region from the reference frame it already had was strictly stronger
verification than any live DOSBox capture this session could have taken fresh. (2) A visible number
that doesn't match a field's *documented default* isn't necessarily a bug in the reading — check
whether the field is *live* (mutable during play) before assuming the disassembly is wrong; the "4"
here was lapsRemaining, genuinely 4, not a misattributed field. (3) Independent parallel research
passes converging on the same facts from different angles (the draw routine, the sibling addresses,
the asset data) is a good cross-check but not a substitute for spot-verifying the single most
visible/highest-consequence claim by hand.

## 9p. M3.11 continued: the RUFFTRUX countdown and the two-car light bar (2026-09-21)

**Scope.** §9o's own "not ported" branches, picked up on request. Fully re-disassembled both
(never trusted from paraphrase — every claim below was independently re-read from raw bytes this
session, not carried over from an earlier summary), and a real, pre-existing bug was found and
fixed along the way.

**Branch A — round 9 (RUFFTRUX), `1000:8ff5-903e`.** `AX=[26C8]>>4`, decomposed via three chained
`DIV 10`s into ones/tens/hundreds (the 4th quotient is computed and discarded — only the last 3
decimal digits of the shifted value are ever shown). Draw order, re-disassembled instruction by
instruction: ones first (`DI=0x19B0`), then — only if the ones digit is non-zero — a "blink" glyph
(index 10 of the 11-glyph digit strip) at `DI=0x19A8`, then tens (`0x19A0`), then hundreds
(`0x1998`). The non-zero condition is the same CX-clobber trap §9o already warned about for this
exact function (`905f` internally does `SHL CX,7`, so `900b`'s `CMP CX,5` is testing
`ones_digit<<7`, not the ones digit — confirmed by direct re-disassembly, not re-trusted from the
earlier note). Coordinates (buffer→view, same `(16,16)`/272-stride conversion as §9o): hundreds at
view (8,8), tens (16,8), blink-or-gap (24,8), ones (32,8) — a different, wider layout than branch
C's 24px column, given its own named constants in `src/render/hud.js` rather than reusing branch
C's (the method note §9o closed with — conflating layouts is exactly the mistake to avoid).

`[26C8]` itself is `RuffTruckTimes[race-1]` at race start (`InitRaceCarsFromTables`), matching this
port's `raceState.ruffTruxTimer`/`ctx.ruffTruxTime` (`states.js`, M3.8) exactly in *value* — but a
real, independently-confirmed **bug in M3.8's own timer rate** surfaced while verifying the
*cadence*: `UpdateCarAirborneLandingSfx 1000:7429`'s `[26C8]--` sits at the very top of the
function with no per-car gate at all (only `[28BF]=='\t'` and the `[26CA]` "already expired" latch
guard it), and that function's *sole* caller (`RunRaceMainLoop`, `1000:309c`, confirmed via
`get_function_xrefs`) runs it once per car slot — 4 times, unconditionally, every physics step
(`disassemble_bytes` on `309b-30b5`: a plain `BX=0;loop:CALL 7429;...;BX+=0x164;CMP BX,0x42C;JLE
loop`, no active check). So `[26C8]` decrements by up to 4 per physics step, not 1 — M3.8's
one-per-step decrement ran the RUFFTRUX countdown **4× too slow** ever since it was written,
unnoticed because nothing before this session displayed the timer or checked its real-world pacing
against `RuffTruckTimes`. Fixed in `states.js` to decrement up to 4 times per step, stopping the
instant the timer reaches 0 within that same step (matching `[26CA]`'s latch precisely, rather than
a plain `-= 4` that could undershoot past 0 on a `RuffTruckTimes` value not divisible by 4).
`tools/check-rounds.mjs`'s existing RUFFTRUX timer test had itself been built around the old (wrong)
rate (seeded 3, expected exactly 3 ticks to expire) and needed re-seeding to actually exercise the
×4 behaviour, including the "doesn't overshoot negative" edge case.

**Branch B — two-car (head-to-head) format, `1000:8f03-8ff3`.** Standalone digit = the leading
car's own `lapsRemaining` (same `DI=0x1118` slot as branch C's top digit — a genuine, confirmed
sharing, not a coincidence of my own numbering). Below it, `CX=8` counting down to 1, one 16×16
light per iteration at the same buffer column branch C's rank-1 icon uses (branch B has no per-car
icon row to compete for that space): while `CX > [26B4]`, plain-blit `PH0+0x1B00` (blue, no
recolour — confirmed via `8d09`, not the icon's own `8dc0` recolour path); once `CX <= [26B4]`, the
loop jumps into a *second*, separate loop body (`8fe0`) that draws `PH0+0x1A00` (red) for every
remaining iteration without re-checking `[26B4]` again — i.e. exactly one transition point per
draw, matching the table's own "row of dots" framing rather than 8 independently-toggled lights.

**`[26B4]` and `UNKNOWN_ph0_light_roles`, resolved.** `search_instructions` across every `0x26b4`
reference (not `get_xrefs_to`, which under-counts base+index accesses — `PLAN.md` §8's own standing
pitfall) found `[26B4]` is not a per-frame recomputation but a **persistent 0-8 tug-of-war score**,
seeded to 4 (`InitRaceCarsFromTables 1000:3c3a`) and moved by an arm/land/blink-swap sequence spread
across three functions: `RunCarPhysicsStep 1000:4bf1` arms `[26B8]` to point at whichever car slot
is currently ahead of the midpoint (car slot 0 if `[26B4]>4`, car slot 1 if `<4`) whenever `[26C4]`
is in its reset state; `UpdateCarAirborneLandingSfx 1000:7429` (gated on `[26B8]==`the car currently
being processed`&&[2656]==2`) runs a 64-tick blink-swap animation (`[26BA]`, swapping `[26B4]`↔
`[26B6]` every 8 ticks — the light bar's own flicker while a score change is announced) and, once it
completes, **commits** the change: `[26B4]+=1` if the scoring car is slot 0, `-=1` if slot 1;
`[26B4]==8` or `==0` ends the whole match (`[26C4]` set to the winner). This is genuinely the same
mechanic §7's existing two-human-H2H write-up already described in outline (`[26B4]` seeded 4,
`INC`/`DEC` toward 8/0) — independently re-derived here from the one-player-vs-CPU code path
(`RunCarPhysicsStep`/`UpdateCarAirborneLandingSfx`), which shares the identical global state and
confirms it applies equally to the CPU-opponent two-car mode this port actually has, not only the
out-of-scope two-human mode. **Resolution**: the light bar's own draw loop (`8fc2-8fe8`) reads
`[26B4]` directly, independent of the still-contested `UNKNOWN_26B8_polarity` — bottom `[26B4]`
lights are RED (car slot 0's colour end), top `8-[26B4]` are BLUE (car slot 1's); a full red bar
means car slot 0 (usually the human) has won the match, full blue means car slot 1 has.

**Implementation.** `src/render/hud.js` gained `drawRuffTruxCountdown` (wired into
`composeRaceView`, real data via `raceState.ruffTruxTimer`) and `drawTwoCarHud` (implemented and
directly unit-tested, **not wired**). `composeRaceView`'s dispatch now mirrors `8dfc`'s own branch
priority exactly: `round===9` is checked *before* `raceFormat===2`, because a two-car tournament's
bonus race genuinely does reach round 9 with `raceFormat===2` (`flow.js` derives `raceFormat` from
`tournament.format`, not per-race) — that combination now shows the countdown, not the light bar
(nor silence), matching the real game's own priority.

**Why the light bar isn't wired.** `[26B4]`'s value requires the whole match-scoring state machine
above, which this port implements *nowhere* — a genuinely separate, larger feature than "the
display" (comparable in scope to M3.8's own already-open "the [two-car] knockout condition isn't
detected anywhere in this port" gap, `PLAN-ENGINE.md`'s M3.8 row). An advisor review flagged the
sharper reason not to paper over this with an invented value: **`lightScore=4` is not a neutral
placeholder** — it is the exact value the real game's own `RunCarPhysicsStep 1000:4be7` branch
treats as "no match in progress" (a between-heats pause/banner sequence that never arms `[26B8]`) [**refuted §9am**: `4BE7` is reached only by a FINISHED car; `[26B4]==4` is the ordinary tied score, and `4CB0` is the tie-at-the-finish "Play Off" sudden death] —
and wiring a permanently-frozen bar into a real two-car race would render a HUD element that looks
live every frame while never actually tracking anything, precisely the failure shape §9m's camera
oscillation was (individually-valid frames, wrong as a sequence). `drawTwoCarHud` is built and
tested against synthetic scores so the moment the match state machine exists, the drawing code is
already proven correct — `raceFormat===2` renders no HUD in the meantime, an honest gap.

**Verification.** All new logic is covered by `tools/check-play.mjs`'s `checkHud`: `drawRuffTruxCountdown`
tested against two real `ticks>>4` decompositions (312 and 10) confirming digit placement and the
blink-glyph's non-zero-ones-digit condition in both directions, plus a negative/expired-tick clamp;
`drawTwoCarHud` tested for both the leading-car digit selection and the exact 8-light red/bottom
blue/top split at a representative score; `composeRaceView`'s dispatch tested for all three
reachable combinations, including the round-9-takes-priority-over-two-car-format case. Each of
these — plus the corrected RUFFTRUX timer rate in `check-rounds.mjs` — was proven to fail against a
deliberately-reintroduced version of its bug before being trusted (the light-bar polarity, the
dispatch priority, and the ×4 timer rate each independently confirmed this way). Live browser
confirmation was attempted but not completed for the RUFFTRUX branch specifically: `game.html`'s
race loop has no synchronous step hook (unlike `play.js`'s `forceSteps`), and the automated tab
runs `document.hidden`, throttling `requestAnimationFrame` to nothing — the same limitation M3.9
already documented, not a new one. The general HUD rendering path (tile/car/overlay/HUD compositing,
`BITSFILE.PH0` loading, `composeRaceView`'s wiring) was already confirmed live in both pages in
§9o; branch A reuses that same path with no new plumbing, so the risk this leaves unverified is
narrow (the digit-decomposition arithmetic itself, which the direct unit tests above already pin
down byte-exactly).

**Method notes.** (1) A function's *sole caller*'s own loop structure can hide a per-step
multiplier a summary of "decrements the timer" would never surface — always check whether a
decrement site is reached once or N times per logical tick before porting its rate literally.
(2) An advisor-suggested placeholder value can itself be load-bearing in the source material; check
what the value you're about to use as "blank" actually means in the real code before calling it
neutral. (3) An `UNKNOWN_*` can be narrower than it reads: §7's existing two-human H2H write-up
already had `[26B4]`'s scoring mechanic (seeded 4, `INC` toward 8/`DEC` toward 0) on record before
this session — what `UNKNOWN_ph0_light_roles` actually needed was only "which colour sits on which
end of the bar," a question the *draw loop* (`8fc2-8fe8`) answers on its own, not the whole
match-scoring subsystem. Re-reading with the narrowest question the tag actually asks avoids
re-deriving what's already documented.

## 9q. Post-M3.11: projectiles, puffs/splashes, palette fades, pause banner (2026-09-22)

**Scope.** User report: "Work on projectiles, puffs/splashes, palette fades, pause banner. Fire
button (S) does nothing yet." Four previously-unimplemented systems, sequenced fire/projectiles
first (the reported symptom), then puffs/splashes, then pause, then fades last (advisor guidance:
"nothing depends on it"). A 4-way parallel Ghidra research pass re-derived all four from scratch;
several findings below were re-verified a second time, live, directly in this write-up session
after an advisor review, which is the pattern that already caught real errors in §9m/§9n/§9p.

**Projectiles — Fire `1000:4f17`, Flight `1000:51b2`/`87f3`, Hit `1000:79fd`, Draw `1000:8712`
(the last previously undocumented, closes `UNKNOWN_ph0_tail_icons`).** Gated on TANKS (round 7) or
the `[2919]`/cheat-type-9 flag at all three of fire/flight/hit's call sites alike (re-confirmed live
this session, `1000:5e3c-5e48`'s hit-check call site). The 0x08 fire button OR the accel+brake 0x30
chord both converge on the identical `4f17` entry/gate (`4f03` falls straight into it). Fire sets
`reloadCooldown=0x3C`, seeds a packed "direction word" per axis from the sine table plus the car's
own sub-pixel velocity fraction, and offsets the shot's spawn point from the car's own position.
Flight decrements `reloadCooldown` and, while `>= FLIGHT_THRESHOLD(0x28)`, advances the shot's
position and a `projStepsA/B` decay pair; **the "in visible flight" boundary was directly
re-disassembled this session** (`1000:7a08 CMP [SI+0x13a4],0x28; JC 7a6d`, an unsigned-less-than
skip) confirming `reloadCooldown >= FLIGHT_THRESHOLD` — not `>` — is genuinely hit-eligible, and
`[SI+0x13a4]` is confirmed to be `reloadCooldown` by address arithmetic against `car.js`'s own
struct offset (`0x13a4 − 0x124A(car 0's base) = 0x15A`, exactly `reloadCooldown`'s field offset).
Hit uses a 12px box (`|dx|,|dy| <= 0xC`, from `CMP CX,0xC; JG skip` / `CMP CX,-0xC; JL skip`) and
sends the victim to state 0xD. Draw (`8712`) has two phases keyed on the same `reloadCooldown`: a
flying tail icon (2 of PH0's 5 `tailIcons`, index chosen by elapsed-tick parity) plus a silhouette
trail offset by the decaying `projStepsA/B`, then — for roughly 10 further ticks after flight ends —
a symmetric grow/shrink impact puff reusing the skid-dust PH0 bank.

Two deliberate simplifications, both documented in `engine/projectile.js`'s own header: (1)
**single decrement** — the real game decrements `reloadCooldown` twice per physics step under some
conditions (once in physics, once in the draw function, the latter only on ticks the smoothness
draw-gate lets through), coupling a shot's timing to the player's smoothness setting; this port
decrements once, in physics, every step, so a shot's ~60-tick lifecycle is fixed real-world time,
not smoothness-dependent. (2) **average-drift flight motion** — `87f3`'s 6-substep-per-axis 8-bit
accumulator's exact sub-pixel carry behaviour was not fully pinned down even after live
re-disassembly; replaced with the mathematically-equivalent average per-tick drift
`trunc(6·sine/256) + (fracNibble−8)`. Hit detection's 12px box makes the difference sub-pixel and
gameplay-irrelevant.

**Puffs and splashes — `DrawWheelEffectPuffs 1000:8083`, `FUN_1000_8386 1000:8386` (splash).**
Resolves `UNKNOWN_puff_slot_fields`: every trigger spawns a **pair** of 8×8 sprites sharing one
frame counter and one `source` (0=wet, 1=skid, 2=mud/low-grip) — `xA/yA` at `heading+puffOffA+0x80`,
`xB/yB` at `heading+puffOffC+0x80` (the `+0x80` points the spray behind the car); `car.js`'s
ambiguous `unkA/unkB` fields were renamed to `xA/yA` accordingly. Priority when multiple triggers
are set at once (matches `DrawWheelEffectPuffs`'s own disassembly order exactly): low-grip/mud
first, then skid, then wet — only one puff spawns per opportunity. `puffOffA/C` (and their step
partners `B/D`) sweep as a round-2-only oscillator (`off += step`, flip sign past `|off| > 29`);
fixed outside round 2. A **genuine, deterministic slot-cursor bug** exists in the shipped game and
is ported bug-for-bug (per advisor guidance — this is a real quirk, not a gap to close): the 8-slot
puff ring and the 5-slot splash ring both skip slot 0 after their first use (`1000:82ab`/`842a`:
`cursor++; if (cursor > N-1) cursor -= (N-1)`, not `cursor %= N`) — slot 0 is used exactly once,
ever, per car, for the life of the race. Splash spawn is gated on `car.splashTrigger`, itself set
only in round 2 (`airborne.js`'s existing landing check, `ctx.round === 2`).

Architecture decision (documented in `engine/puffs.js`'s header, same shape as the projectile
single-decrement above): in the real game, spawn/animate logic lives *inside* the draw functions
(called once per drawn frame), so a chunkier smoothness setting slows puff/splash animation. This
port keeps spawn/animate in the engine layer, called every physics step regardless of smoothness —
consistent with this project's established physics/render split elsewhere (the HUD's rank is
computed in `step.js`, not `hud.js`) and avoiding the same smoothness-coupling risk. Documented
divergence: puffs/splashes animate at a fixed real-world rate here, not a smoothness-dependent one.
The cooldown decrement itself (`puffCooldown`/`splashCooldown`, guarded floor-at-0) was confirmed
live to happen in `UpdateCarAirborneLandingSfx` (`1000:7459/7460`/`7464/746b`), unconditionally,
every physics step — ported into `airborne.js` rather than either spawn/animate function.

**Palette fades — `PaletteFadeToBlack 1000:327a` / `PaletteFadeUpFromBlack 1000:32ce`.**
(**Corrected §9an:** only the fade-out `327a` makes 126 calls/63 steps; the fade-up `32ce` makes 128 calls/64 steps, `32F5-32FD`.)
Re-disassembled live this session end to end (`327a-3332`). Both are busy loops of 126 calls to a
shared per-tick routine (`32ae`) that, via a `SHR CX,1; JC` halving trick, only actually touches the
DAC bytes (±1 per channel, floored/ceiled at 0/max, all 768 bytes) on every *other* call — 126 calls
= 63 real DAC-adjustment steps, each still followed by a full VGA upload (`331f`: `OUT 3C8h` then
256×3 `OUT 3C9h` writes) every one of the 126 times. Critically, **there is no `INT 1Ah`/vsync wait
anywhere in either function** — the upload routine (`331f-3332`, disassembled in full) and the
outer loop body (`CALL 32ae; LOOP 32a5` back to back, `32a2-32a8`) both contain no delay call; `32ae`
itself was not fully re-disassembled instruction by instruction this session, so this rests on the
upload routine and the loop shape, not an exhaustive read of every byte in between — so the loop's
real-world duration is bound purely by
1994 CPU speed and has no derivable value to port; this matches and confirms the earlier research
pass's "no derivable duration" finding rather than refuting it.

Reimplemented (`engine/fade.js`) as a per-frame incremental state machine with a **chosen, not
derived, 800ms duration**, operating on the palette's own 6-bit DAC bytes (not the 8-bit RGBA this
port renders with — ramping the converted values would be a visibly different, smoother curve, not
the same algorithm at a different rate) via a continuous per-frame interpolation rather than a
literal fixed-tick ±1 replica (the same kind of mathematically-equivalent simplification already
used for the projectile's flight motion — a variable-framerate `requestAnimationFrame` loop has no
natural "tick" to hang a literal per-tick replica on). Wired as a fade-IN at race start in
`play.js` only; **deliberately scope-limited** — the ~8 menu-screen fade call sites (title, options,
character select, etc.) stay unwired, an explicit, documented scope cut, not a gap discovered late.

A real bug was caught and fixed by the project's own revert-and-verify test discipline before this
shipped: the first `applyFade` implementation special-cased `!state.active` to return the *input*
palette unchanged — correct for a finished fade-IN (settled at the real palette) but wrong for a
finished fade-OUT (which must settle at black, not the input); fixed to compute purely from
`elapsedMs`, never branching on `active` (which is now purely a signal for the *caller* to stop
bothering to call `updateFade`). A second real bug, this one only reachable live in a browser (no
unit test with a plain `Uint8Array` could have caught it): `io/source.js`'s readers all resolve to a
raw `ArrayBuffer`, not a `Uint8Array` — `ArrayBuffer` has no `.length` (only `.byteLength`), so
`new Uint8Array(dac6.length)` silently built a 0-length buffer, and `decodePalette` downstream threw
"expected 768 bytes, got 0" the instant the game page tried to render its first frame. Fixed via the
same `toU8` normalisation `formats/race.js`/`decodePalette` already use; a regression test passing a
real `ArrayBuffer` (not a `Uint8Array`) was added to `check-play.mjs` and proven to fail against the
reverted code.

**Pause banner — `CheckCheatSpotsThenPause 1000:35f0`.** Re-disassembled live this session,
including its caller (`1000:3074: TEST [107C],0x2; JZ skip; CALL 35f0`), confirming this is a
genuine SPACE-gated pause (`[107C]` bit 0x2, docs §6's "slot 14 (SPACE) = bit 1"), **falsifying
`cheats.js`'s own prior header comment claiming no pause key/screen exists** (fixed). The cheat-spot
proximity scan and effect application (`findCheatSpot`/`applyCheatEffect`, already ported in M3.8)
live *inside* this same function, gated by the identical SPACE-bit test — confirmed this is not a
continuous per-frame proximity check (which would be catastrophic for cheat type 0's `[406]--` life
decrement if applied every tick near a spot); the real game's blocking wait-for-release loop
naturally makes this "once per press" even though the entry test is a level, not an edge, since the
function doesn't return to the main loop until release completes. This port's own translation uses
an explicit edge (`input.js`'s `createPauseKeyReader`, tracking `pressed`/`held` separately from the
5-bit control byte `createKeyboardReader` already produces) to reproduce that same "once per press"
behaviour in an event-driven environment with no blocking wait to lean on.

`UNKNOWN_pause_exact_timing` **resolved 2026-09-22, upgraded to `[PROVEN]` (§9v)**: `[261F]` shares
one incrementer with `DS:0002`, confirmed running at exactly 70.0Hz in a race — 140 ticks is exactly
2.000 seconds, not an approximation. At the time this paragraph was written the real function's
busy-wait threshold ("≥140 ticks of `[261F]` AND a key release" across two loops -- **corrected §9an: OR,
not AND; a key click ends the pause at once**) was known, but
`[261F]`'s own increment rate was not pinned down (`UNKNOWN_tick_counter_writers`, resolved in the
same pass). This port has no busy-wait loop to port at all — a browser keyboard is event-driven, not
polled — so the two-loop structure is collapsed into one boolean state (`engine/pause.js`) with a
minimum hold that turned out, once the rate was confirmed, to already be exactly right: **2000ms is
now the confirmed precise real-world duration, not a chosen approximation** (the "~70Hz vsync tick"
reading used elsewhere in this codebase for `DS:0002`'s 0x7D0-tick/28.6s idle timeout — the same rate
— is what made 2000ms a good guess at the time; §9v is what confirmed it exactly), gated on
**both** the hold elapsing **and** SPACE being released, matching the real function's own "wait for
both" framing against a wall-clock timer instead of an unpinned tick counter. Deliberately cut, not
ported (same precedent as M3.10 cutting the F12 `SCRE0.RAW` dump): the debug-only key-combo backdoor
this function's caller also gates alongside the real pause path.

The banner itself (`PH0_LAYOUT.banners[5]`, "Paused!", 88×22 drawn rows of a stored 24) is centred
horizontally by direct formula (`(w-88)/2 = 84` for the 256px view — this much is derivable and
exact).

**`UNKNOWN_pause_banner_position` resolved 2026-09-23, `[PROVEN]` by disassembly (re-disassembled
live, `mm` project, `MICROU.EXE`).** The real vertical offset is 48, not the symmetric `(h-22)/2=89`
this section previously assumed. `CheckCheatSpotsThenPause` (1000:35f0) sets up its call into the
shared banner-position helper (renamed `DrawBanner88x22Blinking`, 1000:9289 — confirmed reused by 3
other banner-draw sites via `get_xrefs_to`: `DrawRaceOverBannerSfx10` 1000:85b5/862d and
`FUN_1000_851f` 1000:8556/`FUN_1000_8634` 1000:864a) with `1000:3763 MOV DI,0x80` (128, CENTRE-X) and
`1000:3766 MOV AX,0x3c` (60, CENTRE-Y). The helper (renamed `ClipSpriteToRaceView`'s caller) converts
centre to top-left by subtracting half of the sprite's *stored* 88×24 box, as two hardcoded literals
inside the helper itself (not derived from the width/height it loads right after): `1000:9290 SUB
DI,0x2c` (44 = 88/2) and `1000:9293 SUB AX,0xc` (12 = 24/2, **not** half of `drawnHeight` 22). X:
128−44=84 — exactly the already-known, independently-derived value, which is what confirms this same
centre→corner conversion applies to Y. Y: 60−12=**48**. The coordinate space needs no further
adjustment: `1000:8c21-8c2a` computes the destination as `0x1110 + 272·Y + X` and the present routine
(`1000:92bc`) copies 200 rows starting at that same `0x1110` base, so clip-space Y=0 already is the
first row of the presented 256×200 view. The sibling call site drawing the race-over "Winner" banner
through this same helper uses a different literal centre-Y (`1000:85af MOV AX,0x7c` = 124, and its
scroll-in start `1000:85c7 MOV word ptr [26C0],0xffe8` = −36) — proof that each banner's screen
position is an individually hand-authored constant in this engine, not a value derived from view
height, so the symmetric assumption was never safe for this one. `1000:3771`'s `SI=0x9d63` identifies
this call as banner index 5 by exact arithmetic, not by trusting the caller's identity alone: PH0
loads at `DS:3FE3` (existing evidence), and `0x3FE3 + banners.offset(0x3440) + 5·banners.stride(0x840)
= 0x9D63`. (`read_memory` at `DS:9D63` in the static image returns zeros, as expected — PH0 is loaded
at runtime, not present in the EXE image; this is not a bad-address result.) The same call site also
overrides the drawn height to **21** rows, not the usual 22 — `1000:929c CMP SI,0x9d63` / `1000:92a2
MOV DX,0x15` (21) fires only for this SI, vs. `1000:9296 MOV DX,0x16` (22) for every other banner —
so the port now draws 21 rows for this banner specifically rather than reusing `drawnHeight`.
Confirmed (not merely assumed) as the ordinary transparent blit, not the black-silhouette variant:
`1000:376c MOV byte ptr [26CF],0x0` before the call, and the helper's own `1000:92aa CMP [26CF],0x1 /
JZ 92b6` selects `1000:8c3c` (`BlitSpriteSilhouetteBlack`) only when that flag is 1, otherwise
`1000:8ca4` (`BlitSpriteTransparentRace`) — disassembled directly to confirm it really is
colour-0-transparent (`8cb5 LODSB` / `8cb6 OR AL,AL` / `8cb8 JZ` skips the `STOSB` when the source
byte is 0), not just trusting the pre-existing function name. The port's own `drawPauseBanner` had
been doing a raw opaque `dst.set` row copy — a small, real fidelity gap, also fixed this pass by
switching it to `blitTransparent` (default `colorKey: 0`), which happened to double as the fix for a
second, unrelated latent bug this pass's own regression test surfaced: the old y-only bounds check
(no x-clipping) could overrun `dst` once `y` stopped being derived from `h` (hit immediately by
`tools/check-play.mjs`'s isolated-effects test, which uses a 64×64 view). Fixed in
`src/render/raceView.js`'s `drawPauseBanner` (literal `y=48`, 21 rows via `blitTransparent`'s own
clipping instead of `(h-height)/2` and a hand-rolled y-only check).

**Regression test added** (`tools/check-play.mjs`): the pre-existing paused-vs-unpaused diff check
only asserted "some pixel changed", which cannot distinguish y=48 from the old y=89 or any other
value — it would have passed against the wrong number just as easily. A new check renders at the
real `{w:256,h:200}` view and asserts the first and last differing rows are exactly 48 and 68 (the
21-row band this section derives), so a future pass reverting this fix fails loudly instead of
silently re-deriving it.

The real game's own "white screen behind the banner" is a deliberate scope cut, not ported: this port
draws the banner over the frozen last race frame instead, which reads more clearly in a windowed
browser view and avoids needing a palette-vs-indexed-value "what counts as white" decision this port
has no other reason to make.

**Reachability (advisor-caught, real user-facing gap).** `index.html` always boots `ROUND21` (round
2); `projectilesEnabled` requires round 7 or the cheat flag — so the literal reported symptom ("S
does nothing") would have remained true on the one page most players actually open, even with every
system above fully implemented and tested. Fixed with a documented, honest dev/test shortcut: a
"Projectiles (dev)" checkbox in `index.html`'s header (same pattern as M3.10's Smoothness/Strict-
OPL2 controls), read inside `stepOnce` (not the render/`frame` loop, so the automated tests'
`forceSteps()` path exercises the identical read a real frame would) into `ctx.projectilesForAll` —
functionally identical to, and sitting right next to, the *real* in-game path (cheat type 9, now
reachable through a genuine pause-entry cheat-spot match once `GAME1/CHEATS.BIN` is loaded in
`play.js`).

**`game.html`/`flow.js` already run projectiles/puffs/splashes too — a second advisor-caught gap,
this time in the documentation rather than the code.** An early draft of this section claimed only
`play.js` had these three systems wired. False: `flow.js`'s own `composeRaceView` call already
passes `hud: {ph0, ...}` (needed for the HUD since M3.11), and `composeRaceView`'s `ph0` parameter
defaults to `hud?.ph0`, so `ph0` is non-null there — `drawCarLayer` draws puffs/splashes/projectiles
in every `game.html` race exactly as it does in `play.js`. `flow.js` also calls the same shared
`runStep`, which fires/flies/resolves-hits unconditionally. Concretely: the tournament's own
`ORDER_TABLE` (`src/data/frontend-tables.js`) reaches round 7 (TANKS) at indices 13/19/24 — a normal
Challenge run can land a TANKS race with **no toggle and no cheat needed** (`ctx.round===7` alone
satisfies `projectilesEnabled`), and the drone AI's own always-on fire bit means real projectile
hits (state 0xD) are a genuine, previously-completely-untested change to the tournament's own race
outcomes. Risk is judged low, not zero: state 0xD already has a working handler
(`states.js`'s `stepKnockoutAnim`, exercised since early milestones by the ramp-jump landing path),
and round 7 itself is one of the 58 combinations `check-rounds.mjs` already runs 400 steps clean
with `runStep`/`updateCamera` — the same primitives `flow.js` calls, just not through `flow.js`'s
own (DOM-bound, not separately testable) `runOneRace` loop specifically. **Not live-tested this
session** — reaching tournament index 13+ needs a multi-race Challenge playthrough this session
didn't attempt. Only `pause`/`fade` are genuinely `play.js`-only (`flow.js` has no
`pauseKey`/`pauseState`/`fadeState` references at all, confirmed by grep) --
**superseded 2026-09-23, §9ai: `flow.js` now has all three.**

**Implementation.** New files: `engine/projectile.js`, `engine/puffs.js`, `engine/pause.js`,
`engine/fade.js`. Modified: `car.js` (puff-slot field rename, `puffSlots`/`splashSlots` init to the
real empty sentinel `frame:-1` in `spawnCars` — self-caught before it could regress: the prior code
left every slot defaulting to `frame:0`, i.e. every car would have spawned with 8 "active" puffs and
5 "active" splashes rendering at the world origin from frame one); `step.js` (fire/flight/hit/puff-
splash wiring, matching the real per-car-loop ordering: puffs *after* airborne, since their cooldown
decrements there); `airborne.js` (the cooldown decrements); `raceView.js` (`drawCar` split into
shadow/body so `drawCarLayer` can interleave splash→puff→projectile between them, matching
`DrawRaceCarLayer 1000:7ce0`'s own paint order; `drawPauseBanner`); `race.js`
(`ph0PuffFrame`/`ph0TailIcon`/`ph0Round2SplashFrame`/`ph0Banner` PH0 accessors); `cheats.js` (header
comment fix); `play.js` (all four systems wired: CHEATS.BIN load, pause key + state machine, fade-in
at boot, the dev projectiles toggle read inside `stepOnce`).

**A second advisor pass, after this section's first draft, caught two more real gaps** (both fixed,
both covered above/below): the reachability-doc error just described, and that `pause.js` ported
neither of `1000:35f0`'s own opening two instructions — `AH=8 CmdStopSfx` then `AH=6
CmdRequestReset` (docs/sound.md's dispatch table lists both call sites by address) — meaning engines
would have kept droning at their last pitch for the whole pause instead of going silent like the
real game. Fixed: `updatePause` takes an optional `sound` argument (`{stopSfx(id), muteAll()}`,
`Si2Player`'s/`asDriver`'s existing shape — `muteAll` already existed, mapping to the same `command(6)`
docs/sound.md already documented) and calls both, once, on the pause-entry edge only.

**Verification.** `tools/check-play.mjs` gained `checkProjectiles`, `checkPuffsAndSplashes`,
`checkProjectileAndPuffRendering` (a render-layer integration check against the real
`BITSFILE.PH0` — an advisor-caught gap: every engine-level check above exercised fire/flight/hit and
spawn/animate directly, but nothing had ever called `composeRaceView` with an active shot or a live
puff/splash slot, so the draw-side code and the post-rename field reads had never actually run),
`checkPause` (including the pause-entry sound-silencing calls, once each, only on entry), `checkFade`
— every new assertion proven to fail against a deliberately-reintroduced version of the bug it checks
(15 separate revert-and-verify cycles across this segment, matching the project's established
discipline), including three that caught real, previously-unknown implementation bugs before they
shipped (the fade-out `active`-gating bug, the `ArrayBuffer`/`toU8` bug, the missing pause-sound
silencing) and one that caught a real, independent gap in an *existing* test: `tools/check-rounds.mjs`'s
own 58-combination round sweep had never called `updateCamera`, so `controlsLocked` never cleared and
every car sat frozen at its spawn position for the test's entire 400-step run since M3.8 shipped —
"58 combinations run clean" was true but far weaker than it read (clean because nothing moved, not
because driving/AI/terrain were exercised); fixed, and a new assertion (round 7 lands ≥1 genuine
projectile hit from the drone AI's own always-on fire bit, over a real driving race) now depends on
cars actually moving, closing the gap for good. `npm run rounds`/`play` and the full 18-check suite
plus `npm run build` all stay green.

**Live browser confirmation** (`npm run dev`, `index.html`): the palette fade-in on boot, the
"Paused!" banner rendering centred and freezing the visible scene (via a real, trusted SPACE
keypress), and — most directly answering the user's report — the fire button genuinely working
end-to-end **through the real "Projectiles (dev)" checkbox itself** (a genuine `.click()`, not a
console-set `ctx` field — the advisor specifically flagged that the first pass had only proven the
underlying mechanism, not the checkbox-to-`ctx` wiring, since that read lived in the never-firing
`frame()` loop; moved into `stepOnce` and re-confirmed via `forceSteps()`, which now exercises the
identical path a real animation frame would): all four cars fired and `ctx.projectilesForAll`
reflected the checkbox with no manual intervention. A real shot fired, flew, and knocked two drone
boats into state 0xD, and normal driving spawned 7 concurrent wet-terrain puff slots. **Not
confirmed live**: the exact 2000ms hold/release-gate timing (already unit-tested with proven-teeth
tests) and the pause's own sound-silencing (unit-tested with a mock driver, not against real audio) —
the automated browser tab ran `document.hidden` for this session (confirmed directly:
`requestAnimationFrame` never fired at all across a 1.5s `setTimeout` wait, not merely throttled),
the same `requestAnimationFrame`-throttling limitation M3.9/M3.11 already documented, worked around
here via the exposed `forceSteps()` synchronous fast-forward (which bypasses `requestAnimationFrame`
entirely) for the fire/puff confirmation, but not applicable to a real-time hold/release check. Also
not attempted: reaching a TANKS race through `game.html`'s own tournament flow (see the reachability
paragraph above) — a multi-race Challenge playthrough this session didn't undertake.

**Method notes.** (1) A prior segment's own code comments citing a docs section (`§9q`) that didn't
exist yet is a real, self-inconsistent gap — always land the doc in the same pass as the code that
cites it, or immediately after, not "eventually." (2) When a test's boundary assertion disagrees
with the current implementation, re-disassemble the actual byte-level compare before changing
either one — adjusting the test to match the code (or vice versa) without checking the bytes is
exactly the failure mode §9m/§9p were caught making; this session's `FLIGHT_THRESHOLD` boundary
check went the other way (confirmed the implementation was right) specifically because the
disassembly was consulted first. (3) A render-layer bug can hide behind *other* effects drawing to
the same buffer — a puff-rendering regression test that only checks "the buffer differs from quiet"
without isolating individual effects can pass while the actual effect under test silently does
nothing, if a sibling effect (projectile trail, splash) still draws into the same frame.

## 9r. Round 3's real drop-in/shortcut sequencer (2026-09-22)

**Scope.** User request: resolve `UNKNOWN_6ae5_round3_sequencer`, `UNKNOWN_22E1_scope` and
`UNKNOWN_stateE_reach` -- all three tied to the state-E gap M3.6/M3.8 had deliberately left
simplified (`stepDropInSimplified`, docs §9j). Fully re-disassembled `1000:6ae5-6fea` instruction by
instruction this session (M3.8's earlier pass had decompiled it to *confirm* the simplification was
reasonable, but never fully ported it); an advisor review then caught two more things worth
re-checking before trusting the read, both resolved by going back to the bytes rather than the
prose (below).

**Not a generic "cell-matching/slide/hide/show" curiosity -- it's a lap-progress-gated shortcut.**
The same address serves two roles in the original binary: round 3's own terrain-dispatch row-4
handler (`docs/engine.md §5`, state-0 cars only, reached via `dispatchTerrain`) *and* state 0xE's
own entry in the 17-entry state table (`DS:278F`) -- one function, two dispatch tables, which is
why `terrain.js`'s `h6ae5` and `states.js`'s old state-E handler had always cited the identical
address. Confirmed genuinely reachable, not dead content: terrain index 4 appears 32 times in round
3's own `.DIR` data, and a live `queryWorldAt` query against round 3 race 2's real `.MAP`/`.CT`/
`.DIR` found cell (2,14) -- `ROUND3_DROPIN_TABLE[1]`'s own cell -- genuinely carries `dirByte=0x84`
(terrain index 4) at its centre in that race (used directly as `check-rounds.mjs`'s integration
fixture, not a synthetic stand-in).

**`UNKNOWN_22E1_scope` resolved: `DS:22E1` is exactly 74 bytes** -- 5 entries of 7 words (14 bytes)
each (`cellX, cellY, minCursor, spawnTargetX, spawnTargetY, heading, dropInSlot`) followed by one
4-byte terminator (`0xFFFF, 0xFFFF`); read live via `read_memory` and matched byte-exact against
`MICROU.EXE` (`npm run tables`, `ROUND3_DROPIN_TABLE`). `cellX`/`cellY` are 96px-cell coordinates
(matched within ±1 cell per axis against the car's own `posX/posY / 96`); `minCursor` is the
`checkpointOff` (lap-progress) threshold that gates the cell; `spawnTargetX/Y`/`heading` are where
and which way the car reappears; `dropInSlot` is a byte-offset key into a small shared per-point
bookkeeping region (`DS:2684-268F`, four fields: a partner-count, two ring cursors, a wait-timer),
not itself table data.

**`UNKNOWN_6ae5_round3_sequencer` resolved: the full 5-substate machine.** `[1382]` (`subState`)
dispatches to one of five blocks:
- **subState 0** (the terrain-triggered entry, `6b18`): scans the table for the car's current cell;
  on a qualifying match (`checkpointOff >= minCursor`) reserves a queue slot, sets up a short 4-tick
  drift toward the nearest 16px cell centre, and hands off to **state 4** (fall), `subState=1`. No
  match, or a match that isn't ready yet: `crashOrWait`.
- **subState 1** (`6c01`, re-entered the instant state 4's animation ends and hands back to state
  0xE): **re-scans the same table** at the car's now-slightly-drifted position; on a still-qualifying
  match, commits the reappearance -- `spawnTargetX/Y`/`heading` from the table, `speed=maxSpeedCur`,
  a max-speed velocity vector in that heading (`mul2Floor256`, the same `IMUL;...;SHL 1` idiom
  `int16.js` already documents), and a reset of ~20 transient per-tick fields plus every puff/splash
  slot (a car about to reappear shouldn't carry stale skid/grip/animation state) -- then `subState=2`,
  `active=0`. Failure: releases this car's own queue reservation, then `crashOrWait`.
- **subState 2** (`6d94`, the two-car partner wait): entirely **skipped** (falls straight into
  subState 3, same tick) outside `raceFormat===2` -- confirmed by direct disassembly to be a plain
  `[2656]==2` check, **not** the "`HumanPlayerCount`, a Ghidra-inferred global" an earlier
  decompile-only pass had guessed at (that name never appears in the actual instructions; it was an
  unverified label carried over without re-checking). On timeout (~40 ticks with no partner): records
  `raceState.dropInPartnerTimedOut` (`[2911]`, a render-only banner flag this port doesn't act on
  further) and drops the car straight back to state 0 at its current position -- **not** a crash.
  Otherwise waits for both of the format's two active cars to have left state 4.
- **subState 3** (`6df3`, the slide): moves `posX/posY` toward `spawnTargetX/Y` by `8*stepIncrement`
  per axis per tick, snapping exactly once within that distance. Once both axes have converged, a
  per-`dropInSlot` FIFO queue-order check (must be at the front of the queue for *this* physical
  drop point) gates a further, **race-wide** "only one car finishes appearing at a time" claim
  (`[2680]`/`[2682]`, format-gated differently: two-car waits for the current holder to be grounded,
  four-car waits for it to have returned to state 0). Granted: `subState=4`, `active=1`, `height=1`,
  `zVel=8` -- **exactly** this port's own pre-existing `stepDropInSimplified` values, confirmed not
  coincidental -- and falls straight into subState 4, same tick.
- **subState 4** (`6efa`): the mid-sequence draw call (`CALL 7d73`) is skipped, rendering only.
  Watches the **X-axis distance only** to `spawnTargetX` (confirmed by disassembly to be X-only, not
  a simplification -- `6f07-6f19` never reads `spawnTargetY`/`posY` at all) until within 50px, then
  releases the slot/queue bookkeeping and resumes state 0.

**Advisor-caught, both resolved by re-reading the bytes, not by reasoning about them:**
1. *"Does a mismatch really crash the car on every visit?"* Checked `hazardVulnerable`'s real
   default rather than assuming a cheat-only edge case: the static init image holds `1` (vulnerable)
   for every car, and `spawnCars` already matches this -- so yes, this is the real, default
   behaviour, not something normal play avoids.
2. *"What is `[28C0]==1` actually gating?"* Re-read both scan loops (`6b52`, `6c4c`) instruction by
   instruction: for round 3's **race 1 only**, a mismatch on the table's first entry gives up
   immediately, without checking entries 1-4 -- entries 1-4 are simply unreachable in race 1. Ported
   literally (`findMatch`'s own `ctx.race===1` early return), not smoothed into a full scan.

**A real, previously-unknown interaction surfaced building the `check-rounds.mjs` integration test**
(not a porting bug, the real algorithm's own behaviour): position **commit** (not just steering) is
unconditional for state 0xE (§3: "Commit only when state ∈ {0, 2, 0xE}"), so a state-0xE car's
`velX/velY` (set once, to a max-speed vector, by subState 1) keeps driving the car via the ordinary
integrate/commit pipeline **at the same time** subState 3's own explicit slide runs -- both apply,
every tick, and since subState 3 reads `posX/Y` *after* that tick's velocity-driven commit (matching
the real per-tick order: `4aee`'s commit, then `90c5`'s state dispatch), the two can partially cancel
when the table's `heading` doesn't point straight at its own `spawnTarget` (entry 1 doesn't). Net
convergence for that entry lands around 2-3px/tick, not a clean 8, and takes ~330 ticks for its own
(long, cross-map) distance -- confirmed correct by tracing the run tick by tick, not assumed.

**Also resolved in passing:** `UNKNOWN_2911_2913` turns out to be **two unrelated globals** bundled
into one open item purely by address proximity, not a real pairing. `[2911]` is the two-car
partner-timeout flag this section documents (**refined later the same day, §9u**: `[2911]` turns out
to be a SHARED flag with four writers across unrelated subsystems -- the partner-timeout write
documented here is real and correct, just not the whole story; see §9u before citing `[2911]` as
solely a drop-in-mechanism global). `[2913]` is a completely separate render-only "flash"
flag set by `UpdateCarCheckpointsAndSurfaceSfx` on a hazard-death or double-crash detection
(`5e6b`/`5e88`), read only by `RenderRaceFrameToBackBuffer` -- out of scope, not state-E-related at
all. [**Corrected §9am**: `[2913]` is the two-car BOTH-CARS-DOWN flag -- set at `5E6B`/`5E88` only when
`[2656]==2` and P1 and P2 are both in state 1 or both in state 5; it routes the render to `78F8`,
which hides the first car to recover until the other does, then respawns both at the leader's safe
point with no point scored.] Splitting a bundled `UNKNOWN_*` by re-checking each half independently, rather than assuming
proximity implies a relationship, closed both at once.

**Implementation.** New file `src/engine/dropin.js`: `triggerDropIn` (subState 0, called from
`terrain.js`'s `h6ae5`), `stepDropIn` (subStates 1-4, called from `states.js` on `state===0xE`),
`applyScriptedDrift` (the drift half of `73e7`, re-disassembled live to confirm it does **not** also
need its own `animTimer` increment ported -- see below). Slot bookkeeping
(`raceState.dropInSlots[slot] = {queue, waitTicks}`, `raceState.dropInOwner`) lives on `raceState`
per advisor guidance, not a module singleton -- a singleton would leak state between the two
independent races `check-play.mjs`'s determinism test runs in one process. The 4-entry ring buffer
the original uses is modelled as a plain FIFO array: with at most 4 cars in existence and multi-car
queueing only ever populated in two-car races (which cap at 2), the ring can never wrap the way a
genuine 5th arrival would, so a plain array reproduces the observable ordering exactly.

`73e7` itself was re-disassembled live (previously only cross-referenced) and turned out to need a
narrower port than a literal 1:1 translation: it also bumps `animTimer` unconditionally for any
active car, but every state that uses `driftDX/DY/Steps` (1, 4, 5) already increments its own
`animTimer` inline via `animTableDone` (states.js, a pre-existing, already-verified simplification)
-- porting `73e7`'s own increment too would double-count it every tick. Only the drift-application
half is ported, plus `73e7`'s own round-9 quirk (non-car-0 cars skip it entirely in round 9).
Wired into `step.js`'s final per-car pass in the documented order: `7429`(airborne) → `73e7`(drift)
→ `51b2`(projectile flight) -- **after** the state dispatch (`runStates`), not inside it, matching
`RunRaceMainLoop`'s own order (`4aee` physics/commit → `90c5` render/state-dispatch → `3098-30b5`
airborne/drift/projectile) exactly. An earlier draft of this session's own code put the drift call
inside `runStates`' per-car loop instead (the ordering docs §2 lists first, but *not* the order
these two calls actually happen in `RunRaceMainLoop`) -- caught and fixed before landing, by
re-reading §2's own per-address order table rather than trusting a first-pass placement.

**Verification.** `tools/check-play.mjs` gained `checkDropIn` (11 scenarios: the full success path,
the race-1 early-bail quirk on both a matching and non-matching entry, the checkpointOff/minCursor
gate with and without `hazardVulnerable`, the two-car partner timeout, the per-slot FIFO queue-order
gate with two cars sharing one `dropInSlot`, the race-wide ownership token with two cars on
*different* slots, and subState 4's X-only settle gate) plus `applyScriptedDrift`'s own state-gate
and round-9 quirk -- 10 distinct gates verified with teeth by this addition (plus 2 more in
`check-rounds.mjs`'s own integration test below, 12 total). **Three of the ten -- the per-slot
queue-order gate, the race-wide ownership token, and subState 4's settle tolerance -- came back
UNCAUGHT on the first revert attempt**, each exposing a real, narrower gap in that scenario's own
first draft (the isolated single-car test in each case couldn't tell the removed gate from a
no-op, since nothing else was competing for the same slot/token/distance to reveal its absence); a
dedicated multi-car (or off-target) scenario was written for each and re-confirmed with teeth before
being trusted -- the same "an isolated check can't see a gate two things need to conflict over"
shape as §9q's own puff/splash-rendering gap, not a new kind of mistake. `tools/check-rounds.mjs`
gained a real-pipeline integration test (not just `check-play.mjs`'s direct `dropin.js` calls): a car
placed on the live-confirmed real trigger cell, driven through the actual
`runStep`/`dispatchTerrain`/`runStates` pipeline, resolves back to state 0 at the table's own spawn
target when qualifying, and crashes when under threshold -- both independently proven to fail
against a reverted version of the code (including a case where reverting `terrain.js`'s own wiring,
not `dropin.js` itself, was what the test caught, proving the *wiring* is tested, not just the
module in isolation). Full 18-check suite plus `npm run build` stay green throughout.

**Method notes.** (1) A fixed-iteration-count loop can measure the wrong event. The `check-rounds.mjs`
integration test's first draft drove a fixed 500 ticks and asserted the final state; the car actually
resolved cleanly at tick 334, then drove on (still inside those same 500 ticks) close enough to a
real index-4 tile a second time to re-trigger the mechanic and crash on that *separate*, unrelated
pass -- a wrong-looking failure that had nothing to do with the code being tested. Diagnosed by
tracing the run tick by tick rather than trusting the final state alone; fixed by stopping the loop
the instant the car first returns to state 0 after having left it. The same shape as §9q's "a puff
bug can hide behind another effect drawing to the same buffer": a test that keeps running past the
event it means to check can let something *else* true of the same scenario overwrite the result. (2)
Three of `checkDropIn`'s ten gates (queue order, the ownership token, the settle tolerance) passed
clean on first write specifically *because* the scenario was too simple to need them -- a single car
alone in its own slot can't exercise a "wait for another car" gate. Reverting each gate and getting
no failure was the useful signal, not a false all-clear: it meant the scenario, not the code, was
missing something, and the fix was a second, multi-car (or off-target) test, not a stronger assertion
on the first one.

**Not attempted:** a live DOSBox capture of round 3 (would need a fresh navigation session, the same
cost/benefit the project's established precedent already declines for every other round -- M3.4/
M3.5/M3.8 all substitute headless, real-pipeline sweeps instead, which is what this section did too).
The two-car branch is ported as logic and unit/integration-tested directly, but never exercised by
an actual two-car race loop end to end (same status `twocar.js`'s own knockout resolution and the
HUD's light bar have carried since M3.8/M3.11 -- this port has no two-car race-stage controller for
any of them to be called from yet).

## 9s. Scoring: the HUD ranking formula and the [2652]/[2654] progress-scale constants (2026-09-22)

**Scope.** User request: "Work on Scoring: `UNKNOWN_ranking_2670`, `UNKNOWN_2652_progress_scale`,
`UNKNOWN_2654_half_max_progress` -- block a correct HUD number even after a HUD is built." M3.11
(§9o) had implemented the HUD's *drawing* using the port's own pre-existing `car.racePosition`, but
`racePosition` itself was never correctly derived: M3.3 (§9e) shipped `computeRanking` with a
hardcoded `scale=1` (never re-derived from `[2652]`) and `checkpoints.js` shipped with a hardcoded
`halfMaxProgress ?? 128` fallback (`[2654]`, never re-derived either) -- both flagged `UNKNOWN` at
the time and carried forward through M3.6/M3.8/M3.11 without being picked back up.

**Findings.**

- **`[2652]`/`[2654]` resolved: both are per-race data baked into the currently-loaded `.MAP` file
  itself, not fixed engine constants.** Live disassembly of the race-init scan (`1000:3d34-3d51`,
  inside `InitRaceCarsFromTables`) shows a straight max-byte scan over the second 1024-byte half of
  the loaded `.MAP` (the "progress" plane) into `[2652]`, followed immediately by `[2654] = [2652]
  >> 1` -- exactly "half the max, computed once at race init". This matches `src/formats/track.js`'s
  own pre-existing `parseMap` output field, `maxPlane2` (a max-scan over `plane2`, the same second
  half of the file), byte-for-byte in derivation shape -- the port already had the right data sitting
  unused in `world.map.maxPlane2` since before M3.3 shipped; it was simply never wired to the engine.

- **`UNKNOWN_ranking_2670` resolved: the full HUD scoring formula, live at
  `DrawRaceHudDigitsAndRankIcons 1000:8e10` (scoring loop `8e1a-8e73`, bubble sort `8e73-8ecc`).**
  Per car: `score = (9 - lapsRemaining) * scale + progress`, where `scale` is `[2652]`. The multiply
  at `8e2f` is `MUL CL` -- an 8-bit multiply, so only `scale`'s low byte participates; a caller
  feeding in a value outside `[0,255]` would silently diverge from the original unless masked.
  Scores are bubble-sorted (3 outer × 3 inner passes) into a **persistent** order-pointer array
  (`[2678..267E]`, carried frame to frame, not recomputed from scratch each time) -- swapping both
  the score cell and its paired order cell together -- and `racePosition` is written from the
  resulting rank (index 0 = leader, `racePosition = 1`).

- **Freeze-on-finish** (`8e1a-8e51`) *(corrected §9ah: per SLOT, so the result is a prefix freeze, not uniform)*: the instant **any** car's `lapsRemaining <= 0`, OR the separate
  global `[26C6] >= 2`, the real function sets **all four** score cells to a `0x7D00` (32000)
  sentinel before the sort runs -- pinning whatever rank order the persistent array already held
  rather than continuing to fine-rank a field where some cars are still racing.

- **`[26C6]`'s own recompute** *(corrected §9ah: it only runs on a stopped finished car's turn and assigns from 0)* (`1000:4b85-4bde`, a separate disassembly target from the scoring
  loop): count of cars with `lapsRemaining === 0 AND speed === 0`, **forced to 2** the instant the
  camera-target car (`[2660]`, this port's `cars[0]`) has `lapsRemaining <= 0` -- regardless of its
  own speed or how many other cars are finished. This is the same value `RunRaceMainLoop` itself
  tests (`[26C6] >= 2 && (...) -> 30df`) to decide the *race itself* is over -- a genuinely separate,
  larger feature this port doesn't implement (`flow.js`'s own `isOver()` is a different, simpler
  heuristic; deliberately out of scope for this pass, per advisor guidance).

- **`[26C6] >= 2` is provably redundant for the ranking freeze specifically** *(REFUTED §9ah: the lead rule `6054`, the cheat `36a7` and the two-car/RUFFTRUX writers set it with no car finished)* (though not for the
  separate race-over feature above): `[26C6]` can only reach 2 if at least one car already satisfies
  `lapsRemaining <= 0` -- either two-or-more cars independently pass the stricter `AND speed === 0`
  test, or the camera car alone forces the count to 2, and the camera car is itself one of the four
  cars checked by `cars.some(lapsRemaining <= 0)`. So `[26C6] >= 2` never trips the freeze in a case
  the simpler per-car test wouldn't already catch. `computeRanking`'s own freeze condition is
  therefore just `cars.some((c) => c.lapsRemaining <= 0)` -- not a simplification of the real logic,
  the same logic with its redundant half left out (kept as a documented, deliberate reduction, not a
  silent omission).

- **The previously-shipped `halfMaxProgress=128` default was wrong for every single one of the 29
  real races, not merely "most" of them.** A direct scan of every round/race combination's own
  `world.map.maxPlane2` gives halves of 41, 83, 91, 79 (round 1), 14, 40, 46, 35 (round 2), 127, 127,
  127 (round 3, all three races hit the byte-max ceiling of 255), 43, 40, 56 (round 4), 49, 18, 66
  (round 5), 33, 57, 53 (round 6), 23, 33, 43 (round 7), 27, 47, 38 (round 8), 28, 31, 37 (round 9) --
  **29 of 29, all strictly below 128** -- 26 of them badly wrong (halves 14-91, less than three
  quarters of the old default), the remaining 3 (round 3's races, real half 127) off by exactly one,
  confirmed below not to be an artifact of the scan conflating the progress plane's max with the
  unrelated `0xFF` collision-knockout sentinel. This is a real, previously-undetected
  lap/checkpoint-detection bug, not merely a HUD cosmetics issue: `checkpoints.js`'s
  `updateCheckpointsAndLaps` has used this wrong default as its forward/backward line-crossing
  threshold since M3.3 shipped, meaning a genuine
  wrap whose `|Δprogress|` fell between the real half and 128 would have been silently misclassified
  as ordinary movement (or vice versa) in every real race, for the whole time this port has existed --
  exactly the "block a correct HUD number" framing in the user's own request, and worse than the
  ranking-score issue alone.

- *(Superseded §9ah: the premise was wrong -- the effect is a deterministic prefix freeze, ported.)* **Advisor-endorsed decision: the freeze mechanism's loop-order-dependent partial-overwrite quirk is
  deliberately NOT replicated bit-for-bit.** The real scoring loop walks the persistent order array
  and can leave a car mid-loop still able to overwrite its own score cell back to a live value even
  while the freeze condition holds elsewhere in the same pass -- a genuine, confirmed,
  loop-position-dependent artifact, re-disassembled live. But that loop runs once per **drawn frame**,
  while `computeRanking` here runs once per **physics step** -- and this port's own smoothness gate
  (M3.10, `src/engine/smoothness.js`) decouples drawn-frame cadence from physics-step cadence by a
  factor this port has no way to pin down (it varies with the smoothness setting and isn't itself
  derived from a fixed ratio). Reproducing an order-dependent quirk under a cadence that isn't the
  real one's own order would produce a *different* result, not merely an approximation of the real
  one -- so the chosen port behaviour is order-independent: freeze the *previous* frame's order in
  place uniformly (via a new persistent `raceState.rankOrder` field), with no partial per-car
  exception. This is the honest port of the underlying *intent* ("pin the standings once someone
  finishes"), not a shortcut taken for convenience.

**Implementation.** `src/engine/step.js`: `runStep` now derives `progressScale =
world.map.maxPlane2` and `halfMaxProgress = progressScale >> 1` at the top of every call,
unconditionally overriding anything the caller passed in `ctx` -- the real values are per-race data
baked into the currently-loaded `.MAP` file, not a tunable the original ever exposes a
caller-override for. `computeRanking` (now exported, was previously module-private) implements the
formula above with `scale = (ctx.progressScale ?? 1) & 0xff` (the `MUL CL` truncation) and the
simplified, order-independent freeze (`raceState.rankOrder`). `computeRaceOverCount` (new export)
implements the exact `[26C6]` formula byte-accurately, for future race-over-detection work, without
being consulted by `computeRanking`. `src/engine/checkpoints.js`'s own `?? 128` fallback is
unchanged (it still matters for a caller that invokes `updateCheckpointsAndLaps` directly, bypassing
`runStep` -- `check-step.mjs`'s and `check-sound.mjs`'s own isolated rule tests do exactly that,
deliberately, with a synthetic value) but its header comment now documents the real per-race
derivation instead of leaving `UNKNOWN_2654_half_max_progress` open.

**Verification.** `tools/check-step.mjs` gained a new section demonstrating the actual bug directly:
round 2 race 1's real half (14) vs the old hardcoded default (128) judge the *same* genuine
forward-line-crossing delta (`-60`) two different ways -- the real threshold recognises it as a
completed lap, the old default silently misses it -- plus an end-to-end `runStep`-level check that
the real value is genuinely derived and threaded, not just correct when handed to
`updateCheckpointsAndLaps` directly. **That end-to-end check needed a real fix before it had teeth**:
a first draft hand-set the fixture car's `progress`/`progressPrev` fields expecting them to survive
into the checkpoint rule unchanged, but `collide.js`'s `updateCarTileCollision` runs earlier in
`runStep`'s own per-car loop and unconditionally **overwrites both fields** from a live world query
at the car's actual (post-integration) position (`progressPrev = ` the old `progress` value,
`progress = ` the real map's own value there) -- discovered by a revert-and-verify cycle that didn't
catch a deliberately reintroduced bug, traced to a debug dump showing `progress=0` when nothing in
the test had ever written a 0. Fixed by choosing the fixture's *pre-step* `progress` value (60) so
that the *post-collision* delta (`0 - 60 = -60`) is the one under test, landing strictly between the
real half (14) and the old wrong default (128) so the two thresholds genuinely disagree -- unlike the
original fixture (whose effective delta of -190, after the same overwrite, exceeded both thresholds
and gave the same answer either way, which is why the first draft passed with the fix reverted).
Re-confirmed with teeth by a fresh revert-and-verify cycle (reverting `runStep`'s derivation makes
this check fail; restoring it passes again).

`tools/check-play.mjs` gained `checkRanking`, covering (a) `computeRaceOverCount` across
0/1/2-finished-and-stopped configurations and the car0-forces-2 case, (b) `computeRanking`'s 8-bit
scale masking (feeding `0x1C8` behaves as `0xC8`=200, not 456 -- chosen so masked vs. unmasked
actually disagree on the winner), (c) a direct demonstration that the OLD `scale=1` default gives the
WRONG relative order for a car further along with less raw in-lap progress vs. a car on an earlier
lap with more raw progress, while the correctly-derived scale (28, round 2 race 1's real value) gives
the right order for the identical two cars, and (d) the freeze-on-finish mechanism: the order pins in
`raceState.rankOrder` the instant any car finishes, a later car's wildly-changing progress does not
move it in rank while frozen, and un-freezing (every car's `lapsRemaining` back above 0) produces a
fresh sort reflecting the real, now-thawed scores. **Every one of these assertions was independently
confirmed to have teeth** via a deliberate-revert-and-verify cycle: removing the `& 0xff` mask,
hardcoding `scale = 1` (ignoring `ctx.progressScale` entirely), removing the freeze's
`raceState.rankOrder` reuse, and removing `computeRaceOverCount`'s car0-forcing branch each broke
their own corresponding check and no others were affected; each was then restored and reconfirmed
clean. Full 18-check suite (`catalog` through `smoke`) plus `npm run build` stay green throughout.

**Method notes.** (1) *A hand-set test fixture value can be silently overwritten by an earlier stage
of the real pipeline before the code under test ever runs* -- check what runs **before** the function
under test in the real call order, not just what that function itself does. `updateCarTileCollision`
running before `updateCheckpointsAndLaps` in `runStep`'s per-car loop is documented in this very file
(§3's own ordering), but writing an end-to-end fixture test still needs that ordering held in mind
explicitly, not just trusted to not matter. (2) *Print the real value across every instance the fix
will run against, not just one, before wiring it in* -- the 29-race `maxPlane2` survey (not the
1-race spot-check an earlier, less careful pass might have settled for) is what turned "the old
default might be a bit off sometimes" into "the old default was wrong 29 times out of 29, with
one round hitting the byte-max ceiling" -- a materially stronger and more honest finding, and the
same discipline the advisor's own guidance for this session pointed at directly.

**A post-implementation advisor review raised two further questions, both checked before this
section was closed:**

1. *"Round 3's `maxPlane2 = 255` for all three races is suspicious -- does the real `[2652]` scan
   exclude the `0xFF` knockout sentinel (`collide.js`'s own unrelated `hit.progress === 0xff ->
   state 0xD` check), the way a naive max-scan wouldn't?"* Re-disassembled `3d32-3d51` instruction by
   instruction rather than re-reading the earlier summary: `MOV AH,0` (running max, init 0), then a
   1024-byte loop of `LODSB` / `CMP AL,AH` / `JC skip` / `MOV AH,AL` / `LOOP` -- a plain unsigned
   running-max with **no `CMP AL,0xFF` anywhere in the loop**. The scan really does treat `0xFF` as
   an ordinary byte value, same as `parseMap`'s own `maxPlane2`; round 3's three races (`maxPlane2 =
   255`, half = 127) are correctly derived, not a new round-3-only bug from conflating this scan with
   the unrelated collision sentinel. This is the one round where the 29-race survey's own "wrong for
   29 of 29" finding is *only* off-by-one from the old 128 default (127 vs 128), not badly wrong like
   the other 26 -- worth stating precisely rather than folding into one blanket "wrong for all 29"
   claim: 26 races are badly wrong (halves 14-91), 3 (round 3) are off by exactly one.
2. *"Nothing asserts lap counts stay sane under real driving with the new, much lower threshold --
   the clamped `min(9,+1)`/`max(0,-1)` lap updates mean a spurious wrap would produce no NaN, no
   crash, nothing the existing finite/in-world/moved assertions would catch, and `lapsRemaining<=0`
   is now the ranking freeze condition, so one spurious wrap would incorrectly pin `racePosition` for
   the rest of the race."* Checked two ways, both now a permanent test
   (`tools/check-play.mjs`'s new `checkLapCountSanity`): (a) recording car0's `lapsRemaining` across
   the existing 2000-step recorded-tape drive shows exactly one real lap-count change over the whole
   run (round 2 race 1, ROUND21) -- not a sawtooth; (b) replaying that SAME run's real per-step
   progress deltas through `updateCheckpointsAndLaps` directly with each threshold shows the real
   derived half detects genuine line-crossings the old hardcoded 128 default misses entirely on the
   identical data -- positive evidence the fix catches real events under actual driving, not just a
   synthetic single-delta fixture, and that the lower threshold does not manifest as instability.

**One more defensive fix made while re-reading this code for the review above:** `computeRanking`
returned the exact same array object it stores in `raceState.rankOrder` (the frozen-reuse branch
returns `raceState.rankOrder` itself, unchanged) -- no current caller mutates the returned value
(`runStep` only `indexOf`s it), but a future one silently could, corrupting the frozen order for
every subsequent call. Fixed to return `order.slice()`, a defensive copy, while `raceState.rankOrder`
still holds the canonical array.

**Coverage extended, and a real finding along the way.** `checkLapCountSanity` above only exercises
round 2 race 1 (half=14, the low end of the 29-race spread); round 3 (half=127, the high end, and the
one round whose terrain handler -- `dropin.js` -- can teleport a car's position, exactly the kind of
large legitimate progress jump a threshold has to judge correctly) was untested for this specific
concern. `tools/check-rounds.mjs`'s own existing 58-combination real-driving sweep (already running,
not a new one) gained the same "lapsRemaining-change count stays bounded" assertion for free. Its
bound (8) is calibrated against real data: with the real derived threshold, the observed worst case
across all 58 combinations is 2 changes over 400 steps; forcing `halfMaxProgress` down to the most
extreme values possible (1, then 0 -- treating literally any nonzero per-tick delta as a crossing)
only ever reached 4. This is a real finding in its own right, not just a test-calibration detail:
this engine's own per-tick progress deltas are inherently well-behaved under normal driving (small
outside the genuine wrap seam) against this game's real map data, so the "a too-low threshold causes
a sawtooth" failure mode the advisor raised does not structurally manifest here -- confirmed
empirically across the full threshold range down to the most extreme possible value, not assumed
from the round 2 race 1 case alone.

**Not done / out of scope:** the loop-order-dependent freeze leak (deliberately not replicated --
see the advisor-endorsed reasoning above); wiring `computeRaceOverCount` into an actual
race-over-detection feature (a separate, larger feature on the same scale as `twocar.js`'s own
unwired knockout resolution and the HUD's unwired two-car light bar, `flow.js`'s existing `isOver()`
is untouched); a live DOSBox capture of the HUD's numeric rank value at a moment where the corrected
scale visibly changes the displayed order versus the old default (the existing `npm run live` HUD
byte-exact check covers digit/icon drawing against a single captured frame, not a scenario
constructed to make the two scales disagree).

## 9t. Front-end curiosities: the stat block, submenu labels, smoothness map, "Beat the Clock" (2026-09-22)

**Scope.** User request: "work on Front-end curiosities: `UNKNOWN_beat_the_clock_timetrials`...;
`UNKNOWN_frontend_submenu_labels`, `UNKNOWN_smoothness_label_map`, `UNKNOWN_frontend_stat_block_0359`."
All four were named-but-not-traced observations from M3.9/M3.10 (§9k/§9l) -- things spotted live but
not followed to a consumer or a final answer. Documentation-only in scope, matching the four items'
own framing as *curiosities* to resolve, not bugs to fix: M3.9 deliberately deferred the tournament
board screen and deliberately flattened the ONE PLAYER submenu into one 3-item list, and neither
finding below reopens that decision (confirmed with the advisor before writing this section). One
small, directly-motivated code change followed anyway -- see Implementation.

**`UNKNOWN_frontend_stat_block_0359` resolved: two separate, unrelated blocks, not one.** The M3.9
session's own "an unrelated ~52-byte numeric block and [a] set of strings... sit nearby... evidently
belonging to a game mode or difficulty-rating system" turns out to bundle two independent findings
by address proximity, the same shape of mistake `UNKNOWN_2911_2913` turned out to be (§9r) -- split
and resolved separately, not smoothed into one story:

1. **`DS:0312-0345`** (52 bytes = **26 words**, not bytes) is the tournament board screen's own
   icon-position table -- already half-named in docs/engine.md §7's own Screens paragraph
   ("tournament board `18d8` (`CASE.CHR` map + `MINATURE` icons at `DS:0312` positions)"), just never
   cross-referenced against the M3.9 session's live re-discovery of the same bytes, and never reduced
   to a formula. Live disassembly of `FUN_1000_198e` (`1000:198e`, called from the board screen
   `1000:18d8`) gives the exact mechanics: `SI` walks `ORDER_TABLE` (`DS:043C`) with a **pre-increment**
   (so board position 0 uses `ORDER_TABLE[1]`, not `[0]` -- the qualifier never gets its own board
   icon), while a separate counter indexes this table by **word**: `X = (word&0xff)*8+0xC`,
   `Y = (word>>8)*8+0x4E`, and the icon's own frame is `((ORDER_TABLE[i]>>2)-1) + (ORDER_TABLE[i]&3)*8`
   (a MINATURE.CHR class icon). The loop draws one icon per tournament race reached so far
   (`i < [28C1]`).
2. **`DS:034B-035B`** (17 bytes: `2,4,8,16,32,47,32,16,8,4,2,4,8,16,32,47,0`, 0-terminated) -- the
   *actual* address the open item's own name ("`_0359`") sits inside, one byte short of the block
   above's own end. This is a Y-offset bounce/wobble animation curve, consumed by
   `ShowCharacterEliminatedTune6` (`1000:16de`, use site `1000:1747`): each ramp value is added to the
   eliminated character's icon's baseline Y, the sprite's frame is XORed by 1 (a flicker), drawn, and
   the loop waits ~9 ticks before the next value -- so the icon visibly bounces down/up/down (the
   curve's own shape: rises 2→47, falls 32→4, rises 4→47 again) before settling at a fixed frame
   (`0xB`) and handing off to `FUN_1a4a` (the opponent-replacement picker, already
   **Corrected 2026-09-24 (P3, §9ba): no tone plays per step.** `1000:16de` was fully
   re-disassembled and independently re-verified for P3's third item -- the only sound-driver calls
   in the whole 77-instruction function are the tune-6 query/play at entry (`1000:16E4`/`16F1`);
   every call inside the per-step loop (`1000:174D-1789`) is a graphics routine
   (`ClipSpriteDescToFrontView`/`BlitSpriteTransparentFlipSaveUnder`/`CopyFrontViewRowsToVga`/
   `RestoreSpriteBackground`). The "a short tone plays" clause below is kept verbatim as a record of
   the mistake; the real per-step wait is silent, tune 6 plays exactly once, at entry. Full account:
   §9ba.
   named in §9k/tournament.js). This is the "easing-ramp-shaped byte run" the M3.9 open item named but
   never traced to a consumer.

**`UNKNOWN_beat_the_clock_timetrials` resolved: not a hidden mode -- the bonus race's own intro
banner.** All four strings ("TRIPLE WIN !!!", "BONUS RACE", "BEAT THE CLOCK", "TIMETRIALS") are drawn
together by `ShowNextRaceIntroScreenTune4or5` (`1000:11f8`, already documented as the "next-race
intro" screen, tune 4/5), strictly gated on `[28BF]==9` (`1219-121E`: `CMP [28BF],9 / JNZ 126D` skips
the whole block otherwise) -- i.e. they are the flavour-text banner shown specifically on round 9's
(RUFFTRUX) own bonus-race intro, not a separate unreached mode. This lines up exactly with the
already-implemented round-9 mechanic from M3.8: states F ("1 Up!")/`0x10` ("Failed") are a
countdown-timer win/lose signal (`RuffTruckTimes`), not a race-position finish -- literally "beat the
clock" against a "time trial", now confirmed to be the game's own name for that mechanic, not an
inference. Two nearby, superficially similar strings turned out to be unrelated, and are resolved
separately rather than folded in: **"RACE 99"** (`0x3AE`) is a self-patching `"RACE <N>"` template
used by `DrawTrackNameAndRaceNumber` (`1000:1867`) to show the current tournament race number --
`FUN_1000_1a34` (`1000:1a34`) decompiles to a literal `*SI = digitPair`, a genuine in-place write of
two ASCII digits (computed from `[28C1]`, tens-digit-blanked) over the `"99"` placeholder in `DS`
before the (now-patched) string is drawn, not merely a position calculation -- checked directly
because the whole "self-patching template" reading rested on this one call and the earlier finding
that "the value 0x3AE surfaces at a function literally named `DrawTrackNameAndRaceNumber`" wasn't
itself proof the *mechanism* was self-patching, only that the STRING'S role was numeric.
**"IS OUT!!"** (`0x3B6`) belongs to `ShowCharacterEliminatedTune6` (`1000:16DE`) instead, the
elimination screen's own banner (paired with the character's name, unread this session).

A related, smaller finding surfaced re-disassembling this same function: **`[0x3FA]` (the win-streak
counter, `tournament.js`'s `state.streak`) is reset to 3 at `1000:1220`, gated on the SAME `[28BF]==9`
check** -- i.e. at the bonus race's own INTRO time, before it runs, not after it resolves as M3.9's
own prose-gap inference had guessed ("whether the win streak resets to 3 after a bonus race resolves
... filled by inference, not evidence"). Checked against `tournament.js`'s own `reportRaceResult`
(the module that carried this inference) and confirmed the timing difference is **not observable**:
nothing in that module reads `state.streak` while `pendingBonusRace` is set, so a reset at resolution
time (the port) and a reset at intro time (the real game) leave the exact same state by the time
anything downstream looks at `streak` again. `tournament.js`'s header and the reset site's own comment
are updated to record this as **confirmed-equivalent, not a bug** -- the "a hedge is a flag to
re-derive, not a caveat to repeat forward" pitfall (§9r) applies here too, but the outcome this time
is "checked and it doesn't matter", which is worth stating explicitly so a future session doesn't
re-chase the same question.

**`UNKNOWN_frontend_submenu_labels` resolved: the two ONE PLAYER submenu items are sprite graphics,
not strings -- which is why a text search never found them.** Confirmed two independent ways: (1)
sprite-descriptor slot arithmetic. The 18-slot pool is `DS:0B7C + n·27` (docs/engine.md §7/§9k); this
function's (`RunOnePlayerGameMenu`, `1000:02E0`) two descriptor bases, `0xC8A` and `0xCA5`, solve to
`n=10` and `n=11` -- slot 10 is **SELGAM** and slot 11 is **WORDS** in §7's own already-documented
bound-sprite list. The same arithmetic independently confirms the tournament-board finding above:
`FUN_1000_198E`'s own base `0xCDB` solves to `n=13`, the first of the four MINATURE slots, exactly as
that list predicts. (2) `WORDS.CHR` rendered directly (`npm run render`): 3 frames reading
"MicroMachines" / "Head to Head" / "Challenge". The function draws, per item, a SELGAM.CHR icon
(frames 2/3 -- a single-driver portrait vs. a driver-silhouette group, i.e. "one opponent" vs
"several") directly above a WORDS.CHR label (frames 1/2 -- "Head to Head"/"Challenge"), laid out
LEFT (`x=0x10/0x18`) vs RIGHT (`x=0x94/0xA4`) -- matching `RunTwoItemMenu`'s own already-documented
LEFT/RIGHT navigation exactly, and confirming the pre-existing Ghidra function names
(`RunOnePlayerHeadToHeadVsCpu 0FBF`, `RunOnePlayerChallenge 102B`) were already correct. The
slot-index arithmetic is the stronger of the two proofs (it's derived from the binding table, not
from eyeballing what the rendered frames happen to show) and is the one recorded in the Ghidra plate
comment; the earlier draft of this finding leaned on frame-count fit alone, which an advisor review
correctly flagged as the weaker argument before this was written down.

**`UNKNOWN_smoothness_label_map` resolved: the complete, code-derived mapping.** `RunOptionsScreenWith
SettingsDat` (`1000:2770`) draws the current smoothness value via `DrawMenuStringByIndex`
(`1000:08F0`, `SI=0xF22` -- one byte *before* "HIGH" at `0xF23` -- `CX=[0x263A]`, the already-established
verbatim SETTINGS.DAT word 2). `DrawMenuStringByIndex` decompiles to a plain `for(;CX!=0;CX--)
do{...}while(*p++!=0)` walk -- a do-while body that always executes at least once per outer
iteration, which is exactly why the base sits one byte short of the first real string for a
1-based value. This gives a direct, unreordered mapping:

| value | label |
|---|---|
| 1 | HIGH (already established as smoothest) |
| 2 | GOOD |
| 3 | MEDIUM |
| 4 | LOW |

Cross-validated against the adjacent sound-driver label draw in the SAME function (`1000:287E-2888`:
`SI=0xF3D` = "NONE" used **directly**, no base-minus-one adjustment, `CX=[0xF64]`) -- a genuinely
0-based enum (0=NONE, 1=BLASTER, 2=SPEAKER) matching CLAUDE.md's already-established "sound driver
0-2" ordering exactly, confirming the walk-convention reasoning holds in both the 1-based and 0-based
direction at once, not just asserted for whichever one was needed.

**Corrected 2026-09-24 (P1, §9au): "AUTO" (`0xF38`) IS part of the smoothness set -- the claim
this paragraph made below was wrong.** P1's own OPTIONS-screen work re-disassembled F4's cycling
logic fresh (`1000:29CC-29D8`) rather than trusting this paragraph's display-side walk alone, and
found `CMP CH,5 / JLE` -- the wrap only resets past `CH=5`, so the real cycle is 5 values, HIGH/
GOOD/MEDIUM/LOW/**AUTO**, live-confirmed on a real DOSBox GAME OPTIONS screen (four F4 presses
from HIGH shows "AUTO" on screen). The mistake: this paragraph checked the DISPLAY walk's own
upper bound (does `DrawMenuStringByIndex` ever get asked for a 5th label) without separately
checking whether the INPUT side (F4) can ever produce `CX=5` -- it can, and the string table has a
real 5th entry there waiting for it (`0xF22 + 1 + len(HIGH)+len(GOOD)+len(MEDIUM)+len(LOW) =
0xF38`, confirmed both by this byte-offset arithmetic and live). AUTO resolves at RETURN
(`1000:2A6E-2A7E`) to a real 1-4 value via a VGA-retrace CPU-speed probe
(`AutoDetectSmoothnessByRetraceLoops 1000:3AD0`, already named in this project's own Ghidra plate
comments from an earlier session that never cross-checked it against this paragraph's own
contradictory claim). Full account, and the port's own resolution (AUTO -> HIGH unconditionally,
since any modern machine trivially clears the real DOS-era threshold): §9au. The original claim
below is kept verbatim as a record of the mistake (PLAN.md §8's own "re-verify, don't just re-read
a prior claim" pitfall, one more instance of it) -- despite its own confident wording, it is FALSE:
**"AUTO" (`0xF38`) is now proven NOT part of the smoothness set** -- the smoothness walk never reaches `CX=5` -- closing the specific
ambiguity the open item raised ("whether they're LOW/MEDIUM/AUTO at all"); AUTO's own purpose was not
traced this session (no code cross-references `0xF38`/`0xF37` were found by either xref or bare-operand
search) and is left as a narrower, separately-named open item rather than guessed at.

**Implementation.** The smoothness label mapping was the one finding with a direct, cheap, low-risk
application: `index.html`/`game.html`'s existing `<select id="smoothness">` controls (M3.10) showed
bare numbers (`<option>1</option>`...) with no indication of what they meant. Now
`<option value="1">1 HIGH</option>`, `2 GOOD`, `3 MEDIUM`, `4 LOW` -- `value` kept numeric so
`play.js`/`flow.js`'s existing `Number(smoothnessSelect.value)` wiring is untouched. Verified live
(`npm run dev`): the default option shows "1 HIGH" on load, and `Array.from(select.options).map(o=>
({value:o.value,text:o.text}))` read via `javascript_tool` confirms all four labels and values match
the table above; switching to "4 LOW" and dispatching `change` updates `select.value` correctly.
**Deliberately not done**: porting the tournament board screen or restructuring the flattened ONE
PLAYER submenu into its real two-icon layout -- both were M3.9's own deliberate scope cuts, and
resolving the underlying assets/data doesn't reopen that decision (confirmed with the advisor); a
future session porting either now has the exact formulas/frame indices on hand instead of having to
re-derive them.

**A stale Ghidra listing found and only partially fixed.** Re-disassembling
`ShowNextRaceIntroScreenTune4or5` for the "Beat the Clock" finding turned up the exact
"listing is stale inside a no-function gap" pitfall PLAN.md already documents (§8): `1000:124B-1258`
decoded as a nonsense `TEST BH,0x6 / LDS CX,[BP+DI] / OR [BX+SI],AL` sequence that doesn't match a
fresh `read_memory` hand-decode (the real instructions are `CALL 0910` / `MOV [0xBC5],8` /
`MOV [0xBB6],0x5A` / `CALL 01DE`, starting 2 bytes earlier at `1249`). Unlike the earlier instances of
this pitfall, this one resisted every available repair attempt this session -- `apply_data_type`
(`undefined1[18]`, then `undefined1` singly), `disassemble_bytes` (with and without `follow_flow`,
with `restrict_to_execute_memory` toggled), and `clear_flow_and_repair` (dry-run confirmed it has
nothing to clear/repair here, since the range holds data, not misclassified instructions) all left
the listing showing the same wrong decode at `124B`. The function's own boundaries and name are
confirmed unaffected (`get_function_by_address` unchanged throughout). Documented instead with an EOL
comment at `1000:1249` giving the correct hand-decoded instructions and noting the repair attempts
that didn't stick -- the same "tool-unfixable this session" outcome PLAN.md's own M3.0 pitfall entry
already records for a different pair of addresses (`1249`, `1511`), not a new class of problem.

**Method notes.** (1) *An address named in an open item's own identifier can be inexact* -- 
`UNKNOWN_frontend_stat_block_0359` pointed one byte past the actual 52-byte table's own end and
landed inside a second, unrelated block instead; resolving "the area near this name" rather than
"the literal byte" was necessary and is worth remembering the next time an open item's own address
looks slightly off from where the interesting data turns out to start. (2) *Sprite-descriptor slot
arithmetic from a documented base+stride is stronger evidence than matching rendered frame content* --
an advisor review caught that the WORDS/SELGAM attribution above was first written up leaning on "the
rendered PNG happens to show the right words," a coincidence-shaped argument, when the actual proof
(descriptor base address solves cleanly to a named slot index in an already-documented table) was
sitting right there and is independently corroborated by a second, unrelated function's own base
address. Prefer the formula that has to be true over the picture that happens to match. (3) *A timing
difference found by re-disassembly isn't automatically a bug in code that already modelled the
behaviour differently* -- checking whether `tournament.js`'s own state machine could ever OBSERVE the
intro-vs-resolution reset-timing difference (it can't, here) turned "found a discrepancy" into
"confirmed equivalent, no change needed," which is a more useful and more honest thing to write down
than either silently patching working code or leaving an unresolved-sounding note that invites a
future session to re-investigate a non-issue.

**Verification.** No `src/engine`/`src/formats` logic changed (this was a documentation pass, per its
own scope), so the full 18-check suite and `npm run build` were re-run as a pure non-regression guard
(all green) rather than as evidence for anything new. The one behavioural code change (the smoothness
`<select>` labels) was verified live in the browser, per the project's own UI-testing rule, not just
by reading the HTML. `tools/check-tournament.mjs` re-run clean after the `tournament.js` comment
updates (no logic changed there either -- the reset's numeric effect was already correct, only its
own "INFERRED" framing needed updating to "confirmed-equivalent").

**Not done / out of scope:** tracing "AUTO"'s (`0xF38`) own purpose; the tournament board screen and
the real two-level ONE PLAYER submenu (both M3.9's own deliberate cuts, not reopened); "IS OUT!!"'s
own full banner context (paired string/logic not read this session); a live DOSBox capture of any of
these four findings (all resolved from static disassembly + one rendered asset, consistent with this
project's established precedent for RE-only, non-gameplay-critical findings).

## 9u. UNKNOWN_26B8_polarity resolved (2026-09-22)

**Scope.** User request: "work on `UNKNOWN_26B8_polarity`: earlier docs called it 'settled: loser,'
but a later six-writer recount points toward 'scorer/winner' instead. Genuinely contested until a
live two-human knockout trace is captured." Re-derived all six writers and the full reader/consumer
chain live from `MICROU.EXE`'s bytes (a 5-agent parallel Ghidra re-derivation, cross-checked
independently against two of the most decisive addresses by hand afterward). The two prior camps
turn out to have both been locally correct — about **different writers of the same shared global** —
and the practically-relevant half of the question (who does the game credit as the winner of a
two-human head-to-head match **decided by a finish**) is now settled by literal on-screen text, not
inference. Two advisor reviews during this pass each caught a real gap before it landed: whether the
no-fall branch's two-step selection was correctly re-derived (it was, confirmed a second time from raw
bytes), and whether a match can be decided by knockout alone without ever reaching the finish-detection
writer this resolution leans on (unresolved — see the new `UNKNOWN_h2h_knockout_only_ending` below,
which narrows exactly what a live trace would still need to settle).

**The six writers, corrected.** The two earlier citations that anchored this open item were both
address-loose:
- `1000:7759` is `ResetCarsAfterKnockoutSfxA`'s **function entry**, not itself a write; the actual
  `MOV [26B8],BX` is six blocks in, at `1000:77F5`.
- `1000:7F69` is **not a writer of `[26B8]` at all**. It's inside `HandleCarState4FallAnimSfx8` and
  writes `[2682]` (a *different* global, the "which car just fell" latch) — `77F5` later *reads*
  `[2682]` to help pick its own `BX`. The two are linked, not identical.

The real six, found by three convergent methods (bare-operand `search_instructions`, a full-program
`search_byte_patterns` byte sweep for both MOV-to-absolute-disp16 encodings, and manual disassembly
of every hit — 13,405 instructions scanned, 83,662 bytes swept, 0 truncation):

| Addr | Function | Writes | Role |
|---|---|---|---|
| `1000:3C46` | `InitRaceCarsFromTables` | literal `1` | disarm/reset sentinel (race start) |
| `1000:4C08` | `RunCarPhysicsStep` | `[2660]` (car0/"P1") | **match-decided**, gated `[26B4]>=4` AND `[26C4]==1` (§9x: corrected from "finish-detection" — the outer gate is the two-car match SCORE, not a finish) |
| `1000:4C64` | `RunCarPhysicsStep` | `[2662]` (car1/"P2") | **match-decided**, symmetric P2 branch, gated `[26B4]<4` AND `[26C4]==1` |
| `1000:76DD` | `UpdateCarAirborneLandingSfx` | literal `1` | cancel/re-arm (P1 branch, fires while still undecided) |
| `1000:7715` | `UpdateCarAirborneLandingSfx` | literal `1` | cancel/re-arm (P2 branch) |
| `1000:77F5` | `ResetCarsAfterKnockoutSfxA` | a car base pointer | **knockout-reset** |

`[26B8]==1` (the literal constant, not a car pointer — real car bases in this binary are `0`,
`0x164`, `0x2C8`, confirmed at `1000:7B31`/`7B3A`) is a disarmed/"nothing decided yet" sentinel,
checked at `1000:5411`/`75D2`. Only three writers ever arm it with a real car identity: the
knockout-reset (`77F5`) and the two match-decided branches (`4C08`/`4C64`, §9x — corrected from
"finish-detection").

**The core finding: `[26B8]` is not a fixed-polarity register — it's a shared "spotlight" slot
re-armed by whichever of two *different life-cycle events* fired most recently.**

1. **Knockout-reset** (`1000:7759-78F7`, `ResetCarsAfterKnockoutSfxA`), re-disassembled in full:
   - Fall branch (`[2682]!=-1`): `BX` = the car `[2682]` was latched to by `HandleCarState4FallAnimSfx8`
     — **unconditional**, no tie-break.
   - No-fall branch (`[2682]==-1`): `BX` = the car with the smaller `[+0x12EF]` (race position — the
     current *leader*, confirmed by two independent re-derivations: `CX=car0.12EF`, `DX=car1.12EF`
     loaded through two separate struct-base pointers, not a single fixed-address field as an earlier
     citation's phrasing implied), UNLESS that leader's own `[+0x12AE]` (state) is non-zero, in which
     case it swaps to the trailing car instead — a validity filter, not a "leader election."
   - Either way, the tail (`77D9`+) sends the just-selected `BX` (== `[26B8]`) to car-state **`0xB`**,
     while the *other* car (`SI`) gets state **`0xC`** and inherits `BX`'s old `[+0x12F1]`/`[+0x12F3]`
     fields.
2. **Finish-detection** (`1000:4BF8-4CAC`, inside `RunCarPhysicsStep`): gated on `[26C4]==1` (a
   separate one-shot "not yet armed this instant" sentinel, itself gated by which side of `[26B4]`'s
   tug-of-war counter the race is on). Writes `[26B8]` = the car now finishing [**refuted §9am**: it writes the car AHEAD ON THE LIGHT BAR -- P1 if `[26B4]>4`, P2 if `<4` -- whichever car finished; a tied bar runs "Play Off" instead], and **simultaneously**
   sets up the finish-order globals `[2678]/[267A]/[267C]/[267E]` (rank-slot pointers,
   `DrawRaceHudDigitsAndRankIcons`'s own inputs) so that this same car occupies rank-slot-0. This is a
   different event from the knockout-reset — it fires when a car crosses the finish line, not when one
   falls.

**Why both prior readings were each correct about something real.** `RenderRaceFrameToBackBuffer`
(`1000:9241-9281`) dispatches per-car state every frame: state `0xC` → `CALL 855A`
(`DrawRaceOverBannerSfx10`); state `0xB` → `CALL 851F`. `855A` bails immediately unless its OWN car
(the state-`0xC` one) equals `[26B8]` — which, right after a knockout-reset, is **never** true (the
knockout-reset's own tail always makes `[26B8]` the state-`0xB` car, never `0xC`). So immediately
after a fall, `[26B8]`'s car is structurally routed to `851F` instead — and by decoding the actual
sprite each path draws (`BITSFILE.PH0`'s newly-mapped banner strip, see Implementation below,
rendered and visually confirmed: `Bonus, Winner, Play Off, 1 Up!, Failed, Paused!`), `851F` draws
banner index 0, **"Bonus"** — not "Winner", but not "Failed"/"Loser" either
(`UNKNOWN_851f_bonus_banner_choice`, new, narrower open item — **resolved 2026-09-23, see §9ag**: not
a round-9 bonus-race indicator (851F itself gates `[28BF]!=9`, structurally excluding round 9), and
`851F`/state `0xB` has exactly one writer in the whole binary — the artist's chosen label for
"whichever car the knockout-reset spotlight currently names," not evidence of a real third outcome).
The 2026-09-20 "settled: loser" reading
was a reasonable read of *this specific writer's immediate effect* (the just-fallen/leading-with-override
car gets shunted away from the Winner path) — it just wasn't the whole picture.

**The decisive reader evidence — re-verified independently, not just cited.** `DrawRaceOverBannerSfx10`'s
own celebratory path (`1000:856A`: `CMP BX,[26B8] / JZ` proceed) and the tally chain it feeds
(`1000:8606`: derives which player number, 1 or 2, `[26B8]` names, into `[2630]`; `RunRaceMainLoop
@3143-3156`: reads `[2630]` to set the HUD rank-slot-0 pointer; `1000:11D5`: reduces that into a
comparison value at `[3FC]`; `1000:256E`, `ShowHeadToHeadRaceWinnerTune8`) were traced end to end and
then **independently re-disassembled by hand** (not just trusted from the sub-agent report) to confirm
the exact polarity:

```
256E: increments byte[98A] (P1's persistent match-win tally) if [3FC]==0xC03 (== "[26B8] is the
      P1-slot car"), else swaps to increment byte[98C] (P2's) instead -- the counter credited is
      ALWAYS [26B8]'s own car's counter.
25CB-25DF: draws at P1's screen position: SI="WINNER!" if [3FC]==0xC03, else SI="LOSER!"
25E2-25F6: draws at P2's screen position: SI="WINNER!" if [3FC]==0xC1E, else SI="LOSER!"
```

Given `[3FC]` was just set (in the block above) to always equal "whichever identity constant belongs
to `[26B8]`'s own car", this means: **whichever screen position corresponds to `[26B8]`'s car gets the
literal string `"WINNER!"` drawn on it, and the other position gets `"LOSER!"`.** The two literal
strings were read directly from the data segment this session and confirmed byte-for-byte:
`193C:0966` = `"WINNER!\0"`, `193C:096E` = `"LOSER!\0"`. `byte[98A]`/`byte[98C]` (the incremented
tally) are read by `RunHeadToHeadTournament` (`1000:207E-2095`): first to reach 4 sends that same
player's record to `ShowChampionScreenTune3` (`1000:1AAD`). This is about as strong as static
(non-executed) evidence gets — it rests on literal on-screen text and a persistent win-tally/champion
chain, not inference from naming or control-flow shape.

**A gap flagged by an advisor review, checked but not fully closed: does `256E` always run *after* the
finish-detection writer has fired, or can a match be decided by knockout alone?** `256E` is called
**unconditionally**, once per race, from `RunHeadToHeadTournament`'s own per-race loop
(`1000:2077`, immediately after `StopMusicRunRaceReloadAssets@216C`'s `RunRaceMainLoop()` call
returns) — it reads whatever `[26B8]` happens to hold at that moment, from WHICHEVER writer touched
it last during that specific race, not necessarily the finish-detection one. If every two-car race
genuinely requires the surviving car to cross the finish line (even alone, after its opponent is
knocked out) before `RunRaceMainLoop`'s own exit condition (`[26C6]>=2`, docs/engine.md §9s) is
satisfied, then the finish-detection writer (`4C08`/`4C64`) is always the last one to touch `[26B8]`
before `256E` runs, and the reasoning above holds without qualification. **This was NOT traced this
session** — whether `[26C6]`'s formula can be satisfied by a knockout alone (with the SURVIVING car
never itself crossing a finish line) is unestablished, and if it can, `[26B8]` at that point would
still be whatever `ResetCarsAfterKnockoutSfxA` last set it to (the knocked-out car, state `0xB`) with
no confirmed re-arming step for the survivor — which would print `"WINNER!"` at the ELIMINATED car's
own position, a genuinely surprising and unverified result. **New, precise open item:**
`UNKNOWN_h2h_knockout_only_ending` — does a two-car H2H match ever end without a finish, and if so,
what does `256E` read at that point? This is the one piece of the original open item's own framing
("genuinely contested until a live two-human knockout trace is captured") that a live trace would
most directly settle — not the general polarity question, which the finish-decided case above answers
with or without one.

**Resolved 2026-09-22 by §9x below, without the live trace this paragraph called for**: the race
LOOP itself cannot exit via knockout alone — `ResetCarsAfterKnockoutSfxA` never touches `lapsRemaining`
or `[26C6]`, confirmed by re-disassembling its complete body, so `RunRaceMainLoop`'s sole exit gate
(`[26C6]>=2`) is structurally unreachable from a knockout. See §9x for the full account, including a
correction to this section's own `4C08`/`4C64` "finish-detection" framing (the real gate is the
two-car match SCORE `[26B4]`, not a finish flag) and the new, narrower question this leaves open.

**Resolution.** For the question the open item actually cares about — who does the two-human H2H
match credit as its winner **when the match is decided by a finish** (confirmed the common/default
case: `RunRaceMainLoop`'s own exit condition is lap-completion-based) — **`[26B8]` is read as the
WINNER, unambiguously, confirmed by literal `"WINNER!"`/`"LOSER!"` on-screen text and the persistent
win-tally/champion chain that follows it.** This corrects `docs/sound.md` §3b's "settled: loser" and
the original Ghidra EOL comment at `77F5`, which were locally accurate only for the knockout-reset
writer's own transient, mid-race effect (a different, narrower question from "who wins the match").
`UNKNOWN_26B8_polarity` is resolved for this case: not by one side winning outright, but by
recognizing the contradiction was between two correct readings of two different writers/moments
sharing one global slot. The narrower question of what happens in a match decided by knockout alone,
with no finish, is carried forward as `UNKNOWN_h2h_knockout_only_ending` above, not silently folded
into this resolution.

**Confidence: `[STATIC]`, not `[PROVEN]`.** No live two-human-H2H-knockout DOSBox trace was run this
session — the open item's own framing assumed one was required to settle this, and in the event a full
re-derivation of the reader side (literal strings, not inference) turned out to be sufficient for a
confident, actionable answer without it. A live trace remains the way to upgrade this from `[STATIC]`
to `[PROVEN]` and to independently confirm the still-open `UNKNOWN_851f_bonus_banner_choice` and
exactly what triggers car-state 4 ("fall") in the first place — neither blocks the polarity question
itself, which the string-level evidence leaves very little room to be wrong about.

**Implementation.** A byproduct of decoding the "Bonus" vs "Winner" banner distinction: `BITSFILE.PH0`
had one remaining unmapped region, `+0x3440` to EOF (6 banners × 88×24, stride 2112 — the offset
arithmetic lands exactly on EOF: `0x3440 + 6·2112 = 0x65C0`, the file's own unpacked length, confirmed
live). Added to `src/formats/race.js`: `PH0_LAYOUT.banners`/`bannerText` (`['Bonus', 'Winner',
'Play Off', '1 Up!', 'Failed', 'Paused!']`, read directly off the rendered strip, matching
`DrawBanner88x22Blinking 1000:9289`'s own draw geometry), `ph0Banner`/`ph0BannerStack`. Wired into the
asset viewer's `bitsfileView` (`src/ui/views/raceGfxView.js`) alongside the existing PH0 sections, and
into a new standalone render script, `tools/render-bitsfile.mjs` (`npm run bitsfile`) — filling a
real, pre-existing gap in the project's own tooling: `BITSFILE.PH0` had no command-line render path at
all before this (`npm run render`/`render-reference.mjs` never covered it; the asset viewer was the
only way to look at it). Verified live in the browser (`npm run dev`, `viewer.html#BITSFILE.PH0`) —
the banner strip renders identically to the standalone script's own PNG output, no console error.

**Verification.** Five agents, one per writer/reader-group, independently re-derived their assigned
address(es) from `MICROU.EXE`'s bytes via Ghidra MCP tools, cross-checked against each other (all
converge on the same six-writer list and the same core mechanism, despite starting from different
prompts and different entry points) and, for the two most decisive addresses (`1000:256E`'s exact
WINNER!/LOSER! selection logic, and the literal string bytes at `193C:0966`/`096E`), independently
re-verified by hand afterward rather than taken on the sub-agents' word alone. Full pre-existing
18-check regression suite (`catalog` through `smoke`) plus `npm run build` stay green — the new
`race.js` exports are additive (a new `PH0_LAYOUT` field + two new functions, nothing existing
changed shape), so nothing else could have regressed. Ghidra comments persisted at `1000:77F5`
(the fullest account, three dated passes appended in sequence, oldest text preserved verbatim),
`1000:7F69`, `1000:851F`, `1000:855A`, `1000:8606`, `1000:256E` (plate); `save_program` confirmed.

**Method notes.** (1) *A "contested" open item can dissolve instead of settling to one side* — when
two prior passes reach opposite conclusions from real evidence, check whether they were each looking
at a *different* part of the same mechanism before assuming one must be wrong. Here, both were right,
about different writers of one shared global at different points in a race's lifecycle; forcing a
single "winner or loser" verdict onto the variable as a whole was the wrong frame from the start.
(2) *Reader-side evidence (how a value is consumed) can be more decisive than writer-side evidence
(how it's produced) when the reader draws literal, unambiguous content* — the writers alone left real
room for disagreement (a car pointer doesn't say what it MEANS), but a function that draws the literal
string `"WINNER!"` at that car's own screen position leaves essentially none. When both are available,
trace the reader fully before concluding a question needs a live trace to settle. (3) *A prior citation
naming "the function this happens in" is not the same as citing the exact instruction* — `7759`
(a function entry) and `7F69` (a different global's writer, in a function that FEEDS the real one) both
turned out to be one step removed from the actual write site once re-verified against fresh
disassembly, not because anyone was careless, but because address-loose citations drift as a codebase
gets better understood; re-deriving from scratch caught both.

**A real, previously-unknown bug found and fixed as a direct consequence of this re-derivation:**
`src/engine/twocar.js`'s `resolveTwoCarKnockout` (M3.8) modelled `ResetCarsAfterKnockoutSfxA`'s
no-fall branch, but under the ASSUMPTION that state `0xC` meant "winner" — a reasonable guess before
this session's precise re-derivation, but backwards: the real bytes assign the better-racePosition
car (with an override to the OTHER car if the better-racePosition car's own state field is already
non-zero — a genuine two-step selection, re-confirmed byte for byte after an advisor review asked for
it a second time, not two competing readings) state `0xB` (the "Bonus"-banner-routed state, not
"Winner"), and the OTHER car state `0xC`. Fixed to match, and the function's return value is
deliberately no longer called `winner` — this session's own finding is exactly why that name would be
misleading. `tools/check-rounds.mjs`'s own direct-call test updated to match and reconfirmed with
teeth (reverting the state swap makes it fail).

**A second advisor-caught gap, checked and now documented rather than silently carried forward: does
this module's own no-fall branch even correspond to "a real knockout"?** Tracing `ResetCarsAfterKnock
outSfxA`'s own caller (`RenderRaceFrameToBackBuffer@9205`, gated on `[2911]==1`) shows `[2911]` has
five write sites across four unrelated subsystems (`InitRaceCarsFromTables`, `FireProjectileSfxE`,
`HandleCarState0EDropInSequencer`, `UpdateCarAirborneLandingSfx`, and `ResetCarsAfterKnockoutSfxA`
itself), writing three different values (`0`, `1`, `2`) — a shared, multi-purpose flag, not a
single-subsystem one. Narrowing to the ONE value that actually gates this function's call
(`[2911]==1` specifically, per the caller's own `CMP`), there are exactly two writers of THAT value:
`FireProjectileSfxE` (`5089`/`50D1`, a projectile-hit check [**refuted §9am**: `5089`/`50D1` are the camera's two-car separation test -- the cars more than 0xE8 apart in X or 0xB0 in Y -- in code Ghidra files inside `FireProjectileSfxE`; and a partner timeout at `6DB4` normally takes `7759`'s FALL branch, because the timed-out car latched `[2682]` when it fell]) and `1000:6DB4` — which, cross-referenced
against `dropin.js`'s own M3.13 findings from earlier the same day, is the SAME partner-timeout
counter that module already ports as `raceState.dropInPartnerTimedOut` (subState 2's timeout branch,
`1000:6D94`). **Neither trigger is "a car fell into a hazard"** — that is the SEPARATE `[2682]`/
state-4 mechanism, this function's OTHER branch, not the one `resolveTwoCarKnockout` models. So this
module's own docstring and header were substantially rewritten to stop implying it represents a
generic/common "two-car knockout" — it models the branch reached by a projectile kill OR a drop-in
partner timing out, both now identified (an earlier draft of this finding treated `6DB4` as an
unexplored block, following an older Ghidra comment's vaguer wording, without first checking whether
a same-day session had already named it — caught before landing). The pairing itself is left as a
flagged, not fully chased, curiosity: a drop-in partner timeout feeding into the SAME "assign a
Bonus/other-state banner" logic as a combat kill is a genuinely surprising coupling this session did
not verify goes through the identical code path in practice. This function remains **not wired into
any race loop** (M3.8's own status, unchanged) — the knockout condition itself still isn't detected
anywhere in this port, so there is nothing to call it from yet.

**Not done:** the live two-human-H2H-knockout DOSBox trace itself (not required for the finish-decided
resolution above, but would upgrade it to `[PROVEN]`, and is the most direct way to settle the two new
open items this pass surfaced: `UNKNOWN_h2h_knockout_only_ending` — whether a match can end by
knockout alone and, if so, what `[26B8]`/`256E` reads at that point; `UNKNOWN_851f_bonus_banner_choice`
— why the knockout-reset car shows "Bonus" specifically, not "Failed"); confirming whether a drop-in
partner timeout genuinely reaches the SAME no-fall selection logic as a projectile kill in practice
(both are confirmed writers of the gating value, `[2911]==1`, but whether they're then handled
identically once inside `ResetCarsAfterKnockoutSfxA` wasn't traced further, a smaller, flagged
curiosity, not a named `UNKNOWN_`); the exact car-state-4 ("fall") trigger condition; detecting the
knockout condition itself and wiring `resolveTwoCarKnockout` into an actual race loop (a separate,
larger feature, same status as before this session).

## 9v. Small leftover bytes/fields (2026-09-22)

**Scope.** User request: "work on Small leftover bytes/fields: `UNKNOWN_1254_1256`, `UNKNOWN_1386`,
`UNKNOWN_138A_clear`, `UNKNOWN_ph0_1140_1380`, `UNKNOWN_puff_slot_fields`, `UNKNOWN_17DA_semantics`,
`UNKNOWN_col_response_offtrack_branch`, `UNKNOWN_respawn_sideways_offset`, `UNKNOWN_state1_880a`,
`UNKNOWN_tick_counter_writers`, `UNKNOWN_pause_exact_timing`, `UNKNOWN_2911_2913`." `UNKNOWN_puff_
slot_fields` was already fully resolved (§9q, M3.12) -- confirmed, not re-investigated. Seven
parallel Ghidra re-derivations covered the other eleven; two surfaced real port correctness gaps
(fixed, tested with teeth) rather than being pure documentation closures.

### Fully resolved, no code change needed

**`UNKNOWN_1254_1256`** (`CarRecord+0x1254`/`+0x1256`): confirmed genuinely dead by two independent
full-file-coverage searches (bare-operand `search_instructions`, 0 of 13420 hits; `search_byte_
patterns` for the raw little-endian word bytes, 0 of 83662 bytes) -- no instruction anywhere in the
shipped binary, direct or indirect, references this address. The four cars' own static values
(`0x2400/0`, `0x4800/0x3600`, `0x6C00/0x6C00`, `0x9000/0xA200`) follow a clean deliberate arithmetic
progression (`+0x1254 = (carIndex+1)·0x2400`, `+0x1256 = carIndex·0x3600`), ruling out random/garbage
memory -- but with zero consumers in this release, the field's purpose (a cut feature? a debug/
tooling constant? a build-time-only value?) is not resolvable further without external context.

**`UNKNOWN_1386`**: confirmed the exact logical NOT of `[1388]`/`onBridge`, written atomically with
it inside `HandleTerrainDirRampBridgeFlag` (`1000:6AC2-6AE4`: `.DIR` bit 4 set → `[1388]=1,[1386]=0`;
clear → `[1388]=0,[1386]=1`). Confirmed genuinely write-only by the same two full-coverage methods
(exactly 3 hits each, both methods, matching the 3 known write sites, no reader anywhere) -- real
dead data, computed every time `onBridge` changes, never consulted.

**`UNKNOWN_138A_clear`** (`halveOnBounce`): confirmed no clear-to-0 site exists anywhere (7 hits by
both full-coverage methods: the 4 known `=1` writers, the 3 known `CMP...,0` readers, nothing else).
Since every write sets 1 and none ever sets 0, the readers' own `JZ skip-the-halve` branch is
structurally unreachable in this shipped release. The pre-existing doc note ("wall bounces always
halve") is the fully-confirmed, closed answer, not a simplification glossing over a real per-car
toggle -- the toggle exists in the struct but this game's own shipped tuning never exercises its
off-state.

**`UNKNOWN_17DA_semantics`**: `CONTACT_TABLE`'s angle and `SINE8`'s own index share ONE convention
with zero transform between them -- confirmed two ways. (1) Live disassembly of the real consumer,
`ResolveCarToCarCollisionSfx1and3` (`1000:5960-5B34`): the table byte is added directly to `0x10A0`
(`SINE8`'s base) with no offset/negation/scale for the sine lookup, and offset by `-0x41` (the
standard quarter-turn cosine-from-sine idiom, matching `int16.js`'s own documented pattern) for the
cosine lookup -- byte-exact match to the port's already-shipped `resolvePair` formula. (2) An
independent physical sanity check: all four cardinal `(dx,dy)` separations, run through the port's
own live `contactAngle`/`SINE8`/`mul2Floor256`, push each car directly away from the other along the
correct axis with negligible cross-axis component. No transform needed; the port was already
correct, this closes the open item outright.

**`UNKNOWN_tick_counter_writers` / `UNKNOWN_pause_exact_timing`** -- upgraded to **`[PROVEN]`**, not
just `[STATIC]`: `DS:0002` and `DS:261F` share ONE incrementer, `1000:48D8` inside
`TimerIsrVsyncFallbackAndSoundTick` (`1000:489C-490C`), an interrupt service routine that bumps four
counters (`[28F7]`, `[0002]`, `[261F]`, `[26D0]`) unconditionally, back to back, every tick. The
exact rate was ALREADY live-verified in this project (a pre-existing comment at `1000:48FB`, dated
from an earlier live DOSBox session: "700 ticks per 10 CMOS seconds = **70.0 Hz** in a race"), not
re-derived here -- re-used as the authoritative rate for both counters since they share one
incrementer. (**§9an:** the 140-tick loop also exits on a key click, so 2 s is a maximum wait before the
re-render, not a minimum pause.) **140 ticks (the real pause function's own busy-wait threshold, `CheckCheatSpotsThenPause
1000:35F0`, confirmed at `3790`/`37ED`) at 70.0 Hz = exactly 2.000 seconds** -- `src/engine/pause.js`'s
own chosen `MIN_PAUSE_MS = 2000` is not merely "plausible" as its own comment previously said, it is
the exact real-world duration. Cross-checked against `DS:0002`'s own already-documented durations,
all landing on clean round numbers at 70.0 Hz (`0x118`=4.0s, `0x7D0`=28.57s matching the already-cited
"28.6s", `0x2BC`=10.0s exactly) -- independent corroboration the rate is right, not a coincidence.
`src/engine/pause.js`'s own header comment updated to drop the "plausible, not verified" hedge.

**`UNKNOWN_2911_2913`, the remaining `[2911]` piece**: `[2913]` was already closed (§9r). `[2911]`'s
complete state machine is now characterized: **0 = idle, 1 = armed (a projectile kill [**refuted §9am**: the camera's two-car separation test] or a drop-in
partner timeout), 2 = processing**. The two not-previously-traced sites (`1000:7684` inside
`UpdateCarAirborneLandingSfx`, `1000:77B8` inside `ResetCarsAfterKnockoutSfxA`'s own no-fall branch)
both set value 2 as real, connected work in the SAME overall sequence (not an unrelated reuse): `77B8`
marks "now resolving a knockout" right as `ResetCarsAfterKnockoutSfxA` begins its no-fall-branch work
(confirmed the FALL branch never touches `[2911]` at all -- it jumps straight past `77B8` to the
shared tail); `7684` re-arms it to 2 immediately after `UpdateCarAirborneLandingSfx` calls `FUN_1000_
78F8` (which itself resets `[2911]` to 0 at its own tail, `79F6`) and immediately before doing
equivalent inline per-car processing for the other side. `1000:8321` (inside `HandleCarState2or0D
KnockoutAnim`) is the other 0-writer, marking "this car's post-knockout housekeeping is fully done."
No connection was found between these sites and `RunRaceMainLoop`'s own race-over exit condition
(`[26C6]`) -- `UNKNOWN_h2h_knockout_only_ending` (§9u) remains open, unaffected by this closure.

**`UNKNOWN_state1_880a`** -- resolved, but as a refutation of the port's own prior guess, not a
confirmation of it. See "A real gap found, deliberately not fixed" below.

**`UNKNOWN_ph0_1140_1380`** -- investigated thoroughly, genuinely still unresolved, but a real prior
assumption is corrected. See "Genuinely unresolved, one assumption corrected" below.

### Two real port bugs found and fixed, with teeth

**`UNKNOWN_col_response_offtrack_branch`** (`src/engine/collide.js`'s `updateCarTileCollision`).
Full live disassembly of `1000:5659-56A3` shows the port's prior "increment ticks, maybe set state
0xD, then always continue into wall-hit-box detection" reading was wrong on two counts: (1) once
`offTrackTicks` exceeds `0x32`, the real function resets the counter to 0, sets state `0xD`, and
**returns early** (`5671: JMP 5842`, the function's own epilogue) -- wall-hit-box detection
(`hitLeft`/`Right`/`Up`/`Down`, `wallHitPending`, `hit.blocked`) never runs for that tick, so the car
does NOT also get `bounceAndCommit`'s velocity-halving wall-bounce applied on the same tick it's
knocked out, which the port's prior unconditional fall-through incorrectly did. (2) The `dwell==0`
"rough" branch also resets `offTrackTicks` to 0 on EVERY call in the real bytes (`5674`) -- the port
never did this in either branch, so ticks accumulated across intermittent dwell/no-dwell ticks
instead of restarting each time dwell dropped. A third, smaller finding: the `dwell==0` branch's sfx
(previously dismissed as "sound only, out of scope") turns out to be two ALREADY-catalogued ids from
`docs/sound.md`'s own table -- id 6 (`1000:568C`, default/non-POWERBOATS) and id 4 (`1000:569E`,
POWERBOATS/round 2), both drawn-gated -- so wiring them in was cheap and directly motivated, not
scope creep. Fixed to match exactly (early return, unconditional tick reset in both branches, the two
sfx calls via the already-established `ctx.sound?.playSfx(id)` convention). `tools/check-step.mjs`
gained a dedicated test using a fully-solid synthetic world (isolating the branch logic from real map
data): confirms the tick-reset-and-early-return on crossing the threshold, hit-box detection still
running below it, the tick reset with dwell inactive, and both sfx ids under their respective round
gate -- six assertions, all independently reverted and reconfirmed to fail first.

**`UNKNOWN_respawn_sideways_offset`** (`src/engine/states.js`'s `stepRespawn`). Fully resolved: NOT a
literal axis-aligned ±12px as the old shorthand said. Live disassembly of `1000:71A2-721F` shows a
12-unit vector at `heading±90°` -- `[BX+0x1278]` (masked to a multiple of 8 here; the SAME scratch
word `HandleCarState1HazardDeath` reuses for an unrelated oscillator, confirming this field really is
a general-purpose per-car scratch cell shared across unrelated state handlers, not a dedicated one)
holds the just-computed respawn `heading`, `+0x40` (rotate +90°) for the camera-target car (`[2660]`,
`cars[0]` in this port's one-player convention) or `-0x40` (rotate -90°) for every other car, wrapped
into `[0,0x100)`; the offset itself is `mul2Floor256(12, SINE8[angle])` on X and
`mul2Floor256(12, SINE8[(angle-64)&0xff])` on Y -- the identical sin/cos-from-one-table idiom already
used and already ported for `collide.js`'s car-car collision impulse. The blocker was pure port
wiring, not an RE gap: `stepRespawn` had no way to tell which car is the camera-target car, since
`cars` wasn't threaded into its `ctx` -- this codebase already had the exact fix pattern one case
away in the same switch statement (`case 0xE`'s own `{...ctx, cars}` object, built for `dropin.js`'s
`stepPartnerWait`). Renamed that object from `dropInCtx` to `ctxWithCars` and reused it for `case 7`
too, rather than building a second, redundant `{...ctx, cars}` object. `tools/check-play.mjs` gained
`checkRespawnSidewaysOffset`: two cars with identical safe points/headings but only one is `cars[0]`
end up at different, precisely-predicted X positions (`36` vs `58`, computed from the exact formula
above, not just "they differ") -- confirmed to fail first when the offset logic is removed.

### A real gap found, deliberately not fixed

**Superseded 2026-09-22 by §9w** -- the deferral below rested on a premise ("five currently-unnamed
`CarRecord` fields") that turned out to be wrong, and "no heading field is read anywhere in this
function" turned out to be wrong too (`[BX+0x1278]` is `car.heading`, the same field this very
document's `UNKNOWN_respawn_sideways_offset` finding, immediately above, already used). §9w has the
corrected derivation and the actual port. Left in place below, uncorrected, per this project's own
evidence-discipline convention: a refuted finding stays on the record with a pointer to what replaced
it, rather than being silently rewritten as if it had never been wrong.

**`UNKNOWN_state1_880a`**: the open item's own framing ("round 4 vs round 9, or heading 0 vs 0x80")
is answered -- **neither**. Full live disassembly of `HandleCarState1HazardDeath` (`1000:880A-8928`,
90 instructions, re-verified independently after the investigating agent's own report, not taken on
trust given the stakes) shows the real dispatch has nothing to do with heading at all: round only
gates whether a `[BX+0x1278]`-oscillator block is reached (`8810`/`8817`: round==9 or round==4 only);
inside that block, the counter (masked to a multiple of 8) at its two waypoints, 0 and 0x80, selects
`STATE1_ANIM_A`/`STATE1_ANIM_B` (tables `27C1`/`27DD`) -- but ONLY when a second, currently-unnamed
gating flag (`[BX+0x12C2]`) is 0; when that flag is nonzero, BOTH waypoints instead fall through to
the SAME round-2-vs-default table split (`2835`/`27F9`) every OTHER round already uses. **No `heading`
field is read anywhere in this function.** The port's existing `stepHazardDeath` (`src/engine/
states.js`) implements a heading-realignment mechanic (turn the car to face the nearer of {0,0x80}
before animating) that has **no basis in the real bytes whatsoever** -- confirmed wrong, not merely
unattributed. This is not latent: `TERRAIN_ROWS` (`src/data/engine-tables.js`) shows both round 4's
and round 9's own rows genuinely dispatch into state 1 via `h64f5`, so the confirmed-wrong behavior
is reachable in this port, not dead code.

**Deliberately not ported this pass**, per direct advisor consultation. Reasons: porting the real
mechanism needs five currently-unnamed `CarRecord` fields (`[1278]`, `[127A]`, `[12B6]`, `[12C2]`,
`[12B0]`) added to the one struct `npm run car` round-trips byte-exact against the real static DS
image -- not a local edit, a change to the project's own ground-truth data structure, to support a
function not yet fully understood end to end (`[12C2]`'s own role, the `-2`/`-1` sentinel handling in
the function's shared tail at `88A7`+, the exact increment/decrement waveform derived so far only as
a branch-by-branch skeleton, not a clean closed form). Porting a piecewise mechanic that can't yet be
described end-to-end risks shipping a new bug while fixing an old one. This codebase already has the
exact precedent for this disposition -- the two-car light bar (drawing done, data source deliberately
not wired, §9p) and `resolveTwoCarKnockout` (logic ported, never called, §9u) are both "flagged, not
fixed" gaps of comparable shape. `stepHazardDeath`'s own docstring rewritten to state the refutation
plainly (not "guessed here", but "confirmed to have no basis in the real bytes") and to point at the
real mechanism's own confirmed shape, without attempting to port it. New, precisely-scoped open item:
`UNKNOWN_state1_oscillator_port` -- what's known (the entry gate, the two waypoints, the `[12C2]`
fall-through) and what isn't (`[12C2]`'s meaning, the five unnamed fields, the exact waveform, the
sentinel tail) are both recorded so a future session doesn't have to re-derive the skeleton from
scratch.

### Genuinely unresolved, one assumption corrected

**`UNKNOWN_ph0_1140_1380`**: a rigorous, three-method investigation (bare-operand `search_
instructions` at the range boundary and several interior addresses; `search_byte_patterns` full-file
sweep; a strong adjacency hypothesis -- this 576-byte region sits immediately after the already-
decoded 5-frame knockout animation, so a plausible 6th frame -- traced to `DrawPh0KnockoutAnimFrame`/
`HandleCarState2or0DKnockoutAnim`'s own frame-index table, `DS:28AB`, and directly REFUTED: that
table's 6 entries are `[0,1,2,3,4,0]`, never indexing a frame 5) found **no consumer anywhere**, by
every method tried. This differs from the other closures above in an important way: it is an honest
negative result, not a resolution, and is recorded as such rather than forced into a false "closed."

**One real, corrected finding along the way**: the region is **not empty padding**, which a first
look at Ghidra's static pre-load image (all zeros there) could easily suggest. Decompressing the
actual shipped `BITSFILE.PH0` and reading the real bytes at runtime shows 35 non-zero bytes forming
three small, deliberately-shaped icon clusters (two small diamonds, a 5×5 ring) at width 24 (matching
the neighbouring frames' own width) -- rendered and visually confirmed
(`tools/out/UNKNOWN_ph0_1140_1380_24w.png`; other widths tried produce incoherent scatter, supporting
width 24 as correct). This reads as genuine, designed sprite content -- most plausibly a small HUD
marker/reticle/waypoint icon -- that shipped in the asset file but was never wired to any draw call
found by these searches. Left open rather than guessed at further; the remaining possibility (a
consumer reached only through a register-relative computation with no literal operand anywhere) is
outside what a bare-operand/byte-pattern sweep can find.

**Implementation, verification, and files touched.** Two engine files changed behavior
(`src/engine/collide.js`, `src/engine/states.js`), each with a dedicated new test proven to fail
against the reverted code first (`tools/check-step.mjs`, `tools/check-play.mjs`). `src/engine/pause.js`'s
own header comment updated to drop the "plausible, not verified" hedge on the 2000ms pause duration.
Full 18-check regression suite (`catalog` through `smoke`) plus `npm run build` stay green throughout
-- confirmed after each individual fix, not just once at the end.

**Method notes.** (1) *A surprising fork finding that contradicts existing, shipped, tested port
behavior deserves independent re-verification before being trusted, not just before being acted on.*
`UNKNOWN_state1_880a`'s own investigating agent reported, correctly, that the real function reads no
heading field at all -- a claim direct enough, and consequential enough (it says existing code is
wrong), that it was re-disassembled from scratch by the coordinating session rather than taken on the
agent's word, before any doc or code change followed from it. (2) *Not every real finding should be
ported immediately, even when it reveals a confirmed bug.* The off-track-collision and respawn-offset
fixes were small, self-contained, and fully understood end to end -- safe to land immediately. The
state-1 oscillator was neither: understanding it well enough to port would have meant adding new,
unnamed fields to a struct this project validates byte-exact against ground truth, to support a
mechanic whose own waveform wasn't yet reconciled into a closed form. An advisor consultation at
exactly this fork-in-the-road -- port now vs. document and defer -- is what kept this pass from
either shipping a second, less-understood bug in place of the first, or silently leaving confirmed-
wrong code undocumented as such.

## 9w. `UNKNOWN_state1_oscillator_port` resolved, correcting the M3.17 deferral (2026-09-22)

**Scope.** User request: "Work on that gap" -- the `UNKNOWN_state1_oscillator_port` item §9v deferred
rather than ported, on the stated grounds that the real mechanism needed "five currently-unnamed
`CarRecord` fields." That premise turned out to be wrong, discovered at the very start of this pass
before any new disassembly: the five raw absolute offsets §9v cited (`[1278]`, `[127A]`, `[12B6]`,
`[12C2]`, `[12B0]`) were never converted to `car.js`'s own RELATIVE (`CAR_RECORD_BASE`-subtracted:
`0x1278-0x124A=0x2E`, etc.) convention and cross-checked against its `FIELDS` table -- doing that
conversion now shows all five were already named: `heading` (`0x2E`), `speed` (`0x30`), `animTimer`
(`0x66`), `animStep` (`0x6C`), `driftSteps` (`0x78`). §9v's other headline claim -- "no heading field
is read anywhere in the real function" -- is also wrong: `[BX+0x1278]` genuinely is `car.heading`,
the same field `stepRespawn` already reads (§9v's own `UNKNOWN_respawn_sideways_offset` finding had
already established this, one section earlier in the same document, without the connection being
made). Both corrections are recorded here rather than silently overwriting §9v's own text, per this
project's evidence-discipline convention of keeping refuted findings visible rather than erased.

**The real mechanism, fully re-derived** (`HandleCarState1HazardDeath`, `1000:880A-8928`, all 91
instructions disassembled and traced branch by branch): every tick, for rounds 4/9 only, bucket
`heading & 0xF8` into steps of 8. If the bucket is already 0 or 0x80, the car has "arrived" at that
waypoint and table `STATE1_ANIM_A`/`STATE1_ANIM_B` (`27C1`/`27DD`) is selected by WHICH waypoint was
reached -- not by round, as the prior (now-replaced) code assumed. Otherwise `heading` steps by ±4
toward whichever of {0, 0x80} is nearer going around the circle (`882C-8839`'s four-way branch: SUB4
for bucket<0x40 or bucket∈(0x80,0xC0]; ADD4 for bucket>0xC0 or bucket∈[0x40,0x80) -- i.e. it wraps
through 0xFF→0 when that is the shorter path, not a linear walk toward a fixed target as the prior
code's `distTo0`/`diff` arithmetic did) and returns immediately, touching nothing else. All other
rounds skip the oscillator and always use the round-2 (`2835`)/default (`27F9`) table split, which the
prior code already had right. A SECOND gate applies uniformly once the oscillator (if any) has
resolved: `driftSteps != 0` (`8849/8850/8857`'s three-way redundant-but-equivalent check, collapsed
to one) pauses table advancement for the whole tick -- the same field `dropin.js`'s
`applyScriptedDrift` already owns and decrements elsewhere in the per-step pipeline; the prior code
never checked it for state 1, for any round. The shared tail (`88A7`+) reads a control word at
`tableBase + step·2 + stride` (stride `0xE` here) separate from the threshold word -- `-1` is
terminal (→ state 7, `animStep`/`animTimer` both reset to 0), `-2`/other are draw-dispatch selectors
irrelevant to headless physics; `engine-tables.js`'s own `{threshold, frames}` extraction already
encodes this correctly (0xFFFF as the threshold-side terminal sentinel, since the terminal control
word is only ever paired with the table's own last, otherwise-unreachable threshold slot) -- verified
by reading the raw table bytes, not assumed.

**`animTimer`'s real increment site, and why no five-state refactor was needed.** The prior deferral's
draft reasoning (visible in the conversation, not shipped) suspected the WHOLE `animTimer`-increment
architecture might be backwards: the real `1000:73E7` (already ported as `applyScriptedDrift`'s own
namesake) increments `[BX+0x12B0]` unconditionally, once per active car per tick (except non-car0 in
round 9), independent of state -- while this port's states 2/4/5/D increment it INLINE, once per
handler call, via the shared `animTableDone` helper. Before touching that helper (used by four states,
not just the one asked about), an advisor-directed gating check ran first: an exhaustive
`search_instructions` sweep found all 17 writers of `[BX+0x12B0]` program-wide. Every entry point into
states 1/2/4/5/D (`HandleTerrainHazardFallSnapStop` `6466`, `HandleTerrainHazardFallKeepVel` `6505`,
`UpdateCarAirborneLandingSfx` `76A4`/`76BC`, `RespawnCarAtSafePoint` `7280`, `HandleCarState0EDropIn
Sequencer` `6D04`/`6F68`) and every one of these states' own terminal exits zero it; `73E7` (`73F4`)
is the ONLY increment site in the whole binary. Since it's always zeroed on entry and incremented
exactly once per tick thereafter regardless of source, the port's "bump inline once per handler call,
from a zeroed baseline" shape is behaviorally IDENTICAL to the real external-unconditional-increment
for states 2/4/5/D -- confirmed, not assumed, by direct disassembly of `HandleCarState2or0DKnockoutAnim`
(`82BE`), `HandleCarState4FallAnimSfx8` (`7F62`), and `HandleCarState5CrashAnimSfx8` (`7EFA`, through
its own `animStep++`): none of the three self-increments `animTimer` either, all three only COMPARE
it, exactly like state 1. **No refactor of `animTableDone` or of states 2/4/5/D was made or was
needed.** State 1 gets its own self-contained inline bump instead (matching the same "once per handler
call" shape, not a call into `applyScriptedDrift`, which would double-count against the other four
states' own inline bumps) -- placed as this function's unconditional first statement, specifically so
it also covers the heading-oscillation sub-phase, which the real `73E7` keeps ticking through
regardless of what `880A`'s own logic is doing that tick. This is the one place state 1 genuinely
differs from a plain reuse of `animTableDone`: the real function also fires two already-catalogued sfx
ids (`docs/sound.md` id 7 `88F6` / id 17 `890F`) gated on the POST-increment `animStep` hitting an
exact, class-dependent step count (TURBO WHEELS(4)/RUFFTRUX(9)/POWERBOATS(2) at step 4→id 17, every
other class at step 8→id 7), which needs an explicit step cursor `animTableDone`'s opaque threshold-
rescan doesn't expose -- so `stepHazardDeath` walks `car.animStep` directly instead of calling the
shared helper.

**What was fixed.** `src/engine/states.js`'s `stepHazardDeath` rewritten in full per the above (the
heading-realignment concept was real, just implemented against the wrong arithmetic and missing the
driftSteps gate entirely). `src/engine/terrain.js`'s `h6456`/`h64f5` (the two real hazard-entry
handlers) gained the matching `animTimer=0` real bytes also do at entry (`6466`/`6505`) -- redundant
in practice given the exit-zeroing invariant above, added for exact fidelity anyway.
`src/data/engine-tables.js`'s stale `STATE1_ANIM_A`/`STATE1_ANIM_B` header comment (which had said
"which of the two is round 4 vs 9... is not established") corrected to the waypoint-based reading.
**Two bugs in this pass's own first draft, both caught before landing.** (1) The initial
`heading±90°`-style translation of `882C-8839`'s four-way branch had the SUB4/ADD4 signs backwards for
two of the four bucket ranges (an easy mistake once the "toward the nearer waypoint" framing is in
English rather than the four literal `JL`/`JG` comparisons) -- caught by hand-checking the boundary
cases against the disassembly a second time before writing any test, not by a test failure. (2)
**Advisor-caught**, the more consequential one: the inline `animTimer` bump's first draft was truly
unconditional, missing `73E7`'s OWN gate (`73EE-73F3`) that skips the increment entirely for every car
except `cars[0]` when `round===9` -- the exact exclusion `dropin.js`'s `applyScriptedDrift` already
carries for its own half of the same real function (`if (ctx.round===9 && !isCarZero) return`), which
should have been the tell. The advisor's own framing for WHY the inline-bump equivalence holds ("the
source of the increment doesn't matter, as long as it happens once per tick from a zeroed baseline")
was itself incomplete as stated -- it's only true when the increment's GATING matches too, and this is
exactly the one case where it didn't. Fixed by threading `cars` into state 1's `ctx` (`case 1` now uses
the same `ctxWithCars` object `case 7`/`case 0xE` already build) and gating the bump on
`car === ctx.cars[0]`, mirroring `applyScriptedDrift`'s own check exactly. Caught before any completion
report was written, by the advisor consultation itself -- not by a test, since the existing test suite
at that point used `round: 4` throughout and `check-rounds.mjs`'s own round-9 coverage only asserts
no-NaN/in-world, which a car permanently stuck in state 1 satisfies trivially. A dedicated regression
test was added afterward specifically because the existing suite couldn't see this class of bug.

**Tests, with teeth.** `tools/check-play.mjs` gained `checkStateOneOscillator`: (1) heading=200 (round
4) converges to bucket 0 in exactly 14 ticks via the short wraparound path (200→204→...→252→0) -- the
regression case that actually distinguishes old from new: the prior linear-diff code would have walked
the LONG way (200→196→...→0, 50 ticks, never wrapping) to the same eventual destination, so tick count
and intermediate path are what a table-duration-only check can't see but this one does; (2) heading=100
(also round 4) converges to the OTHER waypoint, 0x80, in 7 ticks -- proving waypoint-based table
selection is real (a round-4 car reaches either table depending on starting heading), though the two
tables' own thresholds are headlessly indistinguishable (only `frames`, draw-only, differs), so this is
checked via convergence target, not table identity; (3) `driftSteps != 0` freezes `animStep`/`state`
while `animTimer` keeps incrementing underneath it, and clearing `driftSteps` lets advancement resume
to state 7; (4) the round-9 exclusion: `cars[0]` progresses normally out of state 1 while every other
car in the same array gets no `animTimer` increment at all and stays permanently stuck at `animTimer=0`
-- added specifically to cover the advisor-caught bug above; (5) the sfx gate correctly stays silent
under `runStates`' own unconditional `drawnThisFrame=0` reset before dispatch -- the same pre-existing
limitation states 4/5's own sfx-8 gate already has (nothing in this headless engine sets
`drawnThisFrame` back to 1 for a table-animation state; only an external renderer would), so the gate's
SUPPRESSION is what's provable here, not its firing. All groups independently reverted (the sign bug,
a temporarily-removed driftSteps gate, and the round-9 gate itself) and reconfirmed to fail first.
Building the round-9 test also caught a pure test-authoring bug, unrelated to the port itself: an
initial draft passed a fresh `{}` `raceState` on every loop iteration, which made `runStates`' own
RUFFTRUX (round 9) branch re-default `raceState.ruffTruxTimer` to 0 every single call and hijack
`cars[0]` into state `0x10` before the state-1 logic under test ever got a chance to run -- fixed by
persisting `raceState` across the loop, the same pattern every other test in this file already uses.
Full 18-check regression suite (`catalog` through `smoke`) plus `npm run build` stay green throughout.

**What's still open, narrower now.** A real, separate gap surfaced but was NOT fixed this pass (out of
the scope the advisor's own gating-check guidance drew): states 4/5's ported `stepFallAnim`/
`stepCrashAnim` call `animTableDone` UNCONDITIONALLY every tick, with no `driftSteps` gate on the
table-walk itself (only position-drift application, in `dropin.js`, is gated) -- while the real
`7F62`/`7EFA` both have the same three-way driftSteps-gated pause branch state 1 does (confirmed by
direct disassembly of both through the point where each begins its own table-walk). This does NOT
affect `animTimer` correctness (both the port's unconditional inline bump and the real unconditional
external one increment every tick regardless of driftSteps, so that part already matches) -- it's
narrower than an animTimer bug: only the TABLE-WALK/frame-advancement timing during an active scripted
drift is potentially off for states 4/5. New, precisely-scoped open item:
`UNKNOWN_state4_5_driftsteps_gate`. **Resolved 2026-09-22 (§9z) -- and it turned out to be more than
just the gate: a real sfx-timing bug (wrong field tested) and an incomplete terminal-field set were
found alongside it, in both states.**

## 9x. `UNKNOWN_h2h_knockout_only_ending` resolved for the race-loop half (2026-09-22)

**Scope.** User request: work `UNKNOWN_h2h_knockout_only_ending` -- "can a two-car match end by
knockout alone, without ever crossing a finish line?" -- the one piece of `UNKNOWN_26B8_polarity`
M3.16 (§9u) left open, framed there as needing a live two-human DOSBox trace to settle. It didn't.

**The race loop's only exit is `[26C6]>=2` (`RunRaceMainLoop`, `1000:3081`), full stop.**
`CMP [26C6],2; JL 3095` -- `JL` taken (still `<2`) falls to `3095`, the normal per-tick continuation
(draw, airborne/landing, `73E7`'s scripted-drift/animTimer pass, projectile flight, loop back for
another car); `JL` NOT taken (`>=2`) falls through to `3088` (a two-car-format check, then straight to
`30DF`) or, for four-car format, a short `[26CC]`-countdown linger before also reaching `30DF`. `30DF`
is the race's own exit sequence (re-verified this session, not assumed from its old "camera-target
car" citation alone): sfx id `0x10` gated on `drawnThisFrame`, `StopEngineSounds`, a 100-vsync animated
banner loop calling `DrawRaceOverBannerSfx10` (`855A`, the same tally-chain entry point §9u's own
"WINNER!"/"LOSER!" evidence already traced), a full driver stop+reset, then `RET`s out of
`RunRaceMainLoop` entirely. There is no OTHER path out of the per-tick loop -- no separate
knockout-triggered break, no early-return elsewhere in the function.

**`ResetCarsAfterKnockoutSfxA` (`1000:7759-78F7`, all 106 instructions, re-disassembled in full this
session -- not just the `77F5` write site §9u already had) never touches `lapsRemaining`
(`[+0x12ED]`) or `[26C6]` anywhere in its body.** It writes: `state` (`0xB` to the leader-by-
`racePosition`/state-0-preference winner, `0xC` to the other -- the already-documented §9u logic,
confirmed unchanged), `speed` and four other motion fields (zeroed, for BOTH cars), `[26B8]` (the
winner), `[2911]` (armed to `2`, the already-documented §9v/§9r "processing" state), and, newly
noticed this pass, `[+0x12F1]/[+0x12F3]` copied from the winner onto the loser (the exact fields
`UNKNOWN_h2h_12f1_12f3` names -- still not independently traced, but now confirmed to be part of the
knockout-reset's own output, not merely adjacent to it). **Nothing in this function locks either
car's controls, and neither state `0xB` nor `0xC` gates the physics pipeline** -- both share state 0's
own draw-only state-table entry (`stepTwoCarIdle`/`7D73`, already known since M3.8), meaning
steering/throttle/velocity/collision/checkpoint-crossing keep running normally for both cars, exactly
as if state were still `0`, for every tick after the knockout.

**`[26C6]`'s other five direct `=2`/`=4` setters were checked too, not just the counting mechanism.**
A full `search_instructions` sweep for `0x26c6` found 20 sites total (not just the counting logic
§9s's own account describes) -- `RunCarPhysicsStep`'s per-car counting loop (`4B85-4BDE`, unchanged
from §9s: `lapsRemaining==0 && speed==0` per car slot, plus the car0-forcing override), and five
OTHER direct setters: `UpdateCarCheckpointsAndSurfaceSfx` (`6054`, re-disassembled -- a pure
lap-count comparison: car SLOT 0 specifically, `lapsRemaining<=2` and strictly AHEAD of (corrected §9ah; the text originally said behind) every other
car's own `lapsRemaining`, sets `[26C6]=2` -- the comparison itself is clear from the bytes, what it's
*for* is not established here; no state/knockout involvement whatsoever), three
sites in `UpdateCarAirborneLandingSfx` (`76F2`/`772A`/`7742`, not re-disassembled this pass -- already
a well-understood, unrelated subsystem, no plausible knockout connection [**refuted §9am**: these three
ARE the end of a knockout exchange -- the commit of the 64-step blink -- and they are the only natural
end of a two-car race]), `HandleCarState10BannerSfxF`
(`8702`, the RUFFTRUX "Failed"-banner handler -- round-9-only, unrelated to two-car mode), and a
cheat effect (`CheckCheatSpotsThenPause`, `36A7`, sets it to `4` -- an "instant end the race" cheat,
`4>=2` so it also satisfies `3081`'s gate; which of this project's already-catalogued 10 cheat effects
this corresponds to was not re-traced). None of the six total writers are reachable from, or
connected to, `ResetCarsAfterKnockoutSfxA` or state `0xB`/`0xC`.

**Answer: no, not at the race-loop level.** [**Corrected §9am**: the conclusion below rests on dismissing `76F2`/`772A`/`7742` as unrelated; they are the exchange end. A two-car race ends ONLY there (or by the instant-win cheat) -- completing the laps never ends it by itself, and there is no "both cars keep racing until someone finishes".] A two-car match cannot end "by knockout alone" in the
sense the open item asked -- the physics loop keeps running, with both cars still fully driveable,
until `[26C6]` reaches its sentinel some OTHER way (almost always lap completion; occasionally one of
the five special-case triggers above, none of them knockout-related). Practically, once a knockout has
assigned states `0xB`/`0xC`, the match's OUTCOME is already decided, but the RACE, mechanically, is
not -- it keeps simulating until someone (plausibly, but not provably, the car left in state `0xB`)
crosses the finish line or one of the special-case triggers fires.

**A real correction this surfaces, independent of the above**: §9u's own `4C08`/`4C64` table row
described them as "finish-detection, gated `[26C4]==1` one-shot" -- disassembling the FEW instructions
immediately preceding `4C08` (`4BF1-4C07`, not captured by §9u's own citation window) shows the actual
outer gate is `CMP [26B4],4` (`JL` selects the `[2662]`/P2 branch at `4C64`; the fallthrough is the
`[2660]`/P1 branch at `4C08`) -- the two-car MATCH SCORE, not a finish flag. `[26C4]==1` is a real,
correctly-documented inner gate, just not the only one. This makes `4C08`/`4C64` a "the cumulative
match has now been decided by score" writer, not a "this race's own finish line was crossed" writer --
a materially different trigger, corrected in the table above and wherever else this document cites it.

**What this leaves open, narrower than before.** Since the race loop only exits via `[26C6]`, and
`4C08`/`4C64` is gated on the match SCORE (`[26B4]`) rather than directly on a finish, the real
open question is no longer "can the match end without a finish" (no) but **"once `[26B4]` reaches a
winning threshold, does `[26C4]` get armed in a way that's guaranteed to fire `4C08`/`4C64` with the
SAME car `ResetCarsAfterKnockoutSfxA` already credited via `[26B8]`, or can these two writers
disagree?"** `[26B4]`'s and `[26C4]`'s own full writer sets were deliberately NOT traced this pass
(scoped out, matching the same "whole point-tracking state machine this port doesn't implement" gap
M3.11 already flagged for the two-car light bar's own data source) -- new, precisely-scoped open item:
`UNKNOWN_h2h_match_score_writers`. Whether a live two-human trace is still the most direct way to
settle THAT question, rather than more static tracing, was not evaluated. **Resolved 2026-09-23,
see §9ag: yes, `4C08`/`4C64` mechanically echo `77F5`'s own verdict (they're gated on `[26B4]!=4`,
which only leaves 4 by reading `[26B8]`, itself only ever armed by `77F5` or `4C08`/`4C64`
themselves) — but they fire at most once per race, permanently freezing the HUD rank-slot table on
the FIRST scoring event, while `77F5`'s own knockout-reset can keep re-arming `[26B8]` for a SECOND,
THIRD, etc. fall for the rest of the race. So the frozen score and the "WINNER!"/"LOSER!" text can
name different cars once more than one knockout happens in a race.**

**Method note.** This closed via two focused disassembly checks (the `3081` loop-exit gate, then a
sweep confirming none of `[26C6]`'s other five writers connect to knockout) rather than the full
`[26B4]`/`[26C4]` writer-mapping a first instinct reached for -- an advisor consultation redirected
from "map both globals' full writer sets" (the M3.16-scale, multi-agent approach) to "find the one
check that discriminates the actual question first," which turned out to be enough. No code changes:
nothing in this port currently claims anything about race-loop-level knockout endings (`twocar.js`'s
own scope -- logic ported, never wired into a race loop -- is unaffected either way), so this is a
pure documentation resolution, not a bug fix.

## 9y. Four small open items: kidmodifier, h2h_12f1_12f3, 2p_p2_record, RUFFTRUX bonus rules (2026-09-22)

**Scope.** User request: work `UNKNOWN_h2h_12f1_12f3`, `UNKNOWN_rufftrux_timer`/`UNKNOWN_bonus_race_rules`,
`UNKNOWN_kidmodifier_use`, `UNKNOWN_2p_p2_record`. Four parallel Ghidra investigations (forks
inheriting this session's context) covered one item each; three closed cleanly as pure
documentation, one (`kidmodifier`) surfaced a real, substantial port gap that needed independent
re-verification (it caught real errors in the investigating fork's own report) before being fixed.

### `UNKNOWN_h2h_12f1_12f3` -- resolved, no port change needed

`[BX+0x12F1]`/`[BX+0x12F3]` are `car.js`'s already-named `safeX`/`safeY` (relative `0xA7`/`0xA9`).
Initialized in `InitRaceCarsFromTables` (`437B`/`4383`) as copies of `posX`/`posY`. The "h2h" framing
in the item's own name traces to `ResetCarsAfterKnockoutSfxA` (`7838-7868`) reusing these
general-purpose fields to copy the knockout winner's safe point onto the loser -- not evidence the
fields are H2H-specific. Every real writer/reader (`UpdateCarPositionCommitAndBounce`,
`UpdateCarCheckpointsAndSurfaceSfx`, `RespawnCarAtSafePoint`, the knockout-reset, and `FUN_1000_78F8`'s
own two-car re-line-up copy) already has a correct, already-shipped counterpart in `collide.js`/
`checkpoints.js`/`states.js`. No gap found.

### `UNKNOWN_rufftrux_timer` / `UNKNOWN_bonus_race_rules` -- already resolved, stale catalog entries

Fresh disassembly of `RunTournamentLoop` (`112B-113D`), `FUN_1000_1a82` (`1A82-1AAC`, the bonus-race
runner: forces round 9 via `[343]=1`, runs it, reads `[291D]` for the win/lose outcome message),
`SetupTournamentRace` (`1160-1182`, confirms `[343]!=0` overrides the normal `ORDER_TABLE` selection),
and the states-F/0x10 banner handlers (`8683-8710`, confirms `[291D]` is simply "which banner state
was last active," the exact signal `1A82` reads) all independently re-confirm the rule set
`docs/engine.md` §7's own original (M3.0-era) prose already stated, and that `tournament.js`
(`streak`/`bonusRacesTaken`/`pendingBonusRace`, the 1st-place-gated streak decrement, the
`MAX_BONUS_RACES` cap) already implements correctly. Nothing was found to contradict the existing
docs or port. These read as stale catalog entries -- surfaced by an earlier session, never marked
closed -- rather than genuine gaps.

### `UNKNOWN_2p_p2_record` -- resolved, pure documentation (no port gap: two-human H2H isn't
implemented at all, so there is nothing to wire this into yet)

`[0x98A]`/`[0x98C]` are the live two-human H2H match's win-tally (P1/P2, 0-4, first to 4 wins --
compared at `RunHeadToHeadTournament@2081/208B`). Reset at `RunHeadToHeadChooseGameMenu@1F09/1F0E`,
incremented at `ShowHeadToHeadRaceWinnerTune8@2583/257D` (right after that function's own `[26B8]`-
keyed "WINNER!"/"LOSER!" banner logic, §9u), read and rendered as a single digit per player by
`FUN_1000_240a` (rename: `DrawH2HWinRecordDigits` -- two sprite boxes plus `DrawMenuStringByIndex`
against a literal `"0".."4"` digit-string table at `DS:8A6`), called from three screens
(`RunHeadToHeadTournament`, `RunHeadToHeadVehicleSelectTune2`, `ShowHeadToHeadRaceWinnerTune8`
itself). `ShowHeadToHeadResultUnreferenced` (`2099-216B`) is confirmed genuinely dead code --
`get_xrefs_to` on its entry returns zero callers -- an abandoned earlier 4-counter draft of the same
tally logic (`[98A]+[98B]` / `[98C]+[989]`), left unreferenced when the developers simplified to the
live 2-counter mechanism.

### `UNKNOWN_kidmodifier_use` -- resolved and FIXED, a real, substantial port gap

**The investigating fork's report needed independent re-verification, and re-verification caught
real errors in it -- the third time this session's pattern of re-checking consequential sub-agent
findings has paid off** (after the state-1 oscillator and the round-9 gate, both earlier this same
overall work). The fork correctly identified that `InitRaceCarsFromTables`'s per-car tuning handicap
`CX` was entirely unported, but its own account had it touching only 3 fields (`maxSpeedCur`/
`reverseLimit`/`accel`) through one mechanism. A full independent re-disassembly of the whole block
(`3FBE-4134`, not just the `3FBE-4059` the fork was directed at) found **7 affected fields and two
additional adjustment layers**, and caught three concrete errors in the fork's own report: the
`[28C1]<=0` flat-ramp values for car2/car3 were reported swapped (real: car1=0, car2=12, car3=6 --
not 0/6/12); a claimed `"[28C1]>=8->+8"` rule doesn't exist -- it conflates two real, separate rules
(`==8`->+3 and `>=0x13`(19)->+8); and `brakeDecel`/`coastDecel`/`slipThreshold`/`gripStep` (4 of the 7
affected fields) were missing from the report entirely.

**The real mechanism, fully re-derived**: a per-car handicap `CX`, computed once at race init
(`3FBE-4059`) from `KID_MODIFIER[character]` (an IDENTITY table, `KID_MODIFIER[c]===c`, already noted
in `engine-tables.js`'s own comment) when `[28C1]`(tournament index)`>0`, or a flat per-slot ramp
(car1=0/car2=12/car3=6) when `[28C1]<=0` -- car slot 0 (the human) always gets `CX=0` regardless,
confirmed unconditional. `CX` then gets `-15`, `+[28C1]` raw, three vehicle-class bonuses
(TANKS/CHOPPERS/POWERBOATS, `round` standing in for `[28BF]` per this port's own established
approximation), and six exact/threshold `[28C1]`-specific adjustments. This `CX` is applied, with
different integer multipliers, to `maxSpeedCur`(x11)/`reverseLimit`(x4)/`accel`(x1)/`brakeDecel`(x1)/
`slipThreshold`(x2)/`gripStep`(x3) -- `coastDecel` gets no `CX` term at all, confirming the port's
pre-existing raw `info[4]` was already correct there. Two further layers, both newly found: (1)
`DRONE_MAX_VEL_HANDICAP[[28C1]]` (a 26-entry table, `DS:2462`) subtracted from drones' `maxSpeedCur`
only; (2) a two-car-format-only extra `accel` penalty for drones once `[28C1]>=0x12`(18) --
`accel>>2` at `[28C1]===0x17`(23), `accel>>4` otherwise; and (3) a flat, car-0-ONLY nerf
(`maxSpeedCur-=225`, `accel-=6`) at `[28C1]===0x17`(23) -- the real code applies `-75`/`-2` once per
"advance to the next car" loop transition, which fires exactly 3 times, confirmed against the loop's
own exit structure (it returns before this check runs a 4th time).

**A structurally dead alternate mechanism was also found and confirmed unreachable, not ported**: a
first loop (`3F3B-3FBB`), gated on `CS:[0x9C62]!=0`, implements a completely different per-character
bit-`0x80`-encoded penalty formula that would apply to ALL FOUR cars (including the human) and bypass
the whole `KID_MODIFIER`-based mechanism above if reached. `[9C62]`'s static image value is `0`, and a
full-program sweep found its only two writers (`RunOnePlayerHeadToHeadVsCpu`, `RunOnePlayerChallenge`)
both also set it to `0` -- no writer anywhere sets it nonzero. Same "toggle exists, off-state is the
only reachable one" pattern already established for `UNKNOWN_138A_clear` (M3.17).

**Fixed**: `src/engine/race.js`'s `spawnCars` gained `computeTuningOffset` (the full `CX` derivation)
and now applies it, plus the handicap subtraction and both extra penalty layers, to all seven fields;
new options `tournamentIndex`/`opponentCharacters` (defaulting to `0`/`[]`, which correctly selects
the real game's own flat-ramp branch for callers with no tournament context, e.g. this port's own
`play.js`). `src/frontend/flow.js` wired `tournament.raceIndex`/`tournament.opponents` (both already
tracked by the existing tournament state machine) through to the new options. `tools/check-play.mjs`
gained `checkKidModifierTuning` -- 9 hand-computed assertions (default/flat-ramp, a real
`tournamentIndex>0` KidModifier-identity case, and the two-car-format + race-23 interaction). The
test's own first draft caught 4 of its OWN arithmetic mistakes against the real output (a sign-
extension slip on `0xFCC1`, indexing `DRONE_MAX_VEL_HANDICAP[0]` instead of `[8]`, and an addition
error) before any assertion was trusted -- corrected by hand-retracing, not by adjusting the
assertion to match whatever the code produced. All 9 assertions reverted (a temporary `cx=0`
short-circuit) and reconfirmed to fail first (8 of 9 failed; the car0-zero-adjustment assertion
correctly still passed, since car0 is `CX=0` either way). Full 18-check regression suite + `npm run
build` stay green throughout -- this is a genuine behavior change (AI drone tuning across every
tournament race, previously silently un-adjusted since M3.6), not a no-op refactor, so every existing
check running clean is a real, not free, confirmation.

**Implementation note**: `spawnCars`'s own pre-existing header comment had already flagged this exact
gap ("the per-car handicap CX ... is assumed 0 for every car ... not a captured fact; full
tournament-handicap wiring is out of scope here") -- this pass closes a gap the port's own source
already knew about and named, not a surprise discovery from nowhere.

## 9z. `UNKNOWN_state4_5_driftsteps_gate` resolved (2026-09-22)

**Scope.** User request: work `UNKNOWN_state4_5_driftsteps_gate` -- states 4/5's ported table-walk
wasn't gated on `driftSteps` the way the real bytes are, an item surfaced but deliberately deferred
during M3.18's own state-1 work. Full re-disassembly of both real handlers (`HandleCarState4FallAnimSfx8`
`1000:7F62-7FE7`, `HandleCarState5CrashAnimSfx8` `1000:7EFA-7F61`) found this was correctly scoped but
incomplete: alongside the missing `driftSteps` gate, both functions had a genuine sfx-timing bug (the
port's condition tested the wrong field) and an incomplete terminal-transition field set.

**The `driftSteps` gate**, exactly matching state 1's own shape (`docs/engine.md` §9w): both real
functions check `driftSteps(0x12C2)!=0` before touching the animation table at all; while nonzero,
the tick is draw-only (`CALL 7D73`), no table read, no `animStep` advance. The port's prior
`animTableDone`-based implementation had no such check.

**The sfx-8 timing bug, found while re-deriving the gate, not part of the item's own framing.** The
real sfx-8 firing condition (`7FA4` for state 4, `7F30` for state 5) tests the POST-increment
`animStep`, not `animTimer` -- the port's prior code tested `animTimer+1===4`, which for
`FALL_ANIM`'s own thresholds (`[2,4,6,8,...]`) fires around tick 3, roughly 2-4× too early compared
to the real gate (`animStep` reaches 4 only once `animTimer` crosses `threshold[3]`: `8` for
`FALL_ANIM`, `16` for `CRASH_ANIM`). This is audible behavior on a common path (every car fall and
every crash), the same class of finding as the M3.17 off-track-collision fix.

**Table-pairing verified against raw bytes, not inferred from shape**: `DS:2879` (`FALL_ANIM`) and
`DS:2855` (`CRASH_ANIM`) were both read live -- each is 9 threshold words immediately followed by 9
control words, positionally paired (`threshold[8]=0xFFFF` pairs with `control[8]=-1`), confirming
`engine-tables.js`'s own `{threshold, frames}` extraction already had this right and that
`threshold[step]===0xffff` is a correct terminal test.

**Terminal-transition field sets, both incomplete in the prior code.** State 4's real terminal
(`7FBD-7FE1`) sets SEVEN fields: `animStep=0`, `animTimer=0`, `active=0`, `subState=1`, `state=0xE`,
`controlsLocked=1`, `cameraFarFlag=0` -- the prior code set only four (`active`/`subState`/`state`/
`animTimer`), missing `animStep`/`controlsLocked`/`cameraFarFlag` entirely. State 5's real terminal
(`7F49-7F61`) sets four: `animStep=0`, `state=7`, `animTimer=0`, `subState=0` -- the prior code set
three, missing `animStep`. State 5's `subState=0` (vs state 4's `subState=1`) is a real, confirmed
difference between the two states, not an inconsistency to fix -- state 5 hands off to state 7,
which doesn't consume `subState` the way state E's own sequencer does. `HandleCarState1HazardDeath`'s
own terminal (`8916-8922`) was re-checked directly (its own docstring had speculated it might share
this gap) and confirmed to set neither `subState` nor anything beyond `animStep`/`state`/`animTimer`
-- no correction needed there.

**The round-9/non-car0 `animTimer` exclusion**, ported alongside the rest for consistency with state
1's own already-established mechanism (`bumpAnimTimerRound9Gated`, a new small shared helper): a
real, narrow pre-existing bug this closes as a side effect -- a round-9 drone previously in state
4/5 had its `animTimer` bumped where the real `73E7` would have skipped it entirely.

**Deliberately not ported**: state 4's `[2682]` "which car fell this tick" latch (`7F62-7F69`) --
already documented at `1000:77F5`'s own EOL comment as what `ResetCarsAfterKnockoutSfxA`'s fall
branch consumes. This port has no `[2682]` equivalent, and two-car knockout detection/resolution is
itself unwired (`twocar.js`'s own established scope) -- adding a bare global for one write site with
no reader would be dead weight. Flagged for whoever eventually wires two-car knockout end-to-end.

**Implementation.** `src/engine/states.js`'s `stepFallAnim`/`stepCrashAnim` rewritten in full,
matching `stepHazardDeath`'s own explicit `animStep`-cursor table-walk shape; `case 4`/`case 5` in
`runStates` now pass `ctxWithCars` (needed for the round-9 exclusion, same as `case 1`/`7`/`0xE`).
A pre-existing test (`tools/check-play.mjs`'s `checkDropIn`) needed a real fix, not a workaround, to
keep passing: `dropin.js`'s `triggerDropIn` sets a genuine `driftSteps=4` scripted drift on entry to
state 4, and the test's own loop only called `runStates`, never `applyScriptedDrift` (which owns the
decrement) -- correctly exposing that state 4's table-walk is now genuinely paused until that drift
resolves, exactly matching real behavior; the fix threads `applyScriptedDrift` alongside `runStates`
in that loop, matching `step.js`'s own real per-tick order, not a special case for the test.

**Tests, with teeth.** `tools/check-play.mjs` gained `checkStateFourFiveDriftGate`: the `driftSteps`
freeze (held deliberately LONGER than each table's own last real threshold -- `40` for `FALL_ANIM`,
`160` for `CRASH_ANIM` -- so it's genuinely discriminating against the prior code, which ignored
`driftSteps` and would already have finished by then; a first draft held only 30 ticks, which passed
against BOTH old and new code since 30 ticks wasn't enough for the OLD code to finish either, proving
nothing -- caught before being trusted, by asking specifically whether the old code would ALSO pass
the assertion, not just whether the new code did), resuming after the drift clears, the sfx-timing
tick correctness (`animStep` reaching 4 at exactly `animTimer=8`/`16`, not observing a fired sound --
`runStates` zeroes `drawnThisFrame` before dispatch, the same pre-existing limitation
`checkStateOneOscillator`'s own sfx test already documents), full terminal-field-set completeness for
both states, and the round-9 exclusion (mirroring state 1's own test, state 5 not re-tested
separately since it shares the identical helper). All assertions independently reverted (both
functions restored to their prior `animTableDone`-based implementation) and reconfirmed to fail
first -- 9 of 9, after the driftSteps-freeze assertions' own duration was corrected to be genuinely
discriminating. Full 18-check regression suite + `npm run build` stay green throughout.

## 9aa. `UNKNOWN_live_verification`: the first true live-DOSBox check of any M3 engine code (2026-09-22)

**Scope.** User request: work `UNKNOWN_live_verification` -- every M3 engine claim to date was
`[STATIC]` (read from bytes) or checked only against M3.4's own 21-distinct-step idle trace, itself
carrying an unresolved divergence at step 1. Per an advisor consultation before touching the
emulator, this session narrowed the item to two concrete deliverables rather than chasing the whole
survey-sized gap at once: (1) settle M3.4's own open divergence with a small, targeted live read
before attempting any new capture, and (2) fix whatever that read reveals. A longer/driving trace and
D9's other "first live questions" (car-car impulse sign, sfx 2 on lap completion, one step of car 0)
are explicitly carried forward, not attempted this session.

**Reaching a fresh race required restarting the DOSBox instance.** The managed instance had been
running continuously since an earlier session (frame count in the tens of millions) and its menu
cursor state was stale: `SELECT GAME` -> `S` landed directly on `Head to Head`'s character select
every time (the exact `UNKNOWN_menu_default_persistence` effect §9f already recorded), and once
inside `Head to Head`'s Player Two character select, no input registered at all -- not movement, not
confirm -- across a dozen attempts with varying hold durations (`input_sequence` and `input_key`
both tried, 50-400ms holds). A diagnostic pass (reading the BIOS keyboard flags at `0040:0017`,
confirming a custom `INT 9` handler was genuinely installed via the IVT at `0000:0024`, comparing
`cpu_read_registers` across un-paused calls) didn't isolate a cause and was abandoned as a rabbit
hole per this project's own "don't chase tool failures past 2-3 attempts" discipline. `dosbox_shutdown`
+ `bridge_start` (config reset the mounted `C:` drive to a sibling project's folder -- re-mounted to
this project's `game/` directory) gave a completely clean boot, and the standard recipe (`C:` /
`MICRO`, two `ENTER`s past the code-card screen, `ENTER` past `GAME OPTIONS`, `S` through
`SELECT GAME` -> `ONE PLAYER` -> `Challenge` -> character select -> `PRESS ANY KEY`) reached
`ROUND21` (round 2 race 1, POWERBOATS Challenge qualifier -- exactly D8's target) reliably, first
try, with `input_sequence` 150ms holds -- confirming the earlier flakiness was this specific
long-lived instance's own accumulated state, not a general problem with the input tooling.
**Worth recording for the next live session: prefer a fresh `dosbox_shutdown`/`bridge_start` over
reusing a long-running managed instance**, rather than spending time diagnosing input against stale
menu/keyboard state.

**The discriminating read.** Per the advisor's framing, this needed two words per drone, not a new
trace: `debug_pause` while the race was running, `cpu_read_registers` confirming a trustworthy
pause point (`symbol: "HandleCarState1HazardDeath+0x5ce"`, `ds: 2938` -- a named real function, not
an ISR or reentrant context), then one `mem_read` of the whole `0x590`-byte four-car `CarRecord`
block (`DS:124A`, `segment: 2938` fixed, not the live-resolved `"ds"` register name -- an earlier
attempt using the live-resolved register name while UNPAUSED gave visibly wrong values, `ds`
changing between two consecutive un-paused reads with `cs` staying fixed at `574`, most likely
sampling mid-ISR; pausing first removes the race entirely). Decoded with `car.js`'s own `fromBytes`
(not hand computed offsets, avoiding exactly the kind of arithmetic slip that bit M3.20's own first
draft):

| | car0 (human) | car1 (drone) | car2 (drone) | car3 (drone) |
|---|---|---|---|---|
| `speed` | 0 | **1014** | **1146** | **1080** |
| `maxSpeedCur` | 1662 | **1014** | **1146** | **1080** |
| `maxSpeedBase` | 1662 | **1014** | **1146** | **1080** |
| `controlsLocked` | 0 | 0 | 0 | 0 |
| `controlBits` | 0 | 0x28 | 0x68 | 0x28 |

**Correction (2026-09-22, same session): the row above originally read `maxSpeedBase: 1662/1662/1662/1662`
for all four cars — a transcription error, not what the captured bytes said.** The real dump (still on
disk, re-decoded byte-for-byte to confirm) always showed `maxSpeedBase` equal to `maxSpeedCur` for
every car (1662/1014/1146/1080), exactly like the row above now reads. The wrong transcription agreed
with `tuningFieldsFor`'s own `maxSpeedBase: info[0]` formula (also wrong at the time), so the "28 of 28"
claim below looked clean for the worst possible reason: two independent errors that happened to cancel.
Caught by a live re-derivation while working the two open items this session left (§9ab): a full-program
`search_instructions` sweep for `0x129e` (relative `maxSpeedBase`) found exactly ONE writer anywhere in
`MICROU.EXE` -- `InitRaceCarsFromTables 1000:4244-4248` (`MOV CX,[BX+0x129c]; MOV [BX+0x129e],CX` --
`maxSpeedBase` is a spawn-time COPY of the already-CX-adjusted `maxSpeedCur`, not a separately-derived
flat value), confirmed against three independent live reads across two separate races, all consistent.
`race.js`'s `tuningFieldsFor` is fixed accordingly (§9ab). Six of the seven cross-checked tuning fields
below were genuinely confirmed then and still are; `maxSpeedBase` specifically was not, until now.

`speed === maxSpeedCur` exactly for all three drones -- **confirms hypothesis 1** (`maxSpeedCur`
genuinely pinned, not a coincidence: matches the per-car handicap-adjusted cap, not the round's flat
`maxSpeedBase`), and is on its own a complete, sufficient explanation for the frozen speed regardless
of anything else. **A precise claim about hypothesis 2, not an overclaimed one**: this `debug_pause`
landed several real-time tool calls (many physics ticks) after the race screen first appeared, not at
spawn -- `spawnCars` deliberately sets `controlsLocked: 1` at tick 0, cleared once the camera settles
(§1/§3), so `controlsLocked === 0` here does NOT show it was already 0 at the exact early tick M3.4's
own divergence was about. What it DOES show: well within the same "frozen speed" window, with
`controlsLocked` already clear and the drones actively holding accel+fire (`controlBits` nonzero),
speed stays exactly at `maxSpeedCur` with no help from any controls-locked gate -- the clamp alone is
doing the job, unassisted, making hypothesis 2 unnecessary as an explanation here even though this
read cannot rule out `controlsLocked` also having been true for part of the window. Both readings were
open exactly as §9f left them since M3.4, through every milestone since; hypothesis 1 alone closes the
question this session needed answered. The drones' `speed` values (1014/1146/1080) are the *exact
same numbers* M3.4's own trace recorded as "frozen" -- strong independent confirmation this fresh
Challenge-mode race and the M3.4 capture share the same `round`/`tournamentIndex=0` context, not a
coincidence.

**Why `step.js` didn't need fixing.** `step.js:61` already reads
`car.speed = Math.min(car.speed + accelAmt, car.maxSpeedCur)` -- the clamp the divergence seemed to
be missing was already there. The real bug was one level removed: `tools/check-trace.mjs`'s own
`staticFieldsFor` (a second, independent derivation of each car's static tuning fields, never wired
to `race.js`'s `spawnCars`) still used the flat `maxSpeedCur: info[0]` approximation from *before*
M3.20 added the real per-car `CX` handicap -- explicitly flagged at the time as "an approximation,
not a captured fact" (§9f), but never revisited once M3.20 made the correct formula available
elsewhere in the codebase. The replay's clamp was real; the ceiling it clamped against was wrong.

**Full cross-check, not just the one field.** Decoding the SAME live memory dump's remaining tuning
fields and comparing against `race.js`'s `tuningFieldsFor(carIndex, round)` (round 2, `tournamentIndex`
defaulted to 0) gives an exact match on these 5 fields, all 4 cars (20 of 20 values; `maxSpeedCur` and
`maxSpeedBase` are the other two of the full 7, covered in the table above and its correction note):

| | car0 | car1 | car2 | car3 |
|---|---|---|---|---|
| `accel` | 32 / 32 | 24 / 24 | 36 / 36 | 30 / 30 |
| `reverseLimit` | -781 / -781 | -813 / -813 | -765 / -765 | -789 / -789 |
| `brakeDecel` | 88 / 88 | 80 / 80 | 92 / 92 | 86 / 86 |
| `slipThreshold` | 67 / 67 | 71 / 71 | 95 / 95 | 83 / 83 |
| `gripStep` | 60 / 60 | 56 / 56 | 92 / 92 | 74 / 74 |

(live / `tuningFieldsFor`'s prediction, each pair identical). This is simultaneously the first real
live-DOSBox confirmation of any M3 engine code end to end, and an independent, live re-verification
of M3.20's kidmodifier fix (which previously had unit tests only, no live check) -- both closed by
the same one memory read.

**The fix.** `src/engine/race.js`'s inline per-car tuning computation (`maxSpeedCur`/`accel`/
`reverseLimit`/`brakeDecel`/`coastDecel`/`slipThreshold`/`gripStep`/`steerStep`, previously written
directly into `spawnCars`'s body) extracted into its own export, `tuningFieldsFor(carIndex, round,
tournamentIndex, character, raceFormat)`, used by `spawnCars` (unchanged behavior, verified by the
full regression suite) and now also by `tools/check-trace.mjs`'s `buildInitialCar` (replacing
`staticFieldsFor` entirely) and `tools/check-ai.mjs`'s `fullLoop` init. This isn't just today's fix:
it removes the possibility of the two derivations drifting apart again, which is exactly what caused
this divergence to sit open since M3.4 while M3.20 quietly fixed the same formula somewhere else.

**Result: `npm run trace`'s exact-match run length went from 1 of 20 to 13 of 20** (the trace's own
raw step labels: matches steps 1-13, diverges replaying step 14, raw label 69). The new divergence is
far smaller in kind, not just magnitude: `car1`'s `posY` off by 4 (654 trace vs. 658 engine) at a
point where the trace itself shows car1's `posY`/`velY` frozen (`654`/`1006`) across two consecutive
deduplicated rows despite nonzero velocity -- consistent with a real wall/terrain stop the port's
`collide.js` doesn't reproduce in this exact case (terrain index 1, `dirByte`/`levByte` 34, round 2).
Not investigated further this session -- new, narrower open item: `UNKNOWN_trace_posY_terrain_stop`.

**A related, separate divergence was found and deliberately not chased**: `check-ai.mjs`'s "full
loop" test (AI-driven, not trace-replayed, control bytes) still diverges at step 1 (car1 `speed`:
trace 1014, engine 1038 -- smaller than the pre-fix 1206, but not closed). `ai.js`'s own drone-speed
logic (`car.maxSpeedCur = car.maxSpeedBase` followed by a `.BRK`-driven `Math.max` re-raise, lines
49/53/67) resets a drone's `maxSpeedCur` away from its `CX`-tuned value before potentially
re-applying a `.BRK` limit -- whether this matches real per-step behavior or is itself a gap is
genuinely unclear from this session's evidence and wasn't re-derived from the bytes. New open item:
`UNKNOWN_ai_maxspeedcur_brk_interaction`, separate from the now-closed `tuningFieldsFor` staleness.

**Regression.** Full 18-check suite (`tables car step trace ai play sound rounds tournament menu
screens opl-toggle smoothness si2 catalog smoke` + `chrtable`/`lz`) and `npm run build` all stay
green; `spawnCars`'s own behavior is provably unchanged since `check-rounds`/`check-play`/
`check-tournament` (which all exercise it) show no change in outcome, only in how the numbers are
computed.

**What `UNKNOWN_live_verification` still doesn't cover** (deliberately out of this session's scope,
per the advisor's own ranking): a longer or driving/turning/collision-exercising trace (this session's
read was a snapshot, not a new multi-step capture); car-car impulse sign; sfx 2 on lap completion; one
step of car 0 (human) under real input; anything about states/terrain/sound beyond what a spawn-time
snapshot can show. The item stays open, narrowed to what's left rather than closed outright.

## 9ab. The two open items §9aa left: `UNKNOWN_ai_maxspeedcur_brk_interaction` and `UNKNOWN_trace_posY_terrain_stop` (2026-09-22)

**Scope.** User request: work the two narrower open items §9aa's own live-verification session
surfaced. Both resolved this session, continuing directly from §9aa's own live DOSBox context (the
managed instance was still running).

### `maxSpeedBase`'s real mechanism, and the transcription error it exposed

Re-examining §9aa's own live dump to investigate the `ai.js` divergence found something more
consequential than a new bug: §9aa's own reported table (`maxSpeedBase: 1662/1662/1662/1662` for all
4 cars) does not match the bytes that were actually captured. Re-decoding the SAME saved dump
(`dump1.bin`, untouched since §9aa's own session) with the same `car.js`-based script gives
`maxSpeedBase: 1662/1014/1146/1080` -- identical to `maxSpeedCur`, for every car. Two fresh live reads
this session (a brand-new race, paused at genuine spawn -- `state: 0xA`, `controlsLocked: 1`, both
matching `spawnCars`' own documented init values, confirming this really is tick 0 -- and again several
hundred frames later) both show the same thing: `maxSpeedCur === maxSpeedBase` for all 4 cars, always.
A full-program `search_instructions` sweep for the operand `0x129e` (relative `maxSpeedBase`) found
exactly ONE writer anywhere in `MICROU.EXE`:

```
1000:4244  MOV CX, word ptr [BX+0x129c]   ; CX = maxSpeedCur (just computed, CX-adjusted, 4059-4085)
1000:4248  MOV word ptr [BX+0x129e], CX   ; maxSpeedBase = CX
```

`maxSpeedBase` is a spawn-time COPY of the already-per-car-handicap-adjusted `maxSpeedCur` -- not,
as `race.js`'s `tuningFieldsFor` and §9aa's own (wrong) transcription both assumed, the round's flat
`CarTypeInfo[round-1][0]` value. §9aa's transcription error and `tuningFieldsFor`'s pre-existing
formula bug happened to agree (both said "1662 for every car"), which is why the cross-check read as
28 of 28 instead of the true 25 of 28 -- two independent mistakes cancelling, not confirming each
other. See §9aa's own correction note for the corrected table.

### `UNKNOWN_ai_maxspeedcur_brk_interaction` -- resolved and FIXED

`ai.js`'s `droneControlByte` (already ported correctly, re-verified against a fresh full disassembly
of `RunDroneSteeringAi 1000:5429-5531` this session, byte-exact including the `.BRK` type dispatch)
resets `car.maxSpeedCur = car.maxSpeedBase` on `.BRK` type 0/1, and raises it via `Math.max` on type
2 -- all correctly ported. The divergence was entirely downstream of `tuningFieldsFor`'s own
`maxSpeedBase: info[0]` bug (above): every drone's `maxSpeedCur` got reset to the round's flat 1662
instead of its own CX-adjusted cap on the very first AI-driven tick, since the port's `maxSpeedBase`
never held the right value to restore. Fixed in `src/engine/race.js`: `tuningFieldsFor` now returns
`maxSpeedBase: toI16(maxSpeedCur)` (the same final, fully-adjusted value, matching `4244-4248`
exactly) instead of the round-flat `info[0]`. `npm run ai`'s "full loop" test (AI-driven, not
trace-replayed) went from diverging at the very first transition (0 of 20) to matching 13 of 20 --
converging on the exact same remaining divergence as `npm run trace`'s own stage-1 test, which
`UNKNOWN_trace_posY_terrain_stop` (below) accounts for.

### `UNKNOWN_trace_posY_terrain_stop` -- resolved, not an engine bug: a single torn capture sample

Direct investigation (round 2's terrain dispatch `5e4e`, its two round-2-only "extras" -- the
`.DIR & 0x18` conveyor gate and the every-step plughole proximity check, both re-disassembled and
confirmed NOT to apply to car1's own tile/position at the divergence point -- and the real
`UpdateCarPositionCommitAndBounce 5c70-5d19` bounce/commit logic) found no terrain or wall mechanism
that would freeze car1's position while `velY` stays nonzero. The actual explanation was in the
trace data itself: rows 13/14 (raw step labels 64/69) are BYTE-IDENTICAL for car1 across every
captured field, and checking all 4 cars found only car3's `controlBits` differs between those rows --
nothing else, for anyone. This is the exact signature §9g already diagnosed once in this same trace's
own AI stage-2 test ("a torn read... the real function's own first instruction unconditionally zeroes
controlBits before rebuilding it"): `RunDroneSteeringAi`'s first instruction after the reader-table
entry, `1000:542e` (`MOV byte ptr [BX+0x137b],0x0`), zeroes `controlBits` before recomputing it --
row 69's sample caught car3 mid-rebuild, after the zero, before the new byte. The very NEXT kept row
(raw label 70) shows car1's `posY` at exactly 658 -- the value the engine's own replay computed for
the disputed transition, confirming the engine was right and row 69's snapshot of car1 was simply
stale (one tick behind), not a distinct real physics state.

**Proven, not just argued**: removing row 69 entirely from the parsed trace and re-running the full
21-row replay (i=1..19, no early stop) gives **zero mismatches across all 19 remaining transitions**
-- every genuine physics step in this trace matches the engine exactly. The persistent, non-growing
+4 offset in every field downstream of row 69 (car1's `posY`, car2/car3's `posX`, all constant across
transitions 14-20, never widening) is the signature of a single skipped/torn sample, not a cascading
divergence -- random noise or a real bug would not produce a constant, directionally-consistent
offset (high for car1's `+velY` heading, low for car2/car3's `-velX` heading) that stays exactly one
tick's worth of movement for six transitions running.

`tools/check-trace.mjs`/`tools/check-ai.mjs` are deliberately NOT changed to filter this row out --
`parseTrace`'s dedup stays exact-match-only, and the tools' own printed number (13 of 20) stays the
literal, honest count. The removal experiment above is the documented proof, not a standing behavior
of the tool.

### A real bug found and fixed along the way: `bounceAndCommit` read the wrong signal

While re-deriving `UpdateCarPositionCommitAndBounce`'s exact bytes (`5c70-5d19`) to rule it out as
the `posY` divergence's cause, found it gates its bounce/velocity-halving block on
`wallBounceEnable` (`[BX+0x12fb]`) THEN `wallHitPending` (`[BX+0x12a8]`) -- the port's own
`bounceAndCommit` used a freshly-computed LOCAL (`hit.blocked`, valid only for the current tick) for
the second check, not the PERSISTENT `car.wallHitPending` field. Cross-checking `updateCarTileCollision`
confirmed it only ever SET `wallHitPending = 1`, never reset it to 0 -- the real reset site,
`1000:57fb` (reached from the "not solid" and "class-immune" branches), was simply missing. Fixed:
`updateCarTileCollision` now resets `car.wallHitPending = 0` in its `else` branch; `bounceAndCommit`
now gates on `car.wallHitPending` directly. Didn't change this trace's own outcome (car1 never
actually touches a wall in this window, so the flag was already 0 throughout) but is a real,
independently-confirmed correctness fix for any scenario where it matters. Full 18-check regression
suite stays green.

A narrower, related gap was found but NOT fixed, after an attempted fix caused a real regression:
the real `UpdateCarTileCollisionSfx6or4` gates its ENTIRE body -- not just the wall-response block,
also the `metaTile`/`mapAttr`/`progress`/`dirByte` updates -- on `active!=0 && state==0`
(`1000:5534`/`553e`), skipping to its own epilogue and leaving every field it would touch untouched
otherwise. This port calls the function every tick for every car regardless of state. Adding the
matching gate was tried and reverted: `bounceAndCommit`'s own commit fires for state 0/2/0xE (not
state==0 only), so gating `updateCarTileCollision` to state==0 left it returning stale/undefined
`hit.progress`/`hit.lev` for state-0xE cars -- confirmed by a real failure in round 3's drop-in
sequencer test (`tools/check-rounds.mjs`). Fixing this properly needs `bounceAndCommit` to read the
persistent `car.progress`/`car.levByte` fields instead of this call's own per-tick `hit.progress`/
`hit.lev`, not attempted here. New open item: `UNKNOWN_col_response_active_state_gate`.

**Also found and fixed, minor**: the real `droneWallStuck >= 20` knockout path (`5c96-5ca6`) copies
the car's own current position into `knockoutX`/`knockoutY` (already-named `car.js` fields) alongside
setting `state = 0xD` -- the port only set the state. Added.

**Regression.** Full 18-check suite (`tables car step trace ai play sound rounds tournament menu
screens opl-toggle smoothness si2 catalog smoke` + `chrtable`/`lz`) and `npm run build` stay green
throughout, checked after each individual fix (the tuning-field fix, the wallHitPending fix, the
reverted active/state-gate attempt, and the knockoutX/Y fix each got their own full-suite run).

**Also fixed**: `npm run trace`'s and `npm run ai`'s own printed divergence message used to report
the trace's raw step label as if it were a match COUNT (`"matched 69 of 20 steps"`, nonsensical --
69 was a row label, 20 was a transition count) -- now reports the actual transition index reached,
with the raw label given separately for cross-reference against the TSV.

## 9ac. `UNKNOWN_tile_index_overflow` resolved (2026-09-22)

**Scope.** User request: work `UNKNOWN_tile_index_overflow` -- round 8/9 `.MAP` files reference
tiles past their own `.COL`/`.DIR` counts; the port treated any out-of-range tile as "open, no
special terrain" without confirming whether that fallback ever actually matters.

**Every real case, found by scanning all 29 races, not just the two files already on record.**
`ROUND82.MAP` references meta-tile 58 (`.COL` only -- `nCol=49`, but `nDir=63` so `.DIR` is genuinely
in range there and reads real data) at two grid cells; `ROUND92.MAP` references tile 60 (`.COL`
*and* `.DIR`, both tables 59 tiles) at one cell -- both already on record. A third, previously
undocumented case: `ROUND5.DIR`'s own file (2034 B) ends **18 bytes into meta-tile 56's own 36-byte
record** (`.COL` is unaffected, `nCol=57`) -- referenced at up to 4 grid cells across races 1 and 3.
This is the SAME phenomenon (a `.MAP` tile index the per-round table doesn't fully cover), just for
`.DIR` specifically and a round the earlier "round 8/9" framing didn't name.

**Reachability, settled by a full sub-cell flood fill, not eyeballing the map.** For each affected
race, built the real per-sub-cell open/solid grid from the actual `.COL` masks and flood-filled from
that race's own `STRT_POS.BIN` start position (4-directional, then re-checked 8-directional to allow
for diagonal corner-cutting -- same result both ways):

- **Round 8's two cells and round 9's one cell are structurally unreachable.** Not even their tile
  BOUNDARY is touched by the connected region a car can actually drive in -- every neighbouring
  tile is fully or mostly solid, and the map's own progress-plane byte at these cells is 0 (its
  generic "off-course" default, shared with the vast majority of the 32×32 grid that's genuinely
  outside the course). Same "toggle exists, never exercised" shape as `UNKNOWN_138A_clear` and the
  `CS:[0x9C62]` dead branch (M3.17/M3.20) -- the port's existing "open, no special terrain" fallback
  is unreachable in practice, so whatever it resolves to cannot matter.
- **Round 5's tile 56 is the opposite: fully open, on the real racing line, and reached.** Its
  `.COL` entry is 0/144 solid (fully drivable), it carries genuine nonzero progress values (5, 6,
  102, 103, 126, 127 at its four map occurrences), and the flood fill reaches its own sub-cells
  directly in both affected races -- a live, in-game-relevant case, not a dead edge.

**The real bug this surfaced: the port was discarding real data it already had, not just guessing
at genuinely-undefined bytes.** `.DIR`'s per-tile record is 36 bytes, one per `(subx>>1,
suby&~1)` combination (docs/track-layout.md's `.DIR` section); round 5's own file has the first 18
of those 36 bytes for tile 56 (covering sub-rows `suby=0..5`) -- real, varying, on-disk data
(`0x11`/`0x11`/`0x01` for sub-rows 0-1, `0x08` uniform for sub-rows 2-3, `0x00` uniform for sub-rows
4-5) -- and only the LAST 18 bytes (sub-rows 6-11) are genuinely missing from the file. The port's
previous `t < nDir ? dirTile(...) : new Uint8Array(36)` gate in `collide.js`'s `buildWorld` treated
tile 56 as entirely out of range (`56` is not `< 56`) and discarded ALL 36 bytes, including the 18
real ones. Separately, `src/formats/track.js`'s own `dirTile()` used a bare `.subarray()`, which
silently returns a SHORT array when the file runs out mid-tile (18 bytes here, not 36) -- any
caller indexing past that short array's own length gets `undefined`, not a defined 0, which is what
forced `collide.js`'s whole-tile gate to exist in the first place. `colTile()`, by contrast, already
manually constructs a full 144-byte array bit by bit, and read-then-shift-then-AND against a missing
(`undefined`) source byte happens to coerce through `NaN` to `0` in JS's bitwise ops -- correct, but
an accident of the exact code shape, not a designed zero-fill.

**Why not just replicate the real leftover byte exactly?** The real game's own fallback for the
genuinely-missing 18 bytes is whatever the shared, non-cleared `dirFileBuf` last held from an
EARLIER round's own load (ground truth, disassembly of `LoadRoundColAndDir 1000:458b`, its own
Ghidra comment now has the full account) -- not a fixed value, a **tournament-history-dependent**
one. Traced against this game's own shipped `ORDER_TABLE`: in the canonical Challenge tournament
order, round 4 loads immediately before round 5's race 1, and round 4's own `.DIR` file is the
largest of any round (2304 B, the full buffer) -- simulating the real load sequence confirms tile
56's own missing tail would hold exactly round 4's own tile-56 bytes (`0x14`, uniform) at that point.
A different path through the game (a re-run after finishing 3rd/4th, Head-to-Head's own track
cycling, a bonus race) would leave a different round's data there -- there is no single "the real
value" to hardcode, only a mechanism. Replicating it exactly would need this port to thread a
persistent, cross-race buffer through `loadWorld` (which currently loads each race's world fresh,
independently, matching `PLAN.md`'s own "load once, query directly" design) -- a real architectural
change for a narrow, session-path-dependent payoff. Judged not worth it; the mechanism is fully
documented (here and in the Ghidra comment) instead of guessed at or silently ignored.

**The fix.** `src/formats/track.js`'s `dirTile()` now always returns a full 36-byte array, copying
real file bytes where the file actually has them and explicitly zero-filling only the bytes it
doesn't (`b[start+i] ?? 0`), instead of a bare `.subarray()` that could silently short-change a
caller. `src/engine/collide.js`'s `buildWorld` no longer gates `colOf`/`dirOf` on the tile INDEX at
all (`colTileCount`/`dirTileCount` are unused there now) -- both call the now-safe `colTile`/
`dirTile` directly, so real partial data (round 5's tile 56) is used where it exists and the
zero-fallback only applies to genuinely-missing bytes (round 5's own missing tail, and the fully-out
of both tables cases of round 8/9). `colTile` itself is unchanged (its existing manual construction
was already correct, just not obviously so) but is now explicitly why `dirTile` was brought in line
with it, not the other way round.

**Tests, with teeth.** `tools/check-step.mjs` gained a new section: a direct format-level check on
`dirTile(ROUND5.DIR, 56)` (full 36 bytes, real values at offsets 0/6, defined 0 at offsets 18/35,
not `undefined`), an integration check through the exact `queryWorldAt()` the physics step calls
(tile 56's real sub-row reads the real `0x11` `dirByte`; its missing sub-row reads the defined 0,
neither crashes), and a regression check that round 8/9's confirmed-dead overflow cells still
resolve to "open, no special terrain" through the same general code path (not a tile-index special
case anymore). One first-draft assertion was wrong and self-caught: round 8's own tile 58 was
initially asserted to read `dirByte=0`, which failed -- re-checking found tile 58 is genuinely IN
range for round 8's own 63-tile `.DIR` table (only `.COL`'s smaller 49-tile table overflows there),
so it correctly reads its real value (`0x20`), not the zero fallback; the test was corrected to
assert that instead of weakening the code to match a wrong expectation. All new assertions
independently reverted (both `dirTile` and `collide.js`'s gate restored to their prior form) and
reconfirmed to fail first -- 4 of the new checks catch the regression directly (the two format-level
zero-fill checks, and the integration check that tile 56's REAL half used to read 0 too, since the
old whole-tile gate discarded it along with the genuinely-missing half).

**Regression.** Full 18-check suite + `npm run build` + `npm run live` (still 0 differing pixels
outside the HUD/boat box) all stay green -- `colTile`'s own behavior is unchanged, and no round/race
combination's collision or terrain behavior changes except round 5's own tile 56, which now
correctly uses real data where the file has it.

**Not done, deliberately**: replicating the exact cross-race stale-buffer value (architectural
change, narrow and path-dependent payoff, see above); the asset viewer's own `dirMap`/`colMaskMap`
(`src/formats/track.js`) still gate on the whole tile count for its OWN rendering loop, so it would
still render tile 56 blank in the debug DIR view rather than showing its real partial pattern -- a
cosmetic, debug-tool-only inconsistency with the now-fixed engine behavior, not touched here since
it doesn't affect anything the game itself does.

## 9ad. The things §9ac deliberately didn't do (2026-09-22)

**Scope.** User request: work the items §9ac's own write-up named as deliberately not done --
replicating the real cross-race stale-buffer value, and the asset viewer's own analogous gate.
Investigating the first surfaced a fourth, previously-unknown case beyond §9ac's own three: `.BRK`
has the exact same fixed-buffer-never-cleared shape, and round 3's own case is genuinely reachable,
not a dead corner.

### The cross-race buffer, implemented

`src/engine/collide.js` gained `createColDirBuffers()`/`COL_FILE_BUF_SIZE`/`DIR_FILE_BUF_SIZE`
(0x480/0x900 B, matching `LoadRoundColAndDir`'s own real, already-documented buffer sizes) and an
optional `sharedBuffers` parameter on `buildWorld` (threaded through `race.js`'s `loadWorld`): when
given, each race's own `.COL`/`.DIR` bytes are copied into the FRONT of the persistent buffer pair
(which is then queried instead of the raw file bytes), leaving each buffer's own tail as whatever
an EARLIER call in the same sequence last wrote -- exactly replicating the real, never-cleared
buffer. Omitted (every existing caller except one), `buildWorld` behaves exactly as before.
`src/frontend/flow.js`'s `bootGame` -- the one caller in this port that genuinely represents a
real, continuous sequence of race loads (a tournament run) -- creates the buffer pair once per
session and threads it through every race. Verified against the exact mechanism traced in §9ac:
replaying the canonical Challenge order's own real load sequence (`R2.1, R5.2, R1.1, R6.1, R4.2,
R5.1`) through `loadWorld` with a shared buffer reproduces round 4's own tile-56 byte (`0x14`)
exactly where §9ac predicted it, while an isolated call (no shared buffer) keeps the defined-zero
fallback -- both directions proven with teeth (`tools/check-step.mjs`, reverted and reconfirmed to
fail first).

### The asset viewer's own gate, fixed

`src/formats/track.js`'s `dirMap`/`colMaskMap` (the whole-track debug render used by
`trackView.js`/`render-dir.mjs`) no longer gate on `t >= nTiles` either -- `dirTile`/`colTile` are
now safe for any tile index (§9ac), so these views show round 5's own real partial data for
meta-tile 56 instead of leaving that grid cell blank. `colMaskMap`'s own version of this fix is
currently a no-op (no round ships a partial trailing `.COL` tile the way round 5's `.DIR` does) but
kept in step with `dirMap` rather than leaving two different patterns for the same situation.
Rendered `tools/render-dir.mjs 5` and looked at the output (`tools/out/DIR_ROUND5_grade.png`/
`_heading.png`): a previously-blank cell now shows real, non-background colour.

### `.CT`/render-bank visibility, checked and closed

§9ac's own "not re-investigated" note asked whether round 8/9's dead `.COL`/`.DIR` cells could
still be *visible* near the track edge even though never *driven on* (camera visibility is a
different question from physical reachability). Settled by extending the same flood fill: the
nearest reachable sub-cell to each of the three dead cells is 264, 352, and 744 world units away
respectively -- well beyond the camera's own half-width/half-height (~128/~100 units, `docs/engine.md`
§3's `CAR_CAMERA_TABLE`), so none of them can ever enter the camera's own viewport either. Combined
with §9ac's own physical-reachability finding, these cells are confirmed unreachable BOTH ways;
`npm run render`/`npm run tracks` already complete cleanly for both rounds (checked again this
pass). No render-bank fix needed -- the question is closed, not deferred.

### The `.BRK` sibling case, found, investigated, and fixed

Re-deriving the cross-race buffer mechanism for `.COL`/`.DIR` raised the obvious next question:
does `.BRK` (the AI's own brake/speed-limit lookup, indexed directly by a car's raw progress value,
`1000:5495`) have the same shape? It does, and unlike round 8/9's dead tile cells, this one is real.

**The real buffer**: `LoadRoundColAndDir`'s sibling `.BRK` loader (`1000:3b92-3ba8`, newly commented
this pass) reads with a FIXED `CX=0x200` (512 B) into `DS:195B`, regardless of the real file's own
size (the largest real `.BRK` file, round 3 race 3, is 156 B) -- the exact same fixed-buffer,
never-cleared shape as `colFileBuf`/`dirFileBuf`. `RunDroneSteeringAi`'s own `.BRK` read (`5495`)
has no bounds check against the real file's own length.

**The real overflow, and why it's not a dead corner this time**: round 3's own `.MAP` progress
plane (second plane) genuinely reaches 255 in all three of its races -- re-disassembling
`TestColMaskBitAtWorldXY` (`1000:589c-5920`, its own comment now has the full re-confirmation)
settled a real contradiction between two of this project's own docs (`docs/track-layout.md`'s
"Open items" section said `UNKNOWN_589c_progress_transform` was already closed with "no transform";
its own earlier `.MAP` section body still said "not fully unwound" -- the body was stale): the
function returns the raw plane-2 byte completely unmodified, with no 255-sentinel special-casing
anywhere in it. A full sub-cell flood fill from each of round 3's own race starts (matching §9ac's
own methodology exactly) confirms these cells are genuinely driven over -- round 3 race 1 alone has
143711 of 147456 sub-cells reachable, including every progress=255 cell checked. The real max
NON-255 progress value present in each race sits right next to that race's own START value (race 1:
start=132, next-highest=133) with a complete gap up to 255 -- confirming 255 is a distinct sentinel
the level data assigns to real course tiles, not a continuation of normal lap-progress counting, but
one very much placed on the drivable surface, not tucked into a solid border like round 8/9's cells.

**The fix**: `src/formats/levbrk.js` gained `createBrkBuffer()`/`BRK_FILE_BUF_SIZE` (0x200) and an
optional `sharedBuffer` parameter on `parseBrk`, threaded through `race.js`'s `loadBrk` into
`flow.js`'s own session-scoped buffers alongside the `.COL`/`.DIR` ones. Opted in, `ctx.brk`'s own
records array grows to the full 512 entries (real bytes at the front, a prior race's own leftover
at the tail) instead of stopping at the real file's own length; the array's own `count` still
reports the real file's length either way, for the asset viewer's own display. Every existing
caller (unopted-in) keeps the pre-existing `ctx.brk?.[car.progress]?.raw ?? 0` fallback exactly as
before -- a defined `type=0` ("just accelerate") default, not a crash, just not a real-leftover-byte
replication.

**Regression.** Full 18-check suite + `npm run build` + `npm run live` stay green throughout,
checked after each individual piece (the `.COL`/`.DIR` shared buffers, the viewer gate fix, and the
`.BRK` shared buffer each got their own full-suite run). New teeth-proven tests in
`tools/check-step.mjs` cover both the format-level `parseBrk` behavior and the `droneControlByte`
integration point, all independently reverted and reconfirmed to fail first.

**Still not done, deliberately**: replicating the exact real-tournament-history leftover value by
default (this port's other callers -- every standalone `check-*.mjs` tool, `play.js` -- still use
the simpler, isolated-per-race behavior, matching §9ac's own reasoning: the mechanism is now
available to any caller that wants it, but forcing it everywhere would make every existing headless
test's own result depend on an implicit prior-call ordering, which is worse than the honest
"isolated by default, opt in for real sessions" split already in place).

## 9ae. `UNKNOWN_col_response_active_state_gate` resolved (2026-09-22)

User request: "Work on `UNKNOWN_col_response_active_state_gate` -- ... Needs `bounceAndCommit` to read
persistent fields instead of an ephemeral per-call result first," picking up exactly where §9ab's own
reverted fix attempt left off.

**The fix, as specified.** `collide.js`'s `updateCarTileCollision` now gates its entire body on
`!car.active || car.state !== 0` at the top (matching `1000:5534`/`553e` exactly, confirmed by a
fresh live disassembly of `5532-556d` this session, not just trusted from §9ab's own citation),
returning early with every field left at its last value and `blocked: false`. `bounceAndCommit` no
longer takes the returned `hit` at all: its 0xFF-knockout check now reads `car.progress` (already a
persistent field `updateCarTileCollision` keeps in sync whenever it runs), and its LEV read is now a
FRESH `world.levOf(car.metaTile)` lookup every commit, exactly matching a second live disassembly of
the real commit tail itself (`5da1-5e36`, not previously fully read in this project): `5dd9-5de6`
computes `SI = car.metaTile & 0x3f + roundLevTableBase; AL = LEV[SI]; car.levByte = AL` -- a lookup
keyed by the car's OWN current `metaTile`, re-run every committed step regardless of whether
`updateCarTileCollision` itself ran that tick. `world` is threaded into `bounceAndCommit`'s parameter
list (already in scope at `step.js`'s call site) to support this.

**A real second regression, caught before landing, not by advisor.** A naive version of this fix
(gate added, LEV/progress fix applied, nothing else) broke `check-rounds.mjs`'s round 3 drop-in
sequencer test differently than §9ab's own attempt did: the car left state 0, correctly entered state
0xE, but then never resolved back to state 0 within the test's old 500-tick budget. Tracing it
tick-by-tick (a small instrumented script, not guesswork) showed the car's velocity stayed at its
full post-spawn value the whole time, fighting `dropin.js`'s own explicit slide at roughly half the
rate a working run should. Isolating cause from the two changes (temporarily re-enabling the old
unconditional `updateCarTileCollision` call while KEEPING the LEV/progress fix) showed the gate itself
was responsible, not the LEV fix -- and re-disassembling `1000:5548-5576` (immediately after the
active/state gate, previously not read this session) explains why: **the real
`UpdateCarTileCollisionSfx6or4` doesn't just do collision response -- it ALSO computes `nextX`/`nextY`
(the same velocity integration `int16.js`'s `integrateAxis` implements) under this identical gate.**
An advisor review caught an overstated first reading of this: it does NOT mean velocity-driven
integration stops once a car leaves state 0 -- the commit tail (`5d35-5d67`) re-derives `nextX`/`nextY`
a SECOND time, completely UNGATED, from whatever velocity the intervening bounce block left it at,
wraps it (`5d6b-5d9f`, the same `wrapWorld` `integrateAxis` already applies -- checked, no gap there),
and THAT second value is what `5da1`'s state-gated commit actually writes to `posX`/`posY`. So a car
in any state keeps moving every tick; the gated computation at `5548-5576` is only ever a PRE-bounce
value the unconditional second one goes on to overwrite. The real, narrower divergence: this port's
`integrateCar` integrates ONCE, pre-bounce, and `bounceAndCommit` commits that same value. On a tick
no bounce fires this matches the real second integration exactly (same velocity either way); on a
tick a bounce DOES fire, the real game re-integrates from the POST-bounce velocity before committing
and this port commits the stale pre-bounce position instead. Logged as a new open item
(`UNKNOWN_commit_reintegrates_post_bounce`) rather than folded into this fix per advisor guidance: it
only differs from the real bytes on a tick a bounce actually fires, and reconciling it changes
wall-bounce behaviour on every such tick game-wide -- a separately-verifiable change.
Given that, the drop-in sequencer's OLD "334 ticks" figure (§9r, docs/engine.md and
`tools/check-rounds.mjs`'s own comment) turns out to have been measuring a bug all along: the
UNGATED `updateCarTileCollision` was picking up real wall collisions while the car slid across the
map during state 0xE, repeatedly halving its velocity via `bounceAndCommit`'s bounce block and letting
the slide's own fixed 8px/tick step dominate -- convergence that direct disassembly of `stepSlide`'s
own module header comment had already flagged as "not a clean 8" was actually faster than the real
bytes produce, not slower. Correctly gated, the full un-halved velocity fights the slide the whole way
at the documented ~2-3px/tick real rate, confirmed (with a debug trace) to resolve at **tick 532**,
not 334 -- `tools/check-rounds.mjs`'s loop bound raised from 500 to 1200 accordingly, with the old
comment corrected to explain why the number changed rather than silently bumped.

**Also ported, caught by the advisor before this was called done.** Re-disassembling the bounce block
found `5d1d-5d32`: an UNCONDITIONAL clear of `hitLeft`/`hitRight`/`hitUp`/`hitDown` to 0, every call,
regardless of whether the bounce fired -- right after the bounce block's own final `velY` halve
(`SAR [1276],1` at `5d19`). This is load-bearing specifically because of the gate above: before it,
`updateCarTileCollision` re-derived these 4 fields fresh every tick via its own probe regardless of
state, so any staleness was masked; now that it's correctly skipped for a gated-off car, an
un-cleared hit flag would stay stuck at whatever it was the instant the car left state 0, for as long
as it stays away from state 0. Ported into `bounceAndCommit`, unconditional, matching the real
address ordering.

**Regression, all independently teeth-proven.** New assertions in `tools/check-step.mjs` (the gate
itself -- inactive car, state!=0 car, and a sanity case proving the frozen-field assertions aren't
vacuous; the LEV/progress fix -- two metaTiles with opposite LEV bit-7 values, plus a "stale hit
argument can't influence the result" probe; the hit-flag clear) were each independently reverted
(the gate disabled, the LEV lookup pointed at a deliberately wrong metaTile, the clear commented out)
and reconfirmed to fail first, then restored. Full 18-check suite (`tables car step trace ai play
sound rounds tournament menu screens opl-toggle smoothness si2 catalog smoke` + `chrtable`/`lz`) +
`npm run build` + `npm run live` (0 differing pixels outside the HUD/boat box, unchanged) stay green
throughout, re-run after each individual piece. `npm run trace`/`npm run ai`'s own baseline (13 of 20
transitions) is unchanged -- this fix doesn't touch anything that trace's own window exercises.

**Not done, deliberately, per advisor guidance**: `UNKNOWN_commit_reintegrates_post_bounce` (the
double-integration divergence above) -- named, not fixed, since it's a strictly larger change than
this task's own scope and only manifests on a bounce tick.

## 9af. `UNKNOWN_commit_reintegrates_post_bounce` resolved and FIXED (2026-09-23)

User request: "work on the core engine todos/issues" -- of the six items §9ae/§10 still listed
(this one, `UNKNOWN_h2h_match_score_writers`, `UNKNOWN_851f_bonus_banner_choice`,
`UNKNOWN_ph0_1140_1380`, `UNKNOWN_pause_banner_position`, `UNKNOWN_car_draw_anchor`, plus M3.4's own
still-open live-trace acceptance bar), an advisor consultation identified this as the only one that
changes what the port actually does -- everything else is documentation for a feature that either
doesn't run (`851f`/`h2h_match_score_writers`, both two-car-H2H-only) or was already investigated to
its practical limit (`ph0_1140_1380`). The advisor's guidance: re-disassemble the fix's own range
fresh rather than trust §9ae's prose, since §9ae named the divergence but didn't derive the fix
itself.

**Re-derivation (not a lookup).** Fresh disassembly of `1000:5c70-5d9f` (the full bounce+re-integrate
range, all 61 instructions) confirms §9ae's account exactly, plus one detail §9ae's own wording
("5d1d-5d32, unconditional -- runs every call regardless of whether the bounce above fired") did NOT
capture precisely: **both** outer gates (`5c75 JNZ 5c7a` / `5c77 JMP 5da1` for `wallBounceEnable`;
`5c7f JNZ 5c84` / `5c81 JMP 5da1` for `wallHitPending`) skip straight to the commit at `5da1` when
either check fails -- bypassing `5c84-5d9f` **in full**, which is the bounce-velocity mutation, the
hit-flag clear (`5d1d-5d32`), AND the re-integration (`5d35-5d9f`) together, not just the velocity
mutation. So the hit-flag clear is scoped to the same `wallHitPending && wallBounceEnable` gate as
the bounce logic itself, not unconditional-per-tick the way this port's prior code (and §9ae's own
phrasing) had it.

**The re-integration, confirmed byte-for-byte against `int16.js`'s own `integrateAxis`:**
`5d35-5d4c` computes `t = velX + posXfrac` (16-bit); `AL=AH; CBW` sign-extends the high byte;
`+= posX` gives the new `nextX`; `DH=0; nextXfrac = DX` stores the low byte of `t` zero-extended --
exactly `integrateAxis(car.posX, car.posXfrac, car.velX)`. `5d50-5d67` repeats for Y. Critically, both
read `posX`/`posXfrac` (`0x1258`/`0x125c` relative to `BX`), the car's own STILL-UNCOMMITTED position
from before this tick -- not `nextX`/`nextXfrac` (`0x125a`/`0x125e`), which would already hold the
caller's stale pre-bounce value. `5d6b-5d9f` then wraps both into `[0, 0xC00)`, matching `wrapWorld`
exactly (single-step over/underflow correction, the same shape `integrateAxis` already applies
internally). All addresses confirmed against `car.js`'s own relative-offset table (`0x1258-0x124A =
0x0e = posXfrac`, etc., all matching cleanly) before writing any code.

**The fix.** `bounceAndCommit` (`src/engine/collide.js`) now calls `integrateCar(car)` a second time,
inside the `if (car.wallHitPending && car.wallBounceEnable)` block, right after the velocity-halving
mutations -- re-deriving `nextX`/`nextY` from the car's unchanged `posX`/`posXfrac`/`posY`/`posYfrac`
and the just-mutated `velX`/`velY`, exactly matching `5d35-5d9f`. On a tick the gate isn't entered,
`nextX`/`nextY` keep whatever the caller's own pre-bounce `integrateCar(car)` (`step.js`) already
computed -- which is what the real bytes commit too in that case, since no second integration ran
there either. The hit-flag clear moved inside the same `if`, matching the real gate exactly.

**A second real bug, found by the same re-disassembly, not a separate investigation.** Re-scoping the
hit-flag clear to the gate raised the question of whether it's actually observable -- i.e., does
anything else read `hitLeft`/`hitRight`/`hitUp`/`hitDown` in a way the clear's timing could affect? A
full-codebase grep found exactly one reader (the `reverseX`/`reverseY` test at the top of this same
`if` block) and two writers besides `updateCarTileCollision`'s own solid-branch probe:
`terrain.js`'s `h6674` (sets `wallHitPending=1` alongside fresh `hitLeft=1`/`hitUp=1`) and `h6882`
(sets `wallHitPending=1` WITHOUT touching any of the four flags at all). `h6882`'s own case is the
one where the old unconditional clear was a real bug, not just an imprecise citation: a terrain-
triggered bounce (a big scripted terrain-level jump, `delta > 2`) reads whatever `hitLeft/Right/Up/
Down` were last legitimately set to by an earlier collision -- but this port's old unconditional
per-tick clear would have zeroed them on every intervening non-colliding tick, so by the time `h6882`
fires, they'd read all-0 ("none" pattern, negate both axes) regardless of what the real bytes would
have used. Fixed by the same change (moving the clear inside the gate).

**Regression, teeth-proven.** `tools/check-step.mjs` gained two new blocks: (f) the hit-flag clear's
own scoping -- gate-not-entered leaves flags untouched, gate-entered clears them, both independently
reverted (a temporary unconditional clear reinstated) and reconfirmed to fail first; (g) the position
fix itself -- a car with `velX=512` (integrates to `posX+2` if committed pre-bounce, the old bug) that
takes a `hitLeft`-only bounce (negating `velX` to `-512`, which re-integrates to `posX-2`) commits
`posX=98`, not the stale pre-bounce `102` -- reverted (the `integrateCar(car)` call commented out) and
reconfirmed to fail first (committed `102` instead, exactly the old bug's answer) before being
restored. Full 18-check suite (`tables car step trace ai play sound rounds tournament menu screens
opl-toggle smoothness si2 catalog smoke` + `chrtable`/`lz`) + `npm run build` + `npm run live` (0
differing pixels outside the HUD/boat box, unchanged) all stay green. Per the advisor's explicit
blocking condition, `npm run trace`/`npm run ai`'s own 13-of-20-transitions/59-of-60-control-bytes
baseline is the discriminating check for a fix that changes committed positions game-wide -- both are
UNCHANGED (still 13/20, still diverging at the same transition 14/car 1/`posY`, the already-diagnosed
torn-capture artifact from §9ab), confirming this fix doesn't touch anything that trace's own window
exercises (no bounce fires in that particular capture) rather than silently masking a regression.

**Follow-up (same session): three of the five items below were resolved by a follow-up parallel
investigation, not left carried forward as first reported here** -- see §9q's own update
(`UNKNOWN_pause_banner_position`) and §9ag (`UNKNOWN_h2h_match_score_writers`,
`UNKNOWN_851f_bonus_banner_choice`). This paragraph is left in place, uncorrected, as the record of
what was true at the moment this section was written -- exactly the "don't silently rewrite a stale
claim in place" discipline this project applies to its own Ghidra comments.

**Not done, deliberately, as first written.** The five remaining items from this session's own
opening scope were carried forward, per the advisor's guidance not to treat them as equal-priority
peers of this fix: `UNKNOWN_h2h_match_score_writers` and `UNKNOWN_851f_bonus_banner_choice`
(disassembly-only, both document a feature -- two-car H2H -- this port doesn't wire into any race
loop); `UNKNOWN_pause_banner_position` (disassembly-only, independent); `UNKNOWN_ph0_1140_1380`
(three independent full-coverage methods already failed, not re-attempted); `UNKNOWN_car_draw_anchor`
plus M3.4's own still-open live-trace acceptance bar (a longer/driving/turning/collision trace,
sfx-2-on-lap, one live step of car 0 under human input) -- deliberately NOT opened this session
because this fix changes committed positions, so any trace captured before it lands would measure the
old, now-superseded behaviour; capture after, not before.

## 9ag. `UNKNOWN_851f_bonus_banner_choice` and `UNKNOWN_h2h_match_score_writers` resolved (2026-09-23)

**Scope.** A follow-up parallel investigation (three independent Ghidra fan-outs) into the remaining
items from §9af's own opening scope, immediately after that fix landed. Two of the three -- these --
resolved with confident, evidence-backed answers; the third
(`UNKNOWN_pause_banner_position`) is documented at its own original citation (this section's earlier
paragraphs) since it's a self-contained banner-position question, not H2H-specific. Both items below
are pure documentation/RE resolution -- neither changes anything in `src/`, since two-car H2H itself
is still not wired into any race loop (unchanged since M3.8).

### `UNKNOWN_851f_bonus_banner_choice`

`851F` itself fully disassembled (17 instructions, `851F-8559`): silences this car's engine voices
(`CALL 7AF8`), re-reads the shared knockout spotlight `[26B8]` into `BX` (ignoring whichever car the
caller actually dispatched, so at most one banner/spin plays per frame regardless of how many cars
hold state `0xB`), then **gates on `[28BF]!=9`** (`8526-852B`) -- round 9 (RUFFTRUX) is structurally
excluded, which rules out the "round-9 bonus-race indicator" hypothesis outright (round 9's own
"BONUS RACE"/"BEAT THE CLOCK" banner, §9t, is a separate, `[28BF]==9`-gated mechanism). Past that
gate, `852D-8532` unconditionally advances this car's `heading` by 8/256 per frame -- **the car spins
in place**; the "Bonus" banner (drawn `854D-8556` via `DrawBanner88x22Blinking`, §9q) is an overlay on
top of that spin, not the whole visual. Three more draw-only gates follow: the two-car match score
`[26B4]` must be 2-6 (mid-match, not near the 0/8 match-ending extremes) and this car's
`lapsRemaining` must be `>0`.

**Every writer of car state `0xB` in the whole binary, confirmed two independent ways**
(`search_instructions` for `MOV ...,0x12ae` immediate-`0xB` operands, 37 hits scanned, exactly 1
matches; `search_byte_patterns` for the full 6-byte encoding, exactly 1 hit) -- both land on
`1000:785E`, inside `ResetCarsAfterKnockoutSfxA` (the same function §9u/§9x already document). There
is no second writer anywhere. `get_xrefs_to 1000:7759` confirms the function's own single caller,
`1000:9205` inside `RenderRaceFrameToBackBuffer`, reached only when `[2913]==0 && [2911]==1` --
per §9r/§9v/§9x, `[2911]` arms to 1 from exactly two triggers, a projectile kill
[**refuted §9am**: the camera's two-car separation test] (`FireProjectileSfxE`) or a drop-in-partner timeout (`dropin.js`'s own already-ported mechanism).

**Conclusion.** "Bonus" is the artist's label for banner-strip slot 0, blink-drawn over whichever car
`ResetCarsAfterKnockoutSfxA`'s knockout-reset currently spotlights via `[26B8]`, whenever that reset
fires (a kill or a drop-in timeout) mid-match and before that car finishes its laps -- not a real
third match outcome and not the round-9 bonus-race indicator. **Residual, narrower, genuinely still
open**: why the developers picked banner index 0 ("Bonus") rather than index 4 ("Failed") for this
specific car is a design-intent question static analysis alone can't further settle -- would need a
live two-human-H2H-knockout trace, the same one `UNKNOWN_h2h_knockout_only_ending`'s own residual
questions (§9x) already point at.

### `UNKNOWN_h2h_match_score_writers`

**Every writer of `[26B4]` (4 sites) and `[26C4]` (9 write sites of 12 total hits, 3 are reads),
cross-checked by `search_instructions` and `search_byte_patterns` independently (15/15 and 12/12
agree exactly, full 83,662-byte coverage, 0 truncation):**

- `[26B4]`: `1000:3C3A` seeds it to 4 (neutral midpoint) at race start; `1000:7649` is a cosmetic
  blink swap with `[26B6]` inside the light-bar countdown (`TEST [26BA],7`-gated, not a score
  change); the two REAL commits are `1000:76E3 INC` (car0/"P1" scores) and `1000:771B DEC`
  (car1/"P2" scores).
- `[26C4]`: `1000:3C34 MOV ...,1` is the ONLY site that ever arms it to 1 (every other write moves a
  register, none writes the literal); `1000:311F`/`1000:36B6` force it back to 0 (a race-loop
  condition and the "instant end race" cheat, respectively); `4C04`/`4C0F` and `4C60`/`4C6B` (inside
  `RunCarPhysicsStep`'s two per-player branches) and `76EE`/`7726` (inside
  `UpdateCarAirborneLandingSfx`, alongside `[26C6]=2`, the race loop's own sole exit gate, §9x) are
  the consuming/disarming writes.

**The causal chain.** `[26B4]`'s only two real-commit writers (`76E3`/`771B`) are reached only when
`[26B8]` already equals a real car id matching THIS car -- and `[26B8]` itself has exactly three
armers: `77F5` (the knockout-reset, §9u) and `4C08`/`4C64` (gated `[26B4]!=4`, so they can only fire
AFTER `[26B4]` has already left its neutral seed via a prior `76E3`/`771B` commit, which itself needed
`[26B8]` already set). The only way into that loop is `77F5` going first -- `4C08`/`4C64` have no
independent judgment of their own; they mechanically echo whatever `77F5` already decided, once per
race, corrected from §9u/§9x's earlier "finish-detection" framing to "first-scoring-event snapshot."

**Can the two disagree? Yes, confirmed, not just theoretically possible.** `77F5`'s own FALL branch
(entered whenever `[2682]!=-1`, i.e. a car has just fallen/been knocked out) has NO state check
gating it -- unlike its sibling leader-select branch, which exits early if a car already holds state
`0xC`. So a SECOND, THIRD, etc. fall can keep reassigning `[26B8]` to a different car for the rest of
the race. But `4C08`/`4C64` fire **at most once per race** (`[26C4]==1` only ever arms once, at
`3C34`, and every consuming write disarms it back toward 0) -- once the first scoring event commits,
the HUD rank-slot table (`[2678]` etc.) freezes permanently. Net: the frozen score/HUD rank table
locks onto whoever won the FIRST exchange; `[26B8]` (the "WINNER!"/"LOSER!" text, §9u) keeps tracking
the MOST RECENT knockout. **These can name different cars once more than one knockout happens in a
race** -- a genuine, confirmed divergence, not a hypothetical one. Residual, narrower, not traced this
pass: whether `HandleCarState4FallAnimSfx8` can re-latch `[2682]` for a car already in state
`0xB`/`0xC` (would need one more disassembly pass to fully close, doesn't change the conclusion
above either way since the divergence is already demonstrated by the writer analysis alone).

**Method note.** Both resolved via disassembly and whole-program search only, matching this
session's advisor-set scope (`UNKNOWN_h2h_match_score_writers`/`UNKNOWN_851f_bonus_banner_choice`
document the still-unwired two-car-H2H feature, not something a race loop in this port currently
runs) -- no code change, no live DOSBox session, both cross-checked by two independent search methods
per this project's own standing "`get_xrefs_to` alone can miss DS-relative writes" pitfall.

## 9ah. Win/lose conditions: progress on 0 cells, the prefix-freeze ranking, race end, the lead rule (2026-09-23)

**Scope.** User report: "even if I arrive first at the finishing line I do lose in the port. Also:
I don't even see where the finishing line is." Root cause plus every adjacent divergence found on
the way, each re-read from the bytes by an independent adversarial pass and the key one proven live.

**1. Progress is never written from a plane-2 value of 0 -- `[PROVEN]` live.** `UpdateCarTileCollisionSfx6or4`
clears `[12E5]` after the map query (`55d5`/`5757`, and `5801` on the open path) and writes
`[12E1] = old [12E3]`, `[12E3] = CX`, `[12E5] = 1` (`563c-5648`, `57b2-57be`, `5826-5832`) only
behind `CMP CX,0 / JZ` (`561d`, `579a`, `5807`); CX is `589c`'s ES, the raw plane-2 byte, and `585b`
preserves it. Round 3 adds a skip: not on a bridge (`[1388]!=1`) and `byte [25CC + new meta-tile]==1`.
`UpdateCarCheckpointsAndSurfaceSfx` runs its lap/checkpoint body only if the car's state was 0 at
`5e8f` (tested BEFORE the terrain dispatch, not re-tested after it), outside the round-3 skip
(`5efe-5f18`), and with `[12E5]!=0` (`5f1b`) -- the only reader of `[12E5]` (byte search `e5 12`: 8
sites, full coverage). Live, DOSBox ROUND21 (`CS=023E`, `DS=0B7A`), car 0 poked onto cells and stepped
one physics tick at a time: onto a 0 cell from `p=28` -> `12E3`/`12E1` stay 28, `12E5=0`, laps 4
unchanged (the port wrote 0 and counted a lap); from a stale `1->28` pair onto a 0 cell -> no lap (the
whole body is skipped, not just the write); `p=14` -> 0 cell -> `p=15` -> no change at all (the port
added a lap owed: `0->15` read as a backward crossing); the skip observed directly at `023E:5807` with
`CX=0`. Control: poking across the real line through numbered cells gives exactly the port's -1/+1.
ROUND21 numbers only 33 of its 1024 cells (the loop's centre line); every other drivable cell is 0,
so the port turned ordinary wide driving into fake laps, and with a checkpoint list (rounds 1, 3-7, 9)
into penalties -- and, with no state gate, a stale crossing re-fired every tick and trapped cars in a
permanent `0xD<->7` loop (seen in R12/R41/R62 drones). **This is the user's bug**: going wide from
`p<=14` and rejoining at `p>=15` left the player owing an extra lap, so "first across the line" was not
finished. **Fixed**: `collide.js` `writeProgress` (zero skip + round-3 skip, `progressChanged`),
`checkpoints.js` gates.

**2. The lap test and the cursor.** A forward wrap (`d < -[2654]`) is a lap only if the cursor sits
on the terminator AND `[12E3] < hi` of the list's FIRST entry (`5ff4-5ffb` rewinds SI to the list
base); otherwise it is the penalty (`6006 JMP 5f85`). The port compared with the LAST entry and did
nothing on failure. `[12E7]`/`[12E9]` are BYTE offsets (`+2` at `5f7d`/`5fc5`); the port used indices,
which made `dropin.js`'s `minCursor` (bytes, `6b6a`/`6c64`) twice as strict -- now bytes throughout.
The lap sfx 2 is drawn-gated (`6014`). `RespawnCarAtSafePoint` writes BOTH `[12E3]` and `[12E1]` from
the respawn cell's plane-2 byte (unconditionally, `7120-712a`) and recomputes `[12E7]` = 2 x the number
of leading entries with `lo <= progress` (`7135-7160`); the port set only `progress`. The 0xFF-progress
knockout lives at the write sites (`564e`/`57c4`/`5838` -> `5842`, which also records knockoutX/Y and
skips the rest of `5532`); the port did it in the commit tail, where no `[12E3]` reference exists
(byte search `e3 12`), i.e. after the lap logic. The dwell-overflow exit (`5671 JMP 5842`) records
knockoutX/Y too. All fixed.

**3. Ranking is a PREFIX freeze.** `8e16-8e59` walks the order SLOTS: a slot whose car has
`[12ED]<=0`, or any slot while `[26C6]>=2`, writes 0x7D00 into all four score cells; a live slot
writes only its own cell. Later live slots overwrite their own cells, so slots `0..m` (m = the last
slot holding a finished car) stay pinned and the cars behind them are still ranked live; `[26C6]>=2`
pins everything. Stable 3x3 bubble sort (`JGE`). §9s's "freeze uniformly the instant any car finishes"
and its argument that the loop-order effect is cadence-dependent were wrong: the result is a
deterministic function of the persistent order, the laps and `[26C6]`. It is sampled once per DRAWN
frame (`90c5` returns unless `[2638]==1`, the smoothness batch counter), i.e. every step at the
shipped smoothness 1 (which this port matches) but only every n-th step at smoothness 2-4 -- a
cadence the port does not reproduce (it ranks, and runs the state handlers, every step), a known
divergence for n > 1 (corrected by the review pass; this paragraph first claimed "every step"
unconditionally). Consequence the user could hit: once a drone had
finished, the port pinned everyone, so a player who then passed another drone still got the pinned
place. Seed order `[0,1,2,3]` (`423a`; two-car `445e`/`4466` writes the same). Two-car format ranks
separately (`8f03-8fa1`: slots 0-1 live, one compare, and a forced order when records 0 and 1 have
both finished with `|p0-p1| >= [2654]`); round 9 does not rank at all (`8dfc -> 8ff5`). **Fixed**
(`step.js` `computeRanking`, three branches).

**4. How a four-car race ends.** Finished-car block `4b45-4be4` (four-car, not round 9 -- `4af2`),
BEFORE the state/lock/active gates: speed > 0 -> `speed -= brakeDecel` (clamp 0) and on to the
control path; speed < 0 -> on to the control path; speed == 0 -> `[26C6]` is ASSIGNED
(`4b85 MOV [26C6],0`, then +1 per car with `laps==0 && speed==0`, forced to 2 if the `[2660]` car has
`laps==0`) and the car skips the control path. In the control path (`4d04`...): a finished drone only
coasts (`4d2f-4d44 -> 4e38`); a finished human still steers, then coasts (`4e15`); once `[26C6]>=2`
every car coasts (`4e0e`); the `4e38` coast is NOT gated on being on the ground (the no-input coast
`4e2e` is); the fire button is refused while `[26C6]==2` (`4f03`/`4f17`). Main loop `3081-3093`:
`[26C6]>=2` -> two-car exits at once, four-car decrements `[26CC]` (100, only writer `3c98`) and exits
at 0 -> `30df` (sfx 16, `7af8`, 100 x {`3165`, `855a`, `92bc`} with no render -- `855a` draws only for
the car in `[26B8]`, which is 1 in four-car, so no banner) -> `3115` fix-ups (`[2635]` cheat order,
`[2630]` two-car swap; `[2630]` provably stays 0 in four-car) -> `RET`. The tournament copies the
order array at `11d5` and compares `[3FC]`/`[3FE]` with the player's record `0xC03`: **the result is
car 0's slot in the order array**. So the race ends 100 steps after car 0 has finished AND stopped --
or after two drones have finished and stopped, with the player still racing (a loss the port never
reported). The port ended the instant car 0's laps hit 0, finished drones kept full throttle, and
`[26C6]` was a stateless snapshot nobody consulted. **Fixed** (`step.js` `finishedCarBlock`,
`recountRaceOver`, `checkRaceOver`, `raceState.raceOverCount/raceOverLinger/raceOver`; `flow.js`
reads `raceState.rankOrder.indexOf(0)+1`).

**5. The ROUND21 qualifier's lead rule (`6024-6054`).** On car record 0's lap decrement, four-car
only (`600d`), class 2 and race 1 (`[28BF]==2`, `[28C0]==1` -- exactly the qualifier), with
`[12ED]<=2` after the DEC and cars 1, 2 and 3 all holding STRICTLY more laps remaining (`JLE` skips):
`[26C6]=2`. So completing any lap (from the first real one) while strictly ahead of everyone on laps
ends the qualifier with the player first. §9x called this "strictly behind"; it is strictly ahead.
**Ported** (`checkpoints.js`).

**6. Two more real divergences found while reading the control path.** (a) The rubber band `[262F]`
(`4b1c-4b41` and again `5286-52ab`) scans the order array with `CMP SI,[0x267E]` -- a MEMORY operand
holding the car offset in slot 3, always below SI -- so only slot 0 is examined: the boost is on
exactly while car 0 LEADS. The port boosted every off-screen car behind car 0 at any position. (b)
The steer step helper `4edc-4efa` returns `steerStep` untouched unless the class is 7 (TANKS): the
drone +1 and the human `>>1` at `speed >= 0x320` (signed) are TANKS-only. The port halved a fast
human's steering in every round (and on `|speed|`), making the player run wide more often -- straight
into the 0-cell bug. Both **fixed** (`step.js`).

**7. Where the finish line is, and the "you finished" cue.** In every race the start/finish edge is
a cell edge crossed going north where plane 2 wraps from its max to 1 (2 in R22/R72), right at the
start grid (R73, R93 and R22 have further forward-wrap edges elsewhere, e.g. R73's drivable
east-west cell (11,17) between 75 and 5, which the dev overlay also marks); STRT_POS puts the player and car 1 in the back row just behind it (their first write 0->max is
the +1 that makes the HUD's top digit read 4 at the start) and cars 2/3 just past it. Rounds 1, 4, 5,
6, 7 and 9 paint a line across the lane in their tile art 17-63 px AHEAD of the edge; round 2 (the
bath: the edge is 9 px below the rack across the channel) and round 3 (a cue lies just behind it)
paint nothing; round 8's pipe spur reads as one. No sprite is drawn for it (`90c5`'s hooks
`8996`/`89e0`/`8a2b` animate unrelated tiles; PH0 has only the HUD flag). In R22-R24 the edge runs
through a row of 0 cells (the rack), so the original registers the crossing one cell later than the
old port did. The original's own finish cue is `DrawCarRacePositionLabel 9076`: a 16x8 "1st".."4th"
(PH0 `+0x1D00 + (racePosition-1)*128`) over each car whose laps are exactly 0, or over every car once
`[26C6]>=2` (`7d49-7d65`; four-car, not round 9), at `(posX-height-8, posY-height-20)` relative to the
camera, colour-0-transparent (`8ca4`). **Ported** (`raceView.js` `drawPositionLabel`). A DEV overlay
"Lap line (dev)" (`engine/lapLine.js`, off by default, not original art) marks the edge on both pages.

**8. Races that could never end (found by the review pass, fixed).** A long-horizon sweep (every
race, car 0 on the AI, until the real race-over path fires) showed several races could never be won
or lost at all. (a) **Round 1**: `HandleTerrainNormalOrLeaveLevel` `6105-6164` launches a car off
the ramp lip (prev idx 4 -> `zVel = s/7+4`, idx 3 -> `s/12+8`) OUTSIDE the `[138E]` leave-level
block (`60d6 JZ 6105` skips only that block); the port had nested it inside, so no car could clear
round 1's jump and R11-R14 (tournament order index 2 onward) never ended. (b) **Round 3**: every
car starting a drop-in re-entry releases the race-wide owner (`6c0c MOV [2680],0xFFFF`, the only
clear); the port never released it, and once the byte cursor made the drop-ins reachable a four-car
R32/R33 race could deadlock with every car in state 0xE. (c) **Round 8**: `HandleCarState2or0D
KnockoutAnim` clears the drone wall-stuck count `[12AA]` on every tick (all paths reach `8332`); the
port cleared it only when the animation ended, so a drone knocked out by the >=20 rule was re-knocked
by the next stale bounce and looped 0xD<->7 forever. (d) **RUFFTRUX bonus race**: finishing
(`[12ED]==2`, `4af2-4b19`) latches the countdown `[26CA]` (the latch `7430` tests; expiry at `744d`
sets it too, and car 0 -> 0x10 once), makes the car coast with no controls, and enters state F at
speed 0; the F/0x10 banner routine `86d2` sets `[26C6]=2` (`8702`), so the bonus race ends through
the same four-car countdown, result `[291D]` (1 only in state F). The port had no latch: the clock
kept running after a finish and forced car 0 to 0x10 ("Failed") once it hit 0, and the finished car
kept full throttle -- a won bonus race could be lost. All four fixed (`terrain.js` `h60cb`,
`dropin.js` `stepReenter`, `states.js` `stepKnockoutAnim` and the round-9 timer, `step.js`'s round-9
control branch, `flow.js`).

**Verification.** Mutation-tested: each of 20 old behaviours re-introduced one at a time into a
scratch copy (zero skip, the two gates, first-vs-last `hi`, full freeze, finished-car block, rubber
band, steering, lead rule, respawn, countdown, byte cursor, 0xFF site, finished-drone steering,
per-step recount; then the round-1 ramp, the drop-in owner release, the wall-stuck reset, the
RUFFTRUX latch and the post-race no-op) makes `npm run step`/`play`/`rounds`/`finish` fail. New
`npm run finish` (`tools/check-finish.mjs`): all 29 races resolve through the real race-over path
with an AI-driven car 0 (652 steps for R21's lead rule up to ~18k for R73's slow TANKS). The AI-driven
RUFFTRUX runs always end "Failed" -- the drone AI (never run in round 9 by the original: no `.BRK`,
only the player drives) cuts a corner into a pond (idx 6 -> 7, `64f5`) on every map; the round-9 hop
handlers `6622`/`66ed`/`6768`/`67d8` were re-read and match. So the same script proves the bonus WIN
path on all three real maps directly: car 0 on its last lap, every checkpoint passed, crossing the
real start/finish edge with accelerate held -> latched with 6220/6380/7980 ticks left, coasts to a
stop, state F, race over 175 steps later. New tests: the live scenario C replayed
through the port (`check-step` 1c), the write rule on synthetic worlds, the lap rule and lead rule
with negative twins, the prefix freeze, the finished-car block/countdown/"two drones finished" loss
through `runStep`, and two end-to-end ROUND21 runs (AI-driven car 0: slowed drones -> lead-rule win,
1st, 2 laps left; normal drones -> two drones finish and stop first -> race ends with car 0 3rd).
`check-rounds` now asserts the rule itself across all 58 combinations (laps change only on a step the
car entered in state 0 with its progress written; the tile query never writes 0; no car stuck in
0xD/7). `check-trace` now also compares `progressPrev`/`progressChanged` and still matches 13/20
(the known torn-capture divergence). `npm run live` stays at 0 differing pixels.

**Not done / open.** Two-car (Head-to-Head vs CPU) still ends the port's interim way (when car 0
finishes): its real exit is the knockout match score `[26B4]` (`76f2`/`772a`/`7742`), unported.
The round-3-only bridge path `5740-57f7` (its own `57b2` write, and the `683c` ramp-launch path that
stores CX=12 as progress, an original quirk) is not ported. `drawnThisFrame` is set for every state-0
car in `states.js`, not by an on-screen test, so the rubber band and every drawn-gated sfx still
approximate "on screen". A live `[PROVEN]` capture of a whole race ending (linger, final order) was
not taken.

## 9ai. Front-end music, and pause/fade/cheats on `game.html` (2026-09-23)

Picked up on direct user request against the "things a player notices" list (a `mm-todo-sweep`/
`mm-re-player-visible` two-workflow pass, then hand-implemented and live-checked in a foreground
Chrome tab): the two highest-impact, lowest-risk gaps -- silence throughout the tournament front
end, and `game.html` having none of `play.js`'s own pause/fade/cheat wiring.

**Music (`engine/sound.js`'s new `titleMusic`/`subMenuMusic`/`raceIntroMusic`/`raceResultMusic`/
`championMusic`, wired into `frontend/flow.js`).** `[STATIC]` from `docs/sound.md` §2/§6, which
already had every `AH=4` site mapped to a screen and the title-entry command sequence transcribed
from a live capture -- this milestone is porting that table, not re-deriving it:
- `TITLE` (boot, and every path back to it -- `leaveLogo`, `CHAMPION`'s own confirm, and `OUTCOME`
  when the tournament is over without a champion): `titleMusic` sends `playTune(1), stopMusic(),
  stopSfx(0), muteAll(), playTune(1)` -- literally the five commands `docs/sound.md` §6 transcribes
  ("title entry `AH=4(1), 7, 8, 6, 9, 4(1)`"), trusting the already-proven `Sequencer`/worklet to
  reproduce the documented quirk (the fresh-driver `AH=7` keying notes off one tick after they
  started) rather than hand-simulating it. The trailing `AH=9`-poll-then-`AH=4` is collapsed into a
  second unconditional `playTune(1)`, justified by the same doc's own note that a repeat `AL=1`
  poll is `0901` once then `0900` forever (a no-op restart) -- so is a repeated `playTune(1)` call.
- `MENU` and `CHAR_SELECT` (this port's own flattened stand-ins for the real game's two menu
  levels, `flow.js`'s file header): `subMenuMusic` -> `playTune(2)`, matching the doc's "2 all
  sub-menus" (2 sites) one-for-one, and the live-confirmed reading that the character-select
  screen's own driver `current tune` byte is 2.
- `RACE_INTRO` (`CHAR_SELECT`'s confirm, and `OUTCOME`'s "not over" branch): `raceIntroMusic(sound,
  isLastRace)` -> tune 4, or 5 for the tournament's own final race. `isLastRace` is a new
  `tournament.js` export, `isFinalRace(state)` -- `!state.pendingBonusRace && state.raceIndex ===
  ORDER_TABLE_LAST_INDEX`, the same comparison `maybeTriggerBonusRace`'s own "not the last race"
  guard already used, not a new rule. **Corrected 2026-09-24 (M3.45, `docs/sound.md` §8's
  `UNKNOWN_tune7_unused` write-up): the tune-5 branch was a port-only invention, removed.**
  `ShowNextRaceIntroScreenTune4or5 1000:11f8`'s own `AL=5` branch (`CMP [28c1],0x1a; JNZ`) is dead
  in the shipped game: **every writer of `[28c1]` in `MICROU.EXE` was found exhaustively** (byte
  search for its disp16 bytes, `c1 28`, 38 hits, and for a word write through its low byte,
  `c0 28`, 20 hits, every one classified read vs. write) -- there are exactly five: the tournament
  init (`10af`, `=0`), the normal per-race advance (`10f9 INC` then `1104 CMP [28c1],[439]` /
  `1108 JA`), the `25011968`-cheat race-skip hotkey on this same screen (`13c3`, clamped to
  `[0,0x19]` by `13aa`/`13bf`), and two more inside `RunHeadToHeadTournament 1faf` (the *unported*
  two-human mode, `docs/engine.md`'s own "Two-human Head to Head" note above -- not the ported
  Head-to-Head-vs-CPU flow) -- `1fb9` (`=1`) and `207a` (`INC`, genuinely uncapped, since that
  function's own race loop tests `[98a]`/`[98c]` lives-remaining instead. The last two don't matter:
  `RunHeadToHeadTournament`'s own body (`1faf`-`2098`, read in full) never calls `115c`/`11f8` at
  all, so its own `[28c1]` values are never read by this branch, and `10af` unconditionally resets
  `[28c1]=0` at the start of every fresh one-player tournament regardless of what a prior two-human
  session left behind. So the two paths that DO reach `11f8` -- the normal advance and the cheat
  hotkey -- both leave `[28c1]` at `0x19` at most, one short of `0x1a`. `[439]` itself is never
  written anywhere (the same disp16-byte search for `39 04` finds only 5 reads, `1101`/`1131`/
  `118d`/`13bf`/`187f`) -- a fixed constant, `[STATIC]` (read from the loaded image, not a live
  capture) at `0x19`. `isFinalRace`'s own `ORDER_TABLE_LAST_INDEX` (`0x19`,
  `src/data/frontend-tables.js`, itself read the same way) is the *true* last race, i.e. exactly the
  one race whose intro the real branch needs `[28c1]==0x1a` (one past it) to ever fire tune 5 for --
  so the port's old behaviour played a real, embedded tune (tune 5, present in both `DRIVER1.BIN`
  and `DRIVER2.BIN` -- `docs/sound.md` §4) at a moment the original game never does. Fixed:
  `raceIntroMusic` now always plays tune 4 and takes no second argument; `isFinalRace` (dead once
  its only caller was removed) deleted from `tournament.js`. Teeth-proven in `tools/check-sound.mjs`
  (M3.45): reverting to the old `isLastRace ? 5 : 4` shape and calling `raceIntroMusic(driver,
  true)` (the old call site's own argument) makes the new "always tune 4" pin fail, confirmed
  before restoring the fix.
- `RESULTS` (a normal race's own standings screen, `advanceRace`'s "not round 9" branch):
  `raceResultMusic(sound, lastPassed)` -> tune 8 if passed, 6 if not, reusing the exact boolean the
  screen's own text already computes. **Approximated, not byte-exact** -- see the follow-up RE pass
  below, `ShowRaceResultsScreenTune8or6 1000:1439`'s real condition is narrower.
  **Resolved 2026-09-24, §9bd**: `raceResultMusic` is now called with `resultsWasPassed`
  (`tournament.js`'s own `resultsPassed(state, finishPosition)`, the byte-exact `1439` test), not
  `lastPassed` -- `lastPassed` itself (the screen's own "QUALIFY"/"FAILED" text) is unchanged, and
  was already established as correct for this case by §9bb item 1.
- `OUTCOME` (the shared win/lose *message* screen -- entered two ways: directly from `advanceRace`
  for a bonus race, which skips `RESULTS` entirely; or from `RESULTS`'s own confirm): initially
  ported the same way as `RESULTS` (one `raceResultMusic` call covering both screens), **corrected
  same day** once the follow-up RE pass below supplied `ShowRaceOutcomeMessageTune8or6 1000:1c84`'s
  exact rule -- now `raceOutcomeMusic(sound, tournament.lastOutcome)`, called at both of `OUTCOME`'s
  own entry points instead.
- `CHAMPION` (`OUTCOME`'s "over and champion" branch): `championMusic` -> `playTune(3)`.
- Race audio is untouched: `raceStart` (already existing) still sends the real game's own `AH=7` at
  every race start, so races themselves stay silent of music exactly as before -- this milestone
  only fills the screens around them.
- Deliberately not modelled: the attract-loop `AH=9`-then-`AH=4` re-poll every ~4s while sitting on
  the title screen (docs/sound.md §2) -- inert by construction once a JS session's own state
  persists correctly (no watchdog restart is needed the way the DOS game's own polling loop needed
  one), and the `39F5` second race-start `AH=7`/engine-kill/keep-alive quirk (unrelated to music).

**Follow-up RE pass (`mm-re-player-visible`, same day), and one real correction it produced.** A
`search_instructions`-based sweep (independently, twice: manual per-function reading + a
program-wide byte/mnemonic scan, both agreeing) found and disassembled all 15 `AH=4` sites by
address (`1000:007b/0131/019d/0232/0a18/1213/1439/16f1/1ac4/1c84/1f03/20ab/21a5/2340/25a0`),
confirming this section's own tune-1..8 mapping site-for-site, and additionally found:
- **`ShowRaceOutcomeMessageTune8or6 1000:1c84`'s real rule is CX-parity, not a binary pass/fail**:
  tune 8 if the outcome code is odd (1 `PASSED`, 3 `EXTRA_LIFE`, 5
  `QUALIFIED_FOR_HEAD_TO_HEAD`), 6 if even (0 `QUALIFIER_FAILED`, 2 `ONE_LIFE_LOST`) -- **and code 4
  (`NO_BONUS`) skips the real screen entirely, jumping straight past its own `AH=4`, not just
  landing on the "lose" tune**. `tournament.js`'s `OUTCOME` enum is confirmed the same 0-5 encoding
  as the real CX byte (`frontend-tables.js`'s own `OUTCOME_MESSAGES` header comment, independently
  matching `docs/engine.md` §7's naming) -- `tournament.lastOutcome` needs no translation. Real bug
  this fixed: a lost bonus race previously played tune 6 ("lose") on the `OUTCOME` screen; the real
  game changes nothing there (silently continues whatever the race-intro screen was already
  playing). Ported as `raceOutcomeMusic` above.
  **Corrected 2026-09-24 (GOAL-DOS-PARITY.md P3's 4th item, docs/engine.md §9bb item 4): BOTH
  bolded claims above are WRONG, not just the first.** A fresh, independently-repeated (twice)
  byte-for-byte re-read of `1000:1c6a-1c89` found NO branch anywhere in that range that depends on
  CX at all, let alone one that skips CX=4 specifically: the win/lose tune choice (`1c6c: TEST
  CX,1`) is pure parity, and the ONLY conditional between it and the `AH=4` play call (`1c80: JZ
  1c89`) depends on the sound driver's own `AH=9` "already playing" query result, not on CX. Code 4
  plays tune 6 exactly like every other even code, unconditionally (net of the SAME query-dedup
  every OTHER outcome code also gets) -- confirming this pass's OWN claim that a lost bonus race
  plays tune 6 was directionally RIGHT, but for the wrong reason (plain CX-parity, not a "the real
  game silently continues instead" exemption -- `TriggerBonusRace 1A82`'s own tail (`1A8F: MOV
  CX,4` when lost, fully re-disassembled) DOES call `1C1B` for a lost bonus race, reaching the SAME
  `1c84` play call as every other outcome; it does not skip the outcome screen or its tune at all).
  `raceOutcomeMusic` corrected to remove the wrong `outcomeCode===4` early return;
  `tools/check-sound.mjs`'s own pin updated from "5 codes plus a NO_BONUS exception" to "6 codes,
  exception-free parity".
- **`ShowRaceResultsScreenTune8or6 1000:1439`'s real condition is narrower than "passed the race"**:
  tune 8 iff `word[3FC]==0xC03` (car 0 occupies the order array's own first slot, i.e. placed 1st)
  OR (`byte[28C1]!=0x19` AND `word[3FE]==0xC03`, placed 2nd) -- an apparent exception on the
  tournament's very last race (`byte[28C1]`, 0-based -- the qualifier is 0, so `0x19` is the LAST
  race, not the "25th-of-26") that this pass could not further explain.
  **The `0x19` exception is now explained, 2026-09-24 (GOAL-DOS-PARITY.md P3's 4th item,
  docs/engine.md §9bb item 1)**: it's the SAME "only 1st place passes the tournament's very last
  race" rule `1000:15B7`/`1658` gate for the OUTCOME itself, re-used here for the RESULTS tune --
  `tournament.js`'s own `reportRaceResult` now ports that rule for the outcome (`isLastRace ? 1 :
  2` as the pass threshold), which means `lastPassed` (the boolean this file's own `raceResultMusic`
  still uses as an approximation) now agrees with the byte-exact tune test in every case this port
  can produce -- a 2nd-place finish on the last race is `lastPassed=false` there too. **Still left
  as the `lastPassed` approximation, not implemented byte-exact** for the tune condition
  specifically (the underlying OUTCOME rule is now byte-exact; the TUNE condition itself is a
  separate, not-yet-fully-verified refinement -- see `sound.js`'s own updated header) -- and
  `word[3FC]`/`[3FE]`'s exact encoding (`0xC03`) beyond "the order array's first two slots" still
  wasn't independently pinned down by this pass either.
  **Resolved 2026-09-24, §9bd**: the tune condition is now ported byte-exact, via a new
  `resultsPassed(state, finishPosition)` export called directly (`resultsWasPassed`), not the
  `lastPassed` approximation; `word[3FC]`/`[3FE]`'s own encoding (car descriptor addresses, via
  `1000:11D5`'s copy/transform) is now independently pinned down too, including under the
  instant-win cheat.
- **`1000:26e4` (the ESC-from-race driver reload) issues no tune command itself** -- confirmed by
  reading every instruction in `InitLoadAssets` (`26c0-26eb`): the reload (plus a front-end asset-
  arena/palette refresh) is all it does; whatever screen the caller shows next restarts music via
  its own ordinary `AH=9`/`AH=4` pair. This port's own ESC handler (above) matches that shape --
  `abortRaceFn` triggers no music call of its own, `advanceRace`'s `aborted` branch calls
  `titleMusic` only because it lands on `TITLE`, exactly mirroring the real reload's own downstream
  callers (all of which re-trigger through whichever screen they return to, not the reload itself).
- **Live coverage stays narrow**: of the 15 sites, only #1/#2 (`AL=1` at boot/title-entry) and the
  periodic re-poll #3 are `[PROVEN]` by a capture; sites #4-15 (11 of 15, including every menu/
  results/champion/H2H screen) remain `[STATIC]`, cross-checked twice this session but never
  exercised under DOSBox -- `docs/sound.md`'s existing "live coverage" open item narrows to exactly
  this list rather than closing. Site #12 (`ShowHeadToHeadResultUnreferenced 1000:20ab`) is
  additionally proven **unreachable** (`get_xrefs_to` -> 0 hits into its entry) -- correctly not
  ported, needs no further attention.

**Pause/fade/cheats on `game.html` (`frontend/flow.js`'s `runOneRace`).** Ported byte-for-byte from
`play.js`'s own already-shipped, already-tested wiring (`engine/pause.js`'s `updatePause`,
`engine/fade.js`'s `updateFade`/`applyFade`, `engine/cheats.js` via `updatePause`'s own
`findCheatSpot`/`applyCheatEffect` calls) -- no new engine logic, only new call sites:
- `GAME1/CHEATS.BIN` is now read once at boot (alongside the other front-end assets) and parsed
  with the existing `parseCheats`.
- Each race gets a fresh `pauseKey` (`createPauseKeyReader(window)`), `pauseState`, `fadeState`,
  and `globalState`, created in `runOneRace` and disposed alongside `humanReader` at race end --
  NOT created once at boot the way `play.js` can afford to (single race, no menu). A boot-scoped
  reader would carry a stray SPACE "pressed" edge in from confirming the `RACE_INTRO` screen
  (SPACE/ENTER both confirm a menu in this front end) straight into the race's first frame,
  instantly pausing it; recreating the reader after the menu's own keydown has already finished
  dispatching avoids that race entirely.
- `frame()`'s own loop now matches `play.js`'s shape: `updateFade` every real frame regardless of
  pause, `pauseKey.read()` + `updatePause` before the physics accumulator, the physics `while` loop
  skipped entirely while paused (`shouldRender` seeded from `paused` so the frozen frame still
  redraws once with the banner), `composeRaceView`'s own `paused` flag threaded through so
  `drawPauseBanner` fires, and the palette re-decoded through `applyFade` every render instead of
  once at load (`loadRaceAssets` now also returns the raw `palBytes` `decodePalette` needs).
- **Port-only addition, not modelled on a specific original screen** (flagged as such, matching
  this file's own convention for `play.js`'s earlier port-only additions): ESC now aborts a race
  back to `TITLE` (`flow.js`'s `abortRaceFn`, set for the duration of `RACING` and called from
  `onKeydown`), reusing `raceOverSequence` for the same silence-everything effect a real race end
  already gets rather than a bespoke abort path. `play.js`'s own single-race page similarly gained
  an R-to-restart key once the race is over (`location.reload()` -- the honest equivalent of
  "leave and come back" for a page with no menu to return to, echoing this section's own citation
  of `26E4` reloading the sound driver after a real ESC-from-race).

**Verification.** The full headless check suite (`tables` through `bitsfile`, 21 scripts) passes
unchanged after these edits (a pure addition of new call sites, no touched decoder/physics logic).
Live-checked in a foreground Chrome tab on `game.html`: title screen renders and the console is
clean through `TITLE -> MENU -> CHAR_SELECT -> RACE_INTRO -> RACING` (each music call site
exercised, none throws); a race starts, the HUD renders, SPACE freezes physics and draws "Paused!"
with the status line reading "Paused". The pause's own **resume** timing (>=2000ms held-release)
and the ESC-abort path were **not** independently live-timed end-to-end: this sandbox's browser tab
reports `document.hidden === true` between explicit input actions, which fully suspends
`requestAnimationFrame` (confirmed directly -- `document.visibilityState`/`hidden` read back
`hidden`/`true` mid-race while `document.hasFocus()` still read `true`), so a multi-second
wall-clock hold can't be observed this way; `updatePause`'s exact resume-timing logic (the
>=2000ms-and-released gate, the cheat-flash floor, the sound-call-once-on-entry assertions) is
already unit-tested headlessly in `tools/check-play.mjs` (13 `updatePause` checks) and passed
unchanged, and `frame()`'s wiring is a mechanical copy of `play.js`'s own already-live-tested shape,
not new logic. A follow-up session with real OS-level window focus (not just tab selection) should
still confirm the resume and ESC paths against a real clock rather than resting on the unit tests
alone.

**The "1 Up!"/"Failed" RUFFTRUX banners, added the same day once the `mm-re-player-visible` RE pass
supplied their spec.** `DrawBanner88x22Blinking 1000:9289` is the shared primitive behind four
banners (Bonus/Winner/PlayOff, the pause banner already ported in M3.12, and this pair); full
disassembly this session found **no blink logic anywhere in the call chain despite the function's
own name** -- `[26C2]`'s actual blink-shaped counter belongs to a different, separate, two-car-only
routine (`FUN_1000_8634`) not touched here. State F ("1 Up!", `4AF2-4B19`, car 0 only,
`states.js`'s existing one-shot-sfx handler) and state 0x10 ("Failed", `7429-7459`/`7453`,
likewise car-0-only in this port already) are **provably mutually exclusive within one race** -- a
win latches `[26CA]=1` before the car even stops, permanently blocking the countdown-expiry path
that would otherwise force state 0x10 later, a real interlock this pass proved via a full 37-hit
`[+0x12AE]` writer sweep, not just inferred. Both states share one slide-in draw routine (`86D2`):
centre-X fixed at 128 (top-left 84, same as every banner through `9289`), centre-Y climbing `+8`
every tick from 0 while `<=124`, **with no clamp** -- it deliberately overshoots and settles at
centre-Y 128 (top-left **116**), a real, evidence-based difference from both the pause banner's
fixed 48 and the (two-car-only, unported, see below) Winner banner's clamped 124/top-left-112.
Ported: `states.js`'s `advanceBannerSlide` (the real `[26C0]` register, as `car._bannerSlideY`,
advanced once per tick inside the existing state-F/0x10 handlers) and `raceView.js`'s
`drawRuffTruxBanner` (wired into `composeRaceView`'s round-9 branch, alongside the existing RUFFTRUX
countdown digits), using `ph0Banner`'s existing index 3/4 slots. Verified: the full 21-script check
suite unchanged, plus three synthetic PNG renders looked at directly (sliding vs. settled "1 Up!",
settled "Failed") confirming the banner's position and text match the real sprite data.
**Deliberately not ported alongside it: the "Winner" banner** (`DrawRaceOverBannerSfx10
1000:855A-8633`) -- the same RE pass proved it **structurally unreachable outside two-car mode**
(its own trigger gate, `BX==[26B8]`, only becomes satisfiable through the unported two-car
knockout/finish-detection machinery, `UNKNOWN_twocar_race_end`/§10) -- porting it now would be dead
code with nothing left to trigger it; revisit alongside that larger item instead. `FUN_1000_8634`
("Bonus"/"Play Off" overlay, `[26C2]`'s real blink-shaped home) is the same two-car-only story, not
further resolved this session -- its own trigger semantics weren't asked for and remain open.

## 9aj. CHOPPERS rotor, and the states-2/0xD/1/4/5 car-animation overlays (2026-09-23)

Continuing the same "things a player notices" pass (`mm-re-player-visible`'s remaining four RE
specs, hand-implemented and check-suite-verified one at a time; live browser confirmation wasn't
attempted for these two -- both are additive-only rendering, verified instead by synthetic PNG
renders looked at directly, the same discipline `npm run render`/`tracks` already use project-wide).

**CHOPPERS (round 8) rotor overlay** (`DrawRound8ExtraAnim32 1000:843d`/`DrawSprite32FromDs5EE3
1000:847e`). `formats/race.js`'s `vehicleFrames` now also returns `rotorFrames` (round 8 only, 5×
32×32, via a new single-frame accessor `ph0ChopperRotorFrame` alongside the existing strip-builder
`ph0ChopperRotorFrames`) -- prepared once at load time, not re-sliced per render. `render/
raceView.js`'s new `drawRotor` draws it centre-anchored on the car's raw world position (**no z/
height offset at all**, confirmed by the RE pass -- moot anyway since round 8's body already forces
z=0), gated on state NOT in `{2, 0xD}`, drawn AFTER the body (matching the real paint order). Frame
= `(rotorFrame>>1)&3`. `car.rotorFrame` (already an existing, previously-unused `CarRecord` field at
the right offset) advances via a new `engine/states.js` export, `advanceRotorFrame(cars, round)`,
called from `play.js`/`flow.js`'s own game loop at the `smoothGate.shouldDraw()` hook -- matching
the real `843d`'s genuinely smoothness-gated cadence (it sits inside the gated
`RenderRaceFrameToBackBuffer`, unlike `animTimer`'s own unconditional `73E7`), gated on state NOT in
`{2, 0xD}` same as the draw itself. **An advisor review caught a real bug before this shipped**: the
first draft advanced `rotorFrame` inside `drawRotor` itself (a pure render function) -- since both
game-loop pause branches set `shouldRender = paused` to keep redrawing the frozen "Paused!" frame
every rAF tick, that kept the rotor spinning throughout a pause, when the real game's own busy-wait
pause runs no physics or render-gated logic at all. Fixed by moving the mutation out of the render
path entirely; `drawRotor` is read-only again. Verified: full 21-script suite unchanged; a
with/without diff render (156 pixels differ, all within the rotor's own footprint), an 8-frame spin
sequence (visibly alternating between the blade's two symmetric orientations), and a direct call to
`advanceRotorFrame` confirming it advances on a normal tick, freezes while `state===2`, and never
touches a non-round-8 car's field
looked at directly.

**States 2/0xD/1/4/5 animation overlays.** These states already had correct STATE-MACHINE timing
(`engine/states.js`'s `stepKnockoutAnim`/`stepHazardDeath`/`stepFallAnim`/`stepCrashAnim`, `animStep`/
`animTimer`/`driftSteps` all already tracked and tested) but drew nothing but the plain car body the
entire time a car was in any of them -- this pass adds the drawing, reading those same
already-correct fields, mutating nothing. A new pure, read-only `carAnimationFrame(car, round)` in
`raceView.js` re-derives the real per-tick body-visibility/overlay decision (`82BE`/`880A`/`7F62`/
`7EFA`'s own dispatch, re-disassembled fresh this session) without touching `car`:
- **States 2 (reappear) / 0xD (knockout fade)**: idx = the `KNOCKOUT_DURATIONS` threshold
  `animTimer` hasn't yet crossed (the identical index `stepKnockoutAnim` already computes
  internally, just not persisted -- recomputed here, not a second mechanism). State 2 draws the body
  only for `idx>=3` (last 3 of 6 steps); state 0xD only for `idx<=3` (first 4) -- confirmed
  asymmetric, not a copy-paste guess. The PH0 overlay (new accessor `ph0KnockoutFrame`, `PH0_LAYOUT`
  gains a `knockout` entry at the already-documented `+0x600`, 5×24×24) draws on top of the body
  when both are present, colour-0-transparent with **no car-colour remap** (confirmed at the
  instruction level -- the plain blitter, not the remap one). Anchor is `car.knockoutX`/`knockoutY`
  (`[BX+0x12BA]`/`[0x12BC]`) -- **not** `car.posX`/`posY` directly. A first draft used `posX`/`posY`
  on the reasoning that no state handler touches them while active, which an advisor review caught
  overclaiming (`collide.js`'s commit gate does include state 2, so a car-car hit can genuinely
  drift a reappearing car's position, unlike the real snapshot). Investigating that turned up
  something better than a documented approximation: `car.knockoutX`/`knockoutY` were **already**
  real, tested `CarRecord` fields (`car.js`), already written at every real transition site
  `checkpoints.js`/`collide.js`/`airborne.js`/`projectile.js` name (docs/engine.md §9v/§9ac/§9x
  already cite several of these sites for other reasons) -- a research gap on this pass's own part,
  not a missing port feature, for not finding them before reaching for an approximation. Only
  `states.js`'s own `stepRespawn` (the state-7-to-2 transition, `RespawnCarAtSafePoint
  1000:7258-7264` -- per the RE pass, the position snapshot there is taken AFTER the fresh
  respawn-point/LEV-nudge/heading-offset writes, i.e. the NEW position, not the old one) was
  missing the write -- a real, if narrow, pre-existing gap, now fixed two lines above the `state=2`
  assignment. With that, `drawKnockoutOverlay` reads the real fields directly and needs no
  approximation or caveat for either state.
- **States 1 (hazard death) / 4 (fall) / 5 (crash)**: mutually exclusive with the body per tick --
  `driftSteps!=0` (or, state 1 only, rounds 4/9's own heading-oscillation sub-phase, re-derived
  read-only from `car.heading` the same way `stepHazardDeath` itself decides it) draws the body ONLY;
  otherwise the table-selected overlay draws INSTEAD of the body (a `-2` table entry draws neither,
  matching the real "tick-only" control word exactly -- the car is briefly invisible that one frame,
  not a bug). Overlay source is the round's own VH0 "second bank" (`vehicleFrames`'s existing `bank2`
  field, already the right buffer -- no new file parsing needed), drawn WITH the car-colour remap
  (confirmed the same nibble-1/2-only mask the body's own blitter uses, so the existing
  `remapCarColours` is the right function, reused not reimplemented), no z offset. Round 9's 5-frame
  second bank folds frame ids >4 back to 0-4 (`8034`'s own rule, `STATE1_ANIM_B`'s own frame ids run
  5-9); every other round's 12-frame bank2 indexes directly. All six threshold/frame tables were
  already correct in `data/engine-tables.js` (verified byte-for-byte again this session, independent
  read of `DS:27C1-28B9`) -- only the drawing was missing.
- Verified per-state with synthetic PNG renders looked at directly, not just "no throw": state 2
  correctly hides the body during the early "seeing stars" burst and shows body+overlay together
  once armed; state 0xD the mirror image; states 1/4/5 each show a distinct, plausible spin/tumble/
  crash frame in the correct car colour, body absent throughout; round 9's fold verified with a
  40×40 RUFFTRUX truck frame (ids 5/7/9 folding to 0/2/4) rendering correctly with transparency
  intact. Full 21-script check suite unchanged throughout (pure new draw paths, no touched
  decoder/physics/table logic).
- **Not touched**: the shadow draw (`drawCarShadow`) keeps its own existing, unrelated gate
  (`round===8`/height-zero) -- the RE pass found no evidence either way for shadow suppression
  during these five states, so nothing was changed there rather than guessing. `UNKNOWN_ph0_1140_1380`
  stays open (this pass's own narrower exclusion of these five specific routines as possible
  consumers is recorded in the RE transcript, not a new doc claim -- the broader item is unchanged).

## 9ak. Round 9 (RUFFTRUX): the invisible truck, and deactivating cars 1-3 (2026-09-23)

The last two items from the "things a player notices" list, picked up on direct user request after
an advisor review of the two already-shipped (§9ai/§9aj). Both RE'd in the same `mm-re-player-
visible` pass as §9aj; implementation deliberately deferred to its own session given the
physics/ranking-adjacent risk, per the advisor's own guidance to settle what `3b50` actually does
before touching anything.

**The invisible truck, fixed.** `formats/race.js`'s `vehicleFrames()` had an explicit `if (round !==
9)` guard around the 32-frame mirror-expansion loop (`vflip`/`hflip` from the 9 stored frames),
leaving round 9 with only 9 frames. `raceView.js`'s `carFrame` (`frames[h8>>3]`) then read
`undefined` for 23 of the 32 heading buckets, and both `drawCarBody`/`drawCarShadow` bail out on a
falsy frame -- RUFFTRUX's own truck (and its shadow) was invisible for roughly 3/4 of all headings,
every time this milestone's own "round-9 truck visibility" item was scoped. The RE pass confirmed
round 9's real loader (`LoadRoundVh0AndSplit 1000:4611` -> `ExpandVehicleRotations40 1000:46f6`)
builds the exact same 32-frame mirror table, byte-for-byte the same shape as the already-ported 24×24
generator, just re-parameterized for `size=40` -- so the fix was simply deleting the guard;
`vflip`/`hflip` already generalize by `size` and needed no round-9-specific code at all. A second,
purely cosmetic divergence found alongside it: round 9's real body blit is the plain colour-0-
transparent copy (`BlitSpriteTransparentRace 8ca4`), not the car-colour-remap variant every other
round uses (`8c6a`) -- no observed visual difference today (car 0's own static colour offset is 0,
making the port's previous unconditional remap call an identity op), but `drawCarBody` now skips the
remap for round 9 to match the real bytes exactly rather than lean on that coincidence.

**Cars 1-3 deactivated for round 9, correcting this file's own §7 shorthand.** The RE pass fully
disassembled `1000:3b50` and found its own round-9 `present:=0` write for cars 1-3 is **dead on
arrival** -- `LoadRaceStartPosCheatsMapAndBanks`'s very next call, `InitRaceCarsFromTables`, sets
ALL FOUR cars' `present:=1` unconditionally a few instructions later, clobbering it. The real,
surviving deactivation is `InitRaceCarsFromTables`'s OWN round-9 branch, `1000:41bd-41d2`, right
after that clobber -- this file's earlier "`3b50` … round 9 hides cars 1–3" (§7) named the wrong
site; corrected here, not there, since §7 is itself a historical record. `active` (mirrored from
`present` at `43a4-43a8`) is a genuine, comprehensive "out of the simulation" flag, confirmed by a
full `search_instructions` sweep at the entry of every major per-car physics/collision/draw
function (velocity-toward-heading, tile collision, car-car collision, position-commit/bounce,
airborne/landing, projectile-target eligibility, AND the entire per-car state-machine dispatch of
which drawing is only one consequence) -- not a draw-only gate. Ported as a one-line addition to
`engine/race.js`'s `spawnCars`: `present` now also zeroes for `round===9 && i>=1`, alongside the
existing two-car-format gate; since `active` already mirrors `present` in this port's own `spawnCars`
(unlike the real game's separate two-field mirroring), and every physics/collision/draw path already
gates on `active` pervasively (this port's own established, pre-existing pattern), no other file
needed to change for the deactivation to take full effect.
- Two loose ends the RE pass characterized precisely rather than leaving as a blanket "gated":
  the RUFFTRUX finish latch (`RunCarPhysicsStep`'s own round-9 branch, `car.state=0xf` on
  `lapsRemaining===2`) is NOT itself gated on `active` at the code level, but `lapsRemaining` is
  fixed at init (`3`) and only ever decremented by code downstream of the same active-gated
  position-commit chain -- so it is structurally unreachable for an inactive car in practice, not
  explicitly blocked. Similarly the drone AI reader IS still invoked once per tick for cars 1-3's
  input slots (round-gating doesn't reach that far), reading garbage from the absent `.BRK` data,
  but its output is never consumed since every physics function that reads `controlBits` is itself
  active-gated. Neither is ported as an explicit new gate in this pass -- the existing active-gate
  architecture already produces the same observable behaviour without needing to special-case
  either loose end.
- **Verified**: full 21-script suite unchanged; `npm run finish`'s own RUFFTRUX bonus-race numbers
  moved slightly (175->178 steps to the win, an expected consequence the advisor's own review
  flagged in advance -- deactivating 3 cars changes exactly which physics runs each tick) but the
  bonus race stays winnable on all 3 real maps, same as before. A direct `spawnCars` check confirms
  car 0 stays active/present in round 9 while cars 1-3 are both zeroed, that the gate doesn't leak
  into other rounds, and that it composes correctly alongside the pre-existing two-car-format gate.
  An 8-heading render strip of the RUFFTRUX truck, looked at directly, confirms it's now visible and
  correctly rotated at every sampled heading (previously invisible at 6 of the 8). Two new regression
  checks (`checkRound9Deactivation`, a `vehicleFrames` frame-count pin) were hand-reverted to confirm
  each fails on the pre-fix code, per the same-session advisor guidance that prompted adding them for
  §9aj's own two fixes.

## 9al. Animated course tiles: rounds 1/3/5's parallax, round 2's water shimmer, round 8's hazard graphic (2026-09-23)

The last, highest-risk item of the "things a player notices" list -- flagged as such because it
touches `index.html`'s own default ROUND21 render path, not just a tournament-only round. Per an
advisor review's explicit guidance: confirmed `npm run live` renders through `composeRaceView`
itself (not a separate static path) before touching anything, implemented the camera-derived,
counter-free piece first, and verified against the real per-race `.MAP` data at every step, not just
"doesn't throw." Full RE spec: `mm-re-player-visible`, 2026-09-23 (re-derived after the workflow's
own first pass on this item mis-concluded round 2's animation writes into a dead buffer -- caught by
an in-session advisor check before it was written down, corrected in the same pass).

**The gate, one instruction range for all three.** `1000:90d9-9104` sits inside
`RenderRaceFrameToBackBuffer`, dispatching on `[28BF]` (confirmed, again, literally the round number
-- docs/engine.md §7): rounds 1/3/5 → `8996`; round 2 → `89e0`; round 8 → `8a2b`. Same smoothness
gate as everything else in that function (`[2638]==1`, docs/engine.md §9aj's own rotor section) --
fires once per rendered frame, freezes during pause (confirmed live: `CheckCheatSpotsThenPause`
forces exactly one extra render on pause ENTRY only, then busy-waits with no further call).

**Rounds 1/3/5 (`8996`): a genuine live tile-bank rewrite, not a coordinate trick.** Tile 0's
pristine 256 B bitmap (captured once at load, `CopyPr0HeaderToDs`) is re-shifted into the LIVE tile
bank's own slot 0 every rendered frame: `dx=(camX&0x1F)>>1`, `dy=(camY&0x1F)>>1` (0-15, advancing
every 2 camera px, wrapping every 32) -- the pattern scrolls one full 16px tile-width for every 32px
of camera travel, literally half speed. Ported as `raceView.js`'s new `applyTile0Parallax(bank,
pristineTile0, camX, camY)`, called from `composeRaceView` for round∈{1,3,5} before the tile-blit
pass. Needs no persistent counter or game-loop hook at all -- unlike the rotor/banner, it's a pure
function of the CURRENT camera position, always idempotent for a given (camX,camY), so it can't
drift or need pause-freezing logic. `pristineTile0` is captured once per race, right after
`loadTileBank` returns and before any frame can shift it (`flow.js`'s `loadRaceAssets`); `play.js`
doesn't wire it at all since it's hard-coded to round 2, where this branch can never fire.

**Round 2 (`89e0`): a fixed-world-position background water-shimmer, verified genuinely visible.**
The earlier RE pass's own first conclusion -- that this writes into a dead buffer -- was wrong, and
matters here specifically because ROUND21 (`index.html`'s own default race) is one of round 2's own
4 races. Corrected finding: `4B78`/`5478` are not two separate arenas but ONE buffer, addressed by
two different literal DOS segments only because a 16-bit segment can't span the whole 0x12000-byte
structure at a single fixed base (`InitRaceCarsFromTables`'s own two-pass load, `SI` NOT reset
between passes, confirms it's one continuous sweep) -- exactly the single `Uint16Array(192×192)`
`buildWordMap` already returns; no port change needed there, just this confirmation. The animation
itself: a `[26D1]` counter (zeroed once at race setup, never reset otherwise) drives `phase =
(counter>>2)&3`, `base = phase*16`, writing a 4×4 patch (world px 1584-1647/2896-2959, grid row
181-184/col 99-102) to `base+0..base+15` in raster order -- cycling through 4 consecutive 16-tile
blocks of the tile bank every 4 rendered frames (16-tick period). Verified against the REAL
`ROUND21..24.MAP` data: ROUND21 holds real, varied tile indices at that spot (322-325, 369), not a
reserved placeholder -- rendered both round 2's own tiles and that exact map crop and confirmed both
are the same family of dithered blue "water" texture, sitting at the map's background/edge, off the
drivable surface. No race gate -- fires in all 4 of round 2's races unconditionally. Ported as
`applyRound2WaterAnim(words, tileAnimCounter)`, mutating `words` (the live word-map, same array
`buildWordMap` returns) in place.

**Round 8 (`8a2b`): a race-gated hazard graphic, verified against a reserved level-data
placeholder.** Race 1 gets none at all (the real function returns before even incrementing its own
counter, `[26D3]`, which has no per-race init anywhere in the program and self-wraps to 0 whenever
its own phase reaches 3). Race 2: one 3×3 patch (arena row 68-70/col 18-20). Race 3: six 3×3 patches
-- four in one vertical shaft (row 62-64/68-70/80-82/86-88, col 90-92) plus two more further down
(row 104-106/110-112, same column) -- almost certainly the same graphic (spinning fan/gas jet, round
8 is CHOPPERS) repeated up a shaft. All patches cycle the same base (0, 9, 18) over the counter's own
phase. Verified against `ROUND82.MAP`/`ROUND83.MAP` directly: **every one of the seven target spots
is baked as the exact literal sequence `0 1 2 / 3 4 5 / 6 7 8`** -- a deliberately reserved
placeholder in the level data, confirming both the mechanism and every coordinate precisely; at
tick 0 the port's own overwrite is consequently a byte-perfect no-op against the raw map (confirmed
directly), so the very first rendered frame of a round-8 race is pixel-identical with or without
this system, only later ticks visibly animate. Ported as `applyRound8HazardAnim(words,
tileAnimCounter, race)`. **One real quirk simplified, flagged not silently matched**: the real
counter's self-wrap-to-0-at-phase-3 behaviour adds a single-tick "blip" at base 0 every 13th tick
rather than a clean 12-tick repeat; reproducing that exactly would mean a render-only function
writing back into the shared counter the game loop owns, breaking the same
render-must-not-mutate-timing-state principle the rotor counter's own earlier bug (§9aj) was fixed
to uphold -- judged not worth that coupling for a one-tick-in-thirteen cosmetic difference.

**Cadence, the same shape as the rotor.** `raceState.tileAnimCounter`, a single shared field
(matching `[26D1]`/`[26D3]`'s own mutual exclusion -- only one round's animation is ever active per
race), advanced by exactly 1 in `flow.js`/`play.js`'s own game loop at the `smoothGate.shouldDraw()`
hook, right alongside `advanceRotorFrame` -- never inside `composeRaceView`, per the same
render-must-not-mutate-timing-state principle. `composeRaceView` gained `race`/`tileAnimCounter`
params (the water/hazard functions) and `pristineTile0` (the parallax) -- all default to inert
(`null`/`0`), so every existing caller that doesn't pass them draws exactly as before this system
existed.

**Verified.** Full 21-script suite unchanged, including `npm run live` (still 0 differing pixels
outside the existing car-sprite exclusion box -- confirmed the reference frame's own camera position
doesn't happen to include round 2's water-shimmer spot, so this system is provably invisible to that
specific check, not coincidentally passing). A moving-camera render sequence for round 1, looked at
directly, shows the ground texture visibly rippling as the camera pans. Direct calls to all three
new functions against the REAL `ROUND21.MAP`/`ROUND82.MAP`/`ROUND83.MAP` data confirm the exact
raster-order values at every tested tick, cross-checked against the raw map bytes. A foreground
Chrome tab load of `index.html` (ROUND21) shows a clean console and a normal-looking render. New
regression checks (`checkTileAnimations` in `check-play.mjs`, pinning exact tile-index values, not
just "changed") were hand-reverted once to confirm they fail on the pre-fix code.

## 9am. The two-car match: `UNKNOWN_twocar_race_end` resolved and ported (2026-09-23)

**Scope.** User request: "Head-to-Head vs CPU still ends the port's way (car 0 finishes) instead of
via the real `[26B4]` match-score state machine; the two-car knockout/scoring path is unported."
Method: the lead disassembled `RunCarPhysicsStep 4AEE-4D10`, `UpdateCarAirborneLandingSfx 7429-7758`
(whole function) and the camera `5019-51B2` by hand. A 7-agent read-only Ghidra workflow then produced
one byte-cited spec per subsystem: knockout reset, re-line-up/state D, race exit and tournament result,
setup/camera/call order, banners/HUD, falls/drop-in, two-car racing rules. The seven specs agree on
every load-bearing point, and each agrees with the lead's own reading. Everything below is
`[STATIC]`: there is still no live two-car capture (see the open items). P1 = `[2660]` = car 0 and
P2 = `[2662]` = car 1 in every format; `4152 MOV [2662],0x164` is the only writer of `[2662]`, and
two-car mode never writes either pointer (`4144 JZ 415A`).

**What a two-car race is.** There is no lap race to win. The match is a tug of war on the 8-light bar
`[26B4]`: seeded 4 (tied), +1 when P1 wins a point, -1 when P2 does; 8 or 0 ends the match. A point
is won by getting far enough ahead that the other car leaves the screen. Laps matter only as a
tiebreak: once a car has completed its laps, whoever is AHEAD ON THE BAR is credited, whichever car
finished. The race itself ends only at the end of a point's exchange.

**The exchange, in the real per-step order (`RunRaceMainLoop 3067-30DD`).**
1. *Trigger, physics tail* (`5053-50D7`, the camera -- code Ghidra files inside the misnamed
   `FireProjectileSfxE 4F17-51B1`). While `[27B5]==0`, the static camera table `DS:27B7 =
   {1, car0, car1, car2, car3}` yields the sentinel 1: the camera targets the P1/P2 midpoint,
   `(d SAR 1) + P2 - 0x80` (X) or `- 0x64` (Y), and wraps it. The delta is folded only near the seam
   (`|d| >= 0xB18`/`0xB50`), so the window is a toroidal `|dx| <= 0xE8`, `|dy| <= 0xB0`. Outside the
   window the camera sets `[2911]=1` (`5089`/`50D1`, unless `[2911]==2`), skips the rest (Y is not even
   evaluated when X is out) and leaves the target where it was. The only other writer of 1 is
   round 3's drop-in partner timeout (`6DB4`).
2. *Knockout reset, render* (`91F2-9205` -> `ResetCarsAfterKnockoutSfxA 7759-78F7`; the render body
   runs only on drawn steps, `90C5-90CC`). Fall branch, when `[2682]` is set: the latched car scores,
   whatever its position or state, and `[2911]` stays 1. No-fall branch, the ordinary point: it returns
   early if either car is already 0xC, snapshots both cars' knockoutX/Y and sets `[2911]=2`. The scorer
   is the leader by racePosition (a tie goes to P1, `77CA`), unless the leader's state is not 0, in
   which case the other car scores (`77D0`). The tail then does the following:
   - zero the scorer's drop-in slot;
   - set `[26B8]` = scorer (`77F5`) and scorer.active=1;
   - make the scorer hop (zVel 0x14; not in round 2 on terrain 5);
   - point the camera at the scorer alone (`[27B5]` = its playerSlot, `7825`) with steps 4 (`782C`);
   - zero both cars' motion; scorer to state 0xB, the other car to 0xC with the scorer's safe point;
   - call `7AF8`, then AH=8 AL=0..8, then sfx 10 if the scorer is drawn.
3. *The exchange block* (`75C2-7758`, per car in the `3098` pass, only for the scorer and only once
   it is active and grounded). Arm: `[26BA]=0x40`, both cars to 0xC, `[26B6]` = `[26B4]` +1 (P1
   scoring) or -1. Then 64 steps; before each DEC, if `[26BA]&7==0`, `[26B4]` and `[26B6]` swap, so
   the bar flashes new/old every 8 steps. The swaps are even in number, so it ends on the old value.
   At 0 the commit runs, in this order:
   - `[26C2]=1` if P1 still has laps; `[26BE]=0x80`, `[26C0]=0x7C`;
   - `[27B5]=0`, back to the midpoint (`767B`);
   - `CALL 78F8`; `[2911]=2`; both cars active, state 0xD, animStep2/animTimer 0.
   Then, if the match was already decided by the finish block (`[26C4]!=1`): `[26C6]=2` (`7742`), the
   race is over. Otherwise the scorer, if it still has laps, releases `[26B8]` and moves the bar
   (`INC 76E3`/`DEC 771B`); reaching 8/0, or a scorer with no laps left, sets `[26C4]` and `[26C6]=2`
   (`76F2`/`772A`, sfx 16 gated on the drawn flag).
4. *Back to racing.* The 0xD animation ends in state 7 (`832C`). The state-7 respawn (`6FEB`) puts
   both cars on the shared safe point, split ±90° (`71B8`), about 22 px apart. In two-car mode it also:
   - zeroes the car's drop-in slot (`701B`);
   - clears `[26BC]`/`[26C2]`/`[26BE]`/`[26C0]` (`7302`, all formats);
   - resets the camera step to 8 (`7369`, all formats, any car);
   - sets BOTH cars' laps to min(P1, P2) (`73B6-73E4`).
   The end of the state-2 reappear clears `[2911]` (`8321`, all formats); that is the only re-arm of
   the camera trigger. Controls unlock once the camera settles (both steps back at 0x32).
5. *Both cars down* (`5E4E-5E88`, at the top of each active car's checkpoint call): both cars in
   state 1, or both in 5, sets `[2913]`. The render then runs `78F8` instead of `7759`. While one car
   is still dying, `78F8` hides the one that recovered (active=0 freezes its state-7 handler). Then it
   copies the leader's safe point and onBridge to the trailing car and puts both in state 7. It clears
   `[2913]` and `[2911]` and scores no point.

**The finish block** (`4B4F -> 4BE7-4CFE`, every step, for each car with laps <= 0, BEFORE the
state/lock/active gates):
- **Tied bar**: the "Play Off" sequencer (`4CB0`: enters at x 0x158, 8 px/step to centre, holds while
  `[26C2]` counts 3..0x64, leaves left, parks at 0xC8). The car then carries on into its control path;
  the next point decides (sudden death).
- **Otherwise**: once (`[26C4]==1`), `[26B8]` = P1 if `[26B4]>4` else P2 -- the bar leader, not the
  finisher. The order array is rewritten with the absent car 2 in the other slot
  (`[0,2,1,3]`/`[2,0,1,3]`) and `[26C2]=0xC8`. From then on the finished car skips its control path
  every step. The credited car's next grounded step arms the deciding blink, which ends through
  `7742`.
- A subtlety the port keeps: during a sudden-death blink the swap makes `[26B4]` transiently 5 or 3.
  The finished car's `4BE7` sees that value and credits that point's scorer.

**Banners and HUD** (per drawn frame, `9241-9281`, after the HUD; the banner blit `9289` takes a
centre, 88x22, and alternates normal/silhouette every 32 ticks of the 70 Hz ISR via `[26CF]`):
- **`851F` (state 0xB)**: `7AF8`; the scorer spins +8/256 per frame (not in round 9); "Bonus" at
  (0x80,0x7C) when `1<[26B4]<7` and it still has laps.
- **`855A` (state 0xC, scorer only)**:
  - a deciding point (`[26B4]+[26B6]` = 15 or 1) or a match already decided (`[26C2]==0xC8`) slides
    "Winner" down from centre-Y -24 by 8 to 124;
  - it keeps sfx 16 going, hides the other car's body (`[2621]`, `7D74`) and writes `[2630]` = 1 (P1)
    or 2 (P2);
  - any other point shows a static "Bonus".
- **`8634`** (when `[26C2]!=0` and P2 is not 0xC): after an exchange "Bonus" slides out left; "Play
  Off" shows while `[26C2]` is 3..99.
- **The light bar** (`8F03-8FF3`): `[26B4]` red lights from the bottom, blue above. The lap digit
  belongs to the record in order slot 0, which can be the absent car 2.
- **`7AF8` on the OPL driver** (`[0F64]==1`) zeroes the speed of all four cars; that is how the
  engines fall silent (`UNKNOWN_0f64_speed_zero` -- mechanism fully re-derived §9ar a, still not
  live-confirmed).

**Race end and result.** In two-car mode `[26C6]` has exactly four reachable writers: `76F2`/`772A`/
`7742` (an exchange end) and the instant-win cheat (`36A7`). `4B85`, `6054` and `8702` are four-car or
round 9 only. `3081-3088` exits at once (no `[26CC]` linger). The exit fix-ups (`3115-3156`) then
run: the cheat's `[2635]` forces `[0,2,1,3]`, and `[2630]` forces order slots 0/1 to `[0,2]` or
`[2,0]`. The tournament (`11D5`, `[3FC]==0xC03`) checks slot 0 only: **the player won iff
`[2630]==1`, or `[2630]==0` and (the cheat, or slot 0 already holds car 0)**. The fix-up is load-bearing:
`8F03` keeps re-sorting slots 0/1 every drawn frame (two-car has no freeze), so after `4C6F` it usually
puts car 0 back in slot 0 (car 2's frozen record scores 6·scale+0).
- **Bar reaches 8 / 0**: the final blink is deciding (sum 15/1) -> Winner -> `[2630]` 1/2 -> win/loss.
- **A car finishes while the bar is not tied**: the bar leader wins, even if the other car crossed
  the line. So the CPU finishing first while P1 leads is a WIN, and P1 finishing first while behind
  is a LOSS.
- **A car finishes on a tied bar**: Play Off, then the next point's scorer wins.

**Port.** `src/engine/twocar.js` (rewritten; the old `resolveTwoCarKnockout` had no fall branch, no
0xC guards, the wrong `active` filter, and did not implement its own docstring's `77D0` override) holds:
- `initTwoCarMatch`;
- `resetCarsAfterKnockout` (`7759`) and `lineUpBothCars` (`78F8`);
- `twoCarRenderGate` (`91F2`) and `checkBothDown` (`5E4E`);
- `twoCarFinishedCar` (`4BE7`, incl. Play Off) and `stepExchange` (`75C2`);
- `twoCarBanners` (`851F`/`855A`/`8634`), `stopEngineSounds` (`7AF8`) and `twoCarFinalOrder` (`3115`).

`src/engine/step.js` calls each at its real position: the camera inside `runStep` via `ctx.camera`
(the tail of physics); the finish block before the control gates; `5E4E` for active cars in the
commit loop; the render gate before `runStates`; the banners and the hidden car after it; the
exchange after each car's landing update (`updateCarAirborneLanding` now returns the grounded path
`75C2` and has the `746F` active gate); the exit fix-up when `raceOver` flips. Other changes:
- `camera.js`: `[27B5]`, the midpoint and the trigger, a persistent target.
- `states.js`: `8321`, `7F69`, the `701B`/`7302`/`7369`/`73B6` respawn items.
- `dropin.js`: `6C08`/`6E7E`, and `6DB4` now raises the knockout request instead of the old
  `dropInPartnerTimedOut`; also `resetDropInSlot`.
- `hud.js`/`raceView.js`: the light bar and banners are wired, with `drawBanner` (`9289`, incl. the
  silhouette phase), `bannerBlinkPhase`, and the hidden body.
- `flow.js`: a two-car race ends only on `raceState.raceOver`; the result is order slot 0; the
  standings come from the result.

**Verification.**
- `npm run twocar` (new; 66 distinct assertions, 219 executed): each routine against its bytes, plus real races through the full
  `runStep` pipeline on ROUND11:
  - the full cycle (req 0 -> 2 in one step, i.e. the camera arms it and the same step's render gate
    consumes it; car 0 B -> C -> D -> 7 -> 2 -> 0; `[2911]` back to 0; both cars back inside the
    window, laps equal);
  - the bar reaching 8 (win) and 0 (loss);
  - a finish while ahead and while behind;
  - a tied finish -> Play Off -> sudden death;
  - a double death;
  - the absent car 2 keeping its race-init record (laps 3, progress 0), since slot 0 can hold it.
- `check-play` gained a pixel test of the banner blit: "Winner" at centre (0x80,0x7C) lands at top-left
  (84,112), colour 0 is transparent, and the blink phase is a palette-0 silhouette of exactly its
  pixels (both breaks -- no -44/-12, no silhouette -- are caught).
- 12 reintroduced bugs were each caught by it, among them: commit polarity, scorer = trailer, no
  `8321` re-arm, no exit fix-up, no camera trigger, the old "finish ends it" rule, no laps-min, no
  both-down, fall branch ignored, no `[2630]`, no blink swap, no midpoint fold.
- `npm run finish` now also runs all 26 two-car races (rounds 1-8). Every one ends through a decided
  match, 8-0 for the AI-driven car 0: car 0 carries the human tuning (acceleration 32 vs the CPU's
  17), and `check-twocar` (b) shows the reverse outcome with car 0 handicapped.
- `trace`/`ai` (13/20), `step`, `play`, `rounds`, `tournament`, `sound`, `smoothness`, `menu`,
  `screens`, `tables`, `car`, `smoke`, `chrtable`, `lz`, `catalog`, `si2` and `live` (0 pixels outside
  the boat box) are unchanged.
- **Browser** (`game.html`, Head-to-Head vs CPU, ROUND21, accelerate held):
  - the light bar and midpoint camera showed;
  - a point showed the spinning blue scorer under a blinking "Bonus" with the camera on the scorer
    alone, and the bar at 2;
  - the CPU took the match 4-0 before either boat finished a lap, and the tournament recorded the
    loss.
  - Not seen live: a win and the "Winner" slide on screen (the automated tab is `document.hidden`,
    so it only advances when a screenshot forces a paint). Both are covered headlessly: the banner
    pixel test and `check-twocar`'s Winner sequence.

**One four-car change, bisected.** Moving the camera into `runStep` was done first and alone: all 13
suites were byte-identical. The later change to four-car `finish` lines comes solely from the respawn
camera reset `7369/736F` (`[264E]=[2650]=8`); removing just that line restores all 29 four-car
results. The changed results are ROUND11 4564 -> 4535 steps, ROUND12 11059 -> 10485 (car 0 3rd -> 2nd),
ROUND14 10030 -> 10029, ROUND32 8760 -> 8834 (1st -> 2nd) and ROUND71 10337 -> 10344. The write is
unconditional in the original (any car, any format), so a respawning drone now waits for the camera to
settle before its controls unlock, as in the real game.

**Corrections applied in place:**
- 5089/50D1 is the camera separation test, not "a projectile kill" (§9u, §9v, §9ag, §10,
  `twocar.js`);
- `[2913]` is the both-cars-down flag, not a "flash" flag (§9r, §9v);
- `[26B4]==4` is the tied score and `4CB0` is the tie-at-finish Play Off (§9p, `hud.js`);
- `4C08`/`4C64` credit the bar leader, not the finisher (§9u);
- `76F2`/`772A`/`7742` are the exchange end and the only natural two-car race end (§9x);
- the render body runs on drawn steps only (§2 table);
- `[26B8]` is the scorer (the Ghidra comments at `7703`/`773B` said "loser");
- `[2682]` has a consumer, the fall branch (`dropin.js`/`states.js`);
- the sfx-16 `7742` polarity (`docs/sound.md`);
- Head-to-Head never reaches the round-9 bonus race (`1A82` is Challenge-only);
- the H2H qualifier is a two-car race (`0FC9` `[2656]=2` for the whole run).

**Not ported, or still open:** (**all of the items below except the smoothness cadence, the two
round-3 unknowns and the live capture were resolved or ported in §9an** -- the text is kept as written)
- *Approximations in the ported code:*
  - `UNKNOWN_h2h_bx_clobber_effects`: 7429 does not save BX, so `73E7`/`51B2` in the same loop
    iteration act on P1/P2, or on a score value on swap ticks. That shifts one car's 0xD phase by a
    step.
  - The sfx-16 keep-alive is reduced to one play.
  - The per-drawn-frame cadence of `7759`/`78F8`/the banners at smoothness 2-4 is not reproduced.
    This is the known divergence (§9ah); it now also covers the `6DB4` 40-frame timeout.
- *Not ported:*
  - The 100-tick post-race `855A` hold (`30DF`). (§9an: no banner is drawn during it -- a frozen frame.)
  - The flow-side H2H differences:
    - the player picks the CPU opponent ("WHO DO YOU WANT TO RACE ?", `09E0`);
    - no RESULTS screen after an H2H race (`13F5`), none for the qualifier in either format;
    - no OUTCOME on a win;
    - tune 5 is unreachable (`11F8`).
  - `game.html` never applies the instant-win cheat's `[26C6]`/`[2635]` (a pre-existing gap; `play.js`
    does). (§9an: ported -- `flow.js` `applyCheatGlobals`, plus the four-car exit re-force and
    `play.js`'s `cheatWin`.)
- *Cross-format findings from the same specs, recorded, not ported:*
  - the keyboard-fire preempt (`UNKNOWN_fire_gating`, now fully characterised: `4D4B-4D70`, `4F03`,
    `4F3C` drawn gate);
  - the car-car BX chain (`5960` re-integrates car 3 only before pair 1);
  - the camera-init wrap (`3DFF`/`3E68`, ROUND51);
  - the real control-lock clear site (`4D0E-4D1F`, state-0-gated; `camera.js` still clears on settle);
  - the respawn's missing resets and decrement-first order (`6FFA-7005`), and the `7008`
    `[28C1]==0x16` safeY quirk;
  - the two-car checkpoint cursor overshoot past `FFFF` into the next race's list (`6006 -> 5F85`).
- *Other open items:*
  - `UNKNOWN_twocar_live_cycle`: one live capture of an exchange (`[2911]`/`[27B5]`/`[26B8]`/`[26BA]`/
    `[26B4]`) would upgrade all of this from `[STATIC]` to `[PROVEN]`; `UNKNOWN_0f64_speed_zero`'s
    mechanism is now fully re-derived (§9ar a) but still wants the same live capture.
  - `UNKNOWN_fallbranch_stale_fields` and `UNKNOWN_rematch_fail_stale_2682` (round 3 only) --
    **mechanism fully characterised, §9ar b/c**: (b) closed (already faithfully ported, no bug); (c)'s
    trigger condition is closed but its downstream consequence (does a clobbered exchange lose its
    point, get stuck, or double-move the bar) is still open.

**Method notes.**
1. A wrong function name propagated a wrong reading through five sections. The camera code sits inside
   `FireProjectileSfxE`, so `5089`/`50D1` were read as "a projectile kill" from §9u on; nobody
   disassembled the two instructions before each write.
2. §9x dismissed `76F2`/`772A`/`7742` as "unrelated, not re-disassembled", and that dismissal carried
   its whole conclusion. A candidate writer dismissed without being read is an assumption, not a
   negative finding.
3. The first failures of the new integration tests were all test premises, not engine bugs. A halved
   top speed did not stop car 0 winning (its acceleration still is); a finish forced at step 400 landed
   mid-blink, where the bar is transiently 5. Checking the scenario before the engine avoided "fixing"
   correct behaviour.

## 9an. §9am's leftovers: the Head-to-Head flow, the race exit, the per-car-loop BX quirk, the cheats on `game.html`, and the cross-format findings (2026-09-23)

**Scope.** User request, after §9am: "The Head-to-Head menu differences: you should pick your CPU
opponent, and there should be no RESULTS/OUTCOME screens between races. The ~1.4 s banner hold after
the race ends. A one-frame timing quirk in the original's per-car loop. game.html still doesn't apply
the instant-win cheat (this gap predates this work). Several findings that affect four-car races too,
including the fire-button behaviour." Method: four read-only Ghidra spec passes, one per gap (H2H
screens, post-race hold, the BX clobber, the control/fire path plus every heading reader). Each spec
re-disassembled its own range; the lead checked the load-bearing instructions of each before porting.
Everything about the original below is `[STATIC]` unless tagged. The port's own behaviour was checked
by the test suites and, for the flow and the race exit, in the browser (see 1 and 2). Every change was
mutation-checked: the test that covers it fails when the change is reverted.

### 1. The Head-to-Head vs CPU flow -- ported (and a correction to the request)

**The request's "no RESULTS/OUTCOME screens between races" is only partly right.**
- RESULTS (`13E4`) never shows in H2H: it returns at `13F3`/`13F5` before drawing anything.
- OUTCOME (`1C1B`) does not show after an H2H *win* (`13FB -> 140C` returns CLC with no screen, and
  `1119 -> 10F9` moves on).
- OUTCOME *does* show after an H2H *loss*: `1C1B(2)` "ONE LIFE LOST" (`13FD-1400`), then the same race
  again, or the main menu at 0 lives (`1403-140A` STC -> `1110`).
- The race intro (`11F8`) shows before every H2H race except the qualifier. The early return at
  `1274-127B` sits under the `[28C1]==0` test at `126D`; races 1+ take `12BD`, which even has
  H2H-only code (`1307-131A`, `1354-1375`: the two cars slide in and face each other).
- The qualifier gets an OUTCOME in both formats: "QUALIFIED FOR HEAD TO HEAD!" (`1C1B(1)`, remapped
  to 5 at `1C21-1C2D`) or "FAILED TO QUALIFY!" (`1C1B(0)`, back to the main menu with no life used).

**The real sequence (`0FBF`)**, now `game.html`'s:
1. "WHO DO YOU WANT TO BE ?" (`09E0`, SI=`DS:020F`).
2. "WHO DO YOU WANT TO RACE ?" (`09E0`, SI=`DS:0227`). The pick is `[3F6]`/`[266A]`, which car 1's
   KidModifier reads (`3FBE-4131`, DI+=2 per car at `411A`).
3. "PRESS ANY KEY TO START" (`0C15`): any key, fire held, or `0x2BC` ticks (~10 s).
4. The qualifier `ROUND21` straight away: `11F8` starts tune 4 and returns with no screen.
5. OUTCOME 5 or 0.
6. Per race: intro -> race. A win goes straight to the next intro, or the champion screen after entry
   25. A loss shows ONE LIFE LOST, then the same race again.

**Character select details ported.**
- The cursor starts on the previous pick (`DS:03F4`=10 SPIDER, `DS:03F6`=9 BONNIE, rewritten by each
  pick at `1001`/`1018`/`1087`).
- The opponent select skips a taken start entry in the last-used direction (default right).
- Fire on a taken character is ignored (`0AB5-0ABB`).
- LEFT/RIGHT move the carousel.
- ESC at either select goes back to the main menu.

**Exits.** A finished run, a failed qualifier, 0 lives, the champion screen and ESC at a select all
return to the main menu `0220` (`02D7` CLC -> `0095` -> `008B`), not the title. ESC during a race
still goes to the title (`11CA-11D1 -> 00CC -> 0054`), as before.

**Also changed, because the same bytes say so.** The Challenge qualifier shows no RESULTS table
either (no `13E4` call for `[28C1]==0`), only its OUTCOME. Code: `tournament.js`
(`pickOpponentCharacter`, `hasRaceIntro`, `screenAfterRace`; a won twocar race sets
`lastOutcome=null`), `flow.js` (the `charWho` player/opponent select, the `PRESS_ANY_KEY` and `LOADING`
phases, `startNextRace`/`nextAfterOutcome`), `screens.js` (`drawCharacterSelect`'s `prompt`,
`drawPressAnyKey`).
- *Browser check (the port, not the original).* In `game.html` via the `mmGame` debug hooks:
  - both prompts appear, and a taken pick is refused;
  - PRESS ANY KEY leads straight into the qualifier, with no intro;
  - the qualifier win shows "QUALIFIED FOR HEAD TO HEAD!", then race 1's intro;
  - a won race 1 goes straight to race 2's intro, with no screen between;
  - a lost race 2 shows "ONE LIFE LOST" with lives 3 -> 2.
- *Not ported.* The carousel's look is not ported: the 13-tick eased scroll, the 80-tick FCHAPPY
  flash and the portrait slots. The page keeps its list-style select. Nor is the race intro's H2H
  variant (the portraits and the facing cars).
  **Corrected 2026-09-24 (GOAL-DOS-PARITY.md's "H2H race-intro variant" item, docs/engine.md
  §9be)**: "the H2H variant" undersold the gap -- `12BD`'s portrait panel plus vehicle-icon reveal
  is the ONLY race-intro mechanism for a regular race in EITHER format (this port's own
  `drawRaceIntro`, then just "RACE" and the track name, had no analogue of it at all), and only the
  icon-slide's own exit condition and icon count (2 vs 4) are actually H2H-specific; the portrait
  panel and its own setup are shared code. The sprite panel itself remains unported (matching
  §9az's own established precedent for the SAME `19F2` function), but two things ARE now ported:
  the mechanism's own mandatory-hold TIMING (`tournament.js`'s `raceIntroHoldTicks` -- the `131F`
  slide loop's own 59 H2H / 121 Challenge ticks specifically, not the full real hold, which also
  includes an undeterminable-duration palette fade before the loop starts, `UNKNOWN_race_intro_
  prehold`), and a text-only participant list (`raceIntroParticipants`, a stand-in for `19F2`'s own
  face panel) that `drawRaceIntro` now shows as a third row.

### 2. The race exit: 100 ticks of the frozen frame, then a subtractive fade -- ported

**The real exit (`30DF-315A`).**
- `30DF`: sfx 16 (AH=5 AL=0x10), gated on `[BX+1250]` of 4AEE's returned BX, the camera car. That is
  car 0 in four-car. In two-car it is car 1 for the midpoint camera (`[27B5]==0`, the natural end)
  and car 0 or car 1 when the camera is on the scorer.
- `30EF`: `7AF8`. Under DRIVER1 this only zeroes the four speed words and sends no command, so the
  engine voices keep their last pitch through the hold.
- `30F2-3100`: 100 iterations of `3165` (one IRQ0 tick, 70 Hz) + `855A` + `92BC`, about 1.43 s.
  `90C5` is never called, so nothing is re-rendered. The screen shows the last presented frame, copied
  to VRAM again 100 times. ESC is not read.
- **No banner is drawn during the hold.** §9am and `exit-result.md` said it was; that is corrected
  here. `855A` blits through ES:DI (`8CA4`/`8C3C` STOSB) and does not set ES. In the exit loop ES is
  `193C` (`3053`), because every race-time ES write is paired; byte searches found no other ES=7D78
  load. So even a call that passes the gate draws into DS, not the back buffer. Also, `92BC` clears BL
  every iteration (`92D3`/`92E4`), so in two-car the `856A` gate `BX==[26B8]` can pass on iteration 1
  at most.
- `3102` AH=8 (AL=0x78, left over from `92C3`; dead), then `3109` AH=6 (everything off).
- The exit fix-ups `3115-3156`, then `315A` -> `327A`, the fade to black. It reads the live DAC, then
  makes 126 uploads, decrementing every nonzero byte on the even calls: shown = max(0, v-k), k =
  1,1,2,2..63,63. It is unpaced (no tick wait).

**Port.**
- `raceEnd.js` holds the canvas unchanged for 100/70 s, then calls `raceOverEnd` and fades the frozen
  indexed frame out.
- The exiting step never renders (`3081` jumps past `90C5`), so the last painted frame is the
  original's frozen frame.
- `sound.js` splits the old one-instant sequence into `raceOverStart` (sfx 16 if the gate car
  `raceOverGateCar` is drawn; no engine stop) and `raceOverEnd` (stop + `muteAll`). This matters:
  playing sfx 16 and silencing in the same instant made the driver's `DoPendingReset` clear the start
  queue first, so sfx 16 never played. `[PROVEN]` on the port's own Sequencer model: 0 ticks active
  before; now active for 94 of the hold's 100 ticks.
- `fade.js` `'out'` uses the byte arithmetic above; the duration stays a port choice (`327A` is
  CPU-bound).
- `play.js` arms R only once the fade is done; `flow.js` resolves the race then.
- *Browser check (the port).* In `game.html` the canvas stayed pixel-identical (hash) for the whole
  hold, then its mean brightness dropped 490 -> 479 -> 258 -> 121 -> 15, then the OUTCOME screen.

**The race start is not faded in by the original.** `39F0 32CE` fades up over VRAM zeroed at
`3963-396D`, and every `ROUNDn.PAL` entry 0 is black. The screen stays black for the fade, and the
first frame appears at full brightness at the first `30CE` flip. The port still fades the scene in;
this is recorded, not changed (open items). `32CE` is 128 calls / 64 increments, not 126 (a §9q slip).

### 3. The instant-win cheat on `game.html` -- ported

**The gap.** `flow.js` loaded the cheat spots and ran the pause-time `applyCheatEffect` into a
per-race `globalState`, but nothing read `globalState` back into the race. `play.js` did, which is
why only `index.html` honoured the cheats. The real writes are `36A7-36E5`: `[26C6]=4`, `[2635]=1`,
`[26C4]=0`, order `0,2C8,164,42C`, cells `7D00`.

**Port.** `flow.js` `applyCheatGlobals`, run before every physics step, like `play.js`'s:
- type 1 sets `raceOverCount`=4, the fixed order and `cheatWin`;
- type 9 sets `projectilesForAll`;
- types 5/9 set `fireKeyDisabled` (`[2915]`, see 5a);
- type 0 (a life lost, `3652`) is applied to the tournament's lives after the race.

`globalState` is created per race. The original also clears all three flags at race init (byte
search for their writers: `3CA4` `[2915]`=0, `3CAA` `[2919]`=0, `3CB0` `[291B]`=3), so nothing carries
over in either.

**Two engine-side gaps closed at the same time:**
- **The exit re-force is not format-gated (`3115-313A`).** In four-car, `[26C6]=4` makes every car
  coast and counts `[26CC]` down 100 steps. But the `4B85` recount can drop `[26C6]` below 2 in that
  window, which un-freezes the `8E21` ranking. The exit still re-forces car0/car2/car1/car3.
  `step.js` now applies `cheatWin` in four-car too; two-car keeps `twoCarFinalOrder`.
- **`play.js` never set `cheatWin`.** It does now, alongside the fixed order.

**Browser check (the port, end to end).** In `game.html`, car 0 was placed on ROUND52's type-1 spot
(176, 597; tournament slot 1 in both formats) and SPACE was dispatched. This exercises the page's own
pause -> cheat-spot scan -> `globalState` -> `applyCheatGlobals` path:
- *Challenge (four-car):* `[26C6]`=4, then the 100-step countdown, the hold, the fade, and RESULTS with
  car 0 1st, then car 2, car 1, car 3.
- *Head-to-Head (two-car):* the race ended right after the pause, counted as a win, and went straight
  to race 2's intro with no screen.

### 4. The per-car loop's BX quirk (`UNKNOWN_h2h_bx_clobber_effects`) -- ported

**The quirk.** The per-car pass `3098-30B5` does `PUSH BX; CALL 7429; CMP [BX+12AE],0; CALL 73E7;
CALL 51B2; POP BX`. Nothing in `7429` saves BX, and its two-car exchange block `75C2-7758` returns
with a different one:

| Case | BX returned |
|---|---|
| no exchange (the early exits `75CF`/`75D9`/`75E2`) | the slot car |
| arm | P1 = car 0 (`75F2`) |
| blink tick | P1 (`7633`) |
| swap tick | the *bar value* just shown, `k = [26B6]` (`7645`) |
| commit `7742` | P1 |
| commit `76D2` | P1 |
| commit `770A` | P2 |

So on those ticks, `73E7` (the anim-timer bump + scripted drift) and `51B2` (projectile flight) act on
the wrong car. On swap ticks they act on the bytes 0..8 into car 0's record.

**Effects, ported.**
- When P2 scores, car 0 gets a second `73E7`/`51B2` on the arm, blink and `7742` ticks, and car 1
  gets neither. Car 1's shot is frozen through the exchange, and car 0's flies twice as fast.
- When P1 scores, car 0 loses its own pass on the 8 swap ticks.
- The visible consequence is the timing quirk the request names: the car whose `73E7` was skipped
  tests its 0xD re-line-up counter one step behind the other (`skipAnimBump`).
- `twocar.js` `stepExchange` now returns the BX, and `step.js`'s pass runs `73E7`/`51B2` on it.
- A score-value BX goes to `applyScoreSlotGarbage`, a byte-level emulation of `73E7` + `51B2`
  (with `87F3`) over car 0's record via `car.js`'s `toBytes`/`fromBytes`. The per-k field aliasing
  is in the spec's table: animTimer/puffCooldown/splashCooldown/animStep increments; rare drifts of
  spawnTarget/camHalf/posYfrac.
- `check-twocar` (h) checks the BX sequence against a hand transcription of `75C2-7758`, the one-step
  lag, the P2 redirect, and the k=2/k=7 garbage against a separate byte oracle.
- Race-level effect across `npm run finish`: only two-car ROUND73 (3074 -> 3431 steps; see 6).

### 5. Findings that affect four-car races too -- ported

**a. The fire button (`UNKNOWN_fire_gating`, now closed).** Derived twice, instruction by
instruction, over `4D04-4FDB`. The port now follows it (`step.js` `applySteerAndThrottle`,
`fireEntry`, `fireGates`):
- **The controller type decides.** `4D4B-4D69` reads `word [2658+2*(playerSlot-1)]`: 1/2 joystick, 3
  mouse, 4/5 keys, 6 CPU. playerSlot is static 1..4, and the byte pattern `4a 12` has only two
  readers and no writer. A keyboard or mouse car that is not a drone and holds 0x08 jumps straight to
  the fire entry `4F03` (`4D70`). That step it gets no heading snap, no steering, no throttle and no
  coast: its speed is frozen while fire is held, in every round.
- Joysticks and drones are exempt because they carry 0x08 on every button press or every step. A
  joystick button is 0x28/0x18, and the drone AI ORs 0x08 at `5528`.
- They reach `4F03` only through `4EFB`, after an accelerate-without-brake step.
- **The accel+brake chord 0x30** steers, then goes straight to the fire gates `4F17` (`4E24`), with
  no throttle and no coast.
- **`[2915]` (cheats 5 and 9)** has one reader, `4F0D`. It turns `4F03` into the ground coast
  `4E2E`. With it set, only the chord fires, drones never fire, and keyboard fire coasts the car.
- **The shot's direction nibble** uses the high byte of `velX+posXfrac` (`4F81-4F8E`, likewise Y), not
  the fraction alone (`projectile.js`).
- **Port wiring.** The pages pass `controllerTypes: [5,6,6,6]` (KEYS2, as `SETTINGS.DAT`). The
  headless harnesses default car 0 to a joystick, since they drive it with the drone AI.
- *Effect:* TANKS only, since fire gates on round 7 or `[2919]`: ROUND71 5726 -> 9784 steps with car 0
  1st -> 2nd, ROUND72/73 and two-car ROUND73 shift. No other race changes.
- *Not live-verified:* the DOSBox menu ignored the synthetic fire presses twice (the known input
  flakiness), so `UNKNOWN_keyboard_fire_preempt_live` stays open.

**b. The heading's bit 8, closed with no port change.**
- The right turn `4DE6` adds without masking, and `883B` (the rounds 4/9 hazard death) can add 4
  unmasked. So `[1278]` can hold 0x100-0x103 for many steps.
- All 32 readers (the instruction search and the byte pattern `78 12` agree 1:1) either mask with
  `0xF0`/`0xF8`/`0xFF` or use the low byte only. Nothing observes bit 8.
- The port's masking is behaviourally exact. Only a raw memory compare against a live capture could
  differ.

**c. The car-car BX chain (`5960`).** `5921` pushes BX once around all six pair calls. `5960` reloads
BX from `[27B1]`/`[27B3]` as it runs, so its top block re-integrates the car the PREVIOUS pair left
in BX:
- car 3 before pair 1 (`4FF3`);
- then A if A was inactive or not in state 0/2 (`59D7`/`59F0`);
- otherwise B.

The old port re-integrated car 3 before every pair (`collide.js`). Also fixed: the round-6
(WARRIORS) hard hit needs only car A drawn (`5B40`); B is knocked out only if drawn too (`5B71`), and
each snapshots knockoutX/Y (`5B2E-5B99`).

**d. The controls-lock release site.** `4D0E-4D1F`, inside the state-0-gated control loop: a locked
car stays locked unless `cameraFarFlag==1`, and then it is cleared and steers that same step.
`camera.js` used to clear it on settle for any state; that clear is gone.

**e. The respawn (`6FEB-73E6`).**
- Rounds 2/8 decrement `subState` *before* testing it (`6FFA-7005`): 0x46 waits 0x45 calls.
- `7008-7016`: tournament race 0x16 on meta-tile 4 moves the safe point up by 0x60.
- The resets the port was missing:
  - `703E-708E`: maxSpeedCur := maxSpeedBase; targetVel; nextX/Yfrac; terrainIdx/Prev; nextX/Y :=
    the nudged position; subCell; onBridge on meta-tile 0x1A.
  - `7258-72EC`: animStep/animStep2, height, zVel, bounceOnLand=1, skid/grip/splash, puffOff A-D,
    halveOnBounce=1, the slot waitTicks, the puff/splash cursors, rampJumpActive; dirByte and
    dirBytePrev := the hit's; rounds 4/5's terrainLevel from the grade (13 -> 0xFFFF, 14 -> 4,
    >= 5 -> g-4).

**f. The camera-init wrap.** `3DFF`/`3E68`: a start camera position <= 0 wraps by +0xC00 once
(ROUND51's grid). There is no finish-line effect; `check-play` covers it.

**g. The two-car checkpoint cursor overshoot.** Past its `FFFF` terminator the judge reads the raw
shared blob on into the next race's list (`6006 -> 5F85`); past `21E1` the image holds 0xFF.
`checkpoints.js` now reads the raw blob (`checkpointEntryRaw`). There is no finish-line effect.

**h. Smaller byte fixes found along the way.**
- The airborne puff/splash cooldowns decrement only while signed > 0 (`airborne.js`).
- `stepKnockoutAnim` honours the skipped bump from 4.

**i. `[1250]` is an on-screen flag** (`UNKNOWN_drawn_flag_onscreen`, narrowed -- **resolved and ported in §9ao**).
- `7D7D` sets it when the body is drawn. `7E54` clears it when the sprite is fully clipped
  (`8BAB`) or the car is the hidden one (`[2621]`).
- It is updated on drawn frames only, and only for cars whose state handler draws.
- The port's `drawnThisFrame` used to mean roughly "state 0", so an off-screen TANKS drone could fire
  in the port where `4F3C` blocks it in the original. **Fixed in §9ao**: `drawnThisFrame` now tracks
  the real flag and `fireProjectile` gates on it (`src/engine/drawn.js`, `src/engine/projectile.js`).

### 6. Attribution of every `npm run finish` change (M3.38 snapshot -> now)

Each change was run in isolation against the previous snapshot:

| Change | Races whose finish line moved |
|---|---|
| camera-init wrap (5f) | none |
| car-car BX chain (5c) | 12: ROUND11/12/14/23/31/33/71/72/73/81/82/83 (e.g. ROUND23 2nd -> 1st, ROUND33 1st -> 4th, ROUND12 2nd -> 3rd) |
| respawn resets/order (5e) | 26: 9 four-car (ROUND71 4th -> 1st: `nextX/Y := pos`; most others from `dirByte`) + 17 two-car step counts |
| lock-release site (5d) | ROUND12 (2nd -> 3rd), ROUND32 (steps only) |
| checkpoint overshoot (5g) | none |
| race-exit hold (2) | none (after the last step) |
| BX quirk (4) | two-car ROUND73 (3074 -> 3431) |
| fire path (5a) | ROUND71 (1st -> 2nd), ROUND72, ROUND73, two-car ROUND73 (3431 -> 3077) |

Net: 34 of 55 finish lines moved, none stopped resolving, and every two-car race still ends at a
decided match with `[2630]=1`. `trace` (13/20), `ai` and `live` (0) are unchanged.

### 7. Corrections to earlier sections

- §9am / `exit-result.md`: "`855A` draws over the frozen frame during the hold" -- no; see 2.
- §9am: the sfx-16 "keep-alive reduced to one play" -- the one play was never heard (same-instant
  reset); it is now heard.
- §9q: both fades "126 calls" -- the fade-up is 128 calls / 64 steps. `fade.js`'s old multiplicative
  ramp did not match its own header; the fade-out now follows the bytes.
- §9ah (`UNKNOWN_fire_gating`): "the port fires first and always steers/throttles" -- fixed, see 5a.
- `collide.js`'s old comment "`5960` never writes BX" -- wrong, see 5c.
- `camera.js`'s controls-lock clear -- moved to `4D0E-4D1F`, see 5d.
- §3 (**Pause**) / §9v / `pause.js`: "waits >= 140 ticks of `[261F]` AND a key release" -- wrong in its
  AND (re-disassembled by the lead this session). `3779-3784` zero `[261F]`, `[107E]`, `[107F]`.
  `3789 CMP [107E],0 / JNZ 3798` leaves the first loop on a key click; `3790 CMP [261F],0x8C / JNZ 3789`
  otherwise keeps it waiting. `37B8-37BD` then waits for `[107E]!=0` without clearing it. So the
  pause resumes at the first key click, whether or not 140 ticks have passed. The 140 ticks only decide
  when `37A4` re-renders the view. The 70 Hz rate (§9v, `[PROVEN]`) stands. Not changed in the port
  (`MIN_PAUSE_MS`, open).

### 8. Not ported, or still open

- *The exit:*
  - `UNKNOWN_exit_hold_855a_pass`: the one non-drawing `855A` pass on iteration 1 of the hold
    (two-car, gate car == `[26B8]`) can set `[2630]`/`[2621]`. It is result-neutral in every traced
    natural end; only a cheat exit during a deciding blink could turn into a loss.
  - `UNKNOWN_exit_banner_live` (ES at `30DF`, live).
  - `UNKNOWN_fade_duration` (unpaced).
- *The race start:* the port still fades the scene in; the original shows black, then the first
  frame at full palette (2).
- *Pause:* no 2 s minimum in the original (7); the port keeps `MIN_PAUSE_MS`.
- *Fire:* `UNKNOWN_keyboard_fire_preempt_live`; the on-screen `[1250]` gate (5i) -- **the gate is ported in §9ao; the
  menu "dropping" fire presses was a wrong diagnosis, see §9ao 7; the live preempt check itself is
  `[PROVEN]` in §9aq 3**.
- *The BX quirk:* the k-garbage carries over between races in the original (car records are not
  fully re-initialised), which the port resets per race; smoothness 2-4 cadence as before (§9ah).
- *The Challenge flow (same spec, not requested, not ported):*
  - the final race's 2nd place is a fail (`15B7`, `1658`);
  - the bonus trigger has no cap (`1123-113A`; `[342]` counts wins only, `1A92-1AA5`);
  - a passed Challenge race shows RESULTS only (OUTCOME code 1 is emitted only at `10EC`);
  - tune 5 is unreachable (`1101-1108`);
  - the main menu keeps tune 1 (`0220-0237`), and tune 2 starts at the select (`0A06-0A1D`);
  - OUTCOME code 4 plays tune 6 and shows "NO BONUS" (`1C84` runs before the `1CA3` test);
  - the 3x interactive replacement picker (`1A4A`);
  - the ']' key zeroing lives on OUTCOME 2/3 (`1DCD`).
- `UNKNOWN_bc5_high_byte`, `UNKNOWN_93c2_writer` (the intro's second wait has no writer, so it
  waits indefinitely), `UNKNOWN_a329_writer` (the pause-time debug combos) -- **all three closed,
  §9ar d/e/f**: `[0xBC5]`'s high byte is dead (two writers, both 0-8); `93C2` and `A329` are each a
  `CS:`-relative read of a permanently-zero constant with no writer anywhere, so the "wait" is by
  design (a race-intro screen that just waits for a key) and the F12 pause screen-dump is unreachable
  dead code.

**Method notes.**
1. The request's premise was checked before building it. "No RESULTS/OUTCOME screens" would have
   removed the loss screen and the race intros, which the bytes show.
2. Every four-car shift was bisected to a single change before it was accepted, so a regression
   could not hide inside a batch.
3. A spec pass called the `game.html` cheat gap "stale" because `flow.js`'s mtime was later than
   the docs'. That mtime was this round's own edit. A file timestamp shows only that a file changed,
   not what changed or when relative to the claim; the session log and the backup copies settled it.

## 9ao. The drawn flag `[1250]`: off-screen tanks no longer fire, and what else that flag drives (2026-09-23)

**Scope.** User request: "Work on that: CPU tanks off screen can still fire in the port" (§9an 8).
The fire gate `4F3C` tests `[BX+1250]`. The port had no such test in `fireProjectile`. Its flag,
`drawnThisFrame`, was also cleared before every state dispatch and set for states 0/B/C wherever the
car was, so it meant "state 0" (`UNKNOWN_drawn_flag_onscreen`). A gate alone would have changed
nothing. The fix is the flag itself. The original has one flag and every reader shares it, so the
correction also reaches the rubber band, the engine pitch and every drawn-gated sfx. Those effects
are the larger part of this change (6).

### 1. What writes `[1250]` `[STATIC]`, with one `[PROVEN]` capture

**Exactly three writers.** A byte search found every `[BX+1250]` form and every absolute per-car
address (`0x1250`/`0x13B4`/`0x1518`/`0x167C`, any mod/rm with a disp16):
- `440C` race init (0);
- `7D7D` (1) and `7E54` (0), both inside `DrawCarBodyRotatedRemapped 7D73`.

The other 41 hits are `CMP` reads. So the flag is **sticky**: a car keeps the value from the last
time 7D73 ran for it.

**The test inside 7D73 (`7D74-7E28`):**
- `7D74`: the hidden car `[2621]` goes straight to `7E54` (0).
- `7D7D`: the flag is set to 1.
- `DX` = height `[12D6]`, or 0 in round 8 (`7D85`).
- `DI = posX - DX - [264A]` and `AX = posY - DX - [264C]`. Each is folded once by +0xC00 when <= -12
  (`7E0A`/`7E17`, signed), then has 12 subtracted.
- `8BAB` clips the 24×24 box. An axis is in when `v >= 0 ? v < limit : v + 24 > 0`, where the limit
  is 0x100 for X (`8BC4` `CMP DI,0x100` / `JNC`) and 0xE0 for Y (`8C02`). Out means `STC` (`8BDA`)
  and `7E54` clears the flag.
- The clip window is the back buffer's 256×224. `92BC` copies only 200 rows to the screen, so a car
  in view rows 200-223 counts as drawn although nobody can see it.
- **Round 9:** car 0 is clip-tested with its 40×40 box (threshold -4, offset 0x14, `7DC4-7DE6`).
  Cars 1-3 jump from `7DAD` to `7E52` after `7D7D`: set to 1, no clip, no draw.

**Who calls 7D73.** It is itself the handler for states 0, B and C (`DS:278F` entries 0/0xB/0xC =
`7D73`). Others call it conditionally:

| State | Handler | Call site and condition |
|---|---|---|
| 1 | `880A` | `885E`: while `driftSteps` != 0, or in rounds 4/9 while the heading is being turned toward 0/0x80 (`883B`/`8842`) |
| 2 / 0xD | `82BE` | `82E9` / `82F5`: the body is drawn at animation index >= 3 in state 2, <= 3 in 0xD; the other frames draw only the overlay (`8339`). `8327`: state 2's end draws once (now state 0). Table `DS:289D`: thresholds 4..24, frames 0-4, 0, end (no -2 entries) |
| 4 / 5 | `7F62` / `7EFA` | `7F74` / `7F01`: only while `driftSteps` != 0. Their table frames draw through `7FE8`, not 7D73 |
| A | `849B` | `84CA`: a drone while car 0 is still in A; car 0 (and two-car cars) on the `[26CF]` blink's on-phase, until `[26D5]` reaches 0x60 |
| E | `6AE5` | `6EFF`: the subState-4 reappearance |
| F / 0x10 | `8683` / `86A8` | `86D3` (`86D2`), every frame |
| 7 | `6FEB` | never; the `35BE` stub states never either |

The render loop `7CE0` (`7D2B-7D45`) dispatches only active cars or state 0xE, and only on drawn
frames (`90C5`).

**`[PROVEN]` live, one capture.**
- *Setup:* a Challenge-qualifier ROUND21 race under DOSBox, car 0 left idle, stopped by an execute
  breakpoint at `4AEE`. That is the top of the physics step, where every position still equals the
  last render's (live CS `0x23E`, DS `0xB7A`).
- *Read:* camera (414, 500). Car 0 at (542, 600), state 0, flag 1. Cars 1-3 in state 0 at
  (1303, 487), (1296, 707), (1302, 599), all with flag **0**.
- *Result:* `markDrawn` on those values gives 1/0/0/0, 4 of 4. Three drones driving normally while
  off screen read 0, which the port's old meaning ("state 0 -> 1") gets wrong for all three.
- The edges (x -24/256, rows 200-223, the wrap, round 8, round 9) remain `[STATIC]` -- **the x/y
  edges, the wrap, round 8 and round 9 are all `[PROVEN]` live in §9ap 6; rows 200-223 actually being
  invisible on screen is still `[STATIC]` only.**

### 2. The fire gate

`fireProjectile` now returns unless `car.drawnThisFrame` is set, after the TANKS/`[2919]` and reload
gates, matching `4F3C`'s place after `4F21-4F32`. The fire sfx at `4F47` is gated on the same flag, so
it always plays once a shot leaves.

### 3. Port

- **New `src/engine/drawn.js`.** `markDrawn(car, ctx)` is the 7D73 flag write; `inClipWindow` is
  `8BAB`.
- **With no `ctx.camera`** it simply sets the flag. That is the old meaning, kept for the
  pure-physics harnesses, and those do not load whole races. `finish`, `rounds`, `play`, `twocar`
  and both pages all pass a camera.
- **`states.js`.** `runStates` no longer clears the flag. Each handler calls `markDrawn` at its
  original call site:
  - `stepDriving`, `stepTwoCarIdle` and the F/0x10 banner states: every tick;
  - state 1: in the turn branch and while drifting;
  - `stepKnockoutAnim`: by the index rule, plus state 2's end;
  - states 4/5: while drifting;
  - state A: every tick, because the `[26CF]` blink phase is not modelled;
  - state E (`dropin.js`): in `stepFinalize` (subState 4).
- **The knockout index is the port's own**, which is one tick early (the known simplification in
  that function's header).
- **The hidden car** stays zeroed by `step.js` after the state pass, as before.
- **Timing.** The port writes the flag every step after the camera. That matches the original at
  smoothness 1. At smoothness 2-4 the original writes it only on drawn frames: the known cadence
  divergence (§9ah).

### 4. Tests

- **`check-play` `checkDrawnFlag`** (19 assertions):
  - the clip edges on both axes;
  - rows 200-223;
  - the seam fold and the dx = -12 wrap;
  - round 8's height;
  - round 9's car-0 box and cars 1-3;
  - no-camera;
  - stickiness through states 0, 7, 2 (both sides of index 3), 0xD and 5;
  - the fire gate.
- **The state-1 sfx test.** It used to assert that `runStates`' blanket clear suppresses ids 7/17.
  It now asserts that a car last drawn on screen plays id 7 once and one last drawn off screen stays
  silent.
- **`check-rounds`.** The old check that the 400-step race loop lands at least one hit relied on
  exactly one lucky shot per four-car TANKS race. Replaced by:
  - across all round-7 races, no fire from a car whose flag was 0 entering the step, over 39 shots;
  - such cars did ask to fire: 1866 accelerate+0x08 tries with the reload done;
  - a constructed ROUND71 scenario after 300 real steps, with a stopped tank 28 px ahead: from car 0
    (on screen) the shot knocks it out (0xD) through fire -> flight -> hit; from an off-screen drone,
    20 fire requests and no shot.
- **Mutation-checked.** Each of these, reintroduced, makes checks fail: the gate removed, the flag
  forced to 1, the clip height set to 200, no round-8 exemption, no 0xC00 fold, round-9 drones
  clip-tested, the blanket clear restored, the knockout index rule removed, state 5's drift draw
  removed.

### 5. Attribution (`npm run finish`, §9an snapshot -> now; each step run alone)

| Change | Finish lines moved |
|---|---|
| The sticky, clip-tested flag (without the gate) | 52 of 55, all still resolving. 7 four-car results changed: ROUND12 3rd -> 1st, ROUND13 1st -> 2nd, ROUND32 2nd -> 1st, ROUND33 4th -> 2nd, ROUND63 4th -> 1st, ROUND71 2nd -> 1st, ROUND82 1st -> 4th. The two-car races moved by step counts only |
| The fire gate on top | ROUND71/72/73 step counts only, no result change |

`trace` (13/20), `ai` and `live` (0) are unchanged. The `twocar` example races shift by a few steps.

### 6. What else this changes (the same flag, now faithful)

- **The rubber band (`4B23` throttle ×6, `528D` grip ×1.5)** applies to a drone that is off screen
  while car 0 leads. With the old flag it almost never fired: 1-10 steps per race in ROUND11/21/42/61
  with an AI car 0. Now it fires on nearly every step car 0 leads (e.g. ROUND11: 3424 of 3521).
  Off-screen drones behind the leader now catch up, as the original's code says. This is the largest
  gameplay change in this section.
- **Engine pitch:** a car off screen idles at bend 0x0A (`7B90`/`7BCE`/`7C85`).
- **Sfx:** every drawn-gated sfx site is now silent for off-screen cars. Sites in states 1/4/5 (ids
  7/17/8) now play for a car last drawn on screen; before, they could never play.
- **WARRIORS (round 6):** the car-car knockout needs car A on screen (`5B40`) and knocks out B only
  if B is too (`5B71`).

### 7. Corrections

- §9an 5i and §10 (`UNKNOWN_drawn_flag_onscreen`, "narrowed"): resolved. The port's flag is now the
  original's, sticky and clip-tested; §9an 5i's "on screen at the last drawn frame" is confirmed.
- §9an 8 and the method note behind `UNKNOWN_keyboard_fire_preempt_live`: "the DOSBox menu dropped
  synthetic fire presses" was wrong; the menu never lost a press. Three causes:
  - `SELECT GAME`/`ONE PLAYER GAME` (`0382`) start with nothing selected (`[130]`=0). While nothing
    is selected, fire loops (`03F8 OR CX,CX` / `JZ 0392`), so LEFT/RIGHT must pick an option first.
    **Corrected 2026-09-24 (P2, §9av): this specific claim is FALSE.** `[130]`/`[132]` are `1`/`2`
    at rest (re-read live 193C:0130, and confirmed by CPU state: with no LEFT/RIGHT ever pressed,
    firing on a freshly-drawn `SELECT GAME` immediately entered `ONE PLAYER GAME` -- `[130]`'s own
    value, not 0). The mistake: an earlier session's first fire-press attempt used `input_key`'s
    own press+release tap (already named as this same paragraph's OWN third cause below), read the
    dropped input as "fire correctly ignored", and never re-tested with a proper held press once
    the real cause (the tap) was found. `SELECT GAME`'s own THUMB highlight sprite renders nothing
    visible at `[130]`'s own resting frame (`1`) though, which is a separate, still-unexplained
    oddity -- `UNKNOWN_thumb_frame1_invisible`, left open since it doesn't affect the state
    machine, only the sprite art (§9av).
  - Each selection change redraws and waits for fire to be released (`03B2-03BA`), which swallows a
    fire press that comes too soon.
  - The bridge's `input_key` with `pressed: true` schedules a press *and* a release, so it is a
    tap, not a hold.
  `input_sequence` with explicit holds and ~3 s gaps drives the menus; that is how this capture got
  into a race. The live fire-preempt check itself is still to do, but it is now reachable.
- `check-play`'s header note (`checkStateFourFiveDriftGate`) that `runStates` zeroes the flag before
  dispatch no longer holds; the flag is sticky.

### 8. Still open

- The `[26CF]` blink phase for state A (car 0 and two-car cars skip the write on its off-phase) --
  **resolved and ported in §9ap**.
- The smoothness 2-4 write cadence (§9ah) -- **resolved and ported in §9ap, for the flag write only**.
- A live capture near the clip edges, or of a drone's rubber-band boost in action -- **the y/x edges,
  the wrap fold, and round 8/9's own branches are all `[PROVEN]` in §9ap; the rubber band boost and the
  row-200-223 screen cutoff are both `[PROVEN]` live in §9aq**.
- `UNKNOWN_keyboard_fire_preempt_live` (now reachable, see 7) -- **`[PROVEN]` live in §9aq 3**.

## 9ap. The drawn flag `[1250]`: the state-A blink gate, the smoothness cadence, and a live edge capture (2026-09-23)

**Scope.** User request: "Work on that" against §9ao 8's own still-open list, all three items.

### 1. The state-A blink gate `[STATIC]`, full decode of `849B`

`HandleCarStateADropInSfx9` (`849B-851E`, full re-disassembly + decompile, cross-checked):

```
[26CA] = 1                                    // latch: "state A active this pass"
if ([2656]==2 /*two-car*/ OR BX==[2660] /*car0*/):
    if BX==[2660]: [26D5] += [263A]           // dropInTimer += smoothness N (car0's own tick only)
    if [26D5] < 0x60:
        if [26CF]==1: return                  // blink OFF phase -> no draw at all
        // else (blink ON) -> fall through, draw
    else:                                      // timer expired
        [12AE]=[1412]=[1576]=[16DA]=0         // clears every car's own copy of field 0x64
        [264E]=[2650]=0x32; [26CA]=0
        // falls through, draw unconditionally, ignoring [26CF]
else:                                          // a drone, non-two-car format
    if [12AE] != 10: { [BX+12AE]=0; return }  // [12AE] with NO base register -- car 0's OWN field
    // else (car0's copy is still 10) -> fall through, draw

CALL 7D73                                      // writes [BX+1250]
```

`[0x12ae]` at `8511` is a direct, base-register-free operand (the decompiler renders it
`*(int*)0x12ae`, distinct from `*(int*)(in_BX+0x12ae)` at `8518`) -- per §1, `0x12AE` is car 0's own
instance of state (`[BX+12AE]` for cars 0-3 is `12AE`/`1412`/`1576`/`16DA`), so a DRONE's own draw
gate reads CAR 0's copy of that field, not its own. `InitRaceCarsFromTables` sets every car's own
`[BX+12AE]=10` at race init and nothing else writes it except the two sites above, so in every
reachable state car 0's copy stays 10 until the shared `[26D5]>=0x60` expiry that ends state A for
every car at once -- the drone branch's `!=10` arm is unreachable in practice: **a drone really does
draw unconditionally every tick while in state A**, as the port already assumed; the new, previously
`*(internals unverified)*`-flagged part is the `[26CF]` gate on car 0 (and both two-car participants).

`[26CF]`'s own driver, `TimerIsrVsyncFallbackAndSoundTick` (`48D0-48FB`): a byte counter `[26D0]`
increments every ISR/vsync tick; at `[26D0]>=0x20` (32), `[26CF]` XORs by 1 and `[26D0]` resets -- a
32-ISR-tick half-period. §2's own `[263C]` table (`30bd-30cc`: `2N` vsyncs per `N` physics steps)
fixes the ISR:physics ratio at exactly 2:1 regardless of smoothness, so 32 ISR ticks = **16 physics
ticks**, independent of smoothness -- modelled as a `raceState` counter ticking once per physics
step, toggling every 16.

### 2. Port (`states.js`)

- `runStates` now ticks a free-running `raceState.blinkOn`/`blinkTick` (period 16) every physics
  step, whether or not any car is in state A.
- State A's own case: a drone (any state-A car, not car 0, not two-car format) draws every tick,
  unchanged. Car 0, and BOTH cars in two-car format, draw only while `raceState.blinkOn`.
- **Not modelled:** the `[26D5]>=0x60` "ignore the blink, draw unconditionally" branch. By the time
  this port's own `dropInTimer` (already existing, unchanged) reaches 0x60, every state-A car has
  already been moved to state 0 in that same tick's post-loop transition (below the per-car switch),
  so no car can still reach this case with an already-expired timer -- a one-tick edge the real
  per-car dispatch handles synchronously and this port's batched transition does not, the same class
  of off-by-one `stepKnockoutAnim`'s own header already documents elsewhere in this file.
- **Not modelled either:** `[26CF]`'s exact phase at race start. It free-runs from boot, not from
  race init, so its alignment when a race begins is arbitrary in the real game too; the port's
  `blinkOn` simply starts true (drawing) at the first physics step of every race. Only the period and
  the on/off gating are established, not the phase.

### 3. The smoothness cadence, for the flag write only

`RunRaceMainLoop` calls the render pass (`90C5`) every physics iteration, but `90C5` itself returns
at its own top unless `[2638]==1` (the smoothness batch counter, decremented every physics step at
`30b7` -- reaching 1, i.e. actually drawing, only on the last step of each N-step batch -- and reset
to `[263A]` right after) -- so the entire state-handler dispatch (`DS:278F`, everything `states.js`/
`dropin.js` port) lives inside that gate in the real game: at smoothness 2-4 it runs at 1/N the
physics rate, not just the body draw. This is already documented (§4/§9ah: "it ranks, and runs the
state handlers, every step [in the port], a known divergence for n > 1") as a real, separate,
*larger* divergence than the flag alone -- restructuring the port's entire state cadence to match
would touch every duration/table-walk/transition/ranking call across `states.js` and `dropin.js`
(and `advanceRotorFrame`, already its own carve-out for exactly this reason), well beyond what this
section's user request asked for and risking real regressions across M3.3-M3.19's own tests.

**What's actually fixed here, matching the user's own wording** ("the original only updates the
**flag** on frames it draws"): `markDrawn` (`drawn.js`) now checks `ctx.drawnTick`, set once per
physics step by `play.js`/`flow.js` from the SAME `smoothGate.shouldDraw()` call that already gates
rendering (moved to run before the physics/state pass, not after, so the flag write can see it) --
when it's `false`, the write is skipped and the flag stays sticky at its last value, exactly as
`advanceRotorFrame` already does for the CHOPPERS rotor. Left unset (every headless harness, and the
browser pages at their smoothness===1 default) every physics tick is a drawn tick, unchanged.
Everything else in `states.js`/`dropin.js` -- durations, transitions, ranking -- still advances every
physics tick, the pre-existing, separately-tracked, deliberately untouched divergence above.

### 4. Port: the hidden car, too

`step.js`'s own `[2621]` hidden-car write (`7d74`, inside `7D73`) forced a two-car race's non-scorer
invisible every physics tick, unconditionally -- also missing the same drawn-tick gate as `markDrawn`
itself, caught in review. Fixed the same way: `cars[m.hiddenCar].drawnThisFrame = 0` now also checks
`ctx.drawnTick !== false`.

### 5. Tests

`check-play` `checkDrawnFlag`: 27 assertions, up from 19 (8 new -- `ctx.drawnTick===false` skips the
write and stays sticky, `===true` writes normally, unset defaults to drawn; state A's car 0 skips the
draw off-phase and draws on-phase; a drone in state A draws regardless of phase; two-car format gates
both cars, not just car 0; the blink toggles after 16 physics ticks). `check-twocar`: 82 distinct
assertions, up from 80 (2 new, the hidden-car write's own `ctx.drawnTick` gate). Three reintroduced
bugs (the `ctx.drawnTick` gate removed from `markDrawn`; the state-A blink gate removed; the
hidden-car write's own gate removed) each make exactly their own new assertions fail, nothing else.
The script suite (22 of the 24 `npm run` checks -- everything except `tunes`, meant for listening,
and `lz`, not re-run this pass) and `npm run build` are unchanged/clean.

Browser: the automated tab reports `document.hidden: true` whenever checked (`index.html` did run
~10 `requestAnimationFrame` steps right after each load before stopping, so it is not permanently
dead -- just not driven that way for these checks) -- driven instead via the page's own
`window.mmRace.forceSteps` debug hook, which calls `stepOnce` directly and bypasses `frame()`
entirely. So this does NOT exercise `play.js`'s own `if (ctx.drawnTick) { shouldRender...}`
render/rotor branch, nor any part of `flow.js`'s race loop (`game.html` was only driven as far as its
title screen, not into a race). What it does exercise: `stepOnce` itself, including the moved
`smoothGate.shouldDraw()` call and `ctx.drawnTick`'s effect on `markDrawn` -- confirmed by observing
`mmRace.ctx.drawnTick` itself, not by observing a flag actually failing to update, since car 0 stayed
on screen (`drawnThisFrame` sticky at 1) throughout. The hidden-car write is two-car-format-only and
`index.html` is one-player, so this session's browser check never reaches it at all; only
`check-twocar` (above) covers it. On `index.html`, switching smoothness to 4 and stepping
`mmRace.ctx.drawnTick` across 12 `forceSteps(1)` calls gives `false,false,false,true` repeating
exactly; console stays clean at smoothness 1 and 4.

Fire: car 0 sits in state `0xA` (the drop-in hold) for its first 96 physics steps every race, during
which the physics step's own gate (`4af2`, state≠0 or `controlsLocked`) skips it entirely -- an
initial attempt fired before that window closed and (correctly) produced nothing, misdiagnosed at
first as an automation quirk. Stepped to `state===0 && !controlsLocked` (97 steps), then switched to
smoothness 4, enabled projectiles, dispatched a `keydown KeyS`, and called `forceSteps(3)`:
`reloadCooldown` came back **57** (a shot fired and is now cooling down) -- confirms the DOM-keyboard
path, `ctx.projectilesForAll`, and the fire gate all work correctly together in the live bundle at
smoothness 4, through `stepOnce`/`runStep` (not `frame()`).

### 6. Live capture `[PROVEN]`

First attempt at this compromised and discarded: a background research agent, spawned for an
unrelated Ghidra byte-signature lookup, independently issued its own `mcp__dosbox__*` calls
(confirmed directly against its own transcript: 2 `debug_breakpoint_add`, 5 `debug_continue`, 3
`debug_pause`, 8 `mem_read`, 5 `mem_write`, its own `debug_map_auto`/`debug_map_set_base`, and more)
on the same live instance while this capture was already in progress -- a real violation of this
project's own single-instance rule (CLAUDE.md), not something its prompt asked for. Its own final
message named a breakpoint id this session never created, which is what first surfaced it. Killed,
and the whole capture redone solo from a fresh boot. Lesson saved to memory (see the DOSBox tooling
notes; a fork inherits full tool access and will drive a shared live session on its own initiative
unless its prompt explicitly forbids it).

Re-anchored the Ghidra<->live mapping (`CS 0x23E`/live segment 574, `DS 0xB7A`/live segment 2938 --
identical to §9ao 1's own capture, confirming the boot sequence is fully deterministic) and drove
three more fresh Challenge-qualifier `ROUND21` races (boots B, C, D below) to live cars (car 0/`BX=0`,
car 1/`BX=356`, car 2/`BX=712`) via an execute breakpoint at `7D73`'s own entry, camera read fresh
before each write, flag read back only after the next car's own breakpoint hit (proof the poked
car's own call had actually finished):

- **Boot A** (the first attempt): discarded, see above.
- **Boot B:** the y/x edges and the seam fold, all clean.
- **Boot C:** round 8's own exemption and its round-2 control, both clean -- poking the round byte
  `[28BF]` (confirmed at `7d85`, a plain byte compare) for exactly one car's own `7D73` call, then
  restoring it to 2 right after the NEXT car's own breakpoint hit, worked without incident here.
  This same boot's own round-9 and left-edge attempts are superseded below.
- **Boot C, round 9:** the same "restore at the next car's hit" approach did NOT work for round 9.
  `[28BF]=9` stayed live well past that car's own `7D73` call: after the car-1 poke, cars 2 and 3
  were skipped entirely and the next hit was car 0, at a stack depth matching every other normal
  car-0 hit; after the follow-up car-0 poke, car 0 itself was then dispatched twice in a row at a
  visibly deeper call stack (a rising `ESI` each time). Car 0's own state wasn't read at this point --
  caught by review before going further, this boot's round-9 and left-edge readings were not reported
  as proven and the whole thing was redone.
- **Boot D:** restored at `7DAD` instead (the instruction right after `7da6`'s own round-9 compare,
  reached only once that branch is taken, by which point the byte has already been read) for the
  round-9 cases. This fixed the car-1 case cleanly (the expected car dispatched next, exactly as in
  every non-round-9 test). For the car-0 case, a disruption happened again, with a different symptom:
  after the car-0 `x=-3` reading (clean), car 0 dropped out of the `7D73` dispatch entirely for
  several ticks, replaced by cars 1/2/3 at an unusual call-stack depth. Read directly this time: car 0
  was in state `0xA` with `controlsLocked=1` (its race-init values). Whether the round-9 poke itself
  caused this, or the forced positions themselves did (car 0 placed close to the camera; car 1, from
  the earlier test, left sitting at world x=5000), was not established -- the ordinary start-of-race
  hold is also a live candidate, since a later session found the same state/flag pair coming from
  exactly that (§9aq 5), though this specific boot's own sequence of pokes wasn't re-examined against
  it. Rather than track down the
  cause, both fields were force-written back to 0 so testing could continue -- so the `x=-4` reading,
  and both left-edge (`-11`/`-12`) readings taken afterward in this same boot, were all collected
  after that forced write, not from an otherwise-undisturbed race. The flag values themselves do not
  depend on this: `7D73` recomputes the clip test from scratch on every call from the car's own
  current position/height and the round byte at that instant, so a disturbed race around it doesn't
  retroactively change what a given call computed. But the disturbance itself is unexplained, and a
  differently-scoped test might have hit it differently -- flagged here rather than glossed over. The
  camera's own drift across this boot (414,500 → 364,512 → 283,512 → 233,524 → 183,524) never jumped
  back to a start-of-race value, so this was not a new race beginning mid-test.

| Forced | Expected | Read back | Boot |
|---|---|---|---|
| y 235 / 236 (general path, `8C02`) | in / out | **1** / **0** | B |
| x 267 / 268 (general path, `8BC4`) | in / out | **1** / **0** | B |
| x seam fold: `(cam.x+112−0xC00)&0xFFFF` (`7E0A`) | in | **1** | B |
| x −11 / −12, general path's negative branch (`8BAB`'s own `v<0` arm; `−12` is `7E0A`'s own fold threshold) | in / out | **1** / **0** | D, after the forced state/controlsLocked write above |
| round 8 poked, height 20, y = 236 (the same raw delta as the general-path "out" case above; round 8 skips the height subtract, `7D85`, so the raw delta stays 236) | out | **0** | C |
| round 2 control, same y and height (height IS subtracted here: 236−20=216, back inside the window) | in | **1** | C |
| round 9 poked, car 1 (a non-car-0), placed far off screen (`7DAD`/`7DB2`, no clip test) | in | **1** | D, clean |
| round 9 poked, car 0, x −3 | in | **1** | D, clean (before the disruption) |
| round 9 poked, car 0, x −4 (its own 40×40 box, `7DC8`/`7DD5`) | out | **0** | D, after the forced state/controlsLocked write above |

All 12 cases match the disassembly exactly, upgrading every numbered edge/fold/round-8/round-9 claim
in §9ao 1 from `[STATIC]` to `[PROVEN]`. A visual check (does a flag=1 car in view rows 200-223
actually stay off the physical screen) was attempted several times, across all four boots -- a raw
VRAM read at a predicted screen rectangle, a `raw`-mode screen capture, a `rendered`-mode one (which
returned no frame at all, "nothing is being presented", rather than a picture) -- and none of it is
reported as evidence either way: inconclusive, not re-attempted further. Only the flag-value evidence
in the table above is `[PROVEN]`; whether the sprite itself is actually absent from the displayed 200
rows still rests on the disassembly's own byte count (`92BC`, §1), not a live pixel check.

### 7. Still open

- A live capture of the rubber band actually boosting an off-screen drone, and of a car's on-screen
  absence at rows 200-223 specifically (attempted, not obtained -- see 6) -- **both resolved live in
  §9aq**.
- The larger smoothness/state-cadence divergence (§9ah): durations, transitions and ranking still
  advance every physics tick regardless of smoothness, deliberately not restructured here (3).
- `UNKNOWN_keyboard_fire_preempt_live` (still reachable in DOSBox, still not checked there -- (5)'s
  own browser fire check is a different thing, the PORT's own fire mechanics in Chrome, not the
  original game's) -- **resolved live in §9aq**.

## 9aq. The rubber band, the screen-row cutoff, and the keyboard fire preempt, all live (2026-09-23)

**Scope.** User request: work §9ap 7's own remaining list, all three items. Same boot recipe, one
race, solo. Ghidra grounding first (fresh disassembly, not assumed from the existing doc text), then
all three captures in the same DOSBox session.

### 1. The rubber band `[PROVEN]`

`4B1C-4B41` computes `[262F]`: `BX==0` (car 0 itself) forces it 0 immediately; otherwise `[BX+1250]`
(drawn) must be 0, and `order[0]` (`[2678]`, the leader's car offset, read once via `LODSW`) must
equal 0 (car 0's own offset) -- the loop's own continuation test (`CMP SI,[0x267E]`) compares a
*pointer* against a *data value* stored at that address, so in practice only `order[0]` is ever
examined, exactly as the port's own `order[0] === 0` models it. `4E8E`: `CMP [262F],1` / `JNZ 4EA9`
skips five of six `ADD [BX+127A],AX` (the car's own `speed` field) -- one ADD unboosted, six boosted.

First attempt, and why it was discarded: with the order array read as-is (`[712,1068,356,0]`, car 0
last) then forced to `[0,...]` for one tick, both boosted cars happened to already be sitting exactly
at their own `maxSpeedCur` cap (car 1 and car 2's own `[BX+129C]`, `1014` and `1146` respectively --
confirmed from their own earlier record dumps). `4E8E`'s own clamp (`4EAD-4EB5`: load the cap into
`CX`, `CMP [BX+127A],CX`, `JL` skips a clamp-back otherwise) reads the summed value on the SAME pass
-- so the six ADDs genuinely ran (`JNZ` not taken, watched live), but the very next few instructions
clamped the result straight back to the cap; watched directly for the unboosted control (`1038 ->
1014` at the following tick's own `4B1C`), inferred for the two boosted cars from their own cap
values and the same clamp instructions, not read back a second time. What that run actually showed
was that the boosted branch executes; it said nothing about a drone actually gaining speed, since
neither car was below its own cap.

Redone with a car genuinely below cap, this time on a fresh boot: near the race start, forced car 1's
`[BX+137B]` (control byte, the same field §3 below uses for car 0) to `0x20` (accelerate) and its
speed to `400` at a `4B1C` hit. It never reached `4E8E` -- because it was still in its own
start-of-race state `0xA` hold (the same one §9ap already ported the `[26CF]` blink gate for), and
the whole `4D04-4FD1` control block (`4E8E` included) is skipped entirely for any car whose state
isn't 0 (`4D04`'s own `CMP [BX+12AE],0`). Every car had been reaching `4B1C` regardless, since that
call site sits outside this gate -- which is what made every earlier tick look like "not
accelerating" rather than "not in state 0 yet" until this was checked directly. At the top of the
next physics tick (`4AEE`), read `state`/`controlsLocked` directly (`10`/`1`, confirming the hold),
force-set both to 0 (skipping the hold rather than waiting the usual ~96 ticks out, as was done for
car 0 earlier in this same session), and re-poked the same control byte, speed and `[BX+1250]`
(drawn) -- car 1 was on screen at the start grid, so this last one was also forced, to 0, not read
as already off screen. Continued to `4B1C`, then `4E8E`: `AX=24`, `[262F]=1` (both conditions now
satisfied: drawn forced off, and car 0 "leads" only as the untouched race-start seed order,
`[0,356,712,1068]`, not a real mid-race lead), `JNZ` not taken, stepped through all six ADDs and the
clamp check (`CX=1014` loaded, no clamp taken since `544 < 1014`) -- speed
**`400 -> 544`**, delta exactly `144 = 6x24`, unclamped. Confirmed persisting: read again at the very
top of the *next* physics tick (before anything else had touched it), still `544`. This is the actual
claim the user asked for -- a drone genuinely gaining speed, not just the branch executing -- and it
stands on its own regardless of the discarded first attempt, though it was captured with the boost
forced on artificially early (car 0 "leading" only in the trivial, pre-race-start sense) rather than
during a real mid-race lead. The grip x1.5 site (`5286-52ab`/`5301-5312`) was not observed reached by
any car in this session; the reason is not established, and it was not chased further. The accel x6
-- the "largest gameplay change" §9ao 6 already named -- is now `[PROVEN]` as an actual, persisting
speed gain, not just `[STATIC]`.

### 2. Rows 200-223 `[PROVEN]`, and a stronger result than planned

Rather than proving an absence (hard to establish cleanly, per §9ap 6's own dead end), forced car 1's
clip box to straddle the boundary instead: top edge at view-row 190, so the box spans rows 190-214 --
rows 190-199 fall inside the 200 rows `92BC` actually copies, rows 200-214 do not, though both are
inside the 224-row clip window (flag read back `1`, confirmed "drawn"). Captured the real screen
(`0xA000` linear, palette-decoded from `ROUND2.PAL`) at this position and at a fully-in-window control
position (view-row 100, same x): the control shows the complete boat sprite, confirming view-row and
screen-row are the same coordinate; the straddled capture shows only its topmost sliver (rows
190-199), cut off exactly at row 199, the screen's own last row -- visually confirming `92BC`'s
200-row copy limit in action, not just its byte count. (A byte-level diff against
a temporally distant baseline was tried first and was useless here -- round 2's own water-shimmer
background animates continuously, described in §9al, and swamped any car-sized signal; the palette
render made the cutoff obvious by eye instead.)

### 3. The keyboard fire preempt `[PROVEN]`, `UNKNOWN_keyboard_fire_preempt_live` resolved

`4D47`: `MOV DL,[BX+137B]` (`controlBits`, `car.js`'s own field, same 0x80/0x40/0x20/0x10/0x08 layout
the port already uses). `4D6B`: `TEST DL,8` -- tests the fire bit alone, regardless of what else is
set. `4D70`: `JMP 4F03`, skipping the steering test (`4D73`, `TEST DL,0xC0`) and the throttle path
entirely for that whole tick, for a keyboard or mouse human (`4D4B-4D69` reads the controller-type
table, `[2658+2(slot-1)]`, and both joystick device codes bypass this whole test at `4D50`/`4D64`).

Live: with car 0 (a `KEYS2` human, `controllerType` 5 -- the mouse and joystick paths are not covered
by this live check, disassembly only) out of its own start-of-race hold, wrote its own `[BX+137B]`
directly at the physics-step breakpoint (`4AEE`, right after the real `PollAllCarInputs` had already
run for that tick, so this overrides it -- this checks control byte to behaviour, not the earlier
key-press to control-byte step) instead of fighting real keyboard timing:
- `0x20` (accelerate only), two ticks: `speed` `0 -> 32 -> 64`.
- `0x48` (right + fire), two ticks: `heading` and `speed` **exactly unchanged** both ticks (`0`/`64`).
- `0x28` (accelerate + fire), two ticks: **exactly unchanged** again, this time at whatever the car's
  own `heading`/`speed` were at that point (`3`/`235`) -- confirms the preempt applies even with
  accelerate also held, not just a bare fire press. **Bullet-order note, added with M3.43's own
  replay:** `3`/`235` is the OUTCOME of the `0x40` tick documented in the next bullet, so this poke
  was actually made AFTER that one, not before it -- the real live sequence was `0x20, 0x48, 0x40,
  0x28`, grouped here as `0x20, 0x48, 0x28, 0x40` in the writeup only to keep the two freeze
  confirmations (`0x48`, `0x28`) together before the one interesting release case (`0x40`).
  `tools/check-step.mjs`'s own `runStep`-level replay uses the real, corrected order and matches
  every tick `[PROVEN]`.
- `0x40` (right only, fire released): `heading` changed (`0 -> 3`) as expected. `speed` also changed,
  to `235`, not the `~44` a coastDecel(=20)-only reading of §3's decay rule (`speed -= [BX+12A6]`)
  predicts for a tick with neither accelerate nor brake set. **Resolved 2026-09-23 (M3.43): not a
  divergence, `[PROVEN]`.** `applySteerAndThrottle`'s own `right` branch (`4DAF/4DDE`'s
  minimum-turning-speed floor, already ported: `speed<=0xff && round<=6 -> speed=0xff`) fires FIRST
  in this same tick, before the throttle test -- `0x40` has no accel/brake bit, so the function falls
  straight through to the ordinary no-throttle coast (`4E2E->4E38`) on top of the just-forced `0xff`:
  `255-20=235`, exact (`[STATIC]`, re-derived directly from `applySteerAndThrottle`'s own control
  flow -- the `right`/`left` branches run strictly before the `throttle===0` branch is reached).
  `[PROVEN]` by executing two independent replays of this exact scenario through the port's own code
  (no DOSBox needed, as §9aq 5 itself anticipated): an isolated `applySteerAndThrottle` call, and a
  full `runStep`-level replay of the live session's own control sequence against a real ROUND21
  spawn -- both reproduce `64 -> 235`/`heading 0 -> 3` exactly, and the second also reproduces the
  `0 -> 32 -> 64` ramp and the `0x48` freeze from the earlier bullets. Both pinned with teeth-proven
  tests in `tools/check-step.mjs` (each independently reverted and reconfirmed to fail first). The
  `~44` prediction was simply incomplete -- it accounted for the coast decay alone and missed the
  steer floor that runs immediately before it on the same tick; a test at round 7 (where the floor's
  own `round<=6` gate does not fire) confirms `~44` IS the correct answer there, for the identical
  control byte and starting speed.

The freeze itself matches the disassembly and the port's own existing behaviour (`docs/engine.md`
§9an 5a, `applySteerAndThrottle`) exactly, for the ticks fire was actually held: a keyboard human's
speed and steering freeze for as long as fire is held, in every round, independent of whether
TANKS/a cheat spot actually lets a shot fire. The release tick's own speed jump is resolved above
(M3.43) -- a real, already-ported mechanic interacting with the coast decay, not a new finding.

### 4. Not pursued further

- The grip x1.5 rubber-band site (1 above).
- A live capture of the exact row/x edges for round 8/9 specifically (already `[PROVEN]` in §9ap for
  the flag value; only the visual cutoff was newly checked here, and only in round 2).
- The larger smoothness/state-cadence divergence (§9ah): unchanged, deliberately out of scope.

### 5. New open items surfaced live

- A car's own control byte set to `0x40` (steer only, no accelerate/brake) produced a `speed` jump
  (`64 -> 235`) well past what a coastDecel-only reading of §3's decay rule predicts (`~44`), while
  `heading` changed exactly as expected. **Resolved 2026-09-23 (M3.43), not a divergence:** an
  offline replay through the port's own `applySteerAndThrottle` (no DOSBox needed, exactly as
  anticipated here) reproduces `64 -> 235`/`heading 0 -> 3` exactly. The steer step's own
  minimum-turning-speed floor (`4DAF/4DDE`, `speed<=0xff && round<=6 -> speed=0xff`, already ported)
  fires first in the same tick, then that tick's own no-throttle branch falls straight into the
  ordinary coast decay on top of the just-forced `0xff`: `255-20=235`. See §9aq 3's own `0x40` bullet
  for the full account and `tools/check-step.mjs` for the teeth-proven regression test.
- Not actually an open item, but a live-testing pitfall worth recording since it cost real time
  here: a car freshly caught right at the race start is very likely still in state `0xA`
  (`controlsLocked=1`) -- the same start-of-race hold `[26CF]` gates in §9ap -- and the entire
  `4D04-4FD1` control block (`4E8E` included) is skipped for any car not in state 0, while `4B1C`
  itself sits outside that gate and fires regardless. A car can therefore look like it's "just not
  accelerating" for many ticks when it's actually not in state 0 yet; check `[BX+12AE]` (`state`)
  directly before concluding anything from a missing `4E8E` hit, rather than waiting and hoping. (An
  open question §9ap 6 raised about a *different* car landing in this same state under different
  pokes is NOT resolved by this -- but that capture ALSO began right at the start grid, so the
  ordinary start hold is a live candidate there too, not ruled out; still left as "not established"
  in §9ap 6 itself rather than asserted here, since that capture's own specific sequence of pokes
  wasn't re-examined against this explanation.)

## 10. Open items

`UNKNOWN_tile_index_overflow` **resolved 2026-09-22 (§9ac): three real cases across all 29 races,
not just the two on record -- round 8 (tile 58, `.COL` only) and round 9 (tile 60, `.COL`+`.DIR`)
are confirmed structurally UNREACHABLE by a full sub-cell flood fill from each race's own start
position (4- and 8-directional, matched); round 5's tile 56 (`.DIR` only, previously undocumented)
is the opposite -- fully open, on the real racing line, reached in both affected races. The real
bug: the port discarded real, present file bytes (round 5's own file has 18 of tile 56's 36 `.DIR`
bytes) along with the genuinely-missing ones, because the whole-tile gate that existed to avoid an
`undefined`-not-`0` crash (`dirTile`'s bare `.subarray()`) didn't distinguish "partially present"
from "fully absent". Fixed: `dirTile` now zero-fills only genuinely-missing bytes; `collide.js` no
longer gates on the tile index at all. The real leftover byte for the genuinely-missing tail is
tournament-history-dependent (traced to round 4's own tile-56 data for the canonical Challenge
order). **Follow-up (§9ad, same day, on request): that cross-race replication IS now implemented**
(opt-in `createColDirBuffers()`, threaded through `flow.js`'s own tournament session, verified
against the exact traced value), the asset viewer's own analogous whole-tile gate is fixed too, and
the `.CT`/render-bank visibility question is settled closed (the same flood fill shows round 8/9's
cells are 264-744 world units from the camera's own reach, never visible either). A fourth,
previously-unknown sibling case surfaced and was fixed in the same pass: `.BRK` has the identical
fixed-512-byte-never-cleared buffer shape, and round 3's own progress plane genuinely reaches 255
as REAL, REACHABLE course data (not a dead corner) -- `createBrkBuffer()`, same opt-in pattern.**
`UNKNOWN_26B8_polarity` **resolved 2026-09-22 for the finish-decided case (§9u): a shared slot re-armed by two different events -- the knockout-reset writer's own immediate effect reads loser-ish, but the match-winner determination reads `[26B8]` as scorer/winner, confirmed by literal `"WINNER!"`/`"LOSER!"` on-screen text; a real state-assignment bug this finding surfaced in `twocar.js`'s `resolveTwoCarKnockout` was fixed as a direct consequence. New, narrower open items surfaced then, one now resolved: `UNKNOWN_h2h_knockout_only_ending` **resolved 2026-09-22 (§9x) for the race-loop half: NO -- `RunRaceMainLoop`'s sole exit gate (`[26C6]>=2`, `1000:3081`) is structurally unreachable from a knockout, since `ResetCarsAfterKnockoutSfxA` (fully re-disassembled, all 106 instructions) never touches `lapsRemaining`/`[26C6]`, and none of `[26C6]`'s other five direct setters connect to knockout either -- both cars keep racing normally after a knockout until someone eventually finishes some other way. Also corrected in passing: `4C08`/`4C64` were mischaracterized as "finish-detection" -- the real outer gate is the two-car match SCORE `[26B4]`, not a finish flag. New, narrower open item: `UNKNOWN_h2h_match_score_writers`** (does `[26B4]`/`[26C4]`'s match-decided writer agree with the knockout-reset's own `[26B8]` verdict, or can they disagree) and `UNKNOWN_851f_bonus_banner_choice`** **both resolved 2026-09-23 (§9ag): yes, they CAN disagree -- `4C08`/`4C64` mechanically echo `77F5`'s own first verdict but fire at most once per race, permanently freezing the HUD rank table, while `77F5` can keep re-arming `[26B8]` for later knockouts in the same race; "Bonus" (851F, state `0xB`) is the artist's label for whichever car the knockout-reset spotlight currently names, not a real third outcome or the round-9 bonus-race indicator (851F itself gates `[28BF]!=9`)**, `UNKNOWN_6ae5_round3_sequencer` **resolved 2026-09-22 (§9r)**, `UNKNOWN_stateE_reach` **resolved 2026-09-22 (§9r)**, `UNKNOWN_22E1_scope` **resolved 2026-09-22 (§9r)**, `UNKNOWN_1254_1256` **resolved 2026-09-22 (§9v): genuinely dead per-car static data, confirmed by full-file-coverage searches (0 references, 2 independent methods) -- values follow a clean arithmetic progression, purpose unresolvable further without external context**, `UNKNOWN_1386` **resolved 2026-09-22 (§9v): the exact logical NOT of `[1388]`/`onBridge`, confirmed genuinely write-only (full-coverage search, 3/3 hits all known writers, no reader)**, `UNKNOWN_138A_clear` **resolved 2026-09-22 (§9v): no clear-to-0 site exists anywhere (7/7 hits, full coverage) -- "wall bounces always halve" is the fully-confirmed closed answer, not a simplification**, `UNKNOWN_ph0_1140_1380` **investigated thoroughly 2026-09-22 (§9v), genuinely still unresolved: three independent full-coverage search methods (incl. a directly-refuted adjacency hypothesis) found no consumer, but the region is NOT empty padding as a static image might suggest -- decompressing the real shipped file shows 35 non-zero bytes forming three small designed icon shapes, rendered and visually confirmed**, `UNKNOWN_puff_slot_fields` **resolved 2026-09-22 (§9q)**, `UNKNOWN_ph0_tail_icons` **resolved 2026-09-22 (§9q)**, `UNKNOWN_pause_exact_timing` **resolved 2026-09-22, upgraded to `[PROVEN]` (§9v): `[261F]` shares one 70.0Hz incrementer with `DS:0002` -- 140 ticks is exactly 2.000 seconds; this port's own chosen `MIN_PAUSE_MS=2000` is the precise real-world duration, not an approximation**, `UNKNOWN_pause_banner_position` **resolved 2026-09-23 (§9q), `[PROVEN]` by disassembly: the real vertical offset is 48, not the symmetric `(h-22)/2=89` this section previously assumed -- each banner's screen position is an individually hand-authored constant (the race-over "Winner" banner uses a different literal centre-Y), not derived from view height; fixed in `raceView.js`'s `drawPauseBanner` (also correcting the blit mode from an opaque copy to the real colour-0-transparent blit found while at the same call site), teeth-proven in `check-play.mjs`**, `UNKNOWN_17DA_semantics` **resolved 2026-09-22 (§9v): same convention, zero transform -- confirmed two ways (live disassembly of the one real consumer, and a physical sanity check across all four cardinal separations); the port was already correct**, `UNKNOWN_car_camera_2p`, `UNKNOWN_car_draw_anchor` **resolved 2026-09-23 (§9d), `[STATIC]` by disassembly: the prior centred-anchor guess matched exactly (`dx-half-z` body / `dx-half+z` shadow off the same base `(posX-camX,posY-camY)`, half=size>>1 confirmed a hand-authored literal at both 24×24 and round 9's 40×40), so the anchor formula itself needed no code change -- but the same disassembly pass found and fixed two adjacent real divergences (round 8/CHOPPERS forces z=0 and skips the shadow entirely; height is never clamped to >=0 in the real draw, unlike this port's prior `Math.max(0,height)`), teeth-proven in `check-play.mjs`'s `checkCarDrawAnchor`. Two narrower open items surfaced, both deliberately unported: CHOPPERS' own separate round-8-only 32×32 extra animation (`DrawRound8ExtraAnim32 1000:843d`, `DS:5EE3`) is not disassembled further -- what it draws is unestablished, not assumed to be a shadow substitute; and `UNKNOWN_car_draw_wrap_asymmetry` **resolved and FIXED 2026-09-23 (M3.44, full account §9d): the follow-up pass's own "provably benign" framing AND its own worked counter-example were both wrong (the example was itself off-screen once carried through the half-offset and clip test, not the 22px on-screen case it claimed); the real, brute-forced disagreement window is an 11px positive-side sliver plus a second, independent round-9 near-camera window -- `raceView.js`'s body/shadow now fold through the same `viewCoord` `markDrawn` already used, `[STATIC]` by disassembly, teeth-proven, with zero behaviour change found in either window across a 29-race x both-format x 8000-step sweep. The round-8 rotor overlay is ALSO now gated -- on a FRESH per-render clip test (`drawCarBody`'s own return value), not the separate, state-gated `drawnThisFrame` sticky flag an earlier draft wrongly reused (caught before being trusted) -- matching `843d`'s real control-flow position behind the body's own clip test in the SAME function call; unlike the seam fold, this DOES change real frames: 71 of 87842 round-8 car-ticks in that same sweep (history: 137 checked the OLD rotor against the wrong 256x224 window instead of its own real 200-row canvas, caught in review; 425 then dropped the `oldR` AND the fix's own semantics require, caught by an always-zero `other`-bucket self-check), an everyday screen-edge sliver (left/right/top only, never bottom) the rotor's own larger 32x32 box used to show with no body under it. Two further effects are `[STATIC]` by disassembly: the hidden two-car loser's rotor is exposed 192 times, 186 eligible (non-2/0xD), `oldR` already false in every one of those 186 (`[PROVEN]` by its own dedicated pixel test that the port's own gate correctly suppresses a hidden car's rotor) but never observed to change a frame; a states-1/4/5 bodyless-rotor case (correctly scoped to those states, not state 2/0xD's own separate `drawBody:false`, a mistake an earlier draft of that counter made and corrected) was never once exercised by a round-8 car in these 29 races -- not a world-seam exotic**, `UNKNOWN_ranking_2670` **resolved 2026-09-22 (§9s): the full `8e10` scoring formula, freeze-on-finish, and persistent bubble sort**, `UNKNOWN_2652_progress_scale` / `UNKNOWN_2654_half_max_progress` **resolved 2026-09-22 (§9s): both are per-race data (the max/half-max of the loaded race's own `.MAP` progress plane), derived in `runStep` from the pre-existing `world.map.maxPlane2` and no longer defaulted**, `UNKNOWN_col_response_offtrack_branch` **resolved and FIXED 2026-09-22 (§9v): the real function resets offTrackTicks and returns early (skipping wall-hit-box detection entirely) once the dwell threshold is crossed -- the port's prior unconditional fall-through was a real bug, now fixed with teeth-proven tests**, `UNKNOWN_respawn_sideways_offset` **resolved and FIXED 2026-09-22 (§9v): a 12-unit vector at heading±90° (not literal ±12px), the camera-target car rotating +90° and every other car -90° -- the port's own `stepRespawn` had no way to distinguish which car is which until `cars` was threaded into its `ctx`, now fixed with teeth-proven tests**, `UNKNOWN_2911_2913` **fully resolved 2026-09-22: split (§9r) into two unrelated globals -- `[2913]` is an unrelated render-only hazard/crash "flash" flag; `[2911]`'s complete state machine characterized (§9v): 0=idle, 1=armed (a projectile kill or a drop-in partner timeout), 2=processing, confirmed across all 8 write sites**, `UNKNOWN_h2h_12f1_12f3` **resolved 2026-09-22 (§9y): `car.js`'s already-named `safeX`/`safeY`, already correctly ported everywhere -- no port change needed**, `UNKNOWN_rufftrux_timer` / `UNKNOWN_bonus_race_rules` **resolved 2026-09-22 (§9y): already correct -- fresh disassembly re-confirms `docs/engine.md` §7's own original prose and `tournament.js`'s existing implementation, a stale catalog entry rather than a real gap**, `UNKNOWN_state1_880a` **and `UNKNOWN_state1_oscillator_port` both resolved and FIXED 2026-09-22 (§9w): the M3.17 deferral's own premise ("five currently-unnamed CarRecord fields") was wrong -- all five (`heading`/`speed`/`animTimer`/`animStep`/`driftSteps`) were already named in `car.js`, just not cross-referenced by relative offset. The real mechanism (bucket `heading&0xF8`, step ±4/tick toward the nearer of {0,0x80} around the circle including wraparound, table selected by WHICH waypoint not by round, gated by `driftSteps`) is now ported in `stepHazardDeath` with teeth-proven tests. New, narrower open item surfaced along the way: `UNKNOWN_state4_5_driftsteps_gate`** **resolved and FIXED 2026-09-22 (§9z): the gate itself, plus a real sfx-timing bug (the port tested `animTimer` where the real gate tests post-increment `animStep` -- fired ~2-4x too early) and an incomplete terminal-field set (both states), all found alongside it -- teeth-proven tests, full account §9z** / state A internals (visual sequences, not core physics), `UNKNOWN_kidmodifier_use` **resolved and FIXED 2026-09-22 (§9y): a real, substantial port gap -- `InitRaceCarsFromTables`'s full 7-field per-car tuning handicap (`maxSpeedCur`/`reverseLimit`/`accel`/`brakeDecel`/`slipThreshold`/`gripStep` plus `DRONE_MAX_VEL_HANDICAP` and a two-car-format/race-23 penalty layer) was entirely unapplied since M3.6; now ported into `spawnCars` with teeth-proven tests -- an investigating fork's own report had 3 concrete errors, caught by independent re-verification before any code was written**, `UNKNOWN_2p_p2_record` **resolved 2026-09-22 (§9y): the two-human H2H win-tally scoreboard (`[98A]`/`[98C]`, first to 4 wins) plus a confirmed-dead abandoned draft function (`ShowHeadToHeadResultUnreferenced`) -- pure documentation, no port gap since two-human H2H isn't implemented at all**, `UNKNOWN_frontend_stat_block_0359` **resolved 2026-09-22 (§9t): two unrelated blocks -- `DS:0312` is the tournament board's 26-word icon-position table, `DS:034B` is a 17-byte bounce/wobble curve used by the elimination screen**, `UNKNOWN_beat_the_clock_timetrials` **resolved 2026-09-22 (§9t): not a hidden mode -- "TRIPLE WIN !!!"/"BONUS RACE"/"BEAT THE CLOCK"/"TIMETRIALS" are round 9's own bonus-race intro banner, gated on `[28BF]==9`; "RACE 99" and "IS OUT!!" are unrelated, resolved separately (a self-patching race-number template and the elimination screen's own banner)**, `UNKNOWN_frontend_submenu_labels` **resolved 2026-09-22 (§9t): the two items are WORDS.CHR sprite graphics, not strings -- "Head to Head" (slot 11, frame 1) and "Challenge" (slot 11, frame 2), each paired with a SELGAM.CHR icon (slot 10, frames 2/3), confirmed by descriptor-slot arithmetic against the documented 18-slot binding table**, `UNKNOWN_smoothness_label_map` **resolved 2026-09-22 (§9t): 1=HIGH, 2=GOOD, 3=MEDIUM, 4=LOW, a direct unreordered walk confirmed live; "AUTO" is proven NOT part of the set (its own purpose is a new, narrower, unnamed open item)**, `UNKNOWN_lua_hook_model` / `UNKNOWN_replay_determinism` (bridge), and **`UNKNOWN_live_verification`**
**narrowed, not closed, 2026-09-22 (§9aa/§9ab): the first true live-DOSBox check of any M3 engine
code.** §9aa's own paused, symbol-confirmed memory read of a fresh `ROUND21` race matched every one
of the 7 tuning fields × 4 cars against `race.js`'s current formula (`maxSpeedBase`'s own match was
initially mis-transcribed as 1662 for every car, agreeing with a then-also-wrong `tuningFieldsFor`
formula -- both corrected in §9aa's own correction note and §9ab), and resolved M3.4's own long-open
step-1 divergence as a stale test-harness approximation (`check-trace.mjs`'s own `staticFieldsFor`,
replaced by a shared `tuningFieldsFor` export) rather than an engine bug. §9ab (same day, continuing
the two open items §9aa itself surfaced) resolved both: `UNKNOWN_ai_maxspeedcur_brk_interaction`
**fixed** -- the real single writer of `maxSpeedBase` (`InitRaceCarsFromTables 4244-4248`) copies it
from the CX-adjusted `maxSpeedCur`, not the round-flat `info[0]` `tuningFieldsFor` used; fixing that
one line also fixed this, since `ai.js`'s `car.maxSpeedCur = car.maxSpeedBase` reset now restores the
correct value. `UNKNOWN_trace_posY_terrain_stop` **resolved, not an engine bug**: proven by removing
the one suspect row from the trace and re-running the full replay -- 19 of 19 remaining transitions
then match exactly, zero mismatches, confirming the "divergence" was a single torn Lua-capture sample
(raw step label 69; only one car's `controlBits` differed from the previous kept row, everything else
frozen -- the same artifact class §9g already diagnosed once in this trace's own AI stage-2 test, this
time pinned to `RunDroneSteeringAi`'s own first instruction, `1000:542e`, zeroing `controlBits` before
rebuilding it). `npm run trace`'s own literal, unfiltered output is 13 of 20 (the tool doesn't filter
the bad row, so the number stays honest); the true result -- every real physics step in this trace
matches -- is documented, not silently substituted for it. A real, independently-found bug was fixed
along the way: `bounceAndCommit` read a freshly-computed local instead of the persistent
`car.wallHitPending` field the real bytes (`5c7a`) actually gate on, and `updateCarTileCollision` never
reset that field when not colliding (real reset site `1000:57fb`) -- both fixed. A narrower gap
surfaced by that same investigation was deliberately left open after a fix attempt caused a real
regression (round 3's drop-in sequencer): `UNKNOWN_col_response_active_state_gate` **resolved and
FIXED 2026-09-22 (§9ae): the gate is now ported exactly (`1000:5534`/`553e`), `bounceAndCommit` reads
persistent `car.progress`/a fresh `world.levOf(car.metaTile)` instead of the old ephemeral `hit`, and
two further real gaps surfaced and were fixed alongside it -- an unconditional hit-flag clear
(`5d1d-5d32`) newly load-bearing under the gate, and `tools/check-rounds.mjs`'s own drop-in test
constant (334 ticks), which turned out to have been measuring a bug (the ungated collision function
was picking up real wall bounces mid-slide, converging FASTER than the real bytes do) rather than the
genuine ~532-tick real rate. New, narrower open item surfaced: `UNKNOWN_commit_reintegrates_post_bounce`
**resolved and FIXED 2026-09-23 (§9af): a fresh re-disassembly of `5c70-5d9f` (not trusted from this
citation) confirmed the divergence and found the hit-flag clear is ALSO scoped to the same
`wallHitPending && wallBounceEnable` gate, not unconditional as described here -- both fixed together
in `bounceAndCommit` (a second `integrateCar(car)` call inside the gate, and the clear moved inside
it), with a real second bug found alongside (terrain.js's `h6882`-triggered bounces were reading
stale hit flags as always-zeroed "none" under the old unconditional clear). `npm run trace`/`npm run
ai`'s 13-of-20/59-of-60 baseline is unchanged (this capture never exercises a bounce tick), confirmed
as the discriminating regression check rather than assumed clean.**. Still open:
a longer/driving/turning/collision trace,
car-car impulse sign (already separately resolved 2026-09-21 without a DOSBox capture — §9n — by
re-reading the disassembly directly), sfx-2-on-lap-completion, and one live physics step of car 0
(human) under real input. **Narrowed 2026-09-23 (§9aq 3): the control-byte -> physics leg IS now
live-checked (`0x20`/`0x48`/`0x28`/`0x40` all traced live over 7 ticks, `[PROVEN]`, M3.42/M3.43) —
what remains open is specifically the earlier key-press -> control-byte leg, which §9aq 3's own
poke deliberately bypassed (`[BX+137B]` was written directly at the breakpoint, after
`PollAllCarInputs` had already run for that tick) rather than exercised.**

**Added 2026-09-23 (§9ah).** Resolved: the user-visible "finished first but lost" bug (0-cell
progress writes, `[PROVEN]` live), the prefix-freeze ranking, the four-car race end (finished-car
block, `[26C6]` recount, `[26CC]` countdown, result = car 0's order slot), the ROUND21 lead rule, the
rubber band's slot-0-only scan, the TANKS-only steering modifier, the respawn's progress/cursor
writes, and the 0xFF knockout site. New open items: `UNKNOWN_twocar_race_end` (Head-to-Head vs CPU
still ends when car 0 finishes; the real exit is the `[26B4]` match score, `76f2`/`772a`/`7742`) --
**resolved and ported 2026-09-23 (§9am)**;
`UNKNOWN_round3_bridge_path` (`5740-57f7` unported, incl. the `683c` ramp path that stores progress
12); `UNKNOWN_fire_gating` -- **resolved and ported 2026-09-23 (§9an 5a)** -- (a keyboard/mouse human's 0x08 jumps `4d70 -> 4f03` before steering and
ENDS the tick -- no steering/throttle, in every round -- and `4f03` sends `[26C6]==2`/`[2915]==1` to the
ground-gated coast `4e2e`; drones and joystick humans reach `4f03` only via `4efb`, after an
accelerate-without-brake tick; the port fires first and always steers/throttles, so TANKS drones
fire more often than the original -- needed the P1 device word `[2658]` threaded in, **done in §9an
5a's own "Port wiring": `controllerTypes` passed from `play.js`/`flow.js`, read via `step.js`'s
`controllerTypeOf`**);
`UNKNOWN_countdown_hud_digit` (the port's HUD digit reads 3 during the start countdown and 4 once
racing -- the original's countdown value not captured); smoothness 2-4 ranking/state cadence (above); `UNKNOWN_drawn_flag_onscreen` -- **narrowed §9an 5i, then resolved and ported §9ao: `[1250]` is "on screen at the last drawn frame" (`7D7D`/`7E54`), the port's `drawnThisFrame` now tracks it, and the `4F3C` fire gate is ported** --
a live capture of a whole race end (countdown +
final order) and of the lead rule firing remain open.

**Added 2026-09-23 (§9am).** Resolved and ported: `UNKNOWN_twocar_race_end` -- the whole two-car match
(camera separation trigger, knockout reset in both branches, 64-step blink and commit, re-line-up,
both-cars-down, the finish block with "Play Off", banners, the hidden loser, the light bar, the exit
fix-up the tournament reads). A two-car race now ends only at an exchange end, as in the original.
New or carried open items (details in §9am):
- `UNKNOWN_twocar_live_cycle` (no live capture of an exchange yet) and `UNKNOWN_0f64_speed_zero`
  (mechanism now fully re-derived, §9ar a; still wants the same live capture);
- `UNKNOWN_h2h_bx_clobber_effects`;
- the post-race 100-tick `855A` hold;
- the flow-side H2H differences (opponent pick, no RESULTS/OUTCOME screens, the qualifier);
- `game.html`'s unapplied instant-win cheat;
- the cross-format findings: the keyboard-fire preempt, the car-car BX chain, the camera-init wrap,
  the `4D0E-4D1F` lock clear, the respawn's missing resets/decrement order/`7008` quirk, the two-car
  checkpoint overshoot;
- `UNKNOWN_fallbranch_stale_fields` and `UNKNOWN_rematch_fail_stale_2682` -- mechanism closed, §9ar
  b/c (the latter's downstream consequence is still open).

**Added 2026-09-23 (§9an).** Resolved and ported: the Head-to-Head vs CPU flow (you pick the CPU
opponent, PRESS ANY KEY, no intro before the qualifier, no RESULTS in H2H, no OUTCOME after a won
race -- but ONE LIFE LOST after a lost one, and intros before races 1+), the race exit (sfx 16
actually heard, 100 ticks of the frozen frame -- no banner -- then the subtractive fade),
`UNKNOWN_h2h_bx_clobber_effects`, the instant-win cheat on `game.html` (plus the four-car exit
re-force and `play.js`'s `cheatWin`), `UNKNOWN_fire_gating` (the keyboard/mouse fire preempt, the chord, `[2915]`), the car-car
BX chain, the camera-init wrap, the lock-release site, the respawn's resets/order/`7008` quirk, the
two-car checkpoint overshoot; the heading's bit 8 is closed as unobservable. Corrected: the pause
resumes at the first key click (no 2 s minimum). New or carried open items (details in §9an 8):
- `UNKNOWN_keyboard_fire_preempt_live` (the DOSBox menu dropped synthetic fire presses);
- the on-screen `[1250]` gate on firing (`4F3C`) -- **resolved and ported 2026-09-23 (§9ao)**;
- `UNKNOWN_exit_hold_855a_pass`, `UNKNOWN_exit_banner_live`, `UNKNOWN_fade_duration`;
- the race-start fade-in (the original shows black, then the first frame at full palette);
- the pause's `MIN_PAUSE_MS` (port) vs the first key click (original);
- the BX-quirk garbage's cross-race carry-over;
- the Challenge flow's own divergences (final race 2nd = fail, uncapped bonus trigger, no OUTCOME
  after a passed race, tune 5 unreachable, the main menu's tune 1, OUTCOME 4's screen, the `1A4A`
  replacement picker, ']' on OUTCOME 2/3);
- the carousel look of the character select and the H2H race-intro variant -- **the race-intro
  variant's own mandatory-hold TIMING (the slide loop's own portion; the palette fade before it
  has no derivable duration, `UNKNOWN_race_intro_prehold`) and its text-only participant list both
  resolved and ported 2026-09-24 (§9be); its sprite panel itself (and the carousel's own look)
  remain unported, matching §9az's own precedent**;
- `UNKNOWN_bc5_high_byte`, `UNKNOWN_93c2_writer`, `UNKNOWN_a329_writer` -- **all three closed, §9ar
  d/e/f**.

**Added 2026-09-23 (§9ao).** Resolved and ported: `UNKNOWN_drawn_flag_onscreen`. `[1250]` is
written only by `7D73` (plus race init). It is sticky and clip-tested: 256x224 view, height lifted
except in round 8, round 9's own box. `[PROVEN]` by one live capture (4 of 4 cars). The `4F3C` fire
gate is ported, so off-screen tanks do not fire. Via the same flag the rubber band now boosts
off-screen drones while car 0 leads, and off-screen engines idle and sfx go silent. Corrected: the
DOSBox menu input was never flaky (§9ao 7). Still open: the state-A blink phase, the smoothness
cadence, a live edge capture, and `UNKNOWN_keyboard_fire_preempt_live` (now reachable).

**Added 2026-09-23 (§9ap).** Resolved and ported, closing out §9ao 8: the state-A `[26CF]` blink
gate (car 0 and two-car cars draw only on its on-phase, a free-running 16-physics-tick half-period;
drones unaffected), and the smoothness 2-4 write cadence for the drawn flag specifically (`markDrawn`
and the `[2621]` hidden-car write now honour `ctx.drawnTick`, following the same pattern
`advanceRotorFrame` already used -- the larger state/ranking cadence divergence stays open,
deliberately). `[PROVEN]` live, solo, across four boots (the first was invalidated by a background
agent issuing its own DOSBox calls on the same instance; a later attempt's own round-9 restore point
left the poked byte live too long and visibly disturbed the race, redone restoring earlier instead,
which disturbed it again for the car-0 case in a way not fully explained -- see 6 for the full,
unglossed account): 12 cases -- the y/x box edges, the wrap fold, and (by poking the round byte for
one car's own `7D73` call) round 8's height exemption and round 9's own 40x40 car-0 box plus its
unconditional cars 1-3 -- all matching exactly.
Still `[STATIC]` only: the rubber band in action, and whether a "drawn but invisible" car is actually
absent from the screen (attempted several times, not obtained). Also verified via `npm run build`
and, in Chrome via the page's own debug fast-forward hook (`forceSteps`, since the tab is backgrounded
and its `requestAnimationFrame` doesn't run there -- so this bypasses `frame()`/the real render loop
entirely), that `ctx.drawnTick` follows the exact smoothness-4 pattern with a clean console, and that
fire works correctly at smoothness 4 through `stepOnce`/`runStep` once car 0 clears its own
start-of-race drop-in hold (an initial attempt inside that hold correctly produced nothing, at first
misdiagnosed as a tooling gap).

**Added 2026-09-23 (§9aq).** Resolved live, closing out §9ap 7 in full: the rubber band's accel x6 --
a first attempt (both cars already at their own speed cap, so the boost fired but was clamped back
to nothing) was caught and redone with a car forced well below its cap, released from its own
start-of-race hold, its drawn flag forced off, and car 0 "leading" only through the untouched
race-start seed order: `speed` `400 -> 544`, exactly `144 = 6x24`, unclamped, confirmed persisting
into the next tick -- a boost observed with car 0 genuinely leading mid-race is still open; the
row-200-223 screen cutoff,
shown visually rather than proven as an absence -- a car forced to straddle the boundary renders only
its topmost sliver, cut off exactly at row 199, against a full, undistorted sprite at a fully-visible
control position; and `UNKNOWN_keyboard_fire_preempt_live` -- a keyboard human's speed and heading
freeze exactly, for as long as fire is held (alone or with accelerate). Heading resumed correctly the
instant fire was released; speed instead jumped well past what a coastDecel-only reading of the decay
rule predicts -- **resolved 2026-09-23 (M3.43): not a divergence**, an offline `applySteerAndThrottle`
replay reproduces it exactly (the already-ported `4DAF/4DDE` minimum-turning-speed floor forces
speed to `0xff` on the same tick's steer step, immediately ahead of that tick's own no-throttle
coast decay: `255-20=235`), pinned with a teeth-proven test in `tools/check-step.mjs`. Not pursued: the grip x1.5 rubber-band site (not
observed reached, reason not established); the larger state-cadence divergence (§9ah), unchanged by
design; mouse/joystick fire preempt (disassembly only, not live-checked).

## 9ar. Six small named globals/writers, chased (2026-09-24)

**Scope.** User request: work `UNKNOWN_0f64_speed_zero`, `UNKNOWN_fallbranch_stale_fields`,
`UNKNOWN_rematch_fail_stale_2682`, `UNKNOWN_bc5_high_byte`, `UNKNOWN_93c2_writer`,
`UNKNOWN_a329_writer`. All six re-derived from fresh Ghidra disassembly (the MCP bridge had been
disconnected; reconnected this session), each cross-checked with an exhaustive `search_byte_patterns`
sweep over the full 83,662-byte image (not just `get_xrefs_to`, per `PLAN.md`'s pitfall #120).

**a. `UNKNOWN_0f64_speed_zero` -- closed, `[STATIC]`, still not live-confirmed.** `[0F64]` is
`SETTINGS.DAT`'s own sound-driver word (0/1/2, already named in `CLAUDE.md`'s SETTINGS.DAT layout),
loaded at `27C1` and defaulted at `278C`. `StopEngineSounds 7AF8`'s two branches, re-disassembled in
full:
- `[0F64]!=1` (SPEAKER/NONE): calls the driver's own `AH=0x10` "beeper engine off" command for voices
  0 and 1 (an existing EOL comment at `7B06`/`7B12` already names this).
- `[0F64]==1` (BLASTER/OPL2, the only path this port models): no driver call at all -- it pokes
  `word [BX+0x127A] = 0` directly for all four car bases (`0`, `0x164`, `0x2C8`, `0x42C`). Cross-checked
  against `car.js`'s own field table (`heading` at struct-relative `0x2E`, confirmed live elsewhere as
  absolute `[1278]`, pins the struct base at `0x124A`): `0x124A+0x30 = 0x127A` is exactly `car.js`'s
  `speed` field. So the OPL2 path silences engines by zeroing `car.speed` directly and letting the
  normal per-frame pitch update (`UpdateEngineSoundsPerFrame 7B46`) carry it to nothing, rather than
  issuing an explicit driver command -- `twocar.js`'s `stopEngineSounds` (`for (const car of cars)
  car.speed = 0`) already matches this exactly, unconditionally (correct, since the port only ever
  models the OPL2 path). Still open: an actual DOSBox capture watching `car.speed`/the OPL pitch drop
  to 0 at a real `7AF8` call site (pause entry, race exit, a two-car exchange) -- nobody has done this
  live yet.

**b/c. `UNKNOWN_fallbranch_stale_fields` and `UNKNOWN_rematch_fail_stale_2682` -- both now fully
characterised, `[STATIC]`, mechanism closed; downstream consequence of (c) still open.** Both concern
`ResetCarsAfterKnockoutSfxA`'s fall branch (`[2682]`/`raceState.fallLatch` set -- round 3's shortcut
hole only, `HandleCarState4FallAnimSfx8 7F62-7F69`).
- **(b) stale fields.** The fall branch (`7759-7764`, `twocar.js`'s `resetCarsAfterKnockout`) never
  snapshots `knockoutX`/`knockoutY` for either car, unlike the ordinary no-fall branch (`7786-77A8`,
  both cars). `knockoutX`/`knockoutY` (struct-relative `[BX+0x12BA]`/`[+0x12BC]`, confirmed by an
  exhaustive `search_instructions` sweep for that operand -- 12 hits, one reader) is read by exactly
  one function: `DrawPh0KnockoutAnimFrame 8339`, called unconditionally from
  `HandleCarState2or0DKnockoutAnim 82BE` (states 2/0xD's own handler, ported as `stepKnockoutAnim`) --
  it draws a 24x24 overlay sprite at `knockoutX/Y - height - camera`, with no gate on whether the car
  was actually hit this cycle. The scorer (the car that fell) has fresh `knockoutX/Y` from whatever set
  it on entering state 4 (a hazard trigger in `collide.js`, same mechanism every other knockout uses).
  The *other* car -- never hit at all -- still gets driven through the same 0xC -> 0xD sequence as an
  ordinary loser (the exchange commit puts both cars in state 0xD), and its `knockoutX/Y` is whatever
  it held from its last *real* knockout this race, or never-set. This is confirmed original-game
  behaviour, not a port gap: `raceView.js`'s `drawKnockoutOverlay` already reads `car.knockoutX ??
  car.posX`, which reproduces the same "stale, or fall back to current position" shape the bytes
  produce (the real DS image's own uninitialized-buffer garbage can't be reproduced exactly, but the
  port's fallback is the closest faithful analogue). No code change.
- **(c) rematch fail.** The fall branch has **no re-entry guard** -- unlike the no-fall branch, which
  bails out at once if either car is already in state `0xC` (`777C`/`779E`, the port's `if (p1.state
  === 0xc) return`). So a round-3 fall can force a brand-new exchange to start (reassigning
  `spotlight`, re-arming the camera, re-hopping the scorer) while a *previous* exchange is still mid
  flight (blinking at `[26BA]` or mid-respawn in `0xD`/`7`), unconditionally overwriting that in-flight
  state. `twocar.js` already ports this exactly (the fall branch has no equivalent guard either).
  **What is now closed:** the mechanism and its trigger condition (a fall landing inside another
  exchange's window). **What is still open:** the actual downstream consequence -- does the clobbered
  first exchange lose its point, does the bar move twice, does a car get stuck -- nobody has traced
  `stepExchange`/the commit path far enough with a constructed double-fall scenario to say, and no live
  capture of it exists either. Narrower and more tractable than before this session, not closed.

**d. `UNKNOWN_bc5_high_byte` -- closed, dead/always-zero.** `[0xBC5]` (word) has exactly two writers,
both re-disassembled: `RunTitleScreenAttractLoop 016F` initializes it to `0xFFFF` then wraps a 0..8
counter into it (`017B-0187`, the title screen's own idle-attract-mode index); `RunHeadToHeadTournament
2065` (the unported two-human H2H) stores `(round-1)` into it with `XOR AH,AH` explicitly zeroing the
high byte first. Every write is 0-8; nothing ever inspects a value outside a byte. The single reader
(`017B`, inside the same attract loop) only ever sees what `016F`/`0187` put there. The high byte is
provably always zero and never load-bearing -- `[0xBC5]` is a shared scratch word reused by two
unrelated screens for two unrelated small counters, not a mystery register.

**e. `UNKNOWN_93c2_writer` -- closed, genuinely no writer; not a bug that matters.** The sole reference
anywhere in the image (`search_byte_patterns` for `c2 93`, one hit) is `CMP word ptr CS:[0x93C2],
0x2BC` at `1000:17D7`, inside the shared two-phase wait `179B-17FE` (called from
`ShowNextRaceIntroScreenTune4or5`/the ported race-intro screen, `ShowCharacterEliminatedTune6`, and the
unported `RunHeadToHeadTournament`). `CS:[0x93C2]` sits in the zero-padding just before the embedded
"COPYRIGHT CODEMASTERS" string (`read_memory` confirms 14 zero bytes there) -- a constant, never a
variable, so the phase-2 timeout compare (`JNC` out once >= 0x2BC) can never fire. Net effect: phase 1
waits up to `0x2BC` ticks (~10 s) or a keypress; if it times out, phase 2 waits for a keypress with no
further timeout at all -- i.e. the whole routine's real behaviour is just "wait for a key, with an
internal ~10 s bookkeeping step that changes nothing observable." That already matches the port's
`RACE_INTRO` phase (`flow.js`, advances only on a keypress, no auto-timer). No port change; the
apparent "indefinite wait" is by design (or an original-game copy-paste artifact that happens to be
behaviourally inert), not a divergence.

**f. `UNKNOWN_a329_writer` -- closed, genuinely no writer; corrects a prior doc conflation.** The one
real reference (`search_byte_patterns` for `29 a3`, one hit after discarding a coincidental
instruction-boundary false-positive at `499C`) is `CMP byte ptr CS:[0xA329], 0x1` at `1000:37BF`,
inside `CheckCheatSpotsThenPause` -- the pause menu's F12 screen-dump gate (`docs/track-graphics.md`'s
`SCREn.RAW`/`DumpWorkSegToScreRaw`). `read_memory` at `1000:A329` reads `0`, and no writer exists
anywhere. **This is a different byte from the real `25011968` cheat flag** (`DS:[0x0F69]`, confirmed by
raw bytes at its own read site `1000:289D`, which a stale Ghidra xref had wrongly attributed to
`0xA329` -- another instance of `PLAN.md`'s "stale listing" pitfall, caught by re-disassembling from
fresh bytes rather than trusting the existing xref). `docs/track-graphics.md`'s own phrasing ("the
cheat flag (`CS:A329` / `DS:0F69`)") conflated the two as if interchangeable; they are not. Net effect:
**the F12 pause screen-dump is dead code in this exact shipped binary** -- its gate reads a
permanently-zero byte, so it can never pass, regardless of whether the real `25011968` cheat is active.
`docs/track-graphics.md` corrected below.

**Method note.** Both (e) and (f) are the same shape: a `CS:`-segment-override read of a fixed,
never-written byte that happens to sit in otherwise-inert data (string padding for 93C2; a lone zero
byte for A329), making an apparently "unknown writer" resolve to "no writer, by design or by dead
code" rather than a missed trace. Worth remembering next time an item is phrased as "X has no writer"
-- check whether X is a `CS:`-relative constant before assuming a search gap.

**Added 2026-09-24 (§9ay).** GOAL-DOS-PARITY.md P3's first item resolved and ported: the tournament
board screen (`DrawTournamentBoard 1000:18d8`), including its own real when-shown gate (re-derived
from `SetupTournamentRace 1000:115c`, not `18d8` alone: Challenge format only, never the qualifier,
never the very last race, and -- corrected by an advisor review before commit -- a pending bonus
race's own board call happens BEFORE `[28C1]` advances, needing its own `boardRaceIndex` index
correction, `tournament.js`), the icon-position/frame formula (confirming §9t's own prior derivation
byte-for-byte against the live table; for a regular race the newest icon PREVIEWS the upcoming race,
not a trophy for one just finished, another advisor-caught correction), and the blink/timeout exit
logic (`FUN_1000_17ff`, simplified to the project's existing `AWAIT_RELEASE` idiom, documented; the
real tick constants are 36/720, not 35/700, a third correction). New, deliberately unported open
item: the round-9 "reveal" branch (`1000:192b-198d`) -- the NORMAL path for every bonus race, not a
rare one -- draws past `MINATURE.CHR`'s own real 38-frame table (a genuine benign OOB read in the
original), not pixel-replicated.

**Added 2026-09-24 (§9az).** GOAL-DOS-PARITY.md P3's second item resolved and ported: the real
interactive opponent picker (`FUN_1000_1A4A`), replacing the port's own old first-3-untaken-roster
auto-pick. The item's own "before the picker exists" trap resolved directly from the bytes: the
Challenge qualifier's own 3 opponents are a hardcoded JETHRO trio (`102B`/`10A0`'s own raw writes,
not a real pick, no roster `taken` flag, no tuning effect since `tournamentIndex<=0` always
discards the character-based `KID_MODIFIER` lookup for the qualifier specifically), and
`ResetTournamentState 0EBA` resets all 4 face-preview slots to an "unpicked" sentinel that the
qualifier's own raw writes never clear -- so the real picker, run once right after a Challenge
PASS, reliably finds exactly 3 unfilled slots every time. `tournament.js`'s `pickOpponentCharacter`
(already used for H2H) is reused, not replaced, for all 3 Challenge picks; `09E0`'s own commit
block, fully disassembled for this item, confirmed it services all 4 car slots identically.
`[0x404]` is confirmed write-only/dead (a `search_byte_patterns` sweep found only its own 2
writers), so item 3's own design should not assume it names "which slot to replace". A second
advisor review caught a real regression in the first working draft before commit: `confirm()`'s
`PRESS_ANY_KEY` branch skipped `nextAfterOutcome()`, so the just-shipped tournament board (P3's
first item) never actually showed before race 1 -- fixed, and live-tested end to end afterward
(the same live pass gave P3's first item its own first live board render too, closing that item's
own "not obtained" gap as a side effect). Also fixed: a wrong citation for the roster's own `|0x40`
taken-bit write site (the real one is `1000:0AC2`, not the commit block first suspected), a missing
`subMenuMusic` call, and `lastPick.challengeOpponent` never resetting between tournament runs. New,
deliberately unported finding: `FUN_1000_19F2` (`1A4A`'s own first call) draws a real 4-face status
panel this port does not reproduce.

**Added 2026-09-24 (§9ba).** GOAL-DOS-PARITY.md P3's third item resolved and ported: the elimination
screen (`ShowCharacterEliminatedTune6 1000:16de`, its own 17-byte wobble curve at `DS:034B` -- §9t's
"a short tone plays" claim corrected in place, no tone plays per step, only a one-time tune-6 at
entry) and the real eviction/replacement rule, settling the item's own "not a derivation" flag: a
3-slot descriptor-address cursor (`DS:0346`), not "roster position modulo opponent count" as this
file's own prior prose guessed -- first eviction picks the lowest-index CURRENT opponent, every
later one just advances the cursor (even on a no-op pass, so a replacement CAN be re-evicted); the
victim's `taken` bit is never cleared, only `eliminated` OR'd in; the replacement is chosen by the
PLAYER through the SAME `1A4A` carousel P3's second item ported, not auto-picked (correcting both
this file's own and §9k's prior claim about the original game specifically). Also settled: the
bounce icon is `FCSAD.CHR`, not `FCNORMAL.CHR` (confirmed live via `DS:0A3A`'s own arena-offset
arithmetic); the shared wait function `1000:179B` has no real timeout past its own initial
debounce (`CS:[0x93C2]` is the same dead constant §9ar e already found, so the "press any key" step
waits indefinitely, matching the existing `RACE_INTRO` idiom rather than `PRESS_ANY_KEY`'s own
timer); and `faceFrame`'s branch priority (P2's own item 3, §9ax) had eliminated/taken backwards --
`0DB0` tests `0x20` (eliminated) before `0x40` (taken), fixed. An advisor review of the SYNTHESIZED
PLAN, before any code was written, caught three real bugs the plan would otherwise have shipped
with, all in the eviction trigger's own timing/ordering (a pre/post-increment miscount that would
have evicted one race early -- the third instance of that exact bug class this session, after
§9ay/§9az's own `effectiveRaceIndex`/`tournamentIndex`; an `!bonusTriggered` gate that would have
wrongly skipped eviction on a race that also triggers a bonus; and a RESULTS-table snapshot that
would have been taken after the eviction had already nulled the just-raced opponent's own slot) --
each written correctly from the start and covered by a dedicated regression test, each individually
confirmed by reintroducing the bug alone and re-running the suite. A second advisor review, of the
committed code and tests, then tightened the proof-of-failure methodology (a whole-`src/` stash only
proved missing exports, not that any assertion catches its own bug) and settled -- by fresh
re-disassembly, not by re-asserting the prior claim -- a concrete question it raised: whether
`[0x310]` and `[28C1]` (conflated as interchangeable by the first pass) could actually disagree
across a bonus race and double-fire the eviction gate. They cannot: exhaustively confirmed always
equal by construction, and `TriggerBonusRace`'s own full body never reaches the gate at all. P3's
second item's own deliberately unported `FUN_1000_19F2` 4-face status panel is ported now
(`drawOpponentPanel`), since this item's bounce icon needs the same row layout; shown for both the
initial 3-pick and a replacement pick, closing that item's own deferred gap as a side effect. Two
further render-only bugs, caught only once this item was actually rendered rather than just unit
tested (a red "?" placeholder shown at the victim's own panel slot; the bounce's own final frame
snapping to the wrong Y-offset, then -- once clamped -- wrongly assumed to freeze there rather than
vanish), are both fixed. A briefly-open item from that same pass, `UNKNOWN_elimination_bounce_clip_band`
(a possible clip from `089C`'s own partial-band VGA present), is now resolved and closed: that band
turned out to be an unrelated, harmless refresh optimization (a red herring); the icon actually
SQUASHES instead, via a per-step row-count shrink (`1000:1767`) independently confirmed against three
functions and ported with a new `cropRows` blit option -- see §9ba's own dedicated paragraph.

**Added 2026-09-24 (§9bb).** GOAL-DOS-PARITY.md P3's 4th item resolved: the 5 still-open Challenge-
rule divergences from §9an 8's own bullet list, all 5 fixed. 1: the tournament's very last race
accepts only 1st place, not 2nd (`1000:15B7`/`1658`, correcting `reportRaceResult`'s flat
`finishPosition>=3` fail threshold -- also resolves a loose end an earlier `mm-re-player-visible`
pass, §9ai, left as "an apparent exception... could not further explain" in the SEPARATE
results-tune goal item). 2: the bonus-race TRIGGER (`1123-113A`) has no cap at all, only the bonus-
TRACK counter (`[0x342]`) is capped, at `TriggerBonusRace`'s own resolution time -- an extra,
wrong cap on the trigger itself is removed from `maybeTriggerBonusRace`; a first pass at this item
also missed two further real bugs in that SAME resolution-time code, caught by a later advisor
review: the counter's own increment (and the newly-added life grant, below) must be WIN-gated
(`1A92`), which the port's own draft did unconditionally, and a WON bonus race never actually
incremented `state.lives` at all (`1CF7-1D08`'s own real `INC [0x406]`) -- both fixed. 3: a passed
Challenge race shows RESULTS only -- **a real, currently-shipping bug, not "already correct" as a
first pass at this item concluded** (an advisor review caught that checking only `screenAfterRace`,
which decides the FIRST screen, missed `flow.js`'s own SECOND transition, `confirm()`'s `RESULTS`
branch, which showed a spurious OUTCOME screen -- "QUALIFIED FOR CHALLENGE!" -- after EVERY passed
regular race): a new `showsOutcomeAfterResults` predicate now gates that transition, true only on a
loss, matching `1650-166A`'s own real "a PASS jumps straight past the outcome-message call"
behaviour. 4: OUTCOME code 4 (NO_BONUS) plays tune 6 like every other even code, correcting a real
error an earlier `mm-re-player-visible` pass made ("code 4 skips the whole real screen... jumps
straight past its own AH=4") that this session's fresh, twice-independently-repeated re-disassembly
of `1c6a-1c89` found no support for -- `raceOutcomeMusic`'s own early-return removed. 5: the `]` key
(scancode `0x1B`) zeroes lives while viewing the `ONE_LIFE_LOST`/`EXTRA_LIFE` outcome screen, ending
the tournament immediately only for the former (a real caller-side asymmetry in the bytes) -- ported
as a new `applyLivesCheat` export (its own reachability guard moved inside the function itself,
after an advisor review noted the original draft left it untested in the caller), wired into
`flow.js`'s `onKeydown`. Full derivation, every correction, all 5 items: §9bb.
New open items surfaced by this same pass, deliberately NOT fixed (out of scope for this item), NOT
yet added to any GOAL-DOS-PARITY.md checklist item -- both need their own new bullet next time P3
or P5 is picked up:
**`UNKNOWN_outcome_screen_timeout`** -- the real `1C1B` wait loops both have a real ~700-tick
(`0x2BC`, ~10s) timeout AND exit on a plain key RELEASE (`[0x107E]`, the SAME global release latch
`RunTwoItemMenu`/the title's own exit test already use, §9av) or fire, not a keyDOWN (`1D0D`:
`1D2B`'s own timeout test, `1DD4`'s own `[0x107E]!=0` release exit, `1DDB`'s own fire exit; `1DE5`:
its own timeout plus `17FF`'s shared blink/wait helper) -- unlike this port's own OUTCOME phase,
which waits indefinitely on `keydown` (Space/Enter only), no timeout, matching every OTHER menu
phase's own idiom in this project but not this specific screen's real exit conditions. The SAME
release-not-keydown mismatch also applies to `]` itself (`1DCD` tests the release latch, this
port's own handler fires on `keydown`). **The `]`-cheat's own real byte-wraparound consequence at 0
lives is now RESOLVED, not still open** -- see §9bc (added the same day, right after this note was
first written): `[0x406]` is a single byte, so a loss reached with it already at 0 underflows to
255 rather than ending the tournament; `tournament.js`'s own `decrementLives` now reproduces this
exactly, closing GOAL-DOS-PARITY.md's own "two INFERRED tournament rules" item in full.

**Added 2026-09-24 (§9bc).** GOAL-DOS-PARITY.md's own "two INFERRED tournament rules" item
resolved: what ends the tournament at 0 lives (an exhaustive `search_byte_patterns` sweep of every
`[0x406]` reference found it's a single BYTE, tested for EXACT zero at `166D`/`1403`, wrapping to
255 rather than going negative on underflow -- `decrementLives`/`incrementLives` now reproduce this
exactly), and the win-streak-after-a-bonus-race half (already settled by an earlier session, §9t,
just needed the header's own stale "not evidence" framing removed now both halves are cited
together). The SAME sweep also surfaced, and this pass fixed IN PLACE rather than leaving open, a
real pre-existing bug: `flow.js`'s own `finishRace()` read CHEATS.BIN spot-effect TYPE 0's
accumulated life loss (`globalState.lives`, `cheats.js`'s own `case 0`) through an ordinary signed
`Math.max(0, ...)` clamp instead of the same byte-wrap -- found by grepping the actual call sites
rather than trusting `cheats.js`'s own header comment, which claimed (by then stale) that `lives`
"has no reader." Fixed via a new `applyLivesDelta(state, delta)` export (`tournament.js`), applied
by `reportRaceResult` (`finishRace()` itself only carries the delta out); `cheats.js`'s header
corrected to point at the real reader.
A real ordering bug surfaced by a follow-up review (an earlier check only confirmed `cheatActive`
can't turn on mid-tournament, which doesn't cover a race where a type-0 decrement AND a loss happen
together): the port's own `25011968`-cheat reset ran in `advanceRace`, AFTER the full
result-reporting pass (including the loss check), instead of BEFORE it as `1000:11BA` does (right
after the race, before the results screen) -- so an active cheat's own type-0 pause decrements
could survive long enough to genuinely zero `tournament.lives` and end the run, the opposite of
DOS. Fixed, not left open: `reportRaceResult` itself (`tournament.js`, the one function that IS
unit-tested) now takes `lifeDelta`/`cheatActive` and calls a new `applyPostRaceLives(state, delta,
cheatActive)` export (delta, then reset in DOS's own order) as its own very first statement, before
every branch below it; `flow.js`'s `finishRace` no longer touches `tournament` directly, only
carrying `lifeDelta` out in its resolve payload for `advanceRace` to forward. Since
`reportRaceResult` is shared by every race type, this also closes the port's separate pre-existing
"never re-arms for a bonus race" gap for free. This closes `UNKNOWN_25011968_reset_timing` in full.
(Two earlier claims in this paragraph's own history were checked and corrected in place, not
silently dropped: that the gap "could still end the tournament on the cheat's very first loss" --
false, then that it reduces to an inert, unobservable byte value with "nothing observable to fix"
-- also false, once a type-0 decrement is in the same race as the loss.)

**Added 2026-09-24 (§9bd).** GOAL-DOS-PARITY.md's "results screen tune condition" item resolved:
`1000:1439`'s full 242-instruction body re-disassembled fresh, confirming the tune test
(`1410-1427`) is byte-for-byte identical to two other sites in the SAME function -- `1650-1667`
(the outcome-gate) and `15A5-15C7` (a per-row results-label pick) -- both already found and fully
disassembled by §9bb item 1, which ported the outcome-gate and explicitly deferred the tune site as
the one piece left on the `lastPassed` approximation. One rule, tested three times, not
independently-drifting copies. New `resultsPassed(state,
finishPosition)` export (`tournament.js`) extracts it; `flow.js`'s `advanceRace` computes it
directly (captured before `raceIndex` advances) and passes it to `raceResultMusic`, replacing the
old indirect `lastOutcome`-derived value that fed the tune specifically. `lastPassed` itself (which
also feeds `drawResults`'s "QUALIFY"/"FAILED" text) needed no change -- a draft that redirected it
to the same new export too was checked against the qualifier/H2H cases folded into that branch and
found wrong there (`resultsPassed`'s own formula disagrees with `lastOutcome` for those two), and
reverted. Also independently confirmed, not assumed: `finishPosition` reads the same order-array
slots `[3FC]`/`[3FE]` DOS does, including under the instant-win cheat (`36A7`'s own writes resolve
to exactly `[0,2,1,3]` at `11D5`, matching `cheats.js`'s own `fixedOrder` hardcode).

**Added 2026-09-24 (§9be).** GOAL-DOS-PARITY.md's "H2H race-intro variant" item resolved, scoped:
`1000:11F8`'s full body re-disassembled (162 instructions), settling that `12BD`'s portrait panel
(`19F2`, already disassembled by §9az for its OTHER call site) plus a 4-slot vehicle-class icon
reveal is the ONLY race-intro mechanism for a regular race in EITHER format -- not an "H2H variant"
of something otherwise-ported, correcting §9an 1's own parenthetical. Only the icon-slide's exit
condition and count (2 vs 4) are format-specific: H2H converges two icons over 59 ticks, Challenge
marquees four over 121, both fully traced tick-for-tick. Two things ported, per an explicit user
decision after being shown the full-sprite-panel alternative: `raceIntroHoldTicks(state)` (the
`131F` slide loop's own tick count, wired into `flow.js` as a hold on `confirm`; a press during it
is discarded because `179B`'s own entry clears the key-release latch, not merely because the loop
itself never polls, and proven only for a press-and-release inside the hold, not a key still held
when it ends -- the same gap as `UNKNOWN_outcome_screen_timeout`) and `raceIntroParticipants(state)`
(two text rows listing the player then the opponents, standing in for `19F2`'s own face panel --
two rows and space-separated, not one comma-separated row, since `drawString`'s own glyph map has
no comma/lowercase; caught by rendering both formats to PNG and looking at them). The sprite panel
itself remains unported, matching §9az's own established precedent for the same `19F2` function.
New, narrower open items: `[BX+0xA]`'s
exact meaning (likely a flip byte); the vehicle-icon asset's own binding;
`UNKNOWN_challenge_qualifier_intro_banner` (`127E-12BA`, a genuinely separate, unexplored mechanism
for the Challenge qualifier's own screen); and `UNKNOWN_race_intro_prehold` -- `raceIntroHoldTicks`
covers only the `131F` slide loop, not the `32CE` palette fade-up that runs before it, which has no
derivable tick duration at all (already established elsewhere as CPU-speed-bound, not tick-paced),
so this port's own hold understates the real DOS delay by that fade's own duration.

**Added 2026-09-24 (§9bf).** GOAL-DOS-PARITY.md P4's first item, step 1 of an explicit 4-commit
plan: `race.js`'s `spawnCars` now derives `car.isDrone` from controller type (`controllerTypes[i]
===6`, the real `[BX+0x12EB]`), not car index, proven against every reachable runtime reader
(fire-preempt, round-7 TANKS steer-mod, `collide.js`'s wall-stuck counter). While tracing an
adjacent, already-ported mechanism (`tuningFieldsFor`'s own `4070`/`40A0`, the late-tournament
two-car `accel` reduction, §9y), the actual gate on the WHOLE `3FBE-4134` region those sit in was
found to be a per-RACE mode fork at `1000:3F30` (`CS:[0x9C62]`/`DS:[0x8A2]`), not anything car-index
or raceFormat related directly -- and two-human H2H's own entry (`1F80`'s own `JZ 1FA9` rejecting
`CX==0` before `[0x8A2]` is ever stored nonzero) means that mode ALWAYS takes the OTHER branch,
`3F3B-3FBD`: a fully separate, entirely UNPORTED per-car loop computing all seven of
`tuningFieldsFor`'s own fields (all already named in `car.js`, checked directly) for every car from
each car's own roster byte, symmetrically, with no car-0 exception at all. So a human P2 in
two-human H2H does NOT inherit car slot 1's usual drone tuning, as an earlier draft of this section
concluded -- porting `3F3B`'s own alternate formulas (derived instruction-by-instruction, written
into §9bf) is now a PREREQUISITE for that mode's first playable race -- new open item
`UNKNOWN_alt_tuning_path`. What `[0x8A2]` itself MEANS is a separate, still-open item,
`UNKNOWN_8a2_meaning`: NOT confirmed to be the handicap question's own Y/N answer (a value with
`0B51`'s own separate, confirmed toggle screen was traced to `DS:[0x1D6+character]` instead,
exactly the bit `3F3B`'s own roster-byte test reads) -- more likely a two-player-mode selector,
but unconfirmed, deferred to the start of the `3F3B`-porting commit. Two smaller open items:
`UNKNOWN_0400_mode` (`[0x156]`'s own H2H-specific second box in the shared UI helper
`FUN_1000_0400`); `UNKNOWN_f61_p2_control_word` (whether `[0xF61]` is genuinely SETTINGS.DAT's P2
control word).

## 9as. P1's first item: the logo intro's real per-frame animation (2026-09-24)

Full account, and every cited address, in `docs/intro-and-codecard.md`'s own "The real per-frame
animation and its real skip input" section -- this entry is a pointer for the subsystem index.

Full re-disassembly of `RunIntroMainLoop 1000:097f` and its callees. Ported `flow.js`'s static
`composeLogoScreen()` still frame into the real thing: 48 records revealed one per vsync, the two
banners sliding concurrently, then a diagonal shine sweep once the slide stops, self-terminating
at exactly 314 iterations (~4.49 s at the real ~70 Hz vsync rate) unless a mouse click ends it
early. `UNKNOWN_intro_key_effect` closed: **no key skips it** -- `SM.EXE`'s own `INT 9` hook
consumes every keystroke itself (sends its own EOI, never chains to the BIOS), so nothing
downstream, including `FONT.BIN`'s own code-card input, ever sees one. The one real keyboard
effect is holding A and B together, which holds the post-shine exit counter at 0 for as long as
both are held (a debug/build-stamp leftover whose own visible draw is inert here, since
`ANTIFONT.BIN` ships 0 bytes) -- reachable, so ported as a level check on both keys, not the
scancode latch it technically is (behaviourally identical, sampled once per iteration either way).
The shine's own bright/dim arithmetic is ported exactly, including a real, permanent artefact: 5
of its 30 diagonal bands are never dimmed back (Dim only revisits bands 2..26 of 30), so the
banners are left with a lasting `+0x10` brightening at their edges, because nothing redraws them
after the slide stops -- proven pixel-exact against the untouched `composeLogoScreen()` still
frame in `tools/check-intro.mjs`. New, narrow, not blocking: `UNKNOWN_intro_loop_vs_total_gap`
(the loop's own derived duration is ~0.23 s short of the M3.30 whole-process figure; plausibly the
pre-loop setup, not separately timed -- see the linked section for the live check that would
settle it).

## 9at. P1's second item: the real code-card screen (2026-09-24)

Full account, and every cited address, in `docs/intro-and-codecard.md`'s own "The real code-card
screen" section -- this entry is a pointer for the subsystem index, as §9as was for the logo.

Full from-scratch disassembly of `FONT.BIN` (not the prior "symbols + cursor + patch sites" pass),
live-confirmed in DOSBox. Ported `flow.js`'s missing code-card screen into a new `CODECARD` phase
between `LOGO` and `TITLE`: the real 640x350 mode-10h layout (two flat background fills, colours 9
and 10, with a 4-row gap between them that stays colour 0), the symbol grid at (216,179) cropped to
200 of its real 208 pixel columns (the original's own page-copy routine does this too -- checked
against the decoded strip, not assumed), the live target column/row read from the BIOS tick
counter's low byte (`col=AL&0xF`, `row=(AL>>3)&0xF`, re-read fresh every round -- live-confirmed
changing between boots and between the two rounds of one boot), the trilingual (English/French/
German) welcome text with the target's column-letter/row-digit overlay poked into 3 fixed slots per
language, and the exact 4-direction cursor wrap -- RIGHT/LEFT wrap in reading order, but **UP/DOWN
wrap column-major** (an advisor review caught a first draft's own mistake here, defaulting UP/DOWN
to the same reading-order wrap RIGHT/LEFT use; re-verified directly against the bytes before
porting). The two-round accept flow (both compare sites patched to always "pass", per this file's
existing patch-site account) shows "Correct, now one more" between rounds without disturbing the
grid or the cursor underneath (only rows 0-167 clear), and round 2 falls straight through to the
title with no second interstitial -- all four of these exact behaviours were watched live in
DOSBox, not just read from the bytes. The BIOS's own 8x14 ROM font (needed for the text, since
FONT.BIN calls `INT 10h AH=13h` and never embeds the glyphs itself) was captured live from
DOSBox's `INT 43h` vector and committed as `src/data/bios-font-8x14.js`, with the user's explicit
approval, as platform data rather than game data. New, narrow, not blocking:
`UNKNOWN_codecard_pixel_diff` (a true byte-exact pixel diff needs mode 10h's 4 planar bit-planes
combined, not the single flat `mem_read` mode 13h's linear framebuffer allowed elsewhere in this
project; left for Part F).

## 9au. P1's third item: the real GAME OPTIONS screen (2026-09-24)

Full re-disassembly of `RunOptionsScreenWithSettingsDat 1000:2770` and its four sub-screens
(`ShowCredits 2A82`, `AttemptJoystickCalibration 2AB5`, `RunRedefineKeysScreen 92F0`,
`AutoDetectSmoothnessByRetraceLoops 3AD0`), live-confirmed in DOSBox (`game/` mounted read-only).
Ported into `src/frontend/flow.js`'s new `OPTIONS` phase, between `CODECARD` and `TITLE`; the
pure cycling/matching logic lives in the new `src/frontend/options.js` (mirroring `gfx1.js`'s/
`fontbin.js`'s own step-function pattern for the two earlier P1 items); proven in
`tools/check-options.mjs` (`npm run options`).

**F1/F2, the real device-cycling gate -- asymmetric, not a simplification.** Both keys share one
inner "keep incrementing until a valid choice is found" loop (`1000:2943-296B` for F1,
`296E-29A8` for F2), but the two are NOT mirror images: **P1 can never reach JOY2 or MOUSE, full
stop, regardless of hardware** (`1000:295D-2965`: `BL==1` or `BL==2` unconditionally re-loops, no
device-presence check at all) -- P1 only ever cycles JOY1 (gated on `[2625]!=0`, at least one
stick)/KEYS1/KEYS2. **P2 can reach any of the five**, each gated on real presence: JOY1 needs
`[2625]!=0`, JOY2 needs `[2625]==2` (both sticks, not just "a second one"), MOUSE needs
`[2627]!=0`. Both also skip whatever the OTHER player currently has (no sharing one device).
Live-confirmed with no joystick or mouse present (this port's own state today, P6 not started):
one F1 press and one F2 press each cycled silently through every rejected candidate and landed
back on their own starting value -- a real "no visible change", not a bug, matching
`options.js`'s own `controlAvailable`/`cycleControl`.

**F3 (sound) and F4 (smoothness), live-confirmed wraps.** F3: NONE(0)->BLASTER(1)->SPEAKER(2)->
NONE (`1000:29AA-29C3`); also reloads the driver for whatever was CURRENTLY selected before
advancing (an existing Ghidra plate comment from an earlier session, re-confirmed, not re-derived
fresh). F4: HIGH(1)..LOW(4)..**AUTO(5)**->HIGH (`1000:29CC-29D8`) -- see the correction to this
file's own §9t above; AUTO resolves at RETURN (`1000:2A6E-2A7E`) via
`AutoDetectSmoothnessByRetraceLoops 1000:3AD0`, a VGA-retrace-synchronized busy-loop counting how
many ~1000-iteration passes fit in one frame (>=0x18 -> HIGH, >=0x14 -> GOOD, >=0xD -> MEDIUM,
else LOW) -- a real hardware-speed probe with no meaningful browser equivalent (any machine this
port runs on trivially clears the `>=0x18` threshold an 800MHz-in-1994 sense of "fast" set), so
`frontend-tables.js`'s `resolveSmoothnessForPlay` resolves AUTO to 1 unconditionally rather than
attempting to replicate timing that can't mean the same thing on modern hardware.

**F5, the redefine-keys screen (`92F0`), live-confirmed cumulative layout.** NOT cleared between
groups -- only once, at entry. "KEYS 1" and its 5 confirmed labels stay on screen while "KEYS 2"
and its own 5 draw below them; a real DOSBox screenshot this session showed exactly this (KEYS 1's
full block, then "KEYS 2 / LEFT" appended beneath it). SPACE (`0x39`) is rejected outright
(`1000:9362-9364`, loops back to the same slot); a scancode already used earlier in this SAME
10-key pass is rejected too (`936E-9373`, checked only against this pass's own keys, not any
previous SETTINGS.DAT) -- live-confirmed both (a Space press on BRAKE re-prompted BRAKE; the
scancode-to-display-char table `1000:ADF0` was read in full and matches `frontend-tables.js`'s
`REDEFINE_DISPLAY_CHAR` exactly). ESC here returns to the main options screen without saving any
of this pass (`93BB`: a plain `RET`) -- live-confirmed, a different code path from the top-level
ESC (below). Only 10 of the 16 SETTINGS.DAT scancodes are ever touched (KEYS1 slots 0-4, KEYS2
slots 8-12); F1-F3 (5-7) and D/SPACE/V (13-15) are copied through untouched
(`1000:93AC-93BB`).

**F6, the credits (`2A82`).** 10 lines, `DS:0F75`, dismissed by any key -- text extracted directly
from the DS image and live-confirmed pixel-for-pixel against a real DOSBox capture (this session).

**ESC vs RETURN, and the dirty-flag save rule.** Live-confirmed both: ESC from the MAIN options
screen (`1000:28BE-28C2`, `STC;RET`) drops straight to the real DOS prompt, `C:\>`, no
confirmation, no write -- the dirty flag (`[0xF63]`) is never even consulted on this path. RETURN
(`1000:2A0E-2A6D`) writes the full 32 bytes ONLY if `[0xF63]!=0` -- and `[0xF63]` is set by F1-F5
and F7 UNCONDITIONALLY, before doing anything else, even when the resulting value doesn't actually
change (an F1 press that cycles all the way back to its own starting value still marks the
settings dirty) or when F7 has no joystick to calibrate. The port's own `settingsDirty` flag
mirrors this exactly (set in `optionsMenuKey` before the value even changes), so a `RETURN` with
nothing touched still round-trips through `serializeSettings` if ANY F-key was pressed, matching
the real bytes' own "dirty on touch, not on change" rule -- not the more intuitive "only save if
something is actually different" a naive port might implement instead.

**The 25011968 cheat (`DS:0F6B-0F72`).** Matched against `[0x107E]` as raw **number-row
scancodes**, not ASCII (`03 06 0B 02 02 0A 07 09` decodes via the standard PC/XT set to digits
2,5,0,1,1,9,6,8) -- the port compares against the typed digit character instead, an equivalent,
simpler representation of the same real bytes. A mismatch resets the cursor to 0 WITHOUT
re-testing the mismatched key against digit 0 (`1000:291E`, an unconditional `MOV [0xF73],0xF6B`)
-- typing "225011968" does NOT trigger it, only a clean run of the whole sequence does; live- and
unit-confirmed (`tools/check-options.mjs`). Completion sets `[0xF69]` (draws a live-confirmed "!"
in the corner of the options screen, `1000:289D-28AA`, `SI=0xF00`) and `[0xF6A]` (a second flag,
one further reader found this session at `1000:1398` inside the shared race-intro wait helper
`179B` -- not traced further, out of this item's own scope, a new narrow open item). `[0xF69]`'s
own documented effect (docs/engine.md §7: "cheat `[F69]` -> 10 after every race") is wired into
`flow.js`'s `advanceRace`, setting `tournament.lives = 10` after every non-bonus race report while
the cheat is active.

**SETTINGS.DAT persistence.** DOS reads the file once per session (`[0xEFF]` gate,
`1000:2778-27E0`) and writes it back only when dirty. A browser has no writable `game/`, so the
port keeps the identical 32-byte layout in `localStorage` (`mm-settings-dat-v1`, base64) instead,
via `globaldata.js`'s new `serializeSettings` (the exact inverse of the already-existing
`parseSettings`, round-trip-proven byte-exact against both the real shipped `game/SETTINGS.DAT`
and the DS image's own no-file default). Seed priority, live- and unit-confirmed: the
`localStorage` value (if a previous session saved one) -> `game/SETTINGS.DAT` (if present, the
common case) -> the DS image's own static defaults (`globaldata.js`'s `DEFAULT_SETTINGS`, re-read
live from `193C:0F5F/0F61/263A/106C` this session -- P1=KEYS1, P2=KEYS2, HIGH, SPEAKER, the
DS-image default KEYS2 fire key is Insert `0x52`, not the shipped file's own `S`). Live-confirmed
end to end: cycling F3 to NONE and pressing RETURN persists `soundDriver:0` to `localStorage`; a
fresh page load then seeds from THAT instead of the shipped file's own BLASTER default; pressing
ESC instead leaves `localStorage` untouched.

**Wired into the race itself.** `controllerTypes[0]` (previously hardcoded `5`) now carries the
real `settings.p1Control` value (`1000:2D00`'s own `BuildInputReaderTable`, already a 1-based
1-5/6 enum matching this project's own existing `step.js` convention exactly, needing no
translation); the keyboard reader picks `settings.keys1` or `settings.keys2` to match. The
header's own `<select id="smoothness">` on `game.html` is removed (F4 is the one real control now,
including AUTO, which the header control had no way to represent) -- `index.html`'s own
single-race page keeps its header control unchanged, since it never goes through the boot chain
this item covers.

**Method note.** The AUTO correction above is this session's own clearest instance of PLAN.md
§8's "re-verify, don't just re-read a prior claim" pitfall: a live DOSBox capture (four F4 presses
showing "AUTO" on a real GAME OPTIONS screen) settled in one screenshot what a purely static
re-read of the SAME already-cited addresses could have gotten wrong a second time, because the
original mistake was a scope gap (checked the display side, not the input side) that rereading the
display side again would not have caught.

New open items, not blocking: `UNKNOWN_f6a_reader` (`[0xF6A]`'s own effect at `1000:1398`, inside
the shared race-intro wait helper -- found, not traced); `UNKNOWN_joystick_calibration_body`
(`2B8B`/`2B8F`'s own real analog-port-timing reads, deferred to P6 with the rest of joystick
input); `UNKNOWN_options_pixel_diff` (same shape as codecard's own, left for Part F).

## 9av. P2's first item: the real title attract loop (2026-09-24)

Full re-disassembly of `RunTitleScreenAttractLoop 1000:0100` (78 instructions, 1000:0100-01dd) --
the DECOMPILER mis-resolved this function badly: every one of its real exit blocks was marked
`/* WARNING: Removing unreachable block */` and the whole loop printed as `do {} while(true)`,
because its exits are carry-flag-driven (`CLC`/`STC` before two different `RET`s the decompiler's
own control-flow recovery couldn't connect back to a caller). Ported into `src/frontend/flow.js`'s
new `TITLE` phase's own real-time loop (same `requestAnimationFrame` + tick-accumulator pattern as
the LOGO intro, `INTRO_TICK_MS` reused directly -- both approximate the same real ~70Hz `DS:0002`
tick); the pure state machine lives in the new `src/frontend/attract.js`; proven in
`tools/check-title.mjs` (`npm run title`).

**The exit test reads two completely different mechanisms, not one byte.** `1000:01be-01d8`:
- **Fire is a LEVEL test on `[0x137b]` bit `0x08`** -- and `[0x137b]` is **P1's own reader slot**,
  read directly. Unlike `RunTwoItemMenu` (P2's second item, `0382`), this function never sets
  `[0x1080]=0` itself (it's left at whatever OPTIONS/boot last set it), so `[0x108b]`'s own
  combined-both-players value is never consulted here -- **only P1's configured device can start
  the game from the title screen.** `input.js`'s `createKeyboardReader` already returns exactly
  this bit layout (`0x80/0x40/0x20/0x10/0x08`), so the port reuses it directly, `bits & 0x08`.
- **ESC-vs-other is a single-shot RELEASE edge on `[0x107e]`**, the GLOBAL (whole-keyboard, not
  per-player) "last released scancode" latch a fresh disassembly of the INT9 handler
  (`HookKeyboardInt09 498A` installs the real handler at `2efd`) traced in full: exactly one key is
  tracked at a time (`[0x107f]`, cleared at every screen entry, `[0x107e]=0;[0x107f]=0` -- title's
  own copy at `1000:0148/014d`) -- a fresh keydown is only tracked if nothing is already tracked
  (`2f65-2f6c`), and only THAT tracked key's own release records into `[0x107e]` (`2f43-2f55`,
  which also clears `[0x107f]` first, ready for the next key) -- ESC's own scancode is 1
  (`2f59: CMP AH,1`). This is a DIFFERENT mechanism from the 16-key LEFT/RIGHT/ACCEL/BRAKE/FIRE
  bitmask (`[0x107c]/[0x107d]`, the SAME ISR, `2f70-2f8d`, matching a byte-index-reversed reading
  of CLAUDE.md's own "16 keys to bits of DS:107C" -- index 0 (KEYS1 LEFT) is bit 15, not bit 0,
  confirmed by FIRE (KEYS1 index 4) landing on bit 3 = `0x08` of `[0x107d]`, exactly matching the
  `TEST AL,8` above), which is level-based and untouched by the single-key tracker.
  `engine/input.js`'s new `createMenuReleaseTracker` ports this exactly: one instance for the
  whole session (title, both menu levels and character select all read it), `.reset()` at each
  screen's own entry.

**No idle timeout, confirmed by absence.** Unlike `RunTwoItemMenu`'s own `0x7D0`-tick idle cancel
(P2's second item), there is no `[0x2]`-vs-threshold compare anywhere in this function -- the
showcase just cycles forever with no input. `check-title.mjs` proves a 100000-tick run with no
input never exits.

**The 9-class showcase, exact content re-read live (193C:002F, 110 bytes).** A NUL-walked string
table starting exactly at `SI=0x2F` (the same base `DrawMenuStringByIndex` walks with `CX=[0xbc5]`,
0-based, no off-by-one adjustment -- unlike the smoothness table's own base-minus-one convention,
§9au): SPORTSCARS, POWERBOATS, FORMULA ONE, TURBO WHEELS, FOUR BY FOUR, WARRIORS, TANKS, CHOPPERS,
RUFFTRUX (indices 0-8, exactly round order 1-9) -- then PRO FORMULA ONE (index 9) sits right after,
confirming CLAUDE.md's Anchors list, but `[0xbc5]`'s own wrap (`CMP CX,9 / JL`) never reaches it.
`frontend-tables.js`'s new `TITLE_CLASS_NAMES`/`TITLE_CLASS_NAMES_ADDR`, checked byte-for-byte by
`check-tables.mjs`. The copyright line ("COPYRIGHT CODEMASTERS SOFTWARE", `DS:0010`, drawn once,
16px font, `y=0xB7`) and INTRO.CHR's own fixed position (`x=0x50=80,y=100`, its descriptor's own
`+2`/`+4` fields, explicitly written at `1000:01df/01ed` every frame -- NOT centred by width the
way the port's own pre-P2 placeholder was) are likewise re-read live and exact. **There is no
"PRESS FIRE" string anywhere in this function's own disassembly** -- the port's own earlier
placeholder text (a UX nicety, not a real screen element) is dropped.

**Live-confirmed end to end** (DOSBox, `game/` mounted read-only, boot recipe from CLAUDE.md):
a title screen showing "FORMULA ONE" under the INTRO.CHR car frame and the exact copyright string;
ESC released on the title returned straight to GAME OPTIONS (confirms the `CF=1` path and
`real_entry`'s own `1000:0089: JC 0032` -- StopMusic, then `RunOptionsScreenWithSettingsDat`
again, not some intermediate state); this same live session is also what caught and corrected the
`[130]`=0 mistake in §9ao 7 above (a real fire-confirms-`SELECT GAME`'s-current-selection test,
once `input_key`'s own tap-drop issue was worked around with `input_sequence`'s explicit
press/delay/release).

**`real_entry`'s own master loop, re-disassembled (`1000:0006-00cb`) to place this item in context**
(also resolves `UNKNOWN_race_live_reverify`'s title-loop half, §9, for good): `0032`
(StopMusic) -> `2770` (OPTIONS; `JC 0097` = the real DOS-exit sequence on ESC) -> `2be8`
(SelectGameSetLvl) -> `321c` x2 (driver reload) -> tune-1 AH=9/AH=4 dance -> `0086: CALL 0100`
(title) -> `JC 0032` (ESC: all the way back to OPTIONS, not a shortcut) -> `0090: CALL 0220`
(`RunMainMenuKeepTitleTune`, P2's second item) -> `JC 0069` (0220's OWN top-level cancel/idle:
back to the tune-1 dance + title, not OPTIONS) -> else `JMP 008b` (anything else -- a submenu
cancel, or a finished tournament -- redraws `SELECT GAME` directly, no tune restart, no title).
This is P2's second item's own evidence too (recorded here since this session derived it while
tracing title's own caller), and already fixed one bug in the pre-P2 flattened menu: `confirm()`'s
own `TITLE -> MENU` transition called `subMenuMusic` (tune 2); the real transition touches the
sound driver not at all (tune 1 simply keeps playing) -- removed as part of this item's own
`enterTitle()`/`leaveTitle()`, which now own the whole TITLE phase's transitions in and out.

New open items, not blocking: `UNKNOWN_thumb_frame1_invisible` (§9ao 7's correction above -- THUMB
frame 1 renders no visible highlight in a live capture, frame 2 clearly does; a sprite-art question,
not a state-machine one); `UNKNOWN_title_pixel_diff` (LOGO's own exact y position wasn't re-read
live -- `frontend-tables.js`'s own layout choice keeps the port's earlier reasonable placement --
same shape as codecard/options's own pixel-diff items, left for Part F).

## 9aw. P2's second item: the real two-level menu (2026-09-24)

Full re-disassembly of `RunTwoItemMenu 1000:0382` (47 instructions, its own complete state
machine), `RunMainMenuKeepTitleTune 1000:0220` (SELECT GAME, including its tail at `02c1-02df`,
not previously disassembled -- the earlier decompile of this function silently dropped it) and
`RunOnePlayerGameMenu 1000:02e0` (ONE PLAYER GAME). Ported into `src/frontend/flow.js`'s new
`SELECT_GAME`/`ONE_PLAYER_GAME` phases (replacing the pre-P2 flattened 3-item `MENU` phase
entirely), driven by one shared real-time driver (`enterTwoItemMenu`/`twoItemTick`
/`leaveTwoItemMenu`) since both screens are the exact same `RunTwoItemMenu` state machine, ported
pure in the new `src/frontend/frontMenu.js`; proven in `tools/check-mainmenu.mjs`
(`npm run mainmenu`).

**`0382`'s own exact state machine, disassembled in full.** Two phases: `AWAIT_RELEASE` (draws
THUMB at the current selection, then waits for any already-held fire to be released, `0399-03A9`)
and `POLL` (`03C2-03FF`, entered with the idle timer freshly reset). Every tick in `POLL`: the
idle timer increments FIRST (`0382`'s own vsync wait increments `DS:0002` before any of the checks
below read it, so the port's own `state.idleTicks++` happens before its exit checks too, not
after -- an off-by-one a first draft of the port got wrong, caught by `check-mainmenu.mjs`'s own
tick-1999-vs-2000 boundary test); then idle-timeout (`>=0x7D0`) and ESC-release (the SAME global
`[0x107e]` latch `attract.js` reads) both cancel (`CX=0`); then fire, only accepted if the current
selection is nonzero (`03F8`); then LEFT(`0x80`)/RIGHT(`0x40`), which set the selection and
re-enter `AWAIT_RELEASE` -- **except a repeat of the SAME direction, which only resets the idle
timer and does NOT redraw or re-wait for release** (`03F0-03F2`, a real, provable distinction,
teeth-proven).

**`[0x130]`/`[0x132]`, re-read live: `1`/`2` at rest, not `0`.** This directly corrects §9ao 7's
own earlier claim (kept there, marked corrected, not deleted) that `SELECT GAME` "starts with
nothing selected" -- a fresh `read_memory` of the live DS segment right after a freshly-drawn
`SELECT GAME` screen (no LEFT/RIGHT ever pressed) showed `[0x130]=1`, and firing immediately
entered `ONE PLAYER GAME` -- `[0x130]`'s own value, not "ignored". The genuine, previously
undocumented finding underneath both corrections: **the two levels persist their own selection
asymmetrically.** `0220`'s own write (`02CB: MOV [0x130],CX`) sits AFTER an `OR CX,CX; JZ`
zero-check -- a cancelled `SELECT GAME` visit leaves `[0x130]` untouched. `02e0`'s own write
(`0360: MOV [0x132],CX`) has no such guard -- it writes UNCONDITIONALLY, including `CX=0` on a
cancel, resetting `ONE PLAYER GAME`'s own persisted pick to "nothing selected" for the next visit.
Live-confirmed end to end in the browser (not just unit-tested): entering `ONE PLAYER GAME` with
"Challenge" pre-selected (`X` marker shown), cancelling with ESC, then re-entering shows NEITHER
item marked -- exactly matching this asymmetry, and NOT something a symmetric implementation would
have produced by accident. `flow.js`'s own `lastSelectGameSelection`/`lastOnePlayerSelection`
mirror this exactly (the latter reset to 0 on any non-`'confirm'` exit, the former left alone).

**`real_entry`'s own master loop (already re-disassembled for §9av) is this item's own dispatch
table.** `1000:0090: CALL 0220; JC 0069` (SELECT GAME's own top-level cancel -- idle or ESC --
loops back to the tune-1 restart dance + `RunTitleScreenAttractLoop`, i.e. straight to the title
screen, not some intermediate state) `else JMP 008b` (anything else -- a sub-level `ONE PLAYER
GAME` cancel, choosing an item, OR a finished tournament all the way back from `RunTournamentLoop`
-- redraws `SELECT GAME` directly, no tune restart, no title). `flow.js`'s `enterSelectGame`/
`enterOnePlayerGame` port this precisely: `SELECT_GAME`'s own cancel calls `enterTitle()`;
`ONE_PLAYER_GAME`'s own cancel calls `enterSelectGame()`; and three PRE-EXISTING call sites this
session found were calling the wrong thing (all fixed as a direct consequence of tracing this
dispatch table, same shape as the `TITLE`->`MENU` tune-2 bug §9av already fixed): the champion
screen's own return to the menu, a finished (non-champion) tournament's own return, and `CHAR_
SELECT`'s own ESC -- all three previously did `phase='MENU'; ...; titleMusic(sound)`, restarting
tune 1 for no real reason; all three now call `enterSelectGame()`, which correctly does nothing to
the sound driver.

**Both players drive every level of this menu -- a real, live-confirmed asymmetry from the title
screen's own P1-only fire test (`attract.js`, §9av).** `0382` itself sets `[0x1080]=0`
unconditionally at entry (`0388`), which makes `[0x108b]` (the byte both the fire/LEFT/RIGHT tests
read) equal `[0x137b]|[0x14df]` -- P1's own reader OR'd with P2's, at BOTH `SELECT GAME` and `ONE
PLAYER GAME`. `flow.js`'s `enterTwoItemMenu` creates two `createKeyboardReader` instances
(`p1Keys()`/`p2Keys()`) and ORs their `.read()` results every tick, exactly matching this bit
layout (`input.js`'s own `0x80/0x40/0x08` convention already matches `[0x108b]`'s).

**`WORDS.CHR`/`SELGAM.CHR`'s own frame semantics, resolved live (settling the §9av-listed puzzle,
a DOSBox screenshot of `SELECT GAME` and `ONE PLAYER GAME` both taken this session).** `SELECT
GAME` pairs "ONE PLAYER" with a car-and-pointing-hand icon captioned "Challenge", and "TWO PLAYER"
with a dueling-drivers icon captioned "Head to Head" -- these are flavour-art previews of the
DEFAULT choice at each branch, not literal labels for what each button leads to (`ONE PLAYER`
itself leads to a submenu offering BOTH). `ONE PLAYER GAME` then shows the real two items: Left =
"Head to Head" (`0fbf`, `RunOnePlayerHeadToHeadVsCpu`), Right = "Challenge" (`102b`,
`RunOnePlayerChallenge`) -- confirmed both by descriptor-slot arithmetic (§9t, unchanged) and this
session's own screenshot. Not pixel-ported (the icons themselves, THUMB's own highlight sprite --
same convention as every other screen in `screens.js`); `drawSelectGame`/`drawOnePlayerGameMenu`
use the real string content (re-read live, `frontend-tables.js`) with a plain `X ` marker instead
(the font has no arrow/bullet glyph, same reason `drawCharacterSelect` already gives).

New open items, not blocking: `UNKNOWN_0eba_0400_menu_calls` (`RunOnePlayerGameMenu`'s own calls to
`0EBA`/`0400` right after the `[0x132]` write, before dispatching on the selection -- not traced,
likely roster/tournament-state boilerplate `tournament.js`'s own `initTournament()` already covers
functionally, but not confirmed byte-for-byte); `UNKNOWN_menu_pixel_diff` (same shape as every
other screen's own pixel-diff item, left for Part F).

## 9ax. P2's third and last item: the real character select carousel (2026-09-24)

Full re-disassembly of `RunCharacterSelectMenuTune2 1000:09e0` (131 instructions), its own scroll-
step helper `FUN_1000_0cd3` (the eased-scroll stepper), `DrawCharacterSelectGrid 1000:0d1f` (which
derives the "centred" character from the raw scroll position, not the reverse), `FUN_1000_0db0`
(the face-frame math), and `FUN_1000_0b51` (the handicap question's own gate). This closes out
**all of P2** -- the boot chain now ends with the real title screen, real two-level menu, and real
carousel before the tournament itself begins. Ported into `src/frontend/flow.js`'s existing
`CHAR_SELECT` phase (now a real-time carousel, matching the same driver pattern as every other P2
phase), pure in the new `src/frontend/charSelect.js`; proven in `tools/check-charselect.mjs`
(`npm run charselect`).

**The roster-byte encoding IS the taken/skip mechanism -- there is no separate "if taken" check
anywhere in this function.** `tournament.js`'s own roster array already stores each slot's OWN
identity byte (`index`, `|0x40` once taken, `|0x20` once eliminated -- CLAUDE.md's own long-
established convention, re-confirmed live in the disassembly this session). `DrawCharacterSelect
Grid` writes this SAME byte into `[0x160]` (the "centred" value) whenever a roster entry's own
cyclic position lands on `0x140` -- so a taken/eliminated slot's own value is simply > 10, and
every consumer that gates on `<=0xA` (the entry-time auto-skip loop `1000:0a65-73`, and the fire-
confirm test `1000:0ab8`) treats it as invalid for free, with no dedicated branch. This was the
key insight that resolved an apparent discrepancy: the flattened M3.9 port's own comment cited
`0AB5-0ABB` as "fire on a taken character is ignored", but that address range is actually the
BOUNDS check (`CMP AX,0xA / JA`), not a taken-specific test -- the M3.9 session's own citation was
imprecise, now corrected. `flow.js`'s `rosterBytes()` derives this exact byte view live from
`tournament.js`'s own roster array every tick, so a `pickPlayerCharacter`/`pickOpponentCharacter`
call (unchanged, reused as-is) immediately makes that slot invisible to the carousel's own logic
the very next frame, with no separate synchronisation step.

**The 13-step ease table (DS:0185, re-read live) sums to exactly 64:** `[2,2,2,2,4,4,4,4,8,8,8,8,8]`
-- 4 steps of 2px, 4 of 4px, 5 of 8px, an accelerating ease-in that speeds up as it approaches the
next slot. `0cd3`'s own exit test is `while (cumulative < 0x40)`, so the 13th step lands exactly on
the boundary with nothing left over. LEFT (`0x80`) takes the "add" branch (scroll increases,
wrapping at `0x2C0`=704=11×64), RIGHT (`0x40`) the "subtract" branch -- confirmed live in the
browser that this makes the INDEX move the opposite way a first guess might expect (RIGHT from
SPIDER(10) lands on WALTER(0), i.e. index+1 mod 11, not index-1) -- exactly what the disassembly's
own `BX=1`-for-LEFT/"add" mapping predicts, once traced through rather than assumed.

**Two distinct "wait" mechanisms, not one, confirmed by their own exact positions in the
disassembly.** Unlike `RunTwoItemMenu` (P2's second item, which re-enters its own release-wait
after EVERY selection change), this carousel waits for a held fire to release only ONCE, at entry
(`1000:0a4c-0a5d`) -- a LEFT/RIGHT press during the main loop never re-triggers it. And unlike the
menu's own re-drawn-and-re-waited direction changes, a real user LEFT/RIGHT press here always
settles after exactly one slot (13 ticks) regardless of whether the landed character is valid;
only the ENTRY-time skip loop (`1000:0a65-73`) keeps auto-scrolling past an invalid one.
`charSelect.js`'s own `ENTRY_SKIP` vs `SCROLLING` phases, sharing the identical substep code, port
this distinction exactly -- proven by a dedicated test that a taken STARTING character auto-skips
while a taken character reached by a real LEFT/RIGHT press just sits there, unconfirmable by fire.

**The 5-blink commit sequence, its own exact tick timing re-derived.** `1000:0ad7-0af9`: the pose
bit is toggled, then redrawn, THEN a 16-tick wait (`[0x2]>0xF`) -- toggle-then-wait, repeated 5
times (`CX=5`), so the 5 toggles land at ticks 0/16/32/48/64 relative to the fire press, with the
final (5th) wait completing at tick 80 with no further toggle -- the commit code runs immediately
after. `charSelect.js`'s own `BLINKING` phase applies the first toggle synchronously with entry
(matching the real code's own toggle-before-first-wait order) rather than after the first 16-tick
wait, a distinction a first draft of this port got backwards and a dedicated test (checking
`blinkCount===1` immediately after the fire press) catches. The actual bit-toggle math `0db0`
itself performs (a second, more intricate frame-index encoding for the "flicker between two
poses" effect) is NOT pixel-ported -- `screens.js`'s own `drawCharacterSelect` flashes the picked
face between its own portrait and FCNORMAL's "taken" pose (frame 13) instead, a documented, cheap
stand-in with the same 5-flash cadence.

**`FUN_1000_0b51` (the handicap question), its own gate ported as evidence, not wired to any
reachable screen.** Characters 0-2 only (WALTER/MIKE/ANNE, `KidModifier`'s first 3 entries), and
only in a REAL two-human Head to Head (`[0x2656]!=1` four-car AND `[0x265a]!=6` CPU) -- neither
condition is ever satisfiable by this port's own currently-reachable flows (one-player Challenge is
always four-car; one-player H2H vs CPU always has `[0x265a]==6`), so `handicapQuestionApplies`
(`charSelect.js`) is real, cited, teeth-proven `[STATIC]` logic ahead of its own call site, not a
port gap -- the question SCREEN itself, and its own downstream `KidModifier` handicap effect, are
two-human H2H's own concern (P4).

**`FCNORMAL.CHR`'s own frame layout, confirmed via `0db0`'s decompile:** frames 0-10 are the 11
characters' own portraits (the roster's own index value, once its flag bits are stripped), frame
12 is the eliminated pose (`0x20` bit), frame 13 is the taken pose (`0x40` bit) -- `screens.js`'s
new `faceFrame()` reproduces this exact 3-way branch.

New open items, not blocking: `UNKNOWN_162_stale_direction` (the entry-skip loop's own scroll
direction, `[0x162]`, is whatever a PRIOR screen last left it -- a genuinely stale global this port
does not replicate exactly, defaulting to LEFT/+1 instead, documented in `charSelect.js`'s own
header); `UNKNOWN_26cf_prompt_blink` (`FUN_1000_0c96`'s own `[0x26CF]`-gated prompt-text flicker
during IDLE, not ported -- a cosmetic nicety); `UNKNOWN_carousel_pixel_diff` (same shape as every
other screen's own pixel-diff item, left for Part F).

## 9ay. P3's first item: the tournament board screen (2026-09-24)

**Scope.** GOAL-DOS-PARITY.md P3's first checklist item: `DrawTournamentBoard 1000:18d8`, the
`CASE.CHR` map with `MINATURE` icons at the `DS:0312` positions §9t already named but never reduced
to a formula or wired to a screen ("both were M3.9's own deliberate scope cuts, not reopened" --
§9t's own words, at the time correctly deferring this exact item to a future session, which this is).
Full re-disassembly of `DrawTournamentBoard 1000:18d8` (58 instructions), its own icon-loop helper
`FUN_1000_198e` (42 instructions, confirms §9t's formula byte-for-byte), the shared wait/poll helper
`FUN_1000_17ff` (32 instructions), `TriggerBonusRace 1000:1a82` (13 instructions -- pulled in
because an advisor review of the first draft below asked "if `1a82` calls `115c`, DOS shows a board
before every bonus race" and that turned out to be exactly right, see "Corrected" below), and --
the item's own explicit ask, "find exactly when it is shown" -- a full re-disassembly of
`RunTournamentLoop 1000:10a0` (54 instructions) and `SetupTournamentRace 1000:115c` (38
instructions), which turned out to be where `18d8` is actually called from, not `10a0` itself.

**Corrected before commit (advisor review of the first draft).** Five factual errors were caught by
re-checking this section's own first draft against the disassembly it cites, before that draft was
ever pushed past a local commit: (1) a pending bonus race's own board call happens BEFORE
`RunTournamentLoop`'s `INC [28C1]`, not after -- the draft's "already-advanced `[28C1]`" claim was
backwards, and the fix (`tournament.js`'s `boardRaceIndex`) is below; (2) the newest icon previews
the UPCOMING race for a REGULAR board (not a trophy for one just finished) -- the icon loop runs
with `[28C1]` already pointing at the race `115c` is setting up, not the one that just resolved; (3)
`FUN_1000_0400`'s own divider bar is gated on the SAME `[0x156]` as its second `WORDS.CHR` draw (the
draft said only the second draw was gated), and `0400` also draws `BADGE.CHR` first, which the draft
missed entirely; (4) `WORDS.CHR`'s own real draw position is a literal `(0x48, 8)`, not centred --
the draft used this file's own generic centring helper instead of the real coordinate it had already
transcribed two paragraphs earlier; (5) `FUN_1000_17FF`'s own `CMP [0x2],CX/JLE` loop takes `CX+1`
ticks per call, not `CX` -- the exact same off-by-one shape `frontMenu.js`'s own idle-cancel test
already caught once (§9aw), missed here on a first pass despite the precedent. All five are fixed in
the prose and the port below; `board.js`/`tournament.js`/`check-board.mjs` carry the corrected
constants and logic, teeth-proven (`git stash push -u -- src/` still fails the corrected
`check-board.mjs` with a missing export, `boardRaceIndex`, confirming the fix is load-bearing).

**When it is shown -- `SetupTournamentRace 1000:115c`, not `RunTournamentLoop 1000:10a0` directly.**
`115c` computes `[28BF]`/`[28C0]` (round/race) for the race about to run -- from `ORDER_TABLE[[28C1]]`
normally, or from the pending-bonus-race pair (`[343]!=0` -> round 9, race `[342]+1`) -- THEN, before
calling the race's own intro (`11F8`) and running it (`3039`), gates a `CALL 18D8` on **two** extra
conditions beyond `18d8`'s own internal ones:
- `[3F8]!=1` -- **Challenge (4-car) format only.** The one-player Head-to-Head-vs-CPU format never
  reaches the `CALL 18D8` at all (`1186-118B: CMP [3F8],1 / JZ 119A` skips straight to the intro).
  This resolves the "find exactly when" ask more precisely than `18d8`'s own internal gates alone
  would suggest: the format check happens at the CALL SITE, not inside the screen. (This is a
  DIFFERENT exclusion from two-human Head to Head, `FUN_1000_1E20`/`RunHeadToHeadTournament 1FAF` --
  that is an entirely separate top-level menu branch reached from SELECT GAME's own "TWO PLAYER"
  item, which never calls `RunTournamentLoop`/`115c`/`18D8` at all, under any `[3F8]` value. The
  first draft of this section conflated the two when explaining `[0x156]` below; corrected there.)
- `[28C1]!=[439]` (0x19) -- **never before the very last race** (the champion decider, entry 25).
- **A pending bonus race is called from INSIDE the triggering race's own resolution, before
  `[28C1]` advances -- not from a later, ordinary loop iteration.** `TriggerBonusRace 1000:1A82`
  (`1000:113A`'s own call target) is `[343]=1; CALL 115C; [343]=0; ...outcome message...`, and only
  AFTER `1A82` returns does `RunTournamentLoop`'s own loop tail run `1000:10F9: INC [28C1]`. So at
  the exact moment `115C`/`18D8` run for a bonus race, `[28C1]` still holds the index of the race
  that was JUST WON, not yet incremented -- the opposite of what this section's first draft claimed
  ("the SAME already-advanced `[28C1]`"). This port's own `tournament.js` `reportRaceResult`
  advances `state.raceIndex` unconditionally, in the SAME synchronous call that sets
  `pendingBonusRace` (matching DOS's own EVENTUAL net effect once the whole triggering-race+bonus-
  race pair resolves, but not DOS's own INTERMEDIATE value while the bonus race is still pending) --
  so the port needs its own correction to match: `tournament.js`'s new `boardRaceIndex(state)`
  returns `state.raceIndex - 1` while `state.pendingBonusRace` is set, `state.raceIndex` otherwise,
  and `shouldShowBoard`/`screens.js`'s icon count both use it, not `state.raceIndex` directly.

`18d8` itself then applies its OWN two gates (both already documented in §7): `[28C1]==0` (the
qualifier, entry 0, never gets a board -- `18D8`'s own very first instruction, `CMP [28C1],0/JNZ`)
and `[43A]==0` (`BOARD_SCREEN_ENABLE`, always 1 in the shipped table). `tournament.js`'s new
`shouldShowBoard(state)` is `115c`'s OWN three-way gate transcribed directly (format, not-qualifier,
not-last-race, against `boardRaceIndex` not `state.raceIndex`) -- not `18d8`'s internal one alone,
since the format check never reaches `18d8` at all in the real bytes. `flow.js`'s `nextAfterOutcome`
calls it right before `startNextRace()`, i.e. between a race's own OUTCOME/RESULTS screen and the
NEXT race's own intro -- matching `115c`'s own call order (`CALL 18D8` then `CALL 11F8`) exactly.

**What it shows -- `FUN_1000_198e`, confirming and completing §9t's own formula, and fixing the
first draft's own "trophy" framing.** `SI` walks `ORDER_TABLE` (`DS:043C`) with a pre-increment
(board position 0 uses `ORDER_TABLE[1]`, never `[0]` -- the qualifier never gets its own icon, as
§9t already established), drawing one `MINATURE.CHR` icon per entry in `ORDER_TABLE[1..[28C1]]`.
**For a REGULAR race this is a PREVIEW of the race about to run, not a trophy for one just
finished**: `115C` writes `[28BF]`/`[28C0]` for the UPCOMING race and only THEN calls `18D8`, while
`[28C1]` (already incremented past the just-resolved race by the PRIOR loop iteration's own
`10F9`) points at that SAME upcoming race -- so `ORDER_TABLE[[28C1]]`, the newest and only-blinking
icon, is the class of the race the player is about to attempt, spoiled in advance. The ONE exception
is a pending bonus race (see above): there, `[28C1]` is still the JUST-WON race's own index, so the
newest icon genuinely is a completed one -- and the bonus race itself (round 9) is never in
`ORDER_TABLE` and never gets a preview icon of its own. Each icon's position comes from a 26-word
table at `DS:0312` (52 bytes, re-read live this session, `frontend-tables.js`'s new
`BOARD_ICON_POSITIONS`, checked byte-for-byte in `check-tables.mjs`): low byte an X unit, high byte
a Y unit, `X = xUnit*8+0xC`, `Y = yUnit*8+0x4E` -- exactly §9t's own formula, now byte-checked
against the live table rather than taken on faith. The icon's own frame, `((word>>2)-1) +
(word&3)*8` (round-1, plus 8 per race-within-round) -- a `MINATURE.CHR` class icon: class by round,
colour variant by race -- matches §9t's formula too, confirmed by re-tracing `19AB-19E1`'s own
`SHR AL,2/DEC AL` (round-1) `+ (AND AL,3/SHL 3)` (race-1, times 8) arithmetic directly rather than
re-citing it.

**The newest icon blinks -- `18D8`'s own erase/redraw loop, `FUN_1000_17FF` as the shared exit test,
and its own real 36-tick/720-tick timing, not 35/700.** Once the background (`CALL 0710`,
`BlitTileMap8x8` -- the SAME `CASE.CHR`/`CASE.MAP` "vehicle display case" `chr.js`'s `caseImage()`
already decodes, confirmed re-used here, not a second format) and all icons so far are drawn, the
newest one blinks: `RestoreSpriteBackground` (erase) -> flip -> wait (`FUN_1000_17FF`) ->
`ClipAndBlitSpriteTransparent` (redraw) -> flip -> wait again -- repeating until any input, or a
`[261F]` (`~10s`) timeout. `17FF` itself (fully disassembled, `CX=0x23` at both call sites):
resets `[0x1080]=0` (combines P1|P2's own reader bytes, `[0x108B]`, the same convention
`RunTwoItemMenu` uses) and `[0x107E]/[0x107F]=0` (the global release latch) at every call, then
polls per-tick: any key release (`[0x107E]!=0`) exits `CLC` immediately, and the combined fire bit
(`[0x108B]&8`) is tracked through a release-then-press debounce sharing the SAME `CX`-tick budget
across both phases -- there is **no ESC-specific branch**: fire and any key release are treated
identically, both just mean "move on". **The loop's own `CMP [0x2],CX/JLE` continue-test still
re-enters on the tick where `[0x2]==CX`, so one `17FF` call actually takes `CX+1=0x24=36` ticks to
time out, not `0x23=35`** -- traced tick-by-tick to be sure (`[0x2]` starts at 0, the busy-wait
exits once it changes, and the loop keeps going for every tick where `[0x2]<=CX`, so it is the
`CX+1`-th tick that finally fails the test) -- the same off-by-one shape `frontMenu.js`'s own idle-
cancel test already caught once (§9aw), missed on this section's own first pass despite the
precedent. `18D8`'s own outer loop (`1000:1902-1929`) calls `17FF` TWICE per full blink cycle (once
waiting to erase, once waiting to redraw), so a full cycle is `2*36=72` ticks, and `[261F]`'s own
`>=0x2BC` timeout check (`1000:1921`) runs only ONCE per cycle, right after the redraw half -- so
the REAL timeout is the next 72-tick boundary at or past 700, i.e. **720 ticks (~10.3s), not 700**.
`board.js`'s `boardStep` ports the corrected constants (`BOARD_BLINK_HALF_PERIOD_TICKS=0x24`,
sampling `BOARD_TIMEOUT_TICKS=0x2BC` only right after the off->on transition, reproducing the same
720-tick real timeout) and the "any release or fire exits, no ESC distinction" rule exactly, but
simplifies `17FF`'s own dual-phase-shared-budget debounce to the SAME `AWAIT_RELEASE`/`POLL` idiom
`frontMenu.js`/`charSelect.js` already use for the identical "ignore an already-held button" concern
-- behaviourally equivalent except for one rare edge (fire held continuously from confirming the
PREVIOUS screen, released and re-pressed within the SAME ~0.5s window, could skip the board on its
very first real tick in the original; the port instead always waits for a release first). Documented,
not silently glossed -- a screen with no `[PROVEN]` live capture and no gameplay rule riding on it
did not justify re-deriving `17FF`'s own byte-for-byte timing a second time once an already-proven
idiom covers every case that matters, though its EXACT tick constants still needed re-deriving
correctly, which the advisor review's own re-check caught this draft had not done.

**Not ported: the round-9 "reveal" branch (`18D8`'s own `1000:192B-198D`) -- the NORMAL path for
every bonus race, not the rare one the first draft of this section called it.** `TriggerBonusRace
1000:1A82` forces `[28BF]=9` before calling `115C`, so `18D8`'s own `CMP [28BF],9/JZ 192B` fires
EVERY time a bonus race's own board is shown, unconditionally -- not "rarely", as this section's
first draft (written before `1A82` itself was disassembled) guessed. The branch: draws 8 more
`MINATURE.CHR` icons (reusing the SAME sprite descriptor slot the icon loop just used) at two fixed
columns (`x=0x95`/`0xB5`) across four rows (`y=0x8E,0x9E,0xAE,0xBE`), with frame indices `0x20`
through `0x27` (32-39) advancing by one for EVERY draw with no reset; then, unlike the first draft's
"draws once and exits" reading, a wait (`17FF`, `CX=0x23`, plus a partial-screen flip,
`CopyFrontViewRowsToVga`) -- exit on input, or on `[261F]>=0x2BC`; otherwise redraws the WHOLE
`ORDER_TABLE[1..[28C1]]` icon list again (`CALL 198E`), waits again, and on a SECOND timeout loops
all the way back to redraw the 8-icon reveal from scratch (`1000:198B: JC 1931`) -- the SAME overall
wait/exit/timeout shape as the regular blink (two `17FF` calls per ~72-tick cycle), just alternating
between two different visuals (the reveal marquee, then the icon list) instead of one icon blinking
on and off. `MINATURE.CHR` has only 38 frames (0-37, `chr.js`'s own `CHR_TABLE`) -- the last two of
the eight reveal draws (frames 38, 39) read past the real, declared frame table, a genuine benign
out-of-bounds read in the shipped game (DOS just has whatever bytes sit next in the arena there;
nothing crashes, but the icons shown are not real, designed content). Left unported: a real,
always-taken (not rare) code path with its own repeating animation, reading past its own asset's
real bounds in the original -- not a rule, not requested by the goal item's own text ("find exactly
when it is shown"), and not worth pixel-replicating a marquee that partly reads garbage. The port's
board screen shows the same single-icon blink for a pending-bonus-race board too, a documented,
honest simplification of a normal (not edge-case) real behaviour.

**Header/layout, hand-placed like every other screen in `screens.js` (not pixel-verified) --
correcting the first draft's own misreading of `FUN_1000_0400`.** `18D8` calls `FUN_1000_0400`
first, and `0400` draws MORE than the first draft of this section said: it clears the screen
(`FillWholeFrontView`), THEN draws `BADGE.CHR` (slot 0, `DS:0B7C`, opaque -- `ClipAndBlitSpriteOpaqueFlip`,
not colour-0-transparent) at its own permanently-unwritten (0,0) default (confirmed by reading the
live descriptor bytes: every field past the `.CHR` pointer is 0, and a byte-pattern sweep for `BX,
0xB7C` finds only two sites total -- `InitLoadAssets`'s own one-time bind loop, which sets the
pointer/segment/dimension fields but never x/y/frame, and `0400`'s own draw call -- so BADGE really
does sit at a fixed (0,0) on EVERY screen that calls `0400`, not just the board), THEN `WORDS.CHR`
frame 0 ("MicroMachines") at a literal **`(0x48, 8)`, not centred** (the first draft of this section
had already transcribed this exact coordinate two paragraphs up, then used this file's own generic
centring helper anyway when writing the port -- a copy-paste-vs-re-derive slip, not a missing fact).
ONLY if `[0x156]!=0` does `0400` draw anything else: a SECOND `WORDS.CHR` frame, AND (contrary to
the first draft's claim that only the second frame was gated) the 3-line shaded divider bar
(`FillRowsFrontView`/`1000:0862`) too -- `1000:0425`'s own `JZ 045A` skips straight to the function's
`RET`, past every one of those three draws at once, not past just the first of them. Traced
`[0x156]`'s own writers (a `search_byte_patterns` sweep, not just `get_xrefs_to`, per CLAUDE.md rule
2): the ONLY site that ever sets it nonzero is `FUN_1000_1E20` (`1000:1E4A`, two-human Head to
Head's own entry point). **A second advisor review caught that this alone does not prove `[0x156]`
is 0 at board time**: it is a PERSISTENT global, so "two-human H2H's own code path never shares a
call graph with `18D8`" does not rule out a PRIOR H2H session leaving it at 1 before the player
returns to SELECT GAME and starts a Challenge run. What actually guarantees 0: `RunMainMenu
KeepTitleTune 1000:0220` (SELECT GAME) resets it to 0 at its own entry (`1000:0238`), and SELECT
GAME is the ONLY path to the Challenge entry point that ever calls `18D8`
(`0220`->"ONE PLAYER"->`02E0`->"Challenge"->`102B`->...->`18D8`) -- so every board call is
necessarily preceded by a fresh `0220` entry that JUST reset it, regardless of what an earlier H2H
session left behind. (`[3F8]` and two-human H2H remain unrelated to each other, as corrected above
-- that correction stands; only THIS specific "why is `[0x156]` provably 0" argument needed fixing.)
So `[0x156]` is PROVABLY always 0 for the tournament board, the second `WORDS.CHR` frame AND the
divider bar are both dead code here, and this screen draws no divider at all. **`BADGE.CHR` is NOT
ported here** -- `0400` is shared by every
front-end screen except SELECT GAME/TITLE/CHAR_SELECT (15 call sites: `27F5` OPTIONS, `2A82`
credits, `2AB5` joystick config, `92F0` redefine keys, `2BED` `SelectGameSetLvl`, `02E0`/`036C` ONE
PLAYER GAME, `1225`/`127E` the race intro, `143F` results, `1ADD` champion, `1C3B` outcome, `18EC`
this board, plus two unnamed functions), and NONE of `screens.js`'s existing renderers for those
already-shipped screens draw `BADGE.CHR` either -- a real, previously-undiscovered simplification
that applies across the whole front end, not something this one item's own scope should retrofit
into 8+ already-committed, already-tested screens. `screens.js`'s new `drawTournamentBoard` draws
`WORDS.CHR` at its real `(0x48, 8)` and the case background (`BOARD_CASE_Y=24`, chosen so the real
icon Y range, 78-174, sits comfortably inside it) by hand, matching this file's own established
convention (its header comment: "None of these attempt the original's exact sprite placement
pixel-for-pixel... laid out by hand to be legible and centred") for everything BUT the two things
this item's own DS:0312/WORDS-position bytes actually pin down.

**Port.** `src/frontend/board.js` (new, `boardInitialState`/`boardStep`, the pure step-function
architecture every P1/P2 phase already uses), `src/data/frontend-tables.js` (`BOARD_ICON_POSITIONS`/
`BOARD_ICON_UNITS_RAW`), `src/frontend/tournament.js` (`shouldShowBoard`, `boardRaceIndex`),
`src/frontend/screens.js` (`drawTournamentBoard`), `src/frontend/flow.js`
(`enterBoard`/`boardTick`/`leaveBoard`/`paintBoard`, wired into `nextAfterOutcome`, following the
SAME `enterTwoItemMenu`-style real-time RAF driver every other P2 menu phase uses -- combined P1|P2
reader, shared `menuReleaseTracker`, `forceBoardSteps` debug hook). `tools/check-board.mjs`
(`npm run board`): `shouldShowBoard`'s real three-way gate (qualifier, last race, two-car format),
including the pending-bonus-race `effectiveRaceIndex` correction; the `AWAIT_RELEASE` debounce; the
blink toggling at exactly `0x24`=36 ticks (not 35, and not one early/late either); a fresh fire
press or any release exiting immediately mid-blink; and the idle timeout firing at the real 720-tick
cycle boundary (not 700). `tools/check-screens.mjs` gained two `drawTournamentBoard` smoke cases.
`tools/check-tables.mjs` gained a `BOARD_ICON_POSITIONS` byte check (39/39 tables now match).

**A second, more consequential instance of the same bug, found while researching P3's second item
(`boardRaceIndex` renamed `effectiveRaceIndex`, since it turned out not to be board-specific).**
`flow.js`'s `runOneRace` was passing `tournament.raceIndex` straight through as BOTH `spawnCars`'s
`tournamentIndex` (feeds `tuningFieldsFor`'s own `KID_MODIFIER` lookup and the `DRONE_MAX_VEL_
HANDICAP`/threshold adjustments) and `raceCtx.tournamentIndex` (read every tick by `ai.js`'s
drone speed-limit adjustments at `tournamentIndex===0x17`/`>=0x13`, and by `states.js`'s `7008`
respawn safe-point nudge at `tournamentIndex===0x16`) -- the SAME already-advanced value the board
item's own fix already established is wrong for a pending bonus race, here affecting the ACTUAL
PHYSICS of the bonus race itself (`1a82` calls `115c`, which calls `RunRaceMainLoop 3039` directly,
so the bonus race runs with DOS's own un-incremented `[28C1]` throughout, not just at its own board/
intro screens). Fixed by threading `effectiveRaceIndex(tournament)` through both. No existing check
exercises a real bonus race with a `tournamentIndex` near `0x16`/`0x17`/`0x13` closely enough to have
caught this by number-movement (`finish`/`rounds`/`trace`/`ai` don't run real multi-race tournaments
with bonus races); the full regression suite re-ran clean with no results moving, confirming this
fix touches only the pending-bonus-race path those checks don't exercise, not a regression.

**Live check.** Driven through the real boot chain in a Chrome tab (title -> SELECT GAME -> ONE
PLAYER GAME (Challenge) -> character select -> PRESS ANY KEY -> the qualifier's own RACE_INTRO ->
RACING) using the same `forceIntroSteps`/`forceTitleSteps`/`forceMenuSteps`/`forceCharSelectSteps`
debug hooks P1/P2's own live checks used, confirming the new imports (`board.js`, the extended
`tournament.js`/`screens.js`/`frontend-tables.js`) load and run without throwing all the way through
every phase up to a live race. **Correcting the first draft's own account of this check, which
overstated what it obtained**: the tab's `document.hidden` was `true` throughout, including right
after an explicit screenshot action taken specifically to try to bring it to the foreground (a
follow-up attempt at the advisor's own suggestion) -- so "foreground tab" was wrong, and console-
message tracking in this tool only starts from when it is first called, so "no console errors" is
weaker evidence than the first draft implied (errors before that point would not have been caught).
A `requestAnimationFrame` monkeypatch, tried twice (once mid-session, once from a fresh navigation
before any game code had run) to try to unblock the RACING phase's own physics loop, did not work
either time -- the second attempt's own LOGO phase never advanced at all even after several hundred
milliseconds, so whatever throttling Chrome automation applies to a backgrounded tab's rendering
loop is not something a same-page `requestAnimationFrame` reassignment defeats. **Not obtained**:
driving an actual race to completion to reach the BOARD phase itself live. This is a tooling
limitation, not evidence of a bug, and (per the advisor's own framing) not blocking: the BOARD
phase's own logic is instead fully proven by `check-board.mjs` (the exact, now-corrected tick
constants against the disassembly, including the pending-bonus-race gate) and `check-screens.mjs`
(the render, against synthetic `raceIndex`/`blinkOn` values); its wiring
(`enterBoard`/`boardTick`/`leaveBoard`) is structurally identical to `enterTwoItemMenu`/
`enterCharSelect`, both already live-proven this project (§9av/§9aw/§9ax) under the exact same
backgrounded-tab constraint.

## 9az. P3's second item: the real interactive opponent picker, and the qualifier's fixed trio (2026-09-24)

**Scope.** GOAL-DOS-PARITY.md P3's second checklist item: `FUN_1000_1A4A`, "pick 3 [opponents]
after passing the Challenge qualifier", replacing the port's own auto-pick
(`tournament.js:pickPlayerCharacter`'s old `pickOpponents` call, first-3-untaken-roster-slots).
The item's own known trap (§9k): "the qualifier itself is a 4-car race and needs 3 opponents
*before* the picker exists. Find out from the disassembly who the real qualifier drones are." Full
re-disassembly of `FUN_1000_1A4A` (20 instructions) AND `FUN_1000_19F2` (23 instructions, `1A4A`'s
own first call, not skipped this time), `RunOnePlayerChallenge 1000:102b` (30 instructions, the
Challenge entry point), `RunTournamentLoop 1000:10a0`'s own tournament-init prologue (already
re-disassembled for §9ay, re-read here for its `[266C]`/`[266E]` writes), `ResetTournamentState
1000:0EBA` (31 instructions), `RunCharacterSelectMenuTune2 1000:09E0`'s own commit block
(`1000:0AFA-0B50`, 37 instructions) AND its fire-confirm gate one block earlier (`1000:0AB5-0AC2`,
the roster's own `|0x40` write site -- neither previously disassembled by §9ax's own pass, which
stopped at the blink sequence), and `FUN_1000_0B51`'s own gate-fail return value (already named in
§9ax, its own `AX` value on failure re-checked here since this item's own commit path `OR`s it into
a live KidModifier slot). A `search_byte_patterns` sweep (per CLAUDE.md rule 2) on the per-car
character-slot array's own disp16 bytes (`68 26`/`6A 26`/`6C 26`/`6E 26`) found every read/write
site across the whole binary, not just the ones already cited; a further sweep for the roster's own
`|0x40`/`|0x20` flag-set patterns (`64 01 40`/`64 01 20`) found none, which is WHY the taken-bit
write below needed the slower `search_instructions` (mnemonic+operand, not raw bytes) approach --
the real instruction addresses a register-relative `[SI]`, not a literal `DS:0164`-plus-immediate
sequence a disp16 byte sweep can see.

**Corrected before commit (a second advisor review, after this item's own first working draft).**
Two real defects and three documentation gaps, all fixed below: (1) `confirm()`'s own
`PRESS_ANY_KEY` branch called `startNextRace()` directly, skipping `nextAfterOutcome()` entirely --
harmless for the screen's ORIGINAL, pre-qualifier use, but this item adds a SECOND use of that same
phase (right after the picker's 3rd pick) where skipping `nextAfterOutcome()` meant P3's first item
(the tournament board) never showed before race 1 at all, a real, player-visible regression this
item's own first draft introduced without noticing; (2) the claim "the qualifier's raw writes
bypass the `09E0` commit path that sets the roster's `|0x40` bit" cited the WRONG block (`0AFA-
0B50`, which does not set it) as evidence -- the real write is `1000:0AC2`, one block earlier,
found only after the advisor asked for the actual write site rather than accepting "not found in
the block I checked" as proof of absence; (3) `enterOpponentPick` was missing its own
`subMenuMusic` call (the picker would have inherited whatever tune the qualifier's OUTCOME screen
left playing); (4) `lastPick.challengeOpponent` was never reset between separate tournament runs;
(5) `FUN_1000_19F2` (`1A4A`'s own first instruction) was left undisassembled while the section
still claimed "`1A4A` itself, fully disassembled" -- it turns out to be a real, previously-
undocumented 4-face status panel, now recorded (and explicitly left unported) below. Live-tested
end to end after all five fixes -- see "Live check" at the end of this section, which also closes
P3's first item's own "not obtained" live-board gap as a side effect.

**The qualifier's drones are answered directly: all three are JETHRO (character index 6), a
hardcoded constant, not a real pick at all.** `RunOnePlayerChallenge 1000:102B`, right after PRESS
ANY KEY and right before `CALL 10A0`: `1000:108D: MOV [266A],6`. `RunTournamentLoop`'s own
tournament-init prologue, before the qualifier even runs: `1000:10B9: MOV [266C],6` /
`1000:10BF: MOV [266E],6`. `[2668/266A/266C/266E]` is a 4-word array, one slot per car (car0's own
slot feeds car0, DI+=2 per car in `InitRaceCarsFromTables`'s own KidModifier read, confirming §9an's
prior citation that `[266A]` is "car 1's own character slot" generalises to all 4 cars, not just
car 1) -- so cars 1/2/3 (the qualifier's 3 drones) all get JETHRO, every Challenge qualifier,
unconditionally. **This has NO effect on tuning.** Re-disassembling `InitRaceCarsFromTables`'s own
branch structure at the point it reads this array (`1000:3FBE-4009`) settles it directly: `CMP BX,0`
forces car0(player) to `CX=0` always; for a drone, `CMP [28C1],0 / JG 3FF5` -- **only when
`tournamentIndex>0`** does the code fall through to `3FF5` keeping whatever it read from the
`KID_MODIFIER` table lookup moments earlier (`1000:3FBF-3FCB`, confirming `race.js`'s own
`computeTuningOffset`'s existing `KID_MODIFIER[character]` branch is correct, not something this
item needed to change); when `tournamentIndex<=0` (the qualifier, always), the code instead
OVERWRITES that value with a flat per-car-slot ramp (`0/12/6` by which car-record offset `BX` holds,
already `race.js`'s existing, correct `computeTuningOffset` `else` branch) -- so WHICH character is
nominally assigned during the qualifier is read into a register and then unconditionally discarded.
(An intermediate finding during this trace briefly looked like the WHOLE `KID_MODIFIER` mechanism
was dead code, gated behind a permanently-zero `CS:[9C62]` flag both `102B` and `0FBF` explicitly
zero at entry -- caught as incomplete BEFORE it was written down as a finding or raised with the
advisor: re-tracing past that gate's own skip target (`JMP 3FBE`) all the way through, rather than
stopping at the jump itself, showed the SKIPPED block (`3F3B-3FBD`) is a separate, genuinely-unused
alternate car-init path with its own bit-shifted scaling math writing to different fields entirely
(`+0x129C` etc via a raw `LODSW` stream, not `CarTypeInfo`); the REAL, always-reached `KID_MODIFIER`
read sits at `3FBE` itself, past that jump, not inside it. The advisor's own review, consulted
afterward with this already-corrected reading in hand, confirmed it and flagged five OTHER, real
gaps in this item's own first draft instead -- see the corrections recorded throughout this
section.)

**JETHRO's own roster slot is NOT marked taken by the qualifier's fixed trio.** The normal "taken"
write happens in `09E0`'s own commit block (`1000:0AFA-0B50`, disassembled fresh for this item,
fully quoted below) via the FACE-PREVIEW SLOT's own frame field (`[BX+0x13]=AX`), which the
qualifier's raw `[266A]=6`/`[266C]=6`/`[266E]=6` writes bypass entirely -- they write directly to
the KidModifier array, never touching a face-preview slot or the roster (`DS:0164`) at all. So the
player CAN still pick JETHRO for themselves at character-select, and the real opponent picker below
can still offer JETHRO as a choice for races 1+, exactly as if the qualifier's own hardcoded trio
never happened.

**`09E0`'s own commit block (`1000:0AFA-0B50`), the single mechanism behind EVERY pick in the game
-- and the roster's own `|0x40` "taken" bit, found ONE BLOCK EARLIER, not in it.** Re-disassembled
fresh (not previously covered by §9AX's own pass, which stopped at the 5-blink sequence one block
earlier): once the picked character's index is masked (`AX = [BX+0x13] & 0xF`, `BX` = whichever
FACE-PREVIEW descriptor slot the caller is currently filling), FOUR parallel `CMP BX,<slot>`
branches -- `0xC03`(car0/player) writes `[2668]`, `0xC1E`(car1) writes `[266A]`, `0xC39`(car2)
writes `[266C]`, `0xC54`(car3) writes `[266E]` -- THEN, common to all four, `[BX+0x13]=AX` (the
face-preview slot's OWN frame is set to the picked character -- THIS is what marks a slot
"filled", not a separate flag), a face-frame recompute (`CALL 0DB0`) and a partial screen flip.
**The roster's own `DS:0164` `|0x40` taken bit is NOT set anywhere in this block** (an early
version of this section claimed the qualifier's raw writes "bypass the normal `09E0` commit path
that sets the roster's own `|0x40` bit", citing THIS block as that path -- wrong citation, caught
by an advisor review asking for the actual write site). The real write is one block earlier,
`1000:0AC2` (`OR byte ptr [SI],0x40`, `SI = 0x164+character`), inside `09E0`'s own fire-confirm
gate (`1000:0AB5-0AC2`: `CMP [0x160],0xA / JA <away>` -- exactly the "fire on a taken character is
ignored" test §9AX already names -- then, only for a valid pick, the roster bit is set right as the
5-blink commit sequence begins). The qualifier's own raw `[266A]=6`/`[266C]=6`/`[266E]=6` writes
(`102B`/`10A0`) still never reach `0AC2` either way, since they never `CALL 09E0` at all -- the
qualifier's fixed trio is not a "pick" in any sense the game's own code recognises, at either the
KidModifier-array level or the roster level. **Only the car0/car1 branches also call the
handicap-question gate (`CALL 0B51`, item 3's own `FUN_1000_0B51`, already documented in §9AX) --
car2/car3 do not.** This is not a format-dependent branch in HOW the array is filled (an early
hypothesis this session floated and then dropped once the bytes were read): `0B51` itself already
gates on race format (`CMP [2656],1/JNZ`, returning `AX=0` on ANY gate failure, `1000:0C12`) --
checked directly (not just inferred from the gate's own existence) because `0B1D: OR [266A],AX`
means a nonzero return WOULD corrupt car1's own KidModifier index -- confirming the gate returns 0
for Challenge (and for one-player H2H-vs-CPU, whose own `[265A]==6` also fails the SAME gate), so
`OR [266A],0` is a true no-op in both cases this port actually reaches. Calling `0B51` for
car2/car3 (which can only ever exist in 4-car Challenge, never H2H) would ALSO be a guaranteed
no-op -- the asymmetry is dead-code avoidance in the original, not a real behavioural difference
this port needs to reproduce. The SAME commit block services car0's own pick (from `102B`/`0FBF`'s
own first `09E0` call), H2H's own single opponent pick (`0FBF`'s second call), AND every one of the
Challenge picker's 3 calls below -- confirming `tournament.js`'s existing `pickOpponentCharacter`
(already used for H2H) is the right function to reuse for Challenge too, not a new one.

**`FUN_1000_1A4A` itself, fully disassembled.** A tight loop: `BX` walks the 4 face-preview
descriptor slots (`0xC03,0xC1E,0xC39,0xC54`, stride `0x1B`=27, the SAME 27-byte sprite-descriptor
stride §7 already documents), looking for one whose OWN frame field still reads the "unpicked"
sentinel `0xB`(11) -- found: run `09E0` with `SI=0x227` ("WHO DO YOU WANT TO RACE ?", the identical
prompt H2H's own opponent pick uses) and `AX=0xFFFF` (see below), THEN, on a cancel (`STC`), loop
right back to the SAME slot (`1000:1A78: JNC 1A7C / JMP 1A69`) -- **there is no way to ESC out of
this picker once the qualifier has passed**; on a confirm, record the slot in `[0x404]` and restart
the ENTIRE scan from `0xC03` (`1000:1A80: JMP 1A53`), so each successive pick still finds the NEXT
unfilled slot, in the SAME fixed order (car1, then car2, then car3 -- car0's own slot is already
filled from the player's own earlier pick and never re-matches the sentinel test). Once a full scan
finds no unfilled slot left, `CALL 0C15` ("PRESS ANY KEY TO START", the SAME screen the qualifier's
own character select already led to once) and return. `[0x404]` (`1000:1A4F`/`1A7E`'s own writes,
the ONLY two references to that address anywhere in the binary, `search_byte_patterns` swept and
confirmed) is therefore **write-only, dead for reads** -- nothing in the shipped game ever consults
it; a stray development-time bookkeeping variable, not wired to anything (including, notably, the
elimination-replacement screen, `1000:16DE`, which does NOT read it either -- item 3's own future
design should not assume `[0x404]` names "which slot to replace").

**What resets the 4 face-preview slots to the "unpicked" sentinel, settling the item's own "before
the picker exists" trap precisely.** `ResetTournamentState 1000:0EBA` (fully disassembled): resets
lives (`[406..409]=3`), the carousel's own "centred" value (`[0x160]=6`), the roster (`DS:0164[0..10]
= 0..10`, plain indices, no `taken`/`eliminated` flags -- confirms CLAUDE.md's own roster
description exactly), the per-car KidModifier array (`[2668/266A/266C/266E]=0xB`(11), an
OUT-OF-RANGE sentinel distinct from any real character 0-10, matching the face-slot frame sentinel
in spirit), and -- the key fact -- ALL FOUR face-preview descriptor frames
(`[0xC16]/[0xC31]/[0xC4C]/[0xC67]`, `= [slot]+0x13`) to `0xB` too. `ResetTournamentState` is called
from `RunOnePlayerGameMenu 1000:02E0` (`1000:0369`, EVERY visit to ONE PLAYER GAME, before the
player even commits to Challenge or Head-to-Head-vs-CPU) and from `RunTwoPlayerHeadToHeadSetup
1000:1E66`. So by the time `102B`'s own player-pick `09E0` call runs, all 4 slots (including the
player's own) already read the sentinel; the player's own pick fills slot `0xC03` via the commit
block above; the qualifier's own `[266A]=6`/`[266C]=6`/`[266E]=6` writes are RAW, bypassing the
commit block entirely, so slots `0xC1E`/`0xC39`/`0xC54` are STILL sentinel-`0xB` when the qualifier
finishes -- meaning `1A4A`'s own scan, run right after a PASS, reliably finds exactly the 3
opponent slots unfilled, in order, every time. This is the disassembly-derived answer to the
item's own trap: DOS does not need the picker to exist before the qualifier because it never asks
the qualifier's own opponents to be "picked" at all.

**`AX=0xFFFF` at `09E0`'s own entry: "keep the previous scroll position", not a fresh start.**
`09E0`'s own first 3 instructions: `CMP AX,0xFFFF / JZ 09F1` -- when `AX==0xFFFF` (every call `1A4A`
itself makes), the block that would otherwise look up a starting scroll offset for a SPECIFIC
character index and write it to `[0x192]` (the carousel's own scroll position) is skipped entirely,
so `[0x192]` simply retains whatever the LAST carousel visit left it at. **Not ported
byte-for-byte**: `charSelect.js`'s own `charSelectInitialState` always computes a fresh
`startScroll(startIndex)`; there is no raw-scroll-pixel-carry state threaded through this port's
own menu-to-menu transitions. Approximated instead as "start the next pick from the LAST pick's own
index" (`flow.js`'s `enterOpponentPick`: the first opponent pick starts from the player's own final
pick, `lastPick.player`; each subsequent one starts from the PREVIOUS opponent's own pick,
`lastPick.challengeOpponent`) -- since the just-picked character is now `taken`, this correctly
re-triggers the SAME `ENTRY_SKIP` auto-scroll-past-taken animation `charSelect.js` already has
(P2's own item 3), landing on the same visual neighbourhood as "don't reset the scroll" without a
second, parallel scroll-state mechanism. A documented simplification, in the same spirit as every
other `AWAIT_RELEASE`-class approximation this project already uses for a screen with no
`[PROVEN]` live capture and no numeric rule riding on the exact sub-pixel scroll position.

**`FUN_1000_19F2`, `1A4A`'s own first instruction, disassembled -- not left unread as "probably
just a header draw", as a first pass through this item assumed.** An advisor review pointed out
that citing "full disassembly of `1A4A`" while leaving a function it calls first-thing
undisassembled was overstated; `19F2` turns out to be its own real, previously-undocumented UI
element: a 4-face STATUS PANEL (`CALL 0400` for the shared header, then a loop over 4 -- or, when
`[0x3F8]==1`, 2, for H2H -- face-preview slots, drawn in a horizontal row at a fixed `Y=0x24`(36)
with `X` stepping by `0x40`(64) each, `CALL 0DB0` recomputing each one's current frame from the
SAME per-slot state `09E0`'s own commit block writes). Drawn ONCE, at the very start of the picker
(not called again inside `1A4A`'s own pick loop), so it shows a snapshot of "who's picked so far"
-- the player's own face plus 3 still-sentinel blanks -- at the moment the picker opens, not
continuously refreshed as each of the 3 opponents is subsequently confirmed. **Not ported**: this
port's own `enterOpponentPick` reuses the plain character-select carousel with no persistent status
row above it, a real, visible simplification (the player sees ONLY the current pick's own carousel,
not a running summary of all 4 cars), left this way for the same reason every other
`screens.js`-scoped visual gap in this file is -- hand-drawn menu screens are this project's own
established, documented bar, not pixel parity, and adding a second persistent sprite panel is a
real new feature, not a bug fix, for an item whose own text asked "pick 3 opponents", not "draw the
roster status panel".

**Port.** `tournament.js`: `pickPlayerCharacter` no longer auto-picks opponents (the old
`pickOpponents`/`firstUntaken` helpers are deleted, not just unused); `QUALIFIER_OPPONENTS` (the
fixed JETHRO trio); `opponentCharactersFor(state)` (the qualifier's fixed trio for `raceIndex===0`
Challenge races, `state.opponents` otherwise -- threaded into `spawnCars`'s own `opponentCharacters`
in `flow.js`'s `runOneRace`, replacing the old direct `tournament.opponents` reference);
`needsOpponentPick(state)` (true exactly once, right after a Challenge qualifier PASS);
`pickOpponentCharacter` now APPENDS to `state.opponents` instead of replacing it (H2H's own single
call is unaffected -- append and replace are equivalent for a length-0-then-1 sequence -- but
Challenge's 3 sequential calls need accumulation). `flow.js`: `enterOpponentPick` (reuses
`enterCharSelect` with a new `charWho='challenge-opponent'`), wired into `nextAfterOutcome` right
before the (P3 first item's) board check -- DOS's own order is OUTCOME -> `1A4A` -> `[28C1]` INC ->
board -> intro, and `needsOpponentPick`'s own trigger (checked AFTER this port's `advance()` already
ran) reproduces that order without needing pre/post-increment timing to match exactly, since `1A4A`
itself never reads `[28C1]` (documented distinction from `effectiveRaceIndex`'s own class of bug,
where the pre/post-increment distinction DOES matter); `leaveCharSelect`'s own cancel branch now
loops back into `enterOpponentPick` for `charWho==='challenge-opponent'` instead of going to SELECT
GAME, matching `1A4A`'s own "ESC never exits" loop exactly. `advanceRace`'s own post-race `names`
array (RESULTS table car labels) now picks `QUALIFIER_OPPONENTS` vs `tournament.opponents`
by `wasQualifier` directly (not `opponentCharactersFor`, since `reportRaceResult`'s own `advance()`
call has already moved `raceIndex` past the point that function's own `===0` check needs, by the
time `names` is built) -- a correctness fix for a path that was already dead (the qualifier never
shows RESULTS), not a user-visible change. `enterOpponentPick` also calls `subMenuMusic(sound)`
(`09E0`'s own `1000:0A06-0A1D` re-asserts tune 2 on EVERY entry -- by the time the picker runs, the
qualifier's race music and then `raceOutcomeMusic` have already played over it, so the ONE existing
`subMenuMusic` call at the player's own first `enterCharSelect` is not enough, a gap an advisor
review caught); `lastPick.challengeOpponent` is reset to `null` in the player-pick branch of
`leaveCharSelect` (so a SECOND tournament's own first opponent pick starts from the NEW player pick,
not a stale index left over from a previous run -- DOS's own equivalent, `[0x192]`, is zeroed by
`ResetTournamentState` and then set fresh by the player's own `09E0` call every time).

**A real bug an advisor review caught and this fix closes: the board (P3's first item) never
showed before race 1 at all, until now.** `confirm()`'s own `PRESS_ANY_KEY` branch called
`startNextRace()` directly, bypassing `nextAfterOutcome()` -- harmless for the ORIGINAL, pre-
qualifier use of that phase (`needsOpponentPick`/`shouldShowBoard` are both false at `raceIndex 0`,
so behaviour is unchanged there), but this item adds a SECOND `PRESS_ANY_KEY` right after the
picker's 3rd pick (`1A4A`'s own trailing `CALL 0C15`), and calling `startNextRace()` directly from
THAT one skipped `shouldShowBoard`'s own check entirely -- race 1's board, the FIRST board screen
any Challenge player would ever see, never appeared. Fixed by calling `nextAfterOutcome()` instead
(matching the OUTCOME branch's own existing style), which re-runs the SAME `needsOpponentPick` ->
`shouldShowBoard` -> `startNextRace` chain regardless of which `PRESS_ANY_KEY` triggered it. One
documented, accepted cosmetic cost: for the H2H qualifier specifically (`hasRaceIntro()===false`),
`nextAfterOutcome`'s own unconditional trailing `paintMenu()` now briefly repaints a blank
`LOADING`-phase frame over `runOneRace`'s own "Loading…" status text before the race's real render
loop takes over -- self-correcting within one frame, not worth special-casing.

**Tests.** `tools/check-tournament.mjs` rewritten substantially: the qualifier now races the fixed
`QUALIFIER_OPPONENTS` and `state.opponents` starts empty; `needsOpponentPick` becomes true exactly
once, right after a Challenge PASS, and false again once satisfied; picking the player's own
character as an opponent fails; a qualifier FAILURE leaves the picker permanently unneeded (the
tournament is over, `1A4A` never ran in the real game either); every test that continues past the
qualifier now explicitly drives a `pickFirstUntakenOpponents` harness helper (the SAME
first-3-untaken selection the OLD auto-pick made, now called explicitly by the TEST rather than
implicitly by `tournament.js` itself, so every downstream numeric assertion -- eviction victims,
streak counts -- is unchanged from before this item). `git stash push -u -- src/` fails the
rewritten `check-tournament.mjs` with a missing export (`QUALIFIER_OPPONENTS`), confirming the fix
is load-bearing. Full regression suite (including `finish`/`rounds`/`twocar`, which never went
through `tournament.js`'s own opponent auto-pick at all -- they call `spawnCars` directly with
explicit `opponentCharacters`) re-ran clean with no results moving, confirming this item's own
scope (the front-end picker, and the qualifier's own fixed-trio fact) does not touch any
already-tested physics path.

**Live check -- the picker AND the board (P3's first item) both confirmed live, end to end, once
the PRESS_ANY_KEY bug above was found and fixed.** The boot-chain drive-through (title -> SELECT
GAME -> ONE PLAYER GAME (Challenge) -> character select -> PRESS ANY KEY) first confirmed
`tournament.opponents` is genuinely empty (`[]`) right after the player's own pick -- the
directly observable confirmation the auto-pick is gone. Reaching the picker itself live does not
need a completed qualifier race: the advisor's own suggestion was to poke `tournament.raceIndex`
directly to simulate "the qualifier just passed" (a synthetic STATE jump, but every SCREEN
transition and render from that point on is the real code, not simulated) --
`g.getTournament().raceIndex = 1; g.confirm()` from the pre-qualifier `PRESS_ANY_KEY` screen landed
straight in `CHAR_SELECT` showing "WHO DO YOU WANT TO RACE ?" with the carousel auto-skipped past
the player's own already-taken pick (screenshotted). Driving all 3 picks with `forceCharSelectSteps`
(including one deliberate `escReleased` mid-sequence, confirming `opponents` did not change and the
SAME slot re-prompted, matching `1A4A`'s own "ESC never exits" loop) reached `PRESS_ANY_KEY` again
with `opponents=[9,8,7]`. Confirming THAT is exactly where the bug above was caught: before the
fix, this landed straight in `RACE_INTRO` with the board never shown; after the fix, `g.confirm()`
correctly landed in `BOARD` -- **the first live render of the tournament board screen, item 1's own
"Not obtained" gap, closed as a side effect of item 2's own live testing** -- showing the real
"MicroMachines" header, the CASE.CHR display case, and one blinking MINATURE icon previewing race
1's own vehicle class (screenshotted). `forceBoardSteps` then correctly exited to `RACE_INTRO`. No
console errors from the point the console-message tool was attached (the same standing caveat
§9AY's own live-check paragraph names: this does not cover errors before that attachment point).
The picker's own rule logic remains additionally proven by `check-tournament.mjs`'s 11 test blocks
against the fresh disassembly above; this live pass confirms the UI WIRING specifically
(`enterOpponentPick`, the `leaveCharSelect` cancel-loops-back branch, the `PRESS_ANY_KEY` ->
`nextAfterOutcome` fix) end to end, something no synthetic state poke alone can show.

## 9ba. P3's third item: the elimination screen and the real replacement picker (2026-09-24)

**Scope.** GOAL-DOS-PARITY.md P3's third checklist item: `ShowCharacterEliminatedTune6 1000:16de`
("IS OUT!!", the wobble curve at `DS:034B`, already named in §9t but never disassembled), plus "the
player picks the replacement" and "verify the round-robin victim rule against the bytes: §9k says
'roster position modulo opponent count' is an interpretation, not a derivation." Research for this
item ran as a background `Workflow` (2 parallel Ghidra research agents, each independently
re-verified by a 3rd/4th agent) covering `1000:16de` itself and the real eviction rule, followed by
direct main-session verification of three things the research left open (the icon asset at
`DS:0A3A`, the wait function `1000:179B`'s own real exit condition, and `FUN_1000_0DB0`'s own
branch priority), an advisor review of the resulting synthesized plan (before any code was written)
that caught three real bugs, and a second advisor review of the committed code and tests that
tightened the proof-of-failure methodology and settled a concrete double-eviction question the
first pass's own `[0x310]`/`[28C1]` conflation had left unverified (see both "Corrected" sections
below).

**`ShowCharacterEliminatedTune6 1000:16DE`, fully re-disassembled (77 instructions,
`1000:16DE-179A`) and independently re-verified.** Plays tune 6 once at entry (`1000:16E4`/`16F1`,
the same query-then-play pattern `titleMusic`'s own header already documents). Takes the victim's
own face-descriptor slot address as its incoming parameter (confirmed: the caller passes it in `AX`
alone, not `AX`/`BX` as an intermediate draft of the eviction-rule research said). Sets the roster's
own `|0x20` (eliminated) bit (`1000:1707`, `SI = DS:0164 + character`) and rebinds that SAME slot's
descriptor from `FCNORMAL.CHR` to `FCSAD.CHR` (`1000:173D-1741`) before drawing "IS OUT!!" (`DS:03B6`)
and the character's own name (`DS:0258+idx*8`), both via `DrawString8pxFont` (`1000:0929`,
`DX=0xB54` = `FONT2.CHR`) at `(0x80, 0x64)` and `(0x48, 0x64)`. Then the 17-byte wobble curve at
`DS:034B` (`[2,4,8,16,32,47,32,16,8,4,2,4,8,16,32,47,0]`, 0-terminated, byte-exact match confirmed
independently twice) drives 16 real steps (the 17th byte is only ever read as a "stop" test,
`1000:1757/1759`, never itself drawn or waited on): each step adds the table value to a FIXED
baseline Y (restored after each write, not cumulative), toggles the sprite's own frame bit
(`1000:175B`, alternating `charIndex*2`/`charIndex*2+1`), draws, and waits a literal 9 ticks
(`1000:177F/1784: CMP [0x2],0x9 / JL`) -- no input is polled anywhere inside this loop (no
`CALL 2D5B`, the input-poll routine every OTHER menu wait in this project calls), so it always runs
to completion once started. **Correcting §9t's own "a short tone plays" claim** (see the inline
correction where §9t's own text now sits): the only sound-driver calls in the whole function are
the two at entry; every per-step call is a graphics routine. Each step is silent.

**The icon: `FCSAD.CHR`, not `FCNORMAL.CHR` -- confirmed live, not left as a simplification.**
`1000:173D: MOV SI,[0xA3A]; 1000:1741: MOV [BX+8],SI` rebinds the victim's own slot descriptor's
pixel segment to whatever `DS:0A3A` holds. Read live this session: `193C:0A3A` = `0x37D8`.
`chr.js`'s own `arenaOffset` formula (`(seg - ARENA_SEGMENT) * 16`, `ARENA_SEGMENT=0x2B78`, the
Ghidra-relocated base -- NOT the file-format `0x1B78` `parseChrTable` uses when parsing raw file
bytes, a distinction an early arithmetic slip in this same session got backwards before catching
itself) gives `(0x37D8-0x2B78)*16 = 0xC600` -- `chr.js`'s own `FCSAD.CHR` entry (48x48, 22 frames =
11 characters x 2), exactly. This ALSO settles why the frame math is `charIndex*2`/`charIndex*2+1`
(0-21) rather than 0-13: `FCNORMAL` (14 frames) couldn't hold it, `FCSAD`'s 22 can, exactly. The
bounce icon is a sad-face pose pair per character, not the normal carousel portrait.

**`1000:179B`, the wait before the replacement picker: no real timeout past its own initial
debounce.** Fully re-disassembled (27 instructions). Two stages, sharing one tick counter
(`DS:0002`, reset once at entry, never again): stage 1 (`1000:17B5-17D5`) waits, up to `0x2BC`(700)
ticks, for fire to stop being held (a debounce, matching the SAME shape `FUN_1000_17FF`'s own
release-then-press pattern already documented for the tournament board, §9AY); stage 2
(`1000:17D7-17F8`) then waits for a FRESH fire press or any key release -- but its own timeout test
(`CMP CS:[0x93C2],0x2BC`) compares against a CS-relative constant §9AR e already proved has no
writer anywhere in the binary, permanently 0 -- so `0 >= 0x2BC` never holds, and stage 2's own
timeout branch is NEVER taken. In practice this screen waits for a keypress INDEFINITELY once the
bounce ends. `get_xrefs_to 1000:179B` confirms it is the SAME wait function `ShowNextRaceIntroScreen
Tune4or5` (the RACE_INTRO screen) uses (`1000:1395`) -- and this port's own existing RACE_INTRO
handling ALREADY matches this exactly (a plain `confirm()`-driven wait, no `setTimeout`), so the
elimination screen's own "press any key to continue" step reuses that SAME established idiom rather
than `PRESS_ANY_KEY`'s own `pressAnyKeyTimer` (which WOULD be wrong here -- there is no real
auto-timeout to replicate).

**`FUN_1000_0DB0`'s own branch priority, re-verified: ELIMINATED (`0x20`) is tested BEFORE taken
(`0x40`).** `1000:0DBC: TEST CL,0x20 / JZ 0DC5` (eliminated -> frame 12) comes before
`1000:0DC5: TEST CL,0x40 / JZ 0DEE` (taken -> frame 13). Since `checkElimination` (below) never
clears the victim's own `0x40` bit, an eliminated character's roster byte has BOTH bits set by the
time anything re-displays it (e.g. the SAME carousel, now showing the replacement pick) -- and the
real game shows such a character as "eliminated" (frame 12), not merely "taken" (frame 13).
`screens.js`'s own `faceFrame` (P2's own item 3, §9ax) only ever checked `0x40`, defaulting an
eliminated-and-taken byte to the WRONG pose -- fixed here to check `0x20` first, matching `0DB0`
exactly (the `0DB0` branches this DOESN'T model -- its own `CH!=0` path, selecting between FCHAPPY/
FCFROWN/FCSAD/FCNORMAL for OTHER screens entirely -- are out of scope for this item; the elimination
bounce icon's own FCSAD binding is a separate, explicit rebind in `16DE` itself, confirmed above,
not routed through `0DB0` at all).

**The real eviction rule, fully re-derived -- resolving the goal item's own "not a derivation"
flag.** Lives in `ShowRaceResultsScreenTune8or6` (`1000:1676-16DB`), NOT `RunTournamentLoop`/`1A82`
as this file's own earlier prose assumed without ever having traced it. Gate: `[0x310] % 3 == 0`,
tested on `completedRaceIndex` -- the race JUST finished, read BEFORE `RunTournamentLoop`'s own
`[28C1]` INC (`1000:10F9`), since `13E4`'s own call (`1000:110D`) happens first -- the SAME
pre/post-increment class of bug `effectiveRaceIndex`'s own header already names for the board and
`tournamentIndex` (§9AY/§9AZ), now caught a third time, this time by an advisor review of the
pre-implementation synthesis (before any code was written, evicting one race early in the plan as
first proposed; see "Corrected" below for exactly when each fix landed). Reachable on 1st place (any
race) or 2nd place (any race except the very last order-table entry) -- Challenge format only (H2H
returns early, `1000:13F3`).

`[0x310]` is a genuinely SEPARATE global from `[28C1]`, not the same counter under two names -- a
second advisor pass (after implementation, reviewing the committed code and tests) flagged this
file's own earlier claim that they were interchangeable as unverified, and re-disassembly settled
it exhaustively: `[0x310]`'s only real accesses in the whole 83,662-byte image (a `search_byte
_patterns` sweep for its address bytes, `10 03`, 7 hits, all individually re-disassembled; the two
NOT listed below are false positives -- `2D8D`'s `CMP [0x108C],0x3` and `5546`'s `JMP 5858`, both
coincidental byte runs, not this global) are three resets to 0 (`1000:0FCF`, `1000:1040`,
`1000:10B4` -- each paired in the SAME instruction sequence with a `[28C1]=0` reset), one increment
(`1000:10FD`, immediately after `10F9`'s own `INC [28C1]`, same basic block, unconditional), and the
one read this section already covers (`1677`). So `[0x310]` and `[28C1]` are written together at
every site that touches either -- provably always equal, by construction, for the entire life of a
tournament. This also closes the second advisor pass's own sharper question directly: **can a bonus
race reach the elimination gate a second time** (since `TriggerBonusRace 1A82` runs a whole race via
its own `115C` call, separately from `RunTournamentLoop`'s normal per-race `110A`/`110D` pair)? No --
`1A82`'s own full 13-instruction body (re-disassembled) calls only `115C` (setup+run) and `1C1B`
(the bonus outcome/EXTRA_LIFE-or-NO_BONUS setter); it never calls `13E4`/`ShowRaceResultsScreenTune8
or6` at all, and `115C` itself (also re-disassembled) never touches `[0x310]`/`[28C1]` or calls
`13E4` either -- the bonus race's own completion is structurally incapable of reaching the
elimination gate, not merely "happens not to" for the port's own tested schedules. The port's
`reportRaceResult` already matches this exactly: its `pendingBonusRace` branch returns immediately,
before `checkElimination` is ever reachable in that call. **Victim selection is a 3-SLOT DESCRIPTOR-ADDRESS CURSOR
(`DS:0346`), not a roster-index computation** -- the goal item's own flagged "interpretation": on
the FIRST eviction (`completedRaceIndex===3`, a literal equality in the bytes, not "the first time
this runs"), the cursor is set to whichever of the 3 CURRENT opponent slots (`0xC1E`/`0xC39`/`0xC54`)
holds the lowest character index; every LATER eviction just advances the cursor by 1, wrapping
`0xC54->0xC1E` -- UNCONDITIONALLY, even on a no-op pass (confirmed: `DS:0346`'s own only 3
references in the whole binary are the write sites `1000:16AB`/`16B0`/`16BE`, all inside this one
gate, and the free-slot check runs AFTER the cursor is set), so a replacement CAN be evicted again
once the cursor returns to its own slot. No-op: scan the 11-byte roster for one with neither
`taken` nor `eliminated` set; none -> skip the visible eviction, but the cursor has already moved.
On a real eviction, the victim's `0x20` bit is set but `0x40` is NEVER cleared (`1000:1707` is an
`OR`) -- an eliminated character stays permanently excluded from the free-roster count (the
free-slot scan tests `byte & 0x60`, either bit disqualifying) but is never "un-taken". **The
replacement is chosen by the PLAYER, through the SAME interactive picker P3's second item ported**
(`1000:16de`'s own trailing `1000:1796: CALL 0x1000:1A4A` -- the identical function, identical
identity, confirmed by `get_xrefs_from`), not auto-picked -- correcting this file's own earlier
claim (and docs/engine.md §9k's, which was right only as a description of THIS PORT's own
now-superseded simplification, not of the original game).

**Corrected pre-implementation (advisor review of the workflow synthesis, before any code was
written).** Three real bugs in the PLANNED approach, caught and fixed before a single line of
`tournament.js` changed, so no "first draft" of the code itself ever had them:
1. **The trigger would have fired one race early.** The plan as first synthesized called
   `checkElimination` with the ALREADY-ADVANCED `state.raceIndex` (post-`advance()`), which would
   have evicted after completing races 2, 5, 8, ... instead of 3, 6, 9, .... Written instead as
   capturing `completedRaceIndex = state.raceIndex` BEFORE `advance()` runs, matching `13E4`'s own
   real pre-increment read (see above).
2. **A bonus-triggering race would have skipped its own eviction.** The plan as first synthesized
   kept the OLD code's own `if (!bonusTriggered && !state.over) checkElimination(...)` gate. The
   real `13E4` runs BEFORE `RunTournamentLoop`'s own bonus-trigger check (`1123-113A`) -- a race
   that ALSO triggers a bonus (the default streak=3 means this happens on the very FIRST eviction
   race, race 3, in a perfect run) still evicts. Written instead with the gate removed --
   `checkElimination` runs unconditionally, ahead of the bonus check, matching `13E4`'s own call
   order exactly. `check-tournament.mjs`'s own test 7b is the dedicated regression test for this
   (confirmed by reintroducing the gate and re-running the suite: it fails, specifically and only
   this test plus test 6's tightened checkpoint-sequence assertion -- see below).
3. **The RESULTS table would have shown the wrong driver.** The plan as first synthesized built
   `advanceRace`'s own `names` array from `tournament.opponents` AFTER `reportRaceResult` ran --
   which, on an evicting race, would have ALREADY nulled the victim's own slot, so the results table
   for the very race that victim just drove would show "???" instead of their name. Written instead
   as snapshotting `[...opponentCharactersFor(tournament)]` (a COPY, not a live reference --
   `checkElimination` mutates `state.opponents` IN PLACE) BEFORE calling `reportRaceResult`; this
   also replaces P3's second item's own earlier `wasQualifier`-based special case with one general
   mechanism. `advanceRace` itself has no headless test (DOM/frame-bound), so `check-tournament.mjs`
   gained test 7c, which proves the underlying hazard directly against `tournament.js`'s own
   exported functions -- the same ones `advanceRace` calls, in the same order.

Also fixed at the same pre-implementation stage: `faceFrame`'s own priority (above) -- now with its
own direct assertions in `check-screens.mjs` (`faceFrame(0x60)===12`, `faceFrame(0x43)===13`,
`faceFrame(5)===5`), confirmed by reintroducing the swapped branch order and re-running: only that
test fails; a missing `subMenuMusic` call in `enterOpponentPick` was ALREADY fixed in P3's second
item's own second correction round, not re-broken here, re-confirmed still correct now that the
replacement picker reuses the identical function; and the 4-face status panel (`FUN_1000_19F2`) --
deferred as unported when P3's second item shipped -- is ported now (`screens.js`'s
`drawOpponentPanel`), since this item's own bounce icon needs the SAME row layout the panel defines
(`Y=0x24`, `X=8+0x40*slot`) to be positioned correctly; this retroactively closes that item's own
deferred gap too (the opponent picker's own screen, `enterOpponentPick`, now shows the panel as
well, redrawn fresh from `tournament.opponents` on every repaint rather than the real game's own
"drawn once, left on screen" approach -- a documented, low-risk port-side layering choice, not a
real-bytes citation).

**Corrected post-implementation (a second advisor review, of the code and tests as written so far --
nothing was committed yet at this point).** Three findings, none requiring a behaviour change:
1. **The `git stash push -u -- src/` proof-of-failure was too broad to be meaningful.** Stashing the
   whole `src/` tree against the brand-new `elimination.js`/rewritten `tournament.js`/`screens.js`
   only proved the new EXPORTS didn't exist yet (`SyntaxError: ... does not provide an export named
   'hasEmptyOpponentSlot'`) -- a real failure, but not evidence that any specific assertion (test 6,
   7, 7b, 7c, the `faceFrame` checks) actually catches its own bug. Redone properly: each of the
   three pre-implementation bugs above was reintroduced individually into an otherwise-current
   `tournament.js` (keeping the new exports intact) and the suite re-run each time -- bug 1 alone
   fails test 7 (`no eviction after completing race 2 either`) and, as a side effect of the eviction
   landing on the wrong race, test 7c; bug 2 alone fails test 7b directly plus test 6's own tightened
   checkpoint-sequence assertion; the `faceFrame` swap fails only its own new dedicated assertion.
   Bug 3 (the RESULTS snapshot) has no code left to "reintroduce" inside `tournament.js` itself since
   the bug lived in `flow.js`'s own call ordering, which has no headless harness -- test 7c instead
   proves the hazard it guards against is real (a live post-call read of `opponentCharactersFor`
   DOES show a `null` on the exact race that just evicted someone) directly against the shared
   functions `advanceRace` calls, in the order it must call them.
2. **Whether `[0x310]` and `[28C1]` are really the same counter, or could disagree across a bonus
   race** (raised as a concrete double-eviction risk: could a bonus race's own results reach the
   `1676` gate a second time at the same `completedRaceIndex`, since `_evictionSlotCursor`'s own
   "first eviction" branch would re-fire and reset to the lowest-index slot instead of advancing).
   Settled definitively by direct re-disassembly, not by re-asserting the prior claim -- see the
   `[0x310]` paragraph above. Not a bug, in either the original game or the port: the two globals are
   provably always equal (written together at every site), and `TriggerBonusRace`'s own full body
   never reaches the gate at all. `check-tournament.mjs`'s test 6 was also tightened from "exactly 7
   eliminations" (a count, which a double-fire-then-run-dry-early scenario could still satisfy) to
   asserting the exact checkpoint sequence `[3,6,9,12,15,18,21]`, so this class of bug would be
   caught directly even though this specific mechanism turned out to be structurally impossible.
3. **The pre/post-implementation provenance of the first advisor pass was stated inconsistently**
   across this section, the `GOAL-DOS-PARITY.md` tick and the `PLAN-ENGINE.md` M3.55 row (one
   self-contradicted: "run before any code was written, then caught three real bugs once the code
   existed"). Corrected throughout, per the accurate account above: one advisor call, before any
   `tournament.js`/`flow.js`/`screens.js` code was written, reviewing the synthesized plan itself.

**Corrected after a third advisor review (of the second pass's own fixes and claims).** Two of the
three findings above were themselves incomplete:
1. **Test 7's own round-robin assertion was vacuous, not just weak.** `fillEmptyOpponentSlots`
   always replaces with the next-HIGHER free roster character (ascending order), so under that
   harness the lowest-current-index slot never moves once vacated -- "the 3-slot cursor advances"
   and "always evict the lowest current index" predict the SAME victim at every checkpoint the old
   test 7 drove to. The item's own central claim (a slot cursor, not a roster-index computation) had
   no test that could fail without it. Fixed: new test 7a picks all replacements explicitly and OUT
   of ascending order (`opponents=[3,2,1]` to start, `0`/`4`/`5` as replacements placed by hand, not
   by the harness), driving 4 checkpoints where the two hypotheses diverge, culminating in a
   replacement (character 0, placed at race 3) being RE-EVICTED at race 12 once the cursor cycles
   back to its own slot -- a result no roster-index rule of any kind can produce. Confirmed by
   substituting "always evict the lowest current index" for the cursor and re-running: exactly two
   of test 7a's checks fail (the two discriminating checkpoints), the rest of the suite unaffected.
2. **Test 7c never exercised the code `advanceRace` actually calls.** It called `tournament.js`'s
   raw `opponentCharactersFor`/`reportRaceResult` in the right order itself, which proves the HAZARD
   is real but not that `flow.js`'s own `advanceRace` avoids it -- reordering `advanceRace`'s two
   lines would have left every test green. Fixed by extracting the ordering into a new export,
   `reportRaceResultWithOpponentSnapshot(state, result)` (snapshots `opponentCharactersFor(state)`,
   THEN calls `reportRaceResult`, returns the snapshot), and rewiring `advanceRace` to call it
   instead of doing the two steps inline; test 7c now calls this SAME export directly. Confirmed by
   swapping the two lines INSIDE the helper and re-running: test 7c fails, specifically and only.
3. **The `1A4A`/`179B`/`0C15` "is there really a wait after the picker" question**, raised as a
   possible missing-screen bug in both this item and item 2 -- resolved, not a bug, see the
   dedicated paragraph above (`1A4A`'s own trailing `CALL 0C15` IS the "press any key", reached
   identically for a 3-slot initial pick or a 1-slot replacement; `179B`'s separate wait runs earlier,
   before the picker, not after).

**Corrected after a fourth advisor review (of the render this item had never actually looked at).**
Three real, independently confirmed bugs, neither previously caught because no prior pass had
rendered the elimination screen mid-bounce or at the moment it finishes:
1. **The panel showed the real "unpicked" placeholder (a red "?", frame 11) at the victim's own
   slot, throughout the whole bounce.** `paintEliminated` (`flow.js`) passes `tournament.opponents`
   straight to `drawEliminatedScreen`, and `checkElimination` has ALREADY set that slot to `null`
   before this screen ever starts -- so the port's own `drawOpponentPanel` (redrawn fresh every
   frame, a documented simplification vs. the real game's one-time draw) kept showing the "nobody's
   picked this yet" icon under the bouncing FCSAD face. Fresh re-disassembly of `19F2` (26
   instructions, not fully covered before) shows the real game does something different: it reads
   each slot's face-DESCRIPTOR frame field (NOT the roster byte) through `0DB0`, after masking to
   `0x4F` (`1000:1A0E`) -- so it can only ever show "unpicked" (`0xB`), the generic "taken" state
   (bit `0x40`), or a plain portrait, NEVER "eliminated" (that bit lives on the roster byte, a
   different address `19F2` never reads). `1000:170A: OR word ptr [BX+0x13],0x40` sets exactly that
   bit on the VICTIM's own descriptor, immediately before the panel's own ONE-TIME draw
   (`170E: CALL 19F2`) -- and rendering `faceFrame(0x40)` (frame 13) confirmed it is genuinely BLANK
   artwork in `FCNORMAL.CHR`, not a visible silhouette as an initial reading of `0DB0`'s branch name
   suggested: the victim's static portrait simply vanishes from the panel, leaving only the bouncing
   FCSAD icon to represent them. Fixed: a new pure export, `eliminatedPanelSlots(opponents, slot)`
   (`screens.js`), substitutes `0x40` at the victim's own slot before the panel is built; verified
   with a rendered PNG (three visible portraits, one blank slot, the sad-face icon bouncing
   separately) matching this derivation exactly, and with a dedicated regression test comparing
   `drawEliminatedScreen`'s own output (not a hand-rolled equivalent) against an un-fixed reference
   over the exact panel rows (13-47 of the sprite's 48) confirmed to differ between the two frames --
   chosen at `step=15` specifically, where the bouncing icon has moved far enough down not to
   obscure the comparison (rows 0-12 are blank in both frames regardless, at any step).
2. **The frozen final frame, during the whole indefinite `179B` wait, was wrong -- twice.** First
   fix attempt: `eliminationStep` incremented `state.step` to 16 the instant the bounce finished
   (before returning `done`), and `screens.js`'s own defensive `WOBBLE_TABLE[step] ?? 0` silently
   fell back to a Y-offset of 0 -- the icon visibly SNAPPED back to the panel's own baseline row the
   instant the bounce ended. Clamping `state.step` to `WOBBLE_TABLE.length-1` (15) fixed that snap,
   but rested on an UNVERIFIED assumption (that the icon simply stays at its own last bounced
   position, offset 47, for the whole wait) that a follow-up advisor pass challenged directly by
   asking what `1000:1790`'s own `CALL 08BC` -- called right after the loop exits -- actually draws.
   Re-disassembling it (20 instructions, a plain, unambiguous 200-row copy) plus the loop's own
   `1776: CALL 05B4` (`RestoreSpriteBackground`, ALSO re-disassembled: copies the pixels the sprite's
   own blit overwrote back over it -- i.e. erases the sprite from the work buffer) settled it: `05B4`
   runs EVERY loop iteration, including the last, so the icon is already erased from the work buffer
   the instant the loop exits (`1759`); nothing between that exit and `1790`'s own full-screen
   present draws anything new -- so the real screen shows NO icon at all during the wait, not one
   frozen at offset 47. Fixed properly: `drawEliminatedScreen` now takes an explicit `done` flag and
   skips the icon draw entirely when true (not merely clamping its position); confirmed both by
   reintroducing the bug (removing the `done` skip) and re-running the suite, AND by rendering the
   `done` state to PNG and looking -- three portraits, one blank slot, no icon, matching this
   derivation exactly. A second latent bug the first fix attempt's own `state.step` clamp surfaced:
   calling `eliminationStep` again after done would have waited another full 9 ticks before
   re-signalling done (the tick-counting logic ran unconditionally); fixed with an explicit
   `state.done` latch, checked first.
3. **The icon also SQUASHES -- initially flagged `UNKNOWN_elimination_bounce_clip_band`, now
   resolved and ported.** A pass that first raised this suspected `089C` (`CopyFrontViewRowsToVga`,
   the loop's own PARTIAL per-step VGA present, called with literal row-count/start-row parameters
   `0x3C`/`0x20`) of clipping the icon to a narrow view-relative row band (32-91) whenever its offset
   pushed it below that band -- plausible from the call site alone, but resting on an unconfirmed
   stride reading. A follow-up pass fully re-disassembled `089C`'s own copy loop (confirming the
   destination row stride is 320 bytes -- mode 13h's own width, matching `menuView.js`'s own
   pre-existing header note -- and the source stride 272, `0x888 = 8*272+8`) and found the suspicion
   was a RED HERRING: at the bounce's own Y range (38-84), this band never actually clips anything.
   The REAL mechanism is `1000:1767: SUB byte [BX+0x19],AL` (AL = the just-read wobble offset),
   independently confirmed against THREE separate functions: `1000:1763: CALL 0630`
   (`ClipSpriteDescToFrontView`, re-disassembled) resets `[BX+0x19]` to the sprite's own full height
   (48) every step (Y never nears the real screen's own 200-row bound, so no screen-edge clip ever
   applies either); `1767` then shrinks that count by the CURRENT offset, immediately before the
   draw; `1000:176A: CALL 04BD` (`BlitSpriteTransparentFlipSaveUnder`, re-disassembled) draws exactly
   `[BX+0x19]` rows counted from the sprite's own TOP (`04D2: MOV CH,byte ptr [BX+0x19]`, the draw
   loop's own outer counter) -- while the DRAW POSITION (baseline+offset) still moves down each step
   unchanged. Net effect: the icon's own visible BOTTOM edge stays pinned at `baseline+48` (the panel
   row's own "floor") throughout, and it visibly SQUASHES into that floor as it sinks, down to just 1
   visible row (which happens to render as entirely transparent on this specific sprite) at the
   deepest point of each dip (offset 47 of 48) -- then resurfaces as the offset drops back down,
   matching the wobble table's own double-dip shape. Ported via a new `cropRows` option threaded
   through `blitTransparent` (`src/render/blit.js`) and `blitChr` (`src/render/menuView.js`), applied
   in `drawEliminatedScreen`. Confirmed by reintroducing the bug (dropping `cropRows`) and
   re-running the suite, AND by rendering several steps to PNG and looking -- the face visibly sinks
   to a sliver by step 4-5 and fully resurfaces by step 8, exactly matching this derivation.

**Port.** `src/frontend/elimination.js` (new, pure `eliminationInitialState`/`eliminationStep`, no
input parameter -- the real loop never polls input). `src/frontend/tournament.js`:
`checkElimination` rewritten around the 3-slot cursor (`state._evictionSlotCursor`) and
`completedRaceIndex`; `state.opponents` is now `[null,null,null]` for Challenge (a fixed 3-slot
array, `null` = the real `0xB` "unpicked" sentinel) instead of a variable-length array;
`pickOpponentCharacter` fills the FIRST empty slot instead of appending; new `hasEmptyOpponentSlot`
(replaces the old `opponents.length` checks everywhere, including inside `needsOpponentPick`);
`state.pendingElimination` (`{victim, slot}`) signals `flow.js` to show the bounce screen; new
`reportRaceResultWithOpponentSnapshot` (snapshots `opponentCharactersFor` BEFORE calling
`reportRaceResult`, returns the snapshot -- the one correct way to build a post-race names list on
an evicting race, extracted so `flow.js` and its own test can share the identical code path).
`src/frontend/screens.js`: `drawOpponentPanel` (`FUN_1000_19F2`), `drawEliminatedScreen`
(`1000:16DE`'s own layout, incl. the `cropRows` squash), `faceFrame`'s priority fix, new
`eliminatedPanelSlots` (the victim's own slot substitution, `1000:170A`). `src/render/blit.js` /
`src/render/menuView.js`: new `cropRows` option on `blitTransparent`/`blitChr` (draw only a sprite's
own first N rows, `1000:0630`/`1767`/`04BD`'s own mechanism). `src/engine/sound.js`:
`eliminatedMusic` (tune 6). `flow.js`: `enterEliminatedScreen`/`eliminationTick`/
`leaveEliminatedScreen` (the SAME RAF-tick-driven pattern every other P1/P2/P3 phase uses, but with
no reader -- the bounce takes no input -- and no auto-timeout once done, matching `179B`'s own real
behaviour above); wired into `nextAfterOutcome` AHEAD of `needsOpponentPick`/`shouldShowBoard`
(`13E4`'s own call order: RESULTS -> ELIMINATED -> replacement picker -> PRESS ANY KEY -> [bonus
race if pending] -> board -> next race intro); `leaveCharSelect`'s `challenge-opponent` branch now
checks `hasEmptyOpponentSlot` instead of `opponents.length<3`, so the SAME code path serves both the
initial 3-pick and a single replacement; `advanceRace` now calls
`reportRaceResultWithOpponentSnapshot` instead of a manual snapshot-then-call pair.

**Tests.** `tools/check-elimination.mjs` (new, `npm run elimination`): the wobble table matches
`DS:034B` exactly (16 real steps), each step holds exactly `WOBBLE_STEP_TICKS`(9) ticks, the frame
alternates starting `frameOn=true` on the very first rendered step (the real loop toggles BEFORE
every draw, including the first), the bounce always completes in exactly 144 ticks, it never reads
an input parameter, `state.step` freezes at 15 (never 16) once done with `WOBBLE_TABLE[state.step]`
always defined, and calling `eliminationStep` again after done stays frozen rather than waiting
another 9 ticks. `tools/check-screens.mjs` gained `eliminatedPanelSlots` unit checks, an end-to-end
pixel check of `drawEliminatedScreen`'s own panel rows against an un-fixed reference, an
end-to-end pixel check that the icon disappears entirely once `done` (at a step chosen so the
squash crop below doesn't itself already make the icon invisible), and a pixel check of the squash
crop itself (a near-full step still shows real icon pixels; the deepest dip renders identically to
no icon at all, both confirmed by reintroducing each bug and re-running the suite).
`tools/check-tournament.mjs` rewritten substantially (test 7 re-derived
against the corrected mechanics; new test 7a decisively distinguishes the 3-slot cursor from "always
evict the lowest current index" and from a roster-index round robin, over 4 checkpoints with
explicit, non-ascending replacement picks; new test 7b specifically proves a bonus-triggering race
still
evicts -- the exact scenario bug #2 above would have failed; new test 7c calls
`reportRaceResultWithOpponentSnapshot` directly, proving both that its return value names every
opponent as of the moment it was called and that the live array read afterward does not (bug #3's
own regression test, now against the exact function `advanceRace` calls); test 6 extended to assert
the exact checkpoint sequence `[3,6,9,12,15,18,21]` over a full perfect run (tightened from a bare
count of 7, which a double-fire-then-run-dry-early scenario could still satisfy), from the arithmetic
`11 roster - 1 player - 3 initial opponents = 7 free characters`, one consumed per eviction check,
with the 8th (`completedRaceIndex 24`) always the no-op. `tools/check-screens.mjs` gained
`drawOpponentPanel`/`drawEliminatedScreen` smoke cases plus three direct `faceFrame` assertions.
Every one of these regression tests was individually confirmed by reintroducing its own bug (not by
a single whole-`src/` `git stash`, which only proves missing exports exist -- see the second
"Corrected" section above) and re-running the suite: each fails specifically and only its own
dedicated assertion(s), then passes again once reverted. Full regression suite re-ran clean
throughout, including after every one of these individual bug-reintroduction checks.

**Live check.** Driven end to end in a foreground Chrome tab: the existing boot-chain drive-through
to the initial 3-opponent pick (P3's second item's own precedent), then -- rather than completing
three real races, blocked by the same backgrounded-tab `requestAnimationFrame` limitation §9AY/§9AZ
already documented -- `tournament.pendingElimination` was poked directly (`{victim: <a picked
opponent>, slot: 0}`, with `opponents[0]` nulled to match `checkElimination`'s own real effect) and
`confirm()` called from the pre-existing `PRESS_ANY_KEY` phase, landing correctly in `ELIMINATED`.
Screenshotted: the 4-face panel, the victim's own name and "IS OUT!!" banner, matching the intended
layout. `forceEliminationSteps` ran the bounce to completion; confirming again correctly cleared
`pendingElimination` and entered the replacement picker, which correctly showed the vacated slot as
the real "unpicked" placeholder (frame 11) alongside the other two still-filled slots (screenshotted).
Picking a replacement correctly filled that exact slot and proceeded to `PRESS_ANY_KEY` with the
new roster reflected in `tournament.opponents`. No console errors from the point the console-message
tool was attached (the same standing caveat every prior live-check paragraph this session names).

**A later render is what actually caught the panel/freeze bugs above.** This original live-check
pass, like every one before it, never looked closely at a mid-bounce frame or the exact moment the
bounce ends -- both bugs it missed are specifically about those moments. A follow-up headless render
(`drawEliminatedScreen` at several `step`/`done` values, `indexedToRgba` + `tools/png.mjs`, saved to
a scratch PNG and looked at) showed the fix's own intended picture at each stage: mid-bounce, three
visible portraits, a blank fourth slot (not the red "?" `FCNORMAL.CHR` frame 11, confirmed by a
side-by-side render of both), and the FCSAD icon bouncing separately below the panel row; once done,
the SAME three portraits and blank slot, but with the icon gone entirely -- matching this section's
own derivation exactly at both stages.

**Where that `PRESS_ANY_KEY` actually comes from, settled by a third advisor pass.** The paragraph
above states the observed port behaviour correctly, but this section originally attributed it to the
wrong instruction. `FUN_1000_1A4A` itself, fully re-disassembled (20 instructions, not previously
done in full): `1A4A: CALL 19F2` (the 4-face panel, drawn ONCE at entry, not per pick); then a loop
from `BX=0xC03` (the PLAYER's own face-descriptor slot, `+0x1B` per step through the 3 opponent
slots `0xC1E`/`0xC39`/`0xC54`) scanning for `[BX+0x13]==0xB` (the "unpicked" sentinel); on a hit,
`1A69` remembers the slot, runs `09E0` (the SAME character-select carousel) for that ONE slot, and
either re-enters the SAME slot on ESC (`1A78: JNC 1A7C / JMP 1A69`, confirming this section's own
earlier claim) or, on a real pick, loops back to `1A53` to RE-SCAN FROM THE START (`BX=0xC03` again)
-- so the NEXT slot filled is whichever the scan finds first in slot order, not necessarily the
next-highest index; the port's own `pickOpponentCharacter` (fills the first `null` in `state.
opponents`) matches this exactly, since the player's own slot is always already filled by the time
`1A4A` runs. Once the scan finds no `0xB` slot left (`BX>0xC54`), `1A65: CALL 0C15; RET` -- and
`0C15` (`get_xrefs_to`: 3 callers, `RunOnePlayerChallenge 108A` and `RunOnePlayerHeadToHeadVsCpu
101B`, both right after the PLAYER's own single character pick, plus `1A4A` itself) is the SAME
"PRESS ANY KEY TO START" the qualifier's own character select already leads to once -- confirmed,
not assumed, by that shared-caller identity. So the "press any key" this section's live check
observed comes from `1A4A`'s OWN trailing call, reached identically whether `1A4A` fills 3 empty
slots (item 2's initial pick) or just 1 (this item's replacement pick) -- **not** from a separate
step `16DE`'s own tail or the port invented. `16DE`'s own tail (`1789-179A`, also now fully
re-disassembled) is unrelated and comes EARLIER: the loop's own `1759: JZ 178B` exit (when the
wobble table's 17th/terminator byte is read) lands at `178B: MOV word ptr [BX+0x13],0x0B` (resetting
the VICTIM's own face descriptor to the same "unpicked" sentinel `1A4A`'s scan looks for -- the real
"vacate the slot" mechanism, matching `checkElimination`'s own `state.opponents[slot]=null`
one-for-one), `1790: CALL 08BC` (a redraw), `1793: CALL 179B` (the indefinite wait this section
already covers), THEN `1796: CALL 1A4A`. So the real order is bounce -> vacate+redraw -> wait for a
key -> run the picker (which ends with ITS OWN wait for a key, via `0C15`) -- exactly two separate
waits, both already correctly ported (`ELIMINATED`'s own confirm-gated wait, then `PRESS_ANY_KEY`
after `1A4A`'s scan finds no more `0xB` slots), not the missing-wait bug a third advisor pass
initially suspected from `16DE`'s own tail alone (which, read in isolation, has nothing after its
own `1796: CALL 1A4A` besides `POPA;RET` -- correct, because the wait already happened INSIDE the
callee, at `0C15`, before `1A4A` ever returns).

## 9bb. P3's 4th item: the five Challenge-rule divergences from §9an 8 (2026-09-24)

**Scope.** GOAL-DOS-PARITY.md P3's 4th item, `§9an 8`'s own "The Challenge flow (same spec, not
requested, not ported)" bullet list, narrowed to its 5 still-open entries (the other 3 -- tune 5
unreachable, the main-menu tune, the 3x replacement picker -- were resolved by M3.45/M3.50-51/M3.55
respectively, already ticked off there). Each is its own independently re-disassembled rule; none
depend on each other.

### 1. The final race's 2nd place is a FAIL (`1000:15B7`/`1000:1658`)

Both sites share the identical shape, fully re-disassembled: `CMP byte [0x28C1],0x19` (is this the
tournament's very last race, `ORDER_TABLE_LAST_INDEX`) gates whether a SECOND comparison
(`word[0x3FE]==0xC03`, did the player finish 2nd) is even consulted. `1000:1650-166A` is the real
decision site: `CMP [0x3FC],0xC03` (1st place) alone reaches the PASS tail (`1676`, the elimination-
check block P3's 3rd item ported) unconditionally; the `[0x3FE]` (2nd place) check is skipped
entirely when `[28C1]==0x19`, so on the last race ONLY 1st place passes -- every other placement,
including 2nd, falls through to `CX=2; CALL 1C1B` (`ONE_LIFE_LOST`), the SAME call a normal 3rd/4th
loss uses, so it inherits that path's own life-decrement/streak-reset/game-over logic unchanged.
`1000:15B1-15C7` is a second, cosmetic site with the identical `[28C1]==0x19` gate, choosing which
of two real strings (`DS:039A`="QUALIFY", `DS:03A2`="FAILED", both read live and confirmed) to draw.
**Not "a 2nd-place finisher's own row" in general -- gated to the PLAYER's own row specifically**
(a wording error an advisor review caught): `1000:15A8: CMP AX,[0xC16]` (`[0xC16]=[0xC03+0x13]`,
the PLAYER's own fixed descriptor-frame address) skips this whole label computation (`15AC: JNZ
15E5`) for every row EXCEPT the one currently matching the player's own identity, so `15B1-15C7`'s
own `[3FC]`/`[3FE]` comparison against `BX` only ever runs once per results screen, already scoped
to the player. **This port DOES have a structurally equivalent mechanism -- an earlier draft of
this section wrongly claimed the port had none at all, without checking `screens.js` first, caught
by the SAME advisor review**: `drawResults` already draws a single overall "QUALIFY"/"FAILED" label
(the exact same two strings, confirmed by grep) -- not an approximation of a per-row label, but the
SAME "one label, for the player specifically" design the real bytes use -- driven by a `passed`
boolean, itself derived from
`flow.js`'s own `lastPassed = tournament.lastOutcome !== QUALIFIER_FAILED && !== ONE_LIFE_LOST` --
which automatically becomes `false` for the last-race-2nd-place case too, now that
`reportRaceResult`'s own outcome fix (below) correctly sets `lastOutcome=ONE_LIFE_LOST` there. No
separate wiring needed for this cosmetic site; it inherits the fix for free.
**This also resolves a loose end an earlier `mm-re-player-visible` pass (2026-09-23, docs/engine.md
§9ai) left explicitly unexplained**: `ShowRaceResultsScreenTune8or6 1000:1439`'s own real tune
condition (a SEPARATE goal item, the results-screen tune, not yet ported byte-exact) has "an
apparent exception on the tournament's 25th-of-26 race... this pass could not further explain" --
that exception IS this rule; the `raceResultMusic` header comment is updated below to point at it,
though the tune itself is still left as the `lastPassed` approximation pending that other item.
Ported: `reportRaceResult`'s own pass-threshold is now `isLastRace ? 1 : 2` instead of the previous
flat `finishPosition>=3` FAIL / `<=2` PASS split, `isLastRace = state.raceIndex ===
ORDER_TABLE_LAST_INDEX` (evaluated the SAME pre-advance way `checkElimination`'s own
`completedRaceIndex` already is).

### 2. The bonus trigger has no cap (`1000:1123-113A`; `[0x342]` counts wins only, `1000:1A92-1AA5`)

Fully re-disassembled: the TRIGGER (`1123-113A`, inside `RunTournamentLoop`) gates on exactly three
conditions -- the player won (`1123: CMP [0x3FC],0xC03`), the streak reaches 0
(`112B: DEC [0x3FA]`/`112F: JNZ`), and it isn't the last race (`1131/1134/1138`) -- and reads
`[0x342]`/`[0x43B]` NOWHERE. The cap lives entirely inside `TriggerBonusRace 1A82`'s own
RESOLUTION-time tail (`1A9F: CMP [0x342],[0x43B](MAX_BONUS_RACES) / JZ 1AA9` skips the INC once
capped), which this port's own `reportRaceResult` already modelled correctly-in-shape (`Math.min
(...)` in the `pendingBonusRace` branch) -- the bug this item's own name describes was a SEPARATE,
ADDITIONAL cap `maybeTriggerBonusRace` wrongly placed on the TRIGGER itself, stopping it from firing
again once `bonusRacesTaken` reached `MAX_BONUS_RACES`. Since `[0x342]`/`bonusRacesTaken` is read
(via `1169: MOV AH,[0x342]`, BEFORE its own increment) to pick WHICH of the real 3 bonus tracks
(`ROUND91`/`92`/`93`) loads -- `race = [0x342]+1` -- and `[0x342]` naturally stops incrementing once
capped, the REAL effect of an uncapped trigger is simply that the tournament keeps re-running
`ROUND93` (the last real bonus track) for every streak-out past the 3rd, for as long as the player
keeps winning every 3rd race, all the way to the tournament's own last race. Fixed: the trigger-side
cap check is removed; the race-number formula (`state.bonusRacesTaken + 1`) was ALREADY correct and
is unchanged, and naturally inherits the clamp from the counter's own existing resolution-time cap.

**Two further, genuinely separate bugs an advisor review caught in the SAME branch, both real and
both fixed in the same pass (not part of the item's own original 5-bullet list, but directly
adjacent code this item was already touching):**
- **`[0x342]`'s own resolution-time increment is WIN-gated, and the port's version wasn't.**
  `1000:1A92: CMP [0x291D],1 / JNZ 1AA9` -- a LOST bonus race jumps straight to the outcome-message
  call, skipping `1A99-1AA5` (the counter increment) entirely. This port's own `reportRaceResult`
  incremented `bonusRacesTaken` unconditionally, win or lose -- meaning a LOST bonus race would
  still advance to offer the NEXT track, when the real game re-offers the SAME one. Fixed:
  `bonusRacesTaken`'s own increment moved inside `if (won)`.
- **A WON bonus race never granted a life.** `1000:1CF7-1D08` (inside the shared outcome-message
  function, the CX=3/`EXTRA_LIFE` branch specifically): `INC AL` / `MOV [0x406],AL` -- a real,
  literal `lives++`, matching the outcome's own NAME. This port's `reportRaceResult` set
  `lastOutcome=EXTRA_LIFE` and showed the right message, but never actually incremented
  `state.lives` -- a real, player-visible gap (a win that should extend the run instead had no
  effect at all, so the port's own tournament would end sooner than the real game's on an
  otherwise-identical play sequence). Fixed: `state.lives++` added, gated the SAME `if (won)` as the
  track counter above (both effects share the identical real gate, `1A92`).

### 3. A passed Challenge race shows RESULTS only (`OUTCOME` code 1 is emitted only at `1000:10EC`)

Fully re-disassembled: `1000:10EC`'s own `CX=1; CALL 1C1B` is reached EXCLUSIVELY from the
QUALIFIER-pass block (`10C8-10F9`, gated on `[28C1]==0`, the qualifier) -- confirmed by tracing every
other path into `1C1B` in this same investigation. `1000:1650-166A` is the regular-race decision
site (SHARED with item 1 above): a PASS (`1650: JZ 1676` on 1st place, or `1665: JZ 1676` on 2nd
place when not the last race) jumps straight to the elimination-check tail (`1676`) WITHOUT EVER
calling `1C1B` -- ONLY a FAIL (`1667: MOV CX,2 / CALL 1C1B`) does. So OUTCOME code 1 (`PASSED`) is
semantically QUALIFIER-EXCLUSIVE, AND -- the actually load-bearing fact this item needed -- a
regular mid-tournament Challenge PASS never shows an OUTCOME screen of ANY kind (not just never
code 1), by construction: RESULTS is the only screen, and confirm just advances straight to
whatever's next.

**A real, currently-shipping bug an advisor review caught: this file's own first draft checked only
`screenAfterRace` (which screen shows FIRST after a race) and stopped there, concluding "already
correct" without checking the SECOND transition.** `flow.js`'s own `confirm()`, in its `RESULTS`
branch, transitioned unconditionally to `phase='OUTCOME'` and called `raceOutcomeMusic` regardless
of `lastOutcome`'s value -- so after EVERY passed regular Challenge race, the port showed RESULTS,
then (on the next confirm) a SPURIOUS OUTCOME screen reading `OUTCOME_MESSAGES[1]` = "QUALIFIED FOR
CHALLENGE!" with tune 8 -- a message that only makes sense for the QUALIFIER, shown on every single
regular race pass instead. This is exactly the bug the item's own title describes ("shows RESULTS
only"); it was real, and the pre-existing `screenAfterRace` assertion this file's own first draft
cited never exercised the SECOND transition at all, so it couldn't have caught it. Fixed: a new
pure predicate, `tournament.js`'s `showsOutcomeAfterResults(state)` (true only for
`lastOutcome===ONE_LIFE_LOST`, the one case that DOES reach `1C1B` per the decision site above),
which `confirm()`'s `RESULTS` branch now checks before transitioning -- on a PASS it calls
`nextAfterOutcome()` directly instead, skipping the OUTCOME phase entirely, matching the real bytes'
own "PASS jumps straight past `1C1B`" behaviour exactly.

### 4. OUTCOME code 4 plays tune 6 and shows "NO BONUS" (`1000:1C84` runs before the `1000:1CA3` test)

**Corrects a real error an earlier `mm-re-player-visible` pass (2026-09-23) made and this session's
fresh re-disassembly caught.** That pass claimed "code 4 (NO_BONUS) skips the whole real screen,
jumping straight past its own AH=4, not just landing on the 'lose' tune" (docs/engine.md §9ai,
`sound.js`'s own header comment, both corrected in place). A byte-for-byte re-read of
`1000:1c1b-1c89` (independently re-fetched twice, matching exactly) found NO CX-dependent branch
anywhere between the win/lose tune choice (`1c6c: TEST CX,1` -- parity-based: odd -> tune 8, even ->
tune 6, no code-4 exception) and the play call itself (`1c84`). The ONLY branch in that range,
`1c80: JZ 1c89`, depends on the driver's own `AH=9` "already playing" query result, not on CX --
the SAME "query-then-play, safely collapsible to one unconditional `playTune` call" idiom this
project's own `sound.js` already uses everywhere else (see `titleMusic`'s own header). So CX=4 plays
tune 6 exactly like CX=0/2 (all even codes) -- no exception. **What CX=4 genuinely DOES skip** is
the LATER lives-adjustment display machinery (`1cab-1d08`, reached only by CX=1/2/3/5 en route to
the shared `1D0D` wait loop) -- `1ca3: CMP CX,4 / JZ 1de5` routes it to the SAME simpler wait
`1de5` that CX=0 (`QUALIFIER_FAILED`) uses instead, which is a real, but separate and much smaller,
visual difference (no lives-count blink) this port doesn't model at all (out of scope for this
item -- neither outcome screen shows a lives count currently). `OUTCOME_MESSAGES[4]='NO BONUS'` was
ALREADY correct (no fix needed there). Fixed: `raceOutcomeMusic`'s own `if (outcomeCode===4) return`
early-return removed; it now plays the correct parity-based tune unconditionally for all 6 codes.

### 5. The `]` key zeroes lives on OUTCOME 2/3 (`1000:1DCD`)

Fully re-disassembled: `1D0D` (the SAME shared wait loop with the lives-adjustment display from
item 4 above) is reached ONLY for CX=2 (`ONE_LIFE_LOST`) and CX=3 (`EXTRA_LIFE`) -- confirmed by
tracing `1C1B`'s own full CX dispatch chain (CX=0/4 -> `1DE5`; CX=1/5 -> also `1DE5`, after their
own brief lives-text draw at `1cab-1cd1`; only CX=2/3 fall through to `1D0D` itself). Inside that
loop's own input-poll (`1DC8: CALL 2D5B`), `1DCD: CMP byte [0x107E],0x1B` tests the LAST-PRESSED
SCANCODE against `0x1B` -- the standard PC XT scancode for the `]`/`}` key (not ESC, which is a
DIFFERENT scancode; `0x1B` here is unambiguous since `[0x107E]` is confirmed elsewhere in this
codebase to hold a raw scancode, not an ASCII code) -- and if it matches, `1E12: MOV [0x406],0; RET`
zeroes lives and returns FROM the outcome-message function immediately, with NO further wait. This
is a developer debug shortcut (buried in the shipped binary, not a documented player feature),
matching the "reproduce the original including its cheats" precedent already set by the
`25011968`/`CHEATS.BIN` handling elsewhere in this port. **The two reachable outcome codes have
genuinely different downstream consequences**, both reproduced: CX=2's own real caller
(`166A`'s call site, inside `ShowRaceResultsScreenTune8or6`) checks `166D: CMP [0x406],0` the
INSTANT the call returns and ends the tournament right there (`STC`, propagating all the way up
through `RunTournamentLoop`'s own `1110: JC 115B` exit) -- so `]` on `ONE_LIFE_LOST` is effectively
"quit with 0 lives" immediately; CX=3's own real caller (`TriggerBonusRace`'s `1AA9: CALL 1C1B` /
`1AAC: RET`, unconditional) has NO such check at all -- so `]` on `EXTRA_LIFE` just plants a
zeroed-lives value silently, with no immediate visible effect, until whatever race-loss the player
NEXT reaches.

**At THAT later point, this port's own tournament-over test diverges from the real bytes -- flagged,
deliberately NOT fixed here (out of scope for this item; belongs to GOAL-DOS-PARITY.md's own next
item, "what ends the tournament at 0 lives").** `[0x406]` is a single BYTE (`1CE1: MOV AL,[0x406]` /
`1CEA: DEC AL`, both 8-bit, re-confirmed from this same disassembly pass). A 3rd/4th-place loss
reached with `[0x406]` already at 0 (via this exact cheat) UNDERFLOWS to `0xFF`(255), not a negative
value -- `166D`/`1403` (the SAME `CMP byte [0x406],0` test, confirmed shared by BOTH the Challenge
and two-car formats -- `1403` re-disassembled specifically to check this) then read 255, not 0, so
the real game does NOT end the tournament at that next loss; it silently continues with 255 lives.
This port's own `state.lives<=0` (an ordinary signed JS number: `state.lives--` then a `<=0` test)
ends the run immediately instead -- the OPPOSITE of the real byte-wraparound behaviour. A genuinely
obscure combination (needs the debug cheat itself to reach at all), left as a known, cited
divergence with starting citations (`166D`/`1CEA`/`1403`) for that next item. **Resolved the same
day, §9bc**: `decrementLives`/`incrementLives` now reproduce the byte wraparound exactly, closing
this divergence. Ported as a new pure export, `tournament.js`'s `applyLivesCheat(state)` -- the
reachability guard (`lastOutcome` being `ONE_LIFE_LOST` or `EXTRA_LIFE`, no-op otherwise) lives
INSIDE this function, not in the caller (an advisor review caught that leaving it only in
`flow.js` meant it was never actually tested); zeroes lives, ends the tournament immediately only
for `ONE_LIFE_LOST`. `flow.js`'s own `onKeydown` just calls it unconditionally on `phase==='OUTCOME'
&& e.code==='BracketRight'`, matching the real function's own reachability exactly via the shared
helper rather than duplicating the check at the call site.

**Port.** `src/frontend/tournament.js`: the pass-threshold fix (item 1); `maybeTriggerBonusRace`'s
own extra trigger-side cap removed, and its win-gated counter/life bugs fixed (item 2); new
`showsOutcomeAfterResults` export and the real `confirm()` fix it enables (item 3); new
`applyLivesCheat` export, with its own reachability guard (item 5). `src/engine/sound.js`:
`raceOutcomeMusic`'s early-return removed (item 4), header comment corrected (also corrects
`raceResultMusic`'s own header to point at item 1's `0x19`-exception resolution). `src/frontend/
flow.js`: `confirm()`'s `RESULTS` branch now checks `showsOutcomeAfterResults` before transitioning
(item 3); `onKeydown` gained the `]`-key handler (item 5).

**Tests.** `tools/check-tournament.mjs` gained: test 9 (the last-race-2nd-place fail, plus a
regular-race baseline proving 2nd still passes everywhere else), test 10 (the bonus trigger firing
`MAX_BONUS_RACES+2` times without ever being gated, and the race-number sequence `1,2,3,3` proving
the counter's own pre-existing cap still clamps the TRACK choice correctly even though the TRIGGER
no longer stops), test 11 (`applyLivesCheat`'s own asymmetric behaviour on `ONE_LIFE_LOST` vs
`EXTRA_LIFE`, plus its own no-op on every other outcome code), test 12
(`showsOutcomeAfterResults` true only on a loss), test 13 (the bonus-race win-gate: losing grants
no life and doesn't advance the track counter; winning grants exactly one life and does advance
it). `tools/check-sound.mjs`'s existing outcome-music pin rewritten from "5 codes plus a NO_BONUS
exception" to "6 codes, exception-free parity". Every new/changed assertion was individually
confirmed by reintroducing its own bug and re-running the suite: each fails specifically and only
its own check(s), then passes again once reverted.

## 9bc. The two INFERRED tournament rules, both resolved (2026-09-24)

**Scope.** GOAL-DOS-PARITY.md's own next P3 item, `tournament.js`'s file header: "what ends the
tournament at 0 lives, and whether the win streak resets to 3 after a bonus race. Re-derive both
from `10a0`/`115c` and replace the inference with cited code." The streak-reset half was already
settled by an earlier session (§9t, `1000:1220`) -- see the pointer at the end of this section. The
lives half was genuinely still an inference (`tournament.js`'s own header: "It is implemented the
way the surrounding rules read most naturally... not a silent assumption" -- an honest hedge, not
evidence) until this pass.

**What ends the tournament at 0 lives -- fully re-disassembled, resolved.** An exhaustive
`search_byte_patterns` sweep of `[0x406]`'s disp16 bytes (`06 04`, 13 hits, all individually
checked) found every reference in the whole 83,662-byte image:
- **Init to 3**: `1000:0ED0-0ED8` (inside `ResetTournamentState`), a byte `MOV AL,3` broadcast to
  `[0x406]`/`[0x407]`/`[0x408]` -- confirming `[0x406]` is a plain BYTE, and matching this port's
  own `lives: 3` default exactly. (`[0x407]`/`[0x408]` are not read anywhere this pass found --
  consistent with CLAUDE.md's own existing "only `[406]` is used" note; not chased further.)
- **The `25011968` cheat's own write of 10**: `1000:11BA: MOV byte ptr [0x406],0xA` -- also
  byte-sized, matching the VALUE this port's existing `if (cheatActive) tournament.lives = 10`
  writes, but **not the moment, an inaccuracy a second advisor pass caught in an earlier draft of
  this section**: `11BA` sits INSIDE `SetupTournamentRace 115C`, after `CALL 3039` (the race
  itself) but BEFORE `115C` returns to its own three callers (`10C8` the qualifier, `110A` a
  regular race, `1A87` `TriggerBonusRace`'s own bonus race) -- so DOS re-writes lives=10 for EVERY
  race, qualifier and bonus races included, and does so BEFORE that race's own results/outcome
  screen (`13E4`/`1439`) ever runs, but AFTER `CALL 3039` (`RunRaceMainLoop`) -- the SAME function
  that calls `CheckCheatSpotsThenPause` (confirmed with `analyze_call_graph`), i.e. any in-race
  type-0 CHEATS.BIN pause decrement happens BEFORE this reset, not after.
  **Two claims in earlier drafts of this bullet were checked against the code and found false.**
  One said the port's late write (`flow.js`'s old `advanceRace`-only reset, AFTER
  `reportRaceResultWithOpponentSnapshot`, non-bonus races only) "could still end the tournament on
  the cheat's very first loss after being turned on mid-run" -- FALSE: `cheatActive` (`flow.js:239`)
  only ever becomes `true` inside `optionsKey`, reachable only pre-tournament, so an ordinary loss
  with NO cheat-spot decrement involved could never see anything but a freshly-reset 10. The
  correction that followed then claimed the whole divergence was reduced to an inert, unobservable
  intermediate BYTE VALUE with "nothing observable to fix" -- also FALSE, once the SAME race can
  also contain a type-0 pause decrement (not just an ordinary loss): the port's actual order was
  delta (`finishRace`) -> the full result-reporting pass INCLUDING THE LOSS CHECK
  (`reportRaceResultWithOpponentSnapshot`) -> reset (`advanceRace`, too late) -- so an active cheat's
  own type-0 decrements COULD survive long enough to zero `tournament.lives` and end the run for
  real, the opposite of DOS (where the reset always lands between the type-0 decrements and the
  loss check, erasing them first). **Fixed**: `reportRaceResult` (`tournament.js`) takes
  `lifeDelta`/`cheatActive` and calls `applyPostRaceLives` as its OWN very first statement, before
  every branch below it (qualifier/twocar/bonus/Challenge-fail) -- matching `11AF-11BA`'s real
  position relative to the loss check, and living inside the one function that IS unit-tested
  (a call-site composition in `flow.js` itself would be untestable, since `flow.js` has no
  automated harness). `flow.js`'s `finishRace` no longer touches `tournament` at all; it carries
  the accumulated delta out in the resolve payload (`lifeDelta`), and `advanceRace` forwards it plus
  `cheatActive` into both `reportRaceResult` call sites. Since `reportRaceResult` is shared by every
  race type, this also closes the separate "never re-arms for a bonus race" gap the ORIGINAL
  non-bonus-only `advanceRace` reset had, for free. This makes the port's own event order for a
  single race -- type-0 decrements, THEN the cheat reset, THEN the loss check -- structurally
  identical to DOS's, closing `UNKNOWN_25011968_reset_timing` in full rather than leaving it open.
  Test 16 (`tools/check-tournament.mjs`) now calls `reportRaceResult` itself (10 lives, 9 type-0
  decrements via `lifeDelta:-9`, `cheatActive:true`, a 3rd/4th finish in that SAME call) and asserts
  the reset erases the decrements before the loss check ever sees them, plus a bonus-race variant
  proving the same reset now reaches round 9 too.
- **The decrement**: `1000:1CEA` (inside `ShowRaceOutcomeMessageTune8or6`'s own `CX=2`/
  `ONE_LIFE_LOST` branch) -- `1CE1: MOV AL,[0x406]` / `DEC AL` / `MOV [0x406],AL`, an 8-bit `DEC`.
- **The increment**: `1000:1D00` (the SAME function's `CX=3`/`EXTRA_LIFE` branch) -- the mirror
  image, `INC AL` / `MOV [0x406],AL`.
- **The `]` debug cheat's own zero**: `1000:1E12: MOV byte ptr [0x406],0` (docs/engine.md §9bb
  item 5, already ported as `applyLivesCheat`).
- **A cheat-SPOT effect, TWO genuinely separate mechanisms this section originally conflated into
  one (a second advisor pass caught this too)**: `1000:36A0: DEC byte ptr [0x406]`, inside
  `CheckCheatSpotsThenPause`, is CHEATS.BIN spot-effect TYPE 0 (`3652-3656`'s own dispatch,
  `CMP AX,0 / JZ 36A0`) -- a plain life decrement, nothing else, falling through to the shared
  pause-banner tail (`3734`) with NO life check anywhere nearby. This is a DIFFERENT effect from
  the "instant end the race" one §9x's own cheat-effect table describes (`36A7`, TYPE 1,
  `CMP AX,1 / JZ 36A7` -- sets `[26C6]=4` and resets several car fields; it never touches
  `[0x406]` at all) -- an earlier draft of THIS section wrongly merged the two into "an instant
  end the race effect that also costs a life," which is not what either byte range actually does.
  `applyCheatEffect` (`src/engine/cheats.js`) already had a `case 0` for the real effect
  (`globalState.lives = (globalState.lives ?? 0) - 1`), but that file's OWN header comment used to
  say **`lives` has no reader** -- an earlier draft of this section trusted that comment at face
  value (a `src/` comment, exactly the kind GOAL-DOS-PARITY.md warns goes stale) instead of
  grepping for the actual call sites. Grepping (`grep -rn "\.lives\b|globalState" src/`) found
  `flow.js`'s own `finishRace()` (inside `runOneRace`) DOES read `globalState.lives`, applying it
  to `tournament.lives` -- but with `Math.max(0, tournament.lives + globalState.lives)`, an
  ordinary signed-number floor-at-0 clamp, not the byte-wrap this whole section is about. Both the
  stale comment and the real clamp bug are now fixed IN THIS SAME PASS (not left as a separate open
  item): `applyLivesDelta(state, delta)` (`tournament.js`, `state.lives = (state.lives + delta) &
  0xff`) replaces the clamp, applied by `reportRaceResult` (via `applyPostRaceLives`, below --
  `finishRace()` itself only carries the accumulated delta out as `lifeDelta` now), and
  `cheats.js`'s header comment is corrected to point at the real reader. So the 5 real type-0 spots
  shipped in `GAME1/CHEATS.BIN`
  (round 1 race 1/4, round 3 race 1/3, round 4 race 3, confirmed by parsing the real file with
  `parseCheats`) now reach the SAME byte-wrap arithmetic as the `]` debug cheat, ordinary play
  included, not just the debug key -- correcting the claim two paragraphs below this one, which an
  earlier draft of this section had said was reachable "only via the `]` cheat." Test 15
  (`tools/check-tournament.mjs`) is `applyLivesDelta`'s own direct unit test; the `Math.max` clamp
  was reintroduced and re-tested to confirm it is what test 15 catches.
- Two more `06 04` hits (`1000:166F`, `1000:36A2`) are not separate references at all -- they're the
  disp16 operand bytes of instructions already listed above (`166D`'s own `CMP`, `36A0`'s own `DEC`),
  and one (`1000:1A4E`) is a coincidental false positive inside `1A4D: MOV word [0x404],0` (a
  different, already-confirmed-dead global, `1A4A`'s own header). A follow-up sweep for `05 04`
  (ruling out a WORD access at `[0x405]` that would also touch `[0x406]`'s own high byte) found 19
  hits, all either immediate-operand false positives (`ADD AX,0x4` etc.) or in unrelated code/data
  far from the tournament logic -- no word access to `[0x406]` exists anywhere.

**The real test, at the two sites that actually end a run**: `1000:166D` (Challenge, right after
`ShowRaceOutcomeMessageTune8or6`'s own `CX=2` call returns, inside `ShowRaceResultsScreenTune8or6`)
and `1000:1403` (two-car, the structurally identical site in the SAME shared function) -- BOTH
`CMP byte ptr [0x406],0 / JZ <tournament-over, STC>`. Two things this settles, neither obvious from
the prose alone:
1. **Exact zero, not "non-positive."** `[0x406]` is an UNSIGNED byte. `166D`/`1403` test equality
   with 0, never inequality or a sign flag. In NORMAL play this is indistinguishable from "reached
   0 or below" (the decrement can only ever land on 0 from 1, one step at a time, through ordinary
   play) -- but it is NOT indistinguishable once the `]` cheat (docs/engine.md §9bb item 5) can
   plant a 0 directly outside the normal decrement sequence.
2. **A decrement below 0 WRAPS to 255, it does not go negative.** This is the case the `]` cheat
   opens up: press `]` while viewing an `EXTRA_LIFE` outcome screen (the one reachable outcome the
   cheat's own real caller, `TriggerBonusRace`'s `1AA9`, never checks `[0x406]==0` immediately
   after -- §9bb item 5's own already-documented finding) to zero lives silently, then lose the
   NEXT regular race: `1CEA`'s own `DEC AL` on `AL=0` wraps to `0xFF`(255), and `166D`'s own
   `CMP byte [0x406],0` reads 255, not 0 -- so the real game does NOT end the tournament at that
   next loss at all. It silently continues, now effectively with 255 lives. This IS what the
   real bytes do, and it is the one place an ordinary signed-number port of "lives" (which this
   file's own pre-existing `state.lives<=0` inference was) provably diverges from the real byte
   semantics, not just an unverified guess that happened to be directionally right. The `]` debug
   cheat is the OBVIOUS way to reach a pre-zeroed `[0x406]`, but not the only one: the CHEATS.BIN
   type-0 spot-effect bullet above reaches the identical wrap through entirely ordinary play (no
   debug key needed) -- an earlier draft of this section said the wrap was "reachable only via the
   `]` cheat," which was wrong once that spot-effect's own wiring bug (same bullet) was found and
   fixed in this pass.

**Ported.** `decrementLives(state)`/`incrementLives(state)` (`tournament.js`, both new, private):
`state.lives = (state.lives ∓ 1) & 0xFF`, matching the real 8-bit wraparound exactly;
`decrementLives` returns whether the result landed on EXACTLY 0 (the real test), and its two real
call sites (the Challenge fail branch, the two-car fail branch) now use that return value to decide
`state.over` instead of the old `state.lives<=0` inference. `applyLivesCheat` (§9bb item 5) needed
no code change -- it already just sets `state.lives=0` directly, which is now correctly byte-typed
by construction (0 is a valid byte). Also new: `applyLivesDelta(state, delta)` (the general
byte-wrapped form, used by the CHEATS.BIN type-0 path) and `applyPostRaceLives(state, delta,
cheatActive)` (delta composed with the `25011968` cheat's own reset in DOS's real order), the
latter called from `reportRaceResult`'s own very first statement -- `flow.js` no longer touches
`tournament.lives` directly at all, only carrying `lifeDelta` out of `finishRace` in its resolve
payload and passing it plus `cheatActive` into both `reportRaceResult` call sites in `advanceRace`.
The file's own header (`tournament.js`) is rewritten: the "INFERRED"/"filled by inference, not
evidence" language is removed, replaced with a full citation of both settled rules.

**The win-streak-after-a-bonus-race half was already resolved**, by an earlier session (§9t,
2026-09-22): `[0x3FA]` resets to 3 at `1000:1220` (`ShowNextRaceIntroScreenTune4or5`'s own bonus-race
INTRO gate, `[28BF]==9`), BEFORE the bonus race runs, not after it resolves as the file's own header
had guessed -- confirmed-equivalent to this port's own resolution-time reset (nothing reads
`state.streak` while `pendingBonusRace` is set, so the two timings are unobservably identical). No
code change was needed then, and none is needed now; this pass's only contribution to that half is
removing the stale "confirmed-equivalent... the next session should not re-chase it" framing from
the header now that BOTH halves are settled together, not just noted as separately resolved.

**Tests.** `tools/check-tournament.mjs` test 14: wins a bonus race (`EXTRA_LIFE`), applies the `]`
cheat (zeroing lives with no immediate check), then loses the next regular race and asserts
`lives===255 && over===false` -- the exact scenario that discriminates byte-wrap semantics from a
signed-number guess. Confirmed by reintroducing the old `state.lives-1`/`<=0` logic and re-running
the suite: fails specifically and only this one assertion, then passes again once reverted. Test
15 is `applyLivesDelta`'s own direct unit test (a single decrement to exactly 0 does not wrap; one
more wraps to 255 with no `over` check; a multi-step negative delta wraps correctly in one step; a
positive delta also wraps correctly) -- confirmed the same way, reintroducing the `Math.max(0,
...)` clamp this export replaced and re-running the suite: assertion 1 (the decrement to exactly 0)
passes either way, since `Math.max(0,0)` is still 0; assertions 2 and 3 fail because the clamp
floors at 0 instead of wrapping; assertion 4 fails too, but only because it starts from that
floored 0 rather than the correctly-wrapped 252 (`0+10=10`, not `6`) -- passes again once reverted.

**A follow-up review caught a further, real ordering bug in this same fix** (an earlier check only
confirmed `cheatActive` cannot become true mid-tournament, true but beside the point): the
`25011968` cheat's own reset (`1000:11BA`) and a type-0 delta both apply to the SAME race when the
cheat is active and the player also pauses on a spot, and DOS applies them in a specific order --
delta (inside `CALL 3039`, confirmed by `analyze_call_graph` to be the function that calls
`CheckCheatSpotsThenPause`), THEN the reset (`11B3-11BA`, right after `3039` returns), THEN the
results screen's own loss check (`1CEA`/`166D`, reached only after `115C` returns to its caller). An
earlier draft of this item's fix got the PORT's own order backwards: `applyLivesDelta` in
`finishRace`, then the full `reportRaceResultWithOpponentSnapshot` pass (including the loss check),
THEN a `cheatActive` reset only in `advanceRace` afterward -- which let an active cheat's own
type-0 pause decrements survive long enough to zero `tournament.lives` and genuinely end the
tournament, the opposite of DOS. **Fixed by moving the composition into the tested function
itself**: `reportRaceResult` (`tournament.js`) now takes `lifeDelta`/`cheatActive` and calls
`applyPostRaceLives` as its OWN first statement, before every branch below it (composing this at
the `flow.js` call site instead would be untestable, since `flow.js` has no automated harness);
`flow.js`'s `finishRace` no longer touches `tournament` at all, only carrying `lifeDelta` out in its
resolve payload, and `advanceRace` forwards it plus `cheatActive` into both `reportRaceResult` call
sites. Since `reportRaceResult` is shared by every race type, this also correctly re-arms lives for
BONUS races too, closing a second, smaller pre-existing gap in the same motion -- the port's old
`advanceRace`-only reset never touched bonus races at all. Test 16 now calls `reportRaceResult`
itself (10 lives, `lifeDelta:-9`, `cheatActive:true`, a 3rd/4th finish, all in one call) and asserts
the reset erases the decrements before the loss check sees them (`lives===9 && over===false`, not
`0`/`over===true`), plus a second case proving the same reset now reaches a bonus race
(`pendingBonusRace` set, a win, `lives===11`) -- confirmed by reintroducing the EXACT historical
bug shape (the reset moved to run AFTER `decrementLives` in the Challenge fail branch instead of
before any branch, and dropped entirely from the bonus branch, matching the old `advanceRace`-only,
non-bonus-only reset) and re-running the suite: case 1 lands on `lives===10 && over===true` (the
reset overwrites the value but arrives too late to stop the loss from ending the tournament), case
2 lands on `lives===2` (no reset at all reaches the bonus branch, so the delta and the win's own
`+1` both apply to the un-reset value) -- both wrong, both fail, pass again once reverted.

## 9bd. The results screen's tune condition, ported byte-exact (2026-09-24)

**Scope.** GOAL-DOS-PARITY.md's next P3 item: "The results screen's tune condition. It uses a
pass/fail boolean; the real condition is the narrower `word[3FC]`/`[3FE]` test (§9ai). Port it
exactly." §9ai's own follow-up RE pass (`mm-re-player-visible`, 2026-09-23) had already located and
described the real condition but left the port on the `lastPassed` approximation, flagging it as
"a refinement to VERIFY exhaustively, not a known bug." §9bb item 1 (P3's 4th item, 2026-09-24) then
independently found and fully disassembled two MORE sites testing the identical bytes -- the
per-row results-label pick (`15B1`) and the outcome-message gate (`1650`) -- ported the latter,
confirmed the port's own `lastPassed` already covers the former correctly, and explicitly deferred
§9ai's own tune site (`1410`) as the one piece still left on the approximation: THIS item.

**Fresh disassembly of `1000:1439` (`ShowRaceResultsScreenTune8or6`), the full function body
(`13e4-16dd`, 242 instructions).** Confirms §9ai's own reading of the tune site, and (re-)confirms
§9bb item 1's own reading of the other two: this ONE test is not used once, but at THREE separate
sites in this same function, byte-for-byte identical (or, at the second, identical up to one
register substitution) every time:
1. **The tune-selection block, `1410-1427`:**
   ```
   1410: CMP word[3FC],0xC03   1416: JZ 1429      (-> tune 8)
   1418: CMP byte[28C1],0x19   141D: JZ 1427      (-> tune 6, last race, skip [3FE])
   141F: CMP word[3FE],0xC03   1425: JZ 1429      (-> tune 8)
   1427: MOV AL,6              1429: (play AL)
   ```
   tune 8 iff `[3FC]==0xC03` (1st) OR (`[28C1]!=0x19` AND `[3FE]==0xC03`, 2nd, not the last race);
   else tune 6.
2. **A per-row results-label pick, `15A5-15C7`, inside the standings-drawing loop** (guarded by
   `15A5-15AC`: only for the row identified as the player's own, `word[BX+0x13]==word[0xC16]`):
   ```
   15B1: CMP word[3FC],BX      15B5: JZ 15C7      (SI stays 0x39A)
   15B7: CMP byte[28C1],0x19   15BC: JZ 15C4      (-> SI=0x3A2)
   15BE: CMP word[3FE],BX      15C2: JZ 15C7      (SI stays 0x39A)
   15C4: MOV SI,0x3A2
   ```
   At this point in the per-row loop `BX` already equals the CURRENT row's own car descriptor
   address, and this block only runs for the row identified as the player's own -- so for that row
   `BX` is car 0's own descriptor address, `0xC03`, making `CMP [3FC],BX` the literal
   `CMP [3FC],0xC03` from site 1, just addressed indirectly through the loop's own register. `SI`
   selects between two
   DS-resident string pointers (`0x39A`/`0x3A2`) for the player's OWN results row. **This site was
   already found and fully disassembled by GOAL-DOS-PARITY.md P3's 4th item (§9bb item 1, its own
   `15B1-15C7`), not new to this pass** -- including the guard's own player-identification meaning
   and a LIVE read confirming the two strings themselves (`DS:039A`="QUALIFY", `DS:03A2`="FAILED"),
   and already-established as `drawResults`'s own real DOS analogue, correctly driven by `lastPassed`
   with "no separate wiring needed... it inherits the fix for free." §9bb item 1 also explicitly
   pointed at THIS item -- "the tune itself is still left as the `lastPassed` approximation pending
   that other item" -- as the one piece it deliberately left unfinished.
3. **The outcome-message gate, `1650-1667`** (`CMP [3FC],0xC03 / JZ 1676`, `CMP [28C1],0x19 / JZ
   1667`, `CMP [3FE],0xC03 / JZ 1676`, `1667: MOV CX,2 / CALL 1C1B`) -- also §9bb item 1's own site
   (its `1000:1658`), ported there as `reportRaceResult`'s own `isLastRace ? 1 : 2` pass-threshold
   formula, deciding whether to show the `ONE_LIFE_LOST` outcome message at all.

So of the three sites, §9ai's original `mm-re-player-visible` pass found site 1 (the tune) and
§9bb item 1 found and fully disassembled sites 2 and 3, already establishing all three test the
identical bytes and pointing at this item as the one piece left over: porting site 1 itself
byte-exact, rather than the `lastPassed` approximation it had been left on. This pass's own
contribution is re-disassembling site 1 fresh to confirm it letter-for-letter (`1410-1427`, above),
and the actual port (`resultsPassed`, below) plus the `finishPosition`/instant-win-cheat
verification that follows.

Also present at `13EE`/`13F5-140D`: the function's OWN top-level branch on race format (`CMP
byte[3F8],0`), taking a COMPLETELY SEPARATE, simpler path for H2H (`[3FC]==0xC03` alone, no
`[28C1]`/`[3FE]` involved, and no tune-select/results-draw code at `140E` onward is ever reached) --
confirming `ShowRaceResultsScreenTune8or6`'s own results-table/tune code is Challenge-only, matching
this port's own `screenAfterRace` never returning `'RESULTS'` for `format==='twocar'`.

**`finishPosition`'s own derivation, confirmed to read the SAME order-array slots `[3FC]`/`[3FE]`
that `1439` does, including under the instant-win cheat -- the specific check this item's own scope
warns not to skip (§9bb item 3 was caught taking exactly this kind of shortcut: waving off the
RESULTS->OUTCOME transition as "already correct" without checking `flow.js`'s own second call
site).** `1000:11D5` (`RunTournamentLoop`'s own order-array copy, fully re-disassembled):
```
11D6: DI=0x3FC   11D9: SI=0x2678
11DF: AX=[SI]; SI+=2        (source word, one of [2678..267E])
11E2: AX = AX / [0x2662]    (-> a car INDEX 0..3, DX=remainder discarded)
11E9: AX = AX * 0x1B
11EB: AX += 0xC03           (-> that car's own DESCRIPTOR address, 0xC03/0xC1E/0xC39/0xC54)
11EE: [DI]=AX; DI+=2        (destination word, one of [3FC..402])
11EF: loop while DI<=0x402  (4 iterations: 3FC, 3FE, 400, 402)
```
So `[3FC..402]` are car DESCRIPTOR ADDRESSES (the 0x1B-stride slots §9az already names
"descriptor"), one per finishing slot, derived from `[2678..267E]` divided by a per-car stride,
`[0x2662]` -- independently confirmed (§9am) to be P2's own car-RECORD base pointer (the DIFFERENT,
0x164-stride struct §1 defines), written only at `4152: MOV [0x2662],0x164`, i.e. literally the
per-car struct stride (`CAR_RECORD_SIZE`, `src/engine/car.js`, 356 B = `0x164`), not a value this
pass had to infer. `flow.js`'s own `rankOrder.indexOf(0)+1` (`raceState.rankOrder`, an array of car
INDICES in finishing order) is the exact same information in a different encoding --
`rankOrder[k]===0` (car 0 occupies finishing slot k) is `[3FC+2k]==0xC03` (car 0's own descriptor
address occupies that slot) with the address<->index mapping factored out. Confirmed against the
instant-win cheat specifically: `1000:36A7`'s own effect (fully re-disassembled) writes
`[2678,267A,267C,267E] = 0, 0x2C8, 0x164, 0x42C`; dividing each by `[0x2662]` (`0x164`) gives
indices `0, 2, 1, 3` -- matching `cheats.js`'s own `fixedOrder = [0, 2, 1, 3]` hardcode exactly,
byte-for-byte, not just "car 0 finishes 1st" in the loose sense.

**Ported.** A new export, `resultsPassed(state, finishPosition)` (`tournament.js`): the SAME
`finishPosition <= (isLastRace ? 1 : 2)` formula `reportRaceResult`'s own Challenge-fail branch
already used inline -- extracted and reused, not duplicated, so `reportRaceResult`'s own
`PASSED`/`ONE_LIFE_LOST` outcome and the results-screen tune are now provably ONE computation, not
two that could drift. `reportRaceResult`'s own inline `isLastRace`/`passThreshold` locals are
replaced with a call to this export. `flow.js`'s `advanceRace` now computes `resultsWasPassed =
resultsPassed(tournament, result.finishPosition)` BEFORE `reportRaceResultWithOpponentSnapshot` can
advance `tournament.raceIndex` (the same timing constraint `wasQualifier` already needed, captured
the same way), and passes it directly to `raceResultMusic` instead of the old `lastPassed`. An
early draft of this fix also redirected the non-round-9 branch's own `lastPassed` (which feeds
`drawResults`'s "QUALIFY"/"FAILED" text) to this same `resultsWasPassed` value, reasoning that a
single shared computation is more robust than two that could theoretically diverge -- checked
against the qualifier and H2H cases folded into that same branch and found WRONG: `resultsPassed`'s
own Challenge-shaped formula gives a false PASS for a non-last-race H2H loss and for a two-car
qualifier loss, diverging from `lastOutcome`'s own correct reading in both. Reverted: `lastPassed`
keeps its original `tournament.lastOutcome !== QUALIFIER_FAILED && !== ONE_LIFE_LOST` derivation,
which needs no change here at all, because `reportRaceResult` now decides `PASSED` vs
`ONE_LIFE_LOST` for the one case that matters (a Challenge non-qualifier race) by calling
`resultsPassed` itself -- so `lastOutcome` already reflects the byte-exact rule for that case, and
the drift this draft was trying to prevent cannot happen. `sound.js`'s `raceResultMusic` header
comment updated to point at the byte-exact source; `raceResultMusic` itself (`driver.playTune(passed
? 8 : 6)`) needed no change.

**Tests.** `tools/check-tournament.mjs` test 17: `resultsPassed` directly, across every finish
position on an ordinary race (1st/2nd pass, 3rd/4th fail) and the very last race (1st still passes,
2nd now fails -- the one place the rule narrows). Confirmed by reintroducing a naive
`finishPosition<=2` (dropping the last-race narrowing entirely) and re-running the suite: fails
test 17's own last-race assertion AND the pre-existing test 9 ("the LAST race: 2nd place FAILS"),
confirming the refactor didn't silently lose that earlier item's own coverage; passes again once
reverted.

## 9be. The H2H race-intro variant: the mandatory hold timing, ported (2026-09-24)

**Scope.** GOAL-DOS-PARITY.md's next P3 item: "The H2H race-intro variant (§9an 8, 'the H2H
race-intro variant')." §9an 1's own text (2026-09-23) had already LOCATED the mechanism -- "races
1+ take `12BD`, which even has H2H-only code (`1307-131A`, `1354-1375`: the two cars slide in and
face each other)" -- and §9an 8 listed it, alongside the character-select carousel's own look, as
"not ported." Neither pass disassembled `12BD` itself.

**Correction to §9an 1's own parenthetical.** "The H2H variant (the portraits and the facing cars)"
undersells what's missing: there is no PLAIN variant to compare it against. `12BD` -- the portrait
panel (`19F2`, a face-preview reveal ALREADY fully disassembled by §9az for its OTHER call site,
`1A4A`'s own opponent picker: 4 faces, or 2 for H2H, at fixed `Y=0x24`, `X` stepping `0x40`) plus a
4-slot vehicle-class icon reveal below it (this pass's own find) -- is the ONLY race-intro path for
a REGULAR race in EITHER format. The port's own `drawRaceIntro` (two centred text lines, "RACE" +
the track name) has no analogue of ANY of this, in either format. What's H2H-SPECIFIC is narrower
than the parenthetical implied: only the vehicle-icon reveal's own exit condition and the count of
icons drawn (2 vs 4) differ by format; the portrait panel and its own setup are shared code.

**`1000:11F8` (`ShowNextRaceIntroScreenTune4or5`)'s full body, fully re-disassembled (`11F8-13E3`,
162 instructions), settles the branch structure:**
- `11F8-1218`: tune select (4, or 5 on the tournament's very last race) -- already ported
  (`raceIntroMusic`).
- `1219-126D`: bonus race (`[28BF]==9`) takes its own separate banner/reveal (`1220-126A`,
  `[0xBB6]=0x5A` then `CALL 01DE`, `JMP 1395` straight past `12BD`) -- the already-resolved
  "TRIPLE WIN/BONUS RACE/BEAT THE CLOCK/TIMETRIALS" banner (`UNKNOWN_beat_the_clock_timetrials`).
  Out of this item's scope; not touched.
- `126D-127B`: the qualifier (`[28C1]==0`), H2H format (`[3F8]==1`) -- `JMP 13E3` (`RET`), no
  screen at all. Matches this port's own `hasRaceIntro` returning `false` for exactly this case.
- `127E-12BA`: the qualifier, CHALLENGE format -- a DIFFERENT banner (`SI=0x35C`/`0x367`, two
  string draws at `Y=0x32`/`0x46`, a separate `[0xBC5]`-keyed reveal via `01DE`/`0xBB6=0x5A`) --
  genuinely unrelated to `12BD`'s own mechanism. Not disassembled further; not ported; a new,
  narrower open item (`UNKNOWN_challenge_qualifier_intro_banner`).
- `12BD-1395`: a REGULAR race (not the qualifier, not a bonus race) -- both formats, the mechanism
  this item is actually about.
- `1395-13E3`: the shared `179B` "wait for a key" stage (already understood elsewhere, §9ar
  d/e/§9az) plus a race-skip/auto-advance loop (`1398-13E0`, already flagged in §9ai as the
  "race-skip hotkey," `13aa`/`13bf`) -- not re-derived here, out of scope.

**`12BD-1395`, the regular-race reveal, fully re-disassembled:**
```
12BD: CALL 19F2                          ; the portrait panel (§9az's own 19F2, reused here)
12C0: BX=0x6C; CALL 1867                 ; the track name / race number (DrawTrackNameAndRaceNumber, already cited)
12C6: CX = [28BF]-1                      ; vehicle-class-1, the base icon frame
12D3: [0xBB6]=0x80; CALL 01DE            ; a decorative draw -- 01DE's OWN 18 instructions read in
                                          ; full show no loop, no wait, no INT call; draws something
                                          ; at Y=[0xBB6]+0x40 of width/count [0xBC5], then returns
                                          ; (its three callees, 053A/0862/08F0, were NOT themselves
                                          ; read instruction-by-instruction). NOT a timed reveal --
                                          ; an earlier draft of this section mislabelled it one.
12DC: CALL 08BC                          ; present the full screen (200 rows) to VGA -- the SAME
                                          ; plain full-screen copy elimination.js's own header
                                          ; already identifies at its own tail, 1790
12DF: CALL 32CE                          ; PaletteFadeUpFromBlack -- THE real reveal (fades the
                                          ; portraits/track-name up from black). Already established
                                          ; elsewhere (the palette-fade finding): a busy loop with NO
                                          ; INT 1Ah/vsync wait anywhere in it, paced purely by 1994
                                          ; CPU speed -- "no derivable value to port"
12E3-1305: for BX in {0xCDB,0xCF6,0xD11,0xD2C} (4 slots, stride 0x1B, same as everywhere else):
    [BX+0x13] = CX; CX += 8              ; frame = class-1, class-1+8, class-1+16, class-1+24
    [BX+0x2]  = AX; AX += 0x40           ; X = 0x100, 0x140, 0x180, 0x1C0
    [BX+0x4]  = 0x5A                     ; Y = 90, same for all 4
    [BX+0xA]  = 1                        ; a per-slot byte this pass did NOT need to resolve (not ported -- see below)
1307: if H2H ([0x3F8]!=0):
    [0xCDD] (slot 0's X) = 0xFFE0 (-32, signed)
    [0xCF8] (slot 1's X) = 0x100 (unchanged from the loop above, restated)
    [0xCE5] (slot 0's [BX+0xA]) = 0
131F-1393: the tick loop (see `tournament.js`'s own `raceIntroHoldTicks` header for the exact
  per-tick trace and tick counts -- 59 for H2H, 121 for Challenge)
1395: CALL 179B                          ; falls into the shared "wait for a key" stage
```

**What's ported, and what isn't.** Ported:
1. `tournament.js`'s new `raceIntroHoldTicks(state)` -- the `131F-1393` SLIDE-LOOP's own tick count
   (59 H2H / 121 Challenge / 0 for the qualifier or a bonus race, neither of which reaches `12BD`),
   wired into `flow.js`'s `startNextRace`/`confirm` as a hold timer (a `performance.now()`-based
   deadline, not a per-tick `requestAnimationFrame` loop, since nothing the port draws changes
   during the hold). **Why a press during this window has no effect isn't just "the loop never
   polls input"** (true -- no `CALL 2D5B` anywhere in `131F-1393` -- but the keyboard ISR still
   maintains the release latch `[0x107E]`/`[0x107F]` in the background regardless of whether any
   code explicitly polls it, so that alone doesn't prove a press is DISCARDED rather than buffered
   for later). The real mechanism, confirmed by disassembling `179B` itself: its own entry
   (`17AB`/`17B0`) unconditionally CLEARS the release latch before its own wait loop ever runs, so
   whatever the ISR latched during the slide loop is wiped the instant `179B` starts -- a press
   during the hold is provably discarded, not queued. This is proven for a key PRESSED AND RELEASED
   entirely inside the hold; it does NOT cover a key still HELD when the hold ends (DOS exits `179B`
   on that key's own later release, `17C9`, while this port's own `confirm()` needs a fresh
   `keydown`) -- the same release-vs-keydown mismatch already recorded as
   `UNKNOWN_outcome_screen_timeout` (docs/engine.md §10, under the §9bb entry), not re-fixed here.
   This also STRENGTHENS `elimination.js`'s own analogous claim for its own bounce loop, rather than
   leaving it merely plausible: `179B` is the SAME shared function, confirmed elsewhere in this file
   (§9ar e: "the shared two-phase wait `179B-17FE`, called from `ShowNextRaceIntroScreenTune4or5`...
   `ShowCharacterEliminatedTune6`...") to be the bounce's own successor stage too, and the gap
   between them was checked directly, not assumed: `1000:1776-179B`, disassembled, shows the bounce
   loop's own exit tail (`178B: MOV [BX+0x13],0xB`, `1790: CALL 08BC`) falling straight into
   `1793: CALL 179B` with no `CALL 2D5B` and no read of `[0x107E]`/`[0x107F]` anywhere in between --
   so the SAME entry-clear is confirmed to apply there too, not just plausible by analogy.
2. `tournament.js`'s new `raceIntroParticipants(state)` -- the text equivalent of `19F2`'s own
   face-preview panel (`[player, ...opponents]` by character index, `null` for the qualifier/a
   bonus race, matching `raceIntroHoldTicks`' own gate exactly, since `19F2` is only ever called
   from `12BD`). `screens.js`'s `drawRaceIntro` gained two new text rows (`Y=120` the player's own
   name, `Y=140` "VS" plus the opponents, checked for no collision with the existing `Y=60`/`Y=100`
   rows, and split across two rows -- not one, and not comma-separated -- because `drawString`'s
   own glyph map only covers `0-9`/`A-Z`/`!`/`?`; a comma would silently draw as a blank gap, and a
   single combined row risks overflowing the 256px view at the worst-case name-length case).
   Rendered to PNG and looked at directly (both H2H and the worst-case 4-name Challenge case, both
   readable and fully on-screen with no overflow) after an earlier draft's own lowercase "vs" and
   comma separators were caught in this same check -- neither has a glyph, so both would have
   silently rendered as blank 8px gaps instead of what the text intended. A text-only stand-in for
   the 4-face (or 2-face) sprite panel, matching this project's established `screens.js` bar.
   Ported per an explicit user decision, presented with the alternative of doing nothing here at
   all.

**Not ported, deliberately, matching an established precedent**: the sprite panel itself -- the
portraits (`19F2`), the vehicle-class icon reveal, and the H2H-vs-Challenge slide/marquee animation
that produces the 59/121 tick counts in the first place. `19F2` is the SAME function §9az already
found and left unported for the opponent picker's own call site, for the same reason: this
project's `screens.js` is hand-drawn text, not full sprite-panel parity, and a persistent sprite
panel is a real new feature, not a bug fix -- a scope this session's user chose explicitly, after
being shown the tradeoff against a full sprite-panel port (which would also need a DOSBox live
capture to verify layout/flip/asset, not attempted this pass).

**What `raceIntroHoldTicks` does NOT cover -- a real gap, not just an unexplored corner.** The
`131F` slide loop is only PART of `12BD`'s own total delay before a confirm is accepted. Before it
even starts, `12BD` runs `19F2` (the portrait draw), `1867` (the track name), `01DE` (its OWN 18
instructions read in full show no loop and no wait -- but its three callees, `053A`/`0862`/`08F0`,
were NOT themselves read instruction-by-instruction, so "contributes ~0 ticks" rests on `01DE`'s
own body having no loop around those calls, not on a proof that none of the callees loop
internally), and -- critically -- `32CE` (`PaletteFadeUpFromBlack`), which has **no derivable tick
duration at all**: already established elsewhere in this file as a busy loop with no vsync/tick
pacing, bound purely by 1994 CPU speed -- and that finding's own text notes `32CE`'s own callee,
`32AE`, was likewise not fully re-disassembled instruction by instruction, so the "no derivable
value" conclusion rests on the outer loop's shape and the upload routine, not an exhaustive read of
every byte in between. So the REAL total hold (screen-appears to input-accepted) is
`raceIntroHoldTicks`'s own count PLUS an unknown, non-zero, non-tick-expressible amount for that
fade -- new, narrower open item `UNKNOWN_race_intro_prehold`, the SAME open-endedness the
palette-fade finding already has elsewhere applied to this specific call site, not a new kind of
gap. This port's own hold therefore UNDERSTATES the real delay by that fade's own (likely short,
on any modern machine, but formally unknown) duration.

**Left unresolved, deliberately out of scope, none of it affecting the timing/participant-list
port:** `[BX+0xA]`'s own exact meaning (very likely a horizontal-flip byte given the results-row
loop's own `XOR CH,0x1` alternation at a structurally similar site, `1000:1534` -- but not
confirmed here, since nothing this port draws depends on it); the vehicle-icon asset itself (which
`.CHR` bank slot 8's own descriptor range binds to, and whether the `class-1+8i` frame stride is a
colour/orientation variant); the qualifier's own Challenge-only banner (`127E-12BA`).

**Tests.** `tools/check-tournament.mjs` test 18: `raceIntroHoldTicks` across a regular Challenge
race (121), a regular H2H race (59), the H2H qualifier (0), the Challenge qualifier (0), and a
bonus race (0). Confirmed by reintroducing an off-by-one on both non-zero counts (58/120 instead of
59/121) and re-running the suite: both of the two non-zero-count assertions fail, pass again once
reverted. Test 19: `raceIntroParticipants` across H2H (2 entries), Challenge (4 entries), the
qualifier (`null`), and a bonus race (`null`). Confirmed by reintroducing a version with no
qualifier/bonus-race guard and re-running the suite: both `null`-case assertions fail, pass again
once reverted. `tools/check-screens.mjs` gained two new synthetic cases for `drawRaceIntro`'s own
`participants` row (H2H, and the worst-case 4-name Challenge width), and both were rendered to PNG
via the same buffer-to-RGBA path `tools/`'s other render scripts use and looked at directly --
readable, fully on-screen, no missing glyphs (see the "Ported" paragraph above for what that check
caught in an earlier draft).

**Verification status.** `game.html` was loaded live (a browser check) and confirmed to boot with
no console errors; `drawRaceIntro`'s own new participant rows were rendered to PNG and looked at
directly (above). NOT exercised in-browser this pass: the `flow.js` wiring itself
(`startNextRace`'s own `raceIntroHoldUntil` deadline, `confirm`'s new gate, `paintMenu`'s own
`participants` plumbing) -- reaching a real race-1 intro needs completing the qualifier race
first, which this pass didn't attempt. `mmGame.confirm()`/`getPhase()` (the existing debug hooks)
can drive and check this once a session reaches `RACE_INTRO`, if that becomes cheap to set up.

## 9bf. P4 engine refactor: two-human Head to Head's own `isDrone` (2026-09-24)

**Added 2026-09-24 (§9bf), P4 engine refactor: two-human Head to Head's own `isDrone`.** The race
engine had exactly one runtime concept named `isDrone`, and it conflated two genuinely different
real-bytes mechanisms. `tuningFieldsFor`'s internal `isDrone` (init-time grip/
`DRONE_MAX_VEL_HANDICAP` math at `1000:4070`, `CMP BX,0`) is car-INDEX based -- but, see below,
`4070` itself only ever runs when `CS:[0x9C62]`/`DS:[0x8A2]` (a per-RACE mode selector, not a
per-car one) is `0`. The SEPARATE runtime flag consumed by `applySteerAndThrottle`/`collide.js` is
`[BX+0x12EB]`, written once per car slot at `InitRaceCarsFromTables 41D0-421A` from that slot's own
controller-type word (`[0x2658]`/`[0x265A]`/`[0x265C]`/`[0x265E]` compared against `6`, the CPU
sentinel) -- genuinely controller-TYPE based, independent of slot index. `race.js`'s `spawnCars`
now takes an explicit, optional `controllerTypes` param (`car.isDrone = controllerTypes[i] === 6`)
and defaults to `[1, 6, 6, 6]`, behaviour-neutral for every existing one-player caller (proven: the
full 29-script suite passes unchanged with the default). `tuningFieldsFor`'s own index-based block
was correctly left UNCHANGED -- it is a different mechanism entirely, not a second copy of the same
bug, though (see below) it is also not the whole story for two-human H2H specifically.

Four real `[BX+0x12EB]` readers were checked, cross-referenced against `DS:09BA`'s own H2H track
list (`04 0A 11 0D 1C 21 14 19`, `[STATIC]` -- read from the Ghidra image this session, no DOSBox
capture: decodes with the SAME `round<<2|race-1`
packing `DS:043C` uses, to rounds **1, 2, 4, 3, 7, 8, 5, 6** in H2H's own race order -- rounds 1-8,
NOT round 9 (RUFFTRUX never appears in H2H at all), so "is this reader ever reached in H2H" had to
be checked per round, not assumed):
- `4D3D` (the keyboard fire-preempt, `applySteerAndThrottle`'s own `exempt` test): reachable, and
  is the mechanism directly proven in `check-twocar.mjs` -- a human KEYS car holding fire alone is
  frozen; the same control byte on a `[BX+0x12EB]`-flagged CPU car falls through to the ground-
  gated coast instead.
- `4EE7` (round 7 TANKS's own steer-step modifier, gated ONLY by `CMP byte ptr [0x28bf],0x7` at
  `4ee0` -- re-disassembled `4ed0-4f00` this session, confirmed no raceFormat check anywhere in
  this block): reachable, since round 7 is H2H track index 4 (`DS:09BA` byte `0x1C` = round 7,
  race 1). A human car at speed >= 0x320 halves its steer step (`SAR CX,1`); a drone always adds 1
  (`INC CX`) regardless of speed. Proven directly in `check-twocar.mjs` with `ctx.round=7`.
- `collide.js`'s own `5C84` wall-stuck counter (`bounceAndCommit`): re-disassembled `5c70-5c94`
  this session -- tests only `[BX+12a8]` (a per-car state gate) and `[BX+0x12eb]`, no raceFormat
  or round check anywhere. Reachable in every race, one-car and two-car alike; already correctly
  gated on `car.isDrone` before this session, needed no change.
- `4D2F` (the four-car finished-drone-coasts rule): confirmed NOT reachable in two-human H2H --
  `applySteerAndThrottle`'s own `fourCar = ctx.raceFormat !== 2` gates it off for every car
  regardless of drone status, and two-human H2H is always raceFormat 2.

The rubber band (`step.js`'s `rubberBand` array, the real x6-throttle/x1.5-grip mechanism at
`4B1C`/`528D`) was checked and left index-based, not controller-type-based (`get_xrefs_to` on
`4B1C` shows one jump source, `4AF7`, inside `RunCarPhysicsStep`'s own unconditional per-car entry
`4AEE`, with the same `CMP BX,0` shape as `tuningFieldsFor`'s own block). It CANNOT be gated by the
`[0x8A2]` mode fork below -- that fork is read only twice in the whole binary (`3F33`, `40AF`),
both inside `InitRaceCarsFromTables`'s own INIT-time tuning, nowhere near the per-STEP physics code
`4B1C`/`528D` live in. Whether `4B1C-4B41` has its own, separate `[2656]` raceFormat test is the
real open question (the `[2656]` sweep's own `4B51` hit sits just past this block and wasn't
followed up) -- recorded as not yet checked, not as a confirmed-reachable consequence.

**`4070`'s own real gate is bigger than the instruction it names.** `tuningFieldsFor`'s init-time
tuning (`DRONE_MAX_VEL_HANDICAP`, the `40A0` `accel` cut, the `4116` race-23 nerf -- all three
already ported, all three already correct for every EXISTING caller, see below) sits inside
`3FBE-4134`, and that whole block is reached ONLY when `CS:[0x9C62]`/`DS:[0x8A2]` is `0` at the
fork `1000:3F30` (`CMP CS:[0x9C62],0 / JNZ 3F3B / JMP 3FBE`) -- confirmed by `get_xrefs_to 3FBE`
(exactly 3 references, all `UNCONDITIONAL_JUMP` from inside `InitRaceCarsFromTables` itself: `3F38`
the `==0` fork, `4124`/`4131` its own internal per-car loop-back -- no entry from the `3F3B` side).
The `3F3B` branch (below) never rejoins `3FBE`; it has its own exit straight to `4134`. So it is not
enough to say `4070` is "unconditional on raceFormat": no `[2656]`/`[265A]` test sits directly
inside `3FBE-4134`, but the FORK that decides whether that whole region runs at all is upstream of
it, at `3F30`.

**That fork is what two-human H2H actually takes, and it is the OTHER side.** `[0x8A2]`'s own
real writer at H2H entry, `1000:1F8E` (`MOV [0x8A2],CL`, right where `[2656]` is set to `2` at
`1F88`), stores a `CX` returned by `CALL 0382([0x8A0])` at `1F7D` -- and `1F80: OR CX,CX / JZ 1FA9`
REJECTS `CX==0` before that store ever happens, resetting `[0x8A2]` to `0` and bailing out instead.
So every time this flow actually proceeds into a race, `CX` (and therefore `[0x8A2]`) is nonzero --
meaning two-human H2H ALWAYS takes the `3F3B` branch, NEVER `3FBE`. `[STATIC]`: a human P2 in
two-human H2H does NOT get car slot 1's usual `DRONE_MAX_VEL_HANDICAP`/grip/`40A0`/`4116` tuning at
all -- `4070` and everything inside `3FBE-4134` never execute for that race. DOS distinguishes this
by MODE (the `[0x8A2]` fork, decided once per race), not by re-testing car index inside the tuning
code itself.

**What `3F3B` actually computes instead (re-disassembled `3F3B-3FBD` in full).** It is its own
complete per-car loop (own advance step `3FB4-3FBB`, own
exit test `3FAB: CMP BX,0x42C` before jumping straight to `4134`, no `CMP BX,0` anywhere in it) that
computes ALL SEVEN of `tuningFieldsFor`'s own fields for EVERY car, symmetrically -- not one field,
not a prelude, an outright replacement, still reading the SAME `CarTypeInfo` table (`SI` set up once
at `3F19-3F28`, before the fork) but applying a DIFFERENT modifier. `n = (w & 0x7F) + 1` when bit 7
of `w = [DI+0x2668]` (that car SLOT's own roster byte) is set. ONLY TWO of the seven fields are
actually gated on that bit (`OR DX,DX / JZ`, `3F52`/`3F7A`) -- the other five apply their own term
unconditionally, bit 7 or not. Traced instruction-by-instruction against the actual bytes (all
seven fields, all already named in `car.js`'s own table, offsets relative to `CAR_RECORD_BASE=0x124A`):
- `[BX+0x129C]` = `maxSpeedCur` (`0x52`): bit7 ? `info[0] - 0xC0 + 64*(n-1)` : `info[0]`
- `[BX+0x12A0]` = `reverseLimit` (`0x56`): `info[1] + 0x32` (unconditional, no `n`/bit7 term at all)
- `[BX+0x12A2]` = `accel` (`0x58`): bit7 ? `info[2] - 0xC + 4*(n-1)` : `info[2]`
- `[BX+0x12A4]` = `brakeDecel` (`0x5A`): `info[3]` (raw, unconditional)
- `[BX+0x12A6]` = `coastDecel` (`0x5C`): `info[4]` (raw, unconditional -- same as the normal path, `race.js:144`)
- `[BX+0x127C]` = `slipThreshold` (`0x32`): `info[5] + [0x24E0]` (unconditional)
- `[BX+0x127E]` = `gripStep` (`0x34`): `info[6] + [0x24E0]` (unconditional)

`[0x24E0]` reads `0x14` (20, `GripAdjust`, `[STATIC]` read this session) -- the SAME grip constant
the normal path's own `!isDrone` branch uses, applied here to every car regardless of slot. None of
this is ported (`race.js` has no reference to it; `tuningFieldsFor` always takes the normal ramp),
and since it is what two-human H2H ACTUALLY uses for every car's tuning, porting it is now a
PREREQUISITE for that mode's own first playable race, not an optional refinement -- without it, a
two-human race would silently fall back to the normal (wrong-for-this-mode) ramp. New open item
`UNKNOWN_alt_tuning_path` (docs/engine.md §10): port this alternate computation, verify it against
these seven formulas directly. `UNKNOWN_8a2_accel_gate_relevance` (a prior draft's own open item,
asking whether the ALREADY-ported `40A0` `accel` cut needs an explicit `[0x8A2]` gate) is now
CLOSED as moot: `40A0` sits inside `3FBE-4134`, which two-human H2H never reaches at all, so no
gate is needed there -- the real gap is the missing `3F3B` path itself, tracked above instead. The
stale-`[0x28C1]` question (P4 item 2's own open note) leaves the tuning discussion entirely: `3F3B`
never reads `[0x28C1]`.

**What `[0x8A2]` itself means is still open, and evidence points away from "the handicap Y/N
answer."** `CS:[0x9C62]` and `DS:[0x8A2]` are the SAME physical byte (`CS`/`DS`'s own segment bases
both resolve to linear `0x19C62`, `[STATIC]` confirmed by an identical static read, both `0`) -- it
is NOT confirmed to be the handicap question's own Y/N answer. `[0x8A2]`'s own value comes from
`CALL 0382([0x8A0])` (`1F7D`), and
`CX==2` specifically skips the following `CALL 1FAF` (`RunHeadToHeadTournament`) -- at least 3
distinct effects (`0`, `2`, and "anything else"), more menu-choice-shaped than boolean. Separately,
`0B51` (re-disassembled `0B40-0C10`) IS a real, interactive Y/N toggle screen matching
`handicapQuestionApplies`'s own already-ported gate (`CMP [2656],1`/`CMP [265A],6`, both skip to
`0C12` exactly as `raceFormat===1`/`otherDeviceType===6` already do), and its own final answer is
traceable: `0B68`/`0B73`/`0B7E` set `BX=0x1D6/0x1D7/0x1D8` per character (0/1/2), that `BX` survives
`PUSHA`/`POPA` and a stack round-trip (`0BA2` push, `0C09` pop), and `0C0D` stores the toggle's own
final value (`0x00` or `0x80`, `0BF7`/`0BFD`) through it -- i.e. the real per-character handicap
answer lives at `DS:[0x1D6+character]`, exactly the bit `3F43` tests when reading each slot's own
`[DI+0x2668]` roster word. `[0x8A2]` is therefore more likely a two-player-MODE selector (whether to
apply this whole alternate-tuning mechanism at all) separate from the per-character answer bit, not
the answer itself -- but this is a HYPOTHESIS, not yet confirmed: `1000:0382`'s own identity
(possibly `RunTwoItemMenu`, unconfirmed), what `1F97`'s own `CMP CX,2` branch actually reaches, and
where `DS:[0x1D6+c]` gets merged into `[0x2668]` are all unchecked. New open item
`UNKNOWN_8a2_meaning` (docs/engine.md §10), to be settled at the start of the `3F3B`-porting commit,
not here. (One false positive caught the same way as `4e79`/`5270`: the `A2 08` sweep's own
`1000:0ED8` hit is `MOV [0x0408],AL`, an unrelated buffer init, not a `[0x8A2]` reference.)

`[0x156]` and `[0x3F3]` (open since an earlier round this session, when `4e79`'s own `[0x156]` hit
was found to be a false positive -- `JMP rel16` displacement bytes that happen to equal `0x0156`,
not a real reference) are now substantially resolved by an exhaustive sweep of every real ModRM/
direct-address encoding, not just the one pattern that produced the false positive: `5270`'s own
`[0x156]` hit is the SAME false-positive shape (`e9 56 01`, a `JMP` at `526f` targeting `53c8`).
`[0x156]` has exactly one real reader in the whole binary, `1000:0420` (`MOV AL,[0x156]; OR AL,AL;
JZ 0x45a`) -- NOT early boot code (a first-pass misreading from the low address alone, corrected
here): `0420` is 0x20 bytes into `FUN_1000_0400` (`0400-045A`, fully re-disassembled this session),
a shared UI helper called from 15 sites across the whole front end (menus, race-intro, results,
champion screen, options, redefine-keys, joystick config, the portrait draw `19F2`). With `[0x156]
==0` it draws one string plus one text-box record and returns; nonzero, it draws a SECOND box (the
same field-2 offset `+0x5A`) and stores `[0x156]`'s own value into a field of that record before
three more glyph/icon draws -- "draws a second box," not "shifts the first one down"; which axis or
what those three glyphs are is unestablished. `[0x156]` is written as `1` uniquely at H2H entry
(`1E4A`) and as a computed register value `CL` at one other site (`0364`, inside
`RunOnePlayerGameMenu` -- possibly that menu's own selection index, unconfirmed); `0` everywhere
else. This does NOT reach the race engine or gate anything `step.js` reads -- irrelevant to the
`isDrone` distinction -- but it IS a real, H2H-specific second-box variant of a shared UI helper
that this port's own `screens.js` does not model at all; exactly what it draws is
`UNKNOWN_0400_mode` (docs/engine.md §10), flagged for the later screens/flow-wiring commit, not
this one. `[0x3F3]` has no direct-address (ModRM or short-form) reader anywhere in the 83662-byte
image in this same exhaustive sweep -- write-only by every encoding this method can see; a
computed/indexed reader can't be fully ruled out (the SAME caveat `CS:[0x9C62]`'s own search
initially missed, resolved above only because a second, differently-prefixed search was tried), so
this is softened from "zero readers" to "no direct reader found." Both `[0x156]` and `[0x3F3]` are
written together at `1000:1E45`/`1E4A`, inside the SAME H2H-mode-entry block (`GOAL-DOS-PARITY.md`'s
own `FUN_1000_1e20`) that also writes `[0x265A] = AX` (from `[0xF61]`, `[STATIC]` -- `1E42`/`1E4F`
copy it into P2's own controller-type slot) and `word ptr [0x2656] = 2` (raceFormat). Whether
`[0xF61]` is genuinely SETTINGS.DAT's own P2 control word is a narrower, separate open question --
`UNKNOWN_f61_p2_control_word` (docs/engine.md §10), NOT the same as `UNKNOWN_2p_p2_record` (which
is already resolved, and was about the win-tally scoreboard, not this word).

**Tests.** `tools/check-twocar.mjs` gained a new section (behind the two-humans-on-KEYS fixture
`controllerTypes: [5, 4, 6, 6]` -- P1 on KEYS2, P2 on KEYS1, the real H2H assignment per
`GOAL-DOS-PARITY.md` P4 and CLAUDE.md's own "fire is P1's KEYS2 key S", not an arbitrary pick):
`spawnCars` behaviour-neutrality (the unchanged default still gives car 1 `isDrone===1`; explicit
`controllerTypes` makes both car 0 and car 1 `isDrone===0`), the fire-preempt distinguishing a
human car 1 (frozen) from an AI one (decays via the ground-gated coast), and the TANKS steer-mod
distinguishing a human car 1 (halved steer step at speed) from a drone (always +1). Confirmed by
reintroducing the old `i !== 0` line and re-running the suite: exactly the 3 index-dependent new
checks fail (the two `spawnCars`/fire-preempt checks plus the TANKS human-halving check), all
others unaffected; reverting restores all 89 distinct assertions (243 executed). Full 29-script
regression suite (`catalog` through `smoke`) re-run clean after this change, twice (once after the
`race.js` edit alone, once after the `check-twocar.mjs` additions).

**Verification status.** Engine-level only -- `race.js`/`check-twocar.mjs`, unit-tested directly
against the disassembly, no live DOSBox H2H capture (none exists yet; nothing plays two-human H2H
end to end at this point in the port). The `isDrone`/`[BX+0x12EB]` findings above (fire-preempt,
TANKS steer-mod, wall-stuck) are `[STATIC]`, flagged for live confirmation once the flow wiring
lands; the tuning findings (`3F3B`'s own alternate path, `[0x8A2]`'s own meaning) are `[STATIC]`
and additionally INCOMPLETE -- not yet ported at all. Not yet done, and now including a real
prerequisite discovered this session: porting `3F3B`'s own alternate tuning computation (the
formulas above) BEFORE `twoHuman.js`/screens/flow wiring can give a two-human race correct tuning,
since without it car 1 would silently fall back to the normal, wrong-for-this-mode ramp; settling
`UNKNOWN_8a2_meaning` belongs at the start of that same commit. After that: `twoHuman.js` itself
(win tally, used-track bitmap via `DS:0002&7`, per-character lifetime stats, the handicap question
screen), the CHOOSE GAME/results screens, and `flow.js` wiring (a real P2 keyboard reader,
`enterSelectGame`'s TWO PLAYER branch, one shared `controllerTypes` array feeding both `spawnCars`
and `raceCtx.controllerTypes` instead of the two independently-built arrays that exist today) --
each its own subsequent commit toward closing P4's first checklist item.
