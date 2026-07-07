import { useMemo, useState, type CSSProperties } from 'react';
import { useParams } from 'react-router-dom';
import type { SharedGroup } from '@uniome/shared';
import { NetworkGraph, type NetNode, type NetEdge } from './NetworkGraph';
import { PALETTE, NO_COLOR, overlapColor, type Grp, GroupTrack, NodeTable, netHeight } from './networkParts';
import { NoData } from '../components/Fields';

// The shared-domain network. The point is the SET OVERLAP: which genes share all of the focal's
// domains vs only one. Genes are connected by a clique per domain (everyone sharing a domain is
// linked), edge weight = number of shared domains, and nodes are coloured by their overlap count
// (peripheral → core). A "domain" track lets you highlight each domain's gene set to read overlaps.

type ColorBy = 'overlap' | 'domain';
const MAX_MEMBERS = 40, MAX_NODES = 55; // skip overly-common domains; cap nodes
type Src = { type: string; groups: SharedGroup[] };

export function SharedNetwork({ focalId, focalGene, chrom, sources, unit = 'domain', maxMembers = MAX_MEMBERS }: { focalId: string; focalGene: string; chrom: string; sources: Src[]; unit?: string; maxMembers?: number }) {
  const { taxid } = useParams<{ taxid: string }>();
  const route = (id: string) => `/o/${taxid}/c/${encodeURIComponent(chrom)}/entry/${id}`;
  const [activeType, setActiveType] = useState(sources[0]?.type ?? '');
  const [colorBy, setColorBy] = useState<ColorBy>('overlap');
  const [hover, setHover] = useState<string | null>(null);
  const [hoverGroup, setHoverGroup] = useState<{ mode: ColorBy; key: string } | null>(null);

  const view = useMemo(() => {
    const src = sources.find((s) => s.type === activeType) ?? sources[0];
    if (!src) return null;
    const domains = src.groups
      .map((g) => ({ name: g.name, members: g.members.filter((m) => m.uniqID) as { name: string; uniqID: string }[] }))
      .filter((g) => g.members.length > 0 && g.members.length <= maxMembers);
    if (!domains.length) return null;

    const geneById = new Map<string, string>([[focalId, focalGene]]);
    const sharedCount = new Map<string, number>();
    const sharedDomains = new Map<string, string[]>();
    for (const d of domains) for (const m of d.members) {
      geneById.set(m.uniqID, m.name);
      sharedCount.set(m.uniqID, (sharedCount.get(m.uniqID) ?? 0) + 1);
      (sharedDomains.get(m.uniqID) ?? sharedDomains.set(m.uniqID, []).get(m.uniqID)!).push(d.name);
    }
    const ranked = [...sharedCount.keys()].sort((a, b) => sharedCount.get(b)! - sharedCount.get(a)!).slice(0, MAX_NODES);
    const nodeIds = new Set([focalId, ...ranked]);
    // Node radius = shared count (degree is uninformative here — clique members are all connected),
    // so the highest-overlap genes are the largest. Focal shares every term.
    const nodes: NetNode[] = [{ id: focalId, label: focalGene, kind: 'focal', size: domains.length }, ...ranked.map((id) => ({ id, label: geneById.get(id) ?? id, kind: 'neighbor' as const, link: route(id), size: sharedCount.get(id) ?? 1 }))];

    // Edges: each domain links (focal + its members) into a clique; weight = number of shared domains.
    const ew = new Map<string, number>();
    const domainMembers = new Map<string, Set<string>>();
    for (const d of domains) {
      const inSet = d.members.map((m) => m.uniqID).filter((id) => nodeIds.has(id));
      domainMembers.set(d.name, new Set(inSet));
      const mem = [focalId, ...inSet];
      for (let i = 0; i < mem.length; i++) for (let j = i + 1; j < mem.length; j++) {
        const [a, b] = mem[i] < mem[j] ? [mem[i], mem[j]] : [mem[j], mem[i]];
        ew.set(`${a}|${b}`, (ew.get(`${a}|${b}`) ?? 0) + 1);
      }
    }
    const maxShared = Math.max(1, ...ranked.map((id) => sharedCount.get(id) ?? 0));
    const netEdges: NetEdge[] = [...ew].map(([k, w]) => { const [s, t] = k.split('|'); return { source: s, target: t, weight: Math.min(1, w / maxShared), title: `${geneById.get(s)} – ${geneById.get(t)} · ${w} shared ${unit}${w > 1 ? 's' : ''}` }; });

    // Groupings: overlap (by shared count) and domain (by most-specific shared domain).
    const domainSize = new Map(domains.map((d) => [d.name, d.members.length]));
    const domainColorOf = new Map(domains.slice().sort((a, b) => b.members.length - a.members.length).map((d, i) => [d.name, PALETTE[i % PALETTE.length]]));
    const sortedTerms = (id: string) => (sharedDomains.get(id) ?? []).slice().sort((a, b) => domainSize.get(a)! - domainSize.get(b)!);
    const primaryDomain = (id: string) => sortedTerms(id)[0] ?? '—'; // most specific (smallest) → drives the node colour
    const allTerms = (id: string) => sortedTerms(id).join('; ') || '—'; // full list → the table cell, so a multi-term gene isn't shown as if it shares only one (semicolon-joined: term names contain commas)
    const overlapMembers = new Map<string, Set<string>>();
    nodes.forEach((n) => { if (n.id === focalId) return; const k = String(sharedCount.get(n.id) ?? 0); (overlapMembers.get(k) ?? overlapMembers.set(k, new Set()).get(k)!).add(n.id); });
    const overlapGroups: Grp[] = [...overlapMembers.entries()].sort((a, b) => Number(b[0]) - Number(a[0])).map(([key, set]) => ({ key, color: overlapColor(Number(key)), count: set.size, label: `${key} ${unit}${Number(key) > 1 ? 's' : ''}` }));
    const domainGroups: Grp[] = domains.slice().sort((a, b) => (domainMembers.get(b.name)?.size ?? 0) - (domainMembers.get(a.name)?.size ?? 0)).map((d) => ({ key: d.name, color: domainColorOf.get(d.name)!, count: domainMembers.get(d.name)?.size ?? 0, label: d.name }));

    // Active colouring → node colours + group label (mirrored by the table).
    const useOverlap = colorBy === 'overlap';
    const nodeColor = new Map<string, string>();
    const nodeGroup = new Map<string, string>();
    nodes.forEach((n) => {
      if (n.id === focalId) { const c = useOverlap ? overlapColor(domains.length) : '#334155'; n.color = c; nodeColor.set(n.id, c); nodeGroup.set(n.id, useOverlap ? `${domains.length} ${unit}s` : 'focal'); return; }
      const cnt = sharedCount.get(n.id) ?? 0;
      const c = useOverlap ? overlapColor(cnt) : (domainColorOf.get(primaryDomain(n.id)) ?? NO_COLOR);
      n.color = c; nodeColor.set(n.id, c); nodeGroup.set(n.id, useOverlap ? `${cnt} ${unit}${cnt > 1 ? 's' : ''}` : allTerms(n.id));
    });

    const degree = new Map<string, number>();
    for (const e of netEdges) { degree.set(e.source, (degree.get(e.source) ?? 0) + 1); degree.set(e.target, (degree.get(e.target) ?? 0) + 1); }
    const tableRows = ranked.map((id) => ({ id, conn: degree.get(id) ?? 0, metric: sharedCount.get(id) ?? 0 }));
    // Table swatches mirror the ACTIVE track: under the term track, a dot per term the gene shares
    // (each in that term's colour); under the overlap track, the single overlap-count colour (via the
    // nodeColor fallback) — so the table never mixes a term colour into an overlap-coloured view.
    const nodeDots = useOverlap ? undefined : new Map<string, string[]>(ranked.map((id) => [id, sortedTerms(id).map((t) => domainColorOf.get(t)!).filter(Boolean)]));

    return { nodes, netEdges, focal: focalId, geneById, overlapGroups, domainGroups, overlapMembers, domainMembers, nodeColor, nodeGroup, nodeDots, tableRows, nDomains: domains.length, geneTerms: sharedDomains, sharedCount };
  }, [sources, activeType, colorBy, focalId, focalGene, taxid, chrom]);

  if (!view) return <NoData />;
  // Highlight a group's gene set; include the focal so its spokes to those genes stay lit too.
  const groupSet = hoverGroup ? (hoverGroup.mode === 'overlap' ? view.overlapMembers : view.domainMembers).get(hoverGroup.key) : null;
  const highlight = groupSet ? new Set([view.focal, ...groupSet]) : null;
  const netH = netHeight(view.nodes.length);
  // Track segments to light: a hovered gene lights the terms it belongs to (focal = all); else the
  // self-hovered segment. Reverse of the group→table/graph highlight, so it works both ways.
  const focalHover = hover === view.focal;
  const termLit = hover ? new Set(focalHover ? view.domainGroups.map((g) => g.key) : view.geneTerms.get(hover) ?? []) : hoverGroup?.mode === 'domain' ? new Set([hoverGroup.key]) : null;
  const overlapLit = hover ? new Set([String(focalHover ? view.nDomains : view.sharedCount.get(hover) ?? 0)]) : hoverGroup?.mode === 'overlap' ? new Set([hoverGroup.key]) : null;

  return (
    <div className="grid min-w-0 grid-cols-1 gap-x-4 gap-y-2 lg:grid-cols-2 lg:items-start">
      <div className="min-w-0 space-y-1.5">
        {sources.length > 1 && (
          <div className="flex flex-wrap items-center gap-1 text-[10px]">
            <span className="mr-0.5 text-neutral-400">source</span>
            {sources.map((s) => (
              <button key={s.type} type="button" onClick={() => setActiveType(s.type)}
                className={`rounded px-1.5 py-0.5 ${activeType === s.type ? 'bg-neutral-800 text-white' : 'text-neutral-600 hover:bg-neutral-100'}`}>{s.type}</button>
            ))}
          </div>
        )}
        <NetworkGraph nodes={view.nodes} edges={view.netEdges} height={netH} hovered={hover} onHover={setHover} highlight={highlight} />
        <div className="text-[10px] text-neutral-400">{view.nodes.length - 1} genes share ≥1 of {view.nDomains} {unit}s · edge ∝ # shared · scroll to zoom · drag to pan</div>
      </div>
      <div className="min-w-0 space-y-1.5 lg:flex lg:h-[var(--neth)] lg:flex-col lg:gap-1.5 lg:space-y-0" style={{ ['--neth']: `${netH}px` } as CSSProperties}>
        <div className="space-y-0.5">
          <div className="text-[10px] uppercase tracking-wide text-neutral-400">group · click to colour · hover to highlight its gene set</div>
          <GroupTrack label="overlap" groups={view.overlapGroups} active={colorBy === 'overlap'} onActivate={() => setColorBy('overlap')}
            lit={overlapLit} onHover={(k) => setHoverGroup(k ? { mode: 'overlap', key: k } : null)} />
          <GroupTrack label={unit} groups={view.domainGroups} active={colorBy === 'domain'} onActivate={() => setColorBy('domain')}
            lit={termLit} onHover={(k) => setHoverGroup(k ? { mode: 'domain', key: k } : null)} />
        </div>
        <div className="min-h-0 overflow-y-auto lg:flex-1">
          <NodeTable rows={view.tableRows} geneById={view.geneById} route={route} nodeColor={view.nodeColor} nodeGroup={view.nodeGroup} nodeDots={view.nodeDots} hover={hover} onHover={setHover} focal={view.focal} metricLabel="shared" highlight={highlight} />
        </div>
      </div>
    </div>
  );
}
