import { useEffect, useState } from 'react'
import Vergleich from './Vergleich'
import { ladeNachherHerunter, teileNachherBild, teilenMoeglich } from '../lib/share'

export type ViewerFoto = {
  id: string
  name: string
  vorherUrl: string
  nachherUrl: string
  nachherBlob: Blob
}

type Props = {
  fotos: ViewerFoto[]
  index: number
  onIndex: (index: number) => void
  onClose: () => void
}

/**
 * Vollbildansicht für den Kundentermin: dieselbe Vergleichsfläche wie auf der
 * Seite, nur ohne alles drumherum.
 */
export default function Viewer({ fotos, index, onIndex, onClose }: Props) {
  const foto = fotos[index]
  const [gesichert, setGesichert] = useState(false)

  useEffect(() => {
    setGesichert(false)
  }, [foto?.id])

  useEffect(() => {
    const taste = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft' && index > 0) onIndex(index - 1)
      if (e.key === 'ArrowRight' && index < fotos.length - 1) onIndex(index + 1)
    }
    window.addEventListener('keydown', taste)
    return () => window.removeEventListener('keydown', taste)
  }, [index, fotos.length, onClose, onIndex])

  if (!foto) return null

  return (
    <div className="viewer" role="dialog" aria-label="Vorher-Nachher-Vergleich">
      <div className="viewer-kopf">
        <div className="viewer-titel">
          <strong>{foto.name}</strong>
          <span>
            {index + 1} von {fotos.length}
          </span>
        </div>
        <div className="viewer-knoepfe">
          <button
            className="btn btn-hell"
            onClick={() => {
              ladeNachherHerunter(foto.nachherBlob, foto.name)
              setGesichert(true)
            }}
          >
            {gesichert ? '✓ Heruntergeladen' : 'Herunterladen'}
          </button>
          {teilenMoeglich() && (
            <button
              className="btn btn-hell"
              onClick={() => void teileNachherBild(foto.nachherBlob, foto.name)}
            >
              In Fotos sichern
            </button>
          )}
          <button className="btn btn-hell viewer-zu" onClick={onClose} aria-label="Schließen">
            ✕
          </button>
        </div>
      </div>

      <div className="viewer-mitte">
        {index > 0 && (
          <button className="viewer-pfeil" onClick={() => onIndex(index - 1)} aria-label="Vorheriges Foto">
            ‹
          </button>
        )}

        <Vergleich vorherUrl={foto.vorherUrl} nachherUrl={foto.nachherUrl} zuruecksetzenBei={foto.id} />

        {index < fotos.length - 1 && (
          <button className="viewer-pfeil" onClick={() => onIndex(index + 1)} aria-label="Nächstes Foto">
            ›
          </button>
        )}
      </div>

    </div>
  )
}
