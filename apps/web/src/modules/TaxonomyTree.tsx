import { useEffect, useState } from 'react';

// A generic, reusable hierarchical taxonomy tree: collapsible internal nodes + selectable leaves, with
// an optional count badge per node. Selection is controlled by the parent (`selected` / `onSelect`), so
// the tree is a pure navigator — it doesn't own what a selection means. Used by the Pathways browser to
// show the KEGG BRITE taxonomy (section → category → pathway), but knows nothing pathway-specific.
export type TreeNode = { id: string; label: string; count?: number; children?: TreeNode[] };

export function TaxonomyTree({ nodes, selected, onSelect, defaultExpandDepth = 1 }: {
  nodes: TreeNode[];
  selected: string | null;
  onSelect: (id: string) => void;
  defaultExpandDepth?: number; // internal nodes at depth < this start expanded
}) {
  return (
    <ul className="select-none text-xs text-neutral-700">
      {nodes.map((n) => (
        <TreeItem key={n.id} node={n} depth={0} selected={selected} onSelect={onSelect} defaultExpandDepth={defaultExpandDepth} />
      ))}
    </ul>
  );
}

// does this subtree contain the selected leaf? (used to auto-reveal a selection made elsewhere)
function contains(node: TreeNode, id: string | null): boolean {
  if (!id) return false;
  if (node.id === id) return true;
  return (node.children ?? []).some((c) => contains(c, id));
}

function TreeItem({ node, depth, selected, onSelect, defaultExpandDepth }: {
  node: TreeNode; depth: number; selected: string | null; onSelect: (id: string) => void; defaultExpandDepth: number;
}) {
  const kids = node.children ?? [];
  const isBranch = kids.length > 0;
  const hasSel = contains(node, selected);
  const [open, setOpen] = useState(() => depth < defaultExpandDepth || hasSel);
  // reveal the selection when it moves into this subtree (e.g. a map-link jump), without collapsing
  // branches the user opened by hand.
  useEffect(() => { if (hasSel) setOpen(true); }, [hasSel]);

  const isSelected = node.id === selected;

  // Branch: chevron toggles expand/collapse; the LABEL selects the branch (highlighting every pathway
  // under it) — so sections and categories are selectable too, not just leaf pathways.
  if (isBranch) {
    return (
      <li>
        <div className={`flex items-center gap-1 rounded ${isSelected ? 'bg-blue-50 dark:bg-blue-950' : 'hover:bg-neutral-100'}`} style={{ paddingLeft: `${depth * 12 + 4}px` }}>
          <button type="button" onClick={() => setOpen((o) => !o)} className="w-4 shrink-0 text-[15px] leading-none text-neutral-500" aria-label={open ? 'collapse' : 'expand'}>{open ? '▾' : '▸'}</button>
          {/* collapsed branches read grey, expanded ones dark — so the open/closed state is obvious at a glance */}
          <button type="button" onClick={() => onSelect(node.id)} className={`min-w-0 flex-1 truncate py-0.5 text-left font-medium ${isSelected ? 'text-blue-700 dark:text-blue-200' : open ? 'text-neutral-800' : 'text-neutral-400'}`}>{node.label}</button>
          {/* higher-level items show a plain aggregate count (leaves get the chip below) */}
          {node.count != null && <span className="shrink-0 pr-1.5 text-[10px] tabular-nums text-neutral-400">{node.count}</span>}
        </div>
        {open && <ul>{kids.map((c) => <TreeItem key={c.id} node={c} depth={depth + 1} selected={selected} onSelect={onSelect} defaultExpandDepth={defaultExpandDepth} />)}</ul>}
      </li>
    );
  }

  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(node.id)}
        className={`flex w-full items-center gap-1 rounded py-0.5 pr-1 text-left ${isSelected ? 'bg-blue-50 font-medium text-blue-700 dark:bg-blue-950 dark:text-blue-200' : 'hover:bg-neutral-100'}`}
        style={{ paddingLeft: `${depth * 12 + 16}px` }}
      >
        <span className="min-w-0 flex-1 truncate">{node.label}</span>
        {node.count != null && <span className="shrink-0 rounded-full bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium text-neutral-500">{node.count}</span>}
      </button>
    </li>
  );
}
