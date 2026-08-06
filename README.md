# Fotodokumentation Analysetermin

Statisches Web-Tool (Single-Page-App), das Fotos vom Analysetermin **komplett lokal im Browser**
zu einer chronologisch sortierten, komprimierten PDF verarbeitet.

**Es werden keine Daten hochgeladen oder gespeichert** – kein Backend, keine APIs, kein Tracking,
keine Cookies, kein localStorage. Damit ist das Tool problemlos öffentlich auf GitHub Pages hostbar.

## Funktionen

- **Deckblatt** mit Vertriebler (Name + Foto aus dem Repo), prominentem Objektfoto,
  Erstelldatum und Anzahl der Fotos – im ISOTEC-Design (Rot `#D51317`, Braunschwarz `#564A44`)
- **Exakt 1 Foto pro Seite** ab Seite 2
- **Chronologische Sortierung**: EXIF `DateTimeOriginal` → sonst Dateidatum (`lastModified`) →
  Tie-Breaker Dateiname. Fehlendes EXIF-Datum wird in der UI gekennzeichnet.
- **HEIC/HEIF-Unterstützung**: Konvertierung im Browser via `heic2any` (libheif/WASM),
  EXIF-Datum wird vor der Konvertierung aus der Originaldatei gelesen
- **EXIF-Orientation** wird automatisch korrekt angewendet
- **Duplikat-Erkennung** per SHA-256 über die Datei-Bytes (WebCrypto). Duplikate werden
  standardmäßig ausgeschlossen; optional „Duplikate behalten (kennzeichnen)“
- **Qualitätsschonende Komprimierung** vor dem Einbetten: Downscale auf max. Kante
  (1800 / 2200 / 3000 px, nie Hochskalierung) + JPEG-Qualität (0,75 / 0,82 / 0,90).
  PNGs mit echter Transparenz bleiben PNG.
- Dateiname: `Analysetermin_<Vertriebler>_<JJJJ-MM-TT>.pdf`

## Stack

Vite + React + TypeScript · [pdf-lib](https://pdf-lib.js.org/) · [exifr](https://github.com/MikeKovarik/exifr) ·
[heic2any](https://github.com/alexcorvi/heic2any) · WebCrypto (SHA-256)

## Entwicklung

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # Produktions-Build nach dist/
npm run preview  # dist/ lokal testen
```

Vor `dev` und `build` läuft automatisch `scripts/generate-salespeople.mjs` (siehe unten).

## Vertriebler pflegen

Die Vertrieblerfotos liegen im Repo unter **`public/vertriebler/`**. Dateinamen sind exakt
**„Vorname Nachname.jpg“** (Leerzeichen gehören zum Namen, Groß-/Kleinschreibung beibehalten),
z. B. `Mike Alsdorf.jpg`.

**Neuen Vertriebler hinzufügen:**

1. Foto als `Vorname Nachname.jpg` in `public/vertriebler/` ablegen (quadratisch wirkt am besten;
   das Bild wird auf dem Deckblatt mittig quadratisch zugeschnitten)
2. Committen und pushen – fertig.

Die Dropdown-Liste wird **nicht manuell gepflegt**: GitHub Pages bietet kein Directory-Listing,
daher scannt `scripts/generate-salespeople.mjs` bei jedem Dev-Start/Build den Ordner
`public/vertriebler/`, entfernt die Dateiendung und schreibt die alphabetisch sortierte Liste
nach `src/data/salespeople.generated.ts`. Zur Laufzeit bleibt alles statisch.

Wird ein Foto zur Laufzeit nicht gefunden (404), zeigt die App einen Initialen-Platzhalter
und einen Hinweis – kein Absturz. Die drei mitgelieferten Bilder (`Max Mustermann.jpg`,
`Erika Musterfrau.jpg`, `Peter Beispiel.jpg`) sind Platzhalter und können ersetzt werden.

## Deployment auf GitHub Pages

Der Workflow [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) baut bei jedem Push
auf `main` und deployt über `actions/deploy-pages`:

1. Repo auf GitHub anlegen und pushen
2. Im Repo unter **Settings → Pages → Source** auf **„GitHub Actions“** stellen
3. Push auf `main` → die Seite erscheint unter `https://<user>.github.io/<repo-name>/`

### `base`-Konfiguration

Vite braucht auf GitHub Pages den korrekten Basispfad (`/<repo-name>/`). Der Workflow setzt dafür
automatisch die Umgebungsvariable `BASE_PATH=/<repo-name>/` – der Repo-Name muss also nirgends
hart gepflegt werden. Lokal (ohne `BASE_PATH`) gilt der Fallback in
[`vite.config.ts`](vite.config.ts). Für eine User-/Org-Page (`<user>.github.io` als Repo-Name)
`BASE_PATH=/` setzen.

## Datenschutz / Sicherheit

- Alle Verarbeitung (EXIF, HEIC-Konvertierung, Hashing, Komprimierung, PDF) passiert
  ausschließlich clientseitig im Browser
- Keine Uploads, kein Backend, keine externen Requests zur Laufzeit
  (auch die HEIC-WASM-Bibliothek wird mit der App ausgeliefert)
- Kein Tracking, keine Analytics, keine Cookies, kein localStorage
