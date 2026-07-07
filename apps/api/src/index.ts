import { logHistory, subscribeLogs } from './logbus.js'; // first: installs console capture before load-time logs
import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { getOrganism, listOrganisms } from './organisms.js';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  loadProteinDomains,
  loadProteinInterpro,
  loadProteinCdd,
  loadProteinDisorder,
  loadProteinVariants,
  loadProteinModifications,
  loadProteinReactions,
  loadProteinComplexes,
  loadComplexStructure,
  loadComplexChains,
  proteinStructurePath,
} from './proteins.js';
import {
  loadRnaEntry,
  loadRnaSecondaryStructure,
  loadRnaFeatures,
  loadRnaComplexes,
  rnaSvgPath,
  rnaStructurePath,
} from './rna.js';
import { loadInteractions, loadInteractionNetwork } from './interactions.js';
import { loadRegulation, loadRegulatoryMap, loadRegulationNetwork, loadRegulationEdges, loadRegulon } from './regulation.js';
import { loadShared, loadRelated } from './shared.js';
import { loadExpression } from './expression.js';
import { loadEssentiality } from './essentiality.js';
import { loadConservation } from './conservation.js';
import { loadMutation } from './mutation.js';
import { loadDistributions, loadMultiome } from './scoredist.js';
import { loadCoverage } from './coverage.js';
import { loadRelationshipOverview, loadRelationshipWindow, loadRelationshipClusters, loadClusterBridges } from './relmatrix.js';
import type { RelationshipType } from '@uniome/shared';
import { loadVariants, loadRnaModifications } from './variants.js';
import { loadSimilar } from './similarity.js';
import { loadGenePathways, loadPathwayMap, loadPathwayTaxonomy, loadPathwayGeneMembers, loadGeneOverviews, loadOverviewMap } from './pathways.js';
import { catalog } from './catalog.js';
import { startDownload, getProgress, subscribeProgress } from './downloads.js';

const app = Fastify({ logger: false });

app.get('/api/organisms', async () => listOrganisms());

// Catalog: every downloadable organism + whether its data is already present (with chromosome info
// for present ones, so the home page can render and link them without a second call).
app.get('/api/catalog', async () => {
  const present = new Map(listOrganisms().map((o) => [o.taxid, o]));
  const seen = new Set<string>();
  const out = catalog().map((e) => {
    seen.add(e.taxid);
    const p = present.get(e.taxid);
    // ready = data on disk & discovered; available = declared downloadable; planned = tile only.
    const status = p ? 'ready' : e.available ? 'available' : 'planned';
    return {
      taxid: e.taxid,
      nickname: e.nickname ?? null,
      keggid: e.keggid ?? null,
      name: e.name ?? null, // registry label shown before download
      status,
      // Display metadata is DB-derived — only known once the organism is present (ready).
      shortName: p?.shortName ?? null,
      scientificName: p?.scientificName ?? null,
      strain: p?.strain ?? null,
      bytes: e.bytes ?? null,
      chromosomes: p?.chromosomes ?? [],
    };
  });
  for (const o of present.values()) {
    if (seen.has(o.taxid)) continue; // present but not catalogued (e.g. manually dropped in)
    out.push({ taxid: o.taxid, nickname: null, keggid: null, name: null, status: 'ready', shortName: o.shortName, scientificName: o.scientificName, strain: o.strain, bytes: null, chromosomes: o.chromosomes });
  }
  return out;
});

// Start an organism's data download (idempotent). Progress is watched over the SSE route below.
app.post<{ Params: { taxid: string } }>('/api/organism/:taxid/download', async (req) => {
  void startDownload(req.params.taxid);
  return { started: true };
});

// SSE stream of an organism's download progress (replays the latest state on connect).
app.get<{ Params: { taxid: string } }>('/api/organism/:taxid/download/events', (req, reply) => {
  const { taxid } = req.params;
  reply.hijack();
  reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  const send = (p: unknown) => { try { reply.raw.write(`data: ${JSON.stringify(p)}\n\n`); } catch { /* closing */ } };
  const cur = getProgress(taxid);
  if (cur) send(cur);
  const unsub = subscribeProgress(taxid, send);
  req.raw.on('close', unsub);
});

// Server-log stream for the in-app Console tab (Server-Sent Events). Replays the recent buffer on
// connect, then pushes new lines live. Read-only diagnostics — no organism scoping.
app.get('/api/_logs', (req, reply) => {
  reply.hijack();
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  const send = (l: { t: number; level: string; msg: string }) => {
    try { reply.raw.write(`data: ${JSON.stringify(l)}\n\n`); } catch { /* socket closing */ }
  };
  for (const l of logHistory()) send(l);
  const unsub = subscribeLogs(send);
  req.raw.on('close', unsub);
});

app.get<{ Params: { taxid: string } }>(
  '/api/organism/:taxid/chromosomes',
  async (req, reply) => {
    const o = getOrganism(req.params.taxid);
    if (!o) return reply.code(404).send({ error: 'organism not found' });
    return o.chromosomes;
  }
);

app.get<{ Params: { taxid: string } }>(
  '/api/organism/:taxid/categories/KG_PC',
  async (req, reply) => {
    const o = getOrganism(req.params.taxid);
    if (!o) return reply.code(404).send({ error: 'organism not found' });
    return o.store.distinct('KG_PC');
  }
);

app.get<{ Params: { taxid: string } }>(
  '/api/organism/:taxid/categories/type',
  async (req, reply) => {
    const o = getOrganism(req.params.taxid);
    if (!o) return reply.code(404).send({ error: 'organism not found' });
    return o.store.distinct('type');
  }
);

app.get<{
  Params: { taxid: string };
  Querystring: { chrom?: string; from?: string; to?: string; type?: string; strand?: string };
}>('/api/organism/:taxid/features', async (req, reply) => {
  const o = getOrganism(req.params.taxid);
  if (!o) return reply.code(404).send({ error: 'organism not found' });
  const chromParam = req.query.chrom;
  const chromInfo = chromParam
    ? o.chromosomesById.get(chromParam)
    : o.chromosomes[0];
  if (!chromInfo) return reply.code(404).send({ error: 'chromosome not found' });
  const from = req.query.from ? Number(req.query.from) : 1;
  const to = req.query.to ? Number(req.query.to) : chromInfo.length;
  let result = o.store.inRange(chromInfo.id, from, to);
  if (req.query.type) {
    const types = req.query.type.split(',');
    result = result.filter((f) => types.includes(f.type));
  }
  if (req.query.strand === '+' || req.query.strand === '-') {
    const s = req.query.strand;
    result = result.filter((f) => f.strand === s);
  }
  return result;
});

app.get<{ Params: { taxid: string; acc: string } }>(
  '/api/organism/:taxid/protein/:acc/domains',
  async (req, reply) => {
    const domains = loadProteinDomains(req.params.taxid, req.params.acc);
    if (!domains) return reply.code(404).send({ error: 'domains not found' });
    return domains;
  }
);

app.get<{ Params: { taxid: string; acc: string } }>(
  '/api/organism/:taxid/protein/:acc/interpro',
  async (req, reply) => {
    const domains = loadProteinInterpro(req.params.taxid, req.params.acc);
    if (!domains) return reply.code(404).send({ error: 'interpro domains not found' });
    return domains;
  }
);

app.get<{ Params: { taxid: string; acc: string } }>(
  '/api/organism/:taxid/protein/:acc/cdd',
  async (req, reply) => {
    const motifs = loadProteinCdd(req.params.taxid, req.params.acc);
    if (!motifs) return reply.code(404).send({ error: 'cdd motifs not found' });
    return motifs;
  }
);

app.get<{ Params: { taxid: string; pdbId: string } }>(
  '/api/organism/:taxid/protein/complex-structure/:pdbId',
  async (req, reply) => {
    const buf = await loadComplexStructure(req.params.taxid, req.params.pdbId);
    if (!buf) return reply.code(404).send({ error: 'complex structure not found' });
    return reply.type('application/octet-stream').send(buf);
  }
);

app.get<{ Params: { taxid: string; pdbId: string } }>(
  '/api/organism/:taxid/protein/complex-chains/:pdbId',
  async (req, reply) => {
    const map = await loadComplexChains(req.params.taxid, req.params.pdbId);
    if (!map) return reply.code(404).send({ error: 'chain mapping not found' });
    return map;
  }
);

app.get<{ Params: { taxid: string; acc: string } }>(
  '/api/organism/:taxid/protein/:acc/complexes',
  async (req, reply) => {
    const complexes = loadProteinComplexes(req.params.taxid, req.params.acc);
    if (!complexes) return reply.code(404).send({ error: 'no complex membership' });
    return complexes;
  }
);

app.get<{ Params: { taxid: string; acc: string } }>(
  '/api/organism/:taxid/protein/:acc/disorder',
  async (req, reply) => {
    const disorder = loadProteinDisorder(req.params.taxid, req.params.acc);
    if (!disorder) return reply.code(404).send({ error: 'disorder not found' });
    return disorder;
  }
);

app.get<{ Params: { taxid: string; acc: string } }>(
  '/api/organism/:taxid/protein/:acc/variants',
  async (req, reply) => {
    const variants = loadProteinVariants(req.params.taxid, req.params.acc);
    if (!variants) return reply.code(404).send({ error: 'variants not found' });
    return variants;
  }
);

app.get<{ Params: { taxid: string; acc: string } }>(
  '/api/organism/:taxid/protein/:acc/modifications',
  async (req, reply) => {
    const mods = loadProteinModifications(req.params.taxid, req.params.acc);
    if (!mods) return reply.code(404).send({ error: 'modifications not found' });
    return mods;
  }
);

app.get<{ Params: { taxid: string; acc: string } }>(
  '/api/organism/:taxid/protein/:acc/reactions',
  async (req, reply) => {
    const reactions = loadProteinReactions(req.params.taxid, req.params.acc);
    if (!reactions) return reply.code(404).send({ error: 'reactions not found' });
    return reactions;
  }
);

app.get<{ Params: { taxid: string; acc: string } }>(
  '/api/organism/:taxid/protein/:acc/structure',
  async (req, reply) => {
    const path = proteinStructurePath(req.params.taxid, req.params.acc);
    if (!path) return reply.code(404).send({ error: 'structure not found' });
    return reply.type('application/octet-stream').send(readFileSync(path));
  }
);

// --- RNA assets (keyed by feature uniqID → resolved to an RNAcentral URS) -------
app.get<{ Params: { taxid: string; id: string } }>(
  '/api/organism/:taxid/rna/:id/entry',
  async (req, reply) => {
    const entry = loadRnaEntry(req.params.taxid, req.params.id);
    if (!entry) return reply.code(404).send({ error: 'rna entry not found' });
    return entry;
  }
);

app.get<{ Params: { taxid: string; id: string } }>(
  '/api/organism/:taxid/rna/:id/2d',
  async (req, reply) => {
    const s = loadRnaSecondaryStructure(req.params.taxid, req.params.id);
    if (!s) return reply.code(404).send({ error: '2d structure not found' });
    return s;
  }
);

app.get<{ Params: { taxid: string; id: string } }>(
  '/api/organism/:taxid/rna/:id/features',
  async (req, reply) => {
    const f = loadRnaFeatures(req.params.taxid, req.params.id);
    if (!f) return reply.code(404).send({ error: 'rna features not found' });
    return f;
  }
);

app.get<{ Params: { taxid: string; id: string } }>(
  '/api/organism/:taxid/rna/:id/complexes',
  async (req, reply) => {
    const d = loadRnaComplexes(req.params.taxid, req.params.id);
    if (!d) return reply.code(404).send({ error: 'no complex membership' });
    return d;
  }
);

app.get<{ Params: { taxid: string; id: string } }>(
  '/api/organism/:taxid/rna/:id/2d/svg',
  async (req, reply) => {
    const path = rnaSvgPath(req.params.taxid, req.params.id);
    if (!path) return reply.code(404).send({ error: '2d svg not found' });
    return reply.type('image/svg+xml').send(readFileSync(path));
  }
);

app.get<{ Params: { taxid: string; id: string } }>(
  '/api/organism/:taxid/rna/:id/structure',
  async (req, reply) => {
    const path = rnaStructurePath(req.params.taxid, req.params.id);
    if (!path) return reply.code(404).send({ error: 'structure not found' });
    return reply.type('application/octet-stream').send(readFileSync(path));
  }
);

app.get<{ Params: { taxid: string; id: string } }>(
  '/api/organism/:taxid/features/:id',
  async (req, reply) => {
    const o = getOrganism(req.params.taxid);
    if (!o) return reply.code(404).send({ error: 'organism not found' });
    const f = o.store.find(req.params.id);
    if (!f) return reply.code(404).send({ error: 'not found' });
    return f;
  }
);

app.get<{ Params: { taxid: string; id: string } }>(
  '/api/organism/:taxid/features/:id/siblings',
  async (req, reply) => {
    const o = getOrganism(req.params.taxid);
    if (!o) return reply.code(404).send({ error: 'organism not found' });
    if (!o.store.find(req.params.id)) return reply.code(404).send({ error: 'not found' });
    return o.store.siblings(req.params.id);
  }
);

app.get<{ Params: { taxid: string; id: string } }>(
  '/api/organism/:taxid/features/:id/interactions',
  async (req, reply) => {
    const d = loadInteractions(req.params.taxid, req.params.id);
    if (!d) return reply.code(404).send({ error: 'no interactions' });
    return d;
  }
);

app.get<{ Params: { taxid: string; id: string } }>(
  '/api/organism/:taxid/features/:id/interaction-network',
  async (req, reply) => {
    const d = loadInteractionNetwork(req.params.taxid, req.params.id);
    if (!d) return reply.code(404).send({ error: 'no interaction network' });
    return d;
  }
);

app.get<{ Params: { taxid: string; id: string } }>(
  '/api/organism/:taxid/features/:id/regulation',
  async (req, reply) => {
    const d = loadRegulation(req.params.taxid, req.params.id);
    if (!d) return reply.code(404).send({ error: 'no regulation' });
    return d;
  }
);

app.get<{ Params: { taxid: string; id: string } }>(
  '/api/organism/:taxid/features/:id/regulatory-map',
  async (req, reply) => {
    const d = loadRegulatoryMap(req.params.taxid, req.params.id);
    if (!d) return reply.code(404).send({ error: 'no regulatory map' });
    return d;
  }
);

// The global regulator overlap network (Regulation explorer).
app.get<{ Params: { taxid: string } }>(
  '/api/organism/:taxid/regulation-network',
  async (req, reply) => {
    const d = loadRegulationNetwork(req.params.taxid);
    if (!d) return reply.code(404).send({ error: 'no regulation network' });
    return d;
  }
);

// Every regulator → target edge (with mode), for the static global regulatory network.
app.get<{ Params: { taxid: string } }>(
  '/api/organism/:taxid/regulation-edges',
  async (req, reply) => {
    const d = loadRegulationEdges(req.params.taxid);
    if (!d) return reply.code(404).send({ error: 'not found' });
    return d;
  }
);

// One regulon's targets (drill-down + pairwise compare), by regulator name.
app.get<{ Params: { taxid: string }; Querystring: { name?: string } }>(
  '/api/organism/:taxid/regulon',
  async (req, reply) => {
    const name = (req.query.name ?? '').trim();
    if (!name) return reply.code(400).send({ error: 'name required' });
    const d = loadRegulon(req.params.taxid, name);
    if (!d) return reply.code(404).send({ error: 'no such regulon' });
    return d;
  }
);

app.get<{ Params: { taxid: string; id: string } }>(
  '/api/organism/:taxid/features/:id/expression',
  async (req, reply) => {
    const d = loadExpression(req.params.taxid, req.params.id);
    if (!d) return reply.code(404).send({ error: 'no expression' });
    return d;
  }
);

app.get<{ Params: { taxid: string; id: string } }>(
  '/api/organism/:taxid/features/:id/essentiality',
  async (req, reply) => {
    const d = loadEssentiality(req.params.taxid, req.params.id);
    if (!d) return reply.code(404).send({ error: 'no essentiality' });
    return d;
  }
);

app.get<{ Params: { taxid: string; id: string } }>(
  '/api/organism/:taxid/features/:id/conservation',
  async (req, reply) => {
    const d = loadConservation(req.params.taxid, req.params.id);
    if (!d) return reply.code(404).send({ error: 'no conservation' });
    return d;
  }
);

app.get<{ Params: { taxid: string; id: string } }>(
  '/api/organism/:taxid/features/:id/mutation',
  async (req, reply) => {
    const d = loadMutation(req.params.taxid, req.params.id);
    if (!d) return reply.code(404).send({ error: 'no mutation' });
    return d;
  }
);

app.get<{ Params: { taxid: string } }>(
  '/api/organism/:taxid/distributions',
  async (req, reply) => {
    const d = loadDistributions(req.params.taxid);
    if (!d) return reply.code(404).send({ error: 'no distributions' });
    return d;
  }
);

// Annotation-coverage summary (per info section/field) for the org-home coverage heatmap.
app.get<{ Params: { taxid: string } }>(
  '/api/organism/:taxid/coverage',
  async (req, reply) => {
    const d = loadCoverage(req.params.taxid);
    if (!d) return reply.code(404).send({ error: 'not found' });
    return d;
  }
);

app.get<{ Params: { taxid: string } }>(
  '/api/organism/:taxid/multiome',
  async (req, reply) => {
    const m = loadMultiome(req.params.taxid);
    if (!m) return reply.code(404).send({ error: 'no organism' });
    return m;
  }
);

const REL_TYPES = ['interaction', 'molecular', 'regulation', 'cellular'];
const relType = (t?: string) => (REL_TYPES.includes(t ?? '') ? t : 'interaction') as RelationshipType;
const relSource = (s?: string) => (/^[a-z-]+$/.test(s ?? '') ? (s as string) : 'all'); // sub-source filter; 'all' = combined

app.get<{ Params: { taxid: string }; Querystring: { type?: string; source?: string; bins?: string } }>(
  '/api/organism/:taxid/relationship-overview',
  async (req, reply) => {
    const m = loadRelationshipOverview(req.params.taxid, relType(req.query.type), relSource(req.query.source), Number(req.query.bins) || 128);
    if (!m) return reply.code(404).send({ error: 'no organism' });
    return m;
  }
);

app.get<{ Params: { taxid: string }; Querystring: { type?: string; source?: string; row?: string; col?: string; n?: string } }>(
  '/api/organism/:taxid/relationship-window',
  async (req, reply) => {
    const m = loadRelationshipWindow(req.params.taxid, relType(req.query.type), relSource(req.query.source), Number(req.query.row) || 0, Number(req.query.col) || 0, Number(req.query.n) || 40);
    if (!m) return reply.code(404).send({ error: 'no organism' });
    return m;
  }
);

app.get<{ Params: { taxid: string }; Querystring: { type?: string; source?: string } }>(
  '/api/organism/:taxid/relationship-clusters',
  async (req, reply) => {
    const m = loadRelationshipClusters(req.params.taxid, relType(req.query.type), relSource(req.query.source));
    if (!m) return reply.code(404).send({ error: 'no clusters' });
    return m;
  }
);

app.get<{ Params: { taxid: string }; Querystring: { type?: string; source?: string; a?: string; b?: string } }>(
  '/api/organism/:taxid/relationship-bridges',
  async (req, reply) => {
    const m = loadClusterBridges(req.params.taxid, relType(req.query.type), relSource(req.query.source), Number(req.query.a) || 0, Number(req.query.b) || 0);
    if (!m) return reply.code(404).send({ error: 'no organism' });
    return m;
  }
);

app.get<{ Params: { taxid: string; id: string } }>(
  '/api/organism/:taxid/features/:id/variants',
  async (req, reply) => {
    const d = loadVariants(req.params.taxid, req.params.id);
    if (!d) return reply.code(404).send({ error: 'no variants' });
    return d;
  }
);

app.get<{ Params: { taxid: string; id: string } }>(
  '/api/organism/:taxid/features/:id/rna-modifications',
  async (req, reply) => {
    const d = loadRnaModifications(req.params.taxid, req.params.id);
    if (!d) return reply.code(404).send({ error: 'no modifications' });
    return d;
  }
);

app.get<{ Params: { taxid: string; id: string } }>(
  '/api/organism/:taxid/features/:id/similar',
  async (req, reply) => {
    const d = loadSimilar(req.params.taxid, req.params.id);
    if (!d) return reply.code(404).send({ error: 'no similarity' });
    return d;
  }
);

app.get<{ Params: { taxid: string; id: string } }>(
  '/api/organism/:taxid/features/:id/shared',
  async (req, reply) => {
    const d = loadShared(req.params.taxid, req.params.id);
    if (!d) return reply.code(404).send({ error: 'no shared -ons' });
    return d;
  }
);

app.get<{ Params: { taxid: string; id: string } }>(
  '/api/organism/:taxid/features/:id/related',
  async (req, reply) => {
    const d = loadRelated(req.params.taxid, req.params.id);
    if (!d) return reply.code(404).send({ error: 'not found' });
    return d;
  }
);

// Which KEGG pathways this gene is in (for the pathway-map selector).
app.get<{ Params: { taxid: string; id: string } }>(
  '/api/organism/:taxid/features/:id/pathways',
  async (req, reply) => {
    const d = loadGenePathways(req.params.taxid, req.params.id);
    if (!d) return reply.code(404).send({ error: 'not found' });
    return d;
  }
);

// The KEGG BRITE pathway taxonomy (section → category → pathway) for the home Pathways browser tree.
app.get<{ Params: { taxid: string } }>(
  '/api/organism/:taxid/pathway-taxonomy',
  async (req, reply) => {
    const d = loadPathwayTaxonomy(req.params.taxid);
    if (!d) return reply.code(404).send({ error: 'no pathway taxonomy' });
    return d;
  }
);

// Pathway → member genes (inverse index) — lets the home browser highlight a whole taxonomy branch.
app.get<{ Params: { taxid: string } }>(
  '/api/organism/:taxid/pathway-genes',
  async (req, reply) => {
    const d = loadPathwayGeneMembers(req.params.taxid);
    if (!d) return reply.code(404).send({ error: 'not found' });
    return d;
  }
);

// A single KEGG pathway map (KGML-derived layout + nodes + reactions).
app.get<{ Params: { taxid: string; pathwayId: string } }>(
  '/api/organism/:taxid/pathway/:pathwayId',
  async (req, reply) => {
    const d = loadPathwayMap(req.params.taxid, req.params.pathwayId);
    if (!d) return reply.code(404).send({ error: 'no pathway map' });
    return d;
  }
);

// Global metabolic overview maps (whole-cell network) this gene sits on, + the full overview list.
app.get<{ Params: { taxid: string; id: string } }>(
  '/api/organism/:taxid/features/:id/overviews',
  async (req, reply) => {
    const d = loadGeneOverviews(req.params.taxid, req.params.id);
    if (!d) return reply.code(404).send({ error: 'not found' });
    return d;
  }
);

// A single overview map (enzyme polylines + metabolite dots).
app.get<{ Params: { taxid: string; pathwayId: string } }>(
  '/api/organism/:taxid/pathway-overview/:pathwayId',
  async (req, reply) => {
    const d = loadOverviewMap(req.params.taxid, req.params.pathwayId);
    if (!d) return reply.code(404).send({ error: 'no overview map' });
    return d;
  }
);

app.get<{ Params: { taxid: string }; Querystring: { q?: string } }>(
  '/api/organism/:taxid/search',
  async (req, reply) => {
    const o = getOrganism(req.params.taxid);
    if (!o) return reply.code(404).send({ error: 'organism not found' });
    const q = (req.query.q ?? '').trim();
    if (!q) return [];
    return o.store.search(q);
  }
);

export interface StartOptions {
  /** TCP port; defaults to $PORT or 4000. Pass 0 to let the OS pick a free port. */
  port?: number;
  host?: string;
  /** Resources root; if given, sets $UNIOME_RESOURCES (best-effort — prefer setting it before import). */
  resourcesDir?: string;
  /** Directory of the built web app (Vite dist). When set, the server also serves the SPA so the
   *  desktop window loads everything same-origin and the web app's relative /api calls just work. */
  webDir?: string;
}

// Boot the server. Returns the bound port (useful when port 0 was requested). The desktop shell
// calls this with { webDir } so one origin serves both the SPA and the API.
export async function start(opts: StartOptions = {}): Promise<{ port: number; url: string }> {
  if (opts.resourcesDir) process.env.UNIOME_RESOURCES = opts.resourcesDir;

  await app.register(cors, { origin: true });

  if (opts.webDir && existsSync(opts.webDir)) {
    await app.register(fastifyStatic, { root: opts.webDir, wildcard: false });
    // SPA fallback: non-/api routes that aren't real files return index.html (HashRouter means
    // the path is always '/', but this keeps deep links / reloads robust regardless).
    app.setNotFoundHandler((req, reply) => {
      if (req.raw.url?.startsWith('/api/')) return reply.code(404).send({ error: 'not found' });
      return reply.type('text/html').send(readFileSync(join(opts.webDir!, 'index.html')));
    });
  }

  const host = opts.host ?? '127.0.0.1';
  const port = opts.port ?? Number(process.env.PORT ?? 4000);
  await app.listen({ port, host });
  const bound = (app.server.address() as { port: number }).port;
  console.log(`[uniome] api listening on http://${host}:${bound}`);
  return { port: bound, url: `http://${host}:${bound}` };
}

// Standalone dev entry (`npm run dev` → tsx). When embedded in the desktop shell the bundle sets
// UNIOME_EMBED=1 and calls start() itself, so we don't auto-listen here. No top-level await, so the
// bundle can be emitted as CommonJS (fastify/avvio use require() and won't bundle to ESM cleanly).
if (process.env.UNIOME_EMBED !== '1') {
  start().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
