import { useEffect, useRef, useState } from 'react'
import logo from '../assets/isotec-logo.png'
import Vergleich from './Vergleich'
import Viewer, { type ViewerFoto } from './Viewer'
import {
  istIOS,
  ladeNachherHerunter,
  speichereDatei,
  teileDatei,
  teileNachherBild,
  teilenMoeglich,
} from '../lib/share'
import { bereiteBildVor, blobZuBase64 } from './lib/bild'
import { optimizeWithRetry } from '../lib/bilder'
import { visitenkarteVon } from '../data/visitenkarten'
import { mitarbeiterVon, objektadresseText, type Kundendaten } from '../kunde'
import type { DeckblattBild } from '../lib/deckblatt'
import { GeminiFehler, erfasseBestand, saniereFoto } from './lib/gemini'

/**
 * Je Foto laesst sich eine Option anhaken (Yann, 05.09.2026): Der Boden wird
 * vollflaechig hellgrau saniert statt nur gesaeubert. Die zweite Variante
 * "Moeblieren" gab es bis zum 09.09.2026, Yann hat sie wieder herausgenommen.
 * Dazu kommt das Klappmenue "Bestand": alles, was die KI erkannt hat, ist
 * angehakt; was der Nutzer abhakt, verschwindet aus dem Ergebnis.
 * Jede Kombination wird nur einmal erzeugt und bleibt erhalten.
 */
type Optionen = { boden: boolean }

const STANDARD: Optionen = { boden: false }

/** Hoechstens so viele Fotos je Upload, damit nicht verschwenderisch gearbeitet wird (Yann, 05.09.2026). */
const MAX_JE_UPLOAD = 3

/** Schluessel, unter dem das Ergebnis einer Kombination abgelegt wird. */
function kombination(o: Optionen, entfernt: number[]): string {
  const basis = o.boden ? 'boden' : 'standard'
  return entfernt.length ? `${basis}|-${[...entfernt].sort((a, b) => a - b).join(',')}` : basis
}

/** Lesbare Bezeichnung der Kombination fuer Marke und Dateinamen. */
function bezeichnung(o: Optionen, entfernt: number[]): string {
  const teile: string[] = []
  if (o.boden) teile.push('Boden saniert')
  if (entfernt.length) teile.push(`${entfernt.length} entfernt`)
  return teile.length ? teile.join(', ') : 'Standard'
}

type Ergebnis = {
  status: 'laeuft' | 'fertig' | 'fehler'
  url?: string
  blob?: Blob
  fehler?: string
}

type Foto = {
  id: string
  name: string
  vorherUrl: string
  vorherBlob: Blob
  /** Zustand des Vorher-Bilds: wird gelesen oder bereit. */
  status: 'liest' | 'bereit' | 'lesefehler'
  fehler?: string
  /** Ergebnisse je Kombination, Schluessel siehe kombination(). */
  ergebnisse: Record<string, Ergebnis>
  /** Welche Kombination gerade gezeigt wird. */
  optionen: Optionen
  /** Vom Textmodell erkannter Bestand; einmal je Foto ermittelt, fuer alle Kombinationen genutzt. */
  bestand?: string
  /** Indizes der Bestandszeilen, die im gezeigten Ergebnis fehlen sollen. */
  entfernt: number[]
  /** Auswahl im Klappmenue, wird erst mit "Anwenden" zu entfernt. */
  entwurfEntfernt: number[]
}

function bestandZeilen(foto: Foto): string[] {
  return (foto.bestand ?? '')
    .split('\n')
    .map((z) => z.trim())
    .filter(Boolean)
}

function aktuell(foto: Foto): Ergebnis | undefined {
  return foto.ergebnisse[kombination(foto.optionen, foto.entfernt)]
}

function gleicheMenge(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false
  const s = new Set(a)
  return b.every((x) => s.has(x))
}

/**
 * Hoechstens zwei Anfragen gleichzeitig an Gemini: schont das Kontingent des
 * Schluessels (429) und haelt das Geraet fluessig.
 */
let aktiveAnfragen = 0
const anfrageWarteschlange: Array<() => void> = []
async function mitPlatz<T>(arbeit: () => Promise<T>): Promise<T> {
  if (aktiveAnfragen >= 2) await new Promise<void>((frei) => anfrageWarteschlange.push(frei))
  aktiveAnfragen++
  try {
    return await arbeit()
  } finally {
    aktiveAnfragen--
    anfrageWarteschlange.shift()?.()
  }
}

let naechsteId = 1
let demoGeladen = false

/**
 * Reiter "Sanierungsvorschau": das frueher eigenstaendige Tool Keller
 * Vorher-Nachher, unveraendert in der Arbeitsweise. Kopf- und Fusszeile
 * kommen vom Dokumentationstool.
 */
export interface VorschauPanelProps {
  /** Angaben und Objektfoto von der Seite Kunde - fuer das Deckblatt der PDF */
  kunde: Kundendaten
  /** Fertige PDF fuer die Sammlung auf der Seite Kunde */
  onDokument?: (schluessel: string, quelle: string, datei: File | null) => void
  /**
   * Ob der Server einen Gemini-Schluessel hat (aus /api/ich); null = noch
   * unbekannt. Der Schluessel liegt seit dem Umzug nach Azure nur dort.
   */
  geminiVerfuegbar: boolean | null
}

export default function VorschauPanel({ kunde, onDokument, geminiVerfuegbar }: VorschauPanelProps) {
  const [fotos, setFotos] = useState<Foto[]>([])
  const [auswahlId, setAuswahlId] = useState<string | null>(null)
  /** Fuer das Umsortieren per Ziehen: gezogenes Foto und das Ziel darunter */
  const [ziehtId, setZiehtId] = useState<string | null>(null)
  const [zielId, setZielId] = useState<string | null>(null)
  /**
   * Foto, dessen Name gerade bearbeitet wird. Solange darf die Kachel nicht
   * ziehbar sein, sonst laesst sich der Text mit der Maus nicht markieren.
   */
  const [benanntId, setBenanntId] = useState<string | null>(null)
  const [gesichert, setGesichert] = useState(false)
  const [zeigeIndex, setZeigeIndex] = useState<number | null>(null)
  const [ziehtDatei, setZiehtDatei] = useState(false)
  const [uploadHinweis, setUploadHinweis] = useState('')
  const [pdfLaeuft, setPdfLaeuft] = useState(false)
  const [pdfFehler, setPdfFehler] = useState('')
  const [pdfFertig, setPdfFertig] = useState('')
  /**
   * Auf iPhone und iPad wird die PDF erst erzeugt und dann ueber einen eigenen
   * Knopf geteilt: Das Teilen-Blatt darf nur unmittelbar aus einem Tipp heraus
   * starten, nach der Erzeugung waere die Berechtigung verbraucht (Lehre aus
   * der Fotodoku). Aendert sich etwas an den Fotos, verfaellt die Datei.
   */
  const [pdfBlob, setPdfBlob] = useState<Blob | null>(null)
  const aufIOS = istIOS()
  const dateiFeld = useRef<HTMLInputElement>(null)
  // Laufende Verarbeitungen brauchen den aktuellen Stand (z. B. den Bestand).
  const fotosRef = useRef<Foto[]>([])
  fotosRef.current = fotos

  useEffect(() => {
    // #demo laedt gemalte Beispielbilder, ohne Google zu bemuehen.
    const demo = window.location.hash.includes('demo')
    if (demo && !demoGeladen) {
      demoGeladen = true
      void (async () => {
        const { demoBilder } = await import('./lib/demo')
        const namen = ['Beispiel Waschküche', 'Beispiel Kellerflur', 'Beispiel Heizungsraum']
        for (const [nummer, name] of namen.entries()) {
          const { vorher, nachher } = await demoBilder(nummer, false)
          const { nachher: nachherBoden } = await demoBilder(nummer, true)
          setFotos((liste) => [
            ...liste,
            {
              id: `demo-${naechsteId++}`,
              name,
              vorherUrl: URL.createObjectURL(vorher),
              vorherBlob: vorher,
              status: 'bereit',
              optionen: STANDARD,
              entfernt: [],
              entwurfEntfernt: [],
              bestand: [
                '1 Rohr, waagerecht unter der Decke, grau, über die ganze Breite',
                '1 Fenster, oben links, weißer Rahmen',
                '1 Waschmaschine, Mitte, weiß',
                '1 Leuchte, Decke, Langfeldleuchte',
              ].join('\n'),
              ergebnisse: {
                standard: { status: 'fertig', url: URL.createObjectURL(nachher), blob: nachher },
                boden: { status: 'fertig', url: URL.createObjectURL(nachherBoden), blob: nachherBoden },
              },
            },
          ])
        }
      })()
    }
  }, [])

  function aktualisiere(id: string, aenderung: Partial<Foto>) {
    setFotos((liste) => liste.map((f) => (f.id === id ? { ...f, ...aenderung } : f)))
  }

  function setzeErgebnis(id: string, schluesselKombi: string, ergebnis: Ergebnis) {
    setFotos((liste) =>
      liste.map((f) => {
        if (f.id !== id) return f
        const alt = f.ergebnisse[schluesselKombi]
        if (alt?.url && alt.url !== ergebnis.url) URL.revokeObjectURL(alt.url)
        return { ...f, ergebnisse: { ...f.ergebnisse, [schluesselKombi]: ergebnis } }
      }),
    )
  }

  /**
   * Erzeugt eine Kombination fuer ein Foto. Ein wiederholbarer Fehler bekommt
   * einen zweiten Versuch; der Bestand wird je Foto nur einmal ermittelt.
   */
  async function verarbeite(id: string, vorherBlob: Blob, optionen: Optionen, entfernt: number[]) {
    const kombi = kombination(optionen, entfernt)
    setzeErgebnis(id, kombi, { status: 'laeuft' })
    try {
      const base64 = await blobZuBase64(vorherBlob)
      const blob = await mitPlatz(async () => {
        // Erst schauen, was da ist: Die Liste geht als Pflichtbestand in den
        // Bildauftrag, damit Fenster und Rohre nicht verschwinden oder entstehen.
        let bestand = fotosRef.current.find((f) => f.id === id)?.bestand ?? ''
        if (!bestand) {
          bestand = await erfasseBestand(base64)
          if (bestand) aktualisiere(id, { bestand })
        }
        // Abgewaehlte Zeilen wandern aus der Pflichtliste in den Entfernen-Block.
        const zeilen = bestand
          .split('\n')
          .map((z) => z.trim())
          .filter(Boolean)
        const entfernen = entfernt.map((i) => zeilen[i]).filter(Boolean)
        const bleibt = zeilen.filter((_, i) => !entfernt.includes(i)).join('\n')
        const auftrag = {
          bestand: bleibt || undefined,
          bodenHellgrau: optionen.boden,
          entfernen,
        }
        try {
          return await saniereFoto(base64, auftrag)
        } catch (fehler) {
          if (fehler instanceof GeminiFehler && fehler.wiederholbar) {
            await new Promise((r) => setTimeout(r, 4000))
            return await saniereFoto(base64, auftrag)
          }
          throw fehler
        }
      })
      setzeErgebnis(id, kombi, { status: 'fertig', blob, url: URL.createObjectURL(blob) })
    } catch (fehler) {
      setzeErgebnis(id, kombi, {
        status: 'fehler',
        fehler: fehler instanceof Error ? fehler.message : 'Unbekannter Fehler',
      })
    }
  }

  async function nimmDateien(dateien: FileList | File[]) {
    const bilder = Array.from(dateien).filter(
      (d) => d.type.startsWith('image/') || /\.(heic|heif)$/i.test(d.name),
    )
    if (bilder.length > MAX_JE_UPLOAD) {
      setUploadHinweis(`Höchstens ${MAX_JE_UPLOAD} Fotos auf einmal. Die ersten ${MAX_JE_UPLOAD} wurden übernommen.`)
      window.setTimeout(() => setUploadHinweis(''), 6000)
    }
    for (const datei of bilder.slice(0, MAX_JE_UPLOAD)) {
      const id = String(naechsteId++)
      const name = datei.name.replace(/\.[^.]+$/, '')
      setFotos((liste) => [
        ...liste,
        {
          id,
          name,
          vorherUrl: '',
          vorherBlob: datei,
          status: 'liest',
          optionen: STANDARD,
          entfernt: [],
          entwurfEntfernt: [],
          ergebnisse: {},
        },
      ])
      try {
        const { blob } = await bereiteBildVor(datei)
        aktualisiere(id, { vorherBlob: blob, vorherUrl: URL.createObjectURL(blob), status: 'bereit' })
        void verarbeite(id, blob, STANDARD, [])
      } catch {
        aktualisiere(id, { status: 'lesefehler', fehler: 'Foto konnte nicht gelesen werden.' })
      }
    }
  }

  /** Haekchen umschalten: Kombination wechseln und bei Bedarf erst erzeugen. */
  function schalteOption(foto: Foto, teil: keyof Optionen, wert: boolean) {
    const optionen = { ...foto.optionen, [teil]: wert }
    aktualisiere(foto.id, { optionen })
    if (!foto.ergebnisse[kombination(optionen, foto.entfernt)]) {
      void verarbeite(foto.id, foto.vorherBlob, optionen, foto.entfernt)
    }
  }

  /** Haekchen im Bestandsmenue: nur der Entwurf aendert sich. */
  function schalteBestand(foto: Foto, index: number, behalten: boolean) {
    const entwurf = behalten
      ? foto.entwurfEntfernt.filter((i) => i !== index)
      : [...foto.entwurfEntfernt, index]
    aktualisiere(foto.id, { entwurfEntfernt: entwurf })
  }

  /** "Anwenden" im Bestandsmenue: Entwurf uebernehmen, Ergebnis bei Bedarf erzeugen. */
  function wendeBestandAn(foto: Foto) {
    const entfernt = [...foto.entwurfEntfernt]
    aktualisiere(foto.id, { entfernt })
    if (!foto.ergebnisse[kombination(foto.optionen, entfernt)]) {
      void verarbeite(foto.id, foto.vorherBlob, foto.optionen, entfernt)
    }
  }

  /** Die gerade gezeigte Kombination noch einmal erzeugen. */
  function bearbeiteErneut(foto: Foto) {
    void verarbeite(foto.id, foto.vorherBlob, foto.optionen, foto.entfernt)
  }

  /**
   * Reihenfolge aendern (Yann, 09.09.2026): Die Kacheln stehen in der
   * Reihenfolge, in der die Fotos auch in der PDF landen. Mit den Pfeilen
   * oder per Ziehen laesst sie sich umstellen.
   */
  function verschiebe(id: string, richtung: -1 | 1) {
    setFotos((liste) => {
      const i = liste.findIndex((f) => f.id === id)
      const j = i + richtung
      if (i < 0 || j < 0 || j >= liste.length) return liste
      const neu = [...liste]
      ;[neu[i], neu[j]] = [neu[j], neu[i]]
      return neu
    })
  }

  /** Gezogenes Foto an die Stelle des Ziels setzen, der Rest rueckt nach. */
  function ziehenAuf(zielId: string) {
    const quelleId = ziehtId
    setZiehtId(null)
    setZielId(null)
    if (!quelleId || quelleId === zielId) return
    setFotos((liste) => {
      const von = liste.findIndex((f) => f.id === quelleId)
      const nach = liste.findIndex((f) => f.id === zielId)
      if (von < 0 || nach < 0) return liste
      const neu = [...liste]
      const [bewegt] = neu.splice(von, 1)
      neu.splice(nach, 0, bewegt)
      return neu
    })
  }

  function entferne(id: string) {
    setFotos((liste) => {
      const foto = liste.find((f) => f.id === id)
      if (foto?.vorherUrl) URL.revokeObjectURL(foto.vorherUrl)
      for (const e of Object.values(foto?.ergebnisse ?? {})) if (e.url) URL.revokeObjectURL(e.url)
      return liste.filter((f) => f.id !== id)
    })
  }

  /**
   * Angaben und Bilder fuer das gemeinsame Deckblatt. Sie kommen von der Seite
   * Kunde, damit die Vorschau nichts doppelt abfragt.
   */
  async function deckblattDaten() {
    const mitarbeiter = mitarbeiterVon(kunde)
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
    let objekt: DeckblattBild | null = null
    if (kunde.objektfoto) {
      const bild = await optimizeWithRetry(kunde.objektfoto.workingBlob, kunde.objektfoto.orientation, {
        maxEdge: 1800,
        quality: 0.8,
        sourceType: kunde.objektfoto.sourceType,
      })
      objekt = { bytes: bild.bytes, format: bild.format }
    }
    return {
      objekt,
      visitenkarte: karte,
      kunde: kunde.kunde.trim(),
      kundenadresse: kunde.kundenadresse.trim(),
      objektadresse: objektadresseText(kunde),
    }
  }

  /**
   * PDF "ISOTEC Sanierungsvorschau": Deckblatt, dann je Foto eine Seite mit
   * Vorher und Nachher in genau der Variante, die gerade ausgewaehlt ist.
   */
  async function erstellePdf() {
    const eintraege = fotos
      .filter((f) => f.status === 'bereit' && aktuell(f)?.status === 'fertig')
      .map((f) => ({
        name: f.name,
        variante: bezeichnung(f.optionen, f.entfernt),
        vorher: f.vorherBlob,
        nachher: aktuell(f)!.blob!,
      }))
    if (eintraege.length === 0) return
    setPdfLaeuft(true)
    setPdfFehler('')
    setPdfFertig('')
    try {
      const [{ erzeugeSanierungsvorschauPdf }, logoAntwort] = await Promise.all([
        import('./lib/pdf'),
        fetch(logo),
      ])
      const logoPng = new Uint8Array(await logoAntwort.arrayBuffer())
      const pdf = await erzeugeSanierungsvorschauPdf(eintraege, logoPng, await deckblattDaten())
      onDokument?.(
        'pdf:vorschau',
        'Sanierungsvorschau',
        new File([pdf], 'ISOTEC Sanierungsvorschau.pdf', { type: 'application/pdf' }),
      )
      // Nicht mehr sofort herunterladen: Die PDF liegt jetzt auf der Seite
      // Kunde unter "Erstellte Dokumente" und geht von dort in die Mappe
      // (Yann, 08.09.2026). Der Blob bleibt fuer den Teilen-Knopf auf dem iPhone.
      setPdfBlob(pdf)
      setPdfFertig('Die PDF liegt jetzt unter Kunde › Erstellte Dokumente.')
    } catch (fehler) {
      setPdfFehler(fehler instanceof Error ? fehler.message : 'PDF konnte nicht erstellt werden.')
    } finally {
      setPdfLaeuft(false)
    }
  }

  /** iPhone/iPad: die fertige PDF ueber das Teilen-Blatt weitergeben (Dateien, Mail, MeisterTask). */
  async function teilePdf() {
    if (!pdfBlob) return
    const ergebnis = await teileDatei(pdfBlob, 'ISOTEC Sanierungsvorschau.pdf', 'ISOTEC Sanierungsvorschau')
    if (ergebnis === 'nicht moeglich') speichereDatei(pdfBlob, 'ISOTEC Sanierungsvorschau.pdf')
  }

  // Sobald sich an den Fotos etwas aendert, passt die erzeugte PDF nicht mehr.
  useEffect(() => {
    setPdfBlob(null)
    setPdfFertig('')
  }, [fotos])

  // Im Fenster gezeigt wird das gewaehlte Foto, sonst das erste mit fertigem
  // Ergebnis, sonst das erste bereite. Die Vollbildansicht kennt nur fertige.
  const anzeigbar = fotos.filter((f) => f.status === 'bereit')
  const gewaehlt =
    anzeigbar.find((f) => f.id === auswahlId) ??
    anzeigbar.find((f) => aktuell(f)?.status === 'fertig') ??
    anzeigbar[0]
  const gewaehltesErgebnis = gewaehlt ? aktuell(gewaehlt) : undefined
  const gewaehlteKombi = gewaehlt ? kombination(gewaehlt.optionen, gewaehlt.entfernt) : ''

  const fertige: ViewerFoto[] = anzeigbar
    .filter((f) => aktuell(f)?.status === 'fertig')
    .map((f) => {
      const e = aktuell(f)!
      const zusatz = bezeichnung(f.optionen, f.entfernt)
      return {
        id: f.id,
        name: zusatz === 'Standard' ? f.name : `${f.name} (${zusatz})`,
        vorherUrl: f.vorherUrl,
        nachherUrl: e.url!,
        nachherBlob: e.blob!,
      }
    })

  useEffect(() => {
    if (gewaehlt && gewaehlt.id !== auswahlId) setAuswahlId(gewaehlt.id)
    if (!gewaehlt && auswahlId) setAuswahlId(null)
  }, [gewaehlt, auswahlId])
  useEffect(() => {
    setGesichert(false)
  }, [gewaehlt?.id, gewaehlteKombi])

  function dateiname(foto: Foto): string {
    const zusatz = bezeichnung(foto.optionen, foto.entfernt)
    return zusatz === 'Standard' ? foto.name : `${foto.name} ${zusatz.replace(/, /g, ' ')}`
  }

  function statustext(foto: Foto): string {
    if (foto.optionen.boden) return 'Boden wird saniert …'
    return 'Wird saniert …'
  }

  /** Die beiden Haekchen, an der Kachel und im Fenster gleich. */
  function optionsHaken(foto: Foto, klasse: string) {
    return (
      <div className={klasse} onClick={(e) => e.stopPropagation()}>
        <label className="kachel-option">
          <input
            type="checkbox"
            checked={foto.optionen.boden}
            onChange={(e) => schalteOption(foto, 'boden', e.target.checked)}
          />
          Boden sanieren
        </label>
      </div>
    )
  }

  /** Klappmenue "Bestand": alles Erkannte angehakt, Abgehaktes verschwindet nach "Anwenden". */
  function bestandMenue(foto: Foto) {
    const zeilen = bestandZeilen(foto)
    if (zeilen.length === 0) return null
    const geaendert = !gleicheMenge(foto.entwurfEntfernt, foto.entfernt)
    return (
      <details className="bestand-menue">
        <summary>
          Bestand
          {foto.entfernt.length > 0 && <span className="bestand-zahl">−{foto.entfernt.length}</span>}
        </summary>
        <div className="bestand-liste">
          {zeilen.map((zeile, i) => (
            <label key={i} className="kachel-option">
              <input
                type="checkbox"
                checked={!foto.entwurfEntfernt.includes(i)}
                onChange={(e) => schalteBestand(foto, i, e.target.checked)}
              />
              {zeile}
            </label>
          ))}
          <div className="bestand-knoepfe">
            <button
              className="btn btn-rand btn-klein"
              onClick={() => aktualisiere(foto.id, { entwurfEntfernt: [] })}
              disabled={foto.entwurfEntfernt.length === 0}
            >
              Alle behalten
            </button>
            <button
              className="btn btn-rot btn-klein"
              onClick={() => wendeBestandAn(foto)}
              disabled={!geaendert}
            >
              Anwenden
            </button>
          </div>
        </div>
      </details>
    )
  }

  return (
    <>
      <div className="vorschau">
        {geminiVerfuegbar === false && (
          <section className="card hinweis-warn">
            Die Bildbearbeitung ist gerade nicht verfügbar, auf dem Server fehlt der Zugang zu
            Google. Bitte bei Yann melden. Fotos lassen sich schon auswählen, bearbeitet wird
            aber nichts.
          </section>
        )}

        <section className="card">
          <div className="karte-kopf">
            <h2>Kellerfotos</h2>
            <p>Aus jedem Foto entsteht eine Ansicht, wie der Raum saniert aussehen kann.</p>
          </div>
          <div
            className={ziehtDatei ? 'ablage zieht' : 'ablage'}
            onDragOver={(e) => {
              e.preventDefault()
              setZiehtDatei(true)
            }}
            onDragLeave={() => setZiehtDatei(false)}
            onDrop={(e) => {
              e.preventDefault()
              setZiehtDatei(false)
              void nimmDateien(e.dataTransfer.files)
            }}
            onClick={() => dateiFeld.current?.click()}
          >
            <p>
              <strong>Fotos auswählen</strong> oder hierher ziehen (höchstens {MAX_JE_UPLOAD} auf einmal)
            </p>
          </div>
          {uploadHinweis && <p className="upload-hinweis">{uploadHinweis}</p>}
          <input
            ref={dateiFeld}
            type="file"
            accept="image/*,.heic,.heif"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files) void nimmDateien(e.target.files)
              e.target.value = ''
            }}
          />
        </section>

        {fotos.length > 0 && (
          <section className="card">
            <h2>
              Vorher-Nachher
              {aufIOS && pdfBlob ? (
                <button className="btn btn-rot btn-klein h2-aktion" onClick={() => void teilePdf()}>
                  PDF teilen
                </button>
              ) : (
                <button
                  className="btn btn-rot btn-klein h2-aktion"
                  disabled={pdfLaeuft || fertige.length === 0}
                  onClick={() => void erstellePdf()}
                  title="PDF mit allen fertigen Fotos in der jeweils gewählten Variante"
                >
                  {pdfLaeuft ? 'PDF wird erstellt …' : `PDF erstellen (${fertige.length})`}
                </button>
              )}
            </h2>
            {pdfFehler && <p className="upload-hinweis">{pdfFehler}</p>}
            {pdfFertig && <p className="pdf-fertig">✓ {pdfFertig}</p>}
            <div className="uebersicht">
              <div className="galerie">
                {fotos.map((foto, index) => {
                  const ergebnis = aktuell(foto)
                  const istGewaehlt = gewaehlt?.id === foto.id
                  const klassen = ['kachel']
                  if (foto.status === 'bereit') klassen.push('klickbar')
                  if (istGewaehlt) klassen.push('gewaehlt')
                  if (ziehtId === foto.id) klassen.push('zieht')
                  if (zielId === foto.id && ziehtId !== foto.id) klassen.push('ziehziel')
                  // Nummer nur fuer Fotos, die auch in die PDF kommen
                  const pdfNummer = fertige.findIndex((f) => f.id === foto.id) + 1
                  return (
                    <figure
                      key={foto.id}
                      className={klassen.join(' ')}
                      draggable={benanntId !== foto.id}
                      onDragStart={(e) => {
                        setZiehtId(foto.id)
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
                        setZielId(foto.id)
                      }}
                      onDragLeave={() => {
                        if (zielId === foto.id) setZielId(null)
                      }}
                      onDrop={(e) => {
                        if (!ziehtId) return
                        e.preventDefault()
                        ziehenAuf(foto.id)
                      }}
                      onClick={() => {
                        if (foto.status === 'bereit') setAuswahlId(foto.id)
                      }}
                    >
                      {pdfNummer > 0 && (
                        <span className="kachel-nummer" title="Platz in der PDF">
                          {pdfNummer}
                        </span>
                      )}
                      <div className="kachel-bild">
                        {foto.vorherUrl && <img src={foto.vorherUrl} alt={`${foto.name} vorher`} />}
                        {ergebnis?.status === 'fertig' && ergebnis.url && (
                          <>
                            <img
                              src={ergebnis.url}
                              alt={`${foto.name} nachher`}
                              style={{ clipPath: 'inset(0 0 0 50%)' }}
                            />
                            <span className="kachel-teiler" />
                          </>
                        )}
                        {(foto.status === 'liest' || ergebnis?.status === 'laeuft') && (
                          <span className="kachel-schleier">
                            <span className="dreher" />
                            {foto.status === 'liest' ? 'Wird gelesen …' : statustext(foto)}
                          </span>
                        )}
                        {(foto.status === 'lesefehler' || ergebnis?.status === 'fehler') && (
                          <span className="kachel-schleier kachel-fehler">
                            {foto.status === 'lesefehler' ? foto.fehler : ergebnis?.fehler}
                            {foto.status !== 'lesefehler' && (
                              <button
                                className="btn btn-hell btn-klein"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  bearbeiteErneut(foto)
                                }}
                              >
                                Erneut versuchen
                              </button>
                            )}
                          </span>
                        )}
                      </div>
                      <figcaption>
                        <div className="kachel-zeile">
                          {/* Der Name steht in der PDF und im Dateinamen, deshalb
                              ist er hier direkt aenderbar (Yann, 09.09.2026). */}
                          <input
                            className="kachel-name"
                            value={foto.name}
                            title={`${foto.name} (Name ändern)`}
                            aria-label={`Name von ${foto.name} ändern`}
                            onChange={(e) => aktualisiere(foto.id, { name: e.target.value })}
                            onFocus={() => setBenanntId(foto.id)}
                            onBlur={(e) => {
                              setBenanntId(null)
                              const sauber = e.target.value.trim()
                              aktualisiere(foto.id, { name: sauber === '' ? 'Foto' : sauber })
                            }}
                            onClick={(e) => e.stopPropagation()}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur()
                            }}
                          />
                          {/* Reihenfolge: bestimmt, wie die Fotos in der PDF stehen */}
                          <button
                            className="kachel-entfernen"
                            aria-label={`${foto.name} nach vorne`}
                            title="Nach vorne"
                            disabled={index === 0}
                            onClick={(e) => {
                              e.stopPropagation()
                              verschiebe(foto.id, -1)
                            }}
                          >
                            ‹
                          </button>
                          <button
                            className="kachel-entfernen"
                            aria-label={`${foto.name} nach hinten`}
                            title="Nach hinten"
                            disabled={index === fotos.length - 1}
                            onClick={(e) => {
                              e.stopPropagation()
                              verschiebe(foto.id, 1)
                            }}
                          >
                            ›
                          </button>
                          {(ergebnis?.status === 'fertig' || ergebnis?.status === 'fehler') && (
                            <button
                              className="kachel-entfernen"
                              aria-label="Diese Variante erneut bearbeiten"
                              title="Erneut bearbeiten"
                              onClick={(e) => {
                                e.stopPropagation()
                                bearbeiteErneut(foto)
                              }}
                            >
                              ↻
                            </button>
                          )}
                          <button
                            className="kachel-entfernen"
                            aria-label="Foto entfernen"
                            onClick={(e) => {
                              e.stopPropagation()
                              entferne(foto.id)
                            }}
                          >
                            ✕
                          </button>
                        </div>
                        {foto.status === 'bereit' && optionsHaken(foto, 'kachel-optionen')}
                      </figcaption>
                    </figure>
                  )
                })}
              </div>

              <div className="vergleich-fenster">
                {gewaehlt ? (
                  <>
                    <div className="fenster-kopf">
                      <strong className="fenster-name" title={gewaehlt.name}>
                        {gewaehlt.name}
                        <span className="kachel-marke">
                          {bezeichnung(gewaehlt.optionen, gewaehlt.entfernt)}
                        </span>
                      </strong>
                      <div className="fenster-knoepfe">
                        {optionsHaken(gewaehlt, 'fenster-optionen')}
                        {bestandMenue(gewaehlt)}
                        {gewaehltesErgebnis?.status === 'fertig' && gewaehltesErgebnis.blob && (
                          <>
                            {!aufIOS && (
                              <button
                                className="btn btn-rand btn-klein"
                                onClick={() => {
                                  ladeNachherHerunter(gewaehltesErgebnis.blob!, dateiname(gewaehlt))
                                  setGesichert(true)
                                }}
                              >
                                {gesichert ? '✓ Heruntergeladen' : 'Herunterladen'}
                              </button>
                            )}
                            {teilenMoeglich() && (
                              <button
                                className="btn btn-rand btn-klein"
                                onClick={() =>
                                  void teileNachherBild(gewaehltesErgebnis.blob!, dateiname(gewaehlt))
                                }
                              >
                                In Fotos sichern
                              </button>
                            )}
                            <button
                              className="btn btn-rand btn-klein"
                              onClick={() =>
                                setZeigeIndex(fertige.findIndex((f) => f.id === gewaehlt.id))
                              }
                            >
                              Vollbild
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    {gewaehltesErgebnis?.status === 'fertig' && gewaehltesErgebnis.url ? (
                      <Vergleich
                        vorherUrl={gewaehlt.vorherUrl}
                        nachherUrl={gewaehltesErgebnis.url}
                        zuruecksetzenBei={`${gewaehlt.id}-${gewaehlteKombi}`}
                      />
                    ) : gewaehltesErgebnis?.status === 'fehler' ? (
                      <p className="fenster-leer">
                        {gewaehltesErgebnis.fehler}
                        <br />
                        <button className="btn btn-rand btn-klein" onClick={() => bearbeiteErneut(gewaehlt)}>
                          Erneut versuchen
                        </button>
                      </p>
                    ) : (
                      <p className="fenster-leer">
                        <span className="dreher dreher-dunkel" />
                        {statustext(gewaehlt)}
                      </p>
                    )}
                  </>
                ) : (
                  <p className="fenster-leer">Noch kein Foto ausgewählt.</p>
                )}
              </div>
            </div>
          </section>
        )}

        <p className="vorschau-hinweis">KI-Visualisierung, kein zugesichertes Sanierungsergebnis</p>
      </div>

      {zeigeIndex !== null && fertige[zeigeIndex] && (
        <Viewer
          fotos={fertige}
          index={zeigeIndex}
          onIndex={setZeigeIndex}
          onClose={() => setZeigeIndex(null)}
        />
      )}
    </>
  )
}
