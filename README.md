# Dokumentation

Statisches Web-Tool (Single-Page-App) der **Abdichtungstechnik Dipl.-Ing. Morscheck GmbH** für die
Unterlagen aus dem Außendienst. Fünf Seiten in einem Menüband, die Angaben zum Kunden werden
**einmal** eingetragen und gelten für alle Unterlagen:

- **Kunde:** Mitarbeiter, Kunde, Kundenadresse, Objektadresse (nur bei Abweichung), Auftragsnummer,
  Termindatum, Sanierungskonzept (Gewerke), Objektfoto. Darunter die Sammlung aller erstellten
  Dokumente mit Vorschau und Download sowie der Knopf für die **Angebotsmappe**.
- **Fotodokumentation:** Terminart (Analysetermin oder Reklamation), Fotos, optionale
  Zusammenfassung bzw. Beurteilung als formatierter Text, PDF mit einem Foto pro Seite.
- **Videodokumentation:** Videos bekommen ein 5-Sekunden-Deckblatt vorangestellt, die Drehung
  wird korrigiert und die Datei nur verkleinert, wenn sie über 40 MB liegt (Grenze von Craftboxx).
- **Prinzipskizze:** eigene Bilderauswahl aus demselben Bilderstapel wie die Fotodokumentation;
  PDF mit Deckblatt, freier Seite „Bauzeichnungen" (mit Legende der gewählten Gewerke) und Bildern.
- **Sanierungsvorschau:** Kellerfotos werden per Google Gemini „weißsaniert" (Vorher/Nachher);
  ursprünglich das eigenständige Tool `keller-vorher-nachher`, seit 08.09.2026 hier eingebaut.

Live: https://techniker-feedback-isotec.github.io/analysetermin-fotodoku/ (Adresse und Repo-Name
sind historisch, das Tool heißt nur noch „Dokumentation"). Die ausführliche Projektnotiz mit
Entscheidungen und offenen Punkten liegt in Yanns Obsidian-Vault unter
`02 Projekte/Dokumentation Analysetermin.md`.

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

Die Sanierungsvorschau braucht einen Gemini-Schlüssel, der nur beim Bauen in GitHub Actions
eingesetzt wird (siehe unten). Lokal zeigt sie deshalb „Bildbearbeitung nicht verfügbar";
zum Ausprobieren gibt es `http://localhost:5173/#demo` mit gemalten Beispielbildern.

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

## Deployment auf GitHub Pages

Push auf `main` startet [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml): bauen und
`dist/` in den Branch `gh-pages` schieben (Settings → Pages → Source: „Deploy from a branch",
`gh-pages`). Nach etwa einer Minute ist der Stand live. Der Weg über `actions/deploy-pages` blieb
früher wiederholt in der Warteschlange hängen.

Der Workflow setzt `BASE_PATH=/<repo-name>/` für Vite und reicht das Actions-Geheimnis
`GEMINI_SCHLUESSEL` durch. `vite.config.ts` schreibt den Schlüssel **kodiert** (umgekehrt und
Base64) ins Programm: GitHub scannt den öffentlichen `gh-pages`-Branch nach Google-Schlüsseln und
meldet Treffer, Google sperrt sie dann sofort (passiert am 04.09.2026). Nie einen `AIza`-Schlüssel
im Klartext in einen öffentlichen Branch bauen. Der Schlüssel ist auf `techniker-feedback-isotec.github.io`
beschränkt und gilt deshalb nicht auf localhost.

## Datenschutz

- Fotodokumentation, Videodokumentation, Prinzipskizze und Angebotsmappe laufen vollständig im
  Browser: keine Uploads, kein Backend, kein Tracking, keine Cookies, kein localStorage.
- **Ausnahme Sanierungsvorschau:** Dort gehen die Kellerfotos zur Bearbeitung an Google Gemini.
  Der Hinweis im Menüband wechselt auf dieser Seite entsprechend, die fertige PDF trägt einen
  Hinweiskasten, dass es sich um KI-Visualisierungen handelt.
