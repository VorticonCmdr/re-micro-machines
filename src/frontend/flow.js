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
import { loadWorld, loadBrk, roundCtx, spawnCars } from '../engine/race.js'
import { createColDirBuffers } from '../engine/collide.js'
import { createBrkBuffer } from '../formats/levbrk.js'
import { runStep } from '../engine/step.js'
import { advanceRotorFrame } from '../engine/states.js'
import { droneControlByte } from '../engine/ai.js'
import { initCameraState } from '../engine/camera.js'
import { createKeyboardReader, createPauseKeyReader, recordingReader, SCANCODE_TO_KEY_CODE } from '../engine/input.js'
import { createPauseState, updatePause } from '../engine/pause.js'
import { createRaceEndState, updateRaceEnd } from '../engine/raceEnd.js'
import { createFadeState, updateFade, applyFade } from '../engine/fade.js'
import { raceStart, updateEngines, createRaceJitter, raceOverSequence, raceOverStart, raceOverGateCar, titleMusic, subMenuMusic, raceIntroMusic, raceResultMusic, raceOutcomeMusic, championMusic } from '../engine/sound.js'
import { lapLineSegments, nearestPaletteIndex } from '../engine/lapLine.js'
import { Si2Player } from '../audio/si2Player.js'
import { RUFF_TRUCK_TIMES } from '../data/engine-tables.js'
import { initTournament, pickPlayerCharacter, pickOpponentCharacter, hasRaceIntro, screenAfterRace, currentRace, reportRaceResult, OUTCOME } from './tournament.js'
import { CHARACTER_NAMES, OUTCOME_MESSAGES, resolveSmoothnessForPlay } from '../data/frontend-tables.js'
import { drawTitleScreen, drawMainMenu, drawCharacterSelect, drawPressAnyKey, drawRaceIntro, drawResults, drawOutcome, drawChampion, drawOptionsScreen, drawCreditsScreen, drawRedefineKeysScreen, drawQuitToDosScreen, redefineKeyChar, REDEFINE_SLOT_LABELS } from './screens.js'
import { createSmoothnessGate } from '../engine/smoothness.js'
import { introInitialState, introStep, smPalette, SCREEN_W as LOGO_W, SCREEN_H as LOGO_H } from '../formats/gfx1.js'
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
  const brkBuffer = createBrkBuffer()

  statusEl.textContent = 'Loading front-end assets…'
  const [{ arena }, introPalBytes, settingsBytes, driverBytes, strtList, gfx1Bytes, smBytes, cheatsBytes, fontbinBytes] = await Promise.all([
    buildArena(read),
    read('INTRO.PAL'),
    read('SETTINGS.DAT').catch(() => null),
    read('DRIVER1.BIN'),
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

  const sound = new Si2Player()
  await sound.start(driverBytes.buffer ?? driverBytes, { strictOpl2: !!oplStrictCheckbox?.checked }) // M3.10 OPL waveform toggle
  window.addEventListener('keydown', () => sound.resume()) // see play.js's own comment on this pattern

  // M3.10 smoothness (src/engine/smoothness.js): n=1 is the smoothest/most-often-drawn setting,
  // not the choppiest -- see that module's header. A fresh gate is created per race (in
  // runOneRace, below), not once here: an advisor review caught that a single session-lifetime
  // gate's draw-period only lines up correctly for the first race -- every later race starts
  // mid-period against whatever step count the previous race ended on. The header's own
  // <select id="smoothness"> is gone (P1, GOAL-DOS-PARITY.md): F4 on the real OPTIONS screen is
  // the one control now, including AUTO (5), which resolveSmoothnessForPlay resolves at RETURN.
  let smoothnessN = resolveSmoothnessForPlay(settings.smoothness)

  canvas.width = MENU_VIEW.w
  canvas.height = MENU_VIEW.h
  const menuBuf = createMenuBuffer()

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
    paint(canvas, MENU_VIEW.w, MENU_VIEW.h, indexedToRgba(menuBuf, menuPal), { zoom: 1 })
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
    persistSettingsIfDirty()
    options = null
    phase = 'TITLE'
    titleMusic(sound)
    paintMenu()
  }
  function optionsEscape() {
    // 1000:28BE-28C2: STC;RET -- the real game drops straight to DOS, no write (the dirty flag is
    // never even consulted on this path). No further input is read once here.
    options = null
    phase = 'QUIT'
    menuBuf.fill(0)
    drawQuitToDosScreen(menuBuf, arena)
    paint(canvas, MENU_VIEW.w, MENU_VIEW.h, indexedToRgba(menuBuf, menuPal), { zoom: 1 })
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

  let phase = introState ? 'LOGO' : fontbinBytes ? 'CODECARD' : 'OPTIONS'
  let menuCursor = 0
  let charCursor = 0
  let charWho = 'player' // 'player' ("WHO DO YOU WANT TO BE ?") or 'opponent' (H2H: "WHO DO YOU WANT TO RACE ?")
  // The select screens start on the session's last picks: statics [3F4]=10 / [3F6]=9 (SPIDER/BONNIE),
  // rewritten by each pick (1001/1018/1087) -- docs/engine.md §9an.
  const lastPick = { player: 10, opponent: 9 }
  let pressAnyKeyTimer = null
  let tournament = null
  let lastStandings = null
  let lastPassed = null
  let currentCars = null // exposed on the session for debugging (play.js's own bootRace precedent)
  let currentRaceState = null // likewise
  let abortRaceFn = null // set by runOneRace while phase === 'RACING'; ESC (onKeydown, below) calls it

  function paintMenu() {
    menuBuf.fill(0)
    if (phase === 'TITLE') drawTitleScreen(menuBuf, arena, {})
    else if (phase === 'MENU') drawMainMenu(menuBuf, arena, { cursor: menuCursor })
    else if (phase === 'CHAR_SELECT') drawCharacterSelect(menuBuf, arena, { cursor: charCursor, taken: tournament.roster.filter((r) => r.taken).map((r) => r.index), prompt: charWho === 'opponent' ? 'WHO DO YOU WANT TO RACE ?' : 'WHO DO YOU WANT TO BE ?' })
    else if (phase === 'PRESS_ANY_KEY') drawPressAnyKey(menuBuf, arena)
    else if (phase === 'RACE_INTRO') drawRaceIntro(menuBuf, arena, currentRace(tournament))
    else if (phase === 'RESULTS') drawResults(menuBuf, arena, { standings: lastStandings, passed: lastPassed })
    else if (phase === 'OUTCOME') drawOutcome(menuBuf, arena, { message: OUTCOME_MESSAGES[tournament.lastOutcome] })
    else if (phase === 'CHAMPION') drawChampion(menuBuf, arena, { playerName: CHARACTER_NAMES[tournament.playerCharacter] })
    paint(canvas, MENU_VIEW.w, MENU_VIEW.h, indexedToRgba(menuBuf, menuPal), { zoom: 1 })
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
  async function runOneRace({ round, race }) {
    statusEl.textContent = `Loading round ${round} race ${race}…`
    const { bank, words, palBytes, rgb, size: vehicleSize, frames, rotorFrames, bank2, pristineTile0, ph0, world, brk } = await loadRaceAssets(round, race)
    const strt = strtList.find((s) => s.round === round && s.race === race)
    const raceFormat = tournament.format === 'twocar' ? 2 : 1
    // `UNKNOWN_kidmodifier_use` resolved 2026-09-22 -- `tournament.opponents` (the 3 drones' own
    // selected characters, auto-picked at character-select time per this file's own header note)
    // now feeds spawnCars's real per-car tuning handicap, not just `raceCtx.tournamentIndex`.
    const cars = spawnCars(strtList, round, race, { raceFormat, tournamentIndex: tournament.raceIndex, opponentCharacters: tournament.opponents })
    currentCars = cars
    const camera = initCameraState(strt)
    // controllerTypes [2658..265E]: P1's real chosen device (settings.p1Control, 1000:2D00's own
    // 1-based enum -- JOY1/JOY2/MOUSE never reachable yet, P6), every other car the CPU (6).
    const raceCtx = { ...roundCtx(round, race, { raceFormat }), brk, tournamentIndex: tournament.raceIndex, world, stepIncrement: 1, sound, camera, controllerTypes: [settings.p1Control, 6, 6, 6] }
    if (round === 9) raceCtx.ruffTruxTime = RUFF_TRUCK_TIMES[race - 1]
    const raceState = {}
    currentRaceState = raceState
    const jitter = createRaceJitter()
    const smoothGate = createSmoothnessGate(smoothnessN) // fresh per race -- see the comment above
    raceStart(sound)
    // KEYS1(4) or KEYS2(5) -- the only two devices reachable yet (P6 adds JOY1/JOY2/MOUSE).
    const humanReader = recordingReader(createKeyboardReader(settings.p1Control === 4 ? settings.keys1 : keys2, window))
    // Pause/fade/cheats (docs/engine.md §9q/§9ai): the same modules `play.js` wires into its own
    // loop, ported here for the first time (M3.34) -- `game.html` previously had none of the three.
    // Fresh per race, same as `humanReader`/`smoothGate` above: a reader created once at boot would
    // carry a stray SPACE "pressed" edge in from confirming the RACE_INTRO screen (SPACE/ENTER both
    // confirm a menu) straight into the race's first frame, instantly pausing it.
    const pauseKey = createPauseKeyReader(window)
    const pauseState = createPauseState()
    const fadeState = createFadeState('in')
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
        pauseKey.dispose()
        abortRaceFn = null
      }
      // ESC (docs/engine.md §9q's own header: `26E4` reloads the sound driver after ESC from a
      // race) -- a port-only addition, not modelled on a specific original screen: the real game
      // exits an interrupted race the same way it exits a finished one (silence, then back to the
      // menu tree), which this reuses via `raceOverSequence` rather than a bespoke abort path.
      // `onKeydown` calls this (it lives outside `RACING`'s own `humanReader`, which SPACE/arrows
      // go through instead).
      abortRaceFn = () => {
        cleanup()
        raceOverSequence(sound, cars)
        resolve({ aborted: true })
      }
      let raceEnd = null // the post-race hold + fade-out (engine/raceEnd.js), once the race is over
      let lastIndexed = null // the last painted frame: the hold re-shows it, and the fade-out darkens it
      function finishRace() {
        cleanup()
        // The tournament reads the order array at 11d5 ([2678..267E] -> [3FC..402]): the player's
        // place is car 0's slot in `raceState.rankOrder`, frozen by then (docs/engine.md §9ah). A
        // two-car race only checks slot 0 ([3FC]), after the [2630] exit fix-up that `runStep`
        // already applied (the slot-1 entry can be the absent car 2) -- docs/engine.md §9am.
        const finishPosition = raceFormat === 2 ? (raceState.rankOrder[0] === 0 ? 1 : 2) : raceState.rankOrder.indexOf(0) + 1
        // Cheat type 0 ([406]--, 3652) takes a life at pause time; the tournament reads [406] after
        // the race, so it is applied to the tournament's own counter here.
        if (globalState.lives) tournament.lives = Math.max(0, tournament.lives + globalState.lives)
        resolve(isBonus ? { won: cars[0].state === 0xf } : { finishPosition, cars })
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
        updateFade(fadeState, dtMs)

        const { pressed, held } = pauseKey.read()
        const paused = updatePause(pauseState, dtMs, pressed, held, cars[0], cheats, round, race, globalState, sound)

        let shouldRender = paused
        let over = false
        if (!paused) {
          acc += dtMs / 1000
          while (acc >= STEP_DT) {
            acc -= STEP_DT
            applyCheatGlobals(globalState, raceState, raceCtx)
            // `raceCtx.drawnTick`: read BEFORE the physics/state pass (was after, below) so
            // `markDrawn` (drawn.js) can gate the drawn-flag write on the same smoothness cadence
            // that already gates rendering (docs/engine.md §9ao 8) -- called once, not twice, since
            // `shouldDraw()` mutates its own counter.
            raceCtx.drawnTick = smoothGate.shouldDraw()
            const controls = cars.map((car, i) => (i === 0 ? humanReader.read() : droneControlByte(car, raceCtx)))
            runStep(world, cars, controls, raceState, raceCtx)
            if (isOver()) { over = true; break } // the exiting step never renders (3081 jumps past 90C5)
            if (raceCtx.drawnTick) { shouldRender = true; advanceRotorFrame(cars, round); raceState.tileAnimCounter = (raceState.tileAnimCounter ?? 0) + 1 }
            updateEngines(sound, cars, raceCtx, jitter)
          }
        }
        if (shouldRender && !over) {
          const composed = composeRaceView({ words, bank, camera, frames, vehicleSize, rotorFrames, bank2, pristineTile0, race, tileAnimCounter: raceState.tileAnimCounter ?? 0, cars, view: MENU_VIEW, hud: { ph0, raceFormat, round, ruffTruxTicks: raceState.ruffTruxTimer, raceOverCount: raceState.raceOverCount ?? 0, twoCar: raceState.twoCar, rankOrder: raceState.rankOrder, bannerBlink: bannerBlinkPhase(now) }, paused, lapLine: lapLineToggle?.checked ? lapLine : null })
          const faded = decodePalette(applyFade(palBytes, fadeState)).rgb
          lastIndexed = composed.indexed
          paint(canvas, MENU_VIEW.w, MENU_VIEW.h, indexedToRgba(composed.indexed, faded), { zoom: 1 })
        }
        statusEl.textContent = paused ? 'Paused' : (isBonus ? 'RUFFTRUX bonus race' : raceStatusLine(cars[0]))
        if (over) {
          // 30DF: sfx 16 gated on the camera-table car; then the hold (ESC is not read: 30F2-3100).
          raceOverStart(sound, cars, raceOverGateCar(raceState, raceFormat))
          abortRaceFn = null
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
    const wasQualifier = !tournament.pendingBonusRace && tournament.raceIndex === 0
    phase = 'LOADING' // input is ignored until runOneRace switches to RACING (a second confirm would start a second race)
    const result = await runOneRace(race)
    if (result.aborted) { phase = 'TITLE'; titleMusic(sound); paintMenu(); return } // ESC quit, see runOneRace
    if (race.round === 9) {
      reportRaceResult(tournament, { won: result.won })
      lastStandings = null
      lastPassed = result.won
    } else {
      reportRaceResult(tournament, { finishPosition: result.finishPosition })
      // The 25011968 cheat (DS:0F69, set on the OPTIONS screen): lives forced to 10 after every
      // race, docs/engine.md §7's own "cheat [F69] -> 10 after every race" (re-confirmed this
      // session against the fresh OPTIONS disassembly).
      if (cheatActive) tournament.lives = 10
      const names = [CHARACTER_NAMES[tournament.playerCharacter], ...tournament.opponents.map((i) => CHARACTER_NAMES[i])]
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
    const next = screenAfterRace(tournament, { wasQualifier, wasBonus: race.round === 9 })
    if (next === 'RESULTS') { raceResultMusic(sound, lastPassed); phase = 'RESULTS' }
    else if (next === 'OUTCOME') { raceOutcomeMusic(sound, tournament.lastOutcome); phase = 'OUTCOME' }
    else {
      nextAfterOutcome()
      return
    }
    paintMenu()
  }

  /** Where the flow goes once a race's screens are done: the champion screen, the main menu (a
   * finished run returns to "SELECT GAME", 02D7 -> 0220, not the title), or the next race. */
  function nextAfterOutcome() {
    if (tournament.over) {
      if (tournament.champion) { phase = 'CHAMPION'; championMusic(sound) } else { phase = 'MENU'; menuCursor = 0; titleMusic(sound) }
    } else startNextRace()
    paintMenu()
  }

  /** The next race's intro -- or, for the Head-to-Head qualifier, no intro at all (11F8 starts tune 4
   * and returns without a screen, 126D-127B): straight into the race. */
  function startNextRace() {
    raceIntroMusic(sound)
    if (hasRaceIntro(tournament)) { phase = 'RACE_INTRO'; return }
    advanceRace()
  }

  function confirm() {
    if (phase === 'LOGO') return // a key never skips the intro -- see the P1 header comment above
    if (phase === 'TITLE') { phase = 'MENU'; menuCursor = 0; subMenuMusic(sound) }
    else if (phase === 'MENU') {
      if (menuCursor === 2) { statusEl.textContent = 'Two-human head-to-head is not implemented in this port.'; return }
      tournament = initTournament({ format: menuCursor === 1 ? 'twocar' : 'challenge' })
      phase = 'CHAR_SELECT'; charWho = 'player'; charCursor = lastPick.player
      subMenuMusic(sound) // docs/sound.md tune table: "2 all sub-menus" -- confirmed live on this screen
    } else if (phase === 'CHAR_SELECT') {
      if (tournament.roster[charCursor].taken) return // fire on a taken character is ignored (0AB5-0ABB)
      if (charWho === 'player') {
        pickPlayerCharacter(tournament, charCursor)
        lastPick.player = charCursor
        if (tournament.format === 'twocar') {
          // 0FBF's second 09E0: "WHO DO YOU WANT TO RACE ?", starting on the last opponent pick and
          // stepping on (the carousel's remembered direction, RIGHT by default) past a taken entry.
          charWho = 'opponent'
          charCursor = lastPick.opponent
          while (tournament.roster[charCursor].taken) charCursor = (charCursor + 1) % 11
          paintMenu()
          return
        }
      } else {
        if (!pickOpponentCharacter(tournament, charCursor)) return
        lastPick.opponent = charCursor
      }
      // 0C15: "PRESS ANY KEY TO START" -- any key, or ~10 s (0x2BC ticks) with no input.
      phase = 'PRESS_ANY_KEY'
      clearTimeout(pressAnyKeyTimer)
      pressAnyKeyTimer = setTimeout(() => { if (phase === 'PRESS_ANY_KEY') confirm() }, (0x2bc * 1000) / 70)
    } else if (phase === 'PRESS_ANY_KEY') {
      clearTimeout(pressAnyKeyTimer)
      startNextRace()
      if (phase !== 'RACE_INTRO') return // the H2H qualifier went straight into the race
    } else if (phase === 'RACE_INTRO') {
      advanceRace()
      return
    } else if (phase === 'RESULTS') {
      phase = 'OUTCOME'
      raceOutcomeMusic(sound, tournament.lastOutcome) // ShowRaceOutcomeMessageTune8or6 1000:1c84, docs/engine.md §9ai
    } else if (phase === 'OUTCOME') {
      nextAfterOutcome() // whether this is a regular race or the just-unlocked bonus race, currentRace() resolves it
      return
    } else if (phase === 'CHAMPION') {
      phase = 'MENU' // 1AAD returns to the main menu (02D7 -> 0220), not the title
      menuCursor = 0
      titleMusic(sound)
    }
    paintMenu()
  }

  function onKeydown(e) {
    if (e.code === 'KeyA' || e.code === 'KeyB') introHeldKeys.add(e.code) // fed to introStep regardless of phase; only consumed during LOGO
    if (phase === 'RACING') {
      if (e.code === 'Escape' && abortRaceFn) abortRaceFn() // port-only quit-to-menu, see runOneRace's own comment
      return // the race's own createKeyboardReader owns the rest of a race's input
    }
    if (phase === 'LOGO') return // no key skips the intro -- see the P1 header comment above
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
    if (phase === 'PRESS_ANY_KEY') { confirm(); return } // 0C15: any key click
    if (phase === 'CHAR_SELECT' && e.code === 'Escape') { phase = 'MENU'; menuCursor = 0; titleMusic(sound); paintMenu(); return } // ESC at a select -> main menu
    if (phase === 'CHAR_SELECT' && (e.code === 'ArrowLeft' || e.code === 'ArrowRight')) { charCursor = (charCursor + (e.code === 'ArrowLeft' ? 10 : 1)) % 11; paintMenu(); return } // the carousel's own LEFT/RIGHT
    if (e.code === 'ArrowUp') { if (phase === 'MENU') menuCursor = (menuCursor + 2) % 3; else if (phase === 'CHAR_SELECT') charCursor = (charCursor + 10) % 11; paintMenu() }
    else if (e.code === 'ArrowDown') { if (phase === 'MENU') menuCursor = (menuCursor + 1) % 3; else if (phase === 'CHAR_SELECT') charCursor = (charCursor + 1) % 11; paintMenu() }
    else if (e.code === 'Space' || e.code === 'Enter') confirm()
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
    },
    // debugging/testing hooks: drive the flow without a real keyboard
    getPhase: () => phase,
    getTournament: () => tournament,
    getCars: () => currentCars,
    getRaceState: () => currentRaceState,
    confirm,
    moveCursor: (dir) => onKeydown({ code: dir > 0 ? 'ArrowDown' : 'ArrowUp' }),
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
  }
}

const ORDINAL = ['1st', '2nd', '3rd', '4th']

/** The race status line: laps left is the HUD's own top digit (3 during the countdown, 4 once the
 * back row's first progress write counts as a backward crossing, then down; docs/engine.md §9ah). */
function raceStatusLine(car0) {
  const place = ORDINAL[(car0.racePosition ?? 1) - 1] ?? '?'
  return car0.lapsRemaining <= 0 ? `Finished ${place}!` : `laps left ${car0.lapsRemaining}, position ${place}`
}
