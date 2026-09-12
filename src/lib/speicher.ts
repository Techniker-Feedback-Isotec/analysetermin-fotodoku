import type { PreparedImage, TerminPhoto } from './bilder'
import type { Reichtext } from './richtext'
import type { Dokument, Kundendaten, Terminart } from '../kunde'

/**
 * Speicher im Geraet (IndexedDB), damit ein Vertriebler seine Vorgaenge
 * fortlaufend wiederfindet, statt nach jeder Sitzung von vorn zu beginnen
 * (Yann, 11.09.2026: "starte mit Weg A"). Nichts verlaesst das Geraet: Der
 * Browser haelt Kundendaten, Fotos und fertige Dokumente in seiner eigenen
 * Datenbank, Fotos und PDFs als Blob, so wie sie im Speicher schon liegen.
 *
 * Drei Tabellen, damit nicht bei jedem Tastendruck 300 MB Fotos neu
 * geschrieben werden:
 *   - vorgaenge:  Kopf, Kundendaten, Zustand der Fotoseiten, Mappenauswahl
 *   - fotos:      je Foto ein Satz, mit Verweis auf den Vorgang
 *   - dokumente:  je fertiges oder hochgeladenes Dokument ein Satz
 *   - seiten:     Arbeitsdaten der Sanierungsvorschau und der Videoseite je
 *                 Vorgang (seit 12.09.2026, Version 2), ein Satz je Seite
 *
 * Nicht gespeichert werden fluechtige Felder: Blob-Adressen (thumbUrl, url)
 * entstehen beim Laden neu. Sanierungsvorschau und Videoseite legen ihre
 * Arbeitsdaten seit dem 12.09.2026 in der Tabelle seiten ab (Yann: "alle
 * Daten muessen immer zum Projekt passen und gespeichert werden").
 *
 * Grenzen: je Geraet und Browser. Was am iPad angelegt wird, sieht der PC
 * nicht. Safari raeumt Website-Daten nach 7 Tagen Nichtnutzung weg, ausser
 * die App liegt als Symbol auf dem Startbildschirm; `persistenzAnfordern`
 * bittet den Browser zusaetzlich um Dauerhaftigkeit.
 */

const DB_NAME = 'dokumentation'
const DB_VERSION = 2
const AKTIV_SCHLUESSEL = 'dokumentation.aktiverVorgang'

/** Ab diesem Alter gilt ein Vorgang als alt und wird zum Loeschen vorgeschlagen */
export const ALT_NACH_TAGEN = 90

/** Was die Fotoseite (Fotodokumentation oder Prinzipskizze) an Zustand hat */
export interface SeitenZustand {
  terminart: Terminart
  /** Fotos des gemeinsamen Stapels, die auf dieser Seite nicht mitsollen */
  ausgeschlossen: string[]
  /** Eigene Reihenfolge; null = chronologisch */
  sortierung: string[] | null
  keepDuplicates: boolean
  extraCompression: boolean
  beurteilung: Reichtext
  zusammenfassung: Reichtext
}

export const LEERER_SEITENZUSTAND: SeitenZustand = {
  terminart: 'Analysetermin',
  ausgeschlossen: [],
  sortierung: null,
  keepDuplicates: false,
  extraCompression: true,
  beurteilung: [],
  zusammenfassung: [],
}

/** Auswahl und Reihenfolge der Angebotsmappe (Dokument-Ids) */
export interface MappenZustand {
  nichtInMappe: string[]
  mappenFolge: string[]
}

export const LEERER_MAPPENZUSTAND: MappenZustand = { nichtInMappe: [], mappenFolge: [] }

/** Eigene Texte der Praesentation (Seite Praesentation, seit 12.09.2026) */
export interface PraesentationZustand {
  /** Soll-Situation: wie es nach der Sanierung aussehen soll */
  soll: Reichtext
  /** Sanierungsziel */
  ziel: Reichtext
}

export const LEERE_PRAESENTATION: PraesentationZustand = { soll: [], ziel: [] }

/** Seiten, die ihre Arbeitsdaten als eigenen Satz je Vorgang ablegen */
export type SeitenName = 'vorschau' | 'video'

interface SeitenSatz {
  /** `${vorgangId}:${seite}` */
  id: string
  vorgangId: string
  seite: SeitenName
  daten: unknown
}

/** Kundendaten ohne Blob-Adresse am Objektfoto */
export type KundendatenSatz = Omit<Kundendaten, 'objektfoto'> & {
  objektfoto: Omit<PreparedImage, 'thumbUrl'> | null
}

export interface VorgangSatz {
  id: string
  /** E-Mail der angemeldeten Person beim Anlegen, oder null (Entwicklung) */
  besitzer: string | null
  erstellt: number
  geaendert: number
  kunde: KundendatenSatz
  seiten: { fotodoku: SeitenZustand; prinzipskizze: SeitenZustand }
  mappe: MappenZustand
  /** Fehlt bei Saetzen vor dem 12.09.2026 */
  praesentation?: PraesentationZustand
  /** Fuer die Liste, ohne die Fotos laden zu muessen */
  anzahlFotos: number
  anzahlDokumente: number
}

export type FotoSatz = Omit<TerminPhoto, 'thumbUrl'> & { vorgangId: string }
export type DokumentSatz = Omit<Dokument, 'url'> & { vorgangId: string }

let dbVersprechen: Promise<IDBDatabase> | null = null

/** Steht IndexedDB zur Verfuegung? (Private Fenster mancher Browser: nein) */
export function speicherVerfuegbar(): boolean {
  return typeof indexedDB !== 'undefined'
}

function oeffne(): Promise<IDBDatabase> {
  if (dbVersprechen) return dbVersprechen
  dbVersprechen = new Promise((erfuellt, abgelehnt) => {
    const anfrage = indexedDB.open(DB_NAME, DB_VERSION)
    anfrage.onupgradeneeded = () => {
      const db = anfrage.result
      if (!db.objectStoreNames.contains('vorgaenge')) {
        db.createObjectStore('vorgaenge', { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains('fotos')) {
        db.createObjectStore('fotos', { keyPath: 'id' }).createIndex('vorgang', 'vorgangId')
      }
      if (!db.objectStoreNames.contains('dokumente')) {
        db.createObjectStore('dokumente', { keyPath: 'id' }).createIndex('vorgang', 'vorgangId')
      }
      if (!db.objectStoreNames.contains('seiten')) {
        db.createObjectStore('seiten', { keyPath: 'id' }).createIndex('vorgang', 'vorgangId')
      }
    }
    anfrage.onsuccess = () => {
      const db = anfrage.result
      // Wird die Datenbank anderswo geloescht oder erneuert, beim naechsten Mal neu oeffnen
      db.onversionchange = () => {
        db.close()
        dbVersprechen = null
      }
      erfuellt(db)
    }
    anfrage.onerror = () => {
      dbVersprechen = null
      abgelehnt(anfrage.error ?? new Error('IndexedDB lässt sich nicht öffnen'))
    }
  })
  return dbVersprechen
}

/** Eine Anfrage in ein Promise verpacken */
function warte<T>(anfrage: IDBRequest<T>): Promise<T> {
  return new Promise((erfuellt, abgelehnt) => {
    anfrage.onsuccess = () => erfuellt(anfrage.result)
    anfrage.onerror = () => abgelehnt(anfrage.error ?? new Error('Speicherzugriff fehlgeschlagen'))
  })
}

/** Auf den Abschluss einer Transaktion warten */
function fertig(tx: IDBTransaction): Promise<void> {
  return new Promise((erfuellt, abgelehnt) => {
    tx.oncomplete = () => erfuellt()
    tx.onerror = () => abgelehnt(tx.error ?? new Error('Speichern fehlgeschlagen'))
    tx.onabort = () => abgelehnt(tx.error ?? new Error('Speichern abgebrochen'))
  })
}

// ---------- Vorgaenge ----------

export async function ladeVorgaenge(): Promise<VorgangSatz[]> {
  const db = await oeffne()
  const alle = await warte(db.transaction('vorgaenge').objectStore('vorgaenge').getAll())
  return (alle as VorgangSatz[]).sort((a, b) => b.geaendert - a.geaendert)
}

export async function ladeVorgang(id: string): Promise<VorgangSatz | undefined> {
  const db = await oeffne()
  return warte(db.transaction('vorgaenge').objectStore('vorgaenge').get(id)) as Promise<VorgangSatz | undefined>
}

export async function speichereVorgang(satz: VorgangSatz): Promise<void> {
  const db = await oeffne()
  const tx = db.transaction('vorgaenge', 'readwrite')
  tx.objectStore('vorgaenge').put(satz)
  await fertig(tx)
}

/** Vorgang samt Fotos und Dokumenten entfernen */
export async function loescheVorgang(id: string): Promise<void> {
  const db = await oeffne()
  const tx = db.transaction(['vorgaenge', 'fotos', 'dokumente', 'seiten'], 'readwrite')
  tx.objectStore('vorgaenge').delete(id)
  for (const name of ['fotos', 'dokumente', 'seiten'] as const) {
    const index = tx.objectStore(name).index('vorgang')
    const schluessel = await warte(index.getAllKeys(id))
    for (const s of schluessel) tx.objectStore(name).delete(s)
  }
  await fertig(tx)
}

// ---------- Fotos ----------

export async function ladeFotos(vorgangId: string): Promise<FotoSatz[]> {
  const db = await oeffne()
  return warte(db.transaction('fotos').objectStore('fotos').index('vorgang').getAll(vorgangId)) as Promise<FotoSatz[]>
}

export async function speichereFotos(saetze: FotoSatz[]): Promise<void> {
  if (saetze.length === 0) return
  const db = await oeffne()
  const tx = db.transaction('fotos', 'readwrite')
  for (const satz of saetze) tx.objectStore('fotos').put(satz)
  await fertig(tx)
}

export async function loescheFotos(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  const db = await oeffne()
  const tx = db.transaction('fotos', 'readwrite')
  for (const id of ids) tx.objectStore('fotos').delete(id)
  await fertig(tx)
}

// ---------- Dokumente ----------

export async function ladeDokumente(vorgangId: string): Promise<DokumentSatz[]> {
  const db = await oeffne()
  return warte(
    db.transaction('dokumente').objectStore('dokumente').index('vorgang').getAll(vorgangId),
  ) as Promise<DokumentSatz[]>
}

export async function speichereDokumente(saetze: DokumentSatz[]): Promise<void> {
  if (saetze.length === 0) return
  const db = await oeffne()
  const tx = db.transaction('dokumente', 'readwrite')
  for (const satz of saetze) tx.objectStore('dokumente').put(satz)
  await fertig(tx)
}

export async function loescheDokumente(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  const db = await oeffne()
  const tx = db.transaction('dokumente', 'readwrite')
  for (const id of ids) tx.objectStore('dokumente').delete(id)
  await fertig(tx)
}

// ---------- Seiten: Arbeitsdaten von Sanierungsvorschau und Video ----------

export async function ladeSeitenDaten<T>(vorgangId: string, seite: SeitenName): Promise<T | null> {
  const db = await oeffne()
  const satz = (await warte(db.transaction('seiten').objectStore('seiten').get(`${vorgangId}:${seite}`))) as
    | SeitenSatz
    | undefined
  return satz ? (satz.daten as T) : null
}

export async function speichereSeitenDaten(vorgangId: string, seite: SeitenName, daten: unknown): Promise<void> {
  const db = await oeffne()
  const tx = db.transaction('seiten', 'readwrite')
  const satz: SeitenSatz = { id: `${vorgangId}:${seite}`, vorgangId, seite, daten }
  tx.objectStore('seiten').put(satz)
  await fertig(tx)
}

// ---------- Aktiver Vorgang, Platz, Dauerhaftigkeit ----------

export function aktiverVorgangId(): string | null {
  try {
    return localStorage.getItem(AKTIV_SCHLUESSEL)
  } catch {
    return null
  }
}

export function merkeAktivenVorgang(id: string | null): void {
  try {
    if (id) localStorage.setItem(AKTIV_SCHLUESSEL, id)
    else localStorage.removeItem(AKTIV_SCHLUESSEL)
  } catch {
    // ohne localStorage startet die App eben mit dem zuletzt geaenderten Vorgang
  }
}

/** Belegter Platz in Bytes, oder null, wenn der Browser es nicht sagt */
export async function speicherverbrauch(): Promise<{ belegt: number; frei: number | null } | null> {
  try {
    if (!navigator.storage?.estimate) return null
    const { usage, quota } = await navigator.storage.estimate()
    if (usage === undefined) return null
    return { belegt: usage, frei: quota === undefined ? null : quota - usage }
  } catch {
    return null
  }
}

/**
 * Den Browser bitten, die Daten nicht bei Platzmangel wegzuraeumen. Auf dem
 * iPhone wirkt das erst, wenn die App auf dem Startbildschirm liegt; im
 * normalen Safari-Tab bleibt die 7-Tage-Regel.
 */
export async function persistenzAnfordern(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false
    if (await navigator.storage.persisted()) return true
    return await navigator.storage.persist()
  } catch {
    return false
  }
}

/** Hat der Vorgang irgendeinen Inhalt? Leere Vorgaenge werden nicht gespeichert. */
export function vorgangIstLeer(
  satz: Pick<VorgangSatz, 'kunde' | 'seiten' | 'anzahlFotos' | 'anzahlDokumente' | 'praesentation'>,
): boolean {
  const k = satz.kunde
  const texte = [
    ...[satz.seiten.fotodoku, satz.seiten.prinzipskizze].flatMap((s) => [s.beurteilung, s.zusammenfassung]),
    satz.praesentation?.soll ?? [],
    satz.praesentation?.ziel ?? [],
  ]
  return (
    satz.anzahlFotos === 0 &&
    satz.anzahlDokumente === 0 &&
    k.kunde.trim() === '' &&
    k.kundenadresse.trim() === '' &&
    k.objektadresse.trim() === '' &&
    k.auftragsnummer.trim() === '' &&
    k.baujahr.trim() === '' &&
    k.gewerke.length === 0 &&
    k.objektfoto === null &&
    k.meistertask === null &&
    texte.every((t) => t.length === 0)
  )
}

/** Alter in Tagen seit der letzten Aenderung */
export function alterInTagen(satz: VorgangSatz, jetzt = Date.now()): number {
  return Math.floor((jetzt - satz.geaendert) / 86_400_000)
}
