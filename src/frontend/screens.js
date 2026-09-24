// Render functions for the M3.9 spine screens (docs/engine.md §7, docs/engine.md §9k for what's
// simplified and why). Each function takes the shared 256x200 buffer, the CHR arena, and whatever
// state it needs, and draws -- no input handling and no game logic here (that's `flow.js`).
//
// None of these attempt the original's exact sprite placement pixel-for-pixel (no live capture of
// any of these screens was taken this session, docs/engine.md §9k) -- they use the same CHR
// members and the same text substrate (`menuView.js`) the real screens use, laid out by hand to be
// legible and centred, not measured against a DOSBox frame. The title screen (the one screen most
// likely to get a future live pixel-diff, per PLAN-ENGINE.md's own note) keeps LOGO and the
// INTRO.CHR showcase frame at plausible, centred positions for exactly that reason.
import { CHR_TABLE, caseImage } from '../formats/chr.js'
import { drawString, drawStringCentred, blitChr, MENU_VIEW } from '../render/menuView.js'
import { blitTransparent } from '../render/blit.js'
import { CHARACTER_NAMES, CHARACTER_SKILLS, trackName, OPTIONS_MENU_LINES, OPTIONS_FOOTER, OPTIONS_TITLE, SMOOTHNESS_LABELS, SOUND_LABELS, CREDITS_LINES, REDEFINE_GROUP_LABELS, REDEFINE_SLOT_LABELS, REDEFINE_DISPLAY_CHAR, REDEFINE_DISPLAY_CHAR_DEFAULT, TITLE_COPYRIGHT, TITLE_CLASS_NAMES, SELECT_GAME_TITLE, ONE_PLAYER_LABEL, TWO_PLAYER_LABEL, GAME_LABEL, ONE_PLAYER_ITEM_LABELS, ORDER_TABLE, BOARD_ICON_POSITIONS } from '../data/frontend-tables.js'
import { CONTROL_NAME } from '../formats/globaldata.js'

function rec(name) {
  return CHR_TABLE.find((r) => r.name === name)
}

// P2's first item (GOAL-DOS-PARITY.md, src/frontend/attract.js): RunTitleScreenAttractLoop
// 1000:0100. LOGO (slot1) + the copyright line (16px font, y=0xB7=183, DS:0010) are drawn once;
// INTRO.CHR's own showcase frame (slot2) is fixed at x=0x50=80,y=100 (its own descriptor's static
// fields, re-read live -- NOT centred by width like the port's own earlier placeholder was), the
// class name centred in 8px font at y=164 (100+0x40, `FUN_1000_01de`'s own BX=[0xbb6]+0x40). There
// is no "PRESS FIRE" string anywhere in this function's own disassembly -- the port's earlier
// placeholder text is dropped.
export function drawTitleScreen(buf, arena, { classIndex = 0 } = {}) {
  const logo = rec('LOGO.CHR')
  blitChr(buf, arena, logo, 0, (MENU_VIEW.w - logo.width) >> 1, 20)
  drawStringCentred(buf, arena, rec('FONT2.CHR'), TITLE_COPYRIGHT, 0xb7)
  const intro = rec('INTRO.CHR')
  blitChr(buf, arena, intro, classIndex % intro.frames, 0x50, 100)
  drawStringCentred(buf, arena, rec('FONT1.CHR'), TITLE_CLASS_NAMES[classIndex % TITLE_CLASS_NAMES.length], 164)
}

// P2's second item: RunMainMenuKeepTitleTune 1000:0220 (SELECT GAME) and RunOnePlayerGameMenu
// 1000:02e0 (ONE PLAYER GAME), sharing the two-item menu helper `RunTwoItemMenu 1000:0382`
// (src/frontend/frontMenu.js). Real string content re-read live 193C:0130-0156 and confirmed
// against a DOSBox screenshot of each screen (frontend-tables.js's own header comment); the
// THUMB.CHR highlight sprite (slot9) itself and the SELGAM/WORDS decorative icons are not ported
// pixel-for-pixel (not measured, like every other screen in this file) -- `selection` draws a
// plain marker next to whichever item is currently picked instead, matching the existing
// character-select convention below. `selection` is 0 (nothing picked -- the marker is omitted),
// 1 (LEFT) or 2 (RIGHT), `frontMenu.js`'s own convention.
export function drawSelectGame(buf, arena, { selection = 0 } = {}) {
  const logo = rec('LOGO.CHR')
  blitChr(buf, arena, logo, 0, (MENU_VIEW.w - logo.width) >> 1, 10)
  drawStringCentred(buf, arena, rec('FONT2.CHR'), SELECT_GAME_TITLE, 0x5e)
  const items = [ONE_PLAYER_LABEL, TWO_PLAYER_LABEL]
  const xs = [0x18, 0x9c]
  items.forEach((label, i) => {
    drawString(buf, arena, rec('FONT1.CHR'), (selection === i + 1 ? 'X ' : '  ') + label, xs[i], 0x6f)
  })
}

// RunOnePlayerGameMenu 1000:02e0: "ONE PLAYER"/"GAME" (two stacked header lines, both substrings
// of the SAME DS:0134 "SELECT GAME" string -- frontend-tables.js's own header comment), then the
// two items Left=Head to Head(0fbf)/Right=Challenge(102b), "SELECT GAME" again as a footer.
export function drawOnePlayerGameMenu(buf, arena, { selection = 0 } = {}) {
  drawString(buf, arena, rec('FONT2.CHR'), ONE_PLAYER_LABEL, 0x58, 0x32)
  drawString(buf, arena, rec('FONT2.CHR'), GAME_LABEL, 0x70, 0x44)
  const xs = [0x18, 0x9c]
  ONE_PLAYER_ITEM_LABELS.forEach((label, i) => {
    drawString(buf, arena, rec('FONT1.CHR'), (selection === i + 1 ? 'X ' : '  ') + label, xs[i], 0x99 + i * 0x0b)
  })
  drawStringCentred(buf, arena, rec('FONT2.CHR'), SELECT_GAME_TITLE, 0xb6)
}

// P2's third item: RunCharacterSelectMenuTune2 1000:09e0, the real scrolling FCNORMAL.CHR
// carousel (src/frontend/charSelect.js). `scroll`: the carousel's own raw position (0..0x2C0),
// `roster`: tournament.js's roster array (raw byte values -- 0-10 free, |0x40 taken). Each of the
// 11 faces' own screen X is `pos - 0xD8` (1000:0d1f), cyclic from `scroll`; `blitChr` clips
// off-screen ones automatically, so all 11 are drawn unconditionally, matching the original's own
// clip-in-the-blitter approach rather than pre-filtering. FCNORMAL's own frame semantics
// (`FUN_1000_0db0`, re-disassembled for this item): frame = the roster byte itself (0-10, the
// character's own portrait) once its `0x40` (taken) bit is stripped to frame 13, matching the
// real function's own `uVar3=0xd` branch -- there is no separate `taken` list parameter needed,
// the roster array already encodes it. `blinkOn`: the picked face flashes between its own
// portrait and the "taken" pose (frame 13) during the 5-blink commit sequence -- a simplified
// stand-in for `0db0`'s own more intricate bit-toggled blink frame math, not pixel-ported (this
// file's own usual caveat). `prompt`: 'WHO DO YOU WANT TO BE ?' (DS:020F) for the player's own
// pick, 'WHO DO YOU WANT TO RACE ?' (DS:0227) for the Head-to-Head CPU opponent.
const CAROUSEL_FACE_Y = 90
function faceFrame(rosterByte) {
  if (rosterByte & 0x40) return 13 // taken
  return rosterByte & 0x1f // the plain 0-10 portrait once the flag bits are stripped
}
export function drawCharacterSelect(buf, arena, { scroll = 0, cursor = 0, roster = CHARACTER_NAMES.map((_, i) => i), blinkOn = false, prompt = 'WHO DO YOU WANT TO BE ?' } = {}) {
  drawStringCentred(buf, arena, rec('FONT2.CHR'), prompt, 8)
  const face = rec('FCNORMAL.CHR')
  let pos = scroll
  for (let i = 0; i < roster.length; i++) {
    const centred = pos === 0x140
    const frame = centred && blinkOn ? 13 : faceFrame(roster[i])
    blitChr(buf, arena, face, frame, pos - 0xd8, CAROUSEL_FACE_Y)
    pos += 64
    if (pos > 0x2bf) pos -= 0x2c0
  }
  if (cursor <= 10) {
    drawStringCentred(buf, arena, rec('FONT1.CHR'), `${CHARACTER_NAMES[cursor]} ${CHARACTER_SKILLS[cursor]}`, CAROUSEL_FACE_Y + face.height + 8)
  }
}

/** 0C15's "PRESS ANY KEY TO START" (DS:0241), between the select screens and the first race. */
export function drawPressAnyKey(buf, arena) {
  drawStringCentred(buf, arena, rec('FONT2.CHR'), 'PRESS ANY KEY TO START', 96)
}

export function drawRaceIntro(buf, arena, { round, race }) {
  drawStringCentred(buf, arena, rec('FONT2.CHR'), 'RACE', 60)
  const name = trackName(round, race)
  drawStringCentred(buf, arena, rec('FONT1.CHR'), name || `ROUND ${round} RACE ${race}`, 100)
}

export function drawResults(buf, arena, { standings, passed }) {
  drawStringCentred(buf, arena, rec('FONT2.CHR'), 'RESULTS!', 20)
  standings.forEach(({ name, position }, i) => {
    drawString(buf, arena, rec('FONT1.CHR'), `${position}. ${name ?? '???'}`, 60, 60 + i * 16)
  })
  drawStringCentred(buf, arena, rec('FONT2.CHR'), passed ? 'QUALIFY' : 'FAILED', 160)
}

export function drawOutcome(buf, arena, { message }) {
  drawStringCentred(buf, arena, rec('FONT2.CHR'), message, 96)
  drawStringCentred(buf, arena, rec('FONT1.CHR'), 'PRESS FIRE TO CONTINUE', 140)
}

export function drawChampion(buf, arena, { playerName }) {
  const cup = rec('CUP.CHR')
  blitChr(buf, arena, cup, 0, (MENU_VIEW.w - cup.width) >> 1, 40)
  drawStringCentred(buf, arena, rec('FONT2.CHR'), 'CHAMPIONSHIP WINNER!!', 90)
  drawStringCentred(buf, arena, rec('FONT1.CHR'), playerName, 120)
}

/** P3's first item: DrawTournamentBoard 1000:18d8 (docs/engine.md §9ay, src/frontend/board.js).
 * `raceIndex`: `tournament.js`'s own `boardRaceIndex(state)` -- NOT `state.raceIndex` directly, see
 * its own header for why a pending bonus race needs `-1`. One MINATURE.CHR icon is drawn per entry
 * in `ORDER_TABLE[1..raceIndex]` (the qualifier, entry 0, never gets one -- `FUN_1000_198e`'s own
 * pre-increment); for a REGULAR race `raceIndex` is the one about to run, so the newest icon is a
 * PREVIEW of what's coming up next, not a trophy for the last one -- `board.js`'s own header has
 * the full account, including the one case (a pending bonus race) where it genuinely is the
 * just-completed race instead. `blinkOn`: whether that newest icon is currently visible --
 * `board.js`'s own blink state. `FUN_1000_0400` (the shared header every front-end screen but
 * SELECT GAME/TITLE/CHAR_SELECT calls) also draws BADGE.CHR (slot 0, opaque, at its own permanently
 * unwritten (0,0) default -- confirmed by reading the live descriptor bytes, all zero past the
 * `.CHR` pointer) before WORDS.CHR; BADGE is not ported here, matching every OTHER 0400-calling
 * screen in this file (none of which draw it either -- a pre-existing simplification this item's
 * own research surfaced, not unique to the board, deliberately not retrofitted across 8+ screens in
 * this commit). The divider bar `FillRowsFrontView` draws is ALSO gated on `[0x156]` (not just the
 * second WORDS frame, as an earlier draft of this comment wrongly said) -- `[0x156]` is provably 0
 * whenever `18d8` runs (its only writer sits in `FUN_1000_1E20`, two-human Head to Head's own entry
 * point, a code path that never calls `RunTournamentLoop`/`115c`/`18d8` at all, under any format),
 * so the board never draws a divider; this file draws none either. The case background position
 * (`BOARD_CASE_Y`) is hand-placed like every other screen in this file, not measured against a
 * DOSBox frame -- the icons themselves, and WORDS' own real (0x48, 8) position, use the real bytes. */
const BOARD_CASE_Y = 24
export function drawTournamentBoard(buf, arena, { raceIndex, blinkOn = true } = {}) {
  blitChr(buf, arena, rec('WORDS.CHR'), 0, 0x48, 8)
  blitTransparent(buf, MENU_VIEW.w, MENU_VIEW.h, 0, BOARD_CASE_Y, caseImage(arena), { colorKey: -1 })
  const miniature = rec('MINATURE.CHR')
  for (let i = 1; i <= raceIndex; i++) {
    if (i === raceIndex && !blinkOn) continue // the newest icon blinks
    const { round, race } = ORDER_TABLE[i]
    const { x, y } = BOARD_ICON_POSITIONS[i - 1]
    blitChr(buf, arena, miniature, (round - 1) + (race - 1) * 8, x, y)
  }
}

/** P1's third boot item: RunOptionsScreenWithSettingsDat 1000:2770 (GOAL-DOS-PARITY.md,
 * docs/engine.md §9au). F1-F6 (F7 is never drawn here: it only appears with a real joystick
 * detected, 1000:2822, and no joystick/mouse input is wired up yet -- P6), each with its current
 * value; the footer hints; a "!" once the 25011968 cheat completes (1000:289D-28AA). Laid out by
 * hand for this substrate's 256-wide buffer, like every other screen in this file -- not measured
 * against a DOSBox frame (no live capture of this exact layout was taken; the SCREEN'S OWN
 * behaviour, not its pixel position, was verified live this session). */
export function drawOptionsScreen(buf, arena, { settings, cheatActive = false }) {
  drawStringCentred(buf, arena, rec('FONT2.CHR'), OPTIONS_TITLE, 4)
  const values = [
    CONTROL_NAME[settings.p1Control], CONTROL_NAME[settings.p2Control],
    SOUND_LABELS[settings.soundDriver], SMOOTHNESS_LABELS[settings.smoothness - 1], '', '',
  ]
  OPTIONS_MENU_LINES.slice(0, 6).forEach((label, i) => {
    const y = 26 + i * 12
    drawString(buf, arena, rec('FONT1.CHR'), label, 8, y)
    if (values[i]) drawString(buf, arena, rec('FONT1.CHR'), values[i], 176, y) // longest value is 7 chars (BLASTER/MEDIUM): 176+7*8=232, fits MENU_VIEW.w=256
  })
  OPTIONS_FOOTER.forEach((line, i) => drawStringCentred(buf, arena, rec('FONT1.CHR'), line, 170 + i * 10))
  if (cheatActive) drawString(buf, arena, rec('FONT1.CHR'), '!', 248, 4)
}

/** ShowCredits 1000:2a82: 10 lines, dismissed by any key. */
export function drawCreditsScreen(buf, arena) {
  drawStringCentred(buf, arena, rec('FONT2.CHR'), 'MICRO MACHINES', 10)
  CREDITS_LINES.forEach((line, i) => drawString(buf, arena, rec('FONT1.CHR'), line, 8, 40 + i * 14))
}

/** RunRedefineKeysScreen 1000:92f0: NOT cleared between the two groups (only once, at entry) --
 * "KEYS 1" and its 5 labels stay on screen while "KEYS 2" and its own 5 are drawn below them, live-
 * confirmed this session (a single DOSBox screenshot showed both groups stacked together). `slots`:
 * the 10-scancode scratch array so far (undefined past the current one); `slotIndex`: 0-9, the
 * slot currently being prompted for (or `REDEFINE_TOTAL_SLOTS` once the whole pass is done). */
export function drawRedefineKeysScreen(buf, arena, { slots, slotIndex }) {
  let y = 8
  for (let group = 0; group < 2; group++) {
    if (slotIndex < group * REDEFINE_SLOT_LABELS.length) break // this group hasn't started yet
    drawString(buf, arena, rec('FONT2.CHR'), REDEFINE_GROUP_LABELS[group], 8, y)
    y += 17
    for (let i = 0; i < REDEFINE_SLOT_LABELS.length; i++) {
      const slot = group * REDEFINE_SLOT_LABELS.length + i
      if (slot > slotIndex) break
      drawString(buf, arena, rec('FONT1.CHR'), REDEFINE_SLOT_LABELS[i], 16, y)
      const scancode = slots[slot]
      if (scancode != null) drawString(buf, arena, rec('FONT1.CHR'), redefineKeyChar(scancode), 168, y)
      y += 10
    }
  }
}

/** redefineKeyChar: the character 1000:ADF0's table shows for `scancode` (falls back to '?'). */
export const redefineKeyChar = (scancode) => REDEFINE_DISPLAY_CHAR[scancode] ?? REDEFINE_DISPLAY_CHAR_DEFAULT
export { REDEFINE_SLOT_LABELS }

/** ESC from the top-level options screen (1000:28BE-28C2, `STC;RET`): the real game drops straight
 * to the DOS prompt, no confirmation. A browser tab can't literally exit, so this is the port's
 * own terminal state -- same convention as other port-only end states in this project (docs
 * intro-and-codecard.md's own precedent for states DOS has no browser equivalent for). */
export function drawQuitToDosScreen(buf, arena) {
  drawStringCentred(buf, arena, rec('FONT2.CHR'), 'QUIT', 80)
  drawStringCentred(buf, arena, rec('FONT1.CHR'), 'RELOAD TO PLAY AGAIN', 110)
}
