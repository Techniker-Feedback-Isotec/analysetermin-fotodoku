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
  terminart: Terminart
  /** Name aus der Mitarbeiterliste, CUSTOM_VALUE fuer freie Eingabe, oder '' */
  mitarbeiterAuswahl: string
  /** Frei eingegebener Name, wenn mitarbeiterAuswahl === CUSTOM_VALUE */
  mitarbeiterEigen: string
  kunde: string
  /** Nur bei Reklamation: Anschrift des Kunden, wenn sie vom Objekt abweicht */
  kundenadresse: string
  objektadresse: string
  /** Optionales Termindatum (JJJJ-MM-TT); ueberschreibt die Erkennung aus den Fotos */
  termindatum: string
  /** Nur bei Reklamation */
  auftragsnummer: string
  /** Gewerke des Sanierungskonzepts; leer = kein Block auf dem Deckblatt */
  gewerke: string[]
  /** Objektfoto fuer das Deckblatt der PDF-Dokumente */
  objektfoto: PreparedImage | null
}

export const LEERE_KUNDENDATEN: Kundendaten = {
  terminart: 'Analysetermin',
  mitarbeiterAuswahl: '',
  mitarbeiterEigen: '',
  kunde: '',
  kundenadresse: '',
  objektadresse: '',
  termindatum: '',
  auftragsnummer: '',
  gewerke: [],
  objektfoto: null,
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

/** Manuelles Termindatum als Zeitstempel (12 Uhr, damit Zeitzonen das Datum nicht kippen) */
export function manuellesTermindatum(daten: Kundendaten): number | null {
  const m = daten.termindatum.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0)
  return Number.isNaN(d.getTime()) ? null : d.getTime()
}

/** Ein erstelltes Dokument, gesammelt auf der Seite Kunde */
export interface Dokument {
  id: string
  /** Fachlicher Schluessel; ein neues Dokument mit gleichem Schluessel ersetzt das alte */
  schluessel: string
  name: string
  art: 'pdf' | 'video'
  blob: Blob
  url: string
  /** Seite, auf der es entstanden ist */
  quelle: string
  erstellt: number
}

export type ToastKind = 'info' | 'error' | 'success'
export type ToastFn = (kind: ToastKind, text: string) => void
/** Meldet ein fertiges Dokument (oder null = entfernen) an die Sammlung auf der Seite Kunde */
export type DokumentFn = (schluessel: string, quelle: string, datei: File | null) => void
