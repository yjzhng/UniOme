import type { GeneticLevel } from '@uniome/shared';
import type { EntryModule, ModuleContext } from './types';

// All registered visualization modules. Add new ones here.
//
// The protein level is now rendered by the dedicated ProteinPanel (info + structure
// in one shared panel), so it no longer goes through this generic stacked-module
// path. The registry stays for future DNA/RNA modules.
export const MODULES: EntryModule[] = [];

// The modules that should render for a given level + entry, in registry order.
export function modulesForLevel(level: GeneticLevel, ctx: ModuleContext): EntryModule[] {
  return MODULES.filter((m) => m.level === level && m.isAvailable(ctx));
}
