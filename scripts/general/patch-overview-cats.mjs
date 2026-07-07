#!/usr/bin/env node
// One-off: add per-gene-line category MEMBERSHIP (`cats`) to already-built overview maps, so the pathway
// map can highlight a category's FULL annotated member set (not just the dominant-category territory subset).
// The overview build stores only each enzyme line's single dominant category (`color`); this recovers the
// complete membership from the gene→pathways index + the BRITE category of each pathway (taxonomy.json).
// No network. Idempotent. build-pathway-maps.mjs now emits `cats` directly for future builds.
//   node scripts/general/patch-overview-cats.mjs [taxid=83333]

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { RESOURCES, orgFolder } from '../lib/org.mjs';

function main() {
  const taxid = process.argv[2] || '83333';
  const folder = orgFolder(taxid);
  const pdir = resolve(RESOURCES, folder, 'pathway');

  const taxonomy = JSON.parse(readFileSync(resolve(pdir, 'taxonomy.json'), 'utf8'));
  const index = JSON.parse(readFileSync(resolve(pdir, 'index.json'), 'utf8')); // uniqID -> [{ id, name }]

  // pathway id -> category name, for the clickable metabolism territories (the same set catOf/regions use:
  // Metabolism super-section, excluding "Global and overview maps").
  const pw2cat = new Map();
  for (const s of taxonomy.sections) {
    if (s.name !== 'Metabolism') continue;
    for (const c of s.categories) {
      if (c.name === 'Global and overview maps') continue;
      for (const p of c.pathways) pw2cat.set(p.id, c.name);
    }
  }

  const ovDir = resolve(pdir, 'overview');
  const files = existsSync(ovDir) ? readdirSync(ovDir).filter((f) => /^\w+\d{5}\.json$/.test(f)) : [];
  for (const f of files) {
    const file = resolve(ovDir, f);
    const ov = JSON.parse(readFileSync(file, 'utf8'));
    let touched = 0;
    for (const gn of ov.genes ?? []) {
      const cats = new Set();
      for (const g of gn.genes ?? []) for (const pw of index[g.uniqID] ?? []) { const c = pw2cat.get(pw.id); if (c) cats.add(c); }
      gn.cats = [...cats].sort();
      if (gn.cats.length) touched++;
    }
    writeFileSync(file, JSON.stringify(ov));
    // quick sanity: membership count for one category vs dominant count
    const CAT = 'Lipid metabolism';
    const mem = (ov.genes ?? []).filter((g) => g.cats?.includes(CAT)).length;
    const dom = (ov.genes ?? []).filter((g) => g.color === (ov.regions ?? []).find((r) => r.label === CAT)?.color).length;
    console.log(`[cats] ${folder}/${f}: ${touched} lines with cats · "${CAT}" membership=${mem} dominant=${dom}`);
  }
}

main();
