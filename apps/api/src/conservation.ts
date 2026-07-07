import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Conservation, ConservationCall } from '@uniome/shared';
import { getOrganism } from './organisms.js';
import { scoreOf } from './scoredist.js';
import { resourcesRoot } from './resources.js';

const RESOURCES = resourcesRoot();
const UNIQID_RE = /^[A-Za-z0-9_-]+$/;

function readIndex(folder: string, file: string): Record<string, ConservationCall> {
  try { return JSON.parse(readFileSync(resolve(RESOURCES, folder, 'conservation', file), 'utf8')); }
  catch { return {}; }
}

// Per-locus variability from two switchable sources: computed nucleotide diversity (π, all loci) and
// EnteroBase allele diversity (core loci). Both bounded per-organism indexes are merged once into a
// per-feature record carrying whichever source(s) have a value; the UI defaults to diversity.
const cache = new Map<string, Record<string, Conservation>>();
export function loadConservation(taxid: string, uniqID: string): Conservation | null {
  if (!UNIQID_RE.test(uniqID)) return null;
  const org = getOrganism(taxid);
  if (!org) return null;
  let idx = cache.get(org.config.folder);
  if (!idx) {
    const diversity = readIndex(org.config.folder, 'diversity.json');
    const enterobase = readIndex(org.config.folder, 'enterobase.json');
    const merged: Record<string, Conservation> = {};
    for (const [u, v] of Object.entries(diversity)) (merged[u] ??= {}).diversity = { ...v, score: scoreOf(taxid, 'conservation', u) };
    for (const [u, v] of Object.entries(enterobase)) (merged[u] ??= {}).enterobase = v;
    idx = merged;
    cache.set(org.config.folder, idx);
  }
  return idx[uniqID] ?? null;
}
