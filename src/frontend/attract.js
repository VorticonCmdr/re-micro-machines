// P2's first item (GOAL-DOS-PARITY.md): RunTitleScreenAttractLoop 1000:0100's real per-tick state
// machine -- disassembled fresh (78 instructions, 1000:0100-01dd) since the decompiler mis-resolved
// this function's carry-flag-driven exits into an unreachable infinite loop (it marked every real
// exit block "unreachable" and printed `do {} while(true)`).
//
// The real loop: draw LOGO + the copyright line once, then repeatedly (1000:017b) advance the
// showcase class index (wrapping 0..8, 9 classes -- SPORTSCARS..RUFFTRUX, DS:002F, frontend-
// tables.js's TITLE_CLASS_NAMES) and redraw, then wait up to CLASS_ADVANCE_TICKS (0x118 = 280)
// ticks of DS:0002 -- checking the exit condition on EVERY tick, not just at the 280-tick mark.
// There is NO idle timeout: with no input the class just keeps cycling forever (confirmed by the
// absence of any [0x2]-vs-timeout compare anywhere in this function, unlike RunTwoItemMenu's own
// 0x7D0 check).
//
// The exit test (1000:01be-01d8) reads TWO different things, not one:
//  - Fire is a LEVEL test on [0x137b] bit 0x08 -- and [0x137b] is P1's OWN reader slot, read
//    directly, not the combined-both-players [0x108b] RunTwoItemMenu uses ([0x1080] is never
//    redirected away from 0 here). Only P1's configured device can start the game from the title.
//  - ESC-vs-other is a single-shot RELEASE edge on [0x107e], the GLOBAL (whole-keyboard, not
//    per-player) "last released scancode" latch the INT9 handler (2f43-2f6c) maintains by tracking
//    exactly one held key at a time. ESC's own scancode is 1 (HookKeyboardInt09's own 2f59 compare).
//    ANY other key's release also exits, to the main menu (same as fire).
// real_entry's own master loop (1000:0086-0095, re-disassembled this session) confirms the exit
// destinations: CF=1 (ESC) loops back to 1000:0032 (StopMusic -> RunOptionsScreenWithSettingsDat
// again); CF=0 (fire or any other release) falls into 1000:0220 (RunMainMenuKeepTitleTune).
export const CLASS_ADVANCE_TICKS = 0x118
export const CLASS_COUNT = 9

export function attractInitialState() {
  return { classIndex: 0, ticks: 0 }
}

/**
 * One ~1/70s tick. `input`: `{ p1Fire, escReleased, otherReleased }` -- all three already resolved
 * by the caller from the real per-tick keyboard state (flow.js). Returns
 * `{ exit: null | 'menu' | 'options' }`; `state` is mutated in place (classIndex/ticks), matching
 * `introStep`'s own convention (gfx1.js).
 */
export function attractStep(state, input = {}) {
  if (input.p1Fire) return { exit: 'menu' } // 1000:01c1 TEST AL,8 / JNZ 01da (CLC)
  if (input.escReleased) return { exit: 'options' } // 1000:01c8 CMP AL,1 / JZ 01dc (STC)
  if (input.otherReleased) return { exit: 'menu' } // 1000:01cc OR AL,AL / JNZ 01da (CLC)
  state.ticks++
  if (state.ticks >= CLASS_ADVANCE_TICKS) {
    state.ticks = 0
    state.classIndex = (state.classIndex + 1) % CLASS_COUNT // 1000:017f-0187
  }
  return { exit: null }
}
