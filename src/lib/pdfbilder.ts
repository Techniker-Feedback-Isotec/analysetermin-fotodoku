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
  /**
   * Weisse Raender innerhalb der Box abschneiden. Fotos sitzen mit Seitenverhaeltnis
   * in ihrer Flaeche und lassen links/rechts oder oben/unten Weiss stehen; die
   * Folie soll nur das Foto mit den Zeichnungen zeigen (12.09.2026 abends).
   */
  trimmen?: boolean
}

/**
 * Engstes Rechteck der nicht weissen Pixel innerhalb eines Bereichs, mit etwas
 * Luft; null, wenn dort nur Weiss liegt. Gerastert in Zweierschritten, das
 * reicht fuer die Kante und spart die Haelfte der Zeit.
 */
function nichtWeiss(ctx: CanvasRenderingContext2D, sx: number, sy: number, sw: number, sh: number) {
  const d = ctx.getImageData(sx, sy, sw, sh).data
  let x1 = sw, y1 = sh, x2 = -1, y2 = -1
  for (let y = 0; y < sh; y += 2) {
    for (let x = 0; x < sw; x += 2) {
      const i = (y * sw + x) * 4
      if (d[i] < 238 || d[i + 1] < 238 || d[i + 2] < 238) {
        if (x < x1) x1 = x
        if (x > x2) x2 = x
        if (y < y1) y1 = y
        if (y > y2) y2 = y
      }
    }
  }
  if (x2 < 0) return null
  const luft = 6
  const ax = Math.max(0, x1 - luft), ay = Math.max(0, y1 - luft)
  return { x: sx + ax, y: sy + ay, w: Math.min(sw - ax, x2 - x1 + 1 + 2 * luft), h: Math.min(sh - ay, y2 - y1 + 1 + 2 * luft) }
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
        let sx = Math.max(0, Math.round(a.box.x * massstab))
        let sy = Math.max(0, Math.round(a.box.y * massstab))
        let sw = Math.min(canvas.width - sx, Math.round(a.box.breite * massstab))
        let sh = Math.min(canvas.height - sy, Math.round(a.box.hoehe * massstab))
        if (sw <= 0 || sh <= 0) continue
        if (a.trimmen) {
          const eng = nichtWeiss(ctx, sx, sy, sw, sh)
          if (!eng) continue // nur Weiss: die Seite hat hier kein Foto
          sx = eng.x
          sy = eng.y
          sw = eng.w
          sh = eng.h
        }
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
