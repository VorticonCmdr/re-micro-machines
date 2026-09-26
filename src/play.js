// The playable race page (PLAN-ENGINE.md M3.6). Boots straight into ROUND21 (round 2 race 1, the
// POWERBOATS Challenge qualifier, D8's first target) -- there is no front-end/menu flow yet
// (M3.9). The HUD (docs/engine.md §9o, `render/hud.js`) draws the lap counter and rank icons for
// this page's one-player/four-car format.
//
// One player only: car 0 is keyboard-controlled (KEYS2 from SETTINGS.DAT, or a hardcoded
// arrows+S fallback if that file is missing/malformed), cars 1-3 are `ai.js` drones. The two-car
// camera branch, projectiles, puffs/splashes and states B/C/F/0x10 are out of scope this
// milestone (see docs/engine.md's M3.6/M3.7 sections for the full list and why). Sound (M3.7) runs
// through `Si2Player`, whose AudioWorklet ticks the driver off the audio clock in real time; engine
// pitch is sent every physics step, the wired sfx sites (docs/sound.md §3b, a subset of the 36 —
// see docs/engine.md's M3.7 section) fire through the same `ctx.sound` the headless tests use.
import { resolveSource } from './io/resolveSource.js'
import { loadTileBank, buildWordMap, vehicleFrames } from './formats/race.js'
import { decodePalette } from './formats/pal.js'
import { decompress } from './formats/lz.js'
import { createControlReader, createMouseDriver } from './engine/devices.js'
import { attachMouseDriver } from './engine/pointerMouse.js'
import { parseStrtPos, parseSettings, parseCheats } from './formats/globaldata.js'
import { indexedToRgba, paint } from './render/raster.js'
import { composeRaceView } from './render/raceView.js'
import { loadWorld, loadBrk, roundCtx, spawnCars } from './engine/race.js'
import { runStep } from './engine/step.js'
import { droneControlByte } from './engine/ai.js'
import { initCameraState } from './engine/camera.js'
import { createKeyboardReader, createPauseKeyReader, createMenuReleaseTracker, recordingReader } from './engine/input.js'
import { createPauseState, updatePause } from './engine/pause.js'
import { createFadeState, applyFade, raceStartHold } from './engine/fade.js'
import { raceStart, updateEngines, createRaceJitter, raceOverStart } from './engine/sound.js'
import { createRaceEndState, updateRaceEnd } from './engine/raceEnd.js'
import { lapLineSegments, nearestPaletteIndex } from './engine/lapLine.js'
import { Si2Player } from './audio/si2Player.js'
import { createSmoothnessGate } from './engine/smoothness.js'

const ROUND = 2
const RACE = 1
const STEP_DT = 1 / 35 // 35 Hz physics (docs/engine.md §2)
const VIEW = { w: 256, h: 200 }
const DEFAULT_KEYS2 = [0x4b, 0x4d, 0x48, 0x50, 0x1f] // left,right,accel,brake,fire -- LEFT/RIGHT/UP/DOWN/S

export async function bootRace({ canvas, statusEl, pickButton, dropZone, oplStrictCheckbox, smoothnessSelect, projectilesToggle, lapLineToggle }) {
  const source = await resolveSource({ statusEl, pickButton, dropZone })
  const read = (path) => source.read(path)
  if (pickButton) pickButton.hidden = true

  statusEl.textContent = 'Loading assets…'
  const [{ bytes: bank }, ctBytes, mapBytes, palBytes, vh0Bytes, ph0Bytes, strtBytes, settingsBytes, cheatsBytes, world, brk, driverBytes] = await Promise.all([
    loadTileBank(read, ROUND),
    read(`GAME1/ROUND${ROUND}BR.CT`),
    read(`GAME1/ROUND${ROUND}${RACE}.MAP`),
    read(`GAME1/ROUND${ROUND}.PAL`),
    read(`GAME1/ROUND${ROUND}BR.VH0`),
    read('BITSFILE.PH0'),
    read('GAME1/STRT_POS.BIN'),
    read('SETTINGS.DAT').catch(() => null),
    read('GAME1/CHEATS.BIN'),
    loadWorld(read, ROUND, RACE),
    loadBrk(read, ROUND, RACE),
    Promise.all(['DRIVER0.BIN', 'DRIVER1.BIN', 'DRIVER2.BIN'].map((n) => read(n))), // [0F64] 0/1/2
  ])
  const cheats = parseCheats(cheatsBytes)

  // Sound (PLAN-ENGINE.md M3.7): the worklet ticks the driver off the audio clock in real time
  // (docs/sound.md §5), so the game logic here only ever sends it commands, never `hostTick()`.
  // `AudioContext` needs a user gesture to actually produce sound -- resumed on the first keydown.
  const sound = new Si2Player()
  // SETTINGS.DAT word 3 ([0F64]) picks the driver: 0 DRIVER0 (none), 1 DRIVER1 (OPL2), 2 DRIVER2 (PC
  // speaker) -- docs/sound.md §4b. The shipped file says 1.
  const soundDriver = settingsBytes ? parseSettings(settingsBytes).soundDriver : 1
  const driverFile = driverBytes[soundDriver] ?? driverBytes[1]
  await sound.start(driverFile.buffer ?? driverFile, { kind: ['none', 'opl', 'speaker'][soundDriver] ?? 'opl', strictOpl2: !!oplStrictCheckbox?.checked }) // M3.10 OPL waveform toggle
  // Kept attached (not removed after one attempt): the first keydown after page load is often a
  // synthetic/untrusted event in automated testing, which Chrome's autoplay gate silently ignores
  // -- a real trusted keypress must still be able to unlock audio on a later attempt. resume() is
  // a cheap no-op once the context is already running.
  window.addEventListener('keydown', () => sound.resume())
  raceStart(sound)
  const jitter = createRaceJitter()

  const words = buildWordMap(mapBytes, ctBytes, ROUND)
  const { size: vehicleSize, frames, rotorFrames, bank2 } = vehicleFrames(decompress(vh0Bytes), ROUND)
  const ph0 = decompress(ph0Bytes)
  const strt = parseStrtPos(strtBytes).find((s) => s.round === ROUND && s.race === RACE)

  const fileSettings = settingsBytes ? parseSettings(settingsBytes) : null
  const keys2 = fileSettings ? fileSettings.keys2 : DEFAULT_KEYS2
  // P1's device is SETTINGS.DAT's word 0 (docs/engine.md §9cu): KEYS 1/2, or JOY 1 through the
  // Gamepad API. (P1 can never pick JOY 2 or MOUSE on the real options screen.)
  const p1Control = fileSettings?.p1Control ?? 5
  const mouseDriver = createMouseDriver()
  attachMouseDriver(mouseDriver, window, canvas, () => p1Control === 3)
  const humanReader = recordingReader(createControlReader(p1Control, {
    keyboard: (scancodes) => createKeyboardReader(scancodes, window),
    keys1: fileSettings?.keys1 ?? [], keys2,
    getGamepads: () => (navigator.getGamepads ? navigator.getGamepads() : []),
    thresholds: (stick) => (stick === 2 ? fileSettings?.joystick2 : fileSettings?.joystick1) ?? { left: 10, right: 200 },
    mouse: mouseDriver,
  }))
  const pauseKey = createPauseKeyReader(window)
  const releaseTracker = createMenuReleaseTracker(window) // the ISR's [107E]/[107F] gate, which ends the pause (docs/engine.md §9cl)
  const pauseState = createPauseState()
  const fadeState = createFadeState('in')
  const globalState = {} // written by cheats.js's applyCheatEffect on a pause-entry cheat-spot match (docs/engine.md §9q)

  const cars = spawnCars(parseStrtPos(strtBytes), ROUND, RACE)
  const camera = initCameraState(strt)
  // controllerTypes: the words [2658..265E] -- the player's device (KEYS 2 = 5 by default), the
  // drones the CPU (6). A keyboard or mouse car holding fire gets no steering or throttle that step
  // (4D4B-4D70); a joystick car does (live, docs/engine.md §9cu).
  const ctx = { ...roundCtx(ROUND, RACE), brk, tournamentIndex: 0, world, stepIncrement: 1, sound, camera, controllerTypes: [p1Control, 6, 6, 6] }
  // Fresh per race: [26C6]/[26CC]/the order array all start from their race-init values (runStep's
  // own docstring). `raceState.raceOver` is the real main loop's 30df exit (docs/engine.md §9ah).
  const raceState = {}
  let raceOverAnnounced = false
  let raceEnd = null // the post-race hold + fade-out (engine/raceEnd.js)
  let lastIndexed = null // the last painted frame: the hold re-shows it, the fade-out darkens it
  // DEV overlay (docs/engine.md §9ah): the original draws no lap line of its own on this track --
  // the lap counts where the left channel passes under the bath rack, right where the grid starts.
  const basePalette = decodePalette(palBytes).rgb
  const lapLine = { segments: lapLineSegments(world.map), colours: [nearestPaletteIndex(basePalette, 255, 255, 255), nearestPaletteIndex(basePalette, 0, 0, 0)] }

  const ctx2d = canvas.getContext('2d')
  canvas.width = VIEW.w
  canvas.height = VIEW.h

  // Port-only restart (docs/engine.md §9q's own header: `26E4` reloads the sound driver after ESC
  // from a race in the real game; this page has no menu to return to, so a full page reload is the
  // honest equivalent of "leave and come back"). Only armed once the race is actually over, so it
  // can't be hit by accident mid-race.
  function onRestartKey(e) { if (e.code === 'KeyR' && raceEnd?.phase === 'done') location.reload() }
  window.addEventListener('keydown', onRestartKey)

  let running = true
  let acc = 0
  let last = performance.now()
  let steps = 0
  // M3.10 smoothness (src/engine/smoothness.js): SETTINGS.DAT word 2, verbatim -- n=1 (this
  // file's own default) is the smoothest/most-often-drawn setting, not the choppiest.
  const smoothGate = createSmoothnessGate(settingsBytes ? parseSettings(settingsBytes).smoothness : 1)
  if (smoothnessSelect) {
    smoothnessSelect.value = String(smoothGate.n)
    smoothnessSelect.addEventListener('change', () => { smoothGate.n = Number(smoothnessSelect.value) })
  }
  // Dev/test reachability (docs/engine.md §9q): TANKS (round 7) is the only place projectiles are
  // enabled and this page always boots ROUND21 (round 2) per M3.6's own scope -- without this, "S"
  // fires nothing on the one page most players will actually open. The real, in-game way to reach
  // the same flag is cheat type 9 (CHEATS.BIN, applied on a pause-entry cheat-spot match, read in
  // `stepOnce` below via `globalState.projectilesForAll`); this checkbox is a documented, honest
  // shortcut to the identical `ctx.projectilesForAll` gate -- read inside `stepOnce`, not `frame`,
  // so `forceSteps()` (the synchronous fast-forward the automated/backgrounded-tab tests rely on,
  // since it bypasses `requestAnimationFrame` entirely) exercises the exact same path a real frame
  // would.

  function stepOnce() {
    if (raceState.raceOver) return
    // `ctx.drawnTick`: the same `smoothGate.shouldDraw()` result `frame()` already used to decide
    // whether to render, now read BEFORE the physics/state pass so `markDrawn` (drawn.js) can gate
    // the drawn-flag write on it too (docs/engine.md §9ao 8) -- moved here (was called once per
    // drawn tick, after this step, below) rather than called twice, since `shouldDraw()` mutates its
    // own internal counter and a second call would double-advance the smoothness cadence.
    ctx.drawnTick = smoothGate.shouldDraw()
    ctx.projectilesForAll = !!globalState.projectilesForAll || !!projectilesToggle?.checked
    ctx.fireKeyDisabled = !!globalState.cheat5 // [2915], cheats 5/9: the fire entry becomes a coast (4F0D)
    // Cheat type 1 (CHEATS.BIN "instant win", 36a7-36e5): [26C6]=4 plus the fixed order car0, car2,
    // car1, car3 -- recorded by cheats.js into `globalState` at pause time, applied here once.
    if (globalState.raceOverCount != null && !globalState.raceOverApplied) {
      raceState.raceOverCount = globalState.raceOverCount
      if (globalState.fixedOrder) { raceState.rankOrder = [0, 2, 1, 3]; raceState.cheatWin = true } // [2635], re-applied at the exit (3115)
      globalState.raceOverApplied = true
    }
    const controls = cars.map((car, i) => (i === 0 ? humanReader.read() : droneControlByte(car, ctx)))
    runStep(world, cars, controls, raceState, ctx)
    if (raceState.raceOver) {
      // 30DF: sfx 16 gated on car 0 (the camera-table car), then the 100-tick hold + fade-out.
      if (!raceOverAnnounced) { raceOverAnnounced = true; raceOverStart(sound, cars, 0); raceEnd = createRaceEndState() }
    } else {
      updateEngines(sound, cars, ctx, jitter) // 7B46: drawn steps only (it checks ctx.drawnTick)
    }
    steps++
  }

  function render(paused = false) {
    const composed = composeRaceView({ words, bank, camera, frames, vehicleSize, rotorFrames, bank2, race: RACE, tileAnimCounter: raceState.tileAnimCounter ?? 0, cars, view: VIEW, hud: { ph0, raceFormat: ctx.raceFormat, round: ROUND, raceOverCount: raceState.raceOverCount ?? 0 }, paused, lapLine: lapLineToggle?.checked ? lapLine : null })
    const rgb = decodePalette(applyFade(palBytes, fadeState)).rgb
    const rgba = indexedToRgba(composed.indexed, rgb)
    lastIndexed = composed.indexed
    paint(canvas, VIEW.w, VIEW.h, rgba, { zoom: 1 })
  }

  function frame(now) {
    if (!running) return
    const dtMs = Math.min(now - last, 250) // clamp a tab-backgrounded stall instead of spiraling
    last = now
    if (raceEnd) {
      // 30F2-3100: the frozen last frame for 100 ticks (no re-render, no input), then 327A's fade.
      updateRaceEnd(raceEnd, dtMs, sound)
      if (raceEnd.fade && lastIndexed) paint(canvas, VIEW.w, VIEW.h, indexedToRgba(lastIndexed, decodePalette(applyFade(palBytes, raceEnd.fade)).rgb), { zoom: 1 })
      statusEl.textContent = raceStatusText(cars[0], raceState, steps)
      requestAnimationFrame(frame)
      return
    }
    if (raceStartHold(fadeState, dtMs, pauseKey)) {
      // 39F0 -> 32CE: the fade-up over zeroed VRAM, before the main loop -- black, nothing steps.
      ctx2d.fillStyle = '#000'
      ctx2d.fillRect(0, 0, canvas.width, canvas.height)
      requestAnimationFrame(frame)
      return
    }

    const { pressed, held } = pauseKey.read() // a press since the last frame counts as held: 3074 samples at 35 Hz, a frame can miss a short tap
    const paused = updatePause(pauseState, dtMs, { spaceHeld: held || pressed, released: releaseTracker.isrState().latch }, cars[0], cheats, ROUND, RACE, globalState, sound, cars)
    if (pauseState.latchClearPending) { pauseState.latchClearPending = false; releaseTracker.clearIsrLatch() } // 377F/3784

    let shouldRender = paused
    if (!paused) {
      acc += dtMs / 1000
      while (acc >= STEP_DT) { stepOnce(); acc -= STEP_DT; if (raceState.raceOver) break; if (ctx.drawnTick) { shouldRender = true; raceState.tileAnimCounter = (raceState.tileAnimCounter ?? 0) + 1 } }
    }
    if (shouldRender && !raceState.raceOver) render(paused) // the exiting step never renders (3081)
    statusEl.textContent = paused ? 'Paused' : raceStatusText(cars[0], raceState, steps)
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)

  return {
    cars, camera, ctx, pauseState, raceState,
    stop: () => { running = false; humanReader.dispose?.(); pauseKey.dispose?.(); releaseTracker.dispose?.(); window.removeEventListener('keydown', onRestartKey) },
    getTape: () => humanReader.tape,
    // Synchronous fast-forward for debugging/testing (browser rAF is throttled in a backgrounded
    // or automated tab, which is otherwise the only way to observe many steps quickly).
    forceSteps: (n) => { for (let i = 0; i < n; i++) stepOnce(); render() },
  }
}

const ORDINAL = ['1st', '2nd', '3rd', '4th']

/** The status line. `lapsRemaining` is the HUD's own top digit: 3 during the start countdown, 4 the
 * moment the back row's first progress write (0 -> max, the grid sits just behind the line) counts
 * as a backward crossing, then 3, 2, 1 as laps are completed (docs/engine.md §9ah; the original
 * shows the same 3 during its countdown, live, §9co). */
export function raceStatusText(car0, raceState, steps) {
  const place = ORDINAL[(car0.racePosition ?? 1) - 1] ?? '?'
  if (raceState.raceOver) return `Race over — you finished ${place}. Press R to race again.`
  if (car0.lapsRemaining <= 0) return `Finished ${place}! (step ${steps})`
  return `step ${steps} — laps left ${car0.lapsRemaining}, position ${place}`
}
