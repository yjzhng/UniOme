import { useEffect, useRef, useState } from 'react';
import type { Conservation, ConservationCall } from '@uniome/shared';
import { DIST_FILL, Field, levelClass, levelHex, VizPlaceholder, type Level } from './Fields';
import { getSourceInfo } from '../sourceInfo';
import { Distribution, useDistributions } from './Distribution';
import { useThresholds } from '../lib/thresholds';

// Binary classifier: the not-conserved tail (bottom X% conservation, most genes being conserved) is
// flagged "low" (red, hypervariable); everything else is "high" (conserved, blue). One shared "top
// X%" cut on the variable end (also the explorer's line).
const cat = (consPct: number, top: number): Level => (consPct < top * 100 ? 'low' : 'high');

type SourceKey = 'diversity' | 'enterobase';
const SOURCE_ORDER: SourceKey[] = ['diversity', 'enterobase']; // diversity (π) is the default
const SOURCE_LABEL: Record<SourceKey, string> = { diversity: 'π (diversity)', enterobase: 'EnteroBase' };

// A small ▾ dropdown to switch the conservation source, mirroring the essentiality field / the
// protein viewer's track source picker. Only shown when both sources have a value.
function SourceMenu({ sources, active, onSelect }: { sources: SourceKey[]; active: SourceKey; onSelect: (s: SourceKey) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  return (
    <span ref={ref} className="relative shrink-0">
      <button
        type="button"
        title="conservation source"
        onClick={() => setOpen((o) => !o)}
        className={'flex h-3.5 w-3.5 items-center justify-center rounded text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700 ' + (open ? 'bg-neutral-200 text-neutral-700' : '')}
      >
        <svg viewBox="0 0 8 8" width="7" height="7" aria-hidden><path d="M1 2.5 L4 6 L7 2.5 Z" fill="currentColor" /></svg>
      </button>
      {open && (
        <div className="absolute left-0 top-full z-10 mt-0.5 min-w-[7rem] rounded border border-neutral-200 bg-white py-0.5 normal-case tracking-normal shadow-md">
          {sources.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => { onSelect(s); setOpen(false); }}
              className={'block w-full px-2 py-0.5 text-left text-[11px] ' + (s === active ? 'font-medium text-neutral-900' : 'text-neutral-600 hover:bg-neutral-100')}
            >
              {SOURCE_LABEL[s]}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

// Per-locus sequence conservation for the General section, from up to two switchable sources
// (default π/diversity): computed nucleotide diversity and EnteroBase allele diversity. The chip
// reads in conservation terms (high = strongly conserved); the value shows the underlying metric.
export function ConservationField({ taxid, uniqID }: { taxid: string; uniqID: string }) {
  const [data, setData] = useState<Conservation | null | undefined>(undefined);
  const [source, setSource] = useState<SourceKey>('diversity');
  const { top } = useThresholds();
  const dist = useDistributions(taxid);
  useEffect(() => {
    let cancelled = false;
    setData(undefined);
    setSource('diversity');
    fetch(`/api/organism/${taxid}/features/${encodeURIComponent(uniqID)}/conservation`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => !cancelled && setData(d))
      .catch(() => !cancelled && setData(null));
    return () => { cancelled = true; };
  }, [taxid, uniqID]);

  if (data === undefined) return <Field label="conservedness" info={getSourceInfo('conservation', taxid)} value={<VizPlaceholder w={112} h={30} loading />} />;
  const available = data ? SOURCE_ORDER.filter((s) => data[s]) : [];
  if (available.length === 0) return <Field label="conservedness" info={getSourceInfo('conservation', taxid)} value={<VizPlaceholder w={112} h={30} />} />;

  const active = available.includes(source) ? source : available[0];
  const v = data![active] as ConservationCall;
  const isPi = active === 'diversity';
  const consPct = 100 - v.pct; // conservation = inverse of variability
  const c = cat(consPct, top.conservation);
  // Show the 0–1 conservation score (1 = most conserved), consistent with the other fields; the raw
  // π / allele count lives in the tooltip.
  const detail = isPi ? (v.score ?? 0).toFixed(2) : `${v.alleles ?? '—'} alleles`;
  const title = isPi
    ? `conservation score ${(v.score ?? 0).toFixed(2)} (1 = most conserved) · nucleotide diversity π ${(v.pi ?? 0).toFixed(4)} · SNP density ${(v.snpDensity ?? 0).toFixed(3)} (panel of E. coli genomes vs MG1655) → ${consPct}th percentile`
    : `${v.alleles ?? '—'} distinct alleles across EnteroBase isolates → ${consPct}th conservation percentile`;

  return (
    <Field
      label={<>conservedness{available.length > 1 && <SourceMenu sources={available} active={active} onSelect={setSource} />}</>}
      info={getSourceInfo('conservation', taxid)}
      value={
        <div className="flex items-center gap-3">
          {isPi && dist && <Distribution series={[{ bins: dist.conservation, color: DIST_FILL, mark: v.score ?? null, markColor: levelHex(c) }]} track />}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1" title={title}>
            <span className={`rounded px-1.5 py-0.5 text-xs ${levelClass(c)}`}>{c}</span>
            <span className="text-[11px] tabular-nums text-neutral-400">{detail}</span>
          </div>
        </div>
      }
    />
  );
}
