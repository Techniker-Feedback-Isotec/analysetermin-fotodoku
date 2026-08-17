import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  Conversion,
  ConversionCanceledError,
  Input,
  Mp4OutputFormat,
  Output,
  Quality,
  VideoSample,
  canEncodeAudio,
  canEncodeVideo,
  getFirstEncodableVideoCodec,
  type VideoCodec,
} from 'mediabunny'

/**
 * Komprimierung im Browser - ohne Server, ohne Upload der Rohdatei.
 *
 * Grundlage ist WebCodecs: Der Browser dekodiert und kodiert mit der Hardware
 * des Geraets. Gelesen wird stueckweise aus der Datei, es liegt also nie das
 * ganze Video im Speicher - wichtig auf dem Handy.
 *
 * Leitgedanke: **so wenig verkleinern wie noetig.** Passt ein Video ohnehin in
 * die Groessengrenze, behaelt es seine Qualitaet; nur zu grosse Videos werden
 * so weit heruntergerechnet, dass sie knapp unter die Grenze rutschen.
 *
 * Und im Zweifel gewinnt das Original: Ein zu grosses Video ist immer noch
 * besser als ein kaputtes oder gar keins.
 */

/** Groessengrenzen der Systeme, in die die Videos anschliessend wandern. */
/**
 * Groessengrenzen der Systeme, in die die Videos anschliessend wandern.
 *
 * `limit` ist die echte Grenze des Zielsystems, `plan` das Ziel, mit dem
 * gerechnet wird. Der Abstand dazwischen ist Absicht: Der Encoder trifft eine
 * Vorgabe nie auf das Byte genau, und bei kurzen, bewegten Aufnahmen lag er in
 * Tests deutlich darueber. Gewarnt wird erst, wenn `limit` gerissen ist.
 *
 * Alles in glatten Millionen Bytes: Craftboxx nennt 40 MB und meint damit sehr
 * wahrscheinlich Dezimal-Megabyte, nicht 40 MiB.
 */
export const SIZE_LIMITS = {
  craftboxx: {
    label: 'Bis 40 MB',
    hint: 'passt in Craftboxx und MeisterTask',
    plan: 36_000_000,
    limit: 40_000_000,
  },
  meistertask: {
    label: 'Bis 200 MB',
    hint: 'nur MeisterTask (Pro/Business)',
    plan: 180_000_000,
    limit: 200_000_000,
  },
  keine: {
    label: 'Ohne Begrenzung',
    hint: 'bestmögliche Qualität',
    plan: 0,
    limit: 0,
  },
} as const

export type SizeLimit = keyof typeof SIZE_LIMITS

/** Bilder pro Sekunde im Ergebnis; Handys nehmen oft mit 60 auf, das braucht hier niemand. */
const TARGET_FPS = 30

/** Abstand der Schluesselbilder in Sekunden - kleiner Wert = fluessiges Springen im Video. */
const KEYFRAME_INTERVAL = 2

/** Laenge des vorangestellten Deckblatts in Sekunden. */
export const COVER_SECONDS = 5

/**
 * Anzahl der Standbilder des Deckblatts. Ein einziges Bild mit mehreren
 * Sekunden Laufzeit bringt manche Player durcheinander; mehrere gleiche Bilder
 * kosten dank Bewegungskompensation praktisch nichts.
 */
const COVER_FRAMES = 10

/** Bitrate, mit der wir Ton neu kodieren (nur mit Deckblatt noetig). */
const AUDIO_BITRATE = 96_000

/**
 * Annahme fuer durchgereichten Ton. Handys nehmen mit deutlich mehr als
 * 96 kbit/s auf; wird zu niedrig gerechnet, reisst das Ergebnis die
 * Groessengrenze und es braucht einen zweiten Durchgang.
 */
const AUDIO_BITRATE_DURCHGEREICHT = 192_000

/** Darunter wird das Bild unbrauchbar - dann lieber die Groessengrenze reissen. */
const MIN_VIDEO_BITRATE = 350_000

/**
 * Obergrenze der Aufloesung. 4K bringt bei diesen Bitraten nichts ausser
 * Rechenzeit; Full HD ist fuer die Beurteilung eines Schadens reichlich.
 */
const MAX_EDGE = 1920

/**
 * Aufloesungsstufen mit der Bitrate, ab der sie sich lohnen. Wer wenig Bits
 * hat, faehrt mit weniger Pixeln besser - 720p bei 1 Mbit/s sieht deutlich
 * besser aus als 1080p bei 1 Mbit/s.
 */
const RESOLUTION_STEPS: Array<{ edge: number; minBitrate: number }> = [
  { edge: 1920, minBitrate: 2_500_000 },
  { edge: 1280, minBitrate: 1_200_000 },
  { edge: 854, minBitrate: 600_000 },
  { edge: 640, minBitrate: 0 },
]

export interface VideoInfo {
  durationSeconds: number
  width: number
  height: number
  /** Codec-Kurzname des Originals, z. B. "hevc" */
  codec: string | null
  hasAudio: boolean
  /**
   * Aufnahmezeitpunkt aus den Metadaten der Datei, sonst null. Handys schreiben
   * ihn beim Aufnehmen hinein - und aufgenommen wird beim Termin.
   */
  createdAt: number | null
}

export interface CompressResult {
  blob: Blob
  extension: string
  /** true = neu kodiert, false = Original unveraendert uebernommen */
  compressed: boolean
  width: number
  height: number
  /** Erklaerung, falls nicht komprimiert wurde */
  note?: string
  /** true, wenn die Qualitaet wegen der Groessengrenze gesenkt wurde */
  verkleinert?: boolean
  /** true, wenn die Grenze trotz allem nicht eingehalten werden konnte */
  ueberGrenze?: boolean
}

export class CompressCanceledError extends Error {
  constructor() {
    super('Komprimierung abgebrochen.')
    this.name = 'CompressCanceledError'
  }
}

export interface Geraetecheck {
  /** Browser beherrscht WebCodecs überhaupt */
  webcodecs: boolean
  /** H.264 lässt sich erzeugen (Bild) */
  h264: boolean
  /** AAC lässt sich erzeugen (Ton). Ohne das gibt es kein Deckblatt. */
  aac: boolean
}

/**
 * Was kann dieses Gerät wirklich? Wird in der Oberfläche angezeigt, damit bei
 * einem Problem nicht geraten werden muss, woran es lag.
 */
export async function geraetecheck(): Promise<Geraetecheck> {
  const webcodecs = typeof window !== 'undefined' && 'VideoEncoder' in window && 'VideoDecoder' in window
  if (!webcodecs) return { webcodecs: false, h264: false, aac: false }
  const [h264, aac] = await Promise.all([
    canEncodeVideo('avc', { width: 1280, height: 720 }).catch(() => false),
    canEncodeAudio('aac').catch(() => false),
  ])
  return { webcodecs, h264, aac }
}

export function isVideoFile(file: File): boolean {
  if (file.type.toLowerCase().startsWith('video/')) return true
  return /\.(mp4|mov|m4v|avi|mkv|webm|3gp|mpg|mpeg)$/i.test(file.name)
}

/**
 * Zielbitrate als Quality-Objekt. Wichtig: `new Quality(2_000_000)` waere eine
 * *Qualitaetsstufe* (0 bis 1) und keine Bitrate - das ergibt riesige Dateien.
 */
function bitrateQuality(bitsPerSecond: number): Quality {
  return new Quality({ bitrate: Math.round(bitsPerSecond), bitrateMode: 'variable' })
}

/**
 * Fuer das Bild: konstante Bitrate. Mit variabler Bitrate lag das Ergebnis bei
 * bewegtem Material regelmaessig 15 Prozent ueber der Vorgabe und riss damit
 * die Groessengrenze. Planbare Groesse ist hier wichtiger als das letzte
 * Quaentchen Qualitaet in ruhigen Szenen.
 */
function videoQuality(bitsPerSecond: number): Quality {
  return new Quality({ bitrate: Math.round(bitsPerSecond), bitrateMode: 'constant' })
}

/** Liest Laenge und Bildgroesse, ohne die Datei zu verarbeiten. */
export async function probeVideo(file: File): Promise<VideoInfo | null> {
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) })
  try {
    const track = await input.getPrimaryVideoTrack()
    if (!track) return null

    const audio = await input.getPrimaryAudioTrack()
    const metaDuration = await input.getDurationFromMetadata()
    const duration = metaDuration ?? (await input.computeDuration())

    let createdAt: number | null = null
    try {
      const tags = await input.getMetadataTags()
      const time = tags.date?.getTime()
      if (time !== undefined && Number.isFinite(time)) createdAt = time
    } catch {
      createdAt = null
    }

    return {
      durationSeconds: duration,
      width: track.displayWidth,
      height: track.displayHeight,
      codec: track.codec,
      hasAudio: audio !== null,
      createdAt,
    }
  } catch {
    return null
  } finally {
    input.dispose()
  }
}

/** Zielgroesse: laengste Kante auf maxEdge begrenzen, nie vergroessern, gerade Zahlen. */
export function targetSize(width: number, height: number, maxEdge: number): { width: number; height: number } {
  const longest = Math.max(width, height)
  const scale = longest > maxEdge ? maxEdge / longest : 1
  const even = (value: number) => Math.max(2, Math.round((value * scale) / 2) * 2)
  return { width: even(width), height: even(height) }
}

export interface CompressOptions {
  /** Planungsziel in Bytes, mit Reserve zur echten Grenze; 0 = keine Begrenzung. */
  targetBytes: number
  /** Echte Grenze des Zielsystems in Bytes; erst darueber wird gewarnt. */
  limitBytes: number
  onProgress?: (fraction: number) => void
  signal?: AbortSignal
  /**
   * Liefert das Deckblatt in der Groesse des fertigen Videos. Es wird dem Video
   * vorangestellt, damit jede Vorschau den Termin zeigt.
   */
  cover?: (width: number, height: number) => Promise<CanvasImageSource>
  /** Meldet den aktuellen Arbeitsschritt fuer die Statuszeile. */
  onPhase?: (text: string) => void
}

interface EncodingPlan {
  bitrate: number
  maxEdge: number
  /** true, wenn die Groessengrenze die Qualitaet gedrueckt hat */
  verkleinert: boolean
}

function edgeForBitrate(bitrate: number): number {
  return RESOLUTION_STEPS.find((step) => bitrate >= step.minBitrate)?.edge ?? 640
}

/**
 * Obergrenze der Bitrate, ab der mehr Bits nichts Sichtbares mehr bringen:
 * 10 Mbit/s fuer Full HD, anteilig weniger bei kleineren Bildern. Handykameras
 * nehmen mit einem Vielfachen davon auf - ohne diesen Deckel wuerde ein
 * ohnehin kleines Video beim Neukodieren groesser statt kleiner.
 */
function qualityCap(width: number, height: number): number {
  const pixels = Math.max(1, width * height)
  return Math.max(2_000_000, (10_000_000 * pixels) / (1920 * 1080))
}

/**
 * Bitrate und Aufloesung festlegen.
 *
 * Passt das Video ohnehin in die Grenze, wird die Bitrate des Originals
 * uebernommen (plus etwas Luft gegen Qualitaetsverlust beim Neukodieren) - es
 * wird also nichts verschlechtert. Erst ein zu grosses Video wird auf das
 * heruntergerechnet, was die Grenze hergibt.
 */
function planEncoding(args: {
  fileBytes: number
  durationSeconds: number
  totalDuration: number
  targetBytes: number
  width: number
  height: number
  /** Platz, den die Tonspur im Ergebnis belegen wird */
  audioBitrate: number
}): EncodingPlan {
  const sourceBitrate =
    args.durationSeconds > 0 ? (args.fileBytes * 8) / args.durationSeconds - args.audioBitrate : 0
  const cap = qualityCap(Math.min(args.width, MAX_EDGE), Math.min(args.height, MAX_EDGE))
  const beste = Math.max(MIN_VIDEO_BITRATE, Math.min(sourceBitrate, cap))

  if (!args.targetBytes || args.totalDuration <= 0) {
    return { bitrate: beste, maxEdge: MAX_EDGE, verkleinert: false }
  }

  // 12 Prozent Abschlag fuer Containerdaten und die Ungenauigkeit des Encoders:
  // bei bewegtem Material liegt eine variable Bitrate spuerbar ueber dem Ziel.
  const budget = (args.targetBytes * 8 * 0.88) / args.totalDuration - args.audioBitrate

  if (budget >= beste) {
    // Es passt ohnehin: volle Qualitaet, keine Verkleinerung der Aufloesung.
    return { bitrate: beste, maxEdge: MAX_EDGE, verkleinert: false }
  }

  const bitrate = Math.max(MIN_VIDEO_BITRATE, budget)
  return {
    bitrate,
    maxEdge: Math.min(MAX_EDGE, edgeForBitrate(bitrate)),
    verkleinert: true,
  }
}

export async function compressVideo(file: File, options: CompressOptions): Promise<CompressResult> {
  const original: CompressResult = {
    blob: file,
    extension: extensionOf(file.name),
    compressed: false,
    width: 0,
    height: 0,
  }

  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) })

  try {
    const videoTrack = await input.getPrimaryVideoTrack()
    if (!videoTrack) {
      return { ...original, note: 'Keine Videospur gefunden - die Datei bleibt unveraendert.' }
    }
    if (!(await videoTrack.canDecode())) {
      return { ...original, note: 'Dieser Browser kann das Format nicht lesen - das Original bleibt unveraendert.' }
    }

    const sourceDuration = (await input.getDurationFromMetadata()) ?? (await input.computeDuration())

    /**
     * Das Deckblatt verschiebt Bild und Ton um fünf Sekunden. Für den Ton
     * bedeutet das zwingend eine Neukodierung, denn eine unveränderte Tonspur
     * kann mediabunny nur eins zu eins durchreichen. Kann das Gerät kein AAC
     * erzeugen, würde die Tonspur wegfallen und die ganze Umwandlung wäre
     * hinfällig. Dann lieber ohne Deckblatt verkleinern: eine kleine Datei ohne
     * Vorspann ist mehr wert als eine riesige mit.
     */
    let coverErlaubt = Boolean(options.cover)
    let coverHinweis: string | undefined
    const audioTrack = await input.getPrimaryAudioTrack()
    if (coverErlaubt && audioTrack) {
      // Mit genau den Werten fragen, die die Umwandlung anschliessend verwendet.
      // Eine Abfrage mit Standardwerten koennte anders ausfallen als die
      // Entscheidung, die mediabunny spaeter selbst trifft.
      const tonGeht = await canEncodeAudio('aac', {
        numberOfChannels: audioTrack.numberOfChannels,
        sampleRate: audioTrack.sampleRate,
        quality: bitrateQuality(AUDIO_BITRATE),
      }).catch(() => false)
      if (!tonGeht) {
        coverErlaubt = false
        coverHinweis = 'Ohne Deckblatt, weil dieses Gerät keinen Ton neu kodieren kann.'
      }
    }

    const totalDuration = sourceDuration + (coverErlaubt ? COVER_SECONDS : 0)

    /**
     * Platz fuer die Tonspur. Mit Deckblatt kodieren wir sie selbst und kennen
     * die Bitrate. Ohne Deckblatt wird sie unveraendert durchgereicht, dann
     * wird sie gemessen statt geschaetzt: Handyaufnahmen liegen teils weit
     * ueber dem, was man erwarten wuerde, und jede Fehlannahme geht direkt zu
     * Lasten der Bildqualitaet oder reisst die Groessengrenze.
     */
    const audioDurchgereicht = audioTrack
      ? await audioTrack
          .computePacketStats(200)
          .then((stats) => stats.averageBitrate)
          .catch(() => AUDIO_BITRATE_DURCHGEREICHT)
      : 0
    const audioBitrate = !audioTrack ? 0 : coverErlaubt ? AUDIO_BITRATE : audioDurchgereicht

    let plan = planEncoding({
      fileBytes: file.size,
      durationSeconds: sourceDuration,
      totalDuration,
      targetBytes: options.targetBytes,
      width: videoTrack.displayWidth,
      height: videoTrack.displayHeight,
      audioBitrate,
    })

    let attempt = 0
    let best: { buffer: ArrayBuffer; width: number; height: number } | null = null

    // Hoechstens zwei Durchlaeufe: der erste rechnet die Bitrate aus der
    // Laufzeit, der zweite korrigiert, falls der Encoder darueber lag.
    for (;;) {
      attempt++
      const size = targetSize(videoTrack.displayWidth, videoTrack.displayHeight, plan.maxEdge)
      const codec = await getFirstEncodableVideoCodec(['avc'], {
        width: size.width,
        height: size.height,
        quality: videoQuality(plan.bitrate),
      })
      if (!codec) {
        return { ...original, note: 'Dieser Browser kann kein H.264 erzeugen - das Original bleibt unveraendert.' }
      }

      /**
       * Das Deckblatt ist das einzige, wofuer der Ton neu kodiert werden muss.
       * Scheitert daran die ganze Umwandlung, wird ohne Deckblatt weitergemacht:
       * Dann wird der Ton unveraendert durchgereicht und braucht gar keinen
       * Encoder. Ein verkleinertes Video ohne Vorspann ist deutlich mehr wert
       * als ein unveraendertes mit.
       */
      let pass: PassResult
      if (coverErlaubt) {
        try {
          pass = await runConversion({ input, options, size, codec, bitrate: plan.bitrate, coverErlaubt: true })
        } catch {
          pass = { kind: 'failed', note: 'Ton konnte nicht neu kodiert werden.' }
        }
        if (pass.kind === 'failed') {
          coverErlaubt = false
          coverHinweis = 'Ohne Deckblatt, weil dieses Gerät den Ton nicht neu kodieren kann.'
          // Neu rechnen: ohne Deckblatt ist das Video kuerzer, und der
          // durchgereichte Ton braucht mehr Platz als ein neu kodierter.
          plan = planEncoding({
            fileBytes: file.size,
            durationSeconds: sourceDuration,
            totalDuration: sourceDuration,
            targetBytes: options.targetBytes,
            width: videoTrack.displayWidth,
            height: videoTrack.displayHeight,
            audioBitrate: audioDurchgereicht,
          })
          attempt-- // dieser Anlauf zaehlt nicht als Korrekturdurchgang
          continue
        }
      } else {
        pass = await runConversion({ input, options, size, codec, bitrate: plan.bitrate, coverErlaubt: false })
      }

      if (pass.kind === 'abort') throw new CompressCanceledError()
      if (pass.kind === 'failed') return { ...original, note: pass.note }

      if (!best || pass.buffer.byteLength < best.buffer.byteLength) {
        best = { buffer: pass.buffer, width: size.width, height: size.height }
      }

      const target = options.targetBytes
      if (!target || best.buffer.byteLength <= target || attempt >= 2 || plan.bitrate <= MIN_VIDEO_BITRATE) break

      // Zu gross geraten: Bitrate im Verhaeltnis der Ueberschreitung nachziehen.
      const bitrate = Math.max(MIN_VIDEO_BITRATE, plan.bitrate * (target / best.buffer.byteLength) * 0.9)
      plan = { bitrate, maxEdge: Math.min(plan.maxEdge, edgeForBitrate(bitrate)), verkleinert: true }
      options.onPhase?.(`Noch zu groß – zweiter Durchgang …`)
      options.onProgress?.(0)
    }

    const buffer = best.buffer
    const zuGross = options.limitBytes > 0 && buffer.byteLength > options.limitBytes

    // Nur zurueck zum Original, wenn das Ergebnis groesser ist *und* die Grenze
    // reisst - sonst waere das Deckblatt umsonst gewesen.
    if (buffer.byteLength >= file.size && (zuGross || !options.cover)) {
      return { ...original, note: 'Das Original ist bereits kleiner - es bleibt unveraendert.' }
    }

    options.onProgress?.(1)
    return {
      blob: new Blob([buffer], { type: 'video/mp4' }),
      extension: 'mp4',
      compressed: true,
      width: best.width,
      height: best.height,
      verkleinert: plan.verkleinert,
      ueberGrenze: zuGross,
      note: coverHinweis,
    }
  } finally {
    input.dispose()
  }
}

type PassResult = { kind: 'ok'; buffer: ArrayBuffer } | { kind: 'failed'; note: string } | { kind: 'abort' }

/** Ein vollstaendiger Durchlauf mit fester Bitrate und Aufloesung. */
async function runConversion(args: {
  input: Input
  options: CompressOptions
  size: { width: number; height: number }
  codec: VideoCodec
  bitrate: number
  coverErlaubt: boolean
}): Promise<PassResult> {
  const { input, options, size, codec, bitrate, coverErlaubt } = args

  const output = new Output({
    // "in-memory" schreibt die Sprungmarken an den Dateianfang. Nur so laesst
    // sich das Video sofort abspielen, ohne es ganz zu laden.
    format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
    target: new BufferTarget(),
  })

  // Deckblatt vorbereiten. Schlaegt das Zeichnen fehl, laeuft die
  // Komprimierung ohne Vorspann weiter - das Video ist wichtiger.
  const coverImage = coverErlaubt && options.cover ? await drawCoverSafely(options.cover, size) : null
  let coverWritten = false

  const conversion = await Conversion.init({
    input,
    output,
    video: {
      codec,
      width: size.width,
      height: size.height,
      fit: 'contain',
      frameRate: TARGET_FPS,
      quality: videoQuality(bitrate),
      keyFrameInterval: KEYFRAME_INTERVAL,
      // Drehung fest ins Bild rechnen statt sie als Metadatum mitzugeben -
      // sonst zeigen manche Player quer gefilmte Videos verdreht an.
      allowRotationMetadata: false,
      process: coverImage
        ? (sample) => {
            // Bild und Ton werden um exakt dieselbe Zeit nach hinten
            // geschoben, damit die Lippensynchronitaet erhalten bleibt.
            sample.setTimestamp(sample.timestamp + COVER_SECONDS)
            if (coverWritten) return sample

            coverWritten = true
            const step = COVER_SECONDS / COVER_FRAMES
            const cover = Array.from(
              { length: COVER_FRAMES },
              (_, index) => new VideoSample(coverImage, { timestamp: index * step, duration: step }),
            )
            return [...cover, sample]
          }
        : undefined,
    },
    // Ohne Deckblatt bleibt die Tonspur unangetastet und wird eins zu eins
    // durchgereicht. Wichtig: Schon die Angabe einer Tonqualität erzwingt bei
    // mediabunny eine Neukodierung, und die scheitert auf Geräten, die kein AAC
    // erzeugen können (etwa Safari auf dem iPhone). Das Video bliebe dann
    // unverkleinert. Durchreichen ist ausserdem schneller und verlustfrei.
    audio: coverImage
      ? {
          codec: 'aac',
          quality: bitrateQuality(AUDIO_BITRATE),
          process: (sample) => {
            sample.setTimestamp(sample.timestamp + COVER_SECONDS)
            return sample
          },
        }
      : {},
    showWarnings: false,
  })

  if (!conversion.isValid) {
    return { kind: 'failed', note: 'Das Video laesst sich in diesem Browser nicht umwandeln - Original bleibt.' }
  }

  // Der gesprochene Sanierungsvorschlag ist der halbe Inhalt: lieber die
  // grosse Originaldatei als ein kleines Video ohne Ton.
  if (conversion.discardedTracks.some((entry) => entry.track.isAudioTrack())) {
    return { kind: 'failed', note: 'Der Ton liesse sich nicht uebernehmen - das Original bleibt unveraendert.' }
  }

  conversion.onProgress = (fraction) => options.onProgress?.(fraction)

  const onAbort = () => void conversion.cancel()
  options.signal?.addEventListener('abort', onAbort, { once: true })

  try {
    await conversion.execute()
  } catch (error) {
    if (error instanceof ConversionCanceledError || options.signal?.aborted) return { kind: 'abort' }
    throw error
  } finally {
    options.signal?.removeEventListener('abort', onAbort)
  }

  const buffer = output.target.buffer
  if (!buffer || buffer.byteLength === 0) {
    return { kind: 'failed', note: 'Die Umwandlung lieferte kein Ergebnis - das Original bleibt unveraendert.' }
  }
  return { kind: 'ok', buffer }
}

function extensionOf(fileName: string): string {
  const match = /\.([A-Za-z0-9]{1,5})$/.exec(fileName)
  return match ? match[1].toLowerCase() : 'mp4'
}

async function drawCoverSafely(
  cover: NonNullable<CompressOptions['cover']>,
  size: { width: number; height: number },
): Promise<CanvasImageSource | null> {
  try {
    return await cover(size.width, size.height)
  } catch {
    return null
  }
}
