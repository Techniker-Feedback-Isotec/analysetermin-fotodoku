// Server fuer den Azure-Betrieb des Werkzeugs "Dokumentation". Vier Aufgaben:
//   1. die gebaute Seite aus dist/ ausliefern (gzip vorgerechnet, ETag/304)
//   2. /api/ich: wer ist angemeldet (Easy Auth, Microsoft-Konto) – die
//      Oberflaeche waehlt damit den Mitarbeiter vor
//   3. /api/kunden: die Kundensuche in MeisterTask (server/meistertask.mjs),
//      die Token liegen als Anwendungseinstellungen hier und verlassen den
//      Server nie
//   4. /api/gemini/*: die Sanierungsvorschau (server/gemini.mjs), der
//      Google-Schluessel ebenso
//
// Die Pfade sind dieselben wie im Vite-Dev-Server: die Anwendung merkt nicht,
// wo sie laeuft. Bewusst ohne zusaetzliche Pakete, dasselbe Muster wie der
// Vertriebsprozess-Server (Desktop/meistertask/server/index.mjs). Node 24
// bringt fetch mit, mehr braucht es nicht.
//
// Anwendungseinstellungen:
//   MT_TOKEN           MeisterTask-Token des ISOTEC Bots (Pflicht fuer die Suche)
//   MT_TOKEN_FELDER    Token eines Kontos mit Business-Sitzplatz (Felder, 403 sonst)
//   GEMINI_SCHLUESSEL  Google-Schluessel (ohne: Sanierungsvorschau meldet 503)
//   PORT               setzt Azure selbst
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { extname, join, normalize, sep } from 'node:path'
import { angemeldet } from './anmeldung.mjs'
import { erzeugeKundendienst, MeisterTaskFehler } from './meistertask.mjs'
import { geminiWeiterleiten } from './gemini.mjs'

const PORT = Number(process.env.PORT) || 8080
const MT_TOKEN = process.env.MT_TOKEN
const MT_TOKEN_FELDER = process.env.MT_TOKEN_FELDER
const GEMINI = process.env.GEMINI_SCHLUESSEL

const DIST = fileURLToPath(new URL('../dist/', import.meta.url))
const kunden = erzeugeKundendienst({ token: MT_TOKEN, feldToken: MT_TOKEN_FELDER })

const TYPEN = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  // Der pdf.js-Worker heisst *.mjs; ohne JavaScript-Typ lehnt der Browser ihn
  // ab, und das Inhaltsverzeichnis der Mappe blieb ohne Untertitel (11.09.2026)
  '.mjs': 'text/javascript; charset=utf-8',
  '.pdf': 'application/pdf',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
}

const JSON_KOPF = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }

// ---------- Hilfen ----------

function rumpfLesen(req, grenze) {
  return new Promise((fertig, fehler) => {
    const teile = []
    let laenge = 0
    req.on('data', (t) => {
      laenge += t.length
      if (laenge > grenze) {
        req.destroy()
        fertig(null)
        return
      }
      teile.push(t)
    })
    req.on('end', () => fertig(Buffer.concat(teile)))
    req.on('error', fehler)
  })
}

/**
 * Komprimiert antworten, wenn der Browser es kann. Azure stellt vor dieser
 * Node-App keinen Proxy, der komprimiert (gemessen 05.09.2026 am
 * Vertriebsprozess). Unter 1 KB lohnt es nicht, Bilder sind schon komprimiert.
 */
const KOMPRIMIERBAR = /^(text\/|application\/(javascript|json|manifest\+json|wasm)|image\/svg)/

function antworten(req, res, status, kopf, inhalt) {
  const gzipOk = /\bgzip\b/.test(req.headers['accept-encoding'] ?? '')
  const rumpf = typeof inhalt === 'string' ? Buffer.from(inhalt, 'utf8') : inhalt
  if (gzipOk && KOMPRIMIERBAR.test(kopf['Content-Type'] ?? '') && rumpf.length > 1024) {
    res.writeHead(status, { ...kopf, 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' })
    res.end(gzipSync(rumpf))
    return
  }
  res.writeHead(status, { ...kopf, Vary: 'Accept-Encoding' })
  res.end(rumpf)
}

const json = (req, res, status, daten) => antworten(req, res, status, JSON_KOPF, JSON.stringify(daten))

/**
 * Die gebauten Dateien liegen nach dem ersten Zugriff im Speicher, gzip schon
 * vorgerechnet: dist/ aendert sich nur mit einem Deploy, und der startet den
 * Prozess neu.
 */
const statisch = new Map()

async function statischLesen(voll) {
  const bekannt = statisch.get(voll)
  if (bekannt) return bekannt
  const roh = await readFile(voll)
  const typ = TYPEN[extname(voll)] ?? 'application/octet-stream'
  const eintrag = {
    typ,
    roh,
    gz: KOMPRIMIERBAR.test(typ) && roh.length > 1024 ? gzipSync(roh, { level: 9 }) : null,
    etag: `"${createHash('sha1').update(roh).digest('hex').slice(0, 20)}"`,
  }
  statisch.set(voll, eintrag)
  return eintrag
}

async function statischAusliefern(req, res, pfad) {
  // Pfadausbruch verhindern: alles bleibt unterhalb von dist/
  const voll = normalize(join(DIST, pfad))
  if (!voll.startsWith(normalize(DIST + sep)) && voll !== normalize(DIST)) {
    res.writeHead(403).end()
    return
  }
  let eintrag
  let cache
  try {
    eintrag = await statischLesen(voll)
    // Die Bundles tragen einen Hash im Namen und duerfen lange leben
    cache = pfad.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache'
  } catch {
    // Alles Unbekannte faellt auf die App zurueck (eine Seite, eigene Wege)
    eintrag = await statischLesen(join(DIST, 'index.html'))
    cache = 'no-cache'
  }
  if (req.headers['if-none-match'] === eintrag.etag) {
    res.writeHead(304, { ETag: eintrag.etag, 'Cache-Control': cache, Vary: 'Accept-Encoding' })
    res.end()
    return
  }
  const gzipOk = eintrag.gz && /\bgzip\b/.test(req.headers['accept-encoding'] ?? '')
  res.writeHead(200, {
    'Content-Type': eintrag.typ,
    'Cache-Control': cache,
    ETag: eintrag.etag,
    Vary: 'Accept-Encoding',
    ...(gzipOk ? { 'Content-Encoding': 'gzip' } : {}),
  })
  res.end(gzipOk ? eintrag.gz : eintrag.roh)
}

// ---------- Verteiler ----------

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://intern')
  try {
    // Von der Anmeldung ausgenommen (excludedPaths), damit sich der Server
    // nach dem Ausliefern ohne Sitzung pruefen laesst.
    if (url.pathname === '/gesund') {
      json(req, res, 200, {
        ok: true,
        mtToken: Boolean(MT_TOKEN),
        mtTokenFelder: Boolean(MT_TOKEN_FELDER),
        gemini: Boolean(GEMINI),
      })
      return
    }

    if (url.pathname === '/api/ich') {
      json(req, res, 200, {
        ...angemeldet(req),
        anmeldung: 'easyauth',
        meistertask: Boolean(MT_TOKEN),
        gemini: Boolean(GEMINI),
      })
      return
    }

    if (url.pathname === '/api/kunden') {
      const mitarbeiter = url.searchParams.get('mitarbeiter') ?? ''
      json(req, res, 200, await kunden.kundenliste(mitarbeiter))
      return
    }

    const kunde = /^\/api\/kunden\/(\d+)$/.exec(url.pathname)
    if (kunde) {
      const projekt = Number(url.searchParams.get('projekt')) || undefined
      json(req, res, 200, await kunden.kundendaten(Number(kunde[1]), projekt))
      return
    }

    const gemini = /^\/api\/gemini\/(bild|bestand)$/.exec(url.pathname)
    if (gemini) {
      if (req.method !== 'POST') {
        json(req, res, 405, { error: { message: 'Nur POST.' } })
        return
      }
      // Ein Foto als Base64 liegt bei wenigen MB; 25 MB sind grosszuegig.
      const rumpf = await rumpfLesen(req, 25 * 1024 * 1024)
      if (!rumpf) {
        json(req, res, 413, { error: { message: 'Anfrage zu gross.' } })
        return
      }
      const { status, text } = await geminiWeiterleiten(gemini[1], rumpf.toString('utf8'), GEMINI)
      antworten(req, res, status, JSON_KOPF, text)
      return
    }

    await statischAusliefern(req, res, url.pathname.replace(/^\//, '') || 'index.html')
  } catch (err) {
    if (err instanceof MeisterTaskFehler) {
      json(req, res, err.status === 429 ? 429 : 502, { fehler: err.message })
      return
    }
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end(`Serverfehler: ${String(err)}`)
  }
}).listen(PORT, () => {
  console.log(`Dokumentation-Server auf Port ${PORT}, dist aus ${DIST}`)
  if (!MT_TOKEN) console.warn('WARNUNG: MT_TOKEN fehlt – die Kundensuche antwortet mit 503.')
  if (!MT_TOKEN_FELDER) console.warn('Hinweis: MT_TOKEN_FELDER fehlt – die Auswahl fuellt nur den Namen.')
  if (!GEMINI) console.warn('Hinweis: GEMINI_SCHLUESSEL fehlt – die Sanierungsvorschau bleibt aus.')
})
