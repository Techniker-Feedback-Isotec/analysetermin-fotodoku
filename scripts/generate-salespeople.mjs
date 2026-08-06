// Erzeugt src/data/salespeople.generated.ts aus den Dateien in public/vertriebler/.
// Laeuft automatisch vor "npm run dev" und "npm run build" (predev/prebuild).
// GitHub Pages bietet kein Directory-Listing, daher wird die Liste zur Build-Zeit erzeugt.
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const photoDir = path.join(scriptDir, '..', 'public', 'vertriebler')
const outDir = path.join(scriptDir, '..', 'src', 'data')
const outFile = path.join(outDir, 'salespeople.generated.ts')

const entries = existsSync(photoDir)
  ? readdirSync(photoDir)
      .filter((f) => /\.jpe?g$/i.test(f))
      .map((f) => ({ name: f.replace(/\.jpe?g$/i, ''), file: f }))
      .sort((a, b) => a.name.localeCompare(b.name, 'de'))
  : []

mkdirSync(outDir, { recursive: true })

const banner =
  '// AUTOMATISCH GENERIERT von scripts/generate-salespeople.mjs - nicht von Hand bearbeiten.\n' +
  '// Quelle: public/vertriebler/*.jpg ("Vorname Nachname.jpg")\n\n'

const body =
  'export interface Salesperson {\n' +
  '  /** Anzeigename, z. B. "Mike Alsdorf" */\n' +
  '  name: string\n' +
  '  /** Dateiname in public/vertriebler/, z. B. "Mike Alsdorf.jpg" */\n' +
  '  file: string\n' +
  '}\n\n' +
  `export const SALESPEOPLE: Salesperson[] = ${JSON.stringify(entries, null, 2)}\n`

writeFileSync(outFile, banner + body)
console.log(`salespeople.generated.ts geschrieben: ${entries.length} Vertriebler`)
