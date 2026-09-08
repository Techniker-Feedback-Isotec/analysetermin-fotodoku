/**
 * Formatierter Text fuer Zusammenfassung und Beurteilung.
 *
 * Geschrieben wird im Textfenster in einem bearbeitbaren Bereich des Browsers,
 * dessen Ergebnis HTML ist. Gespeichert und an die PDF gegeben wird aber nicht
 * dieses HTML, sondern ein bewusst kleines Modell: Absaetze und
 * Aufzaehlungspunkte, darin Textstuecke mit fett, kursiv und unterstrichen.
 *
 * Grund: Die PDF kann nur diese Auszeichnungen zeichnen, und aus Word oder
 * Outlook eingefuegter Text bringt sonst Schriftarten, Farben, Tabellen und
 * Bilder mit, die im Deckblatt-Layout nichts verloren haben. Was das Modell
 * nicht kennt, wird beim Uebernehmen verworfen - dadurch sieht die PDF genauso
 * aus wie das Textfenster.
 */

export interface TextStueck {
  text: string
  fett: boolean
  kursiv: boolean
  unterstrichen: boolean
}

export interface TextAbsatz {
  /** 'punkt' ist ein Aufzaehlungspunkt, 'absatz' normaler Fliesstext */
  art: 'absatz' | 'punkt'
  stuecke: TextStueck[]
}

export type Reichtext = TextAbsatz[]

interface Marken {
  fett: boolean
  kursiv: boolean
  unterstrichen: boolean
}

const OHNE_MARKEN: Marken = { fett: false, kursiv: false, unterstrichen: false }

/** Elemente, die einen eigenen Absatz beginnen. */
const BLOECKE = new Set(['P', 'DIV', 'UL', 'OL', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'TR', 'PRE'])

/** Elemente, deren Inhalt gar nicht uebernommen wird. */
const VERWERFEN = new Set(['SCRIPT', 'STYLE', 'HEAD', 'TITLE', 'META', 'LINK', 'IMG', 'SVG', 'VIDEO', 'AUDIO'])

function markenVon(el: HTMLElement, bisher: Marken): Marken {
  const tag = el.tagName
  const stil = el.style
  // Eingefuegter Text bringt die Auszeichnung oft als Stil mit (Word, Outlook,
  // und der Browser selbst, wenn er mit CSS statt mit <b> arbeitet).
  const gewicht = stil.fontWeight
  const fett =
    bisher.fett ||
    tag === 'B' ||
    tag === 'STRONG' ||
    tag.match(/^H[1-6]$/) !== null ||
    gewicht === 'bold' ||
    gewicht === 'bolder' ||
    (/^\d+$/.test(gewicht) && Number(gewicht) >= 600)
  const kursiv = bisher.kursiv || tag === 'I' || tag === 'EM' || stil.fontStyle === 'italic'
  const unterstrichen =
    bisher.unterstrichen || tag === 'U' || (stil.textDecoration + stil.textDecorationLine).includes('underline')
  return { fett, kursiv, unterstrichen }
}

class Sammler {
  absaetze: Reichtext = []
  private offen: TextAbsatz | null = null
  private naechsteArt: TextAbsatz['art'] = 'absatz'

  /** Neuer Block: den laufenden Absatz abschliessen, Art fuer den naechsten merken. */
  blockAnfang(art: TextAbsatz['art']): void {
    this.offen = null
    this.naechsteArt = art
  }

  blockEnde(): void {
    this.offen = null
    this.naechsteArt = 'absatz'
  }

  /** Zeilenumbruch innerhalb eines Blocks: neuer Absatz gleicher Art. */
  umbruch(): void {
    const art = this.offen?.art ?? this.naechsteArt
    // Ein Umbruch in einem noch leeren Block ist eine Leerzeile.
    if (!this.offen) this.absaetze.push({ art, stuecke: [] })
    this.offen = null
    this.naechsteArt = art
  }

  text(roh: string, marken: Marken): void {
    // Umbrueche und Einrueckungen im HTML-Quelltext sind keine Zeilenumbrueche.
    const text = roh.replace(/\s+/g, ' ')
    if (text === '') return
    if (text === ' ' && !this.offen) return
    if (!this.offen) {
      this.offen = { art: this.naechsteArt, stuecke: [] }
      this.absaetze.push(this.offen)
    }
    const letztes = this.offen.stuecke[this.offen.stuecke.length - 1]
    if (
      letztes &&
      letztes.fett === marken.fett &&
      letztes.kursiv === marken.kursiv &&
      letztes.unterstrichen === marken.unterstrichen
    ) {
      letztes.text += text
      return
    }
    this.offen.stuecke.push({ text, ...marken })
  }
}

function lese(node: Node, marken: Marken, sammler: Sammler): void {
  for (const kind of Array.from(node.childNodes)) {
    if (kind.nodeType === Node.TEXT_NODE) {
      sammler.text(kind.textContent ?? '', marken)
      continue
    }
    if (kind.nodeType !== Node.ELEMENT_NODE) continue
    const el = kind as HTMLElement
    const tag = el.tagName
    if (VERWERFEN.has(tag)) continue
    if (tag === 'BR') {
      sammler.umbruch()
      continue
    }
    const eigene = markenVon(el, marken)
    if (tag === 'LI') {
      sammler.blockAnfang('punkt')
      lese(el, eigene, sammler)
      sammler.blockEnde()
      continue
    }
    if (BLOECKE.has(tag) || tag === 'TD' || tag === 'TH') {
      sammler.blockAnfang('absatz')
      lese(el, eigene, sammler)
      sammler.blockEnde()
      continue
    }
    lese(el, eigene, sammler)
  }
}

/** Raeumt auf: Leerraum an den Raendern, keine Leerzeilen am Anfang, Ende oder doppelt. */
function aufraeumen(absaetze: Reichtext): Reichtext {
  const sauber: Reichtext = []
  for (const absatz of absaetze) {
    const stuecke = absatz.stuecke
      .map((s) => ({ ...s }))
      .filter((s) => s.text !== '')
    if (stuecke.length > 0) {
      stuecke[0].text = stuecke[0].text.replace(/^ +/, '')
      stuecke[stuecke.length - 1].text = stuecke[stuecke.length - 1].text.replace(/ +$/, '')
    }
    const inhalt = stuecke.filter((s) => s.text !== '')
    const leer = inhalt.length === 0
    // Leerzeilen nur zwischen Absaetzen, nie am Anfang und nie zwei hintereinander
    if (leer && (sauber.length === 0 || sauber[sauber.length - 1].stuecke.length === 0)) continue
    sauber.push({ art: absatz.art, stuecke: inhalt })
  }
  while (sauber.length > 0 && sauber[sauber.length - 1].stuecke.length === 0) sauber.pop()
  return sauber
}

/** Liest das HTML des Textfensters in das Modell. */
export function reichtextAusHtml(html: string): Reichtext {
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${html}</body>`, 'text/html')
  const sammler = new Sammler()
  lese(doc.body, OHNE_MARKEN, sammler)
  return aufraeumen(sammler.absaetze)
}

function schuetze(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function stueckHtml(s: TextStueck): string {
  let html = schuetze(s.text)
  if (s.unterstrichen) html = `<u>${html}</u>`
  if (s.kursiv) html = `<em>${html}</em>`
  if (s.fett) html = `<strong>${html}</strong>`
  return html
}

/**
 * Baut aus dem Modell wieder HTML fuer das Textfenster. Aufeinanderfolgende
 * Aufzaehlungspunkte werden zu einer Liste zusammengefasst.
 */
export function reichtextZuHtml(reich: Reichtext): string {
  const teile: string[] = []
  let inListe = false
  for (const absatz of reich) {
    const inhalt = absatz.stuecke.map(stueckHtml).join('')
    if (absatz.art === 'punkt') {
      if (!inListe) {
        teile.push('<ul>')
        inListe = true
      }
      teile.push(`<li>${inhalt}</li>`)
      continue
    }
    if (inListe) {
      teile.push('</ul>')
      inListe = false
    }
    // Ein leerer Absatz braucht ein <br>, sonst zeigt der Browser ihn nicht.
    teile.push(`<div>${inhalt === '' ? '<br>' : inhalt}</div>`)
  }
  if (inListe) teile.push('</ul>')
  return teile.join('')
}

export function reichtextIstLeer(reich: Reichtext): boolean {
  return reich.every((absatz) => absatz.stuecke.every((s) => s.text.trim() === ''))
}

/** Unformatierte Fassung, z. B. fuer kurze Vorschauzeilen. */
export function reichtextAlsText(reich: Reichtext): string {
  return reich
    .map((absatz) => {
      const text = absatz.stuecke.map((s) => s.text).join('')
      return absatz.art === 'punkt' ? `• ${text}` : text
    })
    .join('\n')
}
