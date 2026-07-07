import { useEffect, useState } from 'react';
import type { ProteinReactions } from '@uniome/shared';
import { InfoTip, NoData } from './Fields';
import { SOURCE_INFO } from '../sourceInfo';
import { ReactionView } from '../modules/ReactionView';

// Catalysed reactions (UniProt catalytic activity → Rhea). Rendered as a full-width block (like the
// sequence) — a label on its own line, the structural ReactionView spanning the whole column —
// rather than in the narrow label/value field grid. "no data" for a non-enzyme.
export function ReactionsField({ taxid, acc }: { taxid: string; acc: string | null }) {
  const [data, setData] = useState<ProteinReactions | null | undefined>(undefined);
  useEffect(() => {
    if (!acc) { setData(null); return; }
    let cancelled = false;
    setData(undefined);
    fetch(`/api/organism/${taxid}/protein/${encodeURIComponent(acc)}/reactions`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => !cancelled && setData(d))
      .catch(() => !cancelled && setData(null));
    return () => { cancelled = true; };
  }, [taxid, acc]);

  return (
    <div className="space-y-1 pt-1">
      <div className="flex items-center gap-1 text-xs uppercase tracking-wide text-neutral-500">
        reactions
        <InfoTip text={SOURCE_INFO.reactions} />
      </div>
      <div className="min-w-0">
        {data === undefined ? (
          <span className="text-xs text-neutral-400">loading…</span>
        ) : !data?.reactions.length ? (
          <NoData />
        ) : (
          <div className="max-h-96 overflow-y-auto pr-1">
            <ReactionView reactions={data.reactions} />
          </div>
        )}
      </div>
    </div>
  );
}
