import {
  PDFDocument,
  PDFFont,
  PDFImage,
  PDFPage,
  clip,
  endPath,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  rgb,
} from 'pdf-lib'

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
  /**
   * Mittlere Farbe der linken und rechten Bildkante, 0 bis 1 je Kanal.
   * Wird nur beim Objektfoto mitgegeben (siehe deckblattbilder.ts) und nur
   * gebraucht, wenn das Bild nicht formatfuellend gezeigt werden kann: Dann
   * setzen diese Farben die Flaeche daneben fort, statt sie hell zu lassen.
   */
  kanten?: { links: [number, number, number]; rechts: [number, number, number] }
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

/**
 * Formatfuellend: Das Bild deckt die Flaeche vollstaendig ab, der Ueberstand
 * wird abgeschnitten (Yann, 09.09.2026: "ziehe das Bild immer so, dass nie
 * Raender entstehen"). Vorher wurde eingepasst, wodurch oben und an den Seiten
 * heller Grund stehen blieb.
 */
function fuellend(breite: number, hoehe: number, flaecheB: number, flaecheH: number) {
  const faktor = Math.max(flaecheB / breite, flaecheH / hoehe)
  return { w: breite * faktor, h: hoehe * faktor }
}

function eingepasst(breite: number, hoehe: number, maxB: number, maxH: number) {
  const faktor = Math.min(maxB / breite, maxH / hoehe)
  return { w: breite * faktor, h: hoehe * faktor }
}

/**
 * Bis hierhin wird beschnitten, damit das Bild die Flaeche fuellt. Darueber
 * bliebe zu wenig vom Objekt uebrig: Ein Hochformat verliert bei voller Breite
 * gut 40 Prozent, man saehe nur noch den mittleren Streifen des Hauses.
 */
const MAX_BESCHNITT = 0.25

/** Streifen je Seite fuer die Fortsetzung; mehr Streifen, weicherer Verlauf. */
const VERLAUF_STREIFEN = 14

/**
 * Setzt die Flaeche links und rechts vom Bild in dessen Kantenfarben fort.
 * Die Farben kommen aus dem aufbereiteten Objektfoto (deckblattbilder.ts);
 * fehlen sie, bleibt es beim hellen Grund. Nach aussen wird die Farbe leicht
 * dunkler, damit die Flaeche nicht wie ein Farbfehler wirkt, sondern wie ein
 * bewusster Rahmen.
 */
function seitenFortsetzen(
  page: PDFPage,
  bild: PDFImage,
  quelle: DeckblattBild | null,
  bildX: number,
  bereichY: number,
  bereichH: number,
  bildBreite: number,
) {
  const kanten = quelle?.kanten
  if (!kanten) return
  const luecke = bildX
  if (luecke <= 0.5) return
  void bild
  const zeichneSeite = (vonX: number, breite: number, farbe: [number, number, number], nachAussenLinks: boolean) => {
    const schritt = breite / VERLAUF_STREIFEN
    for (let i = 0; i < VERLAUF_STREIFEN; i++) {
      // 0 an der Bildkante, 1 am Blattrand
      const anteil = (i + 0.5) / VERLAUF_STREIFEN
      const dunkler = 1 - 0.18 * anteil
      const x = nachAussenLinks ? vonX + breite - (i + 1) * schritt : vonX + i * schritt
      page.drawRectangle({
        x,
        y: bereichY,
        width: schritt + 0.5,
        height: bereichH,
        color: rgb(farbe[0] * dunkler, farbe[1] * dunkler, farbe[2] * dunkler),
      })
    }
  }
  zeichneSeite(0, luecke, kanten.links, true)
  zeichneSeite(bildX + bildBreite, luecke, kanten.rechts, false)
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
  //
  // Die Hoehe richtet sich nach dem Bild: Ein Querformat bekommt genau die
  // Hoehe, die es bei voller Breite braucht, und wird dadurch gar nicht
  // beschnitten. Erst wenn das mehr Platz kostet, als das Blatt hergibt (oder
  // bei Hochformat), greifen die Grenzen und der Ueberstand faellt weg.
  const platz = H - inhaltHoehe - fussHoehe
  const heroHoehe = objekt
    ? Math.max(230, Math.min(470, platz, Math.round(W * (objekt.height / objekt.width))))
    : 0

  // ---------- zeichnen ----------
  const heroY = H - heroHoehe
  if (objekt) {
    page.drawRectangle({ x: 0, y: heroY, width: W, height: heroHoehe, color: LIGHT })
    const voll = fuellend(objekt.width, objekt.height, W, heroHoehe)
    // Wie viel vom Bild ginge verloren, wenn es die Flaeche ausfuellt?
    const verlust = 1 - (W * heroHoehe) / (voll.w * voll.h)
    page.pushOperators(pushGraphicsState(), rectangle(0, heroY, W, heroHoehe), clip(), endPath())
    if (verlust <= MAX_BESCHNITT) {
      // Formatfuellend und mittig, der Ueberstand wird weggeschnitten. Der
      // Clip-Pfad haelt ihn zurueck; ohne ihn ragte das Bild ueber das rote
      // Band und den Text darunter.
      page.drawImage(objekt, {
        x: (W - voll.w) / 2,
        y: heroY + (heroHoehe - voll.h) / 2,
        width: voll.w,
        height: voll.h,
      })
    } else {
      // Ein Hochformat muesste man zur Haelfte wegschneiden, damit es die
      // Flaeche fuellt. Dann lieber das ganze Bild zeigen und die Flaeche
      // daneben in seinen Kantenfarben fortsetzen (Yann, 09.09.2026), damit
      // trotzdem kein heller Rand entsteht.
      const g = eingepasst(objekt.width, objekt.height, W, heroHoehe)
      const bildX = (W - g.w) / 2
      seitenFortsetzen(page, objekt, daten.objekt ?? null, bildX, heroY, heroHoehe, g.w)
      page.drawImage(objekt, { x: bildX, y: heroY + (heroHoehe - g.h) / 2, width: g.w, height: g.h })
    }
    page.pushOperators(popGraphicsState())
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
