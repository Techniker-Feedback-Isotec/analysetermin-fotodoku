import { PDFDocument, PDFFont, PDFImage, PDFPage, rgb } from 'pdf-lib'
import { initialsOf } from './format'

/**
 * Gemeinsames Deckblatt fuer Fotodokumentation, Prinzipskizze und
 * Sanierungsvorschau (Vorgabe Yann, 08.09.2026).
 *
 * Zwei Dinge muessen sofort erkennbar sein: **das Objekt** (grosses Foto ueber
 * die volle Breite) und **die Art des Dokuments** (grosse Ueberschrift). Alles
 * andere ordnet sich darunter ein.
 *
 * Gegen Ueberschneidungen ist das Blatt durchgehend gemessen statt geraten:
 * - Die Angaben stehen in einer eigenen Textspalte, die rechts 150 Punkt frei
 *   laesst. Dort und nur dort stehen Portraitkreis und Logo, deshalb kann kein
 *   langer Kundenname und keine lange Anschrift hineinlaufen.
 * - Lange Werte werden umbrochen, nicht abgeschnitten; jede Zeile bekommt die
 *   Hoehe, die sie wirklich braucht.
 * - Die Hoehe des Objektfotos ergibt sich aus dem Platz, der nach allen
 *   Angaben uebrig ist. Viele Angaben lassen das Foto kleiner werden, statt
 *   den Text ins Foto oder unter das Blatt zu schieben.
 */

const RED = rgb(213 / 255, 19 / 255, 23 / 255)
const BROWN = rgb(86 / 255, 74 / 255, 68 / 255)
const GREY = rgb(224 / 255, 224 / 255, 224 / 255)
const LIGHT = rgb(244 / 255, 244 / 255, 244 / 255)
const MUTED = rgb(138 / 255, 127 / 255, 120 / 255)

const A4: [number, number] = [595.28, 841.89]
const RAND = 48
/** Rechts freigehaltene Spalte fuer Portraitkreis und Logo */
const RECHTE_SPALTE = 150
const FIRMA = 'ABDICHTUNGSTECHNIK DIPL.-ING. MORSCHECK GMBH'

export interface DeckblattBild {
  bytes: Uint8Array
  format: 'jpeg' | 'png'
}

export interface DeckblattZeile {
  label: string
  /** Leere Werte werden weggelassen */
  wert: string
}

export interface DeckblattDaten {
  /** Grosse Ueberschrift: Art des Dokuments */
  titel: string
  /** Kleine Zeile darunter, etwa "Fotodokumentation" */
  unterzeile?: string | null
  /** Objektfoto, gross oben auf dem Blatt */
  objekt?: DeckblattBild | null
  /** Rundes Mitarbeiterfoto; ohne das erscheinen die Initialen */
  portrait?: DeckblattBild | null
  mitarbeiter?: string | null
  zeilen: DeckblattZeile[]
  /** Block "Sanierungskonzept"; leer = kein Block */
  gewerke?: string[]
  /** Kasten mit rotem Rand am Fuss, etwa der KI-Hinweis der Sanierungsvorschau */
  hinweis?: { titel: string; text: string } | null
  logo: DeckblattBild
}

export interface DeckblattSchriften {
  regular: PDFFont
  bold: PDFFont
}

// Zeichen ausserhalb von WinAnsi (Standard-Helvetica) ersetzen, damit
// eingefuegter Text die PDF-Erstellung nicht abbricht.
const WINANSI_EXTRA = new Set([...'€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ'])
export function winAnsi(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, '  ')
    .split('')
    .map((ch) => {
      if (ch === '\n') return ch
      const code = ch.charCodeAt(0)
      if ((code >= 32 && code <= 126) || (code >= 160 && code <= 255)) return ch
      return WINANSI_EXTRA.has(ch) ? ch : '?'
    })
    .join('')
}

/** Bricht Text wortweise um; ueberlange Woerter werden hart getrennt. */
function umbrechen(text: string, font: PDFFont, size: number, maxBreite: number): string[] {
  const zeilen: string[] = []
  let aktuell = ''
  for (const wort of text.split(/\s+/).filter(Boolean)) {
    const versuch = aktuell ? `${aktuell} ${wort}` : wort
    if (font.widthOfTextAtSize(versuch, size) <= maxBreite) {
      aktuell = versuch
      continue
    }
    if (aktuell) zeilen.push(aktuell)
    let rest = wort
    while (font.widthOfTextAtSize(rest, size) > maxBreite && rest.length > 1) {
      let schnitt = rest.length - 1
      while (schnitt > 1 && font.widthOfTextAtSize(rest.slice(0, schnitt), size) > maxBreite) schnitt--
      zeilen.push(rest.slice(0, schnitt))
      rest = rest.slice(schnitt)
    }
    aktuell = rest
  }
  if (aktuell) zeilen.push(aktuell)
  return zeilen.length > 0 ? zeilen : ['']
}

function eingepasst(breite: number, hoehe: number, maxB: number, maxH: number) {
  const faktor = Math.min(maxB / breite, maxH / hoehe)
  return { w: breite * faktor, h: hoehe * faktor }
}

function gesperrt(
  page: PDFPage,
  text: string,
  x: number,
  y: number,
  font: PDFFont,
  size: number,
  color: ReturnType<typeof rgb>,
  abstand: number,
) {
  let cx = x
  for (const ch of text) {
    page.drawText(ch, { x: cx, y, size, font, color })
    cx += font.widthOfTextAtSize(ch, size) + abstand
  }
}

function einbetten(doc: PDFDocument, bild: DeckblattBild): Promise<PDFImage> {
  return bild.format === 'png' ? doc.embedPng(bild.bytes) : doc.embedJpg(bild.bytes)
}

export async function zeichneDeckblatt(
  doc: PDFDocument,
  { regular, bold }: DeckblattSchriften,
  daten: DeckblattDaten,
): Promise<PDFPage> {
  const [W, H] = A4
  const page = doc.addPage(A4)
  const logo = await einbetten(doc, daten.logo)
  const objekt = daten.objekt ? await einbetten(doc, daten.objekt) : null
  const portrait = daten.portrait ? await einbetten(doc, daten.portrait) : null

  const textBreite = W - 2 * RAND - RECHTE_SPALTE
  const logoBreite = 150
  const logoHoehe = logoBreite * (logo.height / logo.width)

  // ---------- messen ----------
  const titel = winAnsi(daten.titel)
  let titelGroesse = 42
  while (titelGroesse > 22 && bold.widthOfTextAtSize(titel, titelGroesse) > W - 2 * RAND) {
    titelGroesse -= 1
  }
  const unterzeile = daten.unterzeile ? winAnsi(daten.unterzeile) : null

  const LABEL_BREITE = 104
  const WERT_GROESSE = 10.5
  const ZEILE = 14
  const ZEILEN_ABSTAND = 7
  const zeilen = daten.zeilen
    .filter((z) => z.wert.trim() !== '')
    .map((z) => ({
      label: winAnsi(z.label),
      teile: umbrechen(winAnsi(z.wert), bold, WERT_GROESSE, textBreite - LABEL_BREITE),
    }))
  const zeilenHoehe = zeilen.reduce((summe, z) => summe + z.teile.length * ZEILE + ZEILEN_ABSTAND, 0)

  const gewerke = (daten.gewerke ?? []).filter((g) => g.trim() !== '')
  const gewerkeSpalten = gewerke.length > 5 ? 2 : 1
  const gewerkeZeilen = Math.ceil(gewerke.length / gewerkeSpalten)
  const GEWERK_SCHRITT = 13
  const gewerkeHoehe = gewerke.length > 0 ? 29 + gewerkeZeilen * GEWERK_SCHRITT : 0

  const HINWEIS_GROESSE = 9
  const HINWEIS_SCHRITT = 12.5
  const hinweisZeilen = daten.hinweis
    ? umbrechen(winAnsi(daten.hinweis.text), regular, HINWEIS_GROESSE, W - 2 * RAND - 32)
    : []
  const hinweisHoehe = daten.hinweis ? 36 + hinweisZeilen.length * HINWEIS_SCHRITT + 12 : 0

  const kopfHoehe = 30 + titelGroesse + 8 + (unterzeile ? 22 : 0) + 20
  const inhaltHoehe = kopfHoehe + 22 + zeilenHoehe + gewerkeHoehe + (daten.hinweis ? hinweisHoehe + 14 : 0)
  const fussHoehe = 44 + logoHoehe + 18

  // Das Objektfoto bekommt allen Platz, der uebrig bleibt - mindestens 210,
  // hoechstens 430 Punkt (rund die Haelfte der Seite). Ohne Objektfoto (in der
  // Sanierungsvorschau moeglich) entfaellt der Bereich ganz, statt eine leere
  // graue Flaeche zu zeigen; das rote Band sitzt dann oben am Blatt.
  const heroHoehe = objekt ? Math.max(210, Math.min(430, H - inhaltHoehe - fussHoehe)) : 0

  // ---------- zeichnen ----------
  const heroY = H - heroHoehe
  if (objekt) {
    page.drawRectangle({ x: 0, y: heroY, width: W, height: heroHoehe, color: LIGHT })
    // Ganz hineinpassen statt beschneiden: vom Objekt darf nichts fehlen.
    const g = eingepasst(objekt.width, objekt.height, W, heroHoehe)
    page.drawImage(objekt, {
      x: (W - g.w) / 2,
      y: heroY + (heroHoehe - g.h) / 2,
      width: g.w,
      height: g.h,
    })
  }
  const bandHoehe = 10
  page.drawRectangle({ x: 0, y: heroY - bandHoehe, width: W, height: bandHoehe, color: RED })

  let y = heroY - bandHoehe - 30
  gesperrt(page, FIRMA, RAND, y, bold, 9, RED, 1.6)
  y -= titelGroesse + 8
  page.drawText(titel, { x: RAND, y, size: titelGroesse, font: bold, color: BROWN })
  if (unterzeile) {
    y -= 22
    page.drawText(unterzeile, { x: RAND, y, size: 15, font: regular, color: MUTED })
  }
  y -= 20
  page.drawLine({ start: { x: RAND, y }, end: { x: W - RAND, y }, thickness: 0.75, color: GREY })

  // Portraitkreis in der rechten Spalte, oben neben den Angaben
  const angabenOben = y - 22
  const d = 88
  const kreisY = Math.max(44 + logoHoehe + 16, angabenOben + 6 - d)
  const kreisX = W - RAND - d
  if (portrait) {
    page.drawImage(portrait, { x: kreisX, y: kreisY, width: d, height: d })
    page.drawEllipse({
      x: kreisX + d / 2,
      y: kreisY + d / 2,
      xScale: d / 2,
      yScale: d / 2,
      borderColor: RED,
      borderWidth: 2,
    })
  } else if (daten.mitarbeiter) {
    page.drawEllipse({
      x: kreisX + d / 2,
      y: kreisY + d / 2,
      xScale: d / 2,
      yScale: d / 2,
      color: LIGHT,
      borderColor: RED,
      borderWidth: 2,
    })
    const initialen = initialsOf(daten.mitarbeiter) || '?'
    const size = 30
    const breite = bold.widthOfTextAtSize(initialen, size)
    page.drawText(initialen, {
      x: kreisX + (d - breite) / 2,
      y: kreisY + d / 2 - size * 0.36,
      size,
      font: bold,
      color: RED,
    })
  }

  // Angaben: Beschriftung grau, Wert fett - beides in der linken Textspalte
  y = angabenOben
  for (const zeile of zeilen) {
    page.drawText(zeile.label, { x: RAND, y, size: 9, font: regular, color: MUTED })
    zeile.teile.forEach((teil, i) => {
      page.drawText(teil, {
        x: RAND + LABEL_BREITE,
        y: y - i * ZEILE,
        size: WERT_GROESSE,
        font: bold,
        color: BROWN,
      })
    })
    y -= zeile.teile.length * ZEILE + ZEILEN_ABSTAND
  }

  if (gewerke.length > 0) {
    y -= 14
    page.drawText('Sanierungskonzept', { x: RAND, y, size: 10.5, font: bold, color: BROWN })
    y -= 15
    const spaltenBreite = textBreite / gewerkeSpalten
    const laengster = gewerke.reduce((a, b) => (a.length >= b.length ? a : b), '')
    let groesse = 9.5
    while (groesse > 7 && regular.widthOfTextAtSize(`• ${winAnsi(laengster)}`, groesse) > spaltenBreite - 10) {
      groesse -= 0.25
    }
    gewerke.forEach((gewerk, i) => {
      const spalte = Math.floor(i / gewerkeZeilen)
      const zeile = i % gewerkeZeilen
      page.drawText(`• ${winAnsi(gewerk)}`, {
        x: RAND + spalte * spaltenBreite,
        y: y - zeile * GEWERK_SCHRITT,
        size: groesse,
        font: regular,
        color: BROWN,
      })
    })
    y -= gewerkeZeilen * GEWERK_SCHRITT
  }

  if (daten.hinweis) {
    const hoehe = 36 + hinweisZeilen.length * HINWEIS_SCHRITT + 12
    // Nie unter das Logo rutschen, auch wenn die Angaben lang sind.
    const kastenY = Math.max(44 + logoHoehe + 20, y - 14 - hoehe)
    page.drawRectangle({
      x: RAND,
      y: kastenY,
      width: W - 2 * RAND,
      height: hoehe,
      borderColor: RED,
      borderWidth: 1.2,
    })
    page.drawText(winAnsi(daten.hinweis.titel), {
      x: RAND + 16,
      y: kastenY + hoehe - 22,
      size: 10.5,
      font: bold,
      color: RED,
    })
    hinweisZeilen.forEach((zeile, i) => {
      page.drawText(zeile, {
        x: RAND + 16,
        y: kastenY + hoehe - 40 - i * HINWEIS_SCHRITT,
        size: HINWEIS_GROESSE,
        font: regular,
        color: BROWN,
      })
    })
  }

  page.drawImage(logo, { x: W - RAND - logoBreite, y: 44, width: logoBreite, height: logoHoehe })
  return page
}
