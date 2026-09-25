// Two-human Head to Head's own screens (src/frontend/h2hScreens.js, docs/engine.md §9bz) against
// real DOSBox frames: each layout is painted into the port's 256x200 work buffer and compared with
// the captured VGA frame's columns 32..287 (the original presents its 256-wide work buffer at
// screen X+32). Every capture's DAC is INTRO.PAL, so the indices are compared directly.
//   node tools/check-h2hscreens.mjs            (writes tools/out/h2h_*_diff.png on a mismatch)
import { readFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildArena } from '../src/formats/chr.js'
import { MENU_VIEW, createMenuBuffer } from '../src/render/menuView.js'
import {
  paintOps, layoutTwoPlayerRaceInfo, layoutTwoPlayerResult, layoutSingleRaceSelect, layoutChooseGame,
  raceInfoIconX, portraitSprite, twoDigits,
} from '../src/frontend/h2hScreens.js'
import { savePng, scale } from './png.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const GAME = join(ROOT, 'game')
const REFS = join(ROOT, 'tools', 'refs', 'front')
const OUT = join(ROOT, 'tools', 'out')
const { arena } = await buildArena(async (n) => new Uint8Array(readFileSync(join(GAME, n))))
const intro = readFileSync(join(GAME, 'INTRO.PAL'))

let bad = 0
function check(name, cond) {
  if (cond) return
  bad++
  console.log(`FAIL: ${name}`)
}

const DWAYNE = 5
const JETHRO = 6

function diff(refName, ops) {
  const path = join(REFS, `${refName}_a000.bin`)
  if (!existsSync(path)) { check(`${refName}: reference frame present`, false); return }
  const ref = readFileSync(path)
  const dac = readFileSync(join(REFS, `${refName}_dac.bin`))
  check(`${refName}: capture's DAC is INTRO.PAL`, Buffer.compare(dac, intro.subarray(0, 768)) === 0)
  const buf = createMenuBuffer()
  paintOps(buf, arena, ops)
  const { w, h } = MENU_VIEW
  let n = 0
  const rgba = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = buf[y * w + x]
      const b = ref[y * 320 + x + 32]
      const i = (y * w + x) * 4
      if (a !== b) { n++; rgba.set([255, 0, 0, 255], i) } else { const v = Math.round(intro[a * 3] * 255 / 63 * 0.4); rgba.set([v, v, v, 255], i) }
    }
  }
  // Columns outside the work buffer: the present copies 256, so these stay the side border's
  // colour 15 on every capture -- nothing the screen draws lands there.
  let outside = 0
  for (let y = 0; y < h; y++) for (const x of [...Array(32).keys(), ...Array.from({ length: 32 }, (_, k) => 288 + k)]) if (ref[y * 320 + x] !== 15) outside++
  check(`${refName}: screen columns 0..31/288..319 are all the border colour 15`, outside === 0)
  if (n) {
    mkdirSync(OUT, { recursive: true })
    savePng(join(OUT, `${refName}_diff.png`), w * 3, h * 3, scale(rgba, w, h, 3))
  }
  check(`${refName}: ${n} pixel(s) differ from the DOSBox frame`, n === 0)
  return n
}

// --- pure helpers
check('1A34: 0 -> " 0", 7 -> " 7", 12 -> "12"', twoDigits(0) === ' 0' && twoDigits(7) === ' 7' && twoDigits(12) === '12')
check('2216: HIGH (1) rests at 92/132, the first X past 0x58', raceInfoIconX(1).join() === '92,132')
check('2216: step 8 rests at 96/128, step 16 at 96/128', raceInfoIconX(2).join() === '96,128' && raceInfoIconX(4).join() === '96,128')
check('0DB0: bank 0 frame = character', portraitSprite(6).chr === 'FCNORMAL.CHR' && portraitSprite(6).frame === 6)
check('0DB0: bank 2/3 frame = character*2 + blink', portraitSprite(5, 2, false).frame === 10 && portraitSprite(5, 2, true).frame === 11 && portraitSprite(10, 3, true).chr === 'FCSAD.CHR' && portraitSprite(10, 3, true).frame === 21)

// --- live frames (captured this session, docs/engine.md §9bz)
const zeroZero = [{ character: DWAYNE, wins: 0, losses: 0 }, { character: JETHRO, wins: 0, losses: 0 }]
const oneZero = [{ character: DWAYNE, wins: 1, losses: 0 }, { character: JETHRO, wins: 0, losses: 1 }]

// 179B's wait after 1FAF's first race (round 1 SPORTSCARS, 0-0, smoothness HIGH).
diff('h2h_raceinfo', layoutTwoPlayerRaceInfo({ players: zeroZero, tally: [0, 0], raceNumber: 1, round: 1, smoothness: 1 }))
// 256E after P1 won race 1: before the first 26A3 XOR, then after an odd number of them.
diff('h2h_result', layoutTwoPlayerResult({ players: oneZero, tally: [1, 0], raceNumber: 1, round: 1, p1Won: true, blinks: 0 }))
diff('h2h_result_blink', layoutTwoPlayerResult({ players: oneZero, tally: [1, 0], raceNumber: 1, round: 1, p1Won: true, blinks: 1 }))
// 2329's select loop on FORMULA ONE (round 3), PRO FORMULA ONE (class 10 -> round 3), and the
// same with 0C5D's blink bit set.
diff('h2h_selectvehicle', layoutSingleRaceSelect({ players: oneZero, round: 3, vehicleClass: 3, smoothness: 1, polled: true }))
diff('h2h_selectvehicle_pro', layoutSingleRaceSelect({ players: oneZero, round: 3, vehicleClass: 10, smoothness: 1, polled: true }))
diff('h2h_selectvehicle_problink', layoutSingleRaceSelect({ players: oneZero, round: 3, vehicleClass: 10, smoothness: 1, polled: true, blink: true }))
// 1EF1's CHOOSE GAME, re-entered by ESC from SELECT VEHICLE: [0x8A0] still holds the last pick,
// SINGLE RACE (2), and 0382 draws THUMB frame = selection (0 none, 1 left, 2 right).
diff('h2h_choosegame', layoutChooseGame({ characters: [DWAYNE, JETHRO], selection: 2 }))

console.log(bad ? `${bad} check(s) failed` : 'check-h2hscreens: the two-human screens match their DOSBox frames pixel for pixel')
process.exitCode = bad ? 1 : 0
