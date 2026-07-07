import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import type { RegulationEdges } from '@uniome/shared';
import { LoadingBox } from '../components/Fields';
import { ViewControls } from './ViewControls';
import { detectClusters } from './networkParts';

// The whole regulatory network in one static picture: every regulator (large node, coloured by type) and
// every gene it regulates (small dot), joined by very thin, semi-opaque edges coloured by mode (green =
// activation, red = repression, orange = dual). The layout is computed ONCE (a force pass over just the
// regulators — a small graph — then each target is placed around / between its regulators), so it never
// re-simulates and can't "explode": only pan/zoom afterwards. Edges/dots render as a handful of batched
// SVG paths (non-scaling strokes) so thousands of elements stay smooth.
const NET_H = 560;
const MODE_COLOR: Record<string, string> = { a: '#16a34a', r: '#dc2626', d: '#d97706', '': '#cbd5e1' };
// regulator nodes coloured by community (so the clusters are legible even where blobs are near each other)
const COMM_HUES = ['#4e79a7', '#f28e2c', '#59a14f', '#e15759', '#af7aa1', '#76b7b2', '#edc949', '#9c755f', '#b07aa1', '#ff9da7', '#86bcb6', '#d37295', '#8cd17d', '#b6992d'];
const commColor = (c: number) => COMM_HUES[((c % COMM_HUES.length) + COMM_HUES.length) % COMM_HUES.length];
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
// deterministic RNG so the frozen layout is identical every mount (no re-jitter)
function mulberry32(seed: number) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// ── layout parameters (community-region layout, matching the classic regulatory-network picture: every
// gene belongs to a community; each community is a coloured CLOUD of its genes with its regulators
// embedded, and the communities are packed apart as separated regions). Deterministic → never explodes. ──
const CLUSTER_JAC = 0.08; // regulators join a community when their target-set Jaccard ≥ this
const MIN_COMM = 3;       // communities smaller than this are folded into the big one they overlap most
const REGION_SCALE = 3.4; // community-cloud radius per √(gene count)
const COMM_GAP = 26;      // padding between community regions
const GA = Math.PI * (3 - Math.sqrt(5)); // golden angle

type Layout = { rx: Float64Array; ry: Float64Array; tx: Float64Array; ty: Float64Array; comm: Int32Array; tcomm: Int32Array; K: number };
type Built = { L: Layout; edgePaths: Record<string, string>; dotsByComm: string[]; bounds: { minX: number; minY: number; maxX: number; maxY: number }; maxSize: number };

function computeLayout(data: RegulationEdges): Layout {
  const R = data.regulators.length, T = data.targets.length;
  const size = data.regulators.map((r) => r.size);
  const tRegs: number[][] = Array.from({ length: T }, () => []);
  for (const e of data.edges) tRegs[e.t].push(e.r);

  // regulator ↔ regulator shared-target counts + adjacency
  const pair = new Map<number, number>();
  for (const regs of tRegs) for (let i = 0; i < regs.length; i++) for (let j = i + 1; j < regs.length; j++) { const a = Math.min(regs[i], regs[j]), b = Math.max(regs[i], regs[j]); pair.set(a * R + b, (pair.get(a * R + b) ?? 0) + 1); }
  const adj: { j: number; w: number }[][] = Array.from({ length: R }, () => []);
  for (const [k, w] of pair) { const a = Math.floor(k / R), b = k % R; adj[a].push({ j: b, w }); adj[b].push({ j: a, w }); }

  // community detection (Jaccard-thresholded), then FOLD every small community into the big community its
  // regulators overlap most → a handful of large communities (like the reference), not a hundred singletons
  const cedges: { source: string; target: string; weight: number }[] = [];
  for (const [k, w] of pair) { const a = Math.floor(k / R), b = k % R; const jac = w / (size[a] + size[b] - w); if (jac >= CLUSTER_JAC) cedges.push({ source: String(a), target: String(b), weight: jac }); }
  const raw = detectClusters(data.regulators.map((_, i) => String(i)), cedges);
  const rawSize = new Map<number, number>();
  for (let i = 0; i < R; i++) { const c = raw.get(String(i))!; rawSize.set(c, (rawSize.get(c) ?? 0) + 1); }
  const bigList = [...rawSize.entries()].filter(([, n]) => n >= MIN_COMM).sort((a, b) => b[1] - a[1]).map(([c]) => c);
  const bigIdx = new Map(bigList.map((c, i) => [c, i]));
  const OTHER = bigList.length, K = bigList.length + 1;
  const comm = new Int32Array(R);
  for (let i = 0; i < R; i++) {
    const rc = raw.get(String(i))!;
    if (bigIdx.has(rc)) { comm[i] = bigIdx.get(rc)!; continue; }
    const votes = new Map<number, number>();
    for (const { j, w } of adj[i]) { const jc = bigIdx.get(raw.get(String(j))!); if (jc != null) votes.set(jc, (votes.get(jc) ?? 0) + w); }
    let best = OTHER, bw = -1; for (const [c, w] of votes) if (w > bw) { bw = w; best = c; } comm[i] = best;
  }
  // every gene → the community most of its regulators belong to
  const tcomm = new Int32Array(T);
  for (let t = 0; t < T; t++) { const votes = new Map<number, number>(); for (const r of tRegs[t]) votes.set(comm[r], (votes.get(comm[r]) ?? 0) + 1); let best = 0, bw = -1; for (const [c, w] of votes) if (w > bw) { bw = w; best = c; } tcomm[t] = best; }

  // region radius ∝ √(genes in the community); pack regions apart, biggest toward the centre
  const nReg = new Int32Array(K), nTar = new Int32Array(K);
  for (let i = 0; i < R; i++) nReg[comm[i]]++;
  for (let t = 0; t < T; t++) nTar[tcomm[t]]++;
  const commR: number[] = [];
  for (let c = 0; c < K; c++) commR.push(REGION_SCALE * Math.sqrt(nReg[c] * 3 + nTar[c] + 1) + 6);
  const order = [...Array(K).keys()].sort((a, b) => commR[b] - commR[a]);
  const cx = new Float64Array(K), cy = new Float64Array(K);
  const placed: number[] = [];
  for (const c of order) {
    if (!placed.length) { cx[c] = 0; cy[c] = 0; placed.push(c); continue; }
    let bx = 0, by = 0, bd = Infinity, found = false;
    for (const p of placed) { const sep = commR[p] + commR[c] + COMM_GAP; for (let a = 0; a < 40; a++) { const ang = (a / 40) * 2 * Math.PI, x = cx[p] + Math.cos(ang) * sep, y = cy[p] + Math.sin(ang) * sep; let ok = true; for (const q of placed) { const dxx = x - cx[q], dyy = y - cy[q], mn = commR[q] + commR[c] + COMM_GAP; if (dxx * dxx + dyy * dyy < mn * mn - 1) { ok = false; break; } } if (ok) { const d = x * x + y * y; if (d < bd) { bd = d; bx = x; by = y; found = true; } } } }
    cx[c] = found ? bx : 0; cy[c] = found ? by : 0; placed.push(c);
  }

  // regulators: spiral in the inner half of the region (biggest central); genes: scatter across the region
  const rx = new Float64Array(R), ry = new Float64Array(R), tx = new Float64Array(T), ty = new Float64Array(T);
  const regsByComm: number[][] = Array.from({ length: K }, () => []);
  for (let i = 0; i < R; i++) regsByComm[comm[i]].push(i);
  for (let c = 0; c < K; c++) { const arr = regsByComm[c].sort((a, b) => size[b] - size[a]); const sr = commR[c] * 0.62; arr.forEach((i, k) => { const rad = arr.length <= 1 ? 0 : sr * (0.12 + 0.88 * Math.sqrt(k / arr.length)); rx[i] = cx[c] + Math.cos(k * GA) * rad; ry[i] = cy[c] + Math.sin(k * GA) * rad; }); }
  for (let t = 0; t < T; t++) { const c = tcomm[t], jr = mulberry32((t + 1) * 2654435761); const rad = commR[c] * 0.97 * Math.sqrt(jr()), ang = jr() * Math.PI * 2; tx[t] = cx[c] + Math.cos(ang) * rad; ty[t] = cy[c] + Math.sin(ang) * rad; }

  return { rx, ry, tx, ty, comm, tcomm, K };
}

export function GlobalNetworkView({ taxid, chrom }: { taxid: string; chrom: string }) {
  const nav = useNavigate();
  const [data, setData] = useState<RegulationEdges | null | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    setData(undefined);
    fetch(`/api/organism/${taxid}/regulation-edges`).then((r) => (r.ok ? r.json() : null)).then((d: RegulationEdges | null) => !cancelled && setData(d)).catch(() => !cancelled && setData(null));
    return () => { cancelled = true; };
  }, [taxid]);

  const built = useMemo(() => {
    if (!data || !data.regulators.length) return null;
    const L = computeLayout(data);
    // batched edge paths (one per mode) + one target-dot path PER community (so dots colour by community)
    const edgePaths: Record<string, string> = { a: '', r: '', d: '', '': '' };
    for (const e of data.edges) edgePaths[e.m] += `M${L.rx[e.r].toFixed(1)},${L.ry[e.r].toFixed(1)}L${L.tx[e.t].toFixed(1)},${L.ty[e.t].toFixed(1)}`;
    const dotsByComm: string[] = Array.from({ length: L.K }, () => '');
    for (let t = 0; t < data.targets.length; t++) dotsByComm[L.tcomm[t]] += `M${L.tx[t].toFixed(1)},${L.ty[t].toFixed(1)}l.01,0`;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < L.tx.length; i++) { minX = Math.min(minX, L.tx[i]); minY = Math.min(minY, L.ty[i]); maxX = Math.max(maxX, L.tx[i]); maxY = Math.max(maxY, L.ty[i]); }
    const maxSize = Math.max(...data.regulators.map((r) => r.size));
    return { L, edgePaths, dotsByComm, bounds: { minX, minY, maxX, maxY }, maxSize };
  }, [data]);

  if (data === undefined) return <LoadingBox height={NET_H} label="loading & laying out the global network…" />;
  if (!data || !built) return <LoadingBox loading={false} label="no regulation data" height={NET_H} />;
  return <StaticNet data={data} built={built} height={NET_H} onGene={(uid) => nav(`/o/${taxid}/c/${encodeURIComponent(chrom)}/entry/${uid}`)} />;
}

function StaticNet({ data, built, height, onGene }: { data: RegulationEdges; built: Built; height: number; onGene: (uid: string) => void }) {
  const { L, edgePaths, dotsByComm, bounds, maxSize } = built;
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [W, setW] = useState(760);
  const H = height;
  const [hoverNode, setHoverNode] = useState<{ kind: 'reg' | 'gene'; i: number } | null>(null); // node under cursor
  const [hoverComm, setHoverComm] = useState<number | null>(null); // hovered cluster (legend)
  const [selComm, setSelComm] = useState<number | null>(null);     // clicked cluster → show its genes

  const fit = useMemo(() => {
    const bw = (bounds.maxX - bounds.minX) || 1, bh = (bounds.maxY - bounds.minY) || 1, PAD = 40;
    const k = clamp(Math.min((W - 2 * PAD) / bw, (H - 2 * PAD) / bh), 0.05, 4);
    return { k, tx: W / 2 - ((bounds.minX + bounds.maxX) / 2) * k, ty: H / 2 - ((bounds.minY + bounds.maxY) / 2) * k };
  }, [W, H, bounds]);
  const [view, setView] = useState<{ k: number; tx: number; ty: number } | null>(null);
  const v = view ?? fit;
  const viewRef = useRef(v); viewRef.current = v;
  const drag = useRef({ on: false, x: 0, y: 0, moved: false });
  const [grab, setGrab] = useState(false);

  useEffect(() => { const el = wrapRef.current; if (!el) return; const ro = new ResizeObserver(() => setW(el.clientWidth || 760)); ro.observe(el); return () => ro.disconnect(); }, []);
  useEffect(() => {
    const el = svgRef.current; if (!el) return;
    const onWheel = (e: WheelEvent) => { e.preventDefault(); const rect = el.getBoundingClientRect(); const sx = e.clientX - rect.left, sy = e.clientY - rect.top; const cur = viewRef.current; const k = clamp(cur.k * Math.exp(-e.deltaY * 0.0015), 0.05, 16); setView({ k, tx: sx - ((sx - cur.tx) / cur.k) * k, ty: sy - ((sy - cur.ty) / cur.k) * k }); };
    el.addEventListener('wheel', onWheel, { passive: false }); return () => el.removeEventListener('wheel', onWheel);
  }, []);
  const onDown = (e: ReactMouseEvent) => { if (!view) setView(viewRef.current); drag.current = { on: true, x: e.clientX, y: e.clientY, moved: false }; setGrab(true); };
  const onMove = (e: ReactMouseEvent) => {
    if (drag.current.on) { const cur = viewRef.current; setView({ k: cur.k, tx: cur.tx + (e.clientX - drag.current.x), ty: cur.ty + (e.clientY - drag.current.y) }); drag.current.x = e.clientX; drag.current.y = e.clientY; drag.current.moved = true; return; }
    const el = svgRef.current; if (!el) return; const r = el.getBoundingClientRect(); setHoverNode(hitTest(e.clientX - r.left, e.clientY - r.top));
  };
  const onUp = () => { drag.current.on = false; setGrab(false); };
  const zoomBy = (f: number) => { const cur = viewRef.current, cx = W / 2, cy = H / 2, k = clamp(cur.k * f, 0.05, 16); setView({ k, tx: cx - ((cx - cur.tx) / cur.k) * k, ty: cy - ((cy - cur.ty) / cur.k) * k }); };

  const OTHER = built.L.K - 1;
  const cColor = (c: number) => (c === OTHER ? '#a3adba' : commColor(c)); // folded "other" cluster → grey
  // per-community summary for the legend table (biggest regulators name each cluster)
  const communities = useMemo(() => {
    const g = Array.from({ length: built.L.K }, () => ({ regs: [] as number[], nGenes: 0 }));
    data.regulators.forEach((_, i) => g[built.L.comm[i]].regs.push(i));
    for (let t = 0; t < data.targets.length; t++) g[built.L.tcomm[t]].nGenes++;
    return g.map((b, c) => ({ c, regs: b.regs.sort((a, z) => data.regulators[z].size - data.regulators[a].size), nReg: b.regs.length, nGenes: b.nGenes }))
      .filter((x) => x.nReg > 0)
      .sort((a, b) => b.nGenes - a.nGenes);
  }, [data, built.L]);
  const focus = hoverComm ?? selComm; // a focused cluster dims everything else
  const hover = hoverNode?.kind === 'reg' ? hoverNode.i : null;
  const hubR = (size: number) => clamp(2.5 + Math.sqrt(size / maxSize) * 11, 2.5, 13);
  // nearest node under the cursor (screen px) — regulators first (bigger, clickable), then gene dots
  const hitTest = (sx: number, sy: number): { kind: 'reg' | 'gene'; i: number } | null => {
    const cur = viewRef.current, wx = (sx - cur.tx) / cur.k, wy = (sy - cur.ty) / cur.k;
    let bi = -1, bd = Infinity;
    for (let i = 0; i < data.regulators.length; i++) { const dx = wx - L.rx[i], dy = wy - L.ry[i], d2 = dx * dx + dy * dy, rr = hubR(data.regulators[i].size) + 3 / cur.k; if (d2 < rr * rr && d2 < bd) { bd = d2; bi = i; } }
    if (bi >= 0) return { kind: 'reg', i: bi };
    const th = 5 / cur.k; let gi = -1, gd = th * th;
    for (let t = 0; t < data.targets.length; t++) { const dx = wx - L.tx[t], dy = wy - L.ty[t], d2 = dx * dx + dy * dy; if (d2 < gd) { gd = d2; gi = t; } }
    return gi >= 0 ? { kind: 'gene', i: gi } : null;
  };
  const clickNode = () => { if (drag.current.moved || !hoverNode) return; const uid = hoverNode.kind === 'reg' ? data.regulators[hoverNode.i].uniqID : data.targets[hoverNode.i].u; if (uid) onGene(uid); };
  // layers memoised on the focused cluster (not on hover), so hover hit-testing doesn't re-render the
  // thousands of edge/dot elements — only the small overlay + labels update
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const edgeLayer = useMemo(() => (['r', 'a', 'd', ''] as const).map((m) => edgePaths[m] && (
    <path key={m || 'x'} d={edgePaths[m]} fill="none" stroke={MODE_COLOR[m]} strokeWidth={0.5} strokeOpacity={focus != null ? 0.04 : 0.13} style={{ vectorEffect: 'non-scaling-stroke' }} />
  )), [edgePaths, focus]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const dotLayer = useMemo(() => dotsByComm.map((d, c) => d && (
    <path key={c} d={d} fill="none" stroke={cColor(c)} strokeWidth={2.4} strokeLinecap="round" strokeOpacity={focus == null || focus === c ? 0.6 : 0.05} style={{ vectorEffect: 'non-scaling-stroke' }} />
  )), [dotsByComm, focus]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const hubLayer = useMemo(() => data.regulators.map((r, i) => (
    <circle key={i} cx={L.rx[i]} cy={L.ry[i]} r={hubR(r.size)} fill={cColor(L.comm[i])} className="stroke-white" strokeWidth={1} opacity={focus != null && focus !== L.comm[i] ? 0.12 : 1} style={{ vectorEffect: 'non-scaling-stroke' }} />
  )), [data, L, focus, maxSize]);
  // Which regulator labels to show: EVERY regulator is a candidate, but at a FIXED screen text size we
  // greedily keep the biggest first and drop any whose label box would collide with one already kept
  // (mirrors the pathway map's metabolite-label culling). Depends only on zoom `k` — panning is a pure
  // translation, so it doesn't change which labels overlap; zooming IN spreads nodes → more labels appear.
  const FS = 10, CHARW = 5.3, LH = 12, PAD = 1.5;
  const labelVis = useMemo(() => {
    const k = v.k, vis = new Set<number>();
    const placed: { x: number; y: number; w: number; h: number }[] = [];
    const order = data.regulators.map((_, i) => i).sort((a, b) => data.regulators[b].size - data.regulators[a].size);
    for (const i of order) {
      const w = data.regulators[i].name.length * CHARW + 2 * PAD, h = LH;
      const cx = L.rx[i] * k, cy = L.ry[i] * k - hubR(data.regulators[i].size) * k - 6; // label centre, screen space (pan-invariant)
      const b = { x: cx - w / 2, y: cy - h / 2, w, h };
      if (placed.some((p) => !(b.x + b.w < p.x || p.x + p.w < b.x || b.y + b.h < p.y || p.y + p.h < b.y))) continue;
      placed.push(b); vis.add(i);
    }
    return vis;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v.k, data, L]);

  return (
    <div>
      <div className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-neutral-500">
        <span>{data.regulators.length} regulators · {data.targets.length.toLocaleString()} genes · {data.edges.length.toLocaleString()} edges (static layout)</span>
        {(['a', 'r', 'd'] as const).filter((m) => edgePaths[m]).map((m) => <span key={m} className="inline-flex items-center gap-1"><span className="inline-block h-[3px] w-3.5 rounded" style={{ background: MODE_COLOR[m] }} />{m === 'a' ? 'activation' : m === 'r' ? 'repression' : 'dual'}</span>)}
        <span className="text-neutral-400">· large node = regulator, small dot = regulated gene · scroll to zoom, drag to pan</span>
      </div>
      <div className="flex gap-2">
      <div ref={wrapRef} className="relative min-w-0 flex-1">
        <ViewControls onZoomIn={() => zoomBy(1.3)} onZoomOut={() => zoomBy(1 / 1.3)} onReset={() => setView(null)} />
        <svg ref={svgRef} width={W} height={H} className="block select-none rounded border border-neutral-200 bg-white" style={{ cursor: grab ? 'grabbing' : hoverNode ? 'pointer' : 'grab' }}
          onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={() => { onUp(); setHoverNode(null); }} onClick={clickNode}>
          <g transform={`translate(${v.tx},${v.ty}) scale(${v.k})`}>
            {edgeLayer}
            {dotLayer}
            {hubLayer}
          </g>
          {/* fixed-size regulator labels in SCREEN space (collision-culled) */}
          {data.regulators.map((r, i) => {
            if (!labelVis.has(i)) return null;
            const dim = focus != null && focus !== L.comm[i];
            const sx = L.rx[i] * v.k + v.tx, sy = L.ry[i] * v.k + v.ty - hubR(r.size) * v.k - 6;
            return <text key={i} x={sx} y={sy} textAnchor="middle" fontSize={FS} fontWeight={hover === i ? 700 : 600} opacity={dim ? 0.15 : 1}
              className="fill-neutral-800 stroke-white" strokeWidth={3} paintOrder="stroke" pointerEvents="none">{r.name}</text>;
          })}
          {/* hover highlight: ring + name for whichever node (regulator OR gene) is under the cursor */}
          {hoverNode && (() => {
            const isReg = hoverNode.kind === 'reg';
            const wx = isReg ? L.rx[hoverNode.i] : L.tx[hoverNode.i], wy = isReg ? L.ry[hoverNode.i] : L.ty[hoverNode.i];
            const sx = wx * v.k + v.tx, sy = wy * v.k + v.ty;
            const cc = isReg ? L.comm[hoverNode.i] : L.tcomm[hoverNode.i];
            const rr = isReg ? hubR(data.regulators[hoverNode.i].size) * v.k : 3.5;
            const name = isReg ? data.regulators[hoverNode.i].name : data.targets[hoverNode.i].g;
            return (
              <g pointerEvents="none">
                <circle cx={sx} cy={sy} r={rr + 2.5} fill="none" stroke={cColor(cc)} strokeWidth={1.6} />
                <text x={sx} y={sy - rr - 5} textAnchor="middle" fontSize={FS} fontWeight={700} className="fill-neutral-900 stroke-white" strokeWidth={3.5} paintOrder="stroke">{name}</text>
              </g>
            );
          })()}
        </svg>
      </div>
      <aside className="w-64 shrink-0 overflow-y-auto rounded border border-neutral-200 bg-neutral-50 p-2" style={{ maxHeight: H }}>
        {selComm != null ? (() => {
          const cm = communities.find((x) => x.c === selComm);
          if (!cm) return null;
          const genes: { u: string; g: string }[] = [];
          for (let t = 0; t < data.targets.length; t++) if (L.tcomm[t] === selComm) genes.push(data.targets[t]);
          genes.sort((a, b) => a.g.localeCompare(b.g));
          const CAP = 300, shown = genes.slice(0, CAP);
          return (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: cColor(selComm) }} />
                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-neutral-800">{selComm === OTHER ? 'unclustered' : cm.regs.slice(0, 3).map((i) => data.regulators[i].name).join(', ')}</span>
                <button type="button" onClick={() => setSelComm(null)} className="shrink-0 text-[11px] text-neutral-400 hover:text-neutral-700">back</button>
              </div>
              <div className="text-[11px] text-neutral-500">{cm.nReg} regulators · {cm.nGenes.toLocaleString()} regulated genes</div>
              <div>
                <div className="mb-0.5 text-[11px] font-semibold text-neutral-600">Regulators</div>
                <div className="flex flex-wrap gap-1">{cm.regs.map((i) => { const rr = data.regulators[i]; return (
                  <button key={i} type="button" onClick={() => rr.uniqID && onGene(rr.uniqID)} disabled={!rr.uniqID}
                    className={`rounded px-1.5 py-0.5 text-[11px] ${rr.uniqID ? 'bg-white text-neutral-700 ring-1 ring-inset ring-neutral-200 hover:bg-blue-50 hover:text-blue-700' : 'bg-neutral-100 text-neutral-400'}`}>{rr.name}</button>
                ); })}</div>
              </div>
              <div>
                <div className="mb-0.5 text-[11px] font-semibold text-neutral-600">Regulated genes <span className="font-normal text-neutral-400">({cm.nGenes.toLocaleString()})</span></div>
                <div className="flex flex-wrap gap-1">{shown.map((t, idx) => (
                  <button key={`${t.u}-${idx}`} type="button" onClick={() => onGene(t.u)} className="rounded bg-white px-1.5 py-0.5 text-[11px] text-neutral-700 ring-1 ring-inset ring-neutral-200 hover:bg-blue-50 hover:text-blue-700">{t.g}</button>
                ))}</div>
                {genes.length > CAP && <div className="mt-1 px-1 text-[10px] text-neutral-400">+{(genes.length - CAP).toLocaleString()} more</div>}
              </div>
            </div>
          );
        })() : (
          <>
            <div className="mb-1 px-1 text-xs font-semibold text-neutral-700">Clusters <span className="font-normal text-neutral-400">({communities.length})</span></div>
            <ul className="space-y-0.5 text-xs">
              {communities.map((cm) => (
                <li key={cm.c}>
                  <button type="button" onClick={() => setSelComm(cm.c)} onMouseEnter={() => setHoverComm(cm.c)} onMouseLeave={() => setHoverComm(null)}
                    className={`flex w-full items-start gap-1.5 rounded px-1 py-0.5 text-left ${hoverComm === cm.c ? 'bg-neutral-100' : 'hover:bg-neutral-100'}`}>
                    <span className="mt-0.5 inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: cColor(cm.c) }} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-neutral-800">{cm.c === OTHER ? 'unclustered' : cm.regs.slice(0, 3).map((i) => data.regulators[i].name).join(', ')}{cm.c !== OTHER && cm.nReg > 3 ? '…' : ''}</span>
                      <span className="text-[10px] text-neutral-400">{cm.nReg} reg · {cm.nGenes.toLocaleString()} genes</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </aside>
      </div>
    </div>
  );
}
