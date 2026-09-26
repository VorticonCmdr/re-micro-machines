// The M3.9 playable spine (docs/engine.md §9k, PLAN-ENGINE.md M3.9): title -> menu -> character
// select -> {race intro -> race -> results -> outcome}* -> champion, reusing the race engine
// (M3.3-M3.8) for every race and `tournament.js` for the rules between them.
//
// Simplifications made explicit here (the full account is docs/engine.md §9k):
//  - The real main menu is two levels (MAIN: ONE PLAYER/TWO PLAYER -> a ONE PLAYER submenu:
//    Head-to-Head-vs-CPU (`0fbf`) / Challenge (`102b`)) with submenu labels this session never
//    read live. Flattened here into one 3-item menu: CHALLENGE, HEAD TO HEAD (both playable, both
//    exercise `tournament.js`'s two format branches), TWO PLAYER (shows a placeholder -- real
//    two-human H2H is out of scope, see tournament.js's own header).
//  - `FUN_1a4a` (pick your 3 opponents) and the post-elimination replacement picker are both
//    auto-assigned by `tournament.js`, not interactive here either.
//  - The bonus race IS round 9 (RUFFTRUX): `states.js`'s state F ("1 Up!") / 0x10 ("Failed") are
//    exactly the win/lose signal `tournament.js` wants for it -- confirmed by re-reading M3.8's
//    own states.js, not a new finding this milestone.
import { resolveSource } from '../io/resolveSource.js'
import { loadTileBank, buildWordMap, vehicleFrames, TILE_BYTES } from '../formats/race.js'
import { decodePalette } from '../formats/pal.js'
import { decompress } from '../formats/lz.js'
import { parseStrtPos, parseSettings, parseCheats, serializeSettings, DEFAULT_SETTINGS, CONTROL_NAME } from '../formats/globaldata.js'
import { buildArena } from '../formats/chr.js'
import { indexedToRgba, paint } from '../render/raster.js'
import { composeRaceView, bannerBlinkPhase } from '../render/raceView.js'
import { createMenuBuffer, MENU_VIEW } from '../render/menuView.js'
import { loadWorld, loadBrk, roundCtx, spawnCars, createCarRecordCarry } from '../engine/race.js'
import { createColDirBuffers } from '../engine/collide.js'
import { createBrkBuffer } from '../formats/levbrk.js'
import { runStep, runPreLoopRender } from '../engine/step.js'
import { droneControlByte } from '../engine/ai.js'
import { initCameraState } from '../engine/camera.js'
import { createKeyboardReader, createExtraKeysReader, createPauseKeyReader, createMenuReleaseTracker, createIsrKeyWordReader, recordingReader, SCANCODE_TO_KEY_CODE } from '../engine/input.js'
import { createPauseState, updatePause } from '../engine/pause.js'
import { createRaceEndState, updateRaceEnd } from '../engine/raceEnd.js'
import { createFadeState, updateFade, applyFade, raceStartHold, FADE_UP_TICKS } from '../engine/fade.js'
import { createDacFadeState, raceSetupFade, raceStartFadeUp, raceExitFade, beginScreenFadeUp as dacBeginScreenFadeUp, screenFadeStep, screenPalette } from './dacFade.js'
import { raceStart, updateEngines, createRaceJitter, raceOverStart, raceOverGateCar, titleMusic, subMenuMusic, raceIntroMusic, raceResultMusic, raceOutcomeMusic, championMusic, eliminatedMusic } from '../engine/sound.js'
import { lapLineSegments, nearestPaletteIndex } from '../engine/lapLine.js'
import { Si2Player } from '../audio/si2Player.js'
import { RUFF_TRUCK_TIMES } from '../data/engine-tables.js'
import { initTournament, isInQualifier, applyRaceSkip, pickPlayerCharacter, pickOpponentCharacter, hasRaceIntro, raceIntroHoldTicks, raceIntroParticipants, screenAfterRace, showsOutcomeAfterResults, currentRace, reportRaceResult, reportRaceResultWithOpponentSnapshot, resultsPassed, shouldShowBoard, effectiveRaceIndex, opponentCharactersFor, needsOpponentPick, hasEmptyOpponentSlot, applyLivesCheat, OUTCOME } from './tournament.js'
import { CHARACTER_NAMES, OUTCOME_MESSAGES, resolveSmoothnessForPlay } from '../data/frontend-tables.js'
import { paintOps, layoutChooseGame, layoutTwoPlayerRaceInfo, layoutTwoPlayerResult, layoutSingleRaceSelect, slideIconX } from './h2hScreens.js'
import { drawTwoPlayerPickLabels, drawTitleScreen, drawSelectGame, drawOnePlayerGameMenu, drawCharacterSelect, drawOpponentPanel, drawEliminatedScreen, drawPressAnyKey, drawRaceIntro, drawResults, drawOutcome, drawChampion, drawTournamentBoard, drawOptionsScreen, drawCreditsScreen, drawRedefineKeysScreen, drawQuitToDosScreen, redefineKeyChar, REDEFINE_SLOT_LABELS } from './screens.js'
import { createSmoothnessGate } from '../engine/smoothness.js'
import { introInitialState, introStep, smPalette, SCREEN_W as LOGO_W, SCREEN_H as LOGO_H } from '../formats/gfx1.js'
import { attractInitialState, attractStep } from './attract.js'
import { twoItemMenuInitialState, twoItemMenuStep } from './frontMenu.js'
import { charSelectInitialState, charSelectStep, handicapQuestionApplies, handicapInitialState, handicapStep } from './charSelect.js'
import { boardInitialState, boardStep } from './board.js'
import { eliminationInitialState, eliminationStep } from './elimination.js'
import { waitScreenInitialState, waitScreenStep, holdTicksPreStep } from './keyWait.js'
import { outcomeWaitInitialState, outcomeWaitStep } from './outcomeWait.js'
import { championInitialState, championStep } from './champion.js'
import { pressAnyKeyInitialState, pressAnyKeyStep } from './pressAnyKey.js'
import { twoHumanSessionState, twoHumanSetupState, twoHumanRosterBytes, commitTwoHumanPick, twoHumanMatchState, H2H_P1_START, H2H_P2_START, nextTrack, reportRace, raceInfoSlideTicks, raceResultScreenInitialState, raceResultScreenStep, RACE_RESULT_SLIDE_TICKS, singleRaceSelectInitialState, singleRaceSelectStep } from './twoHuman.js'
import { windowedWaitInitialState, windowedWaitStep, RESULTS_17FF_CX } from './windowedWait.js'
import { composeCodeCardScreen, fontbinPalette, targetFromTickByte, moveCursor, CURSOR_X0, CURSOR_Y0, CODECARD_W, CODECARD_H } from '../formats/fontbin.js'
import { cycleControl, cycleSound, cycleSmoothness, advanceCheatCursor, redefineKeyAccepted, redefineGroupOf, redefineSlotInGroup, REDEFINE_TOTAL_SLOTS, REDEFINE_SLOTS_PER_GROUP } from './options.js'

const STEP_DT = 1 / 35 // 35 Hz physics (docs/engine.md §2), matching play.js's own constant

// KeyboardEvent.code -> PC/XT scancode, the inverse of input.js's own table -- F5's redefine-keys
// screen (1000:9357-9379) reads a raw scancode from any key on the keyboard, not just the 5-key
// subset a race reader cares about.
const REDEFINE_KEY_SCANCODES = Object.fromEntries(Object.entries(SCANCODE_TO_KEY_CODE).map(([sc, code]) => [code, Number(sc)]))

const SETTINGS_STORAGE_KEY = 'mm-settings-dat-v1'
function bytesToBase64(bytes) { return btoa(String.fromCharCode(...bytes)) }
function base64ToBytes(b64) { return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)) }
/** localStorage's own persisted SETTINGS.DAT (32 raw bytes, base64), or null if there isn't one
 * yet -- the seed-from-game/SETTINGS.DAT case falls through to the caller. */
function loadStoredSettings() {
  try {
    const b64 = window.localStorage.getItem(SETTINGS_STORAGE_KEY)
    return b64 ? parseSettings(base64ToBytes(b64)) : null
  } catch { return null } // private mode / localStorage disabled -- behave as if never saved
}

export async function bootGame({ canvas, statusEl, pickButton, dropZone, oplStrictCheckbox, lapLineToggle }) {
  const source = await resolveSource({ statusEl, pickButton, dropZone })
  const read = (p) => source.read(p)
  if (pickButton) pickButton.hidden = true

  // Created once per session (not once per race): `UNKNOWN_tile_index_overflow`'s own real
  // colFileBuf/dirFileBuf/.BRK buffer all carry over, uncleared, across every race a real
  // continuous session loads (docs/engine.md §9ad) -- this is the one caller in this port that
  // genuinely represents that (a real tournament run, one race after another), so it's the one
  // place this opts in.
  const colDirBuffers = createColDirBuffers()
  // The car records' bytes race setup never writes carry from one race into the next, BX-quirk
  // garbage included (docs/engine.md §9cs) -- once per session too.
  const carRecordCarry = createCarRecordCarry()
  const brkBuffer = createBrkBuffer()

  statusEl.textContent = 'Loading front-end assets…'
  const [{ arena }, introPalBytes, settingsBytes, driverBytes, strtList, gfx1Bytes, smBytes, cheatsBytes, fontbinBytes] = await Promise.all([
    buildArena(read),
    read('INTRO.PAL'),
    read('SETTINGS.DAT').catch(() => null),
    Promise.all(['DRIVER0.BIN', 'DRIVER1.BIN', 'DRIVER2.BIN'].map((n) => read(n))), // [0F64] 0/1/2 (docs/sound.md §4b)
    parseStrtPos(await read('GAME1/STRT_POS.BIN')),
    read('GFX1.GFX').catch(() => null), // the Codemasters logo intro (M3.10, "optional, cheap") --
    read('SM.EXE').catch(() => null),   // missing either one just skips straight to the title screen
    read('GAME1/CHEATS.BIN'),
    read('FONT.BIN').catch(() => null), // P1's code-card screen -- missing it just skips straight to TITLE
  ])
  const menuPal = decodePalette(introPalBytes).rgb
  const cheats = parseCheats(cheatsBytes)

  // P1's third boot item (GOAL-DOS-PARITY.md, docs/engine.md §9au): SETTINGS.DAT persistence.
  // DOS reads the file once and writes it back only when something changed (RunOptionsScreen
  // WithSettingsDat 1000:27E5's own [0xEFF] "read once" gate, 2A13-2A6D's own dirty-flag write).
  // A browser has no writable game/ directory, so the port keeps the SAME 32-byte layout in
  // localStorage instead: SETTINGS_STORAGE_KEY holds it as base64, seeded from the real
  // game/SETTINGS.DAT the first time (matching the goal's own instruction), falling further back
  // to the DS image's own static defaults (globaldata.js's DEFAULT_SETTINGS) only if that file is
  // missing too.
  const settings = loadStoredSettings() ?? (settingsBytes ? parseSettings(settingsBytes) : { ...DEFAULT_SETTINGS })
  let settingsDirty = false
  function persistSettingsIfDirty() {
    if (!settingsDirty) return // 2A13: `[0xF63]==0` skips the write entirely
    try { window.localStorage.setItem(SETTINGS_STORAGE_KEY, bytesToBase64(serializeSettings(settings))) } catch { /* private mode / quota -- silently keep the in-memory value, matching a real write failure's own silent JC 2A6E */ }
    settingsDirty = false
  }
  let keys2 = settings.keys2
  // KEYS1(4) or KEYS2(5) -- the only two devices reachable yet (P6 adds JOY1/JOY2/MOUSE), shared
  // by every P1-only input site (the race itself, the title screen's own fire test, the character
  // select carousel).
  const p1Keys = () => (settings.p1Control === 4 ? settings.keys1 : keys2)
  const p2Keys = () => (settings.p2Control === 4 ? settings.keys1 : keys2)
  // P2's global "which key was just released" latch (GOAL-DOS-PARITY.md, engine/input.js's own
  // header comment): one instance for the whole session, `.reset()` at each menu screen's entry
  // (mirroring the real ISR's many `[107e]=0;[107f]=0` writes), read once per tick by whichever
  // screen is current.
  const menuReleaseTracker = createMenuReleaseTracker(window)
  /** `1000:179B`'s own P1/P2 readers, SESSION-lifetime (docs/engine.md §9bp). The real keyboard ISR
   * keeps `[0x108B]` current all session long, so a fire key pressed on the PREVIOUS screen (e.g.
   * the fire that confirms PRESS_ANY_KEY and so enters RACE_INTRO) is still seen as held when
   * `179B` starts, and stage 1 debounces it. A reader created at phase entry misses a key pressed
   * before it existed -- as first written, the keydown confirming PRESS_ANY_KEY was the very event
   * that created RACE_INTRO's reader, which never saw it, so `179B` skipped straight to stage 2 (an
   * advisor review caught this; reproduced live). Recreated only when the
   * bindings change (`optionsConfirm`). */
  let waitReaders = null
  let waitReadersBinding = null
  // A player's reader byte also carries three more keys below its five controls (input.js's
  // createExtraKeysReader header): F1/F2/F3 for KEYS1, D/SPACE/V for KEYS2. F1-F3 are mapped here,
  // not in SCANCODE_TO_KEY_CODE, so they don't become bindable on the redefine-keys screen.
  const EXTRA_KEY_CODES = { 0x3b: 'F1', 0x3c: 'F2', 0x3d: 'F3' }
  const extraKeysFor = (control) => (control === 4 ? settings.f1f3 : control === 5 ? settings.dSpaceV : []).map((sc) => SCANCODE_TO_KEY_CODE[sc] ?? EXTRA_KEY_CODES[sc]) // only the two keyboard devices; JOY/MOUSE readers return their own bytes (P6)
  function refreshWaitReaders() {
    const binding = JSON.stringify([p1Keys(), p2Keys(), settings.p1Control, settings.p2Control, settings.f1f3, settings.dSpaceV])
    if (binding === waitReadersBinding) return
    if (waitReaders) for (const r of Object.values(waitReaders)) r.dispose()
    waitReaders = {
      p1: createKeyboardReader(p1Keys(), window), p2: createKeyboardReader(p2Keys(), window),
      p1Extra: createExtraKeysReader(extraKeysFor(settings.p1Control), window), p2Extra: createExtraKeysReader(extraKeysFor(settings.p2Control), window),
    }
    waitReadersBinding = binding
  }
  refreshWaitReaders()
  /** `1000:179B`'s own per-tick input (docs/engine.md §9bn/§9bp): `[0x1080]=0` at its entry means
   * `[0x108B]` is BOTH players' reader bits combined, and `[0x107E]` (any released key, ESC or not)
   * is the release latch. */
  function readWaitInput() {
    const bits = waitReaders.p1.read() | waitReaders.p2.read()
    const { escReleased, otherReleased, code } = menuReleaseTracker.read()
    return { fireHeld: (bits & 0x08) !== 0, anyKeyReleased: escReleased || otherReleased, releasedCode: code } // releasedCode: [0x107E]'s own scancode, for the race skip
  }

  // LoadSoundDriverBinModule 321C: SETTINGS.DAT word 3 ([0F64]) picks DRIVER0 (none), DRIVER1 (the OPL2
  // "BLASTER") or DRIVER2 (the PC-speaker "SPEAKER"), reloaded fresh at the options screen's RETURN
  // (0051/0066) and after every race (26C0 -> 321C); the options screen itself is silent.
  const DRIVER_KINDS = ['none', 'opl', 'speaker']
  const driverImage = (n) => { const b = driverBytes[n] ?? driverBytes[1]; return b.buffer ?? b }
  const loadSoundDriver = () => sound.load(driverImage(settings.soundDriver), { kind: DRIVER_KINDS[settings.soundDriver] ?? 'opl', strictOpl2: !!oplStrictCheckbox?.checked })
  const sound = new Si2Player()
  await sound.start(driverImage(settings.soundDriver), { kind: DRIVER_KINDS[settings.soundDriver] ?? 'opl', strictOpl2: !!oplStrictCheckbox?.checked }) // M3.10 OPL waveform toggle
  window.addEventListener('keydown', () => sound.resume()) // see play.js's own comment on this pattern

  // M3.10 smoothness (src/engine/smoothness.js): n=1 is the smoothest/most-often-drawn setting,
  // not the choppiest -- see that module's header. A fresh gate is created per race (in
  // runOneRace, below), not once here: an advisor review caught that a single session-lifetime
  // gate's draw-period only lines up correctly for the first race -- every later race starts
  // mid-period against whatever step count the previous race ended on. The header's own
  // <select id="smoothness"> is gone (P1, GOAL-DOS-PARITY.md): F4 on the real OPTIONS screen is
  // the one control now, including AUTO (5), which resolveSmoothnessForPlay resolves at RETURN.
  let smoothnessN = resolveSmoothnessForPlay(settings.smoothness)
  // [2638] across races (docs/engine.md §9ck): the race loop's steps-to-present counter as the last
  // race's loop left it -- 0 at boot. Race setup's pre-loop render (39E8 -> 90C5) draws, and runs
  // the state handlers once, only when it is 1: never before the first race, always after one at
  // smoothness 1.
  let presentCountdown = 0

  canvas.width = MENU_VIEW.w
  canvas.height = MENU_VIEW.h
  const menuBuf = createMenuBuffer()

  // [26CE] and the front end's palette fades (docs/engine.md §9cp, dacFade.js): the first screen
  // after a race fades up for 17 ticks with its own logic frozen; race setup fades the screen before
  // the race out.
  const dac = createDacFadeState()
  const beginScreenFadeUp = (kind = 'up', onDone = null) => dacBeginScreenFadeUp(dac, kind, onDone)
  const menuPalNow = () => (dac.screen ? decodePalette(screenPalette(dac, introPalBytes)).rgb : menuPal)
  /** At the top of a screen's tick: while its 32CE runs, repaint the screen at the fading palette
   * and skip the screen's own logic (true). Key releases still latch meanwhile. */
  function screenFadeHold(dtMs) {
    if (!dac.screen) return false
    const holding = screenFadeStep(dac, Math.min(dtMs, 250))
    paint(canvas, MENU_VIEW.w, MENU_VIEW.h, indexedToRgba(menuBuf, menuPalNow()), { zoom: 1 })
    return holding
  }

  // P1 (GOAL-DOS-PARITY.md, docs/intro-and-codecard.md, src/formats/gfx1.js header comment):
  // SM.EXE's own real per-frame animation (48-record reveal, banner slide, diagonal shine sweep),
  // not a static still. Real timing: one step per VGA vsync (~70Hz); missing either file just
  // skips the intro outright. A key press does NOT skip it (SM.EXE's own INT9 hook consumes every
  // keystroke itself, never chaining to the BIOS) -- only a mouse click does, or else the fixed
  // post-shine 250-tick hold auto-advances. Holding A and B together (the one real, if obscure,
  // keyboard effect -- see the gfx1.js header) holds the hold open indefinitely.
  const introPalette = smBytes ? smPalette(smBytes) : null
  const introState = gfx1Bytes && smBytes ? introInitialState(gfx1Bytes, smBytes) : null
  const introHeldKeys = new Set()
  let introMouseDown = false
  let introRafId = null
  let introLast = 0
  let introAcc = 0
  const INTRO_TICK_MS = 1000 / 70
  function paintIntroFrame() {
    paint(canvas, LOGO_W, LOGO_H, indexedToRgba(introState.screen, introPalette), { zoom: 1 })
    statusEl.textContent = 'LOGO (click to skip)'
  }
  function introTick(now) {
    if (phase !== 'LOGO') return
    introAcc += Math.min(now - introLast, 250)
    introLast = now
    const abHeld = introHeldKeys.has('KeyA') && introHeldKeys.has('KeyB')
    while (introAcc >= INTRO_TICK_MS) {
      introAcc -= INTRO_TICK_MS
      introStep(introState, { abHeld, mousePresent: true, mouseDown: introMouseDown })
      if (introState.exited) { leaveLogo(); return }
    }
    paintIntroFrame()
    introRafId = requestAnimationFrame(introTick)
  }
  function leaveLogo() {
    if (introRafId != null) { cancelAnimationFrame(introRafId); introRafId = null }
    if (fontbinBytes) enterCodeCard(); else leaveCodeCard()
  }

  // P1's second item (GOAL-DOS-PARITY.md, docs/intro-and-codecard.md's "The real code-card
  // screen"): FONT.BIN's mode-10h screen, shown after the logo, before the title. Both compare
  // sites are byte-patched in this copy (see fontbin.js's patchState header), so ENTER is always
  // accepted -- but the real screen (the welcome paragraph, the live target column/row, the
  // symbol grid, the cursor) is shown for real, twice, exactly as the disassembly runs it: round
  // 1 -> "Correct, now one more" interstitial (grid/cursor stay visible underneath) -> round 2 ->
  // straight to the title, no second interstitial.
  const codecardPalette = fontbinBytes ? fontbinPalette(fontbinBytes) : null
  let codecard = null // { round, stage: 'prompt'|'correct', target, cursor }
  function freshTarget() {
    // [0x40:6C]'s own low byte, live and free-running -- see fontbin.js's targetFromTickByte header.
    return targetFromTickByte(Math.floor(performance.now() / (1000 / 18.2)) & 0xff)
  }
  function enterCodeCard() {
    canvas.width = CODECARD_W
    canvas.height = CODECARD_H
    codecard = { round: 1, stage: 'prompt', target: freshTarget(), cursor: { x: CURSOR_X0, y: CURSOR_Y0 } }
    phase = 'CODECARD'
    paintCodeCard()
  }
  function paintCodeCard() {
    const composed = composeCodeCardScreen(fontbinBytes, codecard)
    paint(canvas, CODECARD_W, CODECARD_H, indexedToRgba(composed.indexed, codecardPalette), { zoom: 1, aspect43: true })
    statusEl.textContent = codecard.stage === 'prompt' ? 'CODE CARD (arrows move, ENTER accepts)' : 'CODE CARD'
  }
  function codeCardMove(dir) {
    if (phase !== 'CODECARD' || codecard.stage !== 'prompt') return
    codecard.cursor = moveCursor(codecard.cursor, dir)
    paintCodeCard()
  }
  function codeCardConfirm() {
    if (phase !== 'CODECARD') return
    if (codecard.stage === 'prompt') {
      // 1000:02F4-033B computes AL=expected/DL=chosen and compares -- patched to always "pass"
      // (fontbin.js's patchState); the port skips the (unused) compare for the same reason.
      if (codecard.round === 1) { codecard.stage = 'correct'; paintCodeCard() }
      else leaveCodeCard() // round 2's own success falls straight to the mode-3 return, no interstitial
    } else {
      // "Correct, now one more": any key dismisses it (0133's `int 16h ah=0`), round 2 starts with
      // a fresh target but the SAME cursor position (never reset between rounds).
      codecard = { round: 2, stage: 'prompt', target: freshTarget(), cursor: codecard.cursor }
      paintCodeCard()
    }
  }
  function leaveCodeCard() {
    codecard = null
    enterOptions()
  }

  // P1's third boot item (GOAL-DOS-PARITY.md, docs/engine.md §9au): RunOptionsScreenWithSettingsDat
  // 1000:2770, shown after the code card, before the title. F1/F2 cycle the control device (P1 can
  // never reach JOY2/MOUSE, regardless of hardware -- a real, live-confirmed asymmetry, not a
  // simplification; both currently only ever reach KEYS1/KEYS2 since no joystick/mouse input is
  // wired up yet, P6); F3 the sound driver; F4 the smoothness (including AUTO); F5 opens the
  // redefine-keys sub-screen; F6 the credits; ENTER commits (writing SETTINGS.DAT only if
  // something actually changed) and plays; ESC quits -- for real, live-confirmed: an immediate,
  // unconfirmed drop to the DOS prompt, no "are you sure".
  let options = null // { sub: 'main'|'credits'|'redefine', cheatCursor, redefineScratch, redefineSlotIndex }
  let cheatActive = false // DS:0F69 -- survives past the OPTIONS phase itself (options is reset to null on leaving), tournament.js's own lives-to-10 effect reads this
  const deviceAvail = { joy1: false, joy2: false, mouse: false } // no joystick/mouse input yet -- P6
  function enterOptions() {
    canvas.width = MENU_VIEW.w
    canvas.height = MENU_VIEW.h
    options = { sub: 'main', cheatCursor: 0, redefineScratch: [], redefineSlotIndex: 0 }
    phase = 'OPTIONS'
    paintOptions()
  }
  function paintOptions() {
    menuBuf.fill(0)
    if (options.sub === 'credits') drawCreditsScreen(menuBuf, arena)
    else if (options.sub === 'redefine') drawRedefineKeysScreen(menuBuf, arena, { slots: options.redefineScratch, slotIndex: options.redefineSlotIndex })
    else drawOptionsScreen(menuBuf, arena, { settings, cheatActive })
    paint(canvas, MENU_VIEW.w, MENU_VIEW.h, indexedToRgba(menuBuf, menuPalNow()), { zoom: 1 })
    statusEl.textContent = 'GAME OPTIONS'
  }
  /** F1-F7 dispatch (1000:28BE-2A08); anything else falls through to the cheat-code check. */
  function optionsMenuKey(code) {
    if (code === 'F1') { settings.p1Control = cycleControl(settings.p1Control, settings.p2Control, true, deviceAvail); settingsDirty = true }
    else if (code === 'F2') { settings.p2Control = cycleControl(settings.p2Control, settings.p1Control, false, deviceAvail); settingsDirty = true }
    else if (code === 'F3') { settings.soundDriver = cycleSound(settings.soundDriver); settingsDirty = true }
    else if (code === 'F4') { settings.smoothness = cycleSmoothness(settings.smoothness); settingsDirty = true }
    else if (code === 'F5') { settingsDirty = true; options.sub = 'redefine'; options.redefineScratch = []; options.redefineSlotIndex = 0 }
    else if (code === 'F6') { options.sub = 'credits' }
    else return false
    paintOptions()
    return true
  }
  function optionsConfirm() {
    // 1000:2A6E-2A7E: AUTO resolves here, right before the settings write and the game actually
    // starting -- see frontend-tables.js's own resolveSmoothnessForPlay header for why the port
    // resolves it to 1 (HIGH) unconditionally rather than replicating the real CPU-speed probe.
    settings.smoothness = resolveSmoothnessForPlay(settings.smoothness)
    smoothnessN = settings.smoothness
    keys2 = settings.keys2
    refreshWaitReaders() // new bindings -> new 179B readers (a no-op if nothing changed)
    persistSettingsIfDirty()
    options = null
    loadSoundDriver() // 0051/0066: the driver the new setting names
    enterTitle()
  }
  function optionsEscape() {
    // 1000:28BE-28C2: STC;RET -- the real game drops straight to DOS, no write (the dirty flag is
    // never even consulted on this path). No further input is read once here.
    options = null
    phase = 'QUIT'
    menuBuf.fill(0)
    drawQuitToDosScreen(menuBuf, arena)
    paint(canvas, MENU_VIEW.w, MENU_VIEW.h, indexedToRgba(menuBuf, menuPalNow()), { zoom: 1 })
    statusEl.textContent = 'Quit to DOS (this is a port -- close the tab, or reload to play again)'
  }
  function optionsKey(e) {
    if (options.sub === 'credits') { options.sub = 'main'; paintOptions(); return } // 1000:2AAD: any key dismisses it
    if (options.sub === 'redefine') { redefineKey(e); return }
    if (e.code === 'Escape') { optionsEscape(); return }
    if (e.code === 'Enter') { optionsConfirm(); return }
    if (optionsMenuKey(e.code)) return
    // 1000:28FE-2924: every other key is checked against the 25011968 cheat sequence (raw digits,
    // not a specific key group) -- see options.js's own advanceCheatCursor header.
    const digit = /^Digit[0-9]$/.test(e.code) ? e.code.slice(5) : null
    const { cursor, completed } = advanceCheatCursor(options.cheatCursor, digit)
    options.cheatCursor = cursor
    if (completed) { cheatActive = true; settingsDirty = true }
    if (completed || digit != null) paintOptions()
  }
  /** The redefine-keys sub-screen (1000:9357-93A9): a plain keydown scancode map covers this
   * screen's own reachable keys (digits/letters -- the same set FONT.BIN's own scancode->display
   * table names, plus arrows/space, which are valid TARGETS even though this table shows them as
   * '?'). ESC (1000:935E) returns to the main options screen without saving any of this pass. */
  function redefineKey(e) {
    if (e.code === 'Escape') { options.sub = 'main'; paintOptions(); return } // 93BB: plain RET, not the top-level quit signal
    const scancode = REDEFINE_KEY_SCANCODES[e.code]
    if (scancode == null) return // not on the real keyboard-scancode path this screen reads (e.g. a modifier) -- ignored
    if (!redefineKeyAccepted(scancode, options.redefineScratch)) return // SPACE, or a duplicate within this pass
    options.redefineScratch[options.redefineSlotIndex] = scancode
    options.redefineSlotIndex++
    if (options.redefineSlotIndex >= REDEFINE_TOTAL_SLOTS) {
      // 1000:93AC-93BA: KEYS1 -> slots 0-4, KEYS2 -> slots 8-12 (5-7 and 13-15 untouched).
      settings.keys1 = options.redefineScratch.slice(0, REDEFINE_SLOTS_PER_GROUP)
      settings.keys2 = options.redefineScratch.slice(REDEFINE_SLOTS_PER_GROUP, REDEFINE_TOTAL_SLOTS)
      options.sub = 'main'
    }
    paintOptions()
  }

  // P2's first item (GOAL-DOS-PARITY.md, src/frontend/attract.js): RunTitleScreenAttractLoop
  // 1000:0100, real-time paced the same way the LOGO intro is (an accumulator against
  // INTRO_TICK_MS, the ~70Hz tick both `attract.js` and `gfx1.js` approximate DS:0002 with).
  let titleState = null
  let titleReader = null
  let titleRafId = null
  let titleLast = 0
  let titleAcc = 0
  function enterTitle() {
    canvas.width = MENU_VIEW.w
    canvas.height = MENU_VIEW.h
    titleState = attractInitialState()
    titleReader = createKeyboardReader(p1Keys(), window) // fire only -- title reads P1's OWN reader slot directly, never the combined-both-players byte the menu levels use
    menuReleaseTracker.reset() // 1000:0081: [0x1096]=0 before every 0100 call
    phase = 'TITLE'
    beginScreenFadeUp() // 01A9, after 0081's latch clear: a release during the fade counts
    titleMusic(sound) // 1000:0066-007B: tune 1 (re)started right before every real entry into the title
    paintTitle()
    titleLast = performance.now()
    titleAcc = 0
    titleRafId = requestAnimationFrame(titleTick)
  }
  function paintTitle() {
    menuBuf.fill(0)
    drawTitleScreen(menuBuf, arena, { classIndex: titleState.classIndex })
    paint(canvas, MENU_VIEW.w, MENU_VIEW.h, indexedToRgba(menuBuf, menuPalNow()), { zoom: 1 })
    statusEl.textContent = 'MicroMachines'
  }
  function titleTick(now) {
    if (phase !== 'TITLE') return
    if (dac.screen) { const held = screenFadeHold(now - titleLast); titleLast = now; if (held) { titleRafId = requestAnimationFrame(titleTick); return } } // the ending frame's dt is the fade's, not the screen's
    titleAcc += Math.min(now - titleLast, 250)
    titleLast = now
    while (titleAcc >= INTRO_TICK_MS) {
      titleAcc -= INTRO_TICK_MS
      const bits = titleReader.read()
      const { escReleased, otherReleased } = menuReleaseTracker.read()
      const r = attractStep(titleState, { p1Fire: (bits & 0x08) !== 0, escReleased, otherReleased })
      if (r.exit) { leaveTitle(r.exit); return }
    }
    paintTitle()
    titleRafId = requestAnimationFrame(titleTick)
  }
  /** real_entry's own master loop (1000:0086-0095, re-disassembled for this item): fire or any
   * other key release (CF=0) falls into RunMainMenuKeepTitleTune (0220, P2's second item);
   * ESC release (CF=1) loops all the way back to StopMusic+OPTIONS, not some intermediate state. */
  function leaveTitle(exit) {
    if (titleRafId != null) { cancelAnimationFrame(titleRafId); titleRafId = null }
    titleReader?.dispose(); titleReader = null
    if (exit === 'options') { enterOptions(); return }
    enterSelectGame() // no music call: tune 1 just keeps playing (docs/engine.md §7's "the main menu keeps tune 1")
  }

  // P2's second item (GOAL-DOS-PARITY.md, src/frontend/frontMenu.js): RunMainMenuKeepTitleTune
  // 1000:0220 (SELECT GAME) and RunOnePlayerGameMenu 1000:02e0 (ONE PLAYER GAME) -- one shared
  // driver, since both are the exact same RunTwoItemMenu (0382) state machine, differing only in
  // the screen painted and what a confirm/cancel does next. [0x130]/[0x132], the two levels' own
  // persisted selections, are real static-image scratch words this session read live (resting
  // value 1/2, docs/engine.md §9av's own correction of the earlier "nothing selected" claim) --
  // and a genuine asymmetry between them: SELECT GAME (`02CB`) only persists a REAL confirm (the
  // write is skipped entirely on a cancel), while ONE PLAYER GAME (`0360`) persists EVERY exit,
  // including a cancel (CX=0, "nothing selected" for the NEXT visit) -- re-checked directly
  // against the raw disassembly, not assumed symmetric.
  let lastSelectGameSelection = 1 // [0x130]'s own resting value
  let lastOnePlayerSelection = 2 // [0x132]'s own resting value
  let twoItemState = null
  let twoItemReaders = null // { p1, p2 } -- 0382 sets [0x1080]=0, combining both players' input at every level of this menu
  let twoItemPaint = null
  let twoItemOnExit = null // (exit, selection) => void
  let twoItemRafId = null
  let twoItemLast = 0
  let twoItemAcc = 0
  function enterTwoItemMenu(phaseName, initialSelection, paintFn, onExit) {
    canvas.width = MENU_VIEW.w
    canvas.height = MENU_VIEW.h
    phase = phaseName
    twoItemState = twoItemMenuInitialState(initialSelection)
    twoItemReaders = { p1: createKeyboardReader(p1Keys(), window), p2: createKeyboardReader(p2Keys(), window) }
    menuReleaseTracker.reset() // 1000:038c: [0x107e]=0 at every 0382 entry
    twoItemPaint = paintFn
    twoItemOnExit = onExit
    twoItemPaint()
    twoItemLast = performance.now()
    twoItemAcc = 0
    twoItemRafId = requestAnimationFrame(twoItemTick)
  }
  function twoItemTick(now) {
    if (phase !== 'SELECT_GAME' && phase !== 'ONE_PLAYER_GAME' && phase !== 'CHOOSE_GAME') return
    twoItemAcc += Math.min(now - twoItemLast, 250)
    twoItemLast = now
    while (twoItemAcc >= INTRO_TICK_MS) {
      twoItemAcc -= INTRO_TICK_MS
      const bits = twoItemReaders.p1.read() | twoItemReaders.p2.read()
      const { escReleased } = menuReleaseTracker.read()
      const r = twoItemMenuStep(twoItemState, { bits, escReleased })
      if (r.exit) { leaveTwoItemMenu(r.exit, r.selection); return }
    }
    twoItemPaint()
    twoItemRafId = requestAnimationFrame(twoItemTick)
  }
  function leaveTwoItemMenu(exit, selection) {
    if (twoItemRafId != null) { cancelAnimationFrame(twoItemRafId); twoItemRafId = null }
    twoItemReaders.p1.dispose(); twoItemReaders.p2.dispose(); twoItemReaders = null
    const onExit = twoItemOnExit
    twoItemOnExit = null
    onExit(exit, selection)
  }
  function paintSelectGame() {
    menuBuf.fill(0)
    drawSelectGame(menuBuf, arena, { selection: twoItemState.selection })
    paint(canvas, MENU_VIEW.w, MENU_VIEW.h, indexedToRgba(menuBuf, menuPalNow()), { zoom: 1 })
    statusEl.textContent = 'SELECT GAME'
  }
  function enterSelectGame() {
    enterTwoItemMenu('SELECT_GAME', lastSelectGameSelection, paintSelectGame, (exit, selection) => {
      if (exit === 'cancel') { enterTitle(); return } // 0220's own top-level idle/ESC cancel (1000:0093 JC 0069): back to the tune-1 dance + TITLE
      lastSelectGameSelection = selection // 1000:02cb -- only reached on a real (nonzero) confirm
      if (selection === 2) { enterTwoPlayerSetup(); return } // 02D9: CALL 1E20, then CLC;RET back to real_entry's own loop (SELECT GAME again)
      enterOnePlayerGame()
    })
  }
  function paintOnePlayerGame() {
    menuBuf.fill(0)
    drawOnePlayerGameMenu(menuBuf, arena, { selection: twoItemState.selection })
    paint(canvas, MENU_VIEW.w, MENU_VIEW.h, indexedToRgba(menuBuf, menuPalNow()), { zoom: 1 })
    statusEl.textContent = 'ONE PLAYER GAME'
  }
  function enterOnePlayerGame() {
    enterTwoItemMenu('ONE_PLAYER_GAME', lastOnePlayerSelection, paintOnePlayerGame, (exit, selection) => {
      lastOnePlayerSelection = exit === 'confirm' ? selection : 0 // 1000:0360 -- unconditional, unlike SELECT GAME's own guarded write
      if (exit === 'cancel') { enterSelectGame(); return } // 0220's own CLC;RET after CALL 02e0 -- straight back to SELECT GAME, no tune restart, no title
      // selection 1 = LEFT = Head to Head vs CPU (0fbf); 2 = RIGHT = Challenge (102b)
      tournament = initTournament({ format: selection === 1 ? 'twocar' : 'challenge', evictionSlotCursor: tournament?._evictionSlotCursor ?? 0 }) // [0x346] carries over within the session
      subMenuMusic(sound) // docs/sound.md tune table: "2 all sub-menus" -- confirmed live on this screen
      enterCharSelect(lastPick.player, 'player')
    })
  }

  // P2's third item (GOAL-DOS-PARITY.md, src/frontend/charSelect.js): RunCharacterSelectMenuTune2
  // 1000:09e0, the real scrolling carousel. `[0x1080]=0x137b` (set by the CALLER, 0fbf/102b) means
  // this screen reads ONLY P1's own reader slot -- unlike SELECT_GAME/ONE_PLAYER_GAME's combined
  // both-players byte.
  let charSelectState = null
  let charSelectReader = null
  let charSelectRafId = null
  let charSelectLast = 0
  let charSelectAcc = 0
  function rosterBytes() {
    if (charWho.startsWith('h2h')) return twoHumanRosterBytes(h2hSetup)
    return tournament.roster.map((s) => s.index | (s.taken ? 0x40 : 0) | (s.eliminated ? 0x20 : 0))
  }
  function paintCharSelect() {
    menuBuf.fill(0)
    // The Challenge opponent picker (initial 3-pick OR a single elimination replacement) shows the
    // 4-face status panel behind the carousel -- 1A4A's own CALL 19F2, drawn once at its own entry
    // and left on screen (09E0 never clears it) for the WHOLE picking session in the real game; this
    // port instead redraws it fresh from the CURRENT tournament.opponents on every repaint, which
    // shows the identical end state (each pick reflected as soon as it's confirmed) without needing
    // a separate "drawn once, persists" buffer-layering mechanism (docs/engine.md §9az/§9ba).
    if (charWho === 'challenge-opponent') drawOpponentPanel(menuBuf, arena, { slots: [tournament.playerCharacter, ...tournament.opponents], header: false })
    const h2h = charWho.startsWith('h2h')
    drawCharacterSelect(menuBuf, arena, { scroll: charSelectState.scroll, cursor: charSelectState.cursor, roster: rosterBytes(), blinkOn: charSelectState.blinkOn, prompt: charWho !== 'player' && !h2h ? 'WHO DO YOU WANT TO RACE ?' : 'WHO DO YOU WANT TO BE ?' })
    if (h2h) drawTwoPlayerPickLabels(menuBuf, arena, { slot: charWho === 'h2h-p1' ? 0 : 1, handicap: phase === 'HANDICAP' ? { character: handicapCharacter, answer: handicapState.answer } : null })
    paint(canvas, MENU_VIEW.w, MENU_VIEW.h, indexedToRgba(menuBuf, menuPalNow()), { zoom: 1 })
    statusEl.textContent = 'CHAR_SELECT'
  }
  function enterCharSelect(startIndex, who) {
    canvas.width = MENU_VIEW.w
    canvas.height = MENU_VIEW.h
    phase = 'CHAR_SELECT'
    charWho = who
    charSelectState = charSelectInitialState(startIndex, rosterBytes())
    // Two-human picks read the PICKING player's own reader (1E20: [0x1080]=0x137B, then 0x14DF), and
    // the session-lifetime one, so the handicap question after it sees a fire still held from the
    // commit (0B51 has no release-wait, docs/engine.md §9bk/§9bv)
    charSelectReader = charWho.startsWith('h2h') ? null : createKeyboardReader(p1Keys(), window)
    menuReleaseTracker.reset()
    paintCharSelect()
    charSelectLast = performance.now()
    charSelectAcc = 0
    charSelectRafId = requestAnimationFrame(charSelectTick)
  }
  function charSelectTick(now) {
    if (phase !== 'CHAR_SELECT') return
    charSelectAcc += Math.min(now - charSelectLast, 250)
    charSelectLast = now
    while (charSelectAcc >= INTRO_TICK_MS) {
      charSelectAcc -= INTRO_TICK_MS
      const bits = charWho === 'h2h-p1' ? waitReaders.p1.read() : charWho === 'h2h-p2' ? waitReaders.p2.read() : charSelectReader.read()
      const { escReleased } = menuReleaseTracker.read()
      const r = charSelectStep(charSelectState, { bits, escReleased }, rosterBytes())
      if (r.exit) { leaveCharSelect(r.exit, r.character); return }
    }
    paintCharSelect()
    charSelectRafId = requestAnimationFrame(charSelectTick)
  }
  /** 09e0's own STC (ESC) returns straight to its caller, which for `player`/`opponent` (0fbf/102b's
   * OWN single character picks) falls straight through to RET without drawing anything else -- per
   * their own `if (!CF) {...}` guard -- landing back at 0220's own CLC;RET chain: SELECT GAME, same
   * as every other cancel this session traced (§9aw). `challenge-opponent` is different: `1A4A`'s
   * own caller loop (`1000:1A78: JNC 1A7C / JMP 1A69`) re-enters the SAME slot on ESC instead of
   * ever returning -- there is no way to cancel out of the Challenge opponent picker once the
   * qualifier has passed (docs/engine.md §9az). A confirm reuses tournament.js's own existing pick
   * functions. */
  function leaveCharSelect(exit, character) {
    if (charSelectRafId != null) { cancelAnimationFrame(charSelectRafId); charSelectRafId = null }
    charSelectReader?.dispose(); charSelectReader = null
    if (exit === 'cancel') {
      if (charWho === 'challenge-opponent') { enterOpponentPick(); return } // 1A4A: ESC just re-prompts, never exits
      enterSelectGame() // (for h2h-p1/h2h-p2 too: 1E9F/1EE6 JC 1EEB -> RET, back to SELECT GAME)
      return
    }
    if (charWho.startsWith('h2h')) { twoPlayerPicked(charWho === 'h2h-p1' ? 0 : 1, character); return }
    if (charWho === 'player') {
      pickPlayerCharacter(tournament, character)
      lastPick.player = character
      lastPick.challengeOpponent = null // a fresh tournament: 1A4A's own AX=0xFFFF should carry from THIS pick, not a previous run's last opponent
      if (tournament.format === 'twocar') {
        // 0FBF's second 09E0: "WHO DO YOU WANT TO RACE ?", starting on the last opponent pick and
        // stepping on (the carousel's remembered direction, LEFT by default) past a taken entry.
        let opp = lastPick.opponent
        while (tournament.roster[opp].taken) opp = (opp + 1) % 11
        enterCharSelect(opp, 'opponent')
        return
      }
    } else if (charWho === 'challenge-opponent') {
      pickOpponentCharacter(tournament, character) // defensive check inside -- charSelectStep's own taken-guard already makes a taken confirm unreachable
      lastPick.challengeOpponent = character
      if (hasEmptyOpponentSlot(tournament)) { enterOpponentPick(); return } // 1A4A's own re-scan loop: the next empty slot (0, 1, 2 or 3 of them -- the initial pick or a single replacement)
      // every slot filled: 1A4A's own trailing CALL 0C15 -- the SAME "PRESS ANY KEY TO START" the
      // qualifier's own character select already led to once; falls through to the shared tail below.
    } else {
      if (!pickOpponentCharacter(tournament, character)) { enterCharSelect(character, 'opponent'); return } // defensive -- charSelectStep's own taken-guard should make this unreachable
      lastPick.opponent = character
    }
    enterPressAnyKey()
  }

  /** 0C15: "PRESS ANY KEY TO START" (pressAnyKey.js, docs/engine.md §9bt): per tick, any key RELEASE
   * or P1's fire HELD leaves, or the ~10s (0x2BC-tick) timeout. Replaces the old any-keydown
   * dismiss and its setTimeout. */
  let pressAnyKeyState = null
  let pressAnyKeyRafId = null
  let pressAnyKeyLast = 0
  let pressAnyKeyAcc = 0
  function enterPressAnyKey() {
    phase = 'PRESS_ANY_KEY'
    menuReleaseTracker.reset() // 0C2D/0C32
    pressAnyKeyState = pressAnyKeyInitialState()
    paintMenu()
    pressAnyKeyLast = performance.now()
    pressAnyKeyAcc = 0
    if (pressAnyKeyRafId != null) cancelAnimationFrame(pressAnyKeyRafId)
    pressAnyKeyRafId = requestAnimationFrame(pressAnyKeyTick)
  }
  function readPressAnyKeyInput() {
    const { escReleased, otherReleased } = menuReleaseTracker.read()
    return { p1FireHeld: (waitReaders.p1.read() & 0x08) !== 0, anyKeyReleased: escReleased || otherReleased } // [0x1080]=0x137B: P1's reader only
  }
  function pressAnyKeyWaitTick(input) {
    if (pressAnyKeyStep(pressAnyKeyState, input).exit) { leavePressAnyKey(); return true }
    return false
  }
  function pressAnyKeyTick(now) {
    if (phase !== 'PRESS_ANY_KEY') return
    pressAnyKeyAcc += Math.min(now - pressAnyKeyLast, 250)
    pressAnyKeyLast = now
    while (pressAnyKeyAcc >= INTRO_TICK_MS) {
      pressAnyKeyAcc -= INTRO_TICK_MS
      if (pressAnyKeyWaitTick(readPressAnyKeyInput())) return
    }
    pressAnyKeyRafId = requestAnimationFrame(pressAnyKeyTick)
  }
  // NOT startNextRace() directly (a bug an advisor review caught): this PRESS_ANY_KEY is reached
  // twice -- before the qualifier (where nextAfterOutcome's own needsOpponentPick/shouldShowBoard
  // checks are both false, so behaviour is unchanged) AND after the opponent picker, right before
  // race 1 (where shouldShowBoard is TRUE and the board must show -- calling startNextRace()
  // directly skipped it entirely). For the H2H qualifier (no intro, hasRaceIntro()===false),
  // nextAfterOutcome's trailing paintMenu() runs in LOADING, which paints nothing (the PRESS ANY KEY
  // screen stays up for race setup's fade-out, docs/engine.md §9cp).
  function leavePressAnyKey() {
    if (pressAnyKeyRafId != null) { cancelAnimationFrame(pressAnyKeyRafId); pressAnyKeyRafId = null }
    nextAfterOutcome()
  }

  /** P3's second item (GOAL-DOS-PARITY.md, docs/engine.md §9az): the real interactive opponent
   * picker (`FUN_1000_1A4A`), triggered once from `nextAfterOutcome` right after a Challenge
   * qualifier PASS (`tournament.js`'s own `needsOpponentPick`). Reuses the SAME character-select
   * carousel as every other pick (`enterCharSelect`), just with `charWho='challenge-opponent'` so
   * `leaveCharSelect` knows to loop back here (not to SELECT GAME) on both a cancel and a
   * not-yet-all-3-picked confirm. Start index: `1A4A`'s own real AX=0xFFFF entry to `09E0` means
   * "keep the previous scroll position" (not ported byte-for-byte, see charSelect.js's own header
   * for this project's established `AWAIT_RELEASE`-class-of-simplification precedent) --
   * approximated as "start from the last pick" (the player's own, for the first of the 3; each
   * opponent's own, for the next), which lands on the SAME visual neighbourhood without needing a
   * separate raw-scroll-pixel carry mechanism. `09E0` re-asserts tune 2 on EVERY entry
   * (`1000:0A06-0A1D`, "is it already playing? if not, start it") -- by the time this runs, the
   * qualifier's own race music and then `raceOutcomeMusic` have already played, so this needs its
   * own `subMenuMusic` call too, not just the ONE already at the player's own first `enterCharSelect`
   * (an advisor review caught this was missing from the first draft). */
  function enterOpponentPick() {
    subMenuMusic(sound)
    enterCharSelect(lastPick.challengeOpponent ?? lastPick.player, 'challenge-opponent')
  }

  /** P3's third item (GOAL-DOS-PARITY.md, docs/engine.md §9ba): ShowCharacterEliminatedTune6
   * 1000:16de, the "IS OUT!!" bounce screen shown before the elimination replacement picker
   * (`tournament.js`'s own `checkElimination`/`pendingElimination`, wired into `nextAfterOutcome`
   * below, ahead of `needsOpponentPick`/`shouldShowBoard` -- `13E4`'s own call order). The bounce
   * itself (`elimination.js`) takes no input and always runs to completion (the real loop never
   * polls input); once done, `1000:1793`'s own `CALL 179B` runs -- the real two-stage key wait
   * (`keyWait.js`'s `waitScreenStep`, fed by both players' own fire bits and `menuReleaseTracker`,
   * with its own ~700-tick timeout -- docs/engine.md §9bn/§9bp) -- before clearing
   * `pendingElimination` and entering the replacement picker. */
  let eliminationState = null
  let eliminationRafId = null
  let eliminationLast = 0
  let eliminationAcc = 0
  let eliminationWait = null // waitScreenStep's own state: the bounce is its pre-wait work, 179B the wait
  function paintEliminated() {
    menuBuf.fill(0)
    const { victim, slot } = tournament.pendingElimination
    drawEliminatedScreen(menuBuf, arena, { victim, playerCharacter: tournament.playerCharacter, opponents: tournament.opponents, slot, step: eliminationState.step, frameOn: eliminationState.frameOn, done: eliminationState.done })
    paint(canvas, MENU_VIEW.w, MENU_VIEW.h, indexedToRgba(menuBuf, menuPalNow()), { zoom: 1 })
    statusEl.textContent = 'ELIMINATED'
  }
  function enterEliminatedScreen() {
    canvas.width = MENU_VIEW.w
    canvas.height = MENU_VIEW.h
    phase = 'ELIMINATED'
    eliminationState = eliminationInitialState()
    eliminationWait = waitScreenInitialState()
    eliminatedMusic(sound)
    paintEliminated()
    eliminationLast = performance.now()
    eliminationAcc = 0
    eliminationRafId = requestAnimationFrame(eliminationTick)
  }
  /** One ELIMINATED tick, shared by the real RAF loop and forceEliminationSteps. `input` is
   * `{ fireHeld, anyKeyReleased }` (ignored during the bounce). Returns true once the screen has left. */
  function eliminationWaitTick(input) {
    const r = waitScreenStep(eliminationWait, input, () => eliminationStep(eliminationState).done)
    if (r.entered) menuReleaseTracker.reset() // 17AB/17B0: 179B's own entry clears the release latch
    if (r.exit) { leaveEliminatedScreen(); return true }
    return false
  }
  function eliminationTick(now) {
    if (phase !== 'ELIMINATED') return
    eliminationAcc += Math.min(now - eliminationLast, 250)
    eliminationLast = now
    while (eliminationAcc >= INTRO_TICK_MS) {
      eliminationAcc -= INTRO_TICK_MS
      if (eliminationWaitTick(readWaitInput())) return
    }
    paintEliminated()
    eliminationRafId = requestAnimationFrame(eliminationTick)
  }
  function leaveEliminatedScreen() {
    if (eliminationRafId != null) { cancelAnimationFrame(eliminationRafId); eliminationRafId = null }
    tournament.pendingElimination = null
    enterOpponentPick()
  }

  // P3's first item (GOAL-DOS-PARITY.md, src/frontend/board.js): DrawTournamentBoard 1000:18d8,
  // shown between races in the Challenge format only (`tournament.js`'s own `shouldShowBoard`,
  // called from `nextAfterOutcome` below). Its wait is 17FF's own (board.js, windowedWait.js,
  // docs/engine.md §9br), read from the session-lifetime waitReaders so a fire held from the
  // previous screen is seen as held (the part-1 lesson, §9bp).
  let boardState = null
  let boardRafId = null
  let boardLast = 0
  let boardAcc = 0
  function paintBoard() {
    menuBuf.fill(0)
    drawTournamentBoard(menuBuf, arena, { raceIndex: effectiveRaceIndex(tournament), blinkOn: boardState.blinkOn })
    paint(canvas, MENU_VIEW.w, MENU_VIEW.h, indexedToRgba(menuBuf, menuPalNow()), { zoom: 1 })
    statusEl.textContent = 'BOARD'
  }
  function enterBoard() {
    canvas.width = MENU_VIEW.w
    canvas.height = MENU_VIEW.h
    phase = 'BOARD'
    boardState = boardInitialState({ bonusReveal: !!tournament.pendingBonusRace }) // 18F5: [28BF]==9 takes the 192B reveal
    menuReleaseTracker.reset() // the first 17FF call's own 180F/1814
    paintBoard()
    boardLast = performance.now()
    boardAcc = 0
    boardRafId = requestAnimationFrame(boardTick)
  }
  function boardTick(now) {
    if (phase !== 'BOARD') return
    boardAcc += Math.min(now - boardLast, 250)
    boardLast = now
    while (boardAcc >= INTRO_TICK_MS) {
      boardAcc -= INTRO_TICK_MS
      if (boardWaitTick(readWaitInput())) return
    }
    paintBoard()
    boardRafId = requestAnimationFrame(boardTick)
  }
  /** One BOARD tick, shared by the real RAF loop and forceBoardSteps. Returns true once left. */
  function boardWaitTick(input) {
    const r = boardStep(boardState, input)
    if (r.resetLatch) menuReleaseTracker.reset() // the next 17FF call's own 180F/1814
    if (r.exit) { leaveBoard(); return true }
    return false
  }
  function leaveBoard() {
    if (boardRafId != null) { cancelAnimationFrame(boardRafId); boardRafId = null }
    startNextRace()
    paintMenu()
  }

  let phase = introState ? 'LOGO' : fontbinBytes ? 'CODECARD' : 'OPTIONS'
  // 'player' ("WHO DO YOU WANT TO BE ?"), 'opponent' (H2H: "WHO DO YOU WANT TO RACE ?") or
  // 'challenge-opponent' (Challenge's own real 3-opponent picker, GOAL-DOS-PARITY.md P3's second
  // item, docs/engine.md §9az -- the SAME "WHO DO YOU WANT TO RACE ?" prompt as H2H's, `FUN_1A4A`).
  let charWho = 'player'
  // The select screens start on the session's last picks: statics [3F4]=10 / [3F6]=9 (SPIDER/BONNIE),
  // rewritten by each pick (1001/1018/1087) -- docs/engine.md §9an. `challengeOpponent`: null until
  // the first Challenge opponent pick, `1A4A`'s own real "keep the previous scroll position" (its
  // AX=0xFFFF entry to 09E0) approximated here as "start from the last pick" -- the player's own,
  // for the first of the 3, then each opponent's own for the next.
  const lastPick = { player: 10, opponent: 9, challengeOpponent: null }
  let tournament = null
  let lastStandings = null
  let lastPassed = null
  let currentCars = null // exposed on the session for debugging (play.js's own bootRace precedent)
  let currentRaceState = null // likewise

  function paintMenu() {
    // LOADING draws nothing: the screen before the race stays up, as in DOS during the load, and it
    // is what race setup's 395A fade-out then darkens (docs/engine.md §9cp).
    if (phase === 'LOADING') return
    menuBuf.fill(0)
    if (phase === 'PRESS_ANY_KEY') drawPressAnyKey(menuBuf, arena)
    else if (phase === 'RACE_INTRO') drawRaceIntro(menuBuf, arena, { ...currentRace(tournament), participants: raceIntroParticipants(tournament) })
    else if (phase === 'RESULTS') drawResults(menuBuf, arena, { standings: lastStandings, passed: lastPassed })
    else if (phase === 'OUTCOME') drawOutcome(menuBuf, arena, { message: OUTCOME_MESSAGES[tournament.lastOutcome] })
    else if (phase === 'CHAMPION') drawChampion(menuBuf, arena, { playerName: CHARACTER_NAMES[championCharacter ?? tournament.playerCharacter] })
    paint(canvas, MENU_VIEW.w, MENU_VIEW.h, indexedToRgba(menuBuf, menuPalNow()), { zoom: 1 })
    statusEl.textContent = phase
  }

  async function loadRaceAssets(round, race) {
    const [{ bytes: bank }, ctBytes, mapBytes, palBytes, vh0Bytes, ph0Bytes] = await Promise.all([
      loadTileBank(read, round),
      read(`GAME1/ROUND${round}BR.CT`),
      read(`GAME1/ROUND${round}${race}.MAP`),
      read(`GAME1/ROUND${round}.PAL`),
      read(`GAME1/ROUND${round}BR.VH0`),
      read('BITSFILE.PH0'),
    ])
    const world = await loadWorld(read, round, race, colDirBuffers)
    const brk = round === 9 ? undefined : await loadBrk(read, round, race, brkBuffer)
    // Captured BEFORE any frame can shift it (docs/engine.md §9al) -- rounds 1/3/5's own tile-0
    // parallax mutates `bank`'s slot 0 in place every frame, so the un-shifted source has to be a
    // separate, real copy, not a re-slice of the (by-then-mutated) live `bank`.
    const pristineTile0 = bank.slice(0, TILE_BYTES)
    return { bank, words: buildWordMap(mapBytes, ctBytes, round), palBytes, rgb: decodePalette(palBytes).rgb, ...vehicleFrames(decompress(vh0Bytes), round), ph0: decompress(ph0Bytes), world, brk, pristineTile0 }
  }

  /** The pause-time cheat effects (cheats.js `applyCheatEffect` -> `globalState`), applied on the
   * next physics step exactly as `play.js` does: type 9's projectiles-for-all gate, and type 1's
   * instant win -- [26C6]=4 (the race ends: at once in two-car, after the [26CC] countdown in
   * four-car), the fixed order car0/car2/car1/car3, and [2635], which the two-car exit fix-up
   * (3115, `twocar.js` `twoCarFinalOrder`) re-applies over the live two-car ranking. */
  function applyCheatGlobals(globalState, raceState, raceCtx) {
    raceCtx.projectilesForAll = !!globalState.projectilesForAll
    raceCtx.fireKeyDisabled = !!globalState.cheat5 // [2915], cheats 5/9: the fire entry becomes a coast (4F0D)
    if (globalState.raceOverCount != null && !globalState.raceOverApplied) {
      raceState.raceOverCount = globalState.raceOverCount
      if (globalState.fixedOrder) { raceState.rankOrder = [0, 2, 1, 3]; raceState.cheatWin = true }
      globalState.raceOverApplied = true
    }
  }

  /** Runs one race (or, for round 9, the bonus RUFFTRUX challenge) to completion and resolves the
   * result tournament.js's reportRaceResult expects. */
  /** `twoHuman`: a two-human Head to Head race's own setup (docs/engine.md §9bw) -- `{ raceNumber,
   * rosterWords }`: raceFormat 2, both cars human (`[0x2658]`/`[0x265A]` = the two players' own
   * devices), the alternate tuning path with the two slot words (`[0x8A2]` nonzero, §9bg), and a real
   * P2 reader for car 1. Otherwise the one-player `tournament` supplies everything, as before. */
  async function runOneRace({ round, race }, twoHuman = null) {
    statusEl.textContent = `Loading round ${round} race ${race}…`
    const { bank, words, palBytes, rgb, size: vehicleSize, frames, rotorFrames, bank2, pristineTile0, ph0, world, brk } = await loadRaceAssets(round, race)
    const strt = strtList.find((s) => s.round === round && s.race === race)
    const raceFormat = twoHuman ? 2 : tournament.format === 'twocar' ? 2 : 1
    // `UNKNOWN_kidmodifier_use` resolved 2026-09-22 -- `tournament.opponents` (the 3 drones' own
    // selected characters) feeds spawnCars's real per-car tuning handicap, not just
    // `raceCtx.tournamentIndex`. Both use `effectiveRaceIndex`, not `tournament.raceIndex` directly
    // -- during a pending bonus race DOS's own `[28C1]` (and every `[28C1]`-keyed physics read
    // during THAT race: ai.js's speed-limit adjustments, states.js's `7008` respawn nudge) is one
    // less than this port's own already-advanced `raceIndex` (docs/engine.md §9ay,
    // `tournament.js`'s own `effectiveRaceIndex` header for the full account -- found alongside the
    // tournament board item, but not board-specific).
    const tIndex = twoHuman ? twoHuman.raceNumber : effectiveRaceIndex(tournament) // [28C1]: 1FB9/207A in two-human play
    const controllerTypes = twoHuman ? [settings.p1Control, settings.p2Control, 6, 6] : [settings.p1Control, 6, 6, 6]
    const cars = twoHuman
      ? spawnCars(strtList, round, race, { raceFormat, tournamentIndex: tIndex, controllerTypes, altTuning: true, rosterWords: twoHuman.rosterWords })
      : spawnCars(strtList, round, race, { raceFormat, tournamentIndex: tIndex, opponentCharacters: opponentCharactersFor(tournament) })
    carRecordCarry.apply(cars) // what the last race left in the bytes setup doesn't write (§9cs)
    currentCars = cars
    const camera = initCameraState(strt)
    // controllerTypes [2658..265E]: P1's real chosen device (settings.p1Control, 1000:2D00's own
    // 1-based enum -- JOY1/JOY2/MOUSE never reachable yet, P6), every other car the CPU (6).
    const raceCtx = { ...roundCtx(round, race, { raceFormat }), brk, tournamentIndex: tIndex, world, stepIncrement: 1, sound, camera, controllerTypes }
    if (round === 9) raceCtx.ruffTruxTime = RUFF_TRUCK_TIMES[race - 1]
    const raceState = {}
    currentRaceState = raceState
    const jitter = createRaceJitter()
    const smoothGate = createSmoothnessGate(smoothnessN) // fresh per race -- see the comment above
    if (presentCountdown === 1) runPreLoopRender(world, cars, raceState, raceCtx) // 39E8, before 3064 resets [2638]
    raceStart(sound)
    // KEYS1(4) or KEYS2(5) -- the only two devices reachable yet (P6 adds JOY1/JOY2/MOUSE).
    const humanReader = recordingReader(createKeyboardReader(settings.p1Control === 4 ? settings.keys1 : keys2, window))
    const p2Reader = twoHuman ? createKeyboardReader(p2Keys(), window) : null // car 1's own human driver
    // Pause/fade/cheats (docs/engine.md §9q/§9ai): the same modules `play.js` wires into its own
    // loop, ported here for the first time (M3.34) -- `game.html` previously had none of the three.
    // Fresh per race, same as `humanReader`/`smoothGate` above: a reader created once at boot would
    // carry a stray SPACE "pressed" edge in from leaving the RACE_INTRO screen (any key, on its
    // release, docs/engine.md §9bp) straight into the race's first frame, instantly pausing it.
    const pauseKey = createPauseKeyReader(window)
    // [107C], the ISR's 16-key word, for the pause's cheat combos (docs/engine.md §9cn).
    const keyWord = createIsrKeyWordReader([...settings.keys1, ...settings.f1f3, ...keys2, ...settings.dSpaceV], window)
    // [0x1096] (docs/engine.md §9ca), cleared at race setup (3CB6): from here on an ESC release that
    // gets through the ISR's gate (menuReleaseTracker's mirrored [0x107E]/[0x107F], carried over from
    // the screen before -- race setup does not clear them) quits the race to the title, at the next
    // loop head during the race, or after the hold and fade if the race has already ended.
    menuReleaseTracker.clearEscQuit()
    const escLatched = () => menuReleaseTracker.escQuit()
    const pauseState = createPauseState()
    const fadeState = createFadeState('in')
    // 395A (docs/engine.md §9cp): race setup fades the screen before the race to black (16 ticks),
    // unless [26CE] says the DAC is already black; either way [26CE] is 1 at 39F0.
    const setupFade = raceSetupFade(dac)
    const globalState = {} // written by cheats.js's applyCheatEffect on a pause-entry cheat-spot match

    const isBonus = round === 9
    // Race end (docs/engine.md §9ah). Four-car: the real main loop's own exit -- [26C6] >= 2 (car 0
    // finished and braked to a stop, two drones finished and stopped, or the ROUND21 lead rule)
    // plus the 100-step [26CC] countdown, all inside `runStep` (`raceState.raceOver`). Two-car: the
    // race ends ONLY at the end of a knockout exchange ([26C6]=2 at 76f2/772a/7742, `twocar.js`) --
    // the bar reaching 8 or 0, or the deciding exchange after a car has finished -- and exits at once
    // (docs/engine.md §9am); finishing the laps alone never ends it. The RUFFTRUX bonus race (round 9)
    // ends the four-car way: state F ("1 Up!", finished and stopped) or 0x10 ("Failed", countdown
    // expired) sets [26C6]=2 (8702), then the countdown; the result is [291D], i.e. whether car 0
    // reached state F.
    const isOver = () => !!raceState.raceOver
    const lapLine = { segments: lapLineSegments(world.map), colours: [nearestPaletteIndex(rgb, 255, 255, 255), nearestPaletteIndex(rgb, 0, 0, 0)] }

    phase = 'RACING'
    return new Promise((resolve) => {
      // Fixed 35 Hz physics step, decoupled from the display's own refresh rate (docs/engine.md
      // §2) -- an accumulator, matching play.js's own loop exactly. M3.10 found this missing here:
      // the original version of this loop ran exactly one physics step per requestAnimationFrame
      // callback, so on a 60 Hz display the whole race ran at ~60 Hz instead of 35 Hz (cars ~1.7x
      // too fast) -- caught while wiring the smoothness draw-gate below, which only makes sense
      // once physics has a real, stable rate to be decoupled from.
      let acc = 0
      let last = performance.now()
      function cleanup() {
        humanReader.dispose()
        p2Reader?.dispose()
        pauseKey.dispose()
        keyWord.dispose()
      }
      let escGraceSteps = 0 // the rest of the iteration an ESC-ended pause returns into
      let raceEnd = null // the post-race hold + fade-out (engine/raceEnd.js), once the race is over
      let lastIndexed = null // the last painted frame: the hold re-shows it, and the fade-out darkens it
      function finishRace() {
        cleanup()
        carRecordCarry.save(cars) // the records as the race (and its exit hold) left them
        raceExitFade(dac) // 315A's 327A (the ESC exit's too) set [26CE]
        loadSoundDriver() // 11C7/2182 -> 26C0 -> 321C: a fresh copy of the driver after every race
        // 11CA/2185: [0x1096]==1 -> JMP 00CC -> 0054 -> the title (tune 1), whether the ESC ended the
        // race itself or was released during the normal race end's hold or fade.
        if (escLatched()) { resolve({ aborted: true }); return }
        // The tournament reads the order array at 11d5 ([2678..267E] -> [3FC..402]): the player's
        // place is car 0's slot in `raceState.rankOrder`, frozen by then (docs/engine.md §9ah). A
        // two-car race only checks slot 0 ([3FC]), after the [2630] exit fix-up that `runStep`
        // already applied (the slot-1 entry can be the absent car 2) -- docs/engine.md §9am.
        const finishPosition = raceFormat === 2 ? (raceState.rankOrder[0] === 0 ? 1 : 2) : raceState.rankOrder.indexOf(0) + 1
        // Cheat type 0 ([406]--, 3652: CheckCheatSpotsThenPause's own `DEC byte [0x406]`, re-scanned
        // on every pause with no over-check at all) takes a life at pause time; carried out here as
        // `lifeDelta` because `reportRaceResult` (tournament.js) applies it, composed with the
        // `25011968` cheat's own reset, at `11BA`'s own real position (docs/engine.md §9bc).
        resolve(isBonus ? { won: cars[0].state === 0xf, lifeDelta: globalState.lives ?? 0 } : { finishPosition, cars, lifeDelta: globalState.lives ?? 0 })
      }
      function frame(now) {
        const dtMs = Math.min(now - last, 250) // clamp a tab-backgrounded stall instead of spiraling
        last = now
        if (raceEnd) {
          // 30F2-3100: the frozen last frame for 100 ticks (no re-render, no input), then 327A's fade.
          updateRaceEnd(raceEnd, dtMs, sound)
          if (raceEnd.fade && lastIndexed) paint(canvas, MENU_VIEW.w, MENU_VIEW.h, indexedToRgba(lastIndexed, decodePalette(applyFade(palBytes, raceEnd.fade)).rgb), { zoom: 1 })
          if (raceEnd.phase === 'done') { finishRace(); return }
          requestAnimationFrame(frame)
          return
        }
        if (setupFade?.active) {
          // 395A -> 327A: the screen before the race (still in menuBuf) fades out; nothing steps.
          updateFade(setupFade, dtMs)
          pauseKey.read() // no loop head yet: a SPACE tap here must not pause the race (3074 tests the level)
          paint(canvas, MENU_VIEW.w, MENU_VIEW.h, indexedToRgba(menuBuf, decodePalette(applyFade(introPalBytes, setupFade)).rgb), { zoom: 1 })
          requestAnimationFrame(frame)
          return
        }
        if (raceStartHold(fadeState, dtMs, pauseKey)) {
          // 39F0 -> 32CE: the fade-up over zeroed VRAM, before the main loop -- black, nothing steps.
          raceStartFadeUp(dac) // 32DD
          const c2d = canvas.getContext('2d')
          c2d.fillStyle = '#000'
          c2d.fillRect(0, 0, canvas.width, canvas.height)
          requestAnimationFrame(frame)
          return
        }

        // 3789/37B8: the first key release through the ISR's gate ends the pause (docs/engine.md §9cl),
        // so an ESC release does too; 35F0 returns into the middle of the iteration (307B), which runs
        // its step and draw, and the next loop head quits.
        const wasPaused = pauseState.paused
        const { pressed, held } = pauseKey.read() // a press since the last frame counts as held: 3074 samples at 35 Hz, a frame can miss a short tap
        const paused = updatePause(pauseState, dtMs, { spaceHeld: held || pressed, released: menuReleaseTracker.isrState().latch, cheatFlag: cheatActive, keyWord: keyWord.read() }, cars[0], cheats, round, race, globalState, sound, cars)
        if (wasPaused && !paused && escLatched()) escGraceSteps = 1
        if (pauseState.latchClearPending) { // the entry and each combo restart
          pauseState.latchClearPending = false
          menuReleaseTracker.clearIsrLatch() // 377F/3784: [0x107E]=0, [0x107F]=0
          smoothGate.forceNextDraw() // 37A0: [2638]=1, so the iteration the pause returns into draws
        }

        let shouldRender = paused
        let over = false
        let escQuit = false
        if (!paused) {
          acc += dtMs / 1000
          while (acc >= STEP_DT) {
            if (escLatched() && escGraceSteps-- <= 0) { escQuit = true; presentCountdown = smoothGate.countdown; break } // 3067: CMP [0x1096],1 -> JMP 3115
            acc -= STEP_DT
            applyCheatGlobals(globalState, raceState, raceCtx)
            // `raceCtx.drawnTick`: read BEFORE the physics/state pass (was after, below) so
            // `markDrawn` (drawn.js) can gate the drawn-flag write on the same smoothness cadence
            // that already gates rendering (docs/engine.md §9ao 8) -- called once, not twice, since
            // `shouldDraw()` mutates its own counter.
            const countdownAtHead = smoothGate.countdown // [2638] as this iteration starts
            raceCtx.drawnTick = smoothGate.shouldDraw()
            const controls = cars.map((car, i) => (i === 0 ? humanReader.read() : i === 1 && p2Reader ? p2Reader.read() : droneControlByte(car, raceCtx)))
            runStep(world, cars, controls, raceState, raceCtx)
            if (isOver()) { over = true; presentCountdown = countdownAtHead; break } // the exiting step never renders (3081 jumps past 90C5, and 30B7's DEC)
            if (raceCtx.drawnTick) { shouldRender = true; raceState.tileAnimCounter = (raceState.tileAnimCounter ?? 0) + 1 }
            updateEngines(sound, cars, raceCtx, jitter) // 7B46: drawn steps only (it checks drawnTick)
          }
        }
        if (shouldRender && !over) {
          const composed = composeRaceView({ words, bank, camera, frames, vehicleSize, rotorFrames, bank2, pristineTile0, race, tileAnimCounter: raceState.tileAnimCounter ?? 0, cars, view: MENU_VIEW, hud: { ph0, raceFormat, round, ruffTruxTicks: raceState.ruffTruxTimer, raceOverCount: raceState.raceOverCount ?? 0, twoCar: raceState.twoCar, rankOrder: raceState.rankOrder, bannerBlink: bannerBlinkPhase(now) }, paused, lapLine: lapLineToggle?.checked ? lapLine : null })
          const faded = decodePalette(applyFade(palBytes, fadeState)).rgb
          lastIndexed = composed.indexed
          paint(canvas, MENU_VIEW.w, MENU_VIEW.h, indexedToRgba(composed.indexed, faded), { zoom: 1 })
        }
        statusEl.textContent = paused ? 'Paused' : (isBonus ? 'RUFFTRUX bonus race' : raceStatusLine(cars[0]))
        if (escQuit) {
          // 3115 -> 327A: no sfx 16, no hold, no AH=8/AH=6 -- the fade to black on the last frame drawn
          // (this frame's steps included); the engines keep their last pitch until the title's own
          // entry silences the driver.
          raceEnd = createRaceEndState({ esc: true })
          requestAnimationFrame(frame)
          return
        }
        if (over) {
          // 30DF: sfx 16 gated on the camera-table car; then the hold (ESC is not read: 30F2-3100).
          raceOverStart(sound, cars, raceOverGateCar(raceState, raceFormat))
          raceEnd = createRaceEndState()
          requestAnimationFrame(frame)
          return
        }
        requestAnimationFrame(frame)
      }
      requestAnimationFrame(frame)
    })
  }

  async function advanceRace() {
    const race = currentRace(tournament)
    const wasQualifier = isInQualifier(tournament) // position-keyed (tournament.js's own inQualifier header)
    const wasBonus = !!tournament.pendingBonusRace // position-keyed: inside TriggerBonusRace 1A82, whatever race it ended up running
    phase = 'LOADING' // input is ignored until runOneRace switches to RACING (a second confirm would start a second race)
    const result = await runOneRace(race)
    if (result.aborted) { enterTitle(); return } // ESC released during the race or its exit: 11CA -> 00CC -> the title (docs/engine.md §9ca)
    // `ShowRaceResultsScreenTune8or6 1000:1439`'s own byte-exact pass/fail test (tournament.js's
    // `resultsPassed`, docs/engine.md §9bd), captured BEFORE `reportRaceResult` can advance
    // `tournament.raceIndex` -- the SAME timing constraint `wasQualifier` above needs, and the
    // SAME snapshot-before-mutate reasoning the opponent snapshot below explains. Only meaningful
    // for a Challenge non-qualifier, non-bonus race (the only case `next==='RESULTS'` below can
    // produce), but harmless to compute unconditionally.
    const resultsWasPassed = resultsPassed(tournament, result.finishPosition)
    if (race.round === 9) {
      reportRaceResult(tournament, { won: result.won, lifeDelta: result.lifeDelta, cheatActive })
      lastStandings = null
      lastPassed = result.won
    } else {
      // `reportRaceResultWithOpponentSnapshot` (tournament.js), not a manual snapshot-then-call: its
      // own COPY is taken atomically BEFORE `reportRaceResult` runs (an advisor review caught both
      // hazards this avoids), since that call's own advance() moves raceIndex past 0 (so reading
      // opponentCharactersFor AFTER it would wrongly see the QUALIFIER_OPPONENTS branch turn off and
      // read state.opponents instead -- the ORIGINAL bug this snapshot fixed), and on a race 1+
      // result its own checkElimination can NULL a slot of the SAME array IN PLACE -- a live
      // reference, or a snapshot taken too late, would show the just-evicted opponent as missing
      // from the RESULTS table for the very race they raced in. `lifeDelta`/`cheatActive` just pass
      // through to `reportRaceResult`, which applies them (via `applyPostRaceLives`) as its own
      // very first statement, before this same call's own loss check -- docs/engine.md §9bc.
      const raceOpponents = reportRaceResultWithOpponentSnapshot(tournament, { finishPosition: result.finishPosition, lifeDelta: result.lifeDelta, cheatActive })
      const names = [CHARACTER_NAMES[tournament.playerCharacter], ...raceOpponents.map((i) => CHARACTER_NAMES[i])]
      // Two-car: racePosition can be stale for car 1 (car 2 can hold a slot, docs/engine.md §9am), so
      // the two places come from the result itself.
      const twoCarPlaces = tournament.format === 'twocar' ? [result.finishPosition, 3 - result.finishPosition] : null
      lastStandings = result.cars.map((car, i) => ({ name: names[i], position: twoCarPlaces?.[i] ?? car.racePosition, present: car.present }))
        .filter((s) => s.present).sort((a, b) => a.position - b.position)
      lastPassed = tournament.lastOutcome !== OUTCOME.QUALIFIER_FAILED && tournament.lastOutcome !== OUTCOME.ONE_LIFE_LOST
    }
    // The screen after the race (tournament.js `screenAfterRace`, docs/engine.md §9an): the results
    // table only for a Challenge race that isn't the qualifier; an outcome message for a qualifier
    // (either format), a bonus race or a lost Head-to-Head race; nothing after a won Head-to-Head race.
    const next = screenAfterRace(tournament, { wasQualifier, wasBonus })
    if (next === 'RESULTS') { enterResults(resultsWasPassed); return }
    else if (next === 'OUTCOME') { enterOutcome(); return }
    else {
      nextAfterOutcome()
      return
    }
    paintMenu()
  }

  /** Where the flow goes once a race's screens are done: the champion screen, SELECT GAME (a
   * finished run unwinds all the way back through 02e0/0220's own CLC;RET chain to 1000:008b --
   * SELECT GAME redrawn directly, no tune restart, no title -- P2's second item), or the next
   * race. */
  function nextAfterOutcome() {
    // 10F6's picker runs BEFORE 10F9/1101's champion test: a qualifier the race skip moved to the
    // last race, once passed, still gets the picker before the champion screen (docs/engine.md §9bu).
    // Only a FAILED qualifier (10E4 -> RET) skips it -- needsOpponentPick's own !over-unless-champion.
    if (needsOpponentPick(tournament)) { enterOpponentPick(); return }
    if (tournament.over) {
      if (tournament.champion) { championCharacter = tournament.playerCharacter; enterChampion(); return }
      enterSelectGame()
      return
    }
    // 13E4's own elimination check runs INSIDE the results screen, before RunTournamentLoop's own
    // bonus-trigger check or its [28C1] INC -- so a just-evicted opponent's own "IS OUT!!" bounce
    // (P3's third item) comes before EITHER the initial-pick trigger below or the board (docs/engine.md §9ba).
    if (tournament.pendingElimination) { enterEliminatedScreen(); return }
    // (needsOpponentPick -- 10a0's own CALL 1A4A, right after a Challenge qualifier PASS, before the
    // [28C1] INC, P3's second item -- is checked at the top, above)
    if (shouldShowBoard(tournament)) { enterBoard(); return } // 115c's own CALL 18d8, before the next race's own intro
    startNextRace()
    paintMenu()
  }

  /** The outcome-message screen, `ShowRaceOutcomeMessageTune8or6 1000:1C1B` (docs/engine.md
   * §9bq, `outcomeWait.js`): its own two real waits -- the SIMPLE path's repeated `17FF` (CX=15)
   * windows, or the LIVES path's silent digit slide then a poll every 6 ticks -- each with its own
   * ~700-tick timeout, replacing the old indefinite Space/Enter keydown wait. Both entries (after a
   * race, and from RESULTS) come through here. */
  let outcomeWait = null
  let outcomeRafId = null
  let outcomeLast = 0
  let outcomeAcc = 0
  function enterOutcome() {
    phase = 'OUTCOME'
    raceOutcomeMusic(sound, tournament.lastOutcome) // ShowRaceOutcomeMessageTune8or6 1000:1c84, docs/engine.md §9ai
    menuReleaseTracker.reset() // 1C30/1C35
    outcomeWait = outcomeWaitInitialState(tournament.lastOutcome)
    // 1D82/1E01: the fade runs after 1C1B/1D1F zeroed [261F], so it spends 17 ticks of the timeout;
    // on the SIMPLE path the first 17FF (and its latch clear) only opens after it.
    beginScreenFadeUp('up', () => {
      outcomeWait.ticks += FADE_UP_TICKS
      if (outcomeWait.path === 'SIMPLE') menuReleaseTracker.reset()
    })
    paintMenu()
    outcomeLast = performance.now()
    outcomeAcc = 0
    if (outcomeRafId != null) cancelAnimationFrame(outcomeRafId)
    outcomeRafId = requestAnimationFrame(outcomeTick)
  }
  function readOutcomeInput() {
    const p1 = waitReaders.p1.read()
    const p2 = waitReaders.p2.read()
    const { code } = menuReleaseTracker.read()
    return { p1FireHeld: (p1 & 0x08) !== 0, anyFireHeld: ((p1 | p2) & 0x08) !== 0, releasedCode: code }
  }
  /** One OUTCOME tick, shared by the real RAF loop and forceOutcomeSteps. Returns true once left. */
  function outcomeWaitTick(readInput) {
    const r = outcomeWaitStep(outcomeWait, readInput)
    if (r.resetLatch) menuReleaseTracker.reset() // a fresh 17FF call's own 180F/1814
    if (r.exit) { leaveOutcome(r.exit); return true }
    return false
  }
  function outcomeTick(now) {
    if (phase !== 'OUTCOME') return
    if (dac.screen) { const held = screenFadeHold(now - outcomeLast); outcomeLast = now; if (held) { outcomeRafId = requestAnimationFrame(outcomeTick); return } } // the ending frame's dt is the fade's, not the screen's
    outcomeAcc += Math.min(now - outcomeLast, 250)
    outcomeLast = now
    while (outcomeAcc >= INTRO_TICK_MS) {
      outcomeAcc -= INTRO_TICK_MS
      if (outcomeWaitTick(readOutcomeInput)) return
    }
    outcomeRafId = requestAnimationFrame(outcomeTick)
  }
  function leaveOutcome(exit) {
    if (outcomeRafId != null) { cancelAnimationFrame(outcomeRafId); outcomeRafId = null }
    // `]` (1DCD/1E12, a developer debug key): zeroes lives and returns from 1C1B at once, for both
    // codes that reach the LIVES path. The two callers then differ, and applyLivesCheat reproduces
    // both: 166A's own caller (ONE_LIFE_LOST) checks [0x406]==0 right away (166D) and ends the
    // tournament; TriggerBonusRace's (EXTRA_LIFE, 1AA9) has no such check (1AAC: RET), so lives
    // just sit at 0 -- and since [0x406] is a single byte, the NEXT loss wraps it to 255 rather
    // than ending the run (decrementLives, docs/engine.md §9bc). The old keydown handler only left
    // the screen when the tournament was over, so `]` on EXTRA_LIFE used to leave the port stuck on
    // this screen; 1E12's own RET leaves in both cases (docs/engine.md §9bq).
    if (exit === 'livesCheat') applyLivesCheat(tournament)
    nextAfterOutcome() // whether this is a regular race or the just-unlocked bonus race, currentRace() resolves it
  }

  // P4 (GOAL-DOS-PARITY.md, docs/engine.md §9bv): two-human Head to Head's own front end.
  // RunTwoPlayerHeadToHeadSetup 1000:1E20 -> two picks through the SAME carousel (09E0), each followed
  // by 0B51's handicap question when it applies -> RunHeadToHeadChooseGameMenu 1000:1EF1.
  const h2hSession = twoHumanSessionState() // session-lifetime: lifetime stats, the handicap cells, [0x8A0]
  let h2hSetup = null // per 1E20 entry (0EBA)
  let h2hMatch = null // per 1EF1 entry (1F09)
  let h2hMode = 0 // [0x8A2]: 0 none, 1 tournament, 2 single race -- the altTuning fork (1F8E/1FA9)
  let h2hFirstSeed = 0 // race 1's own nextTrack v: CHOOSE GAME's [0x2] at its fire-confirm (docs/engine.md §9bn rule 3)
  let handicapState = null
  let handicapCharacter = null
  let handicapSlot = 0
  let handicapRafId = null
  let handicapLast = 0
  let handicapAcc = 0
  function enterTwoPlayerSetup() {
    h2hSetup = twoHumanSetupState() // 0EBA
    enterCharSelect(H2H_P1_START, 'h2h-p1') // 1E8A-1E9C: [0x19E]=0xC03, [0x1080]=0x137B, AX=[0x9A0]
  }
  /** 09E0's commit block, for a two-human pick: 0B51's handicap question first (for characters
   * 0-2; `[0x2656]`=2 and `[0x265A]` is P2's device, never 6, 1E4F/1E52), then the next pick or
   * CHOOSE GAME. */
  function twoPlayerPicked(slot, character) {
    if (handicapQuestionApplies(character, 2, settings.p2Control)) { enterHandicap(slot, character); return }
    commitTwoHumanPick(h2hSetup, h2hSession, slot, character, null)
    afterTwoPlayerPick(slot)
  }
  function afterTwoPlayerPick(slot) {
    if (slot === 0) { enterCharSelect(H2H_P2_START, 'h2h-p2'); return } // 1ED1-1EE3: [0x19E]=0xC1E, [0x1080]=0x14DF, AX=[0x9A2]
    enterChooseGame() // 1EE8
  }
  function enterHandicap(slot, character) {
    phase = 'HANDICAP'
    handicapSlot = slot
    handicapCharacter = character
    handicapState = handicapInitialState(h2hSession.handicapAnswers[character]) // DS:[0x1D6+c], this session's last answer
    paintCharSelect()
    handicapLast = performance.now()
    handicapAcc = 0
    handicapRafId = requestAnimationFrame(handicapTick)
  }
  function handicapWaitTick(bits) {
    const r = handicapStep(handicapState, { bits }) // the PICKING player's own reader only (rule 1)
    if (!r.exit) return false
    if (handicapRafId != null) { cancelAnimationFrame(handicapRafId); handicapRafId = null }
    commitTwoHumanPick(h2hSetup, h2hSession, handicapSlot, handicapCharacter, handicapState.answer)
    afterTwoPlayerPick(handicapSlot)
    return true
  }
  function handicapTick(now) {
    if (phase !== 'HANDICAP') return
    handicapAcc += Math.min(now - handicapLast, 250)
    handicapLast = now
    while (handicapAcc >= INTRO_TICK_MS) {
      handicapAcc -= INTRO_TICK_MS
      if (handicapWaitTick(handicapSlot === 0 ? waitReaders.p1.read() : waitReaders.p2.read())) return
    }
    paintCharSelect()
    handicapRafId = requestAnimationFrame(handicapTick)
  }
  function paintChooseGame() {
    paintOps(menuBuf, arena, layoutChooseGame({ characters: h2hSetup.characters, selection: twoItemState.selection })) // 1EF1 (docs/engine.md §9bz)
    paint(canvas, MENU_VIEW.w, MENU_VIEW.h, indexedToRgba(menuBuf, menuPalNow()), { zoom: 1 })
    statusEl.textContent = 'CHOOSE GAME'
  }
  /** RunHeadToHeadChooseGameMenu 1000:1EF1: tune 2, the win tally reset (1F09-1F18) on every
   * visit, then the SAME two-item menu (0382, both players combined). */
  function enterChooseGame() {
    subMenuMusic(sound) // 1EF6/1F03: tune 2 unless already playing (the driver model ignores a current tune)
    h2hMatch = twoHumanMatchState(h2hSession) // 1F09-1F18 (and the used-track bitmap, 1FBE)
    h2hMode = 0 // 1F1D
    enterTwoItemMenu('CHOOSE_GAME', h2hSession.chooseGameSelection, paintChooseGame, (exit, selection) => {
      if (exit === 'cancel') { h2hMode = 0; enterSelectGame(); return } // 1FA9: [0x8A2]=0, RET -> 1E20 RET -> SELECT GAME
      h2hFirstSeed = twoItemState.idleTicks // [0x2] at the confirm -- race 1's nextTrack v (rule 3)
      h2hSession.chooseGameSelection = selection // 1F84
      h2hMode = selection // 1F8E: [0x8A2]=CL, the altTuning fork
      if (selection === 1) { h2hNextRace(h2hFirstSeed); return } // 1F97: CALL 1FAF (docs/engine.md §9bw)
      enterSingleRace() // 1F9B: CALL 2329, then 1FA6: JMP 1EF1 (docs/engine.md §9by)
    })
  }

  /** `RunHeadToHeadTournament 1000:1FAF`'s per-race loop (docs/engine.md §9bw): pick the track
   * (`1FDD-1FF9`, `nextTrack` from `v`), the race-info screen (`240A`/`2481`/"TOURNAMENT RACE n",
   * then `2216`'s slide -- `raceInfoSlideTicks` with input ignored -- then `179B`, both players
   * combined), the race (`216C`), then `256E` (commit C), `INC [28C1]` and the first-to-4 test. */
  let h2hTrack = null
  let h2hInfoWait = null
  let h2hInfoPreStep = null
  let h2hInfoRafId = null
  let h2hInfoLast = 0
  let h2hInfoAcc = 0
  let h2hInfoTicks = 0 // 2216's iterations so far (the icon slide), repainted per tick
  /** 240A/2481's per-player inputs: the character and its lifetime record (docs/engine.md §9bh). */
  function h2hPlayers() {
    return h2hSetup.characters.map((c) => ({ character: c, wins: h2hSession.lifetimeWins[c], losses: h2hSession.lifetimeLosses[c] }))
  }
  let championCharacter = null // who 1AAD names: the one-player player, or the two-human match winner (2081-2095: BX=0xC03/0xC1E)
  function h2hNextRace(v) {
    h2hTrack = nextTrack(h2hMatch, v)
    phase = 'H2H_RACE_INFO'
    const slide = raceInfoSlideTicks(smoothnessN) // 2216: floor(22/smoothness)+1 ticks
    h2hInfoWait = waitScreenInitialState()
    h2hInfoPreStep = holdTicksPreStep(slide)
    h2hInfoTicks = 0
    menuReleaseTracker.reset()
    paintTwoPlayerRaceInfo()
    h2hInfoLast = performance.now()
    h2hInfoAcc = 0
    h2hInfoRafId = requestAnimationFrame(h2hInfoTick)
  }
  function paintTwoPlayerRaceInfo() {
    canvas.width = MENU_VIEW.w
    canvas.height = MENU_VIEW.h
    // 1FAF's screen (docs/engine.md §9bz): 2216's icons move one step per slide tick
    paintOps(menuBuf, arena, layoutTwoPlayerRaceInfo({ players: h2hPlayers(), tally: [h2hMatch.p1Wins, h2hMatch.p2Wins], raceNumber: h2hMatch.raceNumber, round: h2hTrack.round, smoothness: smoothnessN, iconX: slideIconX(h2hInfoTicks, smoothnessN) }))
    paint(canvas, MENU_VIEW.w, MENU_VIEW.h, indexedToRgba(menuBuf, menuPalNow()), { zoom: 1 })
    statusEl.textContent = 'TOURNAMENT RACE'
  }
  function h2hInfoWaitTick(input) {
    h2hInfoTicks++ // 2216's own iteration count while its slide runs
    const r = waitScreenStep(h2hInfoWait, input, h2hInfoPreStep)
    if (r.entered) menuReleaseTracker.reset() // 179B's own entry (17AB/17B0)
    if (r.exit) { h2hRunRace(); return true }
    return false
  }
  function h2hInfoTick(now) {
    if (phase !== 'H2H_RACE_INFO') return
    h2hInfoAcc += Math.min(now - h2hInfoLast, 250)
    h2hInfoLast = now
    while (h2hInfoAcc >= INTRO_TICK_MS) {
      h2hInfoAcc -= INTRO_TICK_MS
      if (h2hInfoWaitTick(readWaitInput())) return
    }
    paintTwoPlayerRaceInfo()
    h2hInfoRafId = requestAnimationFrame(h2hInfoTick)
  }
  async function h2hRunRace() {
    if (h2hInfoRafId != null) { cancelAnimationFrame(h2hInfoRafId); h2hInfoRafId = null }
    phase = 'LOADING'
    const result = await runOneRace(h2hTrack, { raceNumber: h2hMatch.raceNumber, rosterWords: h2hSetup.rosterWords }) // 2074: CALL 216C
    if (result.aborted) { enterTitle(); return } // 2185 -> 00CC -> the title, as in one-player play (docs/engine.md §9ca)
    const p1Won = result.finishPosition === 1 // [0x3FC]==0xC03 (256E's own 2574), after the [2630] fix-up
    const raceNumber = h2hMatch.raceNumber // the number 256E shows ([28C1], INC'd only after it at 207A)
    // 256E's own increments (2583/257D, 25B0/25BE) and 207A's INC, applied up front; the screen only
    // displays them, and nothing on it depends on the order.
    const outcome = reportRace(h2hMatch, h2hSetup.characters[0], h2hSetup.characters[1], p1Won)
    enterTwoPlayerResult(p1Won, raceNumber, outcome, h2hTrack.round)
  }
  /** `RunHeadToHeadVehicleSelectTune2 1000:2329` -- two-human single race (docs/engine.md §9by):
   * tune 2 (AH=9-guarded), `[0x8A5]=0`, then the select screen at `234B`, a race on the chosen track,
   * `256E` ("SINGLE RACE", no tally digits, no champion test), and back to `234B`; an ESC release on
   * the select screen returns to CHOOSE GAME (`1FA6: JMP 1EF1`, which resets the tally). */
  let h2hSingle = null
  let h2hSingleRafId = null
  let h2hSingleLast = 0
  let h2hSingleAcc = 0
  let h2hSingleTicks = 0
  function enterSingleRace() {
    subMenuMusic(sound) // 2333/2340: tune 2 unless already playing
    enterSingleRaceSelect()
  }
  function enterSingleRaceSelect() { // 234B
    phase = 'H2H_SINGLE_SELECT'
    menuReleaseTracker.reset() // 2367/236C
    h2hSingle = singleRaceSelectInitialState(h2hSession, smoothnessN)
    h2hSingleTicks = 0
    paintSingleRaceSelect()
    h2hSingleLast = performance.now()
    h2hSingleAcc = 0
    h2hSingleRafId = requestAnimationFrame(h2hSingleTick)
  }
  function paintSingleRaceSelect() {
    canvas.width = MENU_VIEW.w
    canvas.height = MENU_VIEW.h
    // 2329's screen (docs/engine.md §9bz): nothing below "SELECT VEHICLE" until 2193 runs, then
    // 2216's slide, then 0C5D's class-name blink ([0x26CF], the ISR's 32-tick toggle) while polling
    const s = h2hSingle
    const vehicle = s.phase !== 'AWAIT_RELEASE'
    const iconX = slideIconX(s.phase === 'SLIDE' ? s.slideTicks - s.slideLeft : Infinity, smoothnessN)
    paintOps(menuBuf, arena, layoutSingleRaceSelect({ players: h2hPlayers(), round: s.track.round, vehicleClass: s.track.vehicleClass, smoothness: smoothnessN, vehicle, iconX, polled: s.phase === 'POLL', blink: Math.floor(h2hSingleTicks / 32) % 2 === 1 }))
    paint(canvas, MENU_VIEW.w, MENU_VIEW.h, indexedToRgba(menuBuf, menuPalNow()), { zoom: 1 })
    statusEl.textContent = 'SELECT VEHICLE'
  }
  function h2hSingleWaitTick(readInput, readFire) {
    h2hSingleTicks++
    const r = singleRaceSelectStep(h2hSingle, h2hSession, readInput, readFire)
    if (!r.exit) return false
    if (h2hSingleRafId != null) { cancelAnimationFrame(h2hSingleRafId); h2hSingleRafId = null }
    if (r.exit === 'cancel') { enterChooseGame(); return true } // 2409: RET -> 1FA6: JMP 1EF1
    h2hRunSingleRace(r.track) // 23F9: CALL 216C
    return true
  }
  function h2hSingleTick(now) {
    if (phase !== 'H2H_SINGLE_SELECT') return
    h2hSingleAcc += Math.min(now - h2hSingleLast, 250)
    h2hSingleLast = now
    const readInput = () => { const { escReleased } = menuReleaseTracker.read(); return { bits: waitReaders.p1.read() | waitReaders.p2.read(), escReleased } } // [0x1080]=0 (2361)
    const readFire = () => ((waitReaders.p1.read() | waitReaders.p2.read()) & 0x08) !== 0
    while (h2hSingleAcc >= INTRO_TICK_MS) {
      h2hSingleAcc -= INTRO_TICK_MS
      if (h2hSingleWaitTick(readInput, readFire)) return
    }
    paintSingleRaceSelect()
    h2hSingleRafId = requestAnimationFrame(h2hSingleTick)
  }
  async function h2hRunSingleRace(track) {
    phase = 'LOADING'
    // [28C1] is not set by 2329 (it keeps whatever the session last left there); the alternate
    // tuning path never reads it (§9bg), so the race number passed here only feeds the few other
    // [28C1] readers (UNKNOWN_single_race_28c1, docs/engine.md §9by).
    const result = await runOneRace(track, { raceNumber: h2hMatch.raceNumber, rosterWords: h2hSetup.rosterWords })
    if (result.aborted) { enterTitle(); return }
    const p1Won = result.finishPosition === 1
    reportRace(h2hMatch, h2hSetup.characters[0], h2hSetup.characters[1], p1Won, { tournament: false }) // 256E's increments; no 207A
    enterTwoPlayerResult(p1Won, null, { matchOver: false, champion: null }, track.round) // 2402: CALL 256E -- no first-to-4 test in single race
  }
  let h2hResult = null
  let h2hResultRafId = null
  let h2hResultLast = 0
  let h2hResultAcc = 0
  function enterTwoPlayerResult(p1Won, raceNumber, outcome, round) {
    phase = 'H2H_RESULT'
    beginScreenFadeUp() // 2641, before the icon slide and its 17FF windows
    sound.playTune(8) // 2593/25A0: tune 8, AH=9-guarded
    h2hResult = { state: raceResultScreenInitialState(), p1Won, raceNumber, outcome, round } // round: the miniatures' frames, still 2216's own (records 8/9)
    paintTwoPlayerResult()
    h2hResultLast = performance.now()
    h2hResultAcc = 0
    h2hResultRafId = requestAnimationFrame(h2hResultTick)
  }
  function paintTwoPlayerResult() {
    canvas.width = MENU_VIEW.w
    canvas.height = MENU_VIEW.h
    const single = h2hResult.raceNumber == null // [0x8A5]==0: "SINGLE RACE" and no tally digits (261D, 240A's gate)
    const st = h2hResult.state
    // 256E's screen (docs/engine.md §9bz): the icons step 4 per slide tick to 88/136, then each 26A3
    // XOR shows the winner's FCHAPPY and the loser's FCSAD pose, blinking
    paintOps(menuBuf, arena, layoutTwoPlayerResult({ players: h2hPlayers(), tally: [h2hMatch.p1Wins, h2hMatch.p2Wins], raceNumber: h2hResult.raceNumber, round: h2hResult.round, p1Won: h2hResult.p1Won, single, iconX: 4 * (RACE_RESULT_SLIDE_TICKS - st.slideLeft), blinks: st.blinks }))
    paint(canvas, MENU_VIEW.w, MENU_VIEW.h, indexedToRgba(menuBuf, menuPalNow()), { zoom: 1 })
    statusEl.textContent = 'RESULTS'
  }
  function h2hResultWaitTick(input) {
    const r = raceResultScreenStep(h2hResult.state, input)
    if (r.resetLatch) menuReleaseTracker.reset() // each 17FF call's own 180F/1814
    if (!r.exit) return false
    if (h2hResultRafId != null) { cancelAnimationFrame(h2hResultRafId); h2hResultRafId = null }
    if (h2hResult.raceNumber == null) { enterSingleRaceSelect(); return true } // single race: 2405 JMP 234B
    const { matchOver, champion } = h2hResult.outcome
    if (matchOver) { championCharacter = h2hSetup.characters[champion - 1]; enterChampion(); return true } // 2095: CALL 1AAD, then RET up to SELECT GAME
    h2hNextRace(r.seed) // 2092: JMP 1FCC -- 1FDD reads [0x2], still the dismissing 17FF window's count
    return true
  }
  function h2hResultTick(now) {
    if (phase !== 'H2H_RESULT') return
    if (dac.screen) { const held = screenFadeHold(now - h2hResultLast); h2hResultLast = now; if (held) { h2hResultRafId = requestAnimationFrame(h2hResultTick); return } } // the ending frame's dt is the fade's, not the screen's
    h2hResultAcc += Math.min(now - h2hResultLast, 250)
    h2hResultLast = now
    while (h2hResultAcc >= INTRO_TICK_MS) {
      h2hResultAcc -= INTRO_TICK_MS
      if (h2hResultWaitTick(readWaitInput())) return // 17FF: [0x1080]=0, both players combined
    }
    paintTwoPlayerResult()
    h2hResultRafId = requestAnimationFrame(h2hResultTick)
  }

  /** The results table, `ShowRaceResultsScreenTune8or6 1000:13E4`, its wait at `1618-164E`
   * (docs/engine.md §9br): `[0x261F]=0`, then loop -- blink the rows, present, `[0x261F] >= 0x2BC`
   * leaves, else `CALL 17FF` with CX=0xF (a release or a fresh fire press leaves, STC loops). The
   * same shape as the outcome screen's SIMPLE path (windowedWait.js, checkPeriod 1). Replaces the old
   * indefinite Space/Enter keydown wait. */
  let resultsWait = null
  let resultsRafId = null
  let resultsLast = 0
  let resultsAcc = 0
  function enterResults(passed) {
    raceResultMusic(sound, passed)
    phase = 'RESULTS'
    menuReleaseTracker.reset() // the first 17FF call's own 180F/1814
    beginScreenFadeUp('up', () => menuReleaseTracker.reset()) // 1546 comes before that first 17FF
    resultsWait = windowedWaitInitialState({ cx: RESULTS_17FF_CX })
    paintMenu()
    resultsLast = performance.now()
    resultsAcc = 0
    if (resultsRafId != null) cancelAnimationFrame(resultsRafId)
    resultsRafId = requestAnimationFrame(resultsTick)
  }
  function resultsWaitTick(input) {
    const r = windowedWaitStep(resultsWait, input)
    if (r.resetLatch) menuReleaseTracker.reset()
    if (r.exit) { leaveResults(); return true }
    return false
  }
  function resultsTick(now) {
    if (phase !== 'RESULTS') return
    if (dac.screen) { const held = screenFadeHold(now - resultsLast); resultsLast = now; if (held) { resultsRafId = requestAnimationFrame(resultsTick); return } } // the ending frame's dt is the fade's, not the screen's
    resultsAcc += Math.min(now - resultsLast, 250)
    resultsLast = now
    while (resultsAcc >= INTRO_TICK_MS) {
      resultsAcc -= INTRO_TICK_MS
      if (resultsWaitTick(readWaitInput())) return
    }
    resultsRafId = requestAnimationFrame(resultsTick)
  }
  /** A dismiss and a timeout both fall into 1650. 1000:1650-166A: a PASS jumps straight past
   * ShowRaceOutcomeMessageTune8or6 to the elimination-check tail -- only a FAIL (CX=2) shows an
   * OUTCOME screen at all (GOAL-DOS-PARITY.md P3's 4th item, docs/engine.md §9bb item 3,
   * showsOutcomeAfterResults's own header). */
  function leaveResults() {
    if (resultsRafId != null) { cancelAnimationFrame(resultsRafId); resultsRafId = null }
    if (showsOutcomeAfterResults(tournament)) enterOutcome()
    else nextAfterOutcome()
  }

  /** The champion screen, `ShowChampionScreenTune3 1000:1AAD` (docs/engine.md §9bs,
   * `champion.js`): a 108-iteration slide-in with no input poll (one iteration per tick here, a
   * port choice -- `UNKNOWN_champion_slide_duration`), then it leaves when any control bit of
   * either player is held (`1C0B`), with no timeout. Replaces the old Space/Enter keydown wait. */
  let championState = null
  let championRafId = null
  let championLast = 0
  let championAcc = 0
  function enterChampion() {
    phase = 'CHAMPION'
    beginScreenFadeUp('in') // 1BCF before 1BD3's first present: black, then the screen at full
    championMusic(sound)
    championState = championInitialState()
    paintMenu()
    championLast = performance.now()
    championAcc = 0
    if (championRafId != null) cancelAnimationFrame(championRafId)
    championRafId = requestAnimationFrame(championTick)
  }
  function readChampionInput() {
    // 1BF8: [0x1080]=0, both players' WHOLE reader bytes ORed -- the five controls plus each group's
    // three extra keys (F1-F3 / D, SPACE, V), all of which 1C0B's !=0 test sees (docs/engine.md §9bt)
    return { controlBits: waitReaders.p1.read() | waitReaders.p2.read() | waitReaders.p1Extra.read() | waitReaders.p2Extra.read() }
  }
  function championWaitTick(readInput) {
    if (championStep(championState, readInput).exit) { leaveChampion(); return true }
    return false
  }
  function championTick(now) {
    if (phase !== 'CHAMPION') return
    if (dac.screen) { const held = screenFadeHold(now - championLast); championLast = now; if (held) { championRafId = requestAnimationFrame(championTick); return } } // the ending frame's dt is the fade's, not the screen's
    championAcc += Math.min(now - championLast, 250)
    championLast = now
    while (championAcc >= INTRO_TICK_MS) {
      championAcc -= INTRO_TICK_MS
      if (championWaitTick(readChampionInput)) return
    }
    championRafId = requestAnimationFrame(championTick)
  }
  function leaveChampion() {
    if (championRafId != null) { cancelAnimationFrame(championRafId); championRafId = null }
    enterSelectGame() // 1AAD returns to SELECT GAME (02D7 -> 0220's own CLC;RET chain), not the title -- no tune restart either
  }

  let raceIntroWait = null // waitScreenStep's own state: the slide hold is its pre-wait work, 179B the wait
  let raceIntroPreStep = null
  let raceIntroRafId = null
  let raceIntroLast = 0
  let raceIntroAcc = 0

  /** The next race's intro -- or, for the Head-to-Head qualifier, no intro at all (11F8 starts tune 4
   * and returns without a screen, 126D-127B): straight into the race. `raceIntroHoldTicks`
   * (tournament.js, docs/engine.md §9be, GOAL-DOS-PARITY.md's "H2H race-intro variant" item): a
   * regular race's own intro runs a real per-tick loop (the portrait/icon reveal, not ported here --
   * see that export's own header) whose own successor stage (179B) clears the key-release latch at
   * its own entry, discarding anything latched during the loop -- so a key during this window is
   * ignored, matching the real hardware. Then `179B` itself runs (`1000:1395`'s own call): the real
   * two-stage key wait with its own ~700-tick timeout (`keyWait.js`'s `waitScreenStep`,
   * docs/engine.md §9bn/§9bp), driven per tick by `raceIntroTick` below -- a release of any key,
   * or a FRESH fire press (a fire already held at the wait's entry must be released first), or
   * the timeout, advances. Replaces both M3.69's own plain-`setTimeout` stopgap and the old
   * keydown-edge Space/Enter dismiss. */
  function startNextRace() {
    raceIntroMusic(sound)
    if (hasRaceIntro(tournament)) {
      phase = 'RACE_INTRO'
      beginScreenFadeUp('up', () => menuReleaseTracker.reset()) // 12B7/12DF, before the slide loop and 179B
      const holdTicks = raceIntroHoldTicks(tournament)
      raceIntroWait = waitScreenInitialState(holdTicks === 0)
      raceIntroPreStep = holdTicks === 0 ? () => true : holdTicksPreStep(holdTicks)
      menuReleaseTracker.reset() // for a zero hold this IS 179B's own entry; otherwise a harmless extra clear
      raceIntroLast = performance.now()
      raceIntroAcc = 0
      if (raceIntroRafId != null) cancelAnimationFrame(raceIntroRafId)
      raceIntroRafId = requestAnimationFrame(raceIntroTick)
      return
    }
    advanceRace()
  }
  /** One RACE_INTRO tick, shared by the real RAF loop and forceRaceIntroSteps. Returns true once
   * the screen has left. */
  function raceIntroWaitTick(input) {
    const r = waitScreenStep(raceIntroWait, input, raceIntroPreStep)
    if (r.entered) menuReleaseTracker.reset() // 17AB/17B0: 179B's own entry clears the release latch
    if (r.exit) {
      // 1398-13E0 (tournament.js's applyRaceSkip, docs/engine.md §9bu): with the 25011968 cheat on,
      // the key whose RELEASE ended 179B can skip to the next/previous race -- 179B's own release
      // exit is checked before its fire exit, so a release on this tick is what ended it. A timeout
      // or a fresh fire press leave [0x107E] at 0 (no skip).
      const releasedCode = r.exit === 'dismiss' && input.anyKeyReleased ? input.releasedCode : null
      if (applyRaceSkip(tournament, releasedCode, cheatActive)) {
        if (raceIntroRafId != null) { cancelAnimationFrame(raceIntroRafId); raceIntroRafId = null }
        startNextRace() // 13E0: JMP 11F8 -- the tune, the intro and its hold, a fresh 179B; not the board
        paintMenu()
        return true
      }
      leaveRaceIntro()
      return true
    }
    return false
  }
  function raceIntroTick(now) {
    if (phase !== 'RACE_INTRO') return
    if (dac.screen) { const held = screenFadeHold(now - raceIntroLast); raceIntroLast = now; if (held) { raceIntroRafId = requestAnimationFrame(raceIntroTick); return } } // the ending frame's dt is the fade's, not the screen's
    raceIntroAcc += Math.min(now - raceIntroLast, 250)
    raceIntroLast = now
    while (raceIntroAcc >= INTRO_TICK_MS) {
      raceIntroAcc -= INTRO_TICK_MS
      if (raceIntroWaitTick(readWaitInput())) return
    }
    raceIntroRafId = requestAnimationFrame(raceIntroTick)
  }
  function leaveRaceIntro() {
    if (raceIntroRafId != null) { cancelAnimationFrame(raceIntroRafId); raceIntroRafId = null }
    advanceRace()
  }

  function confirm() {
    if (phase === 'LOGO') return // a key never skips the intro -- see the P1 header comment above
    // TITLE/SELECT_GAME/ONE_PLAYER_GAME/CHAR_SELECT's own input is driven entirely by their own
    // dedicated reader(s) + the shared menuReleaseTracker (enterTitle/enterTwoItemMenu/
    // enterCharSelect, above), not by this function.
    if (phase === 'PRESS_ANY_KEY') {
      leavePressAnyKey() // debug/test entry only (window.mmGame.confirm) -- real input goes through pressAnyKeyTick
      return
    } else if (phase === 'ELIMINATED') {
      // debug/test entry only (window.mmGame.confirm) -- real input goes through eliminationWaitTick
      if (eliminationWait.wait == null) return // 1000:174D-1789's own loop never polls input -- a press mid-bounce is simply lost, same as on real hardware
      leaveEliminatedScreen()
      return
    } else if (phase === 'RACE_INTRO') {
      // debug/test entry only (window.mmGame.confirm) -- real input goes through raceIntroWaitTick
      if (raceIntroWait.wait == null) return // still in the slide hold: 179B's own entry would discard it anyway (raceIntroHoldTicks' own header)
      leaveRaceIntro()
      return
    } else if (phase === 'RESULTS') {
      leaveResults() // debug/test entry only (window.mmGame.confirm) -- real input goes through resultsTick
      return
    } else if (phase === 'OUTCOME') {
      leaveOutcome('dismiss') // debug/test entry only (window.mmGame.confirm) -- real input goes through outcomeTick
      return
    } else if (phase === 'CHAMPION') {
      leaveChampion() // debug/test entry only (window.mmGame.confirm) -- real input goes through championTick
      return
    }
    paintMenu()
  }

  function onKeydown(e) {
    if (e.code === 'KeyA' || e.code === 'KeyB') introHeldKeys.add(e.code) // fed to introStep regardless of phase; only consumed during LOGO
    if (phase === 'RACING') {
      return // the race's own readers own a race's input (ESC: its own release latch, runOneRace)
    }
    if (phase === 'LOGO') return // no key skips the intro -- see the P1 header comment above
    if (phase === 'TITLE') return // titleTick's own reader + menuReleaseTracker own this phase's input entirely
    if (phase === 'CODECARD') {
      // 1000:01E9-02EE: only the 4 arrows move the cursor; only ENTER (AL=0xD) accepts -- Space
      // does nothing here, unlike every menu screen's own Space-or-Enter convention.
      if (e.code === 'ArrowRight') codeCardMove('right')
      else if (e.code === 'ArrowLeft') codeCardMove('left')
      else if (e.code === 'ArrowUp') codeCardMove('up')
      else if (e.code === 'ArrowDown') codeCardMove('down')
      else if (e.code === 'Enter') codeCardConfirm()
      return
    }
    if (phase === 'OPTIONS') { optionsKey(e); return }
    if (phase === 'QUIT') return // real DOS is gone at this point; nothing left to read
    if (phase === 'LOADING') return
    if (phase === 'SELECT_GAME' || phase === 'ONE_PLAYER_GAME' || phase === 'CHAR_SELECT' || phase === 'BOARD' || phase === 'RACE_INTRO' || phase === 'ELIMINATED' || phase === 'OUTCOME' || phase === 'RESULTS' || phase === 'CHAMPION' || phase === 'PRESS_ANY_KEY' || phase === 'CHOOSE_GAME' || phase === 'HANDICAP' || phase === 'H2H_RACE_INFO' || phase === 'H2H_RESULT' || phase === 'H2H_SINGLE_SELECT') return // each phase's own dedicated reader(s) + menuReleaseTracker own its input entirely (RACE_INTRO/ELIMINATED: 179B, raceIntroTick/eliminationTick; OUTCOME: 1C1B, outcomeTick; RESULTS: 13E4, resultsTick; CHAMPION: 1AAD, championTick; PRESS_ANY_KEY: 0C15, pressAnyKeyTick)
    if (e.code === 'Space' || e.code === 'Enter') confirm()
  }
  window.addEventListener('keydown', onKeydown)
  function onKeyup(e) { introHeldKeys.delete(e.code) }
  window.addEventListener('keyup', onKeyup)
  // A mouse click is the intro's real, only skip input (INT 33h AX=3, a level check every
  // iteration) -- tracked here as a level, not an edge, same as the real byte it mirrors.
  function onMousedown() { introMouseDown = true }
  function onMouseup() { introMouseDown = false }
  window.addEventListener('mousedown', onMousedown)
  window.addEventListener('mouseup', onMouseup)

  if (phase === 'LOGO') {
    canvas.width = LOGO_W
    canvas.height = LOGO_H
    introLast = performance.now()
    introRafId = requestAnimationFrame(introTick)
  } else if (phase === 'CODECARD') {
    enterCodeCard()
  } else if (phase === 'OPTIONS') {
    enterOptions()
  } else { titleMusic(sound); paintMenu() }

  return {
    stop: () => {
      window.removeEventListener('keydown', onKeydown)
      window.removeEventListener('keyup', onKeyup)
      window.removeEventListener('mousedown', onMousedown)
      window.removeEventListener('mouseup', onMouseup)
      if (introRafId != null) cancelAnimationFrame(introRafId)
      if (titleRafId != null) cancelAnimationFrame(titleRafId)
      if (twoItemRafId != null) cancelAnimationFrame(twoItemRafId)
      if (charSelectRafId != null) cancelAnimationFrame(charSelectRafId)
      if (boardRafId != null) cancelAnimationFrame(boardRafId)
      if (eliminationRafId != null) cancelAnimationFrame(eliminationRafId)
      if (raceIntroRafId != null) cancelAnimationFrame(raceIntroRafId)
      if (outcomeRafId != null) cancelAnimationFrame(outcomeRafId)
      if (resultsRafId != null) cancelAnimationFrame(resultsRafId)
      if (championRafId != null) cancelAnimationFrame(championRafId)
      if (handicapRafId != null) cancelAnimationFrame(handicapRafId)
      if (h2hInfoRafId != null) cancelAnimationFrame(h2hInfoRafId)
      if (h2hResultRafId != null) cancelAnimationFrame(h2hResultRafId)
      if (h2hSingleRafId != null) cancelAnimationFrame(h2hSingleRafId)
      if (pressAnyKeyRafId != null) cancelAnimationFrame(pressAnyKeyRafId)
      if (waitReaders) for (const r of Object.values(waitReaders)) r.dispose()
      titleReader?.dispose()
      twoItemReaders?.p1.dispose(); twoItemReaders?.p2.dispose()
      charSelectReader?.dispose()
      menuReleaseTracker.dispose()
    },
    // debugging/testing hooks: drive the flow without a real keyboard
    getPhase: () => phase,
    getTournament: () => tournament,
    getCars: () => currentCars,
    getRaceState: () => currentRaceState,
    confirm,
    // the synchronous fast-forward automated/backgrounded-tab tests rely on (play.js's own
    // `forceSteps` precedent, CLAUDE.md rule 7): drives the LOGO phase's real introStep directly,
    // bypassing requestAnimationFrame's own real-time pacing (and its throttling in a backgrounded
    // tab) entirely. A no-op once past LOGO.
    forceIntroSteps: (n, input) => {
      if (phase !== 'LOGO') return
      for (let i = 0; i < n; i++) {
        introStep(introState, input)
        if (introState.exited) { leaveLogo(); return }
      }
      paintIntroFrame()
    },
    // Same fast-forward precedent as forceIntroSteps, for the TITLE phase: `input` is
    // `{ p1Fire, escReleased, otherReleased }`, bypassing titleReader/menuReleaseTracker entirely
    // so a headless/automated test can drive attractStep directly. A no-op once past TITLE.
    forceTitleSteps: (n, input) => {
      if (phase !== 'TITLE') return
      for (let i = 0; i < n; i++) {
        const r = attractStep(titleState, input)
        if (r.exit) { leaveTitle(r.exit); return }
      }
      paintTitle()
    },
    // Same fast-forward precedent, for SELECT_GAME/ONE_PLAYER_GAME: `input` is
    // `{ bits, escReleased }`. A no-op outside those two phases.
    forceMenuSteps: (n, input) => {
      if (phase !== 'SELECT_GAME' && phase !== 'ONE_PLAYER_GAME' && phase !== 'CHOOSE_GAME') return
      for (let i = 0; i < n; i++) {
        const r = twoItemMenuStep(twoItemState, input)
        if (r.exit) { leaveTwoItemMenu(r.exit, r.selection); return }
      }
      twoItemPaint()
    },
    // Same fast-forward precedent, for CHAR_SELECT: `input` is `{ bits, escReleased }`. A no-op
    // outside that phase.
    forceCharSelectSteps: (n, input) => {
      if (phase !== 'CHAR_SELECT') return
      for (let i = 0; i < n; i++) {
        const r = charSelectStep(charSelectState, input, rosterBytes())
        if (r.exit) { leaveCharSelect(r.exit, r.character); return }
      }
      paintCharSelect()
    },
    // Same fast-forward precedent, for BOARD (P3's first item): `input` is
    // `{ fireHeld, anyKeyReleased }` (17FF's own input, docs/engine.md §9br). A no-op outside that phase.
    forceBoardSteps: (n, input = {}) => {
      if (phase !== 'BOARD') return
      for (let i = 0; i < n; i++) if (boardWaitTick(input)) return
      paintBoard()
    },
    getBoardWait: () => (phase === 'BOARD' ? { blinkOn: boardState.blinkOn, ticks: boardState.window.ticks, windows: boardState.window.windows, stage: boardState.window.wait.phase, checkOffset: boardState.window.checkOffset } : null),
    // Same, for RESULTS: `input` is `{ fireHeld, anyKeyReleased }`. A no-op outside that phase.
    forceResultsSteps: (n, input = {}) => {
      if (phase !== 'RESULTS') return
      for (let i = 0; i < n; i++) if (resultsWaitTick(input)) return
    },
    // Same, for CHAMPION: `input` is `{ controlBits }`, read only on the iterations that poll.
    forceChampionSteps: (n, input = {}) => {
      if (phase !== 'CHAMPION') return
      const read = () => ({ controlBits: input.controlBits ?? 0 })
      for (let i = 0; i < n; i++) if (championWaitTick(read)) return
    },
    // Same, for PRESS_ANY_KEY: `input` is `{ p1FireHeld, anyKeyReleased }`.
    forcePressAnyKeySteps: (n, input = {}) => {
      if (phase !== 'PRESS_ANY_KEY') return
      for (let i = 0; i < n; i++) if (pressAnyKeyWaitTick(input)) return
    },
    getCheatActive: () => cheatActive,
    getTwoHuman: () => ({ session: h2hSession, setup: h2hSetup, match: h2hMatch, mode: h2hMode, firstSeed: h2hFirstSeed, handicap: phase === 'HANDICAP' ? { ...handicapState, character: handicapCharacter, slot: handicapSlot } : null }),
    getSingleRaceSelect: () => (phase === 'H2H_SINGLE_SELECT' ? { phase: h2hSingle.phase, slideLeft: h2hSingle.slideLeft, track: h2hSingle.track, cursor: h2hSession.singleRaceCursor } : null),
    forceTwoPlayerResultSteps: (n, input = {}) => {
      if (phase !== 'H2H_RESULT') return
      for (let i = 0; i < n; i++) if (h2hResultWaitTick(input)) return
      paintTwoPlayerResult()
    },
    getTwoPlayerResult: () => (phase === 'H2H_RESULT' ? { ...h2hResult.state, wait: h2hResult.state.wait && { ...h2hResult.state.wait } } : null),
    forceTwoPlayerRaceInfoSteps: (n, input = {}) => {
      if (phase !== 'H2H_RACE_INFO') return
      for (let i = 0; i < n; i++) if (h2hInfoWaitTick(input)) return
      paintTwoPlayerRaceInfo()
    },
    forceHandicapSteps: (n, bits = 0) => {
      if (phase !== 'HANDICAP') return
      for (let i = 0; i < n; i++) if (handicapWaitTick(bits)) return
    }, // DS:0F69/0F6A, the 25011968 cheat (both flags set together at 2911/2916)
    getPressAnyKeyWait: () => (phase === 'PRESS_ANY_KEY' ? { ...pressAnyKeyState } : null),
    getChampionWait: () => (phase === 'CHAMPION' ? { ...championState } : null),
    getResultsWait: () => (phase === 'RESULTS' ? { ticks: resultsWait.ticks, windows: resultsWait.windows, stage: resultsWait.wait.phase } : null),
    // Same fast-forward precedent, for ELIMINATED (P3's third item): the bounce, then 179B's own
    // wait. `input` is `{ fireHeld, anyKeyReleased }` (default: nothing), ignored during the bounce,
    // bypassing the readers/menuReleaseTracker entirely. A no-op outside that phase.
    forceEliminationSteps: (n, input = {}) => {
      if (phase !== 'ELIMINATED') return
      for (let i = 0; i < n; i++) if (eliminationWaitTick(input)) return
      paintEliminated()
    },
    // Same, for RACE_INTRO: the slide hold, then 179B's own wait. Same `input` shape.
    forceRaceIntroSteps: (n, input = {}) => {
      if (phase !== 'RACE_INTRO') return
      for (let i = 0; i < n; i++) if (raceIntroWaitTick(input)) return
    },
    // Same, for OUTCOME: `input` is `{ p1FireHeld, anyFireHeld, releasedCode }` (default: nothing),
    // read only on the ticks the real code polls.
    forceOutcomeSteps: (n, input = {}) => {
      if (phase !== 'OUTCOME') return
      const read = () => ({ p1FireHeld: !!input.p1FireHeld, anyFireHeld: !!input.anyFireHeld, releasedCode: input.releasedCode ?? null })
      for (let i = 0; i < n; i++) if (outcomeWaitTick(read)) return
    },
    getOutcomeWait: () => (phase === 'OUTCOME' ? { ...outcomeWait, window: outcomeWait.window && { ...outcomeWait.window, wait: { ...outcomeWait.window.wait } } } : null),
    // Where a 179B-terminated screen is: `{ inWait, stage, ticks }` (null outside RACE_INTRO/ELIMINATED/H2H_RACE_INFO).
    getKeyWait: () => {
      const w = phase === 'RACE_INTRO' ? raceIntroWait : phase === 'ELIMINATED' ? eliminationWait : phase === 'H2H_RACE_INFO' ? h2hInfoWait : null
      if (!w) return null
      return { inWait: w.wait != null, stage: w.wait?.phase ?? null, ticks: w.wait?.ticks ?? 0 }
    },
  }
}

const ORDINAL = ['1st', '2nd', '3rd', '4th']

/** The race status line: laps left is the HUD's own top digit (3 during the countdown, 4 once the
 * back row's first progress write counts as a backward crossing, then down; docs/engine.md §9ah). */
function raceStatusLine(car0) {
  const place = ORDINAL[(car0.racePosition ?? 1) - 1] ?? '?'
  return car0.lapsRemaining <= 0 ? `Finished ${place}!` : `laps left ${car0.lapsRemaining}, position ${place}`
}
