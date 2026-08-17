/**
 * Teilen über das Betriebssystem (Web Share API).
 *
 * Auf dem iPhone ist das der einzige Weg, eine erzeugte Datei dorthin zu
 * bringen, wo sie hingehört: Ein Download landet in "Dateien / Downloads",
 * während das Teilen-Blatt "Video sichern" (also die Fotomediathek) und alle
 * installierten Apps wie MeisterTask anbietet.
 *
 * Wichtig: navigator.share muss unmittelbar aus einem Klick heraus aufgerufen
 * werden. Nach einer langen Verarbeitung ist die Berechtigung verbraucht,
 * deshalb wird erst verarbeitet und dann ein eigener Teilen-Knopf angeboten.
 */

/** Grundsätzliche Unterstützung, unabhängig von der konkreten Datei. */
export function teilenMoeglich(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.share === 'function'
}

/**
 * Prüft mit einer Platzhalterdatei, ob dieser Dateityp geteilt werden darf.
 *
 * Kann der Browser teilen, kennt aber canShare nicht, wird der Knopf trotzdem
 * angeboten: Ein Teilen-Versuch, der scheitert, faellt auf das Herunterladen
 * zurueck. Ein fehlender Knopf waere schlimmer, denn dann fuehrt auf dem Handy
 * kein Weg in die Fotomediathek.
 */
export function typTeilbar(mimeType: string, dateiname: string): boolean {
  if (!teilenMoeglich()) return false
  if (typeof navigator.canShare !== 'function') return true
  try {
    const probe = new File([new Blob(['0'], { type: mimeType })], dateiname, { type: mimeType })
    return navigator.canShare({ files: [probe] })
  } catch {
    return true
  }
}

export type TeilenErgebnis = 'geteilt' | 'abgebrochen' | 'nicht moeglich'

export async function teileDateien(files: File[], titel: string): Promise<TeilenErgebnis> {
  if (!teilenMoeglich()) return 'nicht moeglich'
  try {
    if (typeof navigator.canShare === 'function' && !navigator.canShare({ files })) return 'nicht moeglich'
    await navigator.share({ files, title: titel })
    return 'geteilt'
  } catch (error) {
    // Abbruch durch den Nutzer ist kein Fehler.
    if (error instanceof DOMException && (error.name === 'AbortError' || error.name === 'CanceledError')) {
      return 'abgebrochen'
    }
    return 'nicht moeglich'
  }
}

/** Herunterladen als Rückfallweg, wenn Teilen nicht geht (Desktop). */
export function speichereDatei(blob: Blob, dateiname: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = dateiname
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 20_000)
}
