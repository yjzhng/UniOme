import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Feature, Coverage, CoverageField, CoverageSection } from '@uniome/shared';
import { getOrganism } from './organisms.js';
import { resourcesRoot } from './resources.js';

const RES = resourcesRoot();

// Annotation-coverage summary: for every info section/field on the entry page, what fraction of the
// organism's applicable genes actually have that annotation. "Applicable" is the right denominator per
// field — protein sections vs CDS, RNA sections vs RNA loci, everything else vs all loci. Most sections
// live in their own per-org index/asset files (keyed by uniqID, or UniProt acc, or RNAcentral URS), so
// "has annotation" = presence of the gene's key / asset. Computed once per org, cached.

const jsonObj = (folder: string, ...segs: string[]): Record<string, any> => {
  try { return JSON.parse(readFileSync(resolve(RES, folder, ...segs), 'utf8')); } catch { return {}; }
};
const jsonKeys = (folder: string, ...segs: string[]): Set<string> => new Set(Object.keys(jsonObj(folder, ...segs)));
const dirStems = (folder: string, ...segs: string[]): Set<string> => {
  try { return new Set(readdirSync(resolve(RES, folder, ...segs)).map((f) => f.replace(/\.[^.]+$/, ''))); } catch { return new Set(); }
};

const coverageCache = new Map<string, Coverage>();

export function loadCoverage(taxid: string): Coverage | null {
  const org = getOrganism(taxid);
  if (!org) return null;
  const folder = org.config.folder;
  const cached = coverageCache.get(folder);
  if (cached) return cached;

  const feats = org.store.all;
  const isRna = (t: string) => /rna/i.test(t);
  const total = feats.length;
  const cds = feats.filter((f) => f.type === 'CDS').length;
  const rna = feats.filter((f) => isRna(f.type)).length;

  // sources loaded once (empty when the org lacks that source → those fields drop out below)
  const ecocyc = jsonKeys(folder, 'essentiality', 'ecocyc.json');
  const crispri = jsonKeys(folder, 'essentiality', 'crispri.json');
  const tnseq = jsonKeys(folder, 'essentiality', 'tnseq.json');
  const diversity = jsonKeys(folder, 'conservation', 'diversity.json');
  const mmr = jsonKeys(folder, 'mutation', 'mmr.json');
  const expr = jsonObj(folder, 'expression.json');
  const regIdx = jsonObj(folder, 'regulation', 'index.json');            // uniqID → {regulatedBy, operons, sigmulons, modulons}
  const regMap = jsonObj(folder, 'regulation', 'regulatory-map.json');   // uniqID → {features:[]}
  const pathIdx = jsonObj(folder, 'pathway', 'index.json');              // uniqID → PathwayRef[]
  const geneDomains = jsonKeys(folder, 'proteins', 'gene_domains.json'); // InterPro (by uniqID)
  const geneTed = jsonKeys(folder, 'proteins', 'gene_ted.json');         // TED (by uniqID)
  const geneMotifs = jsonKeys(folder, 'proteins', 'gene_motifs.json');   // CDD (by uniqID)
  const seqSim = jsonKeys(folder, 'proteins', 'seq_similar.json');
  const structSim = jsonKeys(folder, 'proteins', 'struct_similar.json');
  const complexes = jsonKeys(folder, 'proteins', 'complexes.json');      // by UniProt acc
  const reactions = jsonKeys(folder, 'proteins', 'reactions.json');      // by UniProt acc
  const structAcc = dirStems(folder, 'proteins', 'structures');          // <acc>.bcif
  const interactions = dirStems(folder, 'interactions');                 // <uniqID>.json
  const rnaIdx = jsonObj(folder, 'rna', 'index.json');                   // uniqID → {urs}
  const rna2d = dirStems(folder, 'rna', '2d');                           // <urs>.json/.svg
  const rna3d = dirStems(folder, 'rna', 'structures');                   // <urs>.bcif

  type Denom = 'all' | 'cds' | 'rna';
  const field = (key: string, label: string, denom: Denom, has: (f: Feature) => boolean): CoverageField | null => {
    let annotated = 0, applicable = 0;
    for (const f of feats) {
      if (denom === 'cds' ? f.type !== 'CDS' : denom === 'rna' ? !isRna(f.type) : false) continue;
      applicable++;
      if (has(f)) annotated++;
    }
    return annotated > 0 ? { key, label, annotated, applicable } : null; // drop sources absent for this org
  };
  const ursOf = (f: Feature): string | null => rnaIdx[f.uniqID]?.urs ?? null;
  // essentiality / expression roll up their sources → one "has any" tile under General
  const anyEss = (f: Feature) => ecocyc.has(f.uniqID) || crispri.has(f.uniqID) || tnseq.has(f.uniqID);
  const anyExpr = (f: Feature) => !!expr[f.uniqID] && (!!expr[f.uniqID].protein || !!expr[f.uniqID].transcript);

  const sections: CoverageSection[] = [
    { name: 'General', fields: [
      field('function', 'function', 'all', (f) => f.KG_FG.length > 0 || f.KG_FM.length > 0),
      field('pathway', 'pathway', 'all', (f) => (pathIdx[f.uniqID]?.length ?? 0) > 0),
      field('essentiality', 'essentiality', 'all', anyEss),
      field('conservation', 'conservation', 'all', (f) => diversity.has(f.uniqID)),
      field('mutation', 'mutation', 'all', (f) => mmr.has(f.uniqID)),
      field('expression', 'expression', 'all', anyExpr),
      field('interactions', 'interactions', 'all', (f) => interactions.has(f.uniqID)),
    ] },
    { name: 'Regulation', fields: [
      field('regulon', 'regulon', 'all', (f) => (regIdx[f.uniqID]?.regulatedBy ?? 0) > 0),
      field('operon', 'operon', 'all', (f) => (regIdx[f.uniqID]?.operons ?? 0) > 0),
      field('sigmulon', 'sigmulon', 'all', (f) => (regIdx[f.uniqID]?.sigmulons ?? 0) > 0),
      field('modulon', 'modulon', 'all', (f) => (regIdx[f.uniqID]?.modulons ?? 0) > 0),
      field('regmap', 'reg. map', 'all', (f) => (regMap[f.uniqID]?.features?.length ?? 0) > 0),
    ] },
    { name: 'Protein', fields: [
      field('structure', '3D structure', 'cds', (f) => !!f.UniProtID && structAcc.has(f.UniProtID)),
      field('interpro', 'InterPro', 'cds', (f) => geneDomains.has(f.uniqID)),
      field('ted', 'TED', 'cds', (f) => geneTed.has(f.uniqID)),
      field('motifs', 'CDD motifs', 'cds', (f) => geneMotifs.has(f.uniqID)),
      field('seqsim', 'seq. similar', 'cds', (f) => seqSim.has(f.uniqID)),
      field('structsim', 'struct. similar', 'cds', (f) => structSim.has(f.uniqID)),
      field('complexes', 'complexes', 'cds', (f) => !!f.UniProtID && complexes.has(f.UniProtID)),
      field('reactions', 'reactions', 'cds', (f) => !!f.UniProtID && reactions.has(f.UniProtID)),
    ] },
    { name: 'RNA', fields: [
      field('rna', 'RNAcentral', 'rna', (f) => !!rnaIdx[f.uniqID]),
      field('rna2d', '2D structure', 'rna', (f) => { const u = ursOf(f); return !!u && rna2d.has(u); }),
      field('rna3d', '3D structure', 'rna', (f) => { const u = ursOf(f); return !!u && rna3d.has(u); }),
    ] },
  ].map((s) => ({ name: s.name, fields: s.fields.filter((x): x is CoverageField => !!x) })).filter((s) => s.fields.length > 0);

  const cov: Coverage = { total, cds, rna, sections };
  coverageCache.set(folder, cov);
  return cov;
}
