import { PDFDocument, PDFFont, PDFImage, PDFPage, StandardFonts, rgb } from 'pdf-lib'
import type { OptimizedImage } from './image'
import type { Reichtext, TextAbsatz, TextStueck } from './richtext'
import type { LegendenGruppe } from '../data/legende'
import { zeichneDeckblatt, type DeckblattBild } from './deckblatt'
import { formatDateTime } from './format'

// ISOTEC-Farben (Corporate Design Handbuch 2.0)
const RED = rgb(213 / 255, 19 / 255, 23 / 255) // #D51317
const BROWN = rgb(86 / 255, 74 / 255, 68 / 255) // #564A44
const GREY = rgb(224 / 255, 224 / 255, 224 / 255) // #E0E0E0

const A4: [number, number] = [595.28, 841.89]

/** Farbe aus "#rrggbb"; hellt sie auf Wunsch Richtung Weiss auf (0 = Original, 1 = weiss). */
function farbeVon(hex: string, aufhellen = 0): ReturnType<typeof rgb> {
  const zahl = parseInt(hex.replace('#', ''), 16)
  const misch = (kanal: number) => (kanal + (255 - kanal) * aufhellen) / 255
  return rgb(misch((zahl >> 16) & 255), misch((zahl >> 8) & 255), misch(zahl & 255))
}

export interface PdfPhoto {
  image: OptimizedImage
  /** Aufnahme- bzw. Dateizeitpunkt in ms, oder null */
  takenAt: number | null
  isDuplicate: boolean
}

export interface PdfInputs {
  /** Terminart, wird zur Deckblatt-Ueberschrift: Analysetermin / Reklamation */
  terminType: string
  /** Nur noch fuer den Vermerk unter der Textseite, nicht mehr auf dem Deckblatt */
  salespersonName: string
  /** Visitenkarte des Mitarbeiters fuer das Deckblatt, oder null */
  visitenkarte: DeckblattBild | null
  objectImage: OptimizedImage
  /**
   * Anschrift unter dem Objektfoto, oder null. Liegt das Objekt beim Kunden,
   * steht hier "siehe Kundenadresse" statt derselben Anschrift zweimal.
   */
  objectAddress: string | null
  /** Kundenname (optionale Eingabe), oder null */
  customerName: string | null
  /** Anschrift des Kunden (optional), oder null */
  customerAddress: string | null
  /** Auftragsnummer (nur bei Reklamation, optional), oder null */
  orderNumber: string | null
  /**
   * Optionale Textseite direkt nach dem Deckblatt (Fliesstext), z. B.
   * "Fachliche Beurteilung" (Reklamation) oder "Zusammenfassung" (Analysetermin).
   * note = Vermerk am Ende (wer, wann).
   */
  /**
   * Prinzipskizze: freie Seite fuer den Grundriss, direkt nach dem Deckblatt.
   * Unten steht eine kleine Legende zu den gewaehlten Gewerken. null = keine
   * solche Seite (Fotodokumentation).
   */
  /**
   * Prinzipskizze: freie Seite fuer den Grundriss. `zeichnung` ist der
   * vorgezeichnete Wandquerschnitt passend zum Baujahr (siehe
   * data/prinzipzeichnung.ts), oder null - dann bleibt die Flaeche leer.
   */
  drawingPage: { title: string; legende: LegendenGruppe[]; zeichnung: DeckblattBild | null } | null
  /**
   * Kleiner Hinweis, rot umrandet, unten auf jeder Bildseite - bei der
   * Prinzipskizze also auf allen Seiten nach den Bauzeichnungen (Yann,
   * 09.09.2026). null = kein Hinweis (Fotodokumentation).
   */
  fotoHinweis: string | null
  textPage: { title: string; inhalt: Reichtext; note: string } | null
  /** Anzahl der geplanten Termin-Fotos (Zaehler fuer den Fortschritt) */
  photoCount: number
  /**
   * Liefert das Foto fuer Seite `index` erst, wenn es gebraucht wird - so liegt
   * nie die komplette Bildmenge gleichzeitig im Speicher. null = Foto konnte
   * nicht gelesen werden und wird uebersprungen.
   */
  loadPhoto: (index: number) => Promise<PdfPhoto | null>
  createdAt: Date
  /** Termindatum aus den Foto-Aufnahmedaten, z. B. "Mittwoch, 6. August 2026" */
  terminLabel: string
  /** ISOTEC-Logo (PNG) */
  logoPng: Uint8Array
}

function embed(doc: PDFDocument, img: OptimizedImage): Promise<PDFImage> {
  return img.format === 'png' ? doc.embedPng(img.bytes) : doc.embedJpg(img.bytes)
}

/** Dasselbe fuer die Bilder des Deckblatts und die Prinzipzeichnung. */
function embedBild(doc: PDFDocument, bild: DeckblattBild): Promise<PDFImage> {
  return bild.format === 'png' ? doc.embedPng(bild.bytes) : doc.embedJpg(bild.bytes)
}

function fitInto(imgW: number, imgH: number, boxW: number, boxH: number) {
  const scale = Math.min(boxW / imgW, boxH / imgH)
  return { w: imgW * scale, h: imgH * scale }
}

// Zeichen ausserhalb von WinAnsi (Standard-Helvetica) durch "?" ersetzen,
// damit eingefuegter Text (z. B. mit Emojis) die PDF-Erstellung nicht abbricht.
const WINANSI_EXTRA = new Set([...'€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ'])
function toWinAnsi(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, '  ')
    .split('')
    .map((ch) => {
      if (ch === '\n') return ch
      const code = ch.charCodeAt(0)
      if ((code >= 32 && code <= 126) || (code >= 160 && code <= 255)) return ch
      return WINANSI_EXTRA.has(ch) ? ch : '?'
    })
    .join('')
}

/** Bricht Text wortweise auf eine maximale Zeilenbreite um (Absaetze bleiben erhalten). */
function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    if (paragraph.trim() === '') {
      lines.push('')
      continue
    }
    let current = ''
    for (const word of paragraph.split(/\s+/)) {
      const candidate = current ? `${current} ${word}` : word
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        current = candidate
      } else {
        if (current) lines.push(current)
        let rest = word
        while (font.widthOfTextAtSize(rest, size) > maxWidth && rest.length > 1) {
          let cut = rest.length - 1
          while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > maxWidth) cut--
          lines.push(rest.slice(0, cut))
          rest = rest.slice(cut)
        }
        current = rest
      }
    }
    lines.push(current)
  }
  return lines
}

/** Text mit Buchstaben-Sperrung (pdf-lib kennt kein letter-spacing). */
function drawTracked(
  page: PDFPage,
  text: string,
  x: number,
  y: number,
  font: PDFFont,
  size: number,
  color: ReturnType<typeof rgb>,
  tracking: number,
) {
  let cx = x
  for (const ch of text) {
    page.drawText(ch, { x: cx, y, size, font, color })
    cx += font.widthOfTextAtSize(ch, size) + tracking
  }
}

/**
 * Baut die PDF: Deckblatt (Stil "Einarbeitungsmappe") + exakt 1 Foto pro Seite.
 * onProgress wird nach jeder eingefuegten Fotoseite aufgerufen.
 */
export async function buildPdf(
  inputs: PdfInputs,
  onProgress?: (done: number, total: number) => void,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.setTitle(`${inputs.terminType} - Fotodokumentation`)
  doc.setSubject(`${inputs.terminType} ${inputs.terminLabel} - ${inputs.salespersonName}`)
  doc.setCreator('Fotodoku (100 % clientseitig)')
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const regular = await doc.embedFont(StandardFonts.Helvetica)
  const italic = await doc.embedFont(StandardFonts.HelveticaOblique)
  // Fuer fett und kursiv zugleich im formatierten Text
  const boldItalic = await doc.embedFont(StandardFonts.HelveticaBoldOblique)
  const [W, H] = A4
  const logo = await doc.embedPng(inputs.logoPng)

  // ---------- Deckblatt ----------
  // Aufbau, Masse und der Schutz vor Ueberschneidungen stehen in
  // lib/deckblatt.ts; dasselbe Deckblatt benutzt die Sanierungsvorschau.
  // Weniger ist mehr (Yann, 08.09.2026): Auf dem Deckblatt stehen nur das
  // Objektfoto, die Art des Dokuments und die Angaben zum Kunden. Der
  // Mitarbeiter erscheint als Visitenkarte, nicht namentlich.
  const istSkizze = inputs.terminType === 'Prinzipskizze'
  await zeichneDeckblatt(
    doc,
    { regular, bold },
    {
      titel: inputs.terminType,
      // Bei der Prinzipskizze ist die Terminart selbst der Titel, die Unterzeile
      // "Fotodokumentation" entfaellt dort auf Wunsch der Vertriebler.
      unterzeile: istSkizze ? null : 'Fotodokumentation',
      objekt: { bytes: inputs.objectImage.bytes, format: inputs.objectImage.format },
      visitenkarte: inputs.visitenkarte,
      zeilen: [
        { label: 'Kunde', wert: inputs.customerName ?? '' },
        { label: 'Kundenadresse', wert: inputs.customerAddress ?? '' },
        { label: 'Objekt', wert: inputs.objectAddress ?? '' },
        { label: 'Auftragsnummer', wert: inputs.orderNumber ?? '' },
        // Das Termindatum steht nur auf der Fotodokumentation.
        { label: 'Termin', wert: istSkizze ? '' : inputs.terminLabel },
      ],
      logo: { bytes: inputs.logoPng, format: 'png' },
    },
  )

  // ---------- Bauzeichnungen (Prinzipskizze, direkt nach dem Deckblatt) ----------
  // Die Seite bleibt bewusst leer: Dort wird der Grundriss eingefuegt. Unten
  // steht nur eine kleine Legende zu den gewaehlten Gewerken.
  if (inputs.drawingPage) {
    const margin = 48
    const page = doc.addPage(A4)
    const pageLogoW = 70
    const pageLogoH = pageLogoW * (logo.height / logo.width)
    page.drawImage(logo, {
      x: W - margin + 8 - pageLogoW,
      y: H - 12 - pageLogoH,
      width: pageLogoW,
      height: pageLogoH,
    })
    let y = H - 76
    drawTracked(page, inputs.terminType.toUpperCase(), margin, y, bold, 9, RED, 1.6)
    y -= 26
    page.drawText(inputs.drawingPage.title, { x: margin, y, size: 22, font: bold, color: BROWN })
    y -= 14
    page.drawLine({ start: { x: margin, y }, end: { x: W - margin, y }, thickness: 0.75, color: GREY })

    // Vorgezeichneter Wandquerschnitt, passend zum Baujahr (Yann, 10.09.2026).
    // Er steht oben links; rechts und darunter bleibt Platz, um von Hand
    // weiterzuzeichnen.
    if (inputs.drawingPage.zeichnung) {
      const bild = await embedBild(doc, inputs.drawingPage.zeichnung)
      const breite = 100
      const hoehe = breite * (bild.height / bild.width)
      page.drawImage(bild, { x: margin, y: y - 24 - hoehe, width: breite, height: hoehe })
    }

    // Legende als eine Zeile ganz unten (Yann, 09.09.2026): klein, waagerecht
    // und nur mit dem noetigsten Text, damit die Flaeche darueber vollstaendig
    // fuer den eingefuegten Grundriss frei bleibt. Je Gewerk ein Symbol in
    // seiner Farbe und der Kurzname; die Form kommt vom ersten Eintrag der
    // Gruppe (Balken, Flaeche oder Kreuz).
    const gruppen = inputs.drawingPage.legende
    if (gruppen.length > 0) {
      /**
       * Alle Masse haengen an der Schriftgroesse, damit das Verkleinern
       * wirklich Platz schafft: Bei festen Symbolbreiten brachte eine kleinere
       * Schrift kaum etwas, weil die Symbole den meisten Platz brauchen.
       */
      const masse = (g: number) => ({
        symbol: g * 1.7,
        zwischenSymbolen: g * 0.4,
        nachSymbol: g * 0.6,
        zwischenraum: g * 1.8,
      })
      /** Die Symbole einer Gruppe, ohne Wiederholung und in Reihenfolge. */
      const formenVon = (g: LegendenGruppe) => [...new Set(g.eintraege.map((e) => e.form))]
      const eintragBreite = (g: LegendenGruppe, groesse: number) => {
        const m = masse(groesse)
        const formen = formenVon(g).length
        return (
          formen * m.symbol +
          (formen - 1) * m.zwischenSymbolen +
          m.nachSymbol +
          regular.widthOfTextAtSize(toWinAnsi(g.kurz), groesse)
        )
      }
      const breiteBei = (groesse: number) =>
        gruppen.reduce((summe, g) => summe + eintragBreite(g, groesse), 0) +
        masse(groesse).zwischenraum * (gruppen.length - 1)

      // So gross wie moeglich, aber alles in einer Zeile. Erst wenn selbst
      // 5,5 pt nicht reichen (sehr viele Gewerke), wird umbrochen.
      let groesse = 8
      while (groesse > 5.5 && breiteBei(groesse) > W - 2 * margin) groesse -= 0.25
      const m = masse(groesse)

      const zeilen: LegendenGruppe[][] = []
      if (breiteBei(groesse) <= W - 2 * margin) {
        zeilen.push(gruppen)
      } else {
        let laufend: LegendenGruppe[] = []
        let breite = 0
        for (const g of gruppen) {
          const eigene = eintragBreite(g, groesse)
          if (laufend.length > 0 && breite + m.zwischenraum + eigene > W - 2 * margin) {
            zeilen.push(laufend)
            laufend = []
            breite = 0
          }
          breite += (laufend.length > 0 ? m.zwischenraum : 0) + eigene
          laufend.push(g)
        }
        if (laufend.length > 0) zeilen.push(laufend)
      }

      const zeilenHoehe = groesse + 7
      const unten = 34
      const trennlinie = unten + zeilen.length * zeilenHoehe + 6
      page.drawLine({
        start: { x: margin, y: trennlinie },
        end: { x: W - margin, y: trennlinie },
        thickness: 0.5,
        color: GREY,
      })

      zeilen.forEach((zeile, zi) => {
        const y = unten + (zeilen.length - 1 - zi) * zeilenHoehe
        const mitte = y + groesse / 2
        // Jede Zeile mittig, damit die Legende als Band unter der Zeichnung wirkt
        const breite =
          zeile.reduce((summe, g) => summe + eintragBreite(g, groesse), 0) +
          m.zwischenraum * (zeile.length - 1)
        let x = margin + Math.max(0, (W - 2 * margin - breite) / 2)
        for (const gruppe of zeile) {
          // Alle Formen der Gruppe zeigen, nicht nur die erste: Bei der
          // Innenabdichtung fehlte sonst das Quadrat fuer die Wandflaeche und
          // nur der Balken fuer den Grundriss stand da (Yann, 09.09.2026).
          for (const form of formenVon(gruppe)) {
            if (form === 'flaeche') {
              // Quadrat fuer die Flaeche: hell gefuellt mit farbigem Rand
              page.drawRectangle({
                x,
                y: mitte - groesse / 2,
                width: m.symbol,
                height: groesse,
                color: farbeVon(gruppe.farbe, 0.86),
                borderColor: farbeVon(gruppe.farbe),
                borderWidth: 0.7,
              })
            } else if (form === 'kreuz') {
              const strich = { thickness: groesse * 0.18, color: farbeVon(gruppe.farbe) }
              const r = groesse / 2
              page.drawLine({ start: { x: x + 2, y: mitte - r }, end: { x: x + m.symbol - 2, y: mitte + r }, ...strich })
              page.drawLine({ start: { x: x + 2, y: mitte + r }, end: { x: x + m.symbol - 2, y: mitte - r }, ...strich })
            } else {
              // Voller Balken fuer Grundriss und Querschnitt
              page.drawRectangle({
                x,
                y: mitte - groesse * 0.28,
                width: m.symbol,
                height: groesse * 0.56,
                color: farbeVon(gruppe.farbe),
              })
            }
            x += m.symbol + m.zwischenSymbolen
          }
          x += m.nachSymbol - m.zwischenSymbolen
          page.drawText(toWinAnsi(gruppe.kurz), {
            x,
            y: mitte - groesse / 2 + 1,
            size: groesse,
            font: regular,
            color: BROWN,
          })
          x += regular.widthOfTextAtSize(toWinAnsi(gruppe.kurz), groesse) + m.zwischenraum
        }
      })
    }
  }

  // ---------- Optionale Textseite (nur wenn ausgefuellt, direkt nach dem Deckblatt) ----------
  if (inputs.textPage) {
    const { title, inhalt, note } = inputs.textPage
    const margin = 48
    const textSize = 11
    const lineHeight = 17
    const bottomLimit = 70

    const newTextPage = (first: boolean) => {
      const page = doc.addPage(A4)
      const pageLogoW = 70
      const pageLogoH = pageLogoW * (logo.height / logo.width)
      page.drawImage(logo, {
        x: W - margin + 8 - pageLogoW,
        y: H - 12 - pageLogoH,
        width: pageLogoW,
        height: pageLogoH,
      })
      let y = H - 76
      if (first) {
        drawTracked(page, inputs.terminType.toUpperCase(), margin, y, bold, 9, RED, 1.6)
        y -= 26
        page.drawText(title, { x: margin, y, size: 22, font: bold, color: BROWN })
        y -= 14
        page.drawLine({
          start: { x: margin, y },
          end: { x: W - margin, y },
          thickness: 0.75,
          color: GREY,
        })
        y -= 28
      }
      return { page, y }
    }

    // Formatierter Text aus dem Textfenster. Fett, kursiv und unterstrichen
    // koennen mitten in der Zeile wechseln, deshalb traegt jedes Stueck seine
    // eigene Schrift und die Zeile wird aus einzelnen Teilen zusammengesetzt.
    const einzug = 16

    /** Ein Stueck Zeile mit fester Schrift: Wortteil oder Leerzeichen. */
    interface Teil {
      text: string
      font: PDFFont
      unterstrichen: boolean
      breite: number
    }
    /** Ein Wort, das nicht umbrochen werden darf; kann mehrere Schriften enthalten. */
    interface Wort {
      teile: Teil[]
      breite: number
      abstandDavor: boolean
    }

    const schriftFuer = (s: TextStueck): PDFFont =>
      s.fett ? (s.kursiv ? boldItalic : bold) : s.kursiv ? italic : regular

    const teilVon = (text: string, font: PDFFont, unterstrichen: boolean): Teil => ({
      text,
      font,
      unterstrichen,
      breite: font.widthOfTextAtSize(text, textSize),
    })

    const worteVon = (stuecke: TextStueck[], maxBreite: number): Wort[] => {
      const worte: Wort[] = []
      let teile: Teil[] = []
      let abstand = false
      const wortAbschliessen = () => {
        if (teile.length === 0) return
        worte.push({
          teile,
          breite: teile.reduce((summe, t) => summe + t.breite, 0),
          abstandDavor: abstand,
        })
        teile = []
        abstand = false
      }
      for (const stueck of stuecke) {
        const font = schriftFuer(stueck)
        for (const zeichenfolge of toWinAnsi(stueck.text).split(/( )/)) {
          if (zeichenfolge === '') continue
          if (zeichenfolge === ' ') {
            wortAbschliessen()
            abstand = true
            continue
          }
          // Ueberlange Woerter (etwa Dateinamen ohne Leerzeichen) hart trennen
          let rest = zeichenfolge
          while (font.widthOfTextAtSize(rest, textSize) > maxBreite && rest.length > 1) {
            let schnitt = rest.length - 1
            while (schnitt > 1 && font.widthOfTextAtSize(rest.slice(0, schnitt), textSize) > maxBreite) {
              schnitt--
            }
            teile.push(teilVon(rest.slice(0, schnitt), font, stueck.unterstrichen))
            wortAbschliessen()
            rest = rest.slice(schnitt)
          }
          teile.push(teilVon(rest, font, stueck.unterstrichen))
        }
      }
      wortAbschliessen()
      return worte
    }

    let { page, y } = newTextPage(true)

    /**
     * Abstand zwischen zwei Absaetzen (Yann, 09.09.2026: Absaetze sollen im
     * Dokument sichtbar sein). Ohne ihn stehen zwei Absaetze wie fortlaufende
     * Zeilen untereinander und der Wechsel geht unter. Aufeinanderfolgende
     * Aufzaehlungspunkte gehoeren zusammen und bekommen keinen.
     */
    const zeichneAbsatz = (absatz: TextAbsatz, vorheriger: TextAbsatz | null) => {
      const linkerRand = margin + (absatz.art === 'punkt' ? einzug : 0)
      const maxBreite = W - margin - linkerRand
      const worte = worteVon(absatz.stuecke, maxBreite)
      if (worte.length === 0) {
        // Ausdrueckliche Leerzeile: volle Zeilenhoehe, damit mehrere
        // Leerzeilen auch als groesserer Abstand ankommen.
        y -= lineHeight
        return
      }
      const vorherLeer = vorheriger !== null && vorheriger.stuecke.length === 0
      const beidePunkte = vorheriger?.art === 'punkt' && absatz.art === 'punkt'
      if (vorheriger && !vorherLeer && !beidePunkte) y -= lineHeight * 0.45

      let zeile: Teil[] = []
      let breite = 0
      let ersteZeile = true

      const zeileZeichnen = () => {
        if (zeile.length === 0) return
        if (y < bottomLimit) {
          ;({ page, y } = newTextPage(false))
        }
        let x = linkerRand
        if (absatz.art === 'punkt' && ersteZeile) {
          page.drawText('•', { x: margin + 3, y, size: textSize, font: regular, color: BROWN })
        }
        // Der Unterstrich wird als durchgehende Linie gezogen, auch ueber
        // Leerzeichen hinweg - sonst zerfaellt er in einzelne Stuecke.
        let strichAb: number | null = null
        for (const teil of zeile) {
          if (teil.unterstrichen && strichAb === null) strichAb = x
          if (!teil.unterstrichen && strichAb !== null) {
            page.drawLine({
              start: { x: strichAb, y: y - 2 },
              end: { x, y: y - 2 },
              thickness: 0.6,
              color: BROWN,
            })
            strichAb = null
          }
          if (teil.text !== ' ') {
            page.drawText(teil.text, { x, y, size: textSize, font: teil.font, color: BROWN })
          }
          x += teil.breite
        }
        if (strichAb !== null) {
          page.drawLine({
            start: { x: strichAb, y: y - 2 },
            end: { x, y: y - 2 },
            thickness: 0.6,
            color: BROWN,
          })
        }
        y -= lineHeight
        ersteZeile = false
        zeile = []
        breite = 0
      }

      for (const wort of worte) {
        const vorheriges = zeile[zeile.length - 1]
        const leerzeichen =
          wort.abstandDavor && zeile.length > 0
            ? teilVon(
                ' ',
                wort.teile[0].font,
                wort.teile[0].unterstrichen && (vorheriges?.unterstrichen ?? false),
              )
            : null
        if (zeile.length > 0 && breite + (leerzeichen?.breite ?? 0) + wort.breite > maxBreite) {
          zeileZeichnen()
        }
        if (zeile.length > 0 && leerzeichen) {
          zeile.push(leerzeichen)
          breite += leerzeichen.breite
        }
        zeile.push(...wort.teile)
        breite += wort.breite
      }
      zeileZeichnen()
    }

    inhalt.forEach((absatz, i) => zeichneAbsatz(absatz, i > 0 ? inhalt[i - 1] : null))

    // Vermerk am Ende (wer, wann)
    const noteLines = wrapText(toWinAnsi(note), italic, 10, W - 2 * margin)
    const noteHeight = 24 + noteLines.length * 15
    if (y - noteHeight < 40) {
      ;({ page, y } = newTextPage(false))
    }
    y -= 8
    page.drawLine({
      start: { x: margin, y },
      end: { x: W - margin, y },
      thickness: 0.5,
      color: GREY,
    })
    y -= 20
    for (const line of noteLines) {
      page.drawText(line, { x: margin, y, size: 10, font: italic, color: BROWN })
      y -= 15
    }
  }

  // ---------- Fotoseiten: exakt 1 Foto pro Seite ----------
  // Jedes Foto wird erst hier geladen und nach dem Einbetten wieder freigegeben.
  const margin = 40
  const footerH = 32
  // Der Hinweis liegt zwischen Bild und Fusszeile; das Bild bekommt entsprechend
  // weniger Hoehe, damit sich nichts ueberdeckt.
  const hinweisText = inputs.fotoHinweis?.trim() ? toWinAnsi(inputs.fotoHinweis.trim()) : null
  const hinweisKastenH = 18
  const platzUnten = footerH + (hinweisText ? hinweisKastenH + 8 : 0)
  const footers: Array<{ page: PDFPage; takenAt: number | null; isDuplicate: boolean }> = []

  for (let i = 0; i < inputs.photoCount; i++) {
    const photo = await inputs.loadPhoto(i)
    onProgress?.(i + 1, inputs.photoCount)
    if (!photo) continue // nicht lesbar - Seite wird uebersprungen

    const page = doc.addPage(A4)
    const pageLogoW = 70
    const pageLogoH = pageLogoW * (logo.height / logo.width)
    page.drawImage(logo, {
      x: W - margin - pageLogoW,
      y: H - 12 - pageLogoH,
      width: pageLogoW,
      height: pageLogoH,
    })

    const img = await embed(doc, photo.image)
    const { w, h } = fitInto(img.width, img.height, W - 2 * margin, H - 2 * margin - platzUnten)
    const x = (W - w) / 2
    const y = platzUnten + margin + (H - 2 * margin - platzUnten - h) / 2
    page.drawImage(img, { x, y, width: w, height: h })

    footers.push({ page, takenAt: photo.takenAt, isDuplicate: photo.isDuplicate })
  }

  // Fusszeilen erst jetzt zeichnen - dann stimmt "Foto X / N" auch, wenn
  // einzelne Fotos uebersprungen wurden.
  const total = footers.length
  // Der Hinweis steht auf jeder Bildseite gleich: kleiner Kasten mit rotem
  // Rand ueber der Fusszeile, Text mittig.
  let hinweisGroesse = 8.5
  if (hinweisText) {
    while (hinweisGroesse > 6 && bold.widthOfTextAtSize(hinweisText, hinweisGroesse) > W - 2 * margin - 20) {
      hinweisGroesse -= 0.25
    }
  }
  footers.forEach((f, idx) => {
    if (hinweisText) {
      const kastenY = footerH + 8
      f.page.drawRectangle({
        x: margin,
        y: kastenY,
        width: W - 2 * margin,
        height: hinweisKastenH,
        borderColor: RED,
        borderWidth: 0.9,
      })
      const breite = bold.widthOfTextAtSize(hinweisText, hinweisGroesse)
      f.page.drawText(hinweisText, {
        x: (W - breite) / 2,
        y: kastenY + (hinweisKastenH - hinweisGroesse) / 2 + 1.5,
        size: hinweisGroesse,
        font: bold,
        color: RED,
      })
    }
    f.page.drawLine({
      start: { x: margin, y: footerH },
      end: { x: W - margin, y: footerH },
      thickness: 0.5,
      color: GREY,
    })
    let label = `Foto ${idx + 1} / ${total}`
    if (f.isDuplicate) label += '  -  Duplikat'
    f.page.drawText(label, { x: margin, y: footerH - 15, size: 9, font: regular, color: BROWN })
    if (f.takenAt != null) {
      const dateText = formatDateTime(f.takenAt)
      const dw = regular.widthOfTextAtSize(dateText, 9)
      f.page.drawText(dateText, {
        x: W - margin - dw,
        y: footerH - 15,
        size: 9,
        font: regular,
        color: BROWN,
      })
    }
  })

  return doc.save()
}
