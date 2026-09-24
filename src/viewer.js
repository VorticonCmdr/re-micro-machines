import { App } from './ui/app.js'

const app = new App({
  sidebar: document.getElementById('sidebar'),
  view: document.getElementById('view'),
  status: document.getElementById('source-status'),
  zoomSelect: document.getElementById('zoom'),
  pickButton: document.getElementById('pick-folder'),
  dropZone: document.getElementById('drop-zone'),
})

app.start()

// Handy when poking at decoders from the console.
globalThis.mmApp = app
