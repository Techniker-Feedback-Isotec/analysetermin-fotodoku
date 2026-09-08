import { useCallback, useEffect, useRef, useState } from 'react'

type Props = {
  vorherUrl: string
  nachherUrl: string
  /** Wechselt dieser Wert, springt der Regler zurück in die Mitte (neues Foto). */
  zuruecksetzenBei?: string
}

/**
 * Die Vergleichsfläche mit Schieberegler.
 *
 * Links liegt das alte Foto, rechts das sanierte. Zieht man den Griff nach
 * links, wird mehr vom Nachher-Bild sichtbar, nach rechts mehr vom Vorher-Bild.
 * Start bei 90 Prozent Vorher.
 * Wird sowohl im Fenster auf der Seite als auch in der Vollbildansicht benutzt.
 */
/**
 * Startstellung des Reglers (Yann, 05.09.2026): erst fast nur das alte Foto
 * zeigen, das Neue schaut nur am rechten Rand hervor. Beim Kunden zieht man
 * den Regler dann bewusst nach links und enthuellt die Sanierung.
 */
const START_POSITION = 90

export default function Vergleich({ vorherUrl, nachherUrl, zuruecksetzenBei }: Props) {
  const [position, setPosition] = useState(START_POSITION)
  const flaeche = useRef<HTMLDivElement>(null)
  const zieht = useRef(false)

  useEffect(() => {
    setPosition(START_POSITION)
  }, [zuruecksetzenBei])

  const setzeAusEreignis = useCallback((clientX: number) => {
    const rect = flaeche.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return
    const anteil = ((clientX - rect.left) / rect.width) * 100
    setPosition(Math.max(0, Math.min(100, anteil)))
  }, [])

  return (
    <div
      ref={flaeche}
      className="vergleich"
      onPointerDown={(e) => {
        zieht.current = true
        ;(e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId)
        setzeAusEreignis(e.clientX)
      }}
      onPointerMove={(e) => {
        if (zieht.current) setzeAusEreignis(e.clientX)
      }}
      onPointerUp={() => {
        zieht.current = false
      }}
      onPointerCancel={() => {
        zieht.current = false
      }}
    >
      <img className="vergleich-bild" src={vorherUrl} alt="Vorher" draggable={false} />
      <img
        className="vergleich-bild vergleich-nachher"
        src={nachherUrl}
        alt="Nachher"
        draggable={false}
        style={{ clipPath: `inset(0 0 0 ${position}%)` }}
      />
      <span className="vergleich-marke links-oben">Vorher</span>
      <span className="vergleich-marke rechts-oben">Nachher</span>
      <div className="vergleich-linie" style={{ left: `${position}%` }}>
        <div className="vergleich-griff">⇄</div>
      </div>
    </div>
  )
}
