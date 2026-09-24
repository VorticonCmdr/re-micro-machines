// Render every mapped region of BITSFILE.PH0 for a look-and-check of src/formats/race.js's
// ph0* decoders (mirrors the rendering in src/ui/views/raceGfxView.js's bitsfileView).
//   node tools/render-bitsfile.mjs
import { readFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { decompress } from '../src/formats/lz.js'
import { decodePalette } from '../src/formats/pal.js'
import { indexedToRgba } from '../src/render/raster.js'
import { ph0Puffs, ph0Icon16, ph0Digits, ph0PositionLabels, ph0Round2SplashFrames, ph0ChopperRotorFrames, ph0TailIcons, ph0BannerStack, PH0_LAYOUT } from '../src/formats/race.js'
import { savePng, scale } from './png.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'tools', 'out')
mkdirSync(OUT, { recursive: true })

const unpacked = decompress(new Uint8Array(readFileSync(join(ROOT, 'game', 'BITSFILE.PH0'))))
const pal = decodePalette(readFileSync(join(ROOT, 'game', 'GAME1', 'ROUND1.PAL')), { bits: 6 })

function save(name, img, zoom) {
  const rgba = indexedToRgba(img.indexed, pal.rgb, { transparent: 0 })
  savePng(join(OUT, name + '.png'), img.width * zoom, img.height * zoom, scale(rgba, img.width, img.height, zoom))
  console.log(name, 'saved', img.width, 'x', img.height)
}

console.log(`BITSFILE.PH0: ${unpacked.length} B unpacked (expect 26048)`)
for (let s = 0; s < 3; s++) save(`PH0_puffs_${s}`, ph0Puffs(unpacked, s), 8)
{
  const w = 24, h = Math.floor(0xd80 / w)
  save('PH0_UNKNOWN_0600_1380', { width: w, height: h, indexed: unpacked.subarray(0x600, 0x600 + w * h) }, 4)
}
save('PH0_icon_warning', ph0Icon16(unpacked, PH0_LAYOUT.icons.warning), 8)
save('PH0_icon_flag', ph0Icon16(unpacked, PH0_LAYOUT.icons.flag), 8)
save('PH0_digits', ph0Digits(unpacked), 4)
save('PH0_light_red', ph0Icon16(unpacked, PH0_LAYOUT.lights.red), 8)
save('PH0_light_blue', ph0Icon16(unpacked, PH0_LAYOUT.lights.blue), 8)
save('PH0_position_labels', ph0PositionLabels(unpacked), 4)
save('PH0_round2_splash', ph0Round2SplashFrames(unpacked), 3)
save('PH0_tail_icons', ph0TailIcons(unpacked), 6)
save('PH0_banner_stack', ph0BannerStack(unpacked), 3)
console.log('Banner text (by render, top to bottom):', PH0_LAYOUT.bannerText.join(', '))

const mappedEnd = PH0_LAYOUT.banners.offset + PH0_LAYOUT.banners.count * PH0_LAYOUT.banners.stride
console.log(`Banners end at 0x${mappedEnd.toString(16)}; file length 0x${unpacked.length.toString(16)} — ${mappedEnd === unpacked.length ? 'EXACT MATCH' : 'MISMATCH'}`)

// The +0x1F00 slot is dual-purpose: PH0_round2_splash above is what's live during round 2 (POWERBOATS).
// During round 8 (CHOPPERS) the same DS-relative slot is overwritten with ROUND8BR.VH0's bank-2 bytes
// instead. Render those too, and confirm the byte-diff (a standing regression check for this finding).
const vh0 = decompress(new Uint8Array(readFileSync(join(ROOT, 'game', 'GAME1', 'ROUND8BR.VH0'))))
const pal8 = decodePalette(readFileSync(join(ROOT, 'game', 'GAME1', 'ROUND8.PAL')), { bits: 6 })
{
  const rgba = indexedToRgba(ph0ChopperRotorFrames(vh0).indexed, pal8.rgb, { transparent: 0 })
  const img = ph0ChopperRotorFrames(vh0)
  savePng(join(OUT, 'PH0_chopper_rotor_from_VH0.png'), img.width * 3, img.height * 3, scale(rgba, img.width, img.height, 3))
  console.log('PH0_chopper_rotor_from_VH0 saved', img.width, 'x', img.height, '(real round-8 rotor, sourced from ROUND8BR.VH0, NOT BITSFILE.PH0)')
}
{
  const a = vh0.subarray(0x1440, 0x1440 + 0x1400)
  const b = unpacked.subarray(0x1f00, 0x1f00 + 0x1400)
  let diff = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff++
  console.log(`ROUND8BR.VH0 bank2[0..0x1400) vs PH0[0x1f00..0x3300): ${diff}/${a.length} bytes differ — ${diff > 0 ? 'confirms round-8 overwrites this slot (round-2 splash is untouched)' : 'UNEXPECTED: identical, re-check the dual-purpose claim'}`)
}
