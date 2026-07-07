import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Multiome, MultiomePoint } from '@uniome/shared';
import { PATHWAY_COLOR, kgpcColor, NO_COLOR } from './networkParts';
import { useThresholds, INVERT, TWO_SIDED } from '../lib/thresholds';
import { fetchJSONWithRetry } from '../lib/api';

// The /multiome payload is large and organism-stable, but BrowserPage unmounts on every navigation,
// so a naive fetch-on-mount re-loads it (and flashes "loading…") each time you return to the home
// page. Cache it per taxid across mounts, and de-dup concurrent loads, so revisits are instant.
// `prefetchMultiome` lets the Layout warm the cache the moment you enter an organism.
const multiomeCache = new Map<string, Multiome>();
const multiomeInflight = new Map<string, Promise<Multiome | null>>();
export function prefetchMultiome(taxid: string): Promise<Multiome | null> {
  const cached = multiomeCache.get(taxid);
  if (cached) return Promise.resolve(cached);
  const pending = multiomeInflight.get(taxid);
  if (pending) return pending;
  const p = fetchJSONWithRetry<Multiome>(`/api/organism/${taxid}/multiome`)
    .then((d) => { if (d) multiomeCache.set(taxid, d); return d ?? null; })
    .catch(() => null)
    .finally(() => multiomeInflight.delete(taxid));
  multiomeInflight.set(taxid, p);
  return p;
}

// Multiome explorer — an alternative gene navigator. Instead of genome position, genes are placed by
// their multiome scores in three scatters (essentiality LB×M9, mutability×conservation, RNA×protein
// expression), each with marginal histograms. Hover cross-highlights the same gene in all three;
// click opens its entry. Each axis is the gene's 0–1 genome-wide score for that metric. Dots colour by
// KEGG class OR by per-plot threshold quadrant (thresholds are draggable dashed lines, default 0.5).
type Axis = 'essLb' | 'essM9' | 'mutability' | 'conservation' | 'protein' | 'transcript';
type Plot = {
  title: string;
  x: Axis; xLabel: string; xInvert?: boolean; // xInvert = reverse the axis DISPLAY direction
  y: Axis; yLabel: string; yInvert?: boolean;
  quad: [string, string, string, string]; // labels for [hh, hl, lh, ll] (h = in the flagged extreme)
};
const PLOTS: Plot[] = [
  { title: 'essentiality', x: 'essLb', xLabel: 'LB essential →', y: 'essM9', yLabel: 'M9 essential →', quad: ['both', 'LB only', 'M9 only', 'neither'] },
  // Mutable runs 0→1 (right), conservation reversed 1→0 (not-conserved at top), so the unstable
  // corner — mutable + variable — sits top-right.
  { title: 'mutability × conservation', x: 'mutability', xLabel: 'mutable →', y: 'conservation', yLabel: 'variable →', yInvert: true, quad: ['mutable+variable', 'mutable', 'variable', 'neither'] },
  { title: 'expression', x: 'transcript', xLabel: 'RNA →', y: 'protein', yLabel: 'protein →', quad: ['high both', 'RNA-high', 'protein-high', 'low both'] },
];
const HL = '#ea580c'; // cross-plot highlight ring
type ColorMode = 'kegg' | 'threshold';
// Binary plots (essentiality, mutability×conservation): each axis is flagged/not → 2×2 quadrants.
const QUAD: Record<string, string> = { hh: '#dc2626', hl: '#f59e0b', lh: '#2563eb', ll: '#cbd5e1' };
// Two-sided plots (expression): each axis is lo/mid/hi → 3×3 bivariate grid (key `${xTier}-${yTier}`).
const BIVAR: Record<string, string> = {
  'lo-lo': '#e8e8e8', 'mid-lo': '#ace4e4', 'hi-lo': '#5ac8c8',
  'lo-mid': '#dfb0d6', 'mid-mid': '#a5add3', 'hi-mid': '#5698b9',
  'lo-hi': '#be64ac', 'mid-hi': '#8c62aa', 'hi-hi': '#3b4994',
};
const TIERS = ['lo', 'mid', 'hi'] as const;
// Is a score in the flagged extreme? top X% = score above the (1−top) quantile, unless the metric is
// inverted (flag the LOW tail, e.g. conservation) where it's the score below the top quantile.
const inExtreme = (score: number, selScore: number, invert: boolean) => (invert ? score <= selScore : score >= selScore);
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export function MultiomeExplorer({ taxid, condensed, focusId, onPick }: { taxid: string; condensed?: boolean; focusId?: string; onPick?: (g: { uniqID: string; gene: string; chrom: string } | null) => void }) {
  const [data, setData] = useState<Multiome | null | undefined>(() => multiomeCache.get(taxid));
  const [hover, setHover] = useState<string | null>(null);
  const [colorMode, setColorModeState] = useState<ColorMode>('kegg');
  // Group highlight, mirroring the structure viewer's hover/lock heuristic: a transient HOVER group
  // and a clicked LOCK group; the effective highlight is `hover ?? lock` (live hover wins). Hovering a
  // legend item or a marginal class-peak sets the hover; clicking toggles the lock. Others dim.
  const [gHover, setGHover] = useState<{ key: string; ids: Set<string> } | null>(null);
  const [gLock, setGLock] = useState<{ key: string; ids: Set<string> } | null>(null);
  const group = gHover ?? gLock;
  const onGroupHover = (g: { key: string; ids: Set<string> } | null) => setGHover(g);
  const onGroupClick = (key: string, ids: Set<string>) => setGLock((s) => (s && s.key === key ? null : { key, ids }));
  const setColorMode = (m: ColorMode) => { setColorModeState(m); setGHover(null); setGLock(null); };
  // Thresholds are the SHARED per-metric "top X%" selections (also drive the general-section field
  // chips); each axis IS a metric, so a plot's x/y thresholds are just those metrics' values.
  const { top, setTop } = useThresholds();
  const nav = useNavigate();
  useEffect(() => {
    let on = true;
    setHover(null); setGHover(null); setGLock(null);
    const cached = multiomeCache.get(taxid);
    if (cached) { setData(cached); return; } // instant on revisit — no refetch, no loading flash
    setData(undefined);
    prefetchMultiome(taxid).then((d) => on && setData(d));
    return () => { on = false; };
  }, [taxid]);

  const size = condensed ? 130 : 196;

  if (data === undefined) return <div className="py-3 text-center text-xs text-neutral-400">loading multiome…</div>;
  if (!data || !data.length) return <div className="py-3 text-center text-xs text-neutral-400">no multiome data</div>;

  // Selection is decoupled from navigation: when `onPick` is supplied (organism home), picking a
  // point reports it (or null to deselect) and stays put; otherwise fall back to navigating.
  const openGene = (p: MultiomePoint) => (onPick ? onPick({ uniqID: p.uniqID, gene: p.gene, chrom: p.chrom }) : nav(`/o/${taxid}/c/${encodeURIComponent(p.chrom)}/entry/${p.uniqID}`));
  const deselect = (chrom: string) => (onPick ? onPick(null) : nav(`/o/${taxid}/c/${encodeURIComponent(chrom)}`));

  return (
    <div className="flex flex-col gap-1">
      {!condensed && (
        <div className="flex items-center justify-center gap-2 text-[10px] text-neutral-500">
          <span>colour by</span>
          <div className="flex rounded-full border border-neutral-200 bg-neutral-50 p-0.5">
            {(['kegg', 'threshold'] as ColorMode[]).map((m) => (
              <button key={m} type="button" onClick={() => setColorMode(m)}
                className={'cursor-pointer rounded-full px-2 py-0.5 ' + (colorMode === m ? 'bg-white font-medium text-neutral-800 shadow-sm' : 'text-neutral-500 hover:text-neutral-700')}>
                {m === 'kegg' ? 'KEGG class' : 'threshold'}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-start justify-center gap-x-6 gap-y-2">
        {PLOTS.map((pl) => (
          <Scatter key={pl.title} plot={pl} data={data} size={size} hover={hover} onHover={setHover} onPick={openGene} onDeselect={deselect} focusId={focusId}
            condensed={condensed} colorMode={colorMode} top={{ x: top[pl.x], y: top[pl.y] }} selInv={{ x: INVERT[pl.x], y: INVERT[pl.y] }}
            twoSided={{ x: TWO_SIDED[pl.x], y: TWO_SIDED[pl.y] }} onThr={(a, v) => setTop(a === 'x' ? pl.x : pl.y, v)}
            highlight={group?.ids ?? null} activeKey={group?.key ?? null} lockedKey={gLock?.key ?? null} lockedIds={gLock?.ids ?? null} onGroupHover={onGroupHover} onGroupClick={onGroupClick} />
        ))}
      </div>
      {!condensed && colorMode === 'kegg' && <KeggLegend data={data} activeKey={group?.key ?? null} lockedKey={gLock?.key ?? null} onGroupHover={onGroupHover} onGroupClick={onGroupClick} />}
    </div>
  );
}

type Placed = { p: MultiomePoint; cx: number; cy: number };
// Gaussian KDE sampled along [0,1]; `density` normalises it to its own peak (one smooth marginal
// curve), `classDensities` builds one self-normalised curve per KEGG class (so each class shows a
// visible peak at its mode, coloured by class) — used as the marginal in KEGG colour mode.
const SAMP = 48;
function densityRaw(vals: number[], bw = 0.045): number[] {
  const out = new Array(SAMP).fill(0);
  if (!vals.length) return out;
  const inv = 1 / bw;
  for (let s = 0; s < SAMP; s++) {
    const x = (s + 0.5) / SAMP;
    let sum = 0;
    for (const v of vals) { const z = (x - v) * inv; sum += Math.exp(-0.5 * z * z); }
    out[s] = sum;
  }
  return out;
}
function density(vals: number[]): number[] {
  const raw = densityRaw(vals);
  const max = Math.max(1e-9, ...raw);
  return raw.map((d) => d / max);
}
function classDensities(placed: Placed[], getVal: (it: Placed) => number): { cls: string; color: string; dens: number[] }[] {
  const groups = new Map<string, number[]>();
  for (const it of placed) { const k = it.p.kgpc && it.p.kgpc in PATHWAY_COLOR ? it.p.kgpc : 'other'; (groups.get(k) ?? groups.set(k, []).get(k)!).push(getVal(it)); }
  return [...groups.entries()]
    .sort((a, b) => b[1].length - a[1].length) // larger classes first (drawn under the smaller ones)
    .map(([k, vals]) => { const raw = densityRaw(vals); const max = Math.max(1e-9, ...raw); return { cls: k, color: k === 'other' ? NO_COLOR : kgpcColor(k), dens: raw.map((d) => d / max) }; });
}
// Percentile ↔ score on a sorted value array: `quantileAt` gives the score at percentile p (so a
// percentile threshold maps to a score-axis position); `pctOfScore` is the inverse (a dragged score
// → its percentile). This keeps the axes score-based while thresholds read as percentiles.
const quantileAt = (sorted: number[], p: number) => (sorted.length ? sorted[Math.max(0, Math.min(sorted.length - 1, Math.round(p * (sorted.length - 1))))] : 0.5);
const pctOfScore = (sorted: number[], v: number) => { let lo = 0, hi = sorted.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] <= v) lo = mid + 1; else hi = mid; } return sorted.length ? lo / sorted.length : 0; };

type XY = { x: number; y: number };
type XYB = { x: boolean; y: boolean };
type Grp = { key: string; ids: Set<string> };
function Scatter({ plot, data, size, hover, onHover, onPick, onDeselect, condensed, colorMode, top, selInv, twoSided, onThr, focusId, highlight, activeKey, lockedKey, lockedIds, onGroupHover, onGroupClick }: {
  plot: Plot; data: Multiome; size: number; hover: string | null; onHover: (id: string | null) => void; onPick: (p: MultiomePoint) => void;
  condensed?: boolean; colorMode: ColorMode; top: XY; selInv: XYB; twoSided: XYB; onThr: (axis: 'x' | 'y', v: number) => void; focusId?: string; onDeselect: (chrom: string) => void;
  highlight: Set<string> | null; activeKey: string | null; lockedKey: string | null; lockedIds: Set<string> | null; onGroupHover: (g: Grp | null) => void; onGroupClick: (key: string, ids: Set<string>) => void;
}) {
  const M = condensed ? 0 : 13, G = condensed ? 0 : 3; // marginal thickness + gap
  const PAD = condensed ? { l: 7, r: 6, t: 6, b: 7 } : { l: 16, r: 8, t: 8, b: 15 };
  const W = size, H = size;
  const plotX0 = PAD.l, plotY0 = PAD.t + M + G, plotX1 = W - PAD.r - M - G, plotY1 = H - PAD.b;
  const plotW = plotX1 - plotX0, plotH = plotY1 - plotY0;
  const sx = (v: number) => plotX0 + (plot.xInvert ? 1 - v : v) * plotW;
  const sy = (v: number) => plotY0 + (plot.yInvert ? v : 1 - v) * plotH;

  const placed = useMemo<Placed[]>(() =>
    data.filter((p) => p[plot.x] != null && p[plot.y] != null)
      .map((p) => ({ p, cx: sx(p[plot.x] as number), cy: sy(p[plot.y] as number) })),
    [data, plot, size]); // eslint-disable-line react-hooks/exhaustive-deps
  // One overall density (threshold mode) + per-class densities (KEGG mode). Memoised on the data.
  const xd = useMemo(() => density(placed.map((d) => d.p[plot.x] as number)), [placed, plot.x]);
  const yd = useMemo(() => density(placed.map((d) => d.p[plot.y] as number)), [placed, plot.y]);
  const xCls = useMemo(() => classDensities(placed, (it) => it.p[plot.x] as number), [placed, plot.x]);
  const yCls = useMemo(() => classDensities(placed, (it) => it.p[plot.y] as number), [placed, plot.y]);
  // Path builders: a density array → {line, fill} along the top (x) / right (y) marginal strip.
  const xBase = PAD.t + M, yBase = plotX1 + G;
  const buildX = (dens: number[]) => {
    const pts = dens.map((d, s) => ({ x: sx((s + 0.5) / SAMP), y: xBase - d * (M - 2) }));
    return { line: `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)} ` + pts.slice(1).map((p) => `L ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' '),
      fill: `M ${pts[0].x.toFixed(1)} ${xBase} ` + pts.map((p) => `L ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ') + ` L ${pts[pts.length - 1].x.toFixed(1)} ${xBase} Z` };
  };
  const buildY = (dens: number[]) => {
    const pts = dens.map((d, s) => ({ x: yBase + d * (M - 2), y: sy((s + 0.5) / SAMP) }));
    return { line: `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)} ` + pts.slice(1).map((p) => `L ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' '),
      fill: `M ${yBase} ${pts[0].y.toFixed(1)} ` + pts.map((p) => `L ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ') + ` L ${yBase} ${pts[pts.length - 1].y.toFixed(1)} Z` };
  };

  // Thresholds are "top X%"; map each to the score at the matching quantile so the dashed line sits on
  // the score axis. Binary axes have one cut (the flagged extreme); two-sided axes have two (top X% +
  // bottom X% → lo/mid/hi). `grid` plots (both two-sided) colour by a 3×3 bivariate scheme.
  const xs = useMemo(() => placed.map((d) => d.p[plot.x] as number).sort((a, b) => a - b), [placed, plot.x]);
  const ys = useMemo(() => placed.map((d) => d.p[plot.y] as number).sort((a, b) => a - b), [placed, plot.y]);
  const grid = twoSided.x && twoSided.y;
  const selX = selInv.x ? quantileAt(xs, top.x) : quantileAt(xs, 1 - top.x);
  const selY = selInv.y ? quantileAt(ys, top.y) : quantileAt(ys, 1 - top.y);
  const hiX = quantileAt(xs, 1 - top.x), loX = quantileAt(xs, top.x);
  const hiY = quantileAt(ys, 1 - top.y), loY = quantileAt(ys, top.y);
  const tierX = (s: number) => twoSided.x ? (s >= hiX ? 'hi' : s <= loX ? 'lo' : 'mid') : (inExtreme(s, selX, selInv.x) ? 'h' : 'l');
  const tierY = (s: number) => twoSided.y ? (s >= hiY ? 'hi' : s <= loY ? 'lo' : 'mid') : (inExtreme(s, selY, selInv.y) ? 'h' : 'l');

  // Base point layer is memoised so hover (overlay only) never re-renders ~4k circles. In threshold
  // mode it also depends on the thresholds so dragging recolours live.
  const colorOf = (p: MultiomePoint) => colorMode !== 'threshold' ? kgpcColor(p.kgpc)
    : grid ? BIVAR[`${tierX(p[plot.x] as number)}-${tierY(p[plot.y] as number)}`] : QUAD[`${tierX(p[plot.x] as number)}${tierY(p[plot.y] as number)}`];
  const base = useMemo(() => (
    <g>{placed.map(({ p, cx, cy }) => <circle key={p.uniqID} cx={cx} cy={cy} r={condensed ? 1.2 : 1.6} fill={colorOf(p)} fillOpacity={highlight ? (highlight.has(p.uniqID) ? 0.95 : 0.05) : 0.65} />)}</g>
  ), [placed, condensed, colorMode, top.x, top.y, highlight]); // eslint-disable-line react-hooks/exhaustive-deps

  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<string | null>(null); // mark code being dragged: 'x'/'y' (binary) or 'xhi'/'xlo'/'yhi'/'ylo'
  const moved = useRef(false);
  const at = (e: { clientX: number; clientY: number }) => { const r = svgRef.current!.getBoundingClientRect(); return { mx: e.clientX - r.left, my: e.clientY - r.top }; };
  const nearest = (e: { clientX: number; clientY: number }): Placed | null => {
    const { mx, my } = at(e);
    let best: Placed | null = null, bd = Infinity;
    // When a group is locked, only its dots are selectable (the dimmed rest are inert).
    for (const it of placed) { if (lockedIds && !lockedIds.has(it.p.uniqID)) continue; const dx = it.cx - mx, dy = it.cy - my, d = dx * dx + dy * dy; if (d < bd) { bd = d; best = it; } }
    return best && bd <= 81 ? best : null;
  };
  const onMove = (e: ReactPointerEvent) => {
    const code = drag.current;
    if (code) {
      moved.current = true;
      const axis = code[0] as 'x' | 'y';
      const { mx, my } = at(e);
      const f = axis === 'x' ? (mx - plotX0) / plotW : (my - plotY0) / plotH;
      const score = clamp01(axis === 'x' ? (plot.xInvert ? 1 - f : f) : (plot.yInvert ? f : 1 - f));
      const p = pctOfScore(axis === 'x' ? xs : ys, score);
      const inv = axis === 'x' ? selInv.x : selInv.y, two = axis === 'x' ? twoSided.x : twoSided.y;
      // edge 'hi' line → top = 1−p; 'lo' line → top = p; binary line → depends on the metric's invert.
      let nt = code.endsWith('lo') ? p : code.endsWith('hi') ? 1 - p : (inv ? p : 1 - p);
      onThr(axis, Math.max(0.02, Math.min(two ? 0.49 : 0.95, nt)));
      return;
    }
    if (overFocus(e)) { onHover(null); return; } // the current-gene marker sits on top → don't hover a gene behind it
    const n = nearest(e); onHover(n ? n.p.uniqID : null);
  };
  const onLeave = () => { onHover(null); drag.current = null; };
  const onUp = () => { drag.current = null; };
  const startDrag = (e: ReactPointerEvent, code: string) => { e.stopPropagation(); drag.current = code; moved.current = false; };
  // True when the cursor is over the current-gene dot or its label (which deselect on click via their
  // own handler) — so the genes hidden behind aren't hover/click hit-tested through them.
  const overFocus = (e: { clientX: number; clientY: number }) => {
    if (!focus) return false;
    const { mx, my } = at(e);
    const r = (condensed ? 3.4 : 4.4) + 1;
    return (mx - focus.cx) ** 2 + (my - focus.cy) ** 2 <= r * r || (!condensed && mx >= focusLx && mx <= focusLx + focusW && my >= focusLy && my <= focusLy + 12);
  };
  const onClick = (e: ReactMouseEvent) => { if (moved.current) { moved.current = false; return; } if (overFocus(e)) return; const n = nearest(e); if (n) onPick(n.p); };

  const hp = hover ? placed.find((it) => it.p.uniqID === hover) ?? null : null;
  const tline = colorMode === 'threshold';
  // Selected legend group: the KEGG class to keep lit in the marginals, + a helper to collect the
  // gene-ids of a threshold cell (so clicking a quadrant/grid swatch highlights its genes everywhere).
  const selCls = activeKey && activeKey.startsWith('kegg:') ? activeKey.slice(5) : null;
  const groupIds = (xt: string, yt: string) => new Set(placed.filter((it) => tierX(it.p[plot.x] as number) === xt && tierY(it.p[plot.y] as number) === yt).map((it) => it.p.uniqID));
  // Group helpers for the legend / marginal-peak hover: per-quadrant ids above; per-KEGG-class ids
  // (global, from all data so dimming is consistent across plots).
  const keggGroup = (cls: string): Grp => ({ key: `kegg:${cls}`, ids: new Set(data.filter((p) => (cls === 'other' ? !p.kgpc || !(p.kgpc in PATHWAY_COLOR) : p.kgpc === cls)).map((p) => p.uniqID)) });
  // Dashed threshold marks: one per binary axis, two (hi/lo) per two-sided axis.
  const pctTxt = (t: number) => `${Math.round(t * 100)}%`;
  const xMarks = twoSided.x ? [{ c: 'xhi', s: hiX, l: `top ${pctTxt(top.x)}` }, { c: 'xlo', s: loX, l: `bot ${pctTxt(top.x)}` }] : [{ c: 'x', s: selX, l: `top ${pctTxt(top.x)}` }];
  const yMarks = twoSided.y ? [{ c: 'yhi', s: hiY, l: `top ${pctTxt(top.y)}` }, { c: 'ylo', s: loY, l: `bot ${pctTxt(top.y)}` }] : [{ c: 'y', s: selY, l: `top ${pctTxt(top.y)}` }];
  // The current entry gene, flagged with a larger dot + name.
  const focus = focusId ? placed.find((it) => it.p.uniqID === focusId || it.p.locus_tag === focusId) ?? null : null;
  const focusName = focus ? focus.p.gene || focus.p.locus_tag : '';
  const focusW = focusName.length * 5.2 + 6;
  const focusLx = focus ? Math.max(plotX0, Math.min(plotX1 - focusW, focus.cx - focusW / 2)) : 0;
  const focusLy = focus ? (focus.cy - 16 < plotY0 ? focus.cy + 5 : focus.cy - 16) : 0;
  // Hovered-gene label, shown at its dot on EVERY plot (cross-plot), black-on-white (vs the entry
  // gene's white-on-black). Skipped when the hovered gene is the entry gene (already labelled).
  const hLabel = hp && !(focus && hp.p.uniqID === focus.p.uniqID) ? hp.p.gene || hp.p.locus_tag : '';
  const hLeft = hp ? hp.cx < plotX1 - 40 : true;

  return (
    <div className="flex flex-col items-center">
      {!condensed && <div className="mb-0.5 text-[10px] font-medium text-neutral-600">{plot.title}</div>}
      <svg ref={svgRef} width={W} height={H} className="block cursor-pointer touch-none select-none"
        onPointerMove={onMove} onPointerLeave={onLeave} onPointerUp={onUp} onClick={onClick}>
        {/* marginal density: per-KEGG-class curves in KEGG mode, one overall curve in threshold mode */}
        {M > 0 && (colorMode === 'kegg' ? (
          <>
            {xCls.map((c, i) => { const d = selCls != null && c.cls !== selCls; const b = buildX(c.dens); return <g key={'xc' + i} style={{ cursor: 'pointer' }} onMouseEnter={() => onGroupHover(keggGroup(c.cls))} onMouseLeave={() => onGroupHover(null)} onClick={(e) => { e.stopPropagation(); onGroupClick(`kegg:${c.cls}`, keggGroup(c.cls).ids); }}><path d={b.fill} fill={c.color} fillOpacity={d ? 0.03 : 0.16} /><path d={b.line} fill="none" stroke={c.color} strokeWidth={0.9} strokeOpacity={d ? 0.18 : 0.9} strokeLinejoin="round" /></g>; })}
            {yCls.map((c, i) => { const d = selCls != null && c.cls !== selCls; const b = buildY(c.dens); return <g key={'yc' + i} style={{ cursor: 'pointer' }} onMouseEnter={() => onGroupHover(keggGroup(c.cls))} onMouseLeave={() => onGroupHover(null)} onClick={(e) => { e.stopPropagation(); onGroupClick(`kegg:${c.cls}`, keggGroup(c.cls).ids); }}><path d={b.fill} fill={c.color} fillOpacity={d ? 0.03 : 0.16} /><path d={b.line} fill="none" stroke={c.color} strokeWidth={0.9} strokeOpacity={d ? 0.18 : 0.9} strokeLinejoin="round" /></g>; })}
          </>
        ) : (
          <>
            <path d={buildX(xd).fill} className="fill-neutral-200" /><path d={buildX(xd).line} fill="none" className="stroke-neutral-400" strokeWidth={0.8} strokeLinejoin="round" />
            <path d={buildY(yd).fill} className="fill-neutral-200" /><path d={buildY(yd).line} fill="none" className="stroke-neutral-400" strokeWidth={0.8} strokeLinejoin="round" />
          </>
        ))}
        {/* plot frame + mid guides */}
        <rect x={plotX0} y={plotY0} width={plotW} height={plotH} className="fill-neutral-50 stroke-neutral-200" strokeWidth={0.7} />
        {!tline && <><line x1={sx(0.5)} y1={plotY0} x2={sx(0.5)} y2={plotY1} className="stroke-neutral-100" strokeWidth={0.6} /><line x1={plotX0} y1={sy(0.5)} x2={plotX1} y2={sy(0.5)} className="stroke-neutral-100" strokeWidth={0.6} /></>}
        {base}
        {/* threshold marks — drawn at the score for each "top X%" cut; draggable */}
        {tline && (
          <g>
            {xMarks.map((m) => (
              <g key={m.c}>
                <line x1={sx(m.s)} y1={plotY0} x2={sx(m.s)} y2={plotY1} className="stroke-neutral-900" strokeWidth={0.8} strokeDasharray="3 2" />
                <line x1={sx(m.s)} y1={plotY0} x2={sx(m.s)} y2={plotY1} stroke="transparent" strokeWidth={9} style={{ cursor: 'col-resize' }} onPointerDown={(e) => startDrag(e, m.c)} />
                {!condensed && <text x={sx(m.s)} y={plotY0 + 7} textAnchor="middle" fontSize={7} className="fill-neutral-900">{m.l}</text>}
              </g>
            ))}
            {yMarks.map((m) => (
              <g key={m.c}>
                <line x1={plotX0} y1={sy(m.s)} x2={plotX1} y2={sy(m.s)} className="stroke-neutral-900" strokeWidth={0.8} strokeDasharray="3 2" />
                <line x1={plotX0} y1={sy(m.s)} x2={plotX1} y2={sy(m.s)} stroke="transparent" strokeWidth={9} style={{ cursor: 'row-resize' }} onPointerDown={(e) => startDrag(e, m.c)} />
                {!condensed && <text x={plotX1 - 2} y={sy(m.s) - 2} textAnchor="end" fontSize={7} className="fill-neutral-900">{m.l}</text>}
              </g>
            ))}
          </g>
        )}
        {hp && <circle cx={hp.cx} cy={hp.cy} r={condensed ? 2.6 : 3.4} fill="none" stroke={HL} strokeWidth={1.4} />}
        {focus && (
          <g style={{ cursor: 'pointer' }} onClick={(e) => { e.stopPropagation(); onDeselect(focus.p.chrom); }}>
            <title>deselect {focusName}</title>
            <circle cx={focus.cx} cy={focus.cy} r={condensed ? 3.4 : 4.4} fill={colorOf(focus.p)} className="stroke-neutral-900" strokeWidth={1.6} />
            {!condensed && <>
              <rect x={focusLx} y={focusLy} width={focusW} height={12} rx={2} className="fill-neutral-900" />
              <text x={focusLx + focusW / 2} y={focusLy + 9} textAnchor="middle" fontSize={8} className="fill-white">{focusName}</text>
            </>}
          </g>
        )}
        {!condensed && (
          <>
            <text x={plotX0 + plotW / 2} y={H - 4} textAnchor="middle" fontSize={8} className="fill-neutral-400">{plot.xLabel}</text>
            <text x={5} y={plotY0 + plotH / 2} fontSize={8} className="fill-neutral-400" textAnchor="middle" transform={`rotate(-90 5 ${plotY0 + plotH / 2})`}>{plot.yLabel}</text>
          </>
        )}
        {hp && hLabel && (
          <g pointerEvents="none">
            <rect x={hLeft ? hp.cx + 5 : hp.cx - 5 - (hLabel.length * 5.2 + 6)} y={hp.cy - 13} width={hLabel.length * 5.2 + 6} height={12} rx={2} className="fill-white stroke-neutral-900" strokeWidth={0.8} />
            <text x={hLeft ? hp.cx + 8 : hp.cx - 8 - hLabel.length * 5.2} y={hp.cy - 4} fontSize={8} className="fill-neutral-900">{hLabel}</text>
          </g>
        )}
      </svg>
      {/* threshold key — 4 quadrants (binary) or a 3×3 bivariate grid (two-sided); click to highlight */}
      {!condensed && tline && (grid ? (
        <div className="mt-0.5 flex flex-col items-center gap-0.5 text-[7px] text-neutral-400">
          <div className="grid grid-cols-3 gap-px">
            {(['hi', 'mid', 'lo'] as const).map((yt) => (['lo', 'mid', 'hi'] as const).map((xt) => {
              const key = `g:${plot.title}:${xt}-${yt}`;
              return <button key={`${xt}${yt}`} type="button"
                onMouseEnter={() => onGroupHover({ key, ids: groupIds(xt, yt) })} onMouseLeave={() => onGroupHover(null)} onClick={() => onGroupClick(key, groupIds(xt, yt))}
                className={`h-2 w-2 rounded-[1px] ${lockedKey === key ? 'ring-1 ring-neutral-800' : activeKey === key ? 'ring-1 ring-neutral-500' : ''}`} style={{ background: BIVAR[`${xt}-${yt}`] }} />;
            }))}
          </div>
          <span>{plot.xLabel.replace(/[→← ]/g, '')} × {plot.yLabel.replace(/[→← ]/g, '')} · lo→hi</span>
        </div>
      ) : (
        <div className="mt-0.5 flex flex-wrap justify-center gap-x-1.5 gap-y-0 text-[8px] text-neutral-500">
          {(['hh', 'hl', 'lh', 'll'] as const).map((k, i) => {
            const key = `q:${plot.title}:${k}`;
            return <button key={k} type="button"
              onMouseEnter={() => onGroupHover({ key, ids: groupIds(k[0], k[1]) })} onMouseLeave={() => onGroupHover(null)} onClick={() => onGroupClick(key, groupIds(k[0], k[1]))}
              className={`inline-flex items-center gap-0.5 rounded px-0.5 ${lockedKey === key ? 'bg-neutral-200 ring-1 ring-neutral-400' : activeKey === key ? 'bg-neutral-200' : 'hover:bg-neutral-100'}`}>
              <span className="inline-block h-1.5 w-1.5 rounded-sm" style={{ background: QUAD[k] }} />{plot.quad[i]}</button>;
          })}
        </div>
      ))}
    </div>
  );
}

function KeggLegend({ data, activeKey, lockedKey, onGroupHover, onGroupClick }: { data: Multiome; activeKey: string | null; lockedKey: string | null; onGroupHover: (g: Grp | null) => void; onGroupClick: (key: string, ids: Set<string>) => void }) {
  const idsFor = (c: string) => new Set(data.filter((p) => (c === 'other' ? !p.kgpc || !(p.kgpc in PATHWAY_COLOR) : p.kgpc === c)).map((p) => p.uniqID));
  const items: [string, string][] = [...Object.entries(PATHWAY_COLOR), ['other', NO_COLOR]];
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-1.5 gap-y-0.5 text-[9px] text-neutral-500">
      {items.map(([c, col]) => {
        const key = `kegg:${c}`;
        const cls = lockedKey === key ? 'bg-neutral-200 text-neutral-800 ring-1 ring-neutral-400' : activeKey === key ? 'bg-neutral-200 text-neutral-800' : 'hover:bg-neutral-100';
        return (
          <button key={c} type="button"
            onMouseEnter={() => onGroupHover({ key, ids: idsFor(c) })} onMouseLeave={() => onGroupHover(null)} onClick={() => onGroupClick(key, idsFor(c))}
            className={`inline-flex cursor-pointer items-center gap-1 rounded px-1 py-0.5 ${cls}`}>
            <span className="inline-block h-2 w-2 rounded-sm" style={{ background: col }} />{c}
          </button>
        );
      })}
    </div>
  );
}
