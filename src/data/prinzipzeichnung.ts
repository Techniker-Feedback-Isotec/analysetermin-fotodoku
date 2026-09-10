import vor1970 from '../assets/prinzipzeichnungen/vor-1970.png'
import ab1970 from '../assets/prinzipzeichnungen/ab-1970.png'

/**
 * Vorgezeichneter Wandquerschnitt auf der Seite "Bauzeichnungen" der
 * Prinzipskizze (Yann, 10.09.2026).
 *
 * Welche der beiden Zeichnungen passt, entscheidet das Baujahr: Bauten vor
 * 1970 haben einen anderen Wand- und Deckenaufbau als spaetere. Ohne Baujahr
 * wird keine eingefuegt, denn dann waere die Wahl geraten.
 *
 * Ausgenommen sind Treppe und alles rund um den Balkon: Fuer diese Gewerke
 * passt der Wandquerschnitt nicht.
 */

/** Ab diesem Baujahr gilt die zweite Zeichnung (1970 selbst gehoert dazu). */
const GRENZE = 1970

/** Gewerke, zu denen der Wandquerschnitt nicht passt. */
const OHNE_ZEICHNUNG = /^(treppe|balkon)/i

/** Die Jahreszahl aus dem Feld Baujahr, oder null ("1971", "ca. 1965", "190x"). */
export function baujahrZahl(baujahr: string): number | null {
  const treffer = /\b(1[6-9]\d{2}|20\d{2})\b/.exec(baujahr)
  if (!treffer) return null
  return Number(treffer[1])
}

/**
 * Die passende Zeichnung als Adresse, oder null.
 * null heisst: Seite bleibt leer wie bisher.
 */
export function zeichnungFuer(baujahr: string, gewerke: string[]): string | null {
  const jahr = baujahrZahl(baujahr)
  if (jahr === null) return null
  // Nur Treppe und Balkon gewaehlt? Dann passt der Querschnitt nicht.
  if (gewerke.length > 0 && gewerke.every((g) => OHNE_ZEICHNUNG.test(g))) return null
  return jahr < GRENZE ? vor1970 : ab1970
}

/** Kurze Erklaerung fuer die Oberflaeche, warum eine Zeichnung kommt oder nicht. */
export function zeichnungHinweis(baujahr: string, gewerke: string[]): string {
  const jahr = baujahrZahl(baujahr)
  if (jahr === null) return 'Ohne Baujahr bleibt die Seite Bauzeichnungen leer.'
  if (gewerke.length > 0 && gewerke.every((g) => OHNE_ZEICHNUNG.test(g))) {
    return 'Für Treppe und Balkon gibt es keinen passenden Querschnitt, die Seite bleibt leer.'
  }
  return `Baujahr ${jahr}: Querschnitt ${jahr < GRENZE ? 'vor' : 'ab'} 1970 wird eingefügt.`
}
