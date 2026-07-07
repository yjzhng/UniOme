import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Feature, RegulatoryFeature, RegulatoryContextGene, RegulatoryMap as RegMap } from '@uniome/shared';
import { ACCENT, InfoTip, LoadingBox } from '../components/Fields';
import { TableScroller } from '../components/TableScroller';
import { getSourceInfo } from '../sourceInfo';

// TF effect → canonical accent (activator green, repressor red, dual amber — matching the entry-page
// transcriptional-factor chips). Genes/structure stay neutral slate; promoter = blue, σ = indigo.
const EFFECT_COLOR: Record<string, string> = { activator: ACCENT.green, repressor: ACCENT.red, dual: ACCENT.amber };
const NO_EFFECT = '#9ca3af';
const GENE_COLOR = '#475569'; // the focal gene
const OPERON_COLOR = '#94a3b8'; // operon co-members
const FLANK_COLOR = '#cbd5e1'; // flanking genes
const PROMOTER_COLOR = ACCENT.blue;
const SIGMA_FILL = '#eef2ff', SIGMA_TEXT = '#3730a3'; // indigo-50 / indigo-800 (σ boxes)
const effColor = (e: string | null) => (e && EFFECT_COLOR[e]) || NO_EFFECT;

const MIN_SITE_W = 4;
const BOX_H = 7;
const ROW_H = 16;
const PROMO_RISE = 13;
const GENE_H = 13;
// RegulonDB sigma-factor gene name → conventional σ notation (fallback: the raw name).
const SIGMA_NOTATION: Record<string, string> = { RpoD: 'σ70', RpoS: 'σ38', RpoH: 'σ32', RpoN: 'σ54', RpoE: 'σ24', FliA: 'σ28', FecI: 'σ19' };
// Compact σ notation for the dense schematic map (e.g. "σ70"); gene name fallback if unmapped.
export const sigmaLabel = (s: string) => SIGMA_NOTATION[s] ?? s;
// Full label for chips, where there's room: gene name + σ notation (e.g. "RpoD (σ70)").
export const sigmaFull = (s: string) => (SIGMA_NOTATION[s] ? `${s} (${SIGMA_NOTATION[s]})` : s);
// Broken-axis ("collapse the empty space") layout, openly not-to-scale (no break glyph):
//  • Regions WITH features are kept at true scale and packed; the empty space between features and
//    between genes collapses — but along a √ curve, so a bigger empty stretch still reads bigger.
//  • A gene's long INTERIOR (no features) keeps a compressed body bar instead of fully collapsing,
//    so genes stay clearly longer than the (true-scale) elements.
// Overlaps stay faithful (a 2 bp overlap is ~true-scale, never inflated).
const MARGIN = 2;        // bp of context kept around each feature / gene boundary (tight)
const COLLAPSE_MIN = 4;  // gaps longer than this collapse
// Collapsed (non-body) gap width: √-of-length curve (monotonic + capped) → bigger gaps appear bigger.
const GAP_BASE = 1, GAP_SCALE = 0.9, GAP_MIN = 3, GAP_MAX = 22;
const BODY_MIN_BP = 40;  // a gene interior longer than this keeps a (compressed) body bar
// Body width follows a √-of-length curve → monotonic, so a longer gene is always drawn longer than a
// shorter one and the length ratio is roughly respected (compressed, never flat-clamped).
const BODY_BASE = 18, BODY_SCALE = 1.0, BODY_FLOOR = 24, BODY_MAX = 90;
const K_MAX = 1.1, K_MIN = 0.2; // px-per-bp in the kept regions — elements ~½ their previous size
const SCHEMATIC_ZOOM = 1.6; // schematic mode opens enlarged (overflows → pannable); to-scale opens at 1× (fits width)

type Gene = { name: string; start: number; end: number; strand: '+' | '-' };
type Site = { start: number; end: number; strand: '+' | '-' };
// One unique regulatory element (a TF, or a promoter) with all its binding sites — one track.
type Element = { key: string; kind: RegulatoryFeature['kind']; name: string; effect: string | null; sites: Site[]; sigma?: string[] };

// `regulators` = the gene's full regulator list (RegulonDB regulatedBy). Some of these have NO
// positionally-mapped binding site in our data source (RegulonDB's API exposes the regulatory link
// but no coordinate), so they can't be drawn as a bar — they're surfaced as a "site not mapped" note.
type Regulator = { name: string; function: string | null };
export function RegulatoryMapSection({ taxid, feature, leftPanel, regulators }: { taxid: string; feature: Feature; leftPanel?: ReactNode; regulators?: Regulator[] | null }) {
  const [data, setData] = useState<RegMap | null | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    setData(undefined);
    fetch(`/api/organism/${taxid}/features/${encodeURIComponent(feature.uniqID)}/regulatory-map`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => !cancelled && setData(d))
      .catch(() => !cancelled && setData(null));
    return () => { cancelled = true; };
  }, [taxid, feature.uniqID]);

  const title = (
    <div className="flex items-center gap-1 text-xs uppercase tracking-wide text-neutral-500">
      regulatory map
      <InfoTip text={getSourceInfo('regulatoryMap', taxid)} />
    </div>
  );
  const hasMap = !!feature.coord && !!data && data.features.length > 0;
  if (hasMap) {
    const gene: Gene = { name: feature.gene || feature.uniqID, start: feature.coord!.start, end: feature.coord!.end, strand: feature.coord!.strand === '-' ? '-' : '+' };
    // The map renders the SVG on top and the field info / element table 2-column below it.
    return <div className="space-y-1 pt-1">{title}<RegulatoryMap features={data!.features} context={data!.context} gene={gene} leftPanel={leftPanel} regulators={regulators} /></div>;
  }
  // No positional map → still show the -on field info, with a map placeholder above it.
  return (
    <div className="space-y-2 pt-1">
      <div className="space-y-1">
        {title}
        {data === undefined
          ? <LoadingBox height={150} label="loading regulatory map…" />
          : <LoadingBox loading={false} label="no regulatory map" height={150} />}
      </div>
      {leftPanel}
    </div>
  );
}

// Distance of a site's midpoint from the gene's 5' end (negative = upstream).
const relTo5 = (start: number, end: number, gene: Gene) => {
  const mid = Math.round((start + end) / 2);
  const five = gene.strand === '+' ? gene.start : gene.end;
  return gene.strand === '+' ? mid - five : five - mid;
};
const nearestRel = (e: Element, gene: Gene) => e.sites.map((s) => relTo5(s.start, s.end, gene)).sort((a, b) => Math.abs(a) - Math.abs(b))[0];

export function RegulatoryMap({ features, context, gene, leftPanel, regulators }: { features: RegulatoryFeature[]; context: RegulatoryContextGene[]; gene: Gene; leftPanel?: ReactNode; regulators?: { name: string; function: string | null }[] | null }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const draggedRef = useRef(false); // true during a drag-pan, so the trailing click doesn't toggle a track
  const [W, setW] = useState(680);
  const [toScale, setToScale] = useState(false); // default: schematic (broken-axis), not to scale
  const [zoom, setZoom] = useState(SCHEMATIC_ZOOM); // horizontal zoom (both modes) → widens the svg + enables pan/scroll
  const [hovered, setHovered] = useState<string | null>(null);
  const [locked, setLocked] = useState<string | null>(null);
  // Reset zoom on mode switch / gene change: to-scale fits the width (1×), schematic opens enlarged.
  useEffect(() => { setZoom(toScale ? 1 : SCHEMATIC_ZOOM); }, [toScale, gene.start]);
  const selected = hovered ?? locked;
  const toggle = (k: string) => { if (draggedRef.current) return; setLocked((cur) => (cur === k ? null : k)); };
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth || 680));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Drag-to-pan the horizontal scroll container (alongside wheel/trackpad scrolling). A move past a
  // few px flags draggedRef so the click that ends the drag doesn't accidentally toggle a track.
  const onPanDown = (e: React.MouseEvent) => {
    const el = scrollRef.current;
    if (!el || el.scrollWidth <= el.clientWidth) return; // nothing to pan
    draggedRef.current = false;
    const startX = e.clientX, startLeft = el.scrollLeft;
    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      if (Math.abs(dx) > 3) { draggedRef.current = true; el.style.cursor = 'grabbing'; }
      el.scrollLeft = startLeft - dx;
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      el.style.cursor = '';
      if (draggedRef.current) setTimeout(() => { draggedRef.current = false; }, 0);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // Collapse features into one element per unique (kind, name) — so a TF with several binding sites
  // is a single track, not duplicated across rows.
  const { promoterEls, siteEls } = useMemo(() => {
    const m = new Map<string, Element>();
    for (const f of features) {
      const key = `${f.kind}:${f.name}`;
      if (!m.has(key)) m.set(key, { key, kind: f.kind, name: f.name, effect: f.effect, sites: [], sigma: f.sigma });
      m.get(key)!.sites.push({ start: f.start, end: f.end, strand: f.strand });
    }
    const els = [...m.values()];
    return { promoterEls: els.filter((e) => e.kind === 'promoter'), siteEls: els.filter((e) => e.kind !== 'promoter') };
  }, [features]);

  const layout = useMemo(() => {
    const M = 12;
    const innerW = Math.max(60, W - 2 * M);
    const flip = gene.strand === '-';

    let xOf: (pos: number) => number;
    let svgW = W;
    if (toScale) {
      // Faithful LINEAR bp scale, anchored on the gene's 5' end + the regulatory features + context
      // genes. `zoom` widens the axis (the svg overflows its scroll container → drag/scroll to pan),
      // so the tiny regulatory region can be inspected.
      const scaledW = innerW * zoom;
      svgW = scaledW + 2 * M;
      const five = gene.strand === '+' ? gene.start : gene.end;
      const positions = [five, ...features.flatMap((f) => [f.start, f.end]), ...context.flatMap((c) => [c.start, c.end])];
      const lo = Math.min(...positions), hi = Math.max(...positions);
      const pad = Math.max(40, Math.round((hi - lo) * 0.05));
      const LO = lo - pad, HI = hi + pad, span = HI - LO || 1;
      xOf = (pos) => M + ((flip ? HI - pos : pos - LO) / span) * scaledW;
    } else {
      // SCHEMATIC broken axis. 1. Keep intervals = each feature footprint + gene boundary (±MARGIN).
      const raw: [number, number][] = [];
      for (const f of features) raw.push([f.start - MARGIN, f.end + MARGIN]);
      for (const g of [gene, ...context]) { raw.push([g.start - MARGIN, g.start + MARGIN]); raw.push([g.end - MARGIN, g.end + MARGIN]); }
      raw.sort((a, b) => a[0] - b[0]);
      // 2. Merge intervals separated by less than COLLAPSE_MIN.
      const keeps: [number, number][] = [];
      for (const iv of raw) {
        const last = keeps[keeps.length - 1];
        if (last && iv[0] - last[1] <= COLLAPSE_MIN) last[1] = Math.max(last[1], iv[1]);
        else keeps.push([iv[0], iv[1]]);
      }
      // 3. Classify gaps: a gene's long interior keeps a compressed body bar (so genes stay longer
      // than the true-scale elements); every other empty stretch collapses to a small fixed GAP_PX.
      const genes = [gene, ...context];
      const covered = (lo: number, hi: number) => genes.some((g) => g.start <= lo && g.end >= hi);
      const gapW = keeps.slice(1).map((iv, i) => {
        const lo = keeps[i][1], hi = iv[0], len = hi - lo;
        return covered(lo, hi) && len > BODY_MIN_BP
          ? Math.min(BODY_MAX, Math.max(BODY_FLOOR, BODY_BASE + BODY_SCALE * Math.sqrt(len)))
          : Math.min(GAP_MAX, Math.max(GAP_MIN, GAP_BASE + GAP_SCALE * Math.sqrt(len)));
      });
      const totalGap = gapW.reduce((a, b) => a + b, 0);
      const keptBp = keeps.reduce((s, iv) => s + (iv[1] - iv[0]), 0) || 1;
      // Auto-fit px/bp, then apply `zoom` as a uniform scale so the schematic can be enlarged + panned.
      const k = Math.min(K_MAX, Math.max(K_MIN, (innerW - totalGap) / keptBp)) * zoom;
      const gaps = gapW.map((g) => g * zoom);
      const contentW = keptBp * k + totalGap * zoom;
      const off = Math.max(0, (innerW - contentW) / 2); // centre when the neighbourhood fits; 0 when it overflows
      svgW = Math.max(W, contentW + 2 * M); // overflow → the scroll container pans
      type Seg = { lo: number; hi: number; x: number; w: number };
      const segs: Seg[] = [];
      let cursor = M + off;
      keeps.forEach((iv, i) => {
        if (i > 0) { segs.push({ lo: keeps[i - 1][1], hi: iv[0], x: cursor, w: gaps[i - 1] }); cursor += gaps[i - 1]; }
        const w = (iv[1] - iv[0]) * k;
        segs.push({ lo: iv[0], hi: iv[1], x: cursor, w }); cursor += w;
      });
      const xLin = (pos: number) => {
        if (!segs.length) return M;
        if (pos <= segs[0].lo) return segs[0].x;
        const last = segs[segs.length - 1];
        if (pos >= last.hi) return last.x + last.w;
        for (const s of segs) if (pos >= s.lo && pos <= s.hi) return s.x + (s.hi > s.lo ? (pos - s.lo) / (s.hi - s.lo) : 0) * s.w;
        return last.x + last.w;
      };
      const mirror = 2 * (M + off) + contentW;
      xOf = (pos: number) => (flip ? mirror - xLin(pos) : xLin(pos));
    }

    // One row per TF, ordered by leftmost binding site.
    const rows = siteEls
      .map((e) => ({ e, minX: Math.min(...e.sites.flatMap((s) => [xOf(s.start), xOf(s.end)])) }))
      .sort((a, b) => a.minX - b.minX)
      .map((o, i) => ({ ...o.e, row: i, minX: o.minX }));
    const nRows = rows.length;

    const yBase = 4 + nRows * ROW_H + 6 + PROMO_RISE;
    // σ-factor boxes sit below the track line at each promoter's x. Close-together promoters would
    // overlap, so pack the boxes into lanes — a colliding box jitters DOWN to the next free lane
    // (a multi-σ promoter occupies consecutive lanes for its vertical stack).
    const SIG_STEP = 11, SIG_BH = 10, SIG_PAD = 2;
    const sigBaseY = yBase + GENE_H / 2 + 2;
    const sigCols = promoterEls.flatMap((e) => {
      const n = (e.sigma ?? []).length;
      if (!n) return [];
      const w = Math.max(...(e.sigma ?? []).map((s) => sigmaLabel(s).length * 5 + 7));
      return e.sites.map((s) => ({ key: `${e.key}|${s.start}`, px: xOf(s.start), w, n }));
    }).sort((a, b) => a.px - b.px);
    const laneRight: number[] = [];
    const sigmaLane = new Map<string, number>();
    let maxLane = 0;
    for (const c of sigCols) {
      const left = c.px - c.w / 2;
      let lane = 0;
      while (Array.from({ length: c.n }, (_, k) => laneRight[lane + k] ?? -Infinity).some((r) => r > left - SIG_PAD)) lane++;
      for (let k = 0; k < c.n; k++) laneRight[lane + k] = c.px + c.w / 2;
      sigmaLane.set(c.key, lane);
      maxLane = Math.max(maxLane, lane + c.n);
    }
    const H = yBase + GENE_H / 2 + 4 + Math.max(12, maxLane * SIG_STEP);
    const tfbsAreaBottom = yBase - PROMO_RISE - 6;
    return { M, xOf, flip, rows, yBase, H, tfbsAreaBottom, svgW, sigmaLane, sigBaseY, sigStep: SIG_STEP, sigBh: SIG_BH };
  }, [W, features, context, gene, siteEls, promoterEls, toScale, zoom]);

  const { M, xOf, flip, rows, yBase, H, tfbsAreaBottom, svgW, sigmaLane, sigBaseY, sigStep, sigBh } = layout;
  const dimOf = (k: string) => (selected !== null && selected !== k ? 0.18 : 1);

  // A gene box (arrow) with its name inside when it fits, else below.
  const GeneBox = ({ g, fill, inText, focal }: { g: { name: string; start: number; end: number; strand: '+' | '-' }; fill: string; inText: string; focal?: boolean }) => {
    const a = xOf(g.start), b = xOf(g.end);
    const xl = Math.min(a, b), xr = Math.max(a, b);
    const pointRight = (g.strand === '+') !== flip;
    const tip = Math.min(8, Math.max(2, xr - xl));
    const pts = pointRight
      ? `${xl},${yBase - GENE_H / 2} ${xr - tip},${yBase - GENE_H / 2} ${xr},${yBase} ${xr - tip},${yBase + GENE_H / 2} ${xl},${yBase + GENE_H / 2}`
      : `${xr},${yBase - GENE_H / 2} ${xl + tip},${yBase - GENE_H / 2} ${xl},${yBase} ${xl + tip},${yBase + GENE_H / 2} ${xr},${yBase + GENE_H / 2}`;
    const vxl = Math.max(xl, M), vxr = Math.min(xr, svgW - M); // visible span (gene may clip at edges)
    const cx = (vxl + vxr) / 2;
    const fits = vxr - vxl > g.name.length * 5.4 + 8;
    return (
      <g>
        <title>{`${g.name} (${g.start}–${g.end}, ${g.strand})`}</title>
        <polygon points={pts} fill={fill} />
        {fits ? (
          <text x={cx} y={yBase} dominantBaseline="central" textAnchor="middle" fontSize={9} fontStyle="italic" fontWeight={focal ? 600 : 400} fill={inText}>{g.name}</text>
        ) : (
          <text x={cx} y={yBase + GENE_H / 2 + 11} textAnchor="middle" fontSize={focal ? 10 : 9} fontStyle="italic" fontWeight={focal ? 600 : 400} fill={focal ? '#262626' : '#94a3b8'}>{g.name}</text>
        )}
      </g>
    );
  };

  const effectsPresent = [...new Set(siteEls.map((s) => s.effect).filter(Boolean))] as string[];
  // Regulators acting on this gene with NO positionally-mapped site (RegulonDB exposes the regulatory
  // link but no binding-site coordinate) → can't be a bar; listed below so the map matches the regulon.
  const fnEffect = (f: string | null) => { const s = (f ?? '').toLowerCase(); return s.includes('dual') ? 'dual' : s.includes('activ') ? 'activator' : s.includes('repress') ? 'repressor' : null; };
  const mappedTF = new Set(siteEls.map((e) => e.name.toLowerCase()));
  const unmapped = (regulators ?? []).filter((r, i, a) => r.name && !mappedTF.has(r.name.toLowerCase()) && a.findIndex((x) => x.name.toLowerCase() === r.name.toLowerCase()) === i);
  const zoomBtn = 'flex h-4 w-4 items-center justify-center rounded hover:bg-neutral-100 hover:text-neutral-800';
  const pannable = svgW > W + 1;

  return (
    <div ref={wrapRef} className="min-w-0 space-y-1.5">
      {/* legend (left) + view controls (right), above the map so neither overlaps the tracks */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-neutral-500">
          <Swatch color={PROMOTER_COLOR} kind="line" /> <span>promoter</span>
          {effectsPresent.includes('activator') && (<><Swatch color={EFFECT_COLOR.activator} /> <span>activator</span></>)}
          {effectsPresent.includes('repressor') && (<><Swatch color={EFFECT_COLOR.repressor} /> <span>repressor</span></>)}
          {effectsPresent.includes('dual') && (<><Swatch color={EFFECT_COLOR.dual} /> <span>dual</span></>)}
          {siteEls.some((s) => !s.effect) && (<><Swatch color={NO_EFFECT} /> <span>TF (effect n/a)</span></>)}
          {context.length > 0 && (<><Swatch color={OPERON_COLOR} /> <span>operon</span> <Swatch color={FLANK_COLOR} /> <span>flanking</span></>)}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <div className="flex items-center gap-0.5 rounded border border-neutral-200 bg-white/90 p-0.5 text-neutral-500">
            <button type="button" title="zoom out" onClick={() => setZoom((z) => Math.max(1, z / 1.5))} className={zoomBtn}>
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><line x1="2.5" y1="6" x2="9.5" y2="6" /></svg>
            </button>
            <button type="button" title="reset zoom" onClick={() => setZoom(toScale ? 1 : SCHEMATIC_ZOOM)} className={zoomBtn}>
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 4V2.4A.4.4 0 0 1 2.4 2H4M8 2h1.6a.4.4 0 0 1 .4.4V4M10 8v1.6a.4.4 0 0 1-.4.4H8M4 10H2.4a.4.4 0 0 1-.4-.4V8" /></svg>
            </button>
            <button type="button" title="zoom in" onClick={() => setZoom((z) => Math.min(30, z * 1.5))} className={zoomBtn}>
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><line x1="6" y1="2.5" x2="6" y2="9.5" /><line x1="2.5" y1="6" x2="9.5" y2="6" /></svg>
            </button>
          </div>
          <div className="flex items-center gap-0.5 rounded border border-neutral-200 bg-white/90 p-0.5 text-[10px]">
            {([['schematic', false], ['to scale', true]] as const).map(([label, val]) => (
              <button key={label} type="button" onClick={() => setToScale(val)}
                className={`rounded px-1.5 py-0.5 ${toScale === val ? 'bg-neutral-800 text-white' : 'text-neutral-500 hover:text-neutral-800'}`}>{label}</button>
            ))}
          </div>
        </div>
      </div>
      {unmapped.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-neutral-500"
          title="these regulators act on this gene, but RegulonDB exposes no binding-site coordinate for them, so they can't be placed on the map">
          <span className="text-neutral-400">binding site not mapped:</span>
          {unmapped.map((r) => (
            <span key={r.name} className="inline-flex items-center gap-1">
              <Swatch color={effColor(fnEffect(r.function))} />
              <span className="font-mono">{r.name}</span>
            </span>
          ))}
        </div>
      )}
      <div className="relative">
        <div ref={scrollRef} onMouseDown={onPanDown} className={`overflow-x-auto pan-scroll ${pannable ? 'cursor-grab' : ''}`}>
      <svg width={svgW} height={H} className="block">
        <line x1={M} y1={yBase} x2={svgW - M} y2={yBase} stroke="#e5e5e5" strokeWidth={1} />

        {/* Context genes */}
        {context.map((c) => (
          <GeneBox key={`c-${c.uniqID}`} g={{ name: c.gene, start: c.start, end: c.end, strand: c.strand }} fill={c.operon ? OPERON_COLOR : FLANK_COLOR} inText={c.operon ? '#fff' : '#475569'} />
        ))}

        {/* TF tracks — one row per TF, binding-site bars at true scale within the kept regions */}
        {rows.map((e) => {
          const boxBottom = tfbsAreaBottom - e.row * ROW_H;
          const hot = selected === e.key;
          return (
            <g key={e.key} className="cursor-pointer" opacity={dimOf(e.key)}
               onMouseEnter={() => setHovered(e.key)} onMouseLeave={() => setHovered(null)} onClick={() => toggle(e.key)}>
              <title>{`${e.name}${e.effect ? ` · ${e.effect}` : ''} · ${e.sites.length} site${e.sites.length > 1 ? 's' : ''}`}</title>
              {e.sites.map((s, i) => {
                const a = xOf(s.start), b = xOf(s.end);
                const xl = Math.min(a, b);
                return <rect key={i} x={xl} y={boxBottom - BOX_H} width={Math.max(MIN_SITE_W, Math.abs(b - a))} height={BOX_H} rx={1.5} fill={effColor(e.effect)} stroke={hot ? '#262626' : 'none'} strokeWidth={hot ? 0.8 : 0} />;
              })}
              <text x={e.minX} y={boxBottom - BOX_H - 2} fontSize={8} fontWeight={hot ? 600 : 400} fill={hot ? '#262626' : '#525252'}>{e.name}</text>
            </g>
          );
        })}

        {/* Promoters — bent transcription-start arrows, with the σ factor in a box just below */}
        {promoterEls.map((e) => {
          const hot = selected === e.key;
          const sig = (e.sigma ?? []).map(sigmaLabel).join('/');
          return (
            <g key={e.key} className="cursor-pointer" opacity={dimOf(e.key)}
               onMouseEnter={() => setHovered(e.key)} onMouseLeave={() => setHovered(null)} onClick={() => toggle(e.key)}>
              <title>{`${e.name || 'promoter'} · TSS ${e.sites.map((s) => s.start).join(', ')}${sig ? ` · ${sig}` : ''}`}</title>
              {e.sites.map((s, i) => {
                const px = xOf(s.start), top = yBase - PROMO_RISE;
                // jittered lane (below the track line) so dense promoters' σ boxes don't overlap
                const by = sigBaseY + (sigmaLane.get(`${e.key}|${s.start}`) ?? 0) * sigStep;
                return (
                  <g key={i}>
                    <path d={`M${px},${yBase} L${px},${top} L${px + 9},${top}`} stroke={PROMOTER_COLOR} strokeWidth={hot ? 2 : 1.4} fill="none" />
                    <path d={`M${px + 6},${top - 3} L${px + 10},${top} L${px + 6},${top + 3}`} fill={PROMOTER_COLOR} />
                    {/* a faint stem from the arrow foot down to the (possibly jittered) box */}
                    {sig && <line x1={px} y1={yBase + GENE_H / 2} x2={px} y2={by} stroke={PROMOTER_COLOR} strokeWidth={0.5} strokeDasharray="1.5 1.5" opacity={0.6} />}
                    {/* one box per σ factor, stacked downward */}
                    {(e.sigma ?? []).map((sg, j) => {
                      const label = sigmaLabel(sg), bw = label.length * 5 + 7, yy = by + j * sigStep;
                      return (
                        <g key={j}>
                          <rect x={px - bw / 2} y={yy} width={bw} height={sigBh} rx={2} fill={SIGMA_FILL} stroke={ACCENT.indigo} strokeWidth={hot ? 1 : 0.7} />
                          <text x={px} y={yy + sigBh / 2 + 0.5} dominantBaseline="central" textAnchor="middle" fontSize={7.5} fontWeight={hot ? 600 : 400} fill={SIGMA_TEXT}>{label}</text>
                        </g>
                      );
                    })}
                  </g>
                );
              })}
            </g>
          );
        })}

        {/* Focal gene (drawn last → on top) */}
        <GeneBox g={gene} fill={GENE_COLOR} inText="#fff" focal />
      </svg>
        </div>
      </div>

      {/* Below the map: the -on field info (left) and the element feature table (right). */}
      <div className="grid grid-cols-1 gap-x-6 gap-y-3 lg:grid-cols-2 lg:items-start">
        <div className="min-w-0">{leftPanel}</div>
        <div className="min-w-0">
          <RegTable elements={[...promoterEls, ...siteEls]} gene={gene} selected={selected} onHover={setHovered} onToggle={toggle} />
        </div>
      </div>
    </div>
  );
}

function Swatch({ color, kind }: { color: string; kind?: 'box' | 'line' }) {
  if (kind === 'line') return <span className="inline-block h-[2px] w-3 align-middle" style={{ background: color }} />;
  return <span className="inline-block h-2.5 w-2.5 rounded-sm align-middle" style={{ background: color }} />;
}

function RegTable({ elements, gene, selected, onHover, onToggle }: { elements: Element[]; gene: Gene; selected: string | null; onHover: (k: string | null) => void; onToggle: (k: string) => void }) {
  const rows = [...elements].sort((a, b) => nearestRel(a, gene) - nearestRel(b, gene));
  return (
    <TableScroller>
      <table className="w-full text-xs">
        <thead className="text-left text-neutral-500">
          <tr>
            <th className="px-2 py-1 font-medium">element</th>
            <th className="px-2 py-1 font-medium">type</th>
            <th className="px-2 py-1 font-medium">effect</th>
            <th className="px-2 py-1 font-medium">rel. to 5′</th>
            <th className="px-2 py-1 font-medium">sites</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => {
            const hot = selected === e.key;
            const dim = selected !== null && !hot;
            const rel = nearestRel(e, gene);
            return (
              <tr key={e.key} onMouseEnter={() => onHover(e.key)} onMouseLeave={() => onHover(null)} onClick={() => onToggle(e.key)}
                  className={`cursor-pointer border-t border-neutral-100 ${hot ? 'bg-neutral-100' : 'hover:bg-neutral-50'}`} style={{ opacity: dim ? 0.5 : 1 }}>
                <td className="px-2 py-1 whitespace-nowrap">
                  <span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm align-middle" style={{ background: e.kind === 'promoter' ? PROMOTER_COLOR : effColor(e.effect) }} />
                  {e.name || (e.kind === 'promoter' ? 'promoter' : '—')}
                </td>
                <td className="px-2 py-1 text-neutral-600">{e.kind === 'tf_binding_site' ? 'TFBS' : e.kind === 'translational_tf_binding_site' ? 'transl. TFBS' : e.kind}</td>
                <td className="px-2 py-1 text-neutral-600">{e.effect ?? '—'}</td>
                <td className="px-2 py-1 font-mono text-neutral-500">{rel > 0 ? `+${rel}` : rel}</td>
                <td className="px-2 py-1 font-mono text-neutral-500" title={e.sites.map((s) => `${s.start}–${s.end}`).join(', ')}>{e.sites.length}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </TableScroller>
  );
}
