import { Suspense, lazy, useCallback, useEffect, useState } from 'react'
import KundePanel from './KundePanel'
import Vorgaenge from './Vorgaenge'
import { useVorgang } from './vorgang'
import type { SeitenZustand } from './lib/speicher'
import FotoDokuPanel from './FotoDokuPanel'
import { Navigation, type Modus } from './Navigation'
import { useFotostapel } from './fotostapel'
import { abmelden, ladeIch, type Ich } from './lib/api'
import {
  LEERE_KUNDENDATEN,
  QUELLE_HOCHGELADEN,
  mitarbeiterFuerAnmeldung,
  mitarbeiterVon,
  objektadresseEcht,
  titelAusDateiname,
  type Dokument,
  type Kundendaten,
  type ToastKind,
} from './kunde'

interface Toast {
  id: number
  kind: ToastKind
  text: string
}

const COMPANY = 'Abdichtungstechnik Dipl.-Ing. Morscheck GmbH'

/**
 * Video- und Vorschauseite werden erst geladen, wenn jemand sie oeffnet: Die
 * Videoumwandlung (mediabunny) und die KI-Anbindung machen zusammen den
 * groessten Teil des Programms aus, gebraucht werden sie aber nur dort.
 * Einmal geladen bleiben sie eingehaengt, damit nichts verloren geht.
 */
const VideoPanel = lazy(() => import('./VideoPanel'))
const VorschauPanel = lazy(() => import('./vorschau/VorschauPanel'))

const START_MODUS: Modus = /vorschau|demo/.test(window.location.hash) ? 'vorschau' : 'kunde'

let toastCounter = 0

/**
 * Rahmen der Anwendung: Menueband links, rechts die gewaehlte Seite.
 *
 * Die Angaben zum Termin liegen hier und werden auf der Seite Kunde gepflegt;
 * alle anderen Seiten lesen sie nur. Jede Seite bleibt eingehaengt (hidden statt
 * unmount), damit importierte Fotos und verarbeitete Videos beim Seitenwechsel
 * nicht verloren gehen. Fertige Dokumente melden sich hier an und erscheinen
 * gesammelt auf der Seite Kunde.
 */
export default function App() {
  // Die Sanierungsvorschau hat einen eigenen Link (#demo), der sie direkt oeffnet.
  const [modus, setModus] = useState<Modus>(START_MODUS)
  /** Seiten, die schon einmal offen waren - nur die werden (und bleiben) eingehaengt */
  const [geoeffnet, setGeoeffnet] = useState<Partial<Record<Modus, boolean>>>({ [START_MODUS]: true })
  useEffect(() => {
    setGeoeffnet((bisher) => (bisher[modus] ? bisher : { ...bisher, [modus]: true }))
  }, [modus])
  const [kunde, setKunde] = useState<Kundendaten>(LEERE_KUNDENDATEN)
  const [dokumente, setDokumente] = useState<Dokument[]>([])
  const [toasts, setToasts] = useState<Toast[]>([])
  /** Wer angemeldet ist und was der Server kann (MeisterTask, Gemini); null bis zur Antwort */
  const [ich, setIch] = useState<Ich | null>(null)

  const aendereKunde = useCallback((aenderung: Partial<Kundendaten>) => {
    setKunde((bisher) => ({ ...bisher, ...aenderung }))
  }, [])

  const pushToast = useCallback((kind: ToastKind, text: string) => {
    const id = ++toastCounter
    setToasts((prev) => [...prev.slice(-4), { id, kind, text }])
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, 7000)
  }, [])

  /**
   * Die Anmeldung lesen und den eigenen Mitarbeiter vorwaehlen: Wer sich mit
   * seinem ISOTEC-Konto anmeldet und in der Mitarbeiterliste steht, ist
   * gleich ausgewaehlt (Yann, 08.09.2026). Die Auswahl bleibt aenderbar.
   */
  useEffect(() => {
    let abgebrochen = false
    ladeIch()
      .then((antwort) => {
        if (abgebrochen) return
        setIch(antwort)
        const name = mitarbeiterFuerAnmeldung(antwort)
        if (name) setKunde((bisher) => (bisher.mitarbeiterAuswahl ? bisher : { ...bisher, mitarbeiterAuswahl: name }))
      })
      .catch(() => {
        // Ohne Antwort bleibt alles bedienbar, nur ohne Vorauswahl und Suche.
        if (!abgebrochen) setIch({ email: null, name: null, anmeldung: 'entwicklung', meistertask: false, gemini: false })
      })
    return () => {
      abgebrochen = true
    }
  }, [])

  /**
   * Ein gemeinsamer Bilderstapel fuer Fotodokumentation und Prinzipskizze:
   * einmal hochladen, auf beiden Seiten verfuegbar.
   */
  const stapel = useFotostapel(pushToast)

  /**
   * Der Vorgang im Geraet: Kundendaten, Fotos, Dokumente, Seitenzustaende und
   * Mappenauswahl werden fortlaufend in IndexedDB geschrieben und beim Start
   * wiederhergestellt (Yann, 11.09.2026). Die Seiten bekommen `key={vorgang.id}`,
   * damit ein Vorgangswechsel sie mit dem gespeicherten Zustand neu aufsetzt.
   */
  const vorgang = useVorgang({ kunde, setKunde, stapel, dokumente, setDokumente, ich, onToast: pushToast })
  const { setSeite } = vorgang
  const zustandFotodoku = useCallback((z: SeitenZustand) => setSeite('fotodoku', z), [setSeite])
  const zustandSkizze = useCallback((z: SeitenZustand) => setSeite('prinzipskizze', z), [setSeite])

  /** Ein neues Dokument mit gleichem Schluessel ersetzt das alte; null entfernt es. */
  const setzeDokument = useCallback((schluessel: string, quelle: string, datei: File | null) => {
    setDokumente((bisher) => {
      const alt = bisher.find((d) => d.schluessel === schluessel)
      if (alt) URL.revokeObjectURL(alt.url)
      const rest = bisher.filter((d) => d.schluessel !== schluessel)
      if (!datei) return rest
      const neu: Dokument = {
        id: crypto.randomUUID(),
        schluessel,
        name: datei.name,
        art: datei.type === 'application/pdf' ? 'pdf' : 'video',
        blob: datei,
        url: URL.createObjectURL(datei),
        quelle,
        titel: quelle,
        hochgeladen: false,
        erstellt: Date.now(),
      }
      // Neueste zuerst
      return [neu, ...rest]
    })
  }, [])

  /**
   * Eine fertige PDF von aussen (Angebot, fertige Prinzipskizze) in die
   * Sammlung aufnehmen, damit sie Teil der Mappe werden kann (Yann,
   * 11.09.2026). Jede Datei ist ein eigenes Dokument, nichts wird ersetzt.
   */
  const ladeDokumentHoch = useCallback((datei: File) => {
    setDokumente((bisher) => {
      const id = crypto.randomUUID()
      const neu: Dokument = {
        id,
        schluessel: `upload:${id}`,
        name: datei.name,
        art: 'pdf',
        blob: datei,
        url: URL.createObjectURL(datei),
        quelle: QUELLE_HOCHGELADEN,
        titel: titelAusDateiname(datei.name),
        hochgeladen: true,
        erstellt: Date.now(),
      }
      return [neu, ...bisher]
    })
  }, [])

  /** Titel einer Unterlage fuer Inhaltsverzeichnis und Trennblatt aendern */
  const benenneDokument = useCallback((id: string, titel: string) => {
    setDokumente((bisher) => bisher.map((d) => (d.id === id ? { ...d, titel } : d)))
  }, [])

  const entferneDokument = useCallback((id: string) => {
    setDokumente((bisher) => {
      const dok = bisher.find((d) => d.id === id)
      if (dok) URL.revokeObjectURL(dok.url)
      return bisher.filter((d) => d.id !== id)
    })
  }, [])

  // Browser-Standardverhalten (Datei im Tab oeffnen) global unterbinden
  useEffect(() => {
    const prevent = (e: DragEvent) => e.preventDefault()
    window.addEventListener('dragover', prevent)
    window.addEventListener('drop', prevent)
    return () => {
      window.removeEventListener('dragover', prevent)
      window.removeEventListener('drop', prevent)
    }
  }, [])

  const mitarbeiter = mitarbeiterVon(kunde)

  return (
    <div className={`app shell modus-${modus}`}>
      {/* Menueband links wie im Vertriebsprozess-Werkzeug; die Marke steht darin */}
      <Navigation
        modus={modus}
        onWechsel={setModus}
        fuss={
          <>
            {modus === 'vorschau' ? (
              // Die Sanierungsvorschau schickt die Fotos zur Bearbeitung an Google.
              <p className="privacy-note">
                <span aria-hidden="true">☁</span> Fotos werden zur Bearbeitung an Google Gemini
                übertragen.
              </p>
            ) : (
              <p className="privacy-note">
                <span aria-hidden="true">🔒</span> Fotos, Videos und Vorgänge bleiben auf diesem
                Gerät. Kundendaten kommen aus MeisterTask.
              </p>
            )}
            {ich?.anmeldung === 'easyauth' && (
              <p className="privacy-note sidebar-konto">
                {ich.name ?? ich.email ?? 'Angemeldet'}
                {' · '}
                <button type="button" className="link-knopf" onClick={abmelden}>
                  Abmelden
                </button>
              </p>
            )}
          </>
        }
      />

      <div className="content">
        <main className="container">
          <div hidden={modus !== 'kunde'}>
            <Vorgaenge
              liste={vorgang.liste}
              aktivId={vorgang.id}
              status={vorgang.status}
              gespeichertUm={vorgang.gespeichertUm}
              verbrauch={vorgang.verbrauch}
              ich={ich}
              onNeu={vorgang.neu}
              onOeffnen={(id) => void vorgang.oeffnen(id)}
              onLoeschen={(id) => void vorgang.loeschen(id)}
            />
            <KundePanel
              key={vorgang.id}
              daten={kunde}
              onChange={aendereKunde}
              dokumente={dokumente}
              onEntfernen={entferneDokument}
              onDokument={setzeDokument}
              onHochladen={ladeDokumentHoch}
              onTitel={benenneDokument}
              onToast={pushToast}
              ich={ich}
              mappeStart={vorgang.mappe}
              onMappe={vorgang.setMappe}
            />
          </div>

          <div hidden={modus !== 'foto'}>
            <FotoDokuPanel
              key={vorgang.id}
              art="fotodoku"
              kunde={kunde}
              stapel={stapel}
              onToast={pushToast}
              onDokument={setzeDokument}
              start={vorgang.seiten.fotodoku}
              onZustand={zustandFotodoku}
            />
          </div>

          {/* Das Video-Deckblatt zeigt keine Kundenadresse, ein Verweis darauf waere
              dort sinnlos - deshalb bekommt es die tatsaechliche Anschrift. */}
          <div hidden={modus !== 'video'}>
            {geoeffnet.video && (
              <Suspense fallback={<p className="lade-hinweis">Videodokumentation wird geladen …</p>}>
                <VideoPanel
                  mitarbeiter={mitarbeiter.name}
                  mitarbeiterFoto={mitarbeiter.foto}
                  kunde={kunde.kunde}
                  objektadresse={objektadresseEcht(kunde)}
                  onToast={pushToast}
                  onDokument={setzeDokument}
                />
              </Suspense>
            )}
          </div>

          <div hidden={modus !== 'prinzipskizze'}>
            <FotoDokuPanel
              key={vorgang.id}
              art="prinzipskizze"
              kunde={kunde}
              stapel={stapel}
              onToast={pushToast}
              onDokument={setzeDokument}
              start={vorgang.seiten.prinzipskizze}
              onZustand={zustandSkizze}
            />
          </div>

          <div hidden={modus !== 'vorschau'}>
            {geoeffnet.vorschau && (
              <Suspense fallback={<p className="lade-hinweis">Sanierungsvorschau wird geladen …</p>}>
                <VorschauPanel
                  kunde={kunde}
                  onDokument={setzeDokument}
                  onToast={pushToast}
                  geminiVerfuegbar={ich ? ich.gemini : null}
                />
              </Suspense>
            )}
          </div>
        </main>

        <footer className="footer">
          <div className="container">
            {modus === 'vorschau' ? (
              <p>
                {COMPANY} · Fotos gehen zur Bearbeitung an Google Gemini · Anmeldung über das
                ISOTEC-Konto, kein Tracking
              </p>
            ) : (
              <p>
                Fotos und Videos werden lokal im Browser verarbeitet · Anmeldung über das ISOTEC-Konto,
                kein Tracking
                <br />
                PDF: ISOTEC_&lt;Terminart&gt;_Fotodokumentation_&lt;Kunde&gt;_&lt;TT.MM.JJJJ&gt;.pdf ·
                Video: ISOTEC_Videodokumentation_&lt;Titel&gt;_&lt;TT.MM.JJJJ&gt;.mp4
              </p>
            )}
          </div>
        </footer>
      </div>

      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`} role="status">
            {t.text}
          </div>
        ))}
      </div>
    </div>
  )
}
