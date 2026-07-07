import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Interactions, InteractionNetwork } from '@uniome/shared';
import { getOrganism } from './organisms.js';
import { resourcesRoot } from './resources.js';

type Partner = Interactions['partners'][number];

const RESOURCES = resourcesRoot();

// uniqID is used as a path component here, so validate its charset to keep the lookup inside
// the interactions/ directory (unlike rna.ts, where uniqID is only ever an index key).
const UNIQID_RE = /^[A-Za-z0-9_-]+$/;

// The pre-fetched interactions for a feature (scripts/general/fetch-interactions.mjs), or null.
export function loadInteractions(taxid: string, uniqID: string): Interactions | null {
  if (!UNIQID_RE.test(uniqID)) return null;
  const org = getOrganism(taxid);
  if (!org) return null;
  try {
    const path = resolve(RESOURCES, org.config.folder, 'interactions', `${uniqID}.json`);
    return JSON.parse(readFileSync(path, 'utf8')) as Interactions;
  } catch {
    return null;
  }
}

const NETWORK_CAP = 60; // top-scoring partners to include as nodes
const evWeight = (p: Partner): number => (p.score != null ? p.score : p.db === 'IntAct' ? Math.min(0.9, 0.35 + (p.evidence ?? 1) * 0.06) : 0.4);
const dbOf = (p: Partner): 'STRING' | 'IntAct' | 'RNAInter' => (p.db === 'IntAct' ? 'IntAct' : p.db === 'RNAInter' ? 'RNAInter' : 'STRING');

// Assemble the focal gene's interaction network as an induced subgraph: take the top-scoring
// partners (with a uniqID) as the node set, then walk EACH node's own interaction file and keep
// every edge whose other endpoint is also in the set — yielding neighbour↔neighbour edges, so the
// graph clusters instead of being a star.
export function loadInteractionNetwork(taxid: string, uniqID: string): InteractionNetwork | null {
  const focal = loadInteractions(taxid, uniqID);
  if (!focal || !focal.partners.length) return null;

  const geneOf = new Map<string, string>([[uniqID, focal.gene]]);
  const best = new Map<string, number>();
  for (const p of focal.partners) {
    if (!p.uniqID || p.uniqID === uniqID) continue;
    if (!geneOf.has(p.uniqID)) geneOf.set(p.uniqID, p.name);
    const w = evWeight(p);
    if (w > (best.get(p.uniqID) ?? -1)) best.set(p.uniqID, w);
  }
  if (!best.size) return null;
  const neighbors = [...best.entries()].sort((a, b) => b[1] - a[1]).slice(0, NETWORK_CAP).map(([id]) => id);
  const nodeIds = new Set<string>([uniqID, ...neighbors]);

  type Agg = { source: string; target: string; score: number; db: 'STRING' | 'IntAct' | 'RNAInter'; physical: boolean; dbs: Set<string>; method: string | null };
  const edges = new Map<string, Agg>();
  for (const id of nodeIds) {
    const inter = id === uniqID ? focal : loadInteractions(taxid, id);
    if (!inter) continue;
    if (!geneOf.has(id)) geneOf.set(id, inter.gene);
    for (const p of inter.partners) {
      if (!p.uniqID || p.uniqID === id || !nodeIds.has(p.uniqID)) continue;
      if (!geneOf.has(p.uniqID)) geneOf.set(p.uniqID, p.name);
      const [a, b] = id < p.uniqID ? [id, p.uniqID] : [p.uniqID, id];
      const key = `${a}|${b}`;
      const w = evWeight(p), db = dbOf(p), physical = !!p.physical && db === 'STRING';
      const e = edges.get(key);
      if (!e) { edges.set(key, { source: a, target: b, score: w, db, physical, dbs: new Set([db]), method: p.method ?? null }); continue; }
      e.dbs.add(db);
      if (physical) e.physical = true;
      if (w > e.score) { e.score = w; e.db = db; if (p.method) e.method = p.method; }
    }
  }

  const org = getOrganism(taxid);
  return {
    focal: uniqID,
    nodes: [...nodeIds].map((id) => ({ uniqID: id, gene: geneOf.get(id) ?? id, kgpc: org?.store.find(id)?.KG_PC?.[0] ?? null })),
    edges: [...edges.values()].map((e) => ({ source: e.source, target: e.target, score: e.score, db: e.db, physical: e.physical, dbs: [...e.dbs], method: e.method })),
  };
}
