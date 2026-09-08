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

/**
 * iPhone oder iPad. Dort landet ein Download in "Dateien" und ist aus einer
 * installierten App heraus oft gar nicht moeglich; der richtige Weg ist das
 * Teilen-Blatt. iPadOS meldet sich als Mac, verraet sich aber durch Touch.
 */
export function istIOS(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  if (/iPad|iPhone|iPod/.test(ua)) return true
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
}

/** Eine beliebige Datei ueber das Teilen-Blatt anbieten; auf 'nicht moeglich' faellt der Aufrufer auf Download zurueck. */
export async function teileDatei(blob: Blob, dateiname: string, titel: string): Promise<TeilenErgebnis> {
  const file = new File([blob], dateiname, { type: blob.type })
  return teileDateien([file], titel)
}

function nachherDateiname(blob: Blob, basisname: string): string {
  const endung = blob.type.includes('png') ? 'png' : 'jpg'
  const sauber = basisname.replace(/[^\wäöüÄÖÜß. -]+/g, '').trim() || 'Foto'
  return `ISOTEC_Nachher_${sauber}.${endung}`
}

/** Sanierungsvorschau: Nachher-Bild direkt herunterladen (am Rechner). */
export function ladeNachherHerunter(blob: Blob, basisname: string): void {
  speichereDatei(blob, nachherDateiname(blob, basisname))
}

/**
 * Sanierungsvorschau: Nachher-Bild ueber das Teilen-Blatt ablegen (Fotomediathek).
 * Liefert true, wenn die Datei abgelegt wurde.
 */
export async function teileNachherBild(blob: Blob, basisname: string): Promise<boolean> {
  const dateiname = nachherDateiname(blob, basisname)
  const file = new File([blob], dateiname, { type: blob.type })
  const ergebnis = await teileDateien([file], 'Nachher-Bild')
  if (ergebnis === 'geteilt') return true
  // Abbruch durch den Nutzer: nichts tun. Kann das Geraet gar nicht teilen,
  // bleibt der Download als Rueckfallweg.
  if (ergebnis === 'nicht moeglich') {
    speichereDatei(blob, dateiname)
    return true
  }
  return false
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
