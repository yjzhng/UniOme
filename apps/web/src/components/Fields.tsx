import { Fragment } from 'react';
import type { GeneticLevel } from '@uniome/shared';
import { THEME, tint } from '../lib/theme';

// Shared presentational primitives for the entry page's info sections and the
// protein panel. Kept here so both EntryPage and the protein viewer render the
// same label/chip/section styling without a circular import.

export function Section({
  title,
  level,
  anchor,
  children,
}: {
  title: string;
  level?: GeneticLevel;
  // When set, marks this section as a scroll anchor (data-entry-anchor=title) so EntryPage can keep
  // the heading nearest the viewport top stationary across gene switches. Only the always-present
  // top-level sections set it, so the anchor always exists for the next entry too.
  anchor?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section data-entry-anchor={anchor ? title : undefined} className="rounded border border-neutral-200 bg-white">
      <header className="flex items-baseline gap-2 border-b-2 border-neutral-800 px-3 py-2">
        <h2 className="text-sm font-semibold text-neutral-900">{title}</h2>
        {level && <span className="text-xs text-neutral-400">{level}</span>}
      </header>
      <div className="px-3 py-3 space-y-2">{children}</div>
    </section>
  );
}

// A small (i) icon with a hover tooltip describing an external data source + how it's parsed.
// Rendered as a superscript immediately to the right of the field title (raised via -top-1 so it
// reads as a footnote marker even inside the flex `items-center` field headers).
export function InfoTip({ text }: { text: React.ReactNode }) {
  return (
    <span className="group relative -top-1 inline-flex shrink-0">
      <span className="flex h-3 w-3 cursor-help items-center justify-center rounded-full border border-neutral-300 text-[8px] font-semibold lowercase leading-none text-neutral-400 hover:border-neutral-500 hover:text-neutral-600">i</span>
      <span className="pointer-events-none absolute left-0 top-full z-30 mt-1 hidden w-64 rounded border border-neutral-200 bg-white p-2 text-[11px] font-normal normal-case leading-snug tracking-normal text-neutral-600 shadow-lg group-hover:block">
        {text}
      </span>
    </span>
  );
}

export function Field({ label, value, info }: { label: React.ReactNode; value: React.ReactNode; info?: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[var(--field-label,140px)_minmax(0,1fr)] items-start gap-x-[var(--field-gap,0.75rem)] gap-y-1 text-sm">
      <div className="flex items-center gap-1 text-xs uppercase tracking-wide text-neutral-500">
        {label}
        {info && <InfoTip text={info} />}
      </div>
      <div className="min-w-0 text-neutral-800">{value}</div>
    </div>
  );
}

// Two distinct empty states:
//  • Placeholder — the field has no data pipeline yet (a stub for future work).
//  • NoData — the field is fully wired, but this particular feature has no value
//    (e.g. essentiality for an rRNA, or a protein with no UniProt keywords).
// Kept visually different (italic "coming" vs. a plain dash) so they don't read alike.
export function Placeholder() {
  return <span className="text-xs italic text-neutral-400">not yet ingested</span>;
}

export function NoData() {
  return (
    <span className="text-xs text-neutral-400" title="no data available for this feature">
      <span className="text-neutral-300">—</span> no data
    </span>
  );
}

// A full-width box sized to match the content that will replace it, so a graphical section keeps the
// SAME footprint whether it's loading, empty (poorly-annotated gene), or rendered — no layout shift,
// and the page above the scroll anchor stays put. Pass a px `height` or a Tailwind `heightClass`
// (e.g. 'h-72'). `loading` pulses; `loading={false}` is the static empty state (dashed, "no data").
export function LoadingBox({ height, heightClass, label = 'loading…', dashed = false, loading = true }: { height?: number; heightClass?: string; label?: string; dashed?: boolean; loading?: boolean }) {
  return (
    <div
      style={height != null ? { height } : undefined}
      className={`flex w-full items-center justify-center rounded border ${dashed || !loading ? 'border-dashed border-neutral-300' : 'border-neutral-200'} bg-neutral-50 text-xs italic text-neutral-400 ${heightClass ?? ''}`}
    >
      <span className={loading ? 'animate-pulse' : ''}>{label}</span>
    </div>
  );
}

// A fixed-size inline placeholder matching a small General-section viz (distribution sparkline,
// expression dumbbell, localisation diagram), so every gene's field rows keep the same height even
// when the field has no data. `loading` pulses; otherwise it's the static empty state.
export function VizPlaceholder({ w, h, loading = false }: { w: number; h: number; loading?: boolean }) {
  return (
    <div
      style={{ width: w, height: h }}
      title={loading ? 'loading…' : 'no data available for this feature'}
      className={`flex shrink-0 items-center justify-center rounded border border-dashed border-neutral-200 bg-neutral-50 text-[10px] text-neutral-300 ${loading ? 'animate-pulse' : ''}`}
    >
      {loading ? '' : 'no data'}
    </div>
  );
}

// ── Canonical accent palette ────────────────────────────────────────────────────────────────────
// The entry page draws EVERY semantic colour from these six hues (+ the neutral ramp), so the page
// reads as one family instead of ~20 near-duplicate hues. Each axis (central dogma, level scale, TF
// effect, KEGG class, relationship kind) maps onto a subset; the per-section legend disambiguates the
// reuse. Marks/strokes use the hex; chips use ACCENT_CHIP (light fill, flipped in dark mode).
export const ACCENT = { blue: '#2563eb', teal: '#0d9488', indigo: '#4f46e5', green: '#16a34a', amber: '#d97706', red: '#dc2626' } as const;
export type Accent = keyof typeof ACCENT;
export const ACCENT_CHIP: Record<Accent, string> = {
  blue: 'bg-blue-50 text-blue-900 ring-1 ring-inset ring-blue-200 dark:bg-blue-950 dark:text-blue-200 dark:ring-blue-900',
  teal: 'bg-teal-50 text-teal-900 ring-1 ring-inset ring-teal-200 dark:bg-teal-950 dark:text-teal-200 dark:ring-teal-900',
  indigo: 'bg-indigo-50 text-indigo-900 ring-1 ring-inset ring-indigo-200 dark:bg-indigo-950 dark:text-indigo-200 dark:ring-indigo-900',
  green: 'bg-green-50 text-green-900 ring-1 ring-inset ring-green-200 dark:bg-green-950 dark:text-green-200 dark:ring-green-900',
  amber: 'bg-amber-50 text-amber-900 ring-1 ring-inset ring-amber-200 dark:bg-amber-950 dark:text-amber-200 dark:ring-amber-900',
  red: 'bg-red-50 text-red-900 ring-1 ring-inset ring-red-200 dark:bg-red-950 dark:text-red-200 dark:ring-red-900',
};

export type ChipSource = 'KG' | 'UP';
// Annotation source chips: KEGG = amber (KEGG's hue throughout), UniProt = blue.
const CHIP_CLASS: Record<ChipSource, string> = {
  KG: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
  UP: 'bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-200',
};

export function chipClass(source?: ChipSource) {
  return source ? CHIP_CLASS[source] : 'bg-neutral-100 text-neutral-700';
}

// The General panel's identity hue is THEME (tab10 blue): its term chips (function/pathway) and level
// chips (essentiality/mutability/conservedness/expression) all read as one blue family.
export const THEME_CHIP = 'bg-blue-50 text-blue-900 ring-1 ring-inset ring-blue-200 dark:bg-blue-950 dark:text-blue-200 dark:ring-blue-900';

// Low / medium / high chips are a monochrome THEME (blue) intensity ramp — magnitude by depth, high =
// most intense. (Replaces the old diverging blue→amber→red scale; direction no longer encoded.)
export type Level = 'low' | 'medium' | 'high';
const LEVEL_CHIP: Record<Level, string> = {
  low: 'bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300',
  medium: 'bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-200',
  high: 'bg-blue-200 text-blue-900 dark:bg-blue-800/60 dark:text-blue-100',
};
export const levelClass = (level: Level) => LEVEL_CHIP[level];
const LEVEL_HEX: Record<Level, string> = { low: tint(THEME, 0.5), medium: tint(THEME, 0.22), high: THEME };
export const levelHex = (level: Level) => LEVEL_HEX[level];
// Distribution-curve fill — a light THEME tint, so single-distribution tracks (mutation, conservation)
// stay within the General panel's blue family (was neutral grey).
export const DIST_FILL = tint(THEME, 0.58);

export function TagList({ tags, source }: { tags: string[]; source?: ChipSource }) {
  if (tags.length === 0) return <NoData />;
  return (
    <ul className="flex flex-wrap gap-1">
      {tags.map((t, i) => (
        <li key={`${t}-${i}`} className={`rounded px-1.5 py-0.5 text-xs ${chipClass(source)}`}>
          {t}
        </li>
      ))}
    </ul>
  );
}

export function Breadcrumb({ levels, source, chip }: { levels: string[][]; source?: ChipSource; chip?: string }) {
  const cls = chip ?? chipClass(source);
  const nonEmpty = levels.filter((l) => l.length > 0);
  if (nonEmpty.length === 0) return <NoData />;
  return (
    <div className="flex flex-wrap items-center gap-x-1 gap-y-1">
      {nonEmpty.map((level, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="text-neutral-400">›</span>}
          <span className="flex flex-wrap items-center gap-x-1 gap-y-1">
            {level.map((v, j) => (
              <Fragment key={`${v}-${j}`}>
                {j > 0 && <span className="text-neutral-300">/</span>}
                <span className={`rounded px-1.5 py-0.5 text-xs ${cls}`}>{v}</span>
              </Fragment>
            ))}
          </span>
        </Fragment>
      ))}
    </div>
  );
}
