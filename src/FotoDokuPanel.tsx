import { useCallback, useMemo, useRef, useState } from 'react'
import { sha256Hex } from './lib/hash'
import { makeThumbnailUrl, optimizeCircle, type OptimizedImage } from './lib/image'
import { buildPdf, type PdfPhoto } from './lib/pdf'
import { formatBytes, formatDateShort, formatDateTime, formatDateWeekday, fileDate, sanitizeFilePart } from './lib/format'
import {
  ACCEPT,
  EXTRA_LADDER,
  EXTRA_TARGET_BYTES,
  JPEG_QUALITY,
  MAX_EDGE,
  chronoCompare,
  isSupported,
  optimizeWithRetry,
  prepareImage,
  type Progress,
  type TerminPhoto,
} from './lib/bilder'
import teamJpgUrl from './assets/team.jpg'
import logoPngUrl from './assets/isotec-logo.png'
import { speichereDatei, teileDateien, typTeilbar } from './lib/share'
import {
  TERMINARTEN,
  manuellesTermindatum,
  mitarbeiterVon,
  objektadresseEcht,
  objektadresseText,
  type DokumentFn,
  type Kundendaten,
  type Terminart,
  type ToastFn,
} from './kunde'

/** Auf dem Handy kann die PDF geteilt werden, am Rechner wird heruntergeladen. */
const PDF_TEILBAR = typTeilbar('application/pdf', 'dokument.pdf')

/**
 * Fotostrecke als PDF, in zwei Ausfuehrungen:
 * - fotodoku: die Fotodokumentation zum Analysetermin oder zur Reklamation
 *   (Terminart wird hier gewaehlt), mit Zusammenfassung bzw. Beurteilung.
 * - prinzipskizze: eigene Seite mit eigener Fotostrecke; auf dem Deckblatt
 *   entfaellt die Unterzeile "Fotodokumentation", der Dateiname folgt einem
 *   eigenen Schema, die Sonderfelder der Reklamation bleiben aussen vor.
 * Mitarbeiter, Objektfoto und alle Angaben kommen von der Seite Kunde.
 */
export type FotoDokuArt = 'fotodoku' | 'prinzipskizze'

export interface FotoDokuPanelProps {
  art: FotoDokuArt
  kunde: Kundendaten
  onToast: ToastFn
  onDokument: DokumentFn
}

export default function FotoDokuPanel({ art, kunde, onToast, onDokument }: FotoDokuPanelProps) {
  const [terminart, setTerminart] = useState<Terminart>('Analysetermin')
  const [photos, setPhotos] = useState<TerminPhoto[]>([])
  const [keepDuplicates, setKeepDuplicates] = useState(false)
  const [extraCompression, setExtraCompression] = useState(true)
  const [importProgress, setImportProgress] = useState<Progress | null>(null)
  const [pdfProgress, setPdfProgress] = useState<Progress | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [fertigePdf, setFertigePdf] = useState<{ blob: Blob; fileName: string } | null>(null)
  // Reklamation: Beurteilung; Analysetermin und Prinzipskizze: Zusammenfassung.
  // Beide bleiben erhalten, wenn die Terminart wechselt.
  const [assessment, setAssessment] = useState('')
  const [summary, setSummary] = useState('')
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

  const istSkizze = art === 'prinzipskizze'
  const terminType = istSkizze ? 'Prinzipskizze' : terminart
  const quelle = istSkizze ? 'Prinzipskizze' : 'Fotodokumentation'
  const isReklamation = !istSkizze && terminart === 'Reklamation'
  const mitarbeiter = mitarbeiterVon(kunde)
  const objectPhoto = kunde.objektfoto

  // ---------- Termin-Fotos ----------

  const addFiles = useCallback(
    async (list: FileList | File[]) => {
      const files = Array.from(list)
      files.filter((f) => !isSupported(f)).forEach((f) => {
        onToast('error', `Nicht unterstütztes Format: ${f.name}`)
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
            onToast('info', `Duplikat erkannt: ${file.name}`)
          }
          knownHashes.add(hash)
          setPhotos((prev) => {
            const next = [...prev, { ...prepared, hash, id: crypto.randomUUID(), rotation: 0 }]
            return orderTouchedRef.current ? next : next.sort(chronoCompare)
          })
        } catch (err) {
          onToast('error', err instanceof Error ? err.message : `Fehler bei ${file.name}`)
        }
      }
      setImportProgress(null)
      if (noExifCount > 0) {
        onToast('info', `Kein EXIF-Datum bei ${noExifCount} Foto(s) gefunden – verwende Dateidatum.`)
      }
      if (duplicateCount > 0 && !keepDuplicates) {
        onToast('info', `${duplicateCount} Duplikat(e) werden von der PDF ausgeschlossen.`)
      }
    },
    [keepDuplicates, onToast],
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
        onToast('error', `Foto konnte nicht gedreht werden: ${photo.fileName}`)
      }
    },
    [onToast],
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

  // Manuelle Eingabe auf der Seite Kunde hat Vorrang
  const manualTerminDate = manuellesTermindatum(kunde)
  const terminDate = manualTerminDate ?? autoTerminDate
  const terminLabel = terminDate != null ? formatDateWeekday(terminDate) : null

  // ---------- PDF ----------

  const busy = importProgress !== null || pdfProgress !== null
  const canCreate = mitarbeiter.name !== '' && objectPhoto !== null && included.length > 0 && !busy

  const hasAssessment = isReklamation && assessment.trim() !== ''
  const hasSummary = !isReklamation && summary.trim() !== ''
  const pageCount = included.length + 1 + (hasAssessment || hasSummary ? 1 : 0)

  const missingHints: string[] = []
  if (!mitarbeiter.name) missingHints.push('Mitarbeiter auf der Seite Kunde wählen')
  if (!objectPhoto) missingHints.push('Objektfoto auf der Seite Kunde hochladen')
  if (included.length === 0) missingHints.push(istSkizze ? 'mind. 1 Bild hinzufügen' : 'mind. 1 Foto hinzufügen')

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
      if (mitarbeiter.foto) {
        try {
          const res = await fetch(mitarbeiter.foto)
          const type = res.headers.get('content-type') ?? ''
          if (res.ok && type.startsWith('image/')) {
            spImage = await optimizeCircle(await res.blob(), 1, 360)
          }
        } catch {
          // Platzhalter mit Initialen wird verwendet
        }
      }

      // 2) Objektadresse: bei gleicher Anschrift der Verweis auf die Kundenadresse
      const objectAddress: string | null = objektadresseText(kunde) || null

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
            salespersonName: mitarbeiter.name,
            salespersonImage: spImage,
            objectImage: objImage,
            objectAddress,
            customerName: kunde.kunde.trim() || null,
            customerAddress: kunde.kundenadresse.trim() || null,
            orderNumber: isReklamation ? kunde.auftragsnummer.trim() || null : null,
            gewerke: kunde.gewerke,
            textPage: hasAssessment
              ? {
                  title: 'Fachliche Beurteilung',
                  text: assessment.trim(),
                  note: `Die fachliche Beurteilung wurde durchgeführt von ${mitarbeiter.name} am ${formatDateShort(Date.now())}.`,
                }
              : hasSummary
                ? {
                    title: 'Zusammenfassung',
                    text: summary.trim(),
                    note: `Die Zusammenfassung wurde erstellt von ${mitarbeiter.name} am ${formatDateShort(Date.now())}.`,
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
        onToast(
          'info',
          `PDF ist trotz maximaler Komprimierung ${formatBytes(bytes.length)} groß (Ziel: unter 10 MB).`,
        )
      }

      const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' })
      // ISOTEC_Terminart_Fotodokumentation_[Kunde]_Datum.pdf
      // Kunde nur, wenn ausgefuellt. Datum = Termindatum (neuestes Foto), nicht heute.
      // Prinzipskizze weicht ab: "ISOTEC Prinzipskizze_Objektadresse.pdf",
      // die Adresse entfaellt bei leerem Feld.
      const fileName = istSkizze
        ? ['ISOTEC Prinzipskizze', sanitizeFilePart(objektadresseEcht(kunde))]
            .filter((part) => part !== '')
            .join('_') + '.pdf'
        : [
            'ISOTEC',
            sanitizeFilePart(terminType),
            'Fotodokumentation',
            sanitizeFilePart(kunde.kunde),
            fileDate(new Date(terminDate)),
          ]
            .filter((part) => part !== '')
            .join('_') + '.pdf'
      // Auf dem Handy nicht sofort herunterladen: Ein Download landet dort
      // unauffindbar unter "Dateien / Downloads". Stattdessen erscheint ein
      // Teilen-Knopf, denn navigator.share braucht einen eigenen Klick.
      setFertigePdf({ blob, fileName })
      onDokument(`pdf:${art}`, quelle, new File([blob], fileName, { type: 'application/pdf' }))
      if (!PDF_TEILBAR) speichereDatei(blob, fileName)
      onToast(
        'success',
        `PDF erstellt: ${fileName} (${formatBytes(blob.size)}, ${pageCount - fehlerhafteFotos.size} Seiten)`,
      )
      if (fehlerhafteFotos.size > 0) {
        onToast(
          'error',
          `${fehlerhafteFotos.size} Foto(s) konnten nicht gelesen werden und fehlen in der PDF: ${[...fehlerhafteFotos].join(', ')}`,
        )
      }
    } catch (err) {
      onToast('error', `PDF konnte nicht erstellt werden: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setPdfProgress(null)
    }
  }, [
    canCreate,
    objectPhoto,
    included,
    mitarbeiter.foto,
    mitarbeiter.name,
    terminType,
    terminDate,
    terminLabel,
    extraCompression,
    kunde.kunde,
    kunde.objektadresse,
    kunde.kundenadresse,
    kunde.auftragsnummer,
    kunde.gewerke,
    isReklamation,
    istSkizze,
    hasAssessment,
    assessment,
    hasSummary,
    summary,
    pageCount,
    art,
    quelle,
    onToast,
    onDokument,
  ])

  const progress = pdfProgress ?? importProgress

  // ---------- Render ----------

  return (
    <div className={`fotodoku fotodoku-${art}`}>
      {/* Angaben zum Dokument: Terminart (nur Fotodokumentation) und die Textseite */}
      <section className="card" aria-labelledby={`${art}-titel`}>
        <div className="karte-kopf">
          <h2 id={`${art}-titel`}>{istSkizze ? 'Prinzipskizze' : 'Fotodokumentation'}</h2>
          <p>Mitarbeiter, Objektfoto und Kundendaten kommen von der Seite Kunde.</p>
        </div>
        <div className="felder">
          {!istSkizze && (
            <div className="eingabe">
              <label htmlFor="terminart-select">Terminart</label>
              <select
                id="terminart-select"
                value={terminart}
                onChange={(e) => setTerminart(e.target.value as Terminart)}
              >
                {TERMINARTEN.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="eingabe eingabe-breit">
            {isReklamation ? (
              <>
                <label htmlFor={`${art}-assessment-input`}>Beurteilung (eigene Seite nach dem Deckblatt)</label>
                <textarea
                  id={`${art}-assessment-input`}
                  className="assessment-input"
                  value={assessment}
                  onChange={(e) => setAssessment(e.target.value)}
                  placeholder="Text der fachlichen Beurteilung einfügen …"
                  rows={3}
                />
              </>
            ) : (
              <>
                <label htmlFor={`${art}-summary-input`}>Zusammenfassung (eigene Seite nach dem Deckblatt)</label>
                <textarea
                  id={`${art}-summary-input`}
                  className="assessment-input"
                  value={summary}
                  onChange={(e) => setSummary(e.target.value)}
                  placeholder="Text der Zusammenfassung einfügen …"
                  rows={3}
                />
              </>
            )}
          </div>
        </div>
      </section>

      {/* Fotos */}
      <section className="card" aria-labelledby={`${art}-fotos`}>
        <div className="karte-kopf">
          <h2 id={`${art}-fotos`}>{istSkizze ? 'Bilder' : 'Fotos'}</h2>
          {annotated.length > 0 && (
            <p aria-live="polite">
              {annotated.length} importiert
              {duplicateTotal > 0 &&
                ` · ${duplicateTotal} Duplikat(e)${keepDuplicates ? ' (bleiben enthalten)' : ' ausgeschlossen'}`}
              {' '}· {included.length} in der PDF · Reihenfolge = Seitenfolge, per Pfeil oder Ziehen ändern
            </p>
          )}
        </div>
        <div
          className={`dropzone dropzone-zeile${dragOver ? ' dropzone-active' : ''}`}
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
          {duplicateTotal > 0 && (
            <label className="checkbox">
              <input
                type="checkbox"
                checked={keepDuplicates}
                onChange={(e) => setKeepDuplicates(e.target.checked)}
              />
              Duplikate behalten
            </label>
          )}
        </div>

        {annotated.length > 0 && (
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
                    {p.dateSource === 'name' && (
                      <span className="badge" title="Kein EXIF-Datum gefunden - Aufnahmezeit aus dem Dateinamen gelesen">
                        Dateiname
                      </span>
                    )}
                    {p.dateSource === 'file' && (
                      <span className="badge badge-warn" title="Kein EXIF-Datum gefunden – Dateidatum wird verwendet">
                        Dateidatum
                      </span>
                    )}
                    {p.convertedFromHeic && <span className="badge">HEIC</span>}
                    {p.isDuplicate && <span className="badge badge-dup">Duplikat von {p.duplicateOf}</span>}
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
        )}
      </section>

      {/* PDF erstellen (Komprimierung ist fest eingestellt: 2200 px, Qualität 0,75) */}
      <section className="card aktion" aria-labelledby={`${art}-create`}>
        <h2 id={`${art}-create`} className="visually-hidden">
          PDF erstellen
        </h2>
        <div className="aktion-zeile">
          <div className="aktion-links">
            <label className="checkbox">
              <input
                type="checkbox"
                checked={extraCompression}
                onChange={(e) => setExtraCompression(e.target.checked)}
              />
              Extra Komprimierung (unter 10 MB)
            </label>
            {terminLabel && (
              <p className="termin-line">
                Termin: <strong>{terminLabel}</strong>
                {manualTerminDate == null && <span className="eingabe-hinweis-inline"> (aus den Fotos)</span>}
              </p>
            )}
            {!canCreate && !busy && missingHints.length > 0 && (
              <p className="hint-missing">Noch offen: {missingHints.join(' · ')}</p>
            )}
          </div>
          <button type="button" className="btn-primary" disabled={!canCreate} onClick={() => void handleCreatePdf()}>
            PDF erstellen ({pageCount} {pageCount === 1 ? 'Seite' : 'Seiten'})
          </button>
        </div>
        {fertigePdf && (
          <div className="ergebnis">
            <p className="ergebnis-name">
              {fertigePdf.fileName} ({formatBytes(fertigePdf.blob.size)})
            </p>
            <div className="ergebnis-knoepfe">
              {PDF_TEILBAR && (
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() =>
                    void teileDateien(
                      [new File([fertigePdf.blob], fertigePdf.fileName, { type: 'application/pdf' })],
                      quelle,
                    ).then((ergebnis) => {
                      if (ergebnis === 'nicht moeglich') {
                        onToast('error', 'Teilen hat nicht geklappt, die PDF wird stattdessen gespeichert.')
                        speichereDatei(fertigePdf.blob, fertigePdf.fileName)
                      }
                    })
                  }
                >
                  PDF teilen
                </button>
              )}
              <button
                type="button"
                className="btn-secondary"
                onClick={() => speichereDatei(fertigePdf.blob, fertigePdf.fileName)}
              >
                Speichern
              </button>
            </div>
          </div>
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
    </div>
  )
}
