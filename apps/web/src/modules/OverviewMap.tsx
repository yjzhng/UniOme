import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { OverviewMap as OvData, OverviewRef } from '@uniome/shared';
import { LoadingBox } from '../components/Fields';
import { ViewControls } from './ViewControls';
import { MAP_H, clamp } from './PathwayMap';

// The whole-organism metabolic overview (KEGG eco011xx global maps): enzymes are POLYLINES, metabolites
// are dots, drawn over the entire metabolic network. The focal gene's reactions are located (bold) and
// the genes that share a PATHWAY / FUNCTION with it are painted on (this view lives under the "Cellular
// functions" tab, so the relevant relationship is functional, not physical/homology). Map family selectable.
const PREFER = ['eco01100', 'eco01120', 'eco01110']; // default to the broadest map that holds the gene

// One unified map: the whole metabolic network, clean by default. Click the current gene or a category
// label to LOCK that gene set into focus (and zoom to it); zoom in on a locked set to reveal the details
// (gene boxes on the edges, metabolite labels, reaction arrows). No fragile box-map edge guessing.
export function PathwaySection({ focalId, chrom, geneSet }: { focalId: string; chrom: string; geneSet: Set<string> }) {
  return <OverviewMap focalId={focalId} chrom={chrom} geneSet={geneSet} />;
}

// `geneSet` = the related genes to highlight (the active relationship facet's gene set); the map locates
// the focal gene + this set. A gene that's not on the metabolic map shows a placeholder.
export function OverviewMap({ focalId, chrom, geneSet }: { focalId: string; chrom: string; geneSet: Set<string> }) {
  const { taxid } = useParams<{ taxid: string }>();
  const navigate = useNavigate();
  const [meta, setMeta] = useState<{ maps: OverviewRef[]; on: string[] } | null | undefined>(undefined);
  const [pid, setPid] = useState<string | null>(null);
  const [map, setMap] = useState<OvData | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    setMeta(undefined); setPid(null); setMap(undefined);
    fetch(`/api/organism/${taxid}/features/${encodeURIComponent(focalId)}/overviews`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { maps: OverviewRef[]; on: string[] } | null) => {
        if (cancelled) return;
        setMeta(d);
        if (!d || !d.maps.length) return;
        // default to the broadest overview that actually contains the focal gene, else the first map
        const def = PREFER.find((p) => d.on.includes(p)) ?? d.on[0] ?? d.maps[0].id;
        setPid(def);
      })
      .catch(() => !cancelled && setMeta(null));
    return () => { cancelled = true; };
  }, [taxid, focalId]);

  useEffect(() => {
    if (!pid) return;
    let cancelled = false;
    setMap(undefined);
    fetch(`/api/organism/${taxid}/pathway-overview/${pid}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => !cancelled && setMap(d))
      .catch(() => !cancelled && setMap(null));
    return () => { cancelled = true; };
  }, [taxid, pid]);

  if (meta === null || (meta && meta.maps.length === 0)) return <LoadingBox loading={false} label="no overview map" height={MAP_H} />;
  // the focal gene isn't a metabolic enzyme (absent from every overview) — nothing to locate, show a placeholder
  if (meta && meta.on.length === 0) return <LoadingBox loading={false} label="this gene is not on the metabolic pathway map" height={MAP_H} />;

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        {(meta?.maps.length ?? 0) > 1
          ? <select value={pid ?? ''} onChange={(e) => setPid(e.target.value)} className="max-w-full rounded border border-neutral-300 bg-white px-1.5 py-0.5 text-xs">
              {meta?.maps.map((m) => <option key={m.id} value={m.id}>{m.name}{meta.on.includes(m.id) ? '' : ' — gene absent'}</option>)}
            </select>
          : <span className="text-xs font-medium text-neutral-600">{meta?.maps[0]?.name}</span>}
        <span className="text-[10px] text-neutral-500">click the gene name or a pathway label to focus it · zoom in on a focused set for details · click empty space to clear</span>
      </div>
      {meta === undefined || map === undefined ? <LoadingBox height={MAP_H} label="loading overview…" />
        : map === null ? <LoadingBox loading={false} label="no overview map" height={MAP_H} />
        : <OverviewCanvas map={map} located={meta?.on.includes(pid ?? '') ?? false} focalId={focalId} related={geneSet} onGene={(id) => navigate(`/o/${taxid}/c/${encodeURIComponent(chrom)}/entry/${id}`)} />}
    </div>
  );
}

// The organism-level Pathways browser's map: the SAME whole-organism metabolic overview canvas as the
// entry page, but with no single focal gene — `related` is the taxonomy-tree-selected pathway's gene set,
// shown as the permanently-focused selection (`autoFocusRelated`). Selecting a pathway lights its enzymes
// + territory on the global map; zoom in for gene boxes / metabolite names; click an enzyme to open it.
export function PathwayOverview({ overviewId, chrom, related, onClear, title, titleColor, onCategory }: { overviewId: string | null; chrom: string; related: Set<string>; onClear?: () => void; title?: string | null; titleColor?: string | null; onCategory?: (label: string) => void }) {
  const { taxid } = useParams<{ taxid: string }>();
  const navigate = useNavigate();
  const [map, setMap] = useState<OvData | null | undefined>(undefined);

  useEffect(() => {
    if (!overviewId) { setMap(undefined); return; }
    let cancelled = false;
    setMap(undefined);
    fetch(`/api/organism/${taxid}/pathway-overview/${overviewId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => !cancelled && setMap(d))
      .catch(() => !cancelled && setMap(null));
    return () => { cancelled = true; };
  }, [taxid, overviewId]);

  if (!overviewId || map === undefined) return <LoadingBox height={MAP_H} label="loading metabolic map…" />;
  if (map === null) return <LoadingBox loading={false} label="no metabolic map" height={MAP_H} />;
  return <OverviewCanvas map={map} located focalId="" related={related} autoFocusRelated onClear={onClear} title={title} titleColor={titleColor} onCategory={onCategory} onGene={(id) => navigate(`/o/${taxid}/c/${encodeURIComponent(chrom)}/entry/${id}`)} />;
}

type GeneSet = { kind: 'focal' } | { kind: 'cat'; color: string; name: string };
const FOCAL_SET: GeneSet = { kind: 'focal' }; // stable identity so memoised layers don't churn when pinned

// `autoFocusRelated` (home Pathways browser): there's no single focal gene, so the passed-in `related`
// set (the tree-selected pathway's genes) is treated as a PERMANENTLY-focused selection — lit + territory
// by default, revealed in detail on zoom — reusing the exact same focal-set rendering as the entry page.
function OverviewCanvas({ map, located, focalId, related, onGene, autoFocusRelated = false, onClear, title, titleColor, onCategory }: { map: OvData; located: boolean; focalId: string; related: Set<string>; onGene: (id: string) => void; autoFocusRelated?: boolean; onClear?: () => void; title?: string | null; titleColor?: string | null; onCategory?: (label: string) => void }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [W, setW] = useState(700);
  const H = MAP_H;
  // A SELECTION is a gene set — either the current gene (+ its shared-pathway/function genes) or a whole
  // metabolism category. Both are highlighted the SAME way (edges + territory); only the gene set differs.
  // `hover` previews transiently; `locked` persists (set by click, cleared by clicking empty). `active`
  // is whichever applies — locked wins, else the hover preview.
  const [locked, setLocked] = useState<GeneSet | null>(null);
  const [hover, setHover] = useState<GeneSet | null>(null);
  const active = locked ?? hover ?? (autoFocusRelated ? FOCAL_SET : null);
  // whether to show the zoom DETAIL (gene boxes, metabolite names): a locked selection, or — in the home
  // browser — the pinned related set. Hover only previews edges + territory, never the labelled detail.
  const showDetail = !!locked || autoFocusRelated;
  const hi = useMemo(() => { // focal + shared-pathway/function edges (focal drawn last → on top, wins node ties)
    const out: { line: typeof map.genes[number]; focal: boolean; target: string }[] = [];
    for (const g of map.genes) {
      let focal = false, rel = false, target = '';
      for (const ref of g.genes) {
        if (ref.uniqID === focalId) { focal = true; target = ref.uniqID; }
        else if (related.has(ref.uniqID)) { rel = true; if (!target) target = ref.uniqID; }
      }
      if (focal || rel) out.push({ line: g, focal, target });
    }
    return out.sort((a, b) => (a.focal ? 1 : 0) - (b.focal ? 1 : 0));
  }, [map, related, focalId]);
  // the active set's coloured edges. Default (no selection) = just the focal gene's locator edge.
  const litLines = useMemo(() => {
    const focalLines = hi.filter((h) => h.focal);
    if (active?.kind === 'cat') {
      // ALL member lines of the category (annotation membership), not just the dominant-category territory
      const name = active.name;
      const extra = map.genes.filter((g) => g.cats?.includes(name) && !g.genes.some((x) => x.uniqID === focalId)).map((g) => ({ line: g, focal: false, target: g.genes[0]?.uniqID ?? '' }));
      return [...extra, ...focalLines];
    }
    return active?.kind === 'focal' ? hi : focalLines;
  }, [active, hi, map, focalId]);
  // the active set's TERRITORY (octilinear, rounded loops + colour) — a category uses its prebuilt outline;
  // the current gene gets one computed the SAME way (convex hull → octilinear) so they render identically.
  const territory = useMemo(() => {
    if (active?.kind === 'cat') return { loops: map.territory.filter((t) => t.color === active.color).flatMap((t) => t.loops), color: active.color };
    if (active?.kind === 'focal') { const loops = coreLoops(hi.map((x) => x.line.pts), map.bounds.w, map.bounds.h); if (loops.length) return { loops, color: '#64748b' }; }
    return null;
  }, [active, map, hi]);
  const fit = useMemo(() => {
    const k = clamp(Math.min(W / map.bounds.w, H / map.bounds.h), 0.05, 3);
    return { k, tx: (W - map.bounds.w * k) / 2, ty: (H - map.bounds.h * k) / 2 };
  }, [W, map.bounds.w, map.bounds.h]);
  const [view, setView] = useState<{ k: number; tx: number; ty: number } | null>(null);
  const v = view ?? fit;
  const viewRef = useRef(v); viewRef.current = v;
  const drag = useRef({ on: false, x: 0, y: 0, moved: false });
  const [grab, setGrab] = useState(false);

  useEffect(() => {
    const el = wrapRef.current; if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth || 700));
    ro.observe(el); return () => ro.disconnect();
  }, []);
  useEffect(() => { setView(null); setLocked(null); }, [map.id]);
  useEffect(() => {
    const el = svgRef.current; if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
      const cur = viewRef.current;
      const k = clamp(cur.k * Math.exp(-e.deltaY * 0.0015), 0.05, 12);
      setView({ k, tx: sx - ((sx - cur.tx) / cur.k) * k, ty: sy - ((sy - cur.ty) / cur.k) * k });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);
  const onDown = (e: ReactMouseEvent) => { if (!view) setView(viewRef.current); drag.current = { on: true, x: e.clientX, y: e.clientY, moved: false }; setGrab(true); };
  const onMove = (e: ReactMouseEvent) => {
    if (!drag.current.on) return;
    const cur = viewRef.current;
    setView({ k: cur.k, tx: cur.tx + (e.clientX - drag.current.x), ty: cur.ty + (e.clientY - drag.current.y) });
    drag.current.x = e.clientX; drag.current.y = e.clientY; drag.current.moved = true;
  };
  const onUp = () => { drag.current.on = false; setGrab(false); };
  const zoomBy = (f: number) => {
    const cur = viewRef.current, cx = W / 2, cy = H / 2;
    const k = clamp(cur.k * f, 0.05, 12);
    setView({ k, tx: cx - ((cx - cur.tx) / cur.k) * k, ty: cy - ((cy - cur.ty) / cur.k) * k });
  };
  // toggle a set's selection (clicking the active one again deselects); no autozoom, and clear the
  // transient hover so it can't get stuck on
  const lockFocal = () => { setLocked((l) => (l?.kind === 'focal' ? null : { kind: 'focal' })); setHover(null); };
  const lockCat = (color: string, name: string) => { setLocked((l) => (l?.kind === 'cat' && l.color === color ? null : { kind: 'cat', color, name })); setHover(null); };

  const poly = (pts: [number, number][]) => pts.map((p) => p.join(',')).join(' ');
  // The map coordinate space is huge (~5000 units) vs the ~700px viewport, so strokes/fonts sized in map
  // units render sub-pixel at fit zoom. `non-scaling-stroke` keeps line widths constant in SCREEN px
  // (so the network stays legible AND the base can stay memoised — no k dependency); text + node markers
  // are counter-scaled by 1/k instead. The whole network is ~5k nodes, memoised so pan/zoom stays smooth.
  // the active set's territory — ONE renderer for both the current gene and a category (same octilinear
  // rounded outline), so they look and behave identically. Hidden when nothing is selected.
  const cornerR = Math.min(map.bounds.w, map.bounds.h) * 0.02; // corner-fillet radius in map units
  const territoryLayer = useMemo(() => territory && (
    <g pointerEvents="none">
      {territory.loops.map((loop, i) => (
        <path key={i} d={roundedPath(loop, cornerR)} fillRule="evenodd"
          fill={territory.color} fillOpacity={0.18} stroke={darken(territory.color, 0.78)} strokeOpacity={0.75} strokeWidth={2.4}
          strokeLinejoin="round" style={{ vectorEffect: 'non-scaling-stroke' }} />
      ))}
    </g>
  ), [territory, cornerR]);
  // Base network is GREY by default (neutral classes flip in dark mode); category colour only appears
  // category colour appears only on the active set's edges, so the default view is a calm grey map.
  const baseLines = useMemo(() => (
    <>{map.genes.map((g) => (
      <polyline key={g.id} points={poly(g.pts)} fill="none" className="stroke-neutral-300" strokeWidth={1.1} opacity={0.9} strokeLinecap="round"
        style={{ vectorEffect: 'non-scaling-stroke' }} pointerEvents="none" />
    ))}</>
  ), [map]);
  // metabolite NODES (genes are the edges). Radius is capped in SCREEN px so the dots don't balloon when
  // zoomed in; depends on v.k but only re-renders on zoom (pan keeps k constant → memo skipped).
  const baseDots = useMemo(() => {
    const r = Math.min(5.5, 6 / v.k);
    return <>{map.compounds.map((c) => <circle key={c.id} cx={c.x} cy={c.y} r={r} className="fill-neutral-400" pointerEvents="none" />)}</>;
  }, [map, v.k]);
  // metabolite NODES that a related gene's edge connects (substrate/product compound ids from the KGML
  // reaction — exact, no geometry) → drawn bigger + in that pathway's colour. Focal wins ties (`hi` is
  // ordered focal-last, so its assignment overwrites).
  // metabolite NODES the locked set's edges connect → coloured. Nothing coloured when nothing is locked.
  const touched = useMemo(() => {
    const m = new Map<string, string>();
    if (!showDetail) return m; // metabolite nodes/labels are a focused-set detail; hover only previews edges + territory
    for (const { line } of litLines) for (const cid of line.nodes) m.set(cid, line.color);
    return m;
  }, [showDetail, litLines]);
  const touchedNodes = useMemo(() => {
    const r = Math.min(8, 9 / v.k); // capped on-screen size
    return (
      <g pointerEvents="none">
        {map.compounds.filter((c) => touched.has(c.id)).map((c) => (
          <circle key={c.id} cx={c.x} cy={c.y} r={r} fill={touched.get(c.id)} stroke={darken(touched.get(c.id)!, 0.7)} strokeWidth={0.8} style={{ vectorEffect: 'non-scaling-stroke' }} />
        ))}
      </g>
    );
  }, [map, touched, v.k]);
  // in the zoom (detail) view, label the metabolites the pathway touches (real KEGG names, counter-scaled)
  const cpdById = useMemo(() => new Map(map.compounds.map((c) => [c.id, c])), [map]);
  // the point HALF-WAY ALONG the edge (by arc length) — not pts[n/2], which for a 2-point edge is the
  // endpoint (a metabolite node), landing the gene box on top of it instead of mid-line.
  const midOf = (line: { pts: [number, number][] }): [number, number] => {
    const pts = line.pts;
    if (pts.length < 2) return pts[0] ?? [0, 0];
    const seg = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]));
    let half = seg.reduce((a, b) => a + b, 0) / 2;
    for (let i = 0; i < seg.length; i++) {
      if (half <= seg[i]) { const t = seg[i] ? half / seg[i] : 0; return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t]; }
      half -= seg[i];
    }
    return pts[pts.length - 1];
  };
  // orient an edge so its PRODUCT end is last (for the arrowhead), using the reaction's product compounds
  const orientedPts = (line: OvData['genes'][number]): [number, number][] => {
    if (line.pts.length < 2 || !line.prods.length) return line.pts;
    const prods = line.prods.map((id) => cpdById.get(id)).filter(Boolean) as { x: number; y: number }[];
    if (!prods.length) return line.pts;
    const d = (p: [number, number]) => Math.min(...prods.map((q) => Math.hypot(p[0] - q.x, p[1] - q.y)));
    return d(line.pts[line.pts.length - 1]) <= d(line.pts[0]) ? line.pts : [...line.pts].reverse();
  };
  const wrapLabel = (s: string, max: number) => {
    const out: string[] = []; let cur = '';
    for (let word of s.split(' ')) {
      while (word.length > max) { if (cur) { out.push(cur); cur = ''; } out.push(word.slice(0, max - 1) + '-'); word = word.slice(max - 1); }
      if (!cur) cur = word; else if ((cur + ' ' + word).length <= max) cur += ' ' + word; else { out.push(cur); cur = word; }
    }
    if (cur) out.push(cur);
    return out;
  };
  // DENSITY-dependent details: on a locked set, show each gene box / metabolite label only if its on-screen
  // box doesn't clash with an already-placed one (greedy, focal + gene boxes first). Labels are constant
  // SCREEN size while positions scale with zoom, so zooming in frees room → more labels appear; zooming out
  // → fewer. Clash depends only on k (not pan), so this re-runs on zoom, not on drag.
  const labelVis = useMemo(() => {
    const vis = new Set<string>();
    if (!showDetail) return vis;
    const k = v.k, pad = 3;
    type C = { id: string; focal: boolean; x: number; y: number; w: number; h: number };
    const boxC: C[] = litLines.map(({ line, focal }) => { const m = midOf(line), name = line.genes[0]?.gene ?? line.label; return { id: `b${line.id}`, focal, x: m[0] * k, y: m[1] * k, w: name.length * 5.4 + 8, h: 14 }; });
    const cpdC: C[] = [];
    for (const cid of touched.keys()) { const c = cpdById.get(cid); if (!c) continue; const ls = wrapLabel(c.label, 16); cpdC.push({ id: `c${cid}`, focal: false, x: c.x * k, y: c.y * k + 13 + ls.length * 5, w: Math.max(...ls.map((l) => l.length)) * 5.4, h: ls.length * 10 }); }
    const placed: { x: number; y: number; w: number; h: number }[] = [];
    for (const c of [...boxC.sort((a, b) => (b.focal ? 1 : 0) - (a.focal ? 1 : 0)), ...cpdC]) {
      const b = { x: c.x - c.w / 2 - pad, y: c.y - c.h / 2 - pad, w: c.w + 2 * pad, h: c.h + 2 * pad };
      if (placed.some((p) => !(b.x + b.w < p.x || p.x + p.w < b.x || b.y + b.h < p.y || p.y + p.h < b.y))) continue;
      placed.push(b); vis.add(c.id);
    }
    return vis;
  }, [showDetail, litLines, touched, v.k, cpdById]);

  // Category colours the current selection touches (a selected pathway's genes belong to categories the
  // overview colours by): their territory labels fade the same way a clicked-to-focus category's label
  // does, so they don't sit on top of the highlighted detail.
  const selectedCatColors = useMemo(() => {
    const s = new Set<string>();
    if (!autoFocusRelated || !related.size) return s;
    for (const g of map.genes) if (!s.has(g.color) && g.genes.some((x) => related.has(x.uniqID))) s.add(g.color);
    return s;
  }, [map, related, autoFocusRelated]);

  return (
    <div ref={wrapRef} className="relative min-w-0">
      <ViewControls onZoomIn={() => zoomBy(1.3)} onZoomOut={() => zoomBy(1 / 1.3)} onReset={() => setView(null)} />
      {/* the selected pathway's full name, floating at the top-centre of the map — tinted to match its
          sunburst wedge colour (contrast text chosen from the fill's luminance) */}
      {title && (
        <div className="pointer-events-none absolute inset-x-0 top-2 z-10 flex justify-center px-12">
          <span className={`max-w-full truncate rounded-full border px-3 py-1 text-xs font-medium shadow-sm ${titleColor ? '' : 'border-neutral-200 bg-white/90 text-neutral-700'}`}
            style={titleColor ? { backgroundColor: titleColor, color: textOn(titleColor), borderColor: darken(titleColor, 0.85) } : undefined}>{title}</span>
        </div>
      )}
      <svg ref={svgRef} width={W} height={H} className="block select-none rounded border border-neutral-200 bg-white" style={{ cursor: grab ? 'grabbing' : 'grab' }}
        onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onUp}
        onClick={() => { if (!drag.current.moved) { setLocked(null); onClear?.(); } }}>
        <g transform={`translate(${v.tx},${v.ty}) scale(${v.k})`}>
          {/* the active set's territory (current gene OR category — same renderer), behind everything */}
          {territoryLayer}
          {/* the grey base network */}
          {baseLines}
          {baseDots}
          {/* the active set's edges, coloured by pathway. Default = just the focal gene's edge (dark/thick),
              clicking it focuses its set; clicking a neighbour edge opens that gene. */}
          {litLines.map(({ line, focal, target }) => (
            <g key={`hi-${line.id}`} style={{ cursor: 'pointer' }}
              onMouseEnter={focal ? () => setHover({ kind: 'focal' }) : undefined} onMouseLeave={focal ? () => setHover(null) : undefined}
              onClick={(e) => { e.stopPropagation(); if (drag.current.moved) return; focal ? lockFocal() : onGene(target); }}>
              <title>{`${line.genes.map((x) => x.gene).join(', ') || line.label}${focal ? ' (this gene — click to focus)' : ''}${line.reaction ? ` · ${line.reaction}` : ''}`}</title>
              <polyline points={poly(line.pts)} fill="none" stroke={line.color} strokeWidth={focal ? 6 : 1.8} strokeLinecap="round" style={{ vectorEffect: 'non-scaling-stroke' }} />
            </g>
          ))}
          {/* metabolite nodes touched by those edges — bigger + pathway-coloured, on top of the edges */}
          {touchedNodes}
          {/* arrowheads at the PRODUCT end of irreversible reactions (direction from the KGML) — drawn AFTER
              the nodes and pulled back to the node's edge, so they're not hidden under the dot. Zoom-gated. */}
          {litLines.filter((h) => labelVis.has(`b${h.line.id}`) && !h.line.reversible).map(({ line, focal }) => {
            const op = orientedPts(line); if (op.length < 2) return null;
            const end = op[op.length - 1], prev = op[op.length - 2];
            const dx = end[0] - prev[0], dy = end[1] - prev[1], L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L;
            const gap = 9, s = 9 / v.k, w = 4.5 / v.k; // pull the tip back past the node radius (~7u)
            const tx = end[0] - ux * gap, ty = end[1] - uy * gap;
            return <path key={`ar-${line.id}`} d={`M${tx},${ty}L${tx - ux * s - uy * w},${ty - uy * s + ux * w}L${tx - ux * s + uy * w},${ty - uy * s - ux * w}Z`}
              fill={line.color} pointerEvents="none" />;
          })}
          {/* density-gated: name the locked set's metabolites (wrapped, counter-scaled) when there's room */}
          {[...touched.keys()].filter((cid) => labelVis.has(`c${cid}`)).map((cid) => { const c = cpdById.get(cid); if (!c) return null;
            const lines = wrapLabel(c.label, 16), fs = 9 / v.k, lh = 10 / v.k;
            return (
              <g key={`cl-${cid}`} pointerEvents="none">
                {lines.map((ln, li) => (
                  <text key={li} x={c.x} y={c.y + 13 / v.k + li * lh} textAnchor="middle" fontSize={fs} fontWeight={500}
                    className="fill-neutral-700 stroke-white" strokeWidth={2.6 / v.k} paintOrder="stroke">{ln}</text>
                ))}
              </g>
            );
          })}
          {/* zoom-gated: the gene name in a BOX sitting ON its reaction edge (KEGG-style). Focal box dark,
              shared-pathway genes outlined in their pathway colour. */}
          {litLines.filter((h) => labelVis.has(`b${h.line.id}`)).map(({ line, focal, target }) => {
            const m = midOf(line), name = line.genes[0]?.gene ?? line.label;
            const bw = (name.length * 5.4 + 8) / v.k, bh = 14 / v.k, fs = 8.5 / v.k;
            return (
              <g key={`gb-${line.id}`} style={{ cursor: 'pointer' }}
                onClick={(e) => { e.stopPropagation(); if (drag.current.moved) return; focal ? lockFocal() : onGene(target); }}>
                <rect x={m[0] - bw / 2} y={m[1] - bh / 2} width={bw} height={bh} rx={2.5 / v.k}
                  className={focal ? 'fill-neutral-900' : 'fill-white'} stroke={focal ? 'none' : line.color} strokeWidth={1.3 / v.k} />
                <text x={m[0]} y={m[1] + fs * 0.34} textAnchor="middle" fontSize={fs} fontWeight={700}
                  className={focal ? 'fill-white' : 'fill-neutral-800'} pointerEvents="none">{name}</text>
              </g>
            );
          })}
          {/* category labels — drawn ON TOP so their (always-present) hit-rect reliably catches hover/click.
              Only the LOCKED category's own label fades (to 30% opacity) so it doesn't hide its focused
              detail underneath; every other label stays fully visible. Map-anchored; hidden once big. */}
          {map.regions.filter((rg) => rg.fs * v.k <= 52).map((rg, i) => {
            const on = active?.kind === 'cat' && active.color === rg.color;
            // fade when this category is clicked-to-focus (locked) OR the current selection overlaps it
            const sel = (locked?.kind === 'cat' && locked.color === rg.color) || selectedCatColors.has(rg.color);
            const lh = rg.fs * 1.12;
            const y0 = rg.cy - ((rg.lines.length - 1) * lh) / 2;
            const w = Math.max(...rg.lines.map((l) => l.length)) * rg.fs * 0.6;
            return (
              <g key={`rgl-${i}`} style={{ cursor: 'pointer' }} onMouseEnter={() => setHover({ kind: 'cat', color: rg.color, name: rg.label })} onMouseLeave={() => setHover(null)}
                 onClick={(e) => { e.stopPropagation(); if (drag.current.moved) return; onCategory ? onCategory(rg.label) : lockCat(rg.color, rg.label); }}>
                <rect x={rg.cx - w / 2} y={y0 - rg.fs} width={w} height={rg.lines.length * lh + rg.fs} fill="transparent" />
                {rg.lines.map((ln, li) => (
                  // In the home Pathways browser the sunburst colours pathways by SECTION (all metabolism =
                  // one hue), so the map's per-category label colours would contradict it — render them
                  // neutral grey there. On the entry page (no sunburst) keep the category-coloured labels.
                  // grey in the home browser, but restore the category's own colour while it's hovered (`on`)
                  <text key={li} x={rg.cx} y={y0 + li * lh} textAnchor="middle" dominantBaseline="middle"
                    fontSize={rg.fs} fontWeight={on ? 800 : 700} fill={autoFocusRelated && !on ? undefined : rg.color} opacity={sel ? 0.3 : undefined}
                    className={`stroke-white ${autoFocusRelated && !on ? 'fill-neutral-500' : ''}`} strokeWidth={rg.fs * 0.28} paintOrder="stroke">{ln}</text>
                ))}
              </g>
            );
          })}
          {/* the current gene's name BESIDE its edge so it's findable on the whole map — click to focus its
              set. (Once focused, the on-edge gene boxes above take over.) */}
          {!locked && (() => {
            const seen = new Set<string>();
            return hi.filter((h) => h.focal).filter(({ line }) => { const g = line.genes[0]?.gene ?? line.label; if (seen.has(g)) return false; seen.add(g); return true; }).map(({ line }) => {
              const pts = line.pts, mi = Math.floor(pts.length / 2), m = midOf(line);
              const a = pts[Math.max(0, mi - 1)], bb = pts[Math.min(pts.length - 1, mi + 1)];
              const dx = bb[0] - a[0], dy = bb[1] - a[1], L = Math.hypot(dx, dy) || 1, off = 16 / v.k, fs = 13 / v.k;
              const name = line.genes[0]?.gene ?? line.label, lx = m[0] + (-dy / L) * off, ly = m[1] + (dx / L) * off, hw = (name.length * 5 + 10) / v.k;
              return (
                <g key={`lbl-${line.id}`} style={{ cursor: 'pointer' }} onMouseEnter={() => setHover({ kind: 'focal' })} onMouseLeave={() => setHover(null)}
                  onClick={(e) => { e.stopPropagation(); if (!drag.current.moved) lockFocal(); }}>
                  <rect x={lx - hw / 2} y={ly - 10 / v.k} width={hw} height={20 / v.k} fill="transparent" />
                  <text x={lx} y={ly} textAnchor="middle" dominantBaseline="middle" fontSize={fs} fontWeight={800}
                    className="fill-neutral-900 stroke-white" strokeWidth={3.5 / v.k} paintOrder="stroke" pointerEvents="none">{name}</text>
                </g>
              );
            });
          })()}
        </g>
      </svg>
      <div className="mt-0.5 text-[10px] text-neutral-400">
        {map.genes.length} enzyme reactions · {map.compounds.length} metabolites ·
        {autoFocusRelated ? (related.size ? ' the selected pathway is highlighted' : ' select a pathway to highlight it') : located ? ' click the gene name to focus it' : ' this gene is not on the metabolic map'} · click a pathway label to focus that category · zoom in on a focused set for gene boxes, metabolite names + reaction arrows · scroll to zoom, drag to pan{autoFocusRelated ? ' · click empty space to clear' : ''}
      </div>
    </div>
  );
}

// darken a #rrggbb toward black so a pale territory hue stays legible as label text (hue preserved)
const darken = (hex: string, f = 0.62) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${Math.round(((n >> 16) & 255) * f)},${Math.round(((n >> 8) & 255) * f)},${Math.round((n & 255) * f)})`;
};
// black or white, whichever reads better on a given #rrggbb fill (relative luminance)
const textOn = (hex: string) => {
  const n = parseInt(hex.slice(1), 16), r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.6 ? '#1f2937' : '#ffffff';
};

// ── focal-set territory: the SAME dense-core grid pipeline the build uses for category territories, so
// the current gene's region hugs where its edges are DENSE (excluding orphan lines) instead of a greedy
// convex hull. Rasterise edges → grid cells → close small gaps → trace octilinear boundary loops. ──
const ringArea = (pts: [number, number][]) => { let a = 0; for (let i = 0; i + 1 < pts.length; i++) a += pts[i][0] * pts[i + 1][1] - pts[i + 1][0] * pts[i][1]; return a / 2; };
const perpDist = (p: number[], a: number[], b: number[]) => { const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy); return L === 0 ? Math.hypot(p[0] - a[0], p[1] - a[1]) : Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / L; };
function rdp(points: [number, number][], eps: number): [number, number][] {
  if (points.length < 3) return points;
  const a = points[0], b = points[points.length - 1]; let dmax = -1, idx = 0;
  for (let i = 1; i < points.length - 1; i++) { const d = perpDist(points[i], a, b); if (d > dmax) { dmax = d; idx = i; } }
  return dmax > eps ? rdp(points.slice(0, idx + 1), eps).slice(0, -1).concat(rdp(points.slice(idx), eps)) : [a, b];
}
function simplifyLoop(loop: [number, number][], eps: number): [number, number][] {
  const pts = loop.slice(0, -1); if (pts.length < 5) return loop;
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  let ia = 0, da = -1; pts.forEach((p, i) => { const d = Math.hypot(p[0] - cx, p[1] - cy); if (d > da) { da = d; ia = i; } });
  let ib = 0, db = -1; pts.forEach((p, i) => { const d = Math.hypot(p[0] - pts[ia][0], p[1] - pts[ia][1]); if (d > db) { db = d; ib = i; } });
  if (ia > ib) [ia, ib] = [ib, ia];
  const s1 = rdp(pts.slice(ia, ib + 1), eps), s2 = rdp(pts.slice(ib).concat(pts.slice(0, ia + 1)), eps);
  const out = s1.slice(0, -1).concat(s2.slice(0, -1)); if (out.length < 3) return loop; out.push(out[0]); return out;
}
function mergeCollinear(loop: [number, number][]): [number, number][] {
  const pts = loop.slice(0, -1), n = pts.length; if (n < 3) return loop;
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) { const a = pts[(i - 1 + n) % n], b = pts[i], c = pts[(i + 1) % n]; if ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) !== 0) out.push(b); }
  if (out.length < 3) return loop; out.push(out[0]); return out;
}
function traceLoops(isIn: (r: number, c: number) => boolean, rows: number, cols: number): [number, number][][] {
  const E: { ax: number; ay: number; bx: number; by: number; used: boolean }[] = [], byStart = new Map<string, number[]>();
  const add = (ax: number, ay: number, bx: number, by: number) => { const i = E.length; E.push({ ax, ay, bx, by, used: false }); const k = ax + ',' + ay; (byStart.get(k) ?? byStart.set(k, []).get(k)!).push(i); };
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if (!isIn(r, c)) continue;
    if (!isIn(r - 1, c)) add(c + 1, r, c, r);
    if (!isIn(r + 1, c)) add(c, r + 1, c + 1, r + 1);
    if (!isIn(r, c - 1)) add(c, r, c, r + 1);
    if (!isIn(r, c + 1)) add(c + 1, r + 1, c + 1, r);
  }
  const loops: [number, number][][] = [];
  for (let i = 0; i < E.length; i++) {
    if (E[i].used) continue;
    const loop: [number, number][] = []; let cur = i;
    while (cur !== -1 && !E[cur].used) { const e = E[cur]; e.used = true; loop.push([e.ax, e.ay]); const cand = (byStart.get(e.bx + ',' + e.by) || []).find((j) => !E[j].used); cur = cand === undefined ? -1 : cand; }
    if (loop.length >= 4) { loop.push(loop[0]); loops.push(loop); }
  }
  return loops;
}
// dense-core octilinear loops for a set of polylines (map coords), matching the category-territory style
function coreLoops(lines: [number, number][][], boundsW: number, boundsH: number): [number, number][][] {
  const CELL = Math.max(boundsW, boundsH) / 44, cols = Math.ceil(boundsW / CELL), rows = Math.ceil(boundsH / CELL);
  const at = (r: number, c: number) => r * cols + c, grid = new Uint8Array(rows * cols);
  for (const pts of lines) for (let i = 0; i + 1 < pts.length; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[i + 1], steps = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / CELL));
    for (let s = 0; s <= steps; s++) { const c = Math.floor((x1 + (x2 - x1) * (s / steps)) / CELL), r = Math.floor((y1 + (y2 - y1) * (s / steps)) / CELL); if (r >= 0 && c >= 0 && r < rows && c < cols) grid[at(r, c)] = 1; }
  }
  for (let pass = 0; pass < 2; pass++) { // close small gaps so the core is contiguous (orphans stay out)
    const ng = grid.slice();
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      if (grid[at(r, c)]) continue; let n = 0;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) { const rr = r + dr, cc = c + dc; if (rr >= 0 && cc >= 0 && rr < rows && cc < cols && grid[at(rr, cc)]) n++; }
      if (n >= 5) ng[at(r, c)] = 1;
    }
    grid.set(ng);
  }
  const isIn = (r: number, c: number) => r >= 0 && c >= 0 && r < rows && c < cols && grid[at(r, c)] === 1;
  const out: [number, number][][] = [];
  for (let lp of traceLoops(isIn, rows, cols)) {
    lp = mergeCollinear(lp);
    if (Math.abs(ringArea(lp)) < 2.5) continue; // drop tiny orphan specks
    out.push(octilinear(simplifyLoop(lp.map(([x, y]) => [x * CELL, y * CELL]), CELL * 1.25)));
  }
  return out;
}

// snap a closed polygon to OCTILINEAR edges (horizontal / vertical / 45° only) so the current gene's
// territory matches the categories' 90°-or-45° style. Each edge → axis run + 45° run into the vertex.
function octilinear(loop: [number, number][]): [number, number][] {
  const src = loop.slice(0, -1), n = src.length, raw: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const P = src[i], Q = src[(i + 1) % n], dx = Q[0] - P[0], dy = Q[1] - P[1], adx = Math.abs(dx), ady = Math.abs(dy);
    raw.push(P);
    if (adx > ady && ady > 0) raw.push([P[0] + Math.sign(dx) * (adx - ady), P[1]]);
    else if (ady > adx && adx > 0) raw.push([P[0], P[1] + Math.sign(dy) * (ady - adx)]);
  }
  const out: [number, number][] = [];
  for (const p of raw) { const q = out[out.length - 1]; if (!q || q[0] !== p[0] || q[1] !== p[1]) out.push(p); }
  out.push(out[0]);
  return out;
}

// SVG path for a closed polygon with ROUNDED corners — straight edges, each vertex filleted with a
// quadratic arc of radius r (clamped to half the shorter adjacent edge). Tidies the angular outline.
function roundedPath(loop: [number, number][], r: number): string {
  const pts = loop.length > 1 && loop[0][0] === loop[loop.length - 1][0] && loop[0][1] === loop[loop.length - 1][1] ? loop.slice(0, -1) : loop;
  const n = pts.length;
  if (n < 3) return '';
  let d = '';
  for (let i = 0; i < n; i++) {
    const cur = pts[i], prev = pts[(i - 1 + n) % n], next = pts[(i + 1) % n];
    const v1x = prev[0] - cur[0], v1y = prev[1] - cur[1], l1 = Math.hypot(v1x, v1y) || 1;
    const v2x = next[0] - cur[0], v2y = next[1] - cur[1], l2 = Math.hypot(v2x, v2y) || 1;
    const rr = Math.min(r, l1 / 2, l2 / 2);
    const ax = cur[0] + (v1x / l1) * rr, ay = cur[1] + (v1y / l1) * rr;
    const bx = cur[0] + (v2x / l2) * rr, by = cur[1] + (v2y / l2) * rr;
    d += `${i === 0 ? 'M' : 'L'}${ax.toFixed(1)},${ay.toFixed(1)}Q${cur[0]},${cur[1]} ${bx.toFixed(1)},${by.toFixed(1)}`;
  }
  return d + 'Z';
}
