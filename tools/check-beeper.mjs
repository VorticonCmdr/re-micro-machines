// The SPEAKER and NONE sound drivers (GOAL-DOS-PARITY.md P6, docs/sound.md §4b):
//   1. src/formats/beeper.js's DRIVER2.BIN model against two live DOSBox captures of the driver's own
//      memory (segment 2424, bytes 0x60-0xFF, one snapshot per game tick DS:28F7): seeded from one
//      snapshot, the model must reproduce every later one byte for byte -- tune 1 on the title
//      screen, then sfx 1-18 and the two engine voices poked into the live driver;
//   2. the id-16 question: DRIVER2's bank has 15 sfx and 0459 drops a larger id, live and modelled;
//   3. DRIVER0: every command answers 0;
//   4. the game's own [0F64]!=1 branches (src/engine/sound.js): the beeper engine period (7C4E),
//      StopEngineSounds' two branches (7AF8), InitEngineSounds (7A97), the OPL-only sfx 4/5/7
//      (53F7/750A/7571), and the pause's two 7AF8 calls (3759/37A7).
//   5. Si2Player.load's ordering; 6. the asset viewer's DRIVER2 bank listing (pointer words at 0x749).
//   node tools/check-beeper.mjs
import { readFileSync } from 'node:fs'
import { register } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BeeperDriver, NullDriver } from '../src/formats/beeper.js'
import { asDriver, raceStart, stopEngineSounds, updateBeeperEngines, isOplDriver } from '../src/engine/sound.js'
import { createEngineJitter, Driver } from '../src/formats/si2.js'
import { createPauseState, updatePause } from '../src/engine/pause.js'
import { updateCarAirborneLanding } from '../src/engine/airborne.js'
import { parseStrtPos } from '../src/formats/globaldata.js'
import { loadWorld, loadBrk, roundCtx, spawnCars } from '../src/engine/race.js'
import { runStep } from '../src/engine/step.js'
import { droneControlByte } from '../src/engine/ai.js'
import { initCameraState } from '../src/engine/camera.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DRIVER2 = new Uint8Array(readFileSync(join(ROOT, 'game', 'DRIVER2.BIN')))
const ref = (n) => JSON.parse(readFileSync(join(ROOT, 'tools', 'refs', 'si2', n), 'utf8'))

let bad = 0
function check(name, cond) {
  if (!cond) { bad++; console.log(`FAIL: ${name}`) }
}

const slotAt = (k) => 0x9f + k * 0x12

/** Seed from samples[0], then step the model to every later sample's tick and compare 0x73-0xF6
 * (0x7D, the tick's own re-entry guard, is 0 between ticks either way). `explained(live, model)`
 * decides whether a mismatch is an outside write the model cannot know about (a poke). */
function replay(samples, explained = () => false) {
  const d = new BeeperDriver(DRIVER2)
  const put = (b) => { for (let i = 0; i < b.length; i++) d.m[0x60 + i] = b[i] }
  put(Buffer.from(samples[0][1], 'hex'))
  let t = samples[0][0]
  const r = { match: 0, unexplained: [], reseeds: 0, sfxTicks: 0, engineTicks: 0, ids: new Set() }
  for (const [tk, hex] of samples.slice(1)) {
    const live = Buffer.from(hex, 'hex')
    for (let i = 0, n = (tk - t) & 0xffff; i < n; i++) d.hostTick()
    t = tk
    const diffs = []
    for (let a = 0x73; a < 0xf7; a++) if (a !== 0x7d && d.m[a] !== live[a - 0x60]) diffs.push(a)
    if (diffs.length) {
      if (explained(live, d)) r.reseeds++
      else r.unexplained.push(`${tk}: ${diffs.map((a) => `${a.toString(16)} ${d.m[a].toString(16)}/${live[a - 0x60].toString(16)}`).join(', ')}`)
      put(live)
      continue
    }
    r.match++
    for (let k = 0; k < 4; k++) if (d.m[slotAt(k) + 0xa] === 2) { r.sfxTicks++; r.ids.add(d.m[slotAt(k) + 0xe]) }
    if (d.m[0x9a]) r.engineTicks++
  }
  return r
}

// 1a. Tune 1 on the title screen, no outside writes at all.
{
  const { samples } = ref('drv2_title.json')
  const r = replay(samples)
  check(`title (tune 1): every one of ${samples.length - 1} live snapshots reproduced (${r.match} match; first differences: ${r.unexplained.slice(0, 2).join(' | ')})`, r.unexplained.length === 0 && r.match >= 700)
}

// 1b. The pokes: a mismatch is explained only by a poked queue byte still visible, poked engine
// bytes (0x9A-0x9E) the model doesn't have, or a slot the live driver just started from a poke the
// snapshots missed (live state 2 where the model's slot is free).
{
  const { samples, events } = ref('drv2_poke.json')
  const explained = (live, d) =>
    [...Array(16)].some((_, i) => live[0xe7 - 0x60 + i]) ||
    [0x9a, 0x9b, 0x9c, 0x9d, 0x9e].some((a) => live[a - 0x60] !== d.m[a]) ||
    [0, 1, 2, 3].some((k) => live[slotAt(k) + 0xa - 0x60] === 2 && d.m[slotAt(k) + 0xa] === 0)
  const r = replay(samples, explained)
  const pokes = events.length
  check(`pokes: no unexplained difference in ${samples.length - 1} snapshots (${r.unexplained.slice(0, 2).join(' | ')})`, r.unexplained.length === 0)
  check(`pokes: re-seeds only at the pokes (${r.reseeds} for ${pokes} pokes, 3 of them dropped ids)`, r.reseeds <= pokes)
  check(`pokes: the matched stretches cover all 15 sfx (${[...r.ids].sort((a, b) => a - b)}) and engine mode (${r.engineTicks} ticks)`, r.ids.size === 15 && r.engineTicks > 300 && r.sfxTicks > 400)
  const liveIds = new Set()
  for (const [, hex] of samples) { const b = Buffer.from(hex, 'hex'); for (let k = 0; k < 4; k++) if (b[slotAt(k) + 0xa - 0x60]) liveIds.add(b[slotAt(k) + 0xe - 0x60]) }
  check('live: ids 16-18 never reach a slot (0459 drops them)', ![16, 17, 18].some((i) => liveIds.has(i)))
}

// 1c. The sfx starts, strictly: each id was queued with the emulator paused and a snapshot taken
// with it in the queue, so the model's own start routine (bank lookup, slot, first delay) runs on
// every one. A re-seed is allowed only where the live snapshot differs by the queued byte alone.
{
  const { samples, events } = ref('drv2_sfx.json')
  const queueOnly = (live, d) => {
    const diff = []
    for (let a = 0x73; a < 0xf7; a++) if (a !== 0x7d && d.m[a] !== live[a - 0x60]) diff.push(a)
    return diff.every((a) => a >= 0xe7 && a < 0xef)
  }
  const r = replay(samples, queueOnly)
  check(`sfx starts: ${r.match} snapshots match, none unexplained (${r.unexplained.slice(0, 2).join(' | ')})`, r.unexplained.length === 0 && r.match > 1800)
  check(`sfx starts: exactly one re-seed per poke, each only the queued id (${r.reseeds} for ${events.length})`, r.reseeds === events.length)
  check(`sfx starts: the model itself started ids 1-15 (${[...r.ids].sort((a, b) => a - b)})`, r.ids.size === 15)
}

// 2. The id-16 question in the model, from a clean start.
{
  const d = new BeeperDriver(DRIVER2)
  d.command(0, 0, 0); d.command(2, 0, 0x4287)
  check('model: DRIVER2 answers AH=0/AH=2 with AL=0', true)
  d.command(5, 16); d.hostTick()
  const used = [0, 1, 2, 3].filter((k) => d.b(slotAt(k) + 0xa))
  check('model: sfx 16 (the race-over jingle) is dropped: no slot, queue empty', used.length === 0 && d.b(0xe7) === 0)
  check('model: AH=0Ah then says 16 is not playing, so the banners\' keep-alive re-queues it every call', (d.command(0xa, 16) & 0xff) === 16)
  d.command(5, 15); d.hostTick()
  check('model: sfx 15 (the bank\'s last) starts in a slot', [0, 1, 2, 3].some((k) => d.b(slotAt(k) + 0xa) === 2 && d.b(slotAt(k) + 0xe) === 15))
  const d2 = new BeeperDriver(DRIVER2)
  check('model: before AH=0 only AH=0 is accepted ([124]=0)', d2.command(4, 1) === 0xffff)
}

// 3. DRIVER0.
{
  const n = new NullDriver()
  check('DRIVER0: every command answers 0 and nothing sounds', n.command(0xa, 16) === 0 && n.command(9, 1) === 0 && !n.sounding)
  const log = []
  const drv = asDriver({ command: (ah, al) => { log.push([ah, al]); return 0 } }, 'none')
  drv.keepAliveSfx(16)
  check('DRIVER0: the keep-alive idiom never re-queues (AH=0Ah answers 0 = "playing")', log.length === 1 && log[0][0] === 0xa)
}

// 4. The game's own branches.
const logDriver = (kind) => { const log = []; return { log, drv: asDriver({ command: (ah, al, cx) => { log.push([ah, al, cx]); return 0 } }, kind) } }
{
  const { log, drv } = logDriver('speaker')
  raceStart(drv)
  check('7A97 (InitEngineSounds, beeper): AH=0Eh voices 0 and 1 at period 0x32 after the AH=7', JSON.stringify(log) === JSON.stringify([[7, undefined, undefined], [0xe, 0, 0x32], [0xe, 1, 0x32]]))
}
{
  const { log, drv } = logDriver('speaker')
  const cars = [{ speed: 0x300, drawnThisFrame: true }, { speed: -0x900, zVel: 3, drawnThisFrame: true }, { speed: 5 }, { speed: 5 }]
  const jit = createEngineJitter()
  const ref2 = createEngineJitter()
  updateBeeperEngines(drv, cars, jit)
  const r0 = ref2() & 0xf, r1 = ref2() & 0xf
  const p0 = 0x2000 - Math.abs(0x600 + r0 - 8)
  const p1 = 0x2000 - Math.abs(0xffe + 0x7f7 + r1 - 8)
  check(`7C4E: cars 0/1 only, period 0x2000 - |2*min(|speed|,0x7FF) (+0x7F7 airborne) + (rand&15) - 8| (got ${log.map((e) => e.map((x) => x?.toString(16)).join(',')).join(' ')})`,
    log.length === 2 && log[0][0] === 0xe && log[0][1] === 0 && log[0][2] === p0 && log[1][1] === 1 && log[1][2] === p1)
  const { log: l2, drv: d2 } = logDriver('speaker')
  updateBeeperEngines(d2, [{ speed: 0x300, drawnThisFrame: false }, { speed: 0x300, drawnThisFrame: true, subState: 1 }], createEngineJitter())
  const j = createEngineJitter(); const a = j() & 0xf, b = j() & 0xf
  check('7C85/7C7B: not drawn, or [1382] set, -> 0x100 before the jitter', l2[0][2] === 0x2000 - Math.abs(0x100 + a - 8) && l2[1][2] === 0x2000 - Math.abs(0x100 + b - 8))
}
{
  const cars = () => [{ speed: 900 }, { speed: -40 }, { speed: 7 }, { speed: 1 }]
  const c1 = cars()
  stopEngineSounds(c1, undefined)
  check('7AF8, OPL (and no driver): every car\'s speed zeroed, no command', c1.every((c) => c.speed === 0))
  const { log, drv } = logDriver('speaker')
  const c2 = cars()
  stopEngineSounds(c2, drv)
  check('7AF8, beeper: AH=10h for voices 0 and 1, speeds untouched', c2[0].speed === 900 && JSON.stringify(log) === JSON.stringify([[0x10, 0, 0], [0x10, 1, 0]]))
  check('isOplDriver: no driver = OPL, "speaker"/"none" are not', isOplDriver(undefined) && !isOplDriver({ kind: 'speaker' }) && !isOplDriver({ kind: 'none' }))
}
{
  // The pause: 3759 at the entry and 37A7 at stage 1's end.
  const run = (sound) => {
    const cars = [{ speed: 900, posX: 0, posY: 0 }, { speed: 500 }, { speed: 400 }, { speed: 300 }]
    const s = createPauseState()
    updatePause(s, 16, { spaceHeld: true }, cars[0], [], 1, 1, {}, sound, cars)
    const atEntry = cars.map((c) => c.speed)
    cars.forEach((c) => { c.speed = 100 })
    updatePause(s, 2100, { spaceHeld: false }, cars[0], [], 1, 1, {}, sound, cars) // 140 ticks: stage 1 ends
    return { atEntry, atStage: cars.map((c) => c.speed) }
  }
  const opl = run({ kind: 'opl', stopSfx() {}, muteAll() {} })
  check('pause, OPL: 3759 zeroes every car\'s speed at the entry', opl.atEntry.every((v) => v === 0))
  check('pause, OPL: 37A7 zeroes them again when stage 1 ends', opl.atStage.every((v) => v === 0))
  const { log, drv } = logDriver('speaker')
  const spk = run(drv)
  check('pause, beeper: speeds kept, AH=10h instead', spk.atEntry[0] === 900 && log.filter((e) => e[0] === 0x10).length === 4)
}
{
  // The OPL-only sfx: 750A/7571 (landing 4/7) and 53F7 (skid 5).
  const played = []
  const sound = { kind: 'speaker', playSfx: (id) => played.push(id) }
  const car = { active: true, height: 1, zVel: -5, drawnThisFrame: true, state: 0 }
  updateCarAirborneLanding(car, { round: 1, sound })
  const oplPlayed = []
  const car2 = { active: true, height: 1, zVel: -5, drawnThisFrame: true, state: 0 }
  updateCarAirborneLanding(car2, { round: 1, sound: { kind: 'opl', playSfx: (id) => oplPlayed.push(id) } })
  check(`750A: a landing plays sfx 4 under OPL (${oplPlayed}) and nothing under the beeper (${played})`, oplPlayed.includes(4) && played.length === 0)
}

{
  // A whole AI-driven ROUND11 race, once per driver kind: sfx 4/5/7 (53F7, 750A, 7571) only under
  // OPL, and nothing else about the sfx changes.
  const readGame = async (n) => new Uint8Array(readFileSync(join(ROOT, 'game', n)))
  const strt = parseStrtPos(await readGame('GAME1/STRT_POS.BIN'))
  const world = await loadWorld(readGame, 1, 1)
  const brk = await loadBrk(readGame, 1, 1)
  const race = (kind) => {
    const count = {}
    const sound = { kind, playSfx: (id) => { count[id] = (count[id] ?? 0) + 1 }, command() { return 0 }, engine() {}, keepAliveSfx() {}, stopSfx() {} }
    const cars = spawnCars(strt, 1, 1)
    const ctx = { ...roundCtx(1, 1), brk, tournamentIndex: 0, world, sound, camera: initCameraState(strt.find((s) => s.round === 1 && s.race === 1)) }
    const rs = {}
    for (let i = 0; i < 3000 && !rs.raceOver; i++) runStep(world, cars, cars.map((c) => (c.active ? droneControlByte(c, ctx) : 0)), rs, ctx)
    return count
  }
  const opl = race('opl'), spk = race('speaker')
  const others = (c) => JSON.stringify(Object.entries(c).filter(([id]) => ![4, 5, 7].includes(+id)))
  check(`ROUND11: sfx 4/5 fire under OPL (${opl[4]}/${opl[5]}), never under the beeper (${spk[4] ?? 0}/${spk[5] ?? 0}/${spk[7] ?? 0})`, opl[4] > 0 && opl[5] > 0 && !spk[4] && !spk[5] && !spk[7])
  check(`ROUND11: every other sfx is the same under both (${others(opl)} vs ${others(spk)})`, others(opl) === others(spk))
}

{
  // Si2Player.load(): the driver must reach the worklet before the commands sent right after it
  // (optionsConfirm loads, then enterTitle's titleMusic plays tune 1). The worklet chunk's Vite
  // `?worker&url` import is stubbed so the module loads in Node.
  register('data:text/javascript,' + encodeURIComponent("export async function resolve(s,c,n){return s.endsWith('?worker&url')?{url:'data:text/javascript,export default %22%22',shortCircuit:true}:n(s,c)}"))
  const { Si2Player } = await import('../src/audio/si2Player.js')
  const p = new Si2Player()
  const posted = []
  p.node = { port: { postMessage: (m) => posted.push(m.type === 'cmd' ? `cmd${m.ah}` : m.type) } }
  p.ready = Promise.resolve()
  p.load(DRIVER2.buffer, { kind: 'speaker' })
  const kindNow = p.kind
  p.playTune(1)
  check(`Si2Player.load posts the driver before the next command, synchronously (${posted.join(',')}; kind ${kindNow})`, posted.join(',') === 'load,cmd4' && kindNow === 'speaker')
}

{ // 6. the asset viewer's bank listing (si2.js Driver with DRIVER2's pointer words at 0x749): the same
  // tune/sfx counts and starts the beeper's own 0398/0446 read. Driver's default (DRIVER1's 0x13F0)
  // listed 0 tunes for DRIVER2.
  const drv = new Driver(DRIVER2, { bankPointers: 0x749 })
  const w = (a) => DRIVER2[a] | (DRIVER2[a + 1] << 8)
  const sb = w(0x74b)
  const sfxOk = drv.sfxList().every((s) => s.start === ((w(sb + 1 + 2 * (s.index - 1)) + sb) & 0xffff))
  check(`the viewer lists DRIVER2's banks (${drv.tunes().length} tunes, ${drv.sfxList().length} sfx; default pointers give ${new Driver(DRIVER2).tunes().length})`,
    drv.tunes().length === 8 && drv.sfxList().length === 15 && sfxOk && drv.musicBank === w(0x749) && drv.tunes().every((t) => t.tracks.length >= 1))
}

console.log(bad ? `${bad} check(s) failed` : 'check-beeper: the DRIVER2 model reproduces the live driver\'s memory tick for tick (tune 1, sfx 1-15, engine mode), drops sfx 16-18 as the live driver does, DRIVER0 answers 0, and the game\'s [0F64]!=1 branches (beeper engines, StopEngineSounds, the OPL-only sfx, the pause) follow 7A97/7AF8/7C4E/53F7/750A')
process.exit(bad ? 1 : 0)
