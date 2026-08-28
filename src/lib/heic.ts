export function isHeic(file: File): boolean {
  const type = file.type.toLowerCase()
  if (
    type === 'image/heic' ||
    type === 'image/heif' ||
    type === 'image/heic-sequence' ||
    type === 'image/heif-sequence'
  ) {
    return true
  }
  return /\.(heic|heif)$/i.test(file.name)
}

/**
 * Konvertiert HEIC/HEIF im Browser nach JPEG.
 *
 * Gerechnet wird mit libheif als WebAssembly, geladen erst bei Bedarf: Auf dem
 * iPhone liest Safari HEIC selbst, dort wird der Umweg nie gebraucht und der
 * Download nie ausgeloest.
 *
 * Zwei Anlaeufe, weil neuere iPhones (ab iOS 18) HDR-Aufnahmen mit den Marken
 * "heix" (10 Bit) und "tmap" (Tone-Mapping) schreiben. Das aeltere heic2any
 * scheitert daran mit "ERR_LIBHEIF format not supported"; heic-to bringt ein
 * neueres libheif mit und kommt damit zurecht. Bleibt heic2any als Rueckfall
 * fuer alles, was der neue Weg wider Erwarten nicht mag.
 *
 * libheif wendet die HEIF-Transformationen (irot/imir) beim Dekodieren an,
 * das Ergebnis ist also bereits richtig gedreht.
 */
export async function heicToJpegBlob(file: File): Promise<Blob> {
  // Qualitaet 0.9 reicht: das Ergebnis wird direkt danach auf Arbeitsgroesse
  // verkleinert und spaeter ohnehin fuer die PDF neu komprimiert.
  try {
    const { heicTo } = await import('heic-to')
    return await heicTo({ blob: file, type: 'image/jpeg', quality: 0.9 })
  } catch (ersterFehler) {
    try {
      const heic2any = (await import('heic2any')).default
      const result = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.9 })
      return Array.isArray(result) ? result[0] : result
    } catch {
      // Die Meldung des ersten, moderneren Anlaufs ist die aussagekraeftigere.
      throw ersterFehler
    }
  }
}
