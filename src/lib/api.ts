/**
 * Die Aufrufe an den eigenen Server (/api/*). In der Entwicklung antwortet der
 * Dev-Server (vite.config.ts), auf Azure server/index.mjs – dieselben Pfade.
 *
 * Auf Azure sitzt Easy Auth davor. Eine abgelaufene Anmeldung sieht fuer
 * fetch wie ein Erfolg aus: die Umleitung zur Anmeldeseite wird verfolgt und
 * liefert deren HTML mit Status 200. Jeder Aufruf prueft deshalb, ob JSON
 * zurueckkam, und schickt sonst einmal je Sitzung zur Anmeldung.
 */

export interface Ich {
  /** E-Mail der angemeldeten Person, klein geschrieben; null in der Entwicklung ohne Wert */
  email: string | null
  /** Anzeigename aus dem Konto ("Yann Feyen") */
  name: string | null
  anmeldung: 'easyauth' | 'entwicklung'
  /** Ob der Server ein MeisterTask-Token hat (Kundensuche moeglich) */
  meistertask: boolean
  /** Ob der Server einen Gemini-Schluessel hat (Sanierungsvorschau moeglich) */
  gemini: boolean
  /** Ob Easy Auth ein Graph-Token mitgibt (OneDrive des Nutzers lesbar); fehlt bei alten Servern */
  onedrive?: boolean
}

/** Ergebnis der Geokodierung einer Adresse (server/geocode.mjs) */
export interface StandortTreffer {
  lat: number
  lon: number
  anzeige: string
}

/** Ein Foto oder Video aus OneDrive nahe der Objektadresse (server/graph.mjs) */
export interface Aufnahme {
  id: string
  name: string
  groesse: number
  mime: string
  art: 'foto' | 'video'
  /** Aufnahmezeit, ISO */
  aufgenommen: string
  lat: number | null
  lon: number | null
  /** Meter bis zur Objektadresse */
  entfernung: number
}

export interface AufnahmenAntwort {
  treffer: Aufnahme[]
  /** Aufnahmen im Zeitfenster insgesamt */
  geprueft: number
  /** davon ohne Standort */
  ohneStandort: number
  ordner: string[]
  hinweis?: string
}

/** Eine Aufgabe aus dem Ersttermine-Board, wie die Suchliste sie zeigt. */
export interface KundenEintrag {
  id: number
  projekt: number
  /** Token der Aufgabe fuer den Link in MeisterTask */
  token: string
  spalte: string
  titel: string
  /** "Name, Ort" */
  anzeige: string
}

export interface Kundenliste {
  board: string | null
  /**
   * Welche Art Board durchsucht wurde: 'ersttermine' (Vertrieb, nur die drei
   * Spalten des Ablaufs) oder 'reklamation' (technische Leitung, alle offenen
   * Vorgaenge des Reklamationsboards).
   */
  art: 'ersttermine' | 'reklamation'
  eintraege: KundenEintrag[]
  /** Warum es keine Liste gibt (kein Board fuer diesen Namen) */
  grund?: string
}

/** Die Feldwerte einer Aufgabe; leer, wenn das Feld nicht belegt ist. */
export interface KundendatenAusMeisterTask {
  kunde: string
  kundenadresse: string
  objektadresse: string
  baujahr: string
  objektart: string
}

const SITZUNG_VERSUCHT = 'dokumentation-anmeldung-versucht'

/** Schickt zur Microsoft-Anmeldung und kehrt danach hierher zurueck. */
/**
 * Testumgebung auf GitHub Pages (Zweig `entwicklung`, seit 12.09.2026): dort
 * gibt es keinen Server. Ohne diesen Schalter bekaeme /api/ich die HTML-404-
 * Seite von GitHub, die App hielte das fuer eine abgelaufene Anmeldung und
 * schickte den Browser zu /.auth/login, das es auf github.io nicht gibt.
 * Gesetzt wird der Schalter nur im Workflow (.github/workflows/testumgebung.yml).
 */
export const OHNE_SERVER = import.meta.env.VITE_OHNE_SERVER === '1'

const OHNE_SERVER_TEXT =
  'Testumgebung ohne Server: Kundensuche, MeisterTask-Ablage und Sanierungsvorschau gibt es nur auf Azure.'

export function anmelden(): void {
  if (OHNE_SERVER) return
  const ziel = encodeURIComponent(window.location.pathname + window.location.search)
  window.location.href = `/.auth/login/aad?post_login_redirect_uri=${ziel}`
}

export function abmelden(): void {
  if (OHNE_SERVER) return
  window.location.href = '/.auth/logout?post_logout_redirect_uri=/'
}

function anmeldungFehlt(r: Response): boolean {
  if (r.status === 401 || r.status === 403) return true
  return !(r.headers.get('Content-Type') ?? '').includes('json')
}

/**
 * Nur einmal je Browsersitzung zur Anmeldung schicken – sonst dreht sich die
 * Seite im Kreis, wenn nicht die Sitzung das Problem ist, sondern der Server.
 */
function erneutAnmelden(): void {
  try {
    if (sessionStorage.getItem(SITZUNG_VERSUCHT)) return
    sessionStorage.setItem(SITZUNG_VERSUCHT, '1')
  } catch {
    // privates Fenster: dann eben ohne Schutz
  }
  anmelden()
}

export class ApiFehler extends Error {
  status: number
  constructor(nachricht: string, status: number) {
    super(nachricht)
    this.status = status
  }
}

async function hole<T>(pfad: string): Promise<T> {
  if (OHNE_SERVER) throw new ApiFehler(OHNE_SERVER_TEXT, 0)
  let r: Response
  try {
    r = await fetch(pfad, { headers: { Accept: 'application/json' }, cache: 'no-store' })
  } catch {
    throw new ApiFehler('Keine Verbindung zum Server. Internetverbindung prüfen.', 0)
  }
  if (anmeldungFehlt(r)) {
    erneutAnmelden()
    throw new ApiFehler('Die Anmeldung ist abgelaufen. Die Seite meldet sich neu an.', r.status)
  }
  const daten = (await r.json()) as T & { fehler?: string }
  if (!r.ok) throw new ApiFehler(daten.fehler ?? `Der Server antwortet mit ${r.status}.`, r.status)
  return daten
}

export const ladeIch = () => hole<Ich>('/api/ich')

export const ladeKundenliste = (mitarbeiter: string) =>
  hole<Kundenliste>(`/api/kunden?mitarbeiter=${encodeURIComponent(mitarbeiter)}`)

export const ladeKundendaten = (eintrag: KundenEintrag) =>
  hole<KundendatenAusMeisterTask>(`/api/kunden/${eintrag.id}?projekt=${eintrag.projekt}`)

export const ladeStandort = (adresse: string) =>
  hole<{ standort: StandortTreffer | null }>(`/api/geocode?adresse=${encodeURIComponent(adresse)}`)

export const ladeAufnahmen = (p: { seit: string; bis: string; lat: number; lon: number; radius: number }) =>
  hole<AufnahmenAntwort>(
    `/api/onedrive/aufnahmen?seit=${encodeURIComponent(p.seit)}&bis=${encodeURIComponent(p.bis)}&lat=${p.lat}&lon=${p.lon}&radius=${p.radius}`,
  )

/**
 * Eine Aufnahme aus OneDrive als Datei holen. Der Server streamt den Inhalt;
 * Name, Typ und Aufnahmezeit kommen aus der Liste, damit die Fotoseite das
 * Datum wie bei einer selbst gewaehlten Datei liest.
 */
export async function ladeOneDriveDatei(a: Aufnahme): Promise<File> {
  if (OHNE_SERVER) throw new ApiFehler(OHNE_SERVER_TEXT, 0)
  let r: Response
  try {
    r = await fetch(`/api/onedrive/datei/${encodeURIComponent(a.id)}`, { cache: 'no-store' })
  } catch {
    throw new ApiFehler('Keine Verbindung zum Server. Internetverbindung prüfen.', 0)
  }
  const typ = r.headers.get('Content-Type') ?? ''
  if (typ.includes('json')) {
    const daten = (await r.json()) as { fehler?: string }
    throw new ApiFehler(daten.fehler ?? `Der Server antwortet mit ${r.status}.`, r.status)
  }
  if (r.status === 401 || r.status === 403 || typ.includes('text/html')) {
    erneutAnmelden()
    throw new ApiFehler('Die Anmeldung ist abgelaufen. Die Seite meldet sich neu an.', r.status)
  }
  if (!r.ok) throw new ApiFehler(`Der Server antwortet mit ${r.status}.`, r.status)
  const blob = await r.blob()
  const zeit = Date.parse(a.aufgenommen)
  return new File([blob], a.name, { type: a.mime || blob.type, lastModified: Number.isNaN(zeit) ? Date.now() : zeit })
}

/**
 * Easy Auth ein frisches Graph-Token holen lassen (Token-Speicher, Scope
 * offline_access). Liefert true, wenn es geklappt hat.
 */
export async function onedriveAuffrischen(): Promise<boolean> {
  try {
    const r = await fetch('/.auth/refresh', { cache: 'no-store' })
    return r.ok
  } catch {
    return false
  }
}

/** Link zur Aufgabe in MeisterTask. */
export const meistertaskLink = (token: string) => `https://www.meistertask.com/app/task/${token}`

export interface AnhangErgebnis {
  id: number
  name: string
  /** Namen der Anhaenge derselben Art, die dafuer entfernt wurden */
  ersetzt: string[]
}

/**
 * Ein Dokument in die Kundenaufgabe in MeisterTask legen (Yann, 11.09.2026).
 * Der Server ersetzt dort vorhandene Anhaenge derselben Art, damit je Art nur
 * ein Original liegt. Die Datei geht roh im Rumpf, der Name als Parameter.
 */
export async function legeInMeisterTaskAb(aufgabeId: number, art: string, datei: File): Promise<AnhangErgebnis> {
  if (OHNE_SERVER) throw new ApiFehler(OHNE_SERVER_TEXT, 0)
  let r: Response
  try {
    r = await fetch(
      `/api/kunden/${aufgabeId}/anhang?art=${encodeURIComponent(art)}&name=${encodeURIComponent(datei.name)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': datei.type || 'application/octet-stream', Accept: 'application/json' },
        body: datei,
      },
    )
  } catch {
    throw new ApiFehler('Keine Verbindung zum Server. Internetverbindung prüfen.', 0)
  }
  if (anmeldungFehlt(r)) {
    erneutAnmelden()
    throw new ApiFehler('Die Anmeldung ist abgelaufen. Die Seite meldet sich neu an.', r.status)
  }
  const daten = (await r.json()) as AnhangErgebnis & { fehler?: string }
  if (!r.ok) throw new ApiFehler(daten.fehler ?? `Der Server antwortet mit ${r.status}.`, r.status)
  return daten
}

/**
 * Ein POST an die Gemini-Weiterleitung. Liefert die Antwort roh zurueck, die
 * Fehlerbehandlung liegt beim Aufrufer (vorschau/lib/gemini.ts kennt Googles
 * Fehlerbilder). Eine abgelaufene Anmeldung wird auch hier erkannt.
 */
export async function geminiAnfrage(art: 'bild' | 'bestand', rumpf: unknown, signal?: AbortSignal): Promise<Response> {
  if (OHNE_SERVER) throw new ApiFehler(OHNE_SERVER_TEXT, 0)
  const r = await fetch(`/api/gemini/${art}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(rumpf),
    signal,
  })
  if (anmeldungFehlt(r)) {
    erneutAnmelden()
    throw new ApiFehler('Die Anmeldung ist abgelaufen. Die Seite meldet sich neu an.', r.status)
  }
  return r
}
