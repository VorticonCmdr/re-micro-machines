// Every hardcoded table in src/data/engine-tables.js == the live bytes in game/MICROU.EXE.
//   node tools/check-tables.mjs
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as T from '../src/data/engine-tables.js'
import * as FT from '../src/data/frontend-tables.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const exe = new Uint8Array(readFileSync(join(ROOT, 'game', 'MICROU.EXE')))

function fileOffset(ds) {
  return ds + T.DS_TO_FILE_OFFSET
}
function bytesAt(ds, len) {
  const o = fileOffset(ds)
  return Array.from(exe.subarray(o, o + len))
}
function wordsToBytes(words) {
  const out = []
  for (const w of words) { out.push(w & 0xff, (w >> 8) & 0xff) }
  return out
}
function signedToBytes(vals) {
  return vals.map((v) => v & 0xff)
}

function fixedRecordBytes(strings, recordLen) {
  const out = []
  for (const s of strings) {
    for (let i = 0; i < recordLen; i++) out.push(i < s.length ? s.charCodeAt(i) : 0)
  }
  return out
}
function nulWalkedBytes(strings) {
  const out = []
  for (const s of strings) {
    for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i))
    out.push(0)
  }
  return out
}

let ok = 0, bad = 0
function check(name, ds, expectedBytes) {
  const actual = bytesAt(ds, expectedBytes.length)
  const mismatches = []
  for (let i = 0; i < expectedBytes.length; i++) {
    if (actual[i] !== expectedBytes[i]) mismatches.push(i)
  }
  if (mismatches.length) {
    bad++
    console.log(`MISMATCH ${name} @ DS:${ds.toString(16)}: ${mismatches.length}/${expectedBytes.length} bytes differ (first at +0x${mismatches[0].toString(16)}: expected ${expectedBytes[mismatches[0]]}, got ${actual[mismatches[0]]})`)
  } else {
    ok++
  }
}

check('SINE8', T.SINE8_ADDR, signedToBytes(T.SINE8_RAW))
check('CONTACT_TABLE', T.CONTACT_TABLE_ADDR, signedToBytes(T.CONTACT_TABLE))
check('CHECKPOINT_POINTERS', T.CHECKPOINT_POINTERS_ADDR, wordsToBytes(T.CHECKPOINT_POINTERS.flat()))
check('CHECKPOINT_LISTS', T.CHECKPOINT_LISTS_ADDR, signedToBytes(T.CHECKPOINT_LISTS_RAW))
check('KID_MODIFIER', T.KID_MODIFIER_ADDR, wordsToBytes(T.KID_MODIFIER))
check('RUFF_TRUCK_TIMES', T.RUFF_TRUCK_TIMES_ADDR, wordsToBytes(T.RUFF_TRUCK_TIMES))
check('DRONE_MAX_VEL_HANDICAP', T.DRONE_MAX_VEL_HANDICAP_ADDR, wordsToBytes(T.DRONE_MAX_VEL_HANDICAP))
check('GRIP_ADJUST', T.GRIP_ADJUST_ADDR, wordsToBytes([T.GRIP_ADJUST]))
check('DECAY_BOUNCE', T.DECAY_BOUNCE_ADDR, wordsToBytes(T.DECAY_BOUNCE))
check('CAR_TYPE_INFO', T.CAR_TYPE_INFO_ADDR, wordsToBytes(T.CAR_TYPE_INFO.flat()))
check('ROUND3_TILE_FLAGS', T.ROUND3_TILE_FLAGS_ADDR, signedToBytes(T.ROUND3_TILE_FLAGS))
check('TERRAIN_ROW_POINTERS', T.TERRAIN_ROW_POINTERS_ADDR, wordsToBytes(T.TERRAIN_ROW_POINTERS))
// The 9 rows are contiguous in memory right after the 9 row pointers (docs/engine.md §5).
check('TERRAIN_ROWS', T.TERRAIN_ROW_POINTERS[0], wordsToBytes(T.TERRAIN_ROWS.flat()))
check('STATE_TABLE', T.STATE_TABLE_ADDR, wordsToBytes(T.STATE_TABLE))
check('STATE1_ANIM_A', T.STATE1_ANIM_A_ADDR, wordsToBytes([...T.STATE1_ANIM_A.threshold, ...T.STATE1_ANIM_A.frames]))
check('STATE1_ANIM_B', T.STATE1_ANIM_B_ADDR, wordsToBytes([...T.STATE1_ANIM_B.threshold, ...T.STATE1_ANIM_B.frames]))
check('STATE1_ANIM_DEFAULT', T.STATE1_ANIM_DEFAULT_ADDR, wordsToBytes([...T.STATE1_ANIM_DEFAULT.threshold, ...T.STATE1_ANIM_DEFAULT.frames]))
check('STATE1_ANIM_ROUND2', T.STATE1_ANIM_ROUND2_ADDR, wordsToBytes([...T.STATE1_ANIM_ROUND2.threshold, ...T.STATE1_ANIM_ROUND2.frames]))
check('CRASH_ANIM', T.CRASH_ANIM_ADDR, wordsToBytes([...T.CRASH_ANIM.threshold, ...T.CRASH_ANIM.frames]))
check('FALL_ANIM', T.FALL_ANIM_ADDR, wordsToBytes([...T.FALL_ANIM.threshold, ...T.FALL_ANIM.frames]))
check('KNOCKOUT_DURATIONS', T.KNOCKOUT_DURATIONS_ADDR, wordsToBytes(T.KNOCKOUT_DURATIONS))
check('KNOCKOUT_FRAME_IDS', T.KNOCKOUT_FRAME_IDS_ADDR, wordsToBytes(T.KNOCKOUT_FRAME_IDS))
check('CAR_CAMERA_TABLE', T.CAR_CAMERA_TABLE_ADDR, wordsToBytes(T.CAR_CAMERA_TABLE))
check('DRONE_HEADING_TABLE', T.DRONE_HEADING_TABLE_ADDR, wordsToBytes(T.DRONE_HEADING_TABLE))
check('DRONE_DIR_REMAP_TABLE', T.DRONE_DIR_REMAP_TABLE_ADDR, T.DRONE_DIR_REMAP_TABLE.flat())
check('ROUND3_DROPIN_TABLE', T.ROUND3_DROPIN_TABLE_ADDR, wordsToBytes(T.ROUND3_DROPIN_RAW))

check('ORDER_TABLE', FT.ORDER_TABLE_ADDR, FT.ORDER_TABLE_RAW)
check('ORDER_TABLE_LAST_INDEX+BOARD_SCREEN_ENABLE+MAX_BONUS_RACES', FT.ORDER_TABLE_LAST_INDEX_ADDR, [FT.ORDER_TABLE_LAST_INDEX, FT.BOARD_SCREEN_ENABLE, FT.MAX_BONUS_RACES])
// Names/skills are stored centred in a fixed 6-char field (a 4-letter name gets one padding
// space each side; the 6-letter ones need none), then two NUL bytes -- re-derived by inspection
// of the live bytes while extracting these tables, not asserted a priori.
function centerPad6(s) {
  const pad = 6 - s.length
  const left = Math.floor(pad / 2)
  return ' '.repeat(left) + s + ' '.repeat(pad - left)
}
check('CHARACTER_NAMES', FT.CHARACTER_NAMES_ADDR, fixedRecordBytes(FT.CHARACTER_NAMES.map(centerPad6), 8))
check('CHARACTER_SKILLS', FT.CHARACTER_SKILLS_ADDR, fixedRecordBytes(FT.CHARACTER_SKILLS.map(centerPad6), 8))
check('TRACK_NAMES', FT.TRACK_NAMES_ADDR, nulWalkedBytes(FT.TRACK_NAMES))
check('OUTCOME_MESSAGES', FT.OUTCOME_MESSAGES_ADDR, nulWalkedBytes(FT.OUTCOME_MESSAGES))
check('TITLE_COPYRIGHT', FT.TITLE_COPYRIGHT_ADDR, nulWalkedBytes([FT.TITLE_COPYRIGHT]))
check('TITLE_CLASS_NAMES', FT.TITLE_CLASS_NAMES_ADDR, nulWalkedBytes(FT.TITLE_CLASS_NAMES))
check('SELECT_GAME_TITLE', FT.SELECT_GAME_TITLE_ADDR, nulWalkedBytes([FT.SELECT_GAME_TITLE]))
check('ONE_PLAYER_LABEL', FT.ONE_PLAYER_LABEL_ADDR, nulWalkedBytes([FT.ONE_PLAYER_LABEL]))
check('TWO_PLAYER_LABEL', FT.TWO_PLAYER_LABEL_ADDR, nulWalkedBytes([FT.TWO_PLAYER_LABEL]))
check('CAROUSEL_STEP_TABLE', FT.CAROUSEL_STEP_TABLE_ADDR, FT.CAROUSEL_STEP_TABLE)
check('H2H_TRACK_TABLE', FT.H2H_TRACK_TABLE_ADDR, FT.H2H_TRACK_TABLE)
check('H2H_SKILL_INDEX_TABLE', FT.H2H_SKILL_INDEX_TABLE_ADDR, FT.H2H_SKILL_INDEX_TABLE)
check('H2H_SKILL_LABELS', FT.H2H_SKILL_LABELS_ADDR, nulWalkedBytes(FT.H2H_SKILL_LABELS))
check('SINGLE_RACE_TRACK_TABLE', FT.SINGLE_RACE_TRACK_TABLE_ADDR, FT.SINGLE_RACE_TRACK_TABLE.flat())
check('BOARD_ICON_POSITIONS', FT.BOARD_ICON_POSITIONS_ADDR, wordsToBytes(FT.BOARD_ICON_UNITS_RAW.map(([xUnit, yUnit]) => xUnit | (yUnit << 8))))

console.log(bad ? `${bad} table(s) mismatched, ${ok} ok` : `${ok}/${ok} tables match MICROU.EXE`)
process.exitCode = bad ? 1 : 0
