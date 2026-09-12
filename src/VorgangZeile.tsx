import { formatDateTime } from './lib/format'
import type { SpeicherStatus } from './vorgang'

/**
 * Speicherstand des Vorgangs, als eine Zeile im Kopf der Karte "Termin":
 * "gespeichert 20:50", daneben "Projekt löschen". Ein neues Projekt wird seit
 * dem 12.09.2026 auf der Seite Projekte angelegt, nicht mehr hier.
 *
 * Bis zum Abend des 11.09.2026 war das eine eigene Karte mit Liste aller
 * Vorgaenge. Yann: "das soll subtiler sein, wenn ich einen Kunden aufrufen
 * moechte, suche ich einfach in der Namenszeile, die Listenuebersicht braucht
 * es nicht." Gespeicherte Vorgaenge erscheinen deshalb in der Kundensuche.
 */

export interface VorgangZeileProps {
  status: SpeicherStatus
  gespeichertUm: number | null
  /** Ob der Vorgang etwas enthaelt, das man loeschen koennte */
  hatInhalt: boolean
  kundenname: string
  onLoeschen: () => void
}

function statusText(status: SpeicherStatus, um: number | null): string {
  switch (status) {
    case 'aus':
      return 'Speichern in diesem Browser nicht möglich'
    case 'laedt':
      return 'wird geladen …'
    case 'schreibt':
      return 'wird gespeichert …'
    case 'fehler':
      return 'Speichern fehlgeschlagen'
    case 'bereit':
      return um ? `gespeichert ${formatDateTime(um)}` : 'wird beim ersten Eintrag gespeichert'
  }
}

export default function VorgangZeile({ status, gespeichertUm, hatInhalt, kundenname, onLoeschen }: VorgangZeileProps) {
  const loeschenMitRueckfrage = () => {
    const name = kundenname.trim() || 'ohne Namen'
    if (window.confirm(`Projekt „${name}" mit allen Fotos und Dokumenten von diesem Gerät löschen?`)) onLoeschen()
  }
  return (
    <div className="vorgang-zeile">
      <span className={`vorgang-status status-${status}`}>{statusText(status, gespeichertUm)}</span>
      {hatInhalt && (
        <button type="button" className="link-knopf" onClick={loeschenMitRueckfrage}>
          Projekt löschen
        </button>
      )}
    </div>
  )
}
