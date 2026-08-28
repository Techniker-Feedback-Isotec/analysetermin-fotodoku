import exifr from 'exifr'

export interface ExifInfo {
  /** Aufnahmezeitpunkt (DateTimeOriginal, sonst CreateDate) in ms, oder null */
  takenAt: number | null
  /** EXIF-Orientation 1-8; 1 = normal */
  orientation: number
}

/**
 * Liest EXIF-Daten aus JPEG/PNG/HEIC. exifr unterstuetzt HEIC direkt,
 * daher wird immer die Originaldatei (vor einer HEIC-Konvertierung) gelesen.
 * Fehler fuehren nie zum Abbruch - dann gilt: kein Datum, Orientation 1.
 */
export async function readExif(blob: Blob): Promise<ExifInfo> {
  try {
    const data = await exifr.parse(blob, {
      pick: ['DateTimeOriginal', 'CreateDate', 'Orientation'],
      translateValues: false,
    })
    const rawDate: unknown = data?.DateTimeOriginal ?? data?.CreateDate ?? null
    const takenAt =
      rawDate instanceof Date && !Number.isNaN(rawDate.getTime()) ? rawDate.getTime() : null
    const orientation =
      typeof data?.Orientation === 'number' && data.Orientation >= 1 && data.Orientation <= 8
        ? data.Orientation
        : 1
    return { takenAt, orientation }
  } catch {
    return { takenAt: null, orientation: 1 }
  }
}

/**
 * Aufnahmezeitpunkt aus dem Dateinamen lesen, wenn die Datei keine EXIF-Daten
 * mitbringt.
 *
 * Neuere iPhones schreiben HDR-Aufnahmen in einer HEIC-Spielart, die exifr
 * nicht einmal als Bilddatei erkennt ("Unknown file format"). Ohne Datum
 * sortiert die Fotodokumentation nach dem Dateidatum, und das ist nach einem
 * Umweg ueber Teams oder OneDrive der Kopierzeitpunkt statt der Aufnahme.
 *
 * Erkannt werden die ueblichen Muster:
 *   20260827_085508579_iOS.heic   (OneDrive, Teams)
 *   IMG_20260827_085508.jpg       (Android)
 *   PXL_20260827_085508123.jpg    (Pixel)
 *   2026-08-27 08.55.08.jpg       (Screenshots, Exporte)
 */
export function takenAtFromFileName(name: string): number | null {
  const treffer =
    /(\d{4})(\d{2})(\d{2})[_-](\d{2})(\d{2})(\d{2})/.exec(name) ??
    /(\d{4})-(\d{2})-(\d{2})[ _T](\d{2})[.:-](\d{2})[.:-](\d{2})/.exec(name)
  if (!treffer) return null

  const [, jahr, monat, tag, stunde, minute, sekunde] = treffer.map(Number) as unknown as number[]
  if (monat < 1 || monat > 12 || tag < 1 || tag > 31 || stunde > 23 || minute > 59 || sekunde > 59) {
    return null
  }
  const datum = new Date(jahr, monat - 1, tag, stunde, minute, sekunde)
  const zeit = datum.getTime()
  if (Number.isNaN(zeit)) return null

  // Nur plausible Zeitpunkte: nicht vor 2000 und nicht in der Zukunft.
  const jetzt = Date.now()
  if (zeit < Date.UTC(2000, 0, 1) || zeit > jetzt + 24 * 60 * 60 * 1000) return null
  return zeit
}
