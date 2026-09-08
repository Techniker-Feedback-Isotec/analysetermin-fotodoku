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
  return { bytes: bild.bytes, format: bild.format }
}

export async function logoBild(): Promise<DeckblattBild> {
  const antwort = await fetch(logoPngUrl)
  return { bytes: new Uint8Array(await antwort.arrayBuffer()), format: 'png' }
}
