# Dokumentation Analysetermin

Statisches Web-Tool (Single-Page-App) der **Abdichtungstechnik Dipl.-Ing. Morscheck GmbH** für die
Unterlagen vom Analysetermin – **ein Tool für Fotos und Videos**, umschaltbar über zwei Reiter:

- **Fotodokumentation:** Fotos werden komplett lokal im Browser zu einer chronologisch sortierten,
  komprimierten PDF verarbeitet.
- **Videodokumentation:** Videos bekommen ein Deckblatt vorangestellt, die Drehung wird korrigiert
  und die Datei nur dann verkleinert, wenn sie über der Größengrenze liegt.

**Die Angaben zum Termin werden nur einmal eingetragen** (Terminart, Mitarbeiter, Kunde,
Objektadresse, Termindatum, Auftragsnummer) und gelten für beide Reiter.

**Es werden keine Daten hochgeladen oder gespeichert** – kein Backend, keine APIs, kein Tracking,
keine Cookies, kein localStorage. Damit ist das Tool problemlos öffentlich auf GitHub Pages hostbar.

**Kurzanleitung für die Nutzer:** [docs/Kurzanleitung_Fotodokumentation.pdf](docs/Kurzanleitung_Fotodokumentation.pdf)
(5 Seiten, erklärt die drei Terminarten und den Aufbau der fertigen Mappen; Quelle:
`docs/anleitung-quelle.html`, wird mit Edge/Chrome per „Als PDF drucken" erzeugt).
Die Anleitung beschreibt noch nicht den Video-Reiter.

## Videodokumentation

Jedes Video beginnt mit einem **2,5 Sekunden langen Deckblatt** mit den Elementen des
PDF-Deckblatts (Teamfoto, rotes Band, Terminart, Mitarbeiter mit rundem Foto, Logo) – nur ohne
Objektfoto und randlos statt auf Weiß. Der Grund ist die Kachel in MeisterTask, Craftboxx und im
Explorer: Sie zeigt das erste Bild des Videos, und ohne Deckblatt ist das ein zufälliger
Kellerausschnitt.

**Verkleinert wird nur, was zu groß ist.** Es gibt keine Qualitätsstufen, sondern eine maximale
Dateigröße:

| Auswahl         | Grenze | Warum                                                               |
| --------------- | ------ | ------------------------------------------------------------------- |
| Bis 39 MB       | 39 MB  | **Craftboxx** lässt nur 40 MB zu – die engste Stelle im Ablauf       |
| Bis 190 MB      | 190 MB | MeisterTask erlaubt 200 MB je Datei (Pro/Business; Basic nur 20 MB) |
| Ohne Begrenzung | –      | wenn das Video nur in SharePoint landet                             |

Passt ein Video ohnehin darunter, bleiben Auflösung (höchstens Full HD) und Bitrate erhalten,
gedeckelt auf 10 Mbit/s. Ist es zu groß, wird die Bitrate aus Laufzeit und Grenze berechnet und
die Auflösung fällt auf die Stufe, die dazu noch gut aussieht (1080p ab 2,5 Mbit/s, 720p ab 1,2,
480p ab 0,6, darunter 360p). Der Ton bleibt immer erhalten, die Drehung wird fest ins Bild
gerechnet – quer gefilmt bleibt quer.

Dateiname: `ISOTEC_Videodokumentation[_<Titel>]_<JJJJ-MM-TT>.mp4`, je Video überschreibbar.

Gemessen an echtem Material: 372 MB / 3:20 Min. → 36,3 MB in 35 Sekunden; 146 MB / 1:18 Min. →
35,4 MB in 18 Sekunden (bleibt in Full HD, weil das Budget es hergibt); 16,5 MB / 9 Sek. →
12,4 MB bei voller Auflösung.

Technisch: **WebCodecs** über [mediabunny](https://mediabunny.dev). Fehlt WebCodecs (Safari vor
iOS 17), sagt das Tool das und die Videos lassen sich unverändert speichern.

## Funktionen der Fotodokumentation

- **Terminart wählbar** (Analysetermin / Reklamation) – sie wird zur
  Überschrift des Deckblatts und steht im PDF-Dateinamen
- **Deckblatt** im Stil der ISOTEC-Einarbeitungsmappe: Teamfoto als Hero, rotes Band,
  ISOTEC-Logo, Mitarbeiter (Name + rundes Foto), Objektfoto und Termindatum –
  das Termindatum ist **automatisch das neueste Aufnahmedatum der Fotos** und steckt
  auch im PDF-Dateinamen; jede Fotoseite trägt zusätzlich ein kleines ISOTEC-Logo
- **Optionale Felder „Kunde", „Objektadresse" und „Termindatum"** – erscheinen nur auf dem
  Deckblatt, wenn sie ausgefüllt sind; ein eingetragenes Termindatum überschreibt die
  automatische Erkennung aus den Fotos (auch im Dateinamen)
- **Optionale Textseite nach dem Deckblatt**: bei Reklamation „Beurteilung" (Fachliche
  Beurteilung + Auftragsnummer auf dem Deckblatt), bei Analysetermin „Zusammenfassung" –
  jeweils mit Vermerk, wer den Text wann verfasst hat; leer = keine Extra-Seite
- **Mitarbeiter-Dropdown mit Freitext-Option**: „Anderer Name (selbst eingeben) …"
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
- **„Extra Komprimierung"** (Checkbox): komprimiert stufenweise stärker
  (1600/0,60 → 1200/0,50 → 960/0,40 → 800/0,35), bis die PDF **unter 10 MB** liegt
- Dateiname: `ISOTEC_<Terminart>_Fotodokumentation_<Kunde>_<JJJJ-MM-TT>.pdf`
  (der Kunde entfällt, wenn das Feld leer ist; das Datum ist das Termindatum)

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


## Vertriebler pflegen

Die Mitarbeiterfotos liegen im Repo unter **`src/assets/vertriebler/`**. Dateinamen sind exakt
**„Vorname Nachname.jpg“** oder **„Vorname Nachname.png“** (Leerzeichen gehören zum Namen,
Groß-/Kleinschreibung beibehalten), z. B. `Mike Alsdorf.png`. Aktuell enthalten:
Mike Alsdorf, Sarah Najji, Boris Hohl, Alexander Swaghoven, Marvin Bethke, Hüseyin Manaz,
Björn Morscheck, Gerd Kahlau, Dzevit Veliji.

**Neuen Mitarbeiter hinzufügen:**

1. Foto als `Vorname Nachname.jpg`/`.png` in `src/assets/vertriebler/` ablegen (das Bild wird
   auf dem Deckblatt mittig rund zugeschnitten – quadratisch/Portrait wirkt am besten)
2. Committen und pushen – fertig.

Alternativ kann im Tool jederzeit „Anderer Name (selbst eingeben) …" gewählt werden –
dann erscheint statt des Fotos ein Initialen-Platzhalter.

Die Dropdown-Liste wird **nicht manuell gepflegt**: `src/data/salespeople.ts` liest den Ordner
zur Build-Zeit per `import.meta.glob` ein. Vite vergibt dabei gehashte ASCII-Dateinamen –
wichtig, weil der GitHub-Pages-Build an Umlaut-Dateinamen (z. B. „Björn …", „Hüseyin …")
scheitert; die Anzeigenamen behalten ihre Umlaute natürlich.

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
