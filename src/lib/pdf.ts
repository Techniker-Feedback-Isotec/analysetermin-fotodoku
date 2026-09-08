import { PDFDocument, PDFFont, PDFImage, PDFPage, StandardFonts, rgb } from 'pdf-lib'
import type { OptimizedImage } from './image'
import type { Reichtext, TextAbsatz, TextStueck } from './richtext'
import { formatDateShort, formatDateTime, initialsOf } from './format'

// ISOTEC-Farben (Corporate Design Handbuch 2.0)
const RED = rgb(213 / 255, 19 / 255, 23 / 255) // #D51317
const BROWN = rgb(86 / 255, 74 / 255, 68 / 255) // #564A44
const GREY = rgb(224 / 255, 224 / 255, 224 / 255) // #E0E0E0
const LIGHT = rgb(244 / 255, 244 / 255, 244 / 255) // #F4F4F4
const MUTED = rgb(138 / 255, 127 / 255, 120 / 255) // abgeschwaechtes Braun fuer Untertitel

const A4: [number, number] = [595.28, 841.89]

export interface PdfPhoto {
  image: OptimizedImage
  /** Aufnahme- bzw. Dateizeitpunkt in ms, oder null */
  takenAt: number | null
  isDuplicate: boolean
}

export interface PdfInputs {
  /** Terminart, wird zur Deckblatt-Ueberschrift: Analysetermin / Reklamation */
  terminType: string
  salespersonName: string
  /** Rund zugeschnittenes Mitarbeiterfoto (PNG mit Alpha), oder null fuer Initialen */
  salespersonImage: OptimizedImage | null
  objectImage: OptimizedImage
  /**
   * Anschrift unter dem Objektfoto, oder null. Liegt das Objekt beim Kunden,
   * steht hier "siehe Kundenadresse" statt derselben Anschrift zweimal.
   */
  objectAddress: string | null
  /** Kundenname (optionale Eingabe), oder null */
  customerName: string | null
  /** Anschrift des Kunden (optional), oder null */
  customerAddress: string | null
  /** Auftragsnummer (nur bei Reklamation, optional), oder null */
  orderNumber: string | null
  /** Gewaehlte Gewerke fuer den Block "Sanierungskonzept"; leer = kein Block */
  gewerke: string[]
  /**
   * Optionale Textseite direkt nach dem Deckblatt (Fliesstext), z. B.
   * "Fachliche Beurteilung" (Reklamation) oder "Zusammenfassung" (Analysetermin).
   * note = Vermerk am Ende (wer, wann).
   */
  textPage: { title: string; inhalt: Reichtext; note: string } | null
  /** Anzahl der geplanten Termin-Fotos (Zaehler fuer den Fortschritt) */
  photoCount: number
  /**
   * Liefert das Foto fuer Seite `index` erst, wenn es gebraucht wird - so liegt
   * nie die komplette Bildmenge gleichzeitig im Speicher. null = Foto konnte
   * nicht gelesen werden und wird uebersprungen.
   */
  loadPhoto: (index: number) => Promise<PdfPhoto | null>
  createdAt: Date
  /** Termindatum aus den Foto-Aufnahmedaten, z. B. "Mittwoch, 6. August 2026" */
  terminLabel: string
  /** Teamfoto (JPEG) fuer den Hero-Bereich des Deckblatts */
  heroJpg: Uint8Array
  /** ISOTEC-Logo (PNG) */
  logoPng: Uint8Array
}

function embed(doc: PDFDocument, img: OptimizedImage): Promise<PDFImage> {
  return img.format === 'png' ? doc.embedPng(img.bytes) : doc.embedJpg(img.bytes)
}

function fitInto(imgW: number, imgH: number, boxW: number, boxH: number) {
  const scale = Math.min(boxW / imgW, boxH / imgH)
  return { w: imgW * scale, h: imgH * scale }
}

// Zeichen ausserhalb von WinAnsi (Standard-Helvetica) durch "?" ersetzen,
// damit eingefuegter Text (z. B. mit Emojis) die PDF-Erstellung nicht abbricht.
const WINANSI_EXTRA = new Set([...'€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ'])
function toWinAnsi(text: string): string {
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

/** Bricht Text wortweise auf eine maximale Zeilenbreite um (Absaetze bleiben erhalten). */
function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    if (paragraph.trim() === '') {
      lines.push('')
      continue
    }
    let current = ''
    for (const word of paragraph.split(/\s+/)) {
      const candidate = current ? `${current} ${word}` : word
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        current = candidate
      } else {
        if (current) lines.push(current)
        let rest = word
        while (font.widthOfTextAtSize(rest, size) > maxWidth && rest.length > 1) {
          let cut = rest.length - 1
          while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > maxWidth) cut--
          lines.push(rest.slice(0, cut))
          rest = rest.slice(cut)
        }
        current = rest
      }
    }
    lines.push(current)
  }
  return lines
}

/** Text mit Buchstaben-Sperrung (pdf-lib kennt kein letter-spacing). */
function drawTracked(
  page: PDFPage,
  text: string,
  x: number,
  y: number,
  font: PDFFont,
  size: number,
  color: ReturnType<typeof rgb>,
  tracking: number,
) {
  let cx = x
  for (const ch of text) {
    page.drawText(ch, { x: cx, y, size, font, color })
    cx += font.widthOfTextAtSize(ch, size) + tracking
  }
}

/**
 * Baut die PDF: Deckblatt (Stil "Einarbeitungsmappe") + exakt 1 Foto pro Seite.
 * onProgress wird nach jeder eingefuegten Fotoseite aufgerufen.
 */
export async function buildPdf(
  inputs: PdfInputs,
  onProgress?: (done: number, total: number) => void,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.setTitle(`${inputs.terminType} - Fotodokumentation`)
  doc.setSubject(`${inputs.terminType} ${inputs.terminLabel} - ${inputs.salespersonName}`)
  doc.setCreator('Fotodoku (100 % clientseitig)')
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const regular = await doc.embedFont(StandardFonts.Helvetica)
  const italic = await doc.embedFont(StandardFonts.HelveticaOblique)
  // Fuer fett und kursiv zugleich im formatierten Text
  const boldItalic = await doc.embedFont(StandardFonts.HelveticaBoldOblique)
  const [W, H] = A4
  const logo = await doc.embedPng(inputs.logoPng)

  // ---------- Deckblatt ----------
  {
    const page = doc.addPage(A4)
    const margin = 48

    // Hero: Teamfoto in voller Breite, darunter rotes Band
    const hero = await doc.embedJpg(inputs.heroJpg)
    const heroH = W * (hero.height / hero.width)
    page.drawImage(hero, { x: 0, y: H - heroH, width: W, height: heroH })
    const bandH = 14
    const bandY = H - heroH - bandH
    page.drawRectangle({ x: 0, y: bandY, width: W, height: bandH, color: RED })

    // Kicker + Titelblock
    let cursor = bandY - 42
    drawTracked(page, 'ABDICHTUNGSTECHNIK DIPL.-ING. MORSCHECK GMBH', margin, cursor, bold, 9, RED, 1.6)
    cursor -= 33
    page.drawText(inputs.terminType, { x: margin, y: cursor, size: 30, font: bold, color: BROWN })
    // Bei der Prinzipskizze ist die Terminart selbst der Titel, die Unterzeile
    // "Fotodokumentation" entfaellt dort auf Wunsch der Vertriebler.
    if (inputs.terminType !== 'Prinzipskizze') {
      cursor -= 25
      page.drawText('Fotodokumentation', { x: margin, y: cursor, size: 16, font: regular, color: MUTED })
    }
    cursor -= 19
    page.drawLine({
      start: { x: margin, y: cursor },
      end: { x: W - margin, y: cursor },
      thickness: 0.75,
      color: GREY,
    })
    const ruleY = cursor

    // Objektfoto rechts. Die Hoehe richtet sich nach dem tatsaechlich freien Platz
    // bis zum Logo - sonst schieben Hochkant-Fotos die Beschriftung ins Logo.
    const logoW = 150
    const logoH = logoW * (logo.height / logo.width)
    const logoY = 48
    const objBoxW = 220
    const objTop = ruleY - 10
    const labelH = inputs.objectAddress ? 34 : 20
    const objBoxH = Math.max(80, objTop - (logoY + logoH + 14) - labelH)
    const objImg = await embed(doc, inputs.objectImage)
    const objFit = fitInto(objImg.width, objImg.height, objBoxW, objBoxH)
    const objX = W - margin - objFit.w
    const objY = objTop - objFit.h
    page.drawRectangle({
      x: objX - 4,
      y: objY - 4,
      width: objFit.w + 8,
      height: objFit.h + 8,
      color: LIGHT,
      borderColor: GREY,
      borderWidth: 1,
    })
    page.drawImage(objImg, { x: objX, y: objY, width: objFit.w, height: objFit.h })
    page.drawText('Objekt', { x: objX, y: objY - 16, size: 9, font: regular, color: MUTED })
    if (inputs.objectAddress) {
      // Adresse unter der Objekt-Beschriftung. Reicht die Bildbreite nicht, darf der
      // Text nach links bis zur Spaltenkante wandern; erst danach wird verkleinert.
      const addr = toWinAnsi(inputs.objectAddress)
      const colLeft = W - margin - objBoxW
      const fullW = bold.widthOfTextAtSize(addr, 9)
      const addrX = objX + fullW > W - margin ? Math.max(colLeft, W - margin - fullW) : objX
      const avail = W - margin - addrX
      const addrSize = fullW > avail ? Math.max(6.5, (9 * avail) / fullW) : 9
      page.drawText(addr, { x: addrX, y: objY - 30, size: addrSize, font: bold, color: BROWN })
    }

    // Infoblock links
    cursor -= 30
    page.drawText(inputs.salespersonName, { x: margin, y: cursor, size: 14, font: bold, color: BROWN })
    cursor -= 21
    if (inputs.customerName) {
      page.drawText(`Kunde: ${inputs.customerName}`, {
        x: margin,
        y: cursor,
        size: 11,
        font: regular,
        color: BROWN,
      })
      cursor -= 18
    }
    if (inputs.customerAddress) {
      page.drawText('Kundenadresse: ' + toWinAnsi(inputs.customerAddress), {
        x: margin,
        y: cursor,
        size: 11,
        font: regular,
        color: BROWN,
      })
      cursor -= 18
    }
    if (inputs.orderNumber) {
      page.drawText(`Auftragsnummer: ${toWinAnsi(inputs.orderNumber)}`, {
        x: margin,
        y: cursor,
        size: 11,
        font: regular,
        color: BROWN,
      })
      cursor -= 18
    }
    page.drawText(`Termin: ${inputs.terminLabel}`, {
      x: margin,
      y: cursor,
      size: 11,
      font: regular,
      color: BROWN,
    })
    cursor -= 18
    page.drawText(
      `Fotodokumentation: ${inputs.photoCount} ${inputs.photoCount === 1 ? 'Foto' : 'Fotos'}, erstellt am ${formatDateShort(inputs.createdAt.getTime())}`,
      { x: margin, y: cursor, size: 11, font: regular, color: BROWN },
    )

    // Unten links: rundes Vertrieblerfoto (oder Initialen-Kreis)
    const d = 88
    const circleY = 44

    // Sanierungskonzept: die gewaehlten Gewerke, nur wenn welche gewaehlt sind.
    // Der Block sitzt unter dem Infoblock und muss ueber dem runden Foto enden.
    if (inputs.gewerke.length > 0) {
      cursor -= 28
      page.drawText('Sanierungskonzept', { x: margin, y: cursor, size: 12, font: bold, color: BROWN })
      cursor -= 18

      // Nur die linke Spalte nutzen, rechts steht das Objektfoto.
      const spaltenBereich = W - margin - objBoxW - 12 - margin
      const spalten = inputs.gewerke.length > 4 ? 2 : 1
      const zeilen = Math.ceil(inputs.gewerke.length / spalten)
      const spaltenBreite = spaltenBereich / spalten

      // Zeilenabstand an den Platz bis zum runden Foto anpassen.
      const platz = cursor - (circleY + d + 12)
      const schritt = Math.min(15, Math.max(9.5, platz / zeilen))

      // Schrift so weit verkleinern, dass der laengste Eintrag in seine Spalte passt.
      let size = Math.min(10.5, schritt - 3.5)
      const laengster = inputs.gewerke.reduce((a, b) => (a.length >= b.length ? a : b), '')
      while (size > 7.5 && regular.widthOfTextAtSize(`• ${toWinAnsi(laengster)}`, size) > spaltenBreite - 8) {
        size -= 0.5
      }

      inputs.gewerke.forEach((gewerk, index) => {
        const spalte = Math.floor(index / zeilen)
        const zeile = index % zeilen
        page.drawText(`• ${toWinAnsi(gewerk)}`, {
          x: margin + spalte * spaltenBreite,
          y: cursor - zeile * schritt,
          size,
          font: regular,
          color: BROWN,
        })
      })
      cursor -= zeilen * schritt
    }
    if (inputs.salespersonImage) {
      const spImg = await embed(doc, inputs.salespersonImage)
      page.drawImage(spImg, { x: margin, y: circleY, width: d, height: d })
      page.drawEllipse({
        x: margin + d / 2,
        y: circleY + d / 2,
        xScale: d / 2,
        yScale: d / 2,
        borderColor: RED,
        borderWidth: 2,
      })
    } else {
      page.drawEllipse({
        x: margin + d / 2,
        y: circleY + d / 2,
        xScale: d / 2,
        yScale: d / 2,
        color: LIGHT,
        borderColor: RED,
        borderWidth: 2,
      })
      const initials = initialsOf(inputs.salespersonName) || '?'
      const size = 30
      const tw = bold.widthOfTextAtSize(initials, size)
      page.drawText(initials, {
        x: margin + (d - tw) / 2,
        y: circleY + d / 2 - size * 0.36,
        size,
        font: bold,
        color: RED,
      })
    }

    // Unten rechts: ISOTEC-Logo (inkl. Claim "IMMER BESSER.")
    page.drawImage(logo, { x: W - margin - logoW, y: logoY, width: logoW, height: logoH })
  }

  // ---------- Optionale Textseite (nur wenn ausgefuellt, direkt nach dem Deckblatt) ----------
  if (inputs.textPage) {
    const { title, inhalt, note } = inputs.textPage
    const margin = 48
    const textSize = 11
    const lineHeight = 17
    const bottomLimit = 70

    const newTextPage = (first: boolean) => {
      const page = doc.addPage(A4)
      const pageLogoW = 70
      const pageLogoH = pageLogoW * (logo.height / logo.width)
      page.drawImage(logo, {
        x: W - margin + 8 - pageLogoW,
        y: H - 12 - pageLogoH,
        width: pageLogoW,
        height: pageLogoH,
      })
      let y = H - 76
      if (first) {
        drawTracked(page, inputs.terminType.toUpperCase(), margin, y, bold, 9, RED, 1.6)
        y -= 26
        page.drawText(title, { x: margin, y, size: 22, font: bold, color: BROWN })
        y -= 14
        page.drawLine({
          start: { x: margin, y },
          end: { x: W - margin, y },
          thickness: 0.75,
          color: GREY,
        })
        y -= 28
      }
      return { page, y }
    }

    // Formatierter Text aus dem Textfenster. Fett, kursiv und unterstrichen
    // koennen mitten in der Zeile wechseln, deshalb traegt jedes Stueck seine
    // eigene Schrift und die Zeile wird aus einzelnen Teilen zusammengesetzt.
    const einzug = 16

    /** Ein Stueck Zeile mit fester Schrift: Wortteil oder Leerzeichen. */
    interface Teil {
      text: string
      font: PDFFont
      unterstrichen: boolean
      breite: number
    }
    /** Ein Wort, das nicht umbrochen werden darf; kann mehrere Schriften enthalten. */
    interface Wort {
      teile: Teil[]
      breite: number
      abstandDavor: boolean
    }

    const schriftFuer = (s: TextStueck): PDFFont =>
      s.fett ? (s.kursiv ? boldItalic : bold) : s.kursiv ? italic : regular

    const teilVon = (text: string, font: PDFFont, unterstrichen: boolean): Teil => ({
      text,
      font,
      unterstrichen,
      breite: font.widthOfTextAtSize(text, textSize),
    })

    const worteVon = (stuecke: TextStueck[], maxBreite: number): Wort[] => {
      const worte: Wort[] = []
      let teile: Teil[] = []
      let abstand = false
      const wortAbschliessen = () => {
        if (teile.length === 0) return
        worte.push({
          teile,
          breite: teile.reduce((summe, t) => summe + t.breite, 0),
          abstandDavor: abstand,
        })
        teile = []
        abstand = false
      }
      for (const stueck of stuecke) {
        const font = schriftFuer(stueck)
        for (const zeichenfolge of toWinAnsi(stueck.text).split(/( )/)) {
          if (zeichenfolge === '') continue
          if (zeichenfolge === ' ') {
            wortAbschliessen()
            abstand = true
            continue
          }
          // Ueberlange Woerter (etwa Dateinamen ohne Leerzeichen) hart trennen
          let rest = zeichenfolge
          while (font.widthOfTextAtSize(rest, textSize) > maxBreite && rest.length > 1) {
            let schnitt = rest.length - 1
            while (schnitt > 1 && font.widthOfTextAtSize(rest.slice(0, schnitt), textSize) > maxBreite) {
              schnitt--
            }
            teile.push(teilVon(rest.slice(0, schnitt), font, stueck.unterstrichen))
            wortAbschliessen()
            rest = rest.slice(schnitt)
          }
          teile.push(teilVon(rest, font, stueck.unterstrichen))
        }
      }
      wortAbschliessen()
      return worte
    }

    let { page, y } = newTextPage(true)

    const zeichneAbsatz = (absatz: TextAbsatz) => {
      const linkerRand = margin + (absatz.art === 'punkt' ? einzug : 0)
      const maxBreite = W - margin - linkerRand
      const worte = worteVon(absatz.stuecke, maxBreite)
      if (worte.length === 0) {
        // Leerzeile zwischen zwei Absaetzen
        y -= lineHeight * 0.6
        return
      }

      let zeile: Teil[] = []
      let breite = 0
      let ersteZeile = true

      const zeileZeichnen = () => {
        if (zeile.length === 0) return
        if (y < bottomLimit) {
          ;({ page, y } = newTextPage(false))
        }
        let x = linkerRand
        if (absatz.art === 'punkt' && ersteZeile) {
          page.drawText('•', { x: margin + 3, y, size: textSize, font: regular, color: BROWN })
        }
        // Der Unterstrich wird als durchgehende Linie gezogen, auch ueber
        // Leerzeichen hinweg - sonst zerfaellt er in einzelne Stuecke.
        let strichAb: number | null = null
        for (const teil of zeile) {
          if (teil.unterstrichen && strichAb === null) strichAb = x
          if (!teil.unterstrichen && strichAb !== null) {
            page.drawLine({
              start: { x: strichAb, y: y - 2 },
              end: { x, y: y - 2 },
              thickness: 0.6,
              color: BROWN,
            })
            strichAb = null
          }
          if (teil.text !== ' ') {
            page.drawText(teil.text, { x, y, size: textSize, font: teil.font, color: BROWN })
          }
          x += teil.breite
        }
        if (strichAb !== null) {
          page.drawLine({
            start: { x: strichAb, y: y - 2 },
            end: { x, y: y - 2 },
            thickness: 0.6,
            color: BROWN,
          })
        }
        y -= lineHeight
        ersteZeile = false
        zeile = []
        breite = 0
      }

      for (const wort of worte) {
        const vorheriges = zeile[zeile.length - 1]
        const leerzeichen =
          wort.abstandDavor && zeile.length > 0
            ? teilVon(
                ' ',
                wort.teile[0].font,
                wort.teile[0].unterstrichen && (vorheriges?.unterstrichen ?? false),
              )
            : null
        if (zeile.length > 0 && breite + (leerzeichen?.breite ?? 0) + wort.breite > maxBreite) {
          zeileZeichnen()
        }
        if (zeile.length > 0 && leerzeichen) {
          zeile.push(leerzeichen)
          breite += leerzeichen.breite
        }
        zeile.push(...wort.teile)
        breite += wort.breite
      }
      zeileZeichnen()
    }

    for (const absatz of inhalt) zeichneAbsatz(absatz)

    // Vermerk am Ende (wer, wann)
    const noteLines = wrapText(toWinAnsi(note), italic, 10, W - 2 * margin)
    const noteHeight = 24 + noteLines.length * 15
    if (y - noteHeight < 40) {
      ;({ page, y } = newTextPage(false))
    }
    y -= 8
    page.drawLine({
      start: { x: margin, y },
      end: { x: W - margin, y },
      thickness: 0.5,
      color: GREY,
    })
    y -= 20
    for (const line of noteLines) {
      page.drawText(line, { x: margin, y, size: 10, font: italic, color: BROWN })
      y -= 15
    }
  }

  // ---------- Fotoseiten: exakt 1 Foto pro Seite ----------
  // Jedes Foto wird erst hier geladen und nach dem Einbetten wieder freigegeben.
  const margin = 40
  const footerH = 32
  const footers: Array<{ page: PDFPage; takenAt: number | null; isDuplicate: boolean }> = []

  for (let i = 0; i < inputs.photoCount; i++) {
    const photo = await inputs.loadPhoto(i)
    onProgress?.(i + 1, inputs.photoCount)
    if (!photo) continue // nicht lesbar - Seite wird uebersprungen

    const page = doc.addPage(A4)
    const pageLogoW = 70
    const pageLogoH = pageLogoW * (logo.height / logo.width)
    page.drawImage(logo, {
      x: W - margin - pageLogoW,
      y: H - 12 - pageLogoH,
      width: pageLogoW,
      height: pageLogoH,
    })

    const img = await embed(doc, photo.image)
    const { w, h } = fitInto(img.width, img.height, W - 2 * margin, H - 2 * margin - footerH)
    const x = (W - w) / 2
    const y = footerH + margin + (H - 2 * margin - footerH - h) / 2
    page.drawImage(img, { x, y, width: w, height: h })

    footers.push({ page, takenAt: photo.takenAt, isDuplicate: photo.isDuplicate })
  }

  // Fusszeilen erst jetzt zeichnen - dann stimmt "Foto X / N" auch, wenn
  // einzelne Fotos uebersprungen wurden.
  const total = footers.length
  footers.forEach((f, idx) => {
    f.page.drawLine({
      start: { x: margin, y: footerH },
      end: { x: W - margin, y: footerH },
      thickness: 0.5,
      color: GREY,
    })
    let label = `Foto ${idx + 1} / ${total}`
    if (f.isDuplicate) label += '  -  Duplikat'
    f.page.drawText(label, { x: margin, y: footerH - 15, size: 9, font: regular, color: BROWN })
    if (f.takenAt != null) {
      const dateText = formatDateTime(f.takenAt)
      const dw = regular.widthOfTextAtSize(dateText, 9)
      f.page.drawText(dateText, {
        x: W - margin - dw,
        y: footerH - 15,
        size: 9,
        font: regular,
        color: BROWN,
      })
    }
  })

  return doc.save()
}
