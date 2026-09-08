/**
 * Demo-Bilder fuer den Schnelltest ohne API-Schluessel.
 *
 * Wird die Seite mit #demo geoeffnet, erscheint ein fertiges Beispiel-Foto
 * (gemalte Kellerwand mit Flecken -> weisse Wand), damit sich Regler und
 * Grossansicht sofort ausprobieren lassen.
 */

function male(nachher: boolean, variante = 0, bodenHellgrau = false): Promise<Blob> {
  const hochkant = variante % 2 === 1
  const b = hochkant ? 900 : 1200
  const h = hochkant ? 1200 : 900
  const canvas = document.createElement('canvas')
  canvas.width = b
  canvas.height = h
  const ctx = canvas.getContext('2d')!

  // Wand, je Variante leicht anderer Ton, damit sich die Beispiele unterscheiden
  const toene = ['#9d8f7f', '#8f8578', '#a2917d']
  ctx.fillStyle = nachher ? '#f2efe9' : toene[variante % toene.length]
  ctx.fillRect(0, 0, b, h)

  if (!nachher) {
    // Feuchteflecken und Ausbluehungen
    for (let i = 0; i < 26; i++) {
      const x = ((i * 197 + variante * 89) % b) + 20
      const y = ((i * 131 + variante * 57) % (h - 320)) + 40
      const r = 40 + ((i * 53 + variante * 31) % 110)
      const grad = ctx.createRadialGradient(x, y, 4, x, y, r)
      grad.addColorStop(0, 'rgba(70, 55, 40, 0.55)')
      grad.addColorStop(1, 'rgba(70, 55, 40, 0)')
      ctx.fillStyle = grad
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.fillStyle = 'rgba(230, 228, 215, 0.5)'
    for (let i = 0; i < 14; i++) {
      const x = ((i * 311) % b) + 10
      ctx.fillRect(x, h - 420 + ((i * 61) % 120), 26 + ((i * 17) % 60), 8)
    }
  } else {
    // leichte Putzstruktur
    ctx.fillStyle = 'rgba(0, 0, 0, 0.025)'
    for (let i = 0; i < 300; i++) {
      ctx.fillRect((i * 97) % b, (i * 71) % (h - 260), 3, 3)
    }
  }

  // Boden: bleibt gleich, ausser in der Variante "Boden sanieren" (hellgrau beschichtet)
  if (nachher && bodenHellgrau) {
    ctx.fillStyle = '#cfcbc4'
    ctx.fillRect(0, h - 240, b, 240)
  } else {
    ctx.fillStyle = '#6e675f'
    ctx.fillRect(0, h - 240, b, 240)
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.25)'
    ctx.lineWidth = 3
    for (let x = 0; x < b; x += 150) {
      ctx.beginPath()
      ctx.moveTo(x, h - 240)
      ctx.lineTo(x - 60, h)
      ctx.stroke()
    }
  }

  // Rohr an der Decke bleibt ebenfalls
  ctx.fillStyle = nachher ? '#b9b4ac' : '#7c7268'
  ctx.fillRect(0, 40, b, 34)
  ctx.fillStyle = 'rgba(0, 0, 0, 0.2)'
  ctx.fillRect(0, 66, b, 8)

  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob!), 'image/jpeg', 0.9))
}

export async function demoBilder(
  variante = 0,
  bodenHellgrau = false,
): Promise<{ vorher: Blob; nachher: Blob }> {
  return { vorher: await male(false, variante), nachher: await male(true, variante, bodenHellgrau) }
}
