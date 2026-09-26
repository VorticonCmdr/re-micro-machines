// The pages' chrome (GOAL-DOS-PARITY.md P7): the developer toggles exist only with `?dev`.
//   node tools/check-pages.mjs
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { applyDevFlag } from '../src/devFlag.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
let bad = 0
const check = (name, cond) => { if (!cond) { bad++; console.log(`FAIL: ${name}`) } }

// The opening tag carrying `id`, and whether it (or the label/element wrapping it) is dev-only.
function devOnly(html, id) {
  const at = html.indexOf(`id="${id}"`)
  if (at < 0) return null
  const open = html.lastIndexOf('<', at)
  const tag = html.slice(open, html.indexOf('>', at) + 1)
  if (/class="[^"]*\bdev-only\b/.test(tag)) return true
  const label = html.lastIndexOf('<label', at)
  const labelEnd = html.indexOf('</label>', label)
  return label >= 0 && labelEnd > at && /class="[^"]*\bdev-only\b/.test(html.slice(label, html.indexOf('>', label) + 1))
}

const game = readFileSync(join(ROOT, 'game.html'), 'utf8')
check('game.html: Strict OPL2 and Lap line are dev-only', devOnly(game, 'opl-strict') === true && devOnly(game, 'lapline-toggle') === true)
check('game.html: the canvas and the folder picker are not', devOnly(game, 'game-canvas') === false && devOnly(game, 'pick-folder') === false)
const headerLinks = [...game.slice(game.indexOf('<header'), game.indexOf('</header>')).matchAll(/<a [^>]*>/g)].map((m) => m[0])
check('game.html: the header links are dev-only too', headerLinks.length > 0 && headerLinks.every((a) => /\bdev-only\b/.test(a)))
check('game.html: its description no longer points at the dev toggles', !/Lap line \(dev\)/.test(game.slice(game.indexOf('<main'))))
const index = readFileSync(join(ROOT, 'index.html'), 'utf8')
check('index.html: Strict OPL2, Projectiles and Lap line are dev-only; Smoothness stays', ['opl-strict', 'projectiles-toggle', 'lapline-toggle'].every((id) => devOnly(index, id) === true) && devOnly(index, 'smoothness') === false)
for (const f of ['src/game-entry.js', 'src/play-entry.js']) {
  const src = readFileSync(join(ROOT, f), 'utf8')
  check(`${f}: applyDevFlag() runs before the first getElementById`, src.indexOf('applyDevFlag()') >= 0 && src.indexOf('applyDevFlag()') < src.indexOf('getElementById'))
}

// applyDevFlag against a stand-in document.
const fakeDoc = () => {
  const els = [{ removed: false }, { removed: false }]
  els.forEach((e) => { e.remove = () => { e.removed = true } })
  return { els, querySelectorAll: (sel) => (sel === '.dev-only' ? els : []) }
}
const d1 = fakeDoc()
check('applyDevFlag: no ?dev removes every dev-only element and reports false', applyDevFlag(d1, '') === false && d1.els.every((e) => e.removed))
const d2 = fakeDoc()
check('applyDevFlag: ?dev keeps them and reports true', applyDevFlag(d2, '?dev') === true && d2.els.every((e) => !e.removed))
const d3 = fakeDoc()
check('applyDevFlag: ?x=1&dev=1 counts too', applyDevFlag(d3, '?x=1&dev=1') === true && d3.els.every((e) => !e.removed))

console.log(bad ? `${bad} check(s) failed` : 'check-pages: without ?dev the pages have no developer toggles (and game.html no nav links); with ?dev they do')
process.exitCode = bad ? 1 : 0
