// Mitarbeiterliste wird zur Build-Zeit von Vite aus src/assets/vertriebler/ erzeugt.
// Dateiname "Vorname Nachname.jpg/.png" -> Anzeigename; Vite vergibt beim Build
// gehashte ASCII-Dateinamen (wichtig: GitHub Pages scheitert an Umlaut-Dateinamen).
const photoModules = import.meta.glob('../assets/vertriebler/*.{jpg,jpeg,png,JPG,JPEG,PNG}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>

export interface Salesperson {
  /** Anzeigename, z. B. "Mike Alsdorf" */
  name: string
  /** Gebundelte Foto-URL (gehashter Dateiname) */
  url: string
}

export const SALESPEOPLE: Salesperson[] = Object.entries(photoModules)
  .map(([path, url]) => ({
    name: (path.split('/').pop() ?? '').replace(/\.(jpe?g|png)$/i, ''),
    url,
  }))
  .sort((a, b) => a.name.localeCompare(b.name, 'de'))
