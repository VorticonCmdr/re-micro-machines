// M3.9 smoke test: every screens.js render function runs against synthetic data with no throw
// and paints something (same "smoke" shape as check-views.mjs). This exists because the live
// browser session that exercised TITLE/MENU/CHAR_SELECT/RACE_INTRO for real could not reach
// RESULTS/OUTCOME/CHAMPION (the game.html tab went `document.hidden` under browser automation,
// which pauses requestAnimationFrame indefinitely -- the same rAF-throttling caveat play.js's own
// M3.6 section already named, not a new bug); this closes that gap headlessly instead of guessing
// those three screens are fine because the others were.
//   node tools/check-screens.mjs
import { buildArena } from '../src/formats/chr.js'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createMenuBuffer, MENU_VIEW } from '../src/render/menuView.js'
import { drawTitleScreen, drawSelectGame, drawOnePlayerGameMenu, drawCharacterSelect, drawOpponentPanel, drawEliminatedScreen, drawPressAnyKey, drawRaceIntro, drawResults, drawOutcome, drawChampion, drawTournamentBoard, faceFrame, eliminatedPanelSlots } from '../src/frontend/screens.js'
import { WOBBLE_TABLE } from '../src/frontend/elimination.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const GAME = join(ROOT, 'game')
const read = async (n) => new Uint8Array(readFileSync(join(GAME, n)))

let bad = 0
function check(name, cond) {
  if (cond) return
  bad++
  console.log(`FAIL: ${name}`)
}

const { arena } = await buildArena(read)

function nonEmpty(buf) {
  return buf.some((v) => v !== 0)
}

// FUN_1000_0db0 (1000:0dbc-0dee), docs/engine.md §9ba: ELIMINATED (0x20) is tested BEFORE taken
// (0x40) -- an eliminated character keeps 0x40 set too (checkElimination's OR never clears it), so
// a byte with both bits set must resolve to frame 12 (eliminated), not 13 (taken). This is the exact
// assertion the P3-item-3 advisor review demanded a direct test for, not just a smoke render.
check('faceFrame: eliminated-and-taken (0x60) resolves to the eliminated pose, not taken', faceFrame(0x60) === 12)
check('faceFrame: taken-only (0x43) resolves to the taken pose', faceFrame(0x43) === 13)
check('faceFrame: plain portrait index survives untouched', faceFrame(5) === 5)

// Regression for a real bug an advisor review caught (docs/engine.md §9ba, 1000:170A/19F2):
// `drawEliminatedScreen`'s own panel must show the victim's slot as the generic "taken" pose
// (faceFrame(0x40)===13, matching the real one-time 19F2 draw with the victim's descriptor OR'd
// 0x40), NOT the real "unpicked" placeholder (frame 11) that forwarding `opponents[slot]` -- already
// `null`, checkElimination vacates it immediately -- straight through would produce.
check('eliminatedPanelSlots substitutes the "taken" sentinel (0x40) at the victim\'s own slot', eliminatedPanelSlots([null, 2, 3], 0).join() === '64,2,3')
check('eliminatedPanelSlots leaves every other slot untouched', eliminatedPanelSlots([1, null, 3], 1).join() === '1,64,3')
{
  // End-to-end through drawEliminatedScreen itself, not just eliminatedPanelSlots in isolation (a
  // caller could still forget to use it). At step=15 (the bounce's own last position, offset 47) the
  // squash crop (below) draws only 1 row of the FCSAD icon, at Y=PANEL_Y+47 (panel row 47) -- which
  // happens to render as entirely transparent on this sprite -- so it draws nothing at all in rows
  // 13-46, the ones a frame-13-vs-frame-11 choice actually differs in (rows 0-12 are blank in both
  // frames regardless). A pixel diff against an icon-less reference over just that row range
  // isolates the panel's own frame choice from the icon.
  const PANEL_Y = 0x24, PANEL_X0 = 8, PANEL_STEP_X = 0x40
  const eliminated = createMenuBuffer()
  drawEliminatedScreen(eliminated, arena, { victim: 1, playerCharacter: 10, opponents: [null, 2, 3], slot: 0, step: 15, frameOn: true })
  const buggyPanelOnly = createMenuBuffer() // what a panel built from the raw (already-nulled) opponents array would have drawn, no icon
  drawOpponentPanel(buggyPanelOnly, arena, { slots: [10, null, 2, 3] })
  let panelRegionDiffers = false
  for (let row = 13; row < 48; row++) {
    for (let x = 0; x < PANEL_STEP_X; x++) {
      const idx = (PANEL_Y + row) * MENU_VIEW.w + PANEL_X0 + PANEL_STEP_X + x
      if (eliminated[idx] !== buggyPanelOnly[idx]) panelRegionDiffers = true
    }
  }
  check('drawEliminatedScreen\'s own panel differs from the "unpicked" placeholder an un-fixed forward would draw', panelRegionDiffers)
}

// Regression for a real bug (docs/engine.md §9ba): the FCSAD icon must NOT be drawn at all once
// `done` -- it disappears the instant the bounce finishes (`1000:1776: CALL 05B4`, re-disassembled,
// erases it from the work buffer every iteration including the last; nothing redraws it before the
// real game's next full-screen present, `1000:1790: CALL 08BC`), not frozen at its own last bounced
// position as a first fix attempt wrongly assumed. Deliberately at step=0 (offset 2, cropRows=46 of
// 48 -- nearly the whole sprite), not step=15: the SAME `1767`-driven squash crop (below) shrinks the
// icon to just 1 row by step=15/47, which happens to render as ALL-transparent pixels on this
// particular sprite -- a real, separate effect, but one that would make this specific test vacuous
// (an un-fixed `done` skip and the squash's own near-invisibility would look identical) if step=15
// were used here instead.
{
  const notDone = createMenuBuffer()
  drawEliminatedScreen(notDone, arena, { victim: 1, playerCharacter: 10, opponents: [null, 2, 3], slot: 0, step: 0, frameOn: true, done: false })
  const done = createMenuBuffer()
  drawEliminatedScreen(done, arena, { victim: 1, playerCharacter: 10, opponents: [null, 2, 3], slot: 0, step: 0, frameOn: true, done: true })
  check('the icon draws when not done', nonEmpty(notDone))
  check('drawEliminatedScreen with done=true draws no icon at all (differs from the not-done render)', !notDone.every((v, i) => v === done[i]))
}

// Regression for the squash crop itself (docs/engine.md §9ba, 1000:1767): the icon must draw FEWER
// visible rows as the offset grows, with its own visible bottom edge staying pinned (not simply
// translating downward as one whole sprite) -- at the deepest point of the table (offset 47 of a
// 48-tall sprite, step 5 or 15), only 1 row survives the crop, rendering as entirely transparent on
// this sprite (confirmed above) -- i.e. visually indistinguishable from no icon at all, even though
// `done` is still false. A near-full step (offset 2, step 0) must still show real, non-transparent
// icon pixels.
{
  const nearlyFull = createMenuBuffer()
  drawEliminatedScreen(nearlyFull, arena, { victim: 1, playerCharacter: 10, opponents: [null, 2, 3], slot: 0, step: 0, frameOn: true, done: false })
  const deepestDip = createMenuBuffer()
  drawEliminatedScreen(deepestDip, arena, { victim: 1, playerCharacter: 10, opponents: [null, 2, 3], slot: 0, step: 5, frameOn: true, done: false })
  const noIconAtAll = createMenuBuffer()
  drawEliminatedScreen(noIconAtAll, arena, { victim: 1, playerCharacter: 10, opponents: [null, 2, 3], slot: 0, step: 5, frameOn: true, done: true })
  check('a near-full step (offset 2) still shows real icon pixels', !nearlyFull.every((v, i) => v === noIconAtAll[i]))
  check('the deepest dip (offset 47, step 5) squashes to the SAME render as no icon at all (1 row, entirely transparent on this sprite)', deepestDip.every((v, i) => v === noIconAtAll[i]))
}

// Bounding-box invariant, every step (docs/engine.md §9ba): the icon's own visible bottom edge must
// stay pinned at PANEL_Y+48 (the sprite's own full height) while its visible top sinks toward it --
// NOT translate as one whole sprite (a first draft that kept Y fixed at PANEL_Y and only applied the
// crop would still pass every check above, since both variants agree at the two steps already
// tested; this is the one check that tells the two apart at every step in between). Diffing each
// step's render against its OWN `done: true` reference isolates exactly the pixels the icon itself
// contributes (panel/text are identical either way); every one of them must fall inside
// [PANEL_Y+offset, PANEL_Y+48) -- never above the icon's own current top (proves Y moves down, not
// fixed) and never at or below the floor (proves the crop removes BOTTOM rows, not top ones).
{
  const PANEL_Y = 0x24
  const face = { height: 48 } // FCSAD.CHR, confirmed via arena lookup elsewhere in this file
  for (let step = 0; step < WOBBLE_TABLE.length; step++) {
    const offset = WOBBLE_TABLE[step]
    const withIcon = createMenuBuffer()
    drawEliminatedScreen(withIcon, arena, { victim: 1, playerCharacter: 10, opponents: [null, 2, 3], slot: 0, step, frameOn: true, done: false })
    const withoutIcon = createMenuBuffer()
    drawEliminatedScreen(withoutIcon, arena, { victim: 1, playerCharacter: 10, opponents: [null, 2, 3], slot: 0, step, frameOn: true, done: true })
    let ok = true
    for (let i = 0; i < withIcon.length; i++) {
      if (withIcon[i] === withoutIcon[i]) continue
      const y = Math.floor(i / MENU_VIEW.w)
      if (y < PANEL_Y + offset || y >= PANEL_Y + face.height) ok = false
    }
    check(`step ${step} (offset ${offset}): every icon-only pixel falls in [${PANEL_Y + offset}, ${PANEL_Y + face.height})`, ok)
  }
}

const cases = [
  ['drawTitleScreen', () => drawTitleScreen(createMenuBuffer(), arena, { classIndex: 2 })],
  ['drawSelectGame (nothing selected)', () => drawSelectGame(createMenuBuffer(), arena, { selection: 0 })],
  ['drawSelectGame (TWO PLAYER selected)', () => drawSelectGame(createMenuBuffer(), arena, { selection: 2 })],
  ['drawOnePlayerGameMenu (nothing selected)', () => drawOnePlayerGameMenu(createMenuBuffer(), arena, { selection: 0 })],
  ['drawOnePlayerGameMenu (Challenge selected)', () => drawOnePlayerGameMenu(createMenuBuffer(), arena, { selection: 2 })],
  ['drawCharacterSelect', () => drawCharacterSelect(createMenuBuffer(), arena, { scroll: 0x140, cursor: 3, roster: [0, 1, 2, 0x43, 4, 5, 6, 7, 8, 9, 10] })],
  ['drawCharacterSelect (H2H opponent prompt, blinking)', () => drawCharacterSelect(createMenuBuffer(), arena, { scroll: 0, cursor: 5, roster: [0, 1, 2, 3, 0x44, 5, 6, 7, 8, 9, 10], blinkOn: true, prompt: 'WHO DO YOU WANT TO RACE ?' })],
  ['drawPressAnyKey', () => drawPressAnyKey(createMenuBuffer(), arena)],
  ['drawRaceIntro (named track)', () => drawRaceIntro(createMenuBuffer(), arena, { round: 1, race: 1 })],
  ['drawRaceIntro (nameless qualifier)', () => drawRaceIntro(createMenuBuffer(), arena, { round: 2, race: 1 })],
  ['drawRaceIntro (round 9, the bonus race -- no names in TRACK_NAMES at all)', () => drawRaceIntro(createMenuBuffer(), arena, { round: 9, race: 1 })],
  ['drawRaceIntro (H2H, 2 participants)', () => drawRaceIntro(createMenuBuffer(), arena, { round: 1, race: 1, participants: [0, 6] })], // WALTER vs JETHRO
  ['drawRaceIntro (Challenge, worst-case width: 4 six-letter names)', () => drawRaceIntro(createMenuBuffer(), arena, { round: 1, race: 1, participants: [5, 6, 7, 8] })], // DWAYNE vs JETHRO CHERRY EMILIO
  ['drawResults (passed)', () => drawResults(createMenuBuffer(), arena, { standings: [{ name: 'WALTER', position: 1 }, { name: 'MIKE', position: 2 }, { name: 'ANNE', position: 3 }, { name: 'JOEL', position: 4 }], passed: true })],
  ['drawResults (failed)', () => drawResults(createMenuBuffer(), arena, { standings: [{ name: 'WALTER', position: 4 }], passed: false })],
  // Regression guard for an advisor-caught bug from an earlier session (a qualifier failure used
  // to leave `opponents` empty, showing "UNDEFINED" names) -- kept anyway since `drawResults`
  // itself should degrade gracefully, not throw or silently render "undefined", regardless of
  // whether the current tournament.js state shape can still produce it in practice.
  ['drawResults (missing name, defensive)', () => drawResults(createMenuBuffer(), arena, { standings: [{ name: 'WALTER', position: 1 }, { name: undefined, position: 2 }], passed: true })],
  ['drawOutcome', () => drawOutcome(createMenuBuffer(), arena, { message: 'QUALIFIED FOR CHALLENGE!' })],
  ['drawChampion', () => drawChampion(createMenuBuffer(), arena, { playerName: 'WALTER' })],
  ['drawTournamentBoard (raceIndex 1, blinking on)', () => drawTournamentBoard(createMenuBuffer(), arena, { raceIndex: 1, blinkOn: true })],
  ['drawTournamentBoard (raceIndex 24, the last one shown, blinking off)', () => drawTournamentBoard(createMenuBuffer(), arena, { raceIndex: 24, blinkOn: false })],
  ['drawOpponentPanel (with header, some slots empty)', () => drawOpponentPanel(createMenuBuffer(), arena, { slots: [10, 1, null, null] })],
  ['drawOpponentPanel (no header, all filled)', () => drawOpponentPanel(createMenuBuffer(), arena, { slots: [10, 1, 2, 3], header: false })],
  ['drawEliminatedScreen (first wobble step)', () => drawEliminatedScreen(createMenuBuffer(), arena, { victim: 1, playerCharacter: 10, opponents: [null, 2, 3], slot: 0, step: 0, frameOn: true })],
  ['drawEliminatedScreen (last wobble step)', () => drawEliminatedScreen(createMenuBuffer(), arena, { victim: 6, playerCharacter: 10, opponents: [1, 2, null], slot: 2, step: 15, frameOn: false })],
  ['drawEliminatedScreen (done -- the post-bounce wait, no icon)', () => drawEliminatedScreen(createMenuBuffer(), arena, { victim: 6, playerCharacter: 10, opponents: [1, 2, null], slot: 2, step: 15, frameOn: false, done: true })],
]

for (const [name, fn] of cases) {
  try {
    fn()
  } catch (e) {
    bad++
    console.log(`FAIL: ${name} threw: ${e.message}`)
  }
}

// The Head-to-Head carousels' prompt blinks like the Challenge's: 0C96 draws [0x19A] only while
// [0x26CF] bit 0 is set, for every 09E0 caller (docs/engine.md §9dr). Off: nothing in the prompt's
// FONT2 rows (8..23), and nothing else changes.
{
  const opts = { scroll: 0x140, cursor: 6, roster: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] }
  const on = createMenuBuffer(); drawCharacterSelect(on, arena, { ...opts, promptOn: true })
  const off = createMenuBuffer(); drawCharacterSelect(off, arena, { ...opts, promptOn: false })
  let promptInk = 0, promptLeft = 0, elsewhere = 0
  for (let i = 0; i < on.length; i++) {
    const y = Math.floor(i / MENU_VIEW.w)
    const inPrompt = y >= 8 && y < 24
    if (inPrompt && on[i] !== 0) promptInk++
    if (inPrompt && off[i] !== 0) promptLeft++
    if (!inPrompt && on[i] !== off[i]) elsewhere++
  }
  check('drawCharacterSelect: the prompt is drawn with promptOn', promptInk > 0)
  check('drawCharacterSelect: promptOn false leaves the prompt rows blank (0C96, [0x26CF]&1 clear)', promptLeft === 0)
  check('drawCharacterSelect: promptOn changes nothing outside the prompt rows', elsewhere === 0)
}

// A couple of direct pixel-content checks (not just "didn't throw") against a buffer we keep.
{
  const buf = createMenuBuffer()
  drawChampion(buf, arena, { playerName: 'WALTER' })
  check('drawChampion paints something', nonEmpty(buf))
}
{
  const buf = createMenuBuffer()
  drawResults(buf, arena, { standings: [{ name: 'WALTER', position: 1 }], passed: true })
  check('drawResults paints something', nonEmpty(buf))
}
{
  const buf = createMenuBuffer()
  drawTournamentBoard(buf, arena, { raceIndex: 1, blinkOn: true })
  check('drawTournamentBoard paints something', nonEmpty(buf))
}
{
  const buf = createMenuBuffer()
  drawEliminatedScreen(buf, arena, { victim: 1, playerCharacter: 10, opponents: [null, 2, 3], slot: 0, step: 0, frameOn: true })
  check('drawEliminatedScreen paints something', nonEmpty(buf))
}

console.log(bad ? `${bad} check(s) failed` : `check-screens: all ${cases.length} screen renderers run clean against synthetic data (RESULTS/OUTCOME/CHAMPION included, unreachable live this session)`)
process.exitCode = bad ? 1 : 0
