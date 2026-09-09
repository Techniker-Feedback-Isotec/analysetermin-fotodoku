import { PDFDocument, StandardFonts } from 'pdf-lib'
import logoUrl from '../assets/isotec-logo.png'
import type { DeckblattBild } from '../lib/deckblatt'
import {
  KAPITEL_VARIANTEN,
  TRENNBLATT_VARIANTEN,
  type KapitelDaten,
  type Schriften,
  type TrennblattDaten,
} from './varianten'

/**
 * Wegwerf-Vorschauseite fuer die Entwuerfe der Angebotsmappe (Yann,
 * 09.09.2026: erst auf einem eigenen localhost ansehen, dann einbauen).
 * Laeuft unter /mappe-vorschau.html und wird nach der Entscheidung geloescht.
 */

const ziel = document.getElementById('ziel')!

async function pdfUrl(zeichne: (doc: PDFDocument, s: Schriften) => Promise<void>): Promise<string> {
  const doc = await PDFDocument.create()
  const schriften: Schriften = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
  }
  await zeichne(doc, schriften)
  const bytes = await doc.save()
  return URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }))
}

function abschnitt(titel: string, hinweis: string, gross = false) {
  const h2 = document.createElement('h2')
  h2.textContent = titel
  const p = document.createElement('p')
  p.className = 'hinweis'
  p.textContent = hinweis
  const reihe = document.createElement('div')
  reihe.className = gross ? 'reihe ganz' : 'reihe'
  ziel.append(h2, p, reihe)
  return reihe
}

function karte(reihe: HTMLElement, name: string, url: string) {
  const k = document.createElement('div')
  k.className = 'karte'
  const h3 = document.createElement('h3')
  h3.textContent = name
  const rahmen = document.createElement('iframe')
  rahmen.src = `${url}#toolbar=0&navpanes=0&view=Fit`
  k.append(h3, rahmen)
  reihe.append(k)
}

async function los() {
  const logo: DeckblattBild = {
    bytes: new Uint8Array(await (await fetch(logoUrl)).arrayBuffer()),
    format: 'png',
  }

  ziel.textContent = ''

  const trennDaten: TrennblattDaten = {
    nummer: 2,
    titel: 'Prinzipskizze',
    unterzeile: '4 Seiten',
    logo,
  }
  const reihe1 = abschnitt(
    '1. Trennblatt zwischen den Unterlagen',
    'Statt des bisherigen Deckblatts mit Objektfoto steht künftig vor jeder Unterlage nur eine Überschriftsseite. Gezeigt am Beispiel "Teil 2, Prinzipskizze".',
  )
  for (const v of Object.values(TRENNBLATT_VARIANTEN)) {
    karte(reihe1, v.name, await pdfUrl((doc, s) => v.zeichne(doc, s, trennDaten)))
  }

  const kapitelDaten: KapitelDaten = { logo }
  const reihe2 = abschnitt(
    '2. Kapitel "Warum ISOTEC" am Anfang der Mappe',
    'Inhalt aus deinem Vault (Angebot.md, ICP.md): 30 Jahre, 10 Jahre Gewährleistung, WTA-geprüfte Verfahren, Analyse durch den Bausachverständigen, eigene Techniker, saubere Baustelle. Texte stehen in src/mappe/inhalt.ts und sind schnell geändert.',
    true,
  )
  for (const v of Object.values(KAPITEL_VARIANTEN)) {
    karte(reihe2, v.name, await pdfUrl((doc, s) => v.zeichne(doc, s, kapitelDaten)))
  }
}

void los().catch((fehler) => {
  ziel.innerHTML = `<p class="lade">Fehler: ${String(fehler)}</p>`
})
