import { PDFDocument, PDFFont, PDFImage, PDFPage, StandardFonts, rgb } from 'pdf-lib'
import type { OptimizedImage } from './image'
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
  /** Terminart, wird zur Deckblatt-Ueberschrift: Analysetermin / Reklamation / Baustellenbesuch */
  terminType: string
  salespersonName: string
  /** Rund zugeschnittenes Mitarbeiterfoto (PNG mit Alpha), oder null fuer Initialen */
  salespersonImage: OptimizedImage | null
  objectImage: OptimizedImage
  /** Objektadresse (optionale manuelle Eingabe), oder null */
  objectAddress: string | null
  /** Kundenname (optionale Eingabe), oder null */
  customerName: string | null
  /** Auftragsnummer (nur bei Reklamation, optional), oder null */
  orderNumber: string | null
  /**
   * Optionale Textseite direkt nach dem Deckblatt (Fliesstext), z. B.
   * "Fachliche Beurteilung" (Reklamation) oder "Zusammenfassung" (Analysetermin).
   * note = Vermerk am Ende (wer, wann).
   */
  textPage: { title: string; text: string; note: string } | null
  photos: PdfPhoto[]
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
    cursor -= 25
    page.drawText('Fotodokumentation', { x: margin, y: cursor, size: 16, font: regular, color: MUTED })
    cursor -= 19
    page.drawLine({
      start: { x: margin, y: cursor },
      end: { x: W - margin, y: cursor },
      thickness: 0.75,
      color: GREY,
    })
    const ruleY = cursor

    // Objektfoto rechts
    const objBoxW = 220
    const objBoxH = 190
    const objTop = ruleY - 10
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
      // Adresse unter der Objekt-Beschriftung; Schrift ggf. verkleinern, damit sie
      // nicht ueber den Seitenrand laeuft
      let addrSize = 9
      const maxW = W - margin - objX
      const w9 = regular.widthOfTextAtSize(inputs.objectAddress, addrSize)
      if (w9 > maxW) addrSize = Math.max(6.5, (addrSize * maxW) / w9)
      page.drawText(inputs.objectAddress, {
        x: objX,
        y: objY - 30,
        size: addrSize,
        font: bold,
        color: BROWN,
      })
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
      `Fotodokumentation: ${inputs.photos.length} ${inputs.photos.length === 1 ? 'Foto' : 'Fotos'}, erstellt am ${formatDateShort(inputs.createdAt.getTime())}`,
      { x: margin, y: cursor, size: 11, font: regular, color: BROWN },
    )

    // Unten links: rundes Vertrieblerfoto (oder Initialen-Kreis)
    const d = 88
    const circleY = 44
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
    const logoW = 150
    const logoH = logoW * (logo.height / logo.width)
    page.drawImage(logo, { x: W - margin - logoW, y: 48, width: logoW, height: logoH })
  }

  // ---------- Optionale Textseite (nur wenn ausgefuellt, direkt nach dem Deckblatt) ----------
  if (inputs.textPage) {
    const { title, text, note } = inputs.textPage
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

    // Fliesstext: Zeilen umbrechen, Leerzeilen bleiben als Absatzabstand erhalten
    const lines = wrapText(toWinAnsi(text), regular, textSize, W - 2 * margin)
    let { page, y } = newTextPage(true)
    for (const line of lines) {
      if (y < bottomLimit) {
        ;({ page, y } = newTextPage(false))
      }
      if (line !== '') {
        page.drawText(line, { x: margin, y, size: textSize, font: regular, color: BROWN })
      }
      y -= lineHeight
    }

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
  const total = inputs.photos.length
  for (let i = 0; i < total; i++) {
    const photo = inputs.photos[i]
    const page = doc.addPage(A4)
    const margin = 40
    const footerH = 32
    // Kleines ISOTEC-Logo oben rechts im Seitenrand
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

    page.drawLine({
      start: { x: margin, y: footerH },
      end: { x: W - margin, y: footerH },
      thickness: 0.5,
      color: GREY,
    })
    let label = `Foto ${i + 1} / ${total}`
    if (photo.isDuplicate) label += '  -  Duplikat'
    page.drawText(label, { x: margin, y: footerH - 15, size: 9, font: regular, color: BROWN })
    if (photo.takenAt != null) {
      const dateText = formatDateTime(photo.takenAt)
      const dw = regular.widthOfTextAtSize(dateText, 9)
      page.drawText(dateText, {
        x: W - margin - dw,
        y: footerH - 15,
        size: 9,
        font: regular,
        color: BROWN,
      })
    }
    onProgress?.(i + 1, total)
  }

  return doc.save()
}
