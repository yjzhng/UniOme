import { readdirSync, statSync, existsSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import type { ChromosomeInfo } from '@uniome/shared';
import { ingestCsv } from './ingest.js';
import { FeatureStore } from './store.js';
import { resourcesRoot } from './resources.js';
import { catalog } from './catalog.js';

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

// The annotation DB the API ingests. The org root holds the prokDB CORE DB (16 annotation cols);
// UniOme's enrichment (scripts/enrich/) writes the full working DB to <org>/core/. Prefer the enriched
// copy when present, so the org-root core stays an untouched prokDB input.
function findDbPath(folderPath: string): string | null {
  for (const dir of [resolve(folderPath, 'core'), folderPath]) {
    try {
      const file = readdirSync(dir).find((f) => /_DB\.csv$/i.test(f));
      if (file) return resolve(dir, file);
    } catch { /* no such dir */ }
  }
  return null;
}

function discoverOrganisms(): Organism[] {
  const RESOURCES = resourcesRoot();
  // The data dir may not exist yet (packaged app, before first-run download). Boot with zero
  // organisms instead of throwing; the next scan picks them up once the data lands.
  if (!existsSync(RESOURCES)) {
    console.warn(`[uniome] resources dir not found (no organisms loaded): ${RESOURCES}`);
    return [];
  }
  const entries = readdirSync(RESOURCES, { withFileTypes: true });
  const out: Organism[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const m = /^(\d+)_/.exec(e.name);
    if (!m) continue;
    const taxid = m[1];
    const folderPath = resolve(RESOURCES, e.name);
    const dbPath = findDbPath(folderPath);
    if (!dbPath) {
      console.warn(`[uniome] ${e.name}: no *_DB.csv found (checked core/ and root), skipping`);
      continue;
    }
    const dbFile = basename(dbPath);
    const { features, meta, chromosomes } = ingestCsv(dbPath);
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
  // Canonical display order = the organism-catalog.json tile order (so the nav dropdown matches the
  // home tiles). Organisms present but not catalogued sort after, by taxid.
  const order = new Map(catalog().map((e, i) => [e.taxid, i]));
  out.sort((a, b) => {
    const ia = order.get(a.config.taxid) ?? Infinity;
    const ib = order.get(b.config.taxid) ?? Infinity;
    return ia - ib || a.config.taxid.localeCompare(b.config.taxid);
  });
  return out;
}

let organisms = new Map<string, Organism>();
let cacheSignature = '';

// Fingerprint of the resources tree: dir mtime + each org folder mtime + each *_DB.csv mtime.
// Cheap (a handful of stat() calls) and catches both new/removed orgs and in-place CSV edits.
function scanSignature(): string {
  const RESOURCES = resourcesRoot();
  if (!existsSync(RESOURCES)) return 'missing';
  const parts: string[] = [`R:${statSync(RESOURCES).mtimeMs}`];
  for (const e of readdirSync(RESOURCES, { withFileTypes: true })) {
    if (!e.isDirectory() || !/^(\d+)_/.test(e.name)) continue;
    const folder = resolve(RESOURCES, e.name);
    const folderMtime = statSync(folder).mtimeMs;
    let dbMtime = 0;
    try {
      const db = findDbPath(folder);
      if (db) dbMtime = statSync(db).mtimeMs;
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
