// P2's second item (GOAL-DOS-PARITY.md): RunTwoItemMenu 1000:0382, the shared two-item menu
// helper behind both SELECT GAME (RunMainMenuKeepTitleTune 1000:0220 -- ONE PLAYER/TWO PLAYER)
// and ONE PLAYER GAME (RunOnePlayerGameMenu 1000:02e0 -- Head to Head/Challenge). Fully
// disassembled (1000:0382-03ff, 47 instructions).
//
// `bits`: the combined LEFT(0x80)/RIGHT(0x40)/FIRE(0x08) byte BOTH screens read ([0x108b] =
// [0x137b]|[0x14df], P1's reader OR'd with P2's -- 0382 itself sets [0x1080]=0 at entry, forcing
// this combine). Both players' own LEFT/RIGHT/FIRE drive every level of this menu, unlike the
// title screen's own P1-only fire test (attract.js) or the character select carousel's own
// P1-only [0x1080]=0x137b override (charSelect.js). `input.js`'s `createKeyboardReader` already
// returns exactly this bit layout, so flow.js just ORs two instances' `.read()` results.
// `escReleased`: the SAME global single-key-tracked release latch attract.js uses
// (`engine/input.js`'s `createMenuReleaseTracker`) -- 0382's own idle-cancel test (`03D6`) reads
// `[0x107e]==1` directly, not a menu-local copy.
export const MENU_IDLE_CANCEL_TICKS = 0x7d0 // 2000 ticks ~28.6s -- 1000:03CE

/**
 * `initialSelection`: the caller's own AX (0390: `MOV CX,AX`) -- the REAL persisted selection
 * from this exact menu level's own last visit (`[0x130]` for SELECT GAME, `[0x132]` for ONE
 * PLAYER GAME, both DS scratch words whose static-image resting value is a real pre-selection --
 * docs/engine.md §9av's own correction of the earlier "SELECT GAME starts with nothing selected"
 * claim). 0 is a legitimate value too (nothing picked yet, ever).
 */
export function twoItemMenuInitialState(initialSelection) {
  return { selection: initialSelection, phase: 'AWAIT_RELEASE', idleTicks: 0 }
}

/**
 * One ~1/70s tick. `input`: `{ bits, escReleased }`. Returns
 * `{ exit: null | 'cancel' | 'confirm', selection? }`; `state` is mutated in place.
 */
export function twoItemMenuStep(state, input = {}) {
  const bits = input.bits ?? 0
  if (state.phase === 'AWAIT_RELEASE') {
    // 1000:0399-03A9: draw THUMB at the current selection, then swallow a fire press that was
    // already held from before this redraw -- entered on every fresh entry AND every selection
    // change, never on a same-direction repeat (see below).
    if ((bits & 0x08) === 0) { state.phase = 'POLL'; state.idleTicks = 0 }
    return { exit: null }
  }
  // POLL (1000:03C2-03FF). 03C2's own vsync wait increments DS:0002 every tick, unconditionally
  // -- BEFORE any of the checks below read it (03CE), so this port increments first too.
  state.idleTicks++
  if (state.idleTicks >= MENU_IDLE_CANCEL_TICKS) return { exit: 'cancel' } // 03CE
  if (input.escReleased) return { exit: 'cancel' } // 03D6 -- the same global latch attract.js reads
  if (bits & 0x08) { // fire, 03DD-03E2
    if (state.selection === 0) { state.phase = 'AWAIT_RELEASE'; state.idleTicks = 0; return { exit: null } } // 03F8: nothing selected yet -- ignored, redraw + re-wait
    return { exit: 'confirm', selection: state.selection } // 03FC
  }
  const dir = bits & 0x80 ? 1 : bits & 0x40 ? 2 : 0 // 03E4-03EE: LEFT=1, RIGHT=2
  if (dir === 0) return { exit: null } // nothing pressed this tick -- the increment above still counts
  if (dir === state.selection) { state.idleTicks = 0; return { exit: null } } // 03F0-03F2: repeat direction -- timer reset only, no redraw
  state.selection = dir // 03F4
  state.phase = 'AWAIT_RELEASE' // 03F6: JMP 0392 -- redraw + re-wait-for-release
  state.idleTicks = 0
  return { exit: null }
}
