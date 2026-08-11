import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PREVIEW_SIZE, renderCover, type CoverData } from './lib/cover'
import {
  fileDate,
  formatBytes,
  formatDateWeekday,
  formatDuration,
  formatPercent,
  percentWidth,
  sanitizeFilePart,
} from './lib/format'
import {
  compressVideo,
  CompressCanceledError,
  isVideoFile,
  probeVideo,
  SIZE_LIMITS,
  type CompressResult,
  type VideoInfo,
} from './lib/video/compress'

/**
 * Seite "Videodokumentation".
 *
 * Kunde, Objektadresse und Mitarbeiter kommen als Eigenschaften herein - sie
 * werden einmal oben im Tool eingetragen und gelten fuer Fotos und Videos.
 * Das Termindatum kommt dagegen aus dem Video selbst: Aufgenommen wird beim
 * Termin, also ist der Aufnahmezeitpunkt das Termindatum.
 */

/** Videos entstehen ausschliesslich beim Analysetermin. */
const TERMINART = 'Analysetermin'

/** Feste Groessengrenze: Craftboxx laesst 40 MB zu, das ist die engste Stelle. */
const TARGET_BYTES = SIZE_LIMITS.craftboxx.bytes

type JobStatus = 'pruefung' | 'wartet' | 'laeuft' | 'fertig'

interface Job {
  id: string
  file: File
  info: VideoInfo | null
  status: JobStatus
  progress: number
  statusText: string
  /** Aufnahmezeitpunkt des Videos = Termindatum */
  datumMs: number
  /** Freier Titel des Videos, geht in den Dateinamen ein */
  titel: string
  /** Selbst gesetzter Dateiname; leer = automatisch */
  nameOverride: string
  result: CompressResult | null
  /** Stand der Angaben, mit dem das Deckblatt gezeichnet wurde */
  coverKey: string
  gespeichert: boolean
  previewUrl: string | null
}

export interface VideoPanelProps {
  mitarbeiter: string
  mitarbeiterFoto: string | null
  kunde: string
  objektadresse: string
  onToast: (kind: 'info' | 'error' | 'success', text: string) => void
}

/** WebCodecs fehlt z. B. in alten iOS-Versionen - dann bleibt nur das Original. */
function canCompress(): boolean {
  return typeof window !== 'undefined' && 'VideoEncoder' in window && 'VideoDecoder' in window
}

function extensionOf(fileName: string): string {
  const match = /\.([A-Za-z0-9]{1,5})$/.exec(fileName)
  return match ? match[1].toLowerCase() : 'mp4'
}

function ensureExtension(name: string, extension: string): string {
  const clean = sanitizeFilePart(name)
  if (!clean) return `Video.${extension}`
  return new RegExp(`\\.${extension}$`, 'i').test(clean)
    ? clean
    : `${clean.replace(/\.[A-Za-z0-9]{1,5}$/, '')}.${extension}`
}

/** ISOTEC_Videodokumentation[_<Titel>|_<Nr>]_<TT.MM.JJJJ>.mp4 */
function buildFileName(titel: string, datumMs: number, index: number, gesamt: number, extension: string): string {
  const parts = ['ISOTEC', 'Videodokumentation']
  const sauber = sanitizeFilePart(titel).replace(/\s+/g, '-')
  if (sauber) parts.push(sauber)
  else if (gesamt > 1) parts.push(String(index + 1).padStart(2, '0'))
  parts.push(fileDate(new Date(datumMs)))
  return `${parts.join('_')}.${extension}`
}

function makeUnique(name: string, taken: Set<string>): string {
  if (!taken.has(name.toLowerCase())) return name
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''
  for (let n = 2; n < 1000; n++) {
    const candidate = `${stem}_${n}${ext}`
    if (!taken.has(candidate.toLowerCase())) return candidate
  }
  return name
}

function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 20_000)
}

function savedPercent(before: number, after: number): string {
  if (!before) return '0 %'
  return `${Math.round((1 - after / before) * 100)} %`
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object' && 'message' in error) return String((error as { message: unknown }).message)
  return String(error)
}

/** Statuszeile nach der Verarbeitung: was ist mit dem Video passiert? */
function describeResult(originalBytes: number, result: CompressResult): string {
  if (!result.compressed) return result.note ?? 'Original bleibt unverändert.'
  const groessen = `${formatBytes(originalBytes)} → ${formatBytes(result.blob.size)}`
  if (result.ueberGrenze) return `${groessen} – passt trotzdem nicht unter 39 MB, das Video ist sehr lang.`
  if (result.verkleinert)
    return `${groessen} (${savedPercent(originalBytes, result.blob.size)} kleiner), Deckblatt ergänzt`
  return `${groessen} – Qualität unverändert, Deckblatt ergänzt`
}

export default function VideoPanel(props: VideoPanelProps) {
  const [jobs, setJobs] = useState<Job[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [queueTick, setQueueTick] = useState(0)

  const busyRef = useRef(false)
  const controllers = useRef(new Map<string, AbortController>())
  const fileInput = useRef<HTMLInputElement>(null)
  const coverCanvas = useRef<HTMLCanvasElement>(null)

  const compressionAvailable = canCompress()

  /** Deckblatt-Angaben ohne Datum - das steckt im jeweiligen Video. */
  const coverBase = useMemo(
    () => ({
      terminart: TERMINART,
      mitarbeiter: props.mitarbeiter.trim(),
      mitarbeiterFoto: props.mitarbeiterFoto,
      kunde: props.kunde.trim(),
      objektadresse: props.objektadresse.trim(),
      auftragsnummer: '',
    }),
    [props.mitarbeiter, props.mitarbeiterFoto, props.kunde, props.objektadresse],
  )

  const coverFor = useCallback(
    (datumMs: number): CoverData => ({ ...coverBase, datumText: formatDateWeekday(datumMs) }),
    [coverBase],
  )
  const coverKeyFor = useCallback((datumMs: number) => JSON.stringify(coverFor(datumMs)), [coverFor])

  // Immer die neuesten Angaben verwenden, ohne die laufende Warteschlange bei
  // jedem Tastendruck neu anzustossen.
  const coverForRef = useRef(coverFor)
  coverForRef.current = coverFor
  const coverKeyForRef = useRef(coverKeyFor)
  coverKeyForRef.current = coverKeyFor

  const updateJob = useCallback((id: string, patch: Partial<Job>) => {
    setJobs((current) => current.map((job) => (job.id === id ? { ...job, ...patch } : job)))
  }, [])

  // ---------- Vorschau des Deckblatts ----------

  // Ohne Video gibt es noch kein Aufnahmedatum - dann der heutige Tag.
  const vorschauDatum = jobs.length > 0 ? jobs[jobs.length - 1].datumMs : Date.now()
  const vorschauCover = useMemo(() => coverFor(vorschauDatum), [coverFor, vorschauDatum])

  useEffect(() => {
    let cancelled = false
    void renderCover(PREVIEW_SIZE.width, PREVIEW_SIZE.height, vorschauCover)
      .then((rendered) => {
        const target = coverCanvas.current
        if (cancelled || !target) return
        target.width = rendered.width
        target.height = rendered.height
        target.getContext('2d')?.drawImage(rendered, 0, 0)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [vorschauCover])

  // ---------- Warteschlange: immer nur ein Video gleichzeitig ----------

  useEffect(() => {
    if (busyRef.current) return
    const next = jobs.find((job) => job.status === 'wartet')
    if (!next) return

    busyRef.current = true
    const controller = new AbortController()
    controllers.current.set(next.id, controller)

    const original = (): CompressResult => ({
      blob: next.file,
      extension: extensionOf(next.file.name),
      compressed: false,
      width: 0,
      height: 0,
    })

    const run = async () => {
      if (!compressionAvailable) {
        updateJob(next.id, {
          status: 'fertig',
          progress: 1,
          result: original(),
          statusText: 'Dieser Browser kann keine Videos umwandeln – das Original bleibt unverändert.',
        })
        return
      }

      updateJob(next.id, { status: 'laeuft', progress: 0, statusText: 'Wird verarbeitet …' })
      const usedCoverKey = coverKeyForRef.current(next.datumMs)
      const usedCover = coverForRef.current(next.datumMs)
      try {
        const result = await compressVideo(next.file, {
          targetBytes: TARGET_BYTES,
          signal: controller.signal,
          onProgress: (fraction) => updateJob(next.id, { progress: fraction }),
          onPhase: (text) => updateJob(next.id, { statusText: text }),
          cover: (width, height) => renderCover(width, height, usedCover),
        })
        updateJob(next.id, {
          status: 'fertig',
          result,
          coverKey: usedCoverKey,
          progress: 1,
          statusText: describeResult(next.file.size, result),
        })
      } catch (error) {
        if (error instanceof CompressCanceledError) return
        updateJob(next.id, {
          status: 'fertig',
          progress: 1,
          result: original(),
          coverKey: usedCoverKey,
          statusText: `Verarbeitung nicht möglich (${describeError(error)}) – das Original bleibt unverändert.`,
        })
      }
    }

    void run().finally(() => {
      controllers.current.delete(next.id)
      busyRef.current = false
      setQueueTick((tick) => tick + 1)
    })
  }, [jobs, queueTick, compressionAvailable, updateJob])

  // ---------- Dateien annehmen ----------

  const addFiles = useCallback(
    async (list: FileList | File[]) => {
      const files = Array.from(list)
      files.filter((file) => !isVideoFile(file)).forEach((file) => {
        props.onToast('error', `Keine Videodatei: ${file.name}`)
      })
      const videos = files.filter(isVideoFile)
      if (videos.length === 0) return

      const created: Job[] = videos.map((file) => ({
        id: crypto.randomUUID(),
        file,
        info: null,
        status: 'pruefung',
        progress: 0,
        statusText: 'Wird gelesen …',
        datumMs: file.lastModified,
        titel: '',
        nameOverride: '',
        result: null,
        coverKey: '',
        gespeichert: false,
        previewUrl: null,
      }))
      setJobs((current) => [...current, ...created])

      // Erst lesen, dann in die Warteschlange: Das Aufnahmedatum steht im
      // Video und muss feststehen, bevor das Deckblatt gezeichnet wird.
      for (const job of created) {
        const info = await probeVideo(job.file)
        setJobs((current) =>
          current.map((entry) =>
            entry.id === job.id
              ? {
                  ...entry,
                  info,
                  datumMs: info?.createdAt ?? entry.file.lastModified,
                  status: 'wartet',
                  statusText: 'Wartet …',
                }
              : entry,
          ),
        )
      }
    },
    [props],
  )

  const removeJob = useCallback((id: string) => {
    controllers.current.get(id)?.abort()
    controllers.current.delete(id)
    setJobs((current) => {
      const job = current.find((entry) => entry.id === id)
      if (job?.previewUrl) URL.revokeObjectURL(job.previewUrl)
      return current.filter((entry) => entry.id !== id)
    })
  }, [])

  const togglePreview = useCallback((id: string) => {
    setJobs((current) =>
      current.map((job) => {
        if (job.id !== id) return job
        if (job.previewUrl) {
          URL.revokeObjectURL(job.previewUrl)
          return { ...job, previewUrl: null }
        }
        return { ...job, previewUrl: URL.createObjectURL(job.result?.blob ?? job.file) }
      }),
    )
  }, [])

  const requeue = useCallback((match: (job: Job) => boolean) => {
    setJobs((current) =>
      current.map((job) =>
        job.status === 'fertig' && match(job)
          ? { ...job, status: 'wartet', progress: 0, result: null, gespeichert: false, statusText: 'Wartet …' }
          : job,
      ),
    )
  }, [])

  // ---------- Dateinamen ----------

  const fileNames = useMemo(() => {
    const taken = new Set<string>()
    const map = new Map<string, string>()
    jobs.forEach((job, index) => {
      const extension = job.result?.extension ?? 'mp4'
      const base = job.nameOverride.trim()
        ? ensureExtension(job.nameOverride, extension)
        : buildFileName(job.titel, job.datumMs, index, jobs.length, extension)
      const unique = makeUnique(base, taken)
      taken.add(unique.toLowerCase())
      map.set(job.id, unique)
    })
    return map
  }, [jobs])

  const saveAll = useCallback(() => {
    const fertige = jobs.filter((job) => job.status === 'fertig')
    fertige.forEach((job, index) => {
      // Kleiner Abstand: sonst unterdrueckt der Browser die weiteren Downloads.
      window.setTimeout(() => {
        saveBlob(job.result?.blob ?? job.file, fileNames.get(job.id) ?? job.file.name)
        updateJob(job.id, { gespeichert: true })
      }, index * 700)
    })
    props.onToast(
      'success',
      `${fertige.length} Video${fertige.length === 1 ? ' wird' : 's werden'} gespeichert – danach ablegen bzw. in MeisterTask anhängen.`,
    )
  }, [jobs, fileNames, updateJob, props])

  // Beim Verlassen laufende Vorgaenge stoppen und Vorschau-URLs freigeben.
  const jobsRef = useRef(jobs)
  jobsRef.current = jobs
  useEffect(() => {
    const running = controllers.current
    return () => {
      running.forEach((controller) => controller.abort())
      jobsRef.current.forEach((job) => {
        if (job.previewUrl) URL.revokeObjectURL(job.previewUrl)
      })
    }
  }, [])

  // ---------- Darstellung ----------

  const fertige = jobs.filter((job) => job.status === 'fertig')
  const busy = jobs.some((job) => job.status !== 'fertig')
  const veraltet = jobs.filter(
    (job) => job.status === 'fertig' && job.coverKey && job.coverKey !== coverKeyFor(job.datumMs),
  )
  const totalOriginal = jobs.reduce((sum, job) => sum + job.file.size, 0)
  const totalResult = jobs.reduce((sum, job) => sum + (job.result?.blob.size ?? job.file.size), 0)

  return (
    <>
      <section className="card" aria-labelledby="sec-deckblatt">
        <h2 id="sec-deckblatt">
          <span className="step">3</span> Deckblatt
        </h2>
        <p className="section-hint">
          Jedes Video beginnt mit diesem Deckblatt (5 Sekunden). Dadurch zeigt die Kachel in MeisterTask,
          Craftboxx und im Explorer sofort, zu welchem Termin das Video gehört – statt eines zufälligen
          ersten Bildes. Das Datum kommt aus dem Video selbst, also vom Tag der Aufnahme.
        </p>
        <figure className="cover-preview">
          <canvas ref={coverCanvas} aria-label="Vorschau des Deckblatts" />
          <figcaption>Aus den Angaben oben – ändert sich mit jeder Eingabe.</figcaption>
        </figure>
      </section>

      <section className="card" aria-labelledby="sec-videos">
        <h2 id="sec-videos">
          <span className="step">4</span> Videos
        </h2>
        <p className="section-hint">
          Alles läuft im Browser: Deckblatt davorsetzen, Drehung korrigieren – und verkleinern <strong>nur,
          wenn das Video über 39 MB liegt</strong> (Grenze von Craftboxx). Was ohnehin passt, behält seine
          Qualität.
        </p>

        {!compressionAvailable && (
          <p className="hint-warn">
            Dieser Browser beherrscht keine Videoumwandlung (WebCodecs fehlt). Die Videos lassen sich trotzdem
            speichern, bleiben aber unverändert groß und ohne Deckblatt. Abhilfe: aktuelles Safari (iOS 17+),
            Chrome oder Edge.
          </p>
        )}

        <input
          ref={fileInput}
          id="video-input"
          className="visually-hidden"
          type="file"
          accept="video/*"
          multiple
          onChange={(event) => {
            if (event.target.files) void addFiles(event.target.files)
            event.target.value = ''
          }}
        />
        <div
          className={`dropzone${dragOver ? ' dropzone-active' : ''}`}
          onDragOver={(event) => {
            event.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(event) => {
            event.preventDefault()
            setDragOver(false)
            void addFiles(event.dataTransfer.files)
          }}
        >
          <p className="dropzone-title">Videos hierher ziehen</p>
          <p className="dropzone-hint">oder</p>
          <button type="button" className="btn-secondary" onClick={() => fileInput.current?.click()}>
            Videos auswählen
          </button>
        </div>

        {veraltet.length > 0 && (
          <p className="hint-warn">
            Die Angaben oben wurden geändert –{' '}
            {veraltet.length === 1 ? 'ein Video zeigt' : `${veraltet.length} Videos zeigen`} noch das alte
            Deckblatt.{' '}
            <button
              type="button"
              className="btn-inline"
              onClick={() => requeue((job) => job.coverKey !== coverKeyFor(job.datumMs))}
            >
              Deckblatt erneuern
            </button>
          </p>
        )}

        {jobs.length > 0 && (
          <ul className="video-list">
            {jobs.map((job) => (
              <li key={job.id}>
                <div className="video-head">
                  <div className="video-info">
                    <p className="file-name">{job.file.name}</p>
                    <p className="file-meta">
                      {[
                        formatBytes(job.file.size),
                        job.info ? formatDuration(job.info.durationSeconds) : null,
                        job.info ? `${job.info.width} × ${job.info.height}` : null,
                        job.info && !job.info.hasAudio ? 'ohne Ton' : null,
                        `Aufnahme: ${formatDateWeekday(job.datumMs)}`,
                        job.result?.compressed ? `→ ${formatBytes(job.result.blob.size)}` : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </div>
                  <div className="video-actions">
                    <button type="button" className="btn-secondary btn-small" onClick={() => togglePreview(job.id)}>
                      {job.previewUrl ? 'Vorschau zu' : '▶ Ansehen'}
                    </button>
                    <button
                      type="button"
                      className="btn-remove"
                      onClick={() => removeJob(job.id)}
                      aria-label={`${job.file.name} entfernen`}
                    >
                      ✕
                    </button>
                  </div>
                </div>

                <div className="video-fields">
                  <div className="field">
                    <label htmlFor={`titel-${job.id}`}>Titel (optional)</label>
                    <input
                      id={`titel-${job.id}`}
                      type="text"
                      className="custom-name-input"
                      value={job.titel}
                      placeholder="z. B. Sanierungsbereich, Außenbereich, Kellerwand Süd"
                      onChange={(event) => updateJob(job.id, { titel: event.target.value })}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor={`name-${job.id}`}>Dateiname (überschreibbar)</label>
                    <input
                      id={`name-${job.id}`}
                      type="text"
                      className="custom-name-input"
                      value={job.nameOverride || (fileNames.get(job.id) ?? '')}
                      onChange={(event) => updateJob(job.id, { nameOverride: event.target.value })}
                    />
                  </div>
                </div>

                {job.status !== 'fertig' && (
                  <div
                    className="video-bar"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(job.progress * 100)}
                  >
                    <span style={{ width: percentWidth(job.progress) }} />
                  </div>
                )}
                <p className={`video-status${job.gespeichert ? ' is-done' : ''}`}>
                  {job.status === 'laeuft' ? `${formatPercent(job.progress)} · ` : ''}
                  {job.statusText}
                  {job.gespeichert ? ' · gespeichert' : ''}
                </p>

                {job.previewUrl && <video className="video-preview" src={job.previewUrl} controls playsInline />}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card card-action" aria-labelledby="sec-video-save">
        <h2 id="sec-video-save">
          <span className="step">5</span> Videos speichern
        </h2>
        {jobs.length > 0 && (
          <p className="section-hint">
            {jobs.length} Video{jobs.length === 1 ? '' : 's'} · vorher {formatBytes(totalOriginal)} · nachher{' '}
            {formatBytes(totalResult)}
          </p>
        )}
        <button type="button" className="btn-primary" disabled={busy || fertige.length === 0} onClick={saveAll}>
          {busy
            ? 'Verarbeitung läuft …'
            : `Alle ${fertige.length} Video${fertige.length === 1 ? '' : 's'} speichern`}
        </button>
        {jobs.length === 0 && <p className="field-hint">Noch keine Videos ausgewählt.</p>}
      </section>
    </>
  )
}
