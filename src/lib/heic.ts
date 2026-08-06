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
 * heic2any (libheif/WASM) wird lazy geladen, damit der Chunk nur bei Bedarf
 * heruntergeladen wird. libheif wendet die HEIF-Rotations-/Spiegel-Transformationen
 * (irot/imir) beim Dekodieren an - das Ergebnis ist bereits korrekt orientiert.
 */
export async function heicToJpegBlob(file: File): Promise<Blob> {
  const heic2any = (await import('heic2any')).default
  const result = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.95 })
  return Array.isArray(result) ? result[0] : result
}
