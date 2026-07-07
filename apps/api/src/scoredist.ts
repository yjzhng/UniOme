import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Distributions, Multiome, MultiomePoint } from '@uniome/shared';
import { getOrganism } from './organisms.js';
import { resourcesRoot } from './resources.js';

const RESOURCES = resourcesRoot();
const NBINS = 24;

type Metric = 'protein' | 'transcript' | 'mutation' | 'conservation' | 'essentialityLb' | 'essentialityM9';
interface Built {
  maps: Record<Metric, Map<string, number>>; // uniqID → 0–1 score
  hist: Distributions;
}

function readJson(folder: string, ...parts: string[]): Record<string, any> {
  try { return JSON.parse(readFileSync(resolve(RESOURCES, folder, ...parts), 'utf8')); }
  catch { return {}; }
}

// Min-max-normalise a set of (uniqID, rawValue) into a 0–1 score (optionally inverted) and bin it.
function normalise(raw: Array<[string, number]>, invert = false): { map: Map<string, number>; bins: number[] } {
  const bins = new Array(NBINS).fill(0);
  const map = new Map<string, number>();
  if (!raw.length) return { map, bins };
  let min = Infinity, max = -Infinity;
  for (const [, v] of raw) { if (v < min) min = v; if (v > max) max = v; }
  const range = max - min || 1;
  for (const [u, v] of raw) {
    let n = (v - min) / range;
    if (invert) n = 1 - n;
    n = Math.max(0, Math.min(1, n));
    map.set(u, Math.round(n * 1000) / 1000);
    bins[Math.min(NBINS - 1, Math.floor(n * NBINS))]++;
  }
  return { map, bins };
}

const cache = new Map<string, Built>();
function build(folder: string): Built {
  let b = cache.get(folder);
  if (b) return b;
  const expr = readJson(folder, 'expression.json');
  const mut = readJson(folder, 'mutation', 'mmr.json');
  const cons = readJson(folder, 'conservation', 'diversity.json');
  const ecocyc = readJson(folder, 'essentiality', 'ecocyc.json');
  const crispri = readJson(folder, 'essentiality', 'crispri.json');
  const tnseq = readJson(folder, 'essentiality', 'tnseq.json');

  const proteinRaw: Array<[string, number]> = [];
  const transcriptRaw: Array<[string, number]> = [];
  for (const [u, e] of Object.entries(expr)) {
    if (e?.protein && (e.protein.value as number) > 0) proteinRaw.push([u, Math.log10(e.protein.value as number)]); // ppm is log-normal; exclude undetected (0)
    if (e?.transcript) transcriptRaw.push([u, e.transcript.value as number]); // already log-TPM
  }
  const mutationRaw: Array<[string, number]> = Object.entries(mut).map(([u, m]) => [u, (m as any).rate as number]);
  const conservationRaw: Array<[string, number]> = Object.entries(cons).map(([u, c]) => [u, (c as any).pi as number]);

  // CRISPRi essentiality: depletion in LB (rich) and M9 (minimal); low fitness = depleted = essential,
  // inverted so essential = high. Two metrics → two colour-matched peaks.
  const lbRaw: Array<[string, number]> = [];
  const m9Raw: Array<[string, number]> = [];
  for (const [u, c] of Object.entries(crispri)) {
    if ((c as any).lb != null) lbRaw.push([u, (c as any).lb as number]);
    if ((c as any).m9 != null) m9Raw.push([u, (c as any).m9 as number]);
  }
  // EcoCyc essentiality: genome-wide count per categorical call (for the stacked bar).
  const ecocycCounts = { 'non-essential': 0, 'conditional-starvation': 0, essential: 0 };
  for (const c of Object.values(ecocyc)) {
    const call = (c as any).call as keyof typeof ecocycCounts;
    if (call in ecocycCounts) ecocycCounts[call]++;
  }
  // Tn-seq essentiality: same idea, but the call set varies by study (binary now, finer later), so the
  // bar's categories are whatever calls appear — count them generically.
  const tnseqCounts: Record<string, number> = {};
  for (const c of Object.values(tnseq)) {
    const call = (c as any).call as string;
    if (call) tnseqCounts[call] = (tnseqCounts[call] ?? 0) + 1;
  }

  const protein = normalise(proteinRaw);
  const transcript = normalise(transcriptRaw);
  const mutation = normalise(mutationRaw);
  const conservation = normalise(conservationRaw, true); // low diversity = high conservation
  // Normalise LB and M9 SEPARATELY — fitness fold-change isn't comparable across media (growth-rate
  // confound), so each score is the gene's relative essentiality vs the rest of the genome in that
  // condition. Inverted so depleted (low fitness) = high essentiality.
  const essLb = normalise(lbRaw, true);
  const essM9 = normalise(m9Raw, true);

  b = {
    maps: { protein: protein.map, transcript: transcript.map, mutation: mutation.map, conservation: conservation.map, essentialityLb: essLb.map, essentialityM9: essM9.map },
    hist: {
      protein: protein.bins, transcript: transcript.bins, mutation: mutation.bins, conservation: conservation.bins,
      essentialityCrispri: { lb: essLb.bins, m9: essM9.bins }, essentialityEcocyc: ecocycCounts,
      essentialityTnseq: tnseqCounts,
    },
  };
  cache.set(folder, b);
  return b;
}

// A gene's 0–1 score for a metric (used to mark its place on the distribution).
export function scoreOf(taxid: string, metric: Metric, uniqID: string): number | undefined {
  const org = getOrganism(taxid);
  if (!org) return undefined;
  return build(org.config.folder).maps[metric].get(uniqID);
}

// A gene's percentile rank (0–100) within a metric — fraction of genes with a value ≤ this one,
// rank-based so it matches the explorer's percentile thresholds. Cached per folder+metric.
const pctCache = new Map<string, Partial<Record<Metric, Map<string, number>>>>();
export function pctOf(taxid: string, metric: Metric, uniqID: string): number | undefined {
  const org = getOrganism(taxid);
  if (!org) return undefined;
  const folder = org.config.folder;
  let byMetric = pctCache.get(folder);
  if (!byMetric) { byMetric = {}; pctCache.set(folder, byMetric); }
  let m = byMetric[metric];
  if (!m) {
    const map = build(folder).maps[metric];
    const sorted = [...map.values()].sort((a, b) => a - b);
    const n = sorted.length || 1;
    m = new Map();
    for (const [u, v] of map) {
      let lo = 0, hi = sorted.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] <= v) lo = mid + 1; else hi = mid; }
      m.set(u, Math.round((lo / n) * 100));
    }
    byMetric[metric] = m;
  }
  return m.get(uniqID);
}

// Genome-wide value histograms for all metrics.
export function loadDistributions(taxid: string): Distributions | null {
  const org = getOrganism(taxid);
  if (!org) return null;
  return build(org.config.folder).hist;
}

// Every gene as a multiome point: identity + its six 0–1 metric scores (the same min-max normalised
// positions the field distributions use, so the scatters keep their value-space shape). Percentile
// thresholds are derived client-side by mapping a percentile to the score at that quantile. Genes
// with no metric at all are dropped to keep the payload to genes the scatters can show.
export function loadMultiome(taxid: string): Multiome | null {
  const org = getOrganism(taxid);
  if (!org) return null;
  const { maps } = build(org.config.folder);
  const get = (m: keyof Built['maps'], u: string) => maps[m].get(u) ?? null;
  const out: MultiomePoint[] = [];
  for (const f of org.store.all) {
    const p: MultiomePoint = {
      uniqID: f.uniqID, gene: f.gene, locus_tag: f.locus_tag, type: f.type, chrom: f.chrom,
      kgpc: f.KG_PC?.[0] ?? null,
      essLb: get('essentialityLb', f.uniqID), essM9: get('essentialityM9', f.uniqID),
      mutability: get('mutation', f.uniqID), conservation: get('conservation', f.uniqID),
      protein: get('protein', f.uniqID), transcript: get('transcript', f.uniqID),
    };
    if (p.essLb != null || p.essM9 != null || p.mutability != null || p.conservation != null || p.protein != null || p.transcript != null) out.push(p);
  }
  return out;
}
