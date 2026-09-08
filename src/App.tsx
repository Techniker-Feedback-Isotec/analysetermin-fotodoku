import { Suspense, lazy, useCallback, useEffect, useState } from 'react'
import KundePanel from './KundePanel'
import FotoDokuPanel from './FotoDokuPanel'
import { Navigation, type Modus } from './Navigation'
import { useFotostapel } from './fotostapel'
import {
  LEERE_KUNDENDATEN,
  mitarbeiterVon,
  objektadresseEcht,
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

const START_MODUS: Modus = /vorschau|einstellungen|demo/.test(window.location.hash) ? 'vorschau' : 'kunde'

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
  // Die Sanierungsvorschau hat eigene Links (#einstellungen, #demo), die sie direkt oeffnen.
  const [modus, setModus] = useState<Modus>(START_MODUS)
  /** Seiten, die schon einmal offen waren - nur die werden (und bleiben) eingehaengt */
  const [geoeffnet, setGeoeffnet] = useState<Partial<Record<Modus, boolean>>>({ [START_MODUS]: true })
  useEffect(() => {
    setGeoeffnet((bisher) => (bisher[modus] ? bisher : { ...bisher, [modus]: true }))
  }, [modus])
  const [kunde, setKunde] = useState<Kundendaten>(LEERE_KUNDENDATEN)
  const [dokumente, setDokumente] = useState<Dokument[]>([])
  const [toasts, setToasts] = useState<Toast[]>([])

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
   * Ein gemeinsamer Bilderstapel fuer Fotodokumentation und Prinzipskizze:
   * einmal hochladen, auf beiden Seiten verfuegbar.
   */
  const stapel = useFotostapel(pushToast)

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
        erstellt: Date.now(),
      }
      // Neueste zuerst
      return [neu, ...rest]
    })
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
          modus === 'vorschau' ? (
            // Die Sanierungsvorschau schickt die Fotos zur Bearbeitung an Google.
            <p className="privacy-note">
              <span aria-hidden="true">☁</span> Fotos werden zur Bearbeitung an Google Gemini
              übertragen.
            </p>
          ) : (
            <p className="privacy-note">
              <span aria-hidden="true">🔒</span> Alle Dateien bleiben lokal im Browser – es wird nichts
              hochgeladen.
            </p>
          )
        }
      />

      <div className="content">
        <main className="container">
          <div hidden={modus !== 'kunde'}>
            <KundePanel
              daten={kunde}
              onChange={aendereKunde}
              dokumente={dokumente}
              onEntfernen={entferneDokument}
              onToast={pushToast}
            />
          </div>

          <div hidden={modus !== 'foto'}>
            <FotoDokuPanel
              art="fotodoku"
              kunde={kunde}
              stapel={stapel}
              onToast={pushToast}
              onDokument={setzeDokument}
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
              art="prinzipskizze"
              kunde={kunde}
              stapel={stapel}
              onToast={pushToast}
              onDokument={setzeDokument}
            />
          </div>

          <div hidden={modus !== 'vorschau'}>
            {geoeffnet.vorschau && (
              <Suspense fallback={<p className="lade-hinweis">Sanierungsvorschau wird geladen …</p>}>
                <VorschauPanel kunde={kunde} onDokument={setzeDokument} />
              </Suspense>
            )}
          </div>
        </main>

        <footer className="footer">
          <div className="container">
            {modus === 'vorschau' ? (
              <p>
                {COMPANY} · Fotos gehen zur Bearbeitung an Google Gemini, sonst keine Uploads, kein
                Tracking, keine Cookies
              </p>
            ) : (
              <p>
                Verarbeitung zu 100 % lokal im Browser · keine Uploads, kein Tracking, keine Cookies
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
