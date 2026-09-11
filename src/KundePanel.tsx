import { useEffect, useRef, useState } from 'react'
import { SALESPEOPLE } from './data/salespeople'
import { GEWERKE } from './data/gewerke'
import MultiSelect from './MultiSelect'
import KundenSuche from './KundenSuche'
import { ApiFehler, ladeKundendaten, meistertaskLink, type Ich, type KundenEintrag } from './lib/api'
import { ACCEPT, isSupported, prepareImage } from './lib/bilder'
import { logoBild, objektBild, visitenkarteBild } from './lib/deckblattbilder'
import { formatBytes, formatDateTime, initialsOf, sanitizeFilePart } from './lib/format'
import { speichereDatei, teileDateien, typTeilbar } from './lib/share'
import type { MappenZustand } from './lib/speicher'
import {
  CUSTOM_VALUE,
  anschriftenAus,
  mappenFaehig as istMappenFaehig,
  mappenRang,
  mitarbeiterVon,
  objektadresseText,
  type Dokument,
  type DokumentFn,
  type HochladenFn,
  type Kundendaten,
  type ToastFn,
} from './kunde'

/** Am Rechner wird heruntergeladen, am Handy zusaetzlich geteilt. */
const PDF_TEILBAR = typTeilbar('application/pdf', 'dokument.pdf')
const VIDEO_TEILBAR = typTeilbar('video/mp4', 'video.mp4')

/**
 * Reihenfolge der Unterlagen in der Mappe: erst die gemerkte Folge, dann
 * alles Neue nach seinem Startplatz einsortiert (Prinzipskizze, Angebot,
 * Fotodokumentation). So landet ein spaeter hochgeladenes Angebot vor der
 * Fotodokumentation, ohne die Sortierung von Hand anzutasten.
 */
function sortiereMappe(kandidaten: Dokument[], folge: string[]): Dokument[] {
  const geordnet = folge
    .map((id) => kandidaten.find((d) => d.id === id))
    .filter((d): d is Dokument => d !== undefined)
  const neue = kandidaten
    .filter((d) => !folge.includes(d.id))
    .sort((a, b) => mappenRang(a) - mappenRang(b) || a.erstellt - b.erstellt)
  for (const dok of neue) {
    const platz = geordnet.findIndex((d) => mappenRang(d) > mappenRang(dok))
    if (platz < 0) geordnet.push(dok)
    else geordnet.splice(platz, 0, dok)
  }
  return geordnet
}

/** Prueft die ersten Bytes: eine PDF beginnt mit "%PDF". Endung und Typ luegen gern. */
async function istPdf(datei: File): Promise<boolean> {
  try {
    const kopf = new TextDecoder('latin1').decode(await datei.slice(0, 5).arrayBuffer())
    return kopf.startsWith('%PDF')
  } catch {
    return false
  }
}

/* Kleine Symbole fuer die Knoepfe an jeder Datei, im Strichstil der Navigation. */
const strich = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

function SymbolLaden() {
  return (
    <svg width="17" height="17" viewBox="0 0 20 20" {...strich} aria-hidden="true">
      <path d="M10 3v10" />
      <path d="m6 9.5 4 4 4-4" />
      <path d="M3.5 16.5h13" />
    </svg>
  )
}

function SymbolTeilen() {
  return (
    <svg width="17" height="17" viewBox="0 0 20 20" {...strich} aria-hidden="true">
      <circle cx="15" cy="4.5" r="2.2" />
      <circle cx="5" cy="10" r="2.2" />
      <circle cx="15" cy="15.5" r="2.2" />
      <path d="m7 9 6-3.4M7 11l6 3.4" />
    </svg>
  )
}

function SymbolEntfernen() {
  return (
    <svg width="15" height="15" viewBox="0 0 20 20" {...strich} aria-hidden="true">
      <path d="m5 5 10 10M15 5 5 15" />
    </svg>
  )
}

export interface KundePanelProps {
  daten: Kundendaten
  onChange: (aenderung: Partial<Kundendaten>) => void
  dokumente: Dokument[]
  onEntfernen: (id: string) => void
  onDokument: DokumentFn
  /** Fertige PDF von aussen aufnehmen (Angebot, fertige Prinzipskizze) */
  onHochladen: HochladenFn
  /** Titel einer Unterlage fuer die Mappe aendern */
  onTitel: (id: string, titel: string) => void
  onToast: ToastFn
  /** Wer angemeldet ist und was der Server kann; null bis /api/ich geantwortet hat */
  ich: Ich | null
  /** Gespeicherte Mappenauswahl beim Aufsetzen; App.tsx setzt die Seite per `key` je Vorgang neu auf */
  mappeStart: MappenZustand
  onMappe: (zustand: MappenZustand) => void
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
  onHochladen,
  onTitel,
  onToast,
  ich,
  mappeStart,
  onMappe,
}: KundePanelProps) {
  const [spPhotoFailed, setSpPhotoFailed] = useState(false)
  const [dragOverObject, setDragOverObject] = useState(false)
  const [objektLaeuft, setObjektLaeuft] = useState(false)
  const [mappeLaeuft, setMappeLaeuft] = useState(false)
  const [uebernahmeLaeuft, setUebernahmeLaeuft] = useState(false)
  /**
   * Unterlagen, die NICHT in die Mappe sollen (Yann, 09.09.2026: es muss nur
   * auswaehlbar sein, welches Dokument mitkommt). Abgewaehlt wird selten,
   * deshalb merkt sich die Seite die Ausnahmen statt der Auswahl - so ist eine
   * neu erstellte oder hochgeladene Unterlage automatisch dabei. Gemerkt
   * werden Dokument-Ids, weil es seit dem 11.09.2026 mehrere Unterlagen mit
   * demselben Titel geben kann (erstellte und hochgeladene Prinzipskizze).
   */
  const [nichtInMappe, setNichtInMappe] = useState<string[]>(mappeStart.nichtInMappe)
  /**
   * Reihenfolge der Unterlagen in der Mappe, als Liste der Dokument-Ids. Was
   * hier nicht steht, sortiert `sortiereMappe` nach seinem Startplatz ein;
   * Pfeil oder Ziehen schreiben die ganze Folge fest (Yann, 10.09.2026).
   */
  const [mappenFolge, setMappenFolge] = useState<string[]>(mappeStart.mappenFolge)
  // Auswahl und Reihenfolge gehoeren zum Vorgang und werden im Geraet gespeichert
  useEffect(() => {
    onMappe({ nichtInMappe, mappenFolge })
  }, [nichtInMappe, mappenFolge, onMappe])
  /** Gezogene und ins Visier genommene Unterlage beim Umsortieren */
  const [ziehtId, setZiehtId] = useState<string | null>(null)
  const [zielId, setZielId] = useState<string | null>(null)
  /** Titel gerade in Bearbeitung: solange ist die Zeile nicht ziehbar, sonst laesst sich kein Text markieren */
  const [bearbeitetId, setBearbeitetId] = useState<string | null>(null)
  const [dragOverPdf, setDragOverPdf] = useState(false)
  const objectInputRef = useRef<HTMLInputElement>(null)
  const pdfInputRef = useRef<HTMLInputElement>(null)

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

  /** Alles, was in die Mappe koennte, in der gewaehlten Reihenfolge. */
  const mappenFaehig = sortiereMappe(dokumente.filter(istMappenFaehig), mappenFolge)

  /** Die tatsaechlich angehakten Unterlagen. */
  const mappenTeile = mappenFaehig.filter((d) => !nichtInMappe.includes(d.id))

  /** Was nicht in die Mappe kann: die Mappe selbst und Videos. Reine Ablage. */
  const weitereDateien = dokumente.filter((d) => !istMappenFaehig(d))

  const schalteMappe = (id: string, dabei: boolean) =>
    setNichtInMappe((bisher) => (dabei ? bisher.filter((q) => q !== id) : [...bisher, id]))

  /** Eine Unterlage einen Platz nach oben oder unten. */
  function verschiebeMappe(id: string, richtung: -1 | 1) {
    const vorhanden = mappenFaehig.map((d) => d.id)
    const i = vorhanden.indexOf(id)
    const j = i + richtung
    if (i < 0 || j < 0 || j >= vorhanden.length) return
    const neu = [...vorhanden]
    ;[neu[i], neu[j]] = [neu[j], neu[i]]
    setMappenFolge(neu)
  }

  /** Gezogene Unterlage an die Stelle der Ziel-Unterlage setzen. */
  function ziehenAufMappe(ziel: string) {
    const id = ziehtId
    setZiehtId(null)
    setZielId(null)
    if (!id || id === ziel) return
    const vorhanden = mappenFaehig.map((d) => d.id)
    const von = vorhanden.indexOf(id)
    const nach = vorhanden.indexOf(ziel)
    if (von < 0 || nach < 0) return
    const neu = [...vorhanden]
    const [bewegt] = neu.splice(von, 1)
    neu.splice(nach, 0, bewegt)
    setMappenFolge(neu)
  }

  /**
   * Fertige PDFs von aussen aufnehmen (Yann, 11.09.2026: Angebot und fertige
   * Prinzipskizze sollen Teil der Mappe sein). Geprueft wird der Dateikopf,
   * nicht die Endung, damit die Mappe spaeter nicht an einer falsch benannten
   * Datei scheitert.
   */
  async function nimmPdfs(files: FileList | null) {
    if (!files || files.length === 0) return
    const abgelehnt: string[] = []
    for (const datei of Array.from(files)) {
      if (await istPdf(datei)) onHochladen(datei)
      else abgelehnt.push(datei.name)
    }
    if (abgelehnt.length > 0) {
      onToast('error', `Keine PDF, nicht aufgenommen: ${abgelehnt.join(', ')}`)
    }
  }

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
          titel: d.titel.trim() || d.quelle,
          bytes: new Uint8Array(await d.blob.arrayBuffer()),
          alleSeiten: d.hochgeladen,
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
    const ergebnis = await teileDateien([new File([dok.blob], dok.name, { type: dok.blob.type })], dok.titel)
    if (ergebnis === 'nicht moeglich') {
      onToast('error', 'Teilen hat nicht geklappt, die Datei wird stattdessen gespeichert.')
      speichereDatei(dok.blob, dok.name)
    }
  }

  /**
   * Die kleinen Knoepfe hinter jeder Datei: herunterladen, am Handy teilen,
   * entfernen. Bis zum 11.09.2026 standen hier grosse rote Knoepfe je Datei,
   * die die Liste dominiert haben (Yann: "entferne diese").
   */
  function dateiKnoepfe(dok: Dokument) {
    const teilbar = dok.art === 'pdf' ? PDF_TEILBAR : VIDEO_TEILBAR
    return (
      <div className="datei-knoepfe">
        <button
          type="button"
          className="btn-symbol"
          onClick={() => speichereDatei(dok.blob, dok.name)}
          aria-label={`${dok.name} herunterladen`}
          title="Herunterladen"
        >
          <SymbolLaden />
        </button>
        {teilbar && (
          <button
            type="button"
            className="btn-symbol"
            onClick={() => void teile(dok)}
            aria-label={`${dok.name} teilen`}
            title="Teilen"
          >
            <SymbolTeilen />
          </button>
        )}
        <button
          type="button"
          className="btn-symbol btn-symbol-entfernen"
          onClick={() => onEntfernen(dok.id)}
          aria-label={`${dok.name} entfernen`}
          title="Entfernen"
        >
          <SymbolEntfernen />
        </button>
      </div>
    )
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
          <h2 id="kunde-dokumente">Dokumente</h2>
          {dokumente.length === 0 && (
            <p>
              Noch nichts da. Fertige PDFs und Videos der anderen Seiten erscheinen hier; ein Angebot oder
              eine fertige Prinzipskizze lässt sich unten hinzufügen.
            </p>
          )}
        </div>

        <div className="mappe-zeile">
          <div className="mappe-text">
            <p className="mappe-titel">Angebotsmappe</p>
            <p className="eingabe-hinweis">
              {mappenFaehig.length === 0
                ? 'Sobald eine Unterlage da ist, entsteht daraus eine Mappe mit Deckblatt und Inhaltsverzeichnis.'
                : mappenTeile.length === 0
                  ? 'Keine Unterlage ausgewählt.'
                  : 'Deckblatt, Inhaltsverzeichnis, Warum ISOTEC, dann die angehakten Unterlagen in dieser Reihenfolge:'}
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

        {/* Auswahl und Reihenfolge der Unterlagen an einer Stelle: anhaken,
            was mitkommt, und per Pfeil oder Ziehen sortieren (Yann, 10.09.2026).
            Seit dem 11.09.2026 haengen die Knoepfe zum Herunterladen direkt
            an jeder Zeile; eine zweite Liste gibt es nicht mehr. */}
        {mappenFaehig.length > 0 && (
          <ul className="mappenliste">
            {mappenFaehig.map((dok, index) => {
              const dabei = !nichtInMappe.includes(dok.id)
              const hakenId = `mappe-${dok.id}`
              const klassen = ['mappenteil']
              if (!dabei) klassen.push('aus')
              if (ziehtId === dok.id) klassen.push('zieht')
              if (zielId === dok.id && ziehtId !== dok.id) klassen.push('ziehziel')
              return (
                <li
                  key={dok.id}
                  className={klassen.join(' ')}
                  draggable={bearbeitetId !== dok.id}
                  onDragStart={(e) => {
                    setZiehtId(dok.id)
                    e.dataTransfer.effectAllowed = 'move'
                  }}
                  onDragEnd={() => {
                    setZiehtId(null)
                    setZielId(null)
                  }}
                  onDragOver={(e) => {
                    if (!ziehtId) return
                    e.preventDefault()
                    e.dataTransfer.dropEffect = 'move'
                    setZielId(dok.id)
                  }}
                  onDragLeave={() => {
                    if (zielId === dok.id) setZielId(null)
                  }}
                  onDrop={(e) => {
                    if (!ziehtId) return
                    e.preventDefault()
                    ziehenAufMappe(dok.id)
                  }}
                >
                  <label className="mappenteil-haken" htmlFor={hakenId}>
                    <input
                      id={hakenId}
                      type="checkbox"
                      checked={dabei}
                      onChange={(e) => schalteMappe(dok.id, e.target.checked)}
                    />
                    <span className="mappenteil-nummer">{dabei ? `${mappenTeile.indexOf(dok) + 1}.` : '—'}</span>
                  </label>
                  <div className="mappenteil-text">
                    {dok.hochgeladen ? (
                      // Hochgeladene PDFs: der Titel fuer Inhaltsverzeichnis und
                      // Trennblatt ist geraten (aus dem Dateinamen) und bleibt aenderbar.
                      <input
                        type="text"
                        className="mappenteil-titel"
                        value={dok.titel}
                        onChange={(e) => onTitel(dok.id, e.target.value)}
                        onFocus={() => setBearbeitetId(dok.id)}
                        onBlur={() => setBearbeitetId(null)}
                        placeholder="Titel in der Mappe"
                        aria-label="Titel in der Mappe"
                      />
                    ) : (
                      <label className="mappenteil-name" htmlFor={hakenId}>
                        {dok.titel}
                      </label>
                    )}
                    <span className="mappenteil-meta">
                      {dok.name} · {formatBytes(dok.blob.size)} ·{' '}
                      {dok.hochgeladen ? 'hochgeladen' : formatDateTime(dok.erstellt)}
                    </span>
                  </div>
                  <div className="move-buttons">
                    <button
                      type="button"
                      className="btn-move"
                      onClick={() => verschiebeMappe(dok.id, -1)}
                      disabled={index === 0}
                      aria-label={`${dok.titel} nach oben`}
                      title="Nach oben"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="btn-move"
                      onClick={() => verschiebeMappe(dok.id, 1)}
                      disabled={index === mappenFaehig.length - 1}
                      aria-label={`${dok.titel} nach unten`}
                      title="Nach unten"
                    >
                      ↓
                    </button>
                  </div>
                  {dateiKnoepfe(dok)}
                </li>
              )
            })}
          </ul>
        )}

        {/* Fertige PDFs von aussen: Angebot, fertige Prinzipskizze (Yann, 11.09.2026) */}
        <input
          ref={pdfInputRef}
          className="visually-hidden"
          type="file"
          accept="application/pdf,.pdf"
          multiple
          onChange={(e) => {
            void nimmPdfs(e.target.files)
            e.target.value = ''
          }}
        />
        <div
          className={`dropzone dropzone-zeile mappe-hinzu${dragOverPdf ? ' dropzone-active' : ''}`}
          onDragOver={(e) => {
            // Nur echte Dateien annehmen, nicht das Umsortieren der Zeilen darueber
            if (ziehtId || !Array.from(e.dataTransfer.types).includes('Files')) return
            e.preventDefault()
            setDragOverPdf(true)
          }}
          onDragLeave={() => setDragOverPdf(false)}
          onDrop={(e) => {
            if (ziehtId) return
            e.preventDefault()
            setDragOverPdf(false)
            void nimmPdfs(e.dataTransfer.files)
          }}
          onClick={() => pdfInputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') pdfInputRef.current?.click()
          }}
        >
          <span className="mappe-hinzu-titel">Fertige PDF hinzufügen</span>
          <span className="dropzone-hint">
            Angebot oder fertige Prinzipskizze hierher ziehen oder klicken. Sie wird Teil der Mappe und steht
            im Inhaltsverzeichnis.
          </span>
        </div>

        {/* Was nicht in die Mappe kann: die fertige Mappe selbst und Videos */}
        {weitereDateien.length > 0 && (
          <>
            <p className="dateien-titel">Weitere Dateien</p>
            <ul className="mappenliste">
              {weitereDateien.map((dok) => (
                <li key={dok.id} className="mappenteil mappenteil-still">
                  <div className="mappenteil-text">
                    <span className="mappenteil-name">{dok.name}</span>
                    <span className="mappenteil-meta">
                      {dok.quelle} · {formatBytes(dok.blob.size)} · {formatDateTime(dok.erstellt)}
                    </span>
                  </div>
                  {dateiKnoepfe(dok)}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  )
}
