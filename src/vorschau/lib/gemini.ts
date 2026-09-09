/**
 * Anbindung an Google Gemini.
 *
 * Der Aufruf geht seit dem 08.09.2026 nicht mehr direkt an Google, sondern an
 * den eigenen Server (/api/gemini/bild und /api/gemini/bestand, siehe
 * server/gemini.mjs). Dort liegen Modellnamen und Schluessel; der Browser
 * kennt keinen Schluessel mehr. Googles Antwort kommt unveraendert zurueck,
 * deshalb gilt die Fehlerbehandlung unten weiter.
 *
 * Bildmodell: seit 05.09.2026 das Pro-Modell (Entscheidung Yann), weil das
 * Flash-Modell unter dem weissen Putz das Ziegelmuster durchscheinen liess.
 * Bestandsaufnahme: ein Textmodell mit Bildverstaendnis listet auf, was auf
 * dem Foto fest vorhanden ist; die Liste geht als Pflichtbestand in den
 * Bildauftrag ("Hebel 1", Yann 05.09.2026).
 */
import { ApiFehler, geminiAnfrage } from '../../lib/api'

const BESTAND_PROMPT = [
  'Du siehst das Foto eines Kellerraums. Erstelle eine nüchterne Bestandsliste aller fest vorhandenen Elemente, damit ein Bildbearbeitungsprogramm sie unverändert erhalten kann.',
  'Je Zeile genau ein Element mit Anzahl und Lage im Bild (links, Mitte, rechts; oben, unten), zum Beispiel: "1 Fenster, oben links, weißer Rahmen, Kellerfenster mit Gitter davor" oder "1 Rohr, senkrecht in der rechten Ecke, vom Boden bis zur Decke, grau".',
  'Halte diese Reihenfolge strikt ein und lasse keine Gruppe aus, in der etwas vorhanden ist:',
  '1. Fenster und Türen (auch kleine Kellerfenster, Fensternischen, Türöffnungen).',
  '2. Rohre und Leitungen mit ihrem Verlauf (Wasser, Heizung, Abwasser, Lüftung), Kabel, Kabelkanäle.',
  '3. Heizkörper, Zähler, Verteilerkästen, Ventile, Wasseranschlüsse, Steckdosen, Schalter.',
  '4. Geräte und feste Möbel: Waschmaschine, Trockner, Heizung, Boiler, Schränke, Regale, Bodenabläufe.',
  '5. Decke und Leuchten.',
  'Ignoriere lose Gegenstände wie Eimer, Flaschen, Kartons, Wäsche.',
  'Keine Einleitung, keine Bewertung, keine Vorschläge, keine Überschriften, keine Gruppennamen. Nur die Zeilen der Elemente. Höchstens 25 Zeilen. Deutsch.',
].join('\n')

/** Zeilen fuer den Bildauftrag: der erkannte Bestand als Pflichtliste. */
function bestandBlock(bestand?: string): string[] {
  const text = (bestand ?? '').trim()
  if (!text) return []
  return [
    '',
    'BESTAND DIESES FOTOS (jedes dieser Elemente bleibt in Anzahl, Lage und Form genau so):',
    ...text.split('\n').map((z) => z.trim()).filter(Boolean),
  ]
}

/**
 * Der Arbeitsauftrag an das Modell. Grundlage ist Yanns Beispielpaar vom
 * 01.09.2026 (Waschkueche), am 04./05.09.2026 nach seinen Tests geschaerft:
 * Waende werden glatte weisse Flaechen ohne Steinmuster, Verkleidungen wie
 * Rigips oder Holzvertaefelung verschwinden (das gefaellt ihm) - das gilt aber
 * NUR fuer Waende: die Decke bleibt seit 09.09.2026 voellig unangetastet
 * (Yann: exakt im Ursprungszustand, kein Aufhellen, kein Anstrich), weil das
 * Modell eine Holzdecke durch eine glatte weisse Flaeche ersetzt hatte. Der Boden
 * wird in seiner Substanz NIE veraendert, nur heller und sauberer (der
 * fruehere 30-cm-Streifen ist gestrichen). Rohre, Leitungen und Heizkoerper
 * bleiben ALLE erhalten, hoechstens gepflegter, weil das Modell am 05.09. ein
 * Rohr entfernt hatte. Absaetze und Ueberschriften helfen dem Modell, die
 * Regeln je Bauteil auseinanderzuhalten.
 */
// Regelbloecke, die beide Arbeitsauftraege teilen.

/**
 * Das Modell hat in Tests Fenster entfernt und Rohre erfunden. Positive
 * Bestandslisten ("bleibt genau so") wirken bei Bildmodellen zuverlaessiger
 * als Verbote, deshalb steht dieser Block ganz vorn und wird am Ende knapp
 * wiederholt.
 */
function regelErhalten(): string[] {
  return [
    'PFLICHT, UNVERÄNDERT ERHALTEN:',
    'Alle Fenster, Türen, Treppen, Nischen und Öffnungen bleiben in gleicher Anzahl, an gleicher Position und in gleicher Größe. Kein Fenster und keine Tür darf verschwinden oder neu entstehen.',
    'Alle Rohre, Leitungen, Kabel, Heizkörper, Zähler, Kästen, Ventile, Steckdosen, Schalter und Lampen bleiben in gleicher Anzahl, an gleicher Stelle und in gleicher Führung.',
    'Alle Geräte und Möbel, die fest stehen oder angeschlossen sind (Waschmaschine, Trockner, Heizung, Boiler, Schränke, Regale), bleiben an ihrem Platz.',
    'Die Decke bleibt exakt unverändert, auch in Farbe und Helligkeit, einschließlich aller Deckenverkleidungen wie Holzpaneelen, Holzbrettern, Balken und Platten.',
    'ERFINDE NICHTS: Füge keine Rohre, Leitungen, Fenster, Türen, Lampen, Möbel, Geräte oder sonstigen Gegenstände hinzu, die auf dem Foto nicht vorhanden sind.',
  ]
}

const REGEL_WAND_SANIERT = [
  'Jede betroffene Wandfläche wird zu einer vollkommen ebenen, glatt gespachtelten und deckend weiß gestrichenen Fläche, so homogen wie eine neue Trockenbauwand oder eine frisch verputzte Wand: einfarbig matt weiß, ohne jede Struktur, ohne Relief, ohne Textur.',
  'Das ist KEIN weißer Anstrich über dem alten Mauerwerk. Steine, Ziegel, Fugen und Kanten des alten Mauerwerks sind unter neuem Putz vollständig verschwunden und dürfen nicht durchscheinen, auch nicht schwach, auch nicht als Schatten oder Raster.',
  'Sind diese Wände mit Rigips, Gipskartonplatten, Holzvertäfelung, Paneelen, Regalen an der Wand oder ähnlichen Verkleidungen bedeckt: Entferne diese Verkleidungen vollständig und zeige auch dort eine glatte, weiß gestrichene Wand. Das gilt ausschließlich für Wandflächen, niemals für die Decke.',
  'Sämtliche Feuchtigkeitsschäden, Schimmel, Stockflecken, Salzausblühungen, abblätternde Farbe, Risse und dunkle Flecken sind verschwunden.',
]

const REGEL_BODEN = [
  'BODEN:',
  'Verändere den Boden niemals in seiner Bausubstanz. Fliesen, Fugen, Estrich, Beton, Platten, Muster, Farbe und Aufteilung bleiben exakt so, wie sie auf dem Foto sind. Nichts wird entfernt, ersetzt oder hinzugefügt.',
  'Erlaubt ist nur: Der Boden wirkt sauberer, trockener und durch bessere Beleuchtung etwas heller. Schmutz, Staub, Pfützen und Flecken sind weg. Er muss sofort als derselbe Boden erkennbar sein.',
]

/**
 * Variante "Boden hellgrau" (Yann, 05.09.2026): statt den Boden nur zu
 * saeubern, wird er vollflaechig hellgrau beschichtet gezeigt.
 */
const REGEL_BODEN_HELLGRAU = [
  'BODEN:',
  'Der gesamte Boden ist vollflächig mit einer neuen, hellgrauen Bodenbeschichtung versehen: einfarbig hellgrau, matt, eben, sauber und trocken, wie ein frisch beschichteter Estrich.',
  'Alte Fliesen, Fugen, Muster, Flecken und Beläge sind unter der Beschichtung vollständig verschwunden und scheinen nicht durch, auch nicht als Raster.',
  'Bodenabläufe, Gerätesockel und Anschlüsse am Boden bleiben an ihrer Stelle erhalten.',
  'Die Bodenfläche behält exakt ihre Form, Größe und Perspektive. Wände, Geräte und alles andere bleiben davon unberührt.',
]

const REGEL_LEITUNGEN = [
  'LEITUNGEN, ROHRE UND TECHNIK:',
  'Alle vorhandenen Rohre, Wasserleitungen, Heizungsrohre, Kabel, Kabelkanäle, Lüftungsrohre, Heizkörper, Zähler, Verteilerkästen, Ventile und Anschlüsse bleiben vollständig erhalten, an derselben Stelle, in derselben Form und Führung.',
  'Nichts davon darf entfernt, verkürzt, verlegt oder durch etwas anderes ersetzt werden. Erlaubt ist nur, dass sie gepflegt aussehen, etwa frisch gestrichen oder sauber, ohne Rost und Staub.',
]

const REGEL_GEGENSTAENDE = [
  'GEGENSTÄNDE:',
  'Lose herumstehende Gegenstände wie Eimer, Flaschen, Kartons, Holzreste und Gerümpel sind weggeräumt.',
  'Fest installierte Dinge bleiben unverändert erhalten: Geräte wie Waschmaschinen, Trockner, Heizungen und Boiler samt Schläuchen, Wasseranschlüsse und Armaturen, Türen, Fenster, Treppen, Bodenabläufe, Lichtschalter, Steckdosen und Lampen.',
]

function regelAllgemein(entferntEtwas: boolean): string[] {
  const ausnahme = entferntEtwas ? ' Ausgenommen sind allein die unter ENTFERNEN genannten Elemente, die fehlen müssen.' : ''
  return [
    'ALLGEMEIN:',
    'Behalte exakt dieselbe Kameraperspektive und Raumgeometrie bei.',
    'Der Raum wirkt hell, trocken und sauber, mit neutraler heller Ausleuchtung. Die Decke ist davon ausgenommen und behält ihre ursprüngliche Farbe und Helligkeit.',
    'Das Ergebnis muss wie ein echtes, unbearbeitetes Foto desselben Raums aussehen.',
    'Kein Text, kein Wasserzeichen.',
    'Prüfe zum Schluss: Fenster, Türen, Rohre, Heizkörper und Geräte sind in Anzahl und Lage genau wie auf dem Foto. Nichts fehlt, nichts ist neu.' +
      ausnahme +
      ' Die sanierten Wandflächen sind glatte, einfarbig weiße Flächen ohne erkennbares Stein- oder Fugenmuster. Die Decke ist unverändert wie auf dem Foto, auch in Farbe und Helligkeit; eine vorhandene Holz- oder Plattendecke ist unbearbeitet vorhanden.',
  ]
}

/**
 * Abgewaehlte Bestandselemente (Yann, 05.09.2026): Der Nutzer hakt im
 * Klappmenue "Bestand" ab, was im Ergebnis fehlen soll, etwa ein altes Rohr
 * unter der Decke. Der Block hat Vorrang vor allen Erhalten-Regeln, sonst
 * widerspraeche er ihnen.
 */
function entfernenBlock(entfernen: string[]): string[] {
  if (entfernen.length === 0) return []
  return [
    '',
    'ENTFERNEN (hat Vorrang vor allen Regeln zum Erhalt von Leitungen, Technik und Geräten):',
    'Folgende Elemente sind im Ergebnis nicht mehr vorhanden. Entferne sie rückstandslos, samt Halterungen, Schellen, Schatten und Bohrlöchern, und stelle die Fläche dahinter so dar wie die umgebende sanierte Wand, Decke oder der Boden. Ersetze sie durch nichts anderes:',
    ...entfernen.map((e) => `- ${e}`),
  ]
}

/** Der Arbeitsauftrag: alle Waende und die Decke werden saniert, der Boden je nach Variante. */
function prompt(bestand?: string, bodenHellgrau = false, entfernen: string[] = []): string {
  return [
  'Bearbeite dieses Foto eines Kellers.',
  'Zeige exakt denselben Raum nach einer professionellen Kellersanierung. Halte dich genau an diese Regeln:',
  '',
  ...regelErhalten(),
  ...bestandBlock(bestand),
  ...entfernenBlock(entfernen),
  '',
  'WÄNDE:',
  ...REGEL_WAND_SANIERT,
  '',
  'DECKE:',
  'Die Decke bleibt exakt im Ursprungszustand. Übernimm den gesamten Deckenbereich unverändert aus dem Foto, so als wäre er überhaupt nicht bearbeitet worden.',
  'Kein Anstrich, kein Weißstreichen, keine Aufhellung, keine Reinigung, keine Auffrischung, keine Glättung. Material, Farbe, Helligkeit, Maserung, Fugen, Balken, Gebrauchsspuren und vorhandene Flecken bleiben genau so, wie sie sind.',
  'Deckenverkleidungen wie Holzpaneele, Holzbretter, Balken und Platten bleiben zwingend erhalten. Ersetze die Decke niemals durch eine glatte, verputzte oder weiße Fläche.',
  '',
  ...(bodenHellgrau ? REGEL_BODEN_HELLGRAU : REGEL_BODEN),
  '',
  ...REGEL_LEITUNGEN,
  '',
  ...REGEL_GEGENSTAENDE,
  '',
  ...regelAllgemein(entfernen.length > 0),
].join('\n')
}


export class GeminiFehler extends Error {
  /** true, wenn ein weiterer Versuch ohne Aenderung sinnvoll sein kann. */
  wiederholbar: boolean
  /** true, wenn Google den Schluessel selbst abgelehnt hat (ungueltig, gesperrt, falsche Herkunft). */
  schluesselAbgelehnt: boolean
  constructor(nachricht: string, wiederholbar: boolean, schluesselAbgelehnt = false) {
    super(nachricht)
    this.wiederholbar = wiederholbar
    this.schluesselAbgelehnt = schluesselAbgelehnt
  }
}

type ApiAntwort = {
  candidates?: Array<{
    content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }> }
    finishReason?: string
  }>
  error?: { code?: number; message?: string; status?: string }
}

export type SanierOptionen = {
  /** Vom Textmodell erkannter Bestand, geht als Pflichtliste in den Auftrag. */
  bestand?: string
  /** Variante "Boden sanieren": Boden vollflaechig hellgrau beschichtet statt nur gesaeubert. */
  bodenHellgrau?: boolean
  /**
   * Elemente aus dem erkannten Bestand, die der Nutzer abgewaehlt hat (Yann,
   * 05.09.2026): Sie sollen im Ergebnis verschwinden. Die Zeilen stammen aus
   * der Bestandsliste, damit das Modell dasselbe Element meint.
   */
  entfernen?: string[]
}

/** Schickt das Vorher-Bild (JPEG, Base64) an Gemini und liefert das Nachher-Bild. */
export async function saniereFoto(base64Jpeg: string, optionen: SanierOptionen = {}): Promise<Blob> {
  let antwort: Response
  try {
    antwort = await geminiAnfrage('bild', {
      contents: [
        {
          parts: [
            { inlineData: { mimeType: 'image/jpeg', data: base64Jpeg } },
            {
              text: prompt(optionen.bestand, optionen.bodenHellgrau ?? false, optionen.entfernen ?? []),
            },
          ],
        },
      ],
    })
  } catch (fehler) {
    if (fehler instanceof ApiFehler) throw new GeminiFehler(fehler.message, false)
    throw new GeminiFehler('Keine Verbindung zum Server. Internetverbindung prüfen.', true)
  }

  if (!antwort.ok) {
    let detail = ''
    try {
      const json = (await antwort.json()) as ApiAntwort
      detail = json.error?.message ?? ''
    } catch {
      /* Rumpf war kein JSON */
    }
    if (antwort.status === 503) {
      // Der eigene Server hat keinen Schluessel (server/gemini.mjs)
      throw new GeminiFehler(detail || 'Die Bildbearbeitung ist auf dem Server nicht eingerichtet.', false, true)
    }
    if (antwort.status === 400 || antwort.status === 401 || antwort.status === 403) {
      // Googles Text mitgeben: "reported as leaked" heisst gesperrt, "not valid"
      // heisst geloescht oder falsch, "referer" heisst falsche Herkunft.
      throw new GeminiFehler(
        `Google hat den Zugangsschlüssel abgelehnt. Bitte bei Yann melden. ${detail}`.trim(),
        false,
        true,
      )
    }
    if (antwort.status === 429) {
      // Zwei sehr unterschiedliche Faelle kommen beide als 429:
      // 1. Kein Prepaid-Guthaben im Projekt. Dann ist jedes Kontingent 0 und
      //    Warten hilft nie – Guthaben muss in AI Studio aufgeladen werden.
      // 2. Echte Drosselung, weil gerade zu viele Anfragen laufen.
      const ohneGuthaben =
        /prepayment credits|free_tier_requests, limit: 0|billing details/i.test(detail)
      if (ohneGuthaben) {
        throw new GeminiFehler(
          'Für dieses Google-Projekt ist kein Guthaben vorhanden. Unter aistudio.google.com/billing Guthaben aufladen ("Buy credits", ab 10 $), danach erneut versuchen.',
          false,
        )
      }
      throw new GeminiFehler(
        `Das Kontingent ist gerade ausgeschöpft. Kurz warten und erneut versuchen. ${detail}`.trim(),
        true,
      )
    }
    throw new GeminiFehler(
      `Google meldet einen Fehler (${antwort.status}). ${detail}`.trim(),
      antwort.status >= 500,
    )
  }

  const json = (await antwort.json()) as ApiAntwort
  const parts = json.candidates?.[0]?.content?.parts ?? []
  const bild = parts.find((p) => p.inlineData?.data)
  if (!bild?.inlineData?.data) {
    throw new GeminiFehler('Das Modell hat kein Bild geliefert. Erneut versuchen.', true)
  }

  const roh = atob(bild.inlineData.data)
  const bytes = new Uint8Array(roh.length)
  for (let i = 0; i < roh.length; i++) bytes[i] = roh.charCodeAt(i)
  return new Blob([bytes], { type: bild.inlineData.mimeType ?? 'image/png' })
}

/**
 * Bestandsaufnahme: Was ist auf dem Foto fest vorhanden? Liefert eine Liste
 * mit einer Zeile je Element oder einen leeren Text, wenn der Aufruf scheitert.
 * Wirft absichtlich nie, denn die Bearbeitung soll auch ohne Bestand laufen.
 */
export async function erfasseBestand(base64Jpeg: string): Promise<string> {
  const abbruch = new AbortController()
  const wecker = window.setTimeout(() => abbruch.abort(), 25_000)
  try {
    const antwort = await geminiAnfrage(
      'bestand',
      {
        contents: [
          {
            parts: [
              { inlineData: { mimeType: 'image/jpeg', data: base64Jpeg } },
              { text: BESTAND_PROMPT },
            ],
          },
        ],
        // Nuechtern und wiederholbar, keine Kreativitaet. Genug Platz, damit
        // die Liste nicht mitten in den Rohren abbricht.
        generationConfig: { temperature: 0.1, maxOutputTokens: 2000 },
      },
      abbruch.signal,
    )
    if (!antwort.ok) return ''
    const json = (await antwort.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
    }
    const text = (json.candidates?.[0]?.content?.parts ?? [])
      .map((p) => p.text ?? '')
      .join('\n')
      .trim()
    // Aufzaehlungszeichen weg, Anzahl vorn behalten; Gerede und Gruppennamen raus.
    return text
      .split('\n')
      .map((z) => z.replace(/^\s*[-*•]\s*/, '').replace(/^\d+[.)]\s+(?=\d)/, '').trim())
      .filter((z) => z.length > 2 && !/^[A-ZÄÖÜa-zäöü ]+:$/.test(z))
      .slice(0, 25)
      .join('\n')
  } catch {
    return ''
  } finally {
    window.clearTimeout(wecker)
  }
}
