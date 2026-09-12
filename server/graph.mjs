// OneDrive des angemeldeten Nutzers ueber Microsoft Graph (12.09.2026).
//
// Warum: Die Fotos vom Termin entstehen auf dem iPhone und landen ueber die
// OneDrive-App von selbst im Konto des Mitarbeiters (Eigene Aufnahmen /
// Camera Roll, Ordner Jahr/Monat). Das Werkzeug holt sie von dort und ordnet
// sie ueber den Aufnahmeort dem offenen Projekt zu (Yann: "anhand des
// ausgewaehlten Projekts, der Adresse und dem Standort des Fotos").
//
// Der Server bekommt das Graph-Token des Nutzers von Easy Auth in der
// Kopfzeile X-MS-TOKEN-AAD-ACCESS-TOKEN (Token-Speicher an, Scope Files.Read
// in den loginParameters, siehe docs/AZURE.md). Es verlaesst den Server
// nicht; der Browser spricht nur mit /api/onedrive/*. Nichts wird nach
// OneDrive geschrieben (Files.Read).

const GRAPH = 'https://graph.microsoft.com/v1.0'

export class GraphFehler extends Error {
  /** @param {string} nachricht @param {number} status */
  constructor(nachricht, status) {
    super(nachricht)
    this.status = status
  }
}

/**
 * Das Graph-Token aus der Easy-Auth-Kopfzeile; in der Entwicklung ersatzweise
 * ein fest hinterlegtes (GRAPH_TOKEN in .env.local, aus dem Graph Explorer).
 * @param {import('node:http').IncomingMessage} req
 * @param {string | undefined} entwicklung
 */
export function graphToken(req, entwicklung) {
  const kopf = req.headers['x-ms-token-aad-access-token']
  if (typeof kopf === 'string' && kopf.length > 20) return kopf
  return entwicklung || null
}

async function graphAbruf(token, pfad, init = {}) {
  const url = pfad.startsWith('https://') ? pfad : `${GRAPH}${pfad}`
  const r = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(init.headers ?? {}) },
  })
  if (r.status === 401) throw new GraphFehler('Die Anmeldung bei OneDrive ist abgelaufen.', 401)
  if (r.status === 403) throw new GraphFehler('Kein Zugriff auf OneDrive (Berechtigung Files.Read fehlt).', 403)
  if (r.status === 404) return null
  if (!r.ok) {
    let text = ''
    try {
      const j = await r.json()
      text = j?.error?.message ?? ''
    } catch {
      // ohne Rumpf
    }
    throw new GraphFehler(`OneDrive antwortet mit ${r.status}${text ? `: ${text}` : ''}.`, r.status)
  }
  return r.json()
}

/** Alle Seiten einer Kinderliste einsammeln (@odata.nextLink). */
async function alleKinder(token, pfad) {
  const alle = []
  let weiter = pfad
  for (let runde = 0; weiter && runde < 40; runde++) {
    const seite = await graphAbruf(token, weiter)
    if (!seite) break
    alle.push(...(seite.value ?? []))
    weiter = seite['@odata.nextLink'] ?? null
  }
  return alle
}

const FELDER = '$select=id,name,size,file,folder,photo,video,location,createdDateTime,lastModifiedDateTime,fileSystemInfo'

/**
 * Zeitfenster und Ort aus den Abfrageparametern; wirft bei Unsinn einen 400.
 * @param {URLSearchParams} q
 */
export function fensterAus(q) {
  const seit = new Date(q.get('seit') ?? '')
  const bis = q.get('bis') ? new Date(q.get('bis')) : new Date()
  const lat = Number(q.get('lat'))
  const lon = Number(q.get('lon'))
  const radius = Math.min(2000, Math.max(20, Number(q.get('radius')) || 150))
  if (Number.isNaN(seit.getTime()) || Number.isNaN(bis.getTime())) throw new GraphFehler('Zeitfenster fehlt (seit, bis).', 400)
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    throw new GraphFehler('Standort fehlt (lat, lon).', 400)
  }
  return { seit, bis, lat, lon, radius }
}

/** Luftlinie in Metern (Haversine). */
export function entfernungM(lat1, lon1, lat2, lon2) {
  const R = 6371000
  const rad = (g) => (g * Math.PI) / 180
  const dLat = rad(lat2 - lat1)
  const dLon = rad(lon2 - lon1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

/** Jahr/Monat-Paare, die das Zeitfenster beruehrt (UTC reicht: Ordner sind nach Ortszeit, Puffer unten). */
function monateIm(seit, bis) {
  const paare = []
  const d = new Date(Date.UTC(seit.getUTCFullYear(), seit.getUTCMonth(), 1))
  // Einen Monat frueher mitnehmen: die Ordnerzuordnung folgt der Ortszeit des Handys
  d.setUTCMonth(d.getUTCMonth() - 1)
  const ende = new Date(Date.UTC(bis.getUTCFullYear(), bis.getUTCMonth(), 1))
  ende.setUTCMonth(ende.getUTCMonth() + 1)
  while (d <= ende && paare.length < 36) {
    paare.push({ jahr: d.getUTCFullYear(), monat: d.getUTCMonth() + 1 })
    d.setUTCMonth(d.getUTCMonth() + 1)
  }
  return paare
}

/**
 * Ein Eintrag aus OneDrive als Aufnahme; null, wenn es kein Foto und kein
 * Video ist. Aufnahmezeit: EXIF (photo.takenDateTime), sonst Dateizeit.
 */
function alsAufnahme(item) {
  if (!item.file) return null
  const mime = item.file.mimeType ?? ''
  const art = item.video || mime.startsWith('video/') ? 'video' : item.photo || mime.startsWith('image/') ? 'foto' : null
  if (!art) return null
  const aufgenommen = item.photo?.takenDateTime ?? item.fileSystemInfo?.createdDateTime ?? item.createdDateTime
  const ort = item.location
  return {
    id: item.id,
    name: item.name,
    groesse: item.size ?? 0,
    mime,
    art,
    aufgenommen,
    lat: typeof ort?.latitude === 'number' ? ort.latitude : null,
    lon: typeof ort?.longitude === 'number' ? ort.longitude : null,
  }
}

/**
 * Fotos und Videos aus "Eigene Aufnahmen" des Nutzers im Zeitfenster, die
 * innerhalb von `radius` Metern um (lat, lon) aufgenommen wurden.
 *
 * Gesucht wird ueber den Sonderordner cameraroll (Graph kennt ihn unabhaengig
 * vom Sprachnamen "Camera Roll" / "Eigene Aufnahmen") und dessen Ordner
 * Jahr/Monat; liegen Dateien flach im Sonderordner, zaehlen sie ebenfalls.
 *
 * @param {string} token
 * @param {{ seit: Date, bis: Date, lat: number, lon: number, radius: number }} p
 */
export async function aufnahmenNahe(token, p) {
  const wurzel = await graphAbruf(token, `/me/drive/special/cameraroll?$select=id,name`)
  if (!wurzel) {
    return { treffer: [], geprueft: 0, ohneStandort: 0, ordner: [], hinweis: 'Kein Ordner "Eigene Aufnahmen" in OneDrive.' }
  }
  const oben = await alleKinder(token, `/me/drive/items/${wurzel.id}/children?${FELDER}&$top=200`)
  const jahre = new Map(oben.filter((k) => k.folder).map((k) => [String(parseInt(k.name, 10)), k]))
  const dateien = oben.filter((k) => k.file)
  const ordner = []

  for (const { jahr, monat } of monateIm(p.seit, p.bis)) {
    const jahrOrdner = jahre.get(String(jahr))
    if (!jahrOrdner) continue
    if (!jahrOrdner.kinder) jahrOrdner.kinder = await alleKinder(token, `/me/drive/items/${jahrOrdner.id}/children?$select=id,name,folder&$top=200`)
    const monatOrdner = jahrOrdner.kinder.find((k) => k.folder && parseInt(k.name, 10) === monat)
    if (!monatOrdner) continue
    ordner.push(`${jahr}/${monatOrdner.name}`)
    dateien.push(...(await alleKinder(token, `/me/drive/items/${monatOrdner.id}/children?${FELDER}&$top=200`)))
  }

  const treffer = []
  let geprueft = 0
  let ohneStandort = 0
  const von = p.seit.getTime()
  const bisMs = p.bis.getTime()
  for (const item of dateien) {
    const a = alsAufnahme(item)
    if (!a) continue
    const t = Date.parse(a.aufgenommen)
    if (Number.isNaN(t) || t < von || t > bisMs) continue
    geprueft++
    if (a.lat === null || a.lon === null) {
      ohneStandort++
      continue
    }
    const entfernung = entfernungM(p.lat, p.lon, a.lat, a.lon)
    if (entfernung <= p.radius) treffer.push({ ...a, entfernung: Math.round(entfernung) })
  }
  treffer.sort((x, y) => Date.parse(x.aufgenommen) - Date.parse(y.aufgenommen))
  return { treffer, geprueft, ohneStandort, ordner }
}

/**
 * Inhalt einer Datei als Strom. Graph antwortet auf /content mit einer
 * Umleitung auf eine vorab freigegebene Adresse; die wird ohne Token geholt.
 * @param {string} token @param {string} id
 * @returns {Promise<Response>}
 */
export async function dateiInhalt(token, id) {
  const r = await fetch(`${GRAPH}/me/drive/items/${encodeURIComponent(id)}/content`, {
    headers: { Authorization: `Bearer ${token}` },
    redirect: 'manual',
  })
  if (r.status === 401) throw new GraphFehler('Die Anmeldung bei OneDrive ist abgelaufen.', 401)
  if (r.status === 404) throw new GraphFehler('Die Datei liegt nicht mehr in OneDrive.', 404)
  if (r.status >= 300 && r.status < 400) {
    const ziel = r.headers.get('location')
    if (!ziel) throw new GraphFehler('OneDrive nennt keine Downloadadresse.', 502)
    const inhalt = await fetch(ziel)
    if (!inhalt.ok || !inhalt.body) throw new GraphFehler(`Download aus OneDrive scheitert (${inhalt.status}).`, 502)
    return inhalt
  }
  if (!r.ok || !r.body) throw new GraphFehler(`OneDrive antwortet mit ${r.status}.`, r.status)
  return r
}
