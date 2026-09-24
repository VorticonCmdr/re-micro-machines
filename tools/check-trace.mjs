// M3.4 trace oracle, stage 1 ("physics given controls"): replay a live-captured per-step trace's
// own control bytes through step.js and report the first step/car/field where our port diverges
// from what the real game actually did (PLAN-ENGINE.md D9/M3.4). Baselines only go up (D9) --
// this is the number `npm run trace` prints, not a pass/fail gate.
//
// Capture method (docs/engine.md's new M3.4 section has the full account): a Lua script running
// on the DOSBox bridge's emulation thread (`mcp__dosbox__script_load`), NOT the planned per-step
// CPU breakpoint at 1000:30B7 -- the breakpoint approach needs one round trip per step, which is
// far too slow to reach hundreds of steps in this session. The Lua script instead calls
// `dosbox.mem_read` directly against DS:124A+carIdx*0x164 once per rendered frame
// (`dosbox.wait_frames(1)`), which SETTINGS.DAT's smoothness=1 makes equal to one physics step.
// Its 64 KB total-output cap (not the 5 s wall-clock cap, which was never the binding one at this
// row width) limits a single script run to ~100 steps at the field width captured here, hence
// `trace-R21-idle.tsv`'s 100 rows rather than the plan's aspirational >=600.
//
// Only a SUBSET of each CarRecord was captured per step (kinematics + terrain/collision +
// progress/laps + controlBits -- the fields likely to actually change tick to tick), not the full
// 0x164-byte record every step (that would only fit ~23 steps in 64 KB). The static per-car tuning
// fields this trace does NOT carry (slipThreshold, gripStep, accel, brakeDecel, coastDecel,
// steerStep, maxSpeedCur/Base, reverseLimit) are re-derived here via `race.js`'s own
// `tuningFieldsFor(carIndex, round)` (`tournamentIndex` defaulted to 0, exact for this trace's own
// Challenge-mode ROUND21 capture, not an approximation -- confirmed live 2026-09-22,
// docs/engine.md §9aa). This used to be a separate, hand-rolled `CX=0` re-derivation in this file
// that quietly went stale once M3.20 added the real per-car handicap to `tuningFieldsFor` and
// nobody updated this copy -- that staleness, not a `step.js` bug, was the actual cause of the
// original "step 1 diverges" finding (docs/engine.md §9f/§9aa); sharing the one function instead of
// keeping a second derivation is what closes that class of bug for good.
//
// Current result (docs/engine.md §9aa): every genuine physics step in this 21-row trace matches
// exactly once one known-bad row is accounted for -- raw step label 69 is a diagnosed torn Lua
// capture read (only car 3's `controlBits` differs from the previous kept row; every other field,
// for every car, is byte-identical), the same artifact class §9g already found once in this same
// trace's AI stage-2 test. `npm run trace`'s own literal, unfiltered output still reports the
// resulting one-tick-offset divergence honestly (13 of 20) rather than silently working around it.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { toBytes, fromBytes, CAR_RECORD_SIZE } from '../src/engine/car.js'
import { loadWorld, roundCtx, tuningFieldsFor } from '../src/engine/race.js'
import { runStep } from '../src/engine/step.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const GAME = join(ROOT, 'game')
const read = async (n) => new Uint8Array(readFileSync(join(GAME, n)))

export const TRACE_PATH = join(ROOT, 'tools', 'refs', 'trace-R21-idle.tsv')
export const ROUND = 2
export const RACE = 1

// Column order the capture script wrote per car (tools' Lua capture, see docs/engine.md M3.4).
const CAR_FIELDS = [
  'posXfrac', 'nextXfrac', 'posX', 'nextX', 'spawnTargetX', 'camHalfW',
  'posYfrac', 'nextYfrac', 'posY', 'nextY', 'spawnTargetY', 'camHalfH',
  'targetVelX', 'velX', 'targetVelY', 'velY', 'heading', 'speed',
  'state',
  'metaTile', 'subCell', 'terrainIdx', 'terrainIdxPrev', 'zVel', 'height', 'bounceOnLand',
  'dirByte', 'dirBytePrev', 'mapAttr', 'levByte',
  'progressPrev', 'progress', 'progressChanged', 'checkpointOff', 'checkpointOffSaved',
  'isDrone', 'lapsRemaining', 'racePosition',
  'controlBits',
]

/**
 * The Lua capture samples once per `dosbox.wait_frames(1)` "frame", not once per physics step --
 * a live check (docs/engine.md §9f) found each car's position only actually changes every 5-6
 * sampled rows, so most rows are the game re-presenting an unchanged state, not a new step. Rows
 * that are byte-identical to the previous KEPT row are dropped here so what's left is one row per
 * real physics step; this shrinks "100 rows" to the real step count (~18) but removes the
 * frame/step misalignment that would otherwise make every comparison downstream meaningless.
 */
export function parseTrace(path) {
  const text = readFileSync(path, 'utf8').trim()
  const [headerLine, ...dataLines] = text.split('\n')
  const header = headerLine.split('\t')
  const allRows = dataLines.map((line) => {
    const cells = line.split('\t').map(Number)
    const row = { step: cells[0], cars: [{}, {}, {}, {}] }
    for (let i = 1; i < header.length; i++) {
      const [, carTag, field] = header[i].match(/^(car\d)_(.+)$/)
      row.cars[Number(carTag[3])][field] = cells[i]
    }
    return row
  })
  const rows = []
  for (const row of allRows) {
    const prev = rows[rows.length - 1]
    const changed = !prev || row.cars.some((c, i) => Object.keys(c).some((k) => c[k] !== prev.cars[i][k]))
    if (changed) rows.push(row)
  }
  return rows
}

export function buildInitialCar(row, round, carIndex) {
  // docs/engine.md §1 "Init from tables", via race.js's own `tuningFieldsFor` (docs/engine.md §9y/
  // live-verification section) -- NOT a local re-derivation. This trace's own capture (docs/engine.md
  // §9f) is a fresh Challenge-mode ROUND21 start with no tournament context, so `tournamentIndex=0`
  // is exact here, not an approximation -- confirmed live 2026-09-22 by matching this same function's
  // output, byte-exact, against a fresh DOSBox memory read of all 4 spawned cars' tuning fields.
  const partial = { ...row, ...tuningFieldsFor(carIndex, round) }
  partial.slipEnable = 1
  partial.wallBounceEnable = 1
  partial.halveOnBounce = 1
  partial.hazardVulnerable = 1
  partial.active = 1
  partial.present = 1
  partial.drawnThisFrame = 0
  partial.safeX = row.posX
  partial.safeY = row.posY
  partial.safeXPrev = row.posX
  partial.safeYPrev = row.posY
  partial.controlsLocked = 0
  // Round-trip through car.js's own (un)packer so every one of the 117 fields we did NOT set
  // gets car.js's real default (0), not `undefined` -- matches how check-step.mjs's fixtures work.
  const bytes = toBytes(partial)
  return fromBytes(bytes)
}

export function fieldsToCompare() {
  return [
    'posX', 'posY', 'heading', 'speed', 'targetVelX', 'targetVelY', 'velX', 'velY',
    'state', 'progress', 'progressPrev', 'progressChanged', 'lapsRemaining', 'checkpointOff', 'height', 'zVel',
  ]
}

async function main() {
  const rows = parseTrace(TRACE_PATH)
  if (rows.length < 2) throw new Error('trace has fewer than 2 rows')

  const world = await loadWorld(read, ROUND, RACE)
  const ctx = { ...roundCtx(ROUND, RACE), controllerTypes: [5, 6, 6, 6] } // the capture's car 0 was on KEYS2
  const cars = rows[0].cars.map((c, i) => buildInitialCar(c, ROUND, i))
  const raceState = {}

  const compareFields = fieldsToCompare()
  let firstDivergence = null

  for (let i = 1; i < rows.length && !firstDivergence; i++) {
    const controls = rows[i].cars.map((c) => c.controlBits ?? 0)
    runStep(world, cars, controls, raceState, ctx)
    for (let carIdx = 0; carIdx < 4 && !firstDivergence; carIdx++) {
      const expected = rows[i].cars[carIdx]
      const actual = cars[carIdx]
      for (const field of compareFields) {
        if (expected[field] === undefined) continue
        if (actual[field] !== expected[field]) {
          firstDivergence = { matchedCount: i - 1, rawStep: rows[i].step, carIdx, field, expected: expected[field], actual: actual[field] }
          break
        }
      }
    }
  }

  if (firstDivergence) {
    console.log(
      `trace: first divergence replaying transition ${firstDivergence.matchedCount + 1} ` +
        `(trace's own raw step label ${firstDivergence.rawStep}), car ${firstDivergence.carIdx}, ` +
        `field '${firstDivergence.field}': trace=${firstDivergence.expected} engine=${firstDivergence.actual}`
    )
    console.log(`trace: matched ${firstDivergence.matchedCount} of ${rows.length - 1} steps before diverging (${rows.length}-row trace)`)
  } else {
    console.log(`trace: all ${rows.length - 1} steps matched exactly across all 4 cars (${compareFields.join(', ')})`)
  }
}

// Guarded so tools/check-ai.mjs (M3.5) can import this file's helpers without re-running this
// tool's own report as a side effect.
if (process.argv[1] === fileURLToPath(import.meta.url)) main()
