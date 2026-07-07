import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type {
  ProteinDomains,
  ProteinInterproDomains,
  ProteinCddMotifs,
  ProteinDisorder,
  ProteinVariants,
  ProteinModifications,
  ProteinComplexes,
  ComplexChainMap,
  Reaction,
  ReactionParticipant,
  ProteinReactions,
} from '@uniome/shared';
import { getOrganism } from './organisms.js';
import { resourcesRoot } from './resources.js';

const RESOURCES = resourcesRoot();

// UniProt accessions are alphanumeric (+ rare dashes for isoforms). Reject anything
// else so the value can't escape the proteins/ directory.
const ACC_RE = /^[A-Za-z0-9-]+$/;

// The Complex Portal membership index is one bounded file per organism — read once per folder.
const complexCache = new Map<string, Record<string, ProteinComplexes>>();
export function loadProteinComplexes(taxid: string, acc: string): ProteinComplexes | null {
  if (!ACC_RE.test(acc)) return null;
  const org = getOrganism(taxid);
  if (!org) return null;
  let idx = complexCache.get(org.config.folder);
  if (!idx) {
    let parsed: Record<string, ProteinComplexes>;
    try { parsed = JSON.parse(readFileSync(resolve(RESOURCES, org.config.folder, 'proteins', 'complexes.json'), 'utf8')); }
    catch { parsed = {}; }
    idx = parsed;
    complexCache.set(org.config.folder, idx);
  }
  return idx[acc] ?? null;
}

// A complex's experimental structure (BinaryCIF), for the structure viewer's complex-state
// toggle. Local-first: fetched once from RCSB on first request, then cached on disk and served
// locally. Returns the bcif bytes, or null on a bad id / fetch failure.
const PDB_RE = /^[0-9a-z]{4}$/i;
export async function loadComplexStructure(taxid: string, pdbId: string): Promise<Buffer | null> {
  if (!PDB_RE.test(pdbId)) return null;
  const org = getOrganism(taxid);
  if (!org) return null;
  const id = pdbId.toLowerCase();
  const dir = resolve(RESOURCES, org.config.folder, 'proteins', 'complex_structures');
  const file = resolve(dir, `${id}.bcif`);
  if (existsSync(file)) return readFileSync(file);
  try {
    const res = await fetch(`https://models.rcsb.org/${id}.bcif`);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, buf);
    return buf;
  } catch {
    return null;
  }
}

// Chain → UniProt mapping for a complex structure, from PDBe SIFTS, resolved to our features
// (gene/uniqID) via the feature store. Fetched once per PDB id, cached as JSON. Lets the subunit
// table label chains by gene and link them to their entry.
export async function loadComplexChains(taxid: string, pdbId: string): Promise<ComplexChainMap | null> {
  if (!PDB_RE.test(pdbId)) return null;
  const org = getOrganism(taxid);
  if (!org) return null;
  const id = pdbId.toLowerCase();
  const dir = resolve(RESOURCES, org.config.folder, '_assets', 'complex_chains');
  const file = resolve(dir, `${id}.json`);
  if (existsSync(file)) { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { /* refetch */ } }
  try {
    const res = await fetch(`https://www.ebi.ac.uk/pdbe/api/mappings/uniprot/${id}`);
    if (!res.ok) return null;
    const data = await res.json() as Record<string, { UniProt?: Record<string, { mappings?: Array<{ chain_id?: string; struct_asym_id?: string }> }> }>;
    const uni = data?.[id]?.UniProt ?? {};
    const out: ComplexChainMap = {};
    for (const [acc, entry] of Object.entries(uni)) {
      const feat = org.store.find(acc);
      const value = { acc, gene: feat?.gene ?? null, uniqID: feat?.uniqID ?? null };
      for (const m of entry.mappings ?? []) {
        if (m.chain_id && !out[m.chain_id]) out[m.chain_id] = value;
        if (m.struct_asym_id && !out[m.struct_asym_id]) out[m.struct_asym_id] = value;
      }
    }
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, JSON.stringify(out) + '\n');
    return out;
  } catch {
    return null;
  }
}

// Read the locally-stored domain annotations for a protein, or null if the organism
// or file isn't present. Pure disk read — no external calls.
export function loadProteinDomains(taxid: string, acc: string): ProteinDomains | null {
  if (!ACC_RE.test(acc)) return null;
  const org = getOrganism(taxid);
  if (!org) return null;
  const path = resolve(RESOURCES, org.config.folder, 'proteins', 'domains', `${acc}.json`);
  try {
    const data = JSON.parse(readFileSync(path, 'utf8')) as ProteinDomains;
    // TED returns domains unsorted; order them by TED id (TED01, TED02, …) so the
    // table, track and sequence read consistently.
    const idNum = (d: ProteinDomains['domains'][number]) => {
      const m = /(\d+)/.exec(d.id);
      return m ? Number(m[1]) : Infinity;
    };
    data.domains?.sort((a, b) => idNum(a) - idNum(b));
    return data;
  } catch {
    return null;
  }
}

// Read the locally-stored InterPro representative domains for a protein, or null if the
// organism or file isn't present. Pure disk read — no external calls.
export function loadProteinInterpro(taxid: string, acc: string): ProteinInterproDomains | null {
  if (!ACC_RE.test(acc)) return null;
  const org = getOrganism(taxid);
  if (!org) return null;
  const path = resolve(RESOURCES, org.config.folder, 'proteins', 'interpro', `${acc}.json`);
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as ProteinInterproDomains;
  } catch {
    return null;
  }
}

// Read locally-stored CDD motifs for a protein, or null if absent. Pure disk read.
export function loadProteinCdd(taxid: string, acc: string): ProteinCddMotifs | null {
  if (!ACC_RE.test(acc)) return null;
  const org = getOrganism(taxid);
  if (!org) return null;
  const path = resolve(RESOURCES, org.config.folder, 'proteins', 'cdd', `${acc}.json`);
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as ProteinCddMotifs;
  } catch {
    return null;
  }
}

// Read locally-stored disordered regions for a protein, or null if absent. Pure disk read.
export function loadProteinDisorder(taxid: string, acc: string): ProteinDisorder | null {
  if (!ACC_RE.test(acc)) return null;
  const org = getOrganism(taxid);
  if (!org) return null;
  const path = resolve(RESOURCES, org.config.folder, 'proteins', 'disorder', `${acc}.json`);
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as ProteinDisorder;
  } catch {
    return null;
  }
}

// Read locally-stored sequence variants for a protein, or null if absent.
export function loadProteinVariants(taxid: string, acc: string): ProteinVariants | null {
  if (!ACC_RE.test(acc)) return null;
  const org = getOrganism(taxid);
  if (!org) return null;
  const path = resolve(RESOURCES, org.config.folder, 'proteins', 'variants', `${acc}.json`);
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as ProteinVariants;
  } catch {
    return null;
  }
}

// Read locally-stored modifications (PTMs) for a protein, or null if absent.
export function loadProteinModifications(taxid: string, acc: string): ProteinModifications | null {
  if (!ACC_RE.test(acc)) return null;
  const org = getOrganism(taxid);
  if (!org) return null;
  const path = resolve(RESOURCES, org.config.folder, 'proteins', 'modifications', `${acc}.json`);
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as ProteinModifications;
  } catch {
    return null;
  }
}

// Catalysed reactions (UniProt catalytic activity / Rhea) + the per-organism ChEBI structure index
// (id → SMILES) — both bounded files, parsed + cached on first use.
const reactionsCache = new Map<string, Record<string, Reaction[]>>();
const chebiCache = new Map<string, Record<string, { smiles: string; rgroup?: boolean }>>();
function readIndex<T>(folder: string, cache: Map<string, T>, ...parts: string[]): T {
  let idx = cache.get(folder);
  if (!idx) {
    try { idx = JSON.parse(readFileSync(resolve(RESOURCES, folder, ...parts), 'utf8')) as T; }
    catch { idx = {} as T; }
    cache.set(folder, idx);
  }
  return idx;
}
export function loadProteinReactions(taxid: string, acc: string): ProteinReactions | null {
  if (!ACC_RE.test(acc)) return null;
  const org = getOrganism(taxid);
  if (!org) return null;
  const idx = readIndex<Record<string, Reaction[]>>(org.config.folder, reactionsCache, 'proteins', 'reactions.json');
  const stored = idx[acc];
  if (!stored || !stored.length) return null;
  // Attach 2D structure SMILES to each participant from the ChEBI index.
  const chebi = readIndex<Record<string, { smiles: string; rgroup?: boolean }>>(org.config.folder, chebiCache, 'proteins', 'chebi.json');
  const attach = (p: ReactionParticipant): ReactionParticipant => {
    const st = p.chebi ? chebi[p.chebi] : undefined;
    return { name: p.name, chebi: p.chebi, smiles: st?.smiles ?? null, rgroup: st?.rgroup };
  };
  const reactions = stored.map((r) => ({ ...r, left: (r.left ?? []).map(attach), right: (r.right ?? []).map(attach) }));
  return { acc, source: 'UniProt / Rhea', reactions };
}

// Path to the locally-stored AlphaFold structure (BinaryCIF) for a protein, or null if
// absent. Structures are gitignored (large) and produced by scripts/general/fetch-protein-assets.mjs.
export function proteinStructurePath(taxid: string, acc: string): string | null {
  if (!ACC_RE.test(acc)) return null;
  const org = getOrganism(taxid);
  if (!org) return null;
  const path = resolve(RESOURCES, org.config.folder, 'proteins', 'structures', `${acc}.bcif`);
  return existsSync(path) ? path : null;
}
