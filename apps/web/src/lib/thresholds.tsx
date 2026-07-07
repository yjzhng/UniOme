import { createContext, useContext, useState, type ReactNode } from 'react';

// Shared per-metric threshold, expressed as "top X%" (the size of the flagged extreme, 0–1). BOTH the
// general-section field chips and the multiome explorer's threshold lines read it, so they stay
// consistent. It is SYMMETRIC: top X% → "high" tier, bottom X% → "low" tier, middle → "medium".
// Default 0.20 (top 20%). For `invert`ed metrics the flagged extreme is the LOW-score end (e.g.
// conservation: most genes are conserved, so the interesting selection is the not-conserved tail).
export type ThreshMetric = 'essLb' | 'essM9' | 'mutability' | 'conservation' | 'protein' | 'transcript';
const METRICS: ThreshMetric[] = ['essLb', 'essM9', 'mutability', 'conservation', 'protein', 'transcript'];
export const DEFAULT_TOP: Record<ThreshMetric, number> = {
  essLb: 0.10, essM9: 0.15, mutability: 0.10, conservation: 0.10, protein: 0.05, transcript: 0.05,
};
// Which metrics flag their LOW-score extreme as the selection (not the high one).
export const INVERT: Record<ThreshMetric, boolean> = { essLb: false, essM9: false, mutability: false, conservation: true, protein: false, transcript: false };
// Classifier shape. Most metrics are BINARY (one cut → flagged / not). Expression is TWO-SIDED
// symmetric (two cuts → low / mid / high), so the expression plot is a 3×3 grid of categories.
export const TWO_SIDED: Record<ThreshMetric, boolean> = { essLb: false, essM9: false, mutability: false, conservation: false, protein: true, transcript: true };
const KEY = 'uniome.topThresholds.v2';

type ThresholdCtx = { top: Record<ThreshMetric, number>; setTop: (m: ThreshMetric, v: number) => void };
const defaults = () => ({ ...DEFAULT_TOP });
const Ctx = createContext<ThresholdCtx | null>(null);

function load(): Record<ThreshMetric, number> {
  const base = defaults();
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
    for (const m of METRICS) if (typeof saved[m] === 'number') base[m] = saved[m];
  } catch { /* ignore */ }
  return base;
}

export function ThresholdProvider({ children }: { children: ReactNode }) {
  const [top, setTopState] = useState<Record<ThreshMetric, number>>(load);
  const setTop = (m: ThreshMetric, v: number) => setTopState((t) => {
    const next = { ...t, [m]: v };
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* ignore */ }
    return next;
  });
  return <Ctx.Provider value={{ top, setTop }}>{children}</Ctx.Provider>;
}

export function useThresholds(): ThresholdCtx {
  return useContext(Ctx) ?? { top: defaults(), setTop: () => {} };
}
