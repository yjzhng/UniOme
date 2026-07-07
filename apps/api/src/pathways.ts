import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { PathwayMap, PathwayRef, PathwayTaxonomy, OverviewMap, OverviewRef } from '@uniome/shared';
import { getOrganism } from './organisms.js';
import { resourcesRoot } from './resources.js';

const RESOURCES = resourcesRoot();
const UNIQID_RE = /^[A-Za-z0-9_-]+$/;
const PATHWAY_RE = /^[a-z]{2,4}\d{5}$/; // e.g. eco00260 — keeps the lookup inside pathway/maps/

// The gene→pathways index (which KEGG maps each gene appears in), read once per organism.
const idxCache = new Map<string, Record<string, PathwayRef[]>>();
function pathwayIndex(folder: string): Record<string, PathwayRef[]> {
  const cached = idxCache.get(folder);
  if (cached) return cached;
  let c: Record<string, PathwayRef[]>;
  try { c = JSON.parse(readFileSync(resolve(RESOURCES, folder, 'pathway', 'index.json'), 'utf8')); }
  catch { c = {}; }
  idxCache.set(folder, c);
  return c;
}

export function loadGenePathways(taxid: string, uniqID: string): PathwayRef[] | null {
  if (!UNIQID_RE.test(uniqID)) return null;
  const org = getOrganism(taxid);
  if (!org) return null;
  return pathwayIndex(org.config.folder)[uniqID] ?? [];
}

// A single pathway map (built KGML). Cached per pathway id.
const mapCache = new Map<string, PathwayMap | null>();
export function loadPathwayMap(taxid: string, pathwayId: string): PathwayMap | null {
  if (!PATHWAY_RE.test(pathwayId)) return null;
  const org = getOrganism(taxid);
  if (!org) return null;
  const key = `${org.config.folder}/${pathwayId}`;
  if (mapCache.has(key)) return mapCache.get(key)!;
  let map: PathwayMap | null = null;
  try { map = JSON.parse(readFileSync(resolve(RESOURCES, org.config.folder, 'pathway', 'maps', `${pathwayId}.json`), 'utf8')); }
  catch { map = null; }
  mapCache.set(key, map);
  return map;
}

// Pathway → member genes (the inverse of the gene→pathways index), so the home browser can highlight all
// genes under a whole taxonomy branch (category / section) at once. Computed once per org from the index.
const membersCache = new Map<string, Record<string, string[]>>();
export function loadPathwayGeneMembers(taxid: string): Record<string, string[]> | null {
  const org = getOrganism(taxid);
  if (!org) return null;
  const cached = membersCache.get(org.config.folder);
  if (cached) return cached;
  const idx = pathwayIndex(org.config.folder);
  const out: Record<string, string[]> = {};
  for (const [uniqID, refs] of Object.entries(idx)) for (const r of refs) (out[r.id] ??= []).push(uniqID);
  membersCache.set(org.config.folder, out);
  return out;
}

// The KEGG BRITE pathway taxonomy (section → category → pathway) over the org's built maps, read once.
const taxCache = new Map<string, PathwayTaxonomy | null>();
export function loadPathwayTaxonomy(taxid: string): PathwayTaxonomy | null {
  const org = getOrganism(taxid);
  if (!org) return null;
  if (taxCache.has(org.config.folder)) return taxCache.get(org.config.folder)!;
  let t: PathwayTaxonomy | null = null;
  try { t = JSON.parse(readFileSync(resolve(RESOURCES, org.config.folder, 'pathway', 'taxonomy.json'), 'utf8')); }
  catch { t = null; }
  taxCache.set(org.config.folder, t);
  return t;
}

// Global/overview metabolic maps (whole-cell network). The index lists the available overview maps
// and which of them each gene sits on (so the entry page can default to a map that contains the gene).
type OverviewIndex = { maps: OverviewRef[]; genes: Record<string, string[]> };
const ovIdxCache = new Map<string, OverviewIndex>();
function overviewIndex(folder: string): OverviewIndex {
  const cached = ovIdxCache.get(folder);
  if (cached) return cached;
  let c: OverviewIndex;
  try { c = JSON.parse(readFileSync(resolve(RESOURCES, folder, 'pathway', 'overview', 'index.json'), 'utf8')); }
  catch { c = { maps: [], genes: {} }; }
  ovIdxCache.set(folder, c);
  return c;
}

// The overview maps a gene appears on, with the full map list — so the client can locate the focal
// gene and offer the family of overview maps.
export function loadGeneOverviews(taxid: string, uniqID: string): { maps: OverviewRef[]; on: string[] } | null {
  if (!UNIQID_RE.test(uniqID)) return null;
  const org = getOrganism(taxid);
  if (!org) return null;
  const idx = overviewIndex(org.config.folder);
  return { maps: idx.maps, on: idx.genes[uniqID] ?? [] };
}

const ovMapCache = new Map<string, OverviewMap | null>();
export function loadOverviewMap(taxid: string, pathwayId: string): OverviewMap | null {
  if (!PATHWAY_RE.test(pathwayId)) return null;
  const org = getOrganism(taxid);
  if (!org) return null;
  const key = `${org.config.folder}/${pathwayId}`;
  if (ovMapCache.has(key)) return ovMapCache.get(key)!;
  let map: OverviewMap | null = null;
  try { map = JSON.parse(readFileSync(resolve(RESOURCES, org.config.folder, 'pathway', 'overview', `${pathwayId}.json`), 'utf8')); }
  catch { map = null; }
  ovMapCache.set(key, map);
  return map;
}
