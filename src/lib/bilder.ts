import { readExif, takenAtFromFileName } from './exif'
import { heicToJpegBlob, isHeic } from './heic'
import {
  downscaleToJpegBlob,
  loadOriented,
  makeThumbnailUrl,
  optimizeImage,
  type OptimizedImage,
  type OptimizeOptions,
} from './image'

/**
 * Einlesen und Aufbereiten von Fotos - gemeinsam fuer das Objektfoto auf der
 * Seite Kunde und die Fotostrecken der Fotodokumentation und Prinzipskizze.
 */

export interface PreparedImage {
  fileName: string
  fileSize: number
  /** Original, oder bei HEIC das konvertierte JPEG */
  workingBlob: Blob
  /** MIME-Typ der Originaldatei (fuer PNG-Transparenz-Erkennung) */
  sourceType: string
  /** EXIF-Orientation der workingBlob (nach HEIC-Konvertierung immer 1) */
  orientation: number
  takenAt: number
  dateSource: 'exif' | 'name' | 'file'
  thumbUrl: string
  convertedFromHeic: boolean
}

export interface TerminPhoto extends PreparedImage {
  id: string
  hash: string
  /** Vom Nutzer gewaehlte Drehung in Grad: 0, 90, 180 oder 270 */
  rotation: number
}

export interface Progress {
  label: string
  done: number
  total: number
}

// Feste Komprimierung (keine Auswahl im UI): Standard-Aufloesung, kleinste Qualitaetsstufe
export const MAX_EDGE = 2200
export const JPEG_QUALITY = 0.75

// "Extra Komprimierung": stufenweise staerker komprimieren, bis die PDF unter 10 MB liegt
export const EXTRA_TARGET_BYTES = 10 * 1024 * 1024
export const EXTRA_LADDER: Array<{ maxEdge: number; quality: number }> = [
  { maxEdge: 1600, quality: 0.6 },
  { maxEdge: 1200, quality: 0.5 },
  { maxEdge: 960, quality: 0.4 },
  { maxEdge: 800, quality: 0.35 },
]

export const ACCEPT = '.jpg,.jpeg,.png,.heic,.heif,image/jpeg,image/png,image/heic,image/heif'

export function isSupported(file: File): boolean {
  if (/\.(jpe?g|png|heic|heif)$/i.test(file.name)) return true
  return ['image/jpeg', 'image/png', 'image/heic', 'image/heif'].includes(file.type.toLowerCase())
}

/** Datei einlesen: EXIF (Datum, Orientation) -> ggf. HEIC-Konvertierung -> Thumbnail. */
export async function prepareImage(file: File): Promise<PreparedImage> {
  const exif = await readExif(file)
  let workingBlob: Blob = file
  let orientation = exif.orientation
  let convertedFromHeic = false
  let thumbUrl: string | null = null

  if (isHeic(file)) {
    // 1) Nativ versuchen: Safari (iPhone/Mac) dekodiert HEIC direkt - dann bleibt
    //    die Original-Datei die Arbeitsgrundlage und nichts liegt extra im Speicher.
    try {
      thumbUrl = await makeThumbnailUrl(file, orientation, 512)
    } catch {
      // 2) Konvertieren (Chrome/Edge/Firefox) - mit einem zweiten Anlauf - und das
      //    Ergebnis sofort auf Arbeitsgroesse verkleinern, statt das JPEG in voller
      //    Aufloesung zu behalten (Speicher: ~0,5 MB statt 5-8 MB pro Foto).
      let jpeg: Blob
      try {
        jpeg = await heicToJpegBlob(file)
      } catch {
        await new Promise((r) => window.setTimeout(r, 300))
        try {
          jpeg = await heicToJpegBlob(file)
        } catch (err) {
          // heic2any wirft teils Plain-Objects mit {code, message} statt Error
          const reason =
            err instanceof Error
              ? err.message
              : err && typeof err === 'object' && 'message' in err
                ? String((err as { message: unknown }).message)
                : String(err)
          throw new Error(`HEIC konnte nicht konvertiert werden: ${file.name} (${reason})`)
        }
      }
      workingBlob = await downscaleToJpegBlob(jpeg, 1, MAX_EDGE, 0.9)
      convertedFromHeic = true
      orientation = 1 // libheif liefert bereits korrekt orientierte Pixel
    }
  }

  // Ohne EXIF-Datum: Aufnahmezeit aus dem Dateinamen versuchen.
  const nameAt = exif.takenAt == null ? takenAtFromFileName(file.name) : null

  if (thumbUrl === null) {
    thumbUrl = await makeThumbnailUrl(workingBlob, orientation, 512)
  }
  return {
    fileName: file.name,
    fileSize: file.size,
    workingBlob,
    sourceType: file.type || (convertedFromHeic ? 'image/heic' : ''),
    orientation,
    takenAt: exif.takenAt ?? nameAt ?? file.lastModified,
    dateSource: exif.takenAt != null ? 'exif' : nameAt != null ? 'name' : 'file',
    thumbUrl,
    convertedFromHeic,
  }
}

/** Chronologische Grundsortierung: Aufnahmedatum, Tie-Breaker Dateiname */
export function chronoCompare(
  a: { takenAt: number; fileName: string },
  b: { takenAt: number; fileName: string },
): number {
  return a.takenAt - b.takenAt || a.fileName.localeCompare(b.fileName, 'de', { numeric: true })
}

/**
 * Bild orientieren + komprimieren, mit mehreren Anlaeufen. Bei vielen grossen
 * Fotos kann das Dekodieren einmalig scheitern (Speicherdruck); eine kurze
 * Pause gibt dem Browser Gelegenheit aufzuraeumen.
 */
export async function optimizeWithRetry(
  blob: Blob,
  orientation: number,
  opts: OptimizeOptions,
  versuche = 3,
): Promise<OptimizedImage> {
  let letzterFehler: unknown
  for (let v = 0; v < versuche; v++) {
    try {
      const oriented = await loadOriented(blob, orientation)
      try {
        return await optimizeImage(oriented, opts)
      } finally {
        oriented.cleanup()
      }
    } catch (err) {
      letzterFehler = err
      await new Promise((r) => window.setTimeout(r, 250 * (v + 1)))
    }
  }
  throw letzterFehler instanceof Error ? letzterFehler : new Error(String(letzterFehler))
}
