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
import { WOBBLE_TABLE } from './elimination.js'

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
// `roster`: tournament.js's roster array (raw byte values -- 0-10 free, |0x40 taken, |0x20
// eliminated). Each of the 11 faces' own screen X is `pos - 0xD8` (1000:0d1f), cyclic from
// `scroll`; `blitChr` clips off-screen ones automatically, so all 11 are drawn unconditionally,
// matching the original's own clip-in-the-blitter approach rather than pre-filtering. `blinkOn`:
// the picked face flashes between its own portrait and the "taken" pose (frame 13) during the
// 5-blink commit sequence -- a simplified stand-in for `0db0`'s own more intricate bit-toggled
// blink frame math, not pixel-ported (this file's own usual caveat). `prompt`: 'WHO DO YOU WANT
// TO BE ?' (DS:020F) for the player's own pick, 'WHO DO YOU WANT TO RACE ?' (DS:0227) for the
// Head-to-Head CPU opponent, the Challenge opponent picker, and the elimination replacement pick.
const CAROUSEL_FACE_Y = 90
/** `FUN_1000_0db0`'s own roster-byte branch (`1000:0dbc-0dee`), re-disassembled and independently
 * verified for P3's third item: ELIMINATED (`0x20`) is tested BEFORE taken (`0x40`), not after --
 * an eliminated character's own roster byte keeps its `0x40` bit set too (`checkElimination`'s own
 * header, docs/engine.md §9ba: the real `1000:1707` never clears it), so checking `0x40` first, as
 * an earlier draft of this function did, would show an eliminated character as merely "taken"
 * (frame 13) instead of "eliminated" (frame 12) once both bits are set -- exactly the wrong pose in
 * the SAME replacement carousel this item adds. */
export function faceFrame(rosterByte) {
  if (rosterByte & 0x20) return 12 // eliminated
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
 * `raceIndex`: `tournament.js`'s own `effectiveRaceIndex(state)` -- NOT `state.raceIndex` directly, see
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
 * second WORDS frame, as an earlier draft of this comment wrongly said). `[0x156]` is a PERSISTENT
 * global (`FUN_1000_1E20`, two-human Head to Head's own entry, is its only writer, setting it to 1)
 * -- so "18d8 never shares a call graph with 1E20" does NOT by itself prove it is 0 at board time,
 * since a prior H2H session could leave it at 1. What actually guarantees 0 here: `RunMainMenu
 * KeepTitleTune 1000:0220` (SELECT GAME) resets it at its own entry (`1000:0238`), and SELECT GAME
 * is the ONLY path to the Challenge entry point that calls `18d8` (`0220`->"ONE PLAYER"->`02e0`->
 * "Challenge"->`102b`->...->`18d8`) -- so every board call is necessarily preceded by a fresh
 * `0220` entry that JUST reset it, regardless of what an earlier H2H session left behind. So the
 * board never draws a divider; this file draws none either. The case background position
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

/** `FUN_1000_19F2` (docs/engine.md §9az/§9ba): the 4-face status panel `1A4A` draws once before
 * either the initial 3-opponent pick or a single elimination replacement pick. Deferred as an
 * unported cosmetic gap when P3's second item shipped; now ported, since P3's third item (the
 * elimination screen) needs this SAME row for its own bouncing icon. Draws the shared header
 * (`WORDS.CHR` "MicroMachines" at its real `(0x48, 8)`), then one `FCNORMAL.CHR` portrait per
 * `slots` entry (player + 3 opponents for Challenge -- this port never calls it with H2H's own
 * 2-slot layout, out of scope) in a row at `Y=0x24`(36), `X = 8 + 0x40*i` (`1000:19FB`/`1000:1A29`'s
 * own literal start-X and per-slot step). `slots[i]`: a roster-byte-style value (character index,
 * optionally `|0x40`/`|0x20`) for a filled slot, or `null` for the real "unpicked" sentinel
 * (`0xB`, `faceFrame`'s own fallthrough doesn't cover this -- handled directly here). `header`:
 * draws the "MicroMachines" line too (the real screen's own standalone use, e.g. the eliminated
 * screen below) -- `false` when this is drawn ALONGSIDE `drawCharacterSelect`'s own prompt text
 * (both would otherwise land on the same `y=8` row; a port-only layering choice this file's own
 * "hand-placed, not measured" convention already covers, not a real-bytes citation). */
const PANEL_Y = 0x24
const PANEL_X0 = 8
const PANEL_STEP_X = 0x40
export function drawOpponentPanel(buf, arena, { slots, header = true }) {
  if (header) blitChr(buf, arena, rec('WORDS.CHR'), 0, 0x48, 8)
  const face = rec('FCNORMAL.CHR')
  slots.forEach((slot, i) => {
    const frame = slot == null ? 11 : faceFrame(slot)
    blitChr(buf, arena, face, frame, PANEL_X0 + i * PANEL_STEP_X, PANEL_Y)
  })
}

/** P3's third item: ShowCharacterEliminatedTune6 1000:16de (docs/engine.md §9ba,
 * src/frontend/elimination.js). "IS OUT!!" (`DS:03B6`) and the eliminated character's own name
 * (`DS:0258+idx*8`), both `FONT2.CHR` via `DrawString8pxFont` (`1000:0929`, `DX=0xB54` -- the same
 * font this file's own `drawString`/`drawStringCentred` already use as `FONT2.CHR`) at their real
 * positions, `1000:1711-1733`: the name at `(0x48, 0x64)`, "IS OUT!!" at `(0x80, 0x64)`. The panel
 * (`drawOpponentPanel`) is drawn ONCE, matching `1000:170E`'s own single `CALL 19F2` -- fully
 * re-disassembled (an advisor review flagged this as unverified): `19F2` reads each slot's own
 * face-DESCRIPTOR frame field (not the roster byte) through `0DB0`, masked to `0x4F` first
 * (`1000:1A0E`), so it can only ever show "unpicked" (`0xB`, `FCNORMAL.CHR`'s own frame 11 -- a red
 * "?" mark, confirmed by rendering), the "taken" frame (bit 0x40 set -> frame 13, `0DB0`'s branch --
 * confirmed by rendering to be genuinely BLANK/empty artwork in `FCNORMAL.CHR`, not a visible
 * silhouette, discarding the character's own identity bits entirely once 0x40 is set), or a plain
 * portrait (no bits) -- never "eliminated" (frame 12, bit 0x20, since 0x20 is set on the ROSTER
 * byte at `1707`, a SEPARATE memory location `19F2` never reads). `1000:170A: OR word ptr
 * [BX+0x13],0x40` sets JUST that bit on the VICTIM's own descriptor, immediately before this
 * one-time panel draw -- so the victim's own slot goes BLANK (a sensible, deliberate effect: their
 * static portrait vanishes from the panel right as they're about to bounce out, leaving only the
 * FCSAD icon to represent them), not their own portrait and NOT the real "unpicked" placeholder
 * (frame 11, the red "?") `opponents[slot]` -- already `null`, `checkElimination` vacates it before
 * this screen ever starts -- would otherwise produce. The real "unpicked" reset (`1000:178B`) and
 * the FCSAD rebind (`173D`/`1741`)/base-frame overwrite (`1744`) all happen AFTER this one draw,
 * and `19F2` is never called again for the rest of `16DE`'s own body (bounce or wait) -- the panel
 * image is a static snapshot, unlike this port's own `drawOpponentPanel`, which is redrawn fresh
 * every frame (a documented, harmless port-side simplification EXCEPT at the victim's own slot,
 * where redrawing from the ALREADY-vacated `tournament.opponents` would show the wrong pose; fixed
 * below by substituting the SAME `0x40`-only sentinel the real `170A` OR produces). The victim's
 * OWN icon then bounces IN that same panel row (its own slot's X, Y `PANEL_Y + WOBBLE_TABLE[step]`,
 * moving DOWN each step), using `FCSAD.CHR` (confirmed live this session, see `elimination.js`'s own
 * header for the full derivation), NOT `FCNORMAL` -- frame `victim*2 + (frameOn?1:0)`. **It also
 * SQUASHES**: `1000:1767: SUB byte [BX+0x19],AL` shrinks the sprite's own drawn row count by the
 * CURRENT offset every step (re-disassembled, confirmed against `04BD`'s own outer row-loop count
 * and `0630`'s own fresh reset of that field to the sprite's full height first) -- so fewer of the
 * icon's own bottom rows draw the deeper it sinks, down to just 1 visible row at the deepest point
 * of each dip (offset 47 of 48), with its own visible BOTTOM edge staying pinned at
 * `PANEL_Y + face.height` (the panel's own "floor") throughout, rather than the icon simply moving
 * as one whole sprite. **It also disappears entirely once the bounce finishes**, not a beat later
 * and not frozen at its own last position (a first fix attempt's own wrong assumption, caught by
 * re-disassembling the loop's own draw sequence): its last draw is immediately followed, same
 * iteration, by `1000:1776: CALL 05B4` (`RestoreSpriteBackground`, re-disassembled -- copies the
 * pixels the blit overwrote back over it, i.e. erases the sprite from the work buffer), and nothing
 * between the loop's own exit (`1000:1759`) and the real game's next full-screen present
 * (`1000:1790: CALL 08BC`, distinct from the loop's own partial-band `089C` -- that band turned out
 * to be a red herring for this specific effect, see `elimination.js`'s own header) draws anything new
 * -- so `done` (`elimination.js`'s own latched flag) must suppress the icon draw entirely,  not just
 * clamp its position or crop it away. `opponents`: the CURRENT 3-slot array (`tournament.opponents`,
 * already `null` at `slot`). `slot`: 0-2, which of the 3 opponent columns (panel column `slot+1`,
 * column 0 is always the player) the victim occupied. `step`/`frameOn`/`done`: `elimination.js`'s
 * own step state. */
/** 1000:170A's own OR (`[BX+0x13] |= 0x40`), the victim's slot only: extracted as its own pure,
 * directly-testable function (`tools/check-screens.mjs`) since the render-level effect is hard to
 * observe reliably -- the bouncing FCSAD icon drawn on top covers most of the same sprite rows the
 * panel frame choice would otherwise visibly differ in (see `drawEliminatedScreen`'s own header). */
export function eliminatedPanelSlots(opponents, slot) {
  return opponents.map((o, i) => (i === slot ? 0x40 : o))
}

export function drawEliminatedScreen(buf, arena, { victim, playerCharacter, opponents, slot, step = 0, frameOn = true, done = false }) {
  drawOpponentPanel(buf, arena, { slots: [playerCharacter, ...eliminatedPanelSlots(opponents, slot)] })
  drawString(buf, arena, rec('FONT2.CHR'), CHARACTER_NAMES[victim] ?? '', 0x48, 0x64)
  drawString(buf, arena, rec('FONT2.CHR'), 'IS OUT!!', 0x80, 0x64)
  if (!done) {
    const offset = WOBBLE_TABLE[step] ?? 0
    const face = rec('FCSAD.CHR')
    // 1000:1767: SUB byte [BX+0x19],AL -- the sprite's own row count (reset to its full height by
    // 0630 every step, since Y=baseline+offset never nears the real screen's own 200-row bound) is
    // shrunk by the CURRENT offset before the draw (04BD's own outer row-loop count, counted from
    // the sprite's own TOP row, per its own SI/DI addressing) -- while the draw's own Y position
    // (baseline+offset, unchanged) still moves DOWN each step. Net effect: the icon's own VISIBLE
    // bottom edge stays pinned at baseline+fullHeight (the panel's own "floor"), and its top sinks
    // toward it -- a "squash" effect, down to just 1 visible row at the deepest point of each dip
    // (offset 47 of 48) -- NOT a screen-bounds clip (see `blit.js`'s own `blitTransparent` header).
    const y = PANEL_Y + offset
    blitChr(buf, arena, face, victim * 2 + (frameOn ? 1 : 0), PANEL_X0 + (slot + 1) * PANEL_STEP_X, y, { cropRows: face.height - offset })
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
