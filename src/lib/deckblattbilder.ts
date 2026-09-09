import logoPngUrl from '../assets/isotec-logo.png'
import { visitenkarteVon } from '../data/visitenkarten'
import { optimizeWithRetry } from './bilder'
import type { DeckblattBild } from './deckblatt'
import type { Kundendaten } from '../kunde'

/**
 * Bilder fuer das gemeinsame Deckblatt: Objektfoto, Visitenkarte und Logo.
 * Alle drei Dokumentarten und die Angebotsmappe holen sie hier, damit die
 * Aufbereitung an einer Stelle steht.
 */

/** Visitenkarte des Mitarbeiters, oder null - dann steht unten das Logo. */
export async function visitenkarteBild(name: string): Promise<DeckblattBild | null> {
  const url = visitenkarteVon(name)
  if (!url) return null
  try {
    const antwort = await fetch(url)
    if (!antwort.ok) return null
    return { bytes: new Uint8Array(await antwort.arrayBuffer()), format: 'jpeg' }
  } catch {
    return null
  }
}

/** Objektfoto von der Seite Kunde, auf eine handliche Kantenlaenge gebracht. */
export async function objektBild(kunde: Kundendaten, maxEdge = 1800): Promise<DeckblattBild | null> {
  const foto = kunde.objektfoto
  if (!foto) return null
  const bild = await optimizeWithRetry(foto.workingBlob, foto.orientation, {
    maxEdge,
    quality: 0.8,
    sourceType: foto.sourceType,
  })
  return { bytes: bild.bytes, format: bild.format, kanten: await kantenFarben(bild.bytes, bild.format) }
}

/**
 * Mittlere Farbe der linken und rechten Bildkante.
 *
 * Das Deckblatt braucht sie nur fuer Hochformat-Fotos: Die koennen die Flaeche
 * nicht fuellen, ohne dass zu viel wegfaellt, und die Flaeche daneben wird
 * dann in diesen Farben fortgesetzt statt hell zu bleiben (Yann, 09.09.2026).
 * Gemessen wird auf einem stark verkleinerten Abbild, das kostet nichts.
 */
async function kantenFarben(
  bytes: Uint8Array,
  format: 'jpeg' | 'png',
): Promise<DeckblattBild['kanten']> {
  try {
    const blob = new Blob([bytes as BlobPart], { type: format === 'png' ? 'image/png' : 'image/jpeg' })
    const bitmap = await createImageBitmap(blob)
    const breite = 32
    const hoehe = Math.max(1, Math.round((bitmap.height / bitmap.width) * breite))
    const flaeche = document.createElement('canvas')
    flaeche.width = breite
    flaeche.height = hoehe
    const stift = flaeche.getContext('2d', { willReadFrequently: true })
    if (!stift) return undefined
    stift.drawImage(bitmap, 0, 0, breite, hoehe)
    bitmap.close()
    const daten = stift.getImageData(0, 0, breite, hoehe).data
    // Die aeussersten zwei Spalten mitteln, eine allein waere zu zufaellig
    const mittel = (spalten: number[]): [number, number, number] => {
      let r = 0
      let g = 0
      let b = 0
      let n = 0
      for (let y = 0; y < hoehe; y++) {
        for (const x of spalten) {
          const i = (y * breite + x) * 4
          r += daten[i]
          g += daten[i + 1]
          b += daten[i + 2]
          n++
        }
      }
      return [r / n / 255, g / n / 255, b / n / 255]
    }
    return { links: mittel([0, 1]), rechts: mittel([breite - 2, breite - 1]) }
  } catch {
    // Ohne Kantenfarben bleibt es beim hellen Grund - kein Grund abzubrechen.
    return undefined
  }
}

export async function logoBild(): Promise<DeckblattBild> {
  const antwort = await fetch(logoPngUrl)
  return { bytes: new Uint8Array(await antwort.arrayBuffer()), format: 'png' }
}
