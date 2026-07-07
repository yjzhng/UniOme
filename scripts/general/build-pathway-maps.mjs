#!/usr/bin/env node
// Build KEGG pathway MAPS (KGML) for an organism. Downloads each pathway's KGML once (cached), maps
// its eco:b#### gene boxes to our uniqIDs, and writes a compact per-pathway map + a gene→pathways
// index, so the entry page can render the real metabolic diagram and overlay interactions /
// similarity onto the focal gene's co-pathway neighbours.
//   pathway/index.json      { uniqID: [ { id, name } ] }            — which pathways each gene is in
//   pathway/maps/<id>.json  { id, name, bounds, genes, compounds, orthologs, maps, reactions }
// KGML carries real x,y layout coords, so no force layout is needed — it's the canonical KEGG map.
//
// Usage: node scripts/build-pathway-maps.mjs [taxid=83333] [orgcode=eco]
// KEGG REST is free for academic use; data is license-restricted for redistribution.

import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import Papa from 'papaparse';
import { RESOURCES, orgFolder } from '../lib/org.mjs';

const KEGG = 'https://rest.kegg.jp';
// KEGG "global & overview" maps (eco011xx = metabolism/biosynthesis super-maps; eco012xx = overview
// maps like Carbon metabolism / Biosynthesis of amino acids) draw genes as LINE graphics on a custom
// network layout — they have no box x/y/w/h, so our box renderer can't place them (every gene lands
// at the origin). Skip them; the detailed per-pathway maps (eco00xxx) cover the same content.
// KEGG gene-id prefix (`<orgcode>:`) and the global/overview-map skip pattern — set per organism in
// main() from the orgcode. Defaults are E. coli so a bare run still works.
let orgPrefix = /^eco:/;
let skipRe = /^eco01[12]\d\d$/;
const SLEEP_MS = 120; // be polite to KEGG REST

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const attr = (s, k) => { const m = s.match(new RegExp(`\\b${k}="([^"]*)"`)); return m ? m[1] : null; };

// Trace the outline of a binary cell region into ordered, closed grid-corner loops. Each cell of the
// region contributes its boundary edges (those whose neighbour across them is outside the region), wound
// region-on-the-left; the edges stitch into closed loops (outer rings + holes wind opposite ways).
function traceLoops(isIn, rows, cols) {
  const E = [];
  const byStart = new Map();
  const add = (ax, ay, bx, by) => { const i = E.length; E.push({ ax, ay, bx, by, used: false }); const k = ax + ',' + ay; (byStart.get(k) ?? byStart.set(k, []).get(k)).push(i); };
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if (!isIn(r, c)) continue;
    if (!isIn(r - 1, c)) add(c + 1, r, c, r);         // top
    if (!isIn(r + 1, c)) add(c, r + 1, c + 1, r + 1); // bottom
    if (!isIn(r, c - 1)) add(c, r, c, r + 1);         // left
    if (!isIn(r, c + 1)) add(c + 1, r + 1, c + 1, r); // right
  }
  const loops = [];
  for (let i = 0; i < E.length; i++) {
    if (E[i].used) continue;
    const loop = []; let cur = i;
    while (cur !== -1 && !E[cur].used) {
      const e = E[cur]; e.used = true; loop.push([e.ax, e.ay]);
      const cand = (byStart.get(e.bx + ',' + e.by) || []).find((j) => !E[j].used);
      cur = cand === undefined ? -1 : cand;
    }
    if (loop.length >= 4) { loop.push(loop[0]); loops.push(loop); }
  }
  return loops;
}
// drop boundary points that are collinear with their neighbours (the rectilinear outline → just corners)
function mergeCollinear(loop) {
  const pts = loop.slice(0, -1), n = pts.length;
  if (n < 3) return loop;
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = pts[(i - 1 + n) % n], b = pts[i], c = pts[(i + 1) % n];
    if ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) !== 0) out.push(b);
  }
  if (out.length < 3) return loop;
  out.push(out[0]);
  return out;
}
// Ramer–Douglas–Peucker: simplify a polyline to its significant corners (keeps endpoints). Turns the
// rectilinear staircase into a few straight edges → a clean angular territory instead of a blob.
const perpDist = (p, a, b) => {
  const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
  return L === 0 ? Math.hypot(p[0] - a[0], p[1] - a[1]) : Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / L;
};
function rdp(points, eps) {
  if (points.length < 3) return points;
  const a = points[0], b = points[points.length - 1];
  let dmax = -1, idx = 0;
  for (let i = 1; i < points.length - 1; i++) { const d = perpDist(points[i], a, b); if (d > dmax) { dmax = d; idx = i; } }
  if (dmax > eps) return rdp(points.slice(0, idx + 1), eps).slice(0, -1).concat(rdp(points.slice(idx), eps));
  return [a, b];
}
// closed-loop simplify: anchor at two far-apart points, RDP each arc, recombine (a single anchor would
// let RDP collapse the opposite side of the ring)
function simplifyLoop(loop, eps) {
  const pts = loop.slice(0, -1);
  if (pts.length < 5) return loop;
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  let ia = 0, da = -1; pts.forEach((p, i) => { const d = Math.hypot(p[0] - cx, p[1] - cy); if (d > da) { da = d; ia = i; } });
  let ib = 0, db = -1; pts.forEach((p, i) => { const d = Math.hypot(p[0] - pts[ia][0], p[1] - pts[ia][1]); if (d > db) { db = d; ib = i; } });
  if (ia > ib) [ia, ib] = [ib, ia];
  const s1 = rdp(pts.slice(ia, ib + 1), eps), s2 = rdp(pts.slice(ib).concat(pts.slice(0, ia + 1)), eps);
  const out = s1.slice(0, -1).concat(s2.slice(0, -1));
  if (out.length < 3) return loop;
  out.push(out[0]);
  return out;
}
const ringArea = (pts) => { let a = 0; for (let i = 0; i + 1 < pts.length; i++) a += pts[i][0] * pts[i + 1][1] - pts[i + 1][0] * pts[i][1]; return a / 2; };
// Snap a polygon to OCTILINEAR edges — horizontal, vertical, or 45° diagonals only, so every turn is
// 90° or 45°. Each edge becomes an axis-aligned run along its longer side plus a 45° run into the vertex.
function octilinear(loop) {
  const src = loop.slice(0, -1), n = src.length, raw = [];
  for (let i = 0; i < n; i++) {
    const P = src[i], Q = src[(i + 1) % n];
    const dx = Q[0] - P[0], dy = Q[1] - P[1], adx = Math.abs(dx), ady = Math.abs(dy);
    raw.push(P);
    if (adx > ady && ady > 0) raw.push([P[0] + Math.sign(dx) * (adx - ady), P[1]]); // straight, then 45° into Q
    else if (ady > adx && adx > 0) raw.push([P[0], P[1] + Math.sign(dy) * (ady - adx)]);
  }
  const out = [];
  for (const p of raw) { const q = out[out.length - 1]; if (!q || q[0] !== p[0] || q[1] !== p[1]) out.push(p); }
  out.push(out[0]);
  return out;
}

// KEGG BRITE br08901 = the pathway-map hierarchy: B lines are metabolism categories, C lines are
// pathways under them. Parse to pathwayId(eco#####) → category name, so overview enzyme lines can be
// grouped into the labelled coloured territories of the canonical KEGG metabolic map.
function parseBrite(txt, org) {
  const cat = new Map();
  let curA = null, curB = null;
  for (const line of txt.split('\n')) {
    if (line.startsWith('A')) { curA = line.replace(/<\/?b>/g, '').slice(1).trim(); curB = null; }
    else if (line.startsWith('B')) { curB = line.replace(/<\/?b>/g, '').slice(1).trim() || null; }
    // only the canonical metabolic territories (the Metabolism super-section of the KEGG map)
    else if (line.startsWith('C') && curB && curB !== 'Global and overview maps' && /^Metabolism/i.test(curA || '')) { const m = line.match(/\b(\d{5})\b/); if (m) cat.set(org + m[1], curB); }
  }
  return cat;
}

async function get(url, { timeout = 20000 } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) throw new Error(`${r.status} ${url}`);
    return await r.text();
  } finally { clearTimeout(t); }
}

// KGML → compact map. Entry graphics x,y are the object CENTRE; keep centre + w/h, the renderer
// derives corners. Reactions reference compound ENTRY ids as substrate/product.
function parseKgml(xml, id, name, locusMap) {
  const genes = [], compounds = [], orthologs = [], maps = [];
  let maxX = 0, maxY = 0;
  const entryRe = /<entry\b([^>]*)>([\s\S]*?)<\/entry>/g;
  let m;
  while ((m = entryRe.exec(xml))) {
    const head = m[1], body = m[2];
    const type = attr(head, 'type');
    const ename = attr(head, 'name') ?? '';
    const g = body.match(/<graphics\b([^>]*?)\/?>/);
    if (!g) continue;
    const gx = g[1];
    const x = +attr(gx, 'x'), y = +attr(gx, 'y'), w = +attr(gx, 'width'), h = +attr(gx, 'height');
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    maxX = Math.max(maxX, x + (w || 0) / 2); maxY = Math.max(maxY, y + (h || 0) / 2);
    const label = (attr(gx, 'name') ?? '').split(',')[0].trim();
    const eid = attr(head, 'id');
    if (type === 'gene') {
      // name = "eco:b0002 eco:b3940 …" → our genes
      const ours = ename.split(/\s+/).map((t) => t.replace(orgPrefix, '')).map((lt) => locusMap.get(lt)).filter(Boolean);
      genes.push({ id: eid, x, y, w, h, label, genes: ours });
    } else if (type === 'compound') {
      compounds.push({ id: eid, x, y, w, h, label, cnum: ename.split(/\s+/)[0].replace(/^cpd:/, '') });
    } else if (type === 'ortholog') {
      orthologs.push({ id: eid, x, y, w, h, label });
    } else if (type === 'map') {
      maps.push({ id: eid, x, y, w, h, label, pathwayId: ename.replace(/^path:/, '') });
    }
  }
  const reactions = [];
  const rxnRe = /<reaction\b([^>]*)>([\s\S]*?)<\/reaction>/g;
  while ((m = rxnRe.exec(xml))) {
    const enzyme = attr(m[1], 'id'); // KGML reaction id = the catalysing gene/ortholog entry id
    const reversible = attr(m[1], 'type') === 'reversible';
    const subs = [...m[2].matchAll(/<substrate\b([^>]*?)\/?>/g)].map((s) => attr(s[1], 'id'));
    const prods = [...m[2].matchAll(/<product\b([^>]*?)\/?>/g)].map((s) => attr(s[1], 'id'));
    if (subs.length && prods.length) reactions.push({ enzyme, substrates: subs, products: prods, reversible });
  }
  // maplink relations: a metabolite that continues into another pathway. Attach the bridging compound
  // entry-id(s) to each map-link box, so the UI can draw a dashed arrow metabolite → linked pathway.
  const mapIds = new Set(maps.map((mm) => mm.id)), cpdIds = new Set(compounds.map((c) => c.id));
  const via = new Map();
  const relRe = /<relation\b([^>]*)>([\s\S]*?)<\/relation>/g;
  while ((m = relRe.exec(xml))) {
    if (attr(m[1], 'type') !== 'maplink') continue;
    const e1 = attr(m[1], 'entry1'), e2 = attr(m[1], 'entry2');
    const mapId = mapIds.has(e1) ? e1 : mapIds.has(e2) ? e2 : null;
    const cpd = (m[2].match(/<subtype name="compound" value="(\d+)"/) || [])[1];
    if (mapId && cpd && cpdIds.has(cpd)) (via.get(mapId) ?? via.set(mapId, new Set()).get(mapId)).add(cpd);
  }
  for (const mm of maps) mm.via = [...(via.get(mm.id) ?? [])];
  return { id, name, bounds: { w: Math.ceil(maxX + 20), h: Math.ceil(maxY + 20) }, genes, compounds, orthologs, maps, reactions };
}

// The organism KGML only lists reactions catalysed by genes the organism HAS, so steps it lacks leave
// their metabolites unconnected. KEGG's REFERENCE map (ko#####) has the full reaction set at identical
// coordinates — parse its reactions as compound C-number pairs so the build can add the missing edges.
function parseRefReactions(xml) {
  const cnum = new Map(); // compound entry id → C-number
  const entryRe = /<entry\b([^>]*)>/g;
  let m;
  while ((m = entryRe.exec(xml))) {
    if (attr(m[1], 'type') !== 'compound') continue;
    const id = attr(m[1], 'id'), c = (attr(m[1], 'name') ?? '').split(/\s+/)[0].replace(/^cpd:/, '');
    if (id && c) cnum.set(id, c);
  }
  const out = [];
  const rxnRe = /<reaction\b([^>]*)>([\s\S]*?)<\/reaction>/g;
  while ((m = rxnRe.exec(xml))) {
    const reversible = attr(m[1], 'type') === 'reversible';
    const subs = [...m[2].matchAll(/<substrate\b([^>]*?)\/?>/g)].map((s) => cnum.get(attr(s[1], 'id'))).filter(Boolean);
    const prods = [...m[2].matchAll(/<product\b([^>]*?)\/?>/g)].map((s) => cnum.get(attr(s[1], 'id'))).filter(Boolean);
    if (subs.length && prods.length) out.push({ subs, prods, reversible });
  }
  return out;
}
// Merge reference reactions (C-number pairs) into the org map as faded edges, using the org's compound
// positions. Skips pairs the org already draws. Returns the count added.
function mergeRefEdges(map, refRx) {
  const byCnum = new Map(); // C-number → [org compound entry id]
  for (const c of map.compounds) if (c.cnum) (byCnum.get(c.cnum) ?? byCnum.set(c.cnum, []).get(c.cnum)).push(c.id);
  const have = new Set();
  const pair = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  for (const r of map.reactions) for (const s of r.substrates) for (const p of r.products) have.add(pair(s, p));
  let added = 0;
  for (const r of refRx) {
    const subs = r.subs.flatMap((c) => byCnum.get(c) ?? []), prods = r.prods.flatMap((c) => byCnum.get(c) ?? []);
    if (!subs.length || !prods.length) continue;
    const newSub = [], newProd = [];
    for (const s of subs) for (const p of prods) if (s !== p && !have.has(pair(s, p))) { have.add(pair(s, p)); if (!newSub.includes(s)) newSub.push(s); if (!newProd.includes(p)) newProd.push(p); }
    if (newSub.length && newProd.length) { map.reactions.push({ enzyme: null, substrates: newSub, products: newProd, reversible: r.reversible, ref: true }); added++; }
  }
  return added;
}

// Global/overview maps (eco01100 etc.) draw enzymes as LINE graphics (polyline coords) and metabolites
// as small CIRCLE dots — the whole-cell metabolic network. Parse those into edges + nodes (the box
// parser above can't, since these entries carry no x/y/w/h). `fgcolor` = KEGG's category hue.
function parseOverview(xml, id, name, locusMap) {
  const genes = [], compounds = [];
  let maxX = 0, maxY = 0;
  const entryRe = /<entry\b([^>]*)>([\s\S]*?)<\/entry>/g;
  let m;
  while ((m = entryRe.exec(xml))) {
    const head = m[1], body = m[2];
    const type = attr(head, 'type');
    const g = body.match(/<graphics\b([^>]*?)\/?>/);
    if (!g) continue;
    const gx = g[1];
    const gtype = attr(gx, 'type');
    const label = (attr(gx, 'name') ?? '').split(',')[0].trim();
    if (type === 'gene') {
      const eid = attr(head, 'id');
      const ours = (attr(head, 'name') ?? '').split(/\s+/).map((t) => t.replace(orgPrefix, '')).map((lt) => locusMap.get(lt)).filter(Boolean);
      const reaction = (attr(head, 'reaction') ?? '').replace(/^rn:/, '') || null;
      // A KEGG global-map gene entry can carry SEVERAL <graphics type="line"> — the enzyme drawn at each of
      // its reaction sites — so parse EVERY line graphic, not just the first. KEGG also includes PLACEHOLDER
      // line graphics whose coords contain a 0,0 point (e.g. the carotenoid/fatty-acid spiral); KEGG does
      // not render those as a polyline (every such entry also has a clean graphic on its reaction edge), so
      // skip any graphic containing a 0,0 — drawing it produced the spurious top-left line bundle.
      let k = 0;
      for (const gm of body.matchAll(/<graphics\b([^>]*?)\/?>/g)) {
        const gxx = gm[1];
        if (attr(gxx, 'type') !== 'line') continue;
        const nums = (attr(gxx, 'coords') ?? '').split(',').map(Number).filter((n) => Number.isFinite(n));
        if (nums.length < 4) continue;
        let placeholder = false;
        for (let i = 0; i + 1 < nums.length; i += 2) if (nums[i] === 0 && nums[i + 1] === 0) { placeholder = true; break; }
        if (placeholder) continue;
        const pts = [];
        for (let i = 0; i + 1 < nums.length; i += 2) { pts.push([nums[i], nums[i + 1]]); maxX = Math.max(maxX, nums[i]); maxY = Math.max(maxY, nums[i + 1]); }
        genes.push({ id: `${eid}#${k++}`, eid, pts, label, color: attr(gxx, 'fgcolor') ?? '#9ca3af', reaction, genes: ours });
      }
    } else if (type === 'compound' && gtype === 'circle') {
      const x = +attr(gx, 'x'), y = +attr(gx, 'y');
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      compounds.push({ id: attr(head, 'id'), x, y, label });
    }
  }
  // Reactions link a gene entry to its substrate/product COMPOUND entry-ids (KGML reaction id = the gene
  // entry id). So each enzyme edge knows exactly which metabolite nodes it connects — no geometry needed.
  const rxn = new Map();
  const rxnRe = /<reaction\b([^>]*)>([\s\S]*?)<\/reaction>/g;
  let r;
  while ((r = rxnRe.exec(xml))) {
    const rid = attr(r[1], 'id');
    if (!rid) continue;
    const reversible = attr(r[1], 'type') === 'reversible';
    const subs = [...r[2].matchAll(/<substrate\b([^>]*?)\/?>/g)].map((s) => attr(s[1], 'id')).filter(Boolean);
    const prods = [...r[2].matchAll(/<product\b([^>]*?)\/?>/g)].map((s) => attr(s[1], 'id')).filter(Boolean);
    rxn.set(rid, { subs, prods, reversible });
  }
  for (const g of genes) { const rr = rxn.get(g.eid); g.subs = rr?.subs ?? []; g.prods = rr?.prods ?? []; g.reversible = rr?.reversible ?? false; g.nodes = [...(rr?.subs ?? []), ...(rr?.prods ?? [])]; }
  return { id, name, bounds: { w: Math.ceil(maxX + 20), h: Math.ceil(maxY + 20) }, genes, compounds };
}

async function main() {
  const taxid = process.argv[2] || '83333';
  const org = process.argv[3] || 'eco';
  orgPrefix = new RegExp('^' + org + ':');           // KEGG gene ids are `<orgcode>:<locus>`
  skipRe = new RegExp('^' + org + '01[12]\\d\\d$');  // <orgcode>011xx/012xx global+overview maps
  const folder = orgFolder(taxid);
  const dbFile = readdirSync(resolve(RESOURCES, folder)).find((f) => /_DB\.csv$/i.test(f));
  const rows = Papa.parse(readFileSync(resolve(RESOURCES, folder, dbFile), 'utf8'), { header: true, skipEmptyLines: true }).data;
  const locusMap = new Map(); // KEGG locus (ours + underscore-stripped alias) → { uniqID, locus_tag, gene }
  for (const r of rows) {
    const lt = (r.locus_tag ?? '').trim(), uniqID = (r.uniqID ?? '').trim();
    if (!lt || !uniqID) continue;
    const rec = { uniqID, locus_tag: lt, gene: (r.gene ?? '').trim() || lt };
    locusMap.set(lt, rec);
    // KEGG drops the RefSeq underscore for some organisms (B. subtilis: RefSeq BSU_00010 = KEGG BSU00010);
    // register the stripped form as an alias so KEGG gene ids still resolve to our locus.
    const alias = lt.replace(/_/g, '');
    if (alias !== lt && !locusMap.has(alias)) locusMap.set(alias, rec);
  }
  console.log(`[pathway] ${locusMap.size} genes in ${folder}`);

  // gene↔pathway membership + pathway names
  const linkTxt = await get(`${KEGG}/link/${org}/pathway`);
  const pathwayGenes = new Map(); // pathwayId → Set<locus_tag (ours)>
  for (const line of linkTxt.split('\n')) {
    if (!line) continue;
    const [pw, gene] = line.split('\t');
    const pid = pw.replace(/^path:/, '');
    if (skipRe.test(pid)) continue;
    const lt = gene.replace(orgPrefix, '');
    if (!locusMap.has(lt)) continue;
    (pathwayGenes.get(pid) ?? pathwayGenes.set(pid, new Set()).get(pid)).add(lt);
  }
  const listTxt = await get(`${KEGG}/list/pathway/${org}`);
  const nameOf = new Map();
  for (const line of listTxt.split('\n')) {
    if (!line) continue;
    const [pid, title] = line.split('\t');
    nameOf.set(pid, (title ?? '').replace(/ - .*$/, '').trim());
  }
  const pathwayIds = [...pathwayGenes.keys()].sort();
  console.log(`[pathway] ${pathwayIds.length} pathways with our genes`);

  const cacheDir = resolve(RESOURCES, folder, '_assets', 'kegg'); mkdirSync(cacheDir, { recursive: true });
  const outDir = resolve(RESOURCES, folder, 'pathway', 'maps'); mkdirSync(outDir, { recursive: true });
  const index = {}; // uniqID → [{ id, name }]

  // KEGG compound id → readable name (first synonym), so the map can LABEL each metabolite circle
  // instead of showing its C-number. Cached to disk (the full list is large; fetch once).
  const cpdNameFile = resolve(cacheDir, 'compound-names.tsv');
  let cpdTxt;
  if (existsSync(cpdNameFile)) cpdTxt = readFileSync(cpdNameFile, 'utf8');
  else { cpdTxt = await get(`${KEGG}/list/compound`); writeFileSync(cpdNameFile, cpdTxt); await sleep(SLEEP_MS); }
  const cpdName = new Map();
  for (const line of cpdTxt.split('\n')) {
    if (!line) continue;
    const [id, names] = line.split('\t');
    const cid = (id ?? '').replace(/^cpd:/, '');
    const first = (names ?? '').split(';')[0].trim();
    if (cid && first) cpdName.set(cid, first);
  }
  console.log(`[pathway] ${cpdName.size} compound names`);

  // pathway → KEGG metabolism category (for overview territory shading). Cached.
  const briteFile = resolve(cacheDir, 'br08901.keg');
  let briteTxt;
  if (existsSync(briteFile)) briteTxt = readFileSync(briteFile, 'utf8');
  else { try { briteTxt = await get(`${KEGG}/get/br:br08901`); writeFileSync(briteFile, briteTxt); await sleep(SLEEP_MS); } catch { briteTxt = ''; } }
  const pathCategory = parseBrite(briteTxt, org); // eco##### → "Carbohydrate metabolism" etc.
  console.log(`[pathway] ${pathCategory.size} pathways categorised`);

  // The overview (eco01100) marks every reaction reversible, but the detailed / reference maps carry the
  // real direction — harvest reaction(rn:R####) → reversible from them so overview edges can show arrows.
  const rnDir = new Map();
  const accumDir = (x) => { for (const mm of x.matchAll(/<reaction\b([^>]*)>/g)) { const nm = attr(mm[1], 'name'), ty = attr(mm[1], 'type'); if (nm && ty) for (const rn of nm.split(/\s+/)) rnDir.set(rn.replace(/^rn:/, ''), ty === 'reversible'); } };

  for (let i = 0; i < pathwayIds.length; i++) {
    const pid = pathwayIds[i];
    const cacheFile = resolve(cacheDir, `${pid}.kgml`);
    let xml;
    if (existsSync(cacheFile)) { xml = readFileSync(cacheFile, 'utf8'); }
    else {
      try { xml = await get(`${KEGG}/get/${pid}/kgml`); writeFileSync(cacheFile, xml); await sleep(SLEEP_MS); }
      catch (e) { console.warn(`[pathway] skip ${pid}: ${e.message}`); continue; }
    }
    const map = parseKgml(xml, pid, nameOf.get(pid) ?? pid, locusMap);
    // Fill in the edges for steps E. coli LACKS using the reference (ko#####) map's full reaction set at
    // identical coordinates — otherwise those metabolites are drawn unconnected. Matched by C-number.
    const refId = 'ko' + pid.slice(3);
    const refCache = resolve(cacheDir, `${refId}.kgml`);
    let refXml;
    if (existsSync(refCache)) refXml = readFileSync(refCache, 'utf8');
    else { try { refXml = await get(`${KEGG}/get/${refId}/kgml`); writeFileSync(refCache, refXml); await sleep(SLEEP_MS); } catch { refXml = ''; } }
    if (refXml) { mergeRefEdges(map, parseRefReactions(refXml)); accumDir(refXml); }
    accumDir(xml); // organism's own direction takes precedence (set last)
    for (const c of map.compounds) { c.label = cpdName.get(c.label) ?? c.label; delete c.cnum; } // C-number → name
    writeFileSync(resolve(outDir, `${pid}.json`), JSON.stringify(map));
    // index: every one of our genes appearing as a gene box
    const seen = new Set();
    for (const gn of map.genes) for (const g of gn.genes) {
      if (seen.has(g.uniqID)) continue; seen.add(g.uniqID);
      (index[g.uniqID] ??= []).push({ id: pid, name: map.name });
    }
    if ((i + 1) % 20 === 0) console.log(`[pathway] ${i + 1}/${pathwayIds.length}`);
  }
  for (const id of Object.keys(index)) index[id].sort((a, b) => a.name.localeCompare(b.name));
  writeFileSync(resolve(RESOURCES, folder, 'pathway', 'index.json'), JSON.stringify(index));
  console.log(`[pathway] done — ${pathwayIds.length} maps, ${Object.keys(index).length} genes indexed`);

  // Global/overview maps: the whole-cell metabolic network (enzymes = polylines, metabolites = dots).
  // Used as the grand-context view where a gene is located before drilling into its detailed maps.
  const OVERVIEW = [`${org}01100`]; // KEGG's single whole-cell "Metabolic pathways" map (the themed
  // overviews <org>01110/01120 are overlapping subsets — redundant for most genes, so omitted)
  const ovDir = resolve(RESOURCES, folder, 'pathway', 'overview'); mkdirSync(ovDir, { recursive: true });
  const ovMeta = [];
  const ovGenes = {}; // uniqID → Set<overviewId> (which overviews a gene appears on)
  for (const pid of OVERVIEW) {
    const cacheFile = resolve(cacheDir, `${pid}.kgml`);
    let xml;
    if (existsSync(cacheFile)) { xml = readFileSync(cacheFile, 'utf8'); }
    else {
      try { xml = await get(`${KEGG}/get/${pid}/kgml`); writeFileSync(cacheFile, xml); await sleep(SLEEP_MS); }
      catch (e) { console.warn(`[overview] skip ${pid}: ${e.message}`); continue; }
    }
    const ov = parseOverview(xml, pid, nameOf.get(pid) ?? pid, locusMap);
    for (const c of ov.compounds) c.label = cpdName.get(c.label) ?? c.label;
    // overwrite the overview's all-reversible flag with the real per-reaction direction (from detailed maps):
    // a line is directional (gets an arrowhead) if ANY of its reactions is known-irreversible.
    for (const g of ov.genes) {
      const rns = (g.reaction ?? '').split(/\s+/).map((s) => s.replace(/^rn:/, '')).filter(Boolean);
      g.reversible = rns.length ? rns.every((rn) => rnDir.get(rn) !== false) : true;
    }
    // Territory shading — a SMOOTHED metabolism-category field (not a raw per-cell mosaic, which comes
    // out fragmented). Class each enzyme into one of ~11 KEGG metabolism categories (the dominant
    // category of its genes' detailed pathways), vote those into a coarse grid, then run a few
    // majority-smoothing passes that coalesce speckle + fill gaps into contiguous zones. Both the
    // territory fill AND the network lines are recoloured from ONE small distinct palette (KEGG's own
    // pastels are too many / too similar) so the map reads as a few clean regions, not a colour soup.
    // Muted palette, but with hues spread EVENLY around the wheel so neighbouring territories stay
    // distinguishable (a flat desaturated set collapsed carbohydrate/glycan/energy/cofactors into one
    // blue-green mush). Fixed low saturation / mid lightness keeps it soft; the hue does the separating.
    const hsl = (h, s, l) => {
      s /= 100; l /= 100; const a = s * Math.min(l, 1 - l);
      const f = (n) => { const k = (n + h / 30) % 12; const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); return Math.round(255 * c).toString(16).padStart(2, '0'); };
      return `#${f(0)}${f(8)}${f(4)}`;
    };
    const HUE = { // hand-assigned so likely-adjacent zones land far apart (esp. glycan ↔ carbohydrate)
      'Nucleotide metabolism': 8,
      'Amino acid metabolism': 40,
      'Metabolism of terpenoids and polyketides': 75,
      'Lipid metabolism': 135,
      'Energy metabolism': 172,
      'Carbohydrate metabolism': 225,
      'Metabolism of cofactors and vitamins': 258,
      'Metabolism of other amino acids': 290,
      'Xenobiotics biodegradation and metabolism': 312,
      'Glycan biosynthesis and metabolism': 330,
      'Biosynthesis of other secondary metabolites': 350,
    };
    const PALETTE = Object.fromEntries(Object.entries(HUE).map(([k, h]) => [k, hsl(h, 30, 56)])); // quiet, metro-muted
    const FALLBACK = '#cdd3da';
    const catOf = (gn) => {
      const counts = new Map();
      for (const g of gn.genes) for (const pw of (index[g.uniqID] ?? [])) { const c = pathCategory.get(pw.id); if (c) counts.set(c, (counts.get(c) ?? 0) + 1); }
      return counts.size ? [...counts].sort((a, b) => b[1] - a[1])[0][0] : null;
    };
    const CELL = Math.max(ov.bounds.w, ov.bounds.h) / 44; // coarse — the fill is a soft backdrop (blurred
    // in the UI), so big cells coalesce into clean zones rather than a fine speckled mosaic
    const cols = Math.ceil(ov.bounds.w / CELL), rows = Math.ceil(ov.bounds.h / CELL);
    const at = (r, c) => r * cols + c;
    const votes = new Array(rows * cols).fill(null);
    for (const gn of ov.genes) {
      const cat = catOf(gn);
      gn.color = PALETTE[cat] ?? FALLBACK; // recolour the network line to the clean category palette
      if (!cat) continue;
      for (let i = 0; i + 1 < gn.pts.length; i++) {
        const [x1, y1] = gn.pts[i], [x2, y2] = gn.pts[i + 1];
        const steps = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / CELL));
        for (let s = 0; s <= steps; s++) {
          const c = Math.floor((x1 + (x2 - x1) * (s / steps)) / CELL), r = Math.floor((y1 + (y2 - y1) * (s / steps)) / CELL);
          if (r < 0 || c < 0 || r >= rows || c >= cols) continue;
          const m = votes[at(r, c)] ?? (votes[at(r, c)] = new Map());
          m.set(cat, (m.get(cat) ?? 0) + 1);
        }
      }
    }
    let grid = votes.map((m) => (m ? [...m].sort((a, b) => b[1] - a[1])[0][0] : null));
    for (let pass = 0; pass < 4; pass++) { // majority smoothing + gap fill → contiguous territories
      const ng = grid.slice();
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const counts = new Map();
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
          const rr = r + dr, cc = c + dc; if (rr < 0 || cc < 0 || rr >= rows || cc >= cols) continue;
          const g = grid[at(rr, cc)]; if (g) counts.set(g, (counts.get(g) ?? 0) + 1);
        }
        if (!counts.size) continue;
        const [top, n] = [...counts].sort((a, b) => b[1] - a[1])[0];
        if (grid[at(r, c)] === null) { if (n >= 4) ng[at(r, c)] = top; } // fill a gap only when well-surrounded
        else ng[at(r, c)] = top; // smooth existing cells toward the local majority
      }
      grid = ng;
    }
    // Trace each category's cells into a clean octilinear outline (shown only on hover in the UI).
    const territory = [];
    for (const cat of new Set(grid.filter(Boolean))) {
      const isIn = (r, c) => r >= 0 && c >= 0 && r < rows && c < cols && grid[at(r, c)] === cat;
      const loops = [];
      for (let lp of traceLoops(isIn, rows, cols)) {
        lp = mergeCollinear(lp);
        if (Math.abs(ringArea(lp)) < 2.5) continue; // drop tiny specks (area in cell² units)
        const scaled = lp.map(([x, y]) => [x * CELL, y * CELL]);
        loops.push(octilinear(simplifyLoop(scaled, CELL * 1.25)).map(([x, y]) => [Math.round(x), Math.round(y)]));
      }
      if (loops.length) territory.push({ color: PALETTE[cat] ?? FALLBACK, loops });
    }
    // Labels: place each category's label at the visual centre of its LARGEST contiguous territory
    // (pole of inaccessibility, so it sits well inside concave shapes), and wrap the text to fit the
    // territory's width.
    const idxOf = (r, c) => r * cols + c;
    const baseFS = Math.min(ov.bounds.w, ov.bounds.h) * 0.028;
    const candidates = [];
    for (const cat of new Set(grid.filter(Boolean))) {
      const seen = new Uint8Array(rows * cols);
      let largest = null;
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        if (grid[at(r, c)] !== cat || seen[idxOf(r, c)]) continue;
        const stack = [[r, c]]; seen[idxOf(r, c)] = 1; const cells = [];
        while (stack.length) {
          const [cr, cc] = stack.pop(); cells.push([cr, cc]);
          for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
            if (!dr && !dc) continue; const nr = cr + dr, nc = cc + dc;
            if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;
            if (grid[at(nr, nc)] === cat && !seen[idxOf(nr, nc)]) { seen[idxOf(nr, nc)] = 1; stack.push([nr, nc]); }
          }
        }
        if (!largest || cells.length > largest.length) largest = cells;
      }
      if (!largest || largest.length < 6) continue;
      // pole of inaccessibility: BFS distance from the component boundary, take the deepest cell
      const inC = new Set(largest.map(([r, c]) => idxOf(r, c)));
      const dist = new Map(); const q = [];
      const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      for (const [r, c] of largest) {
        if (N4.some(([dr, dc]) => !inC.has(idxOf(r + dr, c + dc)))) { dist.set(idxOf(r, c), 1); q.push([r, c]); }
      }
      for (let qi = 0; qi < q.length; qi++) {
        const [r, c] = q[qi], d = dist.get(idxOf(r, c));
        for (const [dr, dc] of N4) { const k = idxOf(r + dr, c + dc); if (inC.has(k) && !dist.has(k)) { dist.set(k, d + 1); q.push([r + dr, c + dc]); } }
      }
      let best = largest[0], bestD = -1, minCc = Infinity, maxCc = -Infinity;
      for (const [r, c] of largest) { const d = dist.get(idxOf(r, c)) || 0; if (d > bestD) { bestD = d; best = [r, c]; } if (c < minCc) minCc = c; if (c > maxCc) maxCc = c; }
      candidates.push({ cat, cx: best[1] * CELL + CELL / 2, cy: best[0] * CELL + CELL / 2, width: (maxCc - minCc + 1) * CELL, size: largest.length });
    }
    candidates.sort((a, b) => b.size - a.size);
    const regions = [];
    const placed = [];
    const MIND = Math.min(ov.bounds.w, ov.bounds.h) * 0.09;
    for (const cnd of candidates) {
      if (placed.some((p) => Math.hypot(p[0] - cnd.cx, p[1] - cnd.cy) < MIND)) continue;
      const words = cnd.cat.split(' ');
      const fs = baseFS; // unified font size across ALL territories
      // min line width of ~20 chars: a small territory lets its label OVERFLOW (2–3 lines) rather than
      // shrink or wrap into a tall narrow stack that reads as "smaller".
      const maxChars = Math.max(20, Math.floor(cnd.width / (fs * 0.58)));
      const lines = []; let cur = '';
      for (const w of words) { if (!cur) cur = w; else if ((cur + ' ' + w).length <= maxChars) cur += ' ' + w; else { lines.push(cur); cur = w; } }
      if (cur) lines.push(cur);
      placed.push([cnd.cx, cnd.cy]);
      regions.push({ label: cnd.cat, cx: Math.round(cnd.cx), cy: Math.round(cnd.cy), color: PALETTE[cnd.cat] ?? FALLBACK, fs: Math.round(fs), lines });
    }
    // Per-line category MEMBERSHIP (every metabolism category the line's genes belong to, not just the
    // dominant one used for `color`/territory) — so the UI can highlight a category's FULL member set while
    // the territory stays a purely visual bulk indicator.
    for (const gn of ov.genes) {
      const cats = new Set();
      for (const g of gn.genes) for (const pw of (index[g.uniqID] ?? [])) { const c = pathCategory.get(pw.id); if (c) cats.add(c); }
      gn.cats = [...cats].sort();
    }
    ov.territory = territory;
    ov.regions = regions;
    writeFileSync(resolve(ovDir, `${pid}.json`), JSON.stringify(ov));
    const ours = new Set();
    for (const gn of ov.genes) for (const g of gn.genes) { ours.add(g.uniqID); (ovGenes[g.uniqID] ??= new Set()).add(pid); }
    ovMeta.push({ id: pid, name: ov.name, genes: ours.size, compounds: ov.compounds.length });
    console.log(`[overview] ${pid} "${ov.name}": ${ov.genes.length} enzyme lines (${ours.size} of our genes), ${ov.compounds.length} metabolites, ${territory.length} territories / ${regions.length} labels`);
  }
  const ovGenesOut = {}; for (const k of Object.keys(ovGenes)) ovGenesOut[k] = [...ovGenes[k]];
  writeFileSync(resolve(ovDir, 'index.json'), JSON.stringify({ maps: ovMeta, genes: ovGenesOut }));
  console.log(`[overview] done — ${ovMeta.length} overview maps, ${Object.keys(ovGenesOut).length} genes located`);
}

main().catch((e) => { console.error(e); process.exit(1); });
