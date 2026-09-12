import * as pdfjs from 'pdfjs-dist'
import { dekodiereAbschnitte, type Abschnitt } from './abschnitte'

/**
 * Seiten einer PDF als Bilder, fuer die Praesentation (12.09.2026): Die
 * gezeichnete Prinzipskizze wird Seite fuer Seite gerendert. Statt des ganzen
 * A4-Blatts liefert die Funktion auf Wunsch Ausschnitte (Yann: "die einzelnen
 * Seitenelemente auf dem gesamten Bildschirm aufgeteilt, damit sie groesser
 * dargestellt werden"): etwa die Zeichenflaeche und die Legende getrennt.
 * pdf.js ist ueber pdftext.ts an Bord, der Worker wird dort gesetzt.
 */

/** Rechteck in PDF-Punkten, gemessen von der linken oberen Ecke der Seite */
export interface Box {
  x: number
  y: number
  breite: number
  hoehe: number
}

export interface Ausschnitt {
  name: string
  box: Box
}

export interface SeitenTeil {
  name: string
  url: string
  breite: number
  hoehe: number
}

export interface SeitenBild {
  /** Seite in der PDF, 1-basiert */
  seite: number
  /** Abschnitt aus dem Keywords-Vermerk, dem die Seite angehoert, oder null */
  abschnitt: string | null
  teile: SeitenTeil[]
}

export interface PdfBilder {
  bilder: SeitenBild[]
  abschnitte: Abschnitt[]
}

function alsBlobUrl(canvas: HTMLCanvasElement): Promise<string | null> {
  return new Promise((r) => canvas.toBlob((b) => r(b ? URL.createObjectURL(b) : null), 'image/jpeg', 0.9))
}

/**
 * Seiten `von` bis `bis` (1-basiert, einschliesslich) rendern. `breite` ist
 * die Breite des ganzen Blatts in Pixeln; Ausschnitte werden daraus
 * geschnitten, deshalb lieber gross rendern (2400). `schnitt` liefert je Seite
 * die gewuenschten Ausschnitte; ohne schnitt kommt das ganze Blatt als ein
 * Teil "ganz". Die Blob-Adressen gibt der Aufrufer wieder frei.
 */
export async function rendereSeiten(
  bytes: Uint8Array,
  von: number,
  bis: number | null,
  breite = 2400,
  schnitt?: (seite: number, abschnitt: string | null) => Ausschnitt[],
): Promise<PdfBilder> {
  const { stelleWorkerSicher } = await import('./pdftext')
  await stelleWorkerSicher()
  const aufgabe = pdfjs.getDocument({ data: bytes.slice() })
  const doc = await aufgabe.promise
  try {
    let abschnitte: Abschnitt[] = []
    try {
      const meta = await doc.getMetadata()
      abschnitte = dekodiereAbschnitte((meta.info as { Keywords?: string }).Keywords) ?? []
    } catch {
      abschnitte = []
    }
    const abschnittVon = (nr: number) => [...abschnitte].reverse().find((a) => a.seite <= nr)?.titel ?? null

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

      const abschnitt = abschnittVon(nr)
      const ausschnitte = schnitt?.(nr, abschnitt) ?? [
        { name: 'ganz', box: { x: 0, y: 0, breite: basis.width, hoehe: basis.height } },
      ]
      const teile: SeitenTeil[] = []
      for (const a of ausschnitte) {
        const sx = Math.max(0, Math.round(a.box.x * massstab))
        const sy = Math.max(0, Math.round(a.box.y * massstab))
        const sw = Math.min(canvas.width - sx, Math.round(a.box.breite * massstab))
        const sh = Math.min(canvas.height - sy, Math.round(a.box.hoehe * massstab))
        if (sw <= 0 || sh <= 0) continue
        const teil = document.createElement('canvas')
        teil.width = sw
        teil.height = sh
        teil.getContext('2d')?.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh)
        const url = await alsBlobUrl(teil)
        if (url) teile.push({ name: a.name, url, breite: sw, hoehe: sh })
      }
      bilder.push({ seite: nr, abschnitt, teile })
    }
    return { bilder, abschnitte }
  } finally {
    await aufgabe.destroy()
  }
}
