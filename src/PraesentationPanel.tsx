import { useCallback, useEffect, useState } from 'react'
import Praesentation, { type Folie } from './Praesentation'
import Textfenster, { Textvorschau } from './Textfenster'
import type { Fotostapel } from './fotostapel'
import { nameMitRolle, rolleVon } from './data/rollen'
import { reichtextIstLeer, reichtextZuHtml, type Reichtext } from './lib/richtext'
import { formatDateShort } from './lib/format'
import { ladeSeitenDaten, type PraesentationZustand } from './lib/speicher'
import { nachherVon, type VorschauSatz } from './vorschau/lib/saetze'
import { mitarbeiterVon, objektadresseEcht, type Kundendaten, type ToastFn } from './kunde'
import type { Seiten } from './vorgang'

/**
 * Seite "Praesentation" (12.09.2026, Yann): Aus Prinzipskizze,
 * Sanierungsvorschau und den Zusammenfassungen eine Praesentation fuer die
 * Auftragsbesprechung. Aufbau: ISOTEC wie in der Angebotsmappe, Ist-Situation
 * (Zusammenfassung der Fotodokumentation), Soll-Situation, Ist und Soll
 * nebeneinander, Sanierungsziel, die Sanierungsbereiche aus der gezeichneten
 * Skizze, Vorher/Nachher mit Schieberegler.
 *
 * Eigene Texte hier sind nur Soll-Situation und Sanierungsziel; alles andere
 * kommt von den anderen Seiten des Projekts und ist beim Start aktuell.
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
}

type Feld = 'soll' | 'ziel'

const FELDER: { feld: Feld; titel: string }[] = [
  { feld: 'soll', titel: 'Soll-Situation' },
  { feld: 'ziel', titel: 'Sanierungsziel' },
]

export default function PraesentationPanel({
  kunde,
  stapel,
  seiten,
  skizze,
  vorgangId,
  zustand,
  onZustand,
  onToast,
}: PraesentationPanelProps) {
  const [offenesFeld, setOffenesFeld] = useState<Feld | null>(null)
  const [folien, setFolien] = useState<Folie[] | null>(null)
  const [baut, setBaut] = useState(false)
  /** Blob-Adressen, die mit dem Ende der Praesentation wieder frei werden */
  const [adressen, setAdressen] = useState<string[]>([])
  /** Wie viele Vorher/Nachher-Paare gespeichert sind, fuer die Uebersicht */
  const [paare, setPaare] = useState<number | null>(null)

  useEffect(() => {
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
  }, [vorgangId, folien])

  const mitarbeiter = mitarbeiterVon(kunde)
  const ist = seiten.fotodoku.zusammenfassung.length > 0 ? seiten.fotodoku.zusammenfassung : seiten.fotodoku.beurteilung
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
    try {
      const liste: Folie[] = []
      const objekt = objektadresseEcht(kunde)
      liste.push({
        art: 'titel',
        untertitel: 'SANIERUNGSKONZEPT',
        titel: kunde.kunde.trim() || 'Ihr Objekt',
        zeilen: [objekt, kunde.baujahr.trim() ? `Baujahr ${kunde.baujahr.trim()}` : '', formatDateShort(Date.now())].filter(
          Boolean,
        ),
        bildUrl: kunde.objektfoto?.thumbUrl ?? null,
      })
      liste.push({ art: 'isotec' })
      if (hatIst) {
        liste.push({
          art: 'text',
          marke: 'BESTAND',
          titel: 'Ist-Situation',
          html: reichtextZuHtml(ist),
          bilder: istFotos.map((f) => f.thumbUrl),
        })
      }
      if (hatSoll) {
        liste.push({
          art: 'text',
          marke: 'SANIERUNG',
          titel: 'Soll-Situation',
          html: reichtextZuHtml(zustand.soll),
          chips: kunde.gewerke,
        })
      }
      if (hatIst && hatSoll) {
        liste.push({ art: 'gegenueber', istHtml: reichtextZuHtml(ist), sollHtml: reichtextZuHtml(zustand.soll) })
      }
      if (hatZiel) {
        liste.push({ art: 'text', marke: 'ZIEL', titel: 'Sanierungsziel', html: reichtextZuHtml(zustand.ziel) })
      }

      // Die gezeichnete Skizze: alle Seiten ausser dem Deckblatt
      if (skizze) {
        const { rendereSeiten } = await import('./lib/pdfbilder')
        const { bilder, abschnitte } = await rendereSeiten(new Uint8Array(await skizze.blob.arrayBuffer()), 2, null)
        for (const b of bilder) {
          neueAdressen.push(b.url)
          const abschnitt = [...abschnitte].reverse().find((a) => a.seite <= b.seite)
          liste.push({ art: 'bild', marke: 'PRINZIPSKIZZE', titel: abschnitt?.titel ?? 'Sanierungsbereiche', url: b.url })
        }
      }

      // Vorher/Nachher aus dem gespeicherten Stand der Sanierungsvorschau
      const saetze = (await ladeSeitenDaten<VorschauSatz[]>(vorgangId, 'vorschau')) ?? []
      for (const satz of saetze) {
        const nachher = nachherVon(satz)
        if (!nachher) continue
        const vorherUrl = URL.createObjectURL(satz.vorherBlob)
        const nachherUrl = URL.createObjectURL(nachher)
        neueAdressen.push(vorherUrl, nachherUrl)
        liste.push({ art: 'vergleich', name: satz.name, vorherUrl, nachherUrl })
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
    { titel: 'Ist-Situation', da: hatIst, quelle: 'Zusammenfassung der Fotodokumentation' },
    { titel: 'Soll-Situation', da: hatSoll, quelle: 'hier' },
    { titel: 'Ist und Soll', da: hatIst && hatSoll, quelle: 'beide Texte' },
    { titel: 'Sanierungsziel', da: hatZiel, quelle: 'hier' },
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
          {FELDER.map(({ feld, titel }) => (
            <div key={feld} className="eingabe eingabe-breit">
              <span className="eingabe-label">{titel}</span>
              <button type="button" className="textvorschau" onClick={() => setOffenesFeld(feld)}>
                {reichtextIstLeer(zustand[feld]) ? (
                  <span className="textvorschau-leer">{titel}</span>
                ) : (
                  <Textvorschau reich={zustand[feld]} />
                )}
              </button>
            </div>
          ))}
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
            wert={zustand[offenesFeld]}
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
