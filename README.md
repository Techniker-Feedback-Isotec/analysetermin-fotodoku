# Dokumentation

Web-Tool (Single-Page-App mit kleinem Node-Server) der **Abdichtungstechnik Dipl.-Ing. Morscheck
GmbH** für die Unterlagen aus dem Außendienst. Fünf Seiten in einem Menüband, die Angaben zum
Kunden werden **einmal** eingetragen und gelten für alle Unterlagen:

- **Kunde:** Mitarbeiter (nach der Anmeldung vorgewählt), Kunde, Kundenadresse, Objektadresse (nur
  bei Abweichung), Baujahr, Auftragsnummer, Termindatum, Sanierungskonzept (Gewerke), Objektfoto.
  Das Feld Kunde ist zugleich die **Suche in MeisterTask**: Es durchsucht das Ersttermine-Board
  des Mitarbeiters (Spalten Phase 0, Auftragsbesprechungen und Angebote) und übernimmt Name, Anschriften
  und Baujahr aus der gewählten Aufgabe. Darunter die Sammlung aller erstellten Dokumente mit
  Vorschau und Download sowie der Knopf für die **Angebotsmappe**.
- **Fotodokumentation:** Terminart (Analysetermin oder Reklamation), Fotos, optionale
  Zusammenfassung bzw. Beurteilung als formatierter Text, PDF mit einem Foto pro Seite.
- **Videodokumentation:** Videos bekommen ein 5-Sekunden-Deckblatt vorangestellt, die Drehung
  wird korrigiert und die Datei nur verkleinert, wenn sie über 40 MB liegt (Grenze von Craftboxx).
- **Prinzipskizze:** eigene Bilderauswahl aus demselben Bilderstapel wie die Fotodokumentation;
  PDF mit Deckblatt, freier Seite „Bauzeichnungen" (mit Legende der gewählten Gewerke) und Bildern.
- **Sanierungsvorschau:** Kellerfotos werden per Google Gemini „weißsaniert" (Vorher/Nachher);
  ursprünglich das eigenständige Tool `keller-vorher-nachher`, seit 08.09.2026 hier eingebaut.

Live: https://isotec-dokumentation.azurewebsites.net (Anmeldung mit dem ISOTEC-Konto, seit
08.09.2026; Betrieb siehe [`docs/AZURE.md`](docs/AZURE.md)). Die alte GitHub-Pages-Adresse
leitet nur noch um. Der Repo-Name ist historisch, das Tool heißt nur noch „Dokumentation". Die
ausführliche Projektnotiz mit Entscheidungen und offenen Punkten liegt in Yanns Obsidian-Vault
unter `02 Projekte/Dokumentation Analysetermin.md`.

## Deckblatt

Alle PDFs (Fotodokumentation, Prinzipskizze, Sanierungsvorschau, Angebotsmappe) tragen dasselbe
Deckblatt aus `src/lib/deckblatt.ts`. Leitsatz: **weniger ist mehr.** Oben das Objektfoto über die
volle Breite, darunter rotes Band, Firmenzeile, die Art des Dokuments als große Überschrift und
die Angaben zum Kunden (Kunde, Kundenadresse, Objekt; Auftragsnummer bei Reklamationen; das
Termindatum nur auf der Fotodokumentation). Unten rechts liegt die **Visitenkarte** des
Mitarbeiters (`src/assets/visitenkarten/`); wer keine hat, bekommt dort das ISOTEC-Logo. Der
Mitarbeiter wird sonst nicht genannt. Lange Werte werden umbrochen, die Höhe des Objektfotos
ergibt sich aus dem Platz, der nach den Angaben übrig bleibt.

Das Video-Deckblatt (`src/lib/cover.ts`) ist ein Canvas-Bild und zeigt weiter das runde
Mitarbeiterfoto: Eine Visitenkarte wäre im Videobild nicht lesbar.

## Angebotsmappe

Auf der Seite Kunde baut `src/lib/mappe.ts` aus den erstellten PDFs ein Dokument zum Ausdrucken:
Deckblatt, Inhaltsverzeichnis (Seitenzahl und Umfang je Abschnitt), danach Prinzipskizze,
Sanierungsvorschau und Fotodokumentation in dieser Reihenfolge, jede mit ihren eigenen Seiten
übernommen (pdf-lib `copyPages`).

## Stack

Vite + React 18 + TypeScript · [pdf-lib](https://pdf-lib.js.org/) · [exifr](https://github.com/MikeKovarik/exifr) ·
[heic-to](https://github.com/hoppergee/heic-to) (zuerst, kann die HDR-HEICs neuerer iPhones) und
[heic2any](https://github.com/alexcorvi/heic2any) (Rückfall) · [mediabunny](https://mediabunny.dev/)
(WebCodecs, Videoumwandlung) · Google Gemini (nur Sanierungsvorschau) · WebCrypto (SHA-256 für
Duplikate).

Video- und Vorschauseite sowie pdf-lib werden erst geladen, wenn sie gebraucht werden
(`React.lazy`, dynamischer Import). Das Startpaket liegt bei rund 260 KB.

## Entwicklung

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # tsc --noEmit && vite build -> dist/
npm run preview  # dist/ lokal testen
```

Der Dev-Server bedient `/api/*` selbst (`vite.config.ts`, gemeinsame Module unter `server/`) und
liest die Geheimnisse aus `.env.local` (nicht eingecheckt): `MT_TOKEN` und `MT_TOKEN_FELDER` für
die Kundensuche, `GEMINI_SCHLUESSEL` für die Sanierungsvorschau. Ohne Gemini-Schlüssel zeigt die
Vorschau „nicht eingerichtet"; `http://localhost:5173/#demo` lädt gemalte Beispielbilder. Als
angemeldet gilt lokal immer Yann (`/api/ich`).

## Mitarbeiter pflegen

Die Auswahlliste entsteht zur Build-Zeit aus **`src/assets/vertriebler/`** (`import.meta.glob`
in `src/data/salespeople.ts`). Dateiname ist exakt **„Vorname Nachname.jpg"** oder **„.png"**.
Die Fotos dienen nur noch als kleines Rundbild in der App und auf dem Video-Deckblatt; 400 Pixel
Kantenlänge reichen (rund 20 KB), größere Dateien bremsen den Seitenaufbau am Handy.

Die **Visitenkarten** für das Deckblatt liegen in **`src/assets/visitenkarten/`**, ebenfalls als
„Vorname Nachname.jpg" (1000 Pixel breit, rund 80 KB). Nur wer dort eine Karte hat, erscheint auf
dem Deckblatt; alle anderen bekommen das Logo. Aktuell: Björn Morscheck, Gerd Kahlau,
Hüseyin Manaz, Mike Alsdorf.

Vite vergibt beim Bauen gehashte ASCII-Dateinamen, weil der GitHub-Pages-Build an Umlauten im
Dateinamen scheitert; die Anzeigenamen behalten ihre Umlaute. Liegt ein Name in zwei Formaten
vor, zählt nur das erste.

## Server und Deployment (Azure)

`server/index.mjs` liefert `dist/` aus (gzip, ETag) und bedient vier Dinge, die der Browser nicht
selbst kann: `/api/ich` (wer ist angemeldet, aus den Easy-Auth-Kopfzeilen), `/api/kunden` und
`/api/kunden/<id>` (Kundensuche in MeisterTask, `server/meistertask.mjs`) und `/api/gemini/*`
(Weiterleitung an Google, `server/gemini.mjs`). Die Token und der Google-Schlüssel liegen als
Anwendungseinstellungen auf dem Server und verlassen ihn nie; der Browser kennt keinen Schlüssel
mehr. Bauen und Ausliefern immer in PowerShell, Befehle in [`docs/AZURE.md`](docs/AZURE.md).

Der GitHub-Workflow [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) baut nichts
mehr, sondern legt auf `gh-pages` nur noch eine Umleitung nach Azure ab.

## Datenschutz

- Fotos, Videos und PDFs bleiben im Browser: kein Upload, kein Tracking, kein localStorage.
- Die Anmeldung läuft über das ISOTEC-Konto (Microsoft Entra, Sitzungscookie von Easy Auth,
  acht Stunden). Kundendaten werden aus MeisterTask **gelesen**, nichts wird dorthin geschrieben.
- **Ausnahme Sanierungsvorschau:** Dort gehen die Kellerfotos zur Bearbeitung an Google Gemini.
  Der Hinweis im Menüband wechselt auf dieser Seite entsprechend, die fertige PDF trägt einen
  Hinweiskasten, dass es sich um KI-Visualisierungen handelt.
