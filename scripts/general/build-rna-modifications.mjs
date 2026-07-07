#!/usr/bin/env node
// Build a per-RNA MODIFICATION index (modified nucleotides — pseudouridine, methylations, …) from
// MODOMICS, the analogue of the protein PTM track. MODOMICS encodes modified residues as special
// characters in the sequence (`new_abbrev`, e.g. P = pseudouridine, 7 = m7G). For each E. coli
// rRNA / tRNA MODOMICS sequence we extract the modified positions, then map each onto our feature by
// its LOCAL SEQUENCE CONTEXT (a k-mer centred on the site) — robust to the small indels between rRNA
// operons / MODOMICS references. rRNA modifications apply to every copy of that rRNA (16S→rrsA-H,
// 23S→rrlA-H); tRNA modifications map to the tRNA gene whose sequence matches.
//
// Source: MODOMICS (genesilico.pl/modomics) JSON API, cached in _assets/modomics/.
// Writes resources/<org>/rna/modifications.json: { uniqID: [{ pos, symbol, name }] }
//
// Usage: node scripts/build-rna-modifications.mjs <taxid>

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import Papa from 'papaparse';
import { RESOURCES, orgFolder, findDb } from '../lib/org.mjs';

const MODO = 'https://genesilico.pl/modomics/api/sequences/?organism='; // + species (from the enriched DB)
const MOD_URL = 'https://genesilico.pl/modomics/api/modifications';
const FLANK = 12; // k-mer half-width for local-context mapping

function ensureJson(path, url) {
  if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf8'));
  execFileSync('curl', ['-sL', '-o', path, url], { stdio: 'inherit' });
  return JSON.parse(readFileSync(path, 'utf8'));
}

// MODOMICS modified-residue symbol (`new_abbrev`) → { name, base } (the unmodified reference base).
function symbolMap(mods) {
  const map = {};
  for (const m of (Array.isArray(mods) ? mods : Object.values(mods))) {
    if (m.new_abbrev && m.new_abbrev.length === 1) map[m.new_abbrev] = { name: m.name, base: (m.reference_moiety || ['N'])[0] };
  }
  return map;
}

// From a MODOMICS sequence: the unmodified sequence + the modified sites [{ i (0-based), symbol, name }].
function parseModoSeq(seq, sym) {
  let unmod = '';
  const sites = [];
  for (let i = 0; i < seq.length; i++) {
    const ch = seq[i];
    if ('ACGU'.includes(ch)) { unmod += ch; continue; }
    const s = sym[ch];
    unmod += s ? s.base : 'N';
    sites.push({ i, symbol: ch, name: s?.name ?? ch });
  }
  return { unmod, sites };
}

// Map a modified MODOMICS sequence onto a target RNA sequence by local context; returns the modified
// positions in target 1-based coordinates (only sites whose context maps uniquely + base matches).
function mapSites(unmod, sites, target) {
  const out = [];
  for (const { i, symbol, name } of sites) {
    const ctx = unmod.slice(Math.max(0, i - FLANK), i + FLANK + 1);
    const centre = i - Math.max(0, i - FLANK); // offset of the modified base within ctx
    let at = target.indexOf(ctx);
    if (at === -1 || target.indexOf(ctx, at + 1) !== -1) continue; // not found, or ambiguous
    out.push({ pos: at + centre + 1, symbol, name });
  }
  return out.sort((a, b) => a.pos - b.pos);
}

function main() {
  const taxid = process.argv[2] || '83333';
  const folder = orgFolder(taxid);
  // Enriched DB (core/) — needs rna_seq + species, which are genome columns absent from the prokDB core.
  const rows = Papa.parse(readFileSync(findDb(taxid), 'utf8'), { header: true, skipEmptyLines: true }).data;
  const species = (rows.find((r) => (r.species ?? '').trim())?.species ?? '').trim();
  if (!species) { console.error('[rna-mod] no species in DB — cannot query MODOMICS'); process.exit(1); }

  const cacheDir = resolve(RESOURCES, folder, '_assets', 'modomics');
  mkdirSync(cacheDir, { recursive: true });
  const seqs = ensureJson(resolve(cacheDir, `${taxid}_sequences.json`), MODO + encodeURIComponent(species));
  const sym = symbolMap(ensureJson(resolve(cacheDir, 'modifications.json'), MOD_URL));

  // Representative modified sequence per RNA class. rRNA: longest SSU (16S) / LSU (23S). tRNA: one
  // per subtype (longest, most-modified).
  const list = Object.values(seqs);
  const ssu = list.filter((v) => v.subtype === 'SSU').sort((a, b) => b.seq.length - a.seq.length)[0];
  const lsu = list.filter((v) => v.subtype === 'LSU').sort((a, b) => b.seq.length - a.seq.length)[0];
  const tRNAbySub = {};
  for (const v of list) if (v.type === 'tRNA') {
    const cur = tRNAbySub[v.subtype];
    if (!cur || v.seq.length > cur.seq.length) tRNAbySub[v.subtype] = v;
  }
  const parsed = (rec) => rec && parseModoSeq(rec.seq, sym);
  const pSSU = parsed(ssu), pLSU = parsed(lsu);

  const out = {};
  let rRNAn = 0, tRNAn = 0;
  for (const r of rows) {
    const uniqID = (r.uniqID ?? '').trim();
    const type = (r.type ?? '').trim();
    const seq = (r.rna_seq ?? '').toUpperCase();
    if (!uniqID || !seq) continue;
    if (type === 'rRNA') {
      const p = seq.length > 2000 ? pLSU : seq.length > 1000 ? pSSU : null; // 23S vs 16S; skip 5S
      if (!p) continue;
      const sites = mapSites(p.unmod, p.sites, seq);
      if (sites.length) { out[uniqID] = sites; rRNAn++; }
    } else if (type === 'tRNA') {
      // pick the MODOMICS tRNA whose unmodified sequence best matches this gene's
      let best = null, bestN = 0;
      for (const rec of Object.values(tRNAbySub)) {
        const p = parseModoSeq(rec.seq, sym);
        const sites = mapSites(p.unmod, p.sites, seq);
        if (sites.length > bestN) { bestN = sites.length; best = sites; }
      }
      if (best && best.length) { out[uniqID] = best; tRNAn++; }
    }
  }

  const outDir = resolve(RESOURCES, folder, 'rna'); mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, 'modifications.json'), JSON.stringify(out) + '\n');
  console.log(`[rna-mod] ${rRNAn} rRNA + ${tRNAn} tRNA genes modified → ${folder}/rna/modifications.json`);
}

main();
