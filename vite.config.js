import { defineConfig } from 'vite'

export default defineConfig({
  // The original game data lives in game/ (and game/GAME1/) at the project root. In dev,
  // Vite serves it as-is over HTTP and fetch().arrayBuffer() gets the bytes untouched.
  // Nothing here converts, extracts or preprocesses assets — decoders run on the originals.
  //
  // Deliberately NOT copied into the build: the game is commercial software. A production
  // build ships the viewer/port only; the user points it at their own copy via the
  // directory picker (see src/io/source.js).
  publicDir: false,
  base: './',
  server: {
    fs: { strict: true },
  },
  // The sound worklet (src/audio/si2-worklet.js) is loaded with ?worker&url; build it as an ES module
  // so AudioWorkletGlobalScope can addModule() it.
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    outDir: 'dist',
    // Three pages: the single-race page (index.html, M3.6), the tournament flow (game.html, M3.9)
    // and the dev asset viewer (viewer.html). Vite's default build only picks up index.html — list
    // all three or the others silently drop out of dist/.
    rollupOptions: {
      input: {
        main: 'index.html',
        game: 'game.html',
        viewer: 'viewer.html',
      },
    },
  },
})
