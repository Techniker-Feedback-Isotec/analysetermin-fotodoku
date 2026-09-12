import * as pdfjs from 'pdfjs-dist'
import type { TextItem } from 'pdfjs-dist/types/src/display/api'

/**
 * Text aus PDFs lesen, zeilenweise.
 *
 * pdf-lib kann Seiten kopieren und zeichnen, aber keinen Text lesen. Fuer das
 * Inhaltsverzeichnis der Angebotsmappe braucht es aber die Titelpositionen aus
 * dem Angebot und die Ueberschriften aelterer Tool-PDFs ohne Abschnittsvermerk
 * (Yann, 11.09.2026). Dafuer kommt pdf.js dazu, geladen erst beim Erstellen
 * der Mappe, weil es gross ist und sonst niemand es braucht.
 */

export interface Zeile {
  /** Text der Zeile, Leerraum geglaettet */
  text: string
  /** Linke Kante in Punkt */
  x: number
  /** Abstand von der oberen Blattkante in Punkt */
  y: number
  /** Anteil von oben, 0 = Blattkante, 1 = unten. Fuer "steht im oberen Viertel" */
  oben: number
  /** Schriftgroesse in Punkt (groesstes Stueck der Zeile) */
  groesse: number
  /** Interner Schriftname von pdf.js; gleich = gleiche Schrift */
  schrift: string
}

let workerGesetzt = false

/** Worker von aussen setzen (Node-Pruefskripte); im Browser passiert das von selbst. */
export function setzeWorker(quelle: string): void {
  pdfjs.GlobalWorkerOptions.workerSrc = quelle
  workerGesetzt = true
}

export async function stelleWorkerSicher(): Promise<void> {
  if (workerGesetzt) return
  if (typeof document !== 'undefined') {
    const { workerUrl } = await import('./pdfworker')
    setzeWorker(workerUrl)
  }
}

/** Alle Seiten als Zeilenlisten, von oben nach unten. */
export async function ladeSeitentexte(bytes: Uint8Array): Promise<Zeile[][]> {
  await stelleWorkerSicher()
  // pdf.js uebernimmt den Puffer und leert ihn beim Aufrufer; deshalb eine Kopie
  const aufgabe = pdfjs.getDocument({ data: bytes.slice() })
  const doc = await aufgabe.promise
  try {
    const seiten: Zeile[][] = []
    for (let i = 1; i <= doc.numPages; i++) {
      const seite = await doc.getPage(i)
      const inhalt = await seite.getTextContent()
      const { height } = seite.getViewport({ scale: 1 })
      const stuecke = inhalt.items.filter((e): e is TextItem => 'str' in e && e.str.trim() !== '')
      seiten.push(zeilenAus(stuecke, height))
    }
    return seiten
  } finally {
    await aufgabe.destroy()
  }
}

/**
 * Textstuecke zu Zeilen buendeln: gleiche Grundlinie (auf 2 Punkt genau) =
 * eine Zeile, innerhalb der Zeile von links nach rechts.
 */
function zeilenAus(stuecke: TextItem[], hoehe: number): Zeile[] {
  const sortiert = [...stuecke].sort((a, b) => b.transform[5] - a.transform[5] || a.transform[4] - b.transform[4])
  const zeilen: Zeile[] = []
  let aktuell: { y: number; teile: TextItem[] } | null = null
  const abschliessen = () => {
    if (!aktuell) return
    const teile = aktuell.teile.sort((a, b) => a.transform[4] - b.transform[4])
    const text = teile
      .map((t) => t.str)
      .join(' ')
      .replace(/ /g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (text !== '') {
      zeilen.push({
        text,
        x: teile[0].transform[4],
        y: hoehe - aktuell.y,
        oben: (hoehe - aktuell.y) / hoehe,
        groesse: Math.max(...teile.map((t) => Math.hypot(t.transform[0], t.transform[1]) || t.height)),
        schrift: teile[0].fontName,
      })
    }
    aktuell = null
  }
  for (const stueck of sortiert) {
    const y = stueck.transform[5]
    if (aktuell && Math.abs(aktuell.y - y) <= 2) {
      aktuell.teile.push(stueck)
    } else {
      abschliessen()
      aktuell = { y, teile: [stueck] }
    }
  }
  abschliessen()
  return zeilen
}
