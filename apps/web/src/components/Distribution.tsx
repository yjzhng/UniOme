import { useEffect, useState } from 'react';
import type { Distributions } from '@uniome/shared';

// Genome-wide distributions are the same for every gene → fetch once per organism, module-cached.
const distCache = new Map<string, Distributions | null>();
const inflight = new Map<string, Promise<Distributions | null>>();
export function useDistributions(taxid: string): Distributions | null {
  const [d, setD] = useState<Distributions | null>(() => distCache.get(taxid) ?? null);
  useEffect(() => {
    if (distCache.has(taxid)) { setD(distCache.get(taxid)!); return; }
    let cancelled = false;
    let p = inflight.get(taxid);
    if (!p) {
      p = fetch(`/api/organism/${taxid}/distributions`)
        .then((r) => (r.ok ? r.json() : null))
        .then((j: Distributions | null) => { distCache.set(taxid, j); inflight.delete(taxid); return j; })
        .catch(() => { inflight.delete(taxid); return null; });
      inflight.set(taxid, p);
    }
    p.then((j) => !cancelled && setD(j));
    return () => { cancelled = true; };
  }, [taxid]);
  return d;
}

const W = 112, PAD = 6, IW = W - 2 * PAD;

// A small genome-wide value distribution: one or more histogram curves (each a metric series) with a
// marker showing where this gene sits. With `track`, draws its own 0–1 baseline + marker dot; without
// (expression), it sits above the dumbbell whose dots are the markers — both share the PAD/width.
export function Distribution({
  series, track = false, curveH = 16,
}: {
  // `color` paints the curve; `markColor` (default = color) paints the marker dot + dashed line, so
  // a grey single-distribution can still carry a coloured (chip-matched) marker.
  series: Array<{ bins: number[]; color: string; mark: number | null; markColor?: string }>;
  track?: boolean;
  curveH?: number;
}) {
  const mid = curveH + 7;
  const H = track ? curveH + 14 : curveH;
  const max = Math.max(1, ...series.flatMap((s) => s.bins));
  const x = (frac: number) => PAD + frac * IW;
  const areaPath = (bins: number[]) => {
    const n = bins.length;
    let d = `M${x(0)},${curveH} `;
    bins.forEach((b, i) => { d += `L${x(n === 1 ? 0 : i / (n - 1))},${curveH - (b / max) * curveH} `; });
    d += `L${x(1)},${curveH} Z`;
    return d;
  };
  return (
    <svg width={W} height={H} className="shrink-0 overflow-visible">
      {series.map((s, i) => (
        <path key={`c${i}`} d={areaPath(s.bins)} fill={s.color} fillOpacity={0.22} stroke={s.color} strokeOpacity={0.7} strokeWidth={1} />
      ))}
      {track && (
        <>
          <line x1={x(0)} y1={mid} x2={x(1)} y2={mid} className="stroke-neutral-200" />
          <line x1={x(0)} y1={mid - 3} x2={x(0)} y2={mid + 3} className="stroke-neutral-200" />
          <line x1={x(1)} y1={mid - 3} x2={x(1)} y2={mid + 3} className="stroke-neutral-200" />
        </>
      )}
      {series.map((s, i) => s.mark != null && (
        <g key={`m${i}`}>
          <line x1={x(s.mark)} y1={0} x2={x(s.mark)} y2={track ? mid : curveH} stroke={s.markColor ?? s.color} strokeOpacity={0.6} strokeDasharray="2 2" />
          {track && <circle cx={x(s.mark)} cy={mid} r={3} fill={s.markColor ?? s.color} fillOpacity={0.9} className="stroke-white" />}
        </g>
      ))}
    </svg>
  );
}
