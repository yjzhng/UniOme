import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Regulation, SharedRelationships, RelatedData, RelatedMember } from '@uniome/shared';
import { getOrganism } from './organisms.js';
import { resourcesRoot } from './resources.js';

const RESOURCES = resourcesRoot();
const UNIQID_RE = /^[A-Za-z0-9_-]+$/;
const PER_GROUP = 40;

type Member = { name: string; uniqID: string | null };
type RegulonIndex = Record<string, Member[]>;
type ModulonIndex = Record<string, { regulator: string | null; function: string | null; members: Member[] }>;
type GroupMembersIndex = Record<string, { id: string; name: string; link: string; members: Member[] }>;
// Per-gene feature lists carry the viewer's palette index so the Relationships row can show a
// matching colour square. Keyed by the group's id field (id/cath/key/acc per source).
type GeneGroups = Record<string, { id: string; colorIndex?: number | null }[]>;
type RelatedIndex = Record<string, RelatedMember[]>;

// The -on / domain / KEGG → member-genes indexes are bounded; read once per folder.
const cache = new Map<string, {
  regulon: RegulonIndex; modulon: ModulonIndex;
  domainMembers: GroupMembersIndex; geneDomains: GeneGroups;
  tedMembers: GroupMembersIndex; geneTed: GeneGroups;
  motifMembers: GroupMembersIndex; geneMotifs: GeneGroups;
  familyMembers: GroupMembersIndex; geneFamily: GeneGroups;
  pathway: RelatedIndex; fn: RelatedIndex;
}>();
function indexes(folder: string) {
  let c = cache.get(folder);
  if (!c) {
    const read = (sub: string, f: string) => { try { return JSON.parse(readFileSync(resolve(RESOURCES, folder, sub, f), 'utf8')); } catch { return {}; } };
    // gene_ted / gene_motifs / gene_family use a `cath`/`key`/`acc` id field; normalise to `id`.
    const norm = (raw: Record<string, { id?: string; cath?: string; key?: string; acc?: string; colorIndex?: number | null }[]>): GeneGroups => {
      const out: GeneGroups = {};
      for (const [g, list] of Object.entries(raw)) out[g] = list.map((e) => ({ id: e.id ?? e.cath ?? e.key ?? e.acc ?? '', colorIndex: e.colorIndex ?? null }));
      return out;
    };
    c = {
      regulon: read('regulation', 'regulon_members.json'),
      modulon: read('regulation', 'modulon_members.json'),
      domainMembers: read('proteins', 'domain_members.json'),
      geneDomains: norm(read('proteins', 'gene_domains.json')),
      tedMembers: read('proteins', 'ted_members.json'),
      geneTed: norm(read('proteins', 'gene_ted.json')),
      motifMembers: read('proteins', 'motif_members.json'),
      geneMotifs: norm(read('proteins', 'gene_motifs.json')),
      familyMembers: read('relationship', 'family_members.json'),
      geneFamily: norm(read('relationship', 'gene_family.json')),
      pathway: read('relationship', 'pathway_members.json'),
      fn: read('relationship', 'function_members.json'),
    };
    cache.set(folder, c);
  }
  return c;
}

// Shared pathway / function: genes sharing this gene's lowest-level KEGG terms (KG_PW/KG_FM),
// from the precomputed indexes (no per-request scan). null when the gene is unknown.
export function loadRelated(taxid: string, uniqID: string): RelatedData | null {
  if (!UNIQID_RE.test(uniqID)) return null;
  const org = getOrganism(taxid);
  if (!org) return null;
  const base = org.store.find(uniqID);
  if (!base) return null;
  const { pathway, fn } = indexes(org.config.folder);
  const group = (terms: string[], idx: RelatedIndex): RelatedData['sharedPathway'] => {
    const out: RelatedData['sharedPathway'] = [];
    const seen = new Set<string>();
    for (const t of terms) {
      const k = t.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      const members = (idx[k] ?? []).filter((m) => m.uniqID !== uniqID).slice(0, PER_GROUP);
      if (members.length) out.push({ name: t, members });
    }
    return out;
  };
  return { sharedPathway: group(base.KG_PW, pathway), sharedFunction: group(base.KG_FM, fn) };
}

// Genes this gene shares a group with: operon co-members, per-regulon, per-modulon, per-domain.
// Returns null only when the gene has no shared groups at all.
export function loadShared(taxid: string, uniqID: string): SharedRelationships | null {
  if (!UNIQID_RE.test(uniqID)) return null;
  const org = getOrganism(taxid);
  if (!org) return null;
  let reg: Regulation | null = null;
  try {
    reg = JSON.parse(readFileSync(resolve(RESOURCES, org.config.folder, 'regulation', `${uniqID}.json`), 'utf8')) as Regulation;
  } catch {
    reg = null;
  }
  const idx = indexes(org.config.folder);
  const { regulon, modulon } = idx;
  const notSelf = (m: Member) => m.uniqID !== uniqID;

  // Genes sharing one of this gene's feature groups (domains/motifs/families): one SharedGroup
  // per group, carrying the viewer's colorIndex so the row can show a matching colour square.
  const sharedFromGroups = (gene: GeneGroups, members: GroupMembersIndex): SharedRelationships['sharedDomainTed'] => {
    const seen = new Set<string>();
    const out: SharedRelationships['sharedDomainTed'] = [];
    for (const { id, colorIndex } of gene[uniqID] ?? []) {
      if (seen.has(id)) continue;
      seen.add(id);
      const d = members[id];
      if (!d) continue;
      const ms = d.members.filter(notSelf);
      if (ms.length) out.push({ name: d.name, link: d.link, colorIndex: colorIndex ?? null, members: ms });
    }
    return out;
  };

  const sharedOperon = (reg?.operons ?? [])
    .map((op) => ({ name: op.name, link: op.link, members: op.members.filter(notSelf) }))
    .filter((g) => g.members.length > 0);
  // Regulon membership = the distinct regulators acting on this gene (inferred from regulatedBy).
  const regSeen = new Set<string>();
  const sharedRegulon = (reg?.regulatedBy ?? [])
    .filter((r) => !regSeen.has(r.name) && regSeen.add(r.name))
    .map((r) => ({ name: r.name, link: r.link ?? null, regulatorType: r.regulatorType ?? null, members: (regulon[r.name] ?? []).filter(notSelf) }))
    .filter((g) => g.members.length > 0);
  const sharedModulon = (reg?.modulons ?? [])
    .map((mo) => ({ name: mo.name, link: mo.link ?? null, regulator: mo.regulator ?? null, members: (modulon[mo.name]?.members ?? []).filter(notSelf) }))
    .filter((g) => g.members.length > 0);
  const sharedDomainInterpro = sharedFromGroups(idx.geneDomains, idx.domainMembers);
  const sharedDomainTed = sharedFromGroups(idx.geneTed, idx.tedMembers);
  const sharedMotif = sharedFromGroups(idx.geneMotifs, idx.motifMembers);
  const sharedFamily = sharedFromGroups(idx.geneFamily, idx.familyMembers);

  if (!sharedOperon.length && !sharedRegulon.length && !sharedModulon.length
    && !sharedDomainTed.length && !sharedDomainInterpro.length && !sharedMotif.length && !sharedFamily.length) return null;
  return { uniqID, sharedOperon, sharedRegulon, sharedModulon, sharedDomainTed, sharedDomainInterpro, sharedMotif, sharedFamily };
}
