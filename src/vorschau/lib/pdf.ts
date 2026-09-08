/**
 * PDF "ISOTEC Sanierungsvorschau" (Yann, 05.09.2026).
 *
 * A4 hoch. Titelseite rein typografisch im ISOTEC-Design, ohne Bild (Yanns
 * Vorgabe). Danach je Foto eine Seite mit Vorher oben und Nachher darunter,
 * genau in der Variante, die gerade ausgewaehlt ist. Untereinander statt
 * nebeneinander, weil die Bilder im Hochformat so deutlich groesser werden:
 * bei einem Querformat-Foto 455 statt 248 Punkt Breite.
 *
 * Farben aus dem Corporate-Design-Handbuch, Schrift Helvetica (im Handbuch
 * FF Dax, die liegt hier nicht als Datei vor). pdf-lib laeuft komplett im
 * Browser, wie in der Fotodoku.
 */
import { PDFDocument, PDFFont, PDFImage, PDFPage, StandardFonts, rgb } from 'pdf-lib'

const RED = rgb(213 / 255, 19 / 255, 23 / 255) // #D51317
const BROWN = rgb(86 / 255, 74 / 255, 68 / 255) // #564A44
const GREY = rgb(224 / 255, 224 / 255, 224 / 255) // #E0E0E0
const LIGHT = rgb(244 / 255, 244 / 255, 244 / 255) // #F4F4F4
const MUTED = rgb(138 / 255, 127 / 255, 120 / 255)
const WHITE = rgb(1, 1, 1)

// A4 hoch in Punkt
const W = 595.28
const H = 841.89
const RAND = 40

const FIRMA = 'Abdichtungstechnik Dipl.-Ing. Morscheck GmbH'
const HINWEIS = 'KI-Visualisierung, kein zugesichertes Sanierungsergebnis'

export type PdfEintrag = {
  name: string
  /** Bezeichnung der gewaehlten Variante, 'Standard' wird nicht gedruckt. */
  variante: string
  vorher: Blob
  nachher: Blob
}

/** Bild als JPEG mit begrenzter Kante, damit die PDF handlich bleibt (Nachher kommt oft als PNG). */
async function zuJpeg(blob: Blob, maxKante = 1600): Promise<Uint8Array> {
  const bitmap = await createImageBitmap(blob)
  const faktor = Math.min(1, maxKante / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * faktor)
  canvas.height = Math.round(bitmap.height * faktor)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas nicht verfügbar')
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const jpeg = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Bild konnte nicht umgewandelt werden'))), 'image/jpeg', 0.85)
  })
  return new Uint8Array(await jpeg.arrayBuffer())
}

function eingepasst(bild: PDFImage, maxB: number, maxH: number): { w: number; h: number } {
  const s = Math.min(maxB / bild.width, maxH / bild.height)
  return { w: bild.width * s, h: bild.height * s }
}

function gekuerzt(font: PDFFont, text: string, groesse: number, maxB: number): string {
  if (font.widthOfTextAtSize(text, groesse) <= maxB) return text
  let t = text
  while (t.length > 1 && font.widthOfTextAtSize(`${t}…`, groesse) > maxB) t = t.slice(0, -1)
  return `${t.trimEnd()}…`
}

/** Farbige Marke mit weisser Schrift, wie die Vorher/Nachher-Marken in der App. */
function marke(page: PDFPage, font: PDFFont, text: string, x: number, y: number, farbe = BROWN) {
  const groesse = 10
  const b = font.widthOfTextAtSize(text, groesse)
  page.drawRectangle({ x, y, width: b + 14, height: 18, color: farbe })
  page.drawText(text, { x: x + 7, y: y + 5, size: groesse, font, color: WHITE })
}

function fusszeile(page: PDFPage, regular: PDFFont, links: string, rechts: string) {
  page.drawRectangle({ x: 0, y: 0, width: W, height: 6, color: RED })
  page.drawText(links, { x: RAND, y: 18, size: 8, font: regular, color: MUTED })
  const b = regular.widthOfTextAtSize(rechts, 8)
  page.drawText(rechts, { x: W - RAND - b, y: 18, size: 8, font: regular, color: MUTED })
}

export async function erzeugeSanierungsvorschauPdf(
  eintraege: PdfEintrag[],
  logoPng: Uint8Array,
): Promise<Blob> {
  if (eintraege.length === 0) throw new Error('Keine fertigen Bilder für die PDF')

  const doc = await PDFDocument.create()
  doc.setTitle('ISOTEC Sanierungsvorschau')
  doc.setAuthor(FIRMA)
  doc.setCreator('ISOTEC-Sanierungsvorschau')
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const regular = await doc.embedFont(StandardFonts.Helvetica)
  const logo = await doc.embedPng(logoPng)
  const gesamt = eintraege.length + 1
  const datum = new Date().toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })

  // ---- Titelseite: rein typografisch, ohne Bild ----
  {
    const page = doc.addPage([W, H])
    page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: WHITE })

    // Logo oben links, darunter eine feine Linie als Abschluss des Kopfs
    const logoH = 40
    const logoW = (logo.width / logo.height) * logoH
    page.drawImage(logo, { x: RAND, y: H - RAND - logoH, width: logoW, height: logoH })
    page.drawLine({
      start: { x: RAND, y: H - RAND - logoH - 24 },
      end: { x: W - RAND, y: H - RAND - logoH - 24 },
      thickness: 0.8,
      color: GREY,
    })

    // Titelblock etwa auf halber Hoehe
    let y = H * 0.56
    page.drawText('Sanierungsvorschau', { x: RAND, y, size: 34, font: bold, color: BROWN })
    y -= 20
    page.drawRectangle({ x: RAND, y, width: 80, height: 5, color: RED })
    y -= 32
    page.drawText('Ihr Keller vorher und nachher', { x: RAND, y, size: 15, font: regular, color: MUTED })

    // Infoblock: warmes Hellgrau mit roter Akzentkante, wie die Karten in der App
    const blockH = 104
    const blockY = 268
    page.drawRectangle({ x: RAND, y: blockY, width: W - 2 * RAND, height: blockH, color: LIGHT })
    page.drawRectangle({ x: RAND, y: blockY, width: 4, height: blockH, color: RED })
    const zeilen: Array<[string, string]> = [
      ['Erstellt am', datum],
      ['Umfang', `${eintraege.length} ${eintraege.length === 1 ? 'Foto' : 'Fotos'} im Vergleich`],
      ['Erstellt von', FIRMA],
    ]
    let zy = blockY + blockH - 30
    for (const [kopf, wert] of zeilen) {
      page.drawText(kopf, { x: RAND + 20, y: zy, size: 9, font: regular, color: MUTED })
      page.drawText(wert, { x: RAND + 130, y: zy, size: 11, font: bold, color: BROWN })
      zy -= 26
    }

    // Wichtiger Hinweis (Yann, 07.09.2026): Der Kunde soll uns am Ende nicht an
    // den Bildern messen. Deshalb deutlich, als eigener Kasten, in Sie-Form.
    const hinweisY = 100
    const hinweisH = 140
    page.drawRectangle({
      x: RAND,
      y: hinweisY,
      width: W - 2 * RAND,
      height: hinweisH,
      borderColor: RED,
      borderWidth: 1.2,
      color: WHITE,
    })
    page.drawText('Wichtiger Hinweis zu den Bildern', {
      x: RAND + 18,
      y: hinweisY + hinweisH - 26,
      size: 11.5,
      font: bold,
      color: RED,
    })
    page.drawText(
      'Die Nachher-Bilder in dieser Unterlage sind mit künstlicher Intelligenz erzeugte Visualisierungen. ' +
        'Sie zeigen eine mögliche Sanierungsmaßnahme als unverbindliche Vorschau und stellen nicht das ' +
        'tatsächliche oder zu bewertende Ergebnis dar. Farben, Oberflächen, Details und dargestellte ' +
        'Einrichtung können vom ausgeführten Ergebnis abweichen. Maßgeblich für Umfang und Ausführung ' +
        'der Sanierung sind ausschließlich das Angebot und die Auftragsbestätigung.',
      {
        x: RAND + 18,
        y: hinweisY + hinweisH - 48,
        size: 9.5,
        font: regular,
        color: BROWN,
        maxWidth: W - 2 * RAND - 36,
        lineHeight: 13.5,
      },
    )

    fusszeile(page, regular, HINWEIS, `Seite 1 von ${gesamt}`)
  }

  // ---- Je Foto eine Seite: Vorher oben, Nachher unten ----
  for (const [i, e] of eintraege.entries()) {
    const page = doc.addPage([W, H])
    page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: WHITE })

    // Kopf
    const kopfY = H - 52
    const rechts = `Foto ${i + 1} von ${eintraege.length}`
    const rechtsB = regular.widthOfTextAtSize(rechts, 10)
    page.drawText(rechts, { x: W - RAND - rechtsB, y: kopfY, size: 10, font: regular, color: MUTED })
    const titel = gekuerzt(bold, e.name, 15, W - 2 * RAND - rechtsB - 20)
    page.drawText(titel, { x: RAND, y: kopfY, size: 15, font: bold, color: BROWN })
    if (e.variante && e.variante !== 'Standard') {
      page.drawText(e.variante, { x: RAND, y: kopfY - 15, size: 9.5, font: regular, color: MUTED })
    }
    const trennY = H - 80
    page.drawLine({ start: { x: RAND, y: trennY }, end: { x: W - RAND, y: trennY }, thickness: 0.8, color: GREY })

    // Zwei Bildfelder untereinander
    const oben = trennY - 16
    const unten = 44
    const spalt = 18
    const feldB = W - 2 * RAND
    const feldH = (oben - unten - spalt) / 2
    const vorher = await doc.embedJpg(await zuJpeg(e.vorher))
    const nachher = await doc.embedJpg(await zuJpeg(e.nachher))
    const felder: Array<[PDFImage, number, string, ReturnType<typeof rgb>]> = [
      [vorher, oben - feldH, 'Vorher', BROWN],
      [nachher, unten, 'Nachher', RED],
    ]
    for (const [bild, feldY, text, farbe] of felder) {
      const g = eingepasst(bild, feldB, feldH)
      const x = RAND + (feldB - g.w) / 2
      const y = feldY + (feldH - g.h) / 2
      page.drawImage(bild, { x, y, width: g.w, height: g.h })
      marke(page, bold, text, x + 10, y + g.h - 28, farbe)
    }

    fusszeile(page, regular, `ISOTEC Sanierungsvorschau · ${FIRMA}`, `Seite ${i + 2} von ${gesamt}`)
  }

  const bytes = await doc.save()
  // Kopie in einen eigenen ArrayBuffer: pdf-lib liefert Uint8Array<ArrayBufferLike>,
  // Blob verlangt ArrayBuffer.
  return new Blob([Uint8Array.from(bytes)], { type: 'application/pdf' })
}
