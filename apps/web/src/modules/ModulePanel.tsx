import type { GeneticLevel } from '@uniome/shared';
import { modulesForLevel } from './registry';
import type { ModuleContext } from './types';

// Renders the visualization modules available for a level, stacked. Returns null
// when there are none so callers can fall back to a full-width layout.
export default function ModulePanel({ level, ctx }: { level: GeneticLevel; ctx: ModuleContext }) {
  const modules = modulesForLevel(level, ctx);
  if (modules.length === 0) return null;
  return (
    <div className="space-y-4">
      {modules.map((m) => (
        <section key={m.id} className="rounded border border-neutral-200 bg-white">
          <header className="flex items-baseline gap-2 border-b-2 border-neutral-800 px-3 py-2">
            <h2 className="text-sm font-semibold text-neutral-900">{m.title}</h2>
            <span className="text-xs text-neutral-400">{m.level}</span>
          </header>
          <div className="px-3 py-3">
            <m.Component {...ctx} />
          </div>
        </section>
      ))}
    </div>
  );
}

export function hasModulesForLevel(level: GeneticLevel, ctx: ModuleContext): boolean {
  return modulesForLevel(level, ctx).length > 0;
}
