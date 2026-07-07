import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Expression } from '@uniome/shared';
import { getOrganism } from './organisms.js';
import { scoreOf } from './scoredist.js';
import { resourcesRoot } from './resources.js';

const RESOURCES = resourcesRoot();
const UNIQID_RE = /^[A-Za-z0-9_-]+$/;

// The expression index (protein abundance + transcript level) is one bounded file per organism.
const cache = new Map<string, Record<string, Expression>>();
export function loadExpression(taxid: string, uniqID: string): Expression | null {
  if (!UNIQID_RE.test(uniqID)) return null;
  const org = getOrganism(taxid);
  if (!org) return null;
  let idx = cache.get(org.config.folder);
  if (!idx) {
    let parsed: Record<string, Expression>;
    try { parsed = JSON.parse(readFileSync(resolve(RESOURCES, org.config.folder, 'expression.json'), 'utf8')); }
    catch { parsed = {}; }
    idx = parsed;
    cache.set(org.config.folder, idx);
  }
  const e = idx[uniqID];
  if (!e) return null;
  // Attach the value's genome-wide normalised position (for the dumbbell + distribution).
  return {
    protein: e.protein ? { ...e.protein, norm: scoreOf(taxid, 'protein', uniqID) } : undefined,
    transcript: e.transcript ? { ...e.transcript, norm: scoreOf(taxid, 'transcript', uniqID) } : undefined,
  };
}
