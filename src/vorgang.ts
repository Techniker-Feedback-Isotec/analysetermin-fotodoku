import { useCallback, useEffect, useRef, useState } from 'react'
import type { Fotostapel } from './fotostapel'
import type { TerminPhoto } from './lib/bilder'
import type { Ich } from './lib/api'
import { makeThumbnailUrl } from './lib/image'
import {
  LEERE_PRAESENTATION,
  LEERER_MAPPENZUSTAND,
  LEERER_SEITENZUSTAND,
  aktiverVorgangId,
  ladeDokumente,
  ladeFotos,
  ladeVorgaenge,
  ladeVorgang,
  loescheDokumente,
  loescheFotos,
  loescheVorgang,
  merkeAktivenVorgang,
  persistenzAnfordern,
  speicherVerfuegbar,
  speichereDokumente,
  speichereFotos,
  speichereVorgang,
  speicherverbrauch,
  vorgangIstLeer,
  type MappenZustand,
  type PraesentationZustand,
  type SeitenZustand,
  type VorgangSatz,
} from './lib/speicher'
import { LEERE_KUNDENDATEN, mitarbeiterFuerAnmeldung, type Dokument, type Kundendaten, type ToastFn } from './kunde'
import type { FotoDokuArt } from './FotoDokuPanel'

/**
 * Der Vorgang: alles, was zu einem Kunden gehoert, fortlaufend im Geraet
 * gespeichert (Yann, 11.09.2026). Der Hook haengt sich an die Zustaende in
 * App.tsx, schreibt Aenderungen mit kurzer Verzoegerung in IndexedDB und
 * stellt beim Start den zuletzt offenen Vorgang wieder her.
 *
 * Aufteilung: Kundendaten, Seitenzustaende und Mappenauswahl sind klein und
 * werden als ein Satz geschrieben (600 ms nach der letzten Aenderung). Fotos
 * und Dokumente werden einzeln geschrieben, nur was neu, gedreht, umbenannt
 * oder entfernt wurde - sonst gingen bei jedem Tastendruck hunderte Megabyte
 * ueber die Leitung.
 */

export type SpeicherStatus = 'aus' | 'laedt' | 'bereit' | 'schreibt' | 'fehler'

export interface Seiten {
  fotodoku: SeitenZustand
  prinzipskizze: SeitenZustand
}

const LEERE_SEITEN: Seiten = { fotodoku: LEERER_SEITENZUSTAND, prinzipskizze: LEERER_SEITENZUSTAND }

export interface VorgangHook {
  id: string
  liste: VorgangSatz[]
  status: SpeicherStatus
  gespeichertUm: number | null
  verbrauch: number | null
  seiten: Seiten
  setSeite: (art: FotoDokuArt, zustand: SeitenZustand) => void
  mappe: MappenZustand
  setMappe: (zustand: MappenZustand) => void
  praesentation: PraesentationZustand
  setPraesentation: (zustand: PraesentationZustand) => void
  neu: () => Promise<void>
  oeffnen: (id: string) => Promise<void>
  loeschen: (id: string) => Promise<void>
}

interface Anbindung {
  kunde: Kundendaten
  setKunde: (kunde: Kundendaten) => void
  stapel: Fotostapel
  dokumente: Dokument[]
  setDokumente: (dokumente: Dokument[]) => void
  ich: Ich | null
  onToast: ToastFn
}

const VERZOEGERUNG_MS = 600

export function useVorgang({ kunde, setKunde, stapel, dokumente, setDokumente, ich, onToast }: Anbindung): VorgangHook {
  const [id, setId] = useState<string>(() => crypto.randomUUID())
  const [liste, setListe] = useState<VorgangSatz[]>([])
  const [status, setStatus] = useState<SpeicherStatus>(speicherVerfuegbar() ? 'laedt' : 'aus')
  const [gespeichertUm, setGespeichertUm] = useState<number | null>(null)
  const [verbrauch, setVerbrauch] = useState<number | null>(null)
  const [seiten, setSeiten] = useState<Seiten>(LEERE_SEITEN)
  const [mappe, setMappe] = useState<MappenZustand>(LEERER_MAPPENZUSTAND)
  const [praesentation, setPraesentation] = useState<PraesentationZustand>(LEERE_PRAESENTATION)

  /** Erst wenn der Vorgang steht (geladen oder neu), wird geschrieben */
  const bereit = useRef(false)
  const erstellt = useRef(Date.now())
  const besitzer = useRef<string | null>(null)
  /** Letzter geschriebener Stand je Foto und Dokument, fuer den Abgleich */
  const fotosVorher = useRef(new Map<string, TerminPhoto>())
  const dokumenteVorher = useRef(new Map<string, Dokument>())
  const zeitgeber = useRef<number | null>(null)
  /** Aktuelle Werte fuer das Schreiben ausserhalb des Renderns */
  const aktuell = useRef({ id, kunde, seiten, mappe, praesentation, fotos: stapel.fotos, dokumente })
  aktuell.current = { id, kunde, seiten, mappe, praesentation, fotos: stapel.fotos, dokumente }
  const ichRef = useRef(ich)
  ichRef.current = ich
  const stapelRef = useRef(stapel)
  stapelRef.current = stapel

  const meldeFehler = useCallback(
    (fehler: unknown) => {
      console.warn('Speichern im Gerät fehlgeschlagen', fehler)
      setStatus('fehler')
    },
    [],
  )

  const aktualisiereVerbrauch = useCallback(() => {
    void speicherverbrauch().then((v) => setVerbrauch(v ? v.belegt : null))
  }, [])

  /** Den Vorgangssatz aus den aktuellen Werten bauen */
  const baueSatz = useCallback((): VorgangSatz => {
    const { id, kunde, seiten, mappe, praesentation, fotos, dokumente } = aktuell.current
    const { objektfoto, ...restKunde } = kunde
    let objektfotoSatz: VorgangSatz['kunde']['objektfoto'] = null
    if (objektfoto) {
      const { thumbUrl: _thumb, ...rest } = objektfoto
      objektfotoSatz = rest
    }
    return {
      id,
      besitzer: besitzer.current,
      erstellt: erstellt.current,
      geaendert: Date.now(),
      kunde: { ...restKunde, objektfoto: objektfotoSatz },
      seiten,
      mappe,
      praesentation,
      anzahlFotos: fotos.length,
      anzahlDokumente: dokumente.length,
    }
  }, [])

  /** Den Vorgangssatz sofort schreiben (Zeitgeber abgelaufen oder Wechsel steht an) */
  const schreibeSatz = useCallback(async () => {
    if (zeitgeber.current !== null) {
      window.clearTimeout(zeitgeber.current)
      zeitgeber.current = null
    }
    if (!bereit.current) return
    const satz = baueSatz()
    if (vorgangIstLeer(satz)) return
    setStatus('schreibt')
    try {
      await speichereVorgang(satz)
      setListe((bisher) => [satz, ...bisher.filter((v) => v.id !== satz.id)])
      setGespeichertUm(satz.geaendert)
      setStatus('bereit')
      aktualisiereVerbrauch()
    } catch (fehler) {
      meldeFehler(fehler)
    }
  }, [baueSatz, aktualisiereVerbrauch, meldeFehler])

  /** Blob-Adressen freigeben und alle Zustaende auf Anfang */
  const leereAlles = useCallback(() => {
    const { kunde, dokumente } = aktuell.current
    if (kunde.objektfoto) URL.revokeObjectURL(kunde.objektfoto.thumbUrl)
    for (const d of dokumente) URL.revokeObjectURL(d.url)
    stapelRef.current.leeren()
    setDokumente([])
    setSeiten(LEERE_SEITEN)
    setMappe(LEERER_MAPPENZUSTAND)
    setPraesentation(LEERE_PRAESENTATION)
    fotosVorher.current = new Map()
    dokumenteVorher.current = new Map()
  }, [setDokumente])

  /** Einen neuen, leeren Vorgang aufsetzen; der angemeldete Mitarbeiter ist vorgewaehlt */
  const setzeNeuAuf = useCallback(() => {
    bereit.current = false
    leereAlles()
    const neueId = crypto.randomUUID()
    setId(neueId)
    merkeAktivenVorgang(neueId)
    erstellt.current = Date.now()
    besitzer.current = ichRef.current?.email ?? null
    const vorgewaehlt = ichRef.current ? mitarbeiterFuerAnmeldung(ichRef.current) : null
    setKunde({ ...LEERE_KUNDENDATEN, mitarbeiterAuswahl: vorgewaehlt ?? '' })
    setGespeichertUm(null)
    if (speicherVerfuegbar()) setStatus('bereit')
    bereit.current = speicherVerfuegbar()
  }, [leereAlles, setKunde])

  /** Einen gespeicherten Vorgang in die Zustaende laden */
  const stelleWiederHer = useCallback(
    async (satz: VorgangSatz) => {
      bereit.current = false
      setStatus('laedt')
      leereAlles()
      setId(satz.id)
      merkeAktivenVorgang(satz.id)
      erstellt.current = satz.erstellt
      besitzer.current = satz.besitzer

      // Kundendaten: das Objektfoto braucht seine Vorschau wieder
      let objektfoto: Kundendaten['objektfoto'] = null
      if (satz.kunde.objektfoto) {
        const o = satz.kunde.objektfoto
        try {
          objektfoto = { ...o, thumbUrl: await makeThumbnailUrl(o.workingBlob, o.orientation, 512) }
        } catch {
          objektfoto = null
        }
      }
      setKunde({ ...satz.kunde, objektfoto })
      setSeiten(satz.seiten)
      setMappe(satz.mappe)
      setPraesentation(satz.praesentation ?? LEERE_PRAESENTATION)

      // Dokumente: Blob-Adressen neu, sonst unveraendert
      const dokSaetze = await ladeDokumente(satz.id)
      const dokumente: Dokument[] = dokSaetze
        .sort((a, b) => b.erstellt - a.erstellt)
        .map(({ vorgangId: _v, ...rest }) => ({ ...rest, url: URL.createObjectURL(rest.blob) }))
      setDokumente(dokumente)
      dokumenteVorher.current = new Map(dokumente.map((d) => [d.id, d]))

      // Fotos: Vorschauen entstehen nacheinander, mit Fortschritt im Stapel
      const fotoSaetze = await ladeFotos(satz.id)
      const fotos = await stapelRef.current.wiederherstellen(
        fotoSaetze.map(({ vorgangId: _v, ...rest }) => rest),
      )
      fotosVorher.current = new Map(fotos.map((f) => [f.id, f]))

      setGespeichertUm(satz.geaendert)
      setStatus('bereit')
      bereit.current = true
      const name = satz.kunde.kunde.trim() || 'ohne Namen'
      onToast(
        'info',
        `Vorgang „${name}" wiederhergestellt: ${fotos.length} Foto${fotos.length === 1 ? '' : 's'}, ${dokumente.length} Dokument${dokumente.length === 1 ? '' : 'e'}.`,
      )
    },
    [leereAlles, setKunde, setDokumente, onToast],
  )

  // ---------- Start: Liste lesen, zuletzt offenen Vorgang laden ----------
  useEffect(() => {
    if (!speicherVerfuegbar()) {
      bereit.current = false
      return
    }
    let abgebrochen = false
    void (async () => {
      try {
        void persistenzAnfordern()
        const alle = await ladeVorgaenge()
        if (abgebrochen) return
        setListe(alle)
        aktualisiereVerbrauch()
        const gemerkt = aktiverVorgangId()
        const letzter = alle.find((v) => v.id === gemerkt) ?? alle[0]
        if (letzter) {
          await stelleWiederHer(letzter)
        } else {
          setStatus('bereit')
          bereit.current = true
        }
      } catch (fehler) {
        if (!abgebrochen) {
          console.warn('Speicher im Gerät nicht lesbar', fehler)
          setStatus('fehler')
          bereit.current = false
        }
      }
    })()
    return () => {
      abgebrochen = true
    }
    // Nur einmal beim Start; die Funktionen sind stabil.
  }, [])

  // ---------- Vorgangssatz: Kundendaten, Seiten, Mappe, Zaehler ----------
  useEffect(() => {
    if (!bereit.current) return
    if (zeitgeber.current !== null) window.clearTimeout(zeitgeber.current)
    zeitgeber.current = window.setTimeout(() => {
      zeitgeber.current = null
      void schreibeSatz()
    }, VERZOEGERUNG_MS)
    return () => {
      if (zeitgeber.current !== null) {
        window.clearTimeout(zeitgeber.current)
        zeitgeber.current = null
      }
    }
  }, [kunde, seiten, mappe, praesentation, stapel.fotos.length, dokumente.length, id, schreibeSatz])

  // ---------- Fotos: neu, gedreht oder entfernt ----------
  useEffect(() => {
    if (!bereit.current) return
    const vorher = fotosVorher.current
    const jetzt = new Map(stapel.fotos.map((f) => [f.id, f]))
    const zuSchreiben = stapel.fotos.filter((f) => {
      const alt = vorher.get(f.id)
      return !alt || alt.rotation !== f.rotation
    })
    const zuLoeschen = [...vorher.keys()].filter((fid) => !jetzt.has(fid))
    fotosVorher.current = jetzt
    if (zuSchreiben.length === 0 && zuLoeschen.length === 0) return
    const vorgangId = aktuell.current.id
    setStatus('schreibt')
    void Promise.all([
      speichereFotos(zuSchreiben.map(({ thumbUrl: _t, ...rest }) => ({ ...rest, vorgangId }))),
      loescheFotos(zuLoeschen),
    ])
      .then(() => {
        setStatus('bereit')
        aktualisiereVerbrauch()
      })
      .catch(meldeFehler)
  }, [stapel.fotos, aktualisiereVerbrauch, meldeFehler])

  // ---------- Dokumente: neu, umbenannt oder entfernt ----------
  useEffect(() => {
    if (!bereit.current) return
    const vorher = dokumenteVorher.current
    const jetzt = new Map(dokumente.map((d) => [d.id, d]))
    const zuSchreiben = dokumente.filter((d) => {
      const alt = vorher.get(d.id)
      return !alt || alt.titel !== d.titel
    })
    const zuLoeschen = [...vorher.keys()].filter((did) => !jetzt.has(did))
    dokumenteVorher.current = jetzt
    if (zuSchreiben.length === 0 && zuLoeschen.length === 0) return
    const vorgangId = aktuell.current.id
    setStatus('schreibt')
    void Promise.all([
      speichereDokumente(zuSchreiben.map(({ url: _u, ...rest }) => ({ ...rest, vorgangId }))),
      loescheDokumente(zuLoeschen),
    ])
      .then(() => {
        setStatus('bereit')
        aktualisiereVerbrauch()
      })
      .catch(meldeFehler)
  }, [dokumente, aktualisiereVerbrauch, meldeFehler])

  // Vor dem Schliessen noch schreiben, was aussteht
  useEffect(() => {
    const vorSchliessen = () => {
      if (zeitgeber.current !== null) void schreibeSatz()
    }
    window.addEventListener('pagehide', vorSchliessen)
    return () => window.removeEventListener('pagehide', vorSchliessen)
  }, [schreibeSatz])

  const setSeite = useCallback((art: FotoDokuArt, zustand: SeitenZustand) => {
    setSeiten((bisher) => (bisher[art] === zustand ? bisher : { ...bisher, [art]: zustand }))
  }, [])

  const neu = useCallback(async () => {
    await schreibeSatz()
    setzeNeuAuf()
  }, [schreibeSatz, setzeNeuAuf])

  const oeffnen = useCallback(
    async (zielId: string) => {
      if (zielId === aktuell.current.id) return
      await schreibeSatz()
      const satz = await ladeVorgang(zielId)
      if (!satz) {
        onToast('error', 'Dieser Vorgang ist nicht mehr gespeichert.')
        setListe((bisher) => bisher.filter((v) => v.id !== zielId))
        return
      }
      try {
        await stelleWiederHer(satz)
      } catch (fehler) {
        meldeFehler(fehler)
        onToast('error', 'Der Vorgang konnte nicht geladen werden.')
      }
    },
    [schreibeSatz, stelleWiederHer, onToast, meldeFehler],
  )

  const loeschen = useCallback(
    async (zielId: string) => {
      const istAktiv = zielId === aktuell.current.id
      if (istAktiv) {
        // Nicht mehr schreiben, sonst kaeme der Vorgang gleich wieder
        bereit.current = false
        if (zeitgeber.current !== null) {
          window.clearTimeout(zeitgeber.current)
          zeitgeber.current = null
        }
      }
      try {
        await loescheVorgang(zielId)
        setListe((bisher) => bisher.filter((v) => v.id !== zielId))
        aktualisiereVerbrauch()
      } catch (fehler) {
        meldeFehler(fehler)
        onToast('error', 'Der Vorgang konnte nicht gelöscht werden.')
      }
      if (istAktiv) setzeNeuAuf()
    },
    [setzeNeuAuf, aktualisiereVerbrauch, meldeFehler, onToast],
  )

  return {
    id,
    liste,
    status,
    gespeichertUm,
    verbrauch,
    seiten,
    setSeite,
    mappe,
    setMappe,
    praesentation,
    setPraesentation,
    neu,
    oeffnen,
    loeschen,
  }
}
