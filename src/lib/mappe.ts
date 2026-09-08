import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import {
  A4,
  einbetten,
  gesperrt,
  winAnsi,
  zeichneDeckblatt,
  type DeckblattBild,
  type DeckblattZeile,
} from './deckblatt'

/**
 * Angebotsmappe: alle erstellten Unterlagen in einem Dokument (Yann, 08.09.2026).
 *
 * Aufbau: Deckblatt, Inhaltsverzeichnis, danach die einzelnen Unterlagen in
 * fester Reihenfolge - Prinzipskizze, Sanierungsvorschau, Fotodokumentation.
 * Die Unterlagen werden Seite fuer Seite uebernommen, wie sie erstellt wurden;
 * jede behaelt also ihr eigenes Deckblatt und trennt damit die Abschnitte.
 *
 * So laesst sich die ganze Mappe auf einen Klick erzeugen und am Stueck
 * ausdrucken.
 */

const RED = rgb(213 / 255, 19 / 255, 23 / 255)
const BROWN = rgb(86 / 255, 74 / 255, 68 / 255)
const GREY = rgb(224 / 255, 224 / 255, 224 / 255)
const MUTED = rgb(138 / 255, 127 / 255, 120 / 255)

const RAND = 48

export interface MappenTeil {
  /** Ueberschrift im Inhaltsverzeichnis, z. B. "Prinzipskizze" */
  titel: string
  bytes: Uint8Array
}

export interface MappenDaten {
  objekt: DeckblattBild | null
  visitenkarte: DeckblattBild | null
  logo: DeckblattBild
  zeilen: DeckblattZeile[]
  teile: MappenTeil[]
}

export async function erzeugeAngebotsmappe(daten: MappenDaten): Promise<Uint8Array> {
  if (daten.teile.length === 0) throw new Error('Keine Unterlagen für die Mappe')

  const [W, H] = A4
  const doc = await PDFDocument.create()
  doc.setTitle('ISOTEC Angebotsmappe')
  doc.setCreator('Dokumentation (100 % clientseitig)')
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const regular = await doc.embedFont(StandardFonts.Helvetica)

  // ---------- 1. Deckblatt ----------
  await zeichneDeckblatt(doc, { regular, bold }, {
    titel: 'Angebotsmappe',
    objekt: daten.objekt,
    visitenkarte: daten.visitenkarte,
    zeilen: daten.zeilen,
    logo: daten.logo,
  })

  // Die Unterlagen vorab oeffnen: Erst mit ihren Seitenzahlen laesst sich das
  // Inhaltsverzeichnis schreiben, bevor die Seiten angehaengt werden.
  const geladen = []
  for (const teil of daten.teile) {
    const quelle = await PDFDocument.load(teil.bytes)
    geladen.push({ titel: teil.titel, quelle, umfang: quelle.getPageCount() })
  }
  let naechsteSeite = 3 // 1 Deckblatt + 1 Inhaltsverzeichnis
  const eintraege = geladen.map((g) => {
    const eintrag = { titel: g.titel, seite: naechsteSeite, umfang: g.umfang }
    naechsteSeite += g.umfang
    return eintrag
  })

  // ---------- 2. Inhaltsverzeichnis ----------
  {
    const seite = doc.addPage(A4)
    const logo = await einbetten(doc, daten.logo)
    const logoBreite = 70
    const logoHoehe = logoBreite * (logo.height / logo.width)
    seite.drawImage(logo, {
      x: W - RAND + 8 - logoBreite,
      y: H - 12 - logoHoehe,
      width: logoBreite,
      height: logoHoehe,
    })

    let y = H - 76
    gesperrt(seite, 'ANGEBOTSMAPPE', RAND, y, bold, 9, RED, 1.6)
    y -= 26
    seite.drawText('Inhalt', { x: RAND, y, size: 22, font: bold, color: BROWN })
    y -= 14
    seite.drawLine({ start: { x: RAND, y }, end: { x: W - RAND, y }, thickness: 0.75, color: GREY })
    y -= 34

    for (const eintrag of eintraege) {
      const titel = winAnsi(eintrag.titel)
      const seitenzahl = String(eintrag.seite)
      const titelBreite = bold.widthOfTextAtSize(titel, 12)
      const zahlBreite = bold.widthOfTextAtSize(seitenzahl, 12)
      seite.drawText(titel, { x: RAND, y, size: 12, font: bold, color: BROWN })
      seite.drawText(seitenzahl, { x: W - RAND - zahlBreite, y, size: 12, font: bold, color: BROWN })

      // Punktlinie zwischen Titel und Seitenzahl
      const von = RAND + titelBreite + 8
      const bis = W - RAND - zahlBreite - 8
      for (let x = von; x < bis; x += 5) {
        seite.drawCircle({ x, y: y + 3.5, size: 0.5, color: GREY })
      }

      y -= 15
      seite.drawText(`${eintrag.umfang} ${eintrag.umfang === 1 ? 'Seite' : 'Seiten'}`, {
        x: RAND,
        y,
        size: 9,
        font: regular,
        color: MUTED,
      })
      y -= 26
    }
  }

  // ---------- 3. Die Unterlagen ----------
  for (const g of geladen) {
    const seiten = await doc.copyPages(g.quelle, g.quelle.getPageIndices())
    for (const seite of seiten) doc.addPage(seite)
  }

  return doc.save()
}
