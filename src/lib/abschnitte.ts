import type { PDFDocument } from 'pdf-lib'
import type { Zeile } from './pdftext'

/**
 * Abschnitte einer Unterlage fuer das Inhaltsverzeichnis der Angebotsmappe
 * (Yann, 11.09.2026: "Untertitel im Inhaltsverzeichnis" - Prinzipskizze mit
 * Bauzeichnungen und Sanierungsbereichen, Angebot mit seinen Titelpositionen).
 *
 * Drei Wege, in dieser Reihenfolge:
 *  1. Eigene PDFs tragen ihre Abschnitte seit dem 11.09.2026 im Feld
 *     Keywords (`kodiereAbschnitte`). Das ist exakt und braucht kein Textlesen.
 *  2. Fremde PDFs (Angebot aus dem System): Text lesen und die Zeilen
 *     "Titel n ..." einsammeln (`titelAusAngebot`).
 *  3. Aeltere eigene PDFs ohne Vermerk: die grosse Ueberschrift oben auf
 *     jeder Seite (`ueberschriftenAusText`).
 */

export interface Abschnitt {
  titel: string
  /** Seite in der Quell-PDF, 1-basiert */
  seite: number
}

const MARKE = 'abschnitte='

/** Fuer `doc.setKeywords([...])` beim Erzeugen eigener PDFs. */
export function kodiereAbschnitte(abschnitte: Abschnitt[]): string {
  return MARKE + abschnitte.map((a) => `${a.seite}:${a.titel.replace(/[|:]/g, ' ').trim()}`).join('|')
}

/** Gegenstueck zu `kodiereAbschnitte`; null, wenn die PDF keinen Vermerk traegt. */
export function dekodiereAbschnitte(keywords: string | undefined): Abschnitt[] | null {
  if (!keywords) return null
  const start = keywords.indexOf(MARKE)
  if (start < 0) return null
  return keywords
    .slice(start + MARKE.length)
    .split('|')
    .map((teil) => {
      const m = /^(\d+):(.+)$/.exec(teil.trim())
      return m ? { seite: Number(m[1]), titel: m[2].trim() } : null
    })
    .filter((a): a is Abschnitt => a !== null)
}

/**
 * Ersteller-Eintraege der eigenen PDFs. "Fotodoku (100 % clientseitig)" stand
 * bis zum 11.09.2026 in Fotodokumentation und Prinzipskizze; seither heisst
 * das "Dokumentation". Die Sanierungsvorschau traegt ihren eigenen Namen. Alle
 * gelten, damit auch aeltere Dateien erkannt werden, wenn jemand sie wieder
 * hochlaedt.
 */
const EIGENE_ERSTELLER = ['Dokumentation', 'Fotodoku', 'ISOTEC-Sanierungsvorschau']

/**
 * Stammt die PDF aus diesem Werkzeug? Dann traegt sie ein Deckblatt, das in
 * der Mappe wegfaellt, auch wenn sie hochgeladen wurde (Yann, 11.09.2026:
 * "die Skizze soll kein extra Deckblatt haben").
 */
export function istEigenePdf(doc: PDFDocument): boolean {
  const ersteller = doc.getCreator() ?? ''
  return EIGENE_ERSTELLER.some((e) => ersteller.startsWith(e))
}

const glatt = (t: string) => t.replace(/ /g, ' ').replace(/\s+/g, ' ').trim()

/**
 * Titelpositionen aus einem Angebot des Systems: Zeilen der Form
 * "Titel 2 ISOTEC-Baustelleneinrichtung fuer ..." mit ihren Fortsetzungszeilen.
 * Jede Titelnummer zaehlt einmal, beim ersten Auftreten; die Auftragserteilung
 * am Ende wiederholt alle Titel und wuerde sie sonst verdoppeln.
 *
 * Fortsetzung heisst: gleiche Schrift wie die Titelzeile, dicht darunter, und
 * keine Position ("2.1 ..."), keine Titelsumme, kein neuer Titel.
 */
export function titelAusAngebot(seiten: Zeile[][]): Abschnitt[] {
  const gefunden = new Map<number, Abschnitt>()
  seiten.forEach((zeilen, s) => {
    for (let i = 0; i < zeilen.length; i++) {
      const m = /^Titel\s+(\d+)\b\s*(.*)$/.exec(glatt(zeilen[i].text))
      if (!m) continue
      const nummer = Number(m[1])
      if (gefunden.has(nummer)) continue
      let text = m[2].trim()
      for (let j = i + 1; j < zeilen.length; j++) {
        const z = zeilen[j]
        const t = glatt(z.text)
        if (z.schrift !== zeilen[i].schrift) break
        if (/^(\d+\.\d+\b|Titelsumme|Titel\s+\d+)/.test(t)) break
        if (z.y - zeilen[j - 1].y > z.groesse * 2.2) break
        text = `${text} ${t}`.trim()
      }
      gefunden.set(nummer, { titel: text ? `Titel ${nummer}: ${text}` : `Titel ${nummer}`, seite: s + 1 })
    }
  })
  return [...gefunden.values()]
}

/**
 * Ueberschriften eigener PDFs ohne Abschnittsvermerk: die grosse Zeile im
 * oberen Viertel jeder Seite (22 Punkt fett unter der kleinen roten Marke).
 * Aufeinanderfolgende Seiten mit derselben Ueberschrift bilden einen
 * Abschnitt; Seiten ohne Ueberschrift (reine Fotoseiten) bleiben unerwaehnt.
 */
export function ueberschriftenAusText(seiten: Zeile[][]): Abschnitt[] {
  const abschnitte: Abschnitt[] = []
  seiten.forEach((zeilen, i) => {
    const kopf = zeilen
      .filter((z) => z.oben < 0.25 && z.groesse >= 16)
      .sort((a, b) => b.groesse - a.groesse)[0]
    if (!kopf) return
    const titel = glatt(kopf.text)
    const letzter = abschnitte[abschnitte.length - 1]
    if (letzter && letzter.titel === titel) return
    abschnitte.push({ titel, seite: i + 1 })
  })
  return abschnitte
}
