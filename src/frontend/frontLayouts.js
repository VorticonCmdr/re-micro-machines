// The one-player front-end screens as the original draws them (docs/engine.md §9dm), in the same
// op-list form as h2hScreens.js, painted by its paintOps. `FRONT_SCREENS` maps each live capture in
// tools/refs/front/ to the layout of the state it shows; tools/check-front.mjs diffs them. Each entry
// takes `ctx` = `{ settings }` (the parsed SETTINGS.DAT the capture ran with).
import { header, portrait, PORTRAIT_NAMES } from './h2hScreens.js'
import { drawOptionsScreen, drawJoystickCalibrationScreen, redefineKeyChar } from './screens.js'
import { caseImage } from '../formats/chr.js'
import { blitTransparent } from '../render/blit.js'
import { MENU_VIEW } from '../render/menuView.js'
import { ORDER_TABLE, BOARD_ICON_POSITIONS, REDEFINE_GROUP_LABELS, REDEFINE_SLOT_LABELS, CREDITS_LINES } from '../data/frontend-tables.js'

/** GAME OPTIONS (`2770`): the `0400` header (`[0x156]`=0), then the body `drawOptionsScreen` draws
 * (exact below row 30 since §9cu). */
export function layoutOptions({ settings, joystick = false }) {
  return [...header({ words: 0 }), { op: 'call', fn: (buf, arena) => drawOptionsScreen(buf, arena, { settings, joystick }) }]
}

/** F7's joystick calibration (`2AB5`) on the same `0400` header. */
export function layoutJoyCal({ columns, prompt }) {
  return [...header({ words: 0 }), { op: 'call', fn: (buf, arena) => drawJoystickCalibrationScreen(buf, arena, { columns, prompt }) }]
}

/** F6's credits (`ShowCredits 2A82`): the `0400` header, then the ten lines of `DS:0F75` (`08F0`,
 * FONT2, x 0 -- the indent is the strings' own spaces) from y 0x2D, 0x10 apart. */
export function layoutCredits() {
  return [...header({ words: 0 }), ...CREDITS_LINES.map((text, i) => ({ op: 'text', font: 'FONT2.CHR', text, x: 0, y: 0x2d + 0x10 * i }))]
}

/** F5's redefine keys (`RunRedefineKeysScreen 92F0`): the `0400` header, then a y cursor from 0x28.
 * Before slots 0 and 5 the group name ("KEYS 1"/"KEYS 2", `DS:AE3D`/`AE44`, FONT2) at x 0xA and
 * y += 0x11 (`931C-9339`); each slot's label (`08F0`, the n-th of `DS:AE4B`, which carry a leading
 * space) FONT1 at x 0x14 (`933B-9344`); once its key is taken, the key's character (`ADF0`'s table,
 * '?' otherwise) FONT1 at x 0x6E, and y += 0xA (`9392-939F`). Nothing is cleared between slots.
 * `slots`: the scancodes taken so far; `slotIndex`: the slot being asked for (10 when done). */
export function layoutRedefineKeys({ slots, slotIndex }) {
  const ops = [...header({ words: 0 })]
  let y = 0x28
  for (let slot = 0; slot <= Math.min(slotIndex, 9); slot++) {
    const n = slot % REDEFINE_SLOT_LABELS.length
    if (n === 0) { ops.push({ op: 'text', font: 'FONT2.CHR', text: REDEFINE_GROUP_LABELS[slot / REDEFINE_SLOT_LABELS.length], x: 0xa, y }); y += 0x11 }
    ops.push({ op: 'text', font: 'FONT1.CHR', text: ` ${REDEFINE_SLOT_LABELS[n]}`, x: 0x14, y })
    if (slots[slot] == null) break // 9357: waiting for this slot's key
    ops.push({ op: 'text', font: 'FONT1.CHR', text: redefineKeyChar(slots[slot]), x: 0x6e, y })
    y += 0xa
  }
  return ops
}

/** The class names in `DS:002F` order (`0C5D`/`020E`'s NUL-walk). */
const CLASS_NAMES = ['SPORTSCARS', 'POWERBOATS', 'FORMULA ONE', 'TURBO WHEELS', 'FOUR BY FOUR', 'WARRIORS', 'TANKS', 'CHOPPERS', 'RUFFTRUX']

/** The title, `RunTitleScreenAttractLoop 0100` + `01DE`: clear; LOGO (slot `0B97`, static (8,0))
 * transparent (`0160`); "COPYRIGHT CODEMASTERS SOFTWARE" (`DS:0010`) FONT2 centred at y 0xB7
 * (`0163`); then per class (`[0BC5]`, every 280 ticks): INTRO opaque at (0x50,0x64) frame
 * `[0BC5]`, rows 0xA4-0xAB cleared (`01F7`), the class name FONT1 centred at y 0xA4 (`020E`). */
export function layoutTitle({ classIndex }) {
  return [
    { op: 'clear', color: 0 }, // 015A
    { op: 'sprite', chr: 'LOGO.CHR', frame: 0, x: 8, y: 0 }, // 0160
    { op: 'text', font: 'FONT2.CHR', text: 'COPYRIGHT CODEMASTERS SOFTWARE', centre: true, y: 0xb7 }, // 0163-016C
    { op: 'sprite', chr: 'INTRO.CHR', frame: classIndex, x: 0x50, y: 0x64, opaque: true }, // 01DF-01F4
    { op: 'rows', y: 0xa4, count: 8, color: 0 }, // 01F7
    { op: 'text', font: 'FONT1.CHR', text: CLASS_NAMES[classIndex], centre: true, y: 0xa4 }, // 020E
  ]
}

/** THUMB (slot `0C6F`, static x 0x68), `0382`'s pointer: frame = the selection (0 fist, 1 finger,
 * 2 thumbs-up), drawn with save-under, presented, then restored -- so it is on screen but not in the
 * work buffer. */
const thumb = (y, selection) => ({ op: 'sprite', chr: 'THUMB.CHR', frame: selection, x: 0x68, y })

/** SELECT GAME, `0220` (no `0400` header, `[0x156]`=0 at `0238`) + `0382` with BX=0x80. */
export function layoutSelectGame({ selection }) {
  return [
    { op: 'clear', color: 0 }, // 0244
    { op: 'sprite', chr: 'LOGO.CHR', frame: 0, x: 8, y: 0 }, // 024A
    { op: 'text', font: 'FONT2.CHR', text: 'SELECT GAME', centre: true, y: 0x5e }, // 0256: DS:0134
    { op: 'text', font: 'FONT1.CHR', text: 'ONE PLAYER', x: 0x18, y: 0x6f }, // 0265: DS:0140
    { op: 'text', font: 'FONT1.CHR', text: 'TWO PLAYER', x: 0x9c, y: 0x6f }, // 0274: DS:014B
    { op: 'sprite', chr: 'SELGAM.CHR', frame: 0, x: 0x10, y: 0x76, opaque: true }, // 0289
    { op: 'sprite', chr: 'SELGAM.CHR', frame: 1, x: 0x94, y: 0x76, opaque: true }, // 0296
    { op: 'sprite', chr: 'WORDS.CHR', frame: 2, x: 0x18, y: 0xb7, opaque: true }, // 02AB: "Challenge"
    { op: 'sprite', chr: 'WORDS.CHR', frame: 1, x: 0x9c, y: 0xb7, opaque: true }, // 02B8: "Head to Head"
    thumb(0x80, selection), // 0382, BX=0x80
  ]
}

/** ONE PLAYER GAME, `02E0`: the `0400` header, then + `0382` with BX=0x6E. */
export function layoutOnePlayerGame({ selection }) {
  return [
    ...header({ words: 0 }), // 02E8
    { op: 'text', font: 'FONT2.CHR', text: 'ONE PLAYER', x: 0x58, y: 0x32 }, // 02EF: DS:0140
    { op: 'text', font: 'FONT2.CHR', text: 'GAME', x: 0x70, y: 0x44 }, // 02FE: DS:013B
    { op: 'text', font: 'FONT2.CHR', text: 'SELECT GAME', x: 0x58, y: 0xb6 }, // 030D: DS:0134, not centred
    { op: 'sprite', chr: 'SELGAM.CHR', frame: 2, x: 0x10, y: 0x58, opaque: true },
    { op: 'sprite', chr: 'SELGAM.CHR', frame: 3, x: 0x94, y: 0x58, opaque: true },
    { op: 'sprite', chr: 'WORDS.CHR', frame: 1, x: 0x18, y: 0x99, opaque: true }, // "Head to Head"
    { op: 'sprite', chr: 'WORDS.CHR', frame: 2, x: 0xa4, y: 0x99, opaque: true }, // "Challenge", clipped at x 0x100
    thumb(0x6e, selection), // 0382, BX=0x6E
  ]
}

/** `DS:02B1`, the skill labels in 8-byte slots as `0F17` draws them (short ones space-padded). */
const SKILL_LABELS = [' DIRE ', ' RASH ', ' FAIR ', 'SMOOTH', ' ABLE ', ' POOR ', 'SLICK!', 'CRAZY!', ' WILD ', ' FAB! ', ' ACE! ']

/** `0DB0`'s FCNORMAL frame for a roster/slot byte: 0x20 (eliminated) first -> 12, 0x40 (taken) ->
 * 13, else the character (0xB = the red "?"). */
const faceFrameOf = (v) => (v & 0x20 ? 12 : v & 0x40 ? 13 : v & 0x1f)

/** `19F2`: the four-slot panel -- per slot at X 8+0x40i, Y 0x24: the portrait (`0DB0`, opaque; the
 * slot's frame field masked with 0x4F), a 0xD border (`06CC`), and the name at (X, 0x55) (`0F3C`) --
 * or, for an unpicked slot (`v&0xF` >= 0xB), a black 48x8 rect there instead. */
// `19F2`: the face panel -- four slots from x 8 in Challenge, two from x 0x47 in Head to Head vs CPU
// (`[0x3F8]`!=0, `19FE-1A08`), 0x40 apart, at y 0x24.
function panel4(slots, x0 = 8) {
  const ops = []
  slots.forEach((v, i) => {
    const x = x0 + 0x40 * i, y = 0x24
    ops.push({ op: 'sprite', chr: 'FCNORMAL.CHR', frame: faceFrameOf(v & 0x4f), x, y, opaque: true })
    ops.push({ op: 'border', x: x - 1, y: y - 1, w: 50, h: 50, color: 0x0d })
    if ((v & 0xf) >= 0xb) ops.push({ op: 'rect', x, y: y + 0x31, w: 0x30, h: 8, color: 0 })
    else ops.push({ op: 'text', font: 'FONT1.CHR', text: PORTRAIT_NAMES[v & 0xf], x, y: y + 0x31 })
  })
  return ops
}

/** `0D1F`'s carousel and `0E02`'s selection frame. `scroll`: `[0x192]`, the first face's DX (settled
 * on character c it is ((5-c) mod 11)*0x40, `settledScroll`); face i sits at X = DX-0xD8.
 * `roster`: `DS:0164..016E`. `blinkOn`: the commit blink shows the centred face as frame 13 (the
 * port's stand-in for `0DB0`'s blink, not measured). */
function carousel(scroll, roster, blinkOn = false) {
  const ops = [
    { op: 'rows', y: 0x77, count: 7, color: 0x0e }, { op: 'rows', y: 0x7e, count: 1, color: 0x12 },
    { op: 'rows', y: 0x7f, count: 0x30, color: 0 }, { op: 'rows', y: 0xaf, count: 1, color: 0x12 },
    { op: 'rows', y: 0xb0, count: 8, color: 0x0e },
  ]
  let dx = scroll
  for (let i = 0; i < 11; i++) {
    const x = dx - 0xd8, v = roster[i]
    if (!(x < 0 && x + 48 <= 0) && x < 0x100) { // 0630: a dropped face gets no text either
      const frame = blinkOn && x === 0x68 ? 13 : faceFrameOf(v)
      ops.push({ op: 'sprite', chr: 'FCNORMAL.CHR', frame, x, y: 0x7f, opaque: true })
      ops.push({ op: 'text', font: 'FONT1.CHR', text: PORTRAIT_NAMES[v & 0xf], x, y: 0xb0, glyphClip: true }) // 0F17, CX=0xB0
      ops.push({ op: 'text', font: 'FONT1.CHR', text: SKILL_LABELS[v & 0xf], x, y: 0x77, glyphClip: true })
    }
    dx += 0x40
    if (dx >= 0x2c0) dx -= 0x2c0
  }
  // 0E02: two full-width rows, then FRAME.CHR's 8x8 pieces (opaque) round the centred face.
  ops.push({ op: 'rows', y: 0x76, count: 1, color: 0x12 }, { op: 'rows', y: 0xb7, count: 1, color: 0x12 })
  const piece = (frame, x, y, flip = false) => ops.push({ op: 'sprite', chr: 'FRAME.CHR', frame, x, y, opaque: true, flip })
  piece(2, 0x9c, 0xb6, true); piece(2, 0x5c, 0xb6); piece(1, 0x5c, 0x6e); piece(1, 0x9c, 0x6e, true)
  for (let x = 0x64; x <= 0x94; x += 8) { piece(3, x, 0x6e, true); piece(3, x, 0xb6) }
  for (let y = 0x76; y <= 0xae; y += 8) { piece(0, 0x5c, y); piece(0, 0x9c, y, true) }
  return ops
}

/** `0C96`'s prompt: rows 0x62-0x69 cleared, the text (FONT1, centred) only while `[0x26CF]`&1. */
const prompt = (text, on) => [{ op: 'rows', y: 0x62, count: 8, color: 0 }, ...(on ? [{ op: 'text', font: 'FONT1.CHR', text, centre: true, y: 0x62 }] : [])]

/** The Challenge character select (`102B` -> `09E0`): header "Challenge", the single "?" panel at
 * (0x68,0x27) with its border (`105B-1072`), the carousel on `c`, the prompt. */
export const settledScroll = (c) => ((((5 - c) % 11) + 11) % 11) * 0x40
// `picked`: after the commit (`0B37` writes the pick into the panel's descriptor) the panel shows that
// face and its name under it (`0F3C`, y+0x31) -- what PRESS ANY KEY (`0C15`) is drawn over.
export function layoutCharSelect({ scroll, roster, promptOn = true, blinkOn = false, picked = null, promptText = 'WHO DO YOU WANT TO BE ?' }) {
  return [
    ...header({ words: 2 }),
    { op: 'sprite', chr: 'FCNORMAL.CHR', frame: picked ?? 11, x: 0x68, y: 0x27, opaque: true },
    { op: 'border', x: 0x67, y: 0x26, w: 50, h: 50, color: 0x0d },
    ...(picked != null ? [{ op: 'text', font: 'FONT1.CHR', text: PORTRAIT_NAMES[picked], x: 0x68, y: 0x27 + 0x31 }] : []),
    ...carousel(scroll, roster, blinkOn),
    ...prompt(promptText, promptOn),
  ]
}

/** `0C15` ("PRESS ANY KEY TO START"): no screen of its own. It points `0C96`'s prompt (`[0x19A]`) at
 * `DS:0241` (FONT1, y 0x62, `0C1B-0C27`) and calls it every tick, so the text blinks in the prompt
 * row of whatever carousel is still on screen (docs/engine.md §9dr 7). */
export const pressAnyKeyPrompt = (on) => prompt('PRESS ANY KEY TO START', on)

/** The opponent picker (`1A4A` -> `19F2` -> `09E0`): the four-slot panel, the carousel, "WHO DO YOU
 * WANT TO RACE ?". */
export function layoutPicker({ slots, scroll, roster, promptOn = true, blinkOn = false, promptText = 'WHO DO YOU WANT TO RACE ?' }) {
  return [...header({ words: 2 }), ...panel4(slots), ...carousel(scroll, roster, blinkOn), ...prompt(promptText, promptOn)]
}

/** Head to Head vs CPU's two picks (`0FBF` -> `19F2` -> `09E0`): header "Head to Head", the
 * two-slot panel at x 0x47 (the player, then the opponent; 0xB = not picked), the carousel, the
 * prompt ("WHO DO YOU WANT TO BE ?" `DS:020F`, then "WHO DO YOU WANT TO RACE ?" `DS:0227`), and
 * PRESS ANY KEY (`0C15`) in the same row after the second pick. */
export function layoutH2hCpuPick({ slots, scroll, roster, promptText, promptOn = true, blinkOn = false }) {
  return [...header({ words: 1 }), ...panel4(slots, 0x47), ...carousel(scroll, roster, blinkOn), ...prompt(promptText, promptOn)]
}

/** The round-9 bonus race's intro (`11F8`, `[0x28BF]`==9, `1219-126A`): header, "TRIPLE WIN !!!",
 * "BONUS RACE", "BEAT THE CLOCK" (`DS:03BF`/`03CE`/`03D9`, FONT2 centred at y 0x28/0x38/0x48), the
 * RUFFTRUX picture (`[0BC5]`=8, y 0x5A) and "TIMETRIALS" (`DS:03E8`, FONT1 centred, y 0xA2). */
export function layoutBonusIntro() {
  return [
    ...header({ words: 2 }),
    { op: 'text', font: 'FONT2.CHR', text: 'TRIPLE WIN !!!', centre: true, y: 0x28 },
    { op: 'text', font: 'FONT2.CHR', text: 'BONUS RACE', centre: true, y: 0x38 },
    { op: 'text', font: 'FONT2.CHR', text: 'BEAT THE CLOCK', centre: true, y: 0x48 },
    ...classPicture(9, 0x5a),
    { op: 'text', font: 'FONT1.CHR', text: 'TIMETRIALS', centre: true, y: 0xa2 },
  ]
}

/** `01DE` with `[0BB6]` = y: INTRO frame (opaque) at (0x50,y), the 8 rows under it cleared, the
 * class name FONT1 centred there. */
function classPicture(vehicleClass, y) {
  return [
    { op: 'sprite', chr: 'INTRO.CHR', frame: vehicleClass - 1, x: 0x50, y, opaque: true },
    { op: 'rows', y: y + 0x40, count: 8, color: 0 },
    { op: 'text', font: 'FONT1.CHR', text: CLASS_NAMES[vehicleClass - 1], centre: true, y: y + 0x40 },
  ]
}

/** The qualifier's intro (`127E-12BA`): header, "QUALIFYING"/"RACE" (`DS:035C`/`0367`, FONT2), the
 * class picture at y 0x5A. */
export function layoutQualifierIntro({ vehicleClass }) {
  return [
    ...header({ words: 2 }),
    { op: 'text', font: 'FONT2.CHR', text: 'QUALIFYING', x: 0x58, y: 0x32 },
    { op: 'text', font: 'FONT2.CHR', text: 'RACE', x: 0x70, y: 0x46 },
    ...classPicture(vehicleClass, 0x5a),
  ]
}

/** A Challenge race intro (`12BD`...) as it rests at `179B`: the four-slot panel, the race line
 * (`1867`: the track name at X = ((0xFF-((len+1)*8+0x40))>>1)+0x40, FONT2, y 0x6C, and "RACE nn"
 * -- `1A34`'s two digits, a space for a zero tens -- at X-0x40), the class picture at y 0x80, and
 * the four MINATURE icons (frame round-1+8k, mirrored, transparent) at rest at X 0x10+0x40k, Y 0x5A. */
export function layoutRaceIntro({ slots, raceNumber, trackName, round, vehicleClass = round, last = false, h2h = false }) {
  const x = ((0xff - ((trackName.length + 1) * 8 + 0x40)) >> 1) + 0x40
  const digits = `${raceNumber >= 10 ? Math.floor(raceNumber / 10) : ' '}${raceNumber % 10}`
  const x0 = h2h ? 0x47 : 8
  const ops = [...header({ words: h2h ? 1 : 2 }), ...panel4(slots, x0)]
  if (last) ops.push({ op: 'text', font: 'FONT2.CHR', text: trackName, centre: true, y: 0x6c }) // 1888: [28C1]==[439], the slot's own string centred
  else {
    ops.push({ op: 'text', font: 'FONT2.CHR', text: trackName, x, y: 0x6c })
    ops.push({ op: 'text', font: 'FONT2.CHR', text: `RACE ${digits}`, x: x - 0x40, y: 0x6c })
  }
  ops.push(...classPicture(vehicleClass, 0x80))
  // The icons slide in (131F-1393). Four-car: all four from the right to 0x10+0x40k. Head to Head vs
  // CPU (130E-1314, 135B-1375): the first from -0x20 by +2 until it reaches 0x54, the second from
  // 0x100 by -2 over the same 58 steps, so they rest at 0x54 and 0x8C; the first is not mirrored
  // (131A clears its flip byte, [0xCE5]), so it faces the way it slid in.
  const iconX = h2h ? [0x54, 0x8c] : [0x10, 0x50, 0x90, 0xd0]
  for (let k = 0; k < slots.length; k++) ops.push({ op: 'sprite', chr: 'MINATURE.CHR', frame: round - 1 + 8 * k, x: iconX[k], y: 0x5a, flip: !(h2h && k === 0) })
  return ops
}

/** `1867`'s race line at `y`: the track name at X = ((0xFF-((len+1)*8+0x40))>>1)+0x40 and "RACE nn"
 * (`1A34`) at X-0x40, FONT2; the last race only the slot's own string, centred (`1888`). */
function raceLine(y, raceNumber, trackName, last) {
  if (last) return [{ op: 'text', font: 'FONT2.CHR', text: trackName, centre: true, y }]
  const x = ((0xff - ((trackName.length + 1) * 8 + 0x40)) >> 1) + 0x40
  const digits = `${raceNumber >= 10 ? Math.floor(raceNumber / 10) : ' '}${raceNumber % 10}`
  return [{ op: 'text', font: 'FONT2.CHR', text: trackName, x, y }, { op: 'text', font: 'FONT2.CHR', text: `RACE ${digits}`, x: x - 0x40, y }]
}

const RESULT_FACES = [[0x3f, 0x47], [0x86, 0x47], [0x3f, 0x8f], [0x86, 0x8f]] // records [3FC]/[3FE]/[400]/[402]
const RESULT_ICONS = [[6, 0x6f, false], [0xc8, 0x6f, true], [6, 0xb7, false], [0xc8, 0xb7, true]] // resting X after the slide

/** The results screen (`13E4`, Challenge) as it rests in its `17FF` windows. `places`: the four
 * finishers in order, `{ character, car }`; `playerPlace`: 0-3; `passed`: QUALIFY vs FAILED; `b`:
 * the blink phase of the 1st/4th faces (1 on the first present). Header; "RESULTS!" (`DS:036C`)
 * FONT2 centred at y 0x25; the race line at y 0x34; NOS digits 1-4 opaque; the faces' borders
 * (colour 0xF, `150A`); per place its MINATURE icon (frame round-1 + 8*car, opaque after the slide,
 * the right ones mirrored), its name, and for the player QUALIFY/FAILED (`DS:039A`/`03A2`, FONT1,
 * x 4 left or 0xBC right, y face+0x20); then the faces in their result banks: 1st FCHAPPY
 * char*2+b, 2nd FCNORMAL, 3rd FCFROWN, 4th FCSAD char*2+b. */
export function layoutResults({ raceNumber, trackName, last = false, round, places, playerPlace, passed, b = 1 }) {
  const ops = [...header({ words: 2 }), { op: 'text', font: 'FONT2.CHR', text: 'RESULTS!', centre: true, y: 0x25 }, ...raceLine(0x34, raceNumber, trackName, last)]
  ;[[0, 7, 0x47], [2, 7, 0x8f], [1, 0xc6, 0x47], [3, 0xc6, 0x8f]].forEach(([f, x, y]) => ops.push({ op: 'sprite', chr: 'NOS.CHR', frame: f, x, y, opaque: true }))
  RESULT_FACES.forEach(([x, y]) => ops.push({ op: 'border', x: x - 1, y: y - 1, w: 50, h: 50, color: 0x0f }))
  places.forEach(({ character, car }, k) => {
    const [x, y] = RESULT_FACES[k], [ix, iy, flip] = RESULT_ICONS[k]
    ops.push({ op: 'sprite', chr: 'MINATURE.CHR', frame: round - 1 + 8 * car, x: ix, y: iy, opaque: true, flip })
    ops.push({ op: 'text', font: 'FONT1.CHR', text: PORTRAIT_NAMES[character], x, y: y + 0x31 })
    if (k === playerPlace) ops.push({ op: 'text', font: 'FONT1.CHR', text: passed ? 'QUALIFY' : 'FAILED', x: k % 2 === 0 ? 4 : 0xbc, y: y + 0x20 })
  })
  const bank = [['FCHAPPY.CHR', true], ['FCNORMAL.CHR', false], ['FCFROWN.CHR', false], ['FCSAD.CHR', true]]
  places.forEach(({ character }, k) => {
    const [x, y] = RESULT_FACES[k], [chr, blinks] = bank[k]
    ops.push({ op: 'sprite', chr, frame: blinks ? character * 2 + b : character, x, y, opaque: true })
  })
  return ops
}

/** The outcome message (`1C1B`), resting: header; the player's name at (0x68,0x77) and a 0xD border
 * round (0x68,0x46); message `code` (`DS:081F`) FONT2 centred at y 0x32; "LIVES nn" (`DS:0893`,
 * FONT1, (0x60,0x8C)) except for codes 0 and 4; the face opaque at (0x68,0x46) -- FCHAPPY for odd
 * codes, FCSAD for even, frame char*2+b. */
export function layoutOutcome({ code, message, character, lives, b, words = 2 }) {
  const ops = [
    ...header({ words }),
    { op: 'text', font: 'FONT1.CHR', text: PORTRAIT_NAMES[character], x: 0x68, y: 0x77 },
    { op: 'border', x: 0x67, y: 0x45, w: 50, h: 50, color: 0x0d },
    { op: 'text', font: 'FONT2.CHR', text: message, centre: true, y: 0x32 },
  ]
  if (code !== 0 && code !== 4) ops.push({ op: 'text', font: 'FONT1.CHR', text: `LIVES ${lives >= 10 ? Math.floor(lives / 10) : ' '}${lives % 10}`, x: 0x60, y: 0x8c })
  ops.push({ op: 'sprite', chr: code % 2 ? 'FCHAPPY.CHR' : 'FCSAD.CHR', frame: character * 2 + b, x: 0x68, y: 0x46, opaque: true })
  return ops
}

/** The tournament board (`18D8`/`198E`): header; CASE's tile map (`0710`, opaque) at (-1,32); an icon
 * per `ORDER_TABLE[1..raceIndex]` at `DS:0312`'s position, frame (round-1)+8*(race-1), transparent;
 * the newest one blinks (`iconOn`). */
export function layoutBoard({ raceIndex, iconOn }) {
  const ops = [...header({ words: 2 }), { op: 'call', fn: (buf, arena) => blitTransparent(buf, MENU_VIEW.w, MENU_VIEW.h, -1, 32, caseImage(arena), { colorKey: -1 }) }]
  for (let i = 1; i <= raceIndex; i++) {
    if (i === raceIndex && !iconOn) continue
    const { round, race } = ORDER_TABLE[i], { x, y } = BOARD_ICON_POSITIONS[i - 1]
    ops.push({ op: 'sprite', chr: 'MINATURE.CHR', frame: round - 1 + 8 * (race - 1), x, y })
  }
  return ops
}

/** The elimination screen (`16DE`) at its `179B` wait, after the bounce: `19F2`'s panel with the
 * victim's slot ORed with 0x40 (FCNORMAL frame 13, all colour 0, its name still drawn), the victim's
 * name (`DS:0258`) FONT2 at (0x48,0x64) and "IS OUT!!" (`DS:03B6`) at (0x80,0x64). */
export function layoutEliminated({ slots, victimSlot }) {
  const panelSlots = slots.map((v, i) => (i === victimSlot ? v | 0x40 : v))
  const ops = [...header({ words: 2 })]
  panelSlots.forEach((v, i) => {
    const x = 8 + 0x40 * i
    ops.push({ op: 'sprite', chr: 'FCNORMAL.CHR', frame: faceFrameOf(v & 0x4f), x, y: 0x24, opaque: true })
    ops.push({ op: 'border', x: x - 1, y: 0x23, w: 50, h: 50, color: 0x0d })
    ops.push({ op: 'text', font: 'FONT1.CHR', text: PORTRAIT_NAMES[v & 0xf], x, y: 0x55 })
  })
  ops.push({ op: 'text', font: 'FONT2.CHR', text: 'IS OUT!!', x: 0x80, y: 0x64 })
  ops.push({ op: 'text', font: 'FONT2.CHR', text: PORTRAIT_NAMES[slots[victimSlot] & 0xf], x: 0x48, y: 0x64 })
  return ops
}

/** The champion screen (`1AAD`) at the end of its slide: header; CUP frame 0 opaque at (0x50,0x5A);
 * a colour-0xF band (0x68-0x97, 0x62-0x65); the FCHAPPY face (char*2+b) transparent at (0x68,0x35);
 * rows 0x26-0x35 cleared and "CHAMPIONSHIP WINNER!!" (`DS:0384`) FONT2 at (titleX, 0x26) -- 0x26 on
 * the slide's last iteration, 0x28 from the next one on; CUP frame 1 transparent at (0x50,0x62) and
 * frames 2-9 opaque below it; rows 0xA4-0xB3 cleared and the name FONT2 at (0x68,0xA4). */
export function layoutChampion({ character, b, titleX = 0x28, words = 2 }) {
  const ops = [
    ...header({ words }),
    { op: 'sprite', chr: 'CUP.CHR', frame: 0, x: 0x50, y: 0x5a, opaque: true },
    { op: 'rect', x: 0x68, y: 0x62, w: 0x30, h: 4, color: 0x0f },
    { op: 'sprite', chr: 'FCHAPPY.CHR', frame: character * 2 + b, x: 0x68, y: 0x35 },
    { op: 'rows', y: 0x26, count: 16, color: 0 },
    { op: 'text', font: 'FONT2.CHR', text: 'CHAMPIONSHIP WINNER!!', x: titleX, y: 0x26 },
    { op: 'sprite', chr: 'CUP.CHR', frame: 1, x: 0x50, y: 0x62 },
  ]
  for (let f = 2; f <= 9; f++) ops.push({ op: 'sprite', chr: 'CUP.CHR', frame: f, x: 0x50, y: 0x6a + 8 * (f - 2), opaque: true })
  ops.push({ op: 'rows', y: 0xa4, count: 16, color: 0 }, { op: 'text', font: 'FONT2.CHR', text: PORTRAIT_NAMES[character], x: 0x68, y: 0xa4 })
  return ops
}

const FREE_ROSTER = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

export const FRONT_SCREENS = {
  results_lost: () => layoutResults({ raceNumber: 1, trackName: 'THE BREAKFAST BENDS', round: 5, places: [{ character: 0, car: 1 }, { character: 1, car: 2 }, { character: 2, car: 3 }, { character: 10, car: 0 }], playerPlace: 3, passed: false, b: 1 }),
  outcome_qualified: () => layoutOutcome({ code: 1, message: 'QUALIFIED FOR CHALLENGE!', character: 10, lives: 3, b: 1 }),
  outcome_lifelost: () => layoutOutcome({ code: 2, message: 'ONE LIFE LOST', character: 10, lives: 2, b: 0 }),
  outcome_failed: () => layoutOutcome({ code: 0, message: 'FAILED TO QUALIFY!', character: 10, lives: 3, b: 1 }),
  board_a: () => layoutBoard({ raceIndex: 1, iconOn: false }),
  board_b: () => layoutBoard({ raceIndex: 1, iconOn: true }),
  eliminated: () => layoutEliminated({ slots: [10, 0, 1, 2], victimSlot: 1 }),
  champion: () => layoutChampion({ character: 10, b: 0, titleX: 0x26 }),
  charselect: () => layoutCharSelect({ scroll: settledScroll(10), roster: FREE_ROSTER }),
  pressanykey: () => layoutCharSelect({ scroll: settledScroll(10), roster: FREE_ROSTER.map((v) => (v === 10 ? 0x4a : v)), picked: 10, promptText: 'PRESS ANY KEY TO START' }),
  picker: () => layoutPicker({ slots: [10, 0xb, 0xb, 0xb], scroll: settledScroll(0), roster: FREE_ROSTER.map((v) => (v === 10 ? 0x4a : v)) }),
  qualintro: () => layoutQualifierIntro({ vehicleClass: 2 }),
  raceintro: () => layoutRaceIntro({ slots: [10, 0, 1, 2], raceNumber: 1, trackName: 'THE BREAKFAST BENDS', round: 5 }),
  title: () => layoutTitle({ classIndex: 1 }),
  selectgame: () => layoutSelectGame({ selection: 1 }),
  oneplayer: () => layoutOnePlayerGame({ selection: 0 }),
  options: (ctx) => layoutOptions({ settings: ctx.settings }),
  options_f7: (ctx) => layoutOptions({ settings: ctx.settings, joystick: true }),
  redefine: () => layoutRedefineKeys({ slots: [0x3f], slotIndex: 1 }), // F5's auto-repeat was taken as LEFT, live (§9dr 8)
  credits: () => layoutCredits(),
  outcome_nobonus: () => layoutOutcome({ code: 4, message: 'NO BONUS', character: 10, lives: 10, b: 1 }),
  bonus_raceintro: () => layoutBonusIntro(),
  // Head to Head vs CPU (§9dr 10): SPIDER, then BONNIE (the static [0x3F6]=9 start)
  h2hcpu_pick: () => layoutH2hCpuPick({ slots: [0xb, 0xb], scroll: settledScroll(10), roster: FREE_ROSTER, promptText: 'WHO DO YOU WANT TO BE ?' }),
  h2hcpu_opponent: () => layoutH2hCpuPick({ slots: [10, 0xb], scroll: settledScroll(9), roster: FREE_ROSTER.map((v) => (v === 10 ? 0x4a : v)), promptText: 'WHO DO YOU WANT TO RACE ?', promptOn: false }),
  h2hcpu_pressanykey: () => layoutH2hCpuPick({ slots: [10, 9], scroll: settledScroll(9), roster: FREE_ROSTER.map((v) => (v === 10 ? 0x4a : v === 9 ? 0x49 : v)), promptText: 'PRESS ANY KEY TO START' }),
  h2hcpu_raceintro: () => layoutRaceIntro({ slots: [10, 9], raceNumber: 1, trackName: 'THE BREAKFAST BENDS', round: 5, h2h: true }),
  joycal_centre: () => layoutJoyCal({ columns: [['CENTRE'], null], prompt: true }),
  joycal_right: () => layoutJoyCal({ columns: [['CENTRE', 'LEFT', 'RIGHT'], null], prompt: true }),
}
