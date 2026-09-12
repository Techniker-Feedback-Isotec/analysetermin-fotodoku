// ISOTEC Zeichentool: Oberflaeche, Seiten, Eingaben.
//
// Grundsatz: Es gibt keine freie Werkzeugleiste. Gezeichnet wird nur mit den
// Vorlagen rechts (Gewerke aus der Legende, Aufmass aus Drawboard). Jedes
// fertige Objekt landet sofort in der Hand, damit es direkt verschoben oder
// an seinen Punkten angepasst werden kann.
//
// Herkunft: Kopie des eigenstaendigen Zeichentools (Desktop/pdftool, Stand
// 46f5c70) vom 11.09.2026. Hier laeuft es als eigene Seite (zeichnen.html)
// in einem Vollbild-iframe der Dokumentation, um die Prinzipskizze zu
// zeichnen (Yann: "die Vertriebler sollen nur das eine Werkzeug nutzen").
// Eingebettet spricht es mit der App ueber postMessage (siehe unten,
// "Eingebettet"); als eigene Seite geoeffnet verhaelt es sich wie vorher.

import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { GEWERKE, AUFMASS, GRUNDRISS, REGLER, FANG } from './vorlagen.js';
import { zeichneItem, bbox, trefferTest, verschiebe, skaliere, inPolygon, POLSTER } from './zeichnen.js';
import { baueDatei, speichern } from './export.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

const A4 = { breite: 595.28, hoehe: 841.89 };
const dpr = Math.min(window.devicePixelRatio || 1, 2);
/** Pixel je CSS-Pixel: bei vielen Seiten nur einfach, sonst reicht der Canvas-Speicher auf dem iPad nicht. */
const dprAktuell = () => (state.seiten.length > 8 ? 1 : dpr);
const SPEICHER_SCHLUESSEL = 'isotec-zeichentool-einstellungen';
const LEISTE_SCHLUESSEL = 'isotec-zeichentool-leiste';
const touchGeraet = window.matchMedia('(pointer: coarse)').matches;

const state = {
  origBytes: null,     // Original-PDF fuer den Export
  dateiname: 'Zeichnung.pdf',
  seiten: [],          // { nr, pdfSeite, breite, hoehe, items, el, cPdf, cInk, cMini, entwurf, hilfen }
  bilder: {},          // id -> { src, el }
  zoom: 1,
  tool: 'auswahl',     // 'auswahl' oder der tool-Typ der aktiven Vorlage
  vorlage: null,       // aktive Vorlage mit aufgeloester Farbe und Fuellung
  fest: false,         // Vorlage bleibt nach dem Zeichnen aktiv (Doppelklick auf die Vorlage)
  einstellungen: {},   // je Vorlagen-Id die angepasste Strichdicke oder Schriftgroesse
  aktiveSeite: 0,
  auswahl: null,       // { seite, items, item (nur bei genau einem), punkt?, ecke? }
  leisteZu: false,     // Vorlagenleiste eingeklappt
  fixiert: !touchGeraet, // Leiste bleibt nach der Vorlagenwahl offen (auf dem iPad klappt sie zu)
  reiter: 'gewerke',   // aktiver Reiter der Vorlagenleiste; 'grundriss' blendet das Raster ein
  zuschnitt: false,    // Hand mit gewaehltem Foto: Griffe schneiden statt zu skalieren
  pfad: null,          // Polygon in Arbeit: { seite, item }
  linie: null,         // Gerade in Arbeit: { seite, item, start }
  verlauf: [],
  zukunft: [],
};

const $ = (id) => document.getElementById(id);

/**
 * Eingebettet in die Dokumentation (iframe)? Dann kommt das Dokument von der
 * App, Speichern gibt die Bytes an die App zurueck statt herunterzuladen, und
 * ein Knopf "Zurueck" schliesst das Fenster. Gleiche Herkunft, deshalb geht
 * postMessage an den eigenen Origin.
 */
const eingebettet = window.parent !== window;
const anApp = (nachricht, uebertragen) => {
  if (eingebettet) window.parent.postMessage(nachricht, window.location.origin, uebertragen);
};
const anzahlObjekte = () => state.seiten.reduce((n, s) => n + s.items.length, 0);
const el = {
  seiten: $('seiten'), ansicht: $('ansicht'), start: $('start'),
  miniaturen: $('miniaturen'), vorlagen: $('vorlagen'), status: $('status'),
  leiste: $('vorlagen-leiste'), einstellungen: $('einstellungen'),
};

const melde = (text) => {
  el.status.textContent = text;
  // Animation neu anstossen, damit jede Meldung kurz aufleuchtet
  el.status.classList.remove('neu');
  void el.status.offsetWidth;
  el.status.classList.add('neu');
};

/**
 * Eine Auswahl aus einem oder mehreren Objekten einer Seite. Gehoert ein Objekt
 * zu einer Gruppe (Kennung gruppe), kommen alle Mitglieder mit.
 */
function auswahlVon(seite, items) {
  const gruppen = new Set(items.map((i) => i.gruppe).filter(Boolean));
  const alle = gruppen.size ? seite.items.filter((i) => items.includes(i) || gruppen.has(i.gruppe)) : items;
  return { seite, items: alle, item: alle.length === 1 ? alle[0] : null };
}

/** Markierte Objekte zu einer Gruppe verbinden oder eine Gruppe wieder loesen. */
function gruppiere() {
  const a = state.auswahl;
  if (!a || a.items.length < 2) return;
  schnappschuss();
  const istGruppe = a.items.every((i) => i.gruppe && i.gruppe === a.items[0].gruppe);
  if (istGruppe) {
    for (const i of a.items) delete i.gruppe;
    melde('Gruppe gelöst. Die Objekte lassen sich wieder einzeln greifen.');
  } else {
    const kennung = 'g' + Date.now().toString(36);
    for (const i of a.items) i.gruppe = kennung;
    melde(`${a.items.length} Objekte gruppiert. Ein Griff auf eines davon nimmt alle mit.`);
  }
  zeichneAlles();
}

/* ----------------------------------------------------------- Einstellungen */

function ladeEinstellungen() {
  try { state.einstellungen = JSON.parse(localStorage.getItem(SPEICHER_SCHLUESSEL) || '{}'); }
  catch (e) { state.einstellungen = {}; }
  try {
    const l = JSON.parse(localStorage.getItem(LEISTE_SCHLUESSEL) || 'null');
    if (l && typeof l.fixiert === 'boolean') state.fixiert = l.fixiert;
  } catch (e) { /* Standard behalten */ }
}

function speichereLeiste() {
  try { localStorage.setItem(LEISTE_SCHLUESSEL, JSON.stringify({ fixiert: state.fixiert })); } catch (e) { /* egal */ }
}

/** Vorlagenleiste ein- oder ausklappen. */
function klappeLeiste(zu) {
  state.leisteZu = zu;
  el.leiste.classList.toggle('zu', zu);
  document.querySelector('.buehne').classList.toggle('leiste-zu', zu);
  if (zu) schliesseEinstellungen();
  $('btn-fixieren').classList.toggle('aktiv', state.fixiert);
}

function speichereEinstellungen() {
  try { localStorage.setItem(SPEICHER_SCHLUESSEL, JSON.stringify(state.einstellungen)); } catch (e) { /* egal */ }
}

/** Die einstellbare Groesse einer Vorlage: angepasster Wert oder Standard. */
function wertVon(v) {
  const eigen = state.einstellungen[v.id];
  if (typeof eigen === 'number') return eigen;
  return v.einstellbar === 'size' ? v.size : v.width;
}

/* ---------------------------------------------------------------- Vorlagen */

function loeseAuf(gruppe, p) {
  const farbe = p.color || gruppe.farbe;
  return {
    ...p,
    id: `${gruppe.id}.${p.schluessel}`,
    gruppe: gruppe.name,
    color: farbe,
    fill: p.fill === 'auto' ? farbe : (p.fill || null),
    einstellbar: p.einstellbar || 'width',
  };
}

/** Kleines Beispielbild der Vorlage in ihrer Farbe. */
function probe(v) {
  const c = v.color;
  const rand = c.toLowerCase() === '#ffffff' ? '#9a938e' : c;
  switch (v.tool) {
    case 'linie':
      return v.pfeile
        ? `<svg class="probe" viewBox="0 0 22 14"><path d="M3 7h16" stroke="${c}" stroke-width="1.2"/><path d="M1 7l4-2.5v5zM21 7l-4-2.5v5z" fill="${c}"/></svg>`
        : `<svg class="probe" viewBox="0 0 22 14"><path d="M2 10L20 4" stroke="${c}" stroke-width="3.4" stroke-linecap="square"/></svg>`;
    case 'polygon':
      return `<svg class="probe" viewBox="0 0 22 14"><path d="M2 11.5L4 3l8-1.5 8 4-2 8z" fill="${v.fill || 'none'}" fill-opacity="${v.fillOpacity ?? 1}" stroke="${rand}" stroke-width="1.2"/></svg>`;
    case 'rechteck':
      return `<svg class="probe" viewBox="0 0 22 14"><rect x="1.5" y="2" width="19" height="10" fill="${v.fill || 'none'}" stroke="${rand}" stroke-width="1.2"/></svg>`;
    case 'text':
      return `<svg class="probe" viewBox="0 0 22 14">${v.bg ? '<rect x="1" y="1" width="20" height="12" fill="#fff" stroke="#9a938e" stroke-width="0.8"/>' : ''}<text x="11" y="11.5" text-anchor="middle" font-family="Arial" font-size="12" fill="${c}">Aa</text></svg>`;
    case 'callout':
      return `<svg class="probe" viewBox="0 0 22 14"><rect x="8.5" y="1.5" width="12" height="7" fill="#fff" stroke="${c}" stroke-width="1"/><path d="M8.5 6L2.5 12.5" stroke="${c}" stroke-width="1"/><path d="M1.5 13.5l1-3.5 2.5 2.5z" fill="${c}"/></svg>`;
    case 'kreuz':
      return `<svg class="probe" viewBox="0 0 22 14"><path d="M6 2.5l10 9M16 2.5l-10 9" stroke="${c}" stroke-width="2" stroke-linecap="round"/></svg>`;
    default:
      return '<span class="probe"></span>';
  }
}

/** Baut die Vorlagenleiste: je Gewerk eine Zeile mit Symbolknoepfen, Aufmass und Grundriss als Liste. */
function baueVorlagen(reiter) {
  el.vorlagen.innerHTML = '';
  schliesseEinstellungen();
  // Das Raster gehoert zum Grundriss: dort zeigt es die Verhaeltnisse, auf
  // Fotos und Gewerkeflaechen wuerde es nur stoeren (Yann, 12.09.2026).
  state.reiter = reiter;
  zeichneAlles();
  const gruppen = { aufmass: [AUFMASS], grundriss: [GRUNDRISS] }[reiter] || GEWERKE;
  const knopfFuer = (v, breit) => {
    const knopf = document.createElement('button');
    knopf.className = 'vorlage' + (breit ? ' breit' : '');
    knopf.dataset.id = v.id;
    knopf.title = `${v.gruppe}: ${v.name}. Doppelklick hält die Vorlage für mehrere Objekte fest.`;
    knopf.innerHTML = probe(v) + (breit ? `<span>${v.name}</span>` : '');
    knopf.style.setProperty('--akzent', v.color.toLowerCase() === '#ffffff' ? '#9a938e' : v.color);
    knopf.onclick = () => waehleVorlage(v);
    const festhalten = () => {
      state.fest = true;
      markiereVorlage();
      melde(`${v.gruppe} – ${v.name} bleibt festgehalten. Esc oder Hand löst wieder.`);
    };
    knopf.ondblclick = festhalten;
    let letzterTipp = 0;
    knopf.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch') return;
      const jetzt = performance.now();
      if (jetzt - letzterTipp < 350 && state.vorlage && state.vorlage.id === v.id) festhalten();
      letzterTipp = jetzt;
    });
    return knopf;
  };
  gruppen.forEach((g, gi) => {
    if (gruppen.length > 1) {
      const zeile = document.createElement('div');
      zeile.className = 'zeile';
      zeile.style.setProperty('--i', gi);
      zeile.innerHTML = `<span class="fahne" style="background:${g.farbe}"></span><span class="name" title="${g.name}">${g.kurz || g.name}</span>`;
      const knoepfe = document.createElement('div');
      knoepfe.className = 'knoepfe';
      for (const p of g.presets) knoepfe.appendChild(knopfFuer(loeseAuf(g, p), false));
      zeile.appendChild(knoepfe);
      el.vorlagen.appendChild(zeile);
    } else {
      g.presets.forEach((p, pi) => {
        const zeile = document.createElement('div');
        zeile.className = 'zeile liste';
        zeile.style.setProperty('--i', pi);
        zeile.appendChild(knopfFuer(loeseAuf(g, p), true));
        el.vorlagen.appendChild(zeile);
      });
    }
  });
  markiereVorlage();
}

const HINWEISE = {
  linie: 'Anfang anklicken, dann das Ende anklicken (oder ziehen). Umschalt erzwingt waagerecht oder senkrecht.',
  polygon: 'Punkt für Punkt klicken, zum Schließen zurück auf den ersten Punkt. Enter schließt auch, Esc verwirft.',
  polygonFrei: 'Punkt für Punkt klicken, ohne Fang, jeder Punkt liegt genau unter dem Mauszeiger. Zum Schließen zurück auf den ersten Punkt.',
  rechteck: 'Rechteck mit gedrückter Maustaste aufziehen.',
  text: 'Stelle anklicken und Text eingeben. Enter oder Klick ins Blatt übernimmt, Umschalt+Enter bricht um.',
  callout: 'Zielpunkt anklicken. Dann das Feld an die gewünschte Stelle ziehen und mit Doppelklick oder Enter beschreiben.',
  kreuz: 'Stelle anklicken.',
};

function waehleVorlage(v) {
  beendePfad(true);
  beendeLinie(false);
  state.vorlage = v;
  state.tool = v.tool;
  state.fest = false;
  state.auswahl = null;
  markiereVorlage();
  if (!state.fixiert) klappeLeiste(true);
  melde(`${v.gruppe} – ${v.name}. ${HINWEISE[v.frei ? 'polygonFrei' : v.tool] || ''}`);
  zeichneAlles();
}

/** Lasso: Bereich einkreisen, alle Objekte darin werden gemeinsam markiert. */
function waehleLasso() {
  beendePfad(true);
  beendeLinie(false);
  state.tool = 'lasso';
  state.vorlage = null;
  state.fest = false;
  markiereVorlage();
  melde('Lasso: Bereich mit gedrückter Maustaste oder dem Finger einkreisen. Alle Objekte darin lassen sich dann gemeinsam verschieben, an den Ecken skalieren oder löschen.');
  zeichneAlles();
}

function waehleAuswahl() {
  beendePfad(true);
  beendeLinie(false);
  for (const s of state.seiten) s.hilfen = [];
  state.tool = 'auswahl';
  state.vorlage = null;
  state.fest = false;
  markiereVorlage();
  melde('Hand: Objekt anklicken und verschieben, Polygone und Striche an ihren Punkten ziehen, Entf löscht, Doppelklick oder Enter ändert Text.');
  zeichneAlles();
}

/**
 * Jedes fertige Objekt landet sofort in der Hand, das neue Objekt ist markiert.
 * Ist die Vorlage festgehalten, bleibt sie aktiv und das naechste Objekt kann
 * direkt folgen.
 */
function nachErstellen(seite, item) {
  seite.letzterTipp = null;
  if (state.fest && state.vorlage) {
    zeichneAlles();
    return;
  }
  waehleAuswahl();
  state.auswahl = auswahlVon(seite, [item]);
  zeichneAlles();
  melde(item.t === 'callout'
    ? 'Textfeld gesetzt. Feld verschieben, Pfeilspitze am runden Griff versetzen, dann Doppelklick oder Enter zum Schreiben.'
    : 'Objekt gesetzt. Verschieben, an den Punkten anpassen, Entf löscht. Rechts die nächste Vorlage wählen.');
}

function markiereVorlage() {
  for (const b of el.vorlagen.querySelectorAll('.vorlage')) {
    const aktiv = !!state.vorlage && b.dataset.id === state.vorlage.id;
    b.classList.toggle('aktiv', aktiv);
    b.classList.toggle('fest', aktiv && state.fest);
  }
  $('btn-auswahl').classList.toggle('aktiv', state.tool === 'auswahl');
  $('btn-lasso').classList.toggle('aktiv', state.tool === 'lasso');
  const z = $('btn-einstellung');
  z.disabled = !state.vorlage;
  z.classList.toggle('markiert', !!state.vorlage && typeof state.einstellungen[state.vorlage.id] === 'number');
  z.title = state.vorlage
    ? `${REGLER[state.vorlage.einstellbar].name} von „${state.vorlage.name}“ anpassen`
    : 'Erst rechts eine Vorlage wählen, dann hier Strichdicke oder Schriftgröße anpassen';
  const a = state.auswahl;
  const mehrere = !!a && a.items.length > 1;
  const gruppe = mehrere && a.items.every((i) => i.gruppe && i.gruppe === a.items[0].gruppe);
  $('btn-gruppe').disabled = !mehrere;
  $('btn-gruppe').querySelector('.label').textContent = gruppe ? 'Lösen' : 'Gruppe';
  // Zuschneiden gibt es nur fuer genau ein gewaehltes Foto in der Hand
  const foto = state.tool === 'auswahl' && !!a && !!a.item && a.item.t === 'img';
  if (!foto) state.zuschnitt = false;
  $('btn-zuschneiden').disabled = !foto;
  $('btn-zuschneiden').classList.toggle('aktiv', state.zuschnitt);
  el.seiten.classList.toggle('zeichnen', state.tool !== 'auswahl');
  $('zoom-wert').textContent = Math.round(state.zoom * 100) + ' %';
  $('btn-undo').disabled = !state.verlauf.length;
  $('btn-redo').disabled = !state.zukunft.length;
  $('btn-loeschen').disabled = !state.auswahl;
}

/* --------------------------------------------------- Einstellungsfenster */

let offeneEinstellung = null;
const zeige = (n) => String(Math.round(n * 10) / 10).replace('.', ',');

function oeffneEinstellungen(v, knopf) {
  if (offeneEinstellung && offeneEinstellung.id === v.id) { schliesseEinstellungen(); return; }
  schliesseEinstellungen();
  offeneEinstellung = { id: v.id, knopf, geschnappt: false };
  knopf.classList.add('aktiv');
  knopf.classList.add('offen');

  const regler = REGLER[v.einstellbar];
  const standard = v.einstellbar === 'size' ? v.size : v.width;
  const wert = wertVon(v);
  el.einstellungen.innerHTML = `
    <h3>${v.name}</h3>
    <p class="unter">${v.gruppe}</p>
    <label>${regler.name} <span class="wert" id="einst-wert"></span></label>
    <input type="range" id="einst-regler" min="${regler.min}" max="${regler.max}" step="${regler.step}" />
    <div class="knoepfe">
      <button class="btn" id="einst-standard">Standard (${zeige(standard)})</button>
      <button class="btn" id="einst-zu">Fertig</button>
    </div>`;
  const regl = $('einst-regler');
  regl.value = wert;
  $('einst-wert').textContent = `${zeige(wert)} ${regler.einheit}`;

  const uebernehme = (neu, zuruecksetzen) => {
    if (zuruecksetzen) delete state.einstellungen[v.id]; else state.einstellungen[v.id] = neu;
    speichereEinstellungen();
    $('einst-wert').textContent = `${zeige(neu)} ${regler.einheit}`;
    regl.value = neu;
    markiereVorlage();
    // Ein gerade markiertes Objekt dieser Vorlage zieht sofort mit
    const it = state.auswahl && state.auswahl.item;
    if (it && it.v === v.id) {
      if (!offeneEinstellung.geschnappt) { schnappschuss(); offeneEinstellung.geschnappt = true; }
      if (v.einstellbar === 'size') it.size = neu; else it.w = neu;
      zeichneAlles();
    }
  };
  regl.oninput = () => uebernehme(+regl.value, false);
  $('einst-standard').onclick = () => uebernehme(standard, true);
  $('einst-zu').onclick = schliesseEinstellungen;

  el.einstellungen.hidden = false;
  const kr = knopf.getBoundingClientRect(), lr = el.leiste.getBoundingClientRect();
  let oben = kr.bottom - lr.top + 8;
  const hoehe = el.einstellungen.offsetHeight;
  if (oben + hoehe > lr.height - 8) oben = Math.max(8, kr.top - lr.top - hoehe - 8);
  el.einstellungen.style.top = oben + 'px';
}

function schliesseEinstellungen() {
  if (!offeneEinstellung) return;
  offeneEinstellung.knopf.classList.remove('aktiv', 'offen');
  offeneEinstellung = null;
  el.einstellungen.hidden = true;
}

document.addEventListener('pointerdown', (e) => {
  if (offeneEinstellung && !el.einstellungen.contains(e.target) && e.target.id !== 'btn-einstellung') schliesseEinstellungen();
});

/* -------------------------------------------------------------- Dokument */

async function ladePdf(bytes, name) {
  state.origBytes = bytes.slice(0);
  state.dateiname = name || 'Zeichnung.pdf';
  let dok = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
  state.seiten = [];
  state.bilder = {};
  state.auswahl = null;
  for (let i = 1; i <= dok.numPages; i++) {
    const s = await dok.getPage(i);
    const vp = s.getViewport({ scale: 1 });
    state.seiten.push({ nr: i, pdfSeite: s, breite: vp.width, hoehe: vp.height, items: [], hilfen: [] });
  }
  // Frueher gespeicherte Markups zuruecklesen. Je nach pdf.js-Version kommt
  // eine Map oder ein Objekt zurueck, und der Inhalt wird erst auf Anfrage
  // nachgeladen.
  try {
    const roh = await dok.getAttachments();
    const eintrag = (n) => (roh instanceof Map ? roh.get(n) : roh && roh[n]);
    const inhalt = async (n) => {
      const e = eintrag(n);
      if (!e) return null;
      return e.content || (dok.getAttachmentContent ? await dok.getAttachmentContent(n) : null);
    };
    const markups = await inhalt('isotec-markups.json');
    if (markups) {
      const daten = JSON.parse(new TextDecoder().decode(markups));
      const original = await inhalt('isotec-original.pdf');
      if (original) {
        state.origBytes = original;
        dok = await pdfjsLib.getDocument({ data: state.origBytes.slice(0) }).promise;
        for (let i = 0; i < state.seiten.length; i++) state.seiten[i].pdfSeite = await dok.getPage(i + 1);
      }
      for (const [id, src] of Object.entries(daten.bilder || {})) ladeBild(id, src);
      daten.seiten.forEach((s, i) => { if (state.seiten[i]) state.seiten[i].items = s.items; });
      melde(`${name}: gespeicherte Markups geladen.`);
    }
  } catch (e) { console.warn('Markups konnten nicht gelesen werden:', e); }

  state.verlauf = []; state.zukunft = [];
  await baueSeiten();
  passeSeiteAn();
}

const leeresBlatt = (nr) => ({ nr, pdfSeite: null, breite: A4.breite, hoehe: A4.hoehe, items: [], hilfen: [] });

/** Ob ein neues Dokument das bestehende ersetzen darf: nur wenn nichts gezeichnet ist oder Yann zustimmt. */
function darfErsetzen() {
  const gezeichnet = state.seiten.some((s) => s.items.length);
  return !gezeichnet || confirm('Das geöffnete Dokument enthält Markierungen. Sollen sie verworfen und das neue Dokument geöffnet werden?');
}

function leeresDokument() {
  state.origBytes = null;
  state.dateiname = 'Zeichnung.pdf';
  state.seiten = [leeresBlatt(1)];
  state.bilder = {};
  state.auswahl = null;
  state.verlauf = []; state.zukunft = [];
  baueSeiten();
  passeSeiteAn();
}

/**
 * Haengt ein weiteres leeres Blatt hinten an. Das bestehende Dokument bleibt
 * unangetastet (Yann, 10.09.2026: es darf nie etwas ueberschrieben werden).
 */
async function blattAnhaengen() {
  if (!state.seiten.length) { leeresDokument(); melde('Leeres A4-Blatt angelegt.'); return; }
  state.seiten.push(leeresBlatt(state.seiten.length + 1));
  state.aktiveSeite = state.seiten.length - 1;
  await baueSeiten();
  markiereAktiveMini();
  passeSeiteAn();
  melde(`Blatt ${state.seiten.length} angehängt. Das bestehende Dokument bleibt erhalten.`);
}

async function baueSeiten() {
  el.start.style.display = 'none';
  el.seiten.innerHTML = '';
  el.miniaturen.innerHTML = '';
  state.seiten.forEach((s, i) => {
    const blatt = document.createElement('div');
    blatt.className = 'blatt';
    blatt.style.setProperty('--i', Math.min(i, 6));
    const cPdf = document.createElement('canvas');
    cPdf.className = 'pdf';
    const cInk = document.createElement('canvas');
    cInk.className = 'ink';
    const nr = document.createElement('div');
    nr.className = 'nummer';
    nr.textContent = `Seite ${s.nr}`;
    blatt.append(cPdf, cInk, nr);
    el.seiten.appendChild(blatt);
    s.el = blatt; s.cPdf = cPdf; s.cInk = cInk;
    verdrahteSeite(s);

    const mini = document.createElement('div');
    mini.className = 'mini';
    const cm = document.createElement('canvas');
    const mt = document.createElement('span');
    mt.textContent = s.nr;
    mini.append(cm, mt);
    mini.onclick = () => s.el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    el.miniaturen.appendChild(mini);
    s.mini = mini; s.cMini = cm;
  });
  await rendereAlleSeiten();
}

async function rendereSeite(s) {
  const b = Math.round(s.breite * state.zoom);
  const h = Math.round(s.hoehe * state.zoom);
  s.el.style.width = b + 'px';
  s.el.style.height = h + 'px';
  const d = dprAktuell();
  for (const c of [s.cPdf, s.cInk]) {
    c.width = Math.round(b * d);
    c.height = Math.round(h * d);
  }
  const ctx = s.cPdf.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, s.cPdf.width, s.cPdf.height);
  if (s.pdfSeite) {
    if (s.aufgabe) s.aufgabe.cancel();
    const vp = s.pdfSeite.getViewport({ scale: state.zoom * d });
    // pdf.js ab Version 5 braucht das Canvas selbst, sonst fehlt der Flip der Seite
    s.aufgabe = s.pdfSeite.render({ canvas: s.cPdf, canvasContext: ctx, viewport: vp });
    try { await s.aufgabe.promise; } catch (e) { /* abgebrochen */ }
    s.aufgabe = null;
  }
  zeichneSeite(s);
}

async function rendereAlleSeiten() {
  for (const s of state.seiten) await rendereSeite(s);
  markiereVorlage();
}

function rendereMini(s) {
  const breite = 110;
  const skala = breite / s.breite;
  s.cMini.width = Math.round(breite * dpr);
  s.cMini.height = Math.round(s.hoehe * skala * dpr);
  // Miniatur haengt nicht an der Seitenpixeldichte, drawImage skaliert
  const ctx = s.cMini.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, s.cMini.width, s.cMini.height);
  ctx.drawImage(s.cPdf, 0, 0, s.cMini.width, s.cMini.height);
  ctx.drawImage(s.cInk, 0, 0, s.cMini.width, s.cMini.height);
}

/* ------------------------------------------------------------- Zeichnung */

function zeichneSeite(s) {
  const ctx = s.cInk.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, s.cInk.width, s.cInk.height);
  const k = state.zoom * dprAktuell();
  ctx.setTransform(k, 0, 0, k, 0, 0);
  if (state.reiter === 'grundriss') malRaster(ctx, s);
  for (const it of s.items) zeichneItem(ctx, it, state.bilder, true);
  if (s.entwurf) zeichneItem(ctx, s.entwurf, state.bilder, true);
  if (s.hilfen && s.hilfen.length) malHilfen(ctx, s.hilfen);
  if (state.pfad && state.pfad.seite === s) malAnker(ctx, state.pfad);
  if (s.lasso) malLasso(ctx, s.lasso);
  if (state.auswahl && state.auswahl.seite === s) malAuswahl(ctx, state.auswahl);
  if (!s.entwurf && s.cMini) rendereMini(s);
}

function zeichneAlles() {
  for (const s of state.seiten) zeichneSeite(s);
  markiereVorlage();
}

const ecken = (b) => [[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]];

/* --------------------------------------------------------------- Raster */

/** Ein Millimeter in PDF-Punkten; das Raster liegt bei 5 und 10 Millimetern. */
const MM = 72 / 25.4;
const RASTER = { klein: 5 * MM, gross: 10 * MM };

/**
 * Raster fuer den Grundriss (Yann, 12.09.2026): feine Linien alle 5 mm,
 * kraeftigere alle 10 mm, damit die Verhaeltnisse beim Zeichnen sichtbar sind.
 * Nur auf dem Bildschirm; der Export zeichnet die Objekte neu und kennt es nicht.
 */
function malRaster(ctx, s) {
  const z = state.zoom;
  ctx.save();
  const linien = (schritt, farbe, dicke) => {
    ctx.strokeStyle = farbe;
    ctx.lineWidth = dicke / z;
    ctx.beginPath();
    for (let x = schritt; x < s.breite; x += schritt) { ctx.moveTo(x, 0); ctx.lineTo(x, s.hoehe); }
    for (let y = schritt; y < s.hoehe; y += schritt) { ctx.moveTo(0, y); ctx.lineTo(s.breite, y); }
    ctx.stroke();
  };
  // Das feine Raster erst, wenn seine Linien mindestens 7 Pixel auseinander liegen
  if (RASTER.klein * z >= 7) linien(RASTER.klein, 'rgba(86, 74, 68, .10)', 0.6);
  linien(RASTER.gross, 'rgba(86, 74, 68, .22)', 0.8);
  ctx.restore();
}

/** Griffe zum Zuschneiden eines Fotos: vier Ecken und vier Kantenmitten. */
const ZUSCHNITT_GRIFFE = [
  { l: true, t: true }, { r: true, t: true }, { l: true, b: true }, { r: true, b: true },
  { t: true }, { b: true }, { l: true }, { r: true },
];
function zuschnittGriffe(b) {
  return [
    ...ecken(b),
    [b.x + b.w / 2, b.y], [b.x + b.w / 2, b.y + b.h], [b.x, b.y + b.h / 2], [b.x + b.w, b.y + b.h / 2],
  ];
}

/**
 * Griffe eines Objekts. Polygone: jeder Eckpunkt. Linien: beide Enden.
 * Textfeld: die vier Ecken des Feldes und dazu die Pfeilspitze (Index 4).
 * Alles andere: die vier Ecken der Huellbox, dort wird skaliert.
 */
function griffe(it, ctx) {
  if (it.t === 'poly') return it.pts.map((p) => [p[0], p[1]]);
  if (it.t === 'line') return [[it.x1, it.y1], [it.x2, it.y2]];
  if (it.t === 'callout') return [...ecken(bbox(it, ctx)), [it.zx, it.zy]];
  return ecken(bbox(it, ctx));
}

/** Ob der Griff mit diesem Index einen einzelnen Punkt bewegt (statt zu skalieren). */
function istPunktgriff(it, idx) {
  return it.t === 'poly' || it.t === 'line' || (it.t === 'callout' && idx === 4);
}

/** Huellbox mehrerer Objekte zusammen. */
function gruppenBox(items, ctx) {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const it of items) {
    const b = bbox(it, ctx);
    x1 = Math.min(x1, b.x); y1 = Math.min(y1, b.y);
    x2 = Math.max(x2, b.x + b.w); y2 = Math.max(y2, b.y + b.h);
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

function malLasso(ctx, pts) {
  if (pts.length < 2) return;
  ctx.save();
  ctx.setLineDash([5 / state.zoom, 4 / state.zoom]);
  ctx.lineWidth = 1.2 / state.zoom;
  ctx.strokeStyle = '#D51317';
  ctx.fillStyle = 'rgba(213, 19, 23, .06)';
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (const p of pts) ctx.lineTo(p[0], p[1]);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function malAuswahl(ctx, a) {
  ctx.save();
  ctx.setLineDash([4, 3]);
  ctx.lineWidth = 1 / state.zoom;
  ctx.strokeStyle = '#564A44';
  if (a.items.length > 1) {
    // Gruppe: jedes Objekt leicht gestrichelt, die gemeinsame Box mit vier Eckgriffen
    for (const it of a.items) { const b = bbox(it, ctx); ctx.strokeRect(b.x, b.y, b.w, b.h); }
    const g = gruppenBox(a.items, ctx);
    ctx.setLineDash([]);
    ctx.strokeStyle = '#D51317';
    ctx.lineWidth = 1.6 / state.zoom;
    ctx.fillStyle = 'rgba(213, 19, 23, .04)';
    ctx.fillRect(g.x, g.y, g.w, g.h);
    ctx.strokeRect(g.x, g.y, g.w, g.h);
    ctx.fillStyle = '#fff';
    const q = (touchGeraet ? 14 : 9) / state.zoom;
    for (const [x, y] of ecken(g)) { ctx.fillRect(x - q / 2, y - q / 2, q, q); ctx.strokeRect(x - q / 2, y - q / 2, q, q); }
    ctx.restore();
    return;
  }
  const it = a.item;
  const b = bbox(it, ctx);
  if (state.zuschnitt && it.t === 'img') {
    // Zuschneiden: brauner Rahmen, acht kraeftige Griffe an Ecken und Kanten
    ctx.setLineDash([]);
    ctx.strokeStyle = '#564A44';
    ctx.lineWidth = 1.6 / state.zoom;
    ctx.strokeRect(b.x, b.y, b.w, b.h);
    ctx.fillStyle = '#564A44';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.2 / state.zoom;
    const q = (touchGeraet ? 14 : 10) / state.zoom;
    for (const [x, y] of zuschnittGriffe(b)) { ctx.fillRect(x - q / 2, y - q / 2, q, q); ctx.strokeRect(x - q / 2, y - q / 2, q, q); }
    ctx.restore();
    return;
  }
  if (it.t !== 'line') ctx.strokeRect(b.x, b.y, b.w, b.h);
  ctx.setLineDash([]);
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#D51317';
  ctx.lineWidth = 1.2 / state.zoom;
  griffe(it, ctx).forEach(([x, y], i) => {
    if (istPunktgriff(it, i)) {
      const r = 4 / state.zoom;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else {
      const g = 7 / state.zoom;
      ctx.fillRect(x - g / 2, y - g / 2, g, g);
      ctx.strokeRect(x - g / 2, y - g / 2, g, g);
    }
  });
  ctx.restore();
}

/** Die gesetzten Punkte eines laufenden Polygons, der erste Punkt als Ziel zum Schliessen. */
function malAnker(ctx, pfad) {
  const pts = pfad.item.pts;
  const farbe = pfad.item.c.toLowerCase() === '#ffffff' ? '#9a938e' : pfad.item.c;
  ctx.save();
  const r = 3.5 / state.zoom;
  ctx.lineWidth = 1.4 / state.zoom;
  for (let i = 0; i < pts.length - 1; i++) {
    const schliessbar = i === 0 && pts.length >= 4;
    ctx.beginPath();
    ctx.arc(pts[i][0], pts[i][1], schliessbar ? r * 1.8 : r, 0, Math.PI * 2);
    ctx.fillStyle = schliessbar ? '#fff' : farbe;
    ctx.fill();
    ctx.strokeStyle = farbe;
    ctx.stroke();
  }
  // Der Vorschaupunkt: dort wuerde der naechste Punkt liegen (Stift schwebt
  // oder liegt noch auf, gesetzt wird erst beim Abheben)
  const [vx, vy] = pts[pts.length - 1];
  ctx.beginPath();
  ctx.arc(vx, vy, r * 1.5, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255, 255, 255, .85)';
  ctx.fill();
  ctx.strokeStyle = farbe;
  ctx.stroke();
  ctx.restore();
}

/** Fanghilfen: gestrichelte Ausrichtlinien und ein Ring um einen gefangenen Punkt. */
function malHilfen(ctx, hilfen) {
  const z = state.zoom;
  ctx.save();
  ctx.strokeStyle = 'rgba(213, 19, 23, .8)';
  ctx.lineWidth = 1 / z;
  for (const h of hilfen) {
    ctx.setLineDash(h.typ === 'punkt' ? [] : [4 / z, 3 / z]);
    ctx.beginPath();
    if (h.typ === 'v') { ctx.moveTo(h.x, h.y1 - 12 / z); ctx.lineTo(h.x, h.y2 + 12 / z); }
    else if (h.typ === 'h') { ctx.moveTo(h.x1 - 12 / z, h.y); ctx.lineTo(h.x2 + 12 / z, h.y); }
    else ctx.arc(h.x, h.y, 5 / z, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

/* ------------------------------------------------------------ Fanghilfen */

/** Alle Eckpunkte der Seite, an denen sich neue Punkte ausrichten koennen. */
function fangPunkte(s, ausser) {
  const pts = [];
  for (const it of s.items) {
    if (it === ausser) continue;
    if (it.t === 'line') pts.push([it.x1, it.y1], [it.x2, it.y2]);
    else if (it.pts) pts.push(...it.pts);
    else if (it.w2 !== undefined) {
      const b = bbox(it);
      pts.push([b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]);
    } else if (it.x !== undefined) pts.push([it.x, it.y]);
    if (it.zx !== undefined) pts.push([it.zx, it.zy]);
  }
  if (state.pfad && state.pfad.seite === s) pts.push(...state.pfad.item.pts.slice(0, -1));
  if (state.linie && state.linie.seite === s) pts.push([state.linie.item.x1, state.linie.item.y1]);
  return pts;
}

/** Richtungen, an die sich eine neue Kante anlehnen kann: Achsen, 45 Grad und vorhandene Kanten. */
function fangWinkel(s) {
  const w = [0, Math.PI / 2, Math.PI / 4, -Math.PI / 4];
  for (const it of s.items) {
    if (it.t === 'line') w.push(Math.atan2(it.y2 - it.y1, it.x2 - it.x1));
    else if (it.t === 'poly') {
      for (let i = 0; i < it.pts.length; i++) {
        const a = it.pts[i], b = it.pts[(i + 1) % it.pts.length];
        w.push(Math.atan2(b[1] - a[1], b[0] - a[0]));
      }
    }
  }
  return w;
}

/**
 * Faengt einen Mauspunkt weich ein: erst die Richtung ab dem Anker
 * (waagerecht, senkrecht, 45 Grad oder parallel zu einer vorhandenen Kante),
 * dann ein naher Eckpunkt, dann gleiche X- oder Y-Lage wie ein vorhandener
 * Punkt. Mit Umschalt wird die Achse erzwungen. "ausser" nimmt das gerade
 * bearbeitete Objekt aus.
 */
function fange(s, p, anker, erzwinge, ausser, frei) {
  // Mit dem Finger oder Stift darf der Magnet etwas weiter greifen als mit der Maus
  const tolP = (touchGeraet ? 12 : FANG.punkt) / state.zoom, tolL = (touchGeraet ? 9 : FANG.linie) / state.zoom;
  const pts = fangPunkte(s, ausser);
  const hilfen = [];
  let x = p.x, y = p.y;
  const istAnker = (q) => anker && q[0] === anker.x && q[1] === anker.y;

  /*
   * Freie Vorlagen (Gewerkeflaechen) liegen punktgenau unter dem Zeiger, ohne
   * Winkel- und Achsenfang (Yann, 10.09.2026). Seit dem 12.09.2026 gilt nur
   * noch eine Ausnahme: Ganz nah an einem Eckpunkt oder einer Kante eines
   * vorhandenen Polygons dockt der Punkt an ("ganz simpel an ein bestehendes
   * andocken koennen"), sonst bleibt er, wo er ist.
   */
  if (frei && !erzwinge) {
    const m = magnet(s, p, pts, ausser, tolP, tolL, istAnker);
    return m ? { x: m.x, y: m.y, hilfen: [{ typ: 'punkt', x: m.x, y: m.y }] } : { x: p.x, y: p.y, hilfen: [] };
  }

  let fest = null;
  if (anker) {
    const dx = p.x - anker.x, dy = p.y - anker.y;
    if (Math.hypot(dx, dy) > tolP) {
      const a = Math.atan2(dy, dx);
      const kandidaten = erzwinge ? [0, Math.PI / 2] : fangWinkel(s);
      let best = null, bd = erzwinge ? Infinity : (FANG.winkel * Math.PI) / 180;
      for (const k of kandidaten) {
        let d = Math.abs(((a - k) % Math.PI + Math.PI) % Math.PI);
        d = Math.min(d, Math.PI - d);
        if (d < bd) { bd = d; best = k; }
      }
      if (best !== null) {
        const cx = Math.cos(best), cy = Math.sin(best);
        const tt = dx * cx + dy * cy;
        x = anker.x + tt * cx; y = anker.y + tt * cy;
        fest = Math.abs(cy) < 1e-6 ? 'y' : Math.abs(cx) < 1e-6 ? 'x' : 'schraeg';
      }
    }
  }

  if (!erzwinge) {
    // Eckpunkt oder Kante eines vorhandenen Objekts in Reichweite: andocken
    const m = magnet(s, p, pts, ausser, tolP, tolL, istAnker);
    if (m) {
      hilfen.push({ typ: 'punkt', x: m.x, y: m.y });
      return { x: m.x, y: m.y, hilfen };
    }
  }

  if (fest !== 'schraeg') {
    const naechsteKoordinate = (achse, wert) => {
      let q = null, nd = tolL;
      for (const k of pts) {
        if (istAnker(k)) continue;
        const d = Math.abs(k[achse] - wert);
        if (d < nd) { nd = d; q = k; }
      }
      return q;
    };
    if (fest !== 'x') {
      const q = naechsteKoordinate(0, x);
      if (q) { x = q[0]; hilfen.push({ typ: 'v', x, y1: Math.min(y, q[1]), y2: Math.max(y, q[1]) }); }
    }
    if (fest !== 'y') {
      const q = naechsteKoordinate(1, y);
      if (q) { y = q[1]; hilfen.push({ typ: 'h', y, x1: Math.min(x, q[0]), x2: Math.max(x, q[0]) }); }
    }
  }

  // Im Grundriss rastet, was sonst nirgends angedockt hat, auf das 5-mm-Raster
  if (state.reiter === 'grundriss' && fest !== 'schraeg') {
    const g = RASTER.klein;
    if (fest !== 'x' && !hilfen.some((h) => h.typ === 'v')) x = Math.round(x / g) * g;
    if (fest !== 'y' && !hilfen.some((h) => h.typ === 'h')) y = Math.round(y / g) * g;
  }
  return { x, y, hilfen };
}

/**
 * Der Magnet: zuerst der naechste Eckpunkt in Reichweite, sonst der naechste
 * Punkt auf einer Kante eines Polygons oder einer Geraden. Liefert null, wenn
 * nichts nah genug liegt. Der Anker (letzter fester Punkt) zaehlt nicht,
 * sonst klebte die neue Kante an ihrem eigenen Anfang.
 */
function magnet(s, p, pts, ausser, tolP, tolL, istAnker) {
  let best = null, bd = tolP;
  for (const q of pts) {
    if (istAnker(q)) continue;
    const d = Math.hypot(q[0] - p.x, q[1] - p.y);
    if (d < bd) { bd = d; best = { x: q[0], y: q[1] }; }
  }
  if (best) return best;
  bd = tolL;
  const pruefe = (a, b) => {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy;
    if (!l2) return;
    const t = Math.max(0, Math.min(1, ((p.x - a[0]) * dx + (p.y - a[1]) * dy) / l2));
    const x = a[0] + t * dx, y = a[1] + t * dy;
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < bd) { bd = d; best = { x, y }; }
  };
  for (const it of s.items) {
    if (it === ausser) continue;
    if (it.t === 'line') pruefe([it.x1, it.y1], [it.x2, it.y2]);
    else if (it.t === 'poly') for (let i = 0; i < it.pts.length; i++) pruefe(it.pts[i], it.pts[(i + 1) % it.pts.length]);
    else if (it.t === 'rect') {
      const e = ecken(bbox(it));
      pruefe(e[0], e[1]); pruefe(e[1], e[3]); pruefe(e[3], e[2]); pruefe(e[2], e[0]);
    }
  }
  return best;
}

/** Der Bezugspunkt fuer die Richtung: Anfang der Linie oder letzter fester Polygonpunkt. */
function ankerFuer(s) {
  if (state.linie && state.linie.seite === s) return state.linie.start;
  if (state.pfad && state.pfad.seite === s) {
    const pts = state.pfad.item.pts;
    return { x: pts[pts.length - 2][0], y: pts[pts.length - 2][1] };
  }
  return null;
}

/* ---------------------------------------------------------- Interaktionen */

function punkt(s, e) {
  const r = s.cInk.getBoundingClientRect();
  return { x: (e.clientX - r.left) / state.zoom, y: (e.clientY - r.top) / state.zoom };
}

/** Doppelklick oder Doppeltipp auf dem Blatt: Text bearbeiten oder Polygon schliessen. */
function doppeltipp(s) {
  const it = state.auswahl && state.auswahl.seite === s && state.auswahl.item;
  if (state.tool === 'auswahl' && it && (it.t === 'text' || it.t === 'callout')) { bearbeiteText(s, it); return; }
  if (state.pfad && state.pfad.seite === s) beendePfad(true);
}

function verdrahteSeite(s) {
  const c = s.cInk;
  let modus = null, start = null, alt = null;
  const finger = new Map();   // aktive Touch-Zeiger auf diesem Blatt
  let geste = null;           // Zwei-Finger-Geste: schieben und zoomen
  let pan = null;             // Ein-Finger-Schieben in der Hand auf leerer Stelle
  let punktGesetzt = false;   // dieser Fingerdruck hat gerade einen Polygonpunkt gesetzt

  const mitte = () => { const [a, b] = [...finger.values()]; return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) }; };

  /** Zweiter Finger: laufende Einfinger-Aktion zuruecknehmen, Geste starten. */
  const starteGeste = () => {
    if (modus === 'zeichnen') s.entwurf = null;
    modus = null; pan = null;
    if (state.linie && state.linie.seite === s) beendeLinie(false);
    if (punktGesetzt && state.pfad && state.pfad.seite === s) {
      const pts = state.pfad.item.pts;
      if (pts.length > 2) pts.splice(pts.length - 2, 1);
      if (pts.length <= 2) beendePfad(false);
    }
    s.hilfen = [];
    const m = mitte();
    const r = el.seiten.getBoundingClientRect();
    el.seiten.style.transformOrigin = `${m.x - r.left}px ${m.y - r.top}px`;
    geste = { m, scrollLeft: el.ansicht.scrollLeft, scrollTop: el.ansicht.scrollTop, faktor: 1 };
    zeichneSeite(s);
  };

  const beendeGeste = () => {
    const g = geste;
    geste = null;
    el.seiten.style.transform = '';
    if (Math.abs(g.faktor - 1) > 0.03) {
      const r = el.ansicht.getBoundingClientRect();
      const mx = g.m.x - r.left + el.ansicht.scrollLeft, my = g.m.y - r.top + el.ansicht.scrollTop;
      setzeZoom(state.zoom * g.faktor);
      el.ansicht.scrollLeft = mx * g.faktor - (g.m.x - r.left);
      el.ansicht.scrollTop = my * g.faktor - (g.m.y - r.top);
    }
  };

  c.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    // Keine Maus-Ersatzereignisse: der Fokus bleibt im Textfeld, der Browser scrollt und zoomt nicht selbst
    e.preventDefault();
    try { c.setPointerCapture(e.pointerId); } catch (err) { /* synthetische Ereignisse */ }

    if (e.pointerType === 'touch') {
      finger.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (finger.size === 2) { starteGeste(); return; }
      if (finger.size > 2 || geste) return;
    }

    // Ein Klick ins Blatt, waehrend ein Textfeld offen ist, schliesst nur das Textfeld
    const offen = document.querySelector('.text-eingabe');
    if (offen) { offen.blur(); return; }

    // Doppelklick und Doppeltipp selbst erkennen (dblclick kommt nach preventDefault nicht mehr)
    const jetzt = performance.now();
    // Der Doppeltipp zaehlt nur, wenn der erste Tipp nichts abgeschlossen hat: wer eine
    // Wand beendet und sofort am selben Punkt die naechste beginnt, soll nicht ausgebremst werden.
    const lt = s.letzterTipp;
    const doppelt = lt && jetzt - lt.t < 350 && Math.hypot(e.clientX - lt.x, e.clientY - lt.y) < 24;
    s.letzterTipp = { t: jetzt, x: e.clientX, y: e.clientY };
    if (doppelt) { s.letzterTipp = null; doppeltipp(s); return; }

    state.aktiveSeite = state.seiten.indexOf(s);
    markiereAktiveMini();
    let p = punkt(s, e);
    punktGesetzt = false;
    const griffRadius = (e.pointerType === 'mouse' ? 9 : 16) / state.zoom;

    if (state.tool === 'lasso') {
      modus = 'lasso';
      s.lasso = [[p.x, p.y]];
      state.auswahl = null;
      zeichneAlles();
      return;
    }

    if (state.tool === 'auswahl') {
      const a = state.auswahl;
      if (a && a.seite === s) {
        const ctx2 = c.getContext('2d');
        if (a.items.length > 1) {
          // Gruppe: Eckgriff skaliert alles, ein Griff in die Box verschiebt alles
          const g = gruppenBox(a.items, ctx2);
          const idx = ecken(g).findIndex(([x, y]) => Math.hypot(p.x - x, p.y - y) < griffRadius);
          if (idx >= 0) { schnappschuss(); modus = 'skalieren'; start = p; alt = { ...g }; a.ecke = idx; return; }
          if (p.x >= g.x && p.x <= g.x + g.w && p.y >= g.y && p.y <= g.y + g.h) { schnappschuss(); modus = 'schieben'; start = p; return; }
        } else {
          const it = a.item;
          if (state.zuschnitt && it.t === 'img') {
            // Zuschneiden: ein Griff an Ecke oder Kante schneidet, alles andere verschiebt
            const b = bbox(it, ctx2);
            const zi = zuschnittGriffe(b).findIndex(([x, y]) => Math.hypot(p.x - x, p.y - y) < griffRadius);
            if (zi >= 0) {
              schnappschuss();
              modus = 'zuschneiden'; start = p;
              alt = { x: it.x, y: it.y, w2: it.w2, h2: it.h2, sx: it.sx, sy: it.sy, sw: it.sw, sh: it.sh, griff: ZUSCHNITT_GRIFFE[zi] };
              return;
            }
          }
          const idx = griffe(it, ctx2).findIndex(([x, y]) => Math.hypot(p.x - x, p.y - y) < griffRadius);
          if (idx >= 0) {
            schnappschuss();
            if (istPunktgriff(it, idx)) {
              modus = 'punkt'; a.punkt = idx;
            } else {
              modus = 'skalieren'; start = p; alt = { ...bbox(it, ctx2) }; a.ecke = idx;
            }
            return;
          }
        }
      }
      const treffer = [...s.items].reverse().find((it) => trefferTest(it, p.x, p.y, c.getContext('2d')));
      state.auswahl = treffer ? auswahlVon(s, [treffer]) : null;
      if (treffer) { schnappschuss(); modus = 'schieben'; start = p; }
      else if (e.pointerType === 'touch') pan = { x: e.clientX, y: e.clientY, scrollLeft: el.ansicht.scrollLeft, scrollTop: el.ansicht.scrollTop };
      zeichneAlles();
      return;
    }

    const v = state.vorlage;
    if (!v) return;
    const f = fange(s, p, ankerFuer(s), e.shiftKey, null, v.frei);
    p = { x: f.x, y: f.y };
    s.hilfen = [];
    switch (state.tool) {
      case 'linie': linieKlick(s, p); return;
      case 'polygon':
        // Der erste Punkt sitzt sofort, damit die Kante gleich mitlaeuft. Jeder
        // weitere wird erst beim Abheben gesetzt: Solange Stift oder Finger
        // aufliegen, zeigt die Vorschaukante, wo er landen wuerde (Yann,
        // 12.09.2026: "ich muss immer einen Punkt anklicken und erst im
        // Nachhinein wird die Linie gezogen"). Ein schwebender Stift (iPad
        // Pro mit Pencil) bewegt die Vorschau schon vor dem Aufsetzen.
        if (!state.pfad || state.pfad.seite !== s) { pfadKlick(s, p); punktGesetzt = true; return; }
        modus = 'punkt-setzen';
        state.pfad.item.pts[state.pfad.item.pts.length - 1] = [p.x, p.y];
        zeichneSeite(s);
        return;
      case 'text': textEingabe(s, p.x, p.y); return;
      case 'callout': setzeCallout(s, p); return;
      case 'kreuz': {
        schnappschuss();
        const it = { t: 'kreuz', x: p.x, y: p.y, g: 9, c: v.color, w: wertVon(v), o: 1, v: v.id };
        s.items.push(it);
        nachErstellen(s, it);
        return;
      }
      case 'rechteck':
        modus = 'zeichnen'; start = p;
        s.entwurf = { t: 'rect', x: p.x, y: p.y, w2: 0, h2: 0, c: v.color, w: wertVon(v), o: 1, fill: v.fill, fillOpacity: v.fillOpacity ?? 1, v: v.id };
        return;
    }
  });

  c.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch' && finger.has(e.pointerId)) finger.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (geste) {
      if (finger.size >= 2) {
        const m = mitte();
        el.ansicht.scrollLeft = geste.scrollLeft - (m.x - geste.m.x);
        el.ansicht.scrollTop = geste.scrollTop - (m.y - geste.m.y);
        geste.faktor = Math.max(0.3, Math.min(4, m.d / geste.m.d));
        el.seiten.style.transform = `scale(${geste.faktor})`;
      }
      return;
    }
    if (pan) {
      el.ansicht.scrollLeft = pan.scrollLeft - (e.clientX - pan.x);
      el.ansicht.scrollTop = pan.scrollTop - (e.clientY - pan.y);
      return;
    }
    const p = punkt(s, e);
    if (modus === 'lasso') {
      s.lasso.push([p.x, p.y]);
      zeichneSeite(s);
      return;
    }
    if (state.pfad && state.pfad.seite === s) {
      const f = fange(s, p, ankerFuer(s), e.shiftKey, null, state.pfad.item.frei);
      const pts = state.pfad.item.pts;
      pts[pts.length - 1] = [f.x, f.y];
      s.hilfen = f.hilfen;
      zeichneSeite(s);
      return;
    }
    if (state.linie && state.linie.seite === s) {
      const f = fange(s, p, state.linie.start, e.shiftKey);
      state.linie.item.x2 = f.x; state.linie.item.y2 = f.y;
      s.hilfen = f.hilfen;
      zeichneSeite(s);
      return;
    }
    if (modus === 'zeichnen') {
      const it = s.entwurf;
      const f = fange(s, p, null, false);
      it.w2 = f.x - it.x; it.h2 = f.y - it.y;
      s.hilfen = f.hilfen;
      if (e.shiftKey) { const q = Math.max(Math.abs(it.w2), Math.abs(it.h2)); it.w2 = Math.sign(it.w2) * q; it.h2 = Math.sign(it.h2) * q; s.hilfen = []; }
      zeichneSeite(s);
    } else if (modus === 'punkt') {
      // Einzelnen Punkt ziehen, mit Fang an Nachbarn und fremden Punkten
      const it = state.auswahl.item;
      const i = state.auswahl.punkt;
      let anker = null;
      if (it.t === 'poly') { const n = it.pts[(i + it.pts.length - 1) % it.pts.length]; anker = { x: n[0], y: n[1] }; }
      else if (it.t === 'line') anker = { x: i === 0 ? it.x2 : it.x1, y: i === 0 ? it.y2 : it.y1 };
      const f = fange(s, p, anker, e.shiftKey, it, it.frei);
      if (it.t === 'poly') { it.pts[i][0] = f.x; it.pts[i][1] = f.y; }
      else if (it.t === 'line' && i === 0) { it.x1 = f.x; it.y1 = f.y; }
      else if (it.t === 'line') { it.x2 = f.x; it.y2 = f.y; }
      else if (it.t === 'callout') { it.zx = f.x; it.zy = f.y; }
      s.hilfen = f.hilfen;
      zeichneSeite(s);
    } else if (modus === 'zuschneiden') {
      // Der Bildinhalt bleibt liegen, nur der sichtbare Ausschnitt wandert mit
      // dem Griff. Nach aussen gezogen kommt Verdecktes bis zum Bildrand zurueck.
      const it = state.auswahl.item;
      const bild = state.bilder[it.bild];
      const natW = (bild && bild.el && bild.el.naturalWidth) || 1;
      const natH = (bild && bild.el && bild.el.naturalHeight) || 1;
      const q = { sx: alt.sx ?? 0, sy: alt.sy ?? 0, sw: alt.sw ?? natW, sh: alt.sh ?? natH };
      const kx = alt.w2 / q.sw, ky = alt.h2 / q.sh; // Seitenpunkte je Bildpixel
      const minX = alt.x - q.sx * kx, minY = alt.y - q.sy * ky;
      const maxX = minX + natW * kx, maxY = minY + natH * ky;
      const klemme = (v, a, b) => Math.max(a, Math.min(b, v));
      const g = alt.griff, mind = 12 / state.zoom;
      let x1 = alt.x, y1 = alt.y, x2 = alt.x + alt.w2, y2 = alt.y + alt.h2;
      if (g.l) x1 = klemme(p.x, minX, x2 - mind);
      if (g.r) x2 = klemme(p.x, x1 + mind, maxX);
      if (g.t) y1 = klemme(p.y, minY, y2 - mind);
      if (g.b) y2 = klemme(p.y, y1 + mind, maxY);
      it.x = x1; it.y = y1; it.w2 = x2 - x1; it.h2 = y2 - y1;
      it.sx = (x1 - minX) / kx; it.sy = (y1 - minY) / ky;
      it.sw = it.w2 / kx; it.sh = it.h2 / ky;
      zeichneSeite(s);
    } else if (modus === 'schieben') {
      for (const it of state.auswahl.items) verschiebe(it, p.x - start.x, p.y - start.y);
      start = p;
      zeichneSeite(s);
    } else if (modus === 'skalieren') {
      // Einzeln oder als Gruppe: alle Objekte werden durch dieselbe Box-Abbildung gezogen
      const items = state.auswahl.items;
      const b = gruppenBox(items, c.getContext('2d'));
      const feste = ecken(alt)[3 - state.auswahl.ecke];
      const neu = {
        x: Math.min(feste[0], p.x), y: Math.min(feste[1], p.y),
        w: Math.max(2, Math.abs(p.x - feste[0])), h: Math.max(2, Math.abs(p.y - feste[1])),
      };
      for (const it of items) skaliere(it, b, neu);
      zeichneSeite(s);
    }
  });

  const ende = (e) => {
    if (e.pointerType === 'touch') finger.delete(e.pointerId);
    if (geste) { if (finger.size < 2) beendeGeste(); return; }
    if (pan) { pan = null; return; }
    punktGesetzt = false;
    if (modus === 'lasso') {
      const pfad = s.lasso;
      s.lasso = null;
      modus = null;
      const ctx2 = c.getContext('2d');
      const drin = pfad.length >= 3
        ? s.items.filter((it) => { const b = bbox(it, ctx2); return inPolygon(b.x + b.w / 2, b.y + b.h / 2, pfad); })
        : [];
      waehleAuswahl();
      state.auswahl = drin.length ? auswahlVon(s, drin) : null;
      zeichneAlles();
      melde(drin.length
        ? `${drin.length} Objekt${drin.length > 1 ? 'e' : ''} markiert. Gemeinsam verschieben, an den Ecken skalieren, Entf löscht.`
        : 'Nichts eingekreist. Lasso erneut wählen oder mit der Hand einzeln greifen.');
      return;
    }
    const p = punkt(s, e);
    // Polygon: der Punkt sitzt erst beim Abheben, dort wo die Vorschau zuletzt lag.
    // Ein abgebrochener Zeiger (zweiter Finger, Systemgeste) setzt nichts.
    if (modus === 'punkt-setzen') {
      modus = null;
      if (e.type === 'pointerup' && state.pfad && state.pfad.seite === s) {
        const f = fange(s, p, ankerFuer(s), e.shiftKey, null, state.pfad.item.frei);
        s.hilfen = [];
        pfadKlick(s, { x: f.x, y: f.y });
      } else if (state.pfad && state.pfad.seite === s) {
        s.hilfen = [];
        zeichneSeite(s);
      }
      return;
    }
    // Eine gezogene Gerade ist mit dem Loslassen fertig, ein blosser Klick wartet auf den zweiten
    if (state.linie && state.linie.seite === s && Math.hypot(p.x - state.linie.start.x, p.y - state.linie.start.y) > 4 / state.zoom) {
      const f = fange(s, p, state.linie.start, e.shiftKey);
      state.linie.item.x2 = f.x; state.linie.item.y2 = f.y;
      beendeLinie(true);
    }
    if (modus === 'zeichnen' && s.entwurf) {
      const it = s.entwurf;
      s.entwurf = null;
      s.hilfen = [];
      if (Math.abs(it.w2) >= 3 || Math.abs(it.h2) >= 3) {
        schnappschuss();
        s.items.push(it);
        modus = null;
        nachErstellen(s, it);
        return;
      }
      zeichneSeite(s);
    }
    if (modus === 'punkt') s.hilfen = [];
    if (modus) { modus = null; zeichneAlles(); }
  };
  c.addEventListener('pointerup', ende);
  c.addEventListener('pointercancel', ende);
  // Rechtsklick wechselt direkt auf die Hand
  c.addEventListener('contextmenu', (e) => { e.preventDefault(); waehleAuswahl(); });
}

/* ------------------------------------------------------- Gerade (Strich) */

/**
 * Erster Klick setzt den Anfang, die Linie folgt dem Mauszeiger, der zweite
 * Klick setzt das Ende (beide Punkte kommen bereits gefangen an).
 */
function linieKlick(s, p) {
  if (state.linie && state.linie.seite === s) {
    state.linie.item.x2 = p.x; state.linie.item.y2 = p.y;
    beendeLinie(true);
    return;
  }
  beendeLinie(false);
  const v = state.vorlage;
  const item = { t: 'line', x1: p.x, y1: p.y, x2: p.x, y2: p.y, c: v.color, w: wertVon(v), o: 1, cap: v.cap || 'round', pfeile: !!v.pfeile, v: v.id };
  state.linie = { seite: s, item, start: p };
  s.entwurf = item;
  zeichneSeite(s);
}

function beendeLinie(nehmen) {
  if (!state.linie) return;
  const { seite, item } = state.linie;
  state.linie = null;
  seite.entwurf = null;
  seite.hilfen = [];
  if (nehmen && Math.hypot(item.x2 - item.x1, item.y2 - item.y1) >= 2) {
    schnappschuss();
    seite.items.push(item);
    nachErstellen(seite, item);
    return;
  }
  zeichneSeite(seite);
  markiereVorlage();
}

/* ----------------------------------------------------------------- Polygon */

/**
 * Ein Klick im Polygonwerkzeug. Der letzte Punkt der Liste ist immer der
 * Vorschaupunkt unter dem Mauszeiger, deshalb wird er beim Setzen festgenagelt
 * und ein neuer angehaengt.
 */
function pfadKlick(s, p) {
  if (!state.pfad || state.pfad.seite !== s) {
    beendePfad(true);
    const v = state.vorlage;
    const item = { t: 'poly', pts: [[p.x, p.y], [p.x, p.y]], c: v.color, w: wertVon(v), o: 1, fill: v.fill, fillOpacity: v.fillOpacity ?? 1, v: v.id, frei: !!v.frei };
    state.pfad = { seite: s, item };
    s.entwurf = item;
    zeichneSeite(s);
    return;
  }
  const item = state.pfad.item;
  const [sx, sy] = item.pts[0];
  if (item.pts.length >= 4 && Math.hypot(p.x - sx, p.y - sy) < (touchGeraet ? 16 : 10) / state.zoom) {
    beendePfad(true);
    return;
  }
  item.pts[item.pts.length - 1] = [p.x, p.y];
  item.pts.push([p.x, p.y]);
  zeichneSeite(s);
}

/** Schliesst das laufende Polygon ab. Mit weniger als drei Punkten wird es verworfen. */
function beendePfad(nehmen) {
  if (!state.pfad) return;
  const { seite, item } = state.pfad;
  state.pfad = null;
  seite.entwurf = null;
  seite.hilfen = [];
  item.pts.pop(); // Vorschaupunkt unter dem Mauszeiger
  if (nehmen && item.pts.length >= 3) {
    schnappschuss();
    seite.items.push(item);
    nachErstellen(seite, item);
    return;
  }
  zeichneSeite(seite);
  markiereVorlage();
}

/* ------------------------------------------------------------------- Text */

/**
 * Ein Eingabefeld direkt auf der Seite. Mit "breite" bricht der Text wie im
 * fertigen Objekt um, ohne waechst das Feld mit der Zeile. Enter oder ein
 * Klick ins Blatt uebernimmt, Esc verwirft.
 */
function eingabefeld(s, lage, fertig) {
  const ta = document.createElement('textarea');
  ta.className = 'text-eingabe';
  ta.rows = 1;
  ta.value = lage.wert || '';
  ta.style.left = lage.x * state.zoom + 'px';
  ta.style.top = lage.y * state.zoom + 'px';
  ta.style.fontSize = lage.size * state.zoom + 'px';
  ta.style.lineHeight = '1.25';
  ta.style.color = lage.color;
  if (lage.breite) { ta.style.width = lage.breite * state.zoom + 'px'; }
  else { ta.style.whiteSpace = 'pre'; ta.wrap = 'off'; }
  s.el.appendChild(ta);
  const passeHoeheAn = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; };
  // Sofort fokussieren: das iPad oeffnet die Tastatur nur innerhalb der Nutzergeste.
  // Der ausloesende Klick kann den Fokus nicht mehr wegnehmen, weil pointerdown auf
  // dem Blatt die Maus-Ersatzereignisse unterdrueckt.
  ta.focus();
  setTimeout(() => { ta.focus(); ta.select(); passeHoeheAn(); }, 0);
  let erledigt = false;
  const schliessen = (nehmen) => {
    if (erledigt) return;
    erledigt = true;
    const txt = ta.value.trim();
    ta.remove();
    fertig(nehmen ? txt : null);
    zeichneSeite(s);
  };
  ta.addEventListener('blur', () => schliessen(true));
  ta.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); schliessen(false); }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); schliessen(true); }
  });
  ta.addEventListener('input', passeHoeheAn);
}

function textEingabe(s, x, y) {
  const v = state.vorlage;
  const size = wertVon(v);
  eingabefeld(s, { x, y, size, color: v.color }, (txt) => {
    if (!txt) return;
    schnappschuss();
    const it = { t: 'text', x, y, s: txt, c: v.color, bg: v.bg || null, size, o: 1, v: v.id };
    s.items.push(it);
    nachErstellen(s, it);
  });
}

/**
 * Textfeld mit Pfeil: der Klick ist die Pfeilspitze, das Feld erscheint sofort
 * versetzt daneben und ist markiert. Erst verschieben, dann per Doppelklick
 * oder Enter beschreiben (Yann, 10.09.2026).
 */
function setzeCallout(s, p) {
  const v = state.vorlage;
  const size = wertVon(v);
  const w2 = 130;
  let x = p.x + 30, y = p.y - 60;
  if (x + w2 > s.breite - 6) x = p.x - 30 - w2;
  if (y < 6) y = p.y + 30;
  schnappschuss();
  const it = { t: 'callout', zx: p.x, zy: p.y, x, y, w2, h2: size * 1.25 + 2 * POLSTER, s: '', c: v.color, fill: v.fill, w: v.width, size, o: 1, v: v.id };
  s.items.push(it);
  nachErstellen(s, it);
}

/** Text oder Textfeld nachtraeglich beschreiben (Doppelklick oder Enter in der Hand). */
function bearbeiteText(s, it) {
  const lage = it.t === 'callout'
    ? { x: it.x + POLSTER, y: it.y + POLSTER, size: it.size, color: it.c, breite: it.w2 - 2 * POLSTER, wert: it.s }
    : { x: it.x, y: it.y, size: it.size, color: it.c, wert: it.s };
  eingabefeld(s, lage, (txt) => {
    if (txt === null || txt === it.s) return;
    schnappschuss();
    if (!txt && it.t === 'text') { s.items = s.items.filter((i) => i !== it); state.auswahl = null; return; }
    it.s = txt;
    if (it.t === 'callout') it.h2 = 0; // Hoehe richtet sich beim Zeichnen neu nach dem Text
  });
}

/* ----------------------------------------------------------------- Fotos */

function ladeBild(id, src) {
  const bild = { src, el: new Image() };
  bild.el.onload = () => zeichneAlles();
  bild.el.src = src;
  state.bilder[id] = bild;
  return bild;
}

/** Ein Foto in das bestehende Dokument setzen. Es wird nie etwas ersetzt. */
function fotoDialog() {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = 'image/*';
  inp.onchange = () => {
    const datei = inp.files && inp.files[0];
    if (!datei) return;
    if (!state.seiten.length) leeresDokument();
    setzeFoto(datei, state.seiten[state.aktiveSeite], null);
  };
  inp.click();
}

/** Setzt ein Foto auf die Seite, mittig oder an der Ablageposition, und nimmt es in die Hand. */
function setzeFoto(datei, seite, pos) {
  const leser = new FileReader();
  leser.onload = () => {
    const id = 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const bild = ladeBild(id, leser.result);
    bild.el.onload = () => {
      const skala = Math.min((seite.breite * 0.45) / bild.el.width, (seite.hoehe * 0.4) / bild.el.height);
      const w = bild.el.width * skala, h = bild.el.height * skala;
      const x = pos ? pos.x - w / 2 : (seite.breite - w) / 2;
      const y = pos ? pos.y - h / 2 : (seite.hoehe - h) / 2;
      schnappschuss();
      const it = { t: 'img', bild: id, x: Math.max(0, x), y: Math.max(0, y), w2: w, h2: h, rahmen: true, c: '#FFFFFF', w: 2, o: 1 };
      seite.items.push(it);
      state.fest = false;
      nachErstellen(seite, it);
      melde('Foto eingesetzt. Mit den Eckpunkten skalieren, mit der Maus verschieben.');
    };
  };
  leser.readAsDataURL(datei);
}

/* --------------------------------------------------------- Verlauf, Zoom */

function schnappschuss() {
  state.verlauf.push(JSON.stringify(state.seiten.map((s) => s.items)));
  if (state.verlauf.length > 80) state.verlauf.shift();
  state.zukunft = [];
}

function stelleWieder(quelle, ziel) {
  if (!quelle.length) return;
  beendePfad(false);
  beendeLinie(false);
  ziel.push(JSON.stringify(state.seiten.map((s) => s.items)));
  const daten = JSON.parse(quelle.pop());
  daten.forEach((items, i) => { if (state.seiten[i]) state.seiten[i].items = items; });
  state.auswahl = null;
  zeichneAlles();
}

function setzeZoom(z) {
  state.zoom = Math.max(0.25, Math.min(5, z));
  rendereAlleSeiten();
}

/** Zeigt genau eine ganze Seite. */
function passeSeiteAn() {
  if (!state.seiten.length) return;
  const s = state.seiten[state.aktiveSeite] || state.seiten[0];
  const z = Math.min((el.ansicht.clientWidth - 48) / s.breite, (el.ansicht.clientHeight - 60) / s.hoehe);
  setzeZoom(z);
  if (s.el) s.el.scrollIntoView({ block: 'start' });
}

function markiereAktiveMini() {
  state.seiten.forEach((s, i) => s.mini && s.mini.classList.toggle('aktiv', i === state.aktiveSeite));
}

function loescheAuswahl() {
  if (!state.auswahl) return;
  schnappschuss();
  const s = state.auswahl.seite;
  s.items = s.items.filter((i) => !state.auswahl.items.includes(i));
  state.auswahl = null;
  zeichneAlles();
}

/* -------------------------------------------------------------- Dateien */

async function nimmDateien(dateien, ablage) {
  for (const f of dateien) {
    if (f.type === 'application/pdf') {
      if (!darfErsetzen()) { melde('Öffnen abgebrochen, das bestehende Dokument bleibt.'); return; }
      await ladePdf(new Uint8Array(await f.arrayBuffer()), f.name);
      melde(`${f.name} geöffnet – ${state.seiten.length} Seite(n).`);
    } else if (f.type.startsWith('image/')) {
      // Bilder kommen immer hinzu, sie ersetzen nie etwas
      if (!state.seiten.length) leeresDokument();
      const ziel = ablage || { seite: state.seiten[state.aktiveSeite], pos: null };
      setzeFoto(f, ziel.seite, ziel.pos);
    }
  }
}

/** Auf welcher Seite und an welcher Stelle eine Datei abgelegt wurde. */
function ablageZiel(e) {
  for (const s of state.seiten) {
    const r = s.cInk.getBoundingClientRect();
    if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
      return { seite: s, pos: { x: (e.clientX - r.left) / state.zoom, y: (e.clientY - r.top) / state.zoom } };
    }
  }
  return null;
}

/* ----------------------------------------------------------------- Start */

ladeEinstellungen();
baueVorlagen('gewerke');
waehleAuswahl();

for (const k of $('reiter').querySelectorAll('.reiter-knopf')) {
  k.onclick = () => {
    $('reiter').querySelectorAll('.reiter-knopf').forEach((x) => x.classList.toggle('aktiv', x === k));
    baueVorlagen(k.dataset.reiter);
    if (k.dataset.reiter === 'grundriss') melde('Grundriss: Raster 5 mm eingeblendet, Punkte rasten darauf ein.');
  };
}

$('btn-oeffnen').onclick = $('btn-oeffnen-2').onclick = () => $('datei-input').click();
$('btn-leer').onclick = blattAnhaengen;
$('btn-leer-2').onclick = () => { leeresDokument(); melde('Leeres A4-Blatt angelegt.'); };
$('btn-foto').onclick = fotoDialog;
$('datei-input').onchange = (e) => { nimmDateien(e.target.files); e.target.value = ''; };
$('btn-auswahl').onclick = waehleAuswahl;
$('btn-lasso').onclick = waehleLasso;
$('btn-gruppe').onclick = gruppiere;
$('btn-zuschneiden').onclick = () => {
  const a = state.auswahl;
  if (!a || !a.item || a.item.t !== 'img') return;
  state.zuschnitt = !state.zuschnitt;
  zeichneAlles();
  melde(state.zuschnitt
    ? 'Zuschneiden: Ecken oder Kanten nach innen ziehen. Nach außen holt Verdecktes zurück. Fertig mit erneutem Tipp, Hand oder Esc.'
    : 'Zuschnitt übernommen.');
};
$('btn-einstellung').onclick = () => { if (state.vorlage) oeffneEinstellungen(state.vorlage, $('btn-einstellung')); };
$('btn-zuklappen').onclick = () => klappeLeiste(true);
$('btn-aufklappen').onclick = () => klappeLeiste(false);
$('btn-fixieren').onclick = () => {
  state.fixiert = !state.fixiert;
  speichereLeiste();
  klappeLeiste(false);
  melde(state.fixiert ? 'Vorlagenleiste bleibt offen.' : 'Vorlagenleiste klappt nach der Wahl einer Vorlage zu.');
};
klappeLeiste(false);
$('btn-loeschen').onclick = loescheAuswahl;
$('btn-undo').onclick = () => stelleWieder(state.verlauf, state.zukunft);
$('btn-redo').onclick = () => stelleWieder(state.zukunft, state.verlauf);
$('btn-zoom-plus').onclick = () => setzeZoom(state.zoom * 1.2);
$('btn-zoom-minus').onclick = () => setzeZoom(state.zoom / 1.2);
$('btn-seite').onclick = passeSeiteAn;
$('btn-speichern').onclick = async () => {
  if (!state.seiten.length) return;
  beendePfad(true);
  beendeLinie(false);
  melde('PDF wird geschrieben …');
  if (eingebettet) {
    // Die App bekommt die fertige Datei und entscheidet, was damit passiert
    const bytes = await baueDatei(state);
    const puffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    anApp({ typ: 'gespeichert', bytes: puffer, anzahl: anzahlObjekte(), name: state.dateiname }, [puffer]);
    state.verlauf = [];
    state.zukunft = [];
    melde('An die Prinzipskizze übergeben.');
    return;
  }
  const name = state.dateiname.replace(/\.pdf$/i, '') + ' (bearbeitet).pdf';
  await speichern(state, name);
  melde(`Gespeichert als ${name}. Markups bleiben im PDF bearbeitbar.`);
};

/* ------------------------------------------------------------ Eingebettet */

if (eingebettet) {
  document.body.classList.add('eingebettet');
  $('btn-schliessen').onclick = () => {
    beendePfad(true);
    beendeLinie(false);
    // Die App fragt nach, wenn ungespeicherte Aenderungen da sind
    anApp({ typ: 'schliessen', geaendert: state.verlauf.length > 0 });
  };
  window.addEventListener('message', async (e) => {
    if (e.source !== window.parent || e.origin !== window.location.origin) return;
    const n = e.data;
    if (!n || typeof n !== 'object') return;
    if (n.typ === 'oeffne') {
      await ladePdf(new Uint8Array(n.bytes), n.name || 'Prinzipskizze.pdf');
      melde(anzahlObjekte() ? 'Zeichnung geladen, weiter geht es.' : 'Rechts eine Vorlage wählen und auf dem Blatt zeichnen.');
    }
  });
  anApp({ typ: 'bereit' });
}

// Drag and Drop: PDF oeffnet, Bild landet auf der Seite unter dem Mauszeiger
let dragTiefe = 0;
window.addEventListener('dragenter', (e) => { e.preventDefault(); dragTiefe++; document.body.classList.add('ablage'); });
window.addEventListener('dragleave', () => { if (--dragTiefe <= 0) { dragTiefe = 0; document.body.classList.remove('ablage'); } });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragTiefe = 0;
  document.body.classList.remove('ablage');
  nimmDateien(e.dataTransfer.files, ablageZiel(e));
});

// Aus der Zwischenablage einfuegen
window.addEventListener('paste', (e) => {
  const dateien = [...(e.clipboardData?.items || [])]
    .filter((i) => i.kind === 'file' && i.type.startsWith('image/'))
    .map((i) => i.getAsFile());
  if (dateien.length) { e.preventDefault(); nimmDateien(dateien); }
});

// Tastatur
window.addEventListener('keydown', (e) => {
  if (['TEXTAREA', 'INPUT', 'SELECT'].includes(e.target.tagName)) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    if (offeneEinstellung) { schliesseEinstellungen(); return; }
    if (state.zuschnitt) { state.zuschnitt = false; zeichneAlles(); return; }
    if (state.pfad) { beendePfad(false); return; }
    if (state.linie) { beendeLinie(false); return; }
    if (state.tool !== 'auswahl') { waehleAuswahl(); return; }
    if (state.auswahl) { state.auswahl = null; zeichneAlles(); }
    return;
  }
  if (e.key === 'Enter') {
    if (state.pfad) { e.preventDefault(); beendePfad(true); return; }
    const a = state.auswahl;
    if (state.tool === 'auswahl' && a && a.item && (a.item.t === 'text' || a.item.t === 'callout')) { e.preventDefault(); bearbeiteText(a.seite, a.item); }
    return;
  }
  if (e.ctrlKey && e.key.toLowerCase() === 'z') { e.preventDefault(); stelleWieder(state.verlauf, state.zukunft); return; }
  if (e.ctrlKey && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) { e.preventDefault(); stelleWieder(state.zukunft, state.verlauf); return; }
  if (e.ctrlKey && e.key.toLowerCase() === 's') { e.preventDefault(); $('btn-speichern').click(); return; }
  if (e.key === 'Delete' || e.key === 'Backspace') { loescheAuswahl(); return; }
  if (!e.ctrlKey && !e.altKey && e.key.toLowerCase() === 'v') waehleAuswahl();
  if (!e.ctrlKey && !e.altKey && e.key.toLowerCase() === 'l') waehleLasso();
  if (!e.ctrlKey && !e.altKey && e.key.toLowerCase() === 'g') gruppiere();
});

// Strg + Mausrad zoomt
el.ansicht.addEventListener('wheel', (e) => {
  if (!e.ctrlKey) return;
  e.preventDefault();
  setzeZoom(state.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
}, { passive: false });

// Aktive Seite beim Scrollen mitfuehren
el.ansicht.addEventListener('scroll', () => {
  const mitte = el.ansicht.getBoundingClientRect().top + el.ansicht.clientHeight / 3;
  state.seiten.forEach((s, i) => {
    const r = s.el.getBoundingClientRect();
    if (r.top <= mitte && r.bottom >= mitte) { state.aktiveSeite = i; markiereAktiveMini(); }
  });
});

melde(eingebettet ? 'Zeichnung wird geladen …' : 'Bereit. PDF öffnen oder Datei ins Fenster ziehen, dann rechts eine Vorlage wählen.');

// Nur im Entwicklungsmodus: Zustand fuer die Fehlersuche in der Konsole
if (import.meta.env.DEV) window.__zt = state;
