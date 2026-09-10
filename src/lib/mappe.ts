import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import {
  A4,
  einbetten,
  gesperrt,
  winAnsi,
  zeichneDeckblatt,
  zeichneSeitenlogo,
  type DeckblattBild,
  type DeckblattZeile,
} from './deckblatt'
import { zeichneKapitel, zeichneTrennblatt } from '../mappe/seiten'

/**
 * Angebotsmappe: alle ausgewaehlten Unterlagen in einem Dokument.
 *
 * Aufbau seit dem 09.09.2026 (Yann: "so sieht es professioneller aus und mehr
 * wie ein richtiges Dokument"):
 *
 *   1. ein Deckblatt fuer die ganze Mappe
 *   2. Inhaltsverzeichnis
 *   3. Kapitel "Warum ISOTEC"
 *   4. je Unterlage ein Trennblatt (Ueberschrift, kein Foto) und dahinter ihre
 *      Seiten OHNE ihr eigenes Deckblatt
 *
 * Vorher trug jede Unterlage ihr eigenes Deckblatt mit Objektfoto mitten in
 * der Mappe. Einzeln erzeugt behalten die Unterlagen ihr Deckblatt, nur in der
 * Mappe faellt es weg.
 */

const RED = rgb(213 / 255, 19 / 255, 23 / 255)
const BROWN = rgb(86 / 255, 74 / 255, 68 / 255)
const GREY = rgb(224 / 255, 224 / 255, 224 / 255)
const MUTED = rgb(138 / 255, 127 / 255, 120 / 255)

const RAND = 48

export interface MappenTeil {
  /** Ueberschrift im Inhaltsverzeichnis und auf dem Trennblatt */
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
  doc.setCreator('Dokumentation')
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const regular = await doc.embedFont(StandardFonts.Helvetica)
  const schriften = { regular, bold }

  // ---------- 1. Deckblatt ----------
  await zeichneDeckblatt(doc, schriften, {
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
    // Die erste Seite ist das Deckblatt der Unterlage; in der Mappe uebernimmt
    // das Trennblatt diese Rolle. Haette eine Unterlage nur diese eine Seite,
    // bliebe nichts uebrig - dann kommt sie vollstaendig mit.
    const seiten = quelle.getPageIndices()
    const inhalt = seiten.length > 1 ? seiten.slice(1) : seiten
    geladen.push({ titel: teil.titel, quelle, inhalt, umfang: inhalt.length })
  }

  // Seitenzahlen: 1 Deckblatt + 1 Inhalt + 1 Kapitel, dann je Teil ein
  // Trennblatt und seine Seiten.
  let naechsteSeite = 4
  const eintraege = geladen.map((g, i) => {
    const eintrag = { nummer: i + 1, titel: g.titel, seite: naechsteSeite, umfang: g.umfang }
    naechsteSeite += 1 + g.umfang
    return eintrag
  })

  // ---------- 2. Inhaltsverzeichnis ----------
  {
    const seite = doc.addPage(A4)
    zeichneSeitenlogo(seite, await einbetten(doc, daten.logo))

    let y = H - 76
    gesperrt(seite, 'ANGEBOTSMAPPE', RAND, y, bold, 9, RED, 1.6)
    y -= 26
    seite.drawText('Inhalt', { x: RAND, y, size: 22, font: bold, color: BROWN })
    y -= 14
    seite.drawLine({ start: { x: RAND, y }, end: { x: W - RAND, y }, thickness: 0.75, color: GREY })
    y -= 34

    /** Eine Zeile mit Punktlinie zwischen Titel und Seitenzahl. */
    const zeile = (titel: string, seitenzahl: number, unterzeile: string | null) => {
      const text = winAnsi(titel)
      const zahl = String(seitenzahl)
      const titelBreite = bold.widthOfTextAtSize(text, 12)
      const zahlBreite = bold.widthOfTextAtSize(zahl, 12)
      seite.drawText(text, { x: RAND, y, size: 12, font: bold, color: BROWN })
      seite.drawText(zahl, { x: W - RAND - zahlBreite, y, size: 12, font: bold, color: BROWN })
      for (let x = RAND + titelBreite + 8; x < W - RAND - zahlBreite - 8; x += 5) {
        seite.drawCircle({ x, y: y + 3.5, size: 0.5, color: GREY })
      }
      y -= 15
      if (unterzeile) {
        seite.drawText(winAnsi(unterzeile), { x: RAND, y, size: 9, font: regular, color: MUTED })
        y -= 26
      } else {
        y -= 11
      }
    }

    zeile('Warum ISOTEC', 3, null)
    for (const eintrag of eintraege) {
      zeile(
        `${eintrag.nummer}. ${eintrag.titel}`,
        eintrag.seite,
        `${eintrag.umfang} ${eintrag.umfang === 1 ? 'Seite' : 'Seiten'}`,
      )
    }
  }

  // ---------- 3. Kapitel "Warum ISOTEC" ----------
  await zeichneKapitel(doc, schriften, daten.logo)

  // ---------- 4. Trennblatt und Seiten je Unterlage ----------
  for (const [i, g] of geladen.entries()) {
    await zeichneTrennblatt(doc, schriften, {
      nummer: i + 1,
      titel: g.titel,
      unterzeile: `${g.umfang} ${g.umfang === 1 ? 'Seite' : 'Seiten'}`,
      logo: daten.logo,
    })
    const seiten = await doc.copyPages(g.quelle, g.inhalt)
    for (const seite of seiten) doc.addPage(seite)
  }

  return doc.save()
}
