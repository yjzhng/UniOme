import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { RelationshipOverview, RelationshipWindow, RelationshipType, RelationshipClusters, RelationshipBridges } from '@uniome/shared';
import { getOrganism } from './organisms.js';
import { resourcesRoot } from './resources.js';

const RESOURCES = resourcesRoot();
const GROUP_CAP = 100; // skip co-membership groups bigger than this (uninformative — "everyone shares")

function readJson(folder: string, ...parts: string[]): Record<string, any> {
  try { return JSON.parse(readFileSync(resolve(RESOURCES, folder, ...parts), 'utf8')); }
  catch { return {}; }
}

type NB = Map<string, Map<string, number>>; // gene → (gene → weight), symmetric
const bump = (nb: NB, a: string, b: string, w: number) => { const m = nb.get(a) ?? nb.set(a, new Map()).get(a)!; if (w > (m.get(b) ?? 0)) m.set(b, w); };
const add = (nb: NB, a: string, b: string, w: number) => { const m = nb.get(a) ?? nb.set(a, new Map()).get(a)!; m.set(b, (m.get(b) ?? 0) + w); };

// Co-membership: every pair sharing a (capped) group gets +1, so the weight = number of shared groups.
function coMembership(termGenes: Map<string, string[]>): NB {
  const nb: NB = new Map();
  for (const genes of termGenes.values()) {
    if (genes.length < 2 || genes.length > GROUP_CAP) continue;
    for (let i = 0; i < genes.length; i++) for (let j = i + 1; j < genes.length; j++) { add(nb, genes[i], genes[j], 1); add(nb, genes[j], genes[i], 1); }
  }
  return nb;
}

function pathwayNeighbours(taxid: string, source: string): NB {
  const org = getOrganism(taxid)!;
  const termGenes = new Map<string, string[]>();
  const push = (u: string, t: string) => (termGenes.get(t) ?? termGenes.set(t, []).get(t)!).push(u);
  for (const f of org.store.all) {
    if (source !== 'function') for (const x of f.KG_PW ?? []) push(f.uniqID, 'P:' + x);
    if (source !== 'pathway') for (const x of f.KG_FM ?? []) push(f.uniqID, 'F:' + x);
  }
  return coMembership(termGenes);
}

function domainNeighbours(folder: string, source: string): NB {
  const termGenes = new Map<string, string[]>();
  const push = (u: string, t: string) => (termGenes.get(t) ?? termGenes.set(t, []).get(t)!).push(u);
  const inc = (s: string) => source === 'all' || source === s;
  if (inc('interpro')) for (const [u, arr] of Object.entries(readJson(folder, 'proteins', 'gene_domains.json'))) for (const d of arr as any[]) push(u, 'D:' + d.id);
  if (inc('cdd')) for (const [u, arr] of Object.entries(readJson(folder, 'proteins', 'gene_motifs.json'))) for (const m of arr as any[]) push(u, 'M:' + m.key);
  if (inc('ted')) for (const [u, arr] of Object.entries(readJson(folder, 'proteins', 'gene_ted.json'))) for (const d of arr as any[]) push(u, 'T:' + d.cath);
  return coMembership(termGenes);
}

function regulationNeighbours(taxid: string, source: string): NB {
  const folder = getOrganism(taxid)!.config.folder;
  const termGenes = new Map<string, string[]>();
  const push = (u: string, t: string) => (termGenes.get(t) ?? termGenes.set(t, []).get(t)!).push(u);
  const inc = (s: string) => source === 'all' || source === s;
  // regulon_members: regulon → [{uniqID}]. modulon_members: modulon → {members:[{uniqID}]}.
  if (inc('regulon')) for (const [r, arr] of Object.entries(readJson(folder, 'regulation', 'regulon_members.json'))) for (const m of arr as any[]) if (m?.uniqID) push(m.uniqID, 'R:' + r);
  if (inc('modulon')) for (const [r, v] of Object.entries(readJson(folder, 'regulation', 'modulon_members.json'))) for (const m of ((v as any)?.members ?? [])) if (m?.uniqID) push(m.uniqID, 'O:' + r);
  return coMembership(termGenes);
}

function similarityNeighbours(folder: string, file: string, key: string, scale: number): NB {
  const nb: NB = new Map();
  for (const [a, arr] of Object.entries(readJson(folder, 'proteins', file))) {
    for (const s of arr as any[]) {
      if (s.uniqID === a) continue;
      const w = ((s[key] as number) ?? 0) * scale;
      if (w <= 0) continue;
      bump(nb, a, s.uniqID, w); bump(nb, s.uniqID, a, w); // top-N lists are directional → symmetrise by max
    }
  }
  return nb;
}

function interactionNeighbours(folder: string, source: string): NB {
  const nb: NB = new Map();
  let dir: string[];
  try { dir = readdirSync(resolve(RESOURCES, folder, 'interactions')); } catch { return nb; }
  for (const file of dir) {
    if (!file.endsWith('.json')) continue;
    const u = file.slice(0, -5);
    let data: any;
    try { data = JSON.parse(readFileSync(resolve(RESOURCES, folder, 'interactions', file), 'utf8')); } catch { continue; }
    for (const p of data?.partners ?? []) {
      // STRING partners carry no `db` (just channels/score) — split by the `physical` flag; IntAct/RNAInter carry `db`.
      const tag = p.db ? String(p.db).toLowerCase() : (p.physical ? 'string-physical' : 'string-predicted');
      if (source !== 'all' && (source === 'string' ? !tag.startsWith('string') : tag !== source)) continue;
      const w = (p.score as number) ?? (p.evidence != null ? Math.min(0.9, 0.35 + p.evidence * 0.06) : 0.4);
      if (w <= 0 || !p.uniqID) continue;
      bump(nb, u, p.uniqID, w); bump(nb, p.uniqID, u, w);
    }
  }
  return nb;
}

// Neighbour graphs are bounded per organism but a touch heavy (interaction reads ~4k files), so cache.
const cache = new Map<string, NB>();
function neighbours(taxid: string, type: RelationshipType, source: string): NB {
  const org = getOrganism(taxid);
  if (!org) return new Map();
  const folder = org.config.folder;
  const ckey = `${folder}:${type}:${source}`;
  let nb = cache.get(ckey);
  if (nb) return nb;
  // Category → builder. For 'molecular' the SOURCE chooses domain co-membership vs seq/struct similarity.
  nb = type === 'interaction' ? interactionNeighbours(folder, source)
    : type === 'cellular' ? pathwayNeighbours(taxid, source)
    : type === 'regulation' ? regulationNeighbours(taxid, source)
    : source === 'sequence' ? similarityNeighbours(folder, 'seq_similar.json', 'identity', 1 / 100)
    : source === 'structure' ? similarityNeighbours(folder, 'struct_similar.json', 'tmscore', 1)
    : domainNeighbours(folder, source); // molecular: interpro / cdd / ted
  cache.set(ckey, nb);
  return nb;
}

// One Louvain level: greedily move each node into the neighbouring community that maximises modularity
// gain (k_{i,in} − Σ_tot·k_i / 2m), repeating until stable. Operates on a weighted adjacency (with
// self-loops, so aggregated levels work). Returns a compact community label per node.
function localMoving(adj: Map<number, number>[]): number[] {
  const N = adj.length;
  const deg = adj.map((m) => { let s = 0; for (const w of m.values()) s += w; return s; });
  const m2 = deg.reduce((a, b) => a + b, 0) || 1; // ≈ 2m; constant across candidates so the choice is exact
  const com = adj.map((_, i) => i);
  const comTot = deg.slice();
  for (let pass = 0, improved = true; improved && pass < 20; pass++) {
    improved = false;
    for (let i = 0; i < N; i++) {
      const ci = com[i];
      comTot[ci] -= deg[i];
      const w2c = new Map<number, number>();
      for (const [j, w] of adj[i]) { if (j === i) continue; const cj = com[j]; w2c.set(cj, (w2c.get(cj) ?? 0) + w); }
      let bestC = ci, bestGain = (w2c.get(ci) ?? 0) - (comTot[ci] * deg[i]) / m2;
      for (const [c, wic] of w2c) { const gain = wic - (comTot[c] * deg[i]) / m2; if (gain > bestGain) { bestGain = gain; bestC = c; } }
      com[i] = bestC; comTot[bestC] += deg[i];
      if (bestC !== ci) improved = true;
    }
  }
  const remap = new Map<number, number>(); let k = 0;
  return com.map((c) => { let r = remap.get(c); if (r == null) { r = k++; remap.set(c, r); } return r; });
}

// Weighted Louvain: iterate localMoving + aggregate-into-supernodes until communities stop merging.
function louvain(nb: NB): string[][] {
  const ids = [...nb.keys()];
  if (!ids.length) return [];
  const idx = new Map(ids.map((id, i) => [id, i]));
  let adj: Map<number, number>[] = ids.map((id) => { const m = new Map<number, number>(); for (const [b, w] of nb.get(id)!) { const j = idx.get(b); if (j != null) m.set(j, (m.get(j) ?? 0) + w); } return m; });
  let members: string[][] = ids.map((id) => [id]);
  for (let level = 0; level < 10; level++) {
    const com = localMoving(adj);
    const nCom = new Set(com).size;
    if (nCom === adj.length) break; // converged — no further merging
    const newAdj: Map<number, number>[] = Array.from({ length: nCom }, () => new Map());
    for (let s = 0; s < adj.length; s++) { const cs = com[s]; for (const [t, w] of adj[s]) { const ct = com[t]; newAdj[cs].set(ct, (newAdj[cs].get(ct) ?? 0) + w); } }
    const newMembers: string[][] = Array.from({ length: nCom }, () => []);
    for (let s = 0; s < adj.length; s++) newMembers[com[s]].push(...members[s]);
    adj = newAdj; members = newMembers;
  }
  return members;
}

// A global gene order grouped by Louvain community (largest first), so the full matrix is
// block-diagonal: clusters become contiguous runs. Returns both the flat order AND the communities
// themselves (each sorted hubs-first by degree), which the cluster view surfaces directly.
function globalOrder(nb: NB): { order: string[]; groups: string[][] } {
  const ids = [...nb.keys()];
  const deg = new Map(ids.map((id) => { let s = 0; for (const w of nb.get(id)!.values()) s += w; return [id, s] as const; }));
  const groups = louvain(nb).filter((g) => g.length).sort((a, b) => b.length - a.length);
  for (const c of groups) c.sort((a, b) => (deg.get(b) ?? 0) - (deg.get(a) ?? 0));
  const out: string[] = [];
  for (const c of groups) out.push(...c);
  return { order: out, groups };
}

// Per (organism, type): the neighbour graph + its global order/communities + global max weight, cached.
type GlobalRel = { order: string[]; groups: string[][]; nb: NB; max: number };
const gcache = new Map<string, GlobalRel>();
function globalRel(taxid: string, type: RelationshipType, source: string): GlobalRel | null {
  const org = getOrganism(taxid);
  if (!org) return null;
  const ckey = `${org.config.folder}:${type}:${source}`;
  let g = gcache.get(ckey);
  if (g) return g;
  const nb = neighbours(taxid, type, source);
  let max = 0;
  for (const m of nb.values()) for (const w of m.values()) if (w > max) max = w;
  const { order, groups } = globalOrder(nb);
  g = { order, groups, nb, max: max || 1 };
  gcache.set(ckey, g);
  return g;
}

// The communities surfaced as clusters: keep the meaningful ones (≥ MIN_CLUSTER members, top
// CLUSTER_CAP by size), and collapse the gene×gene graph into cluster×cluster meta-matrices —
// density (size-normalised mass) and enrichment (mass vs a degree-preserving null). Cached.
const MIN_CLUSTER = 3;
const CLUSTER_CAP = 30;
type ClusterStruct = {
  genes: { uniqID: string; gene: string; chrom: string }[];
  clusters: { id: number; label: string; size: number; offset: number; density: number; topClass: string | null; members: string[] }[];
  density: number[][];
  enrichment: number[][];
};
const cstructCache = new Map<string, ClusterStruct | null>();
function clusterStructure(taxid: string, type: RelationshipType, source: string): ClusterStruct | null {
  const org = getOrganism(taxid);
  const g = globalRel(taxid, type, source);
  if (!org || !g) return null;
  const ckey = `${org.config.folder}:${type}:${source}`;
  const cached = cstructCache.get(ckey);
  if (cached !== undefined) return cached;

  const kept = g.groups.filter((c) => c.length >= MIN_CLUSTER).slice(0, CLUSTER_CAP);
  if (!kept.length) { cstructCache.set(ckey, null); return null; }
  const K = kept.length;
  const clusterOf = new Map<string, number>();
  kept.forEach((members, i) => members.forEach((u) => clusterOf.set(u, i)));

  // Cluster×cluster contact mass (directed entries double-count undirected edges → symmetric).
  const contact = Array.from({ length: K }, () => new Array(K).fill(0));
  for (const [a, m] of g.nb) {
    const ca = clusterOf.get(a); if (ca == null) continue;
    for (const [b, w] of m) { const cb = clusterOf.get(b); if (cb == null) continue; contact[ca][cb] += w; }
  }
  // Cluster degrees (kept-only) for the enrichment null model.
  const degC = contact.map((row) => row.reduce((s, v) => s + v, 0));
  const totalDeg = degC.reduce((s, d) => s + d, 0) || 1;

  const density = Array.from({ length: K }, () => new Array(K).fill(0));
  const enrich = Array.from({ length: K }, () => new Array(K).fill(0));
  for (let i = 0; i < K; i++) for (let j = 0; j < K; j++) {
    const si = kept[i].length, sj = kept[j].length;
    const pairs = i === j ? si * (si - 1) : si * sj;
    density[i][j] = pairs > 0 ? contact[i][j] / pairs : 0;
    const expected = (degC[i] * degC[j]) / totalDeg;
    enrich[i][j] = expected > 0 ? contact[i][j] / expected : 0;
  }
  const norm = (mat: number[][]) => { let mx = 0; for (const r of mat) for (const v of r) if (v > mx) mx = v; if (mx > 0) for (const r of mat) for (let j = 0; j < r.length; j++) r[j] = Math.round((r[j] / mx) * 1000) / 1000; };
  norm(density); norm(enrich);

  const genes: { uniqID: string; gene: string; chrom: string }[] = [];
  const clusters = kept.map((members, i) => {
    const offset = genes.length;
    const classCount = new Map<string, number>();
    for (const u of members) { const c = org.store.find(u)?.KG_PC?.[0]; if (c) classCount.set(c, (classCount.get(c) ?? 0) + 1); }
    let topClass: string | null = null, best = 0;
    for (const [c, n] of classCount) if (n > best) { best = n; topClass = c; }
    const label = org.store.find(members[0])?.gene || members[0];
    for (const u of members) { const f = org.store.find(u); genes.push({ uniqID: u, gene: f?.gene || u, chrom: f?.chrom || '' }); }
    return { id: i, label, size: members.length, offset, density: density[i][i], topClass, members };
  });
  const out: ClusterStruct = { genes, clusters, density, enrichment: enrich };
  cstructCache.set(ckey, out);
  return out;
}

export function loadRelationshipClusters(taxid: string, type: RelationshipType, source: string): RelationshipClusters | null {
  const cs = clusterStructure(taxid, type, source);
  if (!cs) return null;
  return {
    type,
    genes: cs.genes,
    clusters: cs.clusters.map(({ id, label, size, offset, density, topClass }) => ({ id, label, size, offset, density, topClass })),
    contact: cs.density,
    enrichment: cs.enrichment,
  };
}

// The strongest gene pairs bridging two clusters (or, when a === b, the densest pairs within one) —
// the concrete connector genes behind an off-diagonal heatmap cell.
export function loadClusterBridges(taxid: string, type: RelationshipType, source: string, a: number, b: number): RelationshipBridges | null {
  const org = getOrganism(taxid);
  const cs = clusterStructure(taxid, type, source);
  const g = globalRel(taxid, type, source);
  if (!org || !cs || !g) return null;
  const A = cs.clusters[a]?.members, B = cs.clusters[b]?.members;
  if (!A || !B) return null;
  let pairs: { a: string; b: string; w: number }[] = [];
  if (a === b) {
    // Hub-anchored ego-network: the cluster hub (A[0] — members are hubs-first by global degree) plus its
    // strongest WITHIN-cluster neighbours, and the edges among them. Hub edges are kept first so the hub
    // is always in view and connected; the densest neighbour–neighbour edges then fill in the structure.
    const hub = A[0]; const member = new Set(A); const hm = g.nb.get(hub);
    const nbrs = hm ? [...hm.entries()].filter(([u, w]) => u !== hub && member.has(u) && w > 0).sort((x, y) => y[1] - x[1]).slice(0, 22).map(([u]) => u) : [];
    const hubEdges = nbrs.map((u) => ({ a: hub, b: u, w: hm!.get(u)! }));
    const nn: { a: string; b: string; w: number }[] = [];
    for (let i = 0; i < nbrs.length; i++) { const m = g.nb.get(nbrs[i]); if (!m) continue; for (let j = i + 1; j < nbrs.length; j++) { const w = m.get(nbrs[j]) ?? 0; if (w > 0) nn.push({ a: nbrs[i], b: nbrs[j], w }); } }
    nn.sort((x, y) => y.w - x.w);
    pairs = [...hubEdges, ...nn].slice(0, 70);
  } else {
    for (const ua of A) { const m = g.nb.get(ua); if (!m) continue; for (const ub of B) { const w = m.get(ub) ?? 0; if (w > 0) pairs.push({ a: ua, b: ub, w }); } }
    pairs.sort((x, y) => y.w - x.w);
    pairs = pairs.slice(0, 60);
  }
  // Global weighted degree: Σ of a gene's edge weights across the WHOLE relationship graph (not just the
  // shown pairs / this cluster) — the same quantity that defines the cluster hub. Drives node radius.
  const gdeg = (u: string) => { const m = g.nb.get(u); if (!m) return 0; let s = 0; for (const w of m.values()) s += w; return Math.round(s * 1000) / 1000; };
  const ref = (u: string) => { const f = org.store.find(u); return { uniqID: u, gene: f?.gene || u, chrom: f?.chrom || '', deg: gdeg(u) }; };
  return { pairs: pairs.map((p) => ({ a: ref(p.a), b: ref(p.b), w: Math.round(p.w * 1000) / 1000 })) };
}

// Static overview: the full ordered matrix downsampled to a bins×bins thumbnail (bin = max of its
// cells), plus the full ordered gene list for windowing.
export function loadRelationshipOverview(taxid: string, type: RelationshipType, source: string, bins: number): RelationshipOverview | null {
  const org = getOrganism(taxid);
  const g = globalRel(taxid, type, source);
  if (!org || !g) return null;
  const total = g.order.length;
  const B = Math.max(16, Math.min(256, bins || 128));
  const pos = new Map(g.order.map((id, i) => [id, i]));
  const binOf = (i: number) => (total <= 1 ? 0 : Math.min(B - 1, Math.floor((i / total) * B)));
  // Bin = SUM of its cells (i.e. local relationship DENSITY), not max — max-pooling lit up almost
  // every bin (one strong cell among ~1000 is enough) and hid the real sparsity. Normalise to the
  // densest bin; gentle gamma lifts faint-but-real structure without re-saturating.
  const grid = Array.from({ length: B }, () => new Array(B).fill(0));
  for (const [a, m] of g.nb) { const pa = pos.get(a); if (pa == null) continue; const ba = binOf(pa); for (const [b, w] of m) { const pb = pos.get(b); if (pb == null) continue; grid[ba][binOf(pb)] += w; } }
  let maxBin = 0;
  for (const row of grid) for (const v of row) if (v > maxBin) maxBin = v;
  const denom = Math.log1p(maxBin) || 1; // log scale — bin sums are heavily skewed (one dense cluster)
  if (maxBin > 0) for (const row of grid) for (let j = 0; j < row.length; j++) row[j] = Math.round((Math.log1p(row[j]) / denom) * 1000) / 1000;
  const genes = g.order.map((u) => { const f = org.store.find(u); return { uniqID: u, gene: f?.gene || u, chrom: f?.chrom || '' }; });
  return { type, total, genes, bins: grid };
}

// A window of the global order = rows [rowOffset, +n) × cols [colOffset, +n). On the diagonal
// (rowOffset === colOffset) it's a cluster's internal matrix; off-diagonal it's the relationships
// BETWEEN two regions. Normalised to the SAME global max as the overview so colours are comparable.
export function loadRelationshipWindow(taxid: string, type: RelationshipType, source: string, rowOffset: number, colOffset: number, n: number): RelationshipWindow | null {
  const g = globalRel(taxid, type, source);
  if (!g) return null;
  const total = g.order.length;
  const N = Math.max(10, Math.min(80, n || 40));
  const clamp = (o: number) => Math.max(0, Math.min(Math.max(0, total - N), o || 0));
  const rOff = clamp(rowOffset), cOff = clamp(colOffset);
  const rows = g.order.slice(rOff, rOff + N), cols = g.order.slice(cOff, cOff + N);
  const matrix = rows.map((ru) => { const m = g.nb.get(ru); return cols.map((cu) => (ru === cu || !m ? 0 : Math.round(((m.get(cu) ?? 0) / g.max) * 1000) / 1000)); });
  return { rowOffset: rOff, colOffset: cOff, n: rows.length, matrix };
}
