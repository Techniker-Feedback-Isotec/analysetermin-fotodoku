import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SALESPEOPLE } from './data/salespeople.generated'
import { readExif } from './lib/exif'
import { heicToJpegBlob, isHeic } from './lib/heic'
import { sha256Hex } from './lib/hash'
import {
  loadOriented,
  makeThumbnailUrl,
  optimizeCircle,
  optimizeImage,
  type OptimizedImage,
} from './lib/image'
import { buildPdf, type PdfPhoto } from './lib/pdf'
import {
  formatBytes,
  formatDateShort,
  formatDateTime,
  formatDateWeekday,
  initialsOf,
  isSameDay,
  isoDate,
  sanitizeFilePart,
} from './lib/format'
import teamJpgUrl from './assets/team.jpg'
import logoPngUrl from './assets/isotec-logo.png'

// ---------- Typen ----------

interface PreparedImage {
  fileName: string
  fileSize: number
  /** Original, oder bei HEIC das konvertierte JPEG */
  workingBlob: Blob
  /** MIME-Typ der Originaldatei (fuer PNG-Transparenz-Erkennung) */
  sourceType: string
  /** EXIF-Orientation der workingBlob (nach HEIC-Konvertierung immer 1) */
  orientation: number
  takenAt: number
  dateSource: 'exif' | 'file'
  thumbUrl: string
  convertedFromHeic: boolean
}

interface TerminPhoto extends PreparedImage {
  id: string
  hash: string
}

interface Toast {
  id: number
  kind: 'info' | 'error' | 'success'
  text: string
}

interface Progress {
  label: string
  done: number
  total: number
}

// ---------- Konstanten ----------

const RESOLUTIONS = [
  { label: 'Standard (empfohlen)', hint: 'max. 2200 px Kante', value: 2200 },
  { label: 'Kleinere Datei', hint: 'max. 1800 px Kante', value: 1800 },
  { label: 'Beste Qualität', hint: 'max. 3000 px Kante', value: 3000 },
]

const QUALITIES = [
  { label: '0,75', hint: 'kleinste Datei', value: 0.75 },
  { label: '0,82 (empfohlen)', hint: 'ausgewogen', value: 0.82 },
  { label: '0,90', hint: 'beste Qualität', value: 0.9 },
]

const ACCEPT = '.jpg,.jpeg,.png,.heic,.heif,image/jpeg,image/png,image/heic,image/heif'

/** Dropdown-Wert fuer "Anderer Name (selbst eingeben)" */
const CUSTOM_VALUE = '__custom__'

function isSupported(file: File): boolean {
  if (/\.(jpe?g|png|heic|heif)$/i.test(file.name)) return true
  return ['image/jpeg', 'image/png', 'image/heic', 'image/heif'].includes(file.type.toLowerCase())
}

/** Datei einlesen: EXIF -> ggf. HEIC-Konvertierung -> Thumbnail. */
async function prepareImage(file: File): Promise<PreparedImage> {
  const exif = await readExif(file)
  let workingBlob: Blob = file
  let orientation = exif.orientation
  let convertedFromHeic = false
  if (isHeic(file)) {
    try {
      workingBlob = await heicToJpegBlob(file)
      convertedFromHeic = true
      orientation = 1 // libheif liefert bereits korrekt orientierte Pixel
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      throw new Error(`HEIC konnte nicht konvertiert werden: ${file.name} (${reason})`)
    }
  }
  const thumbUrl = await makeThumbnailUrl(workingBlob, orientation)
  return {
    fileName: file.name,
    fileSize: file.size,
    workingBlob,
    sourceType: file.type || (convertedFromHeic ? 'image/heic' : ''),
    orientation,
    takenAt: exif.takenAt ?? file.lastModified,
    dateSource: exif.takenAt != null ? 'exif' : 'file',
    thumbUrl,
    convertedFromHeic,
  }
}

let toastCounter = 0

// ---------- App ----------

export default function App() {
  const [selectValue, setSelectValue] = useState('')
  const [customName, setCustomName] = useState('')
  const [spPhotoFailed, setSpPhotoFailed] = useState(false)
  const [objectPhoto, setObjectPhoto] = useState<PreparedImage | null>(null)
  const [photos, setPhotos] = useState<TerminPhoto[]>([])
  const [keepDuplicates, setKeepDuplicates] = useState(false)
  const [maxEdge, setMaxEdge] = useState(2200)
  const [quality, setQuality] = useState(0.82)
  const [importProgress, setImportProgress] = useState<Progress | null>(null)
  const [pdfProgress, setPdfProgress] = useState<Progress | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [toasts, setToasts] = useState<Toast[]>([])

  const photosRef = useRef(photos)
  photosRef.current = photos
  const dropInputRef = useRef<HTMLInputElement>(null)
  const objectInputRef = useRef<HTMLInputElement>(null)

  const pushToast = useCallback((kind: Toast['kind'], text: string) => {
    const id = ++toastCounter
    setToasts((prev) => [...prev.slice(-4), { id, kind, text }])
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, 7000)
  }, [])

  // Browser-Standardverhalten (Datei im Tab oeffnen) global unterbinden
  useEffect(() => {
    const prevent = (e: DragEvent) => e.preventDefault()
    window.addEventListener('dragover', prevent)
    window.addEventListener('drop', prevent)
    return () => {
      window.removeEventListener('dragover', prevent)
      window.removeEventListener('drop', prevent)
    }
  }, [])

  // ---------- Vertriebler ----------

  const isCustomName = selectValue === CUSTOM_VALUE
  const salesperson = isCustomName ? customName.trim() : selectValue
  const spEntry = useMemo(
    () => (isCustomName ? undefined : SALESPEOPLE.find((s) => s.name === selectValue)),
    [isCustomName, selectValue],
  )
  const spPhotoUrl = spEntry
    ? `${import.meta.env.BASE_URL}vertriebler/${encodeURIComponent(spEntry.file)}`
    : null

  // ---------- Objektfoto ----------

  const handleObjectFile = useCallback(
    async (files: FileList | null) => {
      const file = files?.[0]
      if (!file) return
      if (!isSupported(file)) {
        pushToast('error', `Nicht unterstütztes Format: ${file.name}`)
        return
      }
      setImportProgress({ label: `Verarbeite Objektfoto ${file.name} …`, done: 0, total: 1 })
      try {
        const prepared = await prepareImage(file)
        setObjectPhoto((prev) => {
          if (prev) URL.revokeObjectURL(prev.thumbUrl)
          return prepared
        })
      } catch (err) {
        pushToast('error', err instanceof Error ? err.message : `Fehler bei ${file.name}`)
      } finally {
        setImportProgress(null)
      }
    },
    [pushToast],
  )

  // ---------- Termin-Fotos ----------

  const addFiles = useCallback(
    async (list: FileList | File[]) => {
      const files = Array.from(list)
      files.filter((f) => !isSupported(f)).forEach((f) => {
        pushToast('error', `Nicht unterstütztes Format: ${f.name}`)
      })
      const supported = files.filter(isSupported)
      if (supported.length === 0) return

      const knownHashes = new Set(photosRef.current.map((p) => p.hash))
      let noExifCount = 0
      let duplicateCount = 0

      for (let i = 0; i < supported.length; i++) {
        const file = supported[i]
        setImportProgress({
          label: `Verarbeite Bild ${i + 1}/${supported.length}: ${file.name}`,
          done: i,
          total: supported.length,
        })
        try {
          const hash = await sha256Hex(file)
          const prepared = await prepareImage(file)
          if (prepared.dateSource === 'file') noExifCount++
          if (knownHashes.has(hash)) {
            duplicateCount++
            pushToast('info', `Duplikat erkannt: ${file.name}`)
          }
          knownHashes.add(hash)
          setPhotos((prev) => [...prev, { ...prepared, hash, id: crypto.randomUUID() }])
        } catch (err) {
          pushToast('error', err instanceof Error ? err.message : `Fehler bei ${file.name}`)
        }
      }
      setImportProgress(null)
      if (noExifCount > 0) {
        pushToast('info', `Kein EXIF-Datum bei ${noExifCount} Foto(s) gefunden – verwende Dateidatum.`)
      }
      if (duplicateCount > 0 && !keepDuplicates) {
        pushToast('info', `${duplicateCount} Duplikat(e) werden von der PDF ausgeschlossen.`)
      }
    },
    [keepDuplicates, pushToast],
  )

  const removePhoto = useCallback((id: string) => {
    setPhotos((prev) => {
      const photo = prev.find((p) => p.id === id)
      if (photo) URL.revokeObjectURL(photo.thumbUrl)
      return prev.filter((p) => p.id !== id)
    })
  }, [])

  // Duplikate markieren (erste Datei mit einem Hash gilt als Original)
  const annotated = useMemo(() => {
    const firstByHash = new Map<string, string>()
    return photos.map((p) => {
      const first = firstByHash.get(p.hash)
      if (first === undefined) {
        firstByHash.set(p.hash, p.fileName)
        return { ...p, isDuplicate: false, duplicateOf: undefined as string | undefined }
      }
      return { ...p, isDuplicate: true, duplicateOf: first }
    })
  }, [photos])

  // Chronologisch: EXIF-Datum > Dateidatum, Tie-Breaker Dateiname
  const sorted = useMemo(
    () =>
      [...annotated].sort(
        (a, b) =>
          a.takenAt - b.takenAt || a.fileName.localeCompare(b.fileName, 'de', { numeric: true }),
      ),
    [annotated],
  )

  const included = useMemo(
    () => (keepDuplicates ? sorted : sorted.filter((p) => !p.isDuplicate)),
    [sorted, keepDuplicates],
  )
  const duplicateTotal = useMemo(() => sorted.filter((p) => p.isDuplicate).length, [sorted])

  // Termindatum automatisch aus den Aufnahmedaten der Fotos
  const terminRange = useMemo(() => {
    if (included.length === 0) return null
    let min = Infinity
    let max = -Infinity
    for (const p of included) {
      if (p.takenAt < min) min = p.takenAt
      if (p.takenAt > max) max = p.takenAt
    }
    return { min, max }
  }, [included])

  const terminLabel = terminRange
    ? isSameDay(terminRange.min, terminRange.max)
      ? formatDateWeekday(terminRange.min)
      : `${formatDateShort(terminRange.min)} – ${formatDateShort(terminRange.max)}`
    : null

  // ---------- PDF ----------

  const busy = importProgress !== null || pdfProgress !== null
  const canCreate = salesperson !== '' && objectPhoto !== null && included.length > 0 && !busy

  const missingHints: string[] = []
  if (!salesperson) missingHints.push(isCustomName ? 'Namen eingeben' : 'Vertriebler wählen')
  if (!objectPhoto) missingHints.push('Objektfoto hochladen')
  if (included.length === 0) missingHints.push('mind. 1 Termin-Foto hinzufügen')

  const handleCreatePdf = useCallback(async () => {
    if (!canCreate || !objectPhoto || !terminRange || !terminLabel) return
    const totalSteps = included.length + 2
    try {
      // 1) Statische Assets (Teamfoto, Logo) + Vertrieblerfoto laden
      setPdfProgress({ label: 'Lade Deckblatt-Bilder …', done: 0, total: totalSteps })
      const [heroJpg, logoPng] = await Promise.all([
        fetch(teamJpgUrl).then((r) => r.arrayBuffer()),
        fetch(logoPngUrl).then((r) => r.arrayBuffer()),
      ])
      let spImage: OptimizedImage | null = null
      if (spPhotoUrl) {
        try {
          const res = await fetch(spPhotoUrl)
          const type = res.headers.get('content-type') ?? ''
          if (res.ok && type.startsWith('image/')) {
            spImage = await optimizeCircle(await res.blob(), 1, 360)
          }
        } catch {
          // Platzhalter mit Initialen wird verwendet
        }
      }

      // 2) Objektfoto optimieren
      setPdfProgress({ label: 'Komprimiere Objektfoto …', done: 1, total: totalSteps })
      const objOriented = await loadOriented(objectPhoto.workingBlob, objectPhoto.orientation)
      let objImage: OptimizedImage
      try {
        objImage = await optimizeImage(objOriented, {
          maxEdge,
          quality,
          sourceType: objectPhoto.sourceType,
        })
      } finally {
        objOriented.cleanup()
      }

      // 3) Termin-Fotos sequenziell verarbeiten (speicherschonend, auch bei 150+)
      const pdfPhotos: PdfPhoto[] = []
      for (let i = 0; i < included.length; i++) {
        const photo = included[i]
        setPdfProgress({
          label: `Verarbeite Bild ${i + 1}/${included.length} …`,
          done: 2 + i,
          total: totalSteps,
        })
        const oriented = await loadOriented(photo.workingBlob, photo.orientation)
        let image: OptimizedImage
        try {
          setPdfProgress({
            label: `Komprimiere Bild ${i + 1}/${included.length} …`,
            done: 2 + i,
            total: totalSteps,
          })
          image = await optimizeImage(oriented, {
            maxEdge,
            quality,
            sourceType: photo.sourceType,
          })
        } finally {
          oriented.cleanup()
        }
        pdfPhotos.push({ image, takenAt: photo.takenAt, isDuplicate: photo.isDuplicate })
      }

      // 4) PDF bauen und herunterladen
      const bytes = await buildPdf(
        {
          salespersonName: salesperson,
          salespersonImage: spImage,
          objectImage: objImage,
          photos: pdfPhotos,
          createdAt: new Date(),
          terminLabel,
          heroJpg: new Uint8Array(heroJpg),
          logoPng: new Uint8Array(logoPng),
        },
        (done, total) =>
          setPdfProgress({ label: `Füge Seite ${done}/${total} ein …`, done: totalSteps, total: totalSteps }),
      )
      const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' })
      // Datum im Dateinamen = Termindatum (fruehestes Foto), nicht das heutige Datum
      const fileName = `Analysetermin_${sanitizeFilePart(salesperson)}_${isoDate(new Date(terminRange.min))}.pdf`
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = fileName
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
      pushToast(
        'success',
        `PDF erstellt: ${fileName} (${formatBytes(blob.size)}, ${included.length + 1} Seiten)`,
      )
    } catch (err) {
      pushToast(
        'error',
        `PDF konnte nicht erstellt werden: ${err instanceof Error ? err.message : String(err)}`,
      )
    } finally {
      setPdfProgress(null)
    }
  }, [
    canCreate,
    objectPhoto,
    included,
    spPhotoUrl,
    maxEdge,
    quality,
    salesperson,
    terminRange,
    terminLabel,
    pushToast,
  ])

  const progress = pdfProgress ?? importProgress

  // ---------- Render ----------

  return (
    <div className="app">
      <header className="header">
        <div className="container header-inner">
          <div className="header-brand">
            <span className="header-logo">
              <img src={logoPngUrl} alt="ISOTEC – Immer besser." />
            </span>
            <div>
              <h1>Analysetermin</h1>
              <p className="header-kicker">Fotodokumentation · ISOTEC Abdichtungstechnik Morscheck</p>
            </div>
          </div>
          <p className="privacy-note">
            🔒 Alle Dateien bleiben lokal im Browser. Es wird nichts hochgeladen.
          </p>
        </div>
      </header>

      <main className="container">
        {/* 1: Vertriebler */}
        <section className="card" aria-labelledby="sec-vertriebler">
          <h2 id="sec-vertriebler">
            <span className="step">1</span> Vertriebler
          </h2>
          <div className="salesperson-row">
            <div className="field">
              <label htmlFor="salesperson-select">Name auswählen</label>
              <select
                id="salesperson-select"
                value={selectValue}
                onChange={(e) => {
                  setSelectValue(e.target.value)
                  setSpPhotoFailed(false)
                }}
              >
                <option value="">Bitte wählen …</option>
                {SALESPEOPLE.map((s) => (
                  <option key={s.file} value={s.name}>
                    {s.name}
                  </option>
                ))}
                <option value={CUSTOM_VALUE}>Anderer Name (selbst eingeben) …</option>
              </select>
              {isCustomName && (
                <input
                  type="text"
                  className="custom-name-input"
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  placeholder="Vorname Nachname"
                  aria-label="Eigenen Vertriebler-Namen eingeben"
                  autoFocus
                />
              )}
            </div>
            {salesperson !== '' && (
              <div className="salesperson-preview">
                {spPhotoUrl && !spPhotoFailed ? (
                  <img
                    src={spPhotoUrl}
                    alt={`Foto von ${salesperson}`}
                    className="salesperson-photo"
                    onError={() => setSpPhotoFailed(true)}
                  />
                ) : (
                  <div className="initials-tile" aria-hidden="true">
                    {initialsOf(salesperson)}
                  </div>
                )}
                <div>
                  <p className="salesperson-name">{salesperson}</p>
                  {spPhotoFailed && (
                    <p className="hint-warn">Kein Foto gefunden für {salesperson} – Initialen-Platzhalter wird verwendet.</p>
                  )}
                </div>
              </div>
            )}
          </div>
        </section>

        {/* 2: Objektfoto */}
        <section className="card" aria-labelledby="sec-objekt">
          <h2 id="sec-objekt">
            <span className="step">2</span> Objektfoto (Gebäude)
          </h2>
          <p className="section-hint">Genau 1 Foto (JPG/PNG/HEIC) – erscheint prominent auf dem Deckblatt.</p>
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
          {objectPhoto ? (
            <div className="object-preview">
              <img src={objectPhoto.thumbUrl} alt="Vorschau Objektfoto" />
              <div>
                <p className="file-name">{objectPhoto.fileName}</p>
                <p className="file-meta">
                  {formatBytes(objectPhoto.fileSize)}
                  {objectPhoto.convertedFromHeic ? ' · aus HEIC konvertiert' : ''}
                </p>
                <button type="button" className="btn-secondary" onClick={() => objectInputRef.current?.click()}>
                  Anderes Foto wählen
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="btn-secondary" onClick={() => objectInputRef.current?.click()}>
              Objektfoto auswählen
            </button>
          )}
        </section>

        {/* 3: Termin-Fotos */}
        <section className="card" aria-labelledby="sec-fotos">
          <h2 id="sec-fotos">
            <span className="step">3</span> Termin-Fotos
          </h2>
          <div
            className={`dropzone${dragOver ? ' dropzone-active' : ''}`}
            onDragOver={(e) => {
              e.preventDefault()
              setDragOver(true)
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragOver(false)
              void addFiles(e.dataTransfer.files)
            }}
          >
            <p className="dropzone-title">Termin-Fotos hinzufügen</p>
            <p className="dropzone-hint">Dateien hierher ziehen (JPG, PNG, HEIC) oder</p>
            <input
              ref={dropInputRef}
              className="visually-hidden"
              type="file"
              accept={ACCEPT}
              multiple
              onChange={(e) => {
                if (e.target.files) void addFiles(e.target.files)
                e.target.value = ''
              }}
            />
            <button type="button" className="btn-secondary" onClick={() => dropInputRef.current?.click()}>
              Dateien auswählen
            </button>
          </div>

          {sorted.length > 0 && (
            <>
              <div className="list-toolbar">
                <p aria-live="polite">
                  {sorted.length} Foto(s) importiert
                  {duplicateTotal > 0 &&
                    ` · ${duplicateTotal} Duplikat(e)${keepDuplicates ? ' (bleiben enthalten)' : ' ausgeschlossen'}`}
                  {' '}· {included.length} in der PDF
                </p>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={keepDuplicates}
                    onChange={(e) => setKeepDuplicates(e.target.checked)}
                  />
                  Duplikate behalten (kennzeichnen)
                </label>
              </div>
              <ul className="photo-list">
                {sorted.map((p) => (
                  <li key={p.id} className={p.isDuplicate && !keepDuplicates ? 'photo-excluded' : ''}>
                    <img src={p.thumbUrl} alt="" className="photo-thumb" />
                    <div className="photo-info">
                      <p className="file-name">{p.fileName}</p>
                      <p className="file-meta">
                        {formatDateTime(p.takenAt)}
                        {p.dateSource === 'file' && (
                          <span className="badge badge-warn" title="Kein EXIF-Datum gefunden – Dateidatum wird verwendet">
                            Dateidatum
                          </span>
                        )}
                        {p.convertedFromHeic && <span className="badge">HEIC</span>}
                      </p>
                    </div>
                    <span className={`badge ${p.isDuplicate ? 'badge-dup' : 'badge-ok'}`}>
                      {p.isDuplicate ? `Duplikat von ${p.duplicateOf}` : 'OK'}
                    </span>
                    <button
                      type="button"
                      className="btn-remove"
                      onClick={() => removePhoto(p.id)}
                      aria-label={`${p.fileName} entfernen`}
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        {/* 4: Einstellungen */}
        <section className="card" aria-labelledby="sec-settings">
          <h2 id="sec-settings">
            <span className="step">4</span> Komprimierung
          </h2>
          <div className="settings-grid">
            <fieldset>
              <legend>Auflösung</legend>
              {RESOLUTIONS.map((r) => (
                <label key={r.value} className="radio">
                  <input
                    type="radio"
                    name="resolution"
                    value={r.value}
                    checked={maxEdge === r.value}
                    onChange={() => setMaxEdge(r.value)}
                  />
                  <span>
                    {r.label} <small>({r.hint})</small>
                  </span>
                </label>
              ))}
            </fieldset>
            <fieldset>
              <legend>JPEG-Qualität</legend>
              {QUALITIES.map((q) => (
                <label key={q.value} className="radio">
                  <input
                    type="radio"
                    name="quality"
                    value={q.value}
                    checked={quality === q.value}
                    onChange={() => setQuality(q.value)}
                  />
                  <span>
                    {q.label} <small>({q.hint})</small>
                  </span>
                </label>
              ))}
            </fieldset>
          </div>
        </section>

        {/* 5: PDF erstellen */}
        <section className="card card-action" aria-labelledby="sec-create">
          <h2 id="sec-create" className="visually-hidden">
            PDF erstellen
          </h2>
          {terminLabel && (
            <p className="termin-line">
              Termin (aus den Foto-Aufnahmedaten): <strong>{terminLabel}</strong>
            </p>
          )}
          <button type="button" className="btn-primary" disabled={!canCreate} onClick={() => void handleCreatePdf()}>
            PDF erstellen ({included.length + 1} Seiten)
          </button>
          {!canCreate && !busy && missingHints.length > 0 && (
            <p className="hint-missing">Noch offen: {missingHints.join(' · ')}</p>
          )}
          {progress && (
            <div className="progress" role="status" aria-live="polite">
              <p>{progress.label}</p>
              <div
                className="progress-bar"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={progress.total}
                aria-valuenow={progress.done}
              >
                <div
                  className="progress-fill"
                  style={{ width: `${progress.total > 0 ? (progress.done / progress.total) * 100 : 0}%` }}
                />
              </div>
            </div>
          )}
        </section>
      </main>

      <footer className="footer">
        <div className="container">
          <p>
            Verarbeitung zu 100 % lokal im Browser · keine Uploads, kein Tracking, keine Cookies ·
            Dateiname: Analysetermin_&lt;Vertriebler&gt;_&lt;JJJJ-MM-TT&gt;.pdf
          </p>
        </div>
      </footer>

      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`} role="status">
            {t.text}
          </div>
        ))}
      </div>
    </div>
  )
}
