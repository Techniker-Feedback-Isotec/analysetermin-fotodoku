import { useRef, useState } from 'react'
import { SALESPEOPLE } from './data/salespeople'
import { GEWERKE } from './data/gewerke'
import MultiSelect from './MultiSelect'
import { ACCEPT, isSupported, prepareImage } from './lib/bilder'
import { formatBytes, formatDateTime, initialsOf } from './lib/format'
import { speichereDatei, teileDateien, typTeilbar } from './lib/share'
import { CUSTOM_VALUE, mitarbeiterVon, type Dokument, type Kundendaten, type ToastFn } from './kunde'

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
 * Seite "Kunde": alle Angaben zum Termin in einem Raster, rechts das
 * Objektfoto, darunter die auf den anderen Seiten erstellten Dokumente.
 */
export default function KundePanel({ daten, onChange, dokumente, onEntfernen, onToast }: KundePanelProps) {
  const [spPhotoFailed, setSpPhotoFailed] = useState(false)
  const [dragOverObject, setDragOverObject] = useState(false)
  const [objektLaeuft, setObjektLaeuft] = useState(false)
  const objectInputRef = useRef<HTMLInputElement>(null)

  const mitarbeiter = mitarbeiterVon(daten)

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
          <p>Einmal eintragen, gilt für Fotodokumentation, Videodokumentation und Prinzipskizze.</p>
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
              <label htmlFor="customer-input">Kunde</label>
              <input
                id="customer-input"
                type="text"
                value={daten.kunde}
                onChange={(e) => onChange({ kunde: e.target.value })}
                placeholder="z. B. Familie Mustermann"
              />
            </div>
            <div className="eingabe">
              <label htmlFor="customeraddress-input">Kundenadresse</label>
              <input
                id="customeraddress-input"
                type="text"
                value={daten.kundenadresse}
                onChange={(e) => onChange({ kundenadresse: e.target.value })}
                placeholder="nur wenn abweichend vom Objekt"
              />
            </div>
            <div className="eingabe">
              <label htmlFor="address-input">Objektadresse</label>
              <input
                id="address-input"
                type="text"
                value={daten.objektadresse}
                onChange={(e) => onChange({ objektadresse: e.target.value })}
                placeholder="z. B. Musterstraße, Krefeld"
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
