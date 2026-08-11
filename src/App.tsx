import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SALESPEOPLE } from './data/salespeople'
import { readExif } from './lib/exif'
import { heicToJpegBlob, isHeic } from './lib/heic'
import { sha256Hex } from './lib/hash'
import {
  downscaleToJpegBlob,
  loadOriented,
  makeThumbnailUrl,
  optimizeCircle,
  optimizeImage,
  type OptimizedImage,
  type OptimizeOptions,
} from './lib/image'
import { buildPdf, type PdfPhoto } from './lib/pdf'
import {
  formatBytes,
  formatDateShort,
  formatDateTime,
  formatDateWeekday,
  initialsOf,
  fileDate,
  sanitizeFilePart,
} from './lib/format'
import teamJpgUrl from './assets/team.jpg'
import logoPngUrl from './assets/isotec-logo.png'
import VideoPanel from './VideoPanel'

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
  /** Vom Nutzer gewaehlte Drehung in Grad: 0, 90, 180 oder 270 */
  rotation: number
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

const TERMINARTEN = ['Analysetermin', 'Reklamation']

const ACCEPT = '.jpg,.jpeg,.png,.heic,.heif,image/jpeg,image/png,image/heic,image/heif'

/** Dropdown-Wert fuer "Anderer Name (selbst eingeben)" */
const CUSTOM_VALUE = '__custom__'

function isSupported(file: File): boolean {
  if (/\.(jpe?g|png|heic|heif)$/i.test(file.name)) return true
  return ['image/jpeg', 'image/png', 'image/heic', 'image/heif'].includes(file.type.toLowerCase())
}

/** Datei einlesen: EXIF (Datum, Orientation) -> ggf. HEIC-Konvertierung -> Thumbnail. */
async function prepareImage(file: File): Promise<PreparedImage> {
  const exif = await readExif(file)
  let workingBlob: Blob = file
  let orientation = exif.orientation
  let convertedFromHeic = false
  let thumbUrl: string | null = null

  if (isHeic(file)) {
    // 1) Nativ versuchen: Safari (iPhone/Mac) dekodiert HEIC direkt - dann bleibt
    //    die Original-Datei die Arbeitsgrundlage und nichts liegt extra im Speicher.
    try {
      thumbUrl = await makeThumbnailUrl(file, orientation, 512)
    } catch {
      // 2) Konvertieren (Chrome/Edge/Firefox) - mit einem zweiten Anlauf - und das
      //    Ergebnis sofort auf Arbeitsgroesse verkleinern, statt das JPEG in voller
      //    Aufloesung zu behalten (Speicher: ~0,5 MB statt 5-8 MB pro Foto).
      let jpeg: Blob
      try {
        jpeg = await heicToJpegBlob(file)
      } catch {
        await new Promise((r) => window.setTimeout(r, 300))
        try {
          jpeg = await heicToJpegBlob(file)
        } catch (err) {
          // heic2any wirft teils Plain-Objects mit {code, message} statt Error
          const reason =
            err instanceof Error
              ? err.message
              : err && typeof err === 'object' && 'message' in err
                ? String((err as { message: unknown }).message)
                : String(err)
          throw new Error(`HEIC konnte nicht konvertiert werden: ${file.name} (${reason})`)
        }
      }
      workingBlob = await downscaleToJpegBlob(jpeg, 1, MAX_EDGE, 0.9)
      convertedFromHeic = true
      orientation = 1 // libheif liefert bereits korrekt orientierte Pixel
    }
  }

  if (thumbUrl === null) {
    thumbUrl = await makeThumbnailUrl(workingBlob, orientation, 512)
  }
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

/** Chronologische Grundsortierung: Aufnahmedatum, Tie-Breaker Dateiname */
function chronoCompare(a: { takenAt: number; fileName: string }, b: { takenAt: number; fileName: string }): number {
  return a.takenAt - b.takenAt || a.fileName.localeCompare(b.fileName, 'de', { numeric: true })
}

/**
 * Bild orientieren + komprimieren, mit mehreren Anlaeufen. Bei vielen grossen
 * Fotos kann das Dekodieren einmalig scheitern (Speicherdruck); eine kurze
 * Pause gibt dem Browser Gelegenheit aufzuraeumen.
 */
async function optimizeWithRetry(
  blob: Blob,
  orientation: number,
  opts: OptimizeOptions,
  versuche = 3,
): Promise<OptimizedImage> {
  let letzterFehler: unknown
  for (let v = 0; v < versuche; v++) {
    try {
      const oriented = await loadOriented(blob, orientation)
      try {
        return await optimizeImage(oriented, opts)
      } finally {
        oriented.cleanup()
      }
    } catch (err) {
      letzterFehler = err
      await new Promise((r) => window.setTimeout(r, 250 * (v + 1)))
    }
  }
  throw letzterFehler instanceof Error ? letzterFehler : new Error(String(letzterFehler))
}

let toastCounter = 0

// ---------- App ----------

export default function App() {
  /** Fotos oder Videos - die Angaben zum Termin gelten fuer beides. */
  const [modus, setModus] = useState<'foto' | 'video'>('foto')
  const [terminType, setTerminType] = useState(TERMINARTEN[0])
  const [selectValue, setSelectValue] = useState('')
  const [customName, setCustomName] = useState('')
  const [spPhotoFailed, setSpPhotoFailed] = useState(false)
  const [objectPhoto, setObjectPhoto] = useState<PreparedImage | null>(null)
  const [customerName, setCustomerName] = useState('')
  const [addressInput, setAddressInput] = useState('')
  /** Optionales Termindatum (JJJJ-MM-TT); ueberschreibt die automatische Erkennung */
  const [terminDateInput, setTerminDateInput] = useState('')
  // Nur bei Terminart "Reklamation" sichtbar und nur dann in der PDF
  const [orderNumber, setOrderNumber] = useState('')
  const [assessment, setAssessment] = useState('')
  // Nur bei Terminart "Analysetermin" sichtbar und nur dann in der PDF
  const [summary, setSummary] = useState('')
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
  const spPhotoUrl = spEntry ? spEntry.url : null

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
            const next = [...prev, { ...prepared, hash, id: crypto.randomUUID(), rotation: 0 }]
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

  /** Foto um 90 Grad im Uhrzeigersinn drehen (Vorschau wird neu erzeugt) */
  const rotatePhoto = useCallback(
    async (id: string) => {
      const photo = photosRef.current.find((p) => p.id === id)
      if (!photo) return
      const rotation = (photo.rotation + 90) % 360
      try {
        const thumbUrl = await makeThumbnailUrl(photo.workingBlob, photo.orientation, 512, rotation)
        setPhotos((prev) =>
          prev.map((p) => {
            if (p.id !== id) return p
            URL.revokeObjectURL(p.thumbUrl)
            return { ...p, rotation, thumbUrl }
          }),
        )
      } catch {
        pushToast('error', `Foto konnte nicht gedreht werden: ${photo.fileName}`)
      }
    },
    [pushToast],
  )

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
  const autoTerminDate = useMemo(() => {
    if (included.length === 0) return null
    let max = -Infinity
    for (const p of included) {
      if (p.takenAt > max) max = p.takenAt
    }
    return max
  }, [included])

  // Manuelle Eingabe hat Vorrang (12 Uhr mittags, damit Zeitzonen das Datum nicht kippen)
  const manualTerminDate = useMemo(() => {
    const m = terminDateInput.match(/^(\d{4})-(\d{2})-(\d{2})$/)
    if (!m) return null
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0)
    return Number.isNaN(d.getTime()) ? null : d.getTime()
  }, [terminDateInput])

  const terminDate = manualTerminDate ?? autoTerminDate
  const terminLabel = terminDate != null ? formatDateWeekday(terminDate) : null

  // ---------- PDF ----------

  const busy = importProgress !== null || pdfProgress !== null
  const canCreate = salesperson !== '' && objectPhoto !== null && included.length > 0 && !busy

  const isReklamation = terminType === 'Reklamation'
  const isAnalyse = terminType === 'Analysetermin'
  const hasAssessment = isReklamation && assessment.trim() !== ''
  const hasSummary = isAnalyse && summary.trim() !== ''
  const pageCount = included.length + 1 + (hasAssessment || hasSummary ? 1 : 0)

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

      // 2) Objektadresse: ausschliesslich die manuelle Eingabe (optional)
      const objectAddress: string | null = addressInput.trim() || null

      // Fotos, die sich partout nicht lesen lassen - werden uebersprungen
      const fehlerhafteFotos = new Set<string>()

      // Ein kompletter Durchlauf: Objektfoto + Termin-Fotos optimieren, PDF bauen.
      // Sequenziell und speicherschonend, auch bei 150+ Bildern.
      const buildOnce = async (maxEdge: number, jpegQuality: number, passLabel: string) => {
        const totalSteps = included.length + 2
        setPdfProgress({ label: `Komprimiere Objektfoto${passLabel} …`, done: 1, total: totalSteps })
        const objImage = await optimizeWithRetry(objectPhoto.workingBlob, objectPhoto.orientation, {
          maxEdge,
          quality: jpegQuality,
          sourceType: objectPhoto.sourceType,
        })

        // Jedes Foto wird erst beim Einbetten geladen und danach wieder freigegeben.
        const loadPhoto = async (i: number): Promise<PdfPhoto | null> => {
          const photo = included[i]
          setPdfProgress({
            label: `Komprimiere Bild ${i + 1}/${included.length}${passLabel} …`,
            done: 2 + i,
            total: totalSteps,
          })
          try {
            const image = await optimizeWithRetry(photo.workingBlob, photo.orientation, {
              maxEdge,
              quality: jpegQuality,
              sourceType: photo.sourceType,
              rotate: photo.rotation,
            })
            return { image, takenAt: photo.takenAt, isDuplicate: photo.isDuplicate }
          } catch {
            // Einzelnes unlesbares Foto darf die ganze PDF nicht verhindern
            fehlerhafteFotos.add(photo.fileName)
            return null
          }
        }

        return buildPdf(
          {
            terminType,
            salespersonName: salesperson,
            salespersonImage: spImage,
            objectImage: objImage,
            objectAddress,
            customerName: customerName.trim() || null,
            orderNumber: isReklamation ? orderNumber.trim() || null : null,
            textPage: hasAssessment
              ? {
                  title: 'Fachliche Beurteilung',
                  text: assessment.trim(),
                  note: `Die fachliche Beurteilung wurde durchgeführt von ${salesperson} am ${formatDateShort(Date.now())}.`,
                }
              : hasSummary
                ? {
                    title: 'Zusammenfassung',
                    text: summary.trim(),
                    note: `Die Zusammenfassung wurde erstellt von ${salesperson} am ${formatDateShort(Date.now())}.`,
                  }
                : null,
            photoCount: included.length,
            loadPhoto,
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
        // Ergebnis der vorherigen Stufe vor dem naechsten Durchlauf freigeben
        bytes = new Uint8Array()
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
      // ISOTEC_Terminart_Fotodokumentation_[Kunde]_Datum.pdf
      // Kunde nur, wenn ausgefuellt. Datum = Termindatum (neuestes Foto), nicht heute.
      const fileName =
        [
          'ISOTEC',
          sanitizeFilePart(terminType),
          'Fotodokumentation',
          sanitizeFilePart(customerName),
          fileDate(new Date(terminDate)),
        ]
          .filter((part) => part !== '')
          .join('_') + '.pdf'
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
        `PDF erstellt: ${fileName} (${formatBytes(blob.size)}, ${pageCount - fehlerhafteFotos.size} Seiten)`,
      )
      if (fehlerhafteFotos.size > 0) {
        pushToast(
          'error',
          `${fehlerhafteFotos.size} Foto(s) konnten nicht gelesen werden und fehlen in der PDF: ${[...fehlerhafteFotos].join(', ')}`,
        )
      }
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
    customerName,
    addressInput,
    isReklamation,
    orderNumber,
    hasAssessment,
    assessment,
    hasSummary,
    summary,
    pageCount,
    pushToast,
  ])

  const progress = pdfProgress ?? importProgress

  // ---------- Render ----------

  return (
    <div className="app">
      <header className="header">
        <div className="container header-inner">
          <div className="header-brand">
            <img className="header-logo" src={logoPngUrl} alt="ISOTEC – Immer besser." />
            <span className="header-divider" aria-hidden="true" />
            <div>
              <h1>Dokumentation Analysetermin</h1>
              <p className="header-kicker">{COMPANY}</p>
            </div>
          </div>
          <p className="privacy-note">
            <span aria-hidden="true">🔒</span> Alle Dateien bleiben lokal im Browser – es wird nichts
            hochgeladen.
          </p>
        </div>
      </header>

      <main className="container">
        {/* Fotos oder Videos - die Angaben in den Schritten 1 bis 3 gelten fuer beides */}
        <div className="modus-tabs" role="tablist" aria-label="Art der Dokumentation">
          <button
            type="button"
            role="tab"
            aria-selected={modus === 'foto'}
            className={`modus-tab${modus === 'foto' ? ' is-active' : ''}`}
            onClick={() => setModus('foto')}
          >
            Fotodokumentation
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={modus === 'video'}
            className={`modus-tab${modus === 'video' ? ' is-active' : ''}`}
            onClick={() => setModus('video')}
          >
            Videodokumentation
          </button>
        </div>

        {/* 1: Terminart - nur fuer Fotos. Videos entstehen immer beim Analysetermin. */}
        <section className="card" aria-labelledby="sec-terminart" hidden={modus !== 'foto'}>
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
            <span className="step">{modus === 'foto' ? 2 : 1}</span> Mitarbeiter
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
                  <option key={s.name} value={s.name}>
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

        {/* 3: Objekt - Foto nur fuer die Fotodokumentation, die Angaben gelten fuer beides */}
        <section className="card" aria-labelledby="sec-objekt">
          <h2 id="sec-objekt">
            <span className="step">{modus === 'foto' ? 3 : 2}</span>{' '}
            {modus === 'foto' ? 'Objektfoto (Gebäude)' : 'Angaben zum Objekt'}
          </h2>
          {modus === 'foto' ? (
            <p className="section-hint">Genau 1 Foto (JPG/PNG/HEIC) – erscheint prominent auf dem Deckblatt.</p>
          ) : (
            <p className="section-hint">
              Diese Angaben gelten für Fotos und Videos gleichermaßen – einmal eintragen genügt.
            </p>
          )}
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
            hidden={modus !== 'foto'}
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
          <div className="object-fields">
            <div className="field">
              <label htmlFor="customer-input">Kunde (optional)</label>
              <input
                id="customer-input"
                type="text"
                className="custom-name-input"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="z. B. Familie Mustermann"
              />
            </div>
            <div className="field">
              <label htmlFor="address-input">Objektadresse (optional)</label>
              <input
                id="address-input"
                type="text"
                className="custom-name-input"
                value={addressInput}
                onChange={(e) => setAddressInput(e.target.value)}
                placeholder="z. B. Musterstraße, Krefeld"
              />
            </div>
            {/* Videos bringen ihr Aufnahmedatum selbst mit - hier nur fuer Fotos */}
            {modus === 'foto' && (
              <div className="field">
                <label htmlFor="termindate-input">Termindatum (optional)</label>
                <input
                  id="termindate-input"
                  type="date"
                  className="custom-name-input"
                  value={terminDateInput}
                  onChange={(e) => setTerminDateInput(e.target.value)}
                />
                <p className="field-hint">
                  Leer lassen = Datum kommt automatisch aus den Fotos. Nur ausfüllen, wenn das erkannte
                  Datum nicht stimmt.
                </p>
              </div>
            )}
            {isReklamation && modus === 'foto' && (
              <div className="field">
                <label htmlFor="ordernumber-input">Auftragsnummer (optional)</label>
                <input
                  id="ordernumber-input"
                  type="text"
                  className="custom-name-input"
                  value={orderNumber}
                  onChange={(e) => setOrderNumber(e.target.value)}
                  placeholder="z. B. AB-2026-0815"
                />
              </div>
            )}
            {isReklamation && modus === 'foto' && (
              <>
                <div className="field">
                  <label htmlFor="assessment-input">Beurteilung (optional)</label>
                  <textarea
                    id="assessment-input"
                    className="custom-name-input assessment-input"
                    value={assessment}
                    onChange={(e) => setAssessment(e.target.value)}
                    placeholder="Text der fachlichen Beurteilung einfügen …"
                    rows={1}
                  />
                  <p className="field-hint">
                    Erscheint als eigene Seite „Fachliche Beurteilung" direkt nach dem Deckblatt.
                  </p>
                </div>
              </>
            )}
            {isAnalyse && modus === 'foto' && (
              <div className="field">
                <label htmlFor="summary-input">Zusammenfassung (optional)</label>
                <textarea
                  id="summary-input"
                  className="custom-name-input assessment-input"
                  value={summary}
                  onChange={(e) => setSummary(e.target.value)}
                  placeholder="Text der Zusammenfassung einfügen …"
                  rows={1}
                />
                <p className="field-hint">
                  Erscheint als eigene Seite „Zusammenfassung" direkt nach dem Deckblatt.
                </p>
              </div>
            )}
          </div>
        </section>

        {/* Bleibt beim Umschalten eingehaengt - sonst waeren bereits verarbeitete
            Videos verloren, sobald jemand kurz zu den Fotos wechselt. */}
        <div hidden={modus !== 'video'}>
          <VideoPanel
            mitarbeiter={salesperson}
            mitarbeiterFoto={spPhotoUrl}
            kunde={customerName}
            objektadresse={addressInput}
            onToast={pushToast}
          />
        </div>

        {/* 4: Termin-Fotos */}
        <section className="card" aria-labelledby="sec-fotos" hidden={modus !== 'foto'}>
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
                Ziehen ändern (startet chronologisch). Mit ↻ drehst du ein Foto um 90°.
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
                      <button
                        type="button"
                        className="btn-move btn-rotate"
                        onClick={() => void rotatePhoto(p.id)}
                        title="Um 90° drehen"
                        aria-label={`${p.fileName} um 90 Grad drehen`}
                      >
                        ↻
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
        <section className="card card-action" aria-labelledby="sec-create" hidden={modus !== 'foto'}>
          <h2 id="sec-create" className="visually-hidden">
            PDF erstellen
          </h2>
          {terminLabel && (
            <p className="termin-line">
              Termin {manualTerminDate != null ? '(manuell eingetragen)' : '(aus den Foto-Aufnahmedaten)'}:{' '}
              <strong>{terminLabel}</strong>
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
            PDF erstellen ({pageCount} {pageCount === 1 ? 'Seite' : 'Seiten'})
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
            Verarbeitung zu 100 % lokal im Browser · keine Uploads, kein Tracking, keine Cookies
            <br />
            PDF: ISOTEC_&lt;Terminart&gt;_Fotodokumentation_&lt;Kunde&gt;_&lt;TT.MM.JJJJ&gt;.pdf ·
            Video: ISOTEC_Videodokumentation_&lt;Titel&gt;_&lt;TT.MM.JJJJ&gt;.mp4
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
