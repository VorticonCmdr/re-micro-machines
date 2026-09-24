// CheckCheatSpotsThenPause 1000:35f0 (docs/engine.md §6/§9q), the pause-menu cheat check -- M3.8's
// "cheats" scope. Split into two pure, testable pieces rather than one function that also owns the
// pause UI (the white screen, "Paused!" banner, the >=140-tick/key-release wait): that part is
// `engine/pause.js`'s own state machine (wired into play.js post-M3.11, docs/engine.md §9q), which
// calls `findCheatSpot`/`applyCheatEffect` directly rather than duplicating this scan.

/**
 * The proximity scan (`|dx|,|dy| < 24` from the camera-target car, docs/engine.md §6). `cheats`:
 * `parseCheats(...)`'s 30 records. `car`: the camera-target car (`[0x2660]`, car 0 in this port's
 * one-player scope). Returns the matching record, or `null`.
 */
export function findCheatSpot(cheats, car, round, race) {
  for (const cheat of cheats) {
    if (cheat.round !== round || cheat.race !== race) continue
    if (Math.abs(car.posX - cheat.x) < 24 && Math.abs(car.posY - cheat.y) < 24) return cheat
  }
  return null
}

/**
 * The 10 cheat effects (`3652-3733`, docs/engine.md §6), applied to the triggering car and/or
 * `globalState` (a plain object this port keeps for the handful of globals these types touch).
 * `play.js` copies type 1's `raceOverCount` (=4, [26C6]) and `fixedOrder` (car0, car2, car1, car3)
 * into its `raceState` on the next step, which `step.js`'s race-over logic then acts on
 * (docs/engine.md §9ah); `projectilesForAll` feeds `ctx.projectilesForAll`; `lives` has no reader.
 */
export function applyCheatEffect(car, cheat, globalState = {}) {
  switch (cheat.type) {
    case 0: globalState.lives = (globalState.lives ?? 0) - 1; break // [406]--
    case 1: // instant win: [26C6]=4, [2635]=1, fixed order, score 0x7D00
      globalState.raceOverCount = 4
      globalState.fixedOrder = true
      globalState.instantWinScore = 0x7d00
      break
    case 2: car.slipThreshold = cheat.param; break // [127C]
    case 3: car.gripStep = cheat.param; break // [127E]
    case 4: car.accel = cheat.param; break // [12A2]
    case 5: globalState.cheat5 = 1; break // [2915]: its only reader 4F0D turns the fire entry 4F03 into a ground coast -- only the 0x30 chord fires (docs/engine.md §9an)
    case 6: globalState.cheat6 = 1; break // [2917] -- ditto
    case 7: car.hazardVulnerable = 0; break // [12F9]
    case 8: car.maxSpeedCur = 0x800; break // [129C]
    case 9: // [2915]=[2919]=1, [291B]=4: projectiles in every round -- but with [2915] only via the 0x30 chord (docs/engine.md §9an)
      globalState.cheat5 = 1
      globalState.projectilesForAll = true
      globalState.projectileLimit = 4
      break
    default: break
  }
  return globalState
}
