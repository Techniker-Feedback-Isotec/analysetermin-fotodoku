/**
 * Auswahlliste der Gewerke fuer das Sanierungskonzept auf dem Deckblatt.
 * Alphabetisch, damit die Liste im Aufklappmenue vorhersehbar bleibt.
 */
export const GEWERKE: string[] = [
  'Außenabdichtung',
  'Balkon - Kombiflex',
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
