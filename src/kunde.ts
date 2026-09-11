import { SALESPEOPLE } from './data/salespeople'
import type { PreparedImage } from './lib/bilder'

/**
 * Die Angaben zum Termin werden einmal auf der Seite "Kunde" gepflegt und
 * gelten fuer alle Dokumente: Fotodokumentation, Videodokumentation und
 * Prinzipskizze lesen daraus, keine Seite fragt etwas doppelt ab.
 */

/** Terminarten der Fotodokumentation; die Prinzipskizze ist eine eigene Seite. */
export const TERMINARTEN = ['Analysetermin', 'Reklamation'] as const
export type Terminart = (typeof TERMINARTEN)[number]

/** Dropdown-Wert fuer "Anderer Name (selbst eingeben)" */
export const CUSTOM_VALUE = '__custom__'

export interface Kundendaten {
  /** Name aus der Mitarbeiterliste, CUSTOM_VALUE fuer freie Eingabe, oder '' */
  mitarbeiterAuswahl: string
  /** Frei eingegebener Name, wenn mitarbeiterAuswahl === CUSTOM_VALUE */
  mitarbeiterEigen: string
  kunde: string
  /** Anschrift des Kunden; wird immer gepflegt und steht auf jedem Deckblatt */
  kundenadresse: string
  /** Nur wenn das Objekt anderswo liegt als der Kunde wohnt; leer = gleiche Anschrift */
  objektadresse: string
  /** Optionales Termindatum (JJJJ-MM-TT); ueberschreibt die Erkennung aus den Fotos */
  termindatum: string
  /** Landet nur bei Reklamationen in der PDF */
  auftragsnummer: string
  /** Baujahr des Objekts, frei ("1971", "190x"); kommt meist aus MeisterTask */
  baujahr: string
  /** Gewerke des Sanierungskonzepts; leer = kein Block auf dem Deckblatt */
  gewerke: string[]
  /** Objektfoto fuer das Deckblatt der PDF-Dokumente */
  objektfoto: PreparedImage | null
  /** Die MeisterTask-Aufgabe, aus der die Angaben uebernommen wurden, oder null */
  meistertask: { id: number; token: string; titel: string } | null
}

export const LEERE_KUNDENDATEN: Kundendaten = {
  mitarbeiterAuswahl: '',
  mitarbeiterEigen: '',
  kunde: '',
  kundenadresse: '',
  objektadresse: '',
  termindatum: '',
  auftragsnummer: '',
  baujahr: '',
  gewerke: [],
  objektfoto: null,
  meistertask: null,
}

/** Fuer den Vergleich zweier Anschriften: klein, ohne Satzzeichen und doppelte Leerzeichen. */
const glatt = (s: string) => s.toLowerCase().replace(/[,\n]/g, ' ').replace(/\s+/g, ' ').trim()

/**
 * Die Anschriften aus einer MeisterTask-Aufgabe in die Regel des Werkzeugs
 * uebersetzen: Kundenadresse immer, Objektadresse nur bei Abweichung (Yann,
 * 08.09.2026). Im Board ist oft nur "Anschrift (OBJEKT)" gefuellt – dann ist
 * das die Kundenadresse.
 */
export function anschriftenAus(kundenadresse: string, objektadresse: string): Pick<Kundendaten, 'kundenadresse' | 'objektadresse'> {
  const kunde = kundenadresse.trim() || objektadresse.trim()
  const objekt = objektadresse.trim()
  return {
    kundenadresse: kunde,
    objektadresse: objekt && glatt(objekt) !== glatt(kunde) ? objekt : '',
  }
}

/**
 * Welcher Eintrag der Mitarbeiterliste zur angemeldeten Person gehoert.
 * Zuerst der Anzeigename aus dem Konto ("Yann Feyen"), sonst der Nachname vor
 * dem @ der Mailadresse (feyen@…). Die Mailadressen anderer Systeme passen
 * nicht immer zur Anmelde-Mail, deshalb nie nur auf die Mail bauen.
 */
export function mitarbeiterFuerAnmeldung(ich: { name: string | null; email: string | null }): string | null {
  const namen = SALESPEOPLE.map((s) => s.name)
  if (ich.name) {
    const gesucht = glatt(ich.name)
    const treffer = namen.find((n) => glatt(n) === gesucht)
    if (treffer) return treffer
  }
  const lokal = ich.email?.split('@')[0]?.toLowerCase()
  if (lokal) {
    const treffer = namen.filter((n) => glatt(n).split(' ').pop() === lokal)
    if (treffer.length === 1) return treffer[0]
  }
  return null
}

export interface Mitarbeiter {
  /** Anzeigename; leer, wenn noch niemand gewaehlt ist */
  name: string
  /** Foto aus der Mitarbeiterliste, oder null (freier Name) */
  foto: string | null
  eigen: boolean
}

export function mitarbeiterVon(daten: Kundendaten): Mitarbeiter {
  const eigen = daten.mitarbeiterAuswahl === CUSTOM_VALUE
  if (eigen) return { name: daten.mitarbeiterEigen.trim(), foto: null, eigen }
  const eintrag = SALESPEOPLE.find((s) => s.name === daten.mitarbeiterAuswahl)
  return { name: daten.mitarbeiterAuswahl, foto: eintrag?.url ?? null, eigen }
}

/**
 * Anschrift des Objekts fuer die Beschriftung eines Deckblatts.
 *
 * Gepflegt wird die Kundenadresse; die Objektadresse wird nur ausgefuellt, wenn
 * das Objekt anderswo liegt. Bleibt sie leer, sind beide gleich - dann steht
 * unter dem Objektfoto "siehe Kundenadresse" (Vorgabe Yann, 08.09.2026), denn
 * die Kundenadresse steht auf demselben Deckblatt im Infoblock links.
 */
export function objektadresseText(daten: Kundendaten): string {
  const objekt = daten.objektadresse.trim()
  if (objekt) return objekt
  return daten.kundenadresse.trim() ? 'siehe Kundenadresse' : ''
}

/**
 * Die tatsaechliche Anschrift des Objekts, ohne Verweis: bei gleicher Anschrift
 * ist das die Kundenadresse. Fuer Dateinamen und das Video-Deckblatt, wo kein
 * Verweis auf eine andere Zeile moeglich ist.
 */
export function objektadresseEcht(daten: Kundendaten): string {
  return daten.objektadresse.trim() || daten.kundenadresse.trim()
}

/** Manuelles Termindatum als Zeitstempel (12 Uhr, damit Zeitzonen das Datum nicht kippen) */
export function manuellesTermindatum(daten: Kundendaten): number | null {
  const m = daten.termindatum.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0)
  return Number.isNaN(d.getTime()) ? null : d.getTime()
}

/** Ein erstelltes oder hochgeladenes Dokument, gesammelt auf der Seite Kunde */
export interface Dokument {
  id: string
  /** Fachlicher Schluessel; ein neues Dokument mit gleichem Schluessel ersetzt das alte */
  schluessel: string
  name: string
  art: 'pdf' | 'video'
  blob: Blob
  url: string
  /** Seite, auf der es entstanden ist; bei fremden PDFs "Hochgeladen" */
  quelle: string
  /**
   * Ueberschrift im Inhaltsverzeichnis und auf dem Trennblatt der Mappe. Bei
   * erstellten Unterlagen ist das die Quelle, bei hochgeladenen der erkannte
   * oder eingetragene Titel (Yann, 11.09.2026: Angebot und fertige
   * Prinzipskizze sollen Bestandteil der Mappe sein und im Inhalt stehen).
   */
  titel: string
  /**
   * Von aussen hochgeladen statt hier erstellt. Solche PDFs haben kein eigenes
   * Deckblatt, das die Mappe weglassen koennte: alle Seiten kommen mit.
   */
  hochgeladen: boolean
  erstellt: number
}

/** Quelle der von aussen hochgeladenen PDFs */
export const QUELLE_HOCHGELADEN = 'Hochgeladen'

/**
 * Vorgegebene Reihenfolge der Unterlagen in der Angebotsmappe (Yann,
 * 11.09.2026): Prinzipskizze, Angebot, Fotodokumentation. Die
 * Sanierungsvorschau gehoert fachlich zur Prinzipskizze und steht deshalb
 * hinter ihr; alles Unbekannte kommt ans Ende. Umsortieren geht in der
 * Mappenliste, das hier ist nur der Startplatz.
 */
const MAPPEN_RANG = ['Prinzipskizze', 'Sanierungsvorschau', 'Angebot', 'Fotodokumentation']

/** Startplatz einer Unterlage in der Mappe; kleiner = weiter vorn. */
export function mappenRang(dok: Dokument): number {
  const i = MAPPEN_RANG.findIndex((t) => t.toLowerCase() === dok.titel.trim().toLowerCase())
  return i < 0 ? MAPPEN_RANG.length : i
}

/** Kann diese Datei in die Mappe? Nur PDFs, und die Mappe selbst nicht noch einmal. */
export function mappenFaehig(dok: Dokument): boolean {
  return dok.art === 'pdf' && dok.quelle !== 'Angebotsmappe'
}

/**
 * Titel einer hochgeladenen PDF aus ihrem Dateinamen raten: "Angebot" und
 * "Prinzipskizze" werden erkannt, alles andere behaelt seinen Namen ohne
 * Endung. Der Titel bleibt in der Mappenliste aenderbar.
 */
export function titelAusDateiname(dateiname: string): string {
  const ohneEndung = dateiname.replace(/\.pdf$/i, '').trim()
  if (/angebot/i.test(ohneEndung)) return 'Angebot'
  if (/prinzip|skizze/i.test(ohneEndung)) return 'Prinzipskizze'
  return ohneEndung || 'Dokument'
}

export type ToastKind = 'info' | 'error' | 'success'
export type ToastFn = (kind: ToastKind, text: string) => void
/** Meldet ein fertiges Dokument (oder null = entfernen) an die Sammlung auf der Seite Kunde */
export type DokumentFn = (schluessel: string, quelle: string, datei: File | null) => void
/** Nimmt eine von aussen mitgebrachte PDF in die Sammlung auf */
export type HochladenFn = (datei: File) => void
