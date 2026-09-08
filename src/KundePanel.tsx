import { useRef, useState } from 'react'
import { SALESPEOPLE } from './data/salespeople'
import { GEWERKE } from './data/gewerke'
import MultiSelect from './MultiSelect'
import { ACCEPT, isSupported, prepareImage } from './lib/bilder'
import { formatBytes, formatDateTime, initialsOf } from './lib/format'
import { speichereDatei, teileDateien, typTeilbar } from './lib/share'
import {
  CUSTOM_VALUE,
  TERMINARTEN,
  mitarbeiterVon,
  type Dokument,
  type Kundendaten,
  type Terminart,
  type ToastFn,
} from './kunde'

/** Am Rechner wird heruntergeladen, am Handy zusaetzlich geteilt. */
const PDF_TEILBAR = typTeilbar('application/pdf', 'dokument.pdf')
const VIDEO_TEILBAR = typTeilbar('video/mp4', 'video.mp4')

export interface KundePanelProps {
  daten: Kundendaten
  onChange: (aenderung: Partial<Kundendaten>) => void
  dokumente: Dokument[]
  onEntfernen: (id: string) => void
  onToast: ToastFn
}

/**
 * Seite "Kunde": alle Angaben zum Termin an einer Stelle, dazu die auf den
 * anderen Seiten erstellten Dokumente mit Vorschau und Download.
 */
export default function KundePanel({ daten, onChange, dokumente, onEntfernen, onToast }: KundePanelProps) {
  const [spPhotoFailed, setSpPhotoFailed] = useState(false)
  const [dragOverObject, setDragOverObject] = useState(false)
  const [objektLaeuft, setObjektLaeuft] = useState<string | null>(null)
  const objectInputRef = useRef<HTMLInputElement>(null)

  const mitarbeiter = mitarbeiterVon(daten)
  const isReklamation = daten.terminart === 'Reklamation'

  async function handleObjectFile(files: FileList | null) {
    const file = files?.[0]
    if (!file) return
    if (!isSupported(file)) {
      onToast('error', `Nicht unterstütztes Format: ${file.name}`)
      return
    }
    setObjektLaeuft(`Verarbeite Objektfoto ${file.name} …`)
    try {
      const prepared = await prepareImage(file)
      if (daten.objektfoto) URL.revokeObjectURL(daten.objektfoto.thumbUrl)
      onChange({ objektfoto: prepared })
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : `Fehler bei ${file.name}`)
    } finally {
      setObjektLaeuft(null)
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
      {/* 1: Terminart - bestimmt Deckblatt, Dateiname und Zusatzfelder */}
      <section className="card" aria-labelledby="kunde-terminart">
        <h2 id="kunde-terminart">
          <span className="step">1</span> Terminart
        </h2>
        <p className="section-hint">
          Gilt für die Fotodokumentation. Die Prinzipskizze hat eine eigene Seite, Videos entstehen
          immer beim Analysetermin.
        </p>
        <div className="field">
          <label htmlFor="terminart-select">Terminart auswählen</label>
          <select
            id="terminart-select"
            value={daten.terminart}
            onChange={(e) => onChange({ terminart: e.target.value as Terminart })}
          >
            {TERMINARTEN.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
      </section>

      {/* 2: Mitarbeiter */}
      <section className="card" aria-labelledby="kunde-mitarbeiter">
        <h2 id="kunde-mitarbeiter">
          <span className="step">2</span> Mitarbeiter
        </h2>
        <div className="salesperson-row">
          <div className="field">
            <label htmlFor="salesperson-select">Name auswählen</label>
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
                className="custom-name-input"
                value={daten.mitarbeiterEigen}
                onChange={(e) => onChange({ mitarbeiterEigen: e.target.value })}
                placeholder="Vorname Nachname"
                aria-label="Eigenen Mitarbeiter-Namen eingeben"
                autoFocus
              />
            )}
          </div>
          {mitarbeiter.name !== '' && (
            <div className="salesperson-preview">
              {mitarbeiter.foto && !spPhotoFailed ? (
                <img
                  src={mitarbeiter.foto}
                  alt={`Foto von ${mitarbeiter.name}`}
                  className="salesperson-photo"
                  onError={() => setSpPhotoFailed(true)}
                />
              ) : (
                <div className="initials-tile" aria-hidden="true">
                  {initialsOf(mitarbeiter.name)}
                </div>
              )}
              <div>
                <p className="salesperson-name">{mitarbeiter.name}</p>
                {spPhotoFailed && (
                  <p className="hint-warn">
                    Kein Foto gefunden für {mitarbeiter.name} – Initialen-Platzhalter wird verwendet.
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* 3: Objektfoto */}
      <section className="card" aria-labelledby="kunde-objektfoto">
        <h2 id="kunde-objektfoto">
          <span className="step">3</span> Objektfoto (Gebäude)
        </h2>
        <p className="section-hint">
          Genau 1 Foto (JPG/PNG/HEIC) – erscheint prominent auf dem Deckblatt von Fotodokumentation und
          Prinzipskizze.
        </p>
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
          className={`dropzone dropzone-small${dragOverObject ? ' dropzone-active' : ''}`}
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
        >
          {objektLaeuft ? (
            <p className="dropzone-hint">{objektLaeuft}</p>
          ) : daten.objektfoto ? (
            <div className="object-preview">
              <img src={daten.objektfoto.thumbUrl} alt="Vorschau Objektfoto" />
              <div>
                <p className="file-name">{daten.objektfoto.fileName}</p>
                <p className="file-meta">
                  {formatBytes(daten.objektfoto.fileSize)}
                  {daten.objektfoto.convertedFromHeic ? ' · aus HEIC konvertiert' : ''}
                </p>
                <button type="button" className="btn-secondary" onClick={() => objectInputRef.current?.click()}>
                  Anderes Foto wählen
                </button>
              </div>
            </div>
          ) : (
            <>
              <p className="dropzone-hint">Foto hierher ziehen oder</p>
              <button type="button" className="btn-secondary" onClick={() => objectInputRef.current?.click()}>
                Objektfoto auswählen
              </button>
            </>
          )}
        </div>
      </section>

      {/* 4: Angaben zum Termin */}
      <section className="card" aria-labelledby="kunde-angaben">
        <h2 id="kunde-angaben">
          <span className="step">4</span> Angaben zum Termin
        </h2>
        <p className="section-hint">
          Einmal eintragen genügt – Fotodokumentation, Videodokumentation und Prinzipskizze übernehmen
          diese Angaben.
        </p>
        <div className="object-fields">
          <div className="field">
            <label htmlFor="customer-input">Kunde (optional)</label>
            <input
              id="customer-input"
              type="text"
              className="custom-name-input"
              value={daten.kunde}
              onChange={(e) => onChange({ kunde: e.target.value })}
              placeholder="z. B. Familie Mustermann"
            />
          </div>
          {isReklamation && (
            <div className="field">
              <label htmlFor="customeraddress-input">Kundenadresse (optional)</label>
              <input
                id="customeraddress-input"
                type="text"
                className="custom-name-input"
                value={daten.kundenadresse}
                onChange={(e) => onChange({ kundenadresse: e.target.value })}
                placeholder="nur wenn abweichend vom Objekt"
              />
            </div>
          )}
          <div className="field">
            <label htmlFor="address-input">Objektadresse (optional)</label>
            <input
              id="address-input"
              type="text"
              className="custom-name-input"
              value={daten.objektadresse}
              onChange={(e) => onChange({ objektadresse: e.target.value })}
              placeholder="z. B. Musterstraße, Krefeld"
            />
          </div>
          <div className="field">
            <label htmlFor="termindate-input">Termindatum (optional)</label>
            <input
              id="termindate-input"
              type="date"
              className="custom-name-input"
              value={daten.termindatum}
              onChange={(e) => onChange({ termindatum: e.target.value })}
            />
            <p className="field-hint">
              Leer lassen = Datum kommt automatisch aus den Fotos. Nur ausfüllen, wenn das erkannte Datum
              nicht stimmt. Videos bringen ihr Aufnahmedatum selbst mit.
            </p>
          </div>
          {isReklamation && (
            <div className="field">
              <label htmlFor="ordernumber-input">Auftragsnummer (optional)</label>
              <input
                id="ordernumber-input"
                type="text"
                className="custom-name-input"
                value={daten.auftragsnummer}
                onChange={(e) => onChange({ auftragsnummer: e.target.value })}
                placeholder="z. B. AB-2026-0815"
              />
            </div>
          )}
          <div className="field">
            <label id="gewerke-label">Sanierungskonzept, Gewerke (optional)</label>
            <MultiSelect
              label="Gewerke des Sanierungskonzepts"
              options={GEWERKE}
              selected={daten.gewerke}
              onChange={(gewerke) => onChange({ gewerke })}
              placeholder="Gewerke auswählen …"
            />
            <p className="field-hint">
              Erscheint als Block „Sanierungskonzept" auf dem Deckblatt. Ohne Auswahl entfällt der Block.
            </p>
          </div>
        </div>
      </section>

      {/* 5: Erstellte Dokumente */}
      <section className="card" aria-labelledby="kunde-dokumente">
        <h2 id="kunde-dokumente">
          <span className="step">5</span> Erstellte Dokumente
        </h2>
        {dokumente.length === 0 ? (
          <p className="section-hint" style={{ marginBottom: 0 }}>
            Noch nichts erstellt. Sobald auf einer der anderen Seiten eine PDF oder ein Video fertig
            ist, erscheint es hier zum Herunterladen.
          </p>
        ) : (
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
                    <div className="ergebnis-knoepfe">
                      <button type="button" className="btn-primary" onClick={() => speichereDatei(dok.blob, dok.name)}>
                        Herunterladen
                      </button>
                      {teilbar && (
                        <button type="button" className="btn-secondary" onClick={() => void teile(dok)}>
                          Teilen
                        </button>
                      )}
                      <button type="button" className="btn-secondary" onClick={() => onEntfernen(dok.id)}>
                        Entfernen
                      </button>
                    </div>
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
