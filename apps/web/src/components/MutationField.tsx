import { useEffect, useState } from 'react';
import type { Mutation } from '@uniome/shared';
import { DIST_FILL, Field, levelClass, levelHex, VizPlaceholder, type Level } from './Fields';
import { Distribution, useDistributions } from './Distribution';
import { useThresholds } from '../lib/thresholds';
import { getSourceInfo } from '../sourceInfo';

// Binary classifier: the top X% mutability is flagged "high" (red); everything else is "low". One
// shared "top X%" cut (also the explorer's line).
const cat = (pct: number, top: number): Level => (pct > (1 - top) * 100 ? 'high' : 'low');
// Per-locus experimental mutation frequency for the General section: the intrinsic mutation rate
// from mutation-accumulation WGS of MMR-defective E. coli (Foster 2018) — distinct from conservation
// (natural diversity). Chip by genome-wide percentile; value shows events/kb.
export function MutationField({ taxid, uniqID }: { taxid: string; uniqID: string }) {
  const INFO = getSourceInfo('mutation', taxid);
  const [data, setData] = useState<Mutation | null | undefined>(undefined);
  const { top } = useThresholds();
  const dist = useDistributions(taxid);
  useEffect(() => {
    let cancelled = false;
    setData(undefined);
    fetch(`/api/organism/${taxid}/features/${encodeURIComponent(uniqID)}/mutation`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => !cancelled && setData(d))
      .catch(() => !cancelled && setData(null));
    return () => { cancelled = true; };
  }, [taxid, uniqID]);

  if (data === undefined) return <Field label="mutability" info={INFO} value={<VizPlaceholder w={112} h={30} loading />} />;
  const v = data?.mmr;
  if (!v) return <Field label="mutability" info={INFO} value={<VizPlaceholder w={112} h={30} />} />;

  const c = cat(v.pct, top.mutability);
  const title = `intrinsic mutation rate ${v.rate.toFixed(2)} (normalised 0–1): ${v.events} substitution events · ${v.ratePerKb}/kb in MMR-defective mutation-accumulation lines (Foster 2018) · ${v.pct}th percentile. Reflects the replication-error landscape, not the wild-type realized rate.`;
  return (
    <Field
      label="mutability"
      info={INFO}
      value={
        <div className="flex items-center gap-3">
          {dist && <Distribution series={[{ bins: dist.mutation, color: DIST_FILL, mark: v.rate, markColor: levelHex(c) }]} track />}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1" title={title}>
            <span className={`rounded px-1.5 py-0.5 text-xs ${levelClass(c)}`}>{c}</span>
            <span className="text-[11px] tabular-nums text-neutral-400">{v.rate.toFixed(2)}</span>
          </div>
        </div>
      }
    />
  );
}
