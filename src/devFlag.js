// `?dev` in the page URL keeps the developer controls (GOAL-DOS-PARITY.md P7). Without it every
// element marked `dev-only` is removed before the page boots, so those controls are absent and off
// (`bootGame`/`bootRace` read them null-safely): the default page is the game canvas and the
// folder picker.

/** Removes the `.dev-only` elements unless `search` has `dev`. Returns whether dev mode is on. */
export function applyDevFlag(doc = globalThis.document, search = globalThis.location?.search ?? '') {
  const dev = new URLSearchParams(search).has('dev')
  if (!dev) for (const el of [...doc.querySelectorAll('.dev-only')]) el.remove()
  return dev
}
