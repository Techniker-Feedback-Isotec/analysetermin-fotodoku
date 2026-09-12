# Azure-Betrieb des Werkzeugs „Dokumentation"

Eingerichtet am 08.09.2026 nach dem Muster von Vertriebsprozess und
Arbeitskleidung. Alles in Germany West Central, Abonnement
`cea028ba-471f-4500-aa7c-78956ff1e5c2`, Mandant `33800607-da7c-4252-b05a-f16843df568f`.

Bis dahin lief das Werkzeug ohne Server auf GitHub Pages. Der Umzug kam mit
der Kundensuche in MeisterTask: Die Token dafuer gehoeren auf einen Server,
und die Anmeldung sagt, wessen Ersttermine-Board durchsucht wird.

## Was wo liegt

| Was | Wert |
| --- | --- |
| Adresse | https://isotec-dokumentation.azurewebsites.net |
| Ressourcengruppe | `rg-dokumentation-prod` |
| Web-App | `isotec-dokumentation`, Linux, Node 24, Startbefehl `node server/index.mjs` |
| App-Service-Plan | `rp-prod-plan` in `rg-rechnungspruefung-prod2` (mitbenutzt, keine eigenen Plankosten) |
| App-Registrierung | `ISOTEC Dokumentation`, Client-ID `4545bab2-88f9-4b26-953e-80efdf2a1c3c`, Objekt-ID `beff1c72-0a61-46b6-8206-73b16a96e20e` |
| Dienstprinzipal | `3873c0ef-96de-4975-957a-900f7e659a10` |
| Anmelde-Identitaet | `id-dokumentation-auth`, Client-ID `6a9a08c3-ca5a-45db-a0ee-121399cc47ad`, Objekt-ID `e1ae4e20-9aff-4d5f-843a-6eb4f0e6b3b2`, Vertrauensbeziehung `mi-easyauth` |
| Von der Anmeldung ausgenommen | `/gesund` sowie Icons und Manifest (`/favicon-32.png`, `/icon-192.png`, `/icon-512.png`, `/apple-touch-icon.png`, `/manifest.webmanifest`) fuers Pinnen auf den Startbildschirm |

Kein Client Secret, kein Speicherkonto: Die Anmeldung laeuft ueber die
Vertrauensbeziehung zur verwalteten Identitaet (laeuft nie ab), und das
Werkzeug speichert nichts – Fotos, Videos und PDFs bleiben im Browser.

## Anwendungseinstellungen

| Name | Bedeutung |
| --- | --- |
| `MT_TOKEN` | MeisterTask-Token des ISOTEC Bots (Mitglied aller Boards), fuer die Kundensuche. Uebernommen aus der Vertriebsprozess-App |
| `MT_TOKEN_FELDER` | Token eines Kontos mit Business-Sitzplatz: die benutzerdefinierten Felder (Name, Anschriften, Baujahr) haengen am Abo des abrufenden Kontos, das Bot-Token bekommt dort 403. Ebenfalls uebernommen |
| `GEMINI_SCHLUESSEL` | Google-Schluessel fuer die Sanierungsvorschau. Ohne ihn meldet die Vorschau „nicht eingerichtet", alles andere laeuft |
| `OVERRIDE_USE_MI_FIC_ASSERTION_CLIENTID` | Client-ID der Anmelde-Identitaet, slot-sticky |
| `WEBSITE_NODE_DEFAULT_VERSION` | `~24` |
| `SCM_DO_BUILD_DURING_DEPLOYMENT` | `false`, es wird fertig gebaut hochgeladen |

`/gesund` sagt ohne Anmeldung, welche der drei Geheimnisse gesetzt sind.

Der Gemini-Schluessel ist in Google auf die Adresse der alten GitHub-Pages-
Seite beschraenkt (HTTP-Referrer) — die Seite selbst gibt es seit dem 09.09.2026
nicht mehr, Google prueft aber nur den Kopfzeilenwert (nachgewiesen). Der Server schickt deshalb diese Adresse
als `Referer` mit (`server/gemini.mjs`); die Beschraenkung bleibt damit als
Schutz gegen einen kopierten Schluessel bestehen. Wird der Schluessel in
Google einmal neu angelegt, entweder wieder diese Adresse zulassen oder die
Konstante im Server anpassen.

## Anmeldung

Easy Auth (`authsettingsV2`), Anbieter Microsoft, Anmeldung erzwungen
(`RedirectToLoginPage`), Sitzung 8 Stunden, `preserveUrlFragmentsForLogins`
eingeschaltet (damit `#demo` die Anmeldung ueberlebt). **Keine
Zuweisungspflicht** (Yann, 08.09.2026): jede Person mit ISOTEC-Konto kommt
herein. Wer in der Mitarbeiterliste (`src/assets/vertriebler/`) steht, ist
nach der Anmeldung als Mitarbeiter vorgewaehlt; der Abgleich laeuft ueber den
Anzeigenamen aus Entra, ersatzweise ueber den Nachnamen vor dem @.

Falls es doch eingeschraenkt werden soll (PowerShell):

```powershell
az ad sp update --id 4545bab2-88f9-4b26-953e-80efdf2a1c3c --set appRoleAssignmentRequired=true
```

Der Server liest die Anmeldung aus den Kopfzeilen `X-MS-CLIENT-PRINCIPAL` und
`X-MS-CLIENT-PRINCIPAL-NAME` (`server/anmeldung.mjs`) und bietet sie unter
`/api/ich` an. Eine abgelaufene Sitzung liefert `fetch` HTML statt JSON; die
Anwendung erkennt das (`src/lib/api.ts`) und schickt einmal je Browsersitzung
zur Anmeldung.

## Die Kundensuche (server/meistertask.mjs)

`GET /api/kunden?mitarbeiter=Yann Feyen` sucht das Board `YF_Ersttermine`
(Kuerzel = erste Buchstaben von Vor- und Nachname) und liefert dessen offene
Aufgaben aus den Spalten **Phase 0**, **Auftragsbesprechungen** und **Angebote**
– sonst keine (Yann, 08.09.2026). Je Aufgabe steht „Name, Ort", gekuerzt aus dem Titel.
`GET /api/kunden/<id>?projekt=<board>` liefert die Felder einer Aufgabe:
Name (KUNDE), Anschrift (KUNDE), Anschrift (OBJEKT), Baujahr, Objektart.

Kontingent: 100 Abrufe je Minute je Token, geteilt von allen Nutzern und mit
der Vertriebsprozess-App (dasselbe Bot-Token). Deshalb haelt der Server
Projekte, Spalten und Feldtypen zehn Minuten und die Aufgabenliste eines
Boards 45 Sekunden im Speicher; das Tippen im Suchfeld filtert im Browser
und kostet keinen Abruf.

## Zweige (seit 11.09.2026)

`main` ist der Live-Stand und wird nur auf Yanns Wort ausgeliefert. Entwickelt
wird auf `entwicklung`; dort liegt alles, was die Kollegen noch nicht haben.
Ausliefern heisst: `git checkout main`, `git merge entwicklung`, dann die
Schritte unten. Der zuletzt ausgelieferte Stand traegt ein Tag `live-<Datum>`.

## Ausliefern (immer PowerShell, nie Git Bash)

```powershell
cd C:\Users\YannFeyen\Desktop\analysetermin-fotodoku
npm run build
Compress-Archive -Path 'dist','server','package.json' -DestinationPath "$env:TEMP\dokumentation-paket.zip" -Force
az webapp deploy --name isotec-dokumentation --resource-group rg-dokumentation-prod --src-path "$env:TEMP\dokumentation-paket.zip" --type zip
```

**Niemals mit `--clean true` ausliefern.** Die Programmteile fuer Video, PDF und
Sanierungsvorschau werden erst geladen, wenn jemand sie braucht, und tragen
einen Hash im Dateinamen. Wer die Seite offen hat, waehrend ausgeliefert wird,
laedt beim naechsten Klick genau die Datei nach, die `--clean` geloescht hat:
"Failed to fetch dynamically imported module" mitten in der Arbeit, und die
bereits geladenen Fotos sind beim Neuladen weg (passiert am 10.09.2026 bei
Yann). Die alten Dateien bleiben deshalb liegen; sie kosten fast nichts.

Zum Aufraeumen: nur ausserhalb der Arbeitszeit einmal mit `--clean true`
ausliefern, dann ist `dist/assets` wieder frisch.

Der Server nutzt nur Node-Bordmittel, es werden keine Pakete nachgeladen.
Pruefen ohne Anmeldung: `https://isotec-dokumentation.azurewebsites.net/gesund`.
Ein 401 auf andere Pfade per `curl` ist normal, Easy Auth leitet nur Browser um.

Das Repo liegt weiter auf GitHub (`Techniker-Feedback-Isotec/analysetermin-fotodoku`).
Ein Push auf `main` liefert nichts aus, Azure wird von Hand bespielt (oben). Seit dem
12.09.2026 baut der Zweig `entwicklung` bei jedem Push eine **Testumgebung ohne Server**
auf GitHub Pages (Quelle "GitHub Actions", `.github/workflows/testumgebung.yml`):
https://techniker-feedback-isotec.github.io/analysetermin-fotodoku/ - fuer den Blick auf
dem iPad, bevor etwas auf Azure geht. Dort fehlen Anmeldung, Kundensuche, MeisterTask-
Ablage und Sanierungsvorschau (`VITE_OHNE_SERVER=1`, siehe src/lib/api.ts).

## Testumgebung auf Azure: isotec-dokumentation-test (seit 12.09.2026 abends)

Zweite Web-App in derselben Ressourcengruppe, gleicher Plan `rp-prod-plan`,
gleiche Anmelde-Identitaet `id-dokumentation-auth` und dieselbe
App-Registrierung (zweite Redirect-URI
`https://isotec-dokumentation-test.azurewebsites.net/.auth/login/aad/callback`).
Anwendungseinstellungen sind eine Kopie der Live-App. Hier laeuft der Zweig
`entwicklung`, damit sich Neues mit Anmeldung, MeisterTask und OneDrive
pruefen laesst, bevor es auf `main` und die Live-App geht.

Adresse: https://isotec-dokumentation-test.azurewebsites.net

Ausliefern wie oben, nur mit dem anderen Namen:

```powershell
cd C:\Users\YannFeyen\Desktop\analysetermin-fotodoku
git checkout entwicklung
npm run build
Compress-Archive -Path 'dist','server','package.json' -DestinationPath "$env:TEMP\dokumentation-test-paket.zip" -Force
az webapp deploy --name isotec-dokumentation-test --resource-group rg-dokumentation-prod --src-path "$env:TEMP\dokumentation-test-paket.zip" --type zip
```

**Unterschied zur Live-App: OneDrive.** Easy Auth hat hier den Token-Speicher
an (`login.tokenStore.enabled`) und fordert beim Anmelden die Graph-Scopes
`openid profile email offline_access Files.Read` an (`loginParameters`). Der
Server bekommt damit je Aufruf das Graph-Token des Nutzers in der Kopfzeile
`X-MS-TOKEN-AAD-ACCESS-TOKEN` und liest dessen OneDrive (`server/graph.mjs`,
Sonderordner `cameraroll` = "Eigene Aufnahmen"); `/.auth/refresh` holt ein
frisches Token, wenn es abgelaufen ist (der Server antwortet dann mit 409).
Die App-Registrierung hat dafuer die delegierten Berechtigungen `Files.Read`
und `User.Read` mit mandantenweiter Einwilligung (`az ad app permission
admin-consent`, erteilt am 12.09.2026). Die Live-App fordert den Scope nicht
an und hat keinen Token-Speicher: dort meldet `/api/ich` `onedrive: false`,
und die App zeigt den Eingang nicht. Soll OneDrive live gehen, dieselben
zwei Einstellungen an `isotec-dokumentation` setzen (Befehle: `az webapp auth
show` der Test-App als Vorlage, `az webapp auth set --body`).

Geokodierung der Objektadresse (`server/geocode.mjs`) laeuft ueber Nominatim
(OpenStreetMap) ohne Schluessel, hoechstens eine Anfrage je Sekunde, mit
Absenderkennung; Ergebnisse haengen am Vorgang (`kunde.standort`).

## Lokal entwickeln

`npm run dev` (Vite auf Port 5173). Der Dev-Server bedient `/api/*` selbst
(`vite.config.ts`) mit den Geheimnissen aus `.env.local` (nicht eingecheckt):
`MT_TOKEN`, `MT_TOKEN_FELDER`, `GEMINI_SCHLUESSEL`. Ohne Anmeldung gilt Yann
als angemeldet (`/api/ich` antwortet fest). OneDrive lokal: `GRAPH_TOKEN` (ein
Token aus dem Graph Explorer, gilt eine Stunde) spricht mit dem echten
OneDrive; `ONEDRIVE_DEMO=<Ordner>` spielt stattdessen die Bilder und Videos
dieses Ordners als Aufnahmen am Objekt ein, ohne Microsoft zu fragen. Fehlt `GEMINI_SCHLUESSEL`, zeigt
die Sanierungsvorschau den Hinweis „nicht eingerichtet"; `#demo` laedt
Beispielbilder ohne Google.
