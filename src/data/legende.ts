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
  /**
   * Der kuerzestmoegliche Text fuer die einzeilige Legende auf der Seite
   * "Bauzeichnungen" (Yann, 09.09.2026: „nur der essentiellste Text"). Er nennt
   * die tatsaechlich gewaehlten Gewerke, nicht den langen Vorlagentitel:
   * „Horizontalsperre" statt „Horizontalsperre (Injektionscreme & Horizontalsperre)".
   */
  kurz: string
  /** Grundfarbe als #rrggbb; Flaechen werden daraus hell eingefaerbt */
  farbe: string
  eintraege: LegendenEintrag[]
}

const GRUNDRISS = 'Grundriss/Querschnitt'
const BEIDES = 'Grundriss/Querschnitt & Wandfläche'

/** Der Kurztext entsteht aus der Auswahl (kurzFuer), er steht nicht in der Vorlage. */
interface Vorlage extends Omit<LegendenGruppe, 'kurz'> {
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
  kurz: 'Wanddurchbruch',
  farbe: '#ff3b3b',
  eintraege: [{ text: 'Wanddurchbruch', form: 'kreuz' }],
}

/**
 * Der Kurztext einer Gruppe: die gewaehlten Gewerke, nicht der Vorlagentitel.
 * Teilen sich mehrere Varianten ein Wort ("Balkon - Kombiflex", "Balkon -
 * Steinteppich"), steht es nur einmal davor.
 */
function kurzFuer(vorlage: Vorlage, gewaehlt: Set<string>): string {
  const eigene = vorlage.gewerke.filter((g) => gewaehlt.has(g))
  if (eigene.length === 0) return vorlage.titel
  if (eigene.length === 1) return eigene[0].replace(' - ', ' ')
  const teile = eigene.map((g) => g.split(' - '))
  const kopf = teile[0][0]
  if (teile.length > 1 && teile.every((t) => t.length === 2 && t[0] === kopf)) {
    return `${kopf} ${teile.map((t) => t[1]).join('/')}`
  }
  return eigene.map((g) => g.replace(' - ', ' ')).join('/')
}

/**
 * Die Legende zu einer Gewerkeauswahl. Gewerke ohne Eintrag in der Vorlage
 * (etwa Treppe oder Betoninstandsetzung) erscheinen nicht - fuer sie gibt es
 * keine Farbe in der Zeichnung.
 */
export function legendeFuer(gewerke: string[]): LegendenGruppe[] {
  const gewaehlt = new Set(gewerke)
  return VORLAGEN.filter((v) => v.gewerke.some((g) => gewaehlt.has(g))).map((v) => ({
    titel: v.titel,
    kurz: kurzFuer(v, gewaehlt),
    farbe: v.farbe,
    eintraege: v.eintraege,
  }))
}

/** Gewerke, für die es in der Vorlage keine Farbe gibt. */
export function ohneLegende(gewerke: string[]): string[] {
  const bekannt = new Set(VORLAGEN.flatMap((v) => v.gewerke))
  return gewerke.filter((g) => !bekannt.has(g))
}
