import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { resourcesRoot } from './resources.js';

// Home-page tile registry, merged from two sources:
//   • resources/organism-catalog.json — the tiles: { taxid, nickname, keggid } only (what's known
//     when an organism is first registered; "add tile").
//   • scripts/organisms/<folder>/organism.json — org-specific infra: cross-DB ids + the availability
//     / download info (available, url, bytes). Written when the organism's backend is built.
// Display name/species/strain are NOT stored anywhere — derived from the enriched DB once present.
//
// 3-state lifecycle: planned (tile only, or available:false) → available (available:true + url, not
// on disk) → ready (data discovered on disk).

interface Tile { taxid: string; nickname?: string; keggid?: string; name?: string; folder?: string }
interface OrgConfig { available?: boolean; url?: string; bytes?: number }
export interface CatalogEntry {
  taxid: string;
  nickname?: string;
  keggid?: string;
  name?: string; // human-readable label shown before download (precise name is DB-derived once ready)
  folder: string;
  available: boolean;
  url?: string;
  bytes?: number;
}

// resources/organism-catalog.json (under resources so it ships/downloads with the data root).
// Override with UNIOME_CATALOG — the desktop build points this at its bundled copy.
function catalogPath(): string {
  return process.env.UNIOME_CATALOG
    ? resolve(process.env.UNIOME_CATALOG)
    : resolve(resourcesRoot(), 'organism-catalog.json');
}

// scripts/organisms/ (org-specific infra). Override with UNIOME_ORG_INFRA — set by the desktop
// build, since scripts/ isn't shipped in the packaged app.
function orgInfraDir(): string {
  return process.env.UNIOME_ORG_INFRA
    ? resolve(process.env.UNIOME_ORG_INFRA)
    : resolve(resourcesRoot(), '..', 'scripts', 'organisms');
}

function folderOf(t: Tile): string {
  if (t.folder) return t.folder;
  return t.nickname ? `${t.taxid}_${t.nickname}` : t.taxid;
}

function readTiles(): Tile[] {
  try { return (JSON.parse(readFileSync(catalogPath(), 'utf8')).organisms ?? []) as Tile[]; }
  catch { return []; }
}

function orgConfig(folder: string): OrgConfig {
  try { return JSON.parse(readFileSync(resolve(orgInfraDir(), folder, 'organism.json'), 'utf8')) as OrgConfig; }
  catch { return {}; }
}

export function catalog(): CatalogEntry[] {
  return readTiles().map((t) => {
    const folder = folderOf(t);
    const cfg = orgConfig(folder);
    return { taxid: t.taxid, nickname: t.nickname, keggid: t.keggid, name: t.name, folder, available: !!cfg.available, url: cfg.url, bytes: cfg.bytes };
  });
}

export function catalogEntry(taxid: string): CatalogEntry | undefined {
  return catalog().find((e) => e.taxid === taxid);
}

// Default archive host: the public GitHub Release (tag "assets"). Baked in so the home-page
// "Download data" buttons work zero-config on a fresh public clone. Override via UNIOME_DATA_BASE
// (a URL for a fork/mirror, or a local dir for testing).
const DEFAULT_DATA_BASE = 'https://github.com/yjzhng/UniOme/releases/download/assets';

// Resolve an archive's location: absolute http(s)/file urls are used as-is; a relative url joins
// UNIOME_DATA_BASE, falling back to the public Release above.
export function resolveArchiveUrl(url: string): string {
  if (/^(https?|file):\/\//.test(url)) return url;
  const base = process.env.UNIOME_DATA_BASE || DEFAULT_DATA_BASE;
  if (/^https?:\/\//.test(base)) return base.replace(/\/$/, '') + '/' + url;
  return resolve(base, url);
}
