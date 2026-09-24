// Race sound (PLAN-ENGINE.md M3.7, docs/sound.md): wires the already-fully-researched sound
// driver model (`src/formats/si2.js`) into the race engine. Everything about the DRIVER (commands,
// timing, the 36 sfx trigger predicates) was already established by an earlier session's research
// pass (docs/sound.md §1-§7) -- this module's job is porting that into the physics step, not
// re-deriving it.
//
// Two "driver" shapes are accepted, both exposing `{playSfx(id), engine(car,opts), stopMusic(),
// muteAll(), command(ah,al)}`: `Si2Player` (src/audio/si2Player.js) already has exactly this shape
// for the browser (its worklet ticks the sequencer off the audio clock in real time); `asDriver()`
// below adapts a raw `Sequencer` (src/formats/si2.js) to the same shape for headless/deterministic
// use (tools/check-sound.mjs), where the caller ticks it manually -- matching D6's "run the
// sequencer on the main thread in lockstep with physics" option, one `hostTick()` twice per
// physics step (35 Hz physics, 70.06 Hz driver tick).
import { createEngineJitter } from '../formats/si2.js'

/** Adapts a raw `Sequencer` to the same call shape as `Si2Player`, for headless use. */
export function asDriver(seq) {
  return {
    playSfx: (id) => seq.command(5, id),
    stopSfx: (id) => seq.command(8, id),
    engine: (car, opts) => seq.engineUpdate(car, opts),
    stopMusic: () => seq.command(7),
    muteAll: () => seq.command(6),
    command: (ah, al) => seq.command(ah, al),
  }
}

/** `LoadRaceStartPosCheatsMapAndBanks`'s race-start sound setup (docs/sound.md §6): `AH=7`
 * ("every race start... races have no music", `1000:11AA`/`2173`/`39F5`). */
export function raceStart(driver) {
  driver.stopMusic()
}

/** `InitEngineSounds 1000:7A97`'s per-class bytes: instrument 0x70 for POWERBOATS(2)/CHOPPERS(8)
 * else 0x71, delay 3 for CHOPPERS(8) else 0 (`ctx.round` doubles as the vehicle-class byte
 * `[28BF]`, docs/sound.md §3b's own closed finding). */
export function raceInstrument(round) {
  return { instrument: round === 2 || round === 8 ? 0x70 : 0x71, delay: round === 8 ? 3 : 0 }
}

/**
 * The per-step engine update (`UpdateEngineSoundsPerFrame 1000:7bee-7c24`, docs/sound.md §6): per
 * car, `bend = min(|speed|,0x7FF)/10`, `+0x30` if airborne (`zVel != 0`), `= 0x14` if `subState` is
 * set, `= 0x0A` if not drawn this frame (later overrides take precedence), then
 * `bend = |bend + ((jitter()&3)-2)|`. Verified live this session (`1000:7b90-7c24`), not just from
 * the doc's prose: `DIV CL` at `7bb6` is a real integer divide by 10 (not a shift/multiply
 * approximation), the airborne test really is `zVel` (not `height`), and the two leading
 * `[BX+1250]!=0`/`[28BF]!=8` comparisons are dead `JNZ +0` branches -- confirming "not gated on
 * drawn" byte-for-byte. Truncation is deferred to after the jitter add (`Math.trunc` below) rather
 * than immediately after the division the way `DIV` does; provably equivalent since every value
 * added afterward is an integer constant (`floor(x)+n == floor(x+n)` for integer `n`). Skipped
 * entirely while any car is in the two-car "loser" state 0xB (not reachable in this port's
 * one-player scope, checked anyway since it costs nothing). `jitter` is a `createEngineJitter()`
 * closure -- one per race, shared by all 4 cars, matching the single `CS`-relative PRNG state the
 * real driver call site uses.
 */
export function updateEngines(driver, cars, ctx, jitter) {
  if (cars.some((c) => c.state === 0xb)) return
  const { instrument, delay } = raceInstrument(ctx.round)
  for (let i = 0; i < cars.length; i++) {
    const car = cars[i]
    let bend = Math.min(Math.abs(car.speed ?? 0), 0x7ff) / 10
    if (car.zVel) bend += 0x30
    if (car.subState) bend = 0x14
    if (!car.drawnThisFrame) bend = 0x0a
    bend = Math.abs(Math.trunc(bend) + ((jitter() & 3) - 2))
    driver.engine(i, { bend, instrument, delay })
  }
}

/** One `createEngineJitter()` per race (docs/sound.md §6: one shared PRNG state, not per-car). */
export const createRaceJitter = createEngineJitter

/**
 * The car the race exit's sfx gate reads (30DF `[BX+1250]`), i.e. 4AEE's leftover BX = the camera
 * table car: car 0 in a four-car race; in two-car, `[27B5]`==0 (the midpoint, the normal end) gives
 * [2662] = car 1, 1 gives car 0, 2 gives car 1 (docs/engine.md §9an).
 */
export function raceOverGateCar(raceState, raceFormat) {
  if (raceFormat !== 2) return 0
  const idx = raceState?.cameraIndex ?? 0
  return idx === 0 ? 1 : idx - 1
}

/**
 * The start of the real race exit, `30DF-30EF`: sfx 16 if the gate car is drawn. `StopEngineSounds`
 * (7AF8) under DRIVER1 only zeroes the car speed words and sends NO driver command, and the engine
 * poke 7B46 is not called during the hold -- so the engine voices keep their last pitch record until
 * `raceOverEnd`. Then comes the 100-tick hold (`30F2-3100`, the page's job).
 */
export function raceOverStart(driver, cars, gateCar = 0) {
  if (cars[gateCar]?.drawnThisFrame) driver.playSfx(16)
}

/** After the hold, `3102`/`3109`: AH=8 with AL=0x78 (a leftover of 92C3's `MOV AX,0x7D78`; dead, the
 * AH=6 reset clears the queues first) then AH=6, which silences everything. Issuing AH=6 in the same
 * instant as the AH=5 above is what made the port drop sfx 16 entirely (docs/engine.md §9an). */
export function raceOverEnd(driver) {
  driver.stopSfx(0x78)
  driver.muteAll()
}

/**
 * `ResetCarsAfterKnockoutSfxA`/race-over's simplified tail (docs/sound.md §6 "race end: AH=5 10h
 * (gated on a car being drawn)... StopEngineSounds... AH=8... AH=6") collapsed into one instant.
 * Kept only for the ESC quit (the real 306E path skips the sfx, the hold and the AH=8/AH=6 entirely;
 * the title screen's own entry sequence mutes). The real race end is `raceOverStart` + the page's
 * 100-tick hold + `raceOverEnd` (docs/engine.md §9an).
 */
export function raceOverSequence(driver, cars) {
  if (cars.some((c) => c.drawnThisFrame)) driver.playSfx(16)
  for (let i = 0; i < cars.length; i++) driver.engine(i, { bend: 0 }) // StopEngineSounds: pitch 0 + END
  driver.stopSfx(0) // AH=8 with "whatever AL holds" at this leftover call site -- 0 is a no-op push
  driver.muteAll()
}

// --- Front-end music (M3.23, docs/sound.md §2/§6) -----------------------------------------------
// The 15 `AH=4 CmdPlayTune` sites map to front-end screens, not races: `raceStart` above already
// sends the `AH=7` that keeps every race itself silent. Only `flow.js` (the tournament front end)
// reaches these; `play.js`'s single-race page skips straight into a race and never shows them.

/**
 * Title-screen entry (docs/sound.md §6): "title entry `AH=4(1), 7, 8, 6, 9, 4(1)`". A fresh
 * driver's zeroed `trackCount` turns the `AH=7` stop-music into a documented quirk (it skips
 * clearing the pending flag via a `JCXZ`, so it fires one tick *after* the tune starts, keying its
 * notes off; the game's own `AH=9`-then-`AH=4` poll then restarts it, deduplicated by the OPL
 * shadow compare). Modelled by sending the same commands in order and letting the already-proven
 * `Sequencer`/worklet reproduce the quirk, rather than hand-simulating it here; the trailing
 * `AH=9` poll is collapsed into a second unconditional `playTune(1)` -- docs/sound.md's own AH=9
 * row notes a repeat `AL=1` poll is `0901` once then `0900` forever ("the tune is never
 * restarted"), so reissuing `playTune(1)` on an already-current tune is a proven no-op.
 */
export function titleMusic(driver) {
  driver.playTune(1)
  driver.stopMusic() // AH=7
  driver.stopSfx(0) // AH=8, leftover AL (docs/sound.md's own precedent for this argument)
  driver.muteAll() // AH=6
  driver.playTune(1) // AH=9-then-AH=4, collapsed (see above)
}

/**
 * The mode-select and character-select screens (docs/sound.md's tune table: "2 all sub-menus";
 * confirmed live on the character-select screen, driver `current tune` byte `+0x125B` == 2). The
 * real game has two menu levels (MAIN then a ONE PLAYER submenu) where this port flattens them
 * into one MENU screen (flow.js's own file header); both MENU and CHAR_SELECT play tune 2 here,
 * matching the two real sub-menu sites one-for-one.
 */
export function subMenuMusic(driver) {
  driver.playTune(2)
}

/**
 * Next-race intro screen (docs/sound.md §2/§8): always tune 4. `ShowNextRaceIntroScreenTune4or5`
 * (`1000:11f8`) also has an `AL=5` branch, gated on `[28c1]==0x1a`, but every path that reaches it
 * -- normal tournament advance (`10f9`/`1104`, capped by `[439]=0x19`) and the `25011968`-cheat
 * race-skip hotkey (`13aa`/`13bf`, same cap) -- leaves `[28c1]` at 0x19 at most, one short of the
 * branch's own threshold. Tune 5 is real, embedded audio (like tune 7, `UNKNOWN_tune7_unused`)
 * that no reachable code path ever requests; a former `isLastRace` parameter here played it for
 * the tournament's real final race, which was a port-only divergence, not a port of this branch.
 */
export function raceIntroMusic(driver) {
  driver.playTune(4)
}

/**
 * The tournament's own standings screen ("RESULTS" in `flow.js`), `ShowRaceResultsScreenTune8or6
 * 1000:1439`: real condition is `word[3FC]==0xC03` (car 0 placed 1st) OR (`byte[28C1]!=0x19` AND
 * `word[3FE]==0xC03`, car 0 placed 2nd, except on the tournament's 25th-of-26 race) -- `[3FC]`/
 * `[3FE]` are the order array's own first two slots (`runOneRace`'s own citation of `[3FC..402]`).
 * Approximated here by `passed` (the same boolean the screen's own display text already computes,
 * `flow.js`'s `lastPassed`) rather than the exact byte test -- a confirmed [STATIC]-only reading
 * (`mm-re-player-visible`, 2026-09-23, docs/engine.md §9ai) whose `0x19`-race exception is NOW
 * understood (GOAL-DOS-PARITY.md P3's 4th item, docs/engine.md §9bb item 1): it's the SAME
 * last-race-only-1st-place rule `tournament.js`'s `reportRaceResult` now ports for the outcome
 * itself (`1000:15B7`/`1658`), just re-used here for the results TUNE specifically -- still left as
 * the `passed` approximation, not implemented byte-exact for the tune condition itself, since
 * `lastPassed` already agrees with the byte-exact test in every case this port's own last-race
 * pass-threshold fix now produces (a 2nd-place finish on the last race is `lastPassed=false` there
 * too), so the two are no longer known to diverge -- flagged as a refinement to VERIFY exhaustively,
 * not a known bug, next time this specific item is picked up. */
export function raceResultMusic(driver, passed) {
  driver.playTune(passed ? 8 : 6)
}

/**
 * The shared "outcome message" screen ("OUTCOME" in `flow.js`), `ShowRaceOutcomeMessageTune8or6
 * 1000:1c1b` (the tune-play itself at `1000:1c84`): tune 8 if the outcome code is odd (1 PASSED, 3
 * EXTRA_LIFE, 5 QUALIFIED_FOR_HEAD_TO_HEAD), tune 6 if even (0 QUALIFIER_FAILED, 2 ONE_LIFE_LOST, 4
 * NO_BONUS) -- CODE 4 DOES PLAY TUNE 6, correcting a real error a `2026-09-23` pass (`mm-re-player-
 * visible`, formerly cited here and at docs/engine.md §9ai) made and this session's own re-
 * disassembly (GOAL-DOS-PARITY.md P3's 4th item, docs/engine.md §9an 8/§9bb) found and fixed: that
 * pass's own claim -- "code 4 skips the whole real screen, jumping straight past its own AH=4" --
 * does not hold up against a byte-for-byte re-read of `1c6a-1c89`; the ONLY branch between the
 * win/lose tune choice (`1c6c: TEST CX,1`, parity-based, no code-4 special case) and the play call
 * itself (`1c84`) is `1c80: JZ 1c89`, which depends on the `AH=9` query's own return value (already
 * playing or not), not on CX at all -- the SAME "query-then-play, safely collapsible into one
 * `playTune` call" idiom this file already uses everywhere else (see `titleMusic`'s own header).
 * What code 4 DOES skip is the LATER lives-adjustment display machinery (`1cab-1d08`) that codes
 * 2/3 alone reach -- a real but separate, not-yet-modelled visual detail, unrelated to the tune.
 * `outcomeCode`: `tournament.js`'s own `OUTCOME` values, confirmed the same 0-5 encoding by
 * `frontend-tables.js`'s `OUTCOME_MESSAGES` header comment ("index == the outcome code
 * docs/engine.md §7 already names"), so no translation is needed -- `tournament.lastOutcome` IS the
 * real CX byte. */
export function raceOutcomeMusic(driver, outcomeCode) {
  driver.playTune(outcomeCode % 2 === 1 ? 8 : 6)
}

/** P3's third item: `ShowCharacterEliminatedTune6 1000:16DE`'s own entry (`1000:16E4`/`16F1`,
 * AH=9-query-then-AH=4-play, collapsed the same way `titleMusic`'s own header note already
 * documents), played ONCE before the bounce animation starts -- confirmed this session, along with
 * the correction that no further tune plays during the bounce itself (docs/engine.md §9ba). */
export function eliminatedMusic(driver) {
  driver.playTune(6)
}

/** Champion screen (docs/sound.md's tune table: "3 champion"). */
export function championMusic(driver) {
  driver.playTune(3)
}
