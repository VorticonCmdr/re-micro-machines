// DRIVER1.BIN view: the embedded music/sfx/instrument banks with a player (AudioWorklet + OPL2 core),
// per-tune track listings, instrument register dumps, and a live channel readout.
// DRIVER2.BIN: the same banks played through the ported PC-speaker driver (BeeperDriver, a band-limited
// square wave, docs/sound.md §4), with its two engine voices; DRIVER0.BIN is the null stub.

import { Driver, decodeTrack, trackStats, HOST_HZ } from '../../formats/si2.js'
import { el, fmtBytes } from '../dom.js'
import { probeView } from './probeView.js'

/** Where each tune plays, from the live command trace + call-site survey (docs/sound.md). */
const TUNE_USE = { 1: 'title / main menu', 2: 'sub-menus (select game, character, vehicle…)', 3: 'champion screen', 4: 'next-race intro', 5: 'last-race intro', 6: 'eliminated / lost', 7: '(present, never requested)', 8: 'won / qualified' }
// Per-site AH=5 disassembly, docs/sound.md §3b (mm-sfx-predicates fan-out: all 36 call sites individually
// traced). Ids 1 and 3 were swapped in the first-pass guess — 1 is the rarer WARRIORS-only hard hit, 3 is
// the routine collision; ids 4/7/18 turned out to be two-unrelated-triggers-sharing-one-slot, not one event.
const SFX_USE = { 1: 'hard hit (WARRIORS collision / checkpoint re-line-up / ramp launch / projectile hit)', 2: 'wrong way', 3: 'collision (routine)', 4: 'landing thud / POWERBOATS tile lookahead (2 unrelated uses)', 5: 'skid', 6: 'rough surface', 7: 'POWERBOATS splash / state-1 script cue (2 unrelated uses)', 8: 'crash animation', 9: 'drop-in / respawn', 10: 're-line-up', 11: 'unused (dead asset)', 12: 'unused (dead asset)', 13: 'unused (dead asset)', 14: 'tank shot', 15: 'RUFFTRUX banner', 16: 'banner / race over / H2H decided', 17: 'class-specific (TURBO WHEELS / RUFFTRUX / POWERBOATS)', 18: 'low-grip terrain (not class-gated)' }

let player = null // one AudioContext for the page
let loaded = null // which driver file the player holds (`kind` + name), so switching views reloads it

export async function soundView(container, ctx) {
  const { bytes, entry, zoom } = ctx
  const name = entry.name.toUpperCase()
  if (name === 'DRIVER0.BIN') {
    container.append(el('p', {}, 'The null driver: both entries are ', el('code', {}, 'MOV AX,0; RETF'), ' — every command returns 0 and no hardware is touched. Chosen when SETTINGS.DAT says SOUND = NONE.'))
    return probeView(container, ctx)
  }
  let drv
  // DRIVER2.BIN keeps its bank-offset words at 0x749 (docs/sound.md §4b), not where DRIVER1.BIN does.
  try { drv = new Driver(bytes, name === 'DRIVER2.BIN' ? { bankPointers: 0x749 } : {}) } catch (err) { container.append(el('p', { class: 'error' }, `bank parse: ${err.message}`)); return probeView(container, ctx) }
  const tunes = drv.tunes(), sfx = drv.sfxList()
  const isOpl = name === 'DRIVER1.BIN'
  const isSpeaker = name === 'DRIVER2.BIN'
  const kind = isSpeaker ? 'speaker' : 'opl'

  container.append(el('p', { class: 'muted' },
    `Sound Images Generation 2 driver. Banks: music @0x${drv.musicBank.toString(16)} (${tunes.length} tunes), sfx @0x${drv.sfxBank.toString(16)} (${sfx.length}), instruments @0x${drv.instBank.toString(16)}${name === 'DRIVER1.BIN' ? ` (${drv.instrumentCount()} × 16 B)` : ''}. ` +
    `Sequence streams are MIDI-style VLQ byte-code; music runs at division×tempo/60 = ${(tunes[0]?.division * tunes[0]?.tempo) / 60} ticks/s, quantised to the game's ${HOST_HZ.toFixed(2)} Hz timer tick. ` +
    (isOpl ? 'The JS model reproduces the real driver\'s OPL register stream write-for-write (npm run si2).' : 'PC-speaker arrangement of the same tunes: one square wave, chords arpeggiated one note per 70 Hz tick; sfx 16–18 are past its 15-entry bank and dropped. The JS driver reproduces two live captures of its memory tick for tick (npm run beeper).')))

  // ---- player ----
  const readout = el('div', { class: 'readout mono' }, 'not started')
  const chanBox = el('div', { class: 'opl-channels' })
  const strict = el('input', { type: 'checkbox' })
  let timer = null
  const ensurePlayer = async () => {
    // Loaded on first use: the player module carries Vite's `?worker&url` import, which only a bundler
    // resolves (the headless smoke test imports this view under plain Node).
    if (!player) { const { Si2Player } = await import('../../audio/si2Player.js'); player = new Si2Player() }
    const want = `${kind}:${name}:${strict.checked}`
    if (!loaded) await player.start(bytes, { kind, strictOpl2: strict.checked })
    else if (loaded !== want) await player.load(bytes, { kind, strictOpl2: strict.checked })
    loaded = want
    await player.resume()
    if (!timer) timer = setInterval(async () => {
      if (!container.isConnected) { clearInterval(timer); timer = null; return } // the view was left
      const st = await player.status()
      if (st.kind === 'speaker') { readout.textContent = `tick ${st.tick}  speaker ${st.frequency ? st.frequency.toFixed(1) + ' Hz' : 'off'}`; return }
      if (!st.slots) return
      readout.textContent = `tick ${st.tick}  tune ${st.tune || '-'}  slots: ` + st.slots.filter((s) => s.state).map((s) => `${s.state === 1 ? 'M' : 'S'}${s.sfx ? s.sfx.toString(16) : ''}→ch${s.channel}`).join(' ')
      chanBox.replaceChildren(...st.opl.map((c) => el('div', { class: `opl-ch${c.key ? ' on' : ''}` }, `ch${c.ch} ${c.key ? c.hz.toFixed(1) + ' Hz' : '—'}`, el('div', { class: 'env', style: { width: `${Math.round(100 - (Math.min(...c.env) / 511) * 100)}%` } }))))
    }, 100)
  }
  strict.addEventListener('change', async () => { if (loaded) { await ensurePlayer() } })
  if (isOpl) {
    const tuneButtons = tunes.map((t) => el('button', { type: 'button', onclick: async () => { await ensurePlayer(); player.muteAll(); player.playTune(t.index) } }, `▶ tune ${t.index}`, el('small', {}, ` ${TUNE_USE[t.index] || ''}`)))
    const sfxButtons = sfx.map((s) => el('button', { type: 'button', onclick: async () => { await ensurePlayer(); player.playSfx(s.index) } }, `sfx ${s.index}`, el('small', {}, SFX_USE[s.index] ? ` ${SFX_USE[s.index]}` : '')))
    const engine = el('input', { type: 'range', min: 0, max: 127, value: 0x40, oninput: async (e) => { await ensurePlayer(); player.engine(0, { instrument: 0x70, bend: Number(e.target.value), delay: 0 }) } })
    container.append(
      el('h3', {}, 'Play'),
      el('div', { class: 'toolbar wrap' }, ...tuneButtons, el('button', { type: 'button', onclick: async () => { await ensurePlayer(); player.stopMusic() } }, '■ stop music'), el('button', { type: 'button', onclick: async () => { await ensurePlayer(); player.muteAll() } }, '■ mute all')),
      el('div', { class: 'toolbar wrap' }, ...sfxButtons),
      el('div', { class: 'toolbar' }, el('label', {}, 'engine sound car 0 (pitch byte the game writes from speed/10) ', engine), el('button', { type: 'button', onclick: () => player?.engineOff(0) }, 'engine off')),
      el('div', { class: 'toolbar' }, el('label', {}, strict, ' strict YM3812 (sine waves only; the default plays the instruments\' waveforms, as DOSBox\'s OPL3 core does)')),
      readout, chanBox,
    )
  }
  if (isSpeaker) {
    // The beeper plays one voice at a time: a tune, an sfx, or an engine voice (AH=0Eh on / 10h off,
    // CX = the PIT period; 7C4E sends 0x2000 - 2*min(|speed|,0x7FF) per step, docs/engine.md §9cq).
    const tuneButtons = tunes.map((t) => el('button', { type: 'button', onclick: async () => { await ensurePlayer(); player.muteAll(); player.playTune(t.index) } }, `▶ tune ${t.index}`, el('small', {}, ` ${TUNE_USE[t.index] || ''}`)))
    const sfxButtons = sfx.map((s) => el('button', { type: 'button', onclick: async () => { await ensurePlayer(); player.playSfx(s.index) } }, `sfx ${s.index}`, el('small', {}, SFX_USE[s.index] ? ` ${SFX_USE[s.index]}` : '')))
    const speed = el('input', { type: 'range', min: 0, max: 0x7ff, value: 0x200, oninput: async (e) => { await ensurePlayer(); player.command(0x0e, 0, (0x2000 - 2 * Number(e.target.value)) & 0xffff) } })
    container.append(
      el('h3', {}, 'Play (PC speaker)'),
      el('div', { class: 'toolbar wrap' }, ...tuneButtons, el('button', { type: 'button', onclick: async () => { await ensurePlayer(); player.stopMusic() } }, '■ stop music'), el('button', { type: 'button', onclick: async () => { await ensurePlayer(); player.muteAll(); player.command(0x10, 0); player.command(0x10, 1) } }, '■ mute all')),
      el('div', { class: 'toolbar wrap' }, ...sfxButtons),
      el('div', { class: 'toolbar' }, el('label', {}, 'engine voice 0 (car speed 0–2047 → PIT period 0x2000−2·speed) ', speed), el('button', { type: 'button', onclick: () => player?.command(0x10, 0) }, 'engine off')),
      readout,
    )
  }

  // ---- tunes ----
  const tuneList = el('div', {})
  for (const t of tunes) {
    const rate = (t.division * t.tempo) / 60
    const stats = t.tracks.map((tp) => trackStats(drv, tp))
    const looping = stats.some((st) => st.loops)
    const det = el('details', {}, el('summary', {}, `tune ${t.index} — ${TUNE_USE[t.index] || ''} — ${t.tracks.length} tracks, ${looping ? `loops every ${(Math.max(...stats.map((st) => st.loopTicks)) / rate).toFixed(1)} s` : `ONE-SHOT: plays once (${(Math.max(...stats.map((st) => st.totalTicks)) / rate).toFixed(1)} s) then holds a silent loop`}, division ${t.division}, tempo ${t.tempo} (${rate} ticks/s), header @0x${t.header.toString(16)}`))
    for (const [k, tp] of t.tracks.entries()) {
      const evs = decodeTrack(drv, tp), st = stats[k]
      const chan = evs.find((e) => e.kind.startsWith('CHANNEL'))
      const insts = [...new Set(evs.filter((e) => e.op === 0x92).map((e) => e.args[0]))]
      det.append(el('div', { class: 'mono small' }, `  track ${k} @0x${tp.toString(16)}  ${chan ? chan.kind : ''}  instruments ${insts.join(',')}  ${st.notes} notes (${st.notesInLoop} inside the loop)  ${st.events} events  ${(st.totalTicks / rate).toFixed(1)} s  ends with ${st.endsWith}`))
    }
    tuneList.append(det)
  }
  container.append(el('h3', {}, `Tunes (${tunes.length})`), tuneList)

  // ---- sfx ----
  const sfxList = el('pre', { class: 'mono small' })
  sfxList.textContent = sfx.map((s) => {
    const evs = decodeTrack(drv, s.start)
    const notes = evs.filter((e) => e.kind === 'NOTE_ON').map((e) => e.op)
    const insts = [...new Set(evs.filter((e) => e.op === 0x92).map((e) => e.args[0]))]
    const total = evs.reduce((a, e) => a + e.delay, 0)
    return `sfx ${String(s.index).padStart(2)} @0x${s.start.toString(16).padStart(4, '0')}  inst ${insts.join(',').padEnd(7)} notes ${notes.join(' ').padEnd(24)} ${(total / 96).toFixed(2)} s  ${SFX_USE[s.index] || ''}`
  }).join('\n')
  container.append(el('h3', {}, `Sfx (${sfx.length}, 96 ticks/s)`), sfxList)
  if (isOpl) {
    const eng = drv.engineRecords().map((r) => `sfx 0x${r.index.toString(16)} @0x${r.start.toString(16)}: ${Array.from(drv.d.subarray(r.start, r.start + 16), (b) => b.toString(16).padStart(2, '0')).join(' ')}`).join('\n')
    container.append(el('p', { class: 'muted' }, 'Engine sound records (sfx 0x40–0x43, one per car): INSTRUMENT ii · SET_LOOP · NOTE 35 vel 127 · PITCH_BEND bb · delay dd · JUMP_LOOP. MICROU.EXE patches ii/bb/dd and the loop byte live (1000:7A97, 7B46).'), el('pre', { class: 'mono small' }, eng))
  }

  // ---- instruments ----
  if (isOpl) {
    const used = new Set()
    for (const t of tunes) for (const tp of t.tracks) for (const e of decodeTrack(drv, tp)) if (e.op === 0x92) used.add(e.args[0])
    for (const s of [...sfx, ...drv.engineRecords()]) for (const e of decodeTrack(drv, s.start)) if (e.op === 0x92) used.add(e.args[0])
    const rows = []
    for (let n = 0; n < drv.instrumentCount(); n++) {
      const i = drv.instrument(n)
      if (!used.has(n) && !i.some((b) => b)) continue
      const [car, mod] = drv.volumeRegs(i, 0x7f, 0x7f)
      rows.push(`${String(n).padStart(3)} ${used.has(n) ? '*' : ' '} op1: 20=${h(i[4])} 40=${h(mod)} 60=${h(i[0])} 80=${h(i[2])} E0=${h(i[6])} | op2: 20=${h(i[5])} 40=${h(car)} 60=${h(i[1])} 80=${h(i[3])} E0=${h(i[7])} | C0=${h(i[9])} transpose=${((i[8] - 24 + 128) & 0xff) - 128} bend=${i[0xf]}`)
    }
    container.append(el('h3', {}, `Instruments (${rows.length} non-empty of 128; * = used) — 16-byte records → OPL operator registers`), el('pre', { class: 'mono small' }, rows.join('\n')))
  }
  container.append(el('h3', {}, 'Raw'))
  probeView(container, ctx)
}
const h = (v) => v.toString(16).padStart(2, '0').toUpperCase()
