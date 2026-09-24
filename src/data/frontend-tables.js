// Front-end constants that live inside MICROU.EXE's data segment (docs/engine.md §7/§8), read
// live this session (M3.9) with `read_memory` at the address each export names, and checked
// byte-for-byte against `game/MICROU.EXE` by `tools/check-tables.mjs` -- same discipline as
// `src/data/engine-tables.js` (D1). Everything here is `[STATIC]` (CLAUDE.md).
//
// NOT here, deliberately: the two-human H2H track lists (DS:09BA/09D9) -- M3.9's own scoping cut
// leaves two-human H2H unimplemented (its own track *selection* is `DS:0002 & 7`, the vsync tick
// counter, so it isn't input-deterministic and can't be driven by this port's tape/replay model
// either); the roster table (DS:0164) -- confirmed live to be zero at rest (an uninitialized
// runtime array the game fills with `roster[i]=i` at startup, not baked static data, so there is
// nothing here to check against the EXE -- `frontend/tournament.js` seeds it directly); and the
// unidentified ~52-byte block between the skill strings and the easing-ramp-shaped bytes at
// DS:0359-ish (read live while locating the skills table, not decoded -- not needed for any
// spine screen this milestone builds, left as a genuine open item rather than guessed at).

import { DS_TO_FILE_OFFSET } from './engine-tables.js'

/** file offset = ds + DS_TO_FILE_OFFSET (engine-tables.js's own constant, re-exported for the
 * checker so it has one import surface for every table's address arithmetic). */
export { DS_TO_FILE_OFFSET }

// --- Tournament order table, DS:043C (26 bytes) + its two neighbour bytes (docs/engine.md §7) ---
// `RunTournamentLoop 10a0`/`SetupTournamentRace 115c`: each byte packs `round<<2 | race-1`, i.e.
// `round = v>>2`, `race = (v&3)+1` -- re-derived live this session and matches the byte values
// docs/engine.md §7 already recorded. `[439]` (ORDER_TABLE_LAST_INDEX) is the last valid index
// into this table (0x19 = 25, i.e. 26 entries, 0-indexed); `[43A]` (BOARD_SCREEN_ENABLE) and
// `[43B]` (MAX_BONUS_RACES) sit immediately before it in memory, read together in the same call.
export const ORDER_TABLE_ADDR = 0x43c
export const ORDER_TABLE_RAW = [
  0x08, 0x15, 0x04, 0x18, 0x11, 0x14, 0x0c, 0x19, 0x09, 0x10, 0x20, 0x16, 0x0b, 0x1c, 0x0d, 0x05,
  0x12, 0x21, 0x1a, 0x1d, 0x06, 0x0a, 0x22, 0x0e, 0x1e, 0x07,
]
export const ORDER_TABLE = ORDER_TABLE_RAW.map((v) => ({ round: v >> 2, race: (v & 3) + 1 }))
export const ORDER_TABLE_LAST_INDEX_ADDR = 0x439
export const ORDER_TABLE_LAST_INDEX = 0x19
export const BOARD_SCREEN_ENABLE_ADDR = 0x43a
export const BOARD_SCREEN_ENABLE = 1
export const MAX_BONUS_RACES_ADDR = 0x43b
export const MAX_BONUS_RACES = 2

// --- Character names, DS:0258 (11 x 8-byte NUL-padded records) --------------------------------
// Matches the roster CLAUDE.md's "Anchors" section already named (WALTER..SPIDER); index is the
// character index used throughout (roster slot, `CarTypeInfo`-independent -- that table is
// indexed by round/vehicle class, this one by driver).
export const CHARACTER_NAMES_ADDR = 0x258
export const CHARACTER_NAMES = ['WALTER', 'MIKE', 'ANNE', 'JOEL', 'CHEN', 'DWAYNE', 'JETHRO', 'CHERRY', 'EMILIO', 'BONNIE', 'SPIDER']

// --- Character skills, DS:02B1 (11 x 8-byte NUL-padded records, one pad byte after the names
// block closes it at 0x2B0) --------------------------------------------------------------------
export const CHARACTER_SKILLS_ADDR = 0x2b1
export const CHARACTER_SKILLS = ['DIRE', 'RASH', 'FAIR', 'SMOOTH', 'ABLE', 'POOR', 'SLICK!', 'CRAZY!', 'WILD', 'FAB!', 'ACE!']

// --- Track names, DS:0460 (36 NUL-terminated strings, walked in order; docs/engine.md §7's
// "one contiguous block... NUL-walked with index (round-1)*4 + (race-1)") -----------------------
// 9 rounds x 4 slots; rounds 3-9 only race 26 (RACES_PER_ROUND, catalog.js) so their 4th slot is
// the empty string. Round 2's *first* slot (index 4, the qualifier ROUND21) is the nameless one,
// not its last (the correction docs/engine.md §7/§9 already recorded); round 1's 4th slot
// legitimately holds "WIN THIS RACE TO BE CHAMPION" in the table itself (re-verified live this
// session: it is not a special-cased string, the tournament's last order-table entry (R1.4) just
// happens to land on this real slot). Round 9 has no names here at all (never in ORDER_TABLE,
// bonus-race only). "CURCUIT" (round 3 race 1) is the game's own spelling, kept verbatim.
export const TRACK_NAMES_ADDR = 0x460
export const TRACK_NAMES = [
  'DESKTOP DROPOFF', 'PENCIL PLATEAUX', 'CRAYON CANYONS', 'WIN THIS RACE TO BE CHAMPION', // round 1
  '', 'BERMUDA BATHTUB', 'SOAP LAKE CITY', 'FOAMY FJORDS', // round 2 (slot 0 = ROUND21, nameless)
  'THE CUEBALL CURCUIT', 'PITFALL POCKETS', 'CHALKDUST CHICANE', '', // round 3
  'SAHARA SANDPIT', 'SANDY STRAIGHTS', 'THE DARE DEVIL DUNES', '', // round 4
  'OATMEAL IN OVERDRIVE', 'THE BREAKFAST BENDS', 'FRUIT JUICE FOLLIES', '', // round 5
  'OILCAN ALLEY', 'HANDYMANS CURVE', 'PERILOUS PITSTOP', '', // round 6
  'BEDROOM BATTLEFIELD', 'WIDE AWAKE WAR ZONE', 'GO FOR IT!', '', // round 7
  'THE POTTED PASSAGE', 'THE SHRUBBERY TWIST', 'THE LEAFY BENDS', '', // round 8
  '', '', '', '', // round 9 (bonus race only, no names in this table)
]
export function trackName(round, race) {
  return TRACK_NAMES[(round - 1) * 4 + (race - 1)]
}

// --- Tournament/race outcome messages, DS:081F (6 NUL-terminated strings) ----------------------
// Index == the outcome code docs/engine.md §7 already names: 0 = qualifier fail (tournament
// over), 1 = qualifier/Challenge pass, 2 = 3rd/4th in the Challenge (one life lost, re-run),
// 3 = bonus-race win (extra life), 4 = bonus-race loss (no bonus), 5 = two-car-mode pass
// ("outcome 1 (5 in two-car mode)").
// --- P1 GAME OPTIONS screen (RunOptionsScreenWithSettingsDat 1000:2770), DS:0E17 -----------------
// One contiguous NUL-terminated string block, re-read live this session (193C:0E17..0F68):
// 7 menu-line headers, 3 footer hints, "SETTINGS.DAT", "PLAY WHICH GAME SET ?", "!", 5 control
// names (globaldata.js's own CONTROL_NAME), a blank string, 5 smoothness labels (index 5 = AUTO,
// live-confirmed reachable via F4 -- corrects docs/engine.md §9t's prior "AUTO proven NOT part of
// the set" claim, which only checked the display walk's own upper bound, not whether F4's cycle
// (1000:29D3, `CMP CH,5 / JLE`) can actually produce it), 3 sound driver names, "GAME OPTIONS".
export const OPTIONS_MENU_LINES_ADDR = 0xe17
export const OPTIONS_MENU_LINES = [
  'F1 PLAYER 1 CONTROL',
  'F2 PLAYER 2 CONTROL',
  'F3 SOUND',
  'F4 SMOOTHNESS',
  'F5 REDEFINE KEYS',
  'F6 CREDITS',
  'F7 CONFIGURE JOYSTICK', // only drawn when a joystick is detected (JoystickCount != 0, 1000:2822) -- P6 scope, never shown by this port yet
]
export const OPTIONS_FOOTER_ADDR = 0xe8c
export const OPTIONS_FOOTER = [
  'USE ESCAPE TO QUIT GAME',
  'PRESS RETURN TO PLAY GAME',
  'SPACE PAUSES IN GAME',
]
export const OPTIONS_TITLE_ADDR = 0xf5b
export const OPTIONS_TITLE = 'GAME OPTIONS'

// Smoothness labels, DS:0F23 (walked from the blank slot at 0F22 -- CX = the raw 1..5 value, no
// -1 adjustment; AUTO at CX=5 verified two ways: the string table's own byte layout (0F22 + 1 +
// len("HIGH")+len("GOOD")+len("MEDIUM")+len("LOW") = 0xF38, matching `AutoDetectSmoothnessByRetraceLoops`'s
// own EOL comment citing the same address) and live, this session (F4 pressed 4 times from HIGH
// shows "AUTO" on a real DOSBox GAME OPTIONS screen). AUTO resolves at RETURN
// (1000:2A6E-2A7E) to a real 1-4 value from a VGA-retrace CPU-speed probe (1000:3AD0) -- a timing
// benchmark with no browser equivalent; since any modern machine trivially clears the "HIGH"
// threshold (>=0x18 loop iterations per retrace, an 800MHz-in-1994 sense of "fast"), the port
// resolves AUTO to 1 (HIGH) unconditionally rather than attempting to replicate the probe.
export const SMOOTHNESS_LABELS_ADDR = 0xf23
export const SMOOTHNESS_LABELS = ['HIGH', 'GOOD', 'MEDIUM', 'LOW', 'AUTO']
export const SMOOTHNESS_AUTO = 5
export function resolveSmoothnessForPlay(value) { return value === SMOOTHNESS_AUTO ? 1 : value }

// Sound driver labels, DS:0F3D -- the SAME short form the options screen itself displays (0-based:
// 0 NONE/DRIVER0.BIN, 1 BLASTER/DRIVER1.BIN, 2 SPEAKER/DRIVER2.BIN). globaldata.js's
// SOUND_DRIVER_NAME is the longer form used elsewhere (viewer-style); this is what F3 shows.
export const SOUND_LABELS_ADDR = 0xf3d
export const SOUND_LABELS = ['NONE', 'BLASTER', 'SPEAKER']

// The credits screen (ShowCredits 1000:2a82), DS:0F75, 10 lines, drawn once and dismissed by any key.
export const CREDITS_LINES_ADDR = 0xf75
export const CREDITS_LINES = [
  '   CODE BY   LYNDON HOMEWOOD',
  '                GARY RANSON',
  '                JON CARTWRIGHT',
  '   MUSIC     GEZ GOURLEY',
  '   GRAFIX    BRIAN HARTLEY',
  '                MARK NEESAM',
  '                PETE RANSON',
  '',
  '  PRODUCED BY BIG RED SOFTWARE',
  '   COPYRIGHT CODEMASTERS 1994',
]

// The redefine-keys screen (RunRedefineKeysScreen 1000:92f0), DS:0AE3D (group headers) and
// DS:0AE4B (the 5 per-slot labels, walked the same way as CONTROL_NAME/SMOOTHNESS_LABELS).
// Slot order matches globaldata.js's own documented SETTINGS.DAT layout (LEFT, RIGHT, ACCELERATE,
// BRAKE, SELECT). Live-confirmed this session: pressing a key shows it next to its label, SPACE
// (scancode 0x39) is silently rejected (re-prompts the same slot), and a scancode already used
// earlier in this same 10-key pass is rejected too (1000:936E-9373, checked only against the keys
// collected so far, not the previous SETTINGS.DAT contents).
export const REDEFINE_GROUP_LABELS_ADDR = 0xae3d
export const REDEFINE_GROUP_LABELS = ['KEYS 1', 'KEYS 2']
export const REDEFINE_SLOT_LABELS_ADDR = 0xae4b
export const REDEFINE_SLOT_LABELS = ['LEFT', 'RIGHT', 'ACCELERATE', 'BRAKE', 'SELECT']

// scancode -> displayed character on the redefine-keys screen (1000:ADF0, word pairs, 0-terminated;
// unmatched scancodes fall back to '?', DH's own default init at 1000:937D-9380). Numbers and
// letters only -- the real game only expects a plain keyboard key here, not an arrow/function key
// (those are read and stored correctly regardless, they just display as '?').
export const REDEFINE_DISPLAY_CHAR_ADDR = 0xadf0
export const REDEFINE_DISPLAY_CHAR = {
  0x02: '1', 0x03: '2', 0x04: '3', 0x05: '4', 0x06: '5', 0x07: '6', 0x08: '7', 0x09: '8', 0x0a: '9', 0x0b: '0',
  0x10: 'Q', 0x11: 'W', 0x12: 'E', 0x13: 'R', 0x14: 'T', 0x15: 'Y', 0x16: 'U', 0x17: 'I', 0x18: 'O', 0x19: 'P',
  0x1e: 'A', 0x1f: 'S', 0x20: 'D', 0x21: 'F', 0x22: 'G', 0x23: 'H', 0x24: 'J', 0x25: 'K', 0x26: 'L',
  0x2c: 'Z', 0x2d: 'X', 0x2e: 'C', 0x2f: 'V', 0x30: 'B', 0x31: 'N', 0x32: 'M',
}
export const REDEFINE_DISPLAY_CHAR_DEFAULT = '?'

export const OUTCOME_MESSAGES_ADDR = 0x81f
export const OUTCOME_MESSAGES = [
  'FAILED TO QUALIFY!',
  'QUALIFIED FOR CHALLENGE!',
  'ONE LIFE LOST',
  'EXTRA LIFE',
  'NO BONUS',
  'QUALIFIED FOR HEAD TO HEAD!',
]

// --- P2's title/menu strings (GOAL-DOS-PARITY.md), re-read live 193C:0010-0156 this session -----
// The copyright line (RunTitleScreenAttractLoop 1000:0100, drawn once at boot, 16px font, y=0xB7).
export const TITLE_COPYRIGHT_ADDR = 0x10
export const TITLE_COPYRIGHT = 'COPYRIGHT CODEMASTERS SOFTWARE'

// The 9 vehicle-class names the title's own INTRO.CHR showcase cycles through, one every 0x118
// ticks ([0xbc5] wraps 0..8 -- DrawMenuStringByIndex walked 0-based from this exact base, SI=0x2F,
// no base-minus-one adjustment, unlike the smoothness table). Round order (class index == round -
// 1); "PRO FORMULA ONE"/"PRO SPORTSCARS" sit right after this block (indices 9/10) but the title
// loop's own [0xbc5] never reaches them -- tournament-only substitutions, CLAUDE.md's Anchors.
export const TITLE_CLASS_NAMES_ADDR = 0x2f
export const TITLE_CLASS_NAMES = [
  'SPORTSCARS', 'POWERBOATS', 'FORMULA ONE', 'TURBO WHEELS', 'FOUR BY FOUR',
  'WARRIORS', 'TANKS', 'CHOPPERS', 'RUFFTRUX',
]

// SELECT GAME / ONE PLAYER GAME (RunMainMenuKeepTitleTune 1000:0220, RunOnePlayerGameMenu
// 1000:02e0): one NUL-terminated "SELECT GAME\0" string at DS:0134 is reused at TWO start
// offsets -- 0x134 for the full "SELECT GAME" (0220's title, 02e0's own footer) and 0x13b for
// just its own tail "GAME" (02e0's second header line, "ONE PLAYER"/"GAME" stacked) -- confirmed
// live (a DOSBox screenshot of each screen) and by byte-offset arithmetic (0x140-0x13b = 5 =
// len("GAME")+1). "ONE PLAYER"/"TWO PLAYER" (DS:0140/0x14B) are likewise each used twice: as the
// two SELECT GAME button labels AND (0x140 only) as 02e0's own first header line.
export const SELECT_GAME_TITLE_ADDR = 0x134
export const SELECT_GAME_TITLE = 'SELECT GAME'
export const ONE_PLAYER_LABEL_ADDR = 0x140
export const ONE_PLAYER_LABEL = 'ONE PLAYER'
export const TWO_PLAYER_LABEL_ADDR = 0x14b
export const TWO_PLAYER_LABEL = 'TWO PLAYER'
export const GAME_LABEL = 'GAME' // DS:013B, the tail of SELECT_GAME_TITLE

// RunOnePlayerGameMenu 1000:02e0's own two items -- SELGAM.CHR frame0/WORDS.CHR frame2 "Challenge"
// (Left, RunOnePlayerChallenge 102b) and SELGAM frame1/WORDS frame1 "Head to Head" (Right,
// RunOnePlayerHeadToHeadVsCpu 0fbf) -- read off WORDS.CHR's own 3 rendered frames (§9t:
// 0="MicroMachines"/1="Head to Head"/2="Challenge") and confirmed live (a DOSBox screenshot of
// ONE PLAYER GAME shows exactly this Left/Right pairing).
export const ONE_PLAYER_ITEM_LABELS = ['Head to Head', 'Challenge'] // [LEFT, RIGHT] -- WORDS.CHR frames 1, 2

// The carousel's own 13-step ease-in scroll (RunCharacterSelectMenuTune2 1000:09e0's helper
// FUN_1000_0cd3, DS:0185): 4 steps of 2px + 4 of 4px + 5 of 8px, summing to exactly 64px (one
// character slot) -- confirmed live-read (193C:0185) and by the sum itself (the stepping loop's
// own exit test is `cumulative < 0x40`, so the 13th step lands exactly on the boundary).
export const CAROUSEL_STEP_TABLE_ADDR = 0x185
export const CAROUSEL_STEP_TABLE = [2, 2, 2, 2, 4, 4, 4, 4, 8, 8, 8, 8, 8]

// P3's first item (GOAL-DOS-PARITY.md, docs/engine.md §9ay): the tournament board's own 26-word
// icon-position table (DrawTournamentBoard 1000:18d8's own helper FUN_1000_198e, re-read live this
// session, 193C:0312). Each word's low byte is an X unit, high byte a Y unit: X = xUnit*8+0xC,
// Y = yUnit*8+0x4E (198e's own `SHL CX,3; ADD CX,0xC`/`SHL CX,3; ADD CX,0x4E`). Entry i (0-based)
// is drawn for `ORDER_TABLE[i+1]` -- 198e's own SI walks ORDER_TABLE with a pre-increment, so board
// position 0 uses ORDER_TABLE[1], not [0] (the qualifier never gets a board icon, docs/engine.md §9t).
export const BOARD_ICON_POSITIONS_ADDR = 0x312
export const BOARD_ICON_UNITS_RAW = [
  [15, 3], [0, 0], [15, 0], [0, 9], [20, 3], [0, 6], [20, 0], [0, 3], [5, 9], [0, 12],
  [25, 3], [5, 3], [15, 6], [5, 6], [5, 0], [10, 9], [5, 12], [25, 0], [20, 6], [10, 0],
  [10, 3], [10, 12], [10, 6], [25, 6], [0, 0], [0, 0],
]
export const BOARD_ICON_POSITIONS = BOARD_ICON_UNITS_RAW.map(([xUnit, yUnit]) => ({ x: xUnit * 8 + 0xc, y: yUnit * 8 + 0x4e }))
