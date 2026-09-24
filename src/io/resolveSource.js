// Resolve a working AssetSource for a game page (play.js / frontend/flow.js), M3.10.
//
// `npm run dev` serves game/ over HTTP (FetchSource), which is how every milestone through M3.9
// tested this port -- but `npm run build`'s output (`publicDir: false`, by design: this is
// commercial game data, never shipped) has nothing at /game, so the built page needs the same
// folder-picker / drop-zone fallback the asset viewer already has (`src/ui/app.js`, since M1/M2).
// This module is that fallback, factored out so both game pages share one implementation instead
// of two copies drifting apart.
import { FetchSource, DirectorySource, DropSource } from './source.js'

const PROBE_FILE = 'INTRO.PAL' // small, always present, needed by every game page anyway

/**
 * @param {{statusEl: HTMLElement, pickButton: HTMLButtonElement, dropZone: HTMLElement}} dom
 * @returns {Promise<import('./source.js').AssetSource>}
 */
export async function resolveSource({ statusEl, pickButton, dropZone }) {
  const fetchSource = new FetchSource('/game')
  try {
    await fetchSource.read(PROBE_FILE)
    return fetchSource // dev server (or any host that actually serves /game) -- unchanged from M3.6-M3.9
  } catch { /* not servable this way -- fall through to the picker/drop UI below */ }

  statusEl.textContent = 'Game files not found at /game. Open your own copy of the game folder, or drop it below.'

  return new Promise((resolve) => {
    // `settled` guards against a stray drop (or a second picker use) firing after a source has
    // already resolved -- without it, e.g. dropping a random file onto the page mid-race would
    // silently overwrite statusEl with a picker error message (advisor-caught).
    let settled = false
    const tryAndResolve = async (source) => {
      try {
        await source.read(PROBE_FILE)
        if (settled) return
        settled = true
        dropZone.removeEventListener('drop', onDrop)
        resolve(source)
      } catch (err) {
        if (!settled) statusEl.textContent = `Could not find ${PROBE_FILE} there (${err.message}) -- make sure you picked the "game" folder itself, then try again.`
      }
    }

    if (DirectorySource.supported) {
      pickButton.hidden = false
      pickButton.addEventListener('click', async () => {
        if (settled) return
        let source
        try { source = await DirectorySource.pick() } catch { return } // user cancelled the picker
        tryAndResolve(source)
      })
    }

    const onDrop = (e) => {
      e.preventDefault()
      dropZone.classList.remove('drag')
      if (settled) return
      const files = [...e.dataTransfer.files]
      if (!files.length) return
      tryAndResolve(new DropSource(files))
    }
    for (const ev of ['dragover', 'dragenter']) dropZone.addEventListener(ev, (e) => { e.preventDefault(); if (!settled) dropZone.classList.add('drag') })
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag'))
    dropZone.addEventListener('drop', onDrop)
  })
}
