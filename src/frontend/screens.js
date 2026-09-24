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
import { CHR_TABLE } from '../formats/chr.js'
import { drawString, drawStringCentred, blitChr, MENU_VIEW } from '../render/menuView.js'
import { CHARACTER_NAMES, CHARACTER_SKILLS, trackName, OPTIONS_MENU_LINES, OPTIONS_FOOTER, OPTIONS_TITLE, SMOOTHNESS_LABELS, SOUND_LABELS, CREDITS_LINES, REDEFINE_GROUP_LABELS, REDEFINE_SLOT_LABELS, REDEFINE_DISPLAY_CHAR, REDEFINE_DISPLAY_CHAR_DEFAULT } from '../data/frontend-tables.js'
import { CONTROL_NAME } from '../formats/globaldata.js'

function rec(name) {
  return CHR_TABLE.find((r) => r.name === name)
}

export function drawTitleScreen(buf, arena, { classIndex = 0 } = {}) {
  const logo = rec('LOGO.CHR')
  blitChr(buf, arena, logo, 0, (MENU_VIEW.w - logo.width) >> 1, 20)
  const intro = rec('INTRO.CHR')
  blitChr(buf, arena, intro, classIndex % intro.frames, (MENU_VIEW.w - intro.width) >> 1, 120)
  drawStringCentred(buf, arena, rec('FONT1.CHR'), 'PRESS FIRE TO START', 190)
}

export function drawMainMenu(buf, arena, { cursor = 0 } = {}) {
  const logo = rec('LOGO.CHR')
  blitChr(buf, arena, logo, 0, (MENU_VIEW.w - logo.width) >> 1, 10)
  drawStringCentred(buf, arena, rec('FONT2.CHR'), 'SELECT GAME', 70)
  // The real menu is two levels (MAIN: ONE PLAYER/TWO PLAYER -> a ONE PLAYER submenu: Head-to-
  // Head-vs-CPU / Challenge, docs/engine.md §7's "0fbf"/"102b") -- flattened here into one list
  // (flow.js's own header comment explains why).
  const items = ['CHALLENGE', 'HEAD TO HEAD (vs CPU)', 'TWO PLAYER']
  items.forEach((label, i) => {
    const y = 100 + i * 20
    // See drawCharacterSelect's comment: the real font has no arrow/bullet glyph, so the cursor
    // is a plain letter marker instead of a silently-invisible unsupported character.
    drawStringCentred(buf, arena, rec('FONT1.CHR'), (i === cursor ? 'X ' : '  ') + label, y)
  })
}

/** 09E0's select screen, laid out as a list (the real one is a scrolling portrait carousel, not
 * ported). `prompt`: 'WHO DO YOU WANT TO BE ?' (DS:020F) for the player's own pick, 'WHO DO YOU
 * WANT TO RACE ?' (DS:0227) for the Head-to-Head CPU opponent. Taken characters are marked and
 * can't be picked. */
export function drawCharacterSelect(buf, arena, { cursor = 0, taken = [], prompt = 'WHO DO YOU WANT TO BE ?' } = {}) {
  drawStringCentred(buf, arena, rec('FONT2.CHR'), prompt, 8)
  CHARACTER_NAMES.forEach((name, i) => {
    const y = 30 + i * 14
    // The real font (BlitGlyph8xH, 1000:0999) only has glyphs for 0-9/A-Z/!/? -- no arrow or
    // bullet character exists to render a cursor with, so this substitutes a plain letter marker
    // rather than silently drawing nothing (glyphFrame's own null-glyph behaviour, confirmed by
    // this milestone's own check-menu.mjs test, otherwise makes an unsupported marker invisible).
    const marker = i === cursor ? 'X' : taken.includes(i) ? 'O' : ' '
    drawString(buf, arena, rec('FONT1.CHR'), `${marker} ${name.padEnd(8)}${CHARACTER_SKILLS[i]}`, 24, y)
  })
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
