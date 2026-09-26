// Two-human Head to Head's own screens, drawn the way the original draws them (docs/engine.md §9bz):
// CHOOSE GAME (`1EF1`), the per-race info screen (`1FAF`), the WINNER!/LOSER! screen (`256E`) and
// SELECT VEHICLE (`2329`). Each screen is a list of draw operations (`layout*`), each one citing
// the routine and record it comes from, painted by `paintOps` into the same 256x200 work buffer
// every other front-end screen uses -- the original's own work buffer is this same 256-wide area
// (`08BC` presents it at screen X+32, `docs/engine.md` §9bz), so these coordinates are the
// original's own. Pixel-checked against six DOSBox captures by `tools/check-h2hscreens.mjs`.
//
// The shared routines, all `[STATIC]`:
// - `0400` (the header): clear to 0 (`0876`); BADGE (record `0xB7C`, opaque `053A`) at (0,0);
//   WORDS frame 0 (record `0xCA5`) at (0x48,8); with `[0x156]` nonzero, WORDS frame `[0x156]` at
//   (0xA2,8) -- 1 "Head to Head" here (two-human play), 2 "Challenge" -- and a divider: row 0x1E colour 0x12, rows 0x1F-0x20 colour 0x0E, row 0x21 colour 0x12
//   (`0862`, full width).
// - A portrait (`0DB0`): the record's `+0x13` high byte picks the bank -- 0 FCNORMAL (frame =
//   character, or 12/13 for the eliminated/taken bits), 2 FCHAPPY and 3+ FCSAD (the win/lose poses,
//   frame = `((cl<<1) | (cl&0x10 ? 1 : 0)) & 0x1F`, i.e. `character*2 + blink`); opaque (`053A`),
//   never mirrored (no writer of `[0xC0D]`/`[0xC28]`).
// - `06CC` with AL=0xD: a 1px colour-0xD border around the sprite's box (x-1..x+48, y-1..y+48).
// - `0F3C`: the name at (x, y+0x31), FONT1, from `DS:0258`'s 8-byte slots (4-letter names are
//   space-padded, " MIKE ", so they sit 8px in).
// - `240A` (AX = Y): P1's portrait at X=0x20, P2's at X=0xB0 (bank bits masked off first), each
//   with its border and name; with `[0x8A5]`=1 (tournament) the tally digits (`DS:08A6`, FONT2) at
//   X=0x58 and X=0xA0, same Y.
// - `2481`: per player at X (0x20/0xB0) and Y: "WON n" (`DS:0997`, the number patched by `1A34`:
//   tens digit, or a space for 0, then units) at (X-0x18, Y+0x3A) and "LOST n" (`DS:098D`) at
//   (X+0x18, Y+0x3A), FONT1; the skill label (`DS:08CD` by `DS:08B0[clamp(w-l+10)]`) at
//   (X-0x18, Y+0x42) -- `0929` keeps AX, so the label's X is the WON text's own.
// - `0910`: centred at X = 0x7F - 4*length. `0929`: 8px per glyph, spaces skipped.

import { CHR_TABLE, chrFrame } from '../formats/chr.js'
import { blitTransparent } from '../render/blit.js'
import { drawString, MENU_VIEW } from '../render/menuView.js'
import { H2H_SKILL_INDEX_TABLE, H2H_SKILL_LABELS } from '../data/frontend-tables.js'

const rec = (name) => CHR_TABLE.find((r) => r.name === name)

/** `DS:0258`: the character names as `0F3C` draws them (8-byte slots, 4-letter names padded). */
export const PORTRAIT_NAMES = ['WALTER', ' MIKE ', ' ANNE ', ' JOEL ', ' CHEN ', 'DWAYNE', 'JETHRO', 'CHERRY', 'EMILIO', 'BONNIE', 'SPIDER']
/** `DS:002F` (the plain class names, index = pre-remap class - 1) and `DS:00AB` (the same list with
 * "PRO " blanked, `0C5D`'s blink table). */
export const CLASS_NAMES = ['SPORTSCARS', 'POWERBOATS', 'FORMULA ONE', 'TURBO WHEELS', 'FOUR BY FOUR', 'WARRIORS', 'TANKS', 'CHOPPERS', 'RUFFTRUX', 'PRO FORMULA ONE', 'PRO SPORTSCARS']
export const CLASS_NAMES_BLINK = ['SPORTSCARS', 'POWERBOATS', 'FORMULA ONE', 'TURBO WHEELS', 'FOUR BY FOUR', 'WARRIORS', 'TANKS', 'CHOPPERS', 'RUFFTRUX', '    FORMULA ONE', '    SPORTSCARS']

export const H2H_P1_X = 0x20 // 240A: [0xC05]
export const H2H_P2_X = 0xb0 // 240A: [0xC20]
export const RACE_INFO_Y = 0x24 // 2034: AX=0x24
export const RESULT_Y = 0x64 // 25C2: AX=0x64
export const ICONS_RACE_INFO_Y = 0x46 // 2274/227A
export const ICONS_RESULT_Y = 0xb6 // 2650/2656

/** `1A34`: two characters, the tens digit as a space when it is 0. */
export function twoDigits(n) {
  const tens = Math.floor(n / 10) % 10
  return `${tens === 0 ? ' ' : tens}${n % 10}`
}

/** `0DB0`: which CHR and frame a portrait record draws. `bank` is the `+0x13` high byte (0 plain,
 * 2 winner, 3 loser); `blink` is `+0x13` bit 4. */
export function portraitSprite(character, bank = 0, blink = false) {
  const cl = character | (blink ? 0x10 : 0)
  if (bank === 0) return { chr: 'FCNORMAL.CHR', frame: character }
  if (bank === 1) return { chr: 'FCFROWN.CHR', frame: cl }
  const frame = (((cl << 1) & 0xff) | (cl & 0x10 ? 1 : 0)) & 0x1f
  return { chr: bank === 2 ? 'FCHAPPY.CHR' : 'FCSAD.CHR', frame }
}

/** The ISR-paced icon slide `2216` ends on: the first X past 0x58 for its step (`smoothness*4`). */
export function raceInfoIconX(smoothness) {
  const step = smoothness * 4
  let x = 0
  do x += step; while (x <= 0x58)
  return [x, 0xe0 - x]
}

/** `0400`, the shared header. `words`: `[0x156]`, a WORDS.CHR frame number (docs/engine.md §9dm):
 * nonzero draws that frame at (0xA2,8) and the divider rows -- 1 "Head to Head" (two-human play,
 * `1E4A`; H2H vs CPU, `0364`), 2 "Challenge" (`0364`); 0 (`0238`/`27F0`/`2BE8`) draws neither. */
export function header({ words = 1 } = {}) {
  const ops = [
    { op: 'clear', color: 0 }, // 0876
    { op: 'sprite', chr: 'BADGE.CHR', frame: 0, x: 0, y: 0, opaque: true }, // 0405: record 0xB7C
    { op: 'sprite', chr: 'WORDS.CHR', frame: 0, x: 0x48, y: 8, opaque: true }, // 040B-041D: record 0xCA5
  ]
  if (!words) return ops
  ops.push(
    { op: 'sprite', chr: 'WORDS.CHR', frame: words, x: 0x48 + 0x5a, y: 8, opaque: true }, // 0420-0433: frame [0x156]
    { op: 'rows', y: 0x1e, count: 1, color: 0x12 }, // 0436-043F
    { op: 'rows', y: 0x1f, count: 2, color: 0x0e }, // 0442-044B
    { op: 'rows', y: 0x21, count: 1, color: 0x12 }, // 044E-0457
  )
  return ops
}

export function portrait(x, y, character) {
  const s = portraitSprite(character, 0)
  return [
    { op: 'sprite', ...s, x, y, opaque: true }, // 0DB0 -> 053A
    { op: 'border', x: x - 1, y: y - 1, w: 50, h: 50, color: 0x0d }, // 06CC, AL=0xD
    { op: 'text', font: 'FONT1.CHR', text: PORTRAIT_NAMES[character], x, y: y + 0x31 }, // 0F3C
  ]
}

/** `240A` (+ `2481`): both portraits, their names, the tally digits (tournament only) and each
 * player's WON/LOST record and skill label. `players`: `[{ character, wins, losses }, ...]`. */
function portraitPanel(y, players, tally) {
  const ops = [...header()]
  ops.push(...portrait(H2H_P1_X, y, players[0].character), ...portrait(H2H_P2_X, y, players[1].character))
  if (tally) {
    ops.push({ op: 'text', font: 'FONT2.CHR', text: String(tally[0]), x: H2H_P1_X + 0x38, y }) // 244E-2464
    ops.push({ op: 'text', font: 'FONT2.CHR', text: String(tally[1]), x: H2H_P2_X - 0x10, y }) // 2467-247D
  }
  return ops
}

function records(y, players) {
  const ops = []
  ;[H2H_P1_X, H2H_P2_X].forEach((x, i) => {
    const { wins, losses } = players[i]
    const index = Math.max(0, Math.min(20, wins - losses + 10))
    ops.push({ op: 'text', font: 'FONT1.CHR', text: `WON${twoDigits(wins)}`, x: x - 0x18, y: y + 0x3a }) // 24B4
    ops.push({ op: 'text', font: 'FONT1.CHR', text: `LOST${twoDigits(losses)}`, x: x + 0x18, y: y + 0x3a }) // 24C0
    ops.push({ op: 'text', font: 'FONT1.CHR', text: H2H_SKILL_LABELS[H2H_SKILL_INDEX_TABLE[index]], x: x - 0x18, y: y + 0x42 }) // 24F4
  })
  return ops
}

function icons(round, xs, y) {
  return [
    { op: 'sprite', chr: 'MINATURE.CHR', frame: round - 1, x: xs[0], y }, // record 8 (0xCDB), 04B8
    { op: 'sprite', chr: 'MINATURE.CHR', frame: round - 1 + 8, x: xs[1], y, flip: true }, // record 9 (0xCF6), [0xD00]=1
  ]
}

function classNameRow(vehicleClass, blink = false) {
  return [
    { op: 'rows', y: 0xbf, count: 8, color: 0 }, // 2216's 0862 / 0C5D's 0862
    { op: 'text', font: 'FONT1.CHR', text: (blink ? CLASS_NAMES_BLINK : CLASS_NAMES)[vehicleClass - 1], centre: true, y: 0xbf },
  ]
}

/** `1EF1`: `19F2`'s two portraits (X 0x47/0x87, Y 0x24), the two labels, "CHOOSE GAME!", the two
 * SELGAM pictures, and `0382`'s THUMB pointer (X 0x68, Y 0x90, frame = selection). */
export function layoutChooseGame({ characters, selection }) {
  const ops = [...header(), ...portrait(0x47, 0x24, characters[0]), ...portrait(0x87, 0x24, characters[1])]
  ops.push({ op: 'text', font: 'FONT1.CHR', text: 'TOURNAMENT', x: 0x18, y: 0xbe }) // 1F31
  ops.push({ op: 'text', font: 'FONT1.CHR', text: 'SINGLE RACE', x: 0x9c, y: 0xbe }) // 1F40
  ops.push({ op: 'text', font: 'FONT2.CHR', text: 'CHOOSE GAME!', centre: true, y: 0x68 }) // 1F4C
  ops.push({ op: 'sprite', chr: 'SELGAM.CHR', frame: 4, x: 0x10, y: 0x7c, opaque: true }) // 1F61: record 0xC8A
  ops.push({ op: 'sprite', chr: 'SELGAM.CHR', frame: 5, x: 0x94, y: 0x7c, opaque: true }) // 1F71
  ops.push({ op: 'sprite', chr: 'THUMB.CHR', frame: selection, x: 0x68, y: 0x90 }) // 0392-0399: record 0xC6F, Y=BX=0x90
  return ops
}

/** `1FAF`'s race-info screen as it rests during `179B` (after `2216`'s last present). */
export function layoutTwoPlayerRaceInfo({ players, tally, raceNumber, round, vehicleClass = round, smoothness, iconX = raceInfoIconX(smoothness)[0] }) {
  const ops = portraitPanel(RACE_INFO_Y, players, tally)
  ops.push(...records(RACE_INFO_Y, players))
  ops.push({ op: 'text', font: 'FONT2.CHR', text: `TOURNAMENT RACE ${twoDigits(raceNumber)}`, centre: true, y: 0x6e }) // 2040-204F
  ops.push({ op: 'sprite', chr: 'INTRO.CHR', frame: round - 1, x: 0x50, y: 0x7f, opaque: true }) // 2052-206B: record 0xBB2
  ops.push(...classNameRow(vehicleClass), ...icons(round, [iconX, 0xe0 - iconX], ICONS_RACE_INFO_Y)) // 2216
  return ops
}

/** `256E`'s screen. `slideDone`: the icons have reached 0x58/0x88; `blinks`: how many `26A3`
 * XORs have run (0 = the portraits are still `240A`'s plain faces). `single`: `[0x8A5]`==0. */
export function layoutTwoPlayerResult({ players, tally, raceNumber, round, p1Won, single = false, iconX = 0x58, blinks = 0 }) {
  const ops = portraitPanel(RESULT_Y, players, single ? null : tally)
  ops.push(...records(RESULT_Y, players))
  ops.push({ op: 'text', font: 'FONT1.CHR', text: p1Won ? 'WINNER!' : 'LOSER!', x: 0x1d, y: 0x5c }) // 25DF
  ops.push({ op: 'text', font: 'FONT1.CHR', text: p1Won ? 'LOSER!' : 'WINNER!', x: 0xb1, y: 0x5c }) // 25F6
  ops.push({ op: 'text', font: 'FONT2.CHR', text: 'RESULTS!!', centre: true, y: 0x3c }) // 2611-261A
  ops.push({ op: 'text', font: 'FONT2.CHR', text: single ? 'SINGLE RACE' : `TOURNAMENT RACE ${twoDigits(raceNumber)}`, centre: true, y: 0x4c }) // 261D-263B
  ops.push(...icons(round, [iconX, 0xe0 - iconX], ICONS_RESULT_Y)) // 266F-269E
  if (blinks > 0) {
    const blink = blinks % 2 === 1
    const banks = p1Won ? [2, 3] : [3, 2] // 2609/260D: 0x200 winner, 0x300 loser
    ;[H2H_P1_X, H2H_P2_X].forEach((x, i) => ops.push({ op: 'sprite', ...portraitSprite(players[i].character, banks[i], blink), x, y: RESULT_Y, opaque: true })) // 26A3-26B1
  }
  return ops
}

/** `2329`'s SELECT VEHICLE screen. `vehicle`: false before `2193` has run (`234B`'s own
 * `AWAIT_RELEASE`, `23A9`: no picture, name or icons yet). `iconX`: the slide's current left X (the
 * resting `raceInfoIconX` once it ends). `polled`: at least one `0C5D` redraw of the class name has
 * run (`23C8`), with `blink` = `[0x26CF]`&1. */
export function layoutSingleRaceSelect({ players, round, vehicleClass, smoothness, vehicle = true, iconX = raceInfoIconX(smoothness)[0], polled = false, blink = false }) {
  const ops = portraitPanel(RACE_INFO_Y, players, null) // 2374: AX=0x24, [0x8A5]=0
  ops.push({ op: 'sprite', chr: 'THUMB.CHR', frame: 1, x: 0xb8, y: 0x88 }) // 2377-2390: record 0xC6F moved to (0xB8,0x88), frame [0xC82]
  ops.push(...records(RACE_INFO_Y, players))
  ops.push({ op: 'text', font: 'FONT2.CHR', text: 'SELECT VEHICLE', centre: true, y: 0x6e }) // 239D-23A6
  if (!vehicle) return ops
  ops.push({ op: 'sprite', chr: 'INTRO.CHR', frame: round - 1, x: 0x50, y: 0x7f, opaque: true }) // 21EA-21FD
  ops.push(...classNameRow(vehicleClass), ...icons(round, [iconX, 0xe0 - iconX], ICONS_RACE_INFO_Y)) // 2200: 2216
  if (polled) ops.push(...classNameRow(vehicleClass, blink)) // 23C8: 0C5D
  return ops
}

/** `2216`'s icon X after `k` of its iterations (0 = not yet moved), clamped at its resting X. */
export function slideIconX(k, smoothness) {
  return Math.min(k * smoothness * 4, raceInfoIconX(smoothness)[0])
}

/** Paints a layout into a 256x200 work buffer. */
export function paintOps(buf, arena, ops) {
  const { w, h } = MENU_VIEW
  for (const o of ops) {
    if (o.op === 'clear') buf.fill(o.color)
    else if (o.op === 'rows') buf.fill(o.color, o.y * w, Math.min(h, o.y + o.count) * w)
    else if (o.op === 'border') {
      const put = (x, y) => { if (x >= 0 && x < w && y >= 0 && y < h) buf[y * w + x] = o.color }
      for (let x = o.x; x < o.x + o.w; x++) { put(x, o.y); put(x, o.y + o.h - 1) }
      for (let y = o.y; y < o.y + o.h; y++) { put(o.x, y); put(o.x + o.w - 1, y) }
    } else if (o.op === 'sprite') {
      blitTransparent(buf, w, h, o.x, o.y, chrFrame(arena, rec(o.chr), o.frame), { colorKey: o.opaque ? -1 : 0, flip: !!o.flip })
    } else if (o.op === 'rect') {
      for (let y = o.y; y < Math.min(h, o.y + o.h); y++) buf.fill(o.color, y * w + Math.max(0, o.x), y * w + Math.min(w, o.x + o.w)) // 0823
    } else if (o.op === 'call') {
      o.fn(buf, arena) // a renderer that is already exact on its own (e.g. drawOptionsScreen's body)
    } else if (o.op === 'text') {
      const x = o.centre ? 0x7f - 4 * o.text.length : o.x
      if (!o.glyphClip) drawString(buf, arena, rec(o.font), o.text, x, o.y)
      else {
        // 0929's own clip: a glyph starting left of 0 is skipped whole, and drawing stops once a
        // glyph would start at X >= 0xFF (docs/engine.md §9dm).
        for (let k = 0; k < o.text.length; k++) {
          const cx = x + 8 * k
          if (cx >= 0xff) break
          if (cx >= 0) drawString(buf, arena, rec(o.font), o.text[k], cx, o.y)
        }
      }
    }
  }
}
