import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SALESPEOPLE } from './data/salespeople.generated'
import { readExif, readGps, type GpsInfo } from './lib/exif'
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
  formatDateTime,
  formatDateWeekday,
  initialsOf,
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
  /** GPS-Koordinaten aus dem EXIF, falls vorhanden */
  gps: GpsInfo | null
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

// Feste Komprimierung (keine Auswahl im UI): Standard-Aufloesung, kleinste Qualitaetsstufe
const MAX_EDGE = 2200
const JPEG_QUALITY = 0.75

// "Extra Komprimierung": stufenweise staerker komprimieren, bis die PDF unter 10 MB liegt
const EXTRA_TARGET_BYTES = 10 * 1024 * 1024
const EXTRA_LADDER: Array<{ maxEdge: number; quality: number }> = [
  { maxEdge: 1600, quality: 0.6 },
  { maxEdge: 1200, quality: 0.5 },
  { maxEdge: 960, quality: 0.4 },
  { maxEdge: 800, quality: 0.35 },
]

const COMPANY = 'Abdichtungstechnik Dipl.-Ing. Morscheck GmbH'

const TERMINARTEN = ['Analysetermin', 'Reklamation', 'Baustellenbesuch']

const ACCEPT = '.jpg,.jpeg,.png,.heic,.heif,image/jpeg,image/png,image/heic,image/heif'

/** Dropdown-Wert fuer "Anderer Name (selbst eingeben)" */
const CUSTOM_VALUE = '__custom__'

function isSupported(file: File): boolean {
  if (/\.(jpe?g|png|heic|heif)$/i.test(file.name)) return true
  return ['image/jpeg', 'image/png', 'image/heic', 'image/heif'].includes(file.type.toLowerCase())
}

/** Datei einlesen: EXIF (Datum, Orientation, GPS) -> ggf. HEIC-Konvertierung -> Thumbnail. */
async function prepareImage(file: File): Promise<PreparedImage> {
  const exif = await readExif(file)
  const gps = await readGps(file)
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
  const thumbUrl = await makeThumbnailUrl(workingBlob, orientation, 512)
  return {
    fileName: file.name,
    fileSize: file.size,
    workingBlob,
    sourceType: file.type || (convertedFromHeic ? 'image/heic' : ''),
    orientation,
    takenAt: exif.takenAt ?? file.lastModified,
    dateSource: exif.takenAt != null ? 'exif' : 'file',
    gps,
    thumbUrl,
    convertedFromHeic,
  }
}

/**
 * Strasse + Ort (ohne Hausnummer) per Reverse-Geocoding (OpenStreetMap/Nominatim).
 * Es werden nur die GPS-Koordinaten uebertragen, keine Fotos. null bei Fehlern.
 */
async function lookupAddress(gps: GpsInfo): Promise<string | null> {
  try {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 6000)
    const url =
      'https://nominatim.openstreetmap.org/reverse?format=jsonv2' +
      `&lat=${gps.lat}&lon=${gps.lon}&zoom=17&accept-language=de`
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } })
    window.clearTimeout(timeout)
    if (!res.ok) return null
    const data = (await res.json()) as { address?: Record<string, string> }
    const a = data.address ?? {}
    const road = a.road ?? a.pedestrian ?? a.footway ?? a.hamlet ?? null
    const city = a.city ?? a.town ?? a.village ?? a.municipality ?? null
    const parts = [road, city].filter(Boolean)
    return parts.length > 0 ? parts.join(', ') : null
  } catch {
    return null
  }
}

/** Chronologische Grundsortierung: Aufnahmedatum, Tie-Breaker Dateiname */
function chronoCompare(a: { takenAt: number; fileName: string }, b: { takenAt: number; fileName: string }): number {
  return a.takenAt - b.takenAt || a.fileName.localeCompare(b.fileName, 'de', { numeric: true })
}

let toastCounter = 0

// ---------- App ----------

export default function App() {
  const [terminType, setTerminType] = useState(TERMINARTEN[0])
  const [selectValue, setSelectValue] = useState('')
  const [customName, setCustomName] = useState('')
  const [spPhotoFailed, setSpPhotoFailed] = useState(false)
  const [objectPhoto, setObjectPhoto] = useState<PreparedImage | null>(null)
  const [photos, setPhotos] = useState<TerminPhoto[]>([])
  const [keepDuplicates, setKeepDuplicates] = useState(false)
  const [extraCompression, setExtraCompression] = useState(true)
  const [importProgress, setImportProgress] = useState<Progress | null>(null)
  const [pdfProgress, setPdfProgress] = useState<Progress | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [dragOverObject, setDragOverObject] = useState(false)
  const [toasts, setToasts] = useState<Toast[]>([])
  // Reihenfolge: startet chronologisch; sobald manuell sortiert wurde, bleibt
  // die Reihenfolge beim Import neuer Fotos unangetastet (neue kommen ans Ende)
  const [orderTouched, setOrderTouched] = useState(false)
  const [dragPhotoId, setDragPhotoId] = useState<string | null>(null)
  const [dragOverPhotoId, setDragOverPhotoId] = useState<string | null>(null)

  const photosRef = useRef(photos)
  photosRef.current = photos
  const orderTouchedRef = useRef(orderTouched)
  orderTouchedRef.current = orderTouched
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
          setPhotos((prev) => {
            const next = [...prev, { ...prepared, hash, id: crypto.randomUUID() }]
            return orderTouchedRef.current ? next : next.sort(chronoCompare)
          })
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

  /** Foto per Pfeil-Button eine Position nach oben/unten schieben */
  const movePhoto = useCallback((id: string, dir: -1 | 1) => {
    setOrderTouched(true)
    setPhotos((prev) => {
      const i = prev.findIndex((p) => p.id === id)
      const j = i + dir
      if (i < 0 || j < 0 || j >= prev.length) return prev
      const next = [...prev]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  }, [])

  /** Foto per Drag & Drop an die Position des Ziel-Fotos verschieben */
  const reorderByDrop = useCallback(
    (targetId: string) => {
      if (!dragPhotoId || dragPhotoId === targetId) {
        setDragPhotoId(null)
        setDragOverPhotoId(null)
        return
      }
      setOrderTouched(true)
      setPhotos((prev) => {
        const from = prev.findIndex((p) => p.id === dragPhotoId)
        const to = prev.findIndex((p) => p.id === targetId)
        if (from < 0 || to < 0) return prev
        const next = [...prev]
        const [moved] = next.splice(from, 1)
        next.splice(to, 0, moved)
        return next
      })
      setDragPhotoId(null)
      setDragOverPhotoId(null)
    },
    [dragPhotoId],
  )

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

  // Die Listen-Reihenfolge (initial chronologisch, manuell aenderbar) ist
  // exakt die Seiten-Reihenfolge in der PDF.
  const included = useMemo(
    () => (keepDuplicates ? annotated : annotated.filter((p) => !p.isDuplicate)),
    [annotated, keepDuplicates],
  )
  const duplicateTotal = useMemo(() => annotated.filter((p) => p.isDuplicate).length, [annotated])

  // Termindatum automatisch aus den Aufnahmedaten der Fotos:
  // immer das NEUESTE Foto, ein einzelnes Datum
  const terminDate = useMemo(() => {
    if (included.length === 0) return null
    let max = -Infinity
    for (const p of included) {
      if (p.takenAt > max) max = p.takenAt
    }
    return max
  }, [included])

  const terminLabel = terminDate != null ? formatDateWeekday(terminDate) : null

  // ---------- PDF ----------

  const busy = importProgress !== null || pdfProgress !== null
  const canCreate = salesperson !== '' && objectPhoto !== null && included.length > 0 && !busy

  const missingHints: string[] = []
  if (!salesperson) missingHints.push(isCustomName ? 'Namen eingeben' : 'Mitarbeiter wählen')
  if (!objectPhoto) missingHints.push('Objektfoto hochladen')
  if (included.length === 0) missingHints.push('mind. 1 Termin-Foto hinzufügen')

  const handleCreatePdf = useCallback(async () => {
    if (!canCreate || !objectPhoto || terminDate == null || !terminLabel) return
    try {
      // 1) Statische Assets (Teamfoto, Logo) + Mitarbeiterfoto laden
      setPdfProgress({ label: 'Lade Deckblatt-Bilder …', done: 0, total: 1 })
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

      // 2) Adresse aus GPS-Daten ableiten (Objektfoto bevorzugt, sonst erstes
      //    Termin-Foto mit GPS). Schlaegt die Abfrage fehl, bleibt alles beim Alten.
      let objectAddress: string | null = null
      const gps = objectPhoto.gps ?? included.find((p) => p.gps)?.gps ?? null
      if (gps) {
        setPdfProgress({ label: 'Ermittle Adresse aus GPS-Daten …', done: 0, total: 1 })
        objectAddress = await lookupAddress(gps)
      }

      // Ein kompletter Durchlauf: Objektfoto + Termin-Fotos optimieren, PDF bauen.
      // Sequenziell und speicherschonend, auch bei 150+ Bildern.
      const buildOnce = async (maxEdge: number, jpegQuality: number, passLabel: string) => {
        const totalSteps = included.length + 2
        setPdfProgress({ label: `Komprimiere Objektfoto${passLabel} …`, done: 1, total: totalSteps })
        const objOriented = await loadOriented(objectPhoto.workingBlob, objectPhoto.orientation)
        let objImage: OptimizedImage
        try {
          objImage = await optimizeImage(objOriented, {
            maxEdge,
            quality: jpegQuality,
            sourceType: objectPhoto.sourceType,
          })
        } finally {
          objOriented.cleanup()
        }

        const pdfPhotos: PdfPhoto[] = []
        for (let i = 0; i < included.length; i++) {
          const photo = included[i]
          setPdfProgress({
            label: `Verarbeite Bild ${i + 1}/${included.length}${passLabel} …`,
            done: 2 + i,
            total: totalSteps,
          })
          const oriented = await loadOriented(photo.workingBlob, photo.orientation)
          let image: OptimizedImage
          try {
            setPdfProgress({
              label: `Komprimiere Bild ${i + 1}/${included.length}${passLabel} …`,
              done: 2 + i,
              total: totalSteps,
            })
            image = await optimizeImage(oriented, {
              maxEdge,
              quality: jpegQuality,
              sourceType: photo.sourceType,
            })
          } finally {
            oriented.cleanup()
          }
          pdfPhotos.push({ image, takenAt: photo.takenAt, isDuplicate: photo.isDuplicate })
        }

        return buildPdf(
          {
            terminType,
            salespersonName: salesperson,
            salespersonImage: spImage,
            objectImage: objImage,
            objectAddress,
            photos: pdfPhotos,
            createdAt: new Date(),
            terminLabel,
            heroJpg: new Uint8Array(heroJpg),
            logoPng: new Uint8Array(logoPng),
          },
          (done, total) =>
            setPdfProgress({
              label: `Füge Seite ${done}/${total} ein${passLabel} …`,
              done: totalSteps,
              total: totalSteps,
            }),
        )
      }

      // Ohne Extra-Komprimierung ein Durchlauf mit den Standardwerten;
      // mit Extra-Komprimierung stufenweise staerker, bis die PDF unter 10 MB liegt.
      const attempts = extraCompression
        ? EXTRA_LADDER
        : [{ maxEdge: MAX_EDGE, quality: JPEG_QUALITY }]
      let bytes: Uint8Array = new Uint8Array()
      for (let a = 0; a < attempts.length; a++) {
        const step = attempts[a]
        const passLabel = extraCompression
          ? ` – Extra-Komprimierung, Stufe ${a + 1}/${attempts.length}`
          : ''
        bytes = await buildOnce(step.maxEdge, step.quality, passLabel)
        if (!extraCompression || bytes.length < EXTRA_TARGET_BYTES) break
      }
      if (extraCompression && bytes.length >= EXTRA_TARGET_BYTES) {
        pushToast(
          'info',
          `PDF ist trotz maximaler Komprimierung ${formatBytes(bytes.length)} groß (Ziel: unter 10 MB).`,
        )
      }

      const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' })
      // Datum im Dateinamen = Termindatum (neuestes Foto), nicht das heutige Datum
      const fileName = `${sanitizeFilePart(terminType)}_${sanitizeFilePart(salesperson)}_${isoDate(new Date(terminDate))}.pdf`
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
    salesperson,
    terminType,
    terminDate,
    terminLabel,
    extraCompression,
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
              <h1>Fotodokumentation</h1>
              <p className="header-kicker">{COMPANY}</p>
            </div>
          </div>
          <p className="privacy-note">
            🔒 Alle Dateien bleiben lokal im Browser. Es wird nichts hochgeladen.
          </p>
        </div>
      </header>

      <main className="container">
        {/* 1: Terminart */}
        <section className="card" aria-labelledby="sec-terminart">
          <h2 id="sec-terminart">
            <span className="step">1</span> Terminart
          </h2>
          <div className="field">
            <label htmlFor="terminart-select">Terminart auswählen</label>
            <select
              id="terminart-select"
              value={terminType}
              onChange={(e) => setTerminType(e.target.value)}
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
        <section className="card" aria-labelledby="sec-mitarbeiter">
          <h2 id="sec-mitarbeiter">
            <span className="step">2</span> Mitarbeiter
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
                  aria-label="Eigenen Mitarbeiter-Namen eingeben"
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

        {/* 3: Objektfoto */}
        <section className="card" aria-labelledby="sec-objekt">
          <h2 id="sec-objekt">
            <span className="step">3</span> Objektfoto (Gebäude)
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
              <>
                <p className="dropzone-hint">Foto hierher ziehen oder</p>
                <button type="button" className="btn-secondary" onClick={() => objectInputRef.current?.click()}>
                  Objektfoto auswählen
                </button>
              </>
            )}
          </div>
        </section>

        {/* 4: Termin-Fotos */}
        <section className="card" aria-labelledby="sec-fotos">
          <h2 id="sec-fotos">
            <span className="step">4</span> Termin-Fotos
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

          {annotated.length > 0 && (
            <>
              <div className="list-toolbar">
                <p aria-live="polite">
                  {annotated.length} Foto(s) importiert
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
              <p className="order-hint">
                Die Reihenfolge unten ist die Seiten-Reihenfolge in der PDF – per Pfeiltasten oder
                Ziehen ändern (startet chronologisch).
              </p>
              <ul className="photo-list">
                {annotated.map((p, idx) => (
                  <li
                    key={p.id}
                    className={[
                      p.isDuplicate && !keepDuplicates ? 'photo-excluded' : '',
                      dragPhotoId === p.id ? 'dragging' : '',
                      dragOverPhotoId === p.id && dragPhotoId !== p.id ? 'drag-target' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    draggable
                    onDragStart={(e) => {
                      setDragPhotoId(p.id)
                      e.dataTransfer.effectAllowed = 'move'
                    }}
                    onDragEnd={() => {
                      setDragPhotoId(null)
                      setDragOverPhotoId(null)
                    }}
                    onDragOver={(e) => {
                      if (dragPhotoId) {
                        e.preventDefault()
                        e.stopPropagation()
                        e.dataTransfer.dropEffect = 'move'
                        setDragOverPhotoId(p.id)
                      }
                    }}
                    onDragLeave={() => {
                      if (dragOverPhotoId === p.id) setDragOverPhotoId(null)
                    }}
                    onDrop={(e) => {
                      if (dragPhotoId) {
                        e.preventDefault()
                        e.stopPropagation()
                        reorderByDrop(p.id)
                      }
                    }}
                  >
                    <span className="order-number" aria-hidden="true">
                      {idx + 1}
                    </span>
                    <img src={p.thumbUrl} alt="" className="photo-thumb" draggable={false} />
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
                      <p className="file-meta">
                        <span className={`badge ${p.isDuplicate ? 'badge-dup' : 'badge-ok'}`}>
                          {p.isDuplicate ? `Duplikat von ${p.duplicateOf}` : 'OK'}
                        </span>
                      </p>
                    </div>
                    <div className="move-buttons">
                      <button
                        type="button"
                        className="btn-move"
                        onClick={() => movePhoto(p.id, -1)}
                        disabled={idx === 0}
                        aria-label={`${p.fileName} nach oben verschieben`}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="btn-move"
                        onClick={() => movePhoto(p.id, 1)}
                        disabled={idx === annotated.length - 1}
                        aria-label={`${p.fileName} nach unten verschieben`}
                      >
                        ↓
                      </button>
                    </div>
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

        {/* 5: PDF erstellen (Komprimierung ist fest eingestellt: 2200 px, Qualität 0,75) */}
        <section className="card card-action" aria-labelledby="sec-create">
          <h2 id="sec-create" className="visually-hidden">
            PDF erstellen
          </h2>
          {terminLabel && (
            <p className="termin-line">
              Termin (aus den Foto-Aufnahmedaten): <strong>{terminLabel}</strong>
            </p>
          )}
          <label className="checkbox checkbox-center">
            <input
              type="checkbox"
              checked={extraCompression}
              onChange={(e) => setExtraCompression(e.target.checked)}
            />
            Extra Komprimierung (Ziel: PDF kleiner als 10 MB)
          </label>
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
            Dateiname: &lt;Terminart&gt;_&lt;Mitarbeiter&gt;_&lt;JJJJ-MM-TT&gt;.pdf ·
            Nur zur Adress-Ermittlung werden GPS-Koordinaten (keine Fotos) an OpenStreetMap gesendet
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
