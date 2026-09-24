// P1 (GOAL-DOS-PARITY.md): the SM.EXE logo intro's real per-frame animation and its real skip
// input, re-derived from a full disassembly of RunIntroMainLoop 1000:097f and its callees
// (re/SM.EXE.lst, docs/intro-and-codecard.md, src/formats/gfx1.js's own header comment). Proves,
// without a new DOSBox capture:
//  - the real 48-record/banner-slide/shine sequence self-terminates at exactly iteration 314
//    (48 reveal + 35-frame slide, shine starting concurrently once the slide stops, 30-frame
//    sweep, then the 250-frame post-shine hold);
//  - a mouse click always wins, at any point, over everything else;
//  - holding A+B together holds the post-shine exit open indefinitely, and releasing it restarts
//    the 250-frame count from 0 -- the one real (if obscure) keyboard effect this intro has;
//  - the shine's own bright/dim arithmetic, checked pixel-for-pixel against the untouched
//    composeLogoScreen() still frame: every pixel the shine ever touched matches
//    composeLogoScreen() plus its own recorded net delta, and 5 of its 30 diagonal bands (0, 1,
//    27, 28, 29 -- Dim only ever reaches bands 2..26) are left permanently brightened, exactly as
//    the real bytes leave them, because the banners are never redrawn after the slide stops.
//   node tools/check-intro.mjs
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { introInitialState, introStep, composeLogoScreen, SCREEN_W, SCREEN_H } from '../src/formats/gfx1.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const gfx = new Uint8Array(readFileSync(join(ROOT, 'game', 'GFX1.GFX')))
const sm = new Uint8Array(readFileSync(join(ROOT, 'game', 'SM.EXE')))

let bad = 0
function check(name, cond) {
  if (cond) return
  bad++
  console.log(`FAIL: ${name}`)
}

// 1. With no input, the sequence runs exactly 314 iterations (48 record-reveal frames + a
// 35-frame banner slide with the 30-frame shine starting concurrently once it stops + a 250-frame
// post-shine hold) before exiting.
{
  const s = introInitialState(gfx, sm)
  let n = 0
  while (!s.exited && n < 1000) { introStep(s, {}); n++ }
  check('no-input run exits at exactly iteration 314', n === 314)
  check('all 48 records were drawn (cursor clamped at the last)', s.recordIndex === 47)
  check('the banner slide finished (not still active)', s.slideActive === false)
  check('the shine finished', s.shineDone === true)
}

// 2. Checkpoints along the way: the banner reaches its stop position (x=0x48) at iteration 35,
// and the shine starts moving that same iteration (35 total shine draws by iteration 64).
{
  const s = introInitialState(gfx, sm)
  for (let i = 0; i < 34; i++) introStep(s, {})
  check('iteration 34: banner not yet at its stop, slide still active', s.bannerAX === -208 + 34 * 8 && s.slideActive)
  introStep(s, {}) // iteration 35
  check('iteration 35: banner reaches SlideStopX and the slide ends', s.bannerAX === 72 && !s.slideActive)
  check('iteration 35: the shine has already made its first move', s.shineX === 80)
  for (let i = 0; i < 29; i++) introStep(s, {}) // iterations 36..64
  check('iteration 64: the shine reaches its end position and is marked done', s.shineX === 312 && s.shineDone)
}

// 3. A mouse click always wins, immediately, regardless of where in the sequence it lands.
for (const stopAt of [1, 20, 35, 64, 65, 200]) {
  const s = introInitialState(gfx, sm)
  for (let i = 0; i < stopAt - 1; i++) introStep(s, {})
  introStep(s, { mousePresent: true, mouseDown: true })
  check(`a mouse click at iteration ${stopAt} exits on that same iteration`, s.exited && s.iteration === stopAt)
}

// 4. A held mouse button that is never pressed (mousePresent but mouseDown:false every tick)
// changes nothing -- the sequence still runs the full 314 iterations.
{
  const s = introInitialState(gfx, sm)
  let n = 0
  while (!s.exited && n < 1000) { introStep(s, { mousePresent: true, mouseDown: false }); n++ }
  check('mouse present but never pressed: still exits at iteration 314', n === 314)
}

// 5. Holding A+B together through the post-shine hold keeps it open indefinitely; releasing it
// restarts the 250-frame count from 0 (FUN_1000_0ac6's own [0x6ba]=0 write every held iteration).
{
  const s = introInitialState(gfx, sm)
  while (!s.shineDone) introStep(s, {}) // reach iteration 64, shineDone just set
  for (let i = 0; i < 1000; i++) introStep(s, { abHeld: true })
  check('1000 iterations of A+B held past shineDone: never exits', !s.exited && s.postShineCounter === 0)
  let n = 0
  while (!s.exited && n < 1000) { introStep(s, {}); n++ }
  check('releasing A+B restarts the 250-frame count from 0', n === 250)
}

// 6. The shine's own arithmetic, checked against the untouched still frame: independently
// re-derive every pixel the shine ever writes and its cumulative signed delta (30 bright calls,
// dim trailing once brightCount>=6, exactly as introStep's own shine sub-step does), then require
// the real run's final screen to equal composeLogoScreen() (which reproduces the same 48
// records + banners at rest, with no shine at all) plus that delta, mod 256, EVERYWHERE the shine
// ever touched -- not just "doesn't crash".
{
  const real = introInitialState(gfx, sm)
  let n = 0
  while (!real.exited && n < 1000) { introStep(real, {}); n++ }
  const still = composeLogoScreen(gfx, sm).indexed

  const delta = new Int32Array(SCREEN_W * SCREEN_H)
  let shineX = 0x48, brightCount = 0
  const band = (x, y, d) => {
    for (let r = 0; r < 0x46; r++) {
      const row = (y + r) * SCREEN_W + (x - r)
      for (let c = 0; c < 8; c++) { const i = row + c; if (i >= 0 && i < delta.length) delta[i] += d }
    }
  }
  for (let k = 0; k < 30; k++) {
    band(shineX, 0x50, 0x10)
    if (brightCount < 8) brightCount++
    shineX += 8
    if (brightCount >= 6) band(shineX - 0x20, 0x50, -0x10)
  }
  let touched = 0, residue16 = 0, mismatches = 0
  for (let i = 0; i < delta.length; i++) {
    if (delta[i] === 0) continue
    touched++
    if (((delta[i] % 256) + 256) % 256 === 0x10) residue16++
    const expect = (still[i] + delta[i] % 256 + 256) % 256
    if (real.screen[i] !== expect) mismatches++
  }
  check('the shine touched a non-trivial number of pixels', touched > 1000)
  check('some pixels carry the permanent +0x10 residue (bands 0,1,27-29, never dimmed)', residue16 > 0)
  check('every shine-touched pixel equals composeLogoScreen() + its own net delta', mismatches === 0)
}

console.log(bad ? `${bad} check(s) failed` : 'check-intro: the real 48-record/slide/shine sequence times out at iteration 314, a mouse click always wins, A+B holds the exit open, and the shine\'s own bright/dim arithmetic matches the untouched still frame pixel-for-pixel')
process.exitCode = bad ? 1 : 0
