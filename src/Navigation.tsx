import { Fragment } from 'react'
import logo from './assets/isotec-logo.png'

/**
 * Menueband am linken Rand, im Stil des Vertriebsprozess-Werkzeugs: Marke
 * oben, darunter die drei Bereiche, unten der Hinweis zum Datenschutz.
 * Auf dem Handy wandert die Marke in eine schmale Kopfzeile und die Bereiche
 * in eine Leiste am unteren Rand (Daumenreichweite), siehe styles.css.
 */
export type Modus = 'projekte' | 'kunde' | 'foto' | 'video' | 'prinzipskizze' | 'vorschau' | 'praesentation'

/**
 * Reihenfolge seit 12.09.2026 (Yann): "Projekte" steht ueber allem, darunter
 * nach einem grauen Strich die Seiten mit den Daten des gewaehlten Projekts.
 * Die fruehere Seite "Kunden" heisst jetzt "Uebersicht".
 */
export const BEREICHE: { id: Modus; label: string; kurz: string }[] = [
  { id: 'projekte', label: 'Projekte', kurz: 'Projekte' },
  { id: 'kunde', label: 'Übersicht', kurz: 'Übersicht' },
  { id: 'foto', label: 'Fotodokumentation', kurz: 'Fotos' },
  { id: 'video', label: 'Videodokumentation', kurz: 'Videos' },
  { id: 'prinzipskizze', label: 'Prinzipskizze', kurz: 'Skizze' },
  { id: 'vorschau', label: 'Sanierungsvorschau', kurz: 'Vorschau' },
  { id: 'praesentation', label: 'Präsentation', kurz: 'Präsi' },
]

const strich = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

const ICONS: Record<Modus, JSX.Element> = {
  // Ordnerstapel: die Projekte
  projekte: (
    <svg width="18" height="18" viewBox="0 0 20 20" {...strich}>
      <path d="M2.5 6.5A1.5 1.5 0 0 1 4 5h3.2l1.6 1.6H16A1.5 1.5 0 0 1 17.5 8.1V14A1.5 1.5 0 0 1 16 15.5H4A1.5 1.5 0 0 1 2.5 14z" />
      <path d="M2.5 9.5h15" />
    </svg>
  ),
  // Person: die Angaben zum Kunden und Termin
  kunde: (
    <svg width="18" height="18" viewBox="0 0 20 20" {...strich}>
      <circle cx="10" cy="6.5" r="3.5" />
      <path d="M3.5 17.5c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5" />
    </svg>
  ),
  // Stift und Lineal: die Skizze
  prinzipskizze: (
    <svg width="18" height="18" viewBox="0 0 20 20" {...strich}>
      <path d="m3 17 1-4 9.5-9.5 3 3L7 16z" />
      <path d="m11.5 5.5 3 3" />
      <path d="M3 17h5" />
    </svg>
  ),
  // Fotoapparat
  foto: (
    <svg width="18" height="18" viewBox="0 0 20 20" {...strich}>
      <path d="M2.5 6.5h3l1.5-2.2h6l1.5 2.2h3v10h-15z" />
      <circle cx="10" cy="11.3" r="3" />
    </svg>
  ),
  // Videokamera
  video: (
    <svg width="18" height="18" viewBox="0 0 20 20" {...strich}>
      <rect x="2.5" y="5.5" width="10.5" height="9" rx="1.6" />
      <path d="m13 8.7 4.5-2.4v7.4L13 11.3" />
    </svg>
  ),
  // Leinwand mit Abspielpfeil: die Praesentation beim Kunden
  praesentation: (
    <svg width="18" height="18" viewBox="0 0 20 20" {...strich}>
      <rect x="2.5" y="4" width="15" height="10" rx="1.5" />
      <path d="M10 14v3.5M7 17.5h6" />
      <path d="m8.5 7 3.5 2-3.5 2z" />
    </svg>
  ),
  // Kellerwand mit Glanz: aus dem Bestand wird die Sanierung sichtbar
  vorschau: (
    <svg width="18" height="18" viewBox="0 0 20 20" {...strich}>
      <path d="M2.5 9.5 10 3l7.5 6.5" />
      <path d="M4.5 8.5v8.5h11V8.5" />
      <path d="M13.2 11.2v.2M14.4 13.4l.6.6M12 13.4l-.6.6M13.2 12.5v2.4" />
    </svg>
  ),
}

export function Navigation({
  modus,
  onWechsel,
  fuss,
}: {
  modus: Modus
  onWechsel: (m: Modus) => void
  fuss?: React.ReactNode
}) {
  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <img src={logo} alt="ISOTEC" />
        <div className="sidebar-titel">
          <p className="app-title">Dokumentation</p>
          <p className="app-claim">Abdichtungstechnik Dipl.-Ing. Morscheck GmbH</p>
        </div>
      </div>

      <nav className="nav" aria-label="Bereiche" role="tablist">
        {BEREICHE.map((b) => (
          <Fragment key={b.id}>
            <button
              type="button"
              role="tab"
              aria-selected={modus === b.id}
              className={`nav-item${modus === b.id ? ' active' : ''}`}
              onClick={() => onWechsel(b.id)}
            >
              <span className="nav-icon">{ICONS[b.id]}</span>
              <span className="nav-lang">{b.label}</span>
              <span className="nav-kurz">{b.kurz}</span>
            </button>
            {/* Grauer Strich: darueber das Projekt, darunter seine Daten */}
            {b.id === 'projekte' && <span className="nav-trenner" aria-hidden="true" />}
          </Fragment>
        ))}
      </nav>

      {fuss && <div className="sidebar-foot">{fuss}</div>}
    </aside>
  )
}
