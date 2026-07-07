import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { PathwayMap as MapData, PathwayRef, Interactions, SimilarData } from '@uniome/shared';
import { ACCENT, LoadingBox } from '../components/Fields';
import { ViewControls } from './ViewControls';
import { OverviewLocator } from './OverviewLocator';

// The biological (KEGG) pathway map for a gene: the canonical metabolic diagram (rendered from
// KGML layout coords) used as a fixed scaffold, with the focal gene's RELATIONSHIPS painted on —
// which co-pathway enzymes physically interact with it, which are structural / sequence homologs.
// A gene's pathways are selectable; map-links jump to neighbouring pathways; scroll-zoom + drag-pan.

export type Status = 'focal' | 'physical' | 'struct' | 'seq';
export const MAP_H = 540; // rendered map height — also the loading placeholder's height, so no layout shift
const LABEL_ZOOM = 0.9; // below this zoom, only the focal gene's metabolites are labelled (avoids label pile-up)
// Overlay categories on canonical accents: focal = bold neutral (the subject), physical = blue,
// structural = teal, sequence = amber — matching the similar-features rows + KEGG class hues.
export const STATUS_STYLE: Record<Status, { fill: string; stroke: string; dot: string }> = {
  focal: { fill: '#e5e7eb', stroke: '#111827', dot: '#111827' },
  physical: { fill: '#dbeafe', stroke: ACCENT.blue, dot: ACCENT.blue },
  struct: { fill: '#ccfbf1', stroke: ACCENT.teal, dot: ACCENT.teal },
  seq: { fill: '#fef3c7', stroke: ACCENT.amber, dot: ACCENT.amber },
};
const PRIORITY: Status[] = ['focal', 'physical', 'struct', 'seq'];
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function PathwayMap({ focalId, chrom, interactions, similar }: { focalId: string; chrom: string; interactions: Interactions | null; similar: SimilarData | null }) {
  const { taxid } = useParams<{ taxid: string }>();
  const navigate = useNavigate();
  const [pathways, setPathways] = useState<PathwayRef[] | null | undefined>(undefined);
  const [pid, setPid] = useState<string | null>(null);
  const [map, setMap] = useState<MapData | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    setPathways(undefined); setPid(null); setMap(undefined);
    fetch(`/api/organism/${taxid}/features/${encodeURIComponent(focalId)}/pathways`)
      .then((r) => (r.ok ? r.json() : []))
      .then((d: PathwayRef[]) => { if (cancelled) return; setPathways(d); setPid(d[0]?.id ?? null); })
      .catch(() => !cancelled && setPathways(null));
    return () => { cancelled = true; };
  }, [taxid, focalId]);

  useEffect(() => {
    if (!pid) { setMap(undefined); return; }
    let cancelled = false;
    setMap(undefined);
    fetch(`/api/organism/${taxid}/pathway/${pid}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => !cancelled && setMap(d))
      .catch(() => !cancelled && setMap(null));
    return () => { cancelled = true; };
  }, [taxid, pid]);

  // Overlay sets from the focal's already-loaded relationships (no extra fetch).
  const overlay = useMemo(() => {
    const physical = new Set<string>();
    for (const p of interactions?.partners ?? []) if (p.uniqID && (p.physical || p.db === 'IntAct')) physical.add(p.uniqID);
    const struct = new Set((similar?.structural ?? []).map((m) => m.uniqID));
    const seq = new Set((similar?.sequence ?? []).map((m) => m.uniqID));
    return { physical, struct, seq };
  }, [interactions, similar]);
  const statusOf = (uniqID: string): Status | null =>
    uniqID === focalId ? 'focal' : overlay.physical.has(uniqID) ? 'physical' : overlay.struct.has(uniqID) ? 'struct' : overlay.seq.has(uniqID) ? 'seq' : null;

  const pathGenes = useMemo(() => new Set((map?.genes ?? []).flatMap((b) => b.genes.map((g) => g.uniqID))), [map]);

  if (pathways === null || (pathways && pathways.length === 0)) return <LoadingBox loading={false} label="no pathway map" height={MAP_H} />;

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <select value={pid ?? ''} onChange={(e) => setPid(e.target.value)} className="max-w-full rounded border border-neutral-300 bg-white px-1.5 py-0.5 text-xs">
          {pathways?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          {pid && !pathways?.some((p) => p.id === pid) && <option value={pid}>{map?.name ?? pid}</option>}
        </select>
        <Legend />
      </div>
      {map === undefined ? <LoadingBox height={MAP_H} label="loading pathway map…" />
        : map === null ? <LoadingBox loading={false} label="no pathway map" height={MAP_H} />
        : <div className="space-y-1.5">
            {/* "you are here": where this detailed pathway sits on the whole metabolic overview */}
            <div className="flex justify-end"><OverviewLocator focalId={focalId} genes={pathGenes} /></div>
            <MapCanvas map={map} statusOf={statusOf} onGene={(id) => navigate(`/o/${taxid}/c/${encodeURIComponent(chrom)}/entry/${id}`)} onPathway={setPid} />
          </div>}
    </div>
  );
}

export function Legend() {
  const items: [string, Status][] = [['focal', 'focal'], ['physical interactor', 'physical'], ['structural homolog', 'struct'], ['sequence homolog', 'seq']];
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-neutral-500">
      {items.map(([label, st]) => (
        <span key={st} className="inline-flex items-center gap-1">
          <span className="inline-block h-2.5 w-3 rounded-sm" style={{ background: STATUS_STYLE[st].fill, border: `1.5px solid ${STATUS_STYLE[st].stroke}` }} />{label}
        </span>
      ))}
    </div>
  );
}

function MapCanvas({ map, statusOf, onGene, onPathway }: { map: MapData; statusOf: (id: string) => Status | null; onGene: (id: string) => void; onPathway: (id: string) => void }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [W, setW] = useState(700);
  const H = MAP_H;
  const [hover, setHover] = useState<string | null>(null);
  const fit = useMemo(() => {
    const k = clamp(Math.min(W / map.bounds.w, H / map.bounds.h), 0.1, 3);
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
  useEffect(() => { setView(null); }, [map.id]); // refit on pathway switch
  useEffect(() => {
    const el = svgRef.current; if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
      const cur = viewRef.current;
      const k = clamp(cur.k * Math.exp(-e.deltaY * 0.0015), 0.1, 8);
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

  const cpd = useMemo(() => new Map(map.compounds.map((c) => [c.id, c])), [map]);
  // Reaction connectivity: the catalysing enzyme box's position (to route edges through it), plus the
  // compound/enzyme ids any reaction touches. KGML is sparse, so reference steps + boundary metabolites
  // it doesn't link are de-emphasised (faded compounds) or dropped (disconnected reference boxes).
  const { enzPos, usedCpd, usedEnz } = useMemo(() => {
    const enzPos = new Map<string, { x: number; y: number }>();
    for (const g of map.genes) enzPos.set(g.id, { x: g.x, y: g.y });
    for (const o of map.orthologs) enzPos.set(o.id, { x: o.x, y: o.y });
    const usedCpd = new Set<string>(), usedEnz = new Set<string>();
    for (const r of map.reactions) { r.substrates.forEach((s) => usedCpd.add(s)); r.products.forEach((p) => usedCpd.add(p)); if (r.enzyme) usedEnz.add(r.enzyme); }
    return { enzPos, usedCpd, usedEnz };
  }, [map]);
  // Per-compound unit directions toward the things it connects to (enzymes / other metabolites) — so a
  // label can be placed on the *uncrowded* side, away from the reaction arrows leaving the circle.
  const cpdDirs = useMemo(() => {
    const dirs = new Map<string, { x: number; y: number }[]>();
    const push = (cid: string, tx: number, ty: number) => {
      const c = cpd.get(cid); if (!c) return;
      const dx = tx - c.x, dy = ty - c.y, d = Math.hypot(dx, dy) || 1;
      (dirs.get(cid) ?? dirs.set(cid, []).get(cid)!).push({ x: dx / d, y: dy / d });
    };
    for (const r of map.reactions) {
      const e = r.enzyme ? enzPos.get(r.enzyme) : null;
      const altS = cpd.get(r.substrates[0] ?? ''), altP = cpd.get(r.products[0] ?? '');
      for (const s of r.substrates) { const t = e ?? altP; if (t) push(s, t.x, t.y); }
      for (const p of r.products) { const t = e ?? altS; if (t) push(p, t.x, t.y); }
    }
    return dirs;
  }, [map, cpd, enzPos]);
  const zoomBy = (f: number) => {
    const cur = viewRef.current, cx = W / 2, cy = H / 2;
    const k = clamp(cur.k * f, 0.1, 8);
    setView({ k, tx: cx - ((cx - cur.tx) / cur.k) * k, ty: cy - ((cy - cur.ty) / cur.k) * k });
  };
  // Metabolites the FOCAL gene directly acts on (substrates/products of reactions its box catalyses) —
  // always labelled so the gene's immediate context is named even at fit zoom. Every other compound's
  // label only appears once zoomed in (LABEL_ZOOM), so the full names don't pile into an illegible mush.
  const focalCpd = useMemo(() => {
    const focalBoxes = new Set(map.genes.filter((b) => b.genes.some((g) => statusOf(g.uniqID) === 'focal')).map((b) => b.id));
    const s = new Set<string>();
    for (const r of map.reactions) if (r.enzyme && focalBoxes.has(r.enzyme)) { r.substrates.forEach((x) => s.add(x)); r.products.forEach((x) => s.add(x)); }
    return s;
  }, [map, statusOf]);

  return (
    <div ref={wrapRef} className="relative min-w-0">
      <ViewControls onZoomIn={() => zoomBy(1.3)} onZoomOut={() => zoomBy(1 / 1.3)} onReset={() => setView(null)} />
      <svg ref={svgRef} width={W} height={H} className="block select-none rounded border border-neutral-200 bg-white" style={{ cursor: grab ? 'grabbing' : 'grab' }}
        onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onUp}>
        <defs>
          <marker id="pw-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="#cbd5e1" /></marker>
        </defs>
        <g transform={`translate(${v.tx},${v.ty}) scale(${v.k})`}>
          {/* reactions as KEGG-style RIGHT-ANGLED, round-cornered arrows: substrate → enzyme box →
              product (routed through the box so the gene label sits on the arrow); direct elbow if no box. */}
          {map.reactions.flatMap((r, i) => {
            const e = r.enzyme ? enzPos.get(r.enzyme) : null;
            // reference-filled steps (no E. coli enzyme) are faded so the organism's own reactions read first
            const stroke = r.ref ? '#e5e7eb' : '#cbd5e1';
            return r.substrates.flatMap((s) => r.products.map((p) => {
              const a = cpd.get(s), b = cpd.get(p);
              if (!a || !b) return null;
              const arrow = r.reversible ? undefined : 'url(#pw-arrow)';
              const key = `${i}-${s}-${p}`;
              if (e) {
                const as = trimTo(e, a, cRadius(a)), bp = trimTo(e, b, cRadius(b) + 2);
                return (
                  <g key={key}>
                    <path d={elbow(as.x, as.y, e.x, e.y)} fill="none" stroke={stroke} strokeWidth={1.2} />
                    <path d={elbow(e.x, e.y, bp.x, bp.y)} fill="none" stroke={stroke} strokeWidth={1.2} markerEnd={arrow} />
                  </g>
                );
              }
              const as = trimTo(b, a, cRadius(a)), bp = trimTo(a, b, cRadius(b) + 2);
              return <path key={key} d={elbow(as.x, as.y, bp.x, bp.y)} fill="none" stroke={stroke} strokeWidth={1.1} markerEnd={arrow} />;
            }));
          })}
          {/* links to neighbouring pathways: a DASHED arrow from the bridging metabolite into the linked
              pathway's box (KEGG-style "this compound continues into …"); clicking the box opens it. */}
          {map.maps.map((m) => (
            <g key={m.id} style={{ cursor: 'pointer' }} onClick={(e) => { e.stopPropagation(); onPathway(m.pathwayId); }}>
              <title>{`continues into pathway: ${m.label}`}</title>
              {m.via.map((cid) => {
                const c = cpd.get(cid); if (!c) return null;
                const end = trimTo(c, { x: m.x, y: m.y }, Math.max(m.w, m.h) / 2 + 1), start = trimTo({ x: m.x, y: m.y }, c, cRadius(c));
                return <path key={cid} d={elbow(start.x, start.y, end.x, end.y)} fill="none" stroke="#94a3b8" strokeWidth={1} strokeDasharray="3 2.5" markerEnd="url(#pw-arrow)" />;
              })}
              <rect x={m.x - m.w / 2} y={m.y - m.h / 2} width={m.w} height={m.h} rx={3} fill="#f1f5f9" stroke="#cbd5e1" />
              <text x={m.x} y={m.y + 3} textAnchor="middle" fontSize={9} fill="#64748b">{trunc(m.label, m.w)}</text>
            </g>
          ))}
          {/* compounds — metabolites a reaction touches are solid; the rest (boundary/cofactor
              compounds KGML doesn't link here) are faded so the active flow reads clearly. */}
          {map.compounds.map((c) => {
            const on = usedCpd.has(c.id);
            const r = cRadius(c);
            // pick the side (below/right/above/left) least crowded by this metabolite's reaction arrows
            const dirs = cpdDirs.get(c.id) ?? [];
            const cands = [
              { ux: 0, uy: 1, anchor: 'middle' as const, tx: c.x, ty: c.y + r + 7 },
              { ux: 1, uy: 0, anchor: 'start' as const, tx: c.x + r + 3, ty: c.y + 2.5 },
              { ux: 0, uy: -1, anchor: 'middle' as const, tx: c.x, ty: c.y - r - 3 },
              { ux: -1, uy: 0, anchor: 'end' as const, tx: c.x - r - 3, ty: c.y + 2.5 },
            ];
            let best = cands[0], bestCost = Infinity;
            cands.forEach((cand, i) => { let cost = i * 0.01; for (const d of dirs) cost += Math.max(0, d.x * cand.ux + d.y * cand.uy); if (cost < bestCost) { bestCost = cost; best = cand; } });
            const showLabel = on || focalCpd.has(c.id) || v.k >= LABEL_ZOOM; // label every in-pathway metabolite
            return (
              <g key={c.id} opacity={on ? 1 : 0.3}>
                <circle cx={c.x} cy={c.y} r={r} fill="#fff" stroke="#94a3b8" strokeWidth={1}><title>{c.label}</title></circle>
                {showLabel && <text x={best.tx} y={best.ty} textAnchor={best.anchor} fontSize={6.5} fill={focalCpd.has(c.id) ? '#1f2937' : '#475569'} fontWeight={focalCpd.has(c.id) ? 600 : 400} pointerEvents="none">{c.label}</text>}
              </g>
            );
          })}
          {/* orthologs: reference enzyme steps with no E. coli gene — show only those a reaction routes
              through (faded context); drop the disconnected ones so the map isn't full of floating boxes. */}
          {map.orthologs.filter((o) => usedEnz.has(o.id)).map((o) => (
            <rect key={o.id} x={o.x - o.w / 2} y={o.y - o.h / 2} width={o.w} height={o.h} rx={2} fill="#f9fafb" stroke="#e5e7eb" />
          ))}
          {/* gene boxes with overlay */}
          {map.genes.map((b) => {
            const sts = new Set<Status>();
            for (const g of b.genes) { const s = statusOf(g.uniqID); if (s) sts.add(s); }
            const primary = PRIORITY.find((s) => sts.has(s)) ?? null;
            const style = primary ? STATUS_STYLE[primary] : { fill: '#ffffff', stroke: '#9ca3af', dot: '' };
            const isHover = hover === b.id;
            const target = b.genes.find((g) => statusOf(g.uniqID) && g.uniqID !== undefined) ?? b.genes[0];
            return (
              <g key={b.id} style={{ cursor: b.genes.length ? 'pointer' : 'default' }}
                 onMouseEnter={() => setHover(b.id)} onMouseLeave={() => setHover(null)}
                 onClick={(e) => { e.stopPropagation(); if (!drag.current.moved && target) onGene(target.uniqID); }}>
                <title>{b.genes.map((g) => `${g.gene}${statusOf(g.uniqID) ? ` (${statusOf(g.uniqID)})` : ''}`).join(', ') || b.label}</title>
                <rect x={b.x - b.w / 2} y={b.y - b.h / 2} width={b.w} height={b.h} rx={2}
                  fill={style.fill} stroke={style.stroke} strokeWidth={primary === 'focal' ? 2.5 : isHover ? 2 : 1.2} />
                <text x={b.x} y={b.y + 3} textAnchor="middle" fontSize={9} fontWeight={primary === 'focal' ? 700 : 400} fill="#1f2937">{trunc(b.genes[0]?.gene ?? b.label, b.w)}</text>
                {/* status badges (a box of isozymes can match several ways) */}
                {[...sts].filter((s) => s !== 'focal').map((s, i) => (
                  <circle key={s} cx={b.x + b.w / 2 - 3 - i * 5} cy={b.y - b.h / 2 + 3} r={2.2} fill={STATUS_STYLE[s].dot} stroke="#fff" strokeWidth={0.5} />
                ))}
              </g>
            );
          })}
        </g>
      </svg>
      <div className="mt-0.5 text-[10px] text-neutral-400">{map.genes.length} enzyme steps · grey = reference step absent in E. coli · click a box to open it · dashed ↗ pill = jump to a linked pathway · the focal gene's metabolites are named — zoom in to label the rest · scroll to zoom, drag to pan</div>
    </div>
  );
}

const trunc = (s: string, boxW: number) => { const max = Math.max(3, Math.floor(boxW / 5)); return s.length > max ? s.slice(0, max - 1) + '…' : s; };
const cRadius = (c: { w: number }) => Math.max(3, c.w / 2);
// Move `to` back toward `from` by `by` px — so a reaction line stops at a node's edge (shorter arrow)
// instead of running into / past the circle.
const trimTo = (from: { x: number; y: number }, to: { x: number; y: number }, by: number) => {
  const dx = to.x - from.x, dy = to.y - from.y, d = Math.hypot(dx, dy) || 1;
  return { x: to.x - (dx / d) * by, y: to.y - (dy / d) * by };
};
// orthogonal connector a→b: one right-angle bend with a rounded corner (KEGG-style reaction arrow).
// Routes along the longer axis first so the bend sits near b.
const elbow = (ax: number, ay: number, bx: number, by: number, r = 7) => {
  const dx = bx - ax, dy = by - ay;
  if (Math.abs(dx) < 2 || Math.abs(dy) < 2) return `M${ax},${ay}L${bx},${by}`;
  const rr = Math.min(r, Math.abs(dx) / 2, Math.abs(dy) / 2), sx = Math.sign(dx), sy = Math.sign(dy);
  return Math.abs(dx) >= Math.abs(dy)
    ? `M${ax},${ay}L${bx - sx * rr},${ay}Q${bx},${ay} ${bx},${ay + sy * rr}L${bx},${by}` // horizontal first, corner at (bx,ay)
    : `M${ax},${ay}L${ax},${by - sy * rr}Q${ax},${by} ${ax + sx * rr},${by}L${bx},${by}`; // vertical first, corner at (ax,by)
};
