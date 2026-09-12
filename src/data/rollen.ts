/**
 * Kurzform und Rolle eines Mitarbeiters fuer den Vermerk unter der
 * Zusammenfassung und der fachlichen Beurteilung (Yann, 10.09.2026):
 * "Die Zusammenfassung wurde erstellt von H. Manaz (Bausachverständiger)
 * am 10.09.2026."
 *
 * Die Rolle steht hier und nicht im Mitarbeiterdatensatz, weil sie nur an
 * dieser Stelle gebraucht wird. Wer nicht in AUSNAHMEN steht, gilt als
 * Bausachverstaendiger - das ist die Rolle, in der die Analysetermine
 * stattfinden. Eine abweichende Rolle einfach hier eintragen.
 */

const STANDARD_ROLLE = 'Bausachverständiger'

const AUSNAHMEN: Record<string, string> = {
  // Yann, 12.09.2026
  'Yann Feyen': 'Stellv. Geschäftsführer & Prokurist',
}

/** "Hüseyin Manaz" wird zu "H. Manaz"; ein einzelnes Wort bleibt, wie es ist. */
export function kurzName(name: string): string {
  const teile = name.trim().split(/\s+/).filter(Boolean)
  if (teile.length < 2) return name.trim()
  const nachname = teile[teile.length - 1]
  const vorname = teile[0]
  // Namenszusaetze wie "van" oder "von" gehoeren zum Nachnamen
  const zusatz = teile.slice(1, -1).filter((t) => /^(van|von|de|del|di|der|zu|zur)$/i.test(t))
  return `${vorname.charAt(0).toUpperCase()}. ${[...zusatz, nachname].join(' ')}`
}

/** Die Rolle, die hinter dem Namen in Klammern steht. */
export function rolleVon(name: string): string {
  return AUSNAHMEN[name.trim()] ?? STANDARD_ROLLE
}

/** "H. Manaz (Bausachverständiger)", oder leer, wenn kein Name gewaehlt ist. */
export function nameMitRolle(name: string): string {
  const sauber = name.trim()
  if (sauber === '') return ''
  return `${kurzName(sauber)} (${rolleVon(sauber)})`
}
