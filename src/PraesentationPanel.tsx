import { useCallback, useEffect, useState } from 'react'
import Praesentation, { type Folie } from './Praesentation'
import Textfenster, { Textvorschau } from './Textfenster'
import type { Fotostapel } from './fotostapel'
import { nameMitRolle, rolleVon } from './data/rollen'
import { reichtextIstLeer, reichtextZuHtml, type Reichtext } from './lib/richtext'
import { formatDateShort } from './lib/format'
import { ladeSeitenDaten, type PraesentationZustand } from './lib/speicher'
import type { Ausschnitt } from './lib/pdfbilder'
import { gewerkBild, infosFuer } from './data/gewerkeInfo'
import { nachherVon, type VorschauSatz } from './vorschau/lib/saetze'
import { mitarbeiterVon, objektadresseEcht, type Kundendaten, type ToastFn } from './kunde'
import type { Seiten } from './vorgang'

/**
 * Seite "Praesentation" (12.09.2026, Yann): Aus Prinzipskizze,
 * Sanierungsvorschau und den Texten eine Praesentation fuer die
 * Auftragsbesprechung. Aufbau: Titel, ISOTEC wie in der Angebotsmappe,
 * Kapitelblatt, Ist-Situation, Soll-Situation, Gegenueberstellung mit Ziel,
 * Kapitelblatt, die Sanierungsbereiche aus der gezeichneten Skizze,
 * Kapitelblatt, Vorher/Nachher mit Schieberegler, Schluss.
 *
 * Eigene Texte hier: Ist-Situation (eine Beschreibung, aus der die
 * Gegenueberstellung entsteht), Soll-Situation, Sanierungsziel. Alles andere
 * kommt beim Start frisch von den anderen Seiten des Projekts; wer dort etwas
 * aendert, sieht es beim naechsten Start (Yann: "muss sich aktualisieren").
 */

export interface PraesentationPanelProps {
  kunde: Kundendaten
  stapel: Fotostapel
  seiten: Seiten
  /** Die gezeichnete Prinzipskizze aus der Sammlung, oder null */
  skizze: { blob: Blob; name: string } | null
  vorgangId: string
  zustand: PraesentationZustand
  onZustand: (zustand: PraesentationZustand) => void
  onToast: ToastFn
  /** Ob die Seite gerade offen ist; dann wird der Stand der Vorschau nachgelesen */
  sichtbar: boolean
}

type Feld = 'ist' | 'soll' | 'ziel'

const FELDER: { feld: Feld; titel: string }[] = [
  { feld: 'ist', titel: 'Ist-Situation' },
  { feld: 'soll', titel: 'Soll-Situation' },
  { feld: 'ziel', titel: 'Sanierungsziel' },
]

/**
 * Ausschnitte der Skizzenseiten in PDF-Punkten von oben (Masse aus
 * lib/pdf.ts): Bauzeichnungen = Zeichenflaeche unter der Kopfzeile bis ueber
 * die Legende, dazu die Legende als eigener Streifen; Bildseiten = die
 * Bildflaeche zwischen Kopf (134) und Hinweis/Fusszeile (58 + Rand 40).
 * Ohne Rahmen um das Blatt wirken die Elemente auf der Folie doppelt so gross.
 */
function ausschnitteFuer(_seite: number, abschnitt: string | null): Ausschnitt[] {
  if (abschnitt === 'Bauzeichnungen') {
    return [
      { name: 'haupt', box: { x: 44, y: 122, breite: 507, hoehe: 842 - 122 - 84 } },
      { name: 'legende', box: { x: 44, y: 842 - 84, breite: 507, hoehe: 62 } },
    ]
  }
  return [{ name: 'haupt', box: { x: 40, y: 134, breite: 515, hoehe: 842 - 134 - 98 } }]
}

export default function PraesentationPanel({
  kunde,
  stapel,
  seiten,
  skizze,
  vorgangId,
  zustand,
  onZustand,
  onToast,
  sichtbar,
}: PraesentationPanelProps) {
  const [offenesFeld, setOffenesFeld] = useState<Feld | null>(null)
  const [folien, setFolien] = useState<Folie[] | null>(null)
  const [baut, setBaut] = useState(false)
  /** Blob-Adressen, die mit dem Ende der Praesentation wieder frei werden */
  const [adressen, setAdressen] = useState<string[]>([])
  /** Wie viele Vorher/Nachher-Paare gespeichert sind, fuer die Uebersicht */
  const [paare, setPaare] = useState<number | null>(null)

  // Bei jedem Oeffnen der Seite den Stand der Vorschau nachlesen
  useEffect(() => {
    if (!sichtbar) return
    let abgebrochen = false
    void ladeSeitenDaten<VorschauSatz[]>(vorgangId, 'vorschau')
      .then((s) => {
        if (!abgebrochen) setPaare((s ?? []).filter((f) => nachherVon(f) !== null).length)
      })
      .catch(() => {
        if (!abgebrochen) setPaare(0)
      })
    return () => {
      abgebrochen = true
    }
  }, [vorgangId, folien, sichtbar])

  const mitarbeiter = mitarbeiterVon(kunde)
  /** Ist-Situation: eigener Text, sonst die Zusammenfassung der Fotodokumentation */
  const istEigen = zustand.ist ?? []
  const istFallback =
    seiten.fotodoku.zusammenfassung.length > 0 ? seiten.fotodoku.zusammenfassung : seiten.fotodoku.beurteilung
  const ist: Reichtext = reichtextIstLeer(istEigen) ? istFallback : istEigen
  const istAusFotodoku = reichtextIstLeer(istEigen) && !reichtextIstLeer(istFallback)
  const hatIst = !reichtextIstLeer(ist)
  const hatSoll = !reichtextIstLeer(zustand.soll)
  const hatZiel = !reichtextIstLeer(zustand.ziel)
  const istFotos = stapel.fotos.filter((f) => !seiten.fotodoku.ausgeschlossen.includes(f.id)).slice(0, 4)

  const setzeText = (feld: Feld, wert: Reichtext) => onZustand({ ...zustand, [feld]: wert })

  const beenden = useCallback(() => {
    for (const a of adressen) URL.revokeObjectURL(a)
    setAdressen([])
    setFolien(null)
  }, [adressen])

  /** Alle Folien aus dem aktuellen Stand des Projekts zusammenstellen */
  async function starten() {
    if (baut) return
    setBaut(true)
    const neueAdressen: string[] = []
    let kapitel = 0
    try {
      const liste: Folie[] = []
      const objekt = objektadresseEcht(kunde)
      const objektfoto = kunde.objektfoto?.thumbUrl ?? null
      liste.push({
        art: 'titel',
        untertitel: 'SANIERUNGSKONZEPT',
        titel: kunde.kunde.trim() || 'Ihr Objekt',
        zeilen: [objekt, kunde.baujahr.trim() ? `Baujahr ${kunde.baujahr.trim()}` : '', formatDateShort(Date.now())].filter(
          Boolean,
        ),
        bildUrl: objektfoto,
      })
      liste.push({ art: 'isotec' })

      // Kapitel: Ist und Soll
      if (hatIst || hatSoll || hatZiel) {
        liste.push({
          art: 'kapitel',
          nummer: ++kapitel,
          titel: 'Ihr Objekt heute und morgen',
          unterzeile: 'Wo Ihr Objekt heute steht, was wir vorhaben und wohin es geht.',
          bildUrl: objektfoto,
        })
      }
      if (hatIst) {
        liste.push({
          art: 'text',
          marke: 'IST-SITUATION',
          titel: 'So ist es heute',
          html: reichtextZuHtml(ist),
          bilder: istFotos.map((f) => f.thumbUrl),
        })
      }
      if (hatSoll) {
        liste.push({
          art: 'text',
          marke: 'SOLL-SITUATION',
          titel: 'So soll es werden',
          html: reichtextZuHtml(zustand.soll),
          chips: kunde.gewerke,
        })
      }
      if (hatIst && hatSoll) {
        liste.push({
          art: 'gegenueber',
          istHtml: reichtextZuHtml(ist),
          sollHtml: reichtextZuHtml(zustand.soll),
          zielHtml: hatZiel ? reichtextZuHtml(zustand.ziel) : null,
        })
      } else if (hatZiel) {
        liste.push({ art: 'text', marke: 'ZIEL', titel: 'Sanierungsziel', html: reichtextZuHtml(zustand.ziel) })
      }

      // Kapitel: die gewaehlten Gewerke mit Grafiken und Erklaerungen der Zentrale
      const gewerkeInfos = infosFuer(kunde.gewerke)
      if (gewerkeInfos.length > 0) {
        liste.push({
          art: 'kapitel',
          nummer: ++kapitel,
          titel: gewerkeInfos.length === 1 ? 'Unsere Systemlösung' : 'Unsere Systemlösungen',
          unterzeile: gewerkeInfos.map((g) => g.titel.replace(/^ISOTEC-/, '')).join(' · '),
          bildUrl: gewerkBild(gewerkeInfos[0].id, 'kapitel'),
        })
        for (const g of gewerkeInfos) {
          liste.push({
            art: 'gewerk',
            titel: g.titel,
            untertitel: g.untertitel,
            bildUrl: gewerkBild(g.id, 'system') ?? gewerkBild(g.id, 'skizze'),
            vorteile: g.vorteile,
            schadenUrl: gewerkBild(g.id, 'schaden'),
            schadenText: g.schaden,
          })
          const bilder = [1, 2, 3, 4].map((n) => gewerkBild(g.id, `schritt${n}`)).filter((b): b is string => b !== null)
          if (bilder.length === 4) {
            liste.push({
              art: 'schritte',
              titel: `So gehen wir vor: ${g.titel.replace(/^ISOTEC-/, '')}`,
              bilder,
              beschriftungen: g.schritte ?? null,
              skizzeUrl: gewerkBild(g.id, 'system') ? gewerkBild(g.id, 'skizze') : gewerkBild(g.id, 'prinzip'),
            })
          }
        }
      }

      // Kapitel: Sanierungsbereiche aus der gezeichneten Skizze
      if (skizze) {
        const { rendereSeiten } = await import('./lib/pdfbilder')
        const { bilder } = await rendereSeiten(new Uint8Array(await skizze.blob.arrayBuffer()), 2, null, 2400, ausschnitteFuer)
        const mitTeilen = bilder.filter((b) => b.teile.length > 0)
        if (mitTeilen.length > 0) {
          const erstes = mitTeilen.find((b) => b.abschnitt !== 'Bauzeichnungen') ?? mitTeilen[0]
          liste.push({
            art: 'kapitel',
            nummer: ++kapitel,
            titel: 'Sanierungsbereiche',
            unterzeile: 'Wo wir arbeiten: die Bereiche Ihres Objekts, eingezeichnet in Plan und Foto.',
            bildUrl: erstes.teile[0]?.url ?? null,
          })
        }
        for (const b of mitTeilen) {
          for (const t of b.teile) neueAdressen.push(t.url)
          const haupt = b.teile.find((t) => t.name === 'haupt') ?? b.teile[0]
          const legende = b.teile.find((t) => t.name === 'legende') ?? null
          liste.push({
            art: 'skizze',
            marke: 'PRINZIPSKIZZE',
            titel: b.abschnitt ?? 'Sanierungsbereiche',
            hauptUrl: haupt.url,
            legendeUrl: legende?.url ?? null,
          })
        }
      }

      // Kapitel: Vorher/Nachher aus dem gespeicherten Stand der Sanierungsvorschau
      const saetze = (await ladeSeitenDaten<VorschauSatz[]>(vorgangId, 'vorschau')) ?? []
      const paareListe = saetze
        .map((satz) => ({ satz, nachher: nachherVon(satz) }))
        .filter((p): p is { satz: VorschauSatz; nachher: Blob } => p.nachher !== null)
      if (paareListe.length > 0) {
        const vorschauBild = URL.createObjectURL(paareListe[0].nachher)
        neueAdressen.push(vorschauBild)
        liste.push({
          art: 'kapitel',
          nummer: ++kapitel,
          titel: 'Sanierungsvorschau',
          unterzeile: 'So kann Ihr Keller nach der Sanierung aussehen. Ziehen Sie den Regler und sehen Sie selbst.',
          bildUrl: vorschauBild,
        })
        for (const { satz, nachher } of paareListe) {
          const vorherUrl = URL.createObjectURL(satz.vorherBlob)
          const nachherUrl = URL.createObjectURL(nachher)
          neueAdressen.push(vorherUrl, nachherUrl)
          liste.push({ art: 'vergleich', name: satz.name, vorherUrl, nachherUrl })
        }
      }

      liste.push({ art: 'schluss', name: mitarbeiter.name, rolle: mitarbeiter.name ? rolleVon(mitarbeiter.name) : '' })
      setAdressen(neueAdressen)
      setFolien(liste)
    } catch (fehler) {
      for (const a of neueAdressen) URL.revokeObjectURL(a)
      onToast('error', `Präsentation konnte nicht aufgebaut werden: ${fehler instanceof Error ? fehler.message : String(fehler)}`)
    } finally {
      setBaut(false)
    }
  }

  /** Zeilen der Folienuebersicht: was kommt, was fehlt noch */
  const uebersicht: { titel: string; da: boolean; quelle: string }[] = [
    { titel: 'Titel', da: true, quelle: kunde.kunde.trim() || 'Kunde fehlt' },
    { titel: 'Warum ISOTEC', da: true, quelle: 'Angebotsmappe' },
    { titel: 'Ist-Situation', da: hatIst, quelle: istAusFotodoku ? 'Zusammenfassung der Fotodokumentation' : 'hier' },
    { titel: 'Soll-Situation', da: hatSoll, quelle: 'hier' },
    { titel: 'Ist und Soll, Ziel', da: hatIst && hatSoll, quelle: hatZiel ? 'mit Sanierungsziel' : 'ohne Sanierungsziel' },
    {
      titel: 'Systemlösungen',
      da: infosFuer(kunde.gewerke).length > 0,
      quelle:
        infosFuer(kunde.gewerke).length > 0
          ? infosFuer(kunde.gewerke).map((g) => g.titel.replace(/^ISOTEC-/, '')).join(', ')
          : 'Gewerke auf der Übersicht wählen',
    },
    { titel: 'Sanierungsbereiche', da: skizze !== null, quelle: skizze ? skizze.name : 'gezeichnete Prinzipskizze' },
    {
      titel: 'Vorher / Nachher',
      da: (paare ?? 0) > 0,
      quelle: paare === null ? 'Sanierungsvorschau' : `${paare} Paar${paare === 1 ? '' : 'e'} aus der Sanierungsvorschau`,
    },
    { titel: 'Schluss', da: true, quelle: mitarbeiter.name ? nameMitRolle(mitarbeiter.name) : 'Mitarbeiter fehlt' },
  ]

  return (
    <div className="praesentation-seite">
      <section className="card" aria-labelledby="praes-texte">
        <div className="karte-kopf">
          <h2 id="praes-texte">Präsentation</h2>
        </div>
        <div className="praes-felder">
          {FELDER.map(({ feld, titel }) => {
            const wert = zustand[feld] ?? []
            return (
              <div key={feld} className="eingabe">
                <span className="eingabe-label">{titel}</span>
                <button type="button" className="textvorschau" onClick={() => setOffenesFeld(feld)}>
                  {reichtextIstLeer(wert) ? (
                    <span className="textvorschau-leer">
                      {feld === 'ist' && istAusFotodoku ? 'aus der Fotodokumentation' : titel}
                    </span>
                  ) : (
                    <Textvorschau reich={wert} />
                  )}
                </button>
              </div>
            )
          })}
        </div>

        <ul className="praes-folien">
          {uebersicht.map((z, i) => (
            <li key={z.titel} className={z.da ? 'da' : 'fehlt'}>
              <span className="praes-nr">{i + 1}</span>
              <span className="praes-titel">{z.titel}</span>
              <span className="praes-quelle">{z.quelle}</span>
            </li>
          ))}
        </ul>

        <div className="praes-aktion">
          <button type="button" className="btn-primary" disabled={baut} onClick={() => void starten()}>
            {baut ? 'Präsentation wird aufgebaut …' : 'Präsentation starten'}
          </button>
        </div>

        {offenesFeld && (
          <Textfenster
            titel={FELDER.find((f) => f.feld === offenesFeld)?.titel ?? ''}
            hinweis="erscheint als eigene Folie in der Präsentation"
            wert={zustand[offenesFeld] ?? []}
            onSpeichern={(neu) => {
              setzeText(offenesFeld, neu)
              setOffenesFeld(null)
            }}
            onAbbrechen={() => setOffenesFeld(null)}
          />
        )}
      </section>

      {folien && <Praesentation folien={folien} onSchliessen={beenden} />}
    </div>
  )
}
