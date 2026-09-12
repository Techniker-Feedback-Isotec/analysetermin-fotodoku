import { useCallback, useEffect, useRef, useState } from 'react'
import logo from './assets/isotec-logo.png'
import Vergleich from './vorschau/Vergleich'
import { KAPITEL_EINLEITUNG, KAPITEL_SCHLUSS, USPS, type UspSymbol } from './mappe/inhalt'
import './praesentation.css'

/**
 * Praesentationsmodus (12.09.2026): Folien im Vollbild, Klick oder Pfeiltaste
 * blaettert, wie in PowerPoint oder Canva. Gedacht fuer die
 * Auftragsbesprechung beim Kunden: erst ISOTEC, dann Ist und Soll mit
 * Gegenueberstellung und Ziel, die Sanierungsbereiche aus der Skizze und
 * zuletzt die Vorher/Nachher-Bilder mit dem Schieberegler. Zwischen den
 * Kapiteln stehen Kapitelblaetter als Ueberleitung (Yann: "so gestaltet, dass
 * man sich freut, die folgenden Seiten anzuschauen").
 *
 * Gestaltung nach dem Corporate Design: weisse Flaeche, rotes Band, braune
 * Schrift. Die Kapitelblaetter waren in der ersten Fassung rot mit
 * durchscheinendem Bild; Yann (12.09.2026): "das transparente rote Design
 * gefaellt mir nicht, bleib bei dem schlichten weiss-roten Stil". Jetzt
 * weiss mit grosser roter Nummer und Bild rechts. Bewegungen in
 * praesentation.css.
 */

export type Folie =
  | { art: 'titel'; titel: string; untertitel: string; zeilen: string[]; bildUrl: string | null }
  | { art: 'isotec' }
  | { art: 'kapitel'; nummer: number; titel: string; unterzeile: string; bildUrl: string | null }
  | { art: 'text'; marke: string; titel: string; html: string; bilder?: string[]; chips?: string[]; symbol?: 'ist' | 'soll' | 'ziel' }
  | { art: 'gegenueber'; istHtml: string; sollHtml: string; zielHtml: string | null }
  | { art: 'skizze'; marke: string; titel: string; hauptUrl: string; legendeUrl: string | null; foto: boolean }
  | {
      art: 'gewerk'
      titel: string
      untertitel: string
      /** Systemgrafik oder Skizze aus den Zentrale-Folien, oder null */
      bildUrl: string | null
      vorteile: string[]
      schadenUrl: string | null
      schadenText: string
    }
  | { art: 'schritte'; titel: string; bilder: string[]; beschriftungen: string[] | null; skizzeUrl: string | null }
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

const strich = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

/** Die Symbole der ISOTEC-Kacheln, wie in der Mappe gezeichnet (mappe/seiten.ts), hier als SVG */
function Symbol({ art }: { art: UspSymbol }) {
  switch (art) {
    case 'haken':
      return (
        <svg viewBox="0 0 24 24" {...strich}>
          <circle cx="12" cy="12" r="10" />
          <path d="m7 12.5 3.2 3.2L17 9" />
        </svg>
      )
    case 'lupe':
      return (
        <svg viewBox="0 0 24 24" {...strich}>
          <circle cx="10.5" cy="10.5" r="6.5" />
          <path d="m15.5 15.5 5 5" />
        </svg>
      )
    case 'person':
      return (
        <svg viewBox="0 0 24 24" {...strich}>
          <circle cx="12" cy="8" r="4" />
          <path d="M4.5 20.5c.8-4.2 3.9-6.5 7.5-6.5s6.7 2.3 7.5 6.5" />
        </svg>
      )
    case 'klemmbrett':
      return (
        <svg viewBox="0 0 24 24" {...strich}>
          <rect x="5" y="4.5" width="14" height="16.5" rx="2" />
          <path d="M9 4.5V3h6v1.5" />
          <path d="m8.5 13 2.5 2.5 4.5-5" />
        </svg>
      )
  }
}

/** Kurzer Vorspann der Kapitelnummer: 01, 02, ... */
const nr = (n: number) => String(n).padStart(2, '0')

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

  /**
   * Wischen auf dem iPad: nach links blaettert vor, nach rechts zurueck. Ohne
   * Tastatur gaebe es sonst nur die kleinen Knoepfe in der Fussleiste, um
   * zurueckzukommen. Der Schieberegler des Vorher/Nachher-Vergleichs bleibt
   * ausgenommen, dort bedeutet Ziehen etwas anderes.
   */
  const wisch = useRef<{ x: number; y: number; id: number } | null>(null)
  const gewischt = useRef(false)
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse') return
    if ((e.target as HTMLElement).closest('.vergleich, button, a, .praesi-fuss')) return
    wisch.current = { x: e.clientX, y: e.clientY, id: e.pointerId }
  }
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const start = wisch.current
    if (!start || start.id !== e.pointerId) return
    wisch.current = null
    const dx = e.clientX - start.x
    const dy = e.clientY - start.y
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return
    gewischt.current = true
    if (dx < 0) weiter()
    else zurueck()
  }

  /** Klick auf die Flaeche blaettert; Bedienelemente und der Schieberegler nicht */
  const onKlick = (e: React.MouseEvent<HTMLDivElement>) => {
    // Nach einem Wisch kommt noch ein Klick hinterher, der nicht auch blaettern darf
    if (gewischt.current) {
      gewischt.current = false
      return
    }
    const ziel = e.target as HTMLElement
    if (ziel.closest('.vergleich, button, a, .praesi-fuss')) return
    weiter()
  }

  const folie = folien[index]

  return (
    <div
      className="praesi"
      role="dialog"
      aria-label="Präsentation"
      onClick={onKlick}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        wisch.current = null
      }}
    >
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
                  <span className={`praesi-zeichen${u.zahl ? ' zahl' : ''}`}>
                    {u.zahl ?? (u.symbol ? <Symbol art={u.symbol} /> : null)}
                  </span>
                  <div>
                    <h3>{u.titel}</h3>
                    <p>{u.text}</p>
                  </div>
                </Anim>
              ))}
            </div>
          </>
        )}

        {folie.art === 'kapitel' && (
          <div className={`praesi-kapitel${folie.bildUrl ? '' : ' ohne-bild'}`}>
            <div className="praesi-kapiteltext">
              <Anim i={0}>
                <p className="praesi-kapitelnummer">{nr(folie.nummer)}</p>
              </Anim>
              <Anim i={1}>
                <h1>{folie.titel}</h1>
              </Anim>
              <Anim i={2}>
                <p className="praesi-kapitelzeile">{folie.unterzeile}</p>
              </Anim>
              <Anim i={3}>
                <span className="praesi-weiter">Weiter ›</span>
              </Anim>
            </div>
            {folie.bildUrl && <img className="praesi-kapitelbild" src={folie.bildUrl} alt="" />}
          </div>
        )}

        {folie.art === 'text' && (
          <>
            <Anim i={0}>
              <p className="praesi-marke">{folie.marke}</p>
              <h2>{folie.titel}</h2>
            </Anim>
            <div className={`praesi-textflaeche${folie.bilder && folie.bilder.length > 0 ? ' mit-bildern' : ''}`}>
              <Anim i={1}>
                <div
                  className={`praesi-reichtext gestaffelt${folie.symbol ? ` mit-symbol ${folie.symbol}` : ''}`}
                  dangerouslySetInnerHTML={{ __html: folie.html }}
                />
                {folie.chips && folie.chips.length > 0 && (
                  <ul className="praesi-chips">
                    {folie.chips.map((c, i) => (
                      <li key={c} style={{ '--i': 4 + i } as React.CSSProperties}>
                        {c}
                      </li>
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
              <h2>Von heute zu morgen</h2>
            </Anim>
            <div className="praesi-gegenueber">
              <Anim i={1} className="praesi-spalte ist">
                <span className="praesi-spaltenmarke">Ist</span>
                <h3>Heute</h3>
                <div className="praesi-reichtext gestaffelt mit-symbol ist" dangerouslySetInnerHTML={{ __html: folie.istHtml }} />
              </Anim>
              <Anim i={2} className="praesi-pfeil">
                <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <path className="praesi-pfeil-linie" d="M6 24h34" />
                  <path className="praesi-pfeil-spitze" d="m30 14 10 10-10 10" />
                </svg>
              </Anim>
              <Anim i={3} className="praesi-spalte soll">
                <span className="praesi-spaltenmarke">Soll</span>
                <h3>Nach der Sanierung</h3>
                <div className="praesi-reichtext gestaffelt mit-symbol soll" dangerouslySetInnerHTML={{ __html: folie.sollHtml }} />
              </Anim>
            </div>
            {folie.zielHtml && (
              <Anim i={5} className="praesi-ziel">
                <span className="praesi-spaltenmarke">Ziel</span>
                <div className="praesi-reichtext mit-symbol ziel" dangerouslySetInnerHTML={{ __html: folie.zielHtml }} />
              </Anim>
            )}
          </>
        )}

        {folie.art === 'skizze' && (
          <>
            <Anim i={0}>
              <p className="praesi-marke">{folie.marke}</p>
              <h2>{folie.titel}</h2>
            </Anim>
            <div className={`praesi-skizze${folie.legendeUrl ? ' mit-legende' : ''}${folie.foto ? ' foto' : ''}`}>
              <Anim i={1} className="praesi-skizze-haupt">
                <img src={folie.hauptUrl} alt={folie.titel} />
              </Anim>
              {folie.legendeUrl && (
                <Anim i={2} className="praesi-skizze-legende">
                  <img src={folie.legendeUrl} alt="Legende" />
                </Anim>
              )}
            </div>
          </>
        )}

        {folie.art === 'gewerk' && (
          <>
            <Anim i={0}>
              <p className="praesi-marke">ISOTEC-SYSTEMLÖSUNG</p>
              <h2>{folie.titel}</h2>
              <p className="praesi-untertitel">{folie.untertitel}</p>
            </Anim>
            <div className={`praesi-gewerk${folie.bildUrl ? '' : ' ohne-bild'}`}>
              {folie.bildUrl && (
                <Anim i={1} className="praesi-gewerk-bild">
                  <img src={folie.bildUrl} alt={folie.titel} />
                </Anim>
              )}
              <div className="praesi-gewerk-text">
                <Anim i={2}>
                  <h3>Ihre Vorteile</h3>
                </Anim>
                <ul className="praesi-vorteile">
                  {folie.vorteile.map((v, i) => (
                    <li key={v} style={{ '--i': 3 + i } as React.CSSProperties}>
                      <svg viewBox="0 0 24 24" {...strich} aria-hidden="true">
                        <circle cx="12" cy="12" r="10" />
                        <path d="m7 12.5 3.2 3.2L17 9" />
                      </svg>
                      <span>{v}</span>
                    </li>
                  ))}
                </ul>
                {folie.schadenUrl && (
                  <Anim i={4 + folie.vorteile.length} className="praesi-schaden">
                    <img src={folie.schadenUrl} alt="" />
                    <span>{folie.schadenText}</span>
                  </Anim>
                )}
              </div>
            </div>
          </>
        )}

        {folie.art === 'schritte' && (
          <>
            <Anim i={0}>
              <p className="praesi-marke">AUSFÜHRUNG</p>
              <h2>{folie.titel}</h2>
            </Anim>
            <div className={`praesi-schritte${folie.skizzeUrl ? ' mit-skizze' : ''}`}>
              {folie.skizzeUrl && (
                <Anim i={1} className="praesi-schritte-skizze">
                  <img src={folie.skizzeUrl} alt="" />
                </Anim>
              )}
              <div className="praesi-schritte-raster">
                {folie.bilder.map((b, i) => (
                  <Anim key={b} i={2 + i} className="praesi-schritt">
                    <img src={b} alt="" />
                    <span className="praesi-schritt-nr">{i + 1}</span>
                    {folie.beschriftungen && <span className="praesi-schritt-text">{folie.beschriftungen[i]}</span>}
                  </Anim>
                ))}
              </div>
            </div>
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
          {folien.map((f, i) => (
            <span key={i} className={`${i === index ? 'aktiv' : i < index ? 'vorbei' : ''}${f.art === 'kapitel' ? ' kapitel' : ''}`} />
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
