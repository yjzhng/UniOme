import Fastify from 'fastify';
import cors from '@fastify/cors';
import { getOrganism, listOrganisms } from './organisms.js';
import { readFileSync } from 'node:fs';
import { loadProteinDomains, proteinStructurePath } from './proteins.js';

const app = Fastify({ logger: false });
await app.register(cors, { origin: true });

app.get('/api/organisms', async () => listOrganisms());

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
  '/api/organism/:taxid/protein/:acc/structure',
  async (req, reply) => {
    const path = proteinStructurePath(req.params.taxid, req.params.acc);
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
  '/api/organism/:taxid/features/:id/related',
  async (req, reply) => {
    const o = getOrganism(req.params.taxid);
    if (!o) return reply.code(404).send({ error: 'organism not found' });
    if (!o.store.find(req.params.id)) return reply.code(404).send({ error: 'not found' });
    return o.store.related(req.params.id);
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

const port = Number(process.env.PORT ?? 4000);
await app.listen({ port, host: '127.0.0.1' });
console.log(`[uniome] api listening on http://127.0.0.1:${port}`);
