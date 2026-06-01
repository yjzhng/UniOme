import type { ParsedCoord } from './coord.js';

export type FeatureType = string;

export type GeneticLevel = 'DNA' | 'RNA' | 'PROT';

// Derived from the type name so new feature types (data-driven) just work:
//   CDS                            → DNA + RNA + Protein
//   *RNA  (rRNA, tRNA, ncRNA, …)  → DNA + RNA
//   anything else                  → DNA only
// If a future type needs an exception, override here.
export function typeLevels(type: string): GeneticLevel[] {
  if (type === 'CDS') return ['DNA', 'RNA', 'PROT'];
  if (/rna/i.test(type)) return ['DNA', 'RNA'];
  return ['DNA'];
}

export type SourceTag = 'RS' | 'GB' | 'UP';

export interface Feature {
  uniqID: string;
  source: SourceTag[];
  GeneID: string;
  locus_tag: string;
  UniProtID: string;
  type: FeatureType;
  chrom: string;
  coord: ParsedCoord | null;
  gene: string;
  product: string;
  KG_FG: string[];
  KG_FM: string[];
  KG_PC: string[];
  KG_PG: string[];
  KG_PW: string[];
  UP_FM: string[];
  UP_PW: string[];
  UP_KW: string[];
  len: number | null;
  seq: string | null;
  rna_len: number | null;
  rna_seq: string | null;
  prot_len: number | null;
  prot_seq: string | null;
}

export interface FeatureSummary {
  uniqID: string;
  locus_tag: string;
  gene: string;
  product: string;
  type: FeatureType;
  chrom: string;
  start: number;
  end: number;
  strand: '+' | '-';
  KG_PC: string[];
  // Present only for multi-segment (join/order) features — e.g. spliced genes or
  // a feature that wraps a circular origin. Each entry is an [start, end] block in
  // genomic coordinates. Omitted for the common single-block case, where [start,end]
  // is the whole feature.
  segments?: Array<[number, number]>;
}

export type ChromTopology = 'circular' | 'linear';

// Protein domain annotation (e.g. from TED — The Encyclopedia of Domains).
// Downloaded once into resources/ and served locally; never queried at view time.
export interface ProteinDomain {
  id: string; // e.g. "TED01"
  // Residue blocks in protein coordinates. >1 block = a discontinuous domain.
  segments: Array<[number, number]>;
  cath: string | null; // CATH superfamily code, e.g. "3.40.50.300"
  cathName: string | null; // human-readable CATH superfamily name
  plddt: number | null; // mean AlphaFold pLDDT over the domain
}

export interface ProteinDomains {
  acc: string; // UniProt accession
  length: number | null; // max residue covered (fallback for the track scale)
  source: string; // provenance, e.g. "TED"
  domains: ProteinDomain[];
}

export interface ChromosomeInfo {
  id: string;
  length: number;
  featureCount: number;
  // Replicon topology from the DB's chrom_topo column. Undefined when the
  // source DB doesn't provide it (older organisms predate the column).
  topology?: ChromTopology;
}
