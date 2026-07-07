import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { RelationshipClusters, RelationshipBridges, RelationshipType } from '@uniome/shared';
import { fetchJSONWithRetry } from '../lib/api';
import { PALETTE } from './networkParts';
import { ACCENT1 } from '../lib/theme';
import { NetworkGraph, type NetNode, type NetEdge } from './NetworkGraph';
import type { RelView } from '../Layout';

// Relationship explorer — a 3-panel navigator over the global gene–gene relationship graph. The graph
// is community-detected (Louvain) server-side; here we surface those communities as CLUSTERS:
//   • left   — a cluster×cluster heatmap (diagonal = internal density/hotspots, off-diagonal = the
//              contact between two clusters). Click a cell to drill in.
//   • middle — the clusters as a sortable table (by size or hotspot density).
//   • right  — the selected cluster's genes (diagonal) or the bridge gene pairs connecting two
//              clusters (off-diagonal). Picking a gene selects/opens it.
const TYPES: { key: RelationshipType; label: string; unit: string; sources: [string, string][] }[] = [
  { key: 'interaction', label: 'interaction', unit: 'interaction strength', sources: [['all', 'combined'], ['string', 'STRING'], ['string-physical', 'STRING physical'], ['string-predicted', 'STRING predicted'], ['intact', 'IntAct'], ['rnainter', 'RNAInter']] },
  { key: 'molecular', label: 'molecular features', unit: 'molecular similarity', sources: [['interpro', 'InterPro'], ['cdd', 'CDD motifs'], ['ted', 'TED/CATH'], ['sequence', 'sequence'], ['structure', 'structure']] },
  { key: 'regulation', label: 'regulation', unit: 'shared regulation', sources: [['all', 'combined'], ['regulon', 'regulon'], ['modulon', 'modulon']] },
  { key: 'cellular', label: 'cellular functions', unit: 'shared pathways/functions', sources: [['all', 'combined'], ['pathway', 'KEGG pathways'], ['function', 'KEGG functions']] },
];
const lerp = (a: number, b: number, t: number) => Math.round(a + (b - a) * t);
const heat = (v: number) => { const t = Math.max(0, Math.min(1, v)); return `rgb(${lerp(238, 49, t)},${lerp(242, 46, t)},${lerp(255, 129, t)})`; };
// Per-cluster identity colour (so adjacent clusters are distinguishable on the heatmap axes + table) —
// a categorical cycle, distinct from the KEGG class (kept as a text label, since many clusters share one).
const SW = 6; // axis colour-strip thickness
const GRID = 360; // constant heatmap span (px); cell size = GRID / clusterCount
const SANKEY_MAX = 22; // strongest bridge pairs drawn in the inter-cluster Sankey
const clusterColor = (i: number) => PALETTE[i % PALETTE.length];
// A cluster's display name: its hub (top-degree) gene + size, e.g. "thrA cluster (12)".
const clusterName = (c: { label: string; size: number }) => `${c.label} cluster (${c.size})`;

type Gene = { uniqID: string; gene: string; chrom: string };
const ctrlRow = 'flex flex-wrap items-center gap-1';
const ctrlLabel = 'w-14 shrink-0 text-neutral-400';

export function RelationshipExplorer({ taxid, focusId, onPick, view, onView }: { taxid: string; condensed?: boolean; focusId?: string; onPick?: (g: Gene | null) => void; view: RelView; onView: (v: RelView) => void }) {
  // The view (relationship type, source, selected cell) is controlled by the parent so it persists across
  // navigation; cluster/bridge data is local and re-fetches from it. Changing type/source clears the cell.
  const { type, source, sel } = view;
  const setType = (t: RelationshipType) => onView({ type: t, source: TYPES.find((x) => x.key === t)!.sources[0][0], sel: null });
  const setSource = (s: string) => onView({ ...view, source: s, sel: null });
  const setSel = (s: { a: number; b: number } | null) => onView({ ...view, sel: s });
  const [data, setData] = useState<RelationshipClusters | null | undefined>(undefined);
  const [bridges, setBridges] = useState<RelationshipBridges | null | undefined>(undefined);
  const nav = useNavigate();

  // Stale-while-revalidate: keep the current view on screen while a new type/source loads, so the
  // panel doesn't collapse to a one-line "loading" and flash the whole page on every switch.
  useEffect(() => {
    let on = true;
    fetchJSONWithRetry<RelationshipClusters>(`/api/organism/${taxid}/relationship-clusters?type=${type}&source=${source}`).then((d) => on && setData(d)).catch(() => on && setData(null));
    return () => { on = false; };
  }, [taxid, type, source]);

  useEffect(() => {
    // Fetch the strongest gene pairs for the selection — within one cluster (a === b, drives the cluster
    // network) or between two clusters (a !== b, drives the bridge Sankey).
    if (!sel) { setBridges(undefined); return; }
    let on = true; setBridges(undefined);
    fetchJSONWithRetry<RelationshipBridges>(`/api/organism/${taxid}/relationship-bridges?type=${type}&source=${source}&a=${sel.a}&b=${sel.b}`).then((d) => on && setBridges(d)).catch(() => on && setBridges(null));
    return () => { on = false; };
  }, [taxid, type, source, sel?.a, sel?.b]);

  const cur = TYPES.find((t) => t.key === type)!;

  return (
    <div className="flex flex-col gap-2">
      {/* controls — relationship, then source (colour lives at the heatmap's corner) */}
      <div className="flex flex-col gap-1 text-[10px]">
        <div className={ctrlRow}>
          <span className={ctrlLabel}>relationship</span>
          {TYPES.map((t) => (
            <button key={t.key} type="button" onClick={() => setType(t.key)}
              className={'cursor-pointer rounded px-1.5 py-0.5 ' + (type === t.key ? 'bg-neutral-800 text-white' : 'text-neutral-600 hover:bg-neutral-100')}>{t.label}</button>
          ))}
        </div>
        <div className={ctrlRow}>
          <span className={ctrlLabel}>source</span>
          {cur.sources.length > 1 ? cur.sources.map(([k, l]) => (
            <button key={k} type="button" onClick={() => setSource(k)}
              className={'cursor-pointer rounded px-1.5 py-0.5 ' + (source === k ? 'bg-neutral-200 font-medium text-neutral-800' : 'text-neutral-500 hover:bg-neutral-100')}>{l}</button>
          )) : <span className="text-neutral-500">{cur.sources[0][1]}</span>}
        </div>
      </div>

      {data === undefined ? (
        <div className="py-8 text-center text-xs text-neutral-400">loading relationships…</div>
      ) : !data || !data.clusters.length ? (
        <div className="py-8 text-center text-xs text-neutral-400">no relationship clusters</div>
      ) : (() => {
        const K = data.clusters.length;
        // The heatmap keeps a CONSTANT overall span — only the per-cluster cell size (density) changes
        // with the cluster count, so the element doesn't grow/shrink as you switch relationship type.
        const cell = GRID / K;
        const bodyH = GRID + SW; // = K * cell + SW — the table columns match it exactly
        const M = data.contact; // density only
        const openGene = (g: Gene) => (onPick ? onPick({ uniqID: g.uniqID, gene: g.gene, chrom: g.chrom }) : nav(`/o/${taxid}/c/${encodeURIComponent(g.chrom)}/entry/${g.uniqID}`));
        return (
          <div className="flex flex-wrap items-start gap-4">
            <ClusterHeatmap clusters={data.clusters} matrix={M} cell={cell} sel={sel} unit={cur.unit} onSelect={setSel} />
            <ClusterTable clusters={data.clusters} sel={sel && sel.a === sel.b ? sel.a : null} onSelect={(i) => setSel({ a: i, b: i })} bodyH={bodyH} />
            <DetailPanel data={data} sel={sel} bridges={bridges} unit={cur.unit} focusId={focusId} onOpen={openGene} onHop={(a, b) => setSel({ a, b })} bodyH={bodyH} />
          </div>
        );
      })()}
    </div>
  );
}

// LEFT — the cluster×cluster heatmap. Diagonal = internal density; off-diagonal = inter-cluster contact.
function ClusterHeatmap({ clusters, matrix, cell, sel, unit, onSelect }: {
  clusters: RelationshipClusters['clusters']; matrix: number[][]; cell: number; sel: { a: number; b: number } | null; unit: string; onSelect: (s: { a: number; b: number }) => void;
}) {
  const K = clusters.length;
  const grid = K * cell;
  const [hover, setHover] = useState<{ a: number; b: number } | null>(null);
  const hv = hover ?? sel;
  return (
    <div className="flex flex-col gap-1" style={{ width: grid + SW + 1 }}>
      <svg width={grid + SW + 1} height={grid + SW + 1} className="block">
        {/* per-cluster identity colour strips along both axes (match the table swatches) */}
        {clusters.map((c, i) => (
          <g key={'s' + c.id}>
            <rect x={SW + i * cell} y={0} width={cell} height={SW} fill={clusterColor(i)} />
            <rect x={0} y={SW + i * cell} width={SW} height={cell} fill={clusterColor(i)} />
          </g>
        ))}
        {matrix.map((row, r) => row.map((v, c) => (
          <rect key={`${r}_${c}`} x={SW + c * cell} y={SW + r * cell} width={cell} height={cell}
            fill={v === 0 ? '#fafafa' : heat(v)} stroke={r === c ? '#d4d4d4' : '#fff'} strokeWidth={r === c ? 0.6 : 0.4}
            className="cursor-pointer" onMouseEnter={() => setHover({ a: r, b: c })} onMouseLeave={() => setHover(null)} onClick={() => onSelect({ a: r, b: c })} />
        )))}
        {sel && (() => {
          // Thin red row + column locator outlines spanning the grid (the interacting pairs: cluster sel.b
          // down the column, cluster sel.a across the row), with a full-weight red box on the selected cell
          // itself at the intersection. White halo underneath keeps the red legible over any heat colour.
          const colX = SW + sel.b * cell, rowY = SW + sel.a * cell;
          const band = (x: number, y: number, w: number, h: number, stroke: string, sw: number) =>
            <rect x={x} y={y} width={w} height={h} fill="none" stroke={stroke} strokeWidth={sw} />;
          return (
            <g pointerEvents="none">
              {band(colX, SW, cell, grid, '#fff', 2.2)}
              {band(SW, rowY, grid, cell, '#fff', 2.2)}
              {band(colX, SW, cell, grid, ACCENT1, 0.9)}
              {band(SW, rowY, grid, cell, ACCENT1, 0.9)}
              {band(colX, rowY, cell, cell, '#fff', 3.4)}
              {band(colX, rowY, cell, cell, ACCENT1, 2)}
            </g>
          );
        })()}
      </svg>
      {/* density legend */}
      <div className="flex items-center gap-2 text-[9px] text-neutral-500">
        <span className="flex items-center gap-1"><span>low</span><span className="inline-block h-2 w-12 rounded-sm" style={{ background: 'linear-gradient(to right, rgb(238,242,255), rgb(49,46,129))' }} /><span>high {unit}</span></span>
      </div>
      {/* instruction / hover read-out, below the legend */}
      <div className="min-h-[1rem] text-[9px] text-neutral-500">
        {hv ? (
          <span><span className="font-mono text-neutral-800">{clusters[hv.a]?.label}</span> {hv.a === hv.b ? <span className="text-neutral-400">internal</span> : <>× <span className="font-mono text-neutral-800">{clusters[hv.b]?.label}</span></>} · density <span className="tabular-nums">{(matrix[hv.a]?.[hv.b] ?? 0).toFixed(2)}</span></span>
        ) : (
          <span className="text-neutral-400">diagonal = a cluster's internal density (hotspot) · off-diagonal = inter-cluster contact · click a cell to drill in</span>
        )}
      </div>
    </div>
  );
}

// MIDDLE — clusters as a table, always sorted by hotspot (internal density). Column height matches the heatmap.
function ClusterTable({ clusters, sel, onSelect, bodyH }: {
  clusters: RelationshipClusters['clusters']; sel: number | null; onSelect: (i: number) => void; bodyH: number;
}) {
  const rows = useMemo(() => [...clusters].sort((a, b) => b.density - a.density), [clusters]);
  return (
    <div className="flex w-56 flex-col gap-1" style={{ height: bodyH }}>
      <div className="flex items-center gap-2 text-[9px] text-neutral-400">
        <span>clusters ({clusters.length})</span>
        <span className="ml-auto">sorted by hotspot</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto rounded border border-neutral-200">
        <table className="w-full text-[11px]">
          <tbody>
            {rows.map((c) => {
              const on = sel === c.id;
              return (
                <tr key={c.id} onClick={() => onSelect(c.id)}
                  className={`cursor-pointer border-t border-neutral-100 first:border-t-0 ${on ? 'bg-neutral-100' : 'hover:bg-neutral-50'}`}>
                  <td className="px-1.5 py-1">
                    <span className="flex items-center gap-1.5">
                      <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: clusterColor(c.id) }} />
                      <span className="truncate font-mono text-neutral-800" title={c.topClass ?? undefined}>{clusterName(c)}</span>
                    </span>
                    <span className="mt-0.5 block h-1 w-full overflow-hidden rounded bg-neutral-100" title={`internal density ${c.density.toFixed(2)}`}>
                      <span className="block h-full rounded" style={{ width: `${Math.max(3, c.density * 100)}%`, background: heat(c.density) }} />
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// RIGHT — the selected cluster's genes (diagonal), or the bridge gene pairs (off-diagonal cell). The
// column is exactly the heatmap height; the scroll body flexes to fill below the header so bottoms align.
function DetailPanel({ data, sel, bridges, unit, focusId, onOpen, onHop, bodyH }: {
  data: RelationshipClusters; sel: { a: number; b: number } | null; bridges: RelationshipBridges | null | undefined; unit: string; focusId?: string; onOpen: (g: Gene) => void; onHop: (a: number, b: number) => void; bodyH: number;
}) {
  if (!sel) return <div className="flex w-72 items-center justify-center rounded border border-dashed border-neutral-200 bg-neutral-50 p-4 text-center text-[11px] text-neutral-400" style={{ height: bodyH }}>select a cluster (table) or a heatmap cell — diagonal for a cluster's genes, off-diagonal for the genes bridging two clusters</div>;

  if (sel.a === sel.b) {
    const c = data.clusters[sel.a];
    const genes = data.genes.slice(c.offset, c.offset + c.size);
    const contacts = data.contact[sel.a].map((v, j) => ({ j, v })).filter((x) => x.j !== sel.a && x.v > 0).sort((a, b) => b.v - a.v).slice(0, 5);
    const netH = Math.max(160, bodyH - (contacts.length ? 66 : 40));
    return (
      <div className="flex w-72 flex-col gap-1" style={{ height: bodyH }}>
        <div className="shrink-0 text-[11px]">
          <div className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: clusterColor(c.id) }} />
            <span className="truncate font-mono font-semibold text-neutral-800">{clusterName(c)}</span>
          </div>
          {c.topClass && <div className="truncate text-[10px] text-neutral-400">{c.topClass}</div>}
        </div>
        {/* A network of the cluster's genes (strongest internal gene–gene links). Falls back to the plain
            list while the edges load or if the cluster has no internal links. */}
        {bridges && bridges.pairs.length
          ? <div className="min-h-0 flex-1 overflow-hidden rounded border border-neutral-200"><ClusterNetwork pairs={bridges.pairs} color={clusterColor(c.id)} hubId={genes[0]?.uniqID} onOpen={onOpen} height={netH} /></div>
          : bridges === undefined
            ? <div className="flex flex-1 items-center justify-center rounded border border-neutral-200 text-[11px] text-neutral-400">loading network…</div>
            : <GeneList genes={genes} focusId={focusId} onOpen={onOpen} />}
        {contacts.length > 0 && (
          <div className="flex shrink-0 flex-wrap items-center gap-1 text-[10px] text-neutral-400">
            contacts:
            {contacts.map(({ j, v }) => (
              <button key={j} type="button" onClick={() => onHop(sel.a, j)} title={`open ${c.label} ↔ ${data.clusters[j].label} bridges`}
                className="cursor-pointer rounded bg-neutral-100 px-1 py-0.5 font-mono text-neutral-700 hover:bg-neutral-200">{data.clusters[j].label} <span className="tabular-nums text-neutral-400">{v.toFixed(2)}</span></button>
            ))}
          </div>
        )}
      </div>
    );
  }

  const A = data.clusters[sel.a], B = data.clusters[sel.b];
  return (
    <div className="flex w-72 flex-col gap-1" style={{ height: bodyH }}>
      <div className="shrink-0 text-[11px]">
        <div className="truncate"><span className="font-mono font-semibold text-neutral-800">{clusterName(A)}</span> <span className="text-neutral-400">↔</span> <span className="font-mono font-semibold text-neutral-800">{clusterName(B)}</span></div>
        <div className="text-[10px] text-neutral-400">{bridges?.pairs.length ?? 0} bridge{(bridges?.pairs.length ?? 0) === 1 ? '' : 's'}</div>
      </div>
      {bridges === undefined ? <div className="flex flex-1 items-center justify-center text-[11px] text-neutral-400">loading…</div>
        : !bridges || !bridges.pairs.length ? <div className="flex flex-1 items-center justify-center px-2 text-center text-[11px] text-neutral-400">no direct {unit} between these clusters</div>
        : (() => {
          const shown = bridges.pairs.slice(0, SANKEY_MAX);
          return (
            <div className="min-h-0 flex-1 overflow-y-auto rounded border border-neutral-200 p-1">
              <BridgeSankey pairs={shown} aId={A.id} bId={B.id} onOpen={onOpen} focusId={focusId} height={Math.max(150, bodyH - 34)} />
              {bridges.pairs.length > shown.length && <div className="pt-1 text-center text-[9px] text-neutral-400">strongest {shown.length} of {bridges.pairs.length} pairs</div>}
            </div>
          );
        })()}
    </div>
  );
}

// A force-directed network of a cluster's genes, built from its strongest internal gene–gene pairs
// (nodes = genes coloured by the cluster, edge width ∝ relationship weight). Node radius scales with a
// gene's GLOBAL weighted degree (Σ edge weights graph-wide, from the API), and the cluster's hub gene
// is marked focal so it reads as the centre of mass. Clicking a gene selects it.
function ClusterNetwork({ pairs, color, hubId, onOpen, height }: {
  pairs: RelationshipBridges['pairs']; color: string; hubId?: string; onOpen: (g: Gene) => void; height: number;
}) {
  const geneById = new Map<string, Gene>();
  const deg = new Map<string, number>(); // global weighted degree, served per gene
  for (const p of pairs) {
    geneById.set(p.a.uniqID, p.a); geneById.set(p.b.uniqID, p.b);
    deg.set(p.a.uniqID, p.a.deg); deg.set(p.b.uniqID, p.b.deg);
  }
  const maxW = Math.max(1e-9, ...pairs.map((p) => p.w));
  const nodes: NetNode[] = [...geneById.values()].map((g) => ({
    id: g.uniqID, label: g.gene || g.uniqID, color, title: g.gene || g.uniqID,
    size: deg.get(g.uniqID) ?? 0, kind: g.uniqID === hubId ? 'focal' : undefined,
  }));
  const edges: NetEdge[] = pairs.map((p) => ({ source: p.a.uniqID, target: p.b.uniqID, weight: p.w / maxW }));
  return <NetworkGraph nodes={nodes} edges={edges} height={height} onNodeClick={(id) => { const g = geneById.get(id); if (g) onOpen(g); }} />;
}

// Bipartite Sankey of the strongest gene–gene bridges between two clusters: cluster A genes on the
// left, cluster B genes on the right; ribbon width ∝ relationship weight, node height ∝ a gene's total
// bridging weight. Click a gene to open it. Sized to fit the panel; scrolls when there are many genes.
function BridgeSankey({ pairs, aId, bId, onOpen, focusId, height }: {
  pairs: RelationshipBridges['pairs']; aId: number; bId: number; onOpen: (g: Gene) => void; focusId?: string; height: number;
}) {
  const W = 270, barW = 7, labelW = 50, gap = 5, minNode = 11, pad = 5;
  const side = (k: 'a' | 'b') => {
    const sum = new Map<string, number>(), gene = new Map<string, Gene>();
    for (const p of pairs) { const g = p[k]; sum.set(g.uniqID, (sum.get(g.uniqID) ?? 0) + p.w); gene.set(g.uniqID, g); }
    return { order: [...sum.entries()].sort((x, y) => y[1] - x[1]), gene };
  };
  const Ls = side('a'), Rs = side('b');
  const T = pairs.reduce((s, p) => s + p.w, 0) || 1;
  const maxN = Math.max(Ls.order.length, Rs.order.length);
  const scale = Math.max(0.0001, (height - 2 * pad - (maxN - 1) * gap) / T);
  const place = (entries: [string, number][]) => {
    let y = pad; const m = new Map<string, { y: number; h: number }>();
    for (const [id, s] of entries) { const h = Math.max(minNode, s * scale); m.set(id, { y, h }); y += h + gap; }
    return m;
  };
  const L = place(Ls.order), R = place(Rs.order);
  const lastY = (m: Map<string, { y: number; h: number }>) => { let b = pad; for (const n of m.values()) b = Math.max(b, n.y + n.h); return b + pad; };
  const svgH = Math.max(lastY(L), lastY(R), height);
  const leftX = labelW, rightX = W - labelW - barW, x1 = leftX + barW, x2 = rightX, mx = (x1 + x2) / 2;
  const lo = new Map<string, number>(), ro = new Map<string, number>();
  const colA = clusterColor(aId), colB = clusterColor(bId);
  const lbl = (g: Gene, x: number, y: number, anchor: 'start' | 'end') =>
    <text x={x} y={y} textAnchor={anchor} dominantBaseline="central" fontSize={8.5}
      className={g.uniqID === focusId ? 'fill-neutral-900 font-semibold' : 'fill-neutral-600'}>{g.gene || g.uniqID}</text>;
  return (
    <svg width={W} height={svgH} className="block">
      {pairs.map((p, i) => {
        const ln = L.get(p.a.uniqID)!, rn = R.get(p.b.uniqID)!, wpx = p.w * scale;
        const so = lo.get(p.a.uniqID) ?? 0, to = ro.get(p.b.uniqID) ?? 0;
        lo.set(p.a.uniqID, so + wpx); ro.set(p.b.uniqID, to + wpx);
        const sy = ln.y + so, ty = rn.y + to;
        const d = `M${x1},${sy} C${mx},${sy} ${mx},${ty} ${x2},${ty} L${x2},${ty + wpx} C${mx},${ty + wpx} ${mx},${sy + wpx} ${x1},${sy + wpx} Z`;
        return <path key={i} d={d} fill={colA} fillOpacity={0.25}><title>{`${p.a.gene} → ${p.b.gene} · ${p.w.toFixed(2)}`}</title></path>;
      })}
      {Ls.order.map(([id]) => { const n = L.get(id)!, g = Ls.gene.get(id)!; return (
        <g key={id} className="cursor-pointer" onClick={() => onOpen(g)}><title>{g.gene || g.uniqID}</title>
          <rect x={leftX} y={n.y} width={barW} height={n.h} rx={1} fill={colA} />{lbl(g, leftX - 4, n.y + n.h / 2, 'end')}</g>
      ); })}
      {Rs.order.map(([id]) => { const n = R.get(id)!, g = Rs.gene.get(id)!; return (
        <g key={id} className="cursor-pointer" onClick={() => onOpen(g)}><title>{g.gene || g.uniqID}</title>
          <rect x={rightX} y={n.y} width={barW} height={n.h} rx={1} fill={colB} />{lbl(g, rightX + barW + 4, n.y + n.h / 2, 'start')}</g>
      ); })}
    </svg>
  );
}

function GeneList({ genes, focusId, onOpen }: { genes: Gene[]; focusId?: string; onOpen: (g: Gene) => void }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto rounded border border-neutral-200">
      <table className="w-full text-[11px]">
        <tbody>
          {genes.map((g, i) => (
            <tr key={g.uniqID} className={`border-t border-neutral-100 first:border-t-0 hover:bg-neutral-50 ${g.uniqID === focusId ? 'bg-amber-50' : ''}`}>
              <td className="px-1.5 py-0.5"><GeneLink g={g} focusId={focusId} onOpen={onOpen} /></td>
              {i === 0 && <td className="px-1.5 py-0.5 text-right text-[9px] text-neutral-300">hub</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GeneLink({ g, focusId, onOpen }: { g: Gene; focusId?: string; onOpen: (g: Gene) => void }) {
  return (
    <button type="button" onClick={() => onOpen(g)} title={`select ${g.gene || g.uniqID}`}
      className={`cursor-pointer font-mono hover:text-neutral-900 ${g.uniqID === focusId ? 'font-bold text-amber-700' : 'text-neutral-700'}`}>{g.gene || g.uniqID}</button>
  );
}
