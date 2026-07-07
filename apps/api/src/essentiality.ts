import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Essentiality, EssentialityCall } from '@uniome/shared';
import { getOrganism } from './organisms.js';
import { scoreOf, pctOf } from './scoredist.js';
import { resourcesRoot } from './resources.js';

const RESOURCES = resourcesRoot();
const UNIQID_RE = /^[A-Za-z0-9_-]+$/;

function readIndex(folder: string, file: string): Record<string, EssentialityCall> {
  try { return JSON.parse(readFileSync(resolve(RESOURCES, folder, 'essentiality', file), 'utf8')); }
  catch { return {}; }
}

// Essentiality comes from whichever sources an organism has: EcoCyc knockout-growth (CDS) + a
// genome-wide CRISPRi screen (E. coli), or a categorical Tn-seq index (e.g. M. tuberculosis). The
// bounded per-organism indexes are merged once into a per-feature record carrying every source that
// has a call; the UI shows whichever are present.
const cache = new Map<string, Record<string, Essentiality>>();
export function loadEssentiality(taxid: string, uniqID: string): Essentiality | null {
  if (!UNIQID_RE.test(uniqID)) return null;
  const org = getOrganism(taxid);
  if (!org) return null;
  let idx = cache.get(org.config.folder);
  if (!idx) {
    const ecocyc = readIndex(org.config.folder, 'ecocyc.json');
    const crispri = readIndex(org.config.folder, 'crispri.json');
    const tnseq = readIndex(org.config.folder, 'tnseq.json');
    const merged: Record<string, Essentiality> = {};
    for (const [u, v] of Object.entries(crispri)) (merged[u] ??= {}).crispri = { ...v, scoreLb: scoreOf(taxid, 'essentialityLb', u), scoreM9: scoreOf(taxid, 'essentialityM9', u), pctLb: pctOf(taxid, 'essentialityLb', u), pctM9: pctOf(taxid, 'essentialityM9', u) };
    for (const [u, v] of Object.entries(ecocyc)) (merged[u] ??= {}).ecocyc = v;
    for (const [u, v] of Object.entries(tnseq)) (merged[u] ??= {}).tnseq = v;
    idx = merged;
    cache.set(org.config.folder, idx);
  }
  return idx[uniqID] ?? null;
}
