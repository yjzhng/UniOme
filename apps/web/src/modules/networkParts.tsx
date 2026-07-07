import { Link } from 'react-router-dom';
import { paletteHex } from '../lib/theme';
import { TableScroller } from '../components/TableScroller';

// Shared building blocks for the entity networks (interactions, shared domains): a community-
// detection routine, the group-track stacked bar, and the node detail table.

// Relationship cluster / category colours come from the shared tab10 theme palette.
export { PALETTE } from '../lib/theme';
export const NO_COLOR = '#cbd5e1';
// KEGG top pathway class → one hue from the shared tab10 theme palette, so KG_PC reads consistently
// with the cluster track and every other network, table, pathway map and similarity row.
export const PATHWAY_COLOR: Record<string, string> = {
  Metabolism: paletteHex(0),
  'Genetic Information Processing': paletteHex(1),
  'Environmental Information Processing': paletteHex(2),
  'Cellular Processes': paletteHex(3),
  'Human Diseases': paletteHex(4),
  'Organismal Systems': paletteHex(5),
};
export const kgpcColor = (kgpc: string | null | undefined) => (kgpc ? PATHWAY_COLOR[kgpc] ?? NO_COLOR : NO_COLOR);
// Overlap colour by count of shared features (domains / pathway terms): 1 = peripheral grey, more =
// core (stands out). Shared by the shared-domain and pathway networks.
export const OVERLAP = ['#cbd5e1', '#cbd5e1', '#60a5fa', '#f59e0b', '#dc2626', '#7c3aed', '#0891b2'];
export const overlapColor = (c: number) => OVERLAP[Math.min(c, OVERLAP.length - 1)];
// The force-graph's rendered height for a given node count (mirrors NetworkGraph's own default), so
// the wrapper can size the network AND bound the adjacent node table to the same height.
export const netHeight = (nodeCount: number) => Math.min(460, Math.max(260, 200 + nodeCount * 3));
// Height for a network's loading placeholder, before the node count is known — a representative
// mid-range value so the box closely matches the eventual graph and minimises layout shift.
export const NET_PLACEHOLDER_H = 360;
export type Grp = { key: string; color: string; count: number; label: string }; // one segment of a group track

// Weighted label propagation → a community id per node (undirected). Deterministic tie-break by
// label so it's stable across renders; good enough to surface the dense modules.
export function detectClusters(ids: string[], edges: { source: string; target: string; weight?: number }[]): Map<string, number> {
  const adj = new Map<string, { id: string; w: number }[]>(ids.map((id) => [id, []]));
  for (const e of edges) { adj.get(e.source)?.push({ id: e.target, w: e.weight ?? 0.4 }); adj.get(e.target)?.push({ id: e.source, w: e.weight ?? 0.4 }); }
  const label = new Map(ids.map((id) => [id, id]));
  const order = [...ids].sort();
  for (let it = 0; it < 25; it++) {
    let changed = false;
    for (const id of order) {
      const counts = new Map<string, number>();
      for (const nb of adj.get(id)!) { const l = label.get(nb.id)!; counts.set(l, (counts.get(l) ?? 0) + nb.w); }
      if (!counts.size) continue;
      let best = label.get(id)!, bw = -Infinity;
      for (const [l, w] of counts) if (w > bw || (w === bw && l < best)) { best = l; bw = w; }
      if (best !== label.get(id)) { label.set(id, best); changed = true; }
    }
    if (!changed) break;
  }
  const idxOf = new Map<string, number>(); let n = 0;
  const out = new Map<string, number>();
  for (const id of ids) { const l = label.get(id)!; if (!idxOf.has(l)) idxOf.set(l, n++); out.set(id, idxOf.get(l)!); }
  return out;
}

// A group track: a stacked bar of the distinct groups, each segment sized by its node count and
// coloured by the group colour. Clicking colours the network by it; hovering a segment highlights its
// nodes. `lit` is the set of segment keys to emphasise (a self-hovered segment, OR the groups a
// hovered gene belongs to — so gene↔group highlighting works both ways); null = all at full opacity.
export function GroupTrack({ label, groups, active, onActivate, lit, onHover }: { label: string; groups: Grp[]; active: boolean; onActivate: () => void; lit: Set<string> | null; onHover: (key: string | null) => void }) {
  const total = groups.reduce((s, g) => s + g.count, 0) || 1;
  return (
    <div onClick={onActivate}
      className={`flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-[10px] ${active ? 'bg-neutral-100 ring-1 ring-inset ring-neutral-300' : 'hover:bg-neutral-50'}`}>
      <span className={`w-12 shrink-0 ${active ? 'font-medium text-neutral-800' : 'text-neutral-500'}`}>{label}</span>
      <div className="flex h-4 flex-1 overflow-hidden rounded bg-neutral-100">
        {groups.map((g) => (
          <div key={g.key} title={`${g.label} · ${g.count}`}
            onMouseEnter={(e) => { e.stopPropagation(); onHover(g.key); }} onMouseLeave={() => onHover(null)}
            className="flex items-center justify-center overflow-hidden text-[8px] text-[#fff] transition-opacity"
            style={{ width: `${(g.count / total) * 100}%`, background: g.color, opacity: lit == null || lit.has(g.key) ? 1 : 0.3, boxShadow: 'inset -1px 0 0 #fff' }}>
            {g.count / total > 0.1 ? g.count : ''}
          </div>
        ))}
      </div>
    </div>
  );
}

// All genes in a network, mirroring the colouring: node-colour swatch, group column, connection
// count (degree) and a per-gene metric (interaction score / shared-feature count). Sorted by group.
export function NodeTable({ rows, geneById, route, nodeColor, nodeGroup, hover, onHover, focal, metricLabel, nodeDots, highlight }: { rows: { id: string; conn: number; metric: number | null }[]; geneById: Map<string, string>; route: (id: string) => string; nodeColor: Map<string, string>; nodeGroup: Map<string, string>; hover: string | null; onHover: (id: string | null) => void; focal: string; metricLabel: string; nodeDots?: Map<string, string[]>; highlight?: Set<string> | null }) {
  // Highest metric first (shared count / score) so the strongest-overlap genes are immediately
  // visible; degree breaks ties, then group keeps equal rows tidy.
  const sorted = [...rows].sort((a, b) => (b.metric ?? -Infinity) - (a.metric ?? -Infinity) || b.conn - a.conn || (nodeGroup.get(a.id) ?? '').localeCompare(nodeGroup.get(b.id) ?? ''));
  return (
    // Cap the height so a large cluster/network's gene list scrolls instead of stretching the page
    // (especially on narrow widths); the header stays pinned via TableScroller's sticky <th> styling.
    <TableScroller maxH="max-h-80">
      <table className="w-full text-xs">
        <thead className="text-left text-neutral-500">
          <tr>
            <th className="px-2 py-1 font-medium">gene</th>
            <th className="px-2 py-1 font-medium">group</th>
            <th className="px-2 py-1 font-medium">conn</th>
            <th className="px-2 py-1 font-medium">{metricLabel}</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map(({ id, conn, metric }) => {
            // A hovered group (highlight set) lights its member rows; otherwise sync with the hovered gene.
            const hot = highlight ? highlight.has(id) : hover === id;
            const dim = highlight ? !highlight.has(id) : (hover != null && hover !== focal && hover !== id);
            return (
              <tr key={id} onMouseEnter={() => onHover(id)} onMouseLeave={() => onHover(null)}
                  className={`border-t border-neutral-100 ${hot ? 'bg-neutral-100' : 'hover:bg-neutral-50'}`} style={{ opacity: dim ? 0.45 : 1 }}>
                <td className="px-2 py-1 whitespace-nowrap">
                  {/* One dot per group the gene belongs to (its term colours), else the single active swatch. */}
                  {nodeDots?.get(id)?.length
                    ? <span className="mr-1.5 inline-flex gap-0.5 align-middle">{nodeDots.get(id)!.map((c, i) => <span key={i} className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: c }} />)}</span>
                    : <span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm align-middle" style={{ background: nodeColor.get(id) ?? NO_COLOR }} />}
                  <Link to={route(id)} className="underline decoration-neutral-300 hover:decoration-neutral-700">{geneById.get(id) ?? id}</Link>
                </td>
                <td className="px-2 py-1 text-neutral-600">{nodeGroup.get(id) ?? '—'}</td>
                <td className="px-2 py-1 font-mono text-neutral-500">{conn}</td>
                <td className="px-2 py-1 font-mono text-neutral-500">{metric != null ? (Number.isInteger(metric) ? metric : metric.toFixed(2)) : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </TableScroller>
  );
}
