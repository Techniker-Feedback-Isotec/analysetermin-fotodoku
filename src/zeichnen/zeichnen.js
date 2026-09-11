// Zeichenlogik: ein Markup-Objekt auf ein Canvas bringen, Trefferpruefung,
// Verschieben und Skalieren. Alle Koordinaten stehen in PDF-Punkten, das
// Canvas ist vorher passend skaliert. Damit sieht der Export exakt so aus
// wie die Ansicht.
//
// Objekttypen:
//   line   Gerade, wahlweise mit Pfeilspitzen an beiden Enden (Balken, Masslinie)
//   poly   Geschlossenes Polygon mit Fuellung (Wandflaeche, Abdeckung)
//   rect   Rechteck mit Fuellung (Abdeckung)
//   text   Textzeilen in Arial
//   callout Textfeld mit Pfeil auf einen Zielpunkt, Text bricht an der Feldbreite um
//   kreuz  Wanddurchbruch
//   img    Eingesetztes Foto

const PFEIL = 3.2; // Faktor Pfeilspitze zur Strichstaerke
export const POLSTER = 4;  // Innenabstand im Textfeld

function setzeStil(ctx, it) {
  ctx.globalAlpha = it.o ?? 1;
  ctx.strokeStyle = it.c || '#000';
  ctx.fillStyle = it.c || '#000';
  ctx.lineWidth = it.w || 1;
  ctx.lineCap = it.cap || 'round';
  ctx.lineJoin = 'miter'; // harte Ecken bei Polygonen und Rechtecken
  ctx.setLineDash([]);
}

function pfeilspitze(ctx, x1, y1, x2, y2, w) {
  const winkel = Math.atan2(y2 - y1, x2 - x1);
  const l = Math.max(7, w * PFEIL);
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - l * Math.cos(winkel - 0.4), y2 - l * Math.sin(winkel - 0.4));
  ctx.lineTo(x2 - l * Math.cos(winkel + 0.4), y2 - l * Math.sin(winkel + 0.4));
  ctx.closePath();
  ctx.fill();
}

function pfadZiehen(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
}

export function inPolygon(px, py, pts) {
  let drin = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) drin = !drin;
  }
  return drin;
}

/** Bricht Text an einer Breite um, Absaetze bleiben erhalten. */
function umbrich(ctx, text, breite) {
  const zeilen = [];
  for (const absatz of String(text || '').split('\n')) {
    const worte = absatz.split(/\s+/).filter(Boolean);
    if (!worte.length) { zeilen.push(''); continue; }
    let zeile = worte[0];
    for (const w of worte.slice(1)) {
      if (ctx.measureText(zeile + ' ' + w).width <= breite) zeile += ' ' + w;
      else { zeilen.push(zeile); zeile = w; }
    }
    zeilen.push(zeile);
  }
  return zeilen;
}

/** Textfeld-Masse eines Callouts; die Hoehe waechst mit dem Text. */
function calloutMasse(ctx, it) {
  const size = it.size || 11;
  ctx.font = `${size}px Arial, sans-serif`;
  const zeilen = umbrich(ctx, it.s, Math.max(10, it.w2 - 2 * POLSTER));
  const hoehe = size * 1.25;
  const benoetigt = zeilen.length * hoehe + 2 * POLSTER;
  if (it.h2 < benoetigt) it.h2 = benoetigt;
  return { zeilen, hoehe, size };
}

function textZeilen(ctx, it) {
  ctx.font = `${it.size || 11}px Arial, sans-serif`;
  const zeilen = String(it.s || '').split('\n');
  const hoehe = (it.size || 11) * 1.25;
  let breite = 0;
  for (const z of zeilen) breite = Math.max(breite, ctx.measureText(z).width);
  return { zeilen, hoehe, breite };
}

/**
 * Zeichnet ein Objekt. "ansicht" ist nur am Bildschirm gesetzt und blendet
 * Hilfen ein, die nicht ins PDF gehoeren (Platzhalter in leeren Textfeldern).
 */
export function zeichneItem(ctx, it, bilder, ansicht) {
  ctx.save();
  setzeStil(ctx, it);

  switch (it.t) {
    case 'line': {
      ctx.beginPath();
      ctx.moveTo(it.x1, it.y1);
      ctx.lineTo(it.x2, it.y2);
      ctx.stroke();
      if (it.pfeile) {
        pfeilspitze(ctx, it.x1, it.y1, it.x2, it.y2, it.w);
        pfeilspitze(ctx, it.x2, it.y2, it.x1, it.y1, it.w);
      }
      break;
    }

    case 'poly': {
      const p = it.pts;
      if (p.length === 1) {
        ctx.beginPath();
        ctx.arc(p[0][0], p[0][1], Math.max(2, it.w), 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      if (p.length === 2) {
        ctx.beginPath();
        ctx.moveTo(p[0][0], p[0][1]);
        ctx.lineTo(p[1][0], p[1][1]);
        ctx.stroke();
        break;
      }
      pfadZiehen(ctx, p);
      if (it.fill) {
        ctx.globalAlpha = (it.o ?? 1) * (it.fillOpacity ?? 1);
        ctx.fillStyle = it.fill;
        ctx.fill();
        ctx.globalAlpha = it.o ?? 1;
      }
      if (it.w > 0) ctx.stroke();
      break;
    }

    case 'rect': {
      if (it.fill) {
        ctx.globalAlpha = (it.o ?? 1) * (it.fillOpacity ?? 1);
        ctx.fillStyle = it.fill;
        ctx.fillRect(it.x, it.y, it.w2, it.h2);
        ctx.globalAlpha = it.o ?? 1;
      }
      if (it.w > 0) ctx.strokeRect(it.x, it.y, it.w2, it.h2);
      break;
    }

    case 'text': {
      const { zeilen, hoehe, breite } = textZeilen(ctx, it);
      if (it.bg) {
        // Hinterlegter Text: weisser Grund knapp um die Zeilen
        ctx.fillStyle = it.bg;
        ctx.fillRect(it.x - 2, it.y - 1, breite + 4, zeilen.length * hoehe + 2);
      }
      ctx.textBaseline = 'top';
      ctx.fillStyle = it.c;
      zeilen.forEach((z, i) => ctx.fillText(z, it.x, it.y + i * hoehe));
      break;
    }

    case 'callout': {
      const leer = !String(it.s || '').trim();
      const { zeilen, hoehe } = calloutMasse(ctx, leer ? { ...it, s: 'Text eingeben' } : it);
      if (leer) it.h2 = Math.max(it.h2, hoehe + 2 * POLSTER);
      // Pfeil vom naechsten Punkt des Feldrands zum Ziel, nur wenn das Ziel ausserhalb liegt
      const ax = Math.min(Math.max(it.zx, it.x), it.x + it.w2);
      const ay = Math.min(Math.max(it.zy, it.y), it.y + it.h2);
      if (ax !== it.zx || ay !== it.zy) {
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(it.zx, it.zy);
        ctx.stroke();
        pfeilspitze(ctx, ax, ay, it.zx, it.zy, Math.max(it.w || 1, 1.4));
      }
      ctx.fillStyle = it.fill || '#fff';
      ctx.fillRect(it.x, it.y, it.w2, it.h2);
      ctx.strokeRect(it.x, it.y, it.w2, it.h2);
      ctx.textBaseline = 'top';
      if (leer) {
        if (ansicht) {
          ctx.fillStyle = '#9a938e';
          ctx.fillText('Text eingeben', it.x + POLSTER, it.y + POLSTER);
        }
        break;
      }
      ctx.fillStyle = it.c;
      zeilen.forEach((z, i) => ctx.fillText(z, it.x + POLSTER, it.y + POLSTER + i * hoehe));
      break;
    }

    case 'kreuz': {
      const r = it.g || 9;
      ctx.beginPath();
      ctx.moveTo(it.x - r, it.y - r);
      ctx.lineTo(it.x + r, it.y + r);
      ctx.moveTo(it.x - r, it.y + r);
      ctx.lineTo(it.x + r, it.y - r);
      ctx.stroke();
      break;
    }

    case 'img': {
      const bild = bilder && bilder[it.bild];
      if (bild && bild.el && bild.el.complete) {
        ctx.drawImage(bild.el, it.x, it.y, it.w2, it.h2);
      } else {
        ctx.fillStyle = '#e6e3e1';
        ctx.fillRect(it.x, it.y, it.w2, it.h2);
      }
      if (it.rahmen) {
        ctx.strokeStyle = it.c || '#fff';
        ctx.lineWidth = it.w || 2;
        ctx.strokeRect(it.x, it.y, it.w2, it.h2);
      }
      break;
    }
  }
  ctx.restore();
}

export function bbox(it, ctx) {
  switch (it.t) {
    case 'poly': {
      let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
      for (const [x, y] of it.pts) {
        x1 = Math.min(x1, x); y1 = Math.min(y1, y);
        x2 = Math.max(x2, x); y2 = Math.max(y2, y);
      }
      const p = (it.w || 1) / 2;
      return { x: x1 - p, y: y1 - p, w: x2 - x1 + 2 * p, h: y2 - y1 + 2 * p };
    }
    case 'line': {
      const x = Math.min(it.x1, it.x2), y = Math.min(it.y1, it.y2);
      const p = Math.max(4, it.w || 1);
      return { x: x - p, y: y - p, w: Math.abs(it.x2 - it.x1) + 2 * p, h: Math.abs(it.y2 - it.y1) + 2 * p };
    }
    case 'kreuz': {
      const r = (it.g || 9) + (it.w || 2) / 2;
      return { x: it.x - r, y: it.y - r, w: r * 2, h: r * 2 };
    }
    case 'text': {
      if (ctx) {
        const { zeilen, hoehe, breite } = textZeilen(ctx, it);
        return { x: it.x - 2, y: it.y - 2, w: breite + 4, h: zeilen.length * hoehe + 4 };
      }
      return { x: it.x, y: it.y, w: 80, h: (it.size || 11) * 1.3 };
    }
    default: {
      const x = it.w2 < 0 ? it.x + it.w2 : it.x;
      const y = it.h2 < 0 ? it.y + it.h2 : it.y;
      return { x, y, w: Math.abs(it.w2), h: Math.abs(it.h2) };
    }
  }
}

function nahAmSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / l2)) : 0;
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

export function trefferTest(it, x, y, ctx) {
  const tol = Math.max(6, (it.w || 2) / 2 + 4);
  switch (it.t) {
    case 'line':
      return nahAmSegment(x, y, it.x1, it.y1, it.x2, it.y2) < tol;
    case 'poly': {
      if (it.fill && inPolygon(x, y, it.pts)) return true;
      const rand = [...it.pts, it.pts[0]];
      for (let i = 1; i < rand.length; i++) {
        if (nahAmSegment(x, y, rand[i - 1][0], rand[i - 1][1], rand[i][0], rand[i][1]) < tol) return true;
      }
      return false;
    }
    case 'callout': {
      const b = bbox(it);
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return true;
      const ax = Math.min(Math.max(it.zx, it.x), it.x + it.w2);
      const ay = Math.min(Math.max(it.zy, it.y), it.y + it.h2);
      return nahAmSegment(x, y, ax, ay, it.zx, it.zy) < tol;
    }
    case 'rect': {
      const b = bbox(it);
      const drin = x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
      if (it.fill) return drin;
      if (!drin) return false;
      return x - b.x < tol || b.x + b.w - x < tol || y - b.y < tol || b.y + b.h - y < tol;
    }
    default: {
      const b = bbox(it, ctx);
      return x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
    }
  }
}

export function verschiebe(it, dx, dy) {
  if (it.pts) { for (const p of it.pts) { p[0] += dx; p[1] += dy; } return; }
  if (it.x1 !== undefined) { it.x1 += dx; it.y1 += dy; it.x2 += dx; it.y2 += dy; return; }
  it.x += dx; it.y += dy;
}

// Skaliert ein Objekt so, dass seine Huellbox von "alt" auf "neu" waechst.
export function skaliere(it, alt, neu) {
  const sx = alt.w ? neu.w / alt.w : 1;
  const sy = alt.h ? neu.h / alt.h : 1;
  const um = (x, y) => [neu.x + (x - alt.x) * sx, neu.y + (y - alt.y) * sy];
  if (it.pts) { for (const p of it.pts) { const [a, b] = um(p[0], p[1]); p[0] = a; p[1] = b; } return; }
  if (it.x1 !== undefined) {
    [it.x1, it.y1] = um(it.x1, it.y1);
    [it.x2, it.y2] = um(it.x2, it.y2);
    return;
  }
  [it.x, it.y] = um(it.x, it.y);
  if (it.w2 !== undefined) { it.w2 = Math.max(it.t === 'callout' ? 30 : 2, it.w2 * sx); it.h2 = Math.max(2, it.h2 * sy); }
  if (it.t === 'text') it.size = (it.size || 11) * ((sx + sy) / 2);
  if (it.t === 'kreuz') it.g = (it.g || 9) * ((sx + sy) / 2);
}
