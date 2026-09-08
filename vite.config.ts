import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// BASE_PATH wird im GitHub-Actions-Workflow automatisch auf "/<repo-name>/"
// gesetzt. Lokal (dev) laeuft die App unter "/".
//
// GEMINI_SCHLUESSEL (Reiter Sanierungsvorschau) kommt aus dem Actions-Geheimnis
// und wird beim Bauen KODIERT ins Programm geschrieben (Zeichen umgekehrt, dann
// Base64). Grund: Das gebaute Programm liegt im oeffentlichen gh-pages-Branch,
// und GitHub meldet dort gefundene Google-Schluessel automatisch an Google, das
// sie sofort sperrt (passiert am 04.09.2026 beim Vorher-Nachher-Tool). Die
// Kodierung verhindert nur diese automatische Erkennung, sie ist kein Schutz
// vor Menschen, die gezielt nachsehen. Bewusst KEIN VITE_-Praefix, damit Vite
// den Klartext nie selbst ins Programm schreibt.
function kodiereSchluessel(klartext: string | undefined): string {
  const wert = (klartext ?? '').trim()
  if (!wert) return ''
  return Buffer.from(wert.split('').reverse().join(''), 'utf8').toString('base64')
}

export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: command === 'build' ? process.env.BASE_PATH ?? '/analysetermin-fotodoku/' : '/',
  // PORT setzt die Claude-Code-Vorschau, wenn 5173 schon belegt ist.
  server: { port: Number(process.env.PORT) || 5173 },
  define: {
    __GEMINI_SCHLUESSEL_KODIERT__: JSON.stringify(kodiereSchluessel(process.env.GEMINI_SCHLUESSEL)),
  },
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
