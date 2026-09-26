// The one-player front-end screens as the original draws them (docs/engine.md §9dm), in the same
// op-list form as h2hScreens.js, painted by its paintOps. `FRONT_SCREENS` maps each live capture in
// tools/refs/front/ to the layout of the state it shows; tools/check-front.mjs diffs them. Each entry
// takes `ctx` = `{ settings }` (the parsed SETTINGS.DAT the capture ran with).
import { header, portrait, PORTRAIT_NAMES } from './h2hScreens.js'
import { drawOptionsScreen, drawJoystickCalibrationScreen } from './screens.js'

/** GAME OPTIONS (`2770`): the `0400` header (`[0x156]`=0), then the body `drawOptionsScreen` draws
 * (exact below row 30 since §9cu). */
export function layoutOptions({ settings, joystick = false }) {
  return [...header({ words: 0 }), { op: 'call', fn: (buf, arena) => drawOptionsScreen(buf, arena, { settings, joystick }) }]
}

/** F7's joystick calibration (`2AB5`) on the same `0400` header. */
export function layoutJoyCal({ columns, prompt }) {
  return [...header({ words: 0 }), { op: 'call', fn: (buf, arena) => drawJoystickCalibrationScreen(buf, arena, { columns, prompt }) }]
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
function panel4(slots) {
  const ops = []
  slots.forEach((v, i) => {
    const x = 8 + 0x40 * i, y = 0x24
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
export function layoutCharSelect({ scroll, roster, promptOn = true, blinkOn = false }) {
  return [
    ...header({ words: 2 }),
    { op: 'sprite', chr: 'FCNORMAL.CHR', frame: 11, x: 0x68, y: 0x27, opaque: true },
    { op: 'border', x: 0x67, y: 0x26, w: 50, h: 50, color: 0x0d },
    ...carousel(scroll, roster, blinkOn),
    ...prompt('WHO DO YOU WANT TO BE ?', promptOn),
  ]
}

/** The opponent picker (`1A4A` -> `19F2` -> `09E0`): the four-slot panel, the carousel, "WHO DO YOU
 * WANT TO RACE ?". */
export function layoutPicker({ slots, scroll, roster, promptOn = true, blinkOn = false }) {
  return [...header({ words: 2 }), ...panel4(slots), ...carousel(scroll, roster, blinkOn), ...prompt('WHO DO YOU WANT TO RACE ?', promptOn)]
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
export function layoutRaceIntro({ slots, raceNumber, trackName, round, vehicleClass = round, last = false }) {
  const x = ((0xff - ((trackName.length + 1) * 8 + 0x40)) >> 1) + 0x40
  const digits = `${raceNumber >= 10 ? Math.floor(raceNumber / 10) : ' '}${raceNumber % 10}`
  const ops = [...header({ words: 2 }), ...panel4(slots)]
  if (last) ops.push({ op: 'text', font: 'FONT2.CHR', text: trackName, centre: true, y: 0x6c }) // 1888: [28C1]==[439], the slot's own string centred
  else {
    ops.push({ op: 'text', font: 'FONT2.CHR', text: trackName, x, y: 0x6c })
    ops.push({ op: 'text', font: 'FONT2.CHR', text: `RACE ${digits}`, x: x - 0x40, y: 0x6c })
  }
  ops.push(...classPicture(vehicleClass, 0x80))
  for (let k = 0; k < 4; k++) ops.push({ op: 'sprite', chr: 'MINATURE.CHR', frame: round - 1 + 8 * k, x: 0x10 + 0x40 * k, y: 0x5a, flip: true })
  return ops
}

const FREE_ROSTER = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

export const FRONT_SCREENS = {
  charselect: () => layoutCharSelect({ scroll: settledScroll(10), roster: FREE_ROSTER }),
  picker: () => layoutPicker({ slots: [10, 0xb, 0xb, 0xb], scroll: settledScroll(0), roster: FREE_ROSTER.map((v) => (v === 10 ? 0x4a : v)) }),
  qualintro: () => layoutQualifierIntro({ vehicleClass: 2 }),
  raceintro: () => layoutRaceIntro({ slots: [10, 0, 1, 2], raceNumber: 1, trackName: 'THE BREAKFAST BENDS', round: 5 }),
  title: () => layoutTitle({ classIndex: 1 }),
  selectgame: () => layoutSelectGame({ selection: 1 }),
  oneplayer: () => layoutOnePlayerGame({ selection: 0 }),
  options: (ctx) => layoutOptions({ settings: ctx.settings }),
  options_f7: (ctx) => layoutOptions({ settings: ctx.settings, joystick: true }),
  joycal_centre: () => layoutJoyCal({ columns: [['CENTRE'], null], prompt: true }),
  joycal_right: () => layoutJoyCal({ columns: [['CENTRE', 'LEFT', 'RIGHT'], null], prompt: true }),
}
