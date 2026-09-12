import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { erzeugeKundendienst, MeisterTaskFehler } from './server/meistertask.mjs'
import { geminiWeiterleiten } from './server/gemini.mjs'
import { GraphFehler, aufnahmenNahe, dateiInhalt, fensterAus, graphToken } from './server/graph.mjs'
import { geocode } from './server/geocode.mjs'
import { Readable } from 'node:stream'
import { readdir, stat } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { join } from 'node:path'

/**
 * Der Dev-Server traegt bei, was der Browser nicht selbst kann: die
 * Kundensuche in MeisterTask (keine CORS-Header, Token bleibt auf dem Server)
 * und die Weiterleitung an Google Gemini (Schluessel bleibt auf dem Server).
 *
 * Auf Azure uebernimmt server/index.mjs exakt dieselben Pfade – die Logik
 * liegt deshalb in den gemeinsamen Modulen unter server/ und steht hier nicht
 * doppelt. Die Geheimnisse kommen aus der .env.local (nicht eingecheckt):
 * MT_TOKEN, MT_TOKEN_FELDER, GEMINI_SCHLUESSEL.
 */

/** Ein Wert aus der .env.local, einmal je Serverlauf gelesen. */
function ausEnv(name: string): string | undefined {
  if (process.env[name]) return process.env[name]
  try {
    const env = readFileSync(new URL('./.env.local', import.meta.url), 'utf8')
    return new RegExp(`^${name}=(.+)$`, 'm').exec(env)?.[1]?.trim()
  } catch {
    return undefined
  }
}

function apiRouten(): Plugin {
  const mtToken = ausEnv('MT_TOKEN')
  const feldToken = ausEnv('MT_TOKEN_FELDER')
  const gemini = ausEnv('GEMINI_SCHLUESSEL')
  const kunden = erzeugeKundendienst({ token: mtToken, feldToken })
  /**
   * OneDrive in der Entwicklung: GRAPH_TOKEN (aus dem Graph Explorer, laeuft
   * nach einer Stunde ab) spricht mit dem echten OneDrive. ONEDRIVE_DEMO
   * (Pfad zu einem Ordner mit Bildern und Videos) spielt stattdessen dessen
   * Dateien als Aufnahmen am Objekt ein, ohne Microsoft zu fragen: fuer den
   * Test des Eingangs im Browser.
   */
  const graphDev = ausEnv('GRAPH_TOKEN')
  const demoOrdner = ausEnv('ONEDRIVE_DEMO')

  return {
    name: 'dokumentation-api',
    configureServer(server) {
      server.middlewares.use('/api', async (req, res) => {
        const url = new URL(req.url ?? '/', 'http://intern')
        const json = (status: number, daten: unknown) => {
          res.statusCode = status
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.setHeader('Cache-Control', 'no-store')
          res.end(JSON.stringify(daten))
        }
        try {
          // In der Entwicklung gibt es keine Anmeldung: Yann sitzt davor.
          if (url.pathname === '/ich') {
            json(200, {
              email: 'feyen@isotec-morscheck.de',
              name: 'Yann Feyen',
              anmeldung: 'entwicklung',
              meistertask: Boolean(mtToken),
              gemini: Boolean(gemini),
              onedrive: Boolean(graphToken(req, graphDev) || demoOrdner),
            })
            return
          }
          if (url.pathname === '/geocode') {
            json(200, { standort: await geocode(url.searchParams.get('adresse') ?? '') })
            return
          }
          if (url.pathname === '/onedrive/aufnahmen') {
            const fenster = fensterAus(url.searchParams)
            if (demoOrdner && !graphDev) {
              // Demo: jede Datei des Ordners liegt "am Objekt", Aufnahmezeit = Dateizeit
              const namen = (await readdir(demoOrdner)).filter((n) => /\.(jpe?g|png|heic|mov|mp4)$/i.test(n))
              const treffer = []
              for (const n of namen) {
                const s = await stat(join(demoOrdner, n))
                const video = /\.(mov|mp4)$/i.test(n)
                treffer.push({
                  id: n, name: n, groesse: s.size, mime: video ? 'video/mp4' : 'image/jpeg', art: video ? 'video' : 'foto',
                  aufgenommen: s.mtime.toISOString(), lat: fenster.lat, lon: fenster.lon, entfernung: 12,
                })
              }
              json(200, { treffer, geprueft: treffer.length, ohneStandort: 0, ordner: ['demo'] })
              return
            }
            const token = graphToken(req, graphDev)
            if (!token) {
              json(503, { fehler: 'OneDrive ist lokal nicht angebunden (GRAPH_TOKEN oder ONEDRIVE_DEMO in .env.local).' })
              return
            }
            json(200, await aufnahmenNahe(token, fenster))
            return
          }
          const datei = /^\/onedrive\/datei\/([^/]+)$/.exec(url.pathname)
          if (datei) {
            const id = decodeURIComponent(datei[1])
            if (demoOrdner && !graphDev) {
              if (id.includes('/') || id.includes('\\')) {
                json(400, { fehler: 'Ungueltiger Name.' })
                return
              }
              res.statusCode = 200
              res.setHeader('Content-Type', /\.(mov|mp4)$/i.test(id) ? 'video/mp4' : 'image/jpeg')
              createReadStream(join(demoOrdner, id)).pipe(res)
              return
            }
            const token = graphToken(req, graphDev)
            if (!token) {
              json(503, { fehler: 'OneDrive ist lokal nicht angebunden.' })
              return
            }
            const inhalt = await dateiInhalt(token, id)
            res.statusCode = 200
            res.setHeader('Content-Type', inhalt.headers.get('content-type') ?? 'application/octet-stream')
            const laenge = inhalt.headers.get('content-length')
            if (laenge) res.setHeader('Content-Length', laenge)
            Readable.fromWeb(inhalt.body as import('node:stream/web').ReadableStream).pipe(res)
            return
          }
          if (url.pathname === '/kunden') {
            json(200, await kunden.kundenliste(url.searchParams.get('mitarbeiter') ?? ''))
            return
          }
          const kunde = /^\/kunden\/(\d+)$/.exec(url.pathname)
          if (kunde) {
            const projekt = Number(url.searchParams.get('projekt')) || undefined
            json(200, await kunden.kundendaten(Number(kunde[1]), projekt))
            return
          }
          const anhang = /^\/kunden\/(\d+)\/anhang$/.exec(url.pathname)
          if (anhang) {
            const teile: Buffer[] = []
            for await (const teil of req) teile.push(Buffer.isBuffer(teil) ? teil : Buffer.from(teil))
            json(
              200,
              await kunden.ersetzeAnhang(
                Number(anhang[1]),
                url.searchParams.get('art') ?? '',
                url.searchParams.get('name') ?? 'Dokument.pdf',
                Buffer.concat(teile),
                req.headers['content-type'],
              ),
            )
            return
          }
          const art = /^\/gemini\/(bild|bestand)$/.exec(url.pathname)
          if (art) {
            let rumpf = ''
            for await (const teil of req) rumpf += teil
            const { status, text } = await geminiWeiterleiten(
              art[1] as 'bild' | 'bestand',
              rumpf,
              gemini,
            )
            res.statusCode = status
            res.setHeader('Content-Type', 'application/json; charset=utf-8')
            res.end(text)
            return
          }
          json(404, { fehler: 'Unbekannter Pfad.' })
        } catch (err) {
          if (err instanceof MeisterTaskFehler) {
            json(err.status === 429 ? 429 : 502, { fehler: err.message })
            return
          }
          if (err instanceof GraphFehler) {
            json(err.status === 401 ? 409 : err.status >= 400 && err.status < 600 ? err.status : 502, {
              fehler: err.message,
              onedriveAbgelaufen: err.status === 401,
            })
            return
          }
          json(500, { fehler: String(err) })
        }
      })
    },
  }
}

export default defineConfig(() => ({
  plugins: [react(), apiRouten()],
  // Auf Azure laeuft die App unter "/". Die alte GitHub-Pages-Adresse leitet
  // nur noch um; BASE_PATH bleibt fuer den Fall, dass ein Unterpfad noetig wird.
  base: process.env.BASE_PATH ?? '/',
  // PORT setzt die Claude-Code-Vorschau, wenn 5173 schon belegt ist.
  server: { port: Number(process.env.PORT) || 5173 },
  build: {
    rollupOptions: {
      // Zwei Seiten: die App und das Zeichentool (zeichnen.html), das die
      // Prinzipskizze in einem Vollbild-iframe oeffnet (seit 11.09.2026).
      input: {
        index: fileURLToPath(new URL('./index.html', import.meta.url)),
        zeichnen: fileURLToPath(new URL('./zeichnen.html', import.meta.url)),
      },
      output: {
        // Asset-Dateinamen ASCII-sicher machen (Mitarbeiterfotos heissen
        // "Björn Morscheck.png"), damit kein Werkzeug in der Kette an Umlauten
        // im Dateinamen scheitert.
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
