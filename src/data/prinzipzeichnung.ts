import vor1970 from '../assets/prinzipzeichnungen/vor-1970-streifenfundament.pdf'
import ab1970 from '../assets/prinzipzeichnungen/ab-1970-bodenplatte.pdf'

/**
 * Vorgezeichneter Wandquerschnitt auf der Seite "Bauzeichnungen" der
 * Prinzipskizze (Yann, 10.09.2026).
 *
 * Welche der beiden Zeichnungen passt, entscheidet das Baujahr: Bauten vor
 * 1970 stehen auf einem Streifenfundament, spaetere auf einer durchgaengigen
 * Bodenplatte. Ohne Baujahr wird keine eingefuegt, denn dann waere die Wahl
 * geraten.
 *
 * Ausgenommen sind Treppe und alles rund um den Balkon: Fuer diese Gewerke
 * passt der Wandquerschnitt nicht.
 *
 * Die Vorlagen sind die Originale aus Yanns Ordner "Skizzenvorlagen Tablet"
 * (OneDrive, Außendienst 2025_01 Zeichnungen Vertrieb) und liegen als Vektor-PDF
 * bei, bleiben also in jeder Groesse scharf. Sie werden nicht als Bild
 * gerechnet, sondern als Seite eingebettet.
 */

/** Ab diesem Baujahr gilt die zweite Zeichnung (1970 selbst gehoert dazu). */
const GRENZE = 1970

/** Gewerke, zu denen der Wandquerschnitt nicht passt. */
const OHNE_ZEICHNUNG = /^(treppe|balkon)/i

export interface Zeichnungsvorlage {
  /** Adresse der PDF-Vorlage */
  url: string
  /**
   * Der bezeichnete Bereich der Vorlagenseite in Punkt (links, unten, rechts,
   * oben). Die Vorlagen sind A4-Seiten mit viel Weissraum; ohne diesen
   * Zuschnitt saesse die Zeichnung winzig in der Ecke. Gemessen am Rendering
   * der Originale (10.09.2026).
   */
  box: { left: number; bottom: number; right: number; top: number }
}

const VOR: Zeichnungsvorlage = {
  url: vor1970,
  box: { left: 176, bottom: 226, right: 417, top: 610 },
}

const AB: Zeichnungsvorlage = {
  url: ab1970,
  box: { left: 174, bottom: 246, right: 421, top: 592 },
}

/** Die Jahreszahl aus dem Feld Baujahr, oder null ("1971", "ca. 1965", "190x"). */
export function baujahrZahl(baujahr: string): number | null {
  const treffer = /\b(1[6-9]\d{2}|20\d{2})\b/.exec(baujahr)
  if (!treffer) return null
  return Number(treffer[1])
}

/** Nur Treppe und Balkon gewaehlt? Dann passt der Querschnitt nicht. */
function nurOhneZeichnung(gewerke: string[]): boolean {
  return gewerke.length > 0 && gewerke.every((g) => OHNE_ZEICHNUNG.test(g))
}

/**
 * Die passende Vorlage, oder null.
 * null heisst: Seite bleibt leer wie bisher.
 */
export function zeichnungFuer(baujahr: string, gewerke: string[]): Zeichnungsvorlage | null {
  const jahr = baujahrZahl(baujahr)
  if (jahr === null) return null
  if (nurOhneZeichnung(gewerke)) return null
  return jahr < GRENZE ? VOR : AB
}

/** Kurze Erklaerung fuer die Oberflaeche, warum eine Zeichnung kommt oder nicht. */
export function zeichnungHinweis(baujahr: string, gewerke: string[]): string {
  const jahr = baujahrZahl(baujahr)
  if (jahr === null) return 'Ohne Baujahr bleibt die Seite Bauzeichnungen leer.'
  if (nurOhneZeichnung(gewerke)) {
    return 'Für Treppe und Balkon gibt es keinen passenden Querschnitt, die Seite bleibt leer.'
  }
  return jahr < GRENZE
    ? `Baujahr ${jahr}: Querschnitt mit Streifenfundament wird eingefügt.`
    : `Baujahr ${jahr}: Querschnitt mit durchgängiger Bodenplatte wird eingefügt.`
}
