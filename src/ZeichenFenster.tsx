import { useEffect, useRef } from 'react'

/**
 * Vollbild-Fenster mit dem Zeichentool (zeichnen.html im iframe), in dem die
 * Prinzipskizze gezeichnet wird (Yann, 11.09.2026: Zeichnen im Vollbild, aber
 * ueber die Prinzipskizzen-Seite zugaenglich; die Vertriebler sollen nur das
 * eine Werkzeug nutzen).
 *
 * Ablauf: Das iframe meldet "bereit", die App schickt die PDF ("oeffne"), das
 * Werkzeug schickt beim Speichern die fertige Datei zurueck ("gespeichert",
 * mit Anzahl gezeichneter Objekte) oder bittet ums Schliessen ("schliessen",
 * mit Hinweis auf ungespeicherte Aenderungen). Gleiche Herkunft, deshalb
 * werden Nachrichten nur vom eigenen Origin angenommen.
 */

export interface ZeichenFensterProps {
  /** Die PDF, die gezeichnet wird: frisch aufgebaut oder eine schon gezeichnete */
  bytes: Uint8Array
  name: string
  onGespeichert: (bytes: Uint8Array, anzahl: number) => void
  onSchliessen: () => void
}

type Nachricht =
  | { typ: 'bereit' }
  | { typ: 'gespeichert'; bytes: ArrayBuffer; anzahl: number; name: string }
  | { typ: 'schliessen'; geaendert: boolean }

export default function ZeichenFenster({ bytes, name, onGespeichert, onSchliessen }: ZeichenFensterProps) {
  const rahmen = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    const onMessage = (e: MessageEvent<Nachricht>) => {
      const fenster = rahmen.current?.contentWindow
      if (!fenster || e.source !== fenster || e.origin !== window.location.origin) return
      const n = e.data
      if (!n || typeof n !== 'object') return
      if (n.typ === 'bereit') {
        // Kopie uebergeben, das Original bleibt bei der App
        const puffer = bytes.slice().buffer
        fenster.postMessage({ typ: 'oeffne', bytes: puffer, name }, window.location.origin, [puffer])
      } else if (n.typ === 'gespeichert') {
        onGespeichert(new Uint8Array(n.bytes), n.anzahl)
      } else if (n.typ === 'schliessen') {
        if (n.geaendert && !window.confirm('Die Zeichnung wurde nicht übernommen. Änderungen verwerfen?')) return
        onSchliessen()
      }
    }
    window.addEventListener('message', onMessage)
    // Die Seite dahinter soll nicht mitscrollen
    document.body.classList.add('zeichnen-offen')
    return () => {
      window.removeEventListener('message', onMessage)
      document.body.classList.remove('zeichnen-offen')
    }
  }, [bytes, name, onGespeichert, onSchliessen])

  return (
    <div className="zeichenfenster" role="dialog" aria-label="Prinzipskizze zeichnen">
      <iframe ref={rahmen} className="zeichenfenster-rahmen" src={`${import.meta.env.BASE_URL}zeichnen.html`} title="Zeichentool" />
    </div>
  )
}
