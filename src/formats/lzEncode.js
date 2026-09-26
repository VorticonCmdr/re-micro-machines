// An encoder for the game's LZ codec (src/formats/lz.js, DecompressWorkBuffer 1000:3333), for the
// level editor's tile banks (ROUNDnBR.PR0/1/2).
//
// It is not the original compressor: that one's choices are not known, so a re-encoded slab is
// not byte-identical to a shipped file. What is guaranteed is that the game's own decompressor
// (the port in lz.js, byte-identical to it on all 41 shipped files) gives back exactly the
// input. The editor passes an unedited slab's original packed bytes through untouched and only
// re-encodes a slab whose unpacked bytes changed.
//
// Only opcode forms that occur in the 41 shipped files are emitted (a histogram of all of them:
// flag-0 literals, short 80-FE, medium 20-4F, long 50-5E and 5F, RLE 10-1E and 1F, reversed copy
// 60-6F, and the FF end marker), so every form the encoder relies on is one the real
// decompressor is proven to decode. Not emitted: incrementing runs, literal runs.
//
// The parse is optimal for the cost model (bits: a flag bit per item plus its bytes), found by a
// backward dynamic programme over every candidate at each position:
//   literal       1+8   one byte
//   short copy    1+8   len 2-5,  distance len..len+31 (not len 5 at 36: that byte is FF)
//   medium copy   1+16  len 3-18, distance 2..0x301 (may overlap its own output)
//   long copy     1+24  len 4-259, distance 1..0xF00 (hi byte in the opcode, 50-5E)
//                 1+32  len 4-259, distance up to 0x10000 (5F: hi byte from the stream)
//   RLE           1+8   len 2-16 of the previous byte; 1+16 for len 17-272 (1F)
//   reversed copy 1+16  len 3-18, read backwards from out[n-off-1], off 0-255

export const LZ_END = 0xff

const SHORT_MAX_LEN = 5
const MED_MIN = 3, MED_MAX = 18, MED_MAX_DIST = 0x2ff + 2 // 20-4F: the hi bits stop at 2 (50+ is the long copy)
const LONG_MIN = 4, LONG_MAX = 259, LONG_MAX_DIST = 0x10000
const RLE_MAX = 272
const REV_MIN = 3, REV_MAX = 18, REV_MAX_OFF = 255

/**
 * @param {Uint8Array} data  unpacked bytes
 * @param {{chainDepth?: number}} [opts]  how many earlier occurrences of a 3-byte prefix to try
 * @returns {Uint8Array} a stream `decompress` turns back into `data`
 */
export function compress(data, { chainDepth = 512 } = {}) {
  const n = data.length
  // Hash chains over 3-byte prefixes, for the medium and long copies.
  const HASH = 1 << 16
  const head = new Int32Array(HASH).fill(-1)
  const prev = new Int32Array(n).fill(-1)
  const hash3 = (i) => ((data[i] << 8) ^ (data[i + 1] << 4) ^ data[i + 2]) & (HASH - 1)
  for (let i = 0; i + 2 < n; i++) { const h = hash3(i); prev[i] = head[h]; head[h] = i }

  // Best candidate per class at each position, found forward; the DP then runs backward.
  const cost = new Float64Array(n + 1)
  const choice = new Array(n) // [kind, len, param]
  const medLen = new Int32Array(n), medDist = new Int32Array(n)
  const longLen = new Int32Array(n), longDist = new Int32Array(n)
  const matchLen = (a, b, max) => { let k = 0; while (k < max && data[a + k] === data[b + k]) k++; return k }
  for (let i = 0; i < n; i++) {
    if (i + 2 >= n) continue
    const maxLen = Math.min(LONG_MAX, n - i)
    let depth = 0
    for (let j = prev[i]; j >= 0 && depth < chainDepth; j = prev[j], depth++) {
      const d = i - j
      if (d > LONG_MAX_DIST) break
      // Overlapping copies are fine: the decoder copies byte by byte.
      const L = matchLen(j, i, maxLen)
      if (d >= 2 && d <= MED_MAX_DIST && L > medLen[i]) { medLen[i] = Math.min(L, MED_MAX); medDist[i] = d }
      if (L > longLen[i] || (L === longLen[i] && d < longDist[i])) { longLen[i] = L; longDist[i] = d }
      if (L >= LONG_MAX) break
    }
  }

  cost[n] = 0
  for (let i = n - 1; i >= 0; i--) {
    let best = 9 + cost[i + 1], pick = [0, 1, 0] // literal
    const remain = n - i
    // Short copy: distance len..len+31.
    for (let len = 2; len <= SHORT_MAX_LEN && len <= remain; len++) {
      const c = 9 + cost[i + len]
      if (c >= best) continue
      for (let d = len; d <= len + 31 && d <= i; d++) {
        if (len === 5 && d === 36) break // would be 0xFF, the end marker
        if (matchLen(i - d, i, len) === len) { best = c; pick = [1, len, d]; break }
      }
    }
    // Medium copy.
    if (medLen[i] >= MED_MIN) {
      for (let len = MED_MIN; len <= medLen[i]; len++) {
        const c = 17 + cost[i + len]
        if (c < best) { best = c; pick = [2, len, medDist[i]] }
      }
    }
    // Long copy.
    if (longLen[i] >= LONG_MIN) {
      const bits = longDist[i] - 1 < 0xf00 ? 25 : 33
      for (let len = LONG_MIN; len <= longLen[i]; len++) {
        const c = bits + cost[i + len]
        if (c < best) { best = c; pick = [3, len, longDist[i]] }
      }
    }
    // RLE of the previous byte (never at 0: nothing precedes it).
    if (i > 0) {
      const p = data[i - 1]
      let run = 0
      while (run < RLE_MAX && run < remain && data[i + run] === p) run++
      for (let len = 2; len <= run; len++) {
        const c = (len <= 16 ? 9 : 17) + cost[i + len]
        if (c < best) { best = c; pick = [4, len, 0] }
      }
    }
    // Reversed copy: out[i+k] = out[i-off-1-k].
    if (i > 0) {
      let bestRev = 0, bestOff = 0
      for (let off = 0; off <= REV_MAX_OFF && off < i; off++) {
        const base = i - off - 1
        const max = Math.min(REV_MAX, remain, base + 1)
        let k = 0
        while (k < max && data[i + k] === data[base - k]) k++
        if (k > bestRev) { bestRev = k; bestOff = off; if (k === REV_MAX) break }
      }
      for (let len = REV_MIN; len <= bestRev; len++) {
        const c = 17 + cost[i + len]
        if (c < best) { best = c; pick = [5, len, bestOff] }
      }
    }
    cost[i] = best
    choice[i] = pick
  }

  // Emit: a control byte (8 flags, MSB first) before the items it governs.
  const out = []
  let ctrlPos = -1, bit = 8
  const flag = (b) => {
    if (bit === 8) { ctrlPos = out.length; out.push(0); bit = 0 }
    if (b) out[ctrlPos] |= 0x80 >> bit
    bit++
  }
  for (let i = 0; i < n;) {
    const [kind, len, p] = choice[i]
    if (kind === 0) { flag(0); out.push(data[i]) }
    else {
      flag(1)
      if (kind === 1) out.push(0x80 | ((len - 2) << 5) | (p - len))
      else if (kind === 2) { const f = p - 2; out.push(0x20 + (((f >> 8) & 3) << 4) + (len - 3), f & 0xff) }
      else if (kind === 3) {
        const f = p - 1
        if ((f >> 8) < 0xf) out.push(0x50 + (f >> 8), f & 0xff, len - 4)
        else out.push(0x5f, f >> 8, f & 0xff, len - 4)
      } else if (kind === 4) {
        if (len <= 16) out.push(0x10 + len - 2)
        else out.push(0x1f, len - 0x11)
      } else out.push(0x60 + len - 3, p)
    }
    i += len
  }
  flag(1)
  out.push(LZ_END)
  return Uint8Array.from(out)
}
