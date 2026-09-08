/**
 * Anbindung an Google Gemini.
 *
 * Der Aufruf geht direkt aus dem Browser an die Google-API, es gibt keinen
 * eigenen Server. Der Schluessel kommt aus schluessel.ts.
 */

/**
 * Bildmodell. Seit 05.09.2026 das Pro-Modell (Entscheidung Yann): Das
 * Flash-Modell liess unter dem weissen Putz das Ziegelmuster durchscheinen
 * und hielt Vorgaben zu Fenstern und Rohren schlechter ein. Pro kostet etwa
 * das Dreifache je Bild, dafuer folgt es dem Auftrag deutlich strenger.
 * Vorgaenger: 'gemini-2.5-flash-image'.
 */
const MODELL = 'gemini-3-pro-image'
const URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODELL}:generateContent`

/**
 * Textmodell mit Bildverstaendnis fuer die Bestandsaufnahme vor der
 * Bearbeitung (Yanns Entscheidung vom 05.09.2026, "Hebel 1"): Es listet auf,
 * was auf dem Foto fest vorhanden ist, und diese Liste geht als Pflichtbestand
 * in den Bildauftrag. So ist das Bildmodell auf DIESES Foto festgenagelt statt
 * auf allgemeine Regeln. Kostet unter einem Cent je Foto.
 */
const BESTAND_MODELL = 'gemini-3.8-flash'
const BESTAND_URL = `https://generativelanguage.googleapis.com/v1beta/models/${BESTAND_MODELL}:generateContent`

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
 * Rigips oder Holzvertaefelung verschwinden (das gefaellt ihm). Der Boden
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
function regelErhalten(moeblieren: boolean): string[] {
  return [
    'PFLICHT, UNVERÄNDERT ERHALTEN:',
    'Alle Fenster, Türen, Treppen, Nischen und Öffnungen bleiben in gleicher Anzahl, an gleicher Position und in gleicher Größe. Kein Fenster und keine Tür darf verschwinden oder neu entstehen.',
    'Alle Rohre, Leitungen, Kabel, Heizkörper, Zähler, Kästen, Ventile, Steckdosen, Schalter und Lampen bleiben in gleicher Anzahl, an gleicher Stelle und in gleicher Führung.',
    'Alle Geräte und Möbel, die fest stehen oder angeschlossen sind (Waschmaschine, Trockner, Heizung, Boiler, Schränke, Regale), bleiben an ihrem Platz.',
    moeblieren
      ? 'ERFINDE KEINE BAUTEILE: Füge keine Rohre, Leitungen, Fenster, Türen, Lampen oder technischen Geräte hinzu, die auf dem Foto nicht vorhanden sind. Neue Einrichtung ist nur so erlaubt, wie der Abschnitt EINRICHTUNG es beschreibt.'
      : 'ERFINDE NICHTS: Füge keine Rohre, Leitungen, Fenster, Türen, Lampen, Möbel, Geräte oder sonstigen Gegenstände hinzu, die auf dem Foto nicht vorhanden sind.',
  ]
}

/**
 * Variante "Moeblieren" (Yann, 05.09.2026): Der sanierte Raum bekommt passende
 * Einrichtung, die seinen moeglichen Nutzen zeigt, etwa Waeschestaender bei
 * einer Waschmaschine. Zurueckhaltend, realistisch, nichts verdecken.
 */
const REGEL_EINRICHTUNG = [
  'EINRICHTUNG:',
  'Richte den sanierten Raum passend und glaubwürdig ein, damit man seinen möglichen Nutzen sieht: wohnlich, aufgeräumt, hochwertig und zurückhaltend, wie in einem gepflegten Haushalt.',
  'Wähle die Einrichtung nach dem, was auf dem Foto vorhanden ist. Beispiele: Bei einer Waschmaschine ein Wäscheständer mit aufgehängter Wäsche, ein Wäschekorb und ein kleines Regal mit Waschmittel. Bei einem leeren Raum ein ordentliches Regal mit Vorratsgläsern oder beschrifteten Kisten, eine aufgeräumte Werkbank, ein Fahrrad an der Wand oder eine kleine Sitzecke mit Sessel, Teppich und Stehlampe. Bei einem Heizungsraum ein sauberes Regal. Bei einem hellen Raum mit Fenster auch ein Schreibtisch mit Stuhl oder ein Fitnessgerät.',
  'Drei bis fünf Gegenstände, nicht mehr. Sie stehen frei im Raum oder an der Wand, in realistischer Größe und Perspektive, mit stimmigen Schatten und passendem Licht.',
  'Die Einrichtung verdeckt keine Fenster, Türen, Rohre, Heizkörper, Zähler oder Anschlüsse und verändert nichts an Wänden, Decke, Boden und der vorhandenen Technik.',
  'Keine Menschen, keine Tiere, kein Text, keine Marken.',
]

const REGEL_WAND_SANIERT = [
  'Jede betroffene Wandfläche wird zu einer vollkommen ebenen, glatt gespachtelten und deckend weiß gestrichenen Fläche, so homogen wie eine neue Trockenbauwand oder eine frisch verputzte Wand: einfarbig matt weiß, ohne jede Struktur, ohne Relief, ohne Textur.',
  'Das ist KEIN weißer Anstrich über dem alten Mauerwerk. Steine, Ziegel, Fugen und Kanten des alten Mauerwerks sind unter neuem Putz vollständig verschwunden und dürfen nicht durchscheinen, auch nicht schwach, auch nicht als Schatten oder Raster.',
  'Sind diese Wände mit Rigips, Gipskartonplatten, Holzvertäfelung, Paneelen, Regalen an der Wand oder ähnlichen Verkleidungen bedeckt: Entferne diese Verkleidungen vollständig und zeige auch dort eine glatte, weiß gestrichene Wand.',
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

function regelAllgemein(moeblieren: boolean, entferntEtwas: boolean): string[] {
  const ausnahme = entferntEtwas ? ' Ausgenommen sind allein die unter ENTFERNEN genannten Elemente, die fehlen müssen.' : ''
  return [
    'ALLGEMEIN:',
    'Behalte exakt dieselbe Kameraperspektive und Raumgeometrie bei.',
    'Der Raum wirkt hell, trocken und sauber, mit neutraler heller Ausleuchtung.',
    'Das Ergebnis muss wie ein echtes, unbearbeitetes Foto desselben Raums aussehen.',
    'Kein Text, kein Wasserzeichen.',
    (moeblieren
      ? 'Prüfe zum Schluss: Fenster, Türen, Rohre, Heizkörper und vorhandene Geräte sind in Anzahl und Lage genau wie auf dem Foto, nichts davon fehlt. Neu ist ausschließlich die beschriebene Einrichtung.'
      : 'Prüfe zum Schluss: Fenster, Türen, Rohre, Heizkörper und Geräte sind in Anzahl und Lage genau wie auf dem Foto. Nichts fehlt, nichts ist neu.') +
      ausnahme +
      ' Die sanierten Wandflächen sind glatte, einfarbig weiße Flächen ohne erkennbares Stein- oder Fugenmuster.',
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
function prompt(
  bestand?: string,
  bodenHellgrau = false,
  moeblieren = false,
  entfernen: string[] = [],
): string {
  return [
  'Bearbeite dieses Foto eines Kellers.',
  'Zeige exakt denselben Raum nach einer professionellen Kellersanierung. Halte dich genau an diese Regeln:',
  '',
  ...regelErhalten(moeblieren),
  ...bestandBlock(bestand),
  ...entfernenBlock(entfernen),
  '',
  'WÄNDE:',
  ...REGEL_WAND_SANIERT,
  '',
  'DECKE:',
  'Die Decke ist glatt verputzt und weiß gestrichen, ohne Flecken und Schäden.',
  '',
  ...(bodenHellgrau ? REGEL_BODEN_HELLGRAU : REGEL_BODEN),
  '',
  ...REGEL_LEITUNGEN,
  '',
  ...REGEL_GEGENSTAENDE,
  ...(moeblieren ? ['', ...REGEL_EINRICHTUNG] : []),
  '',
  ...regelAllgemein(moeblieren, entfernen.length > 0),
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
  /** Variante "Moeblieren": passende Einrichtung, die den Nutzen des Raums zeigt. */
  moeblieren?: boolean
  /**
   * Elemente aus dem erkannten Bestand, die der Nutzer abgewaehlt hat (Yann,
   * 05.09.2026): Sie sollen im Ergebnis verschwinden. Die Zeilen stammen aus
   * der Bestandsliste, damit das Modell dasselbe Element meint.
   */
  entfernen?: string[]
}

/** Schickt das Vorher-Bild (JPEG, Base64) an Gemini und liefert das Nachher-Bild. */
export async function saniereFoto(
  base64Jpeg: string,
  schluessel: string,
  optionen: SanierOptionen = {},
): Promise<Blob> {
  let antwort: Response
  try {
    antwort = await fetch(URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': schluessel,
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { inlineData: { mimeType: 'image/jpeg', data: base64Jpeg } },
              {
                text: prompt(
                  optionen.bestand,
                  optionen.bodenHellgrau ?? false,
                  optionen.moeblieren ?? false,
                  optionen.entfernen ?? [],
                ),
              },
            ],
          },
        ],
      }),
    })
  } catch {
    throw new GeminiFehler('Keine Verbindung zu Google. Internetverbindung prüfen.', true)
  }

  if (!antwort.ok) {
    let detail = ''
    try {
      const json = (await antwort.json()) as ApiAntwort
      detail = json.error?.message ?? ''
    } catch {
      /* Rumpf war kein JSON */
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
export async function erfasseBestand(base64Jpeg: string, schluessel: string): Promise<string> {
  const abbruch = new AbortController()
  const wecker = window.setTimeout(() => abbruch.abort(), 25_000)
  try {
    const antwort = await fetch(BESTAND_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': schluessel },
      signal: abbruch.signal,
      body: JSON.stringify({
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
      }),
    })
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
