import { useEffect, useMemo, useState } from 'react';
import type { PathwayTaxonomy } from '@uniome/shared';
import { LoadingBox } from '../components/Fields';
import { MAP_H } from './PathwayMap';
import { PathwayOverview } from './OverviewMap';
import { TaxonomyTree, type TreeNode } from './TaxonomyTree';
import { Sunburst, sunburstColor } from './Sunburst';

// The organism-level Pathways browser. ONE selection (`sel` = a taxonomy node id — a section, category or
// pathway) is shared across three synced views: the sunburst and the taxonomy tree (both navigators) and
// the whole-organism metabolic map (which highlights every gene under the selected node). Clicking the
// same node again — or empty map space — clears it. The map is the exact entry-page element.
export function PathwayBrowser({ taxid, chrom }: { taxid: string; chrom: string }) {
  const [tax, setTax] = useState<PathwayTaxonomy | null | undefined>(undefined);
  const [members, setMembers] = useState<Record<string, string[]> | null>(null); // pathway id → member genes
  const [sectionOrder, setSectionOrder] = useState<string[]>([]); // KG_PC top-class order = genome-browser palette order
  const [sel, setSel] = useState<string | null>(null);
  const [related, setRelated] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    setTax(undefined); setSel(null);
    fetch(`/api/organism/${taxid}/pathway-taxonomy`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: PathwayTaxonomy | null) => {
        if (cancelled) return;
        setTax(d);
        // no default selection — land on the full metabolic map and let the user pick (auto-selecting the
        // first pathway in BRITE order was arbitrary: it highlighted "Nitrogen cycle")
      })
      .catch(() => !cancelled && setTax(null));
    return () => { cancelled = true; };
  }, [taxid]);

  useEffect(() => {
    let cancelled = false;
    setMembers(null); setSectionOrder([]);
    fetch(`/api/organism/${taxid}/pathway-genes`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Record<string, string[]> | null) => !cancelled && setMembers(d))
      .catch(() => !cancelled && setMembers(null));
    // the genome browser's KG_PC (top pathway class) order → the sunburst reuses its exact palette mapping
    fetch(`/api/organism/${taxid}/categories/KG_PC`)
      .then((r) => (r.ok ? r.json() : []))
      .then((d: string[]) => !cancelled && setSectionOrder(Array.isArray(d) ? d : []))
      .catch(() => {});
    return () => { cancelled = true; };
  }, [taxid]);

  // node id → its display label + { section, depth } (for the map's floating title chip: label + colour).
  const nodeInfo = useMemo(() => {
    const m = new Map<string, { label: string; section: string; depth: number }>();
    for (const s of tax?.sections ?? []) {
      m.set(`sec:${s.name}`, { label: s.name, section: s.name, depth: 0 });
      for (const c of s.categories) {
        m.set(`cat:${s.name}:${c.name}`, { label: c.name, section: s.name, depth: 1 });
        for (const p of c.pathways) m.set(p.id, { label: p.name, section: s.name, depth: 2 });
      }
    }
    return m;
  }, [tax]);

  // category label → its node id (categories are unique within a section; map labels are metabolism cats).
  const catIdByLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const [id, info] of nodeInfo) if (info.depth === 1) m.set(info.label, id);
    return m;
  }, [nodeInfo]);

  // node id → the pathway ids under it (itself if it's a leaf pathway), so any node resolves to a gene set.
  const descPids = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const s of tax?.sections ?? []) {
      const secPids: string[] = [];
      for (const c of s.categories) {
        const catPids = c.pathways.map((p) => p.id);
        m.set(`cat:${s.name}:${c.name}`, catPids);
        for (const p of c.pathways) m.set(p.id, [p.id]);
        secPids.push(...catPids);
      }
      m.set(`sec:${s.name}`, secPids);
    }
    return m;
  }, [tax]);

  // the selected node's gene set — union of member genes across all pathways under it.
  useEffect(() => {
    if (!sel || !members) { setRelated(new Set()); return; }
    const s = new Set<string>();
    for (const pid of descPids.get(sel) ?? []) for (const u of members[pid] ?? []) s.add(u);
    setRelated(s);
  }, [sel, members, descPids]);

  // deduped gene count per node (union across its pathways) — for the count badges + sunburst caption.
  const geneCount = useMemo(() => {
    const m = new Map<string, number>();
    if (!members) return m;
    for (const [id, pids] of descPids) {
      const s = new Set<string>();
      for (const pid of pids) for (const u of members[pid] ?? []) s.add(u);
      m.set(id, s.size);
    }
    return m;
  }, [descPids, members]);

  // taxonomy → generic tree/sunburst nodes (shared id scheme). Category-name keys are prefixed to stay
  // unique across sections. Every node carries a deduped gene count (branches too, once members load).
  const nodes: TreeNode[] = useMemo(() => (tax?.sections ?? []).map((s) => ({
    id: `sec:${s.name}`,
    label: s.name,
    count: geneCount.get(`sec:${s.name}`),
    children: s.categories.map((c) => ({
      id: `cat:${s.name}:${c.name}`,
      label: c.name,
      count: geneCount.get(`cat:${s.name}:${c.name}`),
      children: c.pathways.map((p) => ({ id: p.id, label: p.name, count: p.genes })),
    })),
  })), [tax, geneCount]);

  // the whole-cell overview map id is <orgcode>01100 — orgcode = the letter prefix of any pathway id.
  const overviewId = useMemo(() => {
    const anyId = tax?.sections?.[0]?.categories?.[0]?.pathways?.[0]?.id ?? '';
    const m = anyId.match(/^([a-z]+)\d/);
    return m ? `${m[1]}01100` : null;
  }, [tax]);

  if (tax === undefined) return <LoadingBox height={MAP_H} label="loading pathways…" />;
  if (tax === null || !tax.sections.length) return <LoadingBox loading={false} label="no pathways" height={MAP_H} />;

  const toggle = (id: string) => setSel((cur) => (cur === id ? null : id)); // click the selection again to clear
  // clicking a category label on the map selects that category through the SAME model as the list, so both
  // light the identical (membership) gene set — not the map's tighter dominant-category territory subset.
  const selectCategory = (label: string) => { const id = catIdByLabel.get(label); if (id) toggle(id); };

  return (
    // items-stretch makes the left column match the map column's (taller) height. The tree card is absolutely
    // positioned on lg (so its long content doesn't inflate the column) filling from under the sunburst to the
    // column bottom — i.e. it lines up with the bottom of the map, footer subtitle included.
    <div className="flex flex-col gap-3 lg:flex-row lg:items-stretch">
      <div className="relative flex w-full shrink-0 flex-col gap-2 lg:w-80">
        <div className="shrink-0 rounded border border-neutral-200 bg-white p-2">
          <Sunburst nodes={nodes} selected={sel} onSelect={toggle} onClear={() => setSel(null)} sectionOrder={sectionOrder} geneCountOf={(id) => geneCount.get(id) ?? 0} />
        </div>
        <div className="max-h-[300px] overflow-y-auto rounded border border-neutral-200 bg-neutral-50 p-1.5 lg:absolute lg:inset-x-0 lg:bottom-0 lg:top-[282px] lg:max-h-none">
          <TaxonomyTree nodes={nodes} selected={sel} onSelect={toggle} />
        </div>
      </div>
      <div className="min-w-0 flex-1">
        {/* clicking empty map space also clears the selection */}
        <PathwayOverview overviewId={overviewId} chrom={chrom} related={related} onClear={() => setSel(null)} onCategory={selectCategory}
          title={sel ? nodeInfo.get(sel)?.label ?? null : null}
          titleColor={sel && nodeInfo.get(sel) ? sunburstColor(nodeInfo.get(sel)!.section, nodeInfo.get(sel)!.depth, sectionOrder) : null} />
      </div>
    </div>
  );
}
