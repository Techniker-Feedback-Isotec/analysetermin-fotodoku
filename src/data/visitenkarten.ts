// Visitenkarten der Mitarbeiter, wie sie auf dem Deckblatt erscheinen.
// Dateiname "Vorname Nachname.jpg" -> derselbe Anzeigename wie in der
// Mitarbeiterliste. Vite vergibt beim Bauen gehashte ASCII-Dateinamen
// (GitHub Pages scheitert an Umlauten im Dateinamen).
//
// Es gibt bewusst nicht fuer jeden eine Karte: Wer keine hat, bekommt auf dem
// Deckblatt weder Karte noch Foto (Vorgabe Yann, 08.09.2026).
const kartenModule = import.meta.glob('../assets/visitenkarten/*.{jpg,jpeg,png,JPG,JPEG,PNG}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>

const KARTEN = new Map<string, string>(
  Object.entries(kartenModule).map(([pfad, url]) => [
    (pfad.split('/').pop() ?? '').replace(/\.(jpe?g|png)$/i, ''),
    url,
  ]),
)

/** Adresse der Visitenkarte dieses Mitarbeiters, oder null. */
export function visitenkarteVon(name: string): string | null {
  return KARTEN.get(name.trim()) ?? null
}
