// Small byte-level helpers shared by decoders and the probe view. Pure, DOM-free.

export const u8 = (b, o) => b[o]
export const u16le = (b, o) => b[o] | (b[o + 1] << 8)
export const i16le = (b, o) => (u16le(b, o) << 16) >> 16
export const u32le = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0

export const toU8 = (data) => (data instanceof Uint8Array ? data : new Uint8Array(data))

export const hex = (n, width = 2) => n.toString(16).toUpperCase().padStart(width, '0')

/** Byte value histogram (256 bins). */
export function histogram(bytes) {
  const h = new Uint32Array(256)
  for (let i = 0; i < bytes.length; i++) h[bytes[i]]++
  return h
}

/** Shannon entropy in bits per byte, 0..8. */
export function entropy(bytes) {
  if (!bytes.length) return 0
  const h = histogram(bytes)
  let e = 0
  for (let i = 0; i < 256; i++) {
    if (!h[i]) continue
    const p = h[i] / bytes.length
    e -= p * Math.log2(p)
  }
  return e
}

/** Entropy per fixed-size window — compressed vs. tabular regions show up as a profile. */
export function entropyProfile(bytes, window = 256) {
  const out = []
  for (let o = 0; o < bytes.length; o += window) out.push(entropy(bytes.subarray(o, Math.min(bytes.length, o + window))))
  return out
}

/** Printable-ASCII runs of at least `min` chars, with offsets. */
export function strings(bytes, min = 5) {
  const out = []
  let start = -1
  for (let i = 0; i <= bytes.length; i++) {
    const c = i < bytes.length ? bytes[i] : 0
    const printable = c >= 0x20 && c < 0x7f
    if (printable && start < 0) start = i
    if (!printable && start >= 0) {
      if (i - start >= min) out.push({ offset: start, text: String.fromCharCode(...bytes.subarray(start, i)) })
      start = -1
    }
  }
  return out
}

/** Classic hex dump lines: offset, 16 hex bytes, ASCII gutter. */
export function hexDump(bytes, offset = 0, length = bytes.length - offset, base = 0) {
  const lines = []
  const end = Math.min(bytes.length, offset + length)
  for (let o = offset; o < end; o += 16) {
    const row = bytes.subarray(o, Math.min(end, o + 16))
    const hx = Array.from(row, (b) => hex(b)).join(' ').padEnd(47)
    const asc = Array.from(row, (b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.')).join('')
    lines.push(`${hex(base + o, 6)}  ${hx}  ${asc}`)
  }
  return lines
}
