import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { ladeSeitenDaten, speicherVerfuegbar, speichereSeitenDaten, type SeitenName } from './lib/speicher'

/**
 * Arbeitsdaten einer Seite je Vorgang im Geraet halten (Sanierungsvorschau,
 * Video; 12.09.2026). Verhaelt sich wie useState, laedt beim Aufsetzen den
 * gespeicherten Stand des Vorgangs und schreibt Aenderungen mit kurzer
 * Verzoegerung zurueck. Die Seite wird von App.tsx mit `key={vorgang.id}`
 * neu aufgesetzt, deshalb reicht ein Ladevorgang je Einbau.
 *
 * Geschrieben wird erst, wenn geladen ist: sonst wuerde der leere Startwert
 * den gespeicherten Stand ueberschreiben.
 */
export function useSeitenSpeicher<T, S>(
  vorgangId: string,
  seite: SeitenName,
  optionen: {
    leer: T
    /** Zustand zum Speichern verschlanken (Blob-Adressen weg, Laufendes weg) */
    serialisiere: (wert: T) => S
    /** Gespeicherten Stand wieder benutzbar machen (Blob-Adressen neu) */
    deserialisiere: (satz: S) => T | Promise<T>
    verzoegerungMs?: number
  },
): { wert: T; setWert: Dispatch<SetStateAction<T>>; geladen: boolean } {
  const { leer, serialisiere, deserialisiere, verzoegerungMs = 800 } = optionen
  const [wert, setWert] = useState<T>(leer)
  const [geladen, setGeladen] = useState(!speicherVerfuegbar())
  const zeitgeber = useRef<number | null>(null)
  const serialisiereRef = useRef(serialisiere)
  serialisiereRef.current = serialisiere

  useEffect(() => {
    if (!speicherVerfuegbar()) return
    let abgebrochen = false
    void (async () => {
      try {
        const satz = await ladeSeitenDaten<S>(vorgangId, seite)
        if (abgebrochen) return
        if (satz) setWert(await deserialisiere(satz))
      } catch (fehler) {
        console.warn(`Gespeicherte Daten der Seite ${seite} nicht lesbar`, fehler)
      } finally {
        if (!abgebrochen) setGeladen(true)
      }
    })()
    return () => {
      abgebrochen = true
    }
    // deserialisiere ist eine reine Funktion des Moduls, keine Abhaengigkeit
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vorgangId, seite])

  const schreibe = useCallback(
    (aktuell: T) => {
      void speichereSeitenDaten(vorgangId, seite, serialisiereRef.current(aktuell)).catch((fehler) =>
        console.warn(`Speichern der Seite ${seite} fehlgeschlagen`, fehler),
      )
    },
    [vorgangId, seite],
  )

  useEffect(() => {
    if (!geladen || !speicherVerfuegbar()) return
    if (zeitgeber.current !== null) window.clearTimeout(zeitgeber.current)
    zeitgeber.current = window.setTimeout(() => {
      zeitgeber.current = null
      schreibe(wert)
    }, verzoegerungMs)
    return () => {
      if (zeitgeber.current !== null) {
        window.clearTimeout(zeitgeber.current)
        zeitgeber.current = null
      }
    }
  }, [wert, geladen, schreibe, verzoegerungMs])

  // Beim Verlassen der Seite noch schreiben, was aussteht
  const wertRef = useRef(wert)
  wertRef.current = wert
  useEffect(() => {
    const vorSchliessen = () => {
      if (zeitgeber.current !== null) schreibe(wertRef.current)
    }
    window.addEventListener('pagehide', vorSchliessen)
    return () => {
      window.removeEventListener('pagehide', vorSchliessen)
      // Wechsel des Vorgangs (Neuaufbau per key): Ausstehendes sofort schreiben
      if (zeitgeber.current !== null) {
        window.clearTimeout(zeitgeber.current)
        zeitgeber.current = null
        schreibe(wertRef.current)
      }
    }
  }, [schreibe])

  return { wert, setWert, geladen }
}
