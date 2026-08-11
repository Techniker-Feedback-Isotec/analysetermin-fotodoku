import teamJpgUrl from '../assets/team.jpg'
import logoPngUrl from '../assets/isotec-logo.png'

/**
 * Deckblatt als Einzelbild, dem Video vorangestellt.
 *
 * Es fuellt das Bild randlos aus: Teamfoto ueber die ganze Flaeche, darauf ein
 * rotes Band und ein brauner Balken mit den Termindaten. Grund ist die Kachel
 * in MeisterTask, SharePoint und im Explorer - ein Deckblatt mit viel Weiss
 * sieht dort aus wie eine leere Kachel, ein randfuellendes Bild nicht.
 *
 * Aufbau, Farben und Reihenfolge entsprechen dem Deckblatt der
 * Fotodokumentation, nur ohne Objektfoto.
 */

// ISOTEC-Farben (Corporate Design Handbuch 2.0)
const RED = '#d51317'
const BROWN = '#564a44'
const WHITE = '#ffffff'

const FONT = "'Segoe UI', system-ui, -apple-system, Helvetica, Arial, sans-serif"

export interface CoverData {
  /** Analysetermin / Reklamation / Baustellenbesuch */
  terminart: string
  mitarbeiter: string
  /** Foto-URL des Mitarbeiters, sonst null (dann Initialen) */
  mitarbeiterFoto: string | null
  kunde: string
  objektadresse: string
  auftragsnummer: string
  /** Fertig formatiertes Termindatum, z. B. "Dienstag, 11. August 2026" */
  datumText: string
}

const imageCache = new Map<string, Promise<HTMLImageElement>>()

function loadImage(url: string): Promise<HTMLImageElement> {
  const cached = imageCache.get(url)
  if (cached) return cached
  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error(`Bild konnte nicht geladen werden: ${url}`))
    image.src = url
  })
  imageCache.set(url, promise)
  return promise
}

function initialsOf(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .map((part) => part[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

/** Zeichnet ein Bild formatfuellend in ein Rechteck (wie CSS object-fit: cover). */
function drawImageCover(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight)
  const w = image.naturalWidth * scale
  const h = image.naturalHeight * scale
  ctx.drawImage(image, x + (width - w) / 2, y + (height - h) / 2, w, h)
}

/** Text mit Buchstaben-Sperrung (Canvas kennt kein zuverlaessiges letter-spacing). */
function drawTracked(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, tracking: number): void {
  let cursor = x
  for (const char of text) {
    ctx.fillText(char, cursor, y)
    cursor += ctx.measureText(char).width + tracking
  }
}

/** Verkleinert die Schrift so lange, bis der Text in die Breite passt. */
function fitFontSize(
  ctx: CanvasRenderingContext2D,
  text: string,
  weight: string,
  startSize: number,
  maxWidth: number,
  minSize: number,
): void {
  let size = startSize
  while (size > minSize) {
    ctx.font = `${weight} ${size}px ${FONT}`
    if (ctx.measureText(text).width <= maxWidth) return
    size -= 1
  }
  ctx.font = `${minSize}px ${FONT}`
  ctx.font = `${weight} ${minSize}px ${FONT}`
}

const KICKER = 'ABDICHTUNGSTECHNIK DIPL.-ING. MORSCHECK GMBH'

/**
 * Zeichnet das Deckblatt in der Groesse des Zielvideos. Hoch- und Querformat
 * werden gleich behandelt: Alle Masse haengen an der kuerzeren Kante, und die
 * Hoehe des Textbalkens ergibt sich aus dem, was tatsaechlich drinsteht.
 */
export async function renderCover(width: number, height: number, data: CoverData): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Deckblatt konnte nicht gezeichnet werden.')
  ctx.textBaseline = 'alphabetic'

  const lines: Array<{ text: string; weight: string; size: number }> = []
  if (data.kunde) lines.push({ text: `Kunde: ${data.kunde}`, weight: '400', size: 3 })
  if (data.objektadresse) lines.push({ text: `Objekt: ${data.objektadresse}`, weight: '400', size: 3 })
  if (data.auftragsnummer) lines.push({ text: `Auftragsnummer: ${data.auftragsnummer}`, weight: '400', size: 3 })
  if (data.datumText) lines.push({ text: `Termin: ${data.datumText}`, weight: '400', size: 3 })

  // Hoehe des Balkens aus dem Inhalt berechnen, danach die Masse so stauchen,
  // dass er nie mehr als zwei Drittel des Bildes einnimmt (wichtig im
  // Querformat, wo deutlich weniger Hoehe zur Verfuegung steht).
  const nameLine = data.mitarbeiter ? 1 : 0
  /** Durchmesser des Mitarbeiterfotos oben rechts */
  const CIRCLE_UNITS = 16
  /** Platz, den das Logo unten rechts braucht */
  const LOGO_UNITS = 10
  const textUnits = 6 + 7 + 4 + 4 + nameLine * 5.4 + lines.length * 4.4
  const heightInUnits = Math.max(textUnits + LOGO_UNITS + 5, 4 + CIRCLE_UNITS + 4 + LOGO_UNITS + 5)
  const base = Math.min(width, height) / 100
  // Im Querformat ist Hoehe knapp: Der Balken bekommt weniger, damit vom
  // Teamfoto noch etwas zu sehen ist.
  const maxPanel = height * (width > height ? 0.58 : 0.62)
  const unit = Math.min(base, maxPanel / heightInUnits)
  const panelHeight = heightInUnits * unit
  const panelTop = height - panelHeight

  const margin = 6 * unit
  const contentWidth = width - 2 * margin

  // ---------- Teamfoto ueber die ganze Flaeche ----------
  try {
    const team = await loadImage(teamJpgUrl)
    drawImageCover(ctx, team, 0, 0, width, height)
  } catch {
    ctx.fillStyle = BROWN
    ctx.fillRect(0, 0, width, height)
  }

  // ---------- Rotes Band und brauner Balken ----------
  const bandHeight = Math.max(3, 1.6 * unit)
  ctx.fillStyle = RED
  ctx.fillRect(0, panelTop - bandHeight, width, bandHeight)
  ctx.fillStyle = 'rgba(86, 74, 68, 0.94)'
  ctx.fillRect(0, panelTop, width, panelHeight)

  // ---------- Oben rechts: rundes Mitarbeiterfoto ----------
  // Steht neben dem Titel statt unten in der Ecke - dort geht es im kleinen
  // Vorschaubild unter.
  const circleSize = CIRCLE_UNITS * unit
  const circleTop = panelTop + 4 * unit
  const circleLeft = width - margin - circleSize
  const circleBottom = circleTop + circleSize
  if (data.mitarbeiter) await drawPortrait(ctx, data, circleLeft, circleTop, circleSize, unit)

  /** Textbreite: neben dem Foto schmaler, darunter wieder voll. */
  const widthAt = (baseline: number) =>
    data.mitarbeiter && baseline > circleTop && baseline - 4 * unit < circleBottom
      ? contentWidth - circleSize - 3 * unit
      : contentWidth

  // ---------- Titelblock ----------
  let cursor = panelTop + 6 * unit
  fitFontSize(ctx, KICKER, '700', 2 * unit, widthAt(cursor) * 0.98, 1.2 * unit)
  ctx.fillStyle = 'rgba(255, 255, 255, 0.75)'
  drawTracked(ctx, KICKER, margin, cursor, 2 * unit * 0.14)

  cursor += 7 * unit
  fitFontSize(ctx, data.terminart, '700', 7.5 * unit, widthAt(cursor), 3.5 * unit)
  ctx.fillStyle = WHITE
  ctx.fillText(data.terminart, margin, cursor)

  cursor += 4 * unit
  ctx.font = `400 ${3.4 * unit}px ${FONT}`
  ctx.fillStyle = 'rgba(255, 255, 255, 0.7)'
  ctx.fillText('Videodokumentation', margin, cursor)

  // ---------- Infoblock ----------
  cursor += 4 * unit
  if (data.mitarbeiter) {
    cursor += 5.4 * unit
    fitFontSize(ctx, data.mitarbeiter, '700', 3.8 * unit, widthAt(cursor), 2 * unit)
    ctx.fillStyle = WHITE
    ctx.fillText(data.mitarbeiter, margin, cursor - 1.4 * unit)
  }
  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)'
  for (const line of lines) {
    cursor += 4.4 * unit
    fitFontSize(ctx, line.text, line.weight, line.size * unit, widthAt(cursor), 2 * unit)
    ctx.fillText(line.text, margin, cursor - 1.2 * unit)
  }

  // ---------- Unten rechts: ISOTEC-Logo auf weisser Flaeche ----------
  try {
    const logo = await loadImage(logoPngUrl)
    const logoWidth = Math.min(26 * unit, contentWidth * 0.45)
    const logoHeight = logoWidth * (logo.naturalHeight / logo.naturalWidth)
    const pad = 1.8 * unit
    const boxX = width - margin - logoWidth - pad
    const boxY = height - 5 * unit - logoHeight - pad
    ctx.fillStyle = WHITE
    roundedRect(ctx, boxX, boxY, logoWidth + 2 * pad, logoHeight + 2 * pad, 1.5 * unit)
    ctx.fill()
    ctx.drawImage(logo, boxX + pad, boxY + pad, logoWidth, logoHeight)
  } catch {
    // Ohne Logo ist das Deckblatt immer noch brauchbar.
  }

  return canvas
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + width, y, x + width, y + height, radius)
  ctx.arcTo(x + width, y + height, x, y + height, radius)
  ctx.arcTo(x, y + height, x, y, radius)
  ctx.arcTo(x, y, x + width, y, radius)
  ctx.closePath()
}

/** Rundes Mitarbeiterfoto mit rotem Ring, sonst Initialen. */
async function drawPortrait(
  ctx: CanvasRenderingContext2D,
  data: CoverData,
  circleX: number,
  circleY: number,
  circleSize: number,
  unit: number,
): Promise<void> {
  const radius = circleSize / 2
  ctx.save()
  ctx.beginPath()
  ctx.arc(circleX + radius, circleY + radius, radius, 0, Math.PI * 2)
  ctx.closePath()
  ctx.clip()
  // Immer erst weiss fuellen: Die Fotos sind vor weissem Hintergrund
  // aufgenommen, so wirkt der Kreis wie ausgeschnitten und nicht wie ein
  // dunkler Fleck auf dem braunen Balken.
  ctx.fillStyle = WHITE
  ctx.fillRect(circleX, circleY, circleSize, circleSize)
  let drawn = false
  if (data.mitarbeiterFoto) {
    try {
      const photo = await loadImage(data.mitarbeiterFoto)
      drawImageCover(ctx, photo, circleX, circleY, circleSize, circleSize)
      drawn = true
    } catch {
      drawn = false
    }
  }
  ctx.restore()

  if (!drawn) {
    const initials = initialsOf(data.mitarbeiter) || '?'
    ctx.fillStyle = RED
    ctx.font = `700 ${circleSize * 0.36}px ${FONT}`
    const textWidth = ctx.measureText(initials).width
    ctx.fillText(initials, circleX + (circleSize - textWidth) / 2, circleY + circleSize * 0.62)
  }

  ctx.strokeStyle = RED
  ctx.lineWidth = Math.max(2, 0.35 * unit)
  ctx.beginPath()
  ctx.arc(circleX + radius, circleY + radius, radius - ctx.lineWidth / 2, 0, Math.PI * 2)
  ctx.stroke()
}

/** Nur zur Vorschau in der Oberflaeche. */
export const PREVIEW_SIZE = { width: 360, height: 640 }
