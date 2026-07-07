import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Mutation, MutationCall } from '@uniome/shared';
import { getOrganism } from './organisms.js';
import { resourcesRoot } from './resources.js';

const RESOURCES = resourcesRoot();
const UNIQID_RE = /^[A-Za-z0-9_-]+$/;

function readIndex(folder: string, file: string): Record<string, MutationCall> {
  try { return JSON.parse(readFileSync(resolve(RESOURCES, folder, 'mutation', file), 'utf8')); }
  catch { return {}; }
}

// Per-locus experimental mutation frequency. Currently one source — the MMR-defective mutation-
// accumulation landscape (Foster 2018) — kept as a per-source record so more sources can switch in.
const cache = new Map<string, Record<string, Mutation>>();
export function loadMutation(taxid: string, uniqID: string): Mutation | null {
  if (!UNIQID_RE.test(uniqID)) return null;
  const org = getOrganism(taxid);
  if (!org) return null;
  let idx = cache.get(org.config.folder);
  if (!idx) {
    const mmr = readIndex(org.config.folder, 'mmr.json');
    const merged: Record<string, Mutation> = {};
    for (const [u, v] of Object.entries(mmr)) (merged[u] ??= {}).mmr = v;
    idx = merged;
    cache.set(org.config.folder, idx);
  }
  return idx[uniqID] ?? null;
}
