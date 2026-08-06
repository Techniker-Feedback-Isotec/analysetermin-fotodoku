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
