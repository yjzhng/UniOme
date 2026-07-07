import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Variants, RnaModification } from '@uniome/shared';
import { getOrganism } from './organisms.js';
import { resourcesRoot } from './resources.js';

const RESOURCES = resourcesRoot();
const UNIQID_RE = /^[A-Za-z0-9_-]+$/;

// One bounded index file per organism, parsed + cached on first use.
const cache = new Map<string, Record<string, unknown>>();
function index(folder: string, ...parts: string[]): Record<string, unknown> {
  const key = `${folder}/${parts.join('/')}`;
  const hit = cache.get(key);
  if (hit) return hit;
  let idx: Record<string, unknown>;
  try { idx = JSON.parse(readFileSync(resolve(RESOURCES, folder, ...parts), 'utf8')); }
  catch { idx = {}; }
  cache.set(key, idx);
  return idx;
}

// Per-locus natural nucleotide variants (genome panel).
export function loadVariants(taxid: string, uniqID: string): Variants | null {
  if (!UNIQID_RE.test(uniqID)) return null;
  const org = getOrganism(taxid);
  if (!org) return null;
  return (index(org.config.folder, 'variants.json')[uniqID] as Variants) ?? null;
}

// Per-RNA modified nucleotides (MODOMICS).
export function loadRnaModifications(taxid: string, uniqID: string): RnaModification[] | null {
  if (!UNIQID_RE.test(uniqID)) return null;
  const org = getOrganism(taxid);
  if (!org) return null;
  return (index(org.config.folder, 'rna', 'modifications.json')[uniqID] as RnaModification[]) ?? null;
}
