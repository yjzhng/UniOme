import { readFileSync } from 'node:fs';
import Papa from 'papaparse';
import {
  parseCoord,
  type ChromosomeInfo,
  type ChromTopology,
  type Feature,
  type SourceTag,
} from '@uniome/shared';

type RawRow = Record<string, string>;

export interface OrganismMeta {
  species: string;
  strain: string;
  org: string;
}

export interface IngestResult {
  features: Feature[];
  meta: OrganismMeta;
  chromosomes: ChromosomeInfo[];
}

function splitTags(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function splitSource(raw: string | undefined): SourceTag[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is SourceTag => s === 'RS' || s === 'GB' || s === 'UP');
}

// UP-only rows = stale/deprecated UniProt entries with no RefSeq/GenBank backing (no genome coord,
// absent from the current assembly). Treated as not part of the organism and ignored app-wide.
function isUpOnly(source: SourceTag[]): boolean {
  return source.length > 0 && source.every((s) => s === 'UP');
}

function parseNum(raw: string | undefined): number | null {
  if (!raw) return null;
  const t = raw.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function parseStr(raw: string | undefined): string | null {
  if (!raw) return null;
  const t = raw.trim();
  return t.length > 0 ? t : null;
}

function parseTopology(raw: string | undefined): ChromTopology | undefined {
  const t = raw?.trim().toLowerCase();
  if (t === 'circular' || t === 'linear') return t;
  return undefined;
}

// Build alias → canonical map by grouping chrom names by their reported length.
// Two names with the same chrom_len are treated as aliases for one chromosome;
// the NC_-prefixed one wins when both exist.
interface ChromCanon {
  id: string;
  length: number;
  topology?: ChromTopology;
}
function buildAliases(rows: RawRow[]): { aliasMap: Map<string, ChromCanon>; chromosomes: ChromCanon[] } {
  interface ChromAcc {
    canon: ChromCanon;
    aliases: Set<string>;
  }
  const byLen = new Map<number, ChromAcc>();
  for (const row of rows) {
    const chrom = row.chrom?.trim();
    const lenStr = row.chrom_len?.trim();
    if (!chrom || !lenStr) continue;
    const len = Number(lenStr);
    if (!Number.isFinite(len) || len <= 0) continue;
    const topology = parseTopology(row.chrom_topo);
    let acc = byLen.get(len);
    if (!acc) {
      acc = { canon: { id: chrom, length: len, topology }, aliases: new Set([chrom]) };
      byLen.set(len, acc);
    } else {
      acc.aliases.add(chrom);
      if (chrom.startsWith('NC_') && !acc.canon.id.startsWith('NC_')) acc.canon.id = chrom;
      // First non-empty topology seen for this replicon wins; rows omitting the
      // column don't clobber a value already captured from a sibling alias.
      if (topology && !acc.canon.topology) acc.canon.topology = topology;
    }
  }
  const aliasMap = new Map<string, ChromCanon>();
  const chromosomes: ChromCanon[] = [];
  for (const acc of byLen.values()) {
    chromosomes.push(acc.canon);
    for (const a of acc.aliases) aliasMap.set(a, acc.canon);
  }
  return { aliasMap, chromosomes };
}

export function ingestCsv(path: string): IngestResult {
  const text = readFileSync(path, 'utf8');
  const parsed = Papa.parse<RawRow>(text, { header: true, skipEmptyLines: true });
  const rows = parsed.data;

  const { aliasMap, chromosomes: chromAccs } = buildAliases(rows);
  // chromosomes sorted by length, descending — longest is the implicit default for
  // features with no chrom value of their own.
  chromAccs.sort((a, b) => b.length - a.length);
  const defaultChrom = chromAccs[0]?.id ?? '';

  const meta: OrganismMeta = { species: '', strain: '', org: '' };
  const features: Feature[] = [];

  for (const row of rows) {
    if (!meta.species && row.species) meta.species = row.species.trim();
    if (!meta.strain && row.strain) meta.strain = row.strain.trim();
    if (!meta.org && row.org) meta.org = row.org.trim();

    const type = (row.type ?? '').trim();
    if (!type) continue;

    // Skip stale UP-only entries (deprecated UniProt rows not in RefSeq) — ignored without editing DB.csv.
    const source = splitSource(row.source);
    if (isUpOnly(source)) continue;

    const rawChrom = row.chrom?.trim() ?? '';
    const acc = rawChrom ? aliasMap.get(rawChrom) : undefined;
    const chrom = acc?.id ?? rawChrom ?? defaultChrom;

    features.push({
      uniqID: row.uniqID,
      source,
      GeneID: row.GeneID ?? '',
      locus_tag: row.locus_tag ?? '',
      UniProtID: row.UniProtID ?? '',
      type,
      chrom: chrom || defaultChrom,
      coord: parseCoord(row.coord),
      gene: row.gene ?? '',
      product: row.product ?? '',
      KG_FG: splitTags(row.KG_FG),
      KG_FM: splitTags(row.KG_FM),
      KG_PC: splitTags(row.KG_PC),
      KG_PG: splitTags(row.KG_PG),
      KG_PW: splitTags(row.KG_PW),
      UP_FM: splitTags(row.UP_FM),
      UP_PW: splitTags(row.UP_PW),
      UP_KW: splitTags(row.UP_KW),
      // Subcellular localisation of the functional product (DeepLocPro), from the org_DB.csv
      // `localz` column (Cytoplasmic, Plasma Membrane, Periplasmic, Outer Membrane, Extracellular).
      localisation: parseStr(row.localz ?? row.localisation ?? row.LOC),
      len: parseNum(row.len),
      seq: parseStr(row.seq),
      rna_len: parseNum(row.rna_len),
      rna_seq: parseStr(row.rna_seq),
      prot_len: parseNum(row.prot_len),
      prot_seq: parseStr(row.prot_seq),
    });
  }

  const featureCountByChrom = new Map<string, number>();
  for (const f of features) {
    if (!f.coord) continue;
    featureCountByChrom.set(f.chrom, (featureCountByChrom.get(f.chrom) ?? 0) + 1);
  }
  const chromosomes: ChromosomeInfo[] = chromAccs.map((c) => ({
    id: c.id,
    length: c.length,
    featureCount: featureCountByChrom.get(c.id) ?? 0,
    ...(c.topology ? { topology: c.topology } : {}),
  }));

  return { features, meta, chromosomes };
}
