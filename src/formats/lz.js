// The game's LZ codec — DecompressWorkBuffer, MICROU.EXE 1000:3333..3531 (Ghidra program
// MICROU.EXE). Used for COMPRESS.PI0–6, ROUNDnBR.PR0/1/2, ROUNDnBR.VH0 and BITSFILE.PH0,
// always on a whole file (LoadCompressedSeries 1000:3547 reads the file to 7d78:C000 and
// unpacks to 7d78:0000; BX returns the unpacked length).
//
// Transcribed from the disassembly (the research workflow's Python port reproduced the exact
// slab sizes for all 41 compressed files and a correct FCHAPPY.CHR render; this is a line-for-
// line port of that). Stream grammar:
//   control byte: 8 flag bits, MSB first. 0 → copy one literal byte. 1 → an opcode follows.
//   opcode v:
//     80..FE  short copy: len = ((v>>5)&3)+2, dist = (v&0x1F)+len              (33cf..33f7)
//     FF      end of stream
//     70..7E  incrementing run: len = v-0x70+2 (7F: next byte +2, 0 → 256), each byte = prev+1
//     60..6F  reversed copy: len = v-0x60+3 bytes read backwards from out[len(out)-b-1]
//     50..5E  long copy: dist = ((v-0x50)<<8)|b1 (5F: hi byte from stream), len = b2+4,
//             source = len(out)-dist-1
//     20..4F  medium copy: len = ((v-0x20)&0xF)+3, dist = (((v-0x20)&0x30)>>4)<<8 | b,
//             source = len(out)-dist-2
//     10..1E  RLE of the previous byte: len = v-0x10+2 (1F: b+0x11)
//     00..0E  literal run: len = v+8 (0F: b+0x1E, or b==FF → 16-bit length); after a literal
//             run another OPCODE follows immediately (no flag bit is consumed)
// Copies may overlap their own output (standard LZ semantics, byte by byte).

/**
 * @param {Uint8Array|ArrayBuffer} packed
 * @param {{maxOut?: number}} [opts]  safety cap (the game's work buffer is 64 KB)
 * @returns {Uint8Array} the unpacked bytes
 */
export function decompress(packed, { maxOut = 0x20000 } = {}) {
  const src = packed instanceof Uint8Array ? packed : new Uint8Array(packed)
  let out = new Uint8Array(0x10000)
  let n = 0
  let si = 0
  const ensure = (extra) => {
    if (n + extra <= out.length) return
    if (n + extra > maxOut) throw new Error(`lz: output exceeds ${maxOut} bytes`)
    const bigger = new Uint8Array(Math.min(maxOut, Math.max(out.length * 2, n + extra)))
    bigger.set(out.subarray(0, n))
    out = bigger
  }
  const copyBack = (dist, len) => {
    ensure(len)
    let s = n - dist
    if (s < 0) throw new Error(`lz: back-reference before start (dist ${dist} at ${n})`)
    for (let k = 0; k < len; k++) out[n++] = out[s++]
  }
  const need = (k) => { if (si + k > src.length) throw new Error(`lz: truncated input at ${si}`) }

  // Returns 'end', 'again' (literal run: read another opcode) or 'bits' (back to flag bits).
  const opcode = () => {
    need(1)
    const v = src[si]
    if (v >= 0x80) {
      if (v === 0xff) return 'end'
      const len = ((v >> 5) & 3) + 2
      si++
      copyBack((v & 0x1f) + len, len)
      return 'bits'
    }
    si++
    if (v >= 0x70) {
      let a = v - 0x70
      let cnt
      if (a === 0xf) { need(1); a = src[si++]; cnt = (a + 2) & 0xff } else cnt = a + 2
      if (cnt === 0) cnt = 256
      ensure(cnt)
      let prev = n ? out[n - 1] : 0
      for (let k = 0; k < cnt; k++) { prev = (prev + 1) & 0xff; out[n++] = prev }
      return 'bits'
    }
    if (v >= 0x60) {
      const cnt = v - 0x60 + 3
      need(1)
      const off = src[si++]
      ensure(cnt)
      const base = n - off - 1
      if (base - (cnt - 1) < 0) throw new Error(`lz: reversed copy before start at ${n}`)
      for (let k = 0; k < cnt; k++) out[n++] = out[base - k]
      return 'bits'
    }
    if (v >= 0x50) {
      let hi = v - 0x50
      if (hi === 0xf) { need(1); hi = src[si++] }
      need(2)
      const lo = src[si], cnt = src[si + 1]
      si += 2
      copyBack(((hi << 8) | lo) + 1, cnt + 4)
      return 'bits'
    }
    if (v >= 0x20) {
      const a = v - 0x20
      need(1)
      const b = src[si++]
      copyBack((((a & 0x30) >> 4) << 8 | b) + 2, (a & 0xf) + 3)
      return 'bits'
    }
    if (v >= 0x10) {
      const a = v - 0x10
      let cnt
      if (a === 0xf) { need(1); cnt = src[si++] + 0x11 } else cnt = a + 2
      ensure(cnt)
      const prev = n ? out[n - 1] : 0
      for (let k = 0; k < cnt; k++) out[n++] = prev
      return 'bits'
    }
    let cnt
    if (v !== 0x0f) cnt = v + 8
    else {
      need(1)
      const b = src[si++]
      if (b === 0xff) { need(2); cnt = src[si] | (src[si + 1] << 8); si += 2 } else cnt = b + 0x1e
    }
    need(cnt)
    ensure(cnt)
    out.set(src.subarray(si, si + cnt), n)
    n += cnt
    si += cnt
    return 'again'
  }

  for (;;) {
    need(1)
    const c = src[si++]
    for (let bit = 7; bit >= 0; bit--) {
      if (((c >> bit) & 1) === 0) {
        need(1)
        ensure(1)
        out[n++] = src[si++]
      } else {
        let r = opcode()
        while (r === 'again') r = opcode()
        if (r === 'end') return out.subarray(0, n)
      }
    }
  }
}
