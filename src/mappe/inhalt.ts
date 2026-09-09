/**
 * Inhalt des ISOTEC-Kapitels am Anfang der Angebotsmappe.
 *
 * Alle Aussagen stammen aus Yanns Vault (00 Kontext/Angebot.md, ICP.md,
 * Über mich.md), nichts ist dazuerfunden. Zahlen bitte gegenlesen, bevor die
 * Mappe zum Kunden geht.
 *
 * Schreibstil nach 00 Kontext/Schreibstil.md: gesiezt, sachlich, ohne
 * Gedankenstriche, ohne Emojis, nicht ausschweifend.
 */

export interface UspPunkt {
  /** Kurze Ueberschrift, zwei bis vier Woerter */
  titel: string
  /** Ein bis zwei Saetze */
  text: string
  /** Kennzahl fuer die Varianten, die eine Zahl gross zeigen (optional) */
  zahl?: string
}

export const KAPITEL_TITEL = 'Warum ISOTEC'

export const KAPITEL_EINLEITUNG =
  'Feuchtigkeit im Gebäude hat immer eine Ursache. Wir suchen sie, bevor wir abdichten, und schlagen Ihnen anschließend genau die Maßnahmen vor, die zum Schaden passen. Auf den folgenden Seiten finden Sie unsere Unterlagen zu Ihrem Objekt.'

export const USPS: UspPunkt[] = [
  {
    zahl: '30',
    titel: 'Jahre Erfahrung',
    text: 'ISOTEC ist Marktführer für Gebäudeabdichtung. Was wir bei Ihnen einsetzen, hat sich über Jahrzehnte an Tausenden Objekten bewährt.',
  },
  {
    zahl: '10',
    titel: 'Jahre Gewährleistung',
    text: 'Doppelt so lange wie gesetzlich vorgeschrieben. Sollte doch einmal etwas sein, begleitet Sie ein Techniker persönlich, der seit 20 Jahren bei uns ist.',
  },
  {
    titel: 'Geprüfte Verfahren',
    text: 'Unsere Abdichtungssysteme sind nach den WTA-Merkblättern 4 bis 6 geprüft. Die Materialien entwickeln und produzieren wir im eigenen Haus.',
  },
  {
    titel: 'Analyse vor Angebot',
    text: 'Ein Bausachverständiger sieht sich den Schaden an und ermittelt die Ursache. Diese Analyse ist für Sie unverbindlich und kostenfrei.',
  },
  {
    titel: 'Eigene Fachleute',
    text: 'Wir arbeiten mit fest angestellten, geschulten Technikern statt mit wechselnden Subunternehmern. Am Standort Neukirchen-Vluyn sind das rund 30 Mitarbeiter.',
  },
  {
    titel: 'Saubere Baustelle',
    text: 'Wir schützen Ihre Räume, halten die Baustelle sauber und dokumentieren jeden Arbeitsschritt. Sie wissen jederzeit, was passiert ist und was als Nächstes kommt.',
  },
]

/** Schlusszeile unter den Punkten. */
export const KAPITEL_SCHLUSS =
  'Abdichtungstechnik Dipl.-Ing. Morscheck GmbH, Ihr ISOTEC-Fachbetrieb für Neukirchen-Vluyn und die Region.'
