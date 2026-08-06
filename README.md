# Fotodokumentation Analysetermin

Statisches Web-Tool (Single-Page-App) der **Abdichtungstechnik Dipl.-Ing. Morscheck GmbH**,
das Fotos vom Analysetermin **komplett lokal im Browser** zu einer chronologisch sortierten,
komprimierten PDF verarbeitet. Objektfoto und Termin-Fotos lassen sich per Drag & Drop einfügen.

**Es werden keine Daten hochgeladen oder gespeichert** – kein Backend, keine APIs, kein Tracking,
keine Cookies, kein localStorage. Damit ist das Tool problemlos öffentlich auf GitHub Pages hostbar.

## Funktionen

- **Deckblatt** im Stil der ISOTEC-Einarbeitungsmappe: Teamfoto als Hero, rotes Band,
  ISOTEC-Logo, Vertriebler (Name + rundes Foto), Objektfoto und Termindatum –
  das Termindatum wird **automatisch aus den Aufnahmedaten der Fotos** übernommen
  (bei mehreren Tagen als Zeitraum) und steckt auch im PDF-Dateinamen
- **Vertriebler-Dropdown mit Freitext-Option**: „Anderer Name (selbst eingeben) …"
  erlaubt neue Namen ohne Foto (Initialen-Platzhalter)
- **Exakt 1 Foto pro Seite** ab Seite 2
- **Chronologische Sortierung**: EXIF `DateTimeOriginal` → sonst Dateidatum (`lastModified`) →
  Tie-Breaker Dateiname. Fehlendes EXIF-Datum wird in der UI gekennzeichnet.
- **HEIC/HEIF-Unterstützung**: Konvertierung im Browser via `heic2any` (libheif/WASM),
  EXIF-Datum wird vor der Konvertierung aus der Originaldatei gelesen
- **EXIF-Orientation** wird automatisch korrekt angewendet
- **Duplikat-Erkennung** per SHA-256 über die Datei-Bytes (WebCrypto). Duplikate werden
  standardmäßig ausgeschlossen; optional „Duplikate behalten (kennzeichnen)“
- **Feste, qualitätsschonende Komprimierung** vor dem Einbetten (keine Auswahl nötig):
  Downscale auf max. 2200 px Kante (nie Hochskalierung) + JPEG-Qualität 0,75.
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
**„Vorname Nachname.jpg“** oder **„Vorname Nachname.png“** (Leerzeichen gehören zum Namen,
Groß-/Kleinschreibung beibehalten), z. B. `Mike Alsdorf.png`. Aktuell enthalten:
Mike Alsdorf, Sarah Najji, Boris Hohl, Alexander Swaghoven, Marvin Bethke.

**Neuen Vertriebler hinzufügen:**

1. Foto als `Vorname Nachname.jpg`/`.png` in `public/vertriebler/` ablegen (das Bild wird auf
   dem Deckblatt mittig rund zugeschnitten – quadratisch/Portrait wirkt am besten)
2. Committen und pushen – fertig.

Alternativ kann im Tool jederzeit „Anderer Name (selbst eingeben) …" gewählt werden –
dann erscheint statt des Fotos ein Initialen-Platzhalter.

Die Dropdown-Liste wird **nicht manuell gepflegt**: GitHub Pages bietet kein Directory-Listing,
daher scannt `scripts/generate-salespeople.mjs` bei jedem Dev-Start/Build den Ordner
`public/vertriebler/`, entfernt die Dateiendung und schreibt die alphabetisch sortierte Liste
nach `src/data/salespeople.generated.ts`. Zur Laufzeit bleibt alles statisch.

Wird ein Foto zur Laufzeit nicht gefunden (404), zeigt die App einen Initialen-Platzhalter
und einen Hinweis – kein Absturz.

Das Teamfoto (`src/assets/team.jpg`) und das ISOTEC-Logo (`src/assets/isotec-logo.png`)
für Deckblatt und App-Header werden mit der App gebündelt.

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
