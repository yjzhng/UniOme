#!/usr/bin/env node
// Precompute the KEGG pathway/function → member-gene indexes (the only relationship that was
// computed by scanning all features per request) into resources/<org>/relationship/, so the API
// serves shared pathway/function via a cheap index lookup. Each gene is listed once per term it
// has (no per-gene duplication), keyed by the lowest-level KEGG term (KG_PW / KG_FM), lowercased.
//   relationship/pathway_members.json   { "<kg_pw lower>": [{uniqID,gene,locus_tag,product,chrom}] }
//   relationship/function_members.json  { "<kg_fm lower>": [...] }
// (operon/regulon/modulon/domain co-members already come from their own on-disk indexes.)
//
// Usage: node scripts/build-relationships.mjs <taxid>

import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import Papa from 'papaparse';
import { RESOURCES, orgFolder } from '../lib/org.mjs';

const tags = (s) => (s ?? '').split(';').map((t) => t.trim()).filter(Boolean);

function main() {
  const taxid = process.argv[2] || '83333';
  const folder = orgFolder(taxid);
  const outDir = resolve(RESOURCES, folder, 'relationship');
  mkdirSync(outDir, { recursive: true });

  const dbFile = readdirSync(resolve(RESOURCES, folder)).find((f) => /_DB\.csv$/i.test(f));
  const rows = Papa.parse(readFileSync(resolve(RESOURCES, folder, dbFile), 'utf8'), { header: true, skipEmptyLines: true }).data;

  const pathway = {}; // kg_pw(lower) → [member]
  const fn = {}; // kg_fm(lower) → [member]
  for (const r of rows) {
    const uniqID = (r.uniqID ?? '').trim();
    if (!uniqID) continue;
    const member = { uniqID, gene: (r.gene ?? '').trim(), locus_tag: (r.locus_tag ?? '').trim(), product: (r.product ?? '').trim(), chrom: (r.chrom ?? '').trim() };
    for (const t of tags(r.KG_PW)) (pathway[t.toLowerCase()] ??= []).push(member);
    for (const t of tags(r.KG_FM)) (fn[t.toLowerCase()] ??= []).push(member);
  }

  writeFileSync(resolve(outDir, 'pathway_members.json'), JSON.stringify(pathway, null, 2) + '\n');
  writeFileSync(resolve(outDir, 'function_members.json'), JSON.stringify(fn, null, 2) + '\n');
  console.log(`[relationships] ${Object.keys(pathway).length} pathways + ${Object.keys(fn).length} functions → ${folder}/relationship/`);
}

main();
