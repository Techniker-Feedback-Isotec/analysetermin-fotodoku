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
export function anmelden(): void {
  const ziel = encodeURIComponent(window.location.pathname + window.location.search)
  window.location.href = `/.auth/login/aad?post_login_redirect_uri=${ziel}`
}

export function abmelden(): void {
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

/** Link zur Aufgabe in MeisterTask. */
export const meistertaskLink = (token: string) => `https://www.meistertask.com/app/task/${token}`

/**
 * Ein POST an die Gemini-Weiterleitung. Liefert die Antwort roh zurueck, die
 * Fehlerbehandlung liegt beim Aufrufer (vorschau/lib/gemini.ts kennt Googles
 * Fehlerbilder). Eine abgelaufene Anmeldung wird auch hier erkannt.
 */
export async function geminiAnfrage(art: 'bild' | 'bestand', rumpf: unknown, signal?: AbortSignal): Promise<Response> {
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
