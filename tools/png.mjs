// Minimal PNG writer (RGBA8) on Node's zlib. No dependencies.
// Exists so decoders can be verified by looking at their output.
import { deflateSync, inflateSync } from 'node:zlib'
import { writeFileSync, readFileSync } from 'node:fs'

const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

const crc32 = (buf) => {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}

/** Encode RGBA8 pixels as a PNG buffer. */
export function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0 // filter: none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ])
}

export function savePng(path, width, height, rgba) {
  writeFileSync(path, encodePng(width, height, rgba))
}

/** Integer nearest-neighbour upscale of RGBA. */
export function scale(rgba, width, height, zoom) {
  if (zoom === 1) return rgba
  const out = new Uint8ClampedArray(width * zoom * height * zoom * 4)
  for (let y = 0; y < height * zoom; y++) {
    const sy = Math.floor(y / zoom)
    for (let x = 0; x < width * zoom; x++) {
      const si = (sy * width + Math.floor(x / zoom)) * 4
      const di = (y * width * zoom + x) * 4
      out[di] = rgba[si]; out[di + 1] = rgba[si + 1]; out[di + 2] = rgba[si + 2]; out[di + 3] = rgba[si + 3]
    }
  }
  return out
}

/** Reads an 8-bit RGB, non-interlaced PNG (what the DOSBox bridge's frame endpoint writes) into
 * `{ width, height, rgb }`, undoing the five scanline filters. */
export function readPngRgb(path) {
  const b = readFileSync(path)
  let o = 8, width = 0, height = 0
  const idat = []
  while (o < b.length) {
    const n = b.readUInt32BE(o), t = b.toString('ascii', o + 4, o + 8)
    if (t === 'IHDR') { width = b.readUInt32BE(o + 8); height = b.readUInt32BE(o + 12) }
    if (t === 'IDAT') idat.push(b.subarray(o + 8, o + 8 + n))
    o += 12 + n
  }
  const raw = inflateSync(Buffer.concat(idat)), bpp = 3, stride = width * bpp, rgb = new Uint8Array(width * height * 3)
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? rgb[y * stride + x - bpp] : 0, up = y ? rgb[(y - 1) * stride + x] : 0, c = x >= bpp && y ? rgb[(y - 1) * stride + x - bpp] : 0
      let v = line[x]
      if (f === 1) v += a
      else if (f === 2) v += up
      else if (f === 3) v += (a + up) >> 1
      else if (f === 4) { const p = a + up - c, pa = Math.abs(p - a), pb = Math.abs(p - up), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? up : c }
      rgb[y * stride + x] = v & 0xff
    }
  }
  return { width, height, rgb }
}
