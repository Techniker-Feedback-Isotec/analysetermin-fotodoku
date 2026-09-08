import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import {
  reichtextAusHtml,
  reichtextZuHtml,
  type Reichtext,
  type TextStueck,
} from './lib/richtext'

/**
 * Textfenster zum Schreiben von Zusammenfassung und Beurteilung.
 *
 * Geschrieben wird in einem bearbeitbaren Bereich des Browsers; die Knoepfe
 * benutzen die eingebauten Formatierbefehle (document.execCommand). Die sind
 * zwar als veraltet gekennzeichnet, aber der einzige Weg ohne zusaetzliche
 * Programmbibliothek, und sie funktionieren in allen Browsern, die das Tool
 * bedienen muss - auch in Safari auf dem iPhone.
 *
 * Beim Uebernehmen wird der Inhalt durch das Modell in richtext.ts gefiltert:
 * Es bleiben Absaetze, Aufzaehlungen, fett, kursiv und unterstrichen. Genau
 * das kann die PDF zeichnen, deshalb sieht sie danach aus wie dieses Fenster.
 */

export interface TextfensterProps {
  titel: string
  hinweis: string
  wert: Reichtext
  onSpeichern: (wert: Reichtext) => void
  onAbbrechen: () => void
}

interface Werkzeug {
  befehl: string
  beschriftung: string
  titel: string
  klasse?: string
}

const WERKZEUGE: Werkzeug[] = [
  { befehl: 'bold', beschriftung: 'F', titel: 'Fett (Strg+B)', klasse: 'werkzeug-fett' },
  { befehl: 'italic', beschriftung: 'K', titel: 'Kursiv (Strg+I)', klasse: 'werkzeug-kursiv' },
  { befehl: 'underline', beschriftung: 'U', titel: 'Unterstrichen (Strg+U)', klasse: 'werkzeug-unter' },
  { befehl: 'insertUnorderedList', beschriftung: '• Liste', titel: 'Aufzählung' },
]

export default function Textfenster({ titel, hinweis, wert, onSpeichern, onAbbrechen }: TextfensterProps) {
  const flaeche = useRef<HTMLDivElement>(null)
  const [aktiv, setAktiv] = useState<Record<string, boolean>>({})

  // Der Inhalt wird nur beim Oeffnen gesetzt: Waehrend des Schreibens darf
  // React den Bereich nicht neu befuellen, sonst springt der Schreibzeiger.
  useEffect(() => {
    const el = flaeche.current
    if (!el) return
    el.innerHTML = reichtextZuHtml(wert)
    el.focus()
    // Schreibmarke ans Ende setzen
    const bereich = document.createRange()
    bereich.selectNodeContents(el)
    bereich.collapse(false)
    const auswahl = window.getSelection()
    auswahl?.removeAllRanges()
    auswahl?.addRange(bereich)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const pruefeZustand = useCallback(() => {
    const el = flaeche.current
    if (!el || !el.contains(window.getSelection()?.anchorNode ?? null)) return
    const stand: Record<string, boolean> = {}
    for (const w of WERKZEUGE) {
      try {
        stand[w.befehl] = document.queryCommandState(w.befehl)
      } catch {
        stand[w.befehl] = false
      }
    }
    setAktiv(stand)
  }, [])

  useEffect(() => {
    document.addEventListener('selectionchange', pruefeZustand)
    return () => document.removeEventListener('selectionchange', pruefeZustand)
  }, [pruefeZustand])

  const uebernehmen = useCallback(() => {
    onSpeichern(reichtextAusHtml(flaeche.current?.innerHTML ?? ''))
  }, [onSpeichern])

  function fuehreAus(befehl: string) {
    flaeche.current?.focus()
    document.execCommand(befehl)
    pruefeZustand()
  }

  /**
   * Eingefuegter Text wird sofort auf das erlaubte Mass gebracht. Sonst haette
   * das Fenster die Schriftarten und Farben aus Word oder Outlook, die PDF
   * aber nicht - und der Text saehe dort anders aus als hier.
   */
  function beimEinfuegen(e: React.ClipboardEvent<HTMLDivElement>) {
    e.preventDefault()
    const html = e.clipboardData.getData('text/html')
    const roh = html || schuetzeText(e.clipboardData.getData('text/plain'))
    document.execCommand('insertHTML', false, reichtextZuHtml(reichtextAusHtml(roh)))
  }

  return (
    <div
      className="textfenster-hinter"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onAbbrechen()
      }}
    >
      <div
        className="textfenster"
        role="dialog"
        aria-modal="true"
        aria-label={titel}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            onAbbrechen()
          }
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault()
            uebernehmen()
          }
        }}
      >
        <div className="textfenster-kopf">
          <h3>{titel}</h3>
          <button type="button" className="btn-remove" onClick={onAbbrechen} aria-label="Fenster schließen">
            ✕
          </button>
        </div>

        <div className="textfenster-werkzeuge" role="toolbar" aria-label="Formatierung">
          {WERKZEUGE.map((w) => (
            <button
              key={w.befehl}
              type="button"
              className={`werkzeug${aktiv[w.befehl] ? ' is-active' : ''}${w.klasse ? ' ' + w.klasse : ''}`}
              title={w.titel}
              aria-pressed={aktiv[w.befehl] ?? false}
              // Der Knopf darf die Schreibmarke nicht aus dem Text holen,
              // sonst weiss der Formatierbefehl nicht, worauf er wirken soll.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => fuehreAus(w.befehl)}
            >
              {w.beschriftung}
            </button>
          ))}
          <span className="textfenster-hinweis">{hinweis}</span>
        </div>

        <div
          ref={flaeche}
          className="textfenster-flaeche"
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          aria-label={titel}
          onPaste={beimEinfuegen}
          onKeyUp={pruefeZustand}
          onMouseUp={pruefeZustand}
        />

        <div className="textfenster-fuss">
          <span className="eingabe-hinweis">Strg+B fett · Strg+I kursiv · Strg+Enter übernehmen</span>
          <button type="button" className="btn-secondary" onClick={onAbbrechen}>
            Abbrechen
          </button>
          <button type="button" className="btn-primary" onClick={uebernehmen}>
            Übernehmen
          </button>
        </div>
      </div>
    </div>
  )
}

function schuetzeText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .split(/\n/)
    .map((zeile) => `<div>${zeile === '' ? '<br>' : zeile}</div>`)
    .join('')
}

function stueckeAls(stuecke: TextStueck[]) {
  return stuecke.map((s, i) => {
    let inhalt = <>{s.text}</>
    if (s.unterstrichen) inhalt = <u>{inhalt}</u>
    if (s.kursiv) inhalt = <em>{inhalt}</em>
    if (s.fett) inhalt = <strong>{inhalt}</strong>
    return <Fragment key={i}>{inhalt}</Fragment>
  })
}

/**
 * Zeigt den formatierten Text auf der Seite an - gezeichnet aus demselben
 * Modell, aus dem auch die PDF entsteht.
 */
export function Textvorschau({ reich }: { reich: Reichtext }) {
  const bloecke: React.ReactNode[] = []
  let punkte: React.ReactNode[] = []
  const listeSchliessen = () => {
    if (punkte.length === 0) return
    bloecke.push(<ul key={`l${bloecke.length}`}>{punkte}</ul>)
    punkte = []
  }
  reich.forEach((absatz, i) => {
    if (absatz.art === 'punkt') {
      punkte.push(<li key={i}>{stueckeAls(absatz.stuecke)}</li>)
      return
    }
    listeSchliessen()
    bloecke.push(
      <p key={i}>{absatz.stuecke.length === 0 ? <br /> : stueckeAls(absatz.stuecke)}</p>,
    )
  })
  listeSchliessen()
  return <div className="textvorschau-inhalt">{bloecke}</div>
}
