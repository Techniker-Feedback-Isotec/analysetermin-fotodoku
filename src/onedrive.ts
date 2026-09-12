import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ApiFehler,
  OHNE_SERVER,
  ladeAufnahmen,
  ladeOneDriveDatei,
  ladeStandort,
  onedriveAuffrischen,
  type Ich,
} from './lib/api'
import { manuellesTermindatum, objektadresseEcht, type Kundendaten, type ToastFn } from './kunde'
import type { Fotostapel } from './fotostapel'
import { useSeitenSpeicher } from './seitenspeicher'

/**
 * Automatischer Eingang aus OneDrive (Yann, 12.09.2026 abends).
 *
 * Die Fotos und Videos vom Termin entstehen auf dem iPhone und liegen ueber
 * die OneDrive-App kurz darauf im Konto des Mitarbeiters ("Eigene Aufnahmen",
 * Ordner Jahr/Monat). Solange ein Projekt offen ist, fragt der Hook jede
 * Minute nach Aufnahmen, die im Zeitfenster des Termins innerhalb von
 * ONEDRIVE_RADIUS_M um die Objektadresse entstanden sind, und legt sie in den
 * Bilderstapel (Fotos) bzw. an die Videoseite. Was einmal uebernommen wurde,
 * merkt sich der Vorgang (Tabelle seiten, Schluessel onedrive), damit nichts
 * doppelt kommt, auch nicht nach dem Loeschen eines Bildes aus der Liste.
 *
 * Voraussetzungen: der Server hat das Graph-Token des Nutzers (Easy Auth mit
 * Token-Speicher, nur auf Azure; lokal ueber GRAPH_TOKEN), und die
 * Objektadresse liess sich geokodieren (server/geocode.mjs). Ohne beides
 * bleibt der Hook still.
 */

/** Umkreis um die Objektadresse, in dem ein Foto zum Projekt zaehlt */
export const ONEDRIVE_RADIUS_M = 150
/** Abstand zwischen zwei Abfragen */
const TAKT_MS = 60_000
/** Hoechstens so viele Dateien je Durchlauf laden; der Rest kommt beim naechsten */
const JE_DURCHLAUF = 12
const TAG_MS = 24 * 60 * 60 * 1000

export interface OneDriveStand {
  /**
   * aus: kein Zugang auf diesem Server (Testseite, lokal ohne Token)
   * adresse: Objektadresse fehlt
   * standort: Adresse nicht gefunden
   * bereit: wartet auf die naechste Abfrage
   * laeuft: fragt gerade ab oder laedt
   * fehler: letzte Abfrage scheiterte, Text sagt warum
   */
  status: 'aus' | 'adresse' | 'standort' | 'bereit' | 'laeuft' | 'fehler'
  text: string
  zuletzt: number | null
  pruefen: () => void
}

const uhr = (t: number) => new Date(t).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })

export function useOneDrive(p: {
  ich: Ich | null
  kunde: Kundendaten
  aendereKunde: (teil: Partial<Kundendaten>) => void
  vorgangId: string
  stapel: Fotostapel
  onVideos: (dateien: File[]) => void
  onToast: ToastFn
}): OneDriveStand {
  const zugang = Boolean(p.ich?.onedrive) && !OHNE_SERVER
  const adresse = objektadresseEcht(p.kunde)
  const standort = p.kunde.standort ?? null
  const standortPasst = standort !== null && standort.adresse === adresse

  const { wert: importiert, setWert: setImportiert, geladen } = useSeitenSpeicher<string[], string[]>(
    p.vorgangId,
    'onedrive',
    { leer: [], serialisiere: (x) => x, deserialisiere: (x) => x },
  )

  const [stand, setStand] = useState<{ status: OneDriveStand['status']; text: string; zuletzt: number | null }>({
    status: 'aus',
    text: '',
    zuletzt: null,
  })

  // Aktuelle Werte fuer den Zeitgeber, ohne ihn bei jeder Aenderung neu zu setzen
  const aktuell = useRef({ kunde: p.kunde, importiert, stapel: p.stapel, onVideos: p.onVideos, onToast: p.onToast })
  aktuell.current = { kunde: p.kunde, importiert, stapel: p.stapel, onVideos: p.onVideos, onToast: p.onToast }
  const laeuft = useRef(false)
  /** Adressen, die in dieser Sitzung schon ohne Treffer angefragt wurden */
  const vergeblich = useRef(new Set<string>())

  // 1. Objektadresse zu Koordinaten, einmal je Adresse; am Vorgang gespeichert
  useEffect(() => {
    if (!zugang) return
    if (!adresse) {
      setStand({ status: 'adresse', text: 'Objektadresse fehlt', zuletzt: null })
      return
    }
    if (standortPasst) return
    if (vergeblich.current.has(adresse)) {
      setStand({ status: 'standort', text: 'Adresse nicht gefunden', zuletzt: null })
      return
    }
    let abgebrochen = false
    setStand({ status: 'laeuft', text: 'Adresse wird gesucht …', zuletzt: null })
    ladeStandort(adresse)
      .then((antwort) => {
        if (abgebrochen) return
        if (antwort.standort) {
          p.aendereKunde({ standort: { ...antwort.standort, adresse } })
        } else {
          vergeblich.current.add(adresse)
          setStand({ status: 'standort', text: 'Adresse nicht gefunden', zuletzt: null })
        }
      })
      .catch((fehler: unknown) => {
        if (abgebrochen) return
        setStand({ status: 'fehler', text: fehler instanceof Error ? fehler.message : String(fehler), zuletzt: null })
      })
    return () => {
      abgebrochen = true
    }
    // aendereKunde ist stabil genug (useCallback in App); Adresse und Zugang zaehlen
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zugang, adresse, standortPasst])

  // 2. Abfragen: sofort und dann im Takt, solange Zugang und Standort da sind
  const pruefen = useCallback(async () => {
    if (!zugang || !standortPasst || !standort || laeuft.current) return
    laeuft.current = true
    setStand((s) => ({ ...s, status: 'laeuft', text: 'OneDrive wird abgefragt …' }))
    const { kunde, importiert: bekannt, stapel, onVideos, onToast } = aktuell.current
    try {
      const termin = manuellesTermindatum(kunde)
      const jetzt = Date.now()
      const seit = new Date(termin ? termin - TAG_MS : jetzt - 30 * TAG_MS).toISOString()
      const bis = new Date(jetzt + TAG_MS).toISOString()
      const frage = { seit, bis, lat: standort.lat, lon: standort.lon, radius: ONEDRIVE_RADIUS_M }
      let antwort
      try {
        antwort = await ladeAufnahmen(frage)
      } catch (fehler) {
        // Graph-Token abgelaufen: Easy Auth auffrischen lassen und einmal wiederholen
        if (fehler instanceof ApiFehler && fehler.status === 409 && (await onedriveAuffrischen())) {
          antwort = await ladeAufnahmen(frage)
        } else throw fehler
      }
      const neue = antwort.treffer.filter((a) => !bekannt.includes(a.id)).slice(0, JE_DURCHLAUF)
      const fotos: File[] = []
      const videos: File[] = []
      const fertig: string[] = []
      for (const a of neue) {
        setStand((s) => ({ ...s, text: `Lädt ${a.name} …` }))
        const datei = await ladeOneDriveDatei(a)
        if (a.art === 'video') videos.push(datei)
        else fotos.push(datei)
        fertig.push(a.id)
      }
      if (fotos.length) await stapel.hinzufuegen(fotos)
      if (videos.length) onVideos(videos)
      if (fertig.length) setImportiert((alt) => [...alt, ...fertig.filter((id) => !alt.includes(id))])
      if (fertig.length) {
        const teile = [
          fotos.length ? `${fotos.length} Foto${fotos.length === 1 ? '' : 's'}` : '',
          videos.length ? `${videos.length} Video${videos.length === 1 ? '' : 's'}` : '',
        ].filter(Boolean)
        onToast('success', `${teile.join(' und ')} aus OneDrive übernommen (${objektadresseEcht(kunde)})`)
      }
      const offen = antwort.treffer.filter((a) => !bekannt.includes(a.id)).length - fertig.length
      const text = [
        `zuletzt ${uhr(jetzt)}`,
        `${antwort.geprueft} Aufnahme${antwort.geprueft === 1 ? '' : 'n'} im Zeitraum`,
        `${antwort.treffer.length} am Objekt`,
        antwort.ohneStandort ? `${antwort.ohneStandort} ohne Standort` : '',
        offen > 0 ? `${offen} folgen` : '',
        antwort.hinweis ?? '',
      ]
        .filter(Boolean)
        .join(' · ')
      setStand({ status: 'bereit', text, zuletzt: jetzt })
    } catch (fehler: unknown) {
      setStand((s) => ({ ...s, status: 'fehler', text: fehler instanceof Error ? fehler.message : String(fehler) }))
    } finally {
      laeuft.current = false
    }
  }, [zugang, standortPasst, standort, setImportiert])

  useEffect(() => {
    if (!zugang || !standortPasst || !geladen) return
    void pruefen()
    const takt = window.setInterval(() => void pruefen(), TAKT_MS)
    return () => window.clearInterval(takt)
  }, [zugang, standortPasst, geladen, pruefen])

  if (!zugang) return { status: 'aus', text: '', zuletzt: null, pruefen: () => undefined }
  return { ...stand, pruefen: () => void pruefen() }
}
