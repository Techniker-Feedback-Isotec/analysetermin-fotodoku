// Kundensuche in MeisterTask fuer die Seite Kunde.
//
// Jeder Vertriebler hat ein Board "<Kuerzel>_Ersttermine" (14 Stueck, gemessen
// 08.09.2026). Gesucht wird ausschliesslich in den Spalten "Phase 0",
// "Auftragsbesprechungen" und "Angebote" (Yann, 08.09.2026; Angebote kam nach
// dem ersten Test dazu, alles Weitere bleibt draussen). Die Liste zeigt je Aufgabe
// nur "Name, Ort", gekuerzt aus dem Aufgabentitel; die Felder einer Aufgabe
// (Name, Anschriften, Baujahr) werden erst geholt, wenn jemand sie auswaehlt.
//
// Ausnahme technische Leitung: Gerd Kahlau hat kein Ersttermine-Board, er
// arbeitet auf dem Board "Reklamationen" (Yann, 09.09.2026). Dort gelten alle
// offenen Aufgaben, weil das Board keine Phasen wie der Vertrieb kennt.
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
const ANGEBOTE = ['angebote', 'angebot']
const norm = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim()
const istGesuchteSpalte = (name) => {
  const n = norm(name)
  return PHASE0.includes(n) || BESPRECHUNG.includes(n) || ANGEBOTE.includes(n)
}

/**
 * Feldnamen der Boards, aus denen die Kundendaten kommen. Die Typ-IDs sind je
 * Board verschieden (Baujahr ist 437272 auf YF, 305081 auf HM), deshalb immer
 * ueber den Namen aufloesen. Die Reihenfolge ist die Vorliebe: Auf dem
 * Reklamationsboard gibt es beide Namensschemata nebeneinander ("Name (KUNDE)"
 * und "Kunde", "Anschrift (OBJEKT)" und "Adresse (Objekt)").
 */
const FELDER = {
  kunde: ['name (kunde)', 'kunde'],
  kundenadresse: ['anschrift (kunde)', 'adresse (kunde)'],
  objektadresse: ['anschrift (objekt)', 'adresse (objekt)'],
  baujahr: ['baujahr'],
  objektart: ['objektart'],
}

/**
 * Wer sucht in welchem Board? Ohne Eintrag gilt "<Kuerzel>_Ersttermine".
 * Der Schluessel ist der Anzeigename aus der Mitarbeiterliste, klein.
 */
const SONDERBOARDS = {
  // Technische Leitung: Reklamationen statt Ersttermine (Yann, 09.09.2026)
  'gerd kahlau': { name: 'reklamationen', art: 'reklamation' },
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
  // Auf dem Reklamationsboard steht das Wort oft mitten im Titel und leitet
  // die Beschreibung ein ("…, Duisburg, Reklamation Ausführung 2024 (?)")
  /\breklamation/i,
]

/**
 * Reklamationstitel tragen Datum und Wort vorn statt hinten:
 * "12.04.2022 Reklamation - HV Schlayer, …" oder "Reklamation - Bartholomeus,
 * Mülheim". Beides weg, damit die Kuerzung wie bei den Ersttermin-Titeln
 * greift (dort schneidet das Datum den Rest ab, hier stuende es am Anfang).
 */
const VORNE_WEG = [/^\d{1,2}\.\d{1,2}\.\d{2,4}\s*[-,/]?\s*/, /^reklamation\s*[-,/:]?\s*/i]
const GEDANKENSTRICH = /\s[-–]\s/
const REST_DAHINTER = /\b(?:ausf(?:ührung|ühung|\.)|BL\s*[:.]|team|KW\s*\d|auftragsbesprechung|RM)/i
const TEILAUFTRAG = /\s*\b\d+\s*v(?:on)?\s*\d+\b\s*[:.\-]?\s*/i
const OBJEKT_WORT = /\bObjekt\s+/gi
const KLAMMERN_AM_ENDE = /\s*\([^)]*\)\s*$/
const RANDSTRICH = /^[\s\-–]+|[\s\-–]+$/g
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
  // Fuehrendes Datum und fuehrendes "Reklamation" (auch beides nacheinander)
  for (let runde = 0; runde < 2; runde++) {
    for (const muster of VORNE_WEG) rest = rest.replace(muster, '')
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
    // Loser Gedankenstrich am Rand eines Teils ("YF - Dr. Goetker", "Moers - Angebot"
    // nach dem Schnitt am Datum) gehoert nicht zum Namen
    .map((t) => t.trim().replace(KLAMMERN_AM_ENDE, '').replace(RANDSTRICH, '').trim())
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
  if (gefunden) return teile.join(', ')
  // Ohne Abschneider ist unklar, wo der Name aufhoert und die Beschreibung
  // beginnt. Gesucht ist "Name, Ort", und der Ort steht am Ende - deshalb
  // erster und letzter Teil ("Fr. Conle-Hüttner, Gestüt Wiesenhof, Krefeld"
  // wird zu "Fr. Conle-Hüttner, Krefeld").
  if (teile.length > 2) return `${teile[0]}, ${teile[teile.length - 1]}`
  return teile.join(', ')
}

// ---------- Feldwerte saeubern ----------
//
// Auf dem Reklamationsboard stehen in den Feldern teils ganze Mailverlaeufe
// (gemessen 09.09.2026: das Feld "Kunde" einer Aufgabe enthielt den kompletten
// Schriftwechsel). Ungeprueft uebernommen stuende so etwas als Kundenname auf
// dem Deckblatt. Deshalb wird jeder Wert auf das reduziert, was eine Anschrift
// oder ein Name sein kann.

/** Zeilen, die aus einem eingefuegten Mailverlauf stammen. */
const MAILZEILE = /(@|^(von|gesendet|an|betreff|cc|hallo|sehr geehrte)\b)/i

/** Ein Name: die erste Zeile. Sieht sie nach Fliesstext aus, lieber nichts. */
function alsName(text) {
  const zeile = text.split(/\n/).map((z) => z.trim()).find(Boolean) ?? ''
  if (zeile.length > 120 || MAILZEILE.test(zeile)) return ''
  return zeile
}

/** Eine Anschrift: bis zu drei Zeilen, mit Komma verbunden. */
function alsAnschrift(text) {
  const zeilen = []
  for (const roh of text.split(/\n/)) {
    const zeile = roh.trim()
    if (!zeile) continue
    if (MAILZEILE.test(zeile)) break
    zeilen.push(zeile)
    if (zeilen.length === 3) break
  }
  const ganz = zeilen.join(', ')
  return ganz.length > 150 ? '' : ganz
}

/** Ein kurzer Wert wie das Baujahr ("1971", "190x"). */
function alsKurz(text) {
  const zeile = text.split(/\n/)[0].trim()
  return zeile.length > 20 ? '' : zeile
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

  /**
   * Das Board eines Mitarbeiters: normal "<Kuerzel>_Ersttermine", fuer die
   * technische Leitung das Reklamationsboard (siehe SONDERBOARDS).
   */
  async function boardFuer(mitarbeiterName) {
    const sonder = SONDERBOARDS[norm(mitarbeiterName)]
    const liste = await projekte()
    if (sonder) {
      const board = liste.find((p) => p.status === 1 && norm(p.name) === sonder.name) ?? null
      return { kuerzel: null, board, art: sonder.art, gesucht: sonder.name }
    }
    const kuerzel = kuerzelVon(mitarbeiterName)
    if (!kuerzel) return { kuerzel: null, board: null, art: 'ersttermine', gesucht: null }
    const gesucht = norm(`${kuerzel}_ersttermine`)
    const board = liste.find((p) => p.status === 1 && norm(p.name) === gesucht) ?? null
    return { kuerzel, board, art: 'ersttermine', gesucht: `${kuerzel}_Ersttermine` }
  }

  /**
   * Die Kundenliste eines Mitarbeiters, je Aufgabe "Name, Ort".
   *
   * Ersttermine-Board: nur die Spalten Phase 0, Auftragsbesprechungen und
   * Angebote. Reklamationsboard: alle offenen Aufgaben, denn dort bilden die
   * Spalten den Bearbeitungsstand ab und nicht die Vertriebsphase.
   */
  async function kundenliste(mitarbeiterName) {
    const { kuerzel, board, art, gesucht } = await boardFuer(mitarbeiterName)
    if (!board) {
      return {
        board: null,
        art,
        eintraege: [],
        grund: gesucht
          ? `Für ${mitarbeiterName} gibt es kein Board ${gesucht}.`
          : 'Ohne Mitarbeiter kein Board.',
      }
    }
    const [spaltenListe, aufgaben] = await Promise.all([spalten(board.id), offeneAufgaben(board.id)])
    const spaltenName = new Map(spaltenListe.map((s) => [s.id, s.name]))
    const eintraege = aufgaben
      .map((t) => ({ t, spalte: spaltenName.get(t.section_id) ?? t.section_name ?? '' }))
      .filter(({ spalte }) => art === 'reklamation' || istGesuchteSpalte(spalte))
      .map(({ t, spalte }) => ({
        id: t.id,
        projekt: board.id,
        token: t.token,
        spalte,
        titel: t.name,
        anzeige: kundeUndOrt(t.name, kuerzel),
      }))
      .sort((a, b) => a.anzeige.localeCompare(b.anzeige, 'de'))
    return { board: board.name, art, eintraege }
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
    // Je Angabe der erste Feldname, der etwas Brauchbares liefert: auf dem
    // Reklamationsboard ist "Kunde" mal der Name und mal ein ganzer Mailverlauf,
    // dann traegt das zweite Feld.
    const wert = (schluessel, saeubern) => {
      for (const n of FELDER[schluessel]) {
        const sauber = felder[n] ? saeubern(felder[n]) : ''
        if (sauber) return sauber
      }
      return ''
    }
    return {
      kunde: wert('kunde', alsName),
      // Anschriften stehen im Board mit Zeilenumbruch ("Rotkehlchenweg 3\n41749 Viersen")
      kundenadresse: wert('kundenadresse', alsAnschrift),
      objektadresse: wert('objektadresse', alsAnschrift),
      baujahr: wert('baujahr', alsKurz),
      objektart: wert('objektart', alsKurz),
    }
  }

  // ---------- Anhaenge: Dokumente in die Kundenaufgabe legen ----------
  //
  // Yann, 11.09.2026: Ueber die Seite Kunden sollen erzeugte Dokumente per
  // Knopf in die richtige Kundenaufgabe in MeisterTask. Eine vorher abgelegte
  // Datei derselben Art wird ersetzt, damit je Art nur ein Original dort
  // liegt. Die Art ist das Wort im Dateinamen (Prinzipskizze,
  // Fotodokumentation, Angebotsmappe, Sanierungsvorschau, Videodokumentation);
  // verglichen wird tolerant, klein und ohne Leerzeichen.

  const anhaenge = (aufgabeId) => alle(`/tasks/${aufgabeId}/attachments`)

  async function loescheAnhang(anhangId) {
    const r = await fetch(`${MEISTERTASK}/attachments/${anhangId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })
    // 404: schon weg, das ist in Ordnung
    if (!r.ok && r.status !== 404) {
      throw new MeisterTaskFehler(`MeisterTask konnte den alten Anhang nicht entfernen (${r.status}).`, r.status)
    }
  }

  async function ladeAnhangHoch(aufgabeId, name, bytes, typ) {
    const form = new FormData()
    form.append('name', name)
    form.append('local', new Blob([bytes], { type: typ || 'application/octet-stream' }), name)
    const r = await fetch(`${MEISTERTASK}/tasks/${aufgabeId}/attachments`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      body: form,
    })
    if (!r.ok) {
      const text = await r.text().catch(() => '')
      throw new MeisterTaskFehler(
        r.status === 429
          ? 'MeisterTask drosselt gerade (zu viele Abrufe). Kurz warten.'
          : `MeisterTask nimmt den Anhang nicht an (${r.status}). ${text.slice(0, 200)}`.trim(),
        r.status,
      )
    }
    return r.json()
  }

  /**
   * Datei in die Aufgabe legen und Anhaenge derselben Art entfernen. Erst
   * wenn die neue Datei sicher liegt, gehen die alten weg; scheitert das
   * Hochladen, bleibt alles wie es war.
   */
  async function ersetzeAnhang(aufgabeId, art, name, bytes, typ) {
    if (!token) throw new MeisterTaskFehler('Kein MeisterTask-Token hinterlegt.', 503)
    const suchwort = norm(art).replace(/\s+/g, '')
    if (!suchwort) throw new MeisterTaskFehler('Ohne Art des Dokuments kann nichts ersetzt werden.', 400)
    const vorhanden = await anhaenge(aufgabeId)
    const alte = vorhanden.filter((a) => norm(a.name).replace(/\s+/g, '').includes(suchwort))
    const neu = await ladeAnhangHoch(aufgabeId, name, bytes, typ)
    for (const a of alte) {
      if (a.id !== neu.id) await loescheAnhang(a.id)
    }
    return { id: neu.id, name: neu.name ?? name, ersetzt: alte.map((a) => a.name) }
  }

  return { kundenliste, kundendaten, ersetzeAnhang }
}
