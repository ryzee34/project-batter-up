import { defineConfig } from 'vite'

// served from https://ryzee34.github.io/project-batter-up/
export default defineConfig({
  base: '/project-batter-up/',
  build: {
    // three.js is its own chunk, loaded only once a pitch is revealed
    chunkSizeWarningLimit: 700,
  },
})
