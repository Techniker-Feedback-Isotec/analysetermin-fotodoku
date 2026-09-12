/**
 * Gespeicherter Stand der Sanierungsvorschau je Vorgang (Tabelle seiten),
 * hier ohne Abhaengigkeit von der Seite selbst, damit die Praesentation die
 * Vorher/Nachher-Paare lesen kann, ohne den grossen Vorschau-Code zu laden.
 */

export type Optionen = { boden: boolean }

/** Schluessel, unter dem das Ergebnis einer Kombination abgelegt wird. */
export function kombination(o: Optionen, entfernt: number[]): string {
  const basis = o.boden ? 'boden' : 'standard'
  return entfernt.length ? `${basis}|-${[...entfernt].sort((a, b) => a - b).join(',')}` : basis
}

/** Was von einem Foto der Vorschau im Geraet liegt (Blobs, keine Blob-Adressen) */
export interface VorschauSatz {
  id: string
  name: string
  vorherBlob: Blob
  optionen: Optionen
  entfernt: number[]
  ergebnisse: Record<string, { blob: Blob }>
}

/** Das gerade gezeigte Nachher-Bild eines gespeicherten Fotos, oder null */
export function nachherVon(satz: VorschauSatz): Blob | null {
  return satz.ergebnisse[kombination(satz.optionen, satz.entfernt)]?.blob ?? null
}
