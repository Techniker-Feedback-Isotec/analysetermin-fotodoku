/**
 * Adresse des pdf.js-Workers, von Vite als eigene Datei ausgeliefert.
 *
 * Eigenes Modul, damit `pdftext.ts` es erst im Browser nachlaedt: Der
 * `?url`-Import ist Vite-eigen, und die Node-Pruefskripte (siehe Vault-Notiz,
 * Abschnitt Testen) sollen das Textlesen ohne diesen Import buendeln koennen.
 */
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

export { workerUrl }
