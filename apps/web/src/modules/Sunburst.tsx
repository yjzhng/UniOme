import { Fragment, useMemo, useState } from 'react';
import type { TreeNode } from './TaxonomyTree';
import { paletteHex } from '../lib/theme';
import { THEME_CHIP } from '../components/Fields';

// A generic hierarchical sunburst (concentric partition) over the SAME TreeNode[] the taxonomy tree uses,
// with the SAME node-id scheme — so selection is shared: clicking a wedge calls onSelect(id) exactly like
// the tree, and the `selected` id lights the matching wedge (+ its ancestors/descendants). Ring per depth
// (section → category → pathway); wedge angle ∝ summed leaf value (gene count). Section colours come from
// the SAME ordered palette the genome browser uses (KG_PC top-class → tab10); inner→outer rings are
// progressively lighter shades of their section colour.
type Arc = { id: string; label: string; depth: number; a0: number; a1: number; path: string[]; value: number; color: string };

const SIZE = 300, CX = 150, CY = 150;
const RINGS: [number, number][] = [[34, 74], [74, 116], [116, 146]]; // [innerR, outerR] per depth
const LIGHTEN = [0.2, 0.5, 0.68]; // blend the section colour toward white by depth (muted, not vivid)
const NO_COLOR = '#a3a3a3'; // section not in the browser's class list → neutral (matches GenomeBrowser)

function value(n: TreeNode): number {
  if (n.children && n.children.length) return n.children.reduce((s, c) => s + value(c), 0);
  return Math.max(n.count ?? 1, 0.001);
}
// linear blend of two #rrggbb colours
function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = (sh: number) => Math.round((((pa >> sh) & 255) * (1 - t)) + (((pb >> sh) & 255) * t));
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`;
}
function layout(nodes: TreeNode[], sectionOrder: string[]): Arc[] {
  const arcs: Arc[] = [];
  const total = nodes.reduce((s, n) => s + value(n), 0) || 1;
  let a = -Math.PI / 2; // start at 12 o'clock
  for (const n of nodes) {
    const idx = sectionOrder.indexOf(n.label);
    const base = idx >= 0 ? paletteHex(idx) : NO_COLOR;
    const span = (value(n) / total) * Math.PI * 2;
    walk(n, a, a + span, 0, [], base, arcs);
    a += span;
  }
  return arcs;
}
function walk(n: TreeNode, a0: number, a1: number, depth: number, ancestors: string[], base: string, out: Arc[]) {
  const path = [...ancestors, n.id];
  out.push({ id: n.id, label: n.label, depth, a0, a1, path, value: value(n), color: mix(base, '#ffffff', LIGHTEN[depth]) });
  const kids = n.children ?? [];
  if (!kids.length || depth >= RINGS.length - 1) return;
  const total = kids.reduce((s, c) => s + value(c), 0) || 1;
  let a = a0;
  for (const c of kids) { const span = ((a1 - a0) * value(c)) / total; walk(c, a, a + span, depth + 1, path, base, out); a += span; }
}
function arcPath(r0: number, r1: number, a0: number, a1: number): string {
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const p = (r: number, a: number) => `${(CX + r * Math.cos(a)).toFixed(2)},${(CY + r * Math.sin(a)).toFixed(2)}`;
  return `M${p(r1, a0)}A${r1},${r1} 0 ${large} 1 ${p(r1, a1)}L${p(r0, a1)}A${r0},${r0} 0 ${large} 0 ${p(r0, a0)}Z`;
}

// The exact wedge colour for a node — its section's palette colour, lightened by depth — so other UI
// (e.g. the map's selected-pathway chip) can match the sunburst.
export function sunburstColor(sectionName: string, depth: number, sectionOrder: string[]): string {
  const idx = sectionOrder.indexOf(sectionName);
  const base = idx >= 0 ? paletteHex(idx) : NO_COLOR;
  return mix(base, '#ffffff', LIGHTEN[Math.min(depth, LIGHTEN.length - 1)] ?? 0);
}

export function Sunburst({ nodes, selected, onSelect, onClear, sectionOrder = [], geneCountOf }: {
  nodes: TreeNode[];
  selected: string | null;
  onSelect: (id: string) => void;
  onClear?: () => void; // clicking empty space (background / centre hole) clears the selection
  sectionOrder?: string[]; // ordered KG_PC class list (genome-browser palette order)
  geneCountOf?: (id: string) => number; // deduped gene count for a node (else the summed arc value)
}) {
  const arcs = useMemo(() => layout(nodes, sectionOrder), [nodes, sectionOrder]);
  const labelById = useMemo(() => new Map(arcs.map((a) => [a.id, a.label])), [arcs]);
  const [hover, setHover] = useState<string | null>(null);
  // the selected wedge's root→node path — a wedge is "on" (bright) if it's an ancestor, the node, or a
  // descendant of the selection (i.e. one path is a prefix of the other); everything else dims.
  const selPath = useMemo(() => arcs.find((a) => a.id === selected)?.path ?? null, [arcs, selected]);
  const on = (a: Arc) => {
    if (!selPath) return true;
    const [short, long] = a.path.length < selPath.length ? [a.path, selPath] : [selPath, a.path];
    return short.every((x, i) => x === long[i]);
  };
  const focus = arcs.find((a) => a.id === (hover ?? selected)) ?? null;
  const hovered = hover ? arcs.find((a) => a.id === hover) : null;
  const count = (id: string) => (geneCountOf ? geneCountOf(id) : (arcs.find((a) => a.id === id)?.value ?? 0));

  return (
    <div>
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="mx-auto block w-full max-w-[210px]" onMouseLeave={() => setHover(null)} onClick={() => onClear?.()}>
        {arcs.map((a) => {
          const [r0, r1] = RINGS[a.depth];
          const isSel = a.id === selected;
          return (
            <path
              key={a.id}
              d={arcPath(r0, r1, a.a0, a.a1)}
              fill={a.color}
              fillOpacity={on(a) ? 0.8 : 0.22}
              className={isSel ? 'stroke-neutral-900' : 'stroke-white'}
              strokeWidth={isSel ? 2 : 0.7}
              style={{ cursor: 'pointer' }}
              onMouseEnter={() => setHover(a.id)}
              onClick={(e) => { e.stopPropagation(); onSelect(a.id); }}
            >
              <title>{a.label}{` · ${count(a.id)} genes`}</title>
            </path>
          );
        })}
        {/* hover tint: re-draw the hovered wedge with a translucent white overlay so it visibly lightens */}
        {hovered && (() => { const [r0, r1] = RINGS[hovered.depth]; return (
          <path d={arcPath(r0, r1, hovered.a0, hovered.a1)} fill="#ffffff" fillOpacity={0.3} className="stroke-neutral-500" strokeWidth={1.2} pointerEvents="none" />
        ); })()}
        <circle cx={CX} cy={CY} r={RINGS[0][0] - 2} className="fill-white" />
      </svg>
      {/* caption: the focused wedge's ancestry as chips + arrows (matching the entry-page general section),
          then a pill with its gene count. FIXED height + overflow-hidden so a 1-chip section vs a 3-chip
          pathway (with long names) never changes the card height and pushes the page around. */}
      <div className="mt-1 flex h-11 flex-wrap content-center items-center justify-center gap-x-1 gap-y-0.5 overflow-hidden">
        {focus ? (
          <>
            {focus.path.map((id, i) => (
              <Fragment key={id}>
                {i > 0 && <span className="text-neutral-400">›</span>}
                <span className={`inline-block max-w-[150px] truncate rounded px-1.5 py-0.5 text-xs ${THEME_CHIP}`}>{labelById.get(id) ?? id}</span>
              </Fragment>
            ))}
            <span className="shrink-0 rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-medium text-neutral-600">{count(focus.id)} genes</span>
          </>
        ) : (
          <span className="text-[11px] text-neutral-400">hover or click a wedge to select a pathway</span>
        )}
      </div>
    </div>
  );
}
