import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { SimilarData, SimilarMember } from '@uniome/shared';
import { getOrganism } from './organisms.js';
import { resourcesRoot } from './resources.js';

const RESOURCES = resourcesRoot();
const UNIQID_RE = /^[A-Za-z0-9_-]+$/;

// Within-genome similarity indexes (sequence = BLAST, structural = Foldseek), bounded per organism.
const cache = new Map<string, { sequence: Record<string, SimilarMember[]>; structural: Record<string, SimilarMember[]> }>();
function indexes(folder: string) {
  let c = cache.get(folder);
  if (!c) {
    const read = (f: string) => { try { return JSON.parse(readFileSync(resolve(RESOURCES, folder, 'proteins', f), 'utf8')); } catch { return {}; } };
    c = { sequence: read('seq_similar.json'), structural: read('struct_similar.json') };
    cache.set(folder, c);
  }
  return c;
}

export function loadSimilar(taxid: string, uniqID: string): SimilarData | null {
  if (!UNIQID_RE.test(uniqID)) return null;
  const org = getOrganism(taxid);
  if (!org) return null;
  const idx = indexes(org.config.folder);
  // Annotate each hit with its own KEGG terms (top pathway class + lowest-level pathway/function), so
  // the table can show function alongside the metric. The similarity indexes are built from the raw
  // org_DB.csv, which still contains UP-only rows (stale/secondary UniProt accessions, no coord) that
  // the app store drops at ingest — so a single gene leaks in as several hits. Drop any hit the store
  // doesn't have (store.find == null ⇒ UP-only / not an app-visible feature), removing those dupes.
  const visible = (members: SimilarMember[]): SimilarMember[] =>
    members.flatMap((m) => {
      const f = org.store.find(m.uniqID);
      return f ? [{ ...m, kgpc: f.KG_PC?.[0] ?? null, pathway: f.KG_PW?.join(', ') || null, func: f.KG_FM?.join(', ') || null }] : [];
    });
  return { sequence: visible(idx.sequence[uniqID] ?? []), structural: visible(idx.structural[uniqID] ?? []) };
}
