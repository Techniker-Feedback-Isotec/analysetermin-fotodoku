import { PDFDocument, PDFImage, StandardFonts, rgb } from 'pdf-lib'
import type { OptimizedImage } from './image'
import { formatDate, formatDateTime, initialsOf } from './format'

// ISOTEC-Farben (Corporate Design Handbuch 2.0)
const RED = rgb(213 / 255, 19 / 255, 23 / 255) // #D51317
const BROWN = rgb(86 / 255, 74 / 255, 68 / 255) // #564A44
const GREY = rgb(224 / 255, 224 / 255, 224 / 255) // #E0E0E0
const LIGHT = rgb(244 / 255, 244 / 255, 244 / 255) // #F4F4F4
const WHITE = rgb(1, 1, 1)

const A4: [number, number] = [595.28, 841.89]

export interface PdfPhoto {
  image: OptimizedImage
  /** Aufnahme- bzw. Dateizeitpunkt in ms, oder null */
  takenAt: number | null
  isDuplicate: boolean
}

export interface PdfInputs {
  salespersonName: string
  /** Quadratisch zugeschnittenes Vertrieblerfoto, oder null fuer Initialen-Platzhalter */
  salespersonImage: OptimizedImage | null
  objectImage: OptimizedImage
  photos: PdfPhoto[]
  createdAt: Date
}

function embed(doc: PDFDocument, img: OptimizedImage): Promise<PDFImage> {
  return img.format === 'png' ? doc.embedPng(img.bytes) : doc.embedJpg(img.bytes)
}

function fitInto(imgW: number, imgH: number, boxW: number, boxH: number) {
  const scale = Math.min(boxW / imgW, boxH / imgH)
  return { w: imgW * scale, h: imgH * scale }
}

/**
 * Baut die PDF: Deckblatt + exakt 1 Foto pro Seite.
 * onProgress wird nach jeder eingefuegten Fotoseite aufgerufen.
 */
export async function buildPdf(
  inputs: PdfInputs,
  onProgress?: (done: number, total: number) => void,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.setTitle('Fotodokumentation Analysetermin')
  doc.setSubject(`Analysetermin - ${inputs.salespersonName}`)
  doc.setCreator('Fotodoku Analysetermin (100 % clientseitig)')
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const regular = await doc.embedFont(StandardFonts.Helvetica)
  const [W, H] = A4

  // ---------- Deckblatt ----------
  {
    const page = doc.addPage(A4)
    const margin = 48

    // Kopfband in ISOTEC-Rot
    page.drawRectangle({ x: 0, y: H - 128, width: W, height: 128, color: RED })
    page.drawText('FOTODOKUMENTATION', {
      x: margin,
      y: H - 70,
      size: 29,
      font: bold,
      color: WHITE,
    })
    page.drawText('Analysetermin', { x: margin, y: H - 100, size: 17, font: regular, color: WHITE })

    // Objektfoto prominent, mittig
    const objImg = await embed(doc, inputs.objectImage)
    const boxTop = H - 168
    const { w, h } = fitInto(objImg.width, objImg.height, W - 2 * margin, 390)
    const ox = (W - w) / 2
    const oy = boxTop - h
    page.drawRectangle({
      x: ox - 5,
      y: oy - 5,
      width: w + 10,
      height: h + 10,
      color: LIGHT,
      borderColor: GREY,
      borderWidth: 1,
    })
    page.drawImage(objImg, { x: ox, y: oy, width: w, height: h })
    page.drawText('Objekt', { x: ox, y: oy - 18, size: 9, font: regular, color: BROWN })

    // Infoblock: Vertrieblerfoto (oder Initialen) + Angaben
    const tile = 96
    const infoTop = Math.min(oy - 46, 300)
    const tileY = infoTop - tile
    if (inputs.salespersonImage) {
      const spImg = await embed(doc, inputs.salespersonImage)
      page.drawRectangle({
        x: margin - 3,
        y: tileY - 3,
        width: tile + 6,
        height: tile + 6,
        color: WHITE,
        borderColor: RED,
        borderWidth: 2,
      })
      page.drawImage(spImg, { x: margin, y: tileY, width: tile, height: tile })
    } else {
      page.drawRectangle({
        x: margin,
        y: tileY,
        width: tile,
        height: tile,
        color: LIGHT,
        borderColor: RED,
        borderWidth: 2,
      })
      const initials = initialsOf(inputs.salespersonName) || '?'
      const size = 38
      const tw = bold.widthOfTextAtSize(initials, size)
      page.drawText(initials, {
        x: margin + (tile - tw) / 2,
        y: tileY + tile / 2 - size * 0.36,
        size,
        font: bold,
        color: RED,
      })
    }

    const tx = margin + tile + 22
    let ty = infoTop - 14
    const drawInfo = (label: string, value: string) => {
      page.drawText(label.toUpperCase(), { x: tx, y: ty, size: 8, font: bold, color: RED })
      page.drawText(value, { x: tx, y: ty - 16, size: 13, font: bold, color: BROWN })
      ty -= 40
    }
    drawInfo('Vertriebler', inputs.salespersonName)
    drawInfo('Erstellt am', formatDate(inputs.createdAt))
    drawInfo('Termin-Fotos', String(inputs.photos.length))

    // Fussband
    page.drawRectangle({ x: 0, y: 0, width: W, height: 26, color: RED })
    const claim = 'IMMER BESSER.'
    const cw = bold.widthOfTextAtSize(claim, 10)
    page.drawText(claim, { x: W - margin - cw, y: 9, size: 10, font: bold, color: WHITE })
    page.drawText('Fotodokumentation Analysetermin', {
      x: margin,
      y: 9,
      size: 9,
      font: regular,
      color: WHITE,
    })
  }

  // ---------- Fotoseiten: exakt 1 Foto pro Seite ----------
  const total = inputs.photos.length
  for (let i = 0; i < total; i++) {
    const photo = inputs.photos[i]
    const page = doc.addPage(A4)
    const margin = 40
    const footerH = 32
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
