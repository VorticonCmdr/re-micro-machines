// M3.5 acceptance test, stage 2 (PLAN-ENGINE.md D9): "run ai.js on the trace's state at step n ->
// its output must equal the trace's drone control bytes at step n+1" (PollAllCarInputs runs before
// the physics step, so a row's own controlBits reflects the AI's read of the PREVIOUS row's state).
// Reuses tools/refs/trace-R21-idle.tsv (M3.4) -- the only 3 cars this trace's window has ANY
// meaningful state for are the drones (car 0 is human, idle, and never invokes this code path).
//
// Coverage caveat: the live window's `.BRK` hits are car1/car3 -> type 0 only (bytes 0x00), car2 ->
// type 1 (bytes 0x14/0x13, mag 4/3) but always landing on the "accelerate" side of the threshold --
// no brake, no type 2, no turn, ever appears, so a wrong threshold or steer polarity could pass this
// trace-based check unnoticed (an advisor review caught this after the first "59/60" draft). See
// `syntheticBranches()` below for hand-computed coverage of the branches the trace doesn't reach.
//
// Result: 59/60 predicted control bytes match exactly -- all 59 the unavoidably-identical 0x28
// type-0/type-1-accelerating case (every trace controlBits value is 0x28 except the one miss
// below). The one miss (car 3, raw sampled step 69)
// is a capture artifact, not an AI bug: every other captured field for that row -- position,
// velocity, subCell, everything -- is byte-identical to the previous kept row, and the real
// function's own first instruction is `[BX+0x137B] = 0` before it rebuilds the byte bit by bit
// (docs/engine.md §6). The Lua capture polls memory unsynchronized to any instruction boundary
// (docs/engine.md §9f), so this row is most likely a torn read caught between that zeroing and the
// rest of the same frame committing -- not a distinct physics step at all, and not something the
// row-dedup step (which only compares for *any* difference) had a way to know to drop.
//   node tools/check-ai.mjs
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { droneControlByte } from '../src/engine/ai.js'
import { loadBrk, loadWorld, roundCtx } from '../src/engine/race.js'
import { runStep, computeRanking } from '../src/engine/step.js'
import { parseTrace, buildInitialCar, fieldsToCompare, TRACE_PATH, ROUND, RACE } from './check-trace.mjs'
import { CAR_TYPE_INFO } from '../src/data/engine-tables.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const GAME = join(ROOT, 'game')
const read = async (n) => new Uint8Array(readFileSync(join(GAME, n)))
const ROUND_MAX_SPEED_BASE = CAR_TYPE_INFO[ROUND - 1][0]

/**
 * Synthetic branch coverage (advisor-flagged gap, echoing check-step.mjs scenario 3 for M3.3):
 * the live trace's drones only ever hit `.BRK` type 0 or a type-1 accept that happens to look
 * identical to type 0 (see the module comment above), and never turn -- so a wrong steer polarity,
 * brake threshold, TANKS penalty, or type-2 cap could pass `stage2()` at 59/60 unnoticed. Every
 * expected value below is hand-computed from the `1000:5429-5531` formulas, not from a live run.
 */
function syntheticBranches() {
  let ok = 0, bad = 0
  function check(name, actual, expected) {
    if (actual === expected) { ok++; return }
    bad++
    console.log(`FAIL ai-synthetic: ${name}: expected 0x${expected.toString(16)}, got 0x${actual.toString(16)}`)
  }
  function car(fields) {
    return { dirByte: 0, mapAttr: 0, levByte: 0, heading: 0, speed: 0, progress: 0, maxSpeedCur: 1000, maxSpeedBase: 1000, ...fields }
  }
  const straightCtx = { round: 1, brk: [{ raw: 0x00 }], tournamentIndex: 0 }

  // Steer polarity: dir 0 -> target 0x40 (64).
  check('steer left (d<0)', droneControlByte(car({ heading: 74 }), straightCtx) & 0xc0, 0x80)
  check('steer right (d>=3)', droneControlByte(car({ heading: 50 }), straightCtx) & 0xc0, 0x40)
  check('steer straight (0<=d<3)', droneControlByte(car({ heading: 62 }), straightCtx) & 0xc0, 0x00)

  // .BRK type 0: accelerate, maxSpeedCur reset to base.
  {
    const c = car({ heading: 62, maxSpeedCur: 1, maxSpeedBase: 1234 })
    const bits = droneControlByte(c, straightCtx)
    check('type0 bits', bits, 0x28)
    check('type0 maxSpeedCur reset', c.maxSpeedCur, 1234)
  }

  // .BRK type 1: lim = ((mag<<8)>>1)+0x380. mag=0 -> 896. Accel if speed<=lim, else brake; either
  // way maxSpeedCur resets to base (5511-5515 and 5520-5524 both do this).
  {
    const ctx = { round: 1, brk: [{ raw: 0x10 }], tournamentIndex: 0 }
    const accel = car({ heading: 62, speed: 800, maxSpeedCur: 1, maxSpeedBase: 999 })
    check('type1 accel bits', droneControlByte(accel, ctx), 0x28)
    check('type1 accel resets maxSpeedCur', accel.maxSpeedCur, 999)
    const brake = car({ heading: 62, speed: 1000, maxSpeedCur: 1, maxSpeedBase: 999 })
    check('type1 brake bits', droneControlByte(brake, ctx), 0x18)
    check('type1 brake also resets maxSpeedCur', brake.maxSpeedCur, 999)
  }

  // .BRK type 2: lim = ((mag<<8)>>2)+0x600 = 1536 (mag=0). Always accelerate; maxSpeedCur only
  // ever raised (max), never lowered.
  {
    const ctx = { round: 1, brk: [{ raw: 0x20 }], tournamentIndex: 0 }
    const raise = car({ heading: 62, maxSpeedCur: 1000 })
    check('type2 bits', droneControlByte(raise, ctx), 0x28)
    check('type2 raises maxSpeedCur to lim', raise.maxSpeedCur, 1536)
    const keep = car({ heading: 62, maxSpeedCur: 2000 })
    droneControlByte(keep, ctx)
    check('type2 never lowers maxSpeedCur', keep.maxSpeedCur, 2000)
  }

  // .BRK type 3+ ("other"): type-0-like if not turning, type-1-like if turning (54af-54b5).
  {
    const ctx = { round: 1, brk: [{ raw: 0x30 }], tournamentIndex: 0 }
    const notTurning = car({ heading: 62, maxSpeedCur: 1, maxSpeedBase: 777 })
    check('type3 not turning -> type0 bits', droneControlByte(notTurning, ctx), 0x28)
    check('type3 not turning -> type0 resets maxSpeedCur', notTurning.maxSpeedCur, 777)
    const turning = car({ heading: 50, speed: 800, maxSpeedCur: 1, maxSpeedBase: 777 }) // heading 50 -> steer right
    check('type3 turning -> type1 bits (steer + accel)', droneControlByte(turning, ctx), 0x68)
    check('type3 turning -> type1 resets maxSpeedCur', turning.maxSpeedCur, 777)
  }

  // [28C1] (ctx.tournamentIndex) modifiers: +0x50 bonus at exactly 0x17; TANKS (round 7) extra
  // -0x20 at tournamentIndex >= 0x13, on top of the unconditional -0xD0.
  {
    const bonusCtx = { round: 1, brk: [{ raw: 0x10 }], tournamentIndex: 0x17 } // lim = 896+80 = 976
    check('tournamentIndex 0x17 bonus raises lim (976, not base 896)', droneControlByte(car({ heading: 62, speed: 950 }), bonusCtx) & 0x30, 0x20)
    const tanksHigh = { round: 7, brk: [{ raw: 0x10 }], tournamentIndex: 0x13 } // lim = 896-32-208 = 656
    check('TANKS tournamentIndex>=0x13: extra -0x20 (lim 656, brakes at 670)', droneControlByte(car({ heading: 62, speed: 670 }), tanksHigh) & 0x30, 0x10)
    const tanksLow = { round: 7, brk: [{ raw: 0x10 }], tournamentIndex: 0x12 } // lim = 896-208 = 688
    check('TANKS tournamentIndex<0x13: no extra -0x20 (lim 688, accels at 670)', droneControlByte(car({ heading: 62, speed: 670 }), tanksLow) & 0x30, 0x20)
  }

  // mapAttr bit 1 (0x2): consult DRONE_DIR_REMAP_TABLE[bucket][dir], bucket = (levByte>>5)&3.
  // heading 170 discriminates: remapped (dir 5->3, target 0xA0=160) gives d=160-170=-10 -> LEFT;
  // unremapped (dir stays 5, target 0xE0=224) gives d=224-170=54 -> RIGHT -- an earlier draft of
  // this check used heading 150, which happens to steer right either way (advisor-caught).
  {
    const c = car({ dirByte: 5, mapAttr: 2, levByte: 0x20, heading: 170 })
    check('mapAttr&2 dir remap consulted', droneControlByte(c, straightCtx) & 0xc0, 0x80)
  }
  // mapAttr bit 0 (0x1): target ^= 0x80.
  {
    const c = car({ dirByte: 0, mapAttr: 1, heading: 200 }) // target 0x40^0x80=0xC0
    check('mapAttr&1 flips target', droneControlByte(c, straightCtx) & 0xc0, 0x80)
  }
  // Round 2's extra `&7` dir mask: same dirByte/heading, opposite steer direction round 2 vs not.
  {
    const c2 = car({ dirByte: 0xf, heading: 40 })
    check('round2 dir&7 masking (steer left)', droneControlByte(c2, { round: 2, brk: [{ raw: 0 }], tournamentIndex: 0 }) & 0xc0, 0x80)
    const c1 = car({ dirByte: 0xf, heading: 40 })
    check('round!=2 dir&0xF masking (steer right)', droneControlByte(c1, { round: 1, brk: [{ raw: 0 }], tournamentIndex: 0 }) & 0xc0, 0x40)
  }

  check('fire bit always set', droneControlByte(car({ heading: 62 }), straightCtx) & 0x08, 0x08)

  console.log(bad ? `ai-synthetic: ${bad} check(s) failed, ${ok} ok` : `ai-synthetic: ${ok}/${ok} branch checks passed`)
}

async function stage2(rows, ctx) {
  let checked = 0, matched = 0
  const mismatches = []
  for (let i = 1; i < rows.length; i++) {
    const prevRow = rows[i - 1]
    const curRow = rows[i]
    for (const carIdx of [1, 2, 3]) {
      // ai.js only reads these fields; the rest of a real CarRecord isn't needed for stage 2.
      // maxSpeedBase/maxSpeedCur aren't captured columns, so they're seeded from CAR_TYPE_INFO --
      // this window never hits a .BRK type 2, so the seed doesn't affect the returned bits, but
      // without it a future type-2-hitting trace would silently compute Math.max(undefined, lim)
      // = NaN here and still "match" (NaN happens not to gate any of the OR'd bits) rather than
      // actually failing loudly (advisor-caught).
      const car = { maxSpeedBase: ROUND_MAX_SPEED_BASE, maxSpeedCur: ROUND_MAX_SPEED_BASE, ...prevRow.cars[carIdx] }
      const predicted = droneControlByte(car, ctx)
      checked++
      if (predicted === curRow.cars[carIdx].controlBits) matched++
      else mismatches.push({ step: curRow.step, carIdx, predicted, actual: curRow.cars[carIdx].controlBits })
    }
  }
  console.log(`ai: stage 2 (AI given state) -- ${matched}/${checked} predicted control bytes matched the trace`)
  if (mismatches.length) {
    console.log(`  first mismatch: step ${mismatches[0].step}, car ${mismatches[0].carIdx}: predicted 0x${mismatches[0].predicted.toString(16)}, trace 0x${mismatches[0].actual.toString(16)}`)
  }
  return matched === checked
}

/**
 * "Full loop (AI + physics) reproduces the idle trace with no external input" (PLAN-ENGINE.md
 * M3.5's own acceptance line): car 0 (human) still gets its trace-captured (zero) controlBits --
 * this trace never exercises human input -- but cars 1-3's controlBits now come from `ai.js`
 * itself each step, not the trace, so this is strictly harder than `npm run trace`'s stage 1 alone.
 */
async function fullLoop(rows, ctx, world) {
  const cars = rows[0].cars.map((c, i) => buildInitialCar(c, ROUND, i))
  const raceState = {}
  // Rank row 0 first, as the drawn frame before it did (runStep reads that order since M3.99;
  // docs/engine.md §9dh -- without it the seed order turns the rubber band on for every drone).
  computeRanking(cars, { ...ctx, progressScale: world.map.maxPlane2, halfMaxProgress: world.map.maxPlane2 >> 1 }, raceState)
  const compareFields = fieldsToCompare()
  let firstDivergence = null

  for (let i = 1; i < rows.length && !firstDivergence; i++) {
    const controls = cars.map((car, carIdx) => (carIdx === 0 ? (rows[i].cars[0].controlBits ?? 0) : droneControlByte(car, ctx)))
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
      `ai: full loop -- first divergence replaying transition ${firstDivergence.matchedCount + 1} ` +
        `(trace's own raw step label ${firstDivergence.rawStep}), car ${firstDivergence.carIdx}, ` +
        `field '${firstDivergence.field}': trace=${firstDivergence.expected} engine=${firstDivergence.actual}`
    )
    console.log(`ai: full loop matched ${firstDivergence.matchedCount} of ${rows.length - 1} steps before diverging`)
    return false
  }
  console.log(`ai: full loop -- all ${rows.length - 1} steps matched exactly across all 4 cars`)
  return true
}

async function main() {
  const rows = parseTrace(TRACE_PATH)
  const world = await loadWorld(read, ROUND, RACE)
  const ctx = { ...roundCtx(ROUND, RACE), brk: await loadBrk(read, ROUND, RACE), tournamentIndex: 0 }

  syntheticBranches()
  // Report only, like `npm run trace` -- a baseline that can only go up, not a pass/fail gate
  // (PLAN-ENGINE.md D9); the full-loop check in particular necessarily inherits M3.4's own still-
  // open physics divergence, which is not this file's concern to fail on.
  await stage2(rows, ctx)
  await fullLoop(rows, ctx, world)
}

main()
