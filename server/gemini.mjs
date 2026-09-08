// Weiterleitung an Google Gemini fuer die Sanierungsvorschau.
//
// Bis zum 08.09.2026 rief der Browser Google direkt auf, mit einem beim Bauen
// kodiert mitgelieferten Schluessel (GitHub Pages hatte keinen Server). Seit
// dem Umzug nach Azure liegt der Schluessel als Anwendungseinstellung
// GEMINI_SCHLUESSEL auf dem Server und verlaesst ihn nie. Der Browser schickt
// den fertigen Anfragerumpf an /api/gemini/<art>, der Server setzt Modell und
// Schluessel ein und reicht Googles Antwort unveraendert zurueck, damit die
// Fehlerbehandlung im Browser (429 ohne Guthaben, 400 Schluessel) weiter greift.
//
// Wird von Dev-Server (vite.config.ts) und Azure-Server (server/index.mjs)
// geteilt.

/**
 * Die Modelle je Aufgabe. Bild: seit 05.09.2026 das Pro-Modell (Entscheidung
 * Yann, haelt Vorgaben zu Fenstern und Rohren strenger ein). Bestand: das
 * Textmodell fuer die Bestandsliste vor der Bearbeitung.
 */
export const GEMINI_MODELLE = {
  bild: 'gemini-3-pro-image',
  bestand: 'gemini-3.8-flash',
}

/**
 * Der Schluessel ist in Google auf die Adresse der alten GitHub-Pages-Seite
 * beschraenkt (HTTP-Referrer). Ein Server schickt von sich aus keinen
 * Referer und wuerde abgelehnt; deshalb steht hier die zugelassene Adresse.
 * Damit bleibt die Beschraenkung als Schutz gegen einen kopierten Schluessel
 * bestehen, ohne dass sie in der Google-Konsole geaendert werden muss.
 */
const REFERER = 'https://techniker-feedback-isotec.github.io/analysetermin-fotodoku/'

export const OHNE_SCHLUESSEL =
  'Die Bildbearbeitung ist auf dem Server nicht eingerichtet (GEMINI_SCHLUESSEL fehlt). Bitte bei Yann melden.'

/**
 * @param {'bild' | 'bestand'} art
 * @param {string} rumpf  der JSON-Rumpf aus dem Browser, unveraendert
 * @param {string | undefined} schluessel
 * @returns {Promise<{ status: number, text: string }>}
 */
export async function geminiWeiterleiten(art, rumpf, schluessel) {
  const modell = GEMINI_MODELLE[art]
  if (!modell) return { status: 404, text: JSON.stringify({ error: { message: 'Unbekannte Art.' } }) }
  if (!schluessel) return { status: 503, text: JSON.stringify({ error: { message: OHNE_SCHLUESSEL } }) }
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${modell}:generateContent`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': schluessel,
        Referer: REFERER,
      },
      body: rumpf,
    },
  )
  return { status: r.status, text: await r.text() }
}
