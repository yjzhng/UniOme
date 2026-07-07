import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { OverviewMap as OvData } from '@uniome/shared';

// A "you are here" minimap. The detailed box-map has its own (KEGG textbook) layout that doesn't share
// coordinates with the overview, so instead of forcing them to match we anchor the detailed map to the
// grand metabolic network: this thumbnail shows the whole overview with the currently-open pathway's
// reactions highlighted (and the focal gene's edge picked out), so you can see where this pathway sits.
const W = 250, H = 160;
export function OverviewLocator({ focalId, genes }: { focalId: string; genes: Set<string> }) {
  const { taxid } = useParams<{ taxid: string }>();
  const [ov, setOv] = useState<OvData | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/organism/${taxid}/pathway-overview/eco01100`).then((r) => (r.ok ? r.json() : null)).then((d) => !cancelled && setOv(d)).catch(() => {});
    return () => { cancelled = true; };
  }, [taxid]);
  const fit = useMemo(() => {
    if (!ov) return null;
    const k = Math.min(W / ov.bounds.w, H / ov.bounds.h);
    return { k, tx: (W - ov.bounds.w * k) / 2, ty: (H - ov.bounds.h * k) / 2 };
  }, [ov]);
  if (!ov || !fit) return null;
  const poly = (pts: [number, number][]) => pts.map((p) => p.join(',')).join(' ');
  const inPath = (g: OvData['genes'][number]) => g.genes.some((x) => genes.has(x.uniqID));
  const isFocal = (g: OvData['genes'][number]) => g.genes.some((x) => x.uniqID === focalId);
  return (
    <div className="shrink-0">
      <svg width={W} height={H} className="rounded border border-neutral-200 bg-white">
        <g transform={`translate(${fit.tx},${fit.ty}) scale(${fit.k})`}>
          {/* the whole overview network, faint */}
          {ov.genes.map((g) => <polyline key={g.id} points={poly(g.pts)} fill="none" className="stroke-neutral-200" strokeWidth={1} style={{ vectorEffect: 'non-scaling-stroke' }} pointerEvents="none" />)}
          {/* this pathway's reactions, then the focal gene's edge on top */}
          {ov.genes.filter(inPath).map((g) => <polyline key={`p-${g.id}`} points={poly(g.pts)} fill="none" stroke="#4f46e5" strokeWidth={2} style={{ vectorEffect: 'non-scaling-stroke' }} pointerEvents="none" />)}
          {ov.genes.filter(isFocal).map((g) => <polyline key={`f-${g.id}`} points={poly(g.pts)} fill="none" className="stroke-neutral-900" strokeWidth={3.5} style={{ vectorEffect: 'non-scaling-stroke' }} pointerEvents="none" />)}
        </g>
      </svg>
      <div className="mt-0.5 text-[10px] text-neutral-400">location on the metabolic map · <span style={{ color: '#4f46e5' }}>this pathway</span> · <span className="text-neutral-700">this gene</span></div>
    </div>
  );
}
