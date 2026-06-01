import type { GeneticLevel } from '@uniome/shared';
import type { EntryModule, ModuleContext } from './types';
import { proteinDomainViewer } from './ProteinDomainViewer';

// All registered visualization modules. Add new ones here.
export const MODULES: EntryModule[] = [proteinDomainViewer];

// The modules that should render for a given level + entry, in registry order.
export function modulesForLevel(level: GeneticLevel, ctx: ModuleContext): EntryModule[] {
  return MODULES.filter((m) => m.level === level && m.isAvailable(ctx));
}
