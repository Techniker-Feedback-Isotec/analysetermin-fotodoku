import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { visitenkarteVon } from './data/visitenkarten'
import type { DeckblattBild } from './lib/deckblatt'
import type { PdfPhoto } from './lib/pdf'
import { formatBytes, formatDateShort, formatDateTime, formatDateWeekday, fileDate, sanitizeFilePart } from './lib/format'
import {
  ACCEPT,
  EXTRA_LADDER,
  EXTRA_TARGET_BYTES,
  JPEG_QUALITY,
  MAX_EDGE,
  chronoCompare,
  optimizeWithRetry,
  type Progress,
} from './lib/bilder'
import type { Fotostapel } from './fotostapel'
import { SONSTIGES, legendeFuer, ohneLegende } from './data/legende'
import { nameMitRolle } from './data/rollen'
import { zeichnungFuer, zeichnungHinweis } from './data/prinzipzeichnung'
import logoPngUrl from './assets/isotec-logo.png'
import Textfenster, { Textvorschau } from './Textfenster'
import Bildansicht from './Bildansicht'
import { reichtextIstLeer, type Reichtext } from './lib/richtext'
import type { SeitenZustand } from './lib/speicher'
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
 * Steht rot umrandet unten auf jeder Bildseite der Prinzipskizze, also auf
 * allen Seiten nach den Bauzeichnungen (Yann, 09.09.2026). Der Kunde soll
 * beim Blaettern durch die Skizzen nicht uebersehen, was er vorbereiten muss.
 */
const FREIRAEUM_HINWEIS =
  'Alle Sanierungsbereiche müssen im Abstand von ca. 1 Meter bauseits freigeräumt werden.'

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
  /** Gemeinsamer Bilderstapel beider Fotoseiten */
  stapel: Fotostapel
  onToast: ToastFn
  onDokument: DokumentFn
  /**
   * Gespeicherter Zustand dieser Seite beim Aufsetzen (vorgang.ts). Gelesen
   * wird er nur einmal; App.tsx setzt die Seite beim Vorgangswechsel ueber
   * `key` neu auf, damit hier kein Abgleich noetig ist.
   */
  start: SeitenZustand
  /** Meldet jede Aenderung des Zustands, damit sie im Geraet gespeichert wird */
  onZustand: (zustand: SeitenZustand) => void
}

export default function FotoDokuPanel({ art, kunde, stapel, onToast, onDokument, start, onZustand }: FotoDokuPanelProps) {
  const [terminart, setTerminart] = useState<Terminart>(start.terminart)
  /** Index des gross gezeigten Fotos, oder null */
  const [ansichtIndex, setAnsichtIndex] = useState<number | null>(null)
  /** Bilder, die auf dieser Seite nicht mitsollen; im Stapel bleiben sie */
  const [ausgeschlossen, setAusgeschlossen] = useState<string[]>(start.ausgeschlossen)
  /** Selbst gewaehlte Reihenfolge dieser Seite; null = chronologisch */
  const [sortierung, setSortierung] = useState<string[] | null>(start.sortierung)
  const [keepDuplicates, setKeepDuplicates] = useState(start.keepDuplicates)
  const [extraCompression, setExtraCompression] = useState(start.extraCompression)
  const [pdfProgress, setPdfProgress] = useState<Progress | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [fertigePdf, setFertigePdf] = useState<{ blob: Blob; fileName: string } | null>(null)
  // Reklamation: Beurteilung; Analysetermin und Prinzipskizze: Zusammenfassung.
  // Beide bleiben erhalten, wenn die Terminart wechselt. Geschrieben wird im
  // Textfenster, gespeichert als formatierter Text (Absaetze, fett, kursiv,
  // unterstrichen, Aufzaehlung) - genau so kommt er in die PDF.
  const [beurteilung, setBeurteilung] = useState<Reichtext>(start.beurteilung)
  const [zusammenfassung, setZusammenfassung] = useState<Reichtext>(start.zusammenfassung)
  const [fensterOffen, setFensterOffen] = useState(false)

  // Jede Aenderung nach oben melden, damit der Vorgang im Geraet gespeichert wird
  useEffect(() => {
    onZustand({ terminart, ausgeschlossen, sortierung, keepDuplicates, extraCompression, beurteilung, zusammenfassung })
  }, [terminart, ausgeschlossen, sortierung, keepDuplicates, extraCompression, beurteilung, zusammenfassung, onZustand])
  const [dragPhotoId, setDragPhotoId] = useState<string | null>(null)
  const [dragOverPhotoId, setDragOverPhotoId] = useState<string | null>(null)

  const dropInputRef = useRef<HTMLInputElement>(null)

  const istSkizze = art === 'prinzipskizze'
  const terminType = istSkizze ? 'Prinzipskizze' : terminart
  const quelle = istSkizze ? 'Prinzipskizze' : 'Fotodokumentation'
  const isReklamation = !istSkizze && terminart === 'Reklamation'
  const mitarbeiter = mitarbeiterVon(kunde)
  const objectPhoto = kunde.objektfoto

  // ---------- Bilder: gemeinsamer Stapel, eigene Auswahl je Seite ----------

  /**
   * Beide Fotoseiten arbeiten mit demselben Bilderstapel: Hochgeladen wird
   * einmal, und jede Seite entscheidet selbst, welche Bilder sie zeigt und in
   * welcher Reihenfolge (Wunsch Yann, 08.09.2026). Das X nimmt ein Bild
   * deshalb nur von dieser Seite; der Stapel behaelt es fuer die andere.
   */
  const sichtbar = useMemo(() => {
    const uebrig = stapel.fotos.filter((f) => !ausgeschlossen.includes(f.id))
    if (!sortierung) return [...uebrig].sort(chronoCompare)
    // Bilder, die nach dem Sortieren dazukamen, kennt die eigene Reihenfolge
    // noch nicht - sie haengen sich chronologisch hinten an.
    const platz = new Map(sortierung.map((id, i) => [id, i]))
    const ende = Number.MAX_SAFE_INTEGER
    return [...uebrig].sort(
      (a, b) => (platz.get(a.id) ?? ende) - (platz.get(b.id) ?? ende) || chronoCompare(a, b),
    )
  }, [stapel.fotos, ausgeschlossen, sortierung])

  /** Nur von dieser Seite nehmen - im Stapel bleibt das Bild fuer die andere. */
  const removePhoto = (id: string) => setAusgeschlossen((bisher) => [...bisher, id])

  const rotatePhoto = (id: string) => stapel.drehen(id)

  /** Foto per Pfeil-Button eine Position nach oben/unten schieben */
  const movePhoto = (id: string, dir: -1 | 1) => {
    const liste = [...sichtbar]
    const i = liste.findIndex((p) => p.id === id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= liste.length) return
    ;[liste[i], liste[j]] = [liste[j], liste[i]]
    setSortierung(liste.map((p) => p.id))
  }

  /** Foto per Drag & Drop an die Position des Ziel-Fotos verschieben */
  const reorderByDrop = (targetId: string) => {
    if (!dragPhotoId || dragPhotoId === targetId) {
      setDragPhotoId(null)
      setDragOverPhotoId(null)
      return
    }
    const liste = [...sichtbar]
    const von = liste.findIndex((p) => p.id === dragPhotoId)
    const nach = liste.findIndex((p) => p.id === targetId)
    if (von >= 0 && nach >= 0) {
      const [bewegt] = liste.splice(von, 1)
      liste.splice(nach, 0, bewegt)
      setSortierung(liste.map((p) => p.id))
    }
    setDragPhotoId(null)
    setDragOverPhotoId(null)
  }

  // Duplikate markieren (erste Datei mit einem Hash gilt als Original)
  const annotated = useMemo(() => {
    const firstByHash = new Map<string, string>()
    return sichtbar.map((p) => {
      const first = firstByHash.get(p.hash)
      if (first === undefined) {
        firstByHash.set(p.hash, p.fileName)
        return { ...p, isDuplicate: false, duplicateOf: undefined as string | undefined }
      }
      return { ...p, isDuplicate: true, duplicateOf: first }
    })
  }, [sichtbar])

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

  const busy = stapel.fortschritt !== null || pdfProgress !== null
  const canCreate = mitarbeiter.name !== '' && objectPhoto !== null && included.length > 0 && !busy

  const hasAssessment = isReklamation && !reichtextIstLeer(beurteilung)
  const hasSummary = !isReklamation && !reichtextIstLeer(zusammenfassung)
  // Prinzipskizze: Deckblatt, freie Seite fuer den Grundriss, dann die Bilder
  const legende = useMemo(
    () => (istSkizze ? [...legendeFuer(kunde.gewerke), SONSTIGES] : []),
    [istSkizze, kunde.gewerke],
  )
  const gewerkeOhneFarbe = istSkizze ? ohneLegende(kunde.gewerke) : []
  /** Vorgezeichneter Wandquerschnitt nach Baujahr, oder null (siehe data/prinzipzeichnung.ts) */
  const vorlage = istSkizze ? zeichnungFuer(kunde.baujahr, kunde.gewerke) : null
  const pageCount = included.length + 1 + (istSkizze ? 1 : 0) + (hasAssessment || hasSummary ? 1 : 0)

  // Welches der beiden Textfelder gerade gilt
  const textTitel = isReklamation ? 'Beurteilung' : 'Zusammenfassung'
  const textWert = isReklamation ? beurteilung : zusammenfassung
  const setzeText = isReklamation ? setBeurteilung : setZusammenfassung

  const missingHints: string[] = []
  if (!mitarbeiter.name) missingHints.push('Mitarbeiter auf der Seite Kunden wählen')
  if (!objectPhoto) missingHints.push('Objektfoto auf der Seite Kunden hochladen')
  if (included.length === 0) missingHints.push(istSkizze ? 'mind. 1 Bild hinzufügen' : 'mind. 1 Foto hinzufügen')

  const handleCreatePdf = useCallback(async () => {
    if (!canCreate || !objectPhoto || terminDate == null || !terminLabel) return
    try {
      // 1) Statische Assets (Teamfoto, Logo) + Mitarbeiterfoto laden
      setPdfProgress({ label: 'Lade Deckblatt-Bilder …', done: 0, total: 1 })
      // pdf-lib wird erst hier geladen: Beim Start der Seite braucht es niemand.
      const [{ buildPdf }, logoPng] = await Promise.all([
        import('./lib/pdf'),
        fetch(logoPngUrl).then((r) => r.arrayBuffer()),
      ])
      // Visitenkarte statt Mitarbeiterfoto; wer keine hat, bekommt das Logo.
      let karte: DeckblattBild | null = null
      const karteUrl = visitenkarteVon(mitarbeiter.name)
      if (karteUrl) {
        try {
          const antwort = await fetch(karteUrl)
          if (antwort.ok) {
            karte = { bytes: new Uint8Array(await antwort.arrayBuffer()), format: 'jpeg' }
          }
        } catch {
          // Ohne Karte steht unten das Logo.
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

        // Der vorgezeichnete Wandquerschnitt der Prinzipskizze, falls einer passt
        const zeichnung = vorlage
          ? {
              pdf: new Uint8Array(await (await fetch(vorlage.url)).arrayBuffer()),
              box: vorlage.box,
            }
          : null

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
            visitenkarte: karte,
            objectImage: objImage,
            objectAddress,
            customerName: kunde.kunde.trim() || null,
            customerAddress: kunde.kundenadresse.trim() || null,
            orderNumber: isReklamation ? kunde.auftragsnummer.trim() || null : null,
            drawingPage: istSkizze ? { title: 'Bauzeichnungen', legende, zeichnung } : null,
            fotoHinweis: istSkizze ? FREIRAEUM_HINWEIS : null,
            fotoSeitenTitel: istSkizze ? 'Sanierungsbereiche' : null,
            textPage: hasAssessment
              ? {
                  title: 'Fachliche Beurteilung',
                  inhalt: beurteilung,
                  note: `Die fachliche Beurteilung wurde durchgeführt von ${nameMitRolle(mitarbeiter.name)} am ${formatDateShort(Date.now())}.`,
                }
              : hasSummary
                ? {
                    title: 'Zusammenfassung',
                    inhalt: zusammenfassung,
                    note: `Die Zusammenfassung wurde erstellt von ${nameMitRolle(mitarbeiter.name)} am ${formatDateShort(Date.now())}.`,
                  }
                : null,
            photoCount: included.length,
            loadPhoto,
            createdAt: new Date(),
            terminLabel,
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
    mitarbeiter.name,
    terminType,
    terminDate,
    terminLabel,
    extraCompression,
    kunde.kunde,
    kunde.objektadresse,
    kunde.kundenadresse,
    kunde.auftragsnummer,
    isReklamation,
    istSkizze,
    legende,
    hasAssessment,
    beurteilung,
    hasSummary,
    zusammenfassung,
    pageCount,
    art,
    quelle,
    onToast,
    onDokument,
  ])

  const progress = pdfProgress ?? stapel.fortschritt

  // ---------- Render ----------

  return (
    <div className={`fotodoku fotodoku-${art}`}>
      {/* Angaben zum Dokument: Terminart (nur Fotodokumentation) und die Textseite */}
      <section className="card" aria-labelledby={`${art}-titel`}>
        <div className="karte-kopf">
          <h2 id={`${art}-titel`}>{istSkizze ? 'Prinzipskizze' : 'Fotodokumentation'}</h2>
          <p>
            {istSkizze
              ? 'Deckblatt, freie Seite „Bauzeichnungen" für den Grundriss, dann die Bilder. Die Legende dort zeigt die auf der Seite Kunden gewählten Gewerke.'
              : 'Mitarbeiter, Objektfoto und Kundendaten kommen von der Seite Kunden.'}
          </p>
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
            <span className="eingabe-label">{textTitel} (eigene Seite nach dem Deckblatt)</span>
            <button type="button" className="textvorschau" onClick={() => setFensterOffen(true)}>
              {reichtextIstLeer(textWert) ? (
                <span className="textvorschau-leer">
                  {textTitel} schreiben und formatieren – zum Öffnen anklicken
                </span>
              ) : (
                <Textvorschau reich={textWert} />
              )}
            </button>
          </div>
          {gewerkeOhneFarbe.length > 0 && (
            <p className="eingabe-breit hint-warn">
              Ohne Farbe in der Legende: {gewerkeOhneFarbe.join(', ')}
            </p>
          )}
          {/* Was auf der Seite Bauzeichnungen landet, haengt am Baujahr auf der Seite Kunde */}
          {istSkizze && (
            <p className="eingabe-breit eingabe-hinweis">
              {zeichnungHinweis(kunde.baujahr, kunde.gewerke)}
            </p>
          )}
        </div>
      </section>

      {/* Fotos */}
      <section className="card" aria-labelledby={`${art}-fotos`}>
        <div className="karte-kopf">
          <h2 id={`${art}-fotos`}>{istSkizze ? 'Bilder' : 'Fotos'}</h2>
          <p aria-live="polite">
            {annotated.length === 0
              ? 'Einmal hochladen genügt – die Bilder stehen auf beiden Fotoseiten bereit'
              : `${annotated.length} Bild(er) · ${included.length} in der PDF · ✕ nimmt eines nur von dieser Seite · Reihenfolge = Seitenfolge`}
          </p>
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
            void stapel.hinzufuegen(e.dataTransfer.files)
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
              if (e.target.files) void stapel.hinzufuegen(e.target.files)
              e.target.value = ''
            }}
          />
          <button type="button" className="btn-secondary" onClick={() => dropInputRef.current?.click()}>
            Dateien auswählen
          </button>
          {ausgeschlossen.length > 0 && (
            <button type="button" className="btn-inline" onClick={() => setAusgeschlossen([])}>
              {ausgeschlossen.length} entfernte wieder anzeigen
            </button>
          )}
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
                {/* Klick auf die Vorschau zeigt das Foto gross, um Details zu pruefen */}
                <button
                  type="button"
                  className="photo-thumb-knopf"
                  onClick={() => setAnsichtIndex(idx)}
                  title="Foto groß ansehen"
                  aria-label={`${p.fileName} groß ansehen`}
                >
                  <img src={p.thumbUrl} alt="" className="photo-thumb" draggable={false} />
                  <span className="photo-thumb-lupe" aria-hidden="true">
                    ⤢
                  </span>
                </button>
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
        {fensterOffen && (
          <Textfenster
            titel={textTitel}
            hinweis={`erscheint als eigene Seite „${isReklamation ? 'Fachliche Beurteilung' : 'Zusammenfassung'}" nach dem Deckblatt`}
            wert={textWert}
            onSpeichern={(neu) => {
              setzeText(neu)
              setFensterOffen(false)
            }}
            onAbbrechen={() => setFensterOffen(false)}
          />
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

      {ansichtIndex !== null && annotated[ansichtIndex] && (
        <Bildansicht
          fotos={annotated}
          index={ansichtIndex}
          onIndex={setAnsichtIndex}
          onClose={() => setAnsichtIndex(null)}
        />
      )}
    </div>
  )
}
