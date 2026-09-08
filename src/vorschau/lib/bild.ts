/**
 * Fotos fuer die KI-Bearbeitung vorbereiten.
 *
 * Alles laeuft im Browser: Die Datei wird gelesen (HEIC vom iPhone bei Bedarf
 * umgewandelt), auf eine handliche Kantenlaenge verkleinert und als JPEG
 * ausgegeben. Das haelt die Anfrage an die KI klein und schnell.
 */

const MAX_KANTE = 1568
const JPEG_QUALITAET = 0.87

function istHeic(file: File): boolean {
  const name = file.name.toLowerCase()
  return (
    file.type === 'image/heic' ||
    file.type === 'image/heif' ||
    name.endsWith('.heic') ||
    name.endsWith('.heif')
  )
}

/** Datei zu einem Bitmap lesen; HEIC wird bei Bedarf umgewandelt (Safari liest es selbst). */
async function leseBitmap(file: File): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file)
  } catch (fehler) {
    if (!istHeic(file)) throw fehler
    // HEIC am Rechner: erst umwandeln (auf dem iPhone liest Safari HEIC direkt,
    // dieser Zweig wird dort nie erreicht).
    const { heicTo } = await import('heic-to')
    const jpeg = await heicTo({ blob: file, type: 'image/jpeg', quality: 0.9 })
    return await createImageBitmap(jpeg as Blob)
  }
}

export type VorbereitetesBild = {
  /** Verkleinertes JPEG, geht an die KI und dient als Vorher-Bild. */
  blob: Blob
  breite: number
  hoehe: number
}

export async function bereiteBildVor(file: File): Promise<VorbereitetesBild> {
  const bitmap = await leseBitmap(file)
  const faktor = Math.min(1, MAX_KANTE / Math.max(bitmap.width, bitmap.height))
  const breite = Math.round(bitmap.width * faktor)
  const hoehe = Math.round(bitmap.height * faktor)

  const canvas = document.createElement('canvas')
  canvas.width = breite
  canvas.height = hoehe
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas nicht verfügbar')
  ctx.drawImage(bitmap, 0, 0, breite, hoehe)
  bitmap.close()

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Bild konnte nicht umgewandelt werden'))),
      'image/jpeg',
      JPEG_QUALITAET,
    )
  })
  return { blob, breite, hoehe }
}

export async function blobZuBase64(blob: Blob): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
  return dataUrl.slice(dataUrl.indexOf(',') + 1)
}
