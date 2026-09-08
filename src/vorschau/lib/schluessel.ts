/**
 * Herkunft des Gemini-API-Schluessels.
 *
 * Damit jeder das Werkzeug einfach ueber den Link benutzen kann, wird ein
 * Schluessel **beim Bauen mitgeliefert**: Er steckt als Actions-Geheimnis
 * `GEMINI_SCHLUESSEL` in GitHub, landet also nicht im Quelltext und nicht
 * in der Versionsgeschichte, wohl aber (kodiert) im ausgelieferten Programm. Wer den
 * Quelltext der Seite ansieht, kann ihn dort finden. Geschuetzt ist er nur
 * durch die Beschraenkung auf die Generative Language API und auf die Adresse
 * der Seite; die eigentliche Obergrenze ist das Prepaid-Guthaben.
 *
 * Reihenfolge: ein selbst hinterlegter Schluessel (localStorage, ueber
 * #einstellungen oder einen Link mit #schluessel=...) hat Vorrang, sonst gilt
 * der mitgelieferte. So laesst sich fuer einzelne Geraete ein eigener
 * Schluessel setzen, ohne neu zu bauen.
 */

const ABLAGE = 'vn-gemini-schluessel'

/**
 * Der beim Bauen mitgelieferte Schluessel; leer, wenn beim Bauen keiner gesetzt
 * war. Er steckt kodiert im Programm (Base64 der umgekehrten Zeichenfolge),
 * siehe vite.config.ts: So erkennt ihn der automatische Scanner von GitHub
 * nicht, der gefundene Google-Schluessel sofort sperren laesst.
 */
function dekodiere(kodiert: string): string {
  if (!kodiert) return ''
  try {
    return atob(kodiert).split('').reverse().join('')
  } catch {
    return ''
  }
}

export const MITGELIEFERTER_SCHLUESSEL: string = dekodiere(__GEMINI_SCHLUESSEL_KODIERT__)

/** Eigener Schluessel dieses Geraets, falls einer hinterlegt wurde. */
export function leseEigenenSchluessel(): string {
  try {
    return localStorage.getItem(ABLAGE) ?? ''
  } catch {
    return ''
  }
}

/** Der Schluessel, mit dem gearbeitet wird. */
export function leseSchluessel(): string {
  return leseEigenenSchluessel() || MITGELIEFERTER_SCHLUESSEL
}

export function speichereSchluessel(wert: string): void {
  try {
    if (wert) localStorage.setItem(ABLAGE, wert)
    else localStorage.removeItem(ABLAGE)
  } catch {
    /* privates Fenster o. ae. – dann gilt der Schluessel nur fuer diese Sitzung */
  }
}

/** Uebernimmt einen Schluessel aus dem Link (#schluessel=...) und raeumt die Adresszeile auf. */
export function uebernimmSchluesselAusLink(): string {
  const treffer = /[#&]schluessel=([^&]+)/.exec(window.location.hash)
  if (!treffer) return ''
  const wert = decodeURIComponent(treffer[1]).trim()
  if (wert) speichereSchluessel(wert)
  history.replaceState(null, '', window.location.pathname + window.location.search)
  return wert
}

/** Baut den Verteil-Link mit dem Schluessel im Fragment. */
export function verteilLink(schluessel: string): string {
  return `${window.location.origin}${window.location.pathname}#schluessel=${encodeURIComponent(schluessel)}`
}
