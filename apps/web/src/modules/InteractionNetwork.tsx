import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useParams } from 'react-router-dom';
import type { InteractionNetwork as NetData } from '@uniome/shared';
import { NetworkGraph, type NetNode, type NetEdge } from './NetworkGraph';
import { LoadingBox } from '../components/Fields';
import { PALETTE, NO_COLOR, PATHWAY_COLOR, type Grp, detectClusters, GroupTrack, NodeTable, netHeight, NET_PLACEHOLDER_H } from './networkParts';

type Cat = 'STRING physical' | 'STRING predicted' | 'IntAct' | 'RNAInter';
const CATS: Cat[] = ['STRING physical', 'STRING predicted', 'IntAct', 'RNAInter'];
const CAT_COLOR: Record<Cat, string> = {
  'STRING physical': '#6366f1',
  'STRING predicted': '#a5b4fc',
  IntAct: '#0891b2',
  RNAInter: '#16a34a',
};
const catOf = (e: { db: string; physical: boolean }): Cat =>
  e.db === 'IntAct' ? 'IntAct' : e.db === 'RNAInter' ? 'RNAInter' : e.physical ? 'STRING physical' : 'STRING predicted';

// Node colouring. 'cluster' = detected communities (topology); 'pathway' = KEGG top class (function).
type ColorBy = 'cluster' | 'pathway';

// The focal gene's molecular-interaction network as a true graph: nodes = the focal + its top
// partners, edges = ALL interactions among that set (the induced subgraph from the API), so
// tightly-interacting groups cluster. Edges coloured by evidence DB, thickness ∝ confidence; the
// legend doubles as a source filter; scroll to zoom, drag to pan, click a node to open it.
export function InteractionNetwork({ uniqID, chrom }: { uniqID: string; chrom: string }) {
  const { taxid } = useParams<{ taxid: string }>();
  const [data, setData] = useState<NetData | null | undefined>(undefined);
  // Single active source ('all' = every DB combined); only one shown at a time.
  const [active, setActive] = useState<Cat | 'all'>('all');
  const [colorBy, setColorBy] = useState<ColorBy>('cluster');
  const [hover, setHover] = useState<string | null>(null); // shared with the network + the table
  const [hoverGroup, setHoverGroup] = useState<{ mode: ColorBy; key: string } | null>(null);
  useEffect(() => {
    let cancelled = false;
    setData(undefined); setHover(null);
    fetch(`/api/organism/${taxid}/features/${encodeURIComponent(uniqID)}/interaction-network`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => !cancelled && setData(d))
      .catch(() => !cancelled && setData(null));
    return () => { cancelled = true; };
  }, [taxid, uniqID]);

  const base = useMemo(() => {
    if (!data) return null;
    const route = (id: string) => `/o/${taxid}/c/${encodeURIComponent(chrom)}/entry/${id}`;
    const geneById = new Map(data.nodes.map((n) => [n.uniqID, n.gene]));
    const tagged = data.edges.map((e) => ({ e, cat: catOf(e) }));
    const present = CATS.filter((c) => tagged.some((t) => t.cat === c));
    return { route, geneById, tagged, present };
  }, [data, taxid, chrom]);

  // Default to the first present source (STRING physical when available), reset on gene change.
  useEffect(() => { if (base) setActive(base.present[0] ?? 'all'); }, [base]);

  const view = useMemo(() => {
    if (!data || !base) return null;
    const edges = active === 'all' ? base.tagged : base.tagged.filter((t) => t.cat === active);
    const keep = new Set<string>([data.focal]);
    for (const { e } of edges) { keep.add(e.source); keep.add(e.target); }
    const nodes: NetNode[] = data.nodes.filter((n) => keep.has(n.uniqID)).map((n) => ({ id: n.uniqID, label: n.gene, kind: n.uniqID === data.focal ? 'focal' : 'neighbor', link: base.route(n.uniqID) }));
    const netEdges: NetEdge[] = edges.map(({ e, cat }) => ({ source: e.source, target: e.target, weight: e.score, color: CAT_COLOR[cat], title: `${base.geneById.get(e.source)} – ${base.geneById.get(e.target)} · ${e.dbs.join('/')} · ${e.score.toFixed(2)}` }));

    // Group every node both ways (community + KEGG class), so both group tracks can render and the
    // active one drives node colours.
    const cl = detectClusters(nodes.map((n) => n.id), netEdges);
    const kgById = new Map(data.nodes.map((n) => [n.uniqID, n.kgpc]));
    const clusterKey = (id: string) => String(cl.get(id) ?? 0);
    const pathwayKey = (id: string) => kgById.get(id) || 'unclassified';
    const clusterColor = (key: string) => PALETTE[Number(key) % PALETTE.length];
    const pathwayColor = (key: string) => (key === 'unclassified' ? NO_COLOR : PATHWAY_COLOR[key] ?? NO_COLOR);
    const clusterLabel = (key: string) => `cluster ${Number(key) + 1}`;
    const membersBy = (keyFn: (id: string) => string) => {
      const m = new Map<string, Set<string>>();
      nodes.forEach((n) => { const k = keyFn(n.id); (m.get(k) ?? m.set(k, new Set()).get(k)!).add(n.id); });
      return m;
    };
    const clusterMembers = membersBy(clusterKey);
    const pathwayMembers = membersBy(pathwayKey);
    const toGroups = (m: Map<string, Set<string>>, color: (k: string) => string, label: (k: string) => string): Grp[] =>
      [...m.entries()].sort((a, b) => b[1].size - a[1].size).map(([key, set]) => ({ key, color: color(key), count: set.size, label: label(key) }));
    const clusterGroups = toGroups(clusterMembers, clusterColor, clusterLabel);
    const pathwayGroups = toGroups(pathwayMembers, pathwayColor, (k) => k);

    // Active colouring → node colours + per-node group label (mirrored by the table).
    const useCluster = colorBy === 'cluster';
    const nodeColor = new Map<string, string>();
    const nodeGroup = new Map<string, string>();
    nodes.forEach((n) => {
      const key = useCluster ? clusterKey(n.id) : pathwayKey(n.id);
      const col = useCluster ? clusterColor(key) : pathwayColor(key);
      n.color = col; nodeColor.set(n.id, col); nodeGroup.set(n.id, useCluster ? clusterLabel(key) : key);
    });

    // Degree (connections within the shown graph) + this gene's edge score, for the table — over ALL nodes.
    const degree = new Map<string, number>();
    for (const e of netEdges) { degree.set(e.source, (degree.get(e.source) ?? 0) + 1); degree.set(e.target, (degree.get(e.target) ?? 0) + 1); }
    const focalScore = new Map<string, number>();
    for (const { e } of edges) { if (e.source === data.focal) focalScore.set(e.target, e.score); else if (e.target === data.focal) focalScore.set(e.source, e.score); }
    const tableRows = nodes.filter((n) => n.id !== data.focal).map((n) => ({ id: n.id, conn: degree.get(n.id) ?? 0, metric: focalScore.get(n.id) ?? null }));

    const nn = edges.filter(({ e }) => e.source !== data.focal && e.target !== data.focal).length;
    // Per-gene group keys, so hovering a gene can light the cluster/pathway segments it belongs to.
    const clusterKeyById = new Map(nodes.map((n) => [n.id, clusterKey(n.id)]));
    const pathwayKeyById = new Map(nodes.map((n) => [n.id, pathwayKey(n.id)]));
    return { nodes, netEdges, nn, focal: data.focal, clusterGroups, pathwayGroups, clusterMembers, pathwayMembers, nodeColor, nodeGroup, tableRows, clusterKeyById, pathwayKeyById };
  }, [data, base, active, colorBy]);

  if (data === undefined) return <LoadingBox height={NET_PLACEHOLDER_H} label="loading network…" />;
  if (!base || !base.tagged.length) return <LoadingBox loading={false} label="no interactions" height={NET_PLACEHOLDER_H} />;

  // Hovering a group segment highlights all its nodes in the network.
  const highlight = hoverGroup ? (hoverGroup.mode === 'cluster' ? view!.clusterMembers : view!.pathwayMembers).get(hoverGroup.key) ?? null : null;
  const netH = netHeight(view!.nodes.length); // bound the table column to the network height
  // Reverse: a hovered gene lights the cluster/pathway segment it belongs to; else the self-hovered segment.
  const clusterLit = hover ? new Set([view!.clusterKeyById.get(hover)].filter(Boolean) as string[]) : hoverGroup?.mode === 'cluster' ? new Set([hoverGroup.key]) : null;
  const pathwayLit = hover ? new Set([view!.pathwayKeyById.get(hover)].filter(Boolean) as string[]) : hoverGroup?.mode === 'pathway' ? new Set([hoverGroup.key]) : null;

  return (
    <div className="grid min-w-0 grid-cols-1 gap-x-4 gap-y-2 lg:grid-cols-2 lg:items-start">
      {/* Left: source toggle + network */}
      <div className="min-w-0 space-y-1.5">
        <div className="flex flex-wrap items-center gap-1 text-[10px]">
          <span className="mr-0.5 text-neutral-400">source</span>
          {([...base.present, 'all'] as (Cat | 'all')[]).map((c) => {
            const on = active === c;
            return (
              <button key={c} type="button" onClick={() => setActive(c)}
                className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 ${on ? 'bg-neutral-800 text-white' : 'text-neutral-600 hover:bg-neutral-100'}`}>
                {c !== 'all' && <span className="inline-block h-[2px] w-3 align-middle" style={{ background: CAT_COLOR[c] }} />}
                {c}
              </button>
            );
          })}
        </div>
        <NetworkGraph nodes={view!.nodes} edges={view!.netEdges} height={netH} hovered={hover} onHover={setHover} highlight={highlight} />
        <div className="text-[10px] text-neutral-400">{view!.nodes.length - 1} partners, {view!.nn} co-interactions · scroll to zoom · drag to pan</div>
      </div>
      {/* Right: group tracks (active = node colouring) + node table — bounded to the network height */}
      <div className="min-w-0 space-y-1.5 lg:flex lg:h-[var(--neth)] lg:flex-col lg:gap-1.5 lg:space-y-0" style={{ ['--neth']: `${netH}px` } as CSSProperties}>
        <div className="space-y-0.5">
          <div className="text-[10px] uppercase tracking-wide text-neutral-400">group · click a track to colour by it · hover a segment to highlight</div>
          <GroupTrack label="cluster" groups={view!.clusterGroups} active={colorBy === 'cluster'} onActivate={() => setColorBy('cluster')}
            lit={clusterLit} onHover={(k) => setHoverGroup(k ? { mode: 'cluster', key: k } : null)} />
          <GroupTrack label="pathway" groups={view!.pathwayGroups} active={colorBy === 'pathway'} onActivate={() => setColorBy('pathway')}
            lit={pathwayLit} onHover={(k) => setHoverGroup(k ? { mode: 'pathway', key: k } : null)} />
        </div>
        <div className="min-h-0 overflow-y-auto lg:flex-1">
          <NodeTable rows={view!.tableRows} geneById={base.geneById} route={base.route} nodeColor={view!.nodeColor} nodeGroup={view!.nodeGroup} hover={hover} onHover={setHover} focal={view!.focal} metricLabel="score" highlight={highlight} />
        </div>
      </div>
    </div>
  );
}
