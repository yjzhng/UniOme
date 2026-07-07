import { Field, VizPlaceholder } from './Fields';
import { SOURCE_INFO } from '../sourceInfo';
import { useDarkMode, ACCENT2, tint, shade } from '../lib/theme';

// Subcellular localisation of the functional product (DeepLocPro), carried on the Feature record via
// the org_DB.csv `localz` column. The five classes are exactly the Gram-negative cell envelope, so
// it's drawn as a compartmentalised cell cross-section (outside → in) with the gene's compartment
// highlighted. Placeholder until the column is ingested; an unrecognised value falls back to a chip.
export function LocalisationField({ value, compact }: { value: string | null; compact?: boolean }) {
  const drawn = value && localKey(value) ? (compact ? <LocalisationBar value={value} /> : <LocalisationMap value={value} />) : null;
  // No data → a same-size placeholder (compact bar vs full cell diagram) so the row keeps its height.
  const empty = compact ? <VizPlaceholder w={107} h={14} /> : <VizPlaceholder w={266} h={104} />;
  return (
    <Field
      label="localisation"
      info={SOURCE_INFO.localisation}
      value={value ? (drawn ?? <LocChip value={value} />) : empty}
    />
  );
}

// Gram-negative cell drawn as a horizontal pill (rod), with the envelope as concentric stadium
// rings: outside → in = extracellular medium, outer membrane, periplasm, plasma membrane, cytoplasm
// core. Compartments are light grey, the two lipid membranes a shade darker; the localised
// compartment is filled warm amber.
//
// Two palettes: the light scheme was tuned first; the dark scheme keeps the same structure (aqueous
// lighter than membrane, warm amber highlight) but at low luminance so the diagram doesn't glare
// against the dark page. Picked per render via useDarkMode().
type Palette = {
  grey: string; mem: string; fade: string; legendText: string; legendStroke: string;
  hl: { fill: string; mem: string; stroke: string; text: string }; // localised compartment
};
// The localised compartment is highlighted in ACCENT2 (tab10 orange): a light tint fill in light mode,
// a low-luminance shade in dark mode, so the diagram never glares.
const LIGHT: Palette = {
  grey: '#edf0f4', mem: '#cbd5e1', fade: '#e2e8f0', legendText: '#6b7280', legendStroke: '#cbd5e1',
  hl: { fill: tint(ACCENT2, 0.72), mem: tint(ACCENT2, 0.52), stroke: shade(ACCENT2, 0.2), text: shade(ACCENT2, 0.58) },
};
const DARK: Palette = {
  grey: '#2a2a2f', mem: '#3c3c44', fade: '#242428', legendText: '#9a9aa2', legendStroke: '#3d3d44',
  hl: { fill: shade(ACCENT2, 0.6), mem: shade(ACCENT2, 0.46), stroke: tint(ACCENT2, 0.12), text: tint(ACCENT2, 0.62) },
};

// Pill geometry + envelope layers, outermost → innermost. A radial cross-section from the centre
// has ratio cytoplasm:plasma-mem:periplasm:outer-mem = 5:1:1:1, so the half-height is 8 units and
// each envelope layer is 1 unit thick (the cytoplasm core takes the inner 5). Flat 5:2 pill.
const PILL = { x: 22, y: 28, w: 100, h: 40 }; // x leaves room so the blurred extracellular halo isn't clipped at the SVG's left edge
const UNIT = PILL.h / 16; // half-height = 8 units
type Layer = { key: string; label: string; t: number; membrane?: boolean; core?: boolean };
const LAYERS: Layer[] = [
  { key: 'outer membrane', label: 'outer membrane', t: UNIT, membrane: true },
  { key: 'periplasm', label: 'periplasm', t: UNIT },
  { key: 'plasma membrane', label: 'plasma membrane', t: UNIT, membrane: true },
  { key: 'cytoplasm', label: 'cytoplasm', t: 0, core: true },
];
// Legend / picker order, outside → in (extracellular surrounds the pill).
const LEGEND = ['extracellular', ...LAYERS.map((l) => l.key)];
const LABEL_OF: Record<string, string> = { extracellular: 'extracellular', ...Object.fromEntries(LAYERS.map((l) => [l.key, l.label])) };

// DeepLocPro value → envelope compartment key.
function localKey(value: string): string | null {
  const v = value.toLowerCase();
  if (v.includes('cytoplasm')) return 'cytoplasm';
  if (v.includes('plasma') || v.includes('inner mem')) return 'plasma membrane';
  if (v.includes('periplasm')) return 'periplasm';
  if (v.includes('outer mem')) return 'outer membrane';
  if (v.includes('extracellular') || v.includes('secreted')) return 'extracellular';
  return null;
}

function LocalisationMap({ value }: { value: string }) {
  const P = useDarkMode() ? DARK : LIGHT;
  const active = localKey(value);
  const extra = active === 'extracellular';
  const labelX = PILL.x + PILL.w + 18;
  const baseFill = (l: Layer) => (l.membrane ? P.mem : P.grey);
  // Accumulate insets so each ring nests inside the previous one.
  let inset = 0;
  const rings = LAYERS.map((l) => { const r = { l, inset }; inset += l.t; return r; });
  const swatchOf = (key: string, on: boolean) => {
    if (on) return key === 'plasma membrane' || key === 'outer membrane' ? P.hl.mem : P.hl.fill;
    if (key === 'extracellular') return P.fade;
    return baseFill(LAYERS.find((l) => l.key === key)!);
  };
  return (
    <svg width={266} height={104} className="block">
      <defs>
        <filter id="loc-fade" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation={5.5} /></filter>
      </defs>
      {/* extracellular medium = a soft halo that fades out around the cell (blurred, no border) */}
      <rect x={PILL.x - 4} y={PILL.y - 4} width={PILL.w + 8} height={PILL.h + 8} rx={(PILL.h + 8) / 2}
        fill={extra ? P.hl.fill : P.fade} opacity={extra ? 0.85 : 0.6} filter="url(#loc-fade)" />
      {/* envelope rings, outermost first so each inner fill leaves a ring of the previous */}
      {rings.map(({ l, inset: ins }) => {
        const on = l.key === active;
        const w = PILL.w - 2 * ins, h = PILL.h - 2 * ins;
        const fill = on ? (l.membrane ? P.hl.mem : P.hl.fill) : baseFill(l);
        return (
          <rect key={l.key} x={PILL.x + ins} y={PILL.y + ins} width={w} height={h} rx={h / 2} fill={fill} />
        );
      })}
      {/* legend / picker, outside → in */}
      {LEGEND.map((key, i) => {
        const on = key === active;
        const y = 16 + i * 16;
        return (
          <g key={key}>
            {on && <rect x={labelX - 3} y={y - 7} width={94} height={14} rx={3} fill={P.hl.fill} opacity={0.5} />}
            <rect x={labelX} y={y - 4.5} width={9} height={9} rx={2} fill={swatchOf(key, on)} stroke={on ? P.hl.stroke : P.legendStroke} strokeWidth={0.7} />
            <text x={labelX + 14} y={y} dominantBaseline="central" fontSize={9} fontWeight={on ? 700 : 400} fill={on ? P.hl.text : P.legendText}>{LABEL_OF[key]}</text>
          </g>
        );
      })}
    </svg>
  );
}

// Compact variant for the protein section: a single radius slice (centre → outside) as a horizontal
// stacked bar, segments 5:1:1:1 (cytoplasm:plasma-mem:periplasm:outer-mem) plus a faded extracellular
// tail, with the localised segment in amber and a chip naming it to the right.
const SLICE = [
  { key: 'cytoplasm', u: 5 },
  { key: 'plasma membrane', u: 1, membrane: true },
  { key: 'periplasm', u: 1 },
  { key: 'outer membrane', u: 1, membrane: true },
];
function LocalisationBar({ value }: { value: string }) {
  const P = useDarkMode() ? DARK : LIGHT;
  const active = localKey(value);
  const extra = active === 'extracellular';
  const U = 11, H = 12, EXTRA_W = 1.7 * U;
  let x = 0;
  const segs = SLICE.map((s) => { const seg = { ...s, x, w: s.u * U }; x += seg.w; return seg; });
  const cellW = x, W = cellW + EXTRA_W;
  return (
    <div className="flex items-center gap-2">
      <svg width={W} height={H} className="block">
        <defs>
          <clipPath id="loc-slice"><rect x={0} y={0} width={W} height={H} rx={H / 2} /></clipPath>
          <linearGradient id="loc-slice-extra" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={extra ? P.hl.fill : P.fade} stopOpacity={0.9} />
            <stop offset="100%" stopColor={extra ? P.hl.fill : P.fade} stopOpacity={0} />
          </linearGradient>
        </defs>
        <g clipPath="url(#loc-slice)">
          {segs.map((s) => {
            const on = s.key === active;
            const fill = on ? (s.membrane ? P.hl.mem : P.hl.fill) : s.membrane ? P.mem : P.grey;
            return <rect key={s.key} x={s.x} y={0} width={s.w} height={H} fill={fill} />;
          })}
          <rect x={cellW} y={0} width={EXTRA_W} height={H} fill="url(#loc-slice-extra)" />
        </g>
      </svg>
      <span className="rounded px-1.5 py-0.5 text-xs" style={{ background: P.hl.fill, color: P.hl.text }}>{LABEL_OF[active!] ?? value}</span>
    </div>
  );
}

function LocChip({ value }: { value: string }) {
  return (
    <span className="inline-block rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-700">{value}</span>
  );
}
