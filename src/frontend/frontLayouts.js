// The one-player front-end screens as the original draws them (docs/engine.md §9dm), in the same
// op-list form as h2hScreens.js, painted by its paintOps. `FRONT_SCREENS` maps each live capture in
// tools/refs/front/ to the layout of the state it shows; tools/check-front.mjs diffs them. Each entry
// takes `ctx` = `{ settings }` (the parsed SETTINGS.DAT the capture ran with).
import { header, portrait } from './h2hScreens.js'
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

export const FRONT_SCREENS = {
  title: () => layoutTitle({ classIndex: 1 }),
  selectgame: () => layoutSelectGame({ selection: 1 }),
  oneplayer: () => layoutOnePlayerGame({ selection: 0 }),
  options: (ctx) => layoutOptions({ settings: ctx.settings }),
  options_f7: (ctx) => layoutOptions({ settings: ctx.settings, joystick: true }),
  joycal_centre: () => layoutJoyCal({ columns: [['CENTRE'], null], prompt: true }),
  joycal_right: () => layoutJoyCal({ columns: [['CENTRE', 'LEFT', 'RIGHT'], null], prompt: true }),
}
