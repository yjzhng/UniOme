import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ViewControls } from './ViewControls';

// A generic node-link network: a LIVE force-directed simulation rendered as custom SVG. Nodes are
// draggable (drag perturbs the graph and it re-settles); edge rest-length + stiffness scale with
// weight, so stronger interactions pull their nodes closer. Zoom is semantic — node/label/edge
// sizes stay constant while the layout itself scales (it's not a magnifying glass). Reusable across
// the Relationships datasets (undirected interactions/similarity; directed regulation/pathway).

export interface NetNode {
  id: string;
  label: string;
  kind?: 'focal' | 'neighbor';
  color?: string;
  link?: string | null; // entry-page path; clicking navigates there
  title?: string;
  size?: number; // optional magnitude (e.g. shared count) → drives radius instead of degree
}
export interface NetEdge {
  source: string;
  target: string;
  weight?: number; // 0–1; stronger = thicker, shorter, stiffer
  color?: string;
  directed?: boolean;
  title?: string;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const NODE_R = 4.5;
// Node radius encodes connectivity with a steep curve (deg^0.85) and a small floor, so peripheral
// single-link nodes stay tiny and hubs stand out clearly.
const nodeRadius = (deg: number, focal: boolean) => clamp(1.4 + 0.7 * Math.pow(deg, 0.85), focal ? 4 : 2, 16);
// When nodes carry an explicit `size` (e.g. shared-count in a co-membership network, where degree is
// uninformative because every clique member is equally connected), radius scales with that magnitude
// instead — normalised across the shown nodes so the highest-overlap nodes are visibly largest.
const sizeRadius = (v: number, lo: number, hi: number, focal: boolean) => clamp(3 + 12 * Math.sqrt((v - lo) / ((hi - lo) || 1)), focal ? 6 : 3, 16);
// d3-force-style velocity-Verlet (Obsidian-like): every node repels (charge), edges spring toward a
// rest length (degree-normalised so hubs stay put; stiffer/shorter for stronger edges), and gravity
// keeps the graph framed — nothing is pinned. Nodes carry MOMENTUM (VEL_DECAY < 1) and energy decays
// slowly (ALPHA_DECAY), so a released node glides back through equilibrium and overshoots.
const REP = 2600, LINK_K = 0.7, BASE = 92, WSPAN = 52, GRAVITY = 0.05;
const VEL_DECAY = 0.6, MAX_V = 40; // velocity retained per tick — lower = more damping (less "gelly")
const ALPHA_DECAY = 0.0228, ALPHA_MIN = 0.0015, DRAG_TARGET = 0.3, REHEAT = 1;

interface Sim {
  ids: string[];
  idx: Map<string, number>;
  x: Float64Array; y: Float64Array;
  vx: Float64Array; vy: Float64Array;
  deg: Float64Array;
  edges: { s: number; t: number; w: number }[];
  focal: number;
}

export function NetworkGraph({ nodes, edges, directed = false, height, hovered, onHover, highlight, onNodeClick, baseEdgeOpacity }: { nodes: NetNode[]; edges: NetEdge[]; directed?: boolean; height?: number; hovered?: string | null; onHover?: (id: string | null) => void; highlight?: Set<string> | null; onNodeClick?: (id: string) => void; baseEdgeOpacity?: number }) {
  const navigate = useNavigate();
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [W, setW] = useState(560);
  const H = height ?? clamp(200 + nodes.length * 3, 260, 460);

  const sim = useRef<Sim | null>(null);
  const alpha = useRef(0);
  const alphaTarget = useRef(0);
  const raf = useRef(0);
  const drag = useRef<{ node: number | null; pan: boolean; lastX: number; lastY: number; moved: boolean }>({ node: null, pan: false, lastX: 0, lastY: 0, moved: false });
  const [, setTick] = useState(0);
  // Hover is controllable (so a detail table can sync highlighting) — falls back to internal state.
  const [hoverState, setHoverState] = useState<string | null>(null);
  const hover = onHover ? hovered ?? null : hoverState;
  const setHover = onHover ?? setHoverState;
  const [grabbing, setGrabbing] = useState(false);

  // Semantic-zoom viewport: world→screen = world*k + t. Auto-fits the layout until the user first
  // interacts (zoom / pan / drag), after which it's user-controlled.
  const [view, setView] = useState<{ k: number; tx: number; ty: number } | null>(null);
  const viewRef = useRef({ k: 1, tx: W / 2, ty: H / 2 });

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth || 560));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Rebuild only when the TOPOLOGY changes (node set / edges) — not when node colours change, so
  // re-colouring (cluster vs pathway) doesn't re-run the layout.
  const topo = useMemo(() => nodes.map((n) => n.id).join('') + '' + edges.map((e) => `${e.source}>${e.target}`).join(''), [nodes, edges]);
  useEffect(() => {
    const prev = sim.current;
    const N = nodes.length;
    const idx = new Map(nodes.map((n, i) => [n.id, i]));
    const x = new Float64Array(N), y = new Float64Array(N);
    const vx = new Float64Array(N), vy = new Float64Array(N), deg = new Float64Array(N);
    const focal = nodes.findIndex((n) => n.kind === 'focal');
    nodes.forEach((n, i) => {
      const pi = prev?.idx.get(n.id);
      if (pi != null) { x[i] = prev!.x[pi]; y[i] = prev!.y[pi]; }
      else { const a = i * 2.399963; const r = 24 + (i % 9) * 11; x[i] = Math.cos(a) * r; y[i] = Math.sin(a) * r; } // golden-angle spread
    });
    const eds = edges.map((e) => ({ s: idx.get(e.source)!, t: idx.get(e.target)!, w: e.weight ?? 0.4 })).filter((e) => e.s != null && e.t != null);
    for (const e of eds) { deg[e.s]++; deg[e.t]++; }
    sim.current = { ids: nodes.map((n) => n.id), idx, x, y, vx, vy, deg, edges: eds, focal };
    alphaTarget.current = 0;
    // Full energy for the first layout; only a gentle nudge when the node set merely changed (e.g. a
    // source-filter toggle) so the preserved positions settle instead of violently re-exploding.
    const sameSet = !!prev && prev.ids.length === nodes.length && nodes.every((n) => prev.idx.has(n.id));
    reheat(!prev || sameSet ? REHEAT : 0.25);
    // IMPORTANT: reset raf.current so StrictMode's mount→unmount→mount (which cancels the rAF) lets
    // reheat() restart the loop — otherwise the stale cancelled id makes the sim never tick.
    return () => { cancelAnimationFrame(raf.current); raf.current = 0; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topo]);

  function reheat(a: number) {
    alpha.current = Math.max(alpha.current, a);
    if (!raf.current) loop();
  }
  function loop() {
    raf.current = requestAnimationFrame(() => {
      tick();
      alpha.current += (alphaTarget.current - alpha.current) * ALPHA_DECAY;
      setTick((t) => t + 1);
      if (alpha.current > ALPHA_MIN || alphaTarget.current > 0) loop();
      else raf.current = 0;
    });
  }
  // One velocity-Verlet step: forces add to velocity (scaled by alpha), friction bleeds it off,
  // then positions integrate. The retained velocity (momentum) is what springs a released node back.
  function tick() {
    const s = sim.current!;
    const N = s.x.length, a = alpha.current;
    const { x, y, vx, vy, deg } = s;
    for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) {
      let ex = x[i] - x[j], ey = y[i] - y[j];
      let d2 = ex * ex + ey * ey; if (d2 < 1) d2 = 1;
      const d = Math.sqrt(d2), f = (REP * a) / d2;
      const ux = (ex / d) * f, uy = (ey / d) * f;
      vx[i] += ux; vy[i] += uy; vx[j] -= ux; vy[j] -= uy;
    }
    for (const e of s.edges) {
      let ex = x[e.t] - x[e.s], ey = y[e.t] - y[e.s];
      const d = Math.sqrt(ex * ex + ey * ey) || 1;
      const rest = Math.max(28, BASE - e.w * WSPAN);
      const strength = (LINK_K / Math.max(1, Math.min(deg[e.s], deg[e.t]))) * (0.5 + e.w);
      const l = (d - rest) * strength * a;
      const ux = (ex / d) * l, uy = (ey / d) * l;
      vx[e.s] += ux; vy[e.s] += uy; vx[e.t] -= ux; vy[e.t] -= uy;
    }
    for (let i = 0; i < N; i++) {
      vx[i] += -x[i] * GRAVITY * a; vy[i] += -y[i] * GRAVITY * a;
      if (i === drag.current.node) { vx[i] = 0; vy[i] = 0; continue; } // held at the cursor
      vx[i] *= VEL_DECAY; vy[i] *= VEL_DECAY;
      const sp = Math.hypot(vx[i], vy[i]);
      if (sp > MAX_V) { vx[i] = (vx[i] / sp) * MAX_V; vy[i] = (vy[i] / sp) * MAX_V; }
      x[i] += vx[i]; y[i] += vy[i];
    }
  }

  // Auto-fit (used until the user takes control).
  const s = sim.current;
  const autoFit = (() => {
    if (!s) return { k: 1, tx: W / 2, ty: H / 2 };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < s.x.length; i++) { minX = Math.min(minX, s.x[i]); minY = Math.min(minY, s.y[i]); maxX = Math.max(maxX, s.x[i]); maxY = Math.max(maxY, s.y[i]); }
    const bw = maxX - minX || 1, bh = maxY - minY || 1, PAD = 50;
    const k = clamp(Math.min((W - 2 * PAD) / bw, (H - 2 * PAD) / bh), 0.2, 3);
    return { k, tx: W / 2 - ((minX + maxX) / 2) * k, ty: H / 2 - ((minY + maxY) / 2) * k };
  })();
  const v = view ?? autoFit;
  viewRef.current = v;
  const toScreen = (wx: number, wy: number) => ({ x: wx * v.k + v.tx, y: wy * v.k + v.ty });
  const toWorld = (sx: number, sy: number) => ({ x: (sx - v.tx) / v.k, y: (sy - v.ty) / v.k });

  // ---- interaction ----
  const lock = () => { if (!view) setView(viewRef.current); };
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
      const factor = Math.exp(-e.deltaY * 0.0015);
      const cur = viewRef.current;
      const k = clamp(cur.k * factor, 0.2, 12);
      const wx = (sx - cur.tx) / cur.k, wy = (sy - cur.ty) / cur.k;
      setView({ k, tx: sx - wx * k, ty: sy - wy * k });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const onSvgDown = (e: ReactMouseEvent) => { lock(); drag.current = { node: null, pan: true, lastX: e.clientX, lastY: e.clientY, moved: false }; setGrabbing(true); };
  const onNodeDown = (i: number, e: ReactMouseEvent) => {
    e.stopPropagation(); lock();
    drag.current = { node: i, pan: false, lastX: e.clientX, lastY: e.clientY, moved: false };
    alphaTarget.current = DRAG_TARGET; reheat(DRAG_TARGET); setGrabbing(true); // keep the sim warm while held
  };
  const onMove = (e: ReactMouseEvent) => {
    const d = drag.current;
    if (d.node != null && sim.current) {
      const rect = svgRef.current!.getBoundingClientRect();
      const w = toWorld(e.clientX - rect.left, e.clientY - rect.top);
      sim.current.x[d.node] = w.x; sim.current.y[d.node] = w.y; d.moved = true;
      reheat(DRAG_TARGET); // neighbours follow the dragged node
    } else if (d.pan) {
      const cur = viewRef.current;
      setView({ k: cur.k, tx: cur.tx + (e.clientX - d.lastX), ty: cur.ty + (e.clientY - d.lastY) });
      d.lastX = e.clientX; d.lastY = e.clientY; d.moved = true;
    }
  };
  // On release: let energy decay to 0, but give it a kick so the freed node carries momentum back
  // through equilibrium (the springy Obsidian feel).
  const endDrag = () => {
    const sprung = drag.current.node != null && drag.current.moved;
    alphaTarget.current = 0;
    drag.current.node = null; drag.current.pan = false; setGrabbing(false);
    if (sprung) reheat(0.3);
  };

  // Range of explicit node sizes (if any) → normalises the size→radius scale across the shown nodes.
  let sizeLo = Infinity, sizeHi = -Infinity;
  for (const n of nodes) if (n.size != null) { sizeLo = Math.min(sizeLo, n.size); sizeHi = Math.max(sizeHi, n.size); }

  // ---- highlight ----
  // A provided highlight set (a hovered group) takes precedence over the hovered node's neighbourhood.
  const incident = (() => {
    if (highlight) return highlight;
    if (!hover) return null;
    const set = new Set<string>([hover]);
    for (const e of edges) if (e.source === hover || e.target === hover) { set.add(e.source); set.add(e.target); }
    return set;
  })();
  const nodeDim = (id: string) => (incident && !incident.has(id) ? 0.18 : 1);

  // Zoom about the viewport centre (for the +/- buttons), from the current/auto-fit view.
  const zoomBy = (f: number) => {
    const cur = viewRef.current, cx = W / 2, cy = H / 2;
    const k = clamp(cur.k * f, 0.2, 12);
    setView({ k, tx: cx - ((cx - cur.tx) / cur.k) * k, ty: cy - ((cy - cur.ty) / cur.k) * k });
  };

  // The <svg> is always rendered (even before the sim is built) so its ref exists when the wheel
  // listener attaches on mount — otherwise the page scrolls instead of the graph zooming.
  return (
    <div ref={wrapRef} className="relative min-w-0">
      <ViewControls onZoomIn={() => zoomBy(1.3)} onZoomOut={() => zoomBy(1 / 1.3)} onReset={() => setView(null)} />
      <svg ref={svgRef} width={W} height={H} className="block select-none" style={{ cursor: grabbing ? 'grabbing' : 'grab' }}
        onMouseDown={onSvgDown} onMouseMove={onMove} onMouseUp={endDrag} onMouseLeave={endDrag}>
        {directed && (
          <defs>
            <marker id="net-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
              <path d="M0,0 L7,3.5 L0,7 Z" className="fill-neutral-400" />
            </marker>
          </defs>
        )}
        {s && edges.map((e, i) => {
          // Look up positions by id (not array index) and skip endpoints not in the current sim —
          // guards the frame after a filter toggle, when props change before the sim rebuilds.
          const si = s.idx.get(e.source), ti = s.idx.get(e.target);
          if (si == null || ti == null) return null;
          const a = toScreen(s.x[si], s.y[si]);
          const b = toScreen(s.x[ti], s.y[ti]);
          // Edges very faint by default so labelled nodes read clearly; a hovered node's edges brighten.
          const lit = highlight ? highlight.has(e.source) && highlight.has(e.target) : hover ? e.source === hover || e.target === hover : null;
          const opacity = lit == null ? (baseEdgeOpacity ?? 0.12) : lit ? 0.7 : 0.03;
          let x2 = b.x, y2 = b.y;
          if (directed) { const ux = b.x - a.x, uy = b.y - a.y, d = Math.hypot(ux, uy) || 1; x2 = b.x - (ux / d) * (NODE_R + 6); y2 = b.y - (uy / d) * (NODE_R + 6); }
          return (
            <line key={i} x1={a.x} y1={a.y} x2={x2} y2={y2} stroke={e.color ?? '#cbd5e1'} strokeWidth={0.5 + (e.weight ?? 0.4) * 2} strokeOpacity={opacity} markerEnd={directed ? 'url(#net-arrow)' : undefined}>
              {e.title && <title>{e.title}</title>}
            </line>
          );
        })}
        {s && nodes.map((n) => {
          const si = s.idx.get(n.id);
          if (si == null) return null;
          const p = toScreen(s.x[si], s.y[si]);
          const focal = n.kind === 'focal';
          const r = n.size != null ? sizeRadius(n.size, sizeLo, sizeHi, focal) : nodeRadius(s.deg[si], focal);
          // All nodes labelled by default; while hovering, only the focal + the hovered neighbourhood.
          const showLabel = incident == null || focal || incident.has(n.id);
          return (
            <g key={n.id} opacity={nodeDim(n.id)} style={{ cursor: 'grab' }}
               onMouseDown={(e) => onNodeDown(si, e)}
               onMouseEnter={() => setHover(n.id)} onMouseLeave={() => setHover(null)}
               onClick={() => { if (drag.current.moved) return; if (onNodeClick) onNodeClick(n.id); else if (n.link) navigate(n.link); }}>
              <title>{n.title ?? n.label}</title>
              <circle cx={p.x} cy={p.y} r={r} fill={n.color ?? (focal ? '#334155' : '#94a3b8')} className="stroke-white" strokeWidth={1} />
              {showLabel && <text x={p.x + r + 2} y={p.y + 3} fontSize={focal ? 11 : 9} fontWeight={focal || hover === n.id ? 600 : 400} className={focal ? "fill-neutral-800" : "fill-neutral-600"}>{n.label}</text>}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
