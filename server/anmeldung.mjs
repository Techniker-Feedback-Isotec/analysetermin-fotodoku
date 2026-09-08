// Wer ist angemeldet? Easy Auth setzt fuer jeden angemeldeten Aufruf
// Kopfzeilen, die nur der Server sieht. Bewusst nicht ueber /.auth/me: dieser
// Pfad braucht den Tokenspeicher und liefert ohne ihn kein JSON, sondern eine
// HTML-Seite (gelernt beim Urlaubsplaner, uebernommen aus dem
// Vertriebsprozess-Server).

// Anspruch-Namen, unter denen Entra die E-Mail-Adresse liefert
const EMAIL_ANSPRUECHE = [
  'preferred_username',
  'email',
  'emails',
  'upn',
  'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/upn',
  'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress',
]
const NAME_ANSPRUECHE = ['name', 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name']

/**
 * Liest E-Mail und Anzeigename aus den Easy-Auth-Kopfzeilen.
 * @param {import('node:http').IncomingMessage} req
 * @returns {{ email: string | null, name: string | null }}
 */
export function angemeldet(req) {
  const roh = req.headers['x-ms-client-principal']
  let email = null
  let name = null
  if (roh) {
    try {
      const p = JSON.parse(Buffer.from(String(roh), 'base64').toString('utf8'))
      const anspruch = p.claims ?? []
      const wert = (namen) =>
        namen.map((n) => anspruch.find((c) => (c.typ ?? c.type) === n)?.val).find(Boolean) ?? null
      email = wert(EMAIL_ANSPRUECHE)
      name = wert(NAME_ANSPRUECHE)
    } catch {
      // beschaedigte Kopfzeile: unten auf den Namen zurueckfallen
    }
  }
  if (!email) {
    const n = req.headers['x-ms-client-principal-name']
    if (typeof n === 'string' && n.includes('@')) email = n
  }
  return { email: email?.toLowerCase() ?? null, name }
}
