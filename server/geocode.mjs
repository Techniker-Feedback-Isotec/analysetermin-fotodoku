// Adresse zu Koordinaten (12.09.2026), fuer die Zuordnung von OneDrive-Fotos
// zum Projekt ueber den Aufnahmeort. Nominatim (OpenStreetMap) ohne
// Schluessel; die Nutzungsregeln verlangen eine erkennbare Absenderkennung
// und hoechstens eine Anfrage je Sekunde. Es werden nur Objektadressen
// unserer Projekte angefragt, das sind wenige am Tag. Ergebnisse bleiben im
// Speicher des Servers, die App merkt sich die Koordinaten zusaetzlich am
// Vorgang, deshalb fragt sie je Adresse nur einmal.

const ADRESSE = 'https://nominatim.openstreetmap.org/search'
const KENNUNG = process.env.GEOCODE_KENNUNG ?? 'ISOTEC-Dokumentation/1.0 (feyen@isotec-morscheck.de)'

/** @type {Map<string, { lat: number, lon: number, anzeige: string } | null>} */
const speicher = new Map()
let letzteAnfrage = 0
let warteschlange = Promise.resolve()

const normalisiere = (s) => s.replace(/\s+/g, ' ').trim()

/**
 * @param {string} adresse
 * @returns {Promise<{ lat: number, lon: number, anzeige: string } | null>}
 */
export function geocode(adresse) {
  const schluessel = normalisiere(adresse).toLowerCase()
  if (!schluessel) return Promise.resolve(null)
  if (speicher.has(schluessel)) return Promise.resolve(speicher.get(schluessel) ?? null)
  // Anfragen nacheinander, mindestens 1,1 s Abstand
  const eigene = warteschlange.then(async () => {
    const pause = 1100 - (Date.now() - letzteAnfrage)
    if (pause > 0) await new Promise((r) => setTimeout(r, pause))
    letzteAnfrage = Date.now()
    const url = new URL(ADRESSE)
    url.searchParams.set('q', normalisiere(adresse))
    url.searchParams.set('format', 'jsonv2')
    url.searchParams.set('limit', '1')
    url.searchParams.set('countrycodes', 'de,nl,be,at,ch')
    url.searchParams.set('addressdetails', '0')
    const r = await fetch(url, { headers: { 'User-Agent': KENNUNG, Accept: 'application/json', 'Accept-Language': 'de' } })
    if (!r.ok) throw new Error(`Geokodierung antwortet mit ${r.status}.`)
    const liste = await r.json()
    const erster = Array.isArray(liste) ? liste[0] : null
    const ergebnis = erster
      ? { lat: Number(erster.lat), lon: Number(erster.lon), anzeige: String(erster.display_name ?? '') }
      : null
    speicher.set(schluessel, ergebnis)
    return ergebnis
  })
  warteschlange = eigene.catch(() => undefined)
  return eigene
}
