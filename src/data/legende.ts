/**
 * Legende der Prinzipskizze.
 *
 * Auf der Seite "Bauzeichnungen" steht unten eine kleine Legende: Sie zeigt
 * nur die Gewerke, die auf der Seite Kunde als Sanierungskonzept ausgewaehlt
 * sind. Farben und Beschriftungen kommen aus Yanns Vorlage (08.09.2026).
 *
 * Mehrere Gewerke der Auswahlliste teilen sich eine Farbe und stehen deshalb
 * in einer Gruppe (etwa Kombiflex und Steinteppich beim Balkon). Die
 * Ueberschrift der Gruppe ist die aus der Vorlage, damit die Legende zur
 * gezeichneten Skizze passt.
 */

export type LegendenForm = 'balken' | 'flaeche' | 'kreuz'

export interface LegendenEintrag {
  text: string
  form: LegendenForm
}

export interface LegendenGruppe {
  titel: string
  /** Grundfarbe als #rrggbb; Flaechen werden daraus hell eingefaerbt */
  farbe: string
  eintraege: LegendenEintrag[]
}

const GRUNDRISS = 'Grundriss/Querschnitt'
const BEIDES = 'Grundriss/Querschnitt & Wandfläche'

interface Vorlage extends LegendenGruppe {
  /** Gewerke aus der Auswahlliste, die zu dieser Gruppe gehoeren */
  gewerke: string[]
}

/** Reihenfolge wie in der Vorlage. */
const VORLAGEN: Vorlage[] = [
  {
    titel: 'Innenabdichtung',
    farbe: '#2323ff',
    gewerke: ['Innenabdichtung'],
    eintraege: [
      { text: GRUNDRISS, form: 'balken' },
      { text: 'Wandfläche', form: 'flaeche' },
    ],
  },
  {
    titel: 'Sanierputz',
    farbe: '#e8801c',
    gewerke: ['Sanierputz'],
    eintraege: [
      { text: GRUNDRISS, form: 'balken' },
      { text: 'Wandfläche', form: 'flaeche' },
    ],
  },
  {
    titel: 'Außenabdichtung',
    farbe: '#0a7d2e',
    gewerke: ['Außenabdichtung'],
    eintraege: [
      { text: GRUNDRISS, form: 'balken' },
      { text: 'Wandfläche', form: 'flaeche' },
    ],
  },
  {
    titel: 'Balkon (PMMA)',
    farbe: '#6b0d7b',
    gewerke: ['Balkon - PMMA'],
    eintraege: [
      { text: GRUNDRISS, form: 'balken' },
      { text: 'Balkonfläche', form: 'flaeche' },
    ],
  },
  {
    titel: 'Klimaplatte',
    farbe: '#efe000',
    gewerke: ['Klimaplatte'],
    eintraege: [
      { text: GRUNDRISS, form: 'balken' },
      { text: 'Wandfläche', form: 'flaeche' },
    ],
  },
  {
    titel: 'Balkon (Kombiflex & Steinteppich)',
    farbe: '#3366ff',
    gewerke: ['Balkon - Kombiflex', 'Balkon - Steinteppich'],
    eintraege: [
      { text: GRUNDRISS, form: 'balken' },
      { text: 'Balkonfläche', form: 'flaeche' },
    ],
  },
  {
    titel: 'Bodenabdichtung',
    farbe: '#5b5bd6',
    gewerke: ['Bodenabdichtung'],
    eintraege: [{ text: BEIDES, form: 'flaeche' }],
  },
  {
    titel: 'Rissinjektion & Flexband',
    farbe: '#ff2d95',
    gewerke: ['Rissinjektion', 'Flexband'],
    eintraege: [
      { text: GRUNDRISS, form: 'balken' },
      { text: 'Wandfläche', form: 'flaeche' },
    ],
  },
  {
    titel: 'Horizontalsperre (Injektionscreme & Horizontalsperre)',
    farbe: '#ff0000',
    gewerke: ['Horizontalsperre', 'Injektionscreme'],
    eintraege: [{ text: BEIDES, form: 'balken' }],
  },
  {
    titel: 'Kellerbodensanierung',
    farbe: '#00d5d5',
    gewerke: ['Kellerbodensanierung'],
    eintraege: [{ text: GRUNDRISS, form: 'flaeche' }],
  },
]

/** Steht unabhaengig von der Gewerkeauswahl immer in der Legende. */
export const SONSTIGES: LegendenGruppe = {
  titel: 'Sonstiges',
  farbe: '#ff3b3b',
  eintraege: [{ text: 'Wanddurchbruch', form: 'kreuz' }],
}

/**
 * Die Legende zu einer Gewerkeauswahl. Gewerke ohne Eintrag in der Vorlage
 * (etwa Treppe oder Betoninstandsetzung) erscheinen nicht - fuer sie gibt es
 * keine Farbe in der Zeichnung.
 */
export function legendeFuer(gewerke: string[]): LegendenGruppe[] {
  const gewaehlt = new Set(gewerke)
  return VORLAGEN.filter((v) => v.gewerke.some((g) => gewaehlt.has(g))).map(
    ({ titel, farbe, eintraege }) => ({ titel, farbe, eintraege }),
  )
}

/** Gewerke, für die es in der Vorlage keine Farbe gibt. */
export function ohneLegende(gewerke: string[]): string[] {
  const bekannt = new Set(VORLAGEN.flatMap((v) => v.gewerke))
  return gewerke.filter((g) => !bekannt.has(g))
}
