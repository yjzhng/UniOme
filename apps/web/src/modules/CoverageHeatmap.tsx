import { useEffect, useState } from 'react';
import type { Coverage } from '@uniome/shared';

// A compact heatmap of annotation coverage: one tile per info field, grouped by section, coloured by the
// fraction of applicable genes that carry that annotation (a light→dark green ramp). An at-a-glance map of
// how complete each section of the database is for this organism. Tiles link nowhere — they summarise.
const RAMP_LO = [240, 253, 244], RAMP_HI = [21, 128, 61]; // green-50 → green-700
const ramp = (t: number) => { const u = Math.max(0, Math.min(1, t)); return `rgb(${RAMP_LO.map((v, i) => Math.round(v + (RAMP_HI[i] - v) * u)).join(',')})`; };
const textOn = (t: number) => (t > 0.5 ? '#f0fdf4' : '#14532d');

// Mean field coverage within a section (annotated/applicable, averaged over its fields).
export const sectionScore = (s: Coverage['sections'][number]) =>
  s.fields.reduce((a, f) => a + (f.applicable ? f.annotated / f.applicable : 0), 0) / (s.fields.length || 1);

// One overall annotation score for the organism: the plain average of annotation coverage over
// every field (annotated/applicable), across all sections. Used on the home-page tile.
export const overallCoverageScore = (cov: Coverage) => {
  const fields = cov.sections.flatMap((s) => s.fields);
  return fields.reduce((a, f) => a + (f.applicable ? f.annotated / f.applicable : 0), 0) / (fields.length || 1);
};

// A small progress ring: filled arc = the section's overall annotation score, % in the centre.
export function ScoreRing({ score, label }: { score: number; label: string }) {
  const D = 40, R = 15.5, C = 2 * Math.PI * R, cx = D / 2;
  return (
    <svg width={D} height={D} viewBox={`0 0 ${D} ${D}`} className="shrink-0" role="img" aria-label={label}>
      <title>{label}</title>
      <circle cx={cx} cy={cx} r={R} fill="none" className="stroke-neutral-200" strokeWidth={4} />
      <circle cx={cx} cy={cx} r={R} fill="none" stroke={ramp(Math.max(0.35, score))} strokeWidth={4} strokeLinecap="round"
        strokeDasharray={C} strokeDashoffset={C * (1 - score)} transform={`rotate(-90 ${cx} ${cx})`} />
      <text x={cx} y={cx + 0.5} textAnchor="middle" dominantBaseline="central" fontSize={11} fontWeight={700} className="fill-neutral-700 tabular-nums">{Math.round(score * 100)}</text>
    </svg>
  );
}

export function CoverageHeatmap({ taxid }: { taxid: string }) {
  const [cov, setCov] = useState<Coverage | null | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    setCov(undefined);
    fetch(`/api/organism/${taxid}/coverage`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Coverage | null) => !cancelled && setCov(d))
      .catch(() => !cancelled && setCov(null));
    return () => { cancelled = true; };
  }, [taxid]);

  if (cov === undefined) return <div className="h-28 animate-pulse rounded bg-neutral-100" />;
  if (!cov || !cov.sections.length) return null;

  return (
    // section blocks flow left-to-right and wrap, so single-field sections pack together instead of
    // each taking a whole sparse row
    <div className="flex flex-wrap gap-x-3 gap-y-2">
        {cov.sections.map((s) => {
          const score = s.fields.reduce((a, f) => a + (f.applicable ? f.annotated / f.applicable : 0), 0) / (s.fields.length || 1);
          return (
            <div key={s.name}>
              <div className="mb-0.5 text-[10px] font-semibold text-neutral-600">{s.name}</div>
              <div className="flex items-center gap-1.5">
                {/* section-level overall score (mean of its fields), as a progress ring */}
                <ScoreRing score={score} label={`${s.name} — ${Math.round(score * 100)}% average annotation across ${s.fields.length} field${s.fields.length === 1 ? '' : 's'}`} />
                <div className="flex gap-0.5">
                  {s.fields.map((f) => {
                    const t = f.applicable ? f.annotated / f.applicable : 0;
                    return (
                      <div key={f.key} title={`${s.name} · ${f.label}: ${f.annotated.toLocaleString()} of ${f.applicable.toLocaleString()} genes (${Math.round(t * 100)}%)`}
                        className="flex h-8 w-[64px] flex-col items-center justify-center rounded px-1 text-center" style={{ background: ramp(t), color: textOn(t) }}>
                        <span className="w-full truncate text-[9px] leading-tight">{f.label}</span>
                        <span className="text-[8px] leading-none tabular-nums opacity-80">{Math.round(t * 100)}%</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}
    </div>
  );
}
