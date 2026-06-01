import { readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ChromosomeInfo } from '@uniome/shared';
import { ingestCsv } from './ingest.js';
import { FeatureStore } from './store.js';

export interface OrganismConfig {
  taxid: string;
  folder: string;
  annotationDb: string;
  shortName: string;
  scientificName: string;
  strain: string;
}

export interface Organism {
  config: OrganismConfig;
  store: FeatureStore;
  chromosomes: ChromosomeInfo[];
  chromosomesById: Map<string, ChromosomeInfo>;
}

const here = fileURLToPath(new URL('.', import.meta.url));
const RESOURCES = resolve(here, '../../../resources');

function discoverOrganisms(): Organism[] {
  const entries = readdirSync(RESOURCES, { withFileTypes: true });
  const out: Organism[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const m = /^(\d+)_/.exec(e.name);
    if (!m) continue;
    const taxid = m[1];
    const folderPath = resolve(RESOURCES, e.name);
    const dbFile = readdirSync(folderPath).find((f) => /_DB\.csv$/i.test(f));
    if (!dbFile) {
      console.warn(`[uniome] ${e.name}: no *_DB.csv found, skipping`);
      continue;
    }
    const { features, meta, chromosomes } = ingestCsv(resolve(folderPath, dbFile));
    if (chromosomes.length === 0) {
      console.warn(`[uniome] ${e.name}: no chromosomes detected (chrom/chrom_len missing), skipping`);
      continue;
    }
    const store = new FeatureStore(features);
    const chromosomesById = new Map<string, ChromosomeInfo>();
    for (const c of chromosomes) chromosomesById.set(c.id, c);
    const cfg: OrganismConfig = {
      taxid,
      folder: e.name,
      annotationDb: dbFile,
      shortName: meta.org || taxid,
      scientificName: meta.species,
      strain: meta.strain,
    };
    out.push({ config: cfg, store, chromosomes, chromosomesById });
    const totalWithCoord = chromosomes.reduce((s, c) => s + c.featureCount, 0);
    const chromSummary = chromosomes
      .map((c) => `${c.id} (${c.length.toLocaleString()} bp${c.topology ? `, ${c.topology}` : ''})`)
      .join(', ');
    console.log(
      `[uniome] ${cfg.shortName} (${taxid}): ${features.length} features, ${totalWithCoord} with coord; chromosomes: ${chromSummary}`
    );
  }
  out.sort((a, b) => a.config.taxid.localeCompare(b.config.taxid));
  return out;
}

let organisms = new Map<string, Organism>();
let cacheSignature = '';

// Fingerprint of the resources tree: dir mtime + each org folder mtime + each *_DB.csv mtime.
// Cheap (a handful of stat() calls) and catches both new/removed orgs and in-place CSV edits.
function scanSignature(): string {
  const parts: string[] = [`R:${statSync(RESOURCES).mtimeMs}`];
  for (const e of readdirSync(RESOURCES, { withFileTypes: true })) {
    if (!e.isDirectory() || !/^(\d+)_/.test(e.name)) continue;
    const folder = resolve(RESOURCES, e.name);
    const folderMtime = statSync(folder).mtimeMs;
    let dbMtime = 0;
    try {
      const db = readdirSync(folder).find((f) => /_DB\.csv$/i.test(f));
      if (db) dbMtime = statSync(resolve(folder, db)).mtimeMs;
    } catch {
      // folder vanished between readdir calls — ignore, next scan will reconcile
    }
    parts.push(`${e.name}:${folderMtime}:${dbMtime}`);
  }
  return parts.join('|');
}

function ensureFresh(): void {
  const sig = scanSignature();
  if (sig === cacheSignature) return;
  const next = new Map<string, Organism>();
  for (const o of discoverOrganisms()) next.set(o.config.taxid, o);
  organisms = next;
  cacheSignature = sig;
  console.log(`[uniome] loaded ${next.size} organism(s): ${Array.from(next.keys()).join(', ')}`);
}

ensureFresh();

export function getOrganism(taxid: string): Organism | undefined {
  ensureFresh();
  return organisms.get(taxid);
}

export function listOrganisms(): Array<{
  taxid: string;
  shortName: string;
  scientificName: string;
  strain: string;
  chromosomes: ChromosomeInfo[];
}> {
  ensureFresh();
  return Array.from(organisms.values()).map((o) => ({
    taxid: o.config.taxid,
    shortName: o.config.shortName,
    scientificName: o.config.scientificName,
    strain: o.config.strain,
    chromosomes: o.chromosomes,
  }));
}
