export interface OrientedImage {
  source: CanvasImageSource
  width: number
  height: number
  cleanup: () => void
}

export interface OptimizedImage {
  bytes: Uint8Array
  width: number
  height: number
  format: 'jpeg' | 'png'
}

export interface OptimizeOptions {
  /** Maximale Kantenlaenge in px; es wird nie hochskaliert. */
  maxEdge: number
  /** JPEG-Qualitaet 0..1 */
  quality: number
  /** MIME-Typ der Originaldatei; PNG mit Transparenz bleibt PNG. */
  sourceType?: string
}

function loadImageElement(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Bild konnte nicht dekodiert werden'))
    }
    img.src = url
  })
}

/** Setzt die Canvas-Transformation fuer eine EXIF-Orientation (2-8). */
function applyOrientation(
  ctx: CanvasRenderingContext2D,
  orientation: number,
  w: number,
  h: number,
): void {
  switch (orientation) {
    case 2:
      ctx.transform(-1, 0, 0, 1, w, 0)
      break
    case 3:
      ctx.transform(-1, 0, 0, -1, w, h)
      break
    case 4:
      ctx.transform(1, 0, 0, -1, 0, h)
      break
    case 5:
      ctx.transform(0, 1, 1, 0, 0, 0)
      break
    case 6:
      ctx.transform(0, 1, -1, 0, h, 0)
      break
    case 7:
      ctx.transform(0, -1, -1, 0, h, w)
      break
    case 8:
      ctx.transform(0, -1, 1, 0, 0, w)
      break
  }
}

/** Wendet eine EXIF-Orientation (2-8) manuell auf ein <img> an. */
function orientOnCanvas(img: HTMLImageElement, orientation: number): HTMLCanvasElement {
  const w = img.naturalWidth
  const h = img.naturalHeight
  const swap = orientation >= 5 && orientation <= 8
  const canvas = document.createElement('canvas')
  canvas.width = swap ? h : w
  canvas.height = swap ? w : h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas-Kontext nicht verfuegbar')
  applyOrientation(ctx, orientation, w, h)
  ctx.drawImage(img, 0, 0)
  return canvas
}

/**
 * Dekodiert ein Bild bereits korrekt orientiert - mit drei Stufen, damit ein
 * einzelnes sperriges Bild (oder Speicherdruck bei vielen Fotos) nicht sofort
 * zum Abbruch fuehrt.
 */
export async function loadOriented(blob: Blob, orientation: number): Promise<OrientedImage> {
  // 1) Bevorzugt: Browser wendet die EXIF-Orientation beim Dekodieren an
  try {
    const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' })
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      cleanup: () => bitmap.close(),
    }
  } catch {
    // naechster Versuch
  }

  // 2) Bitmap ohne Orientierungs-Option (manche Browser/Bilder scheitern nur an der Option),
  //    Orientation danach selbst anwenden
  try {
    const bitmap = await createImageBitmap(blob)
    if (orientation <= 1) {
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        cleanup: () => bitmap.close(),
      }
    }
    const swap = orientation >= 5 && orientation <= 8
    const canvas = document.createElement('canvas')
    canvas.width = swap ? bitmap.height : bitmap.width
    canvas.height = swap ? bitmap.width : bitmap.height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas-Kontext nicht verfuegbar')
    applyOrientation(ctx, orientation, bitmap.width, bitmap.height)
    ctx.drawImage(bitmap, 0, 0)
    bitmap.close()
    return { source: canvas, width: canvas.width, height: canvas.height, cleanup: () => {} }
  } catch {
    // letzter Versuch unten
  }

  // 3) Klassisch ueber ein <img>-Element
  const img = await loadImageElement(blob)
  if (orientation <= 1) {
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, cleanup: () => {} }
  }
  const canvas = orientOnCanvas(img, orientation)
  return { source: canvas, width: canvas.width, height: canvas.height, cleanup: () => {} }
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Bild konnte nicht kodiert werden'))),
      type,
      quality,
    )
  })
}

/** Prueft stichprobenartig, ob der Canvas transparente Pixel enthaelt. */
function canvasHasAlpha(ctx: CanvasRenderingContext2D, width: number, height: number): boolean {
  const step = Math.max(1, Math.floor(Math.max(width, height) / 64))
  const data = ctx.getImageData(0, 0, width, height).data
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      if (data[(y * width + x) * 4 + 3] < 255) return true
    }
  }
  return false
}

/**
 * Downscale + Rekompression fuer die PDF-Einbettung.
 * Fotos werden als JPEG kodiert; nur PNGs mit echter Transparenz bleiben PNG.
 */
export async function optimizeImage(
  oriented: OrientedImage,
  opts: OptimizeOptions,
): Promise<OptimizedImage> {
  const scale = Math.min(1, opts.maxEdge / Math.max(oriented.width, oriented.height))
  const width = Math.max(1, Math.round(oriented.width * scale))
  const height = Math.max(1, Math.round(oriented.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas-Kontext nicht verfuegbar')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(oriented.source, 0, 0, width, height)

  let format: 'jpeg' | 'png' = 'jpeg'
  if (opts.sourceType === 'image/png' && canvasHasAlpha(ctx, width, height)) {
    format = 'png'
  }
  if (format === 'jpeg') {
    // JPEG kennt keine Transparenz: weiss hinterlegen
    ctx.globalCompositeOperation = 'destination-over'
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, height)
    ctx.globalCompositeOperation = 'source-over'
  }
  const blob = await canvasToBlob(
    canvas,
    format === 'png' ? 'image/png' : 'image/jpeg',
    opts.quality,
  )
  return { bytes: new Uint8Array(await blob.arrayBuffer()), width, height, format }
}

/**
 * Verkleinert einen Blob auf maxEdge und liefert ihn als JPEG-Blob zurueck.
 * Wird nach der HEIC-Konvertierung genutzt, damit nicht das JPEG in voller
 * Aufloesung im Speicher gehalten wird.
 */
export async function downscaleToJpegBlob(
  blob: Blob,
  orientation: number,
  maxEdge: number,
  quality: number,
): Promise<Blob> {
  const oriented = await loadOriented(blob, orientation)
  try {
    const out = await optimizeImage(oriented, { maxEdge, quality })
    return new Blob([out.bytes as BlobPart], { type: 'image/jpeg' })
  } finally {
    oriented.cleanup()
  }
}

/** Runder Center-Crop mit transparentem Hintergrund (PNG), fuer das Deckblatt. */
export async function optimizeCircle(
  blob: Blob,
  orientation: number,
  size: number,
): Promise<OptimizedImage> {
  const oriented = await loadOriented(blob, orientation)
  try {
    const side = Math.min(oriented.width, oriented.height)
    const sx = (oriented.width - side) / 2
    const sy = (oriented.height - side) / 2
    const target = Math.max(1, Math.min(size, side))
    const canvas = document.createElement('canvas')
    canvas.width = target
    canvas.height = target
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas-Kontext nicht verfuegbar')
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.beginPath()
    ctx.arc(target / 2, target / 2, target / 2, 0, Math.PI * 2)
    ctx.closePath()
    ctx.clip()
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, target, target)
    ctx.drawImage(oriented.source, sx, sy, side, side, 0, 0, target, target)
    const out = await canvasToBlob(canvas, 'image/png')
    return { bytes: new Uint8Array(await out.arrayBuffer()), width: target, height: target, format: 'png' }
  } finally {
    oriented.cleanup()
  }
}

/** Kleines Vorschaubild als Object-URL (Aufrufer muss revokeObjectURL aufrufen). */
export async function makeThumbnailUrl(
  blob: Blob,
  orientation: number,
  maxEdge = 240,
): Promise<string> {
  const oriented = await loadOriented(blob, orientation)
  try {
    const scale = Math.min(1, maxEdge / Math.max(oriented.width, oriented.height))
    const width = Math.max(1, Math.round(oriented.width * scale))
    const height = Math.max(1, Math.round(oriented.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas-Kontext nicht verfuegbar')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, height)
    ctx.drawImage(oriented.source, 0, 0, width, height)
    const out = await canvasToBlob(canvas, 'image/jpeg', 0.75)
    return URL.createObjectURL(out)
  } finally {
    oriented.cleanup()
  }
}
