// Engine constants that live inside MICROU.EXE's data segment (DS:193C), not in a shipped file
// (docs/engine.md §8). Every array here was read live from the Ghidra project this session
// (mm-engine-plan M3.1) with `read_memory`, at the address given in its own comment; every one
// of them is checked byte-for-byte against `game/MICROU.EXE` by `tools/check-tables.mjs`
// (`npm run tables`) so a transcription slip fails loudly instead of rotting quietly, exactly
// like `src/formats/chr.js`'s CHR_TABLE. Everything here is `[STATIC]` (CLAUDE.md).
//
// File offset for a DS offset in the unpacked EXE = ds + 0x9840 (confirmed by chr.js's
// chrDescriptorTable: DS:0A14 == file 0xA254, 0xA254-0xA14 = 0x9840); tools/check-tables.mjs
// uses the same constant.
//
// The camera target table (DS:27B7, `UNKNOWN_car_camera_2p`, closed) is further down. Not here,
// deliberately: the front-end tables (order table 043C, track names
// 0460, character data, H2H tables 09BA/09D9), which belong to M3.9's frontend/ module, not the
// race engine.

export const DS_TO_FILE_OFFSET = 0x9840

// --- Sine table, DS:10A0 (256 B) -------------------------------------------------------------
// round(127*sin(2*pi*i/256)) as signed bytes (docs/engine.md §3). Stored raw (unsigned, as the
// bytes sit in memory) with a derived signed view, so the raw array is exactly what
// check-tables.mjs diffs against the EXE.
export const SINE8_ADDR = 0x10a0
// prettier-ignore
export const SINE8_RAW = [
  0,3,6,9,12,16,19,22,25,28,31,34,37,40,43,46,49,51,54,57,60,63,65,68,71,73,76,78,81,83,85,88,
  90,92,94,96,98,100,102,104,106,107,109,111,112,113,115,116,117,118,120,121,122,122,123,124,125,125,126,126,126,127,127,127,
  127,127,127,127,126,126,126,125,125,124,123,122,122,121,120,118,117,116,115,113,112,111,109,107,106,104,102,100,98,96,94,92,90,88,
  85,83,81,78,76,73,71,68,65,63,60,57,54,51,49,46,43,40,37,34,31,28,25,22,19,16,12,9,6,3,0,253,
  250,247,244,240,237,234,231,228,225,222,219,216,213,210,207,205,202,199,196,193,191,188,185,183,180,178,175,173,171,168,166,164,
  162,160,158,156,154,152,150,149,147,145,144,143,141,140,139,138,136,135,134,134,133,132,131,131,130,130,130,129,129,129,129,129,
  129,129,130,130,130,131,131,132,133,134,134,135,136,138,139,140,141,143,144,145,147,149,150,152,154,156,158,160,162,164,166,168,
  171,173,175,178,180,183,185,188,191,193,196,199,202,205,207,210,213,216,219,222,225,228,231,234,237,240,244,247,250,253,
]
/** Signed view of SINE8_RAW: `sin8[h & 0xF8]` in the physics step, docs/engine.md §3. */
export const SINE8 = SINE8_RAW.map((v) => (v > 127 ? v - 256 : v))

// --- Car-car contact angle table, DS:17DA (17x17 = 289 B) -------------------------------------
// byte[17DA + ((dy+16)>>1)*17 + ((dx+16)>>1)]: 0 = no contact, centre (dx=dy=0) = 0x60, values
// are the A->B heading byte (unsigned, docs/engine.md §3 "the car-car impulse sign" question).
export const CONTACT_TABLE_ADDR = 0x17da
export const CONTACT_TABLE_SIDE = 17
// prettier-ignore
export const CONTACT_TABLE = [
  0,0,0,0,0,0,120,125,127,131,136,0,0,0,0,0,0,
  0,0,0,0,108,113,119,125,126,131,137,143,148,0,0,0,0,
  0,0,0,100,105,111,117,124,125,132,139,145,151,156,0,0,0,
  0,0,92,96,101,107,115,123,124,133,141,149,155,160,164,0,0,
  0,84,87,91,96,103,112,122,123,134,144,153,160,165,169,172,0,
  0,79,81,85,89,96,106,120,121,136,150,160,167,171,175,177,0,
  72,73,75,77,80,86,96,115,116,141,160,170,176,179,181,183,184,
  67,67,68,69,70,72,77,96,96,160,179,184,186,187,188,189,189,
  65,66,67,68,69,71,76,96,96,160,180,185,187,188,189,190,191,
  61,61,60,59,58,56,51,32,32,224,205,200,198,197,196,195,195,
  56,55,53,51,48,42,32,13,12,243,224,214,208,205,203,201,200,
  0,49,47,43,39,32,22,8,7,248,234,224,217,213,209,207,0,
  0,44,41,37,32,25,16,6,5,250,240,231,224,219,215,212,0,
  0,0,36,32,27,21,13,5,4,251,243,235,229,224,220,0,0,
  0,0,0,28,23,17,11,4,3,252,245,239,233,228,0,0,0,
  0,0,0,0,20,15,9,3,2,253,247,241,236,0,0,0,0,
  0,0,0,0,0,0,8,3,1,253,248,0,0,0,0,0,0,
]
/** `dx, dy` clamped to [-16,16] already known to be within range (the caller checks `|dx|,|dy| <= 16` first). */
export function contactAngle(dx, dy) {
  const row = (dy + 16) >> 1
  const col = (dx + 16) >> 1
  return CONTACT_TABLE[row * CONTACT_TABLE_SIDE + col]
}

// --- Checkpoint pointer table, DS:1FEB (9 rounds x 4 races, 72 B) -----------------------------
// word[1FEB + (round-1)*8 + (race-1)*2], docs/engine.md §3. Unused race-4 slots for the 8
// three-race rounds read 0x0000 (rounds 1,3-8) except round 9 (0xFFFF) -- both treated as
// "no list" by checkpointList() below. Rounds 2 and 8 point at the shared empty-list terminator.
export const CHECKPOINT_POINTERS_ADDR = 0x1feb
// prettier-ignore
export const CHECKPOINT_POINTERS = [
  [0x2035, 0x2043, 0x2055, 0x2075], // round 1
  [0x21df, 0x21df, 0x21df, 0x21df], // round 2 (empty; race-index 0 = ROUND21 the qualifier)
  [0x2093, 0x20ab, 0x20bf, 0x0000], // round 3
  [0x20d3, 0x20e1, 0x20e9, 0x0000], // round 4
  [0x20ff, 0x2115, 0x211d, 0x0000], // round 5
  [0x2135, 0x2145, 0x2159, 0x0000], // round 6
  [0x216f, 0x217d, 0x2193, 0x0000], // round 7
  [0x21df, 0x21df, 0x21df, 0x0000], // round 8 (empty)
  [0x21ad, 0x21bd, 0x21cd, 0xffff], // round 9
]

// --- Checkpoint lists, DS:2035-21E1 (428 B) ----------------------------------------------------
// Raw bytes; each list is words of {lo, hi} progress-byte pairs, 0xFFFF-terminated
// (docs/engine.md §3). Parsed relative to CHECKPOINT_LISTS_ADDR via checkpointList() below.
export const CHECKPOINT_LISTS_ADDR = 0x2035
// prettier-ignore
export const CHECKPOINT_LISTS_RAW = [
  2,5,6,10,25,29,35,40,63,68,74,78,255,255,
  1,6,10,17,19,24,47,51,62,66,80,87,106,111,147,151,255,255,
  8,12,21,26,28,33,40,46,66,71,79,83,85,89,93,96,102,106,121,126,130,133,138,142,146,150,151,160,163,168,255,255,
  2,6,14,19,26,30,31,36,52,56,59,63,76,81,83,88,90,94,113,120,125,129,135,140,146,150,154,158,255,255,
  1,7,17,22,32,36,57,62,73,77,89,96,97,101,101,103,104,107,114,118,127,133,255,255,
  5,12,13,15,28,35,41,46,62,67,77,82,104,109,119,124,139,142,255,255,
  1,5,30,33,44,47,62,64,68,72,82,86,95,99,108,110,123,143,255,255,
  19,24,35,41,50,53,62,66,69,72,81,85,255,255,
  4,18,41,46,50,55,255,255,
  1,6,15,24,29,33,35,40,42,45,50,56,58,63,75,79,101,105,107,112,255,255,
  7,12,21,27,31,35,37,41,49,53,57,59,64,68,77,84,86,90,92,96,255,255,
  3,7,17,23,32,36,255,255,
  2,6,8,12,12,17,26,32,43,47,49,51,62,67,87,91,94,99,109,114,117,122,255,255,
  5,10,13,17,19,23,28,31,36,41,55,59,61,64,255,255,
  1,5,12,17,22,29,30,37,45,47,62,65,80,86,94,99,107,114,255,255,
  1,7,19,22,36,39,52,55,58,61,64,69,73,82,83,86,98,101,103,106,255,255,
  5,11,14,19,25,28,29,31,33,40,43,46,255,255,
  2,6,8,12,14,18,22,26,27,31,36,40,45,48,49,52,57,61,64,67,255,255,
  2,5,6,8,12,15,16,19,21,24,28,32,39,42,53,58,61,64,73,75,79,82,84,86,255,255,
  1,5,6,10,22,25,30,36,38,40,43,46,50,54,255,255,
  4,6,24,28,31,34,36,38,39,42,53,57,60,62,255,255,
  6,9,12,16,23,25,31,33,36,39,42,45,52,54,74,75,255,255,255,255,
]
/** @returns {{lo:number,hi:number}[]} the {lo,hi} progress-threshold pairs for round/race, or [] if that slot has none. */
export function checkpointList(round, race) {
  const ptr = CHECKPOINT_POINTERS[round - 1]?.[race - 1]
  if (!ptr || ptr === 0xffff) return []
  let off = ptr - CHECKPOINT_LISTS_ADDR
  const out = []
  while (off >= 0 && off + 1 < CHECKPOINT_LISTS_RAW.length) {
    const lo = CHECKPOINT_LISTS_RAW[off], hi = CHECKPOINT_LISTS_RAW[off + 1]
    if (lo === 0xff && hi === 0xff) break
    out.push({ lo, hi })
    off += 2
  }
  return out
}

/**
 * The checkpoint word the game actually reads, `word[word[1FEB+(round-1)*8+(race-1)*2] + cursor]`
 * (5F59-5F5F, 5FE8-5FEE, 6090-6098): straight into the shared blob, so a cursor past this race's
 * 0xFFFF reads the NEXT race's entries (the two-car penalty path can push it there, 6006 -> 5F85 ->
 * 5FC5, docs/engine.md §9an). Past the blob's end (21E1) the image holds 0xFF bytes (read
 * 193C:21DD-2217), i.e. terminators. Returns `{lo, hi}`, or null for a 0xFFFF terminator.
 */
export function checkpointEntryRaw(round, race, cursor) {
  const ptr = CHECKPOINT_POINTERS[round - 1]?.[race - 1]
  if (!ptr || ptr === 0xffff) return null
  const i = ptr - CHECKPOINT_LISTS_ADDR + cursor
  const lo = CHECKPOINT_LISTS_RAW[i] ?? 0xff
  const hi = CHECKPOINT_LISTS_RAW[i + 1] ?? 0xff
  return lo === 0xff && hi === 0xff ? null : { lo, hi }
}

/** 6078-60A1: the byte cursor of the first 0xFFFF at or after `cursor`, scanning the raw blob. */
export function checkpointTerminatorFrom(round, race, cursor) {
  let c = cursor
  while (checkpointEntryRaw(round, race, c)) c += 2
  return c
}

// --- Handicap / tuning tables --------------------------------------------------------------
/** DS:23DC, 12 words, identity (0..11) -- confirmed live, not just "by character" as CLAUDE.md summarises it. */
export const KID_MODIFIER_ADDR = 0x23dc
export const KID_MODIFIER = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]

/** DS:2419, 7 words, indexed to feed [26C8] (round-9 RUFFTRUX countdown), docs/engine.md §8. */
export const RUFF_TRUCK_TIMES_ADDR = 0x2419
export const RUFF_TRUCK_TIMES = [6240, 6400, 8000, 4000, 10, 10, 10]

/** DS:2462, 26 words, indexed by [28C1] (the tournament race index, 0..25). */
export const DRONE_MAX_VEL_HANDICAP_ADDR = 0x2462
// prettier-ignore
export const DRONE_MAX_VEL_HANDICAP = [
  560, 640, 512, 215, 486, 278, 321, 167, 324, 452, 234, 74, 16,
  144, 168, 272, 487, 336, 151, 96, 208, 0, 162, 198, 112, 144,
]

/** DS:24E0, single word. */
export const GRIP_ADJUST_ADDR = 0x24e0
export const GRIP_ADJUST = 20

/** DS:24FF, 10 words, word 0 unused, indexed by round (1..9); docs/engine.md §3 airborne model. */
export const DECAY_BOUNCE_ADDR = 0x24ff
export const DECAY_BOUNCE = [0, 1, 2, 1, 1, 1, 2, 2, 2, 2]

/**
 * DS:252A, 9 rounds x 9 words (docs/engine.md §8), columns (per InitRaceCarsFromTables 3c09-458a):
 * [0] maxSpeedBase, [1] reverseLimit-ish base, [2] accel base, [3] brakeDecel base, [4] coastDecel
 * base, [5] slipThreshold base, [6] gripStep base, [7] -> [28C2], [8] -> [28C4].
 */
export const CAR_TYPE_INFO_ADDR = 0x252a
// prettier-ignore
export const CAR_TYPE_INFO = [
  [0x07ee, 0xfc00, 0x0020, 0x0020, 0x0020, 0x001e, 0x001b, 0x0007, 0x0006], // round 1 sportscars
  [0x067e, 0xfcc1, 0x0020, 0x0030, 0x0014, 0x002f, 0x0028, 0x0007, 0x0006], // round 2 powerboats
  [0x07f8, 0xfc00, 0x0020, 0x003c, 0x0010, 0x004d, 0x004c, 0x0007, 0x0006], // round 3 formula one
  [0x07bd, 0xfc85, 0x0028, 0x0051, 0x001e, 0x001e, 0x001c, 0x0007, 0x0006], // round 4 turbo wheels
  [0x067e, 0xfcc1, 0x0019, 0x000f, 0x001c, 0x0032, 0x002f, 0x0007, 0x0006], // round 5 four by four
  [0x05dc, 0xfdae, 0x0015, 0x0014, 0x000a, 0x0017, 0x0012, 0x0007, 0x0006], // round 6 warriors
  [0x03a3, 0xfcc1, 0x0010, 0x0010, 0x001e, 0x003c, 0x003b, 0x000e, 0x000c], // round 7 tanks
  [0x04a3, 0xfdae, 0x0030, 0x0030, 0x0004, 0x001e, 0x000e, 0x0001, 0x0002], // round 8 choppers
  [0x0400, 0xfce0, 0x0040, 0x0034, 0x000f, 0x0048, 0x004b, 0x0007, 0x0006], // round 9 rufftrux
]

/** DS:25CC, 64 bytes, one flag per meta-tile, round-3-specific rules (docs/engine.md §3). */
export const ROUND3_TILE_FLAGS_ADDR = 0x25cc
// prettier-ignore
export const ROUND3_TILE_FLAGS = [
  0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
  0,0,0,1,0,1,1,0,0,1,0,1,1,1,1,1,
  1,1,1,1,1,1,1,0,1,1,1,1,1,1,1,1,
  1,0,1,1,1,1,1,1,1,1,1,1,0,0,0,1,
]

// --- Per-round terrain dispatch table, DS:26D7-278F (184 B) ------------------------------------
// idx = [12DA]>>5 (rounds 1,2,3,6) or >>4 (4,5,7,8,9); CALL word[[28BD] + 2*idx], [28BD] = the
// round's row pointer (docs/engine.md §5). Values are CODE addresses (1000: segment) -- this is
// the table's raw content for verification, not a lookup a JS port calls through; terrain.js
// (M3.3) implements each handler directly and can cross-reference TERRAIN_HANDLER_NAMES below.
export const TERRAIN_ROW_POINTERS_ADDR = 0x26d7
export const TERRAIN_ROW_POINTERS = [0x26e9, 0x26f9, 0x2707, 0x2717, 0x2735, 0x274f, 0x2759, 0x2779, 0x277f]
// prettier-ignore
export const TERRAIN_ROWS = [
  [0x60cb, 0x6456, 0x657e, 0x6674, 0x6674, 0x669b, 0x6768, 0x683b], // round 1
  [0x60cb, 0x63d6, 0x6768, 0x641a, 0x35be, 0x35be, 0x63dd], // round 2
  [0x60cb, 0x657e, 0x6456, 0x35be, 0x6ae5, 0x6ac2, 0x35be, 0x683c], // round 3
  [0x60cb, 0x657e, 0x6622, 0x64f5, 0x6768, 0x6882, 0x6882, 0x6882, 0x6882, 0x6882, 0x6882, 0x6882, 0x6882, 0x6882, 0x6882], // round 4
  [0x60cb, 0x66ed, 0x6622, 0x61b0, 0x6456, 0x6882, 0x6882, 0x6882, 0x6882, 0x6882, 0x6882, 0x6882, 0x6882], // round 5
  [0x60cb, 0x657e, 0x6768, 0x669b, 0x61b0], // round 6
  [0x60cb, 0x69c5, 0x69c5, 0x69c5, 0x69c5, 0x69c5, 0x69c5, 0x69c5, 0x69c5, 0x35be, 0x35be, 0x35be, 0x35be, 0x35be, 0x67d8, 0x66b2], // round 7
  [0x60cb, 0x6169, 0x618c], // round 8
  [0x60cb, 0x66ed, 0x6768, 0x6231, 0x6231, 0x6231, 0x6622, 0x64f5], // round 9
]
/** Address -> the Ghidra function name at that entry (docs/engine.md §5, §9b), for cross-reference only. */
export const TERRAIN_HANDLER_NAMES = {
  0x35be: 'RET (unused)',
  0x60cb: 'HandleTerrainNormalOrLeaveLevel',
  0x6169: 'HandleTerrainKnockoutTile',
  0x618c: 'HandleTerrainOffTrackDwell',
  0x61b0: 'HandleTerrainRoughSurfaceSfx6',
  0x6231: 'FUN_1000_6231 (conveyor/current)',
  0x63d6: 'HandleTerrainWetPuffTrigger',
  0x63dd: 'HandleTerrainGroundedZVel',
  0x641a: 'HandleTerrainAirborneZVelBoost',
  0x6456: 'HandleTerrainHazardFallSnapStop',
  0x64f5: 'HandleTerrainHazardFallKeepVel',
  0x657e: 'HandleTerrainLeaveLevelHop',
  0x6622: 'HandleTerrainLeaveLevelWetPuff',
  0x6674: 'HandleTileResetSteerFlags',
  0x669b: 'HandleTileLowGripSfx12',
  0x66b2: 'HandleTerrainLeaveLevelMudPuff',
  0x66ed: 'HandleTerrainLeaveLevelHopVariant',
  0x6768: 'HandleTerrainLeaveLevelHighHop',
  0x67d8: 'HandleTerrainLeaveLevelLowHop',
  0x683b: 'RET (unused)',
  0x683c: 'ramp launch (unnamed)',
  0x6882: 'HandleTerrainSteppedLevels',
  0x69c5: 'HandleTerrainTankLevels',
  0x6ac2: 'HandleTerrainDirRampBridgeFlag',
  0x6ae5: 'HandleCarState0EDropInSequencer',
}

// --- Car state dispatch table, DS:278F (17 words) -----------------------------------------------
// CALL [278F + 2*state] (docs/engine.md §4). Index = state 0..0x10.
export const STATE_TABLE_ADDR = 0x278f
// prettier-ignore
export const STATE_TABLE = [
  0x7d73, 0x880a, 0x82be, 0x35be, 0x7f62, 0x7efa, 0x35be, 0x6feb,
  0x35be, 0x35be, 0x849b, 0x7d73, 0x7d73, 0x82be, 0x6ae5, 0x8683, 0x86a8,
]
export const STATE_HANDLER_NAMES = {
  0x7d73: 'DrawCarBodyRotatedRemapped',
  0x880a: 'HandleCarState1HazardDeath',
  0x82be: 'HandleCarState2or0DKnockoutAnim',
  0x35be: 'RET (unused)',
  0x7f62: 'HandleCarState4FallAnimSfx8',
  0x7efa: 'HandleCarState5CrashAnimSfx8',
  0x6feb: 'RespawnCarAtSafePoint',
  0x849b: 'HandleCarStateADropInSfx9',
  0x6ae5: 'HandleCarState0EDropInSequencer',
  0x8683: 'HandleCarStateFBannerSfx10',
  0x86a8: 'HandleCarState10BannerSfxF',
}

// --- State 1/2/4/5/D animation tables, DS:27C1-28B9 (docs/engine.md §4) ------------------------
// Each is a {threshold[], frames[]} pair: walk threshold[] for the first entry > animTimer (0xFFFF
// sentinel always last), the same index into frames[] is the frame id (-2/-1 are sentinels, not
// frame ids -- how the tail treats them is below and in docs/engine.md §9w; UNKNOWN_state1_880a is closed). 27C1 and 27DD are two
// COMPLETE, independently-addressed {threshold,frames} tables that happen to share an identical
// threshold row (not one shared threshold table split across two frame halves, as an earlier
// reading of this file had it) -- used together for "rounds 9/4 align heading to 0/0x80"
// (docs/engine.md §4 state 1, §9w). UNKNOWN_state1_oscillator_port resolved 2026-09-22: selection
// is by WHICH waypoint the heading oscillator arrives at, not by round -- table A when it arrives
// at heading bucket 0, table B when it arrives at bucket 0x80 (a round-4 car can reach EITHER,
// depending on the starting heading; the two tables are headlessly indistinguishable anyway since
// only `frames`, draw-only, differs).
export const STATE1_ANIM_A_ADDR = 0x27c1 // arrival at heading bucket 0 (rounds 4/9)
export const STATE1_ANIM_A = { threshold: [8, 16, 24, 32, 40, 48, 0xffff], frames: [0, 1, 2, 3, 4, -2, -1] }
export const STATE1_ANIM_B_ADDR = 0x27dd // arrival at heading bucket 0x80 (rounds 4/9)
export const STATE1_ANIM_B = { threshold: [8, 16, 24, 32, 40, 48, 0xffff], frames: [5, 6, 7, 8, 9, -2, -1] }
export const STATE1_ANIM_DEFAULT_ADDR = 0x27f9 // every round except 2, 4, 9
export const STATE1_ANIM_DEFAULT = {
  threshold: [4, 8, 12, 16, 20, 24, 28, 80, 88, 96, 104, 112, 120, 160, 0xffff],
  frames: [0, 1, 2, 3, 4, 5, 6, -2, 7, 8, 9, 10, 11, -2, -1],
}
export const STATE1_ANIM_ROUND2_ADDR = 0x2835
export const STATE1_ANIM_ROUND2 = { threshold: [4, 8, 12, 16, 20, 24, 80, 0xffff], frames: [0, 1, 2, 3, 4, 5, -2, -1] }
export const CRASH_ANIM_ADDR = 0x2855 // state 5, HandleCarState5CrashAnimSfx8
export const CRASH_ANIM = { threshold: [4, 8, 12, 16, 20, 24, 28, 160, 0xffff], frames: [0, 1, 2, 3, 4, 5, 6, -2, -1] }
export const FALL_ANIM_ADDR = 0x2879 // state 4, HandleCarState4FallAnimSfx8
export const FALL_ANIM = { threshold: [2, 4, 6, 8, 10, 12, 14, 40, 0xffff], frames: [0, 1, 2, 3, 4, 5, 6, -2, -1] }
// States 2/D (HandleCarState2or0DKnockoutAnim): 5 distinct 24x24 frames (docs/engine.md §4).
export const KNOCKOUT_DURATIONS_ADDR = 0x289d
export const KNOCKOUT_DURATIONS = [4, 8, 12, 16, 20, 24, 0xffff]
export const KNOCKOUT_FRAME_IDS_ADDR = 0x28ab
export const KNOCKOUT_FRAME_IDS = [0, 1, 2, 3, 4, 0, 0xffff]

// --- Camera target table, DS:27B7 (docs/engine.md §3, M3.1's deferred UNKNOWN_car_camera_2p,
// resolved M3.1 follow-up 2026-09-20) --------------------------------------------------------
// `5019-5023`: `DI = 2*[27B5]; BX = word[27B7 + DI]`. `[27B5]` (DS:27B5, one word, a *runtime*
// camera-mode index, not itself table data -- not embedded here) selects one of these 5 entries.
// Index 0 is the sentinel `1`: `CMP BX,1; JZ 5053` takes the two-car midpoint branch (below).
// Indices 1-4 are literal `CarRecord` base offsets (0, 0x164, 0x2C8, 0x42C = cars 0-3) used
// directly as `BX` into `[BX+0x125C]`/`[BX+0x1268]` (posX/posY) for a single-car camera target
// (one-player mode always resolves to index 1 = car 0, matching docs §2's already-closed
// `UNKNOWN_bx_at_30df`, which reads this exact table for the render-side camera-target car).
// The sentinel path is confirmed live, not dead code: every writer of `[27B5]` was searched
// (byte-pattern, not xref count -- PLAN.md §8), and 4 of 6 are `CMP [2656],2 / JZ -> 0 else 1`,
// i.e. the two-car branch runs exactly when the race format ([2656]) is 2 (docs/engine.md §3).
export const CAR_CAMERA_TABLE_ADDR = 0x27b7
export const CAR_CAMERA_TABLE = [1, 0, 0x164, 0x2c8, 0x42c]

// --- Drone AI heading tables, RunDroneSteeringAi 1000:5429 (docs/engine.md §6, M3.5) ------------
// `DRONE_HEADING_TABLE` (DS:18FB, 16 words): the 16-point-compass target heading byte for a given
// (possibly remapped) `.DIR` direction code 0-15. Two interleaved 8-entry ramps, not one 16-entry
// ramp: index i in 0-7 is `(0x40+0x20*i) mod 256`, index i in 8-15 is `(0x50+0x20*(i-8)) mod 256`
// -- e.g. index 6 is 0x00 (wraps), index 7 is 0x20, then index 8 restarts at 0x50, not 0x40. Kept
// as embedded data (D1) rather than the formula, and distinct from `DIR_COMPASS_TABLE` (a different
// consumer, docs/track-layout.md).
export const DRONE_HEADING_TABLE_ADDR = 0x18fb
export const DRONE_HEADING_TABLE = [0x40, 0x60, 0x80, 0xa0, 0xc0, 0xe0, 0x00, 0x20, 0x50, 0x70, 0x90, 0xb0, 0xd0, 0xf0, 0x10, 0x30]
// `DRONE_DIR_REMAP_TABLE` (DS:191B, 4 rows x 16 bytes): only consulted when `mapAttr & 2` is set
// (5450-5468); row = `(levByte>>5)&3` (the same "bucket" `LEV_HEADING_TABLE` uses, but as a raw
// 0-3 index here, not the mapped heading byte); each row remaps the raw `.DIR` direction 0-15 to
// the direction code the heading lookup above actually indexes with.
export const DRONE_DIR_REMAP_TABLE_ADDR = 0x191b
export const DRONE_DIR_REMAP_TABLE = [
  [4, 3, 2, 1, 0, 7, 6, 5, 11, 10, 9, 8, 15, 14, 13, 12],
  [0, 7, 6, 5, 4, 3, 2, 1, 15, 14, 13, 12, 11, 10, 9, 8],
  [6, 5, 4, 3, 2, 1, 0, 7, 13, 12, 11, 10, 9, 8, 15, 14],
  [2, 1, 0, 7, 6, 5, 4, 3, 9, 8, 15, 14, 13, 12, 11, 10],
]

// --- Round 3 drop-in/shortcut table, HandleCarState0EDropInSequencer 1000:6ae5 (docs/engine.md
// §9r, M3.13) -- resolves UNKNOWN_22E1_scope. DS:22E1, exactly 74 bytes: 5 entries of 7 words (14
// bytes) each -- [cellX, cellY, minCursor, spawnTargetX, spawnTargetY, heading, dropInSlot] -- then
// a 4-byte terminator (0xFFFF, 0xFFFF). cellX/cellY are 96px-cell coordinates (world pos / 96,
// matched within +-1 cell on each axis); minCursor is the car's own `checkpointOff` threshold that
// must be reached before this entry can fire; spawnTargetX/Y and heading are where/which way the
// car reappears; dropInSlot is a byte-offset key into a small shared slot-bookkeeping array (not
// itself table data -- see engine/dropin.js). Read live and verified byte-exact against a fresh
// `read_memory` (not carried over from an older, less careful pass).
export const ROUND3_DROPIN_TABLE_ADDR = 0x22e1
export const ROUND3_DROPIN_RAW = [
  16, 25, 16, 1584, 1296, 192, 0,
  2, 14, 4, 264, 224, 96, 0,
  21, 3, 2, 1736, 336, 160, 0,
  18, 16, 14, 2064, 1584, 64, 16,
  30, 16, 16, 2880, 2912, 224, 32,
  0xffff, 0xffff,
]
const DROPIN_FIELD_NAMES = ['cellX', 'cellY', 'minCursor', 'spawnTargetX', 'spawnTargetY', 'heading', 'dropInSlot']
export const ROUND3_DROPIN_TABLE = Array.from({ length: 5 }, (_, i) => {
  const rec = {}
  DROPIN_FIELD_NAMES.forEach((name, j) => { rec[name] = ROUND3_DROPIN_RAW[i * 7 + j] })
  return rec
})

// Re-exported so engine code has one import surface for every DS table (D1); these two were
// already extracted and verified against MICROU.EXE for the graphics/track port.
export { DIR_REMAP_TABLE, DIR_COMPASS_TABLE } from '../formats/track.js'
export { LEV_NUDGE_TABLE, LEV_HEADING_TABLE } from '../formats/levbrk.js'
