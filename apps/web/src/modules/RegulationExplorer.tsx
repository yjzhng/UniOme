import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { RegulationNetwork, Regulon, Regulation } from '@uniome/shared';
import { LoadingBox } from '../components/Fields';
import { NetworkGraph, type NetNode, type NetEdge } from './NetworkGraph';
import { detectClusters } from './networkParts';
import { GlobalNetworkView } from './RegulationGlobal';

// The Regulation explorer: three views of the global regulatory network, under tabs.
//   • Overlap network — regulators linked by shared targets; focus one for its regulon (regulator→genes).
//   • Overlap matrix  — the regulator×regulator shared-target matrix, community-ordered (block structure).
//   • Bipartite       — pick regulators, see their target genes directly (directed, coloured by mode).
const NET_H = 520;
const EGO_CAP = 220;      // targets shown in the regulon ego view
const MATRIX_MAX = 55;     // most-connected regulators shown in the (labelled) matrix
const CHORD_MIN_MOD = 2;   // min regulators for a co-regulation community to be its own chord arc
const CHORD_MAX_MODS = 16; // most cross-linked communities shown in the chord
const TYPE_COLOR: Record<string, string> = { TF: '#4e79a7', sRNA: '#f28e2c', other: '#9c755f' };
const typeColor = (t: string) => TYPE_COLOR[t] ?? TYPE_COLOR.other;
const TYPE_LABEL: Record<string, string> = { TF: 'transcription factor', sRNA: 'sRNA', other: 'other (small molecule / complex)' };
const MODE_COLOR: Record<string, string> = { activator: '#16a34a', repressor: '#dc2626', dual: '#d97706' };
const modeColor = (m: string | null | undefined) => (m && MODE_COLOR[m]) || '#c9ced6';
const entryPath = (taxid: string, chrom: string, uid: string) => `/o/${taxid}/c/${encodeURIComponent(chrom)}/entry/${uid}`;

type View = 'global' | 'network' | 'matrix' | 'chord';
const TABS: { key: View; label: string }[] = [
  { key: 'global', label: 'global network' },
  { key: 'chord', label: 'community chord' },
  { key: 'matrix', label: 'overlap matrix' },
  { key: 'network', label: 'overlap network' },
];

export function RegulationExplorer({ taxid, chrom }: { taxid: string; chrom: string }) {
  const [net, setNet] = useState<RegulationNetwork | null | undefined>(undefined);
  const [tab, setTab] = useState<View>('global');

  useEffect(() => {
    let cancelled = false;
    setNet(undefined);
    fetch(`/api/organism/${taxid}/regulation-network`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: RegulationNetwork | null) => !cancelled && setNet(d))
      .catch(() => !cancelled && setNet(null));
    return () => { cancelled = true; };
  }, [taxid]);

  if (net === undefined) return <LoadingBox height={NET_H} label="loading regulatory network…" />;
  if (net === null || !net.regulators.length) return <LoadingBox loading={false} label="no regulation data" height={NET_H} />;

  return (
    <div className="space-y-2">
      <div className="inline-flex rounded border border-neutral-200 bg-neutral-50 p-0.5 text-xs">
        {TABS.map((t) => (
          <button key={t.key} type="button" onClick={() => setTab(t.key)}
            className={`rounded px-2 py-1 ${tab === t.key ? 'bg-white font-medium text-neutral-900 shadow-sm' : 'text-neutral-500 hover:text-neutral-800'}`}>{t.label}</button>
        ))}
      </div>
      {tab === 'global' && <GlobalNetworkView taxid={taxid} chrom={chrom} />}
      {tab === 'network' && <OverlapNetworkView net={net} taxid={taxid} chrom={chrom} />}
      {tab === 'matrix' && <OverlapMatrixView net={net} taxid={taxid} chrom={chrom} />}
      {tab === 'chord' && <ChordView net={net} taxid={taxid} chrom={chrom} />}
    </div>
  );
}

// ── Tab 1: overlap network (+ focus → regulon ego, + pairwise compare) ────────────────────────────
function OverlapNetworkView({ net, taxid, chrom }: { net: RegulationNetwork; taxid: string; chrom: string }) {
  const nav = useNavigate();
  const [sel, setSel] = useState<string | null>(null);      // focused regulator
  const [cmp, setCmp] = useState<string | null>(null);      // compare-with regulator
  const [regA, setRegA] = useState<Regulon | null>(null);
  const [regB, setRegB] = useState<Regulon | null>(null);
  const [regRec, setRegRec] = useState<Regulation | null>(null); // focal regulator's own record (target modes)
  const [hover, setHover] = useState<string | null>(null);

  useEffect(() => { setRegA(null); if (!sel) return; let c = false; fetchRegulon(taxid, sel).then((d) => !c && setRegA(d)); return () => { c = true; }; }, [taxid, sel]);
  useEffect(() => { setRegB(null); if (!cmp) return; let c = false; fetchRegulon(taxid, cmp).then((d) => !c && setRegB(d)); return () => { c = true; }; }, [taxid, cmp]);

  const byName = useMemo(() => new Map(net.regulators.map((r) => [r.name, r])), [net]);
  const focalUid = sel ? byName.get(sel)?.uniqID ?? null : null;
  useEffect(() => {
    setRegRec(null);
    if (!focalUid) return;
    let c = false;
    fetch(`/api/organism/${taxid}/features/${focalUid}/regulation`).then((r) => (r.ok ? r.json() : null)).then((d: Regulation | null) => !c && setRegRec(d)).catch(() => {});
    return () => { c = true; };
  }, [taxid, focalUid]);
  const modeByKey = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const e of regRec?.regulates ?? []) m.set(e.uniqID ?? e.name, e.function ?? null);
    return m;
  }, [regRec]);

  const partners = useMemo(() => {
    if (!sel) return [] as { name: string; shared: number; jaccard: number }[];
    const out: { name: string; shared: number; jaccard: number }[] = [];
    for (const e of net.edges) {
      const an = net.regulators[e.a].name, bn = net.regulators[e.b].name;
      if (an === sel) out.push({ name: bn, shared: e.shared, jaccard: e.jaccard });
      else if (bn === sel) out.push({ name: an, shared: e.shared, jaccard: e.jaccard });
    }
    return out.sort((x, y) => y.shared - x.shared);
  }, [net, sel]);

  const nodes: NetNode[] = useMemo(() => net.regulators.map((r) => ({
    id: r.name, label: r.name, size: r.size, color: typeColor(r.type),
    kind: r.name === sel ? 'focal' : undefined,
    title: `${r.name} · ${TYPE_LABEL[r.type] ?? r.type} · ${r.size} targets`,
  })), [net, sel]);
  const edges: NetEdge[] = useMemo(() => net.edges.map((e) => ({
    source: net.regulators[e.a].name, target: net.regulators[e.b].name, weight: e.jaccard,
    title: `${net.regulators[e.a].name} ∩ ${net.regulators[e.b].name}: ${e.shared} shared targets`,
  })), [net]);
  const highlight = useMemo(() => {
    if (!sel) return null;
    const s = new Set<string>([sel]);
    if (cmp) s.add(cmp); else for (const p of partners) s.add(p.name);
    return s;
  }, [sel, cmp, partners]);

  const pick = (name: string) => { setSel((cur) => (cur === name ? null : name)); setCmp(null); };
  const openEntry = (uniqID: string | null) => { if (uniqID) nav(entryPath(taxid, chrom, uniqID)); };

  return (
    <div className="flex flex-col gap-3 lg:flex-row">
      <div className="min-w-0 flex-1">
        {sel && !cmp ? (
          <Ego taxid={taxid} chrom={chrom} name={sel} node={byName.get(sel)} regulon={regA} modeByKey={modeByKey} onBack={() => setSel(null)} />
        ) : (
          <>
            <div className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-neutral-500">
              <span>{net.regulators.length} regulators · {net.edges.length} overlaps</span>
              {Object.entries(TYPE_LABEL).map(([t, label]) => net.regulators.some((r) => r.type === t) && (
                <span key={t} className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: typeColor(t) }} />{label}</span>
              ))}
              <span className="text-neutral-400">· node size = regulon size · link = shared targets · click a regulator to focus</span>
            </div>
            <NetworkGraph nodes={nodes} edges={edges} height={NET_H} highlight={highlight} hovered={hover} onHover={setHover} onNodeClick={pick} />
          </>
        )}
      </div>

      <aside className="w-full shrink-0 rounded border border-neutral-200 bg-neutral-50 p-2 lg:w-80" style={{ maxHeight: NET_H + 24, overflowY: 'auto' }}>
        {!sel ? (
          <RegulatorList net={net} onPick={pick} onHover={setHover} hover={hover} />
        ) : cmp ? (
          <Compare a={sel} b={cmp} regA={regA} regB={regB} colorA={typeColor(byName.get(sel)?.type ?? 'other')} colorB={typeColor(byName.get(cmp)?.type ?? 'other')} onBack={() => setCmp(null)} onOpen={openEntry} />
        ) : (
          <Detail name={sel} node={byName.get(sel)} regulon={regA} partners={partners} onOpen={openEntry} onClear={() => setSel(null)} onCompare={setCmp} onHover={setHover} />
        )}
      </aside>
    </div>
  );
}

// ── Tab 2: regulator × regulator overlap matrix (community-ordered) ────────────────────────────────
function OverlapMatrixView({ net, taxid, chrom }: { net: RegulationNetwork; taxid: string; chrom: string }) {
  const nav = useNavigate();
  const [hover, setHover] = useState<{ i: number; j: number } | null>(null);
  const [sel, setSel] = useState<{ i: number; j: number } | null>(null);
  const [regA, setRegA] = useState<Regulon | null>(null);
  const [regB, setRegB] = useState<Regulon | null>(null);

  const m = useMemo(() => {
    // regulators with ≥1 overlap, keep the most-connected MATRIX_MAX so labels stay legible
    const deg = new Map<string, number>();
    for (const e of net.edges) { const a = net.regulators[e.a].name, b = net.regulators[e.b].name; deg.set(a, (deg.get(a) ?? 0) + 1); deg.set(b, (deg.get(b) ?? 0) + 1); }
    const kept = new Set([...deg.keys()].sort((a, b) => (deg.get(b)! - deg.get(a)!)).slice(0, MATRIX_MAX));
    const nodeEdges = net.edges.filter((e) => kept.has(net.regulators[e.a].name) && kept.has(net.regulators[e.b].name))
      .map((e) => ({ source: net.regulators[e.a].name, target: net.regulators[e.b].name, weight: e.jaccard }));
    const ids = [...kept];
    const clusters = detectClusters(ids, nodeEdges);
    const size = new Map(net.regulators.map((r) => [r.name, r.size]));
    const order = ids.sort((a, b) => (clusters.get(a)! - clusters.get(b)!) || (size.get(b)! - size.get(a)!) || a.localeCompare(b));
    const pos = new Map(order.map((n, i) => [n, i]));
    // symmetric cell values
    const cell = new Map<string, { shared: number; jaccard: number }>();
    for (const e of net.edges) {
      const a = net.regulators[e.a].name, b = net.regulators[e.b].name;
      if (!kept.has(a) || !kept.has(b)) continue;
      const [lo, hi] = pos.get(a)! < pos.get(b)! ? [pos.get(a)!, pos.get(b)!] : [pos.get(b)!, pos.get(a)!];
      cell.set(`${lo},${hi}`, { shared: e.shared, jaccard: e.jaccard });
    }
    return { order, clusters, cell, byName: new Map(net.regulators.map((r) => [r.name, r])) };
  }, [net]);

  const N = m.order.length;
  const aName = sel ? m.order[sel.i] : null;
  const bName = sel ? m.order[sel.j] : null;
  useEffect(() => { setRegA(null); if (!aName) return; let c = false; fetchRegulon(taxid, aName).then((d) => !c && setRegA(d)); return () => { c = true; }; }, [taxid, aName]);
  useEffect(() => { setRegB(null); if (!bName) return; let c = false; fetchRegulon(taxid, bName).then((d) => !c && setRegB(d)); return () => { c = true; }; }, [taxid, bName]);
  const openEntry = (u: string | null) => { if (u) nav(entryPath(taxid, chrom, u)); };

  const CELL = 13, LBL = 92, PAD = 4;
  const W = LBL + N * CELL + PAD, H = LBL + N * CELL + PAD;
  const val = (i: number, j: number) => (i === j ? null : m.cell.get(i < j ? `${i},${j}` : `${j},${i}`) ?? null);
  const rowLit = (r: number) => (hover != null && (hover.i === r || hover.j === r)) || (sel != null && (sel.i === r || sel.j === r));
  const colLit = (c: number) => (hover != null && (hover.i === c || hover.j === c)) || (sel != null && (sel.i === c || sel.j === c));

  if (!N) return <LoadingBox loading={false} label="no regulator overlaps" height={NET_H} />;
  return (
    <div className="flex flex-col gap-3 lg:flex-row">
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-neutral-500">
          <span>top {N} most-connected regulators · community-ordered</span>
          <span className="inline-flex items-center gap-1">low<span className="inline-block h-2.5 w-16 rounded" style={{ background: 'linear-gradient(90deg, rgb(238,242,255), rgb(49,46,129))' }} />high overlap (Jaccard)</span>
          <span className="text-neutral-400">· click a cell to compare the two regulators · click a name to open it</span>
        </div>
        <div className="overflow-auto rounded border border-neutral-200 bg-white" style={{ maxHeight: NET_H + 24 }}>
          <svg width={W} height={H} className="block">
            {m.order.map((_, i) => m.order.map((_2, j) => {
              const v = val(i, j);
              const x = LBL + j * CELL, y = LBL + i * CELL;
              const isSelCell = sel != null && ((sel.i === i && sel.j === j) || (sel.i === j && sel.j === i));
              const cross = hover != null && (hover.i === i || hover.j === j);
              const fill = i === j ? '#e2e8f0' : v ? heat(0.18 + 0.82 * v.jaccard) : '#f8fafc';
              return <rect key={`${i}-${j}`} x={x} y={y} width={CELL} height={CELL} fill={fill}
                stroke={isSelCell ? '#111827' : cross ? '#334155' : '#fff'} strokeWidth={isSelCell ? 1.6 : cross ? 0.8 : 0.5}
                style={{ cursor: i !== j && v ? 'pointer' : 'default' }}
                onMouseEnter={() => setHover({ i, j })} onMouseLeave={() => setHover(null)}
                onClick={() => { if (i !== j && v) setSel((cur) => (cur && cur.i === i && cur.j === j ? null : { i, j })); }}>
                {v && <title>{`${m.order[i]} × ${m.order[j]}: ${v.shared} shared · Jaccard ${v.jaccard}`}</title>}
              </rect>;
            }))}
            {m.order.map((name, i) => (
              <g key={`r${i}`} onMouseEnter={() => setHover({ i, j: i })} onMouseLeave={() => setHover(null)}>
                <rect x={LBL - 3} y={LBL + i * CELL + 1.5} width={2.5} height={CELL - 3} fill={paletteHexClamp(m.clusters.get(name)!)} />
                <text x={LBL - 6} y={LBL + i * CELL + CELL - 3.5} textAnchor="end" fontSize={8.5} style={{ cursor: 'pointer' }}
                  className={rowLit(i) ? 'fill-neutral-900 font-semibold' : 'fill-neutral-600'}
                  onClick={() => { const u = m.byName.get(name)?.uniqID; if (u) nav(entryPath(taxid, chrom, u)); }}>{trunc(name, 13)}</text>
              </g>
            ))}
            {m.order.map((name, j) => {
              const x = LBL + j * CELL + CELL / 2;
              return <text key={`c${j}`} x={x} y={LBL - 5} textAnchor="start" fontSize={8.5} transform={`rotate(-60 ${x} ${LBL - 5})`}
                className={colLit(j) ? 'fill-neutral-900 font-semibold' : 'fill-neutral-500'}>{trunc(name, 13)}</text>;
            })}
          </svg>
        </div>
      </div>
      <aside className="w-full shrink-0 rounded border border-neutral-200 bg-neutral-50 p-2 lg:w-80" style={{ maxHeight: NET_H + 24, overflowY: 'auto' }}>
        {sel && aName && bName ? (
          <Compare a={aName} b={bName} regA={regA} regB={regB} colorA={typeColor(m.byName.get(aName)?.type ?? 'other')} colorB={typeColor(m.byName.get(bName)?.type ?? 'other')} onBack={() => setSel(null)} onOpen={openEntry} />
        ) : (
          <div className="px-1 py-2 text-[11px] text-neutral-400">Click a cell to compare the two regulators — their shared vs unique target genes.</div>
        )}
      </aside>
    </div>
  );
}

// ── Tab (community chord): co-regulation communities as arcs, ribbons = cross-community shared targets ─
const CHORD_RI = 168, CHORD_RO = 184; // ribbon radius, outer ring radius
const cpt = (r: number, a: number) => `${(r * Math.sin(a)).toFixed(2)},${(-r * Math.cos(a)).toFixed(2)}`; // a=0 at top, clockwise
const chordRing = (a0: number, a1: number) => { const L = a1 - a0 > Math.PI ? 1 : 0; return `M${cpt(CHORD_RO, a0)}A${CHORD_RO},${CHORD_RO} 0 ${L} 1 ${cpt(CHORD_RO, a1)}L${cpt(CHORD_RI, a1)}A${CHORD_RI},${CHORD_RI} 0 ${L} 0 ${cpt(CHORD_RI, a0)}Z`; };
const chordRibbon = (a0: number, a1: number, b0: number, b1: number) => { const la = a1 - a0 > Math.PI ? 1 : 0, lb = b1 - b0 > Math.PI ? 1 : 0; return `M${cpt(CHORD_RI, a0)}A${CHORD_RI},${CHORD_RI} 0 ${la} 1 ${cpt(CHORD_RI, a1)}Q0,0 ${cpt(CHORD_RI, b0)}A${CHORD_RI},${CHORD_RI} 0 ${lb} 1 ${cpt(CHORD_RI, b1)}Q0,0 ${cpt(CHORD_RI, a0)}Z`; };

function ChordView({ net, taxid, chrom }: { net: RegulationNetwork; taxid: string; chrom: string }) {
  const nav = useNavigate();
  const [hover, setHover] = useState<number | null>(null);
  const [sel, setSel] = useState<number | null>(null);
  const c = useMemo(() => {
    // communities over the regulator overlap graph (same clustering the matrix uses)
    const gedges = net.edges.map((e) => ({ source: net.regulators[e.a].name, target: net.regulators[e.b].name, weight: e.jaccard }));
    const ids = [...new Set(gedges.flatMap((e) => [e.source, e.target]))];
    const cl = detectClusters(ids, gedges);
    const membersByCl = new Map<number, string[]>();
    for (const id of ids) { const k = cl.get(id)!; (membersByCl.get(k) ?? membersByCl.set(k, []).get(k)!).push(id); }
    const size = new Map(net.regulators.map((r) => [r.name, r.size]));
    // candidate modules (≥ CHORD_MIN_MOD regulators), labelled by their biggest regulator
    let mods = [...membersByCl.entries()].filter(([, m]) => m.length >= CHORD_MIN_MOD)
      .map(([cid, m]) => ({ cid, members: [...m].sort((a, b) => size.get(b)! - size.get(a)!) }));
    const clOf = new Map<string, number>(); mods.forEach((mod, i) => mod.members.forEach((n) => clOf.set(n, i)));
    // cross-module shared-target matrix (off-diagonal only → community↔community cross-talk)
    const G = mods.length;
    const M = Array.from({ length: G }, () => new Array(G).fill(0));
    for (const e of net.edges) {
      const ia = clOf.get(net.regulators[e.a].name), ib = clOf.get(net.regulators[e.b].name);
      if (ia == null || ib == null || ia === ib) continue;
      M[ia][ib] += e.shared; M[ib][ia] += e.shared;
    }
    // keep only modules that actually share with others, top CHORD_MAX_MODS by cross-talk volume
    const rowSum = M.map((row) => row.reduce((s, v) => s + v, 0));
    const kept = mods.map((_, i) => i).filter((i) => rowSum[i] > 0).sort((a, b) => rowSum[b] - rowSum[a]).slice(0, CHORD_MAX_MODS);
    const g = kept.map((i, k) => ({ top: mods[i].members[0], members: mods[i].members, color: paletteHexClamp(k), rowSum: rowSum[i] }));
    const val = (a: number, b: number) => M[kept[a]][kept[b]];
    const total = kept.reduce((s, i) => s + rowSum[i], 0) || 1;
    // layout: each module an arc sized by its cross-talk volume, split into per-partner sub-arcs
    const GAP = 0.04, avail = Math.PI * 2 - g.length * GAP;
    const arc: [number, number][] = [], sub: [number, number][][] = g.map(() => []);
    let cur = 0;
    for (let i = 0; i < g.length; i++) {
      const start = cur;
      for (let j = 0; j < g.length; j++) { const w = (val(i, j) / total) * avail; sub[i][j] = [cur, cur + w]; cur += w; }
      arc[i] = [start, cur]; cur += GAP;
    }
    const ribbons: { i: number; j: number; path: string; shared: number }[] = [];
    for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) if (val(i, j) > 0)
      ribbons.push({ i, j, path: chordRibbon(sub[i][j][0], sub[i][j][1], sub[j][i][0], sub[j][i][1]), shared: val(i, j) });
    // each module's cross-community partners (for the detail panel)
    const partners: { mod: number; shared: number }[][] = g.map(() => []);
    for (const r of ribbons) { partners[r.i].push({ mod: r.j, shared: r.shared }); partners[r.j].push({ mod: r.i, shared: r.shared }); }
    partners.forEach((p) => p.sort((a, b) => b.shared - a.shared));
    return { g, arc, ribbons, partners, byName: new Map(net.regulators.map((r) => [r.name, r])) };
  }, [net]);

  const focus = hover ?? sel; // hover previews; else the selected module stays isolated
  const pick = (i: number) => setSel((cur) => (cur === i ? null : i));
  const openEntry = (u: string | null | undefined) => { if (u) nav(entryPath(taxid, chrom, u)); };

  if (!c.g.length) return <LoadingBox loading={false} label="no cross-community regulation" height={NET_H} />;
  return (
    <div className="flex flex-col gap-3 lg:flex-row">
      <div className="min-w-0 flex-1">
        <div className="mb-1 text-[11px] text-neutral-500">{c.g.length} co-regulation communities · arc = cross-community shared-target volume · ribbon = shared targets between two communities · click a community for its members</div>
        <svg viewBox="-200 -200 400 400" className="mx-auto block w-full max-w-[440px]" style={{ height: NET_H }} onMouseLeave={() => setHover(null)}>
          {c.ribbons.map((r) => {
            const on = focus == null || focus === r.i || focus === r.j;
            return <path key={`${r.i}-${r.j}`} d={r.path} fill={c.g[r.i].color} fillOpacity={on ? 0.5 : 0.05} stroke="none">
              <title>{`${c.g[r.i].top} module ↔ ${c.g[r.j].top} module: ${r.shared} shared targets`}</title>
            </path>;
          })}
          {c.g.map((mod, i) => (
            <path key={i} d={chordRing(c.arc[i][0], c.arc[i][1])} fill={mod.color} fillOpacity={focus == null || focus === i ? 1 : 0.3}
              stroke={sel === i ? '#111827' : '#fff'} strokeWidth={sel === i ? 1.4 : 0.75} style={{ cursor: 'pointer' }}
              onMouseEnter={() => setHover(i)} onClick={() => pick(i)}>
              <title>{`${mod.top} module · ${mod.members.length} regulators`}</title>
            </path>
          ))}
        </svg>
      </div>
      <aside className="w-full shrink-0 rounded border border-neutral-200 bg-neutral-50 p-2 lg:w-80" style={{ maxHeight: NET_H + 24, overflowY: 'auto' }}>
        {sel != null ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: c.g[sel].color }} />
              <span className="min-w-0 flex-1 truncate text-sm font-semibold text-neutral-800">{c.g[sel].top} module</span>
              <button type="button" onClick={() => setSel(null)} className="shrink-0 text-[11px] text-neutral-400 hover:text-neutral-700">back</button>
            </div>
            <div className="text-[11px] text-neutral-500">{c.g[sel].members.length} regulators in this co-regulation community</div>
            <div>
              <div className="mb-0.5 text-[11px] font-semibold text-neutral-600">Regulators</div>
              <div className="flex flex-wrap gap-1">
                {c.g[sel].members.map((n) => { const u = c.byName.get(n)?.uniqID; return (
                  <button key={n} type="button" onClick={() => openEntry(u)} disabled={!u}
                    className={`rounded px-1.5 py-0.5 text-[11px] ${u ? 'bg-white text-neutral-700 ring-1 ring-inset ring-neutral-200 hover:bg-blue-50 hover:text-blue-700' : 'bg-neutral-100 text-neutral-400'}`}>{n}</button>
                ); })}
              </div>
            </div>
            {c.partners[sel].length > 0 && (
              <div>
                <div className="mb-0.5 text-[11px] font-semibold text-neutral-600">Shares targets with</div>
                <ul className="space-y-0.5">
                  {c.partners[sel].map((p) => (
                    <li key={p.mod}>
                      <button type="button" onClick={() => pick(p.mod)} onMouseEnter={() => setHover(p.mod)} onMouseLeave={() => setHover(null)}
                        className="flex w-full items-center gap-2 rounded px-1.5 py-0.5 text-left text-xs hover:bg-neutral-100">
                        <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: c.g[p.mod].color }} />
                        <span className="min-w-0 flex-1 truncate font-medium text-neutral-800">{c.g[p.mod].top} module</span>
                        <span className="shrink-0 tabular-nums text-[10px] text-neutral-400">{p.shared} shared</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="mb-1 px-1 text-xs font-semibold text-neutral-700">Communities <span className="font-normal text-neutral-400">by cross-talk · click to inspect</span></div>
            <ul className="space-y-0.5 text-xs">
              {c.g.map((mod, i) => (
                <li key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                  <button type="button" onClick={() => pick(i)} className={`w-full rounded px-1.5 py-1 text-left ${hover === i ? 'bg-neutral-100' : 'hover:bg-neutral-100'}`}>
                    <div className="flex items-center gap-2">
                      <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: mod.color }} />
                      <span className="min-w-0 flex-1 truncate font-semibold text-neutral-800">{mod.top} module</span>
                      <span className="shrink-0 text-[10px] text-neutral-400">{mod.members.length} reg</span>
                    </div>
                    <div className="mt-0.5 truncate pl-4 text-[10px] text-neutral-500">{mod.members.slice(0, 8).join(', ')}{mod.members.length > 8 ? '…' : ''}</div>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </aside>
    </div>
  );
}

// ── shared sub-components ─────────────────────────────────────────────────────────────────────────
function Ego({ taxid, chrom, name, node, regulon, modeByKey, onBack }: {
  taxid: string; chrom: string; name: string; node?: { uniqID: string | null; type: string; size: number };
  regulon: Regulon | null; modeByKey: Map<string, string | null>; onBack: () => void;
}) {
  const targets = regulon?.targets ?? [];
  const shown = targets.slice(0, EGO_CAP);
  const hub = `@${name}`;
  const nodes: NetNode[] = useMemo(() => [
    { id: hub, label: name, kind: 'focal' as const, color: typeColor(node?.type ?? 'other'), link: node?.uniqID ? entryPath(taxid, chrom, node.uniqID) : null, title: `${name} · regulates ${targets.length} genes` },
    ...shown.map((t) => ({ id: `t:${t.uniqID ?? t.name}`, label: t.name, color: '#cbd5e1', link: t.uniqID ? entryPath(taxid, chrom, t.uniqID) : null, title: modeByKey.get(t.uniqID ?? t.name) ? `${t.name} · ${modeByKey.get(t.uniqID ?? t.name)}` : t.name })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [name, node, regulon, modeByKey]);
  const edges: NetEdge[] = useMemo(() => shown.map((t) => ({ source: hub, target: `t:${t.uniqID ?? t.name}`, directed: true, weight: 0.3, color: modeColor(modeByKey.get(t.uniqID ?? t.name)) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [name, regulon, modeByKey]);
  return (
    <div>
      <div className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-neutral-500">
        <button type="button" onClick={onBack} className="font-medium text-neutral-500 hover:text-neutral-800">← all regulators</button>
        <span className="font-semibold text-neutral-700">{name} regulon</span>
        <span>{targets.length} targets{targets.length > shown.length ? ` · showing ${shown.length}` : ''}</span>
        {(['activator', 'repressor', 'dual'] as const).map((k) => <span key={k} className="inline-flex items-center gap-1"><span className="inline-block h-[3px] w-3.5 rounded" style={{ background: MODE_COLOR[k] }} />{k}</span>)}
        <span className="text-neutral-400">· click a gene to open it</span>
      </div>
      {regulon ? <NetworkGraph nodes={nodes} edges={edges} directed height={NET_H} baseEdgeOpacity={0.55} /> : <LoadingBox height={NET_H} label="loading regulon…" />}
    </div>
  );
}

function RegulatorList({ net, onPick, onHover, hover }: { net: RegulationNetwork; onPick: (n: string) => void; onHover: (n: string | null) => void; hover: string | null }) {
  const sorted = useMemo(() => [...net.regulators].sort((a, b) => b.size - a.size), [net]);
  return (
    <div>
      <div className="mb-1 px-1 text-xs font-semibold text-neutral-700">Regulators <span className="font-normal text-neutral-400">by regulon size</span></div>
      <ul className="text-xs">
        {sorted.map((r) => (
          <li key={r.name}>
            <button type="button" onClick={() => onPick(r.name)} onMouseEnter={() => onHover(r.name)} onMouseLeave={() => onHover(null)}
              className={`flex w-full items-center gap-2 rounded px-1.5 py-0.5 text-left ${hover === r.name ? 'bg-neutral-100' : 'hover:bg-neutral-100'}`}>
              <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: typeColor(r.type) }} />
              <span className="min-w-0 flex-1 truncate font-medium text-neutral-800">{r.name}</span>
              <span className="shrink-0 tabular-nums text-[10px] text-neutral-400">{r.size}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Detail({ name, node, regulon, partners, onOpen, onClear, onCompare, onHover }: {
  name: string; node?: { uniqID: string | null; type: string; size: number }; regulon: Regulon | null;
  partners: { name: string; shared: number; jaccard: number }[]; onOpen: (u: string | null) => void;
  onClear: () => void; onCompare: (n: string) => void; onHover: (n: string | null) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: typeColor(node?.type ?? 'other') }} />
        <button type="button" onClick={() => onOpen(node?.uniqID ?? null)} disabled={!node?.uniqID}
          className={`min-w-0 flex-1 truncate text-left text-sm font-semibold ${node?.uniqID ? 'text-blue-700 hover:underline' : 'text-neutral-800'}`}>{name}</button>
        <button type="button" onClick={onClear} className="shrink-0 text-[11px] text-neutral-400 hover:text-neutral-700">clear</button>
      </div>
      <div className="text-[11px] text-neutral-500">{TYPE_LABEL[node?.type ?? 'other']} · regulates {node?.size ?? regulon?.targets.length ?? 0} genes</div>
      {partners.length > 0 && (
        <div>
          <div className="mb-0.5 text-[11px] font-semibold text-neutral-600">Shares targets with</div>
          <ul className="space-y-0.5">
            {partners.slice(0, 12).map((p) => (
              <li key={p.name}>
                <button type="button" onClick={() => onCompare(p.name)} onMouseEnter={() => onHover(p.name)} onMouseLeave={() => onHover(null)}
                  className="flex w-full items-center gap-2 rounded px-1.5 py-0.5 text-left text-xs hover:bg-neutral-100">
                  <span className="min-w-0 flex-1 truncate font-medium text-neutral-800">{p.name}</span>
                  <span className="shrink-0 tabular-nums text-[10px] text-neutral-400">{p.shared} shared</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-0.5 px-1.5 text-[10px] text-neutral-400">click a partner to compare shared vs unique targets</div>
        </div>
      )}
      <div>
        <div className="mb-0.5 text-[11px] font-semibold text-neutral-600">Regulon <span className="font-normal text-neutral-400">({regulon ? regulon.targets.length : '…'} targets)</span></div>
        {regulon ? <TargetChips targets={regulon.targets} onOpen={onOpen} /> : <div className="px-1 text-[11px] text-neutral-400">loading…</div>}
      </div>
    </div>
  );
}

function Compare({ a, b, regA, regB, colorA, colorB, onBack, onOpen }: {
  a: string; b: string; regA: Regulon | null; regB: Regulon | null; colorA: string; colorB: string;
  onBack: () => void; onOpen: (u: string | null) => void;
}) {
  const groups = useMemo(() => {
    if (!regA || !regB) return null;
    const key = (t: { name: string; uniqID: string | null }) => t.uniqID ?? t.name;
    const bIds = new Set(regB.targets.map(key)), aIds = new Set(regA.targets.map(key));
    return { shared: regA.targets.filter((t) => bIds.has(key(t))), aOnly: regA.targets.filter((t) => !bIds.has(key(t))), bOnly: regB.targets.filter((t) => !aIds.has(key(t))) };
  }, [regA, regB]);
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: colorA }} />{a}</span>
        <span className="text-neutral-400">vs</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: colorB }} />{b}</span>
        <button type="button" onClick={onBack} className="ml-auto shrink-0 text-[11px] font-normal text-neutral-400 hover:text-neutral-700">back</button>
      </div>
      {!groups ? <div className="px-1 text-[11px] text-neutral-400">loading…</div> : (
        <>
          <Group title="shared" count={groups.shared.length} accent="#16a34a" targets={groups.shared} onOpen={onOpen} />
          <Group title={`${a} only`} count={groups.aOnly.length} accent={colorA} targets={groups.aOnly} onOpen={onOpen} />
          <Group title={`${b} only`} count={groups.bOnly.length} accent={colorB} targets={groups.bOnly} onOpen={onOpen} />
        </>
      )}
    </div>
  );
}

function Group({ title, count, accent, targets, onOpen }: { title: string; count: number; accent: string; targets: { name: string; uniqID: string | null }[]; onOpen: (u: string | null) => void }) {
  return (
    <div>
      <div className="mb-0.5 flex items-center gap-1.5 text-[11px] font-semibold text-neutral-600">
        <span className="inline-block h-2 w-2 rounded-full" style={{ background: accent }} />{title} <span className="font-normal text-neutral-400">({count})</span>
      </div>
      <TargetChips targets={targets} onOpen={onOpen} />
    </div>
  );
}

function TargetChips({ targets, onOpen }: { targets: { name: string; uniqID: string | null }[]; onOpen: (u: string | null) => void }) {
  if (!targets.length) return <div className="px-1 text-[11px] text-neutral-400">none</div>;
  return (
    <div className="flex flex-wrap gap-1">
      {targets.map((t, i) => (
        <button key={`${t.uniqID ?? t.name}-${i}`} type="button" onClick={() => onOpen(t.uniqID)} disabled={!t.uniqID}
          className={`rounded px-1.5 py-0.5 text-[11px] ${t.uniqID ? 'bg-white text-neutral-700 ring-1 ring-inset ring-neutral-200 hover:bg-blue-50 hover:text-blue-700' : 'bg-neutral-100 text-neutral-400'}`}>{t.name}</button>
      ))}
    </div>
  );
}

// ── data + colour helpers ─────────────────────────────────────────────────────────────────────────
async function fetchRegulon(taxid: string, name: string): Promise<Regulon | null> {
  try { const r = await fetch(`/api/organism/${taxid}/regulon?name=${encodeURIComponent(name)}`); return r.ok ? await r.json() : null; }
  catch { return null; }
}
const trunc = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
// white → indigo heat ramp for the overlap matrix
function heat(t: number): string {
  const u = Math.max(0, Math.min(1, t));
  const a = [238, 242, 255], b = [49, 46, 129];
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * u)},${Math.round(a[1] + (b[1] - a[1]) * u)},${Math.round(a[2] + (b[2] - a[2]) * u)})`;
}
// small qualitative palette for cluster ticks (kept local to avoid over-coupling)
const CLUSTER_HUES = ['#4e79a7', '#f28e2c', '#59a14f', '#e15759', '#af7aa1', '#76b7b2', '#edc949', '#9c755f', '#bab0ab', '#ff9da7'];
const paletteHexClamp = (i: number) => CLUSTER_HUES[((i % CLUSTER_HUES.length) + CLUSTER_HUES.length) % CLUSTER_HUES.length];
