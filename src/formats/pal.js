// VGA palette files: INTRO.PAL and GAME1/ROUNDn.PAL, all exactly 768 bytes.
//
// 768 = 256 entries × 3 bytes (R, G, B) in DAC order, 6-bit values. PROVEN: LoadPalFileToDac
// (MICROU.EXE 1000:07a0) reads 0x300 bytes and uploads them with INT 10h AX=1012h, and the
// live DAC read back through port 3C9h during a race was byte-identical to ROUND2.PAL.
//
// 6-bit → 8-bit uses round(v·255/63): decoding the captured A000 frame buffer with that
// formula reproduced the DOSBox bridge's rendered frame with 0 mismatching pixels, whereas
// bit replication ((v<<2)|(v>>4)) left 67 and a plain v<<2 tens of thousands. Keep this
// formula so pixel diffs against DOSBox captures stay exact (docs/boot-and-runtime.md).
// Pure and DOM-free so Node tools can import it.

export const PAL_ENTRIES = 256

/** 6-bit DAC value → 8-bit, the way the DOSBox renderer does it (round(v·255/63)). */
export const dac6ToRgb8 = (v) => (((v & 0x3f) * 255 + 31) / 63) | 0

/**
 * @param {Uint8Array|ArrayBuffer} data  the raw .PAL bytes
 * @param {{bits?: 6|8}} [opts]
 * @returns {{rgb: Uint8Array, bits: number, maxRaw: number}}  rgb is 256×3, 8-bit per channel
 */
export function decodePalette(data, { bits = 6 } = {}) {
  const src = data instanceof Uint8Array ? data : new Uint8Array(data)
  if (src.length !== PAL_ENTRIES * 3) throw new Error(`palette: expected 768 bytes, got ${src.length}`)
  const rgb = new Uint8Array(PAL_ENTRIES * 3)
  let maxRaw = 0
  for (let i = 0; i < src.length; i++) {
    const v = src[i]
    if (v > maxRaw) maxRaw = v
    rgb[i] = bits === 6 ? dac6ToRgb8(v) : v
  }
  return { rgb, bits, maxRaw }
}

/** A neutral fallback when no .PAL is chosen: index = brightness. */
export function grayPalette() {
  const rgb = new Uint8Array(PAL_ENTRIES * 3)
  for (let i = 0; i < PAL_ENTRIES; i++) rgb[i * 3] = rgb[i * 3 + 1] = rgb[i * 3 + 2] = i
  return { rgb, bits: 8, maxRaw: 255 }
}

/** CSS colour for one entry. */
export function cssColor(rgb, index) {
  const o = index * 3
  return `rgb(${rgb[o]}, ${rgb[o + 1]}, ${rgb[o + 2]})`
}
