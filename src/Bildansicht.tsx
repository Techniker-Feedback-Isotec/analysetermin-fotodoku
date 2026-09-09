import { useEffect, useState } from 'react'
import { makeThumbnailUrl } from './lib/image'
import type { TerminPhoto } from './lib/bilder'
import { formatDateTime } from './lib/format'

/**
 * Ein Foto gross ansehen (Yann, 09.09.2026: „dann sehe ich auch die Details").
 *
 * In der Liste ist die Vorschau klein; hier fuellt das Bild den Bildschirm.
 * Gezeigt wird zuerst die vorhandene 512er-Vorschau, damit sofort etwas da
 * ist, und sobald sie fertig ist die grosse Fassung aus dem Originalbild -
 * ueber dieselbe Funktion wie die Vorschau, damit Drehung und EXIF-Ausrichtung
 * genauso stimmen. Die grosse Fassung wird beim Schliessen wieder freigegeben.
 */

/** Kantenlaenge der grossen Fassung: genug fuer Details, ohne lange zu rechnen. */
const GROSSE_KANTE = 2400

export interface BildansichtProps {
  fotos: TerminPhoto[]
  index: number
  onIndex: (index: number) => void
  onClose: () => void
}

export default function Bildansicht({ fotos, index, onIndex, onClose }: BildansichtProps) {
  const foto = fotos[index]
  const [grossUrl, setGrossUrl] = useState<string | null>(null)
  const [laedt, setLaedt] = useState(false)

  // Grosse Fassung je gezeigtem Foto einmal erzeugen und danach freigeben.
  useEffect(() => {
    if (!foto) return
    let abgebrochen = false
    let erzeugt: string | null = null
    setGrossUrl(null)
    setLaedt(true)
    makeThumbnailUrl(foto.workingBlob, foto.orientation, GROSSE_KANTE, foto.rotation)
      .then((url) => {
        erzeugt = url
        if (abgebrochen) {
          URL.revokeObjectURL(url)
          return
        }
        setGrossUrl(url)
      })
      .catch(() => {
        // Dann bleibt es bei der kleinen Vorschau.
      })
      .finally(() => {
        if (!abgebrochen) setLaedt(false)
      })
    return () => {
      abgebrochen = true
      if (erzeugt) URL.revokeObjectURL(erzeugt)
    }
  }, [foto])

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
    <div
      className="bildansicht"
      role="dialog"
      aria-label={`Foto ${index + 1} von ${fotos.length}: ${foto.fileName}`}
      onClick={onClose}
    >
      <div className="bildansicht-kopf" onClick={(e) => e.stopPropagation()}>
        <div className="bildansicht-titel">
          <p className="file-name">{foto.fileName}</p>
          <p className="file-meta">
            Foto {index + 1} von {fotos.length} · {formatDateTime(foto.takenAt)}
            {laedt && ' · volle Auflösung wird geladen …'}
          </p>
        </div>
        <button type="button" className="bildansicht-schliessen" onClick={onClose} aria-label="Schließen">
          ✕
        </button>
      </div>

      {/* Klick auf das Bild selbst schliesst nicht - sonst trifft man beim
          Heranzoomen am Handy dauernd daneben. */}
      <img
        className="bildansicht-bild"
        src={grossUrl ?? foto.thumbUrl}
        alt={foto.fileName}
        onClick={(e) => e.stopPropagation()}
      />

      {index > 0 && (
        <button
          type="button"
          className="bildansicht-pfeil links"
          onClick={(e) => {
            e.stopPropagation()
            onIndex(index - 1)
          }}
          aria-label="Vorheriges Foto"
        >
          ‹
        </button>
      )}
      {index < fotos.length - 1 && (
        <button
          type="button"
          className="bildansicht-pfeil rechts"
          onClick={(e) => {
            e.stopPropagation()
            onIndex(index + 1)
          }}
          aria-label="Nächstes Foto"
        >
          ›
        </button>
      )}
    </div>
  )
}
