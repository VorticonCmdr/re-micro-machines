// The car record: 4 x 0x164 (356) bytes at DS:124A, one per car, indexed by BX (docs/engine.md
// §1). Field layout mirrors the `CarRecord` struct built in the Ghidra project this session
// (117 fields; get_struct_layout MICROU.EXE/CarRecord) byte-for-byte -- offsets and sizes here
// are load-bearing evidence, not a guess, and fromBytes(toBytes(x)) must round-trip the static
// DS image exactly (npm run tables-adjacent check: see tools/check-car.mjs). Names are the
// friendlier docs/engine.md §1 names; each field's comment gives the Ghidra struct field name
// for cross-reference back into the disassembly.
//
// Signedness: fields the evidence describes as signed (velocities, speed, zVel, drift deltas,
// puff/splash animation frame, D2 in PLAN-ENGINE.md) are read/written as i16; everything else
// (positions, counters, flags, states) is u16, matching how the game itself treats them (mostly
// unsigned world coordinates and small non-negative counters). Getting this wrong does not
// break round-tripping (both paths write the same bits back), only downstream arithmetic.

export const CAR_RECORD_SIZE = 0x164
export const CAR_RECORD_BASE = 0x124a // DS:124A, car 0; car n = BASE + n*CAR_RECORD_SIZE

// { name, offset, size (1|2), signed }
// prettier-ignore
const FIELDS = [
  { name: 'playerSlot', offset: 0x00, size: 2 }, // wPlayerSlot
  { name: 'active', offset: 0x02, size: 2 }, // wActive
  { name: 'present', offset: 0x04, size: 2 }, // wPresent
  { name: 'drawnThisFrame', offset: 0x06, size: 2 }, // wDrawnThisFrame
  { name: 'colourOffset', offset: 0x08, size: 2 }, // wColourOffset
  { name: 'unk1254', offset: 0x0a, size: 2 }, // wUnk1254 (UNKNOWN_1254_1256)
  { name: 'unk1256', offset: 0x0c, size: 2 }, // wUnk1256
  { name: 'posXfrac', offset: 0x0e, size: 2 }, // wPosXfrac
  { name: 'nextXfrac', offset: 0x10, size: 2 }, // wNextXfrac
  { name: 'posX', offset: 0x12, size: 2 }, // wPosX
  { name: 'nextX', offset: 0x14, size: 2 }, // wNextX
  { name: 'spawnTargetX', offset: 0x16, size: 2 }, // wSpawnTargetX
  { name: 'camHalfW', offset: 0x18, size: 2 }, // wCamHalfW
  { name: 'posYfrac', offset: 0x1a, size: 2 }, // wPosYfrac
  { name: 'nextYfrac', offset: 0x1c, size: 2 }, // wNextYfrac
  { name: 'posY', offset: 0x1e, size: 2 }, // wPosY
  { name: 'nextY', offset: 0x20, size: 2 }, // wNextY
  { name: 'spawnTargetY', offset: 0x22, size: 2 }, // wSpawnTargetY
  { name: 'camHalfH', offset: 0x24, size: 2 }, // wCamHalfH
  { name: 'targetVelX', offset: 0x26, size: 2, signed: true }, // wTargetVelX
  { name: 'velX', offset: 0x28, size: 2, signed: true }, // wVelX
  { name: 'targetVelY', offset: 0x2a, size: 2, signed: true }, // wTargetVelY
  { name: 'velY', offset: 0x2c, size: 2, signed: true }, // wVelY
  { name: 'heading', offset: 0x2e, size: 2 }, // wHeading (0..255, low byte only meaningful)
  { name: 'speed', offset: 0x30, size: 2, signed: true }, // wSpeed
  { name: 'slipThreshold', offset: 0x32, size: 2 }, // wSlipThreshold
  { name: 'gripStep', offset: 0x34, size: 2 }, // wGripStep
  { name: 'slipEnable', offset: 0x36, size: 2 }, // wSlipEnable (static 1)
  { name: 'skidding', offset: 0x38, size: 2 }, // wSkidding
  { name: 'lowGripTimerA', offset: 0x3a, size: 2 }, // wLowGripTimerA
  { name: 'lowGripTimerB', offset: 0x3c, size: 2 }, // wLowGripTimerB
  { name: 'puffSrcSkid', offset: 0x3e, size: 2 }, // wPuffSrcSkid
  { name: 'puffSrcWet', offset: 0x40, size: 2 }, // wPuffSrcWet
  { name: 'splashTrigger', offset: 0x42, size: 2 }, // wSplashTrigger
  { name: 'puffOffA', offset: 0x44, size: 2, signed: true }, // wPuffOffA (-30)
  { name: 'puffOffB', offset: 0x46, size: 2, signed: true }, // wPuffOffB (20)
  { name: 'puffOffC', offset: 0x48, size: 2, signed: true }, // wPuffOffC (30)
  { name: 'puffOffD', offset: 0x4a, size: 2, signed: true }, // wPuffOffD (-20)
  { name: 'puffSlotCursor', offset: 0x4c, size: 2 }, // wPuffSlotCursor
  { name: 'splashSlotCursor', offset: 0x4e, size: 2 }, // wSplashSlotCursor
  { name: 'steerStep', offset: 0x50, size: 2 }, // wSteerStep
  { name: 'maxSpeedCur', offset: 0x52, size: 2 }, // wMaxSpeedCur
  { name: 'maxSpeedBase', offset: 0x54, size: 2 }, // wMaxSpeedBase
  { name: 'reverseLimit', offset: 0x56, size: 2, signed: true }, // wReverseLimit (negative floor)
  { name: 'accel', offset: 0x58, size: 2 }, // wAccel
  { name: 'brakeDecel', offset: 0x5a, size: 2 }, // wBrakeDecel
  { name: 'coastDecel', offset: 0x5c, size: 2 }, // wCoastDecel
  { name: 'wallHitPending', offset: 0x5e, size: 2 }, // wWallHitPending
  { name: 'droneWallStuck', offset: 0x60, size: 2 }, // wDroneWallStuck
  { name: 'carCarHit', offset: 0x62, size: 2 }, // wCarCarHit
  { name: 'state', offset: 0x64, size: 2 }, // wState (docs/engine.md §4)
  { name: 'animTimer', offset: 0x66, size: 2 }, // wAnimTimer
  { name: 'puffCooldown', offset: 0x68, size: 2 }, // wPuffCooldown
  { name: 'splashCooldown', offset: 0x6a, size: 2 }, // wSplashCooldown
  { name: 'animStep', offset: 0x6c, size: 2 }, // wAnimStep
  { name: 'animStep2', offset: 0x6e, size: 2 }, // wAnimStep2
  { name: 'knockoutX', offset: 0x70, size: 2 }, // wKnockoutX
  { name: 'knockoutY', offset: 0x72, size: 2 }, // wKnockoutY
  { name: 'driftDX', offset: 0x74, size: 2, signed: true }, // wDriftDX
  { name: 'driftDY', offset: 0x76, size: 2, signed: true }, // wDriftDY
  { name: 'driftSteps', offset: 0x78, size: 2 }, // wDriftSteps
  { name: 'hitLeft', offset: 0x7a, size: 2 }, // wHitLeft
  { name: 'hitRight', offset: 0x7c, size: 2 }, // wHitRight
  { name: 'hitUp', offset: 0x7e, size: 2 }, // wHitUp
  { name: 'hitDown', offset: 0x80, size: 2 }, // wHitDown
  { name: 'metaTile', offset: 0x82, size: 2 }, // wMetaTile
  { name: 'subCell', offset: 0x84, size: 2 }, // wSubCell (CH=subx, CL=suby packed by the game; kept whole)
  { name: 'terrainIdx', offset: 0x86, size: 2 }, // wTerrainIdx
  { name: 'terrainIdxPrev', offset: 0x88, size: 2 }, // wTerrainIdxPrev
  { name: 'zVel', offset: 0x8a, size: 2, signed: true }, // wZVel
  { name: 'height', offset: 0x8c, size: 2, signed: true }, // wHeight -- signed: docs/engine.md §3's landing test is `z <= 0` and z can briefly go negative before being clamped
  { name: 'bounceOnLand', offset: 0x8e, size: 2 }, // wBounceOnLand
  { name: 'dirByte', offset: 0x90, size: 2 }, // wDirByte
  { name: 'dirBytePrev', offset: 0x92, size: 2 }, // wDirBytePrev
  { name: 'mapAttr', offset: 0x94, size: 2 }, // wMapAttr
  { name: 'levByte', offset: 0x96, size: 1 }, // bLevByte
  { name: 'progressPrev', offset: 0x97, size: 2 }, // wProgressPrev
  { name: 'progress', offset: 0x99, size: 2 }, // wProgress
  { name: 'progressChanged', offset: 0x9b, size: 2 }, // wProgressChanged
  { name: 'checkpointOff', offset: 0x9d, size: 2 }, // wCheckpointOff
  { name: 'checkpointOffSaved', offset: 0x9f, size: 2 }, // wCheckpointOffSaved
  { name: 'isDrone', offset: 0xa1, size: 2 }, // wIsDrone
  { name: 'lapsRemaining', offset: 0xa3, size: 2 }, // wLapsRemaining
  { name: 'racePosition', offset: 0xa5, size: 2 }, // wRacePosition
  { name: 'safeX', offset: 0xa7, size: 2 }, // wSafeX
  { name: 'safeY', offset: 0xa9, size: 2 }, // wSafeY
  { name: 'safeXPrev', offset: 0xab, size: 2 }, // wSafeXPrev
  { name: 'safeYPrev', offset: 0xad, size: 2 }, // wSafeYPrev
  { name: 'hazardVulnerable', offset: 0xaf, size: 2 }, // wHazardVulnerable
  { name: 'wallBounceEnable', offset: 0xb1, size: 2 }, // wWallBounceEnable
  // 0xb3..0x112 (96 B): puffSlots[8], handled separately
  // 0x113..0x130 (30 B): splashSlots[5], handled separately
  { name: 'controlBits', offset: 0x131, size: 1 }, // bControlBits (0x80 L, 0x40 R, 0x20 accel, 0x10 brake, 0x08 fire)
  { name: 'startGridSlot', offset: 0x132, size: 2 }, // wStartGridSlot
  { name: 'cameraFarFlag', offset: 0x134, size: 2 }, // wCameraFarFlag
  { name: 'controlsLocked', offset: 0x136, size: 2 }, // wControlsLocked
  { name: 'subState', offset: 0x138, size: 2 }, // wSubState
  { name: 'rampJumpActive', offset: 0x13a, size: 2 }, // wRampJumpActive
  { name: 'unk1386', offset: 0x13c, size: 2 }, // wUnk1386 (UNKNOWN_1386)
  { name: 'onBridge', offset: 0x13e, size: 2 }, // wOnBridge
  { name: 'halveOnBounce', offset: 0x140, size: 2 }, // wHalveOnBounce (static 1)
  { name: 'dropInSlot', offset: 0x142, size: 2 }, // wDropInSlot
  { name: 'terrainLevel', offset: 0x144, size: 2 }, // wTerrainLevel
  { name: 'offTrackDwell', offset: 0x146, size: 2 }, // wOffTrackDwell
  { name: 'rotorFrame', offset: 0x148, size: 2 }, // wRotorFrame
  { name: 'projActive', offset: 0x14a, size: 2 }, // wProjActive
  { name: 'projFrame', offset: 0x14c, size: 2 }, // wProjFrame
  { name: 'projX', offset: 0x14e, size: 2 }, // wProjX
  { name: 'projStepsA', offset: 0x150, size: 2 }, // wProjStepsA
  { name: 'projY', offset: 0x152, size: 2 }, // wProjY
  { name: 'projStepsB', offset: 0x154, size: 2 }, // wProjStepsB
  { name: 'projXsub', offset: 0x156, size: 2 }, // wProjXsub
  { name: 'projYsub', offset: 0x158, size: 2 }, // wProjYsub
  { name: 'reloadCooldown', offset: 0x15a, size: 2 }, // wReloadCooldown
  // 0x15c..0x162 (6 B): pad13A6, kept raw for round-tripping (init-only per docs/engine.md §1)
  { name: 'offTrackTicks', offset: 0x162, size: 1 }, // bOffTrackTicks
  { name: 'pad13AD', offset: 0x163, size: 1 }, // bPad13AD (no known reader)
]

const PUFF_SLOT_COUNT = 8
const PUFF_SLOT_SIZE = 12
const PUFF_SLOTS_OFFSET = 0xb3
// UNKNOWN_puff_slot_fields resolved (docs/engine.md §9q): every puff-trigger event spawns a PAIR
// of 8x8 sprites (a left/right wheel-spray pair, one at heading-30 via puffOffA/B, one at
// heading+30 via puffOffC/D), sharing one frame counter and one source pointer -- +0/+2 = xA/yA
// (the heading-30 point, formerly "unkA/unkB"), +4/+6 = xB/yB (the heading+30 point, formerly
// "x/y"), +8 frame (-1 or 0..7), +A source (the raw PH0 pointer for the chosen set, not a 0-2 index).
const PUFF_SLOT_FIELDS = [
  { name: 'xA', offset: 0x0, signed: false },
  { name: 'yA', offset: 0x2, signed: false },
  { name: 'xB', offset: 0x4, signed: false },
  { name: 'yB', offset: 0x6, signed: false },
  { name: 'frame', offset: 0x8, signed: true },
  { name: 'source', offset: 0xa, signed: false },
]

const SPLASH_SLOT_COUNT = 5
const SPLASH_SLOT_SIZE = 6
const SPLASH_SLOTS_OFFSET = 0x113
const SPLASH_SLOT_FIELDS = [
  { name: 'x', offset: 0x0, signed: false },
  { name: 'y', offset: 0x2, signed: false },
  { name: 'frame', offset: 0x4, signed: true },
]

function dv(bytes) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

/** @param {Uint8Array} bytes at least `base + 0x164` long @param {number} base byte offset of this car's record */
export function fromBytes(bytes, base = 0) {
  const view = dv(bytes)
  const car = {}
  for (const f of FIELDS) {
    if (f.size === 1) car[f.name] = bytes[base + f.offset]
    else car[f.name] = f.signed ? view.getInt16(base + f.offset, true) : view.getUint16(base + f.offset, true)
  }
  car.puffSlots = []
  for (let i = 0; i < PUFF_SLOT_COUNT; i++) {
    const so = base + PUFF_SLOTS_OFFSET + i * PUFF_SLOT_SIZE
    const slot = {}
    for (const f of PUFF_SLOT_FIELDS) slot[f.name] = f.signed ? view.getInt16(so + f.offset, true) : view.getUint16(so + f.offset, true)
    car.puffSlots.push(slot)
  }
  car.splashSlots = []
  for (let i = 0; i < SPLASH_SLOT_COUNT; i++) {
    const so = base + SPLASH_SLOTS_OFFSET + i * SPLASH_SLOT_SIZE
    const slot = {}
    for (const f of SPLASH_SLOT_FIELDS) slot[f.name] = f.signed ? view.getInt16(so + f.offset, true) : view.getUint16(so + f.offset, true)
    car.splashSlots.push(slot)
  }
  car.pad13A6 = Array.from(bytes.subarray(base + 0x15c, base + 0x162))
  return car
}

/** @param {object} car as returned by fromBytes @returns {Uint8Array} 0x164 bytes */
export function toBytes(car, out = new Uint8Array(CAR_RECORD_SIZE), base = 0) {
  const view = dv(out)
  for (const f of FIELDS) {
    const v = car[f.name] ?? 0
    if (f.size === 1) out[base + f.offset] = v & 0xff
    else if (f.signed) view.setInt16(base + f.offset, v, true)
    else view.setUint16(base + f.offset, v, true)
  }
  for (let i = 0; i < PUFF_SLOT_COUNT; i++) {
    const so = base + PUFF_SLOTS_OFFSET + i * PUFF_SLOT_SIZE
    const slot = car.puffSlots?.[i] ?? {}
    for (const f of PUFF_SLOT_FIELDS) {
      const v = slot[f.name] ?? 0
      if (f.signed) view.setInt16(so + f.offset, v, true)
      else view.setUint16(so + f.offset, v, true)
    }
  }
  for (let i = 0; i < SPLASH_SLOT_COUNT; i++) {
    const so = base + SPLASH_SLOTS_OFFSET + i * SPLASH_SLOT_SIZE
    const slot = car.splashSlots?.[i] ?? {}
    for (const f of SPLASH_SLOT_FIELDS) {
      const v = slot[f.name] ?? 0
      if (f.signed) view.setInt16(so + f.offset, v, true)
      else view.setUint16(so + f.offset, v, true)
    }
  }
  const pad = car.pad13A6 ?? new Array(6).fill(0)
  for (let i = 0; i < 6; i++) out[base + 0x15c + i] = pad[i] ?? 0
  return out
}

/** The four cars' base byte offsets relative to CAR_RECORD_BASE (docs/engine.md §1). */
export function carBase(index) {
  return index * CAR_RECORD_SIZE
}

/** Read all 4 car records out of a 0x590-byte dump starting at CAR_RECORD_BASE (DS:124A). */
export function allFromBytes(bytes) {
  return [0, 1, 2, 3].map((i) => fromBytes(bytes, carBase(i)))
}
