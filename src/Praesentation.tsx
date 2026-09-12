import { useCallback, useEffect, useState } from 'react'
import logo from './assets/isotec-logo.png'
import Vergleich from './vorschau/Vergleich'
import { KAPITEL_EINLEITUNG, KAPITEL_SCHLUSS, USPS } from './mappe/inhalt'
import './praesentation.css'

/**
 * Praesentationsmodus (12.09.2026): Folien im Vollbild, Klick oder Pfeiltaste
 * blaettert, wie in PowerPoint oder Canva. Gedacht fuer die
 * Auftragsbesprechung beim Kunden: erst ISOTEC, dann Ist und Soll, das
 * Sanierungsziel, die Sanierungsbereiche aus der Skizze und zuletzt die
 * Vorher/Nachher-Bilder mit dem Schieberegler.
 *
 * Gestaltung nach dem Corporate Design: weisse Flaeche, rotes Band, braune
 * Schrift, ruhige Bewegungen (Einblenden von unten, gestaffelt). Alle
 * Bewegungen laufen ueber CSS in praesentation.css.
 */

export type Folie =
  | { art: 'titel'; titel: string; untertitel: string; zeilen: string[]; bildUrl: string | null }
  | { art: 'isotec' }
  | { art: 'text'; marke: string; titel: string; html: string; bilder?: string[]; chips?: string[] }
  | { art: 'gegenueber'; istHtml: string; sollHtml: string }
  | { art: 'bild'; marke: string; titel: string; url: string }
  | { art: 'vergleich'; name: string; vorherUrl: string; nachherUrl: string }
  | { art: 'schluss'; name: string; rolle: string }

export interface PraesentationProps {
  folien: Folie[]
  onSchliessen: () => void
}

/** Kinder mit gestaffelter Einblendung: jedes bekommt seinen Platz in der Reihe */
function Anim({ i, className, children }: { i: number; className?: string; children: React.ReactNode }) {
  return (
    <div className={`anim${className ? ` ${className}` : ''}`} style={{ '--i': i } as React.CSSProperties}>
      {children}
    </div>
  )
}

export default function Praesentation({ folien, onSchliessen }: PraesentationProps) {
  const [index, setIndex] = useState(0)
  const letzte = folien.length - 1

  const weiter = useCallback(() => setIndex((i) => Math.min(i + 1, letzte)), [letzte])
  const zurueck = useCallback(() => setIndex((i) => Math.max(i - 1, 0)), [])

  // Tastatur: Pfeile, Leertaste, Bild auf/ab, Pos1/Ende, Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (['ArrowRight', 'ArrowDown', ' ', 'PageDown', 'Enter'].includes(e.key)) {
        e.preventDefault()
        weiter()
      } else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(e.key)) {
        e.preventDefault()
        zurueck()
      } else if (e.key === 'Home') setIndex(0)
      else if (e.key === 'End') setIndex(letzte)
      else if (e.key === 'Escape') onSchliessen()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [weiter, zurueck, letzte, onSchliessen])

  // Vollbild, wenn das Geraet es erlaubt (iPad ja, iPhone nein); Seite dahinter festhalten
  useEffect(() => {
    document.body.classList.add('praesi-offen')
    const wurzel = document.documentElement
    if (wurzel.requestFullscreen && !document.fullscreenElement) {
      wurzel.requestFullscreen().catch(() => undefined)
    }
    return () => {
      document.body.classList.remove('praesi-offen')
      if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => undefined)
    }
  }, [])

  /** Klick auf die Flaeche blaettert; Bedienelemente und der Schieberegler nicht */
  const onKlick = (e: React.MouseEvent<HTMLDivElement>) => {
    const ziel = e.target as HTMLElement
    if (ziel.closest('.vergleich, button, a, .praesi-fuss')) return
    weiter()
  }

  const folie = folien[index]

  return (
    <div className="praesi" role="dialog" aria-label="Präsentation" onClick={onKlick}>
      <div className="praesi-band" aria-hidden="true" />
      <img className="praesi-logo" src={logo} alt="ISOTEC" />

      {/* key = index: jede Folie kommt frisch herein und spielt ihre Einblendung */}
      <section key={index} className={`praesi-folie art-${folie.art}`}>
        {folie.art === 'titel' && (
          <div className="praesi-titelblatt">
            {folie.bildUrl && <img className="praesi-titelbild" src={folie.bildUrl} alt="" />}
            <div className="praesi-titeltext">
              <Anim i={0}>
                <p className="praesi-marke">{folie.untertitel}</p>
              </Anim>
              <Anim i={1}>
                <h1>{folie.titel}</h1>
              </Anim>
              <Anim i={2}>
                <ul className="praesi-zeilen">
                  {folie.zeilen.map((z, i) => (
                    <li key={i}>{z}</li>
                  ))}
                </ul>
              </Anim>
            </div>
          </div>
        )}

        {folie.art === 'isotec' && (
          <>
            <Anim i={0}>
              <p className="praesi-marke">ISOTEC</p>
              <h2>Warum ISOTEC</h2>
            </Anim>
            <Anim i={1}>
              <p className="praesi-einleitung">{KAPITEL_EINLEITUNG}</p>
            </Anim>
            <div className="praesi-kacheln">
              {USPS.map((u, i) => (
                <Anim key={u.titel} i={2 + i} className="praesi-kachel">
                  <span className={`praesi-zeichen${u.zahl ? ' zahl' : ''}`}>{u.zahl ?? '•'}</span>
                  <div>
                    <h3>{u.titel}</h3>
                    <p>{u.text}</p>
                  </div>
                </Anim>
              ))}
            </div>
          </>
        )}

        {folie.art === 'text' && (
          <>
            <Anim i={0}>
              <p className="praesi-marke">{folie.marke}</p>
              <h2>{folie.titel}</h2>
            </Anim>
            <div className={`praesi-textflaeche${folie.bilder && folie.bilder.length > 0 ? ' mit-bildern' : ''}`}>
              <Anim i={1}>
                <div className="praesi-reichtext" dangerouslySetInnerHTML={{ __html: folie.html }} />
                {folie.chips && folie.chips.length > 0 && (
                  <ul className="praesi-chips">
                    {folie.chips.map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                )}
              </Anim>
              {folie.bilder && folie.bilder.length > 0 && (
                <div className="praesi-bilder">
                  {folie.bilder.map((b, i) => (
                    <Anim key={b} i={2 + i}>
                      <img src={b} alt="" />
                    </Anim>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {folie.art === 'gegenueber' && (
          <>
            <Anim i={0}>
              <p className="praesi-marke">SANIERUNG</p>
              <h2>Ist und Soll</h2>
            </Anim>
            <div className="praesi-spalten">
              <Anim i={1} className="praesi-spalte ist">
                <h3>Ist-Situation</h3>
                <div className="praesi-reichtext" dangerouslySetInnerHTML={{ __html: folie.istHtml }} />
              </Anim>
              <Anim i={2} className="praesi-spalte soll">
                <h3>Soll-Situation</h3>
                <div className="praesi-reichtext" dangerouslySetInnerHTML={{ __html: folie.sollHtml }} />
              </Anim>
            </div>
          </>
        )}

        {folie.art === 'bild' && (
          <>
            <Anim i={0}>
              <p className="praesi-marke">{folie.marke}</p>
              <h2>{folie.titel}</h2>
            </Anim>
            <Anim i={1} className="praesi-bildflaeche">
              <img src={folie.url} alt={folie.titel} />
            </Anim>
          </>
        )}

        {folie.art === 'vergleich' && (
          <>
            <Anim i={0}>
              <p className="praesi-marke">SANIERUNGSVORSCHAU</p>
              <h2>{folie.name}</h2>
            </Anim>
            <Anim i={1} className="praesi-vergleich">
              <Vergleich vorherUrl={folie.vorherUrl} nachherUrl={folie.nachherUrl} zuruecksetzenBei={folie.name} />
            </Anim>
          </>
        )}

        {folie.art === 'schluss' && (
          <div className="praesi-schluss">
            <Anim i={0}>
              <h2>Vielen Dank</h2>
            </Anim>
            <Anim i={1}>
              <p className="praesi-kontakt">
                {folie.name}
                {folie.rolle && <span> · {folie.rolle}</span>}
              </p>
            </Anim>
            <Anim i={2}>
              <p className="praesi-firma">{KAPITEL_SCHLUSS}</p>
            </Anim>
          </div>
        )}
      </section>

      <div className="praesi-fuss">
        <button type="button" className="praesi-knopf" onClick={zurueck} disabled={index === 0} aria-label="Zurück">
          ‹
        </button>
        <div className="praesi-punkte" aria-hidden="true">
          {folien.map((_, i) => (
            <span key={i} className={i === index ? 'aktiv' : i < index ? 'vorbei' : ''} />
          ))}
        </div>
        <span className="praesi-zaehler">
          {index + 1} / {folien.length}
        </span>
        <button type="button" className="praesi-knopf" onClick={weiter} disabled={index === letzte} aria-label="Weiter">
          ›
        </button>
        <button type="button" className="praesi-knopf praesi-schliessen" onClick={onSchliessen} aria-label="Präsentation beenden">
          ✕
        </button>
      </div>
    </div>
  )
}
