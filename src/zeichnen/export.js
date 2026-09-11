// Export: Markups auf das PDF brennen und die Rohdaten zusaetzlich als
// Anhang einbetten. Dadurch laesst sich eine gespeicherte Zeichnung im Tool
// spaeter wieder oeffnen und weiterbearbeiten.

import { PDFDocument, degrees } from 'pdf-lib';
import { zeichneItem } from './zeichnen.js';

const AUFLOESUNG = 2; // Pixel je PDF-Punkt beim Brennen

function alsBlob(canvas) {
  return new Promise((ok) => canvas.toBlob(ok, 'image/png'));
}

function overlayCanvas(seite, bilder) {
  const c = document.createElement('canvas');
  c.width = Math.round(seite.breite * AUFLOESUNG);
  c.height = Math.round(seite.hoehe * AUFLOESUNG);
  const ctx = c.getContext('2d');
  ctx.setTransform(AUFLOESUNG, 0, 0, AUFLOESUNG, 0, 0);
  for (const it of seite.items) zeichneItem(ctx, it, bilder);
  return c;
}

function platzierung(rot, bild, pw, ph) {
  // Das Overlay liegt in Anzeigekoordinaten vor. Bei gedrehten Seiten wird es
  // gegenlaeufig in den Seitenraum gedreht, damit es im Viewer passt.
  const w = bild.width, h = bild.height;
  switch (((rot % 360) + 360) % 360) {
    case 90: return { x: pw, y: 0, width: w, height: h, rotate: degrees(90) };
    case 180: return { x: pw, y: ph, width: w, height: h, rotate: degrees(180) };
    case 270: return { x: 0, y: ph, width: w, height: h, rotate: degrees(270) };
    default: return { x: 0, y: 0, width: w, height: h };
  }
}

export async function baueDatei(state) {
  let pdf;
  if (state.origBytes) {
    pdf = await PDFDocument.load(state.origBytes, { ignoreEncryption: true });
  } else {
    pdf = await PDFDocument.create();
    for (const s of state.seiten) pdf.addPage([s.breite, s.hoehe]);
  }

  const seitenObjekte = pdf.getPages();
  for (let i = 0; i < state.seiten.length; i++) {
    const seite = state.seiten[i];
    const ziel = seitenObjekte[i];
    if (!ziel || !seite.items.length) continue;

    const blob = await alsBlob(overlayCanvas(seite, state.bilder));
    const png = await pdf.embedPng(await blob.arrayBuffer());
    const { width: pw, height: ph } = ziel.getSize();
    const rot = ziel.getRotation().angle;
    const anzeige = { width: seite.breite, height: seite.hoehe };
    ziel.drawImage(png, platzierung(rot, anzeige, pw, ph));
  }

  // Bearbeitbare Daten mitgeben
  const daten = {
    version: 1,
    erstellt: new Date().toISOString(),
    massstab: state.massstab,
    bilder: Object.fromEntries(Object.entries(state.bilder).map(([k, v]) => [k, v.src])),
    seiten: state.seiten.map((s) => ({ breite: s.breite, hoehe: s.hoehe, items: s.items })),
  };
  await pdf.attach(new TextEncoder().encode(JSON.stringify(daten)), 'isotec-markups.json', {
    mimeType: 'application/json',
    description: 'Bearbeitbare Markups des ISOTEC Zeichentools',
  });
  if (state.origBytes) {
    await pdf.attach(state.origBytes, 'isotec-original.pdf', {
      mimeType: 'application/pdf',
      description: 'Originaldokument ohne Markups',
    });
  }

  // Ohne Objektstroeme, damit die Anhaenge von jedem Reader gefunden werden
  return pdf.save({ useObjectStreams: false });
}

export async function speichern(state, name) {
  const bytes = await baueDatei(state);
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
