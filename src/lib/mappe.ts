import { PDFDocument, PDFFont, StandardFonts, rgb } from 'pdf-lib'
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
import {
  dekodiereAbschnitte,
  istEigenePdf,
  titelAusAngebot,
  ueberschriftenAusText,
  type Abschnitt,
} from './abschnitte'

/**
 * Angebotsmappe: alle ausgewaehlten Unterlagen in einem Dokument.
 *
 * Aufbau seit dem 09.09.2026 (Yann: "so sieht es professioneller aus und mehr
 * wie ein richtiges Dokument"):
 *
 *   1. ein Deckblatt fuer die ganze Mappe
 *   2. Inhaltsverzeichnis (eine Seite, bei vielen Untertiteln auch mehr)
 *   3. Kapitel "Warum ISOTEC"
 *   4. je Unterlage ein Trennblatt (Ueberschrift, kein Foto) und dahinter ihre
 *      Seiten OHNE ihr eigenes Deckblatt
 *
 * Vorher trug jede Unterlage ihr eigenes Deckblatt mit Objektfoto mitten in
 * der Mappe. Einzeln erzeugt behalten die Unterlagen ihr Deckblatt, nur in der
 * Mappe faellt es weg. Das gilt auch fuer eigene PDFs, die jemand wieder
 * hochlaedt (erkannt am Ersteller): Yann, 11.09.2026, "die Skizze soll kein
 * extra Deckblatt haben". Fremde PDFs (Angebot aus dem System) haben kein
 * solches Deckblatt und kommen vollstaendig mit.
 *
 * Seit dem 11.09.2026 fuehrt das Inhaltsverzeichnis unter jeder Unterlage
 * ihre Abschnitte auf: bei der Prinzipskizze Bauzeichnungen und
 * Sanierungsbereiche, beim Angebot die Titelpositionen (siehe abschnitte.ts).
 */

const RED = rgb(213 / 255, 19 / 255, 23 / 255)
const BROWN = rgb(86 / 255, 74 / 255, 68 / 255)
const GREY = rgb(224 / 255, 224 / 255, 224 / 255)
const MUTED = rgb(138 / 255, 127 / 255, 120 / 255)

const RAND = 48
const [W, H] = A4

/** Masse des Inhaltsverzeichnisses, fuer Vorausberechnung und Zeichnen gleich */
const INHALT_START_Y = H - 76 - 26 - 14 - 34
const INHALT_UNTEN = 70
const ZEILE_HAUPT = 15
const ZEILE_UNTER = 15
const NACH_UNTERZEILE = 26
const NACH_UNTERTITELN = 14
const NACH_HAUPT_OHNE = 11
const EINZUG_UNTER = 18

export interface MappenTeil {
  /** Ueberschrift im Inhaltsverzeichnis und auf dem Trennblatt */
  titel: string
  bytes: Uint8Array
  /**
   * Alle Seiten uebernehmen statt die erste als Deckblatt wegzulassen. Fuer
   * PDFs, die nicht hier entstanden sind und deshalb kein Deckblatt tragen.
   * Eigene PDFs (am Ersteller erkannt) verlieren ihr Deckblatt trotzdem.
   */
  alleSeiten?: boolean
}

export interface MappenDaten {
  objekt: DeckblattBild | null
  visitenkarte: DeckblattBild | null
  logo: DeckblattBild
  zeilen: DeckblattZeile[]
  teile: MappenTeil[]
}

/** Ein Untertitel im Inhalt: Abschnitt einer Unterlage mit seinem Versatz in deren Seiten */
interface Untertitel {
  titel: string
  /** Index in den uebernommenen Seiten der Unterlage (0 = erste Seite nach dem Trennblatt) */
  versatz: number
}

interface GeladenerTeil {
  titel: string
  quelle: PDFDocument
  inhalt: number[]
  umfang: number
  untertitel: Untertitel[]
}

/** Ein Eintrag im Inhaltsverzeichnis, fertig zum Zeichnen */
interface Eintrag {
  titel: string
  seite: number
  /** "n Seiten" unter dem Titel, wenn es keine Untertitel gibt */
  unterzeile: string | null
  untertitel: Array<{ titel: string; seite: number }>
}

export async function erzeugeAngebotsmappe(daten: MappenDaten): Promise<Uint8Array> {
  if (daten.teile.length === 0) throw new Error('Keine Unterlagen für die Mappe')

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

  // Die Unterlagen vorab oeffnen: Erst mit ihren Seitenzahlen und Abschnitten
  // laesst sich das Inhaltsverzeichnis schreiben, bevor die Seiten angehaengt
  // werden.
  const geladen: GeladenerTeil[] = []
  for (const teil of daten.teile) {
    const quelle = await PDFDocument.load(teil.bytes)
    const eigene = istEigenePdf(quelle)
    // Die erste Seite ist das Deckblatt der Unterlage; in der Mappe uebernimmt
    // das Trennblatt diese Rolle. Haette eine Unterlage nur diese eine Seite,
    // bliebe nichts uebrig - dann kommt sie vollstaendig mit. Fremde PDFs
    // haben kein Deckblatt und kommen immer ganz.
    const seiten = quelle.getPageIndices()
    const ohneDeckblatt = eigene || !teil.alleSeiten
    const inhalt = ohneDeckblatt && seiten.length > 1 ? seiten.slice(1) : seiten
    const untertitel = await ermittleUntertitel(quelle, teil.bytes, eigene, inhalt)
    geladen.push({ titel: teil.titel, quelle, inhalt, umfang: inhalt.length, untertitel })
  }

  // Seitenzahlen: Deckblatt, dann das Inhaltsverzeichnis (meist eine Seite),
  // das Kapitel, dann je Teil ein Trennblatt und seine Seiten. Wie viele
  // Seiten das Inhaltsverzeichnis braucht, haengt von seinen Zeilen ab, und
  // davon haengen wieder alle Seitenzahlen ab: deshalb erst die Hoehen
  // ausrechnen, dann die Seiten verteilen, dann zeichnen.
  const kapitelEintrag: Eintrag = { titel: 'Warum ISOTEC', seite: 0, unterzeile: null, untertitel: [] }
  const teilEintraege: Eintrag[] = geladen.map((g, i) => ({
    titel: `${i + 1}. ${g.titel}`,
    seite: 0,
    unterzeile: g.untertitel.length === 0 ? `${g.umfang} ${g.umfang === 1 ? 'Seite' : 'Seiten'}` : null,
    untertitel: g.untertitel.map((u) => ({ titel: u.titel, seite: u.versatz })),
  }))
  const alleEintraege = [kapitelEintrag, ...teilEintraege]
  const inhaltSeiten = verteileEintraege(alleEintraege)
  const anzahlInhalt = inhaltSeiten.length

  kapitelEintrag.seite = 2 + anzahlInhalt
  let naechsteSeite = 3 + anzahlInhalt
  geladen.forEach((g, i) => {
    const eintrag = teilEintraege[i]
    eintrag.seite = naechsteSeite
    for (const u of eintrag.untertitel) u.seite = naechsteSeite + 1 + u.seite
    naechsteSeite += 1 + g.umfang
  })

  // ---------- 2. Inhaltsverzeichnis ----------
  const logoBild = await einbetten(doc, daten.logo)
  for (const [nr, indizes] of inhaltSeiten.entries()) {
    const seite = doc.addPage(A4)
    zeichneSeitenlogo(seite, logoBild)

    let y = H - 76
    gesperrt(seite, 'ANGEBOTSMAPPE', RAND, y, bold, 9, RED, 1.6)
    y -= 26
    seite.drawText(nr === 0 ? 'Inhalt' : 'Inhalt (Fortsetzung)', { x: RAND, y, size: 22, font: bold, color: BROWN })
    y -= 14
    seite.drawLine({ start: { x: RAND, y }, end: { x: W - RAND, y }, thickness: 0.75, color: GREY })
    y -= 34

    /** Punktlinie zwischen Text und Seitenzahl */
    const punkte = (von: number, bis: number, grundlinie: number) => {
      for (let x = von; x < bis; x += 5) {
        seite.drawCircle({ x, y: grundlinie + 3.5, size: 0.5, color: GREY })
      }
    }

    for (const i of indizes) {
      const eintrag = alleEintraege[i]
      const text = winAnsi(eintrag.titel)
      const zahl = String(eintrag.seite)
      const zahlBreite = bold.widthOfTextAtSize(zahl, 12)
      seite.drawText(text, { x: RAND, y, size: 12, font: bold, color: BROWN })
      seite.drawText(zahl, { x: W - RAND - zahlBreite, y, size: 12, font: bold, color: BROWN })
      punkte(RAND + bold.widthOfTextAtSize(text, 12) + 8, W - RAND - zahlBreite - 8, y)
      y -= ZEILE_HAUPT

      if (eintrag.untertitel.length > 0) {
        for (const u of eintrag.untertitel) {
          const uz = String(u.seite)
          const uzBreite = regular.widthOfTextAtSize(uz, 10)
          const platz = W - RAND - uzBreite - 8 - (RAND + EINZUG_UNTER) - 8
          const ut = kuerze(winAnsi(u.titel), regular, 10, platz)
          seite.drawText(ut, { x: RAND + EINZUG_UNTER, y, size: 10, font: regular, color: MUTED })
          seite.drawText(uz, { x: W - RAND - uzBreite, y, size: 10, font: regular, color: MUTED })
          punkte(RAND + EINZUG_UNTER + regular.widthOfTextAtSize(ut, 10) + 8, W - RAND - uzBreite - 8, y)
          y -= ZEILE_UNTER
        }
        y -= NACH_UNTERTITELN
      } else if (eintrag.unterzeile) {
        seite.drawText(winAnsi(eintrag.unterzeile), { x: RAND, y, size: 9, font: regular, color: MUTED })
        y -= NACH_UNTERZEILE
      } else {
        y -= NACH_HAUPT_OHNE
      }
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

/** Hoehe eines Eintrags im Inhaltsverzeichnis, wie er gezeichnet wird */
function hoeheVon(eintrag: Eintrag): number {
  if (eintrag.untertitel.length > 0) return ZEILE_HAUPT + eintrag.untertitel.length * ZEILE_UNTER + NACH_UNTERTITELN
  return ZEILE_HAUPT + (eintrag.unterzeile ? NACH_UNTERZEILE : NACH_HAUPT_OHNE)
}

/**
 * Eintraege auf Seiten verteilen. Liefert je Seite die Indizes der Eintraege.
 * Ein Eintrag wird nicht getrennt; passt er nicht mehr, beginnt eine neue
 * Seite. Fast immer ist es eine.
 */
function verteileEintraege(eintraege: Eintrag[]): number[][] {
  const seiten: number[][] = [[]]
  let y = INHALT_START_Y
  eintraege.forEach((eintrag, i) => {
    const hoehe = hoeheVon(eintrag)
    if (y - hoehe < INHALT_UNTEN && seiten[seiten.length - 1].length > 0) {
      seiten.push([])
      y = INHALT_START_Y
    }
    seiten[seiten.length - 1].push(i)
    y -= hoehe
  })
  return seiten
}

/** Text auf eine Breite kuerzen, mit Auslassungspunkten am Ende */
function kuerze(text: string, font: PDFFont, groesse: number, breite: number): string {
  if (font.widthOfTextAtSize(text, groesse) <= breite) return text
  let t = text
  while (t.length > 1 && font.widthOfTextAtSize(`${t}...`, groesse) > breite) t = t.slice(0, -1)
  return `${t.trimEnd()}...`
}

/**
 * Abschnitte einer Unterlage fuer das Inhaltsverzeichnis, abgebildet auf die
 * mitgenommenen Seiten. Reihenfolge der Wege siehe abschnitte.ts; scheitert
 * das Textlesen, gibt es eben keine Untertitel, die Mappe entsteht trotzdem.
 */
async function ermittleUntertitel(
  quelle: PDFDocument,
  bytes: Uint8Array,
  eigene: boolean,
  inhalt: number[],
): Promise<Untertitel[]> {
  let roh: Abschnitt[] | null = dekodiereAbschnitte(quelle.getKeywords())
  if (!roh) {
    try {
      const { ladeSeitentexte } = await import('./pdftext')
      const texte = await ladeSeitentexte(bytes)
      roh = eigene ? ueberschriftenAusText(texte) : titelAusAngebot(texte)
    } catch (fehler) {
      console.warn('Text der Unterlage nicht lesbar, Inhalt ohne Untertitel', fehler)
      roh = []
    }
  }
  return roh
    .map((a) => ({ titel: a.titel, versatz: inhalt.indexOf(a.seite - 1) }))
    .filter((u) => u.versatz >= 0)
}
