import { useRef, useState } from 'react'
import { SALESPEOPLE } from './data/salespeople'
import { GEWERKE } from './data/gewerke'
import MultiSelect from './MultiSelect'
import KundenSuche from './KundenSuche'
import { ApiFehler, ladeKundendaten, meistertaskLink, type Ich, type KundenEintrag } from './lib/api'
import { ACCEPT, isSupported, prepareImage } from './lib/bilder'
import { logoBild, objektBild, visitenkarteBild } from './lib/deckblattbilder'
import { formatBytes, formatDateTime, initialsOf, sanitizeFilePart } from './lib/format'
import { speichereDatei, teileDateien, typTeilbar } from './lib/share'
import {
  CUSTOM_VALUE,
  anschriftenAus,
  mitarbeiterVon,
  objektadresseText,
  type Dokument,
  type DokumentFn,
  type Kundendaten,
  type ToastFn,
} from './kunde'

/**
 * Reihenfolge der Unterlagen in der Angebotsmappe (Yann, 08.09.2026): erst die
 * Prinzipskizze, dann die Sanierungsvorschau, zuletzt die Fotodokumentation.
 */
const MAPPEN_REIHENFOLGE = ['Prinzipskizze', 'Sanierungsvorschau', 'Fotodokumentation']

/** Am Rechner wird heruntergeladen, am Handy zusaetzlich geteilt. */
const PDF_TEILBAR = typTeilbar('application/pdf', 'dokument.pdf')
const VIDEO_TEILBAR = typTeilbar('video/mp4', 'video.mp4')

export interface KundePanelProps {
  daten: Kundendaten
  onChange: (aenderung: Partial<Kundendaten>) => void
  dokumente: Dokument[]
  onEntfernen: (id: string) => void
  onDokument: DokumentFn
  onToast: ToastFn
  /** Wer angemeldet ist und was der Server kann; null bis /api/ich geantwortet hat */
  ich: Ich | null
}

/**
 * Seite "Kunde": alle Angaben zum Termin in einem Raster, rechts das
 * Objektfoto, darunter die auf den anderen Seiten erstellten Dokumente.
 */
export default function KundePanel({
  daten,
  onChange,
  dokumente,
  onEntfernen,
  onDokument,
  onToast,
  ich,
}: KundePanelProps) {
  const [spPhotoFailed, setSpPhotoFailed] = useState(false)
  const [dragOverObject, setDragOverObject] = useState(false)
  const [objektLaeuft, setObjektLaeuft] = useState(false)
  const [mappeLaeuft, setMappeLaeuft] = useState(false)
  const [uebernahmeLaeuft, setUebernahmeLaeuft] = useState(false)
  const objectInputRef = useRef<HTMLInputElement>(null)

  const mitarbeiter = mitarbeiterVon(daten)

  /**
   * Ein Vorgang aus der Suchliste wurde gewaehlt: Name, Anschriften und
   * Baujahr aus den Feldern der Aufgabe uebernehmen. Der Name steht sofort
   * (aus der Liste), die Felder kommen mit einem Abruf nach.
   */
  async function uebernimmVorgang(eintrag: KundenEintrag) {
    const nameAusTitel = eintrag.anzeige.split(',')[0]?.trim() ?? eintrag.anzeige
    onChange({
      kunde: nameAusTitel,
      meistertask: { id: eintrag.id, token: eintrag.token, titel: eintrag.titel },
    })
    setUebernahmeLaeuft(true)
    try {
      const felder = await ladeKundendaten(eintrag)
      const anschriften = anschriftenAus(felder.kundenadresse, felder.objektadresse)
      onChange({
        kunde: felder.kunde || nameAusTitel,
        ...anschriften,
        baujahr: felder.baujahr,
      })
      const fehlt = [
        !anschriften.kundenadresse && 'Anschrift',
        !felder.baujahr && 'Baujahr',
      ].filter((t): t is string => Boolean(t))
      onToast(
        fehlt.length === 0 ? 'success' : 'info',
        fehlt.length === 0
          ? `Angaben aus MeisterTask übernommen: ${eintrag.anzeige}`
          : `Aus MeisterTask übernommen: ${eintrag.anzeige}. In der Aufgabe fehlt: ${fehlt.join(', ')}.`,
      )
    } catch (err) {
      onToast(
        'error',
        err instanceof ApiFehler
          ? `Felder der Aufgabe nicht lesbar: ${err.message}`
          : 'Felder der Aufgabe nicht lesbar.',
      )
    } finally {
      setUebernahmeLaeuft(false)
    }
  }

  async function handleObjectFile(files: FileList | null) {
    const file = files?.[0]
    if (!file) return
    if (!isSupported(file)) {
      onToast('error', `Nicht unterstütztes Format: ${file.name}`)
      return
    }
    setObjektLaeuft(true)
    try {
      const prepared = await prepareImage(file)
      if (daten.objektfoto) URL.revokeObjectURL(daten.objektfoto.thumbUrl)
      onChange({ objektfoto: prepared })
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : `Fehler bei ${file.name}`)
    } finally {
      setObjektLaeuft(false)
    }
  }

  /** Die Unterlagen, die in die Mappe wandern - in fester Reihenfolge. */
  const mappenTeile = MAPPEN_REIHENFOLGE.map((quelle) =>
    dokumente.find((d) => d.art === 'pdf' && d.quelle === quelle),
  ).filter((d): d is Dokument => d !== undefined)

  /**
   * Alles in einem Dokument: Deckblatt, Inhaltsverzeichnis und die Unterlagen
   * am Stueck - zum Ausdrucken und Uebergeben.
   */
  async function erstelleMappe() {
    if (mappenTeile.length === 0 || mappeLaeuft) return
    setMappeLaeuft(true)
    try {
      const [{ erzeugeAngebotsmappe }, objekt, karte, logo] = await Promise.all([
        import('./lib/mappe'),
        objektBild(daten),
        visitenkarteBild(mitarbeiter.name),
        logoBild(),
      ])
      const teile = await Promise.all(
        mappenTeile.map(async (d) => ({
          titel: d.quelle,
          bytes: new Uint8Array(await d.blob.arrayBuffer()),
        })),
      )
      const bytes = await erzeugeAngebotsmappe({
        objekt,
        visitenkarte: karte,
        logo,
        zeilen: [
          { label: 'Kunde', wert: daten.kunde.trim() },
          { label: 'Kundenadresse', wert: daten.kundenadresse.trim() },
          { label: 'Objekt', wert: objektadresseText(daten) },
        ],
        teile,
      })
      const name =
        ['ISOTEC Angebotsmappe', sanitizeFilePart(daten.kunde)].filter((t) => t !== '').join('_') + '.pdf'
      onDokument(
        'pdf:mappe',
        'Angebotsmappe',
        new File([bytes as BlobPart], name, { type: 'application/pdf' }),
      )
      onToast('success', `Angebotsmappe erstellt: ${name}`)
    } catch (fehler) {
      onToast(
        'error',
        `Angebotsmappe konnte nicht erstellt werden: ${fehler instanceof Error ? fehler.message : String(fehler)}`,
      )
    } finally {
      setMappeLaeuft(false)
    }
  }

  async function teile(dok: Dokument) {
    const ergebnis = await teileDateien([new File([dok.blob], dok.name, { type: dok.blob.type })], dok.quelle)
    if (ergebnis === 'nicht moeglich') {
      onToast('error', 'Teilen hat nicht geklappt, die Datei wird stattdessen gespeichert.')
      speichereDatei(dok.blob, dok.name)
    }
  }

  return (
    <div className="kunde">
      <section className="card" aria-labelledby="kunde-termin">
        <div className="karte-kopf">
          <h2 id="kunde-termin">Termin</h2>
          <p>
            Einmal eintragen, gilt für alle Unterlagen. Das Feld Kunde sucht im Ersttermine-Board des
            Mitarbeiters und übernimmt Anschrift und Baujahr aus der Aufgabe.
          </p>
        </div>

        <div className="kunde-raster">
          <div className="felder">
            <div className="eingabe eingabe-breit">
              <label htmlFor="salesperson-select">Mitarbeiter</label>
              <div className="mitarbeiter-zeile">
                {mitarbeiter.name !== '' &&
                  (mitarbeiter.foto && !spPhotoFailed ? (
                    <img
                      src={mitarbeiter.foto}
                      alt=""
                      className="avatar"
                      onError={() => setSpPhotoFailed(true)}
                    />
                  ) : (
                    <span className="avatar avatar-initialen" aria-hidden="true">
                      {initialsOf(mitarbeiter.name)}
                    </span>
                  ))}
                <select
                  id="salesperson-select"
                  value={daten.mitarbeiterAuswahl}
                  onChange={(e) => {
                    onChange({ mitarbeiterAuswahl: e.target.value })
                    setSpPhotoFailed(false)
                  }}
                >
                  <option value="">Bitte wählen …</option>
                  {SALESPEOPLE.map((s) => (
                    <option key={s.name} value={s.name}>
                      {s.name}
                    </option>
                  ))}
                  <option value={CUSTOM_VALUE}>Anderer Name (selbst eingeben) …</option>
                </select>
                {mitarbeiter.eigen && (
                  <input
                    type="text"
                    value={daten.mitarbeiterEigen}
                    onChange={(e) => onChange({ mitarbeiterEigen: e.target.value })}
                    placeholder="Vorname Nachname"
                    aria-label="Eigenen Mitarbeiter-Namen eingeben"
                    autoFocus
                  />
                )}
              </div>
            </div>

            <div className="eingabe">
              <label htmlFor="customer-input">
                Kunde
                {daten.meistertask && (
                  <>
                    {' '}
                    <a
                      className="eingabe-link"
                      href={meistertaskLink(daten.meistertask.token)}
                      target="_blank"
                      rel="noreferrer"
                      title={daten.meistertask.titel}
                    >
                      {uebernahmeLaeuft ? 'wird gelesen …' : 'in MeisterTask öffnen'}
                    </a>
                  </>
                )}
              </label>
              <KundenSuche
                id="customer-input"
                wert={daten.kunde}
                onText={(kunde) => onChange({ kunde })}
                mitarbeiter={mitarbeiter.eigen ? '' : mitarbeiter.name}
                verfuegbar={ich ? ich.meistertask : null}
                onAuswahl={(eintrag) => void uebernimmVorgang(eintrag)}
                placeholder="Name tippen, Vorgang wählen"
              />
            </div>
            <div className="eingabe">
              <label htmlFor="customeraddress-input">Kundenadresse</label>
              <input
                id="customeraddress-input"
                type="text"
                value={daten.kundenadresse}
                onChange={(e) => onChange({ kundenadresse: e.target.value })}
                placeholder="z. B. Musterstraße 1, Krefeld"
              />
            </div>
            <div className="eingabe">
              <label htmlFor="address-input">Objektadresse</label>
              <input
                id="address-input"
                type="text"
                value={daten.objektadresse}
                onChange={(e) => onChange({ objektadresse: e.target.value })}
                placeholder="nur wenn abweichend"
              />
              <p className="eingabe-hinweis">
                {daten.objektadresse.trim() === '' && daten.kundenadresse.trim() !== ''
                  ? 'Leer = siehe Kundenadresse'
                  : 'Nur wenn das Objekt anderswo liegt'}
              </p>
            </div>
            <div className="eingabe">
              <label htmlFor="baujahr-input">Baujahr</label>
              <input
                id="baujahr-input"
                type="text"
                inputMode="numeric"
                value={daten.baujahr}
                onChange={(e) => onChange({ baujahr: e.target.value })}
                placeholder="z. B. 1971"
              />
            </div>
            <div className="eingabe">
              <label htmlFor="ordernumber-input">Auftragsnummer</label>
              <input
                id="ordernumber-input"
                type="text"
                value={daten.auftragsnummer}
                onChange={(e) => onChange({ auftragsnummer: e.target.value })}
                placeholder="bei Reklamationen"
              />
            </div>
            <div className="eingabe">
              <label htmlFor="termindate-input">Termindatum</label>
              <input
                id="termindate-input"
                type="date"
                value={daten.termindatum}
                onChange={(e) => onChange({ termindatum: e.target.value })}
              />
              <p className="eingabe-hinweis">Leer = Datum aus den Fotos</p>
            </div>
            <div className="eingabe">
              <label id="gewerke-label">Sanierungskonzept</label>
              <MultiSelect
                label="Gewerke des Sanierungskonzepts"
                options={GEWERKE}
                selected={daten.gewerke}
                onChange={(gewerke) => onChange({ gewerke })}
                placeholder="Gewerke auswählen …"
              />
            </div>
          </div>

          <div className="objektfoto">
            <span className="eingabe-label">Objektfoto</span>
            <input
              ref={objectInputRef}
              id="object-input"
              className="visually-hidden"
              type="file"
              accept={ACCEPT}
              onChange={(e) => {
                void handleObjectFile(e.target.files)
                e.target.value = ''
              }}
            />
            <div
              className={`dropzone objektfoto-feld${dragOverObject ? ' dropzone-active' : ''}`}
              onDragOver={(e) => {
                e.preventDefault()
                setDragOverObject(true)
              }}
              onDragLeave={() => setDragOverObject(false)}
              onDrop={(e) => {
                e.preventDefault()
                setDragOverObject(false)
                void handleObjectFile(e.dataTransfer.files)
              }}
              onClick={() => objectInputRef.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') objectInputRef.current?.click()
              }}
            >
              {objektLaeuft ? (
                <span className="objektfoto-leer">Wird gelesen …</span>
              ) : daten.objektfoto ? (
                <img src={daten.objektfoto.thumbUrl} alt="Objektfoto" />
              ) : (
                <span className="objektfoto-leer">Foto hierher ziehen oder klicken</span>
              )}
            </div>
            {daten.objektfoto && (
              <p className="eingabe-hinweis" title={daten.objektfoto.fileName}>
                {daten.objektfoto.fileName} · {formatBytes(daten.objektfoto.fileSize)}
              </p>
            )}
          </div>
        </div>
      </section>

      <section className="card" aria-labelledby="kunde-dokumente">
        <div className="karte-kopf">
          <h2 id="kunde-dokumente">Erstellte Dokumente</h2>
          {dokumente.length === 0 && <p>Noch nichts erstellt. Fertige PDFs und Videos erscheinen hier.</p>}
        </div>

        <div className="mappe-zeile">
          <div className="mappe-text">
            <p className="mappe-titel">Angebotsmappe</p>
            <p className="eingabe-hinweis">
              {mappenTeile.length === 0
                ? 'Sobald eine Unterlage fertig ist, entsteht daraus eine Mappe mit Deckblatt und Inhaltsverzeichnis.'
                : `Deckblatt, Inhaltsverzeichnis, ${mappenTeile.map((t) => t.quelle).join(', ')}`}
            </p>
          </div>
          <button
            type="button"
            className="btn-primary"
            disabled={mappenTeile.length === 0 || mappeLaeuft}
            onClick={() => void erstelleMappe()}
          >
            {mappeLaeuft ? 'Mappe wird erstellt …' : 'Angebotsmappe erstellen'}
          </button>
        </div>
        {dokumente.length > 0 && (
          <ul className="dokumente">
            {dokumente.map((dok) => {
              const teilbar = dok.art === 'pdf' ? PDF_TEILBAR : VIDEO_TEILBAR
              return (
                <li key={dok.id} className="dokument">
                  <div className="dokument-vorschau">
                    {dok.art === 'pdf' ? (
                      <iframe
                        src={`${dok.url}#toolbar=0&navpanes=0&scrollbar=0&view=Fit`}
                        title={`Vorschau ${dok.name}`}
                        loading="lazy"
                      />
                    ) : (
                      <video src={dok.url} controls preload="metadata" playsInline />
                    )}
                  </div>
                  <div className="dokument-info">
                    <p className="file-name">{dok.name}</p>
                    <p className="file-meta">
                      {dok.quelle} · {formatBytes(dok.blob.size)} · {formatDateTime(dok.erstellt)}
                    </p>
                  </div>
                  <div className="dokument-knoepfe">
                    <button type="button" className="btn-primary" onClick={() => speichereDatei(dok.blob, dok.name)}>
                      Herunterladen
                    </button>
                    {teilbar && (
                      <button type="button" className="btn-secondary" onClick={() => void teile(dok)}>
                        Teilen
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn-remove"
                      onClick={() => onEntfernen(dok.id)}
                      aria-label={`${dok.name} entfernen`}
                      title="Entfernen"
                    >
                      ✕
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
