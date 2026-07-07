import { useEffect, useId, useState } from 'react';
import type { Expression } from '@uniome/shared';
import { Field, levelClass, VizPlaceholder, type Level } from './Fields';
import { getSourceInfo } from '../sourceInfo';
import { Distribution, useDistributions } from './Distribution';
import { useThresholds } from '../lib/thresholds';
import { THEME, tint } from '../lib/theme';

// Distribution-peak colours for the two molecules (RNA vs protein). Both in the THEME (blue) family,
// told apart by depth: protein = full theme, RNA = a lighter tint.
const RNA_COLOR = tint(THEME, 0.45);
const PROT_COLOR = THEME;
// Normalised level (0–1) → category. Symmetric shared threshold "top X%" (also the explorer's line):
// top X% → high, bottom X% → low, middle → medium.
const cat = (x: number, top: number): Level => (x > 1 - top ? 'high' : x < top ? 'low' : 'medium');

function useExpression(taxid: string, uniqID: string) {
  const [exp, setExp] = useState<Expression | null | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    setExp(undefined);
    fetch(`/api/organism/${taxid}/features/${encodeURIComponent(uniqID)}/expression`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => !cancelled && setExp(d))
      .catch(() => !cancelled && setExp(null));
    return () => { cancelled = true; };
  }, [taxid, uniqID]);
  return exp;
}

const Chip = ({ c, label }: { c: Level; label?: string }) => (
  <span className={`rounded px-1.5 py-0.5 text-xs ${levelClass(c)}`}>{label ?? c}</span>
);

// Per-level bar (protein OR transcript) for the protein / RNA panels: normalised 0–1 bar + value
// + a high/medium/low chip.
export function ExpressionBar({ taxid, uniqID, kind }: { taxid: string; uniqID: string; kind: 'protein' | 'transcript' }) {
  const exp = useExpression(taxid, uniqID);
  const { top } = useThresholds();
  if (exp === undefined) return <Field label="expression" info={getSourceInfo('expression', taxid)} value={<VizPlaceholder w={96} h={20} loading />} />;
  const v = exp ? exp[kind] : null;
  if (!v) return <Field label="expression" info={getSourceInfo('expression', taxid)} value={<VizPlaceholder w={96} h={20} />} />;
  const level = v.norm ?? v.pct / 100; // normalised value (falls back to percentile)
  const color = kind === 'protein' ? PROT_COLOR : RNA_COLOR;
  return (
    <Field
      label="expression"
      info={getSourceInfo('expression', taxid)}
      value={
        <div className="flex items-center gap-2" title={`${kind === 'protein' ? `${v.value.toLocaleString()} ppm abundance (PaxDb)` : `log-TPM ${v.value} (iModulonDB)`} · ${v.pct}th percentile · normalised ${level.toFixed(2)}`}>
          <div className="relative h-2 w-24 shrink-0 overflow-hidden rounded bg-neutral-200">
            <div className="absolute inset-y-0 left-0 rounded" style={{ width: `${level * 100}%`, background: color }} />
          </div>
          <span className="text-xs tabular-nums text-neutral-600">{level.toFixed(2)}</span>
          <Chip c={cat(v.pct / 100, top[kind])} />
        </div>
      }
    />
  );
}

// Combined dumbbell (general section): transcript (blue) + protein (purple) dots on one 0–1
// track with end ticks marking the range and a directional RNA→protein arrow, the 0–1 values,
// and an explicit chip — "<level>" when they agree, else "<protein> protein, <rna> rna".
const DUMBBELL = { W: 112, H: 16, PAD: 6, R: 4 };
export function ExpressionDumbbell({ taxid, uniqID }: { taxid: string; uniqID: string }) {
  const exp = useExpression(taxid, uniqID);
  const { top } = useThresholds();
  const dist = useDistributions(taxid);
  const arrowId = useId();
  if (exp === undefined) return <Field label="expression level" info={getSourceInfo('expression', taxid)} value={<VizPlaceholder w={112} h={32} loading />} />;
  const rna = exp?.transcript ? (exp.transcript.norm ?? exp.transcript.pct / 100) : null;
  const prot = exp?.protein ? (exp.protein.norm ?? exp.protein.pct / 100) : null;
  if (rna == null && prot == null) return <Field label="expression level" info={getSourceInfo('expression', taxid)} value={<VizPlaceholder w={112} h={32} />} />;

  // Dots/values use the normalised value (so they line up with the distribution); the chip stays
  // percentile-based (rank tier relative to all genes).
  const rnaCat = exp?.transcript ? cat(exp.transcript.pct / 100, top.transcript) : null;
  const protCat = exp?.protein ? cat(exp.protein.pct / 100, top.protein) : null;
  // Like CRISPRi essentiality: when RNA and protein agree (or only one exists) show a single level
  // chip; when they disagree show a "mixed" chip + the two values "0.31 (RNA) · 0.58 (protein)".
  const concordant = !rnaCat || !protCat || rnaCat === protCat;
  const level = (protCat ?? rnaCat) as Level; // shared level (protein leads, else RNA)
  const valuesTitle = [
    exp?.transcript ? `transcript: log-TPM ${exp.transcript.value} (iModulonDB) · ${exp.transcript.pct}th pct` : null,
    exp?.protein ? `protein: ${exp.protein.value.toLocaleString()} ppm (PaxDb) · ${exp.protein.pct}th pct` : null,
  ].filter(Boolean).join(' · ');

  const { W, H, PAD, R } = DUMBBELL;
  const mid = H / 2;
  const xOf = (level: number) => PAD + level * (W - 2 * PAD);
  // Draw the RNA→protein connector only when the dots are far enough apart for the arrow to read;
  // stop it short of the protein dot so the arrowhead points at (not into) it.
  const showArrow = rna != null && prot != null && Math.abs(xOf(prot) - xOf(rna)) > R * 2;
  return (
    <Field
      label="expression level"
      info={getSourceInfo('expression', taxid)}
      value={
        <div className="flex items-center gap-2">
          <div className="shrink-0">
            {/* genome-wide RNA + protein expression distributions (2 colour-matched peaks); this
                gene's RNA/protein dumbbell dots below are the markers. */}
            {dist && (
              <Distribution
                series={[
                  { bins: dist.transcript, color: RNA_COLOR, mark: rna },
                  { bins: dist.protein, color: PROT_COLOR, mark: prot },
                ]}
              />
            )}
          <svg width={W} height={H} className="block overflow-visible">
            <defs>
              <marker id={arrowId} markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                <path d="M0,0 L6,3 L0,6 Z" fill="#cbcbcb" />
              </marker>
            </defs>
            {/* baseline + end ticks (same faint tone) marking the 0–1 range */}
            <line x1={PAD} y1={mid} x2={W - PAD} y2={mid} stroke="#e5e5e5" />
            <line x1={PAD} y1={mid - 4} x2={PAD} y2={mid + 4} stroke="#e5e5e5" />
            <line x1={W - PAD} y1={mid - 4} x2={W - PAD} y2={mid + 4} stroke="#e5e5e5" />
            {/* directional connector: RNA → protein */}
            {showArrow && (
              <line
                x1={xOf(rna!)}
                y1={mid}
                x2={xOf(prot!) - Math.sign(xOf(prot!) - xOf(rna!)) * (R + 1)}
                y2={mid}
                stroke="#cbcbcb"
                markerEnd={`url(#${arrowId})`}
              />
            )}
            {/* semi-opaque dots so overlap stays legible */}
            {rna != null && <circle cx={xOf(rna)} cy={mid} r={R} fill={RNA_COLOR} fillOpacity={0.6} stroke="#fff" />}
            {prot != null && <circle cx={xOf(prot)} cy={mid} r={R} fill={PROT_COLOR} fillOpacity={0.6} stroke="#fff" />}
          </svg>
          </div>
          {/* chip first, then always the quantitative 0–1 scores ("mixed" chip when RNA/protein
              disagree, else the shared level). */}
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1" title={valuesTitle}>
            {concordant ? <Chip c={level} /> : <Chip c="medium" label="mixed" />}
            <span className="text-xs tabular-nums text-neutral-500">
              {rna != null && <span style={{ color: RNA_COLOR }}>{rna.toFixed(2)} (RNA)</span>}
              {rna != null && prot != null && ' · '}
              {prot != null && <span style={{ color: PROT_COLOR }}>{prot.toFixed(2)} (protein)</span>}
            </span>
          </span>
        </div>
      }
    />
  );
}
