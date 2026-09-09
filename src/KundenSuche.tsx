import { useEffect, useId, useRef, useState } from 'react'
import { ApiFehler, ladeKundenliste, type KundenEintrag, type Kundenliste } from './lib/api'

/**
 * Das Feld "Kunde" ist zugleich die Suche in MeisterTask: Getippt wird frei,
 * darunter klappt die Liste der passenden Vorgaenge auf – nur die aus dem
 * Ersttermine-Board des gewaehlten Mitarbeiters, nur Phase 0,
 * Auftragsbesprechungen und Angebote, je Vorgang "Name, Ort". Eine Auswahl fuellt die
 * uebrigen Felder (Anschriften, Baujahr) aus der Aufgabe.
 *
 * Die Liste wird je Mitarbeiter einmal geladen und dann im Browser gefiltert:
 * so kostet das Tippen keinen einzigen Abruf des geteilten Kontingents.
 */

export interface KundenSucheProps {
  id: string
  wert: string
  onText: (text: string) => void
  /** Anzeigename des gewaehlten Mitarbeiters; leer = keine Suche moeglich */
  mitarbeiter: string
  /** Ob der Server ueberhaupt ein MeisterTask-Token hat; null = noch unbekannt */
  verfuegbar: boolean | null
  onAuswahl: (eintrag: KundenEintrag) => void
  placeholder?: string
}

const HOECHSTENS = 40

/** Alle Suchwoerter muessen vorkommen, Reihenfolge egal, Gross-/Kleinschreibung egal. */
function passt(eintrag: KundenEintrag, suche: string): boolean {
  const woerter = suche.toLowerCase().split(/\s+/).filter(Boolean)
  if (woerter.length === 0) return true
  const text = `${eintrag.anzeige} ${eintrag.titel}`.toLowerCase()
  return woerter.every((w) => text.includes(w))
}

export default function KundenSuche({
  id,
  wert,
  onText,
  mitarbeiter,
  verfuegbar,
  onAuswahl,
  placeholder,
}: KundenSucheProps) {
  const [liste, setListe] = useState<Kundenliste | null>(null)
  const [laedt, setLaedt] = useState(false)
  const [fehler, setFehler] = useState('')
  const [offen, setOffen] = useState(false)
  const [aktiv, setAktiv] = useState(0)
  const huelle = useRef<HTMLDivElement>(null)
  const listId = useId()

  // Je Mitarbeiter einmal laden. Ein Wechsel des Mitarbeiters wechselt das Board.
  useEffect(() => {
    setListe(null)
    setFehler('')
    if (!mitarbeiter || verfuegbar === false) return
    let abgebrochen = false
    setLaedt(true)
    ladeKundenliste(mitarbeiter)
      .then((l) => {
        if (!abgebrochen) setListe(l)
      })
      .catch((err: unknown) => {
        if (!abgebrochen) setFehler(err instanceof ApiFehler ? err.message : 'Die Suche ist gerade nicht erreichbar.')
      })
      .finally(() => {
        if (!abgebrochen) setLaedt(false)
      })
    return () => {
      abgebrochen = true
    }
  }, [mitarbeiter, verfuegbar])

  // Klick daneben und Escape schliessen die Liste.
  useEffect(() => {
    if (!offen) return
    const onPointerDown = (event: PointerEvent) => {
      if (!huelle.current?.contains(event.target as Node)) setOffen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [offen])

  const treffer = liste ? liste.eintraege.filter((e) => passt(e, wert)).slice(0, HOECHSTENS) : []
  const zeigeListe = offen && liste !== null && liste.board !== null

  function waehle(eintrag: KundenEintrag) {
    setOffen(false)
    onAuswahl(eintrag)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!zeigeListe || treffer.length === 0) {
      if (e.key === 'ArrowDown') setOffen(true)
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setAktiv((i) => Math.min(i + 1, treffer.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setAktiv((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      waehle(treffer[Math.min(aktiv, treffer.length - 1)])
    } else if (e.key === 'Escape') {
      setOffen(false)
    }
  }

  /** Die Zeile unter dem Feld: woher die Liste kommt, oder warum es keine gibt. */
  let hinweis: string
  if (verfuegbar === false) hinweis = 'Kundensuche nicht eingerichtet (kein MeisterTask-Zugang auf dem Server).'
  else if (!mitarbeiter) hinweis = 'Mitarbeiter wählen, dann sucht das Feld in seinem MeisterTask-Board.'
  else if (laedt) hinweis = 'MeisterTask wird gelesen …'
  else if (fehler) hinweis = fehler
  else if (liste?.board) {
    // Die technische Leitung sucht im Reklamationsboard, dort zaehlen alle
    // offenen Vorgaenge statt drei Spalten des Vertriebsablaufs.
    hinweis =
      liste.art === 'reklamation'
        ? `${liste.eintraege.length} offene Vorgänge (${liste.board})`
        : `${liste.eintraege.length} Vorgänge in Phase 0, Auftragsbesprechungen und Angebote (${liste.board})`
  } else if (liste?.grund) hinweis = liste.grund
  else hinweis = ''

  return (
    <div className="kundensuche" ref={huelle}>
      <input
        id={id}
        type="text"
        role="combobox"
        aria-expanded={zeigeListe}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        value={wert}
        onChange={(e) => {
          onText(e.target.value)
          setAktiv(0)
          setOffen(true)
        }}
        onFocus={() => setOffen(true)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
      />
      {zeigeListe && (
        <ul className="kundensuche-liste" id={listId} role="listbox">
          {treffer.length === 0 ? (
            <li className="kundensuche-leer">
              {liste.eintraege.length === 0
                ? liste.art === 'reklamation'
                  ? 'Keine offenen Vorgänge im Reklamationsboard.'
                  : 'Keine offenen Vorgänge in Phase 0, Auftragsbesprechungen oder Angebote.'
                : 'Kein Vorgang passt zur Eingabe.'}
            </li>
          ) : (
            treffer.map((e, i) => (
              <li
                key={e.id}
                role="option"
                aria-selected={i === aktiv}
                className={`kundensuche-eintrag${i === aktiv ? ' aktiv' : ''}`}
                onMouseEnter={() => setAktiv(i)}
                // pointerdown statt click: der Klick wuerde erst das Feld verlassen
                // (blur) und die Liste schliessen, bevor er ankommt
                onPointerDown={(ev) => {
                  ev.preventDefault()
                  waehle(e)
                }}
              >
                <span className="kundensuche-name">{e.anzeige}</span>
                <span className="kundensuche-spalte">{e.spalte}</span>
              </li>
            ))
          )}
        </ul>
      )}
      {hinweis && <p className="eingabe-hinweis" title={hinweis}>{hinweis}</p>}
    </div>
  )
}
