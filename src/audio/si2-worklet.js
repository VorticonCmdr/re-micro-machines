// AudioWorklet processor hosting the Sound Images driver model + the OPL2 core.
//
// Runs on the audio thread so the driver's 70.06 Hz tick is clocked by samples, not by the main
// thread. The OPL2 renders at its native 49716 Hz and is linearly resampled to the context rate.
// Messages from the main thread (see si2Player.js):
//   { type: 'load', image: ArrayBuffer }             DRIVER1.BIN bytes → new Driver/Sequencer/Opl2
//   { type: 'cmd', ah, al }                          a driver command, exactly as MICROU.EXE issues them
//   { type: 'engine', car, bend, instrument?, delay? }  the game's per-step engine update for one car
//                                                    (UpdateEngineSoundsPerFrame 1000:7BEE–7C24, see #engine)
//   { type: 'status' }                               → posts { type: 'status', opl, tune, slots, tick }
import { Driver, Sequencer, HOST_HZ } from '../formats/si2.js'
import { Opl2, OPL_RATE } from './opl2.js'

class Si2Processor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.seq = null
    this.opl = null
    this.wi = 0
    this.tickAcc = 0 // fractional OPL samples until the next host tick
    this.resampleAcc = 0 // fractional position into the OPL stream
    this.last = 0
    this.cur = 0
    this.port.onmessage = (e) => this.#message(e.data)
  }

  #message(m) {
    switch (m.type) {
      case 'load': {
        const drv = new Driver(new Uint8Array(m.image))
        this.seq = new Sequencer(drv)
        this.opl = new Opl2({ strictOpl2: !!m.strictOpl2 }) // M3.10 OPL waveform toggle (si2Player.js)
        this.wi = 0
        this.seq.command(6) // mute-all, as the game does before its first tune
        break
      }
      case 'cmd': if (this.seq) this.seq.command(m.ah, m.al ?? 0); break
      case 'engine': if (this.seq) this.#engine(m); break
      case 'status': if (this.seq) this.port.postMessage({ type: 'status', opl: this.opl.status(), tune: this.seq.currentTune, tick: this.seq.tick, slots: this.seq.slots.map((s) => ({ state: s.state, channel: s.channel, note: s.note, inst: s.instNum, sfx: s.sfxId })) }); break
    }
  }

  /** The game's per-step engine update (Sequencer.engineUpdate, 1000:7BEE–7C24). It runs here because the
   *  AH=0A "still looping?" answer it depends on is the sequencer's synchronous return value. */
  #engine({ car, bend = 0x40, instrument, delay }) { this.seq.engineUpdate(car, { bend, instrument, delay }) }

  #oplSample() {
    // one native-rate sample; run the driver tick when due
    if (this.tickAcc <= 0) {
      this.tickAcc += OPL_RATE / HOST_HZ
      this.seq.hostTick()
      const w = this.seq.writes
      for (; this.wi < w.length; this.wi++) this.opl.write(w[this.wi][1], w[this.wi][2])
      if (w.length > 65536) { w.splice(0, this.wi); this.wi = 0 } // keep the write log bounded
    }
    this.tickAcc -= 1
    return this.opl.sample()
  }

  process(inputs, outputs) {
    const out = outputs[0][0]
    if (!this.seq) { out.fill(0); return true }
    const step = OPL_RATE / sampleRate
    for (let i = 0; i < out.length; i++) {
      this.resampleAcc += step
      while (this.resampleAcc >= 1) { this.last = this.cur; this.cur = this.#oplSample(); this.resampleAcc -= 1 }
      const v = this.last + (this.cur - this.last) * this.resampleAcc
      out[i] = v > 1 ? 1 : v < -1 ? -1 : v
    }
    for (let c = 1; c < outputs[0].length; c++) outputs[0][c].set(out)
    return true
  }
}

registerProcessor('si2', Si2Processor)
