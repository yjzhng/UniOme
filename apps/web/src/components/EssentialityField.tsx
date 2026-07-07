import { useEffect, useRef, useState } from 'react';
import type { Essentiality, EssentialityCall, EssentialityVerdict } from '@uniome/shared';
import { Field, levelClass, levelHex, VizPlaceholder, type Level } from './Fields';
import { getSourceInfo } from '../sourceInfo';
import { Distribution, useDistributions } from './Distribution';
import { useThresholds } from '../lib/thresholds';
import { THEME, tint } from '../lib/theme';

// CRISPRi distribution: two distinct peaks — LB (rich) and M9 (minimal). Both in the THEME (blue)
// family, told apart by depth: LB = full theme, M9 = a lighter tint.
const LB_COLOR = THEME;
const M9_COLOR = tint(THEME, 0.45);
// Calls map onto the shared low/medium/high scale (essential = high = red; either conditional = mid).
const callLevel = (call: string): Level => (call === 'essential' ? 'high' : call.startsWith('conditional') ? 'medium' : 'low');
// CRISPRi call from the shared LB/M9 "top X%" thresholds (so the chip tracks the explorer): essential
// = depleted top X% in BOTH media; M9-only = conditional (starvation); LB-only = conditional (fast
// growth); neither = non-essential.
const crispriCall = (v: EssentialityCall, topLb: number, topM9: number): EssentialityCall['call'] => {
  const lbHigh = v.pctLb != null && v.pctLb > (1 - topLb) * 100;
  const m9High = v.pctM9 != null && v.pctM9 > (1 - topM9) * 100;
  return lbHigh && m9High ? 'essential' : m9High ? 'conditional-starvation' : lbHigh ? 'conditional-fastgrowth' : 'non-essential';
};
const CALL_LABEL: Record<string, string> = {
  essential: 'essential',
  'conditional-starvation': 'conditional (starvation)',
  'conditional-fastgrowth': 'conditional (fast growth)',
  'non-essential': 'non-essential',
};
// Canonical severity order for the categorical bar, least → most essential. A categorical source's
// segments are whichever of these calls actually appear in its genome-wide counts (EcoCyc: the three
// non-essential/conditional/essential; Tn-seq: usually just non-essential/essential).
const VERDICT_ORDER: EssentialityVerdict[] = ['non-essential', 'conditional-fastgrowth', 'conditional-starvation', 'essential'];

// Categorical sources (EcoCyc, Tn-seq) → a horizontal proportional bar of the genome-wide calls.
// Each segment has a minimum width so a rare class stays visible; only this gene's segment is coloured
// (its call's red-yellow-blue level colour).
function EssentialityBar({ counts, call }: { counts: Record<string, number>; call: string }) {
  const order = VERDICT_ORDER.filter((k) => k in counts);
  const total = order.reduce((s, k) => s + (counts[k] ?? 0), 0) || 1;
  const MINW = 14; // % floor per non-empty segment, so a 2–3% class is still visible
  const widths = order.map((k) => (counts[k] ? Math.max((counts[k] / total) * 100, MINW) : 0));
  const wsum = widths.reduce((s, w) => s + w, 0) || 1;
  return (
    <div className="flex h-3.5 w-28 shrink-0 overflow-hidden rounded bg-neutral-200">
      {order.map((k, i) => (
        <div
          key={k}
          title={`${CALL_LABEL[k] ?? k}: ${counts[k] ?? 0} genes${k === call ? ' ← this gene' : ''}`}
          className={i < order.length - 1 ? 'border-r border-white' : ''}
          style={{ width: `${(widths[i] / wsum) * 100}%`, background: k === call ? levelHex(callLevel(k)) : '#d4d4d4' }}
        />
      ))}
    </div>
  );
}

type SourceKey = 'EcoCyc' | 'CRISPRi' | 'Tn-seq';
type SourceDef = { key: SourceKey; dataKey: keyof Essentiality; kind: 'categorical' | 'fitness' };
// Source registry, in preferred order (CRISPRi first where present, i.e. E. coli; Tn-seq is the lone
// source for organisms like M. tuberculosis). The UI shows whichever are present for the organism.
const SOURCES: SourceDef[] = [
  { key: 'CRISPRi', dataKey: 'crispri', kind: 'fitness' },
  { key: 'EcoCyc', dataKey: 'ecocyc', kind: 'categorical' },
  { key: 'Tn-seq', dataKey: 'tnseq', kind: 'categorical' },
];

// Feature types where a single-locus CRISPRi knockdown can't reveal essentiality: rRNA (7 operons)
// and tRNA (redundant isoacceptors) are masked by their paralogous copies.
const REDUNDANT = new Set(['rRNA', 'tRNA']);

// A small ▾ dropdown to switch the essentiality source (EcoCyc | CRISPRi), mirroring the protein
// viewer's track source picker. Only shown when both sources have a call.
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
        title="essentiality source"
        onClick={() => setOpen((o) => !o)}
        className={'flex h-3.5 w-3.5 items-center justify-center rounded text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700 ' + (open ? 'bg-neutral-200 text-neutral-700' : '')}
      >
        <svg viewBox="0 0 8 8" width="7" height="7" aria-hidden><path d="M1 2.5 L4 6 L7 2.5 Z" fill="currentColor" /></svg>
      </button>
      {open && (
        <div className="absolute left-0 top-full z-10 mt-0.5 min-w-[5rem] rounded border border-neutral-200 bg-white py-0.5 normal-case tracking-normal shadow-md">
          {sources.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => { onSelect(s); setOpen(false); }}
              className={'block w-full px-2 py-0.5 text-left text-[11px] ' + (s === active ? 'font-medium text-neutral-900' : 'text-neutral-600 hover:bg-neutral-100')}
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

// Gene/RNA essentiality for the General section, from whichever sources the organism has: E. coli has
// EcoCyc knockout-growth (CDS) + a genome-wide CRISPRi screen (all loci); Tn-seq organisms (e.g.
// M. tuberculosis) have a single categorical Tn-seq call.
export function EssentialityField({ taxid, uniqID, type }: { taxid: string; uniqID: string; type?: string }) {
  const [data, setData] = useState<Essentiality | null | undefined>(undefined);
  const [source, setSource] = useState<SourceKey | null>(null);
  const { top } = useThresholds();
  const dist = useDistributions(taxid);
  useEffect(() => {
    let cancelled = false;
    setData(undefined);
    setSource(null);
    fetch(`/api/organism/${taxid}/features/${encodeURIComponent(uniqID)}/essentiality`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => !cancelled && setData(d))
      .catch(() => !cancelled && setData(null));
    return () => { cancelled = true; };
  }, [taxid, uniqID]);

  if (data === undefined) return <Field label="essentiality" info={getSourceInfo('essentiality', taxid)} value={<VizPlaceholder w={112} h={30} loading />} />;
  const available = data ? SOURCES.filter((s) => data[s.dataKey]) : [];
  if (available.length === 0) return <Field label="essentiality" info={getSourceInfo('essentiality', taxid)} value={<VizPlaceholder w={112} h={30} />} />;

  const activeSrc = available.find((s) => s.key === source) ?? available[0];
  const v = data![activeSrc.dataKey] as EssentialityCall;
  const isCrispri = activeSrc.kind === 'fitness';
  // CRISPRi chip reflects the shared LB/M9 thresholds (responsive to the explorer); categorical sources
  // keep their reported call.
  const tcall = isCrispri ? crispriCall(v, top.essLb, top.essM9) : v.call;
  // CRISPRi is quantitative → show the two normalised 0–1 essentiality scores (LB rich / M9 minimal;
  // 1 = most essential). EcoCyc → name the minimal media the knockout fails on (conditional-starvation
  // only). Tn-seq → no detail line; its provenance lives in the field tooltip.
  const detail = isCrispri
    ? <span className="tabular-nums"><span style={{ color: LB_COLOR }}>{v.scoreLb?.toFixed(2) ?? '—'} (LB)</span> · <span style={{ color: M9_COLOR }}>{v.scoreM9?.toFixed(2) ?? '—'} (M9)</span></span>
    : activeSrc.key === 'EcoCyc'
      ? (v.call === 'conditional-starvation' && v.media?.length ? v.media.join(', ') : null)
      : null;
  const title = isCrispri
    ? `CRISPRi screen — median guide fitness (log2 depletion): LB (rich) ${v.lb ?? '—'}, M9 (minimal) ${v.m9 ?? '—'}. essential = depleted in both; conditional (starvation) = minimal-only (auxotroph); conditional (fast growth) = rich-only. Scores are 0–1 within each medium (1 = most essential).`
    : activeSrc.key === 'EcoCyc'
      ? `EcoCyc knockout-growth across LB / LB-Lennox / LB-enriched (rich) and M9+glycerol / M9+glucose / MOPS+glucose (minimal): no growth in ${v.noGrowth} of ${v.total} conditions${v.media?.length ? ` — fails on ${v.media.join(', ')}` : ''}`
      : `${v.source ?? 'Tn-seq'} — genome-wide transposon-insertion essentiality. essential = insertions strongly depleted (gene required for growth in vitro).`;
  const redundant = isCrispri && type != null && REDUNDANT.has(type);
  // Categorical bar counts for the active source (EcoCyc / Tn-seq).
  const counts = activeSrc.key === 'EcoCyc' ? dist?.essentialityEcocyc : activeSrc.key === 'Tn-seq' ? dist?.essentialityTnseq : null;

  return (
    <Field
      label={<>essentiality{available.length > 1 && <SourceMenu sources={available.map((s) => s.key)} active={activeSrc.key} onSelect={setSource} />}</>}
      info={getSourceInfo('essentiality', taxid)}
      value={
        <div className="flex items-center gap-3">
          {/* Categorical (EcoCyc / Tn-seq) → stacked bar of genome-wide proportions; CRISPRi =
              continuous fitness → distribution, like the other fields. */}
          {!isCrispri
            ? counts && <EssentialityBar counts={counts} call={v.call} />
            : dist && <Distribution series={[
                { bins: dist.essentialityCrispri.lb, color: LB_COLOR, mark: v.scoreLb ?? null },
                { bins: dist.essentialityCrispri.m9, color: M9_COLOR, mark: v.scoreM9 ?? null },
              ]} track />}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className={`rounded px-1.5 py-0.5 text-xs ${levelClass(callLevel(tcall))}`} title={title}>{CALL_LABEL[tcall] ?? tcall}</span>
            {detail && <span className="text-[11px] tabular-nums text-neutral-400" title={title}>{detail}</span>}
            {redundant && (
              <span className="text-[10px] text-amber-700 dark:text-amber-400" title="single-locus knockdown — redundant copies (rRNA operons / tRNA isoacceptors) can mask true essentiality">
                ⚠ redundant locus
              </span>
            )}
          </div>
        </div>
      }
    />
  );
}
