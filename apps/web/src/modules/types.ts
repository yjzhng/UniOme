import type { FC } from 'react';
import type { Feature, GeneticLevel } from '@uniome/shared';

// Everything a visualization module needs to render itself for one entry.
export interface ModuleContext {
  feature: Feature;
  taxid: string;
}

// A pluggable visualization slotted into a genetic level of the entry page.
// New modules (RNA structure, gene-relationship graphs, …) just add an entry to
// the registry; the page renders whichever ones are available for the level.
export interface EntryModule {
  id: string;
  title: string;
  level: GeneticLevel;
  // Whether this module has something to show for the given entry (e.g. the
  // protein domain viewer needs a UniProt accession).
  isAvailable(ctx: ModuleContext): boolean;
  Component: FC<ModuleContext>;
}
