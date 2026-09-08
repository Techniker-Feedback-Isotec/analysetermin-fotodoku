// Kundensuche in MeisterTask fuer die Seite Kunde.
//
// Jeder Vertriebler hat ein Board "<Kuerzel>_Ersttermine" (14 Stueck, gemessen
// 08.09.2026). Gesucht wird ausschliesslich in den Spalten "Phase 0" und
// "Auftragsbesprechungen" (Yann: "sonst keine!"). Die Liste zeigt je Aufgabe
// nur "Name, Ort", gekuerzt aus dem Aufgabentitel; die Felder einer Aufgabe
// (Name, Anschriften, Baujahr) werden erst geholt, wenn jemand sie auswaehlt.
//
// Das Modul ist browserfrei und paketfrei und wird von zwei Stellen benutzt:
// vom Dev-Server (vite.config.ts) und vom Azure-Server (server/index.mjs).
// Beide reichen ihre Token hinein; die Token liegen nur auf dem Server.
//
// Kontingent: die MeisterTask-API erlaubt 100 Abrufe je Minute je Token, und
// alle Nutzer teilen sich dieses eine Bot-Token. Deshalb werden Projekte,
// Spalten und Feldtypen zehn Minuten, die Aufgabenliste eines Boards 45
// Sekunden im Speicher gehalten. Eine Suche kostet so im Normalfall keinen
// einzigen Abruf, ein Boardwechsel einen, eine Auswahl einen.

const MEISTERTASK = 'https://www.meistertask.com/api'

/** Spaltennamen sind kein Vertrag: Yann benennt sie um, deshalb tolerant vergleichen. */
const PHASE0 = ['phase 0', 'phase0', 'ersttermine']
const BESPRECHUNG = ['auftragsbesprechung', 'auftragsbesprechungen', 'zweittermine', 'zweitermine']
const norm = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim()
const istGesuchteSpalte = (name) => PHASE0.includes(norm(name)) || BESPRECHUNG.includes(norm(name))

/**
 * Feldnamen der Boards, aus denen die Kundendaten kommen. Die Typ-IDs sind je
 * Board verschieden (Baujahr ist 437272 auf YF, 305081 auf HM), deshalb immer
 * ueber den Namen aufloesen.
 */
const FELDER = {
  kunde: ['name (kunde)', 'kunde'],
  kundenadresse: ['anschrift (kunde)', 'adresse (kunde)'],
  objektadresse: ['anschrift (objekt)', 'adresse (objekt)'],
  baujahr: ['baujahr'],
  objektart: ['objektart'],
}

/** "Yann Feyen" -> "YF": erster Buchstabe von erstem und letztem Wort. */
export function kuerzelVon(name) {
  const woerter = String(name ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (woerter.length < 2) return null
  return (woerter[0][0] + woerter[woerter.length - 1][0]).toUpperCase()
}

// ---------- Titel kuerzen: "Name, Ort" ----------
//
// Uebernommen aus dem Vertriebsprozess-Werkzeug (lib/titel.ts, dort an 313
// Titeln gemessen) und um die Muster der Ersttermine-Boards ergaenzt. Die
// Titel dort lauten etwa "YF Christian Erbe, Mülheim, 09.09.2026 um 10:00 Uhr",
// "HM, Hr. Spolders, Alpen, 05.08.2026, 12:30 Uhr" oder "YF Eileen Heuser,
// Straelen Auftragsbesprechung 11.09.2026 15 Uhr".

const ABSCHNEIDER = [
  /\bausf(?:ührung|ühung|\.)/i,
  /\bBL\s*[:.]/i,
  /\bteam\b/i,
  /\d{1,2}\.\d{1,2}\.\d{2,4}/,
  /\bKW\s*\d/i,
  /\bauftragsbesprechung\b/i,
  /\bAB\s+\d/,
  /\bRM\b/,
  /\bxx\.xx\./i,
]
const GEDANKENSTRICH = /\s[-–]\s/
const REST_DAHINTER = /\b(?:ausf(?:ührung|ühung|\.)|BL\s*[:.]|team|KW\s*\d|auftragsbesprechung|RM)/i
const TEILAUFTRAG = /\s*\b\d+\s*v(?:on)?\s*\d+\b\s*[:.\-]?\s*/i
const OBJEKT_WORT = /\bObjekt\s+/gi
const KLAMMERN_AM_ENDE = /\s*\([^)]*\)\s*$/
const VERMERKE = /^(altkunde|neukunde|folgeauftrag|\d+\.\s*Projekt)$/i
const BESCHREIBUNG_AB = 30

/** Der Titel, gekuerzt auf Auftraggeber und Ort. */
export function kundeUndOrt(titel, kuerzel) {
  let rest = String(titel ?? '')
    .replace(/\s+/g, ' ')
    .trim()

  // Das Vertriebler-Kuerzel vorn faellt weg, mit oder ohne Komma dahinter
  if (kuerzel) {
    rest = rest.replace(new RegExp(`^${kuerzel}\\s*,?\\s+`, 'i'), '')
  }

  let schnitt = rest.length
  for (const muster of ABSCHNEIDER) {
    const treffer = muster.exec(rest)
    if (treffer && treffer.index < schnitt) schnitt = treffer.index
  }
  const strich = GEDANKENSTRICH.exec(rest)
  if (strich && strich.index < schnitt && REST_DAHINTER.test(rest.slice(strich.index))) {
    schnitt = strich.index
  }
  const gefunden = schnitt < rest.length

  let teile = rest
    .slice(0, schnitt)
    .replace(TEILAUFTRAG, ', ')
    .replace(OBJEKT_WORT, '')
    .split(',')
    .map((t) => t.trim().replace(KLAMMERN_AM_ENDE, '').trim())
    .filter(Boolean)
    .filter((t) => !VERMERKE.test(t))

  const beschreibung = teile.findIndex((t, i) => i > 0 && t.length > BESCHREIBUNG_AB)
  if (beschreibung > 0) {
    const letzter = teile[teile.length - 1]
    const behalten = teile.slice(0, beschreibung)
    teile =
      beschreibung < teile.length - 1 && letzter.length <= BESCHREIBUNG_AB
        ? [...behalten, letzter]
        : behalten
  }

  if (teile.length === 0) return rest
  return (gefunden ? teile : teile.slice(0, 2)).join(', ')
}

// ---------- Zwischenspeicher ----------

const LANGE_FRIST = 10 * 60_000
const KURZE_FRIST = 45_000

/**
 * Haelt ein Versprechen fuer eine Frist. Zwei gleichzeitige Leser starten so
 * nur einen Abruf; ein Fehlschlag raeumt sich selbst weg.
 */
function speicher() {
  const ablage = new Map()
  return (schluessel, frist, holen) => {
    const da = ablage.get(schluessel)
    if (da && Date.now() - da.zeit < frist) return da.wert
    const wert = holen()
    ablage.set(schluessel, { wert, zeit: Date.now() })
    wert.catch(() => {
      if (ablage.get(schluessel)?.wert === wert) ablage.delete(schluessel)
    })
    return wert
  }
}

export class MeisterTaskFehler extends Error {
  constructor(nachricht, status) {
    super(nachricht)
    this.status = status
  }
}

/**
 * Baut den Kundendienst mit den beiden Token. `token` gehoert dem ISOTEC Bot
 * (Mitglied aller Boards); `feldToken` braucht ein Konto mit Business-Sitzplatz,
 * weil die benutzerdefinierten Felder am Abo des abrufenden Kontos haengen
 * (das Bot-Token bekommt dort 403). Fehlt es, gilt das Bot-Token und die
 * Auswahl fuellt nur den Namen.
 */
export function erzeugeKundendienst({ token, feldToken }) {
  const gemerkt = speicher()
  const feld = feldToken || token

  async function api(pfad, tok = token) {
    if (!tok) throw new MeisterTaskFehler('Kein MeisterTask-Token hinterlegt.', 503)
    const r = await fetch(MEISTERTASK + pfad, {
      headers: { Authorization: `Bearer ${tok}`, Accept: 'application/json' },
    })
    if (!r.ok) {
      throw new MeisterTaskFehler(
        r.status === 429
          ? 'MeisterTask drosselt gerade (zu viele Abrufe). Kurz warten.'
          : `MeisterTask antwortet mit ${r.status}.`,
        r.status,
      )
    }
    return r.json()
  }

  /** Listen kommen seitenweise, 100 je Seite; ohne items= liefert die API nur 50. */
  async function alle(pfad, tok = token, maxSeiten = 10) {
    const trenner = pfad.includes('?') ? '&' : '?'
    const aus = []
    for (let seite = 1; seite <= maxSeiten; seite++) {
      const teil = await api(`${pfad}${trenner}items=100&page=${seite}`, tok)
      if (!Array.isArray(teil)) break
      aus.push(...teil)
      if (teil.length < 100) break
    }
    return aus
  }

  const projekte = () => gemerkt('projekte', LANGE_FRIST, () => alle('/projects'))
  const spalten = (projektId) =>
    gemerkt(`spalten.${projektId}`, LANGE_FRIST, () => alle(`/projects/${projektId}/sections`))
  const feldtypen = (projektId) =>
    gemerkt(`felder.${projektId}`, LANGE_FRIST, () =>
      alle(`/projects/${projektId}/custom_field_types`, feld),
    )
  const offeneAufgaben = (projektId) =>
    gemerkt(`aufgaben.${projektId}`, KURZE_FRIST, () =>
      alle(`/projects/${projektId}/tasks?status=open`),
    )

  /** Das Ersttermine-Board eines Mitarbeiters, oder null. */
  async function boardFuer(mitarbeiterName) {
    const kuerzel = kuerzelVon(mitarbeiterName)
    if (!kuerzel) return { kuerzel: null, board: null }
    const gesucht = norm(`${kuerzel}_ersttermine`)
    const liste = await projekte()
    const board = liste.find((p) => p.status === 1 && norm(p.name) === gesucht) ?? null
    return { kuerzel, board }
  }

  /**
   * Die Kundenliste eines Mitarbeiters: offene Aufgaben seines Boards in den
   * Spalten Phase 0 und Auftragsbesprechungen, je Aufgabe "Name, Ort".
   */
  async function kundenliste(mitarbeiterName) {
    const { kuerzel, board } = await boardFuer(mitarbeiterName)
    if (!board) {
      return {
        board: null,
        eintraege: [],
        grund: kuerzel
          ? `Für ${mitarbeiterName} gibt es kein Board ${kuerzel}_Ersttermine.`
          : 'Ohne Mitarbeiter kein Board.',
      }
    }
    const [spaltenListe, aufgaben] = await Promise.all([spalten(board.id), offeneAufgaben(board.id)])
    const spaltenName = new Map(spaltenListe.map((s) => [s.id, s.name]))
    const eintraege = aufgaben
      .map((t) => ({ t, spalte: spaltenName.get(t.section_id) ?? t.section_name ?? '' }))
      .filter(({ spalte }) => istGesuchteSpalte(spalte))
      .map(({ t, spalte }) => ({
        id: t.id,
        projekt: board.id,
        token: t.token,
        spalte,
        titel: t.name,
        anzeige: kundeUndOrt(t.name, kuerzel),
      }))
      .sort((a, b) => a.anzeige.localeCompare(b.anzeige, 'de'))
    return { board: board.name, eintraege }
  }

  /** Die Werte der Kundenfelder einer Aufgabe; leere Felder fehlen. */
  async function kundendaten(aufgabeId, projektId) {
    let projekt = projektId
    if (!projekt) {
      const aufgabe = await api(`/tasks/${aufgabeId}`)
      projekt = aufgabe.project_id
    }
    const typen = await feldtypen(projekt)
    const nameVonTyp = new Map(typen.map((t) => [t.id, norm(t.name)]))
    const werte = await alle(`/tasks/${aufgabeId}/custom_fields`, feld)
    const felder = {}
    for (const w of werte) {
      const name = nameVonTyp.get(w.custom_field_type_id)
      if (name && w.value) felder[name] = String(w.value).trim()
    }
    const wert = (schluessel) => {
      for (const n of FELDER[schluessel]) if (felder[n]) return felder[n]
      return ''
    }
    // Anschriften stehen im Board mit Zeilenumbruch ("Rotkehlchenweg 3\n41749 Viersen")
    const einzeilig = (s) => s.split(/\s*\n+\s*/).filter(Boolean).join(', ')
    return {
      kunde: wert('kunde'),
      kundenadresse: einzeilig(wert('kundenadresse')),
      objektadresse: einzeilig(wert('objektadresse')),
      baujahr: wert('baujahr'),
      objektart: wert('objektart'),
    }
  }

  return { kundenliste, kundendaten }
}
