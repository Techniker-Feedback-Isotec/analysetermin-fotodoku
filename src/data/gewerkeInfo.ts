/**
 * Erklaerungen und Grafiken zu den ISOTEC-Gewerken fuer die Praesentation
 * (Yann, 12.09.2026: "baue je nachdem, welches Gewerk beim Projekt
 * ausgewaehlt ist, die Grafiken und Erklaerungen in unsere Praesentation ein").
 *
 * Quelle sind die Zentrale-PowerPoints "ISOTEC Gewerke fuer Erstgespraech"
 * (Kapitelbilder, Systemgrafiken) und die Kurzvorstellungen je Gewerk
 * (Schadensbild, vier Ausfuehrungsschritte, Skizze, Vorteile), Stand Mai 2026.
 * Die Bilder liegen als JPEG unter src/assets/gewerke/<id>/ und wurden mit
 * scratchpad/gewerke_assets.py aus den Decks gezogen; die Texte sind die der
 * Folien, sprachlich geglaettet. Neue Gewerke: Ordner anlegen, Eintrag hier.
 */

export interface GewerkInfo {
  id: string
  /** Gewerke der Auswahlliste (data/gewerke.ts), die zu diesem Eintrag fuehren */
  gewerke: string[]
  titel: string
  untertitel: string
  /** Woher der Schaden kommt, als Bildunterschrift zum Schadensbild */
  schaden: string
  /** Beschriftung der vier Ausfuehrungsschritte, wo die Folie sie nennt */
  schritte?: [string, string, string, string]
  vorteile: string[]
}

export const GEWERKE_INFO: GewerkInfo[] = [
  {
    id: 'aussenabdichtung',
    gewerke: ['Außenabdichtung', 'Sockelabdichtung'],
    titel: 'ISOTEC-Außenabdichtung',
    untertitel: 'Flexibel und druckwasserdicht',
    schaden: 'Infolge seitlich eindringender Feuchtigkeit',
    vorteile: [
      'Umweltfreundlich und lösemittelfrei',
      'Sicherer Sanierungserfolg, dauerhafter Schutz',
      'Angenehmes Raumklima nach der Sanierung',
      'Verbesserung der Wärmedämmung',
      'Wertsteigerung der Immobilie',
    ],
  },
  {
    id: 'innenabdichtung',
    gewerke: ['Innenabdichtung'],
    titel: 'ISOTEC-Innenabdichtung',
    untertitel: 'Flexibel und druckwasserdicht',
    schaden: 'Infolge seitlich eindringender Feuchtigkeit',
    vorteile: [
      'Dauerhafter Feuchteschutz von innen',
      'Lösungen für Details: Rohrdurchdringungen, Querwände, Übergänge',
      'Energieeinsparung mit Innendämmsystem als Schutzschicht',
      'Werterhalt der Immobilie',
      'Angenehmes Raumklima nach der Sanierung',
    ],
  },
  {
    id: 'horizontalsperre',
    gewerke: ['Horizontalsperre', 'Injektionscreme'],
    titel: 'ISOTEC-Horizontalsperre',
    untertitel: 'Mit Spezialparaffin',
    schaden: 'Infolge aufsteigender Feuchtigkeit',
    schritte: ['Analysieren', 'Bohren', 'Trocknen', 'Injizieren'],
    vorteile: [
      'Sicherer Sanierungserfolg, unabhängig von der Durchfeuchtung',
      'Dauerhafte Kapillarsperre',
      'Ohne Lösemittel, ohne Belastung für Organismus und Umwelt',
      'Kontrolliertes Austrocknen des Injektionsbereichs',
      'Angenehmes Raumklima nach der Sanierung',
      'Wertsteigerung der Immobilie',
    ],
  },
  {
    id: 'sanierputz',
    gewerke: ['Sanierputz'],
    titel: 'ISOTEC-Sanierputz',
    untertitel: 'Diffusionsoffen und salzspeichernd',
    schaden: 'Infolge seitlich eindringender Feuchtigkeit',
    vorteile: [
      'Schadensfreie Austrocknung des Mauerwerks',
      'Schnelle Nutzung der sanierten Räume',
      'Aufnahme der Salze und Bindung unterhalb der Oberfläche',
      'Verbessertes Wohnklima',
      'Optische Aufwertung',
      'Wertsteigerung der Immobilie',
    ],
  },
  {
    id: 'balkon',
    gewerke: ['Balkon - Kombiflex', 'Balkon - Steinteppich'],
    titel: 'ISOTEC-Balkonsanierung',
    untertitel: 'Langlebig und optisch ansprechend',
    schaden: 'Eindringende Feuchte',
    vorteile: [
      'Dünnschichtiges Beschichtungssystem',
      'Langlebig und leicht zu reinigen',
      'Geprüfte Materialien',
      'Optisch ansprechend',
      'Transparente Kosten',
      'Wertsteigerung der Immobilie',
    ],
  },
  {
    id: 'balkon-pmma',
    gewerke: ['Balkon - PMMA'],
    titel: 'ISOTEC-Balkonsanierung',
    untertitel: 'Mit Flüssigkunststoff, langlebig und optisch ansprechend',
    schaden: 'Eindringende Feuchte',
    vorteile: [
      'Dünnschichtiges Beschichtungssystem',
      'Langlebig und leicht zu reinigen',
      'Geprüfte Materialien',
      'Optisch ansprechend',
      'Transparente Kosten',
      'Wertsteigerung der Immobilie',
    ],
  },
  {
    id: 'kellerboden',
    gewerke: ['Kellerbodensanierung', 'Bodenabdichtung'],
    titel: 'ISOTEC-Kellerbodensanierung',
    untertitel: 'Dünnschichtig und feuchtesperrend',
    schaden: 'Kapillar aufsteigende Feuchtigkeit bei alten Kellerböden',
    vorteile: [
      'Dünnschichtiges Beschichtungssystem',
      'Sicherer Sanierungserfolg',
      'Kein Auskoffern des vorhandenen Bodens',
      'Mit Innenabdichtung kombinierbar',
      'Geprüfte Materialien',
      'Wertsteigerung der Immobilie',
    ],
  },
  {
    id: 'rissinjektion',
    gewerke: ['Rissinjektion'],
    titel: 'ISOTEC-Rissinjektion',
    untertitel: 'Elastische Abdichtung',
    schaden: 'Wasserführende Risse und Fugen',
    vorteile: [
      'Kein aufwendiges Freilegen undichter Betonbauteile von außen',
      'Abdichtungserfolg auf der wasserabgewandten Seite',
      'Unabhängig geprüftes System',
    ],
  },
  {
    id: 'flexband',
    gewerke: ['Flexband'],
    titel: 'ISOTEC-Flexbandsystem',
    untertitel: 'Elastische Abdichtung',
    schaden: 'Wasserführende Risse und Fugen',
    vorteile: [
      'Kein aufwendiges Freilegen undichter Betonbauteile von außen',
      'Abdichtungserfolg auf der wasserabgewandten Seite',
      'Dank hoher Dehnfähigkeit auch bei dynamischen Rissen einsetzbar',
      'Unabhängig geprüftes System',
    ],
  },
  {
    id: 'schimmel',
    gewerke: ['Schimmelschadensanierung', 'Anti-Schimmelbeschichtung'],
    titel: 'ISOTEC-Schimmelbeseitigung',
    untertitel: 'Sichere Entfernung und Ursachenbeseitigung',
    schaden: 'Schimmelbefall im Wohnraum',
    vorteile: [
      'Fachgerechte Beseitigung nach den anerkannten Regelwerken',
      'Schutz vor gesundheitsgefährdenden Sporen ab Beginn der Sanierung',
      'Ursache ermittelt und beseitigt: Schutz vor erneutem Befall',
      'Hygienisches und gesundes Wohnen',
      'Werterhalt der Immobilie',
    ],
  },
  {
    id: 'klimaplatte',
    gewerke: ['Klimaplatte'],
    titel: 'ISOTEC-Klimaplatte',
    untertitel: 'Diffusionsoffen, wärmedämmend, kapillarleitfähig, schimmelhemmend und nicht brennbar',
    schaden: 'Kondensation und Schimmel an kalten Wandflächen',
    vorteile: [
      'Vorbeugung von Kondensation und Schimmelpilzbefall',
      'Umweltfreundlicher, ökologischer Baustoff',
      'Behagliches Raumklima durch klimaregulierende Wirkung',
      'Schnelle Nutzung als Wohnraum',
      'Nicht brennbar',
      'Wertsteigerung der Immobilie',
    ],
  },
]

/**
 * Alle Bilder unter assets/gewerke als Adressen, Schluessel "<id>/<datei>".
 * Vite haengt die Dateien als eigene Assets an, geladen werden sie erst,
 * wenn eine Folie sie zeigt.
 */
const BILDER = import.meta.glob('../assets/gewerke/*/*.jpg', { eager: true, query: '?url', import: 'default' }) as Record<
  string,
  string
>

export function gewerkBild(id: string, datei: string): string | null {
  return BILDER[`../assets/gewerke/${id}/${datei}.jpg`] ?? null
}

/** Die Eintraege zu den gewaehlten Gewerken, in der Reihenfolge der Liste oben, jeder einmal */
export function infosFuer(gewerke: string[]): GewerkInfo[] {
  const gewaehlt = new Set(gewerke)
  return GEWERKE_INFO.filter((g) => g.gewerke.some((n) => gewaehlt.has(n)))
}
