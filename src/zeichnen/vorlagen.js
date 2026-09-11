// Vorlagen: die einzige Quelle fuer Zeichenwerkzeuge.
//
// Die Nutzer sollen nicht selbst gestalten, sondern feste Muster verwenden.
// Deshalb gibt es keine freie Werkzeugleiste mehr. Jede Vorlage bringt Farbe,
// Fuellung und Standardstaerke fest mit, lediglich die Strichdicke (beim Text
// die Schriftgroesse) laesst sich ueber das Zahnrad je Vorlage anpassen.
//
// Die Gewerke stammen aus der Legende der Prinzipskizze im Dokumentationstool
// (analysetermin-fotodoku, src/data/legende.ts). Farben, Reihenfolge und
// Bezeichnungen sind unveraendert, damit Zeichnung und Legende zusammenpassen.
// Der Reiter Aufmass enthaelt die aus Drawboard uebernommenen Hilfswerkzeuge.

/** Deckkraft der Flaechenfuellung bei den Gewerken, fest 25 % (Yann, 10.09.2026). */
const FLAECHEN_DECKKRAFT = 0.25;

// Formen der Legende. 'auto' heisst: Fuellung in der Gewerkefarbe.
// Strich = Grundriss und Querschnitt, Flaeche = Wand- und Balkonflaechen
// (Yann, 10.09.2026: kurze Namen, Strich 3, Polygonrand 1).
const balken = { schluessel: 'balken', name: 'Strich', tool: 'linie', width: 3, cap: 'square', nurSymbol: true };
// frei: true schaltet die Fanghilfen ab. Die Gewerkeflaeche muss punktgenau
// dort liegen, wo geklickt wird (Yann, 10.09.2026); Aufmass und Grundriss fangen weiter.
const flaeche = { schluessel: 'flaeche', name: 'Fläche', tool: 'polygon', width: 1, fill: 'auto', fillOpacity: FLAECHEN_DECKKRAFT, frei: true, nurSymbol: true };
const kreuz = { schluessel: 'kreuz', name: 'Wanddurchbruch', tool: 'kreuz', width: 2.5, nurSymbol: true };
// Drawboard-Callout: Pfeil auf einen Punkt, daran ein weisses Textfeld mit
// duenner schwarzer Umrandung. Der Text bricht an der Feldbreite um.
const hinweis = { schluessel: 'hinweis', name: 'Textfeld mit Pfeil', tool: 'callout', color: '#000000', fill: '#FFFFFF', width: 0.7, size: 11, einstellbar: 'size', nurSymbol: true };

// "kurz" ist der Anzeigename in der Leiste (wie das kurz-Feld der Legende),
// der volle Name bleibt als Tooltip erhalten.
export const GEWERKE = [
  { id: 'innenabdichtung', name: 'Innenabdichtung', farbe: '#2323ff', presets: [balken, flaeche] },
  { id: 'sanierputz', name: 'Sanierputz', farbe: '#e8801c', presets: [balken, flaeche] },
  { id: 'aussenabdichtung', name: 'Außenabdichtung', farbe: '#0a7d2e', presets: [balken, flaeche] },
  { id: 'balkon-pmma', name: 'Balkon (PMMA)', kurz: 'Balkon PMMA', farbe: '#6b0d7b', presets: [balken, flaeche] },
  { id: 'klimaplatte', name: 'Klimaplatte', farbe: '#efe000', presets: [balken, flaeche] },
  { id: 'balkon-kombiflex', name: 'Balkon (Kombiflex & Steinteppich)', kurz: 'Balkon Kombiflex', farbe: '#3366ff', presets: [balken, flaeche] },
  { id: 'bodenabdichtung', name: 'Bodenabdichtung', farbe: '#5b5bd6', presets: [flaeche] },
  { id: 'rissinjektion', name: 'Rissinjektion & Flexband', kurz: 'Rissinjektion', farbe: '#ff2d95', presets: [balken, flaeche] },
  { id: 'horizontalsperre', name: 'Horizontalsperre (Injektionscreme & Horizontalsperre)', kurz: 'Horizontalsperre', farbe: '#ff0000', presets: [balken] },
  { id: 'kellerbodensanierung', name: 'Kellerbodensanierung', kurz: 'Kellerboden', farbe: '#00d5d5', presets: [flaeche] },
  { id: 'sonstiges', name: 'Sonstiges', farbe: '#ff3b3b', presets: [kreuz, hinweis] },
];

// Aus Drawboard uebernommen: Masslinie (ShapeArrow mit Pfeil an beiden Enden,
// Staerke 1) und Textfeld Arial 11.
export const AUFMASS = {
  id: 'aufmass', name: 'Aufmaß', farbe: '#564A44',
  presets: [
    { schluessel: 'masslinie', name: 'Maßlinie', tool: 'linie', color: '#000000', width: 1, pfeile: true },
    { schluessel: 'text', name: 'Aufmaßtext', tool: 'text', color: '#000000', size: 11, einstellbar: 'size' },
    // Schwarze Schrift auf weissem Grund, damit der Text auf dunklen Planstellen lesbar bleibt
    { schluessel: 'text-weiss', name: 'Aufmaßtext (weiß)', tool: 'text', color: '#000000', bg: '#FFFFFF', size: 11, einstellbar: 'size' },
  ],
};

// Grundriss zeichnen: deckende Flaechen aus Drawboard (ShapePolygon FF646464
// als Grundflaeche, dann in Weiss die Raeume und als Rechteck Fenster und
// Tueren, Rand 0,1). Reihenfolge ist die Arbeitsreihenfolge.
export const GRUNDRISS = {
  id: 'grundriss', name: 'Grundriss', farbe: '#646464',
  presets: [
    { schluessel: 'grundflaeche', name: 'Grundfläche', tool: 'polygon', color: '#646464', width: 8, fill: '#646464', fillOpacity: 1 },
    { schluessel: 'raeume', name: 'Räume', tool: 'polygon', color: '#FFFFFF', width: 0.1, fill: '#FFFFFF', fillOpacity: 1 },
    { schluessel: 'fenster-tueren', name: 'Fenster/Türen', tool: 'rechteck', color: '#FFFFFF', width: 0.1, fill: '#FFFFFF', fillOpacity: 1 },
  ],
};

/** Fangabstaende in Bildschirmpixeln bzw. Grad. Nicht zu hart, aber gerade Arbeit moeglich. */
export const FANG = { punkt: 8, linie: 6, winkel: 5 };

/** Grenzen des Zahnrad-Reglers je einstellbarer Groesse. */
export const REGLER = {
  width: { name: 'Strichdicke', min: 0.1, max: 20, step: 0.1, einheit: 'pt' },
  size: { name: 'Schriftgröße', min: 6, max: 40, step: 1, einheit: 'pt' },
};
