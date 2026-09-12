import { useEffect, useState } from 'react'
import { SALESPEOPLE } from './data/salespeople'
import KundenSuche from './KundenSuche'
import type { Ich, KundenEintrag } from './lib/api'
import { formatDateTime } from './lib/format'
import type { VorgangSatz } from './lib/speicher'
import { CUSTOM_VALUE, mitarbeiterFuerAnmeldung, type Kundendaten } from './kunde'

/**
 * Seite "Projekte", ganz oben im Menueband (Yann, 12.09.2026): Hier wird das
 * Projekt gewaehlt, an dem gearbeitet wird. Alles darunter (Uebersicht,
 * Fotos, Videos, Skizze, Vorschau) zeigt die Daten dieses Projekts.
 *
 * Gezeigt werden nur die Projekte des gewaehlten Mitarbeiters: die fuenf
 * zuletzt bearbeiteten auf einen Klick, alle anderen ueber die Suche (im
 * Geraet gespeicherte Projekte und das MeisterTask-Board des Mitarbeiters).
 * Ein Projekt ist technisch ein Vorgang (vorgang.ts).
 */

export interface ProjektePanelProps {
  daten: Kundendaten
  ich: Ich | null
  /** Alle eigenen Vorgaenge dieses Geraets, neueste zuerst */
  vorgaenge: VorgangSatz[]
  aktivId: string
  onOeffnen: (id: string) => void
  /** Neues Projekt aus einer MeisterTask-Aufgabe anlegen und oeffnen */
  onNeuAusMeisterTask: (eintrag: KundenEintrag, mitarbeiter: string) => void
  /** Neues Projekt ohne MeisterTask, nur mit Namen */
  onNeuFrei: (name: string, mitarbeiter: string) => void
}

const ZULETZT = 5

/** Ort aus der Kundenadresse: der Teil nach dem letzten Komma */
function ortAus(adresse: string): string {
  const teile = adresse.split(',').map((t) => t.trim()).filter(Boolean)
  return teile.length > 1 ? teile[teile.length - 1] : ''
}

export default function ProjektePanel({
  daten,
  ich,
  vorgaenge,
  aktivId,
  onOeffnen,
  onNeuAusMeisterTask,
  onNeuFrei,
}: ProjektePanelProps) {
  /**
   * Mitarbeiter, dessen Projekte gezeigt werden. Eigener Zustand statt des
   * Mitarbeiters am offenen Vorgang: Wer hier umschaltet, will schauen, nicht
   * den offenen Vorgang umschreiben. Startet mit dem Mitarbeiter des offenen
   * Vorgangs, sonst mit der Anmeldung.
   */
  const [mitarbeiter, setMitarbeiter] = useState<string>('')
  // Anmeldung und gespeicherter Vorgang kommen erst nach dem ersten Aufbau an:
  // solange nichts gewaehlt ist, den Mitarbeiter des Vorgangs nehmen, sonst
  // den der Anmeldung. Eine eigene Wahl bleibt danach stehen.
  useEffect(() => {
    if (mitarbeiter) return
    const ausVorgang =
      daten.mitarbeiterAuswahl && daten.mitarbeiterAuswahl !== CUSTOM_VALUE ? daten.mitarbeiterAuswahl : null
    const ausAnmeldung = ich ? mitarbeiterFuerAnmeldung(ich) : null
    const name = ausVorgang ?? ausAnmeldung
    if (name && SALESPEOPLE.some((s) => s.name === name)) setMitarbeiter(name)
  }, [mitarbeiter, daten.mitarbeiterAuswahl, ich])
  const [suche, setSuche] = useState('')

  const eigene = vorgaenge.filter(
    (v) => v.kunde.mitarbeiterAuswahl === mitarbeiter && v.kunde.kunde.trim() !== '',
  )
  const zuletzt = eigene.slice(0, ZULETZT)
  /** Fuer die Suche: alle Projekte des Mitarbeiters ausser dem offenen */
  const suchbar = eigene.filter((v) => v.id !== aktivId)

  function waehleMeisterTask(eintrag: KundenEintrag) {
    // Gibt es das Projekt schon im Geraet, wird es geoeffnet statt doppelt angelegt
    const vorhanden = vorgaenge.find((v) => v.kunde.meistertask?.id === eintrag.id)
    setSuche('')
    if (vorhanden) onOeffnen(vorhanden.id)
    else onNeuAusMeisterTask(eintrag, mitarbeiter)
  }

  return (
    <div className="projekte">
      <section className="card" aria-labelledby="projekte-titel">
        <div className="karte-kopf">
          <h2 id="projekte-titel">Projekte</h2>
        </div>

        <div className="projekte-felder">
          <div className="eingabe">
            <label htmlFor="projekte-mitarbeiter">Mitarbeiter</label>
            <select id="projekte-mitarbeiter" value={mitarbeiter} onChange={(e) => setMitarbeiter(e.target.value)}>
              <option value="">Bitte wählen …</option>
              {SALESPEOPLE.map((s) => (
                <option key={s.name} value={s.name}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div className="eingabe eingabe-breit">
            <label htmlFor="projekte-suche">Projekt</label>
            <KundenSuche
              id="projekte-suche"
              wert={suche}
              onText={setSuche}
              mitarbeiter={mitarbeiter}
              verfuegbar={ich ? ich.meistertask : null}
              onAuswahl={waehleMeisterTask}
              gespeicherte={suchbar}
              onGespeichert={(id) => {
                setSuche('')
                onOeffnen(id)
              }}
              neuAnlegen={(name) => {
                setSuche('')
                onNeuFrei(name, mitarbeiter)
              }}
              placeholder="Name suchen"
            />
          </div>
        </div>

        {zuletzt.length > 0 && (
          <>
            <p className="projekte-titel">Zuletzt bearbeitet</p>
            <ul className="projekte-liste">
              {zuletzt.map((v) => {
                const aktiv = v.id === aktivId
                const ort = ortAus(v.kunde.kundenadresse)
                return (
                  <li key={v.id}>
                    <button
                      type="button"
                      className={`projekt${aktiv ? ' aktiv' : ''}`}
                      onClick={() => onOeffnen(v.id)}
                      aria-current={aktiv ? 'true' : undefined}
                    >
                      <span className="projekt-name">
                        {v.kunde.kunde.trim()}
                        {ort && <span className="projekt-ort">, {ort}</span>}
                      </span>
                      <span className="projekt-meta">
                        {formatDateTime(v.geaendert)} · {v.anzahlFotos} Foto{v.anzahlFotos === 1 ? '' : 's'} ·{' '}
                        {v.anzahlDokumente} Dokument{v.anzahlDokumente === 1 ? '' : 'e'}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </section>
    </div>
  )
}
