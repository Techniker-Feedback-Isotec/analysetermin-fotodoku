import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// BASE_PATH wird im GitHub-Actions-Workflow automatisch auf "/<repo-name>/"
// gesetzt. Lokal (dev) laeuft die App unter "/".
export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: command === 'build' ? process.env.BASE_PATH ?? '/analysetermin-fotodoku/' : '/',
  build: {
    rollupOptions: {
      output: {
        // Asset-Dateinamen ASCII-sicher machen: Der GitHub-Pages-Build scheitert
        // an Umlauten in Dateinamen (z. B. "Björn Morscheck.png").
        assetFileNames: (info) => {
          const original = info.names?.[0] ?? 'asset'
          const base = original.replace(/\.[^.]+$/, '')
          const ascii =
            base
              .normalize('NFKD')
              .replace(/[^\x20-\x7E]/g, '')
              .replace(/[^A-Za-z0-9._-]/g, '_') || 'asset'
          return `assets/${ascii}-[hash][extname]`
        },
      },
    },
  },
}))
