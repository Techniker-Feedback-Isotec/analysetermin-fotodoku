import * as pdfjs from 'pdfjs-dist'
import { dekodiereAbschnitte, type Abschnitt } from './abschnitte'

/**
 * Seiten einer PDF als Bilder, fuer die Praesentation (12.09.2026): Die
 * gezeichnete Prinzipskizze wird Seite fuer Seite gerendert und als Folie
 * gezeigt. pdf.js ist ueber pdftext.ts schon an Bord; der Worker wird dort
 * gesetzt, deshalb wird die Funktion von dort mitbenutzt.
 */

export interface SeitenBild {
  /** Seite in der PDF, 1-basiert */
  seite: number
  url: string
  breite: number
  hoehe: number
}

export interface PdfBilder {
  bilder: SeitenBild[]
  /** Abschnitte aus dem Keywords-Vermerk der eigenen PDFs, sonst leer */
  abschnitte: Abschnitt[]
}

/**
 * Seiten `von` bis `bis` (1-basiert, einschliesslich) rendern. `breite` ist
 * die Zielbreite in Pixeln; fuer eine Folie reichen 1600. Die Blob-Adressen
 * muss der Aufrufer wieder freigeben.
 */
export async function rendereSeiten(
  bytes: Uint8Array,
  von: number,
  bis: number | null,
  breite = 1600,
): Promise<PdfBilder> {
  const { stelleWorkerSicher } = await import('./pdftext')
  await stelleWorkerSicher()
  const aufgabe = pdfjs.getDocument({ data: bytes.slice() })
  const doc = await aufgabe.promise
  try {
    const letzte = Math.min(bis ?? doc.numPages, doc.numPages)
    const bilder: SeitenBild[] = []
    for (let nr = Math.max(1, von); nr <= letzte; nr++) {
      const seite = await doc.getPage(nr)
      const basis = seite.getViewport({ scale: 1 })
      const massstab = breite / basis.width
      const viewport = seite.getViewport({ scale: massstab })
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(viewport.width)
      canvas.height = Math.round(viewport.height)
      const ctx = canvas.getContext('2d')
      if (!ctx) continue
      await seite.render({ canvasContext: ctx, viewport, canvas }).promise
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.88))
      if (!blob) continue
      bilder.push({ seite: nr, url: URL.createObjectURL(blob), breite: canvas.width, hoehe: canvas.height })
    }
    let abschnitte: Abschnitt[] = []
    try {
      const meta = await doc.getMetadata()
      const info = meta.info as { Keywords?: string }
      abschnitte = dekodiereAbschnitte(info.Keywords) ?? []
    } catch {
      abschnitte = []
    }
    return { bilder, abschnitte }
  } finally {
    await aufgabe.destroy()
  }
}
