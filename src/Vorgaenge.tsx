import { useState } from 'react'
import type { Ich } from './lib/api'
import { formatBytes, formatDateTime } from './lib/format'
import { ALT_NACH_TAGEN, alterInTagen, type VorgangSatz } from './lib/speicher'
import type { SpeicherStatus } from './vorgang'

/**
 * Karte "Vorgänge" oben auf der Seite Kunde: Speicherstand, Knopf fuer einen
 * neuen Vorgang und die Liste der gespeicherten Vorgaenge dieses Geraets
 * (Yann, 11.09.2026: jeder Vertriebler soll fortlaufend auf seine Kunden
 * zugreifen koennen).
 *
 * Gezeigt werden nur die eigenen Vorgaenge: die ohne Besitzer (Entwicklung)
 * und die der angemeldeten Person. Teilen sich zwei Leute ein iPad, sieht
 * jeder seine.
 */

export interface VorgaengeProps {
  liste: VorgangSatz[]
  aktivId: string
  status: SpeicherStatus
  gespeichertUm: number | null
  verbrauch: number | null
  ich: Ich | null
  onNeu: () => void
  onOeffnen: (id: string) => void
  onLoeschen: (id: string) => void
}

/** Ort aus der Kundenadresse: der Teil nach dem letzten Komma */
function ortAus(adresse: string): string {
  const teile = adresse.split(',').map((t) => t.trim()).filter(Boolean)
  return teile.length > 1 ? teile[teile.length - 1] : ''
}

function statusText(status: SpeicherStatus, um: number | null): string {
  switch (status) {
    case 'aus':
      return 'Speichern in diesem Browser nicht möglich'
    case 'laedt':
      return 'Vorgang wird geladen …'
    case 'schreibt':
      return 'wird gespeichert …'
    case 'fehler':
      return 'Speichern fehlgeschlagen'
    case 'bereit':
      return um ? `gespeichert ${formatDateTime(um)}` : 'noch nichts zu speichern'
  }
}

export default function Vorgaenge({
  liste,
  aktivId,
  status,
  gespeichertUm,
  verbrauch,
  ich,
  onNeu,
  onOeffnen,
  onLoeschen,
}: VorgaengeProps) {
  const [offen, setOffen] = useState(false)

  const eigene = liste.filter((v) => !v.besitzer || !ich?.email || v.besitzer === ich.email)
  const alte = eigene.filter((v) => alterInTagen(v) >= ALT_NACH_TAGEN)

  const loeschenMitRueckfrage = (v: VorgangSatz) => {
    const name = v.kunde.kunde.trim() || 'ohne Namen'
    const frage = `Vorgang „${name}" mit ${v.anzahlFotos} Foto${v.anzahlFotos === 1 ? '' : 's'} und ${v.anzahlDokumente} Dokument${v.anzahlDokumente === 1 ? '' : 'en'} von diesem Gerät löschen?`
    if (window.confirm(frage)) onLoeschen(v.id)
  }

  return (
    <section className="card vorgaenge" aria-labelledby="vorgaenge-titel">
      <div className="vorgaenge-kopf">
        <div className="vorgaenge-text">
          <h2 id="vorgaenge-titel">Vorgänge</h2>
          <p className={`vorgaenge-status status-${status}`}>{statusText(status, gespeichertUm)}</p>
        </div>
        <div className="vorgaenge-knoepfe">
          {eigene.length > 0 && (
            <button type="button" className="btn-secondary" onClick={() => setOffen((o) => !o)}>
              {offen ? 'Liste schließen' : `Meine Vorgänge (${eigene.length})`}
            </button>
          )}
          <button type="button" className="btn-primary" onClick={onNeu} disabled={status === 'laedt'}>
            Neuer Vorgang
          </button>
        </div>
      </div>

      {offen && eigene.length > 0 && (
        <ul className="vorgangsliste">
          {eigene.map((v) => {
            const name = v.kunde.kunde.trim() || 'Ohne Namen'
            const ort = ortAus(v.kunde.kundenadresse)
            const aktiv = v.id === aktivId
            const alt = alterInTagen(v) >= ALT_NACH_TAGEN
            return (
              <li key={v.id} className={`vorgang${aktiv ? ' aktiv' : ''}${alt ? ' alt' : ''}`}>
                <div className="vorgang-text">
                  <span className="vorgang-name">
                    {name}
                    {ort && <span className="vorgang-ort"> · {ort}</span>}
                    {aktiv && <span className="vorgang-marke">geöffnet</span>}
                    {alt && <span className="vorgang-marke vorgang-marke-alt">älter als {ALT_NACH_TAGEN} Tage</span>}
                  </span>
                  <span className="vorgang-meta">
                    {formatDateTime(v.geaendert)} · {v.anzahlFotos} Foto{v.anzahlFotos === 1 ? '' : 's'} ·{' '}
                    {v.anzahlDokumente} Dokument{v.anzahlDokumente === 1 ? '' : 'e'}
                  </span>
                </div>
                <div className="vorgang-knoepfe">
                  {!aktiv && (
                    <button type="button" className="btn-secondary btn-klein" onClick={() => onOeffnen(v.id)}>
                      Öffnen
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn-symbol btn-symbol-entfernen"
                    onClick={() => loeschenMitRueckfrage(v)}
                    aria-label={`Vorgang ${name} löschen`}
                    title="Von diesem Gerät löschen"
                  >
                    <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                      <path d="m5 5 10 10M15 5 5 15" />
                    </svg>
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {offen && (
        <p className="vorgaenge-fuss">
          Alles bleibt auf diesem Gerät und in diesem Browser.
          {verbrauch !== null && ` Belegt: ${formatBytes(verbrauch)}.`}
          {alte.length > 0 &&
            ` ${alte.length} Vorgang${alte.length === 1 ? ' ist' : 'e sind'} älter als ${ALT_NACH_TAGEN} Tage und ${alte.length === 1 ? 'kann' : 'können'} gelöscht werden.`}
        </p>
      )}
    </section>
  )
}
