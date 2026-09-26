import { resolveSource } from './io/resolveSource.js'
import { LevelModel } from './editor/model.js'
import { startEditor } from './editor/app.js'

const statusEl = document.getElementById('source-status')
const main = document.getElementById('ed-main')

async function boot() {
  const source = await resolveSource({ statusEl, pickButton: document.getElementById('pick-folder'), dropZone: main })
  document.getElementById('pick-folder').hidden = true
  statusEl.textContent = 'loading the level files…'
  const model = await LevelModel.load((p) => source.read(p))
  statusEl.textContent = source.description
  globalThis.mmEditor = startEditor(model) // handy from the console (mmEditor.model, mmEditor.app)
}

boot().catch((err) => {
  statusEl.textContent = `Failed to start: ${err.message}`
  console.error(err)
})
