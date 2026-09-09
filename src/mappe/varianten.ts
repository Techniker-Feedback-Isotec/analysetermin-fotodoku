import { PDFDocument, PDFFont, PDFPage, rgb } from 'pdf-lib'
import { A4, einbetten, gesperrt, umbrechen, winAnsi, type DeckblattBild } from '../lib/deckblatt'
import { KAPITEL_EINLEITUNG, KAPITEL_SCHLUSS, KAPITEL_TITEL, USPS } from './inhalt'

/**
 * Entwurfsvarianten fuer die neue Angebotsmappe (Yann, 09.09.2026).
 *
 * Zwei Dinge stehen zur Wahl, beide werden auf der Vorschauseite als echte
 * PDF gezeigt und danach wandert die gewaehlte Fassung nach lib/mappe.ts:
 *
 *   1. das Trennblatt zwischen den Unterlagen (bisher trug jede Unterlage ihr
 *      eigenes Deckblatt mit Objektfoto, kuenftig genuegt eine schlichte
 *      Ueberschriftsseite)
 *   2. das ISOTEC-Kapitel am Anfang der Mappe
 *
 * Alle Varianten benutzen dieselben Bausteine wie die uebrigen Dokumente
 * (Farben, Raender, Logo oben rechts), damit die Mappe aus einem Guss wirkt.
 */

const RED = rgb(213 / 255, 19 / 255, 23 / 255)
const BROWN = rgb(86 / 255, 74 / 255, 68 / 255)
const GREY = rgb(224 / 255, 224 / 255, 224 / 255)
const MUTED = rgb(138 / 255, 127 / 255, 120 / 255)
const LIGHT = rgb(244 / 255, 244 / 255, 244 / 255)
const WHITE = rgb(1, 1, 1)

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

// ============================================================
//  Trennblatt: Variante A, B, C
// ============================================================

export interface TrennblattDaten {
  /** Fortlaufende Nummer des Abschnitts, beginnend bei 1 */
  nummer: number
  titel: string
  /** Kurze Einordnung unter dem Titel, z. B. "12 Seiten" */
  unterzeile: string
  logo: DeckblattBild
}

/**
 * A "Ruhig": Kapitelnummer klein und rot ueber dem Titel, darunter eine
 * kurze rote Linie. Viel Weissraum, die Seite haelt sich zurueck.
 */
export async function trennblattA(doc: PDFDocument, s: Schriften, d: TrennblattDaten) {
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
 * B "Zahl": Die Kapitelnummer steht sehr gross und hellgrau hinter dem Titel.
 * Gibt der Mappe einen erkennbaren Rhythmus beim Durchblaettern.
 */
export async function trennblattB(doc: PDFDocument, s: Schriften, d: TrennblattDaten) {
  const seite = doc.addPage(A4)
  await logoObenRechts(doc, seite, d.logo)
  const mitte = H * 0.55
  seite.drawText(String(d.nummer), {
    x: RAND - 6,
    y: mitte - 30,
    size: 150,
    font: s.bold,
    color: LIGHT,
  })
  seite.drawText(winAnsi(d.titel), { x: RAND, y: mitte + 8, size: 30, font: s.bold, color: BROWN })
  seite.drawText(winAnsi(d.unterzeile), { x: RAND, y: mitte - 14, size: 11, font: s.regular, color: MUTED })
}

/**
 * C "Band": Rotes Band ueber die volle Breite mit weisser Schrift, wie das
 * Band auf dem Deckblatt. Am kraeftigsten von den dreien.
 */
export async function trennblattC(doc: PDFDocument, s: Schriften, d: TrennblattDaten) {
  const seite = doc.addPage(A4)
  await logoObenRechts(doc, seite, d.logo)
  const bandHoehe = 96
  const bandY = H * 0.52
  seite.drawRectangle({ x: 0, y: bandY, width: W, height: bandHoehe, color: RED })
  gesperrt(seite, `TEIL ${d.nummer}`, RAND, bandY + bandHoehe - 30, s.bold, 9, WHITE, 1.8)
  seite.drawText(winAnsi(d.titel), {
    x: RAND,
    y: bandY + 24,
    size: 26,
    font: s.bold,
    color: WHITE,
  })
  seite.drawText(winAnsi(d.unterzeile), {
    x: RAND,
    y: bandY - 26,
    size: 11,
    font: s.regular,
    color: MUTED,
  })
}

export const TRENNBLATT_VARIANTEN = {
  A: { name: 'A · Ruhig (Nummer klein, rote Linie)', zeichne: trennblattA },
  B: { name: 'B · Zahl (grosse graue Kapitelnummer)', zeichne: trennblattB },
  C: { name: 'C · Band (rotes Band, weisse Schrift)', zeichne: trennblattC },
}

// ============================================================
//  ISOTEC-Kapitel: Variante A, B, C
// ============================================================

export interface KapitelDaten {
  logo: DeckblattBild
}

/** Kopf der Kapitelseite, bei allen drei Varianten gleich. */
async function kapitelKopf(doc: PDFDocument, s: Schriften, d: KapitelDaten, marke: string) {
  const seite = doc.addPage(A4)
  await logoObenRechts(doc, seite, d.logo)
  let y = H - 76
  gesperrt(seite, marke, RAND, y, s.bold, 9, RED, 1.6)
  y -= 26
  seite.drawText(winAnsi(KAPITEL_TITEL), { x: RAND, y, size: 22, font: s.bold, color: BROWN })
  y -= 14
  seite.drawLine({ start: { x: RAND, y }, end: { x: W - RAND, y }, thickness: 0.75, color: GREY })
  return { seite, y: y - 28 }
}

/** Die Einleitung als Fliesstext, liefert das neue y zurueck. */
function einleitung(seite: PDFPage, s: Schriften, y: number, breite = W - 2 * RAND) {
  for (const zeile of umbrechen(winAnsi(KAPITEL_EINLEITUNG), s.regular, 11, breite)) {
    seite.drawText(zeile, { x: RAND, y, size: 11, font: s.regular, color: BROWN })
    y -= 16
  }
  return y - 18
}

/** Die Schlusszeile unten auf der Seite. */
function schluss(seite: PDFPage, s: Schriften) {
  seite.drawLine({ start: { x: RAND, y: 74 }, end: { x: W - RAND, y: 74 }, thickness: 0.5, color: GREY })
  for (const [i, zeile] of umbrechen(winAnsi(KAPITEL_SCHLUSS), s.regular, 9, W - 2 * RAND).entries()) {
    seite.drawText(zeile, { x: RAND, y: 58 - i * 12, size: 9, font: s.regular, color: MUTED })
  }
}

/**
 * A "Liste": Einleitung, darunter die Punkte untereinander mit rotem
 * Balken davor. Ruhig und gut lesbar, wie eine Textseite.
 */
export async function kapitelA(doc: PDFDocument, s: Schriften, d: KapitelDaten) {
  const { seite, y: start } = await kapitelKopf(doc, s, d, 'ANGEBOTSMAPPE')
  let y = einleitung(seite, s, start)
  for (const usp of USPS) {
    seite.drawRectangle({ x: RAND, y: y - 3, width: 3, height: 14, color: RED })
    seite.drawText(winAnsi(usp.zahl ? `${usp.zahl} ${usp.titel}` : usp.titel), {
      x: RAND + 14,
      y,
      size: 12,
      font: s.bold,
      color: BROWN,
    })
    y -= 16
    for (const zeile of umbrechen(winAnsi(usp.text), s.regular, 10, W - 2 * RAND - 14)) {
      seite.drawText(zeile, { x: RAND + 14, y, size: 10, font: s.regular, color: BROWN })
      y -= 13
    }
    y -= 12
  }
  schluss(seite, s)
}

/**
 * B "Kacheln": Die Punkte in zwei Spalten auf hellgrauem Grund. Wirkt wie
 * eine Uebersicht und laesst sich schnell ueberfliegen.
 */
export async function kapitelB(doc: PDFDocument, s: Schriften, d: KapitelDaten) {
  const { seite, y: start } = await kapitelKopf(doc, s, d, 'ANGEBOTSMAPPE')
  let y = einleitung(seite, s, start)
  const spalten = 2
  const abstand = 16
  const breite = (W - 2 * RAND - abstand) / spalten
  const hoehe = 118
  USPS.forEach((usp, i) => {
    const spalte = i % spalten
    const reihe = Math.floor(i / spalten)
    const x = RAND + spalte * (breite + abstand)
    const oben = y - reihe * (hoehe + abstand)
    seite.drawRectangle({ x, y: oben - hoehe, width: breite, height: hoehe, color: LIGHT })
    seite.drawRectangle({ x, y: oben - hoehe, width: 3, height: hoehe, color: RED })
    let zy = oben - 26
    if (usp.zahl) {
      seite.drawText(usp.zahl, { x: x + 16, y: zy - 8, size: 26, font: s.bold, color: RED })
      const zahlBreite = s.bold.widthOfTextAtSize(usp.zahl, 26)
      seite.drawText(winAnsi(usp.titel), {
        x: x + 16 + zahlBreite + 8,
        y: zy,
        size: 11,
        font: s.bold,
        color: BROWN,
      })
      zy -= 30
    } else {
      seite.drawText(winAnsi(usp.titel), { x: x + 16, y: zy, size: 11, font: s.bold, color: BROWN })
      zy -= 18
    }
    for (const zeile of umbrechen(winAnsi(usp.text), s.regular, 9, breite - 30)) {
      seite.drawText(zeile, { x: x + 16, y: zy, size: 9, font: s.regular, color: BROWN })
      zy -= 12
    }
  })
  schluss(seite, s)
}

/**
 * C "Kennzahlen": Oben ein Streifen mit den beiden Zahlen gross, darunter
 * die uebrigen Punkte zweispaltig als reiner Text. Setzt die Zahlen in den
 * Vordergrund, ohne dass die Seite unruhig wird.
 */
export async function kapitelC(doc: PDFDocument, s: Schriften, d: KapitelDaten) {
  const { seite, y: start } = await kapitelKopf(doc, s, d, 'ANGEBOTSMAPPE')
  let y = einleitung(seite, s, start)

  const mitZahl = USPS.filter((u) => u.zahl)
  const ohneZahl = USPS.filter((u) => !u.zahl)

  // Streifen mit den Kennzahlen
  const streifenHoehe = 92
  seite.drawRectangle({ x: RAND, y: y - streifenHoehe, width: W - 2 * RAND, height: streifenHoehe, color: LIGHT })
  const feldBreite = (W - 2 * RAND) / Math.max(mitZahl.length, 1)
  mitZahl.forEach((usp, i) => {
    const x = RAND + i * feldBreite
    if (i > 0) {
      seite.drawLine({
        start: { x, y: y - streifenHoehe + 16 },
        end: { x, y: y - 16 },
        thickness: 0.5,
        color: GREY,
      })
    }
    seite.drawText(usp.zahl!, { x: x + 22, y: y - 46, size: 34, font: s.bold, color: RED })
    seite.drawText(winAnsi(usp.titel), { x: x + 22, y: y - 62, size: 11, font: s.bold, color: BROWN })
    const kurz = umbrechen(winAnsi(usp.text), s.regular, 8.5, feldBreite - 44)
    kurz.slice(0, 2).forEach((zeile, zi) => {
      seite.drawText(zeile, { x: x + 22, y: y - 76 - zi * 11, size: 8.5, font: s.regular, color: MUTED })
    })
  })
  y -= streifenHoehe + 30

  // Die uebrigen Punkte zweispaltig
  const spaltenBreite = (W - 2 * RAND - 20) / 2
  ohneZahl.forEach((usp, i) => {
    const x = RAND + (i % 2) * (spaltenBreite + 20)
    const reihe = Math.floor(i / 2)
    let zy = y - reihe * 78
    seite.drawText(winAnsi(usp.titel), { x, y: zy, size: 11.5, font: s.bold, color: BROWN })
    zy -= 15
    for (const zeile of umbrechen(winAnsi(usp.text), s.regular, 9.5, spaltenBreite)) {
      seite.drawText(zeile, { x, y: zy, size: 9.5, font: s.regular, color: BROWN })
      zy -= 12
    }
  })
  schluss(seite, s)
}

export const KAPITEL_VARIANTEN = {
  A: { name: 'A · Liste (Punkte untereinander)', zeichne: kapitelA },
  B: { name: 'B · Kacheln (zwei Spalten, grauer Grund)', zeichne: kapitelB },
  C: { name: 'C · Kennzahlen (Streifen oben, Text darunter)', zeichne: kapitelC },
}
