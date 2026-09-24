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
export const OUTCOME_MESSAGES_ADDR = 0x81f
export const OUTCOME_MESSAGES = [
  'FAILED TO QUALIFY!',
  'QUALIFIED FOR CHALLENGE!',
  'ONE LIFE LOST',
  'EXTRA LIFE',
  'NO BONUS',
  'QUALIFIED FOR HEAD TO HEAD!',
]
