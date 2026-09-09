import { PDFDocument, PDFFont, PDFPage, rgb } from 'pdf-lib'
import { A4, einbetten, gesperrt, umbrechen, winAnsi, type DeckblattBild } from '../lib/deckblatt'
import { KAPITEL_EINLEITUNG, KAPITEL_SCHLUSS, KAPITEL_TITEL, USPS } from './inhalt'

/**
 * Die beiden eigenen Seiten der Angebotsmappe: das Trennblatt vor jeder
 * Unterlage und das Kapitel "Warum ISOTEC" am Anfang.
 *
 * Aus drei Entwuerfen je Seite hat Yann am 09.09.2026 beide Male die ruhige
 * Fassung gewaehlt: das Trennblatt mit kleiner roter Kapitelnummer und kurzer
 * Linie, das Kapitel als Liste mit rotem Balken vor jedem Punkt. Die uebrigen
 * Entwuerfe sind wieder entfernt.
 */

const RED = rgb(213 / 255, 19 / 255, 23 / 255)
const BROWN = rgb(86 / 255, 74 / 255, 68 / 255)
const GREY = rgb(224 / 255, 224 / 255, 224 / 255)
const MUTED = rgb(138 / 255, 127 / 255, 120 / 255)
const LIGHT = rgb(244 / 255, 244 / 255, 244 / 255)

const RAND = 48
const [W, H] = A4

export interface Schriften {
  regular: PDFFont
  bold: PDFFont
}

/** Das Logo oben rechts, wie auf allen anderen Seiten. */
async function logoObenRechts(doc: PDFDocument, seite: PDFPage, logo: DeckblattBild, breite = 70) {
  const bild = await einbetten(doc, logo)
  const hoehe = breite * (bild.height / bild.width)
  seite.drawImage(bild, { x: W - RAND + 8 - breite, y: H - 12 - hoehe, width: breite, height: hoehe })
}

export interface TrennblattDaten {
  /** Fortlaufende Nummer des Abschnitts, beginnend bei 1 */
  nummer: number
  titel: string
  /** Kurze Einordnung unter dem Titel, z. B. "12 Seiten" */
  unterzeile: string
  logo: DeckblattBild
}

/**
 * Trennblatt vor einer Unterlage: Kapitelnummer klein und rot ueber dem Titel,
 * darunter eine kurze rote Linie. Es ersetzt das Deckblatt, das jede Unterlage
 * einzeln erzeugt mitbringt, denn in der Mappe genuegt ein Deckblatt vorn.
 */
export async function zeichneTrennblatt(doc: PDFDocument, s: Schriften, d: TrennblattDaten) {
  const seite = doc.addPage(A4)
  await logoObenRechts(doc, seite, d.logo)
  const mitte = H * 0.56
  gesperrt(seite, `TEIL ${d.nummer}`, RAND, mitte + 40, s.bold, 10, RED, 1.8)
  seite.drawText(winAnsi(d.titel), { x: RAND, y: mitte - 12, size: 30, font: s.bold, color: BROWN })
  seite.drawLine({
    start: { x: RAND, y: mitte - 30 },
    end: { x: RAND + 90, y: mitte - 30 },
    thickness: 2.5,
    color: RED,
  })
  seite.drawText(winAnsi(d.unterzeile), { x: RAND, y: mitte - 52, size: 11, font: s.regular, color: MUTED })
}

/**
 * Kapitel "Warum ISOTEC", die erste Seite nach dem Inhaltsverzeichnis: kurze
 * Einleitung, darunter die Punkte als Kacheln in zwei Spalten auf hellgrauem
 * Grund (Yanns Wahl vom 09.09.2026). Der Kunde soll auf einen Blick sehen, was
 * uns vom Wettbewerb unterscheidet. Die Texte stehen in inhalt.ts.
 */
export async function zeichneKapitel(doc: PDFDocument, s: Schriften, logo: DeckblattBild) {
  const seite = doc.addPage(A4)
  await logoObenRechts(doc, seite, logo)

  let y = H - 76
  gesperrt(seite, 'ANGEBOTSMAPPE', RAND, y, s.bold, 9, RED, 1.6)
  y -= 26
  seite.drawText(winAnsi(KAPITEL_TITEL), { x: RAND, y, size: 22, font: s.bold, color: BROWN })
  y -= 14
  seite.drawLine({ start: { x: RAND, y }, end: { x: W - RAND, y }, thickness: 0.75, color: GREY })
  y -= 28

  for (const zeile of umbrechen(winAnsi(KAPITEL_EINLEITUNG), s.regular, 11, W - 2 * RAND)) {
    seite.drawText(zeile, { x: RAND, y, size: 11, font: s.regular, color: BROWN })
    y -= 16
  }
  y -= 18

  const spalten = 2
  const abstand = 16
  const breite = (W - 2 * RAND - abstand) / spalten
  const textBreite = breite - 30
  const TEXT = 9
  const ZEILE = 12

  // Alle Kacheln gleich hoch, und zwar so hoch wie der laengste Text es
  // braucht. Eine feste Hoehe wuerde bei einem laengeren Satz ueberlaufen.
  const inhalte = USPS.map((usp) => ({
    usp,
    zeilen: umbrechen(winAnsi(usp.text), s.regular, TEXT, textBreite),
    kopf: usp.zahl ? 56 : 44,
  }))
  const hoehe = Math.max(...inhalte.map((i) => i.kopf + i.zeilen.length * ZEILE + 12))

  inhalte.forEach((eintrag, i) => {
    const spalte = i % spalten
    const reihe = Math.floor(i / spalten)
    const x = RAND + spalte * (breite + abstand)
    const oben = y - reihe * (hoehe + abstand)
    seite.drawRectangle({ x, y: oben - hoehe, width: breite, height: hoehe, color: LIGHT })
    seite.drawRectangle({ x, y: oben - hoehe, width: 3, height: hoehe, color: RED })

    let zy = oben - 26
    if (eintrag.usp.zahl) {
      seite.drawText(eintrag.usp.zahl, { x: x + 16, y: zy - 8, size: 26, font: s.bold, color: RED })
      const zahlBreite = s.bold.widthOfTextAtSize(eintrag.usp.zahl, 26)
      seite.drawText(winAnsi(eintrag.usp.titel), {
        x: x + 16 + zahlBreite + 8,
        y: zy,
        size: 11,
        font: s.bold,
        color: BROWN,
      })
      zy -= 30
    } else {
      seite.drawText(winAnsi(eintrag.usp.titel), { x: x + 16, y: zy, size: 11, font: s.bold, color: BROWN })
      zy -= 18
    }
    for (const zeile of eintrag.zeilen) {
      seite.drawText(zeile, { x: x + 16, y: zy, size: TEXT, font: s.regular, color: BROWN })
      zy -= ZEILE
    }
  })

  seite.drawLine({ start: { x: RAND, y: 74 }, end: { x: W - RAND, y: 74 }, thickness: 0.5, color: GREY })
  umbrechen(winAnsi(KAPITEL_SCHLUSS), s.regular, 9, W - 2 * RAND).forEach((zeile, i) => {
    seite.drawText(zeile, { x: RAND, y: 58 - i * 12, size: 9, font: s.regular, color: MUTED })
  })
}
