/**
 * Auswahlliste der Gewerke fuer das Sanierungskonzept auf dem Deckblatt.
 * Alphabetisch, damit die Liste im Aufklappmenue vorhersehbar bleibt.
 */
export const GEWERKE: string[] = [
  'Außenabdichtung',
  'Balkon - Kombiflex',
  // Bodenabdichtung kam am 08.09.2026 dazu: Sie steht in der Legende der
  // Prinzipskizze, war aber noch nicht auswaehlbar.
  'Bodenabdichtung',
  'Balkon - PMMA',
  'Balkon - Steinteppich',
  'Betoninstandsetzung',
  'Flexband',
  'Horizontalsperre',
  'Injektionscreme',
  'Innenabdichtung',
  'Kellerbodensanierung',
  'Klimaplatte',
  'Rissinjektion',
  'Sanierputz',
  'Sockelabdichtung',
  'Treppe',
].sort((a, b) => a.localeCompare(b, 'de'))
