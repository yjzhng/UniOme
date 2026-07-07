import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Regulation, RegulatoryMap, RegulationNetwork, RegulationEdges, Regulon } from '@uniome/shared';
import { getOrganism } from './organisms.js';
import { resourcesRoot } from './resources.js';

const RESOURCES = resourcesRoot();

// uniqID is a path component → validate charset to keep the lookup inside regulation/.
const UNIQID_RE = /^[A-Za-z0-9_-]+$/;

// ── Regulator overlap network (Regulation explorer) ──────────────────────────────────────────────
// Edge criteria: two regulators are linked when their target sets overlap enough to be meaningful.
// Jaccard (not raw shared count) is the weight, so a huge global regulator doesn't dominate; a small
// shared/Jaccard floor drops noise, and a cap keeps the densest organisms (e.g. Mtb) from hairballing.
const NET_MIN_SHARED = 2;
const NET_MIN_JACCARD = 0.1;
const NET_MAX_EDGES = 700;

type RegulonMembers = Record<string, { name: string; uniqID: string | null }[]>;
type RegulatorMeta = Record<string, { uniqID: string | null; type: string }>;

const membersCache = new Map<string, RegulonMembers>();
function regulonMembers(folder: string): RegulonMembers {
  const c = membersCache.get(folder);
  if (c) return c;
  let m: RegulonMembers;
  try { m = JSON.parse(readFileSync(resolve(RESOURCES, folder, 'regulation', 'regulon_members.json'), 'utf8')); }
  catch { m = {}; }
  membersCache.set(folder, m);
  return m;
}
function regulatorMeta(folder: string): RegulatorMeta {
  try { return JSON.parse(readFileSync(resolve(RESOURCES, folder, 'regulation', 'regulators.json'), 'utf8')); }
  catch { return {}; }
}

// One regulon's targets, looked up by regulator name (drill-down + pairwise compare).
export function loadRegulon(taxid: string, name: string): Regulon | null {
  const org = getOrganism(taxid);
  if (!org) return null;
  const targets = regulonMembers(org.config.folder)[name];
  return targets ? { name, targets } : null;
}

// Every regulator → target edge (with mode), for the static global regulatory network. Built from each
// regulator's own record (carries the mode) and cached; regulators without a gene fall back to the regulon
// membership index (no mode). Compact index-based shape keeps the payload small (~10k edges).
const edgesCache = new Map<string, RegulationEdges>();
export function loadRegulationEdges(taxid: string): RegulationEdges | null {
  const org = getOrganism(taxid);
  if (!org) return null;
  const folder = org.config.folder;
  const cached = edgesCache.get(folder);
  if (cached) return cached;

  const members = regulonMembers(folder);
  const meta = regulatorMeta(folder);
  const mode = (f: string | null | undefined) => (f === 'activator' ? 'a' : f === 'repressor' ? 'r' : f === 'dual' ? 'd' : '');

  const regNames = Object.keys(members);
  const targetIdx = new Map<string, number>();
  const targets: { u: string; g: string }[] = [];
  const tIndex = (u: string, g: string) => { let i = targetIdx.get(u); if (i == null) { i = targets.length; targetIdx.set(u, i); targets.push({ u, g }); } return i; };

  const regulators: RegulationEdges['regulators'] = [];
  const edges: RegulationEdges['edges'] = [];
  for (const name of regNames) {
    const uid = meta[name]?.uniqID ?? null;
    // the regulator's outgoing edges (mode-carrying); fall back to the membership index if empty/no gene
    let out: { uniqID: string | null; gene: string; function: string | null }[] = [];
    if (uid) {
      try {
        const rec: Regulation = JSON.parse(readFileSync(resolve(RESOURCES, folder, 'regulation', `${uid}.json`), 'utf8'));
        out = (rec.regulates ?? []).map((e) => ({ uniqID: e.uniqID, gene: e.name, function: e.function ?? null }));
      } catch { /* fall through */ }
    }
    if (!out.length) out = (members[name] ?? []).map((t) => ({ uniqID: t.uniqID, gene: t.name, function: null }));
    const buf = out.filter((t) => t.uniqID).map((t) => ({ t: tIndex(t.uniqID!, t.gene), m: mode(t.function) }));
    if (!buf.length) continue;
    const ri = regulators.length;
    regulators.push({ name, uniqID: uid, type: meta[name]?.type ?? 'other', size: buf.length });
    for (const b of buf) edges.push({ r: ri, t: b.t, m: b.m });
  }

  const result: RegulationEdges = { regulators, targets, edges };
  edgesCache.set(folder, result);
  return result;
}

const netCache = new Map<string, RegulationNetwork>();
export function loadRegulationNetwork(taxid: string): RegulationNetwork | null {
  const org = getOrganism(taxid);
  if (!org) return null;
  const cached = netCache.get(org.config.folder);
  if (cached) return cached;

  const members = regulonMembers(org.config.folder);
  const meta = regulatorMeta(org.config.folder);
  // regulator nodes (only those with ≥1 genome-resolved target), largest fan-out first
  const nodes = Object.keys(members)
    .map((name) => {
      const ids = new Set((members[name] ?? []).map((t) => t.uniqID).filter((u): u is string => !!u));
      return { name, uniqID: meta[name]?.uniqID ?? null, type: meta[name]?.type ?? 'other', size: ids.size, ids };
    })
    .filter((n) => n.size > 0)
    .sort((a, b) => b.size - a.size);

  // pairwise target-set overlap
  const edges: RegulationNetwork['edges'] = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const [small, big] = nodes[i].size < nodes[j].size ? [nodes[i].ids, nodes[j].ids] : [nodes[j].ids, nodes[i].ids];
      let shared = 0;
      for (const x of small) if (big.has(x)) shared++;
      if (shared < NET_MIN_SHARED) continue;
      const jaccard = shared / (nodes[i].size + nodes[j].size - shared);
      if (jaccard < NET_MIN_JACCARD) continue;
      edges.push({ a: i, b: j, shared, jaccard: Math.round(jaccard * 1000) / 1000 });
    }
  }
  edges.sort((a, b) => b.jaccard - a.jaccard);
  const net: RegulationNetwork = {
    regulators: nodes.map(({ name, uniqID, type, size }) => ({ name, uniqID, type, size })),
    edges: edges.slice(0, NET_MAX_EDGES),
  };
  netCache.set(org.config.folder, net);
  return net;
}

// The per-gene regulatory map (promoters / TFBS / terminators) — one bounded index per organism,
// keyed by uniqID, parsed + cached on first use.
const regMapCache = new Map<string, Record<string, RegulatoryMap>>();
export function loadRegulatoryMap(taxid: string, uniqID: string): RegulatoryMap | null {
  if (!UNIQID_RE.test(uniqID)) return null;
  const org = getOrganism(taxid);
  if (!org) return null;
  let idx = regMapCache.get(org.config.folder);
  if (!idx) {
    try { idx = JSON.parse(readFileSync(resolve(RESOURCES, org.config.folder, 'regulation', 'regulatory-map.json'), 'utf8')); }
    catch { idx = {}; }
    regMapCache.set(org.config.folder, idx!);
  }
  const m = idx![uniqID];
  return m && m.features?.length ? m : null;
}

// The pre-fetched regulatory relationships for a feature (scripts/organisms/83333_Ec/fetch-regulation.mjs), or null.
export function loadRegulation(taxid: string, uniqID: string): Regulation | null {
  if (!UNIQID_RE.test(uniqID)) return null;
  const org = getOrganism(taxid);
  if (!org) return null;
  let reg: Regulation;
  try {
    reg = JSON.parse(readFileSync(resolve(RESOURCES, org.config.folder, 'regulation', `${uniqID}.json`), 'utf8')) as Regulation;
  } catch {
    return null;
  }
  // Split each modulon's (possibly slash-joined) regulator string into individual TFs and resolve
  // them to genome features by gene name → so the UI can link each regulator to its entry.
  for (const m of reg.modulons ?? []) {
    if (!m.regulator) continue;
    const seen = new Set<string>();
    m.regulators = m.regulator
      .split(/[+/,]/)
      .map((s) => s.trim())
      .filter((s) => s && !seen.has(s.toLowerCase()) && seen.add(s.toLowerCase()))
      .map((name) => ({ name, uniqID: org.store.find(name)?.uniqID ?? null }));
  }
  return reg;
}
