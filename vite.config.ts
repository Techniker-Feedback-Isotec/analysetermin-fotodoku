import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// BASE_PATH wird im GitHub-Actions-Workflow automatisch auf "/<repo-name>/"
// gesetzt. Lokal (dev) laeuft die App unter "/".
export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: command === 'build' ? process.env.BASE_PATH ?? '/analysetermin-fotodoku/' : '/',
}))
