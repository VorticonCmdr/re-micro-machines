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
import { drawTitleScreen, drawSelectGame, drawOnePlayerGameMenu, drawCharacterSelect, drawPressAnyKey, drawRaceIntro, drawResults, drawOutcome, drawChampion } from '../src/frontend/screens.js'

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
  ['drawResults (passed)', () => drawResults(createMenuBuffer(), arena, { standings: [{ name: 'WALTER', position: 1 }, { name: 'MIKE', position: 2 }, { name: 'ANNE', position: 3 }, { name: 'JOEL', position: 4 }], passed: true })],
  ['drawResults (failed)', () => drawResults(createMenuBuffer(), arena, { standings: [{ name: 'WALTER', position: 4 }], passed: false })],
  // Regression guard for the advisor-caught bug (tournament.js now always populates `opponents`
  // before any race runs, so flow.js can no longer produce this shape in practice -- kept anyway
  // since drawResults itself should degrade gracefully, not throw or silently render "undefined").
  ['drawResults (missing name, defensive)', () => drawResults(createMenuBuffer(), arena, { standings: [{ name: 'WALTER', position: 1 }, { name: undefined, position: 2 }], passed: true })],
  ['drawOutcome', () => drawOutcome(createMenuBuffer(), arena, { message: 'QUALIFIED FOR CHALLENGE!' })],
  ['drawChampion', () => drawChampion(createMenuBuffer(), arena, { playerName: 'WALTER' })],
]

for (const [name, fn] of cases) {
  try {
    fn()
  } catch (e) {
    bad++
    console.log(`FAIL: ${name} threw: ${e.message}`)
  }
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

console.log(bad ? `${bad} check(s) failed` : `check-screens: all ${cases.length} screen renderers run clean against synthetic data (RESULTS/OUTCOME/CHAMPION included, unreachable live this session)`)
process.exitCode = bad ? 1 : 0
