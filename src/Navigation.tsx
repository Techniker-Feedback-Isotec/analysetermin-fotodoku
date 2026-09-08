import logo from './assets/isotec-logo.png'

/**
 * Menueband am linken Rand, im Stil des Vertriebsprozess-Werkzeugs: Marke
 * oben, darunter die drei Bereiche, unten der Hinweis zum Datenschutz.
 * Auf dem Handy wandert die Marke in eine schmale Kopfzeile und die Bereiche
 * in eine Leiste am unteren Rand (Daumenreichweite), siehe styles.css.
 */
export type Modus = 'foto' | 'video' | 'vorschau'

export const BEREICHE: { id: Modus; label: string; kurz: string }[] = [
  { id: 'foto', label: 'Fotodokumentation', kurz: 'Fotos' },
  { id: 'video', label: 'Videodokumentation', kurz: 'Videos' },
  { id: 'vorschau', label: 'Sanierungsvorschau', kurz: 'Vorschau' },
]

const strich = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

const ICONS: Record<Modus, JSX.Element> = {
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
          <p className="app-title">Dokumentation Analysetermin</p>
          <p className="app-claim">Abdichtungstechnik Dipl.-Ing. Morscheck GmbH</p>
        </div>
      </div>

      <nav className="nav" aria-label="Bereiche" role="tablist">
        {BEREICHE.map((b) => (
          <button
            key={b.id}
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
        ))}
      </nav>

      {fuss && <div className="sidebar-foot">{fuss}</div>}
    </aside>
  )
}
