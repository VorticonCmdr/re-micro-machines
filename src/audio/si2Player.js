// Main-thread side of the sound system: loads DRIVER1.BIN into the worklet and exposes the driver's
// command API the way the game uses it (docs/sound.md, command table).
//
// The worklet module is bundled by Vite as a separate worker-style chunk (`?worker&url`), so its
// imports of src/formats/si2.js and src/audio/opl2.js resolve both in dev and in the build.
import workletUrl from './si2-worklet.js?worker&url'

export class Si2Player {
  constructor() {
    this.kind = 'opl' // [0F64]: 'opl' (1, DRIVER1), 'speaker' (2, DRIVER2), 'none' (0, DRIVER0) -- sound.js isOplDriver
    this.ctx = null
    this.node = null
    this.ready = null
    this._statusWaiters = []
  }

  /**
   * @param {ArrayBuffer} driverImage  the bytes of DRIVER1.BIN
   * @param {{strictOpl2?: boolean}} opts  `strictOpl2: true` reproduces a real YM3812 (reg 01
   *   never set by the game -> every voice forced to a sine, per opl2.js's own header comment);
   *   the default (false) matches what the game actually sounded like under the DOSBox build the
   *   live captures came from (Nuked OPL3 core, honours the 19 instruments' non-zero E0 waveform
   *   bytes regardless of reg 01) -- M3.10's "OPL waveform toggle".
   */
  async start(driverImage, { strictOpl2 = false, kind = 'opl' } = {}) {
    if (this.ready) return this.ready
    this.kind = kind
    this.ready = (async () => {
      this.ctx = new AudioContext()
      await this.ctx.audioWorklet.addModule(workletUrl)
      this.node = new AudioWorkletNode(this.ctx, 'si2', { outputChannelCount: [2] })
      this.node.port.onmessage = (e) => { if (e.data.type === 'status') for (const w of this._statusWaiters.splice(0)) w(e.data) }
      this.node.connect(this.ctx.destination)
      this.node.port.postMessage({ type: 'load', image: driverImage.slice(0), strictOpl2, kind })
    })()
    return this.ready
  }

  /** LoadSoundDriverBinModule 321C: a fresh copy of a driver file into the slot. `kind` 'opl'
   * (DRIVER1.BIN), 'speaker' (DRIVER2.BIN) or 'none' (DRIVER0.BIN). */
  load(driverImage, { strictOpl2 = false, kind = 'opl' } = {}) {
    // Posted synchronously once the node exists: the commands the caller sends right after (the
    // title's tune) must reach the worklet after the new driver, not before it.
    const post = () => { this.kind = kind; this.node?.port.postMessage({ type: 'load', image: driverImage.slice(0), strictOpl2, kind }) }
    if (this.node) { post(); return Promise.resolve() }
    return (this.ready ?? Promise.resolve()).then(post)
  }

  async resume() { if (this.ctx && this.ctx.state !== 'running') await this.ctx.resume() }

  /** Raw driver command (AH, AL) — the same numbers MICROU.EXE uses. */
  command(ah, al = 0, cx = 0) { this.node?.port.postMessage({ type: 'cmd', ah, al, cx }) }

  // Convenience wrappers named after the driver handlers (docs/sound.md).
  playTune(n) { this.command(4, n) } // CmdPlayTune — starts at the next tick unless already current
  playSfx(id) { this.command(5, id) } // CmdPlaySfx — 1..18, or 0x40+car for the engine loops
  stopSfx(id) { this.command(8, id) }
  stopMusic() { this.command(7) }
  muteAll() { this.command(6) } // CmdRequestReset: silence list + free every slot
  /** The banners' keep-alive idiom (`8684-8695`, `86A9-86BA`, `85EC-85FD`): `AH=0Ah` "is sfx `id`
   * active?", then `AH=5` only if it isn't -- asked in the worklet, where the answer is synchronous. */
  keepAliveSfx(id) { this.node?.port.postMessage({ type: 'keepalive', id }) }
  /**
   * Engine sound for car 0..3, as the game's per-step update does it (1000:7B46): the pitch byte (speed/10,
   * +0x30 airborne, 0x0A idle) goes into the driver's record and sfx 0x40+car is queued only if AH=0A says it
   * is not looping already; the worklet holds that logic. `instrument` 0x70/0x71 and `delay` are the
   * per-class bytes the game writes once at race start (1000:7A97); pass them on the first call.
   */
  engine(car, { bend = 0x40, instrument, delay } = {}) {
    this.node?.port.postMessage({ type: 'engine', car, bend, instrument, delay })
  }
  /** The game never sends AH=8 for an engine: it writes pitch 0 + END into the record and the loop ends on its own. */
  engineOff(car) { this.engine(car, { bend: 0 }) }

  status() {
    return new Promise((resolve) => { this._statusWaiters.push(resolve); this.node?.port.postMessage({ type: 'status' }) })
  }
}
