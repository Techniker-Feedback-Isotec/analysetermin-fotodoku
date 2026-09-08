import { PDFDocument, PDFFont, PDFImage, PDFPage, rgb } from 'pdf-lib'

/**
 * Gemeinsames Deckblatt fuer Fotodokumentation, Prinzipskizze,
 * Sanierungsvorschau und die Angebotsmappe.
 *
 * Leitgedanke: weniger ist mehr (Yann, 08.09.2026). Auf dem Blatt stehen nur
 * drei Dinge - das Objekt als grosses Foto, die Art des Dokuments als grosse
 * Ueberschrift und die wenigen Angaben zum Kunden. Der Mitarbeiter wird nicht
 * namentlich genannt: Wer eine Visitenkarte hat, dessen Karte liegt unten
 * rechts auf dem Blatt und traegt Name, Rolle, Anschrift und Kontakt. Wer
 * keine hat, bekommt dort das Logo.
 *
 * Gegen Ueberschneidungen ist das Blatt durchgehend gemessen statt geraten:
 * Lange Werte werden umbrochen, jede Zeile bekommt die Hoehe, die sie
 * braucht, und die Hoehe des Objektfotos ergibt sich aus dem Platz, der nach
 * allen Angaben uebrig bleibt.
 */

const RED = rgb(213 / 255, 19 / 255, 23 / 255)
const BROWN = rgb(86 / 255, 74 / 255, 68 / 255)
const GREY = rgb(224 / 255, 224 / 255, 224 / 255)
const LIGHT = rgb(244 / 255, 244 / 255, 244 / 255)
const MUTED = rgb(138 / 255, 127 / 255, 120 / 255)

export const A4: [number, number] = [595.28, 841.89]
const RAND = 48
const FIRMA = 'ABDICHTUNGSTECHNIK DIPL.-ING. MORSCHECK GMBH'

/** Breite der Visitenkarte auf dem Blatt (rund 8 cm, also fast Originalgroesse) */
const KARTE_BREITE = 230

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
  /** Visitenkarte des Mitarbeiters; ohne Karte steht unten das Logo */
  visitenkarte?: DeckblattBild | null
  zeilen: DeckblattZeile[]
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
export function umbrechen(text: string, font: PDFFont, size: number, maxBreite: number): string[] {
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

/** Text mit weiten Buchstabenabstaenden, wie in der ISOTEC-Bildsprache. */
export function gesperrt(
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

export function einbetten(doc: PDFDocument, bild: DeckblattBild): Promise<PDFImage> {
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
  const karte = daten.visitenkarte ? await einbetten(doc, daten.visitenkarte) : null

  const textBreite = W - 2 * RAND
  const logoBreite = 150
  const logoHoehe = logoBreite * (logo.height / logo.width)
  const karteHoehe = karte ? KARTE_BREITE * (karte.height / karte.width) : 0

  // ---------- messen ----------
  const titel = winAnsi(daten.titel)
  let titelGroesse = 44
  while (titelGroesse > 22 && bold.widthOfTextAtSize(titel, titelGroesse) > textBreite) {
    titelGroesse -= 1
  }
  const unterzeile = daten.unterzeile ? winAnsi(daten.unterzeile) : null

  const LABEL_BREITE = 104
  const WERT_GROESSE = 11
  const ZEILE = 15
  const ZEILEN_ABSTAND = 8
  const zeilen = daten.zeilen
    .filter((z) => z.wert.trim() !== '')
    .map((z) => ({
      label: winAnsi(z.label),
      teile: umbrechen(winAnsi(z.wert), bold, WERT_GROESSE, textBreite - LABEL_BREITE),
    }))
  const zeilenHoehe = zeilen.reduce((summe, z) => summe + z.teile.length * ZEILE + ZEILEN_ABSTAND, 0)

  const HINWEIS_GROESSE = 9
  const HINWEIS_SCHRITT = 12.5
  const hinweisZeilen = daten.hinweis
    ? umbrechen(winAnsi(daten.hinweis.text), regular, HINWEIS_GROESSE, textBreite - 32)
    : []
  const hinweisHoehe = daten.hinweis ? 36 + hinweisZeilen.length * HINWEIS_SCHRITT + 12 : 0

  const kopfHoehe = 30 + titelGroesse + 10 + (unterzeile ? 22 : 0) + 22
  const inhaltHoehe = kopfHoehe + 24 + zeilenHoehe + (daten.hinweis ? hinweisHoehe + 18 : 0)
  const fussHoehe = 44 + (karte ? karteHoehe : logoHoehe) + 30

  // Das Objektfoto bekommt allen Platz, der uebrig bleibt. Ohne Objektfoto
  // entfaellt der Bereich ganz, statt eine leere graue Flaeche zu zeigen; das
  // rote Band sitzt dann oben am Blatt.
  const heroHoehe = objekt ? Math.max(230, Math.min(470, H - inhaltHoehe - fussHoehe)) : 0

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
  y -= titelGroesse + 10
  page.drawText(titel, { x: RAND, y, size: titelGroesse, font: bold, color: BROWN })
  if (unterzeile) {
    y -= 22
    page.drawText(unterzeile, { x: RAND, y, size: 15, font: regular, color: MUTED })
  }
  y -= 22
  page.drawLine({ start: { x: RAND, y }, end: { x: W - RAND, y }, thickness: 0.75, color: GREY })

  // Angaben: Beschriftung grau, Wert fett
  y -= 24
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

  if (daten.hinweis) {
    const hoehe = 36 + hinweisZeilen.length * HINWEIS_SCHRITT + 12
    // Nie in den Fussbereich rutschen, auch wenn die Angaben lang sind.
    const kastenY = Math.max(44 + (karte ? karteHoehe : logoHoehe) + 24, y - 14 - hoehe)
    page.drawRectangle({
      x: RAND,
      y: kastenY,
      width: textBreite,
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

  // Unten rechts die Visitenkarte, sonst das Logo. Die Karte traegt Logo,
  // Name, Rolle und Kontakt - deshalb steht beides nie zusammen auf dem Blatt.
  if (karte) {
    const x = W - RAND - KARTE_BREITE
    page.drawImage(karte, { x, y: 44, width: KARTE_BREITE, height: karteHoehe })
    page.drawRectangle({
      x,
      y: 44,
      width: KARTE_BREITE,
      height: karteHoehe,
      borderColor: GREY,
      borderWidth: 0.75,
    })
  } else {
    page.drawImage(logo, { x: W - RAND - logoBreite, y: 44, width: logoBreite, height: logoHoehe })
  }
  return page
}
