import { useEffect, useId, useRef, useState } from 'react'
import { ApiFehler, ladeKundenliste, type KundenEintrag, type Kundenliste } from './lib/api'
import { formatDateShort } from './lib/format'
import type { VorgangSatz } from './lib/speicher'

/**
 * Das Feld "Kunde" ist zugleich die Suche in MeisterTask: Getippt wird frei,
 * darunter klappt die Liste der passenden Vorgaenge auf – nur die aus dem
 * Ersttermine-Board des gewaehlten Mitarbeiters, nur Phase 0,
 * Auftragsbesprechungen und Angebote, je Vorgang "Name, Ort". Eine Auswahl fuellt die
 * uebrigen Felder (Anschriften, Baujahr) aus der Aufgabe.
 *
 * Die Liste wird je Mitarbeiter einmal geladen und dann im Browser gefiltert:
 * so kostet das Tippen keinen einzigen Abruf des geteilten Kontingents.
 *
 * Seit dem 11.09.2026 stehen oben in der Liste die im Geraet gespeicherten
 * Vorgaenge, die zur Eingabe passen (Yann: "wenn ich einen Kunden aufrufen
 * moechte, suche ich einfach in der Namenszeile"). Eine Auswahl dort oeffnet
 * den Vorgang mit allem, was dazu gespeichert ist.
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
  /** Im Geraet gespeicherte Vorgaenge (ohne den offenen), neueste zuerst */
  gespeicherte: VorgangSatz[]
  onGespeichert: (id: string) => void
  /** Wenn gesetzt: letzte Zeile der Liste legt den getippten Namen als neues Projekt an */
  neuAnlegen?: (name: string) => void
  placeholder?: string
}

/** Hoechstens so viele gespeicherte Vorgaenge oben in der Liste */
const HOECHSTENS_GESPEICHERT = 6

/** Ort aus der Kundenadresse: der Teil nach dem letzten Komma */
function ortAus(adresse: string): string {
  const teile = adresse.split(',').map((t) => t.trim()).filter(Boolean)
  return teile.length > 1 ? teile[teile.length - 1] : ''
}

function passtGespeichert(v: VorgangSatz, suche: string): boolean {
  const woerter = suche.toLowerCase().split(/\s+/).filter(Boolean)
  if (woerter.length === 0) return true
  const text = `${v.kunde.kunde} ${v.kunde.kundenadresse} ${v.kunde.objektadresse}`.toLowerCase()
  return woerter.every((w) => text.includes(w))
}

/** Ohne Kundennamen laesst sich ein Vorgang in der Namenszeile nicht finden */
function vorgangIstOhneNamen(v: VorgangSatz): boolean {
  return v.kunde.kunde.trim() === ''
}

/** Ein Eintrag der aufgeklappten Liste: gespeicherter Vorgang oder MeisterTask-Treffer */
type Zeile =
  | { art: 'gespeichert'; vorgang: VorgangSatz }
  | { art: 'meistertask'; eintrag: KundenEintrag }
  | { art: 'neu'; name: string }

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
  gespeicherte,
  onGespeichert,
  neuAnlegen,
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
  const gespeicherteTreffer = gespeicherte
    .filter((v) => !vorgangIstOhneNamen(v) && passtGespeichert(v, wert))
    .slice(0, HOECHSTENS_GESPEICHERT)
  const zeilen: Zeile[] = [
    ...gespeicherteTreffer.map((vorgang): Zeile => ({ art: 'gespeichert', vorgang })),
    ...treffer.map((eintrag): Zeile => ({ art: 'meistertask', eintrag })),
    ...(neuAnlegen && wert.trim() !== '' ? [{ art: 'neu', name: wert.trim() } as Zeile] : []),
  ]
  const meistertaskBereit = liste !== null && liste.board !== null
  const zeigeListe = offen && (meistertaskBereit || zeilen.length > 0)

  function waehle(zeile: Zeile) {
    setOffen(false)
    if (zeile.art === 'gespeichert') onGespeichert(zeile.vorgang.id)
    else if (zeile.art === 'meistertask') onAuswahl(zeile.eintrag)
    else neuAnlegen?.(zeile.name)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!zeigeListe || zeilen.length === 0) {
      if (e.key === 'ArrowDown') setOffen(true)
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setAktiv((i) => Math.min(i + 1, zeilen.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setAktiv((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      waehle(zeilen[Math.min(aktiv, zeilen.length - 1)])
    } else if (e.key === 'Escape') {
      setOffen(false)
    }
  }

  /**
   * Die Zeile unter dem Feld: nur noch Laden und Fehler. Die Erklaerungen
   * (welches Board, wie viele Vorgaenge) sind seit dem 11.09.2026 weg, Yann:
   * "es muss selbsterklaerend nutzbar sein".
   */
  let hinweis: string
  if (verfuegbar === false) hinweis = 'Kundensuche nicht eingerichtet (kein MeisterTask-Zugang auf dem Server).'
  else if (laedt) hinweis = 'MeisterTask wird gelesen …'
  else if (fehler) hinweis = fehler
  else if (liste && !liste.board && liste.grund) hinweis = liste.grund
  else hinweis = ''

  return (
    <div className="kundensuche" ref={huelle}>
      <div className="kundensuche-feld">
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
          {zeilen.length === 0 ? (
            <li className="kundensuche-leer">
              {liste && liste.eintraege.length === 0
                ? liste.art === 'reklamation'
                  ? 'Keine offenen Vorgänge im Reklamationsboard.'
                  : 'Keine offenen Vorgänge in Phase 0, Auftragsbesprechungen oder Angebote.'
                : 'Kein Vorgang passt zur Eingabe.'}
            </li>
          ) : (
            zeilen.map((zeile, i) => {
              const schluessel =
                zeile.art === 'gespeichert' ? `g-${zeile.vorgang.id}` : zeile.art === 'meistertask' ? `m-${zeile.eintrag.id}` : 'neu'
              const klassen = ['kundensuche-eintrag']
              if (i === aktiv) klassen.push('aktiv')
              if (zeile.art === 'gespeichert') klassen.push('gespeichert')
              if (zeile.art === 'neu') klassen.push('neu')
              return (
                <li
                  key={schluessel}
                  role="option"
                  aria-selected={i === aktiv}
                  className={klassen.join(' ')}
                  onMouseEnter={() => setAktiv(i)}
                  // pointerdown statt click: der Klick wuerde erst das Feld verlassen
                  // (blur) und die Liste schliessen, bevor er ankommt
                  onPointerDown={(ev) => {
                    ev.preventDefault()
                    waehle(zeile)
                  }}
                >
                  {zeile.art === 'gespeichert' ? (
                    <>
                      <span className="kundensuche-name">
                        {zeile.vorgang.kunde.kunde.trim()}
                        {ortAus(zeile.vorgang.kunde.kundenadresse) && `, ${ortAus(zeile.vorgang.kunde.kundenadresse)}`}
                      </span>
                      <span className="kundensuche-spalte">
                        auf diesem Gerät · {formatDateShort(zeile.vorgang.geaendert)} · {zeile.vorgang.anzahlFotos} Foto
                        {zeile.vorgang.anzahlFotos === 1 ? '' : 's'}
                      </span>
                    </>
                  ) : zeile.art === 'meistertask' ? (
                    <>
                      <span className="kundensuche-name">{zeile.eintrag.anzeige}</span>
                      <span className="kundensuche-spalte">{zeile.eintrag.spalte}</span>
                    </>
                  ) : (
                    <>
                      <span className="kundensuche-name">„{zeile.name}"</span>
                      <span className="kundensuche-spalte">als neues Projekt anlegen</span>
                    </>
                  )}
                </li>
              )
            })
          )}
        </ul>
      )}
      </div>
      {hinweis && <p className="eingabe-hinweis" title={hinweis}>{hinweis}</p>}
    </div>
  )
}
