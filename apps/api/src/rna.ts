import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { RnaEntry, RnaFeatures, RnaSecondaryStructure, ProteinComplexes } from '@uniome/shared';
import { getOrganism } from './organisms.js';
import { resourcesRoot } from './resources.js';

const RESOURCES = resourcesRoot();
const UNIQID_RE = /^[A-Za-z0-9_-]+$/;

// RNA features that participate in a Complex Portal complex (rna/complexes.json), reusing the
// protein ProteinComplex shape. Bounded index → read once per folder.
const complexCache = new Map<string, Record<string, ProteinComplexes>>();
export function loadRnaComplexes(taxid: string, uniqID: string): ProteinComplexes | null {
  if (!UNIQID_RE.test(uniqID)) return null;
  const org = getOrganism(taxid);
  if (!org) return null;
  let idx = complexCache.get(org.config.folder);
  if (!idx) {
    let parsed: Record<string, ProteinComplexes>;
    try { parsed = JSON.parse(readFileSync(resolve(RESOURCES, org.config.folder, 'rna', 'complexes.json'), 'utf8')); }
    catch { parsed = {}; }
    idx = parsed;
    complexCache.set(org.config.folder, idx);
  }
  return idx[uniqID] ?? null;
}

// RNAcentral URS ids are "URS" + alphanumerics. Validate before building a file path so a
// resolved value can't escape the rna/ directory. The feature uniqID is only ever used as
// a lookup key into index.json (never a path component), so it needs no charset check.
const URS_RE = /^URS[0-9A-Za-z]+$/;

interface RnaIndex {
  [uniqID: string]: { urs: string; taxid: string };
}

function rnaDir(taxid: string): string | null {
  const org = getOrganism(taxid);
  if (!org) return null;
  return resolve(RESOURCES, org.config.folder, 'rna');
}

// Read the per-organism uniqID → URS index, or null if the organism / file is absent.
function loadIndex(taxid: string): RnaIndex | null {
  const dir = rnaDir(taxid);
  if (!dir) return null;
  try {
    return JSON.parse(readFileSync(resolve(dir, 'index.json'), 'utf8')) as RnaIndex;
  } catch {
    return null;
  }
}

// Resolve a feature uniqID to its RNAcentral URS (+ taxid), validated, or null.
function resolveUrs(taxid: string, uniqID: string): { urs: string; taxid: string } | null {
  const idx = loadIndex(taxid);
  const hit = idx?.[uniqID];
  if (!hit || !URS_RE.test(hit.urs)) return null;
  return hit;
}

// The resolved RNAcentral identity + SO classification for a feature, or null. Pure disk
// read — also the availability probe (its presence means the feature has RNA assets).
export function loadRnaEntry(taxid: string, uniqID: string): RnaEntry | null {
  const dir = rnaDir(taxid);
  const hit = resolveUrs(taxid, uniqID);
  if (!dir || !hit) return null;
  try {
    return JSON.parse(readFileSync(resolve(dir, 'entries', `${hit.urs}.json`), 'utf8')) as RnaEntry;
  } catch {
    return null;
  }
}

// 2D (secondary) structure metadata (dot-bracket + template) for a feature, or null.
export function loadRnaSecondaryStructure(taxid: string, uniqID: string): RnaSecondaryStructure | null {
  const dir = rnaDir(taxid);
  const hit = resolveUrs(taxid, uniqID);
  if (!dir || !hit) return null;
  try {
    return JSON.parse(readFileSync(resolve(dir, '2d', `${hit.urs}.json`), 'utf8')) as RnaSecondaryStructure;
  } catch {
    return null;
  }
}

// Decoded structural-element features (stems/loops) + Rfam family for a feature, or null.
export function loadRnaFeatures(taxid: string, uniqID: string): RnaFeatures | null {
  const dir = rnaDir(taxid);
  const hit = resolveUrs(taxid, uniqID);
  if (!dir || !hit) return null;
  try {
    return JSON.parse(readFileSync(resolve(dir, 'features', `${hit.urs}.json`), 'utf8')) as RnaFeatures;
  } catch {
    return null;
  }
}

// Path to the locally-stored R2DT SVG layout for a feature, or null if absent.
export function rnaSvgPath(taxid: string, uniqID: string): string | null {
  const dir = rnaDir(taxid);
  const hit = resolveUrs(taxid, uniqID);
  if (!dir || !hit) return null;
  const path = resolve(dir, '2d', `${hit.urs}.svg`);
  return existsSync(path) ? path : null;
}

// Path to the locally-stored PDBe structure (BinaryCIF) for a feature, or null if absent.
// Structures are gitignored (large) and produced by scripts/general/fetch-rna-assets.mjs.
export function rnaStructurePath(taxid: string, uniqID: string): string | null {
  const dir = rnaDir(taxid);
  const hit = resolveUrs(taxid, uniqID);
  if (!dir || !hit) return null;
  const path = resolve(dir, 'structures', `${hit.urs}.bcif`);
  return existsSync(path) ? path : null;
}
