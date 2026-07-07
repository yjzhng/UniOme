import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Feature, Interactions, RnaEntry, RnaFeatures, ProteinComplexes, Variants, RnaModification } from '@uniome/shared';
import { Breadcrumb, Field, InfoTip, NoData, Placeholder, Section } from '../components/Fields';
import { useEntryActive } from '../lib/entryActive';
import { ExpressionBar } from '../components/ExpressionField';
import { LocalisationField } from '../components/LocalisationField';
import { SOURCE_INFO, getSourceInfo } from '../sourceInfo';
import { RnaComplexView } from './RnaComplexView';
import { ComplexTable } from './ProteinDomainViewer';
import { SequenceView } from '../components/SequenceView';
import { TableScroller } from '../components/TableScroller';

const MolstarViewer = lazy(() => import('./MolstarViewer'));

const STRUCT_H = 'h-[26rem]';

// Structural motifs: coloured by family, reusing AlphaFold's pLDDT palette
// (light-blue / yellow / orange for stem / loop / junction).
const FAMILY_COLOR: Record<string, string> = {
  stem: '#65CBF3',
  loop: '#FFDB13',
  junction: '#FF7D45',
  pseudoknot: '#0053D6',
  end: '#b3b3aa',
};
// Dark mode recolours the R2DT SVG's black `black`/`blue` classes to light via CSS (.dark .rna2d … in
// styles.css) rather than an invert() filter — a filter forces the browser to rasterise the vector SVG
// (blurry text on zoom) and also mangles the colour-coded annotation overlay. CSS keeps it crisp.
// Functional regions (arms / domains) — distinct named features, coloured like protein domains, from
// the shared tab10 theme palette, one colour per region.
import { PALETTE as REGION_PALETTE, THEME, ACCENT1, ACCENT4, shade } from '../lib/theme';
// Fixed colour of the Rfam Family track item — reused by the Relationships "shared family" square.
export const RNA_FAMILY_COLOR = THEME;

const RNA3DHUB_LOOP = (loopId: string) => `https://rna.bgsu.edu/rna3dhub/loops/view/${loopId}`;

// Lighten a hex colour toward white by `amt` (0..1) — for alternating helix shades.
function mixWhite(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v + (255 - v) * amt));
  return `#${((ch[0] << 16) | (ch[1] << 8) | ch[2]).toString(16).padStart(6, '0')}`;
}

// One rendered row across track / table / sequence / 2D / 3D.
interface TrackItem {
  key: string;
  color: string;
  name: string; // element label / region name
  sub: string | null; // type / detail
  length: number;
  unit: string;
  segments: Array<[number, number]>;
  link: string | null; // RNA 3D Hub loop page, for motifs observed in 3D
}
interface Layer {
  id: string;
  label: string;
  nameHeader: string;
  subHeader: string;
  items: TrackItem[];
  source: string; // provenance footer shown below the table
  info?: string; // data-source tooltip text
  loading?: boolean; // still fetching — an empty bar reads "loading…" rather than "no data"
}

type SeqRegion = { segments: Array<[number, number]>; color: string };
type RegionEmit = (segments: Array<[number, number]> | null, color: string | null) => void;

export function RnaPanel({ feature, taxid, carried, onRegion }: { feature: Feature; taxid: string; carried?: SeqRegion | null; onRegion?: RegionEmit }) {
  const id = feature.uniqID;
  const [entry, setEntry] = useState<RnaEntry | null | undefined>(undefined);
  const [interactions, setInteractions] = useState<Interactions | null | undefined>(undefined);
  const [complexes, setComplexes] = useState<ProteinComplexes | null>(null);

  useEffect(() => {
    let cancelled = false;
    setEntry(undefined);
    setInteractions(undefined);
    setComplexes(null);
    fetch(`/api/organism/${taxid}/rna/${encodeURIComponent(id)}/entry`)
      .then((r) => (r.ok ? r.json() : null))
      .then((e) => !cancelled && setEntry(e))
      .catch(() => !cancelled && setEntry(null));
    fetch(`/api/organism/${taxid}/features/${encodeURIComponent(id)}/interactions`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => !cancelled && setInteractions(d))
      .catch(() => !cancelled && setInteractions(null));
    fetch(`/api/organism/${taxid}/rna/${encodeURIComponent(id)}/complexes`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => !cancelled && setComplexes(d))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [id, taxid]);

  if (entry) return <RnaStructurePanel feature={feature} taxid={taxid} entry={entry} interactions={interactions} complexes={complexes} carried={carried ?? null} onRegion={onRegion} />;
  return <RnaInfoSection feature={feature} taxid={taxid} loading={entry === undefined} interactions={interactions} carried={carried ?? null} />;
}

// No RNAcentral assets (e.g. the mRNA of a CDS): same field set + layout as the structured
// panel. There is no folded structure, so the right column carries the interactive feature
// tracks (variants / modifications) — mirroring the protein viewer, hover-synced to the
// sequence on the left. Falls back to a plain "no structure" slot when no features exist.
function RnaInfoSection({ feature: f, taxid, loading, interactions, carried }: { feature: Feature; taxid: string; loading: boolean; interactions: Interactions | null | undefined; carried: SeqRegion | null }) {
  const rnaName = f.type === 'CDS' ? f.gene : f.product || f.gene;
  const resolving = loading ? <span className="text-xs text-neutral-400">resolving…</span> : <NoData />;
  const length = f.rna_len ?? (f.rna_seq?.length ?? 1);
  const layers = useNtFeatureLayers(taxid, f.uniqID);
  const t = useNtTracks(layers, length, f.rna_seq ?? null);
  return (
    <Section title="RNA level" level="RNA">
      <div className="grid grid-cols-1 gap-x-6 gap-y-4 lg:grid-cols-2 lg:items-start">
        {/* Left: info, interactions, then the feature tracks below interactions. */}
        <div className="space-y-2">
          <Field label="name" value={rnaName || <NoData />} />
          <Field label="RNAcentral" info={SOURCE_INFO.rnacentral} value={resolving} />
          <Field label="SO classification" info={SOURCE_INFO.rnacentral} value={resolving} />
          <Field label="length" value={f.rna_len !== null ? `${f.rna_len.toLocaleString()} nt` : <NoData />} />
          {f.type !== 'CDS' && <LocalisationField value={f.localisation} />}
          <ExpressionBar taxid={taxid} uniqID={f.uniqID} kind="transcript" />
          <Field label="interactions" info={SOURCE_INFO.interactionsRna} value={<RnaInteractions interactions={interactions} chrom={f.chrom} rnaGene={f.type !== 'CDS'} />} />
          {f.type !== 'CDS' && <Field label="reactions" info={SOURCE_INFO.reactions} value={<Placeholder />} />}
          {/* No folded structure for an mRNA — the feature tracks (Variants always; Modifications
              shows "no data" for mRNA) sit here below interactions. */}
          <FeaturePanel layers={layers} active={t.active} length={length} selected={t.selected} onActivate={t.switchLayer} onHover={t.setHovered} onToggle={t.toggleLock} />
        </div>
        {/* Right: the interactive sequence. */}
        <div className="space-y-2">
          {f.rna_seq ? (
            <InteractiveSequence seq={f.rna_seq} tickInterval={15} residueSpan={t.residueSpan} highlights={t.highlights} selected={t.selected} onHover={t.setHovered} onCopyItem={t.copyItem} carried={carried} />
          ) : (
            <Field label="sequence" value={<NoData />} />
          )}
        </div>
      </div>
    </Section>
  );
}

function RnaStructurePanel({ feature: f, taxid, entry, interactions, complexes, carried, onRegion }: { feature: Feature; taxid: string; entry: RnaEntry; interactions: Interactions | null | undefined; complexes: ProteinComplexes | null; carried: SeqRegion | null; onRegion?: RegionEmit }) {
  const id = f.uniqID;
  const has3d = !!entry.pdb;
  const [mode, setMode] = useState<'2d' | '3d'>('2d');
  const entryActive = useEntryActive(); // gate the WebGL 3D viewer to the on-screen entry (pool keep-alive)
  // Structure selection: '' = the RNA monomer (2D/3D), else a Complex Portal complex ac
  // (shown via RnaComplexView). Mirrors the protein panel's complex switcher.
  const [activeComplex, setActiveComplex] = useState('');
  const [hovered, setHovered] = useState<string | null>(null);
  const [locked, setLocked] = useState<string | null>(null);
  const [features, setFeatures] = useState<RnaFeatures | null>(null);
  const [variants, setVariants] = useState<Variants | null | undefined>(undefined);
  const [rnaMods, setRnaMods] = useState<RnaModification[] | null | undefined>(undefined);
  const [activeLayer, setActiveLayer] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    setFeatures(null); setVariants(undefined); setRnaMods(undefined);
    setHovered(null);
    setLocked(null);
    setActiveLayer(null);
    setActiveComplex('');
    fetch(`/api/organism/${taxid}/rna/${encodeURIComponent(id)}/features`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => !cancelled && setFeatures(d))
      .catch(() => {});
    fetch(`/api/organism/${taxid}/features/${encodeURIComponent(id)}/variants`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => !cancelled && setVariants(d ?? null))
      .catch(() => !cancelled && setVariants(null));
    fetch(`/api/organism/${taxid}/features/${encodeURIComponent(id)}/rna-modifications`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => !cancelled && setRnaMods(d ?? null))
      .catch(() => !cancelled && setRnaMods(null));
    return () => {
      cancelled = true;
    };
  }, [id, taxid]);

  // Build the layers: Family (Rfam) on top, then functional region tracks, then motifs.
  const layers: Layer[] = useMemo(() => {
    const out: Layer[] = [];
    const len = features?.length ?? 1;
    const rf = features?.rfam;
    if (rf?.acc) {
      const a = (rf.start ?? 0) + 1; // rfam-hits start is 0-based
      const b = rf.end ?? len;
      out.push({
        id: 'family',
        label: 'Family',
        nameHeader: 'family',
        subHeader: 'name',
        source: 'Rfam (via RNAcentral)',
        info: SOURCE_INFO.track_rnaFamily,
        items: [{ key: 'family', color: RNA_FAMILY_COLOR, name: rf.acc, sub: rf.id, length: b - a + 1, unit: 'nt', segments: [[a, b]], link: `https://rfam.org/family/${rf.acc}` }],
      });
    }
    // Provenance per functional-region track (Arms = tRNA Sprinzl, Domains = rRNA
    // secondary-structure numbering, Helices = RiboVision E. coli tables).
    const regionSource = (label: string) =>
      label === 'Helices' ? 'RiboVision · E. coli helix numbering'
      : label === 'Arms' ? 'R2DT template · Sprinzl numbering'
      : label === 'Domains' ? '16S secondary-structure domains (CRW) · E. coli numbering'
      : 'R2DT template numbering';
    const regionLayers = features?.regionLayers ?? [];
    // Domain colours (REGION_PALETTE); helices inherit their parent domain's colour in
    // alternating shades (like CDD motifs adopting their domain colour in the protein view).
    const domainColors = (regionLayers.find((L) => L.label === 'Domains')?.regions ?? []).map((r, i) => ({ segments: r.segments, color: REGION_PALETTE[i % REGION_PALETTE.length] }));
    const domainColorAt = (pos: number) => domainColors.find((d) => d.segments.some(([a, b]) => pos >= a && pos <= b))?.color ?? null;

    regionLayers.forEach((L, li) => {
      let items: TrackItem[];
      if (L.label === 'Helices' && domainColors.length) {
        const shadeCount = new Map<string, number>();
        items = L.regions.map((r) => {
          const base = domainColorAt(r.segments[0]?.[0]) ?? '#9c9c9c';
          const n = shadeCount.get(base) ?? 0;
          shadeCount.set(base, n + 1);
          const color = n % 2 === 0 ? base : mixWhite(base, 0.45);
          return { key: r.key, color, name: r.label, sub: r.detail, length: r.length, unit: r.unit, segments: r.segments, link: null };
        });
      } else {
        items = L.regions.map((r, i) => ({ key: r.key, color: REGION_PALETTE[i % REGION_PALETTE.length], name: r.label, sub: r.detail, length: r.length, unit: r.unit, segments: r.segments, link: null }));
      }
      out.push({
        id: `region${li}`,
        label: L.label,
        nameHeader: L.label === 'Helices' ? 'helix' : L.label === 'Arms' ? 'arm' : 'region',
        subHeader: 'detail',
        source: regionSource(L.label),
        info: SOURCE_INFO.track_rnaRegions,
        items,
      });
    });
    if (features?.features?.length) {
      out.push({
        id: 'motifs',
        label: 'Motifs',
        nameHeader: 'element',
        subHeader: 'type',
        source: 'decoded from R2DT secondary structure',
        info: SOURCE_INFO.track_rnaStructure,
        items: features.features.map((ft) => ({ key: ft.key, color: FAMILY_COLOR[ft.family] ?? '#999', name: ft.element, sub: ft.type, length: ft.length, unit: ft.unit, segments: ft.segments, link: ft.observed3d ? RNA3DHUB_LOOP(ft.observed3d) : null })),
      });
    }
    // Natural variants (genome panel) + modified nucleotides (MODOMICS) — point features,
    // hover-synced to the sequence / 2D / 3D like the structural motifs above. Both always
    // shown (empty → "no data"), variants above modifications.
    out.push(variantsLayer(variants, taxid));
    out.push(modificationsLayer(rnaMods));
    return out;
  }, [features, rnaMods, variants, taxid]);

  const active = layers.find((l) => l.id === activeLayer) ?? layers[0] ?? null;
  const items = active?.items ?? [];
  const selected = hovered ?? locked;
  const toggleLock = (key: string) => setLocked((cur) => (cur === key ? null : key));
  const switchLayer = (lid: string) => { setActiveLayer(lid); setHovered(null); setLocked(null); };

  // Carry the pinned feature's region up to the entry page (so it propagates to the
  // DNA level). `items` is stable (memoised); emitting null when nothing is pinned is a no-op.
  const onRegionRef = useRef(onRegion);
  onRegionRef.current = onRegion;
  useEffect(() => {
    const it = locked ? items.find((x) => x.key === locked) : null;
    onRegionRef.current?.(it ? it.segments : null, it ? it.color : null);
  }, [locked, items]);

  const svgUrl = `/api/organism/${taxid}/rna/${encodeURIComponent(id)}/2d/svg`;
  const structureUrl = `/api/organism/${taxid}/rna/${encodeURIComponent(id)}/structure`;
  const rnaName = f.product || f.gene || entry.description;
  const length = features?.length ?? entry.length ?? f.rna_len ?? 1;

  const copyText = (text: string, label: string) => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(label);
      clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(null), 1500);
    }).catch(() => {});
  };
  const copyFull = () => f.rna_seq && copyText(f.rna_seq, 'full sequence');
  const copyItem = (key: string) => {
    const it = items.find((x) => x.key === key);
    if (it && f.rna_seq) copyText(it.segments.map(([a, b]) => f.rna_seq!.slice(a - 1, b)).join('-'), it.name);
  };

  const residueSpan = useMemo(() => {
    const arr = new Array<number>(length + 1).fill(-1);
    items.forEach((it, i) => it.segments.forEach(([a, b]) => { for (let p = a; p <= b && p <= length; p++) arr[p] = i; }));
    return arr;
  }, [items, length]);
  const highlights = useMemo(() => items.map((it) => ({ key: it.key, color: it.color })), [items]);
  const domains = useMemo(() => items.map((it) => ({ id: it.key, segments: it.segments, color: it.color, label: it.name })), [items]);

  return (
    <Section title="RNA level" level="RNA">
      <div className="grid grid-cols-1 gap-x-6 gap-y-4 lg:grid-cols-2 lg:items-start">
        {/* Left: identity, SO classification, sequence (tinted + copyable). */}
        <div className="space-y-2">
          <Field label="name" value={rnaName || <NoData />} />
          <Field
            label="RNAcentral"
            info={SOURCE_INFO.rnacentral}
            value={
              <a href={`https://rnacentral.org/rna/${entry.urs}/${entry.taxid}`} target="_blank" rel="noreferrer" className="font-mono underline decoration-neutral-300 hover:decoration-neutral-700">
                {entry.urs}_{entry.taxid}
              </a>
            }
          />
          <Field label="SO classification" info={SOURCE_INFO.rnacentral} value={<SoLineage lineage={entry.so.lineage} fallback={entry.so.rnaType} />} />
          <Field label="length" value={`${length.toLocaleString()} nt`} />
          {f.type !== 'CDS' && <LocalisationField value={f.localisation} />}
          <ExpressionBar taxid={taxid} uniqID={f.uniqID} kind="transcript" />
          {complexes && complexes.length > 0 && (
            <Field
              label="complexes"
              info={SOURCE_INFO.complexes}
              value={
                <ComplexTable
                  complexes={complexes}
                  acc={null}
                  hasMonomer={entry.has2d || has3d}
                  selected={activeComplex}
                  onSelect={setActiveComplex}
                  monomerName="2D / 3D"
                  monomerLink={`https://rnacentral.org/rna/${entry.urs}/${entry.taxid}`}
                  monomerClass="RNA"
                />
              }
            />
          )}
          <Field label="interactions" info={SOURCE_INFO.interactionsRna} value={<RnaInteractions interactions={interactions} chrom={f.chrom} rnaGene={f.type !== 'CDS'} />} />
          {f.type !== 'CDS' && <Field label="reactions" info={SOURCE_INFO.reactions} value={<Placeholder />} />}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-neutral-500">
                sequence
                <button type="button" onClick={copyFull} title="copy full sequence" className="cursor-pointer text-neutral-400 hover:text-neutral-700">
                  <CopyIcon />
                </button>
              </div>
              {copied && <span className="text-xs text-neutral-400">copied {copied} ✓</span>}
            </div>
            {f.rna_seq ? (
              <SequenceView seq={f.rna_seq} tickInterval={15} residueSpan={residueSpan} highlights={highlights} hovered={selected} onHover={setHovered} onCopy={copyItem} carried={carried} />
            ) : (
              <NoData />
            )}
          </div>
        </div>

        {/* Right: structure window + feature tracks + table. The complex switcher (when this
            RNA is in Complex Portal complexes) swaps the whole structure column to the complex
            assembly view, matching the protein panel. */}
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <SectionLabel>Structure</SectionLabel>
            {complexes && complexes.length > 0 && (
              <select
                value={activeComplex}
                onChange={(e) => setActiveComplex(e.target.value)}
                className="max-w-[14rem] truncate rounded border border-neutral-300 bg-white px-1.5 py-0.5 text-xs text-neutral-700"
                title="show structural state"
              >
                <option value="">Monomer</option>
                {complexes.map((c) => (
                  <option key={c.ac} value={c.ac}>{c.assembly ?? '—'}</option>
                ))}
              </select>
            )}
          </div>

          {activeComplex !== '' ? (
            <RnaComplexView taxid={taxid} chrom={f.chrom} active={(complexes ?? []).find((c) => c.ac === activeComplex)!} />
          ) : (
            <>
              <div className="flex items-center justify-between gap-2">
                <div className="inline-flex overflow-hidden rounded border border-neutral-300 text-xs">
                  <ToggleButton active={mode === '2d'} onClick={() => setMode('2d')}>2D</ToggleButton>
                  <ToggleButton active={mode === '3d'} disabled={!has3d} title={has3d ? undefined : 'no experimental 3D structure'} onClick={() => setMode('3d')}>3D</ToggleButton>
                </div>
                <span className="truncate text-xs text-neutral-500">{mode === '2d' ? '2D · R2DT secondary structure' : '3D · experimental (PDBe)'}</span>
              </div>

              <div className={`relative overflow-hidden rounded border border-neutral-200 bg-white ${STRUCT_H}`}>
                {mode === '2d' ? (
                  entry.has2d ? (
                    <PanZoom>
                      <Rna2D url={svgUrl} items={items} selected={selected} onHover={setHovered} onToggle={toggleLock} />
                    </PanZoom>
                  ) : (
                    <Centered>no 2D structure available</Centered>
                  )
                ) : !entryActive ? (
                  <Centered>3D viewer paused — return to this gene to view</Centered>
                ) : (
                  <Suspense fallback={<Centered>loading 3D…</Centered>}>
                    <MolstarViewer structureUrl={structureUrl} heightClass={STRUCT_H} chain={entry.pdb?.chain ?? null} domains={domains} hovered={selected} onHover={setHovered} />
                  </Suspense>
                )}
              </div>

              <p className="truncate text-xs text-neutral-500">
                {mode === '2d'
                  ? 'scroll to zoom · drag to pan · 2D layout by R2DT (RNAcentral)'
                  : entry.pdb
                    ? `${entry.pdb.chain ? `chain ${entry.pdb.chain} of ` : ''}PDB ${entry.pdb.pdbId}` +
                      `${entry.pdb.method ? ` · ${entry.pdb.method.toLowerCase()}` : ''}` +
                      `${entry.pdb.resolution ? ` · ${entry.pdb.resolution} Å` : ''}`
                    : null}
              </p>

              <FeaturePanel layers={layers} active={active} length={length} selected={selected} onActivate={switchLayer} onHover={setHovered} onToggle={toggleLock} />
            </>
          )}
        </div>
      </div>
    </Section>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{children}</div>;
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function ToggleButton({ active, disabled, title, onClick, children }: { active: boolean; disabled?: boolean; title?: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title} className={`px-3 py-1 font-medium transition-colors ${active ? 'bg-neutral-800 text-white' : 'bg-white text-neutral-700 hover:bg-neutral-100'} ${disabled ? 'cursor-not-allowed opacity-40 hover:bg-white' : ''}`}>
      {children}
    </button>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full w-full items-center justify-center text-xs text-neutral-400">{children}</div>;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function PanZoom({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const [view, setView] = useState({ s: 1, tx: 0, ty: 0 });

  const zoomAt = (clientX: number, clientY: number, factor: number) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const mx = clientX - (r.left + r.width / 2);
    const my = clientY - (r.top + r.height / 2);
    setView((v) => {
      const s = clamp(v.s * factor, 1, 14);
      if (s === 1) return { s: 1, tx: 0, ty: 0 };
      const k = s / v.s;
      return { s, tx: mx - k * (mx - v.tx), ty: my - k * (my - v.ty) };
    });
  };
  const zoomCentre = (factor: number) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    zoomAt(r.left + r.width / 2, r.top + r.height / 2, factor);
  };
  const wheelRef = useRef<(e: WheelEvent) => void>(() => {});
  wheelRef.current = (e) => { e.preventDefault(); zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.12 : 1 / 1.12); };
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const h = (e: WheelEvent) => wheelRef.current(e);
    el.addEventListener('wheel', h, { passive: false });
    return () => el.removeEventListener('wheel', h);
  }, []);

  return (
    <div
      ref={ref}
      className="h-full w-full cursor-grab touch-none overflow-hidden active:cursor-grabbing"
      onPointerDown={(e) => { drag.current = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty }; e.currentTarget.setPointerCapture(e.pointerId); }}
      onPointerMove={(e) => { const d = drag.current; if (!d) return; setView((v) => ({ ...v, tx: d.tx + (e.clientX - d.x), ty: d.ty + (e.clientY - d.y) })); }}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
    >
      <div className="flex h-full w-full items-center justify-center" style={{ transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.s})`, transformOrigin: 'center' }}>
        {children}
      </div>
      <div
        onPointerDown={(e) => e.stopPropagation()}
        className="absolute right-1.5 top-1.5 flex flex-col overflow-hidden rounded border border-neutral-300 bg-white/90 text-neutral-700 shadow-sm"
      >
        <ZoomBtn onClick={() => zoomCentre(1.3)} title="zoom in">+</ZoomBtn>
        <ZoomBtn onClick={() => zoomCentre(1 / 1.3)} title="zoom out">−</ZoomBtn>
        <ZoomBtn onClick={() => setView({ s: 1, tx: 0, ty: 0 })} title="fit">⤢</ZoomBtn>
      </div>
    </div>
  );
}

function ZoomBtn({ onClick, title, children }: { onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button type="button" title={title} onClick={onClick} className="h-6 w-6 border-b border-neutral-200 text-sm leading-none last:border-b-0 hover:bg-neutral-100">
      {children}
    </button>
  );
}

function scopeSvgStyles(svg: string, scope: string): string {
  return svg.replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, (_m, css: string) => {
    const clean = css.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    const scoped = clean.replace(/([^{}]+)\{/g, (mm: string, sel: string) => {
      if (sel.includes('@')) return mm;
      return sel.split(',').map((s) => (s.trim() ? `.${scope} ${s.trim()}` : s)).join(', ') + '{';
    });
    return `<style>${scoped}</style>`;
  });
}

const SVG_NS = 'http://www.w3.org/2000/svg';

// R2DT 2D layout, inlined (styles scoped) so nucleotides are addressable. A persistent
// feature layer (one disc per nucleotide of the active layer, coloured per feature) sits
// behind the letters; hover/lock adjusts disc opacity. Groups are
// `<g><title>P (…)</title><text x y>L</text></g>` with P = 1-based sequence position.
function Rna2D({ url, items, selected, onHover, onToggle }: { url: string; items: TrackItem[]; selected: string | null; onHover: (k: string | null) => void; onToggle: (k: string) => void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'loading' | 'ok' | 'none'>('loading');
  const onHoverRef = useRef(onHover); onHoverRef.current = onHover;
  const onToggleRef = useRef(onToggle); onToggleRef.current = onToggle;

  const featByPos = useMemo(() => {
    const m = new Map<number, string>();
    items.forEach((it) => it.segments.forEach(([a, b]) => { for (let p = a; p <= b; p++) m.set(p, it.key); }));
    return m;
  }, [items]);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    fetch(url)
      .then((r) => (r.ok ? r.text() : null))
      .then((txt) => {
        if (cancelled) return;
        const host = hostRef.current;
        if (!txt || !host) { setStatus('none'); return; }
        const scope = 'rna2d';
        host.className = `${scope} flex h-full w-full items-center justify-center`;
        host.innerHTML = scopeSvgStyles(txt, scope);
        const svg = host.querySelector('svg');
        if (!svg) { setStatus('none'); return; }
        const w = parseFloat(svg.getAttribute('width') || '');
        const h = parseFloat(svg.getAttribute('height') || '');
        if (!svg.getAttribute('viewBox') && Number.isFinite(w) && Number.isFinite(h)) svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
        svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
        svg.removeAttribute('width');
        svg.removeAttribute('height');
        svg.style.width = '100%';
        svg.style.height = '100%';

        const map = new Map<number, { x: number; y: number }>();
        host.querySelectorAll('g').forEach((g) => {
          const title = g.querySelector('title');
          const text = g.querySelector('text');
          if (!title || !text) return;
          const mp = /^(\d+)/.exec(title.textContent || '');
          if (!mp) return;
          const pos = Number(mp[1]);
          const x = parseFloat(text.getAttribute('x') || '');
          const y = parseFloat(text.getAttribute('y') || '');
          if (!Number.isFinite(x) || !Number.isFinite(y)) return;
          map.set(pos, { x, y });
          const key = featByPos.get(pos);
          if (key) {
            (g as SVGGElement).style.cursor = 'pointer';
            g.addEventListener('mouseenter', () => onHoverRef.current(key));
            g.addEventListener('mouseleave', () => onHoverRef.current(null));
            g.addEventListener('click', () => onToggleRef.current(key));
          }
        });

        const layer = document.createElementNS(SVG_NS, 'g');
        layer.setAttribute('id', 'feat-layer');
        layer.setAttribute('pointer-events', 'none');
        // Size the highlight disc to the R2DT scale: ~40% of the median backbone step between consecutive
        // nucleotides, so each disc covers its own base without merging into a halo/tube (the fixed r=9 was
        // wider than the spacing in denser layouts). Clamped to a sane range.
        const steps: number[] = [];
        for (const [p, xy] of map) { const n = map.get(p + 1); if (n) steps.push(Math.hypot(n.x - xy.x, n.y - xy.y)); }
        steps.sort((a, b) => a - b);
        const step = steps.length ? steps[steps.length >> 1] : 15;
        const R = String(Math.max(3, Math.min(8, step * 0.4)));
        for (const it of items) {
          for (const [a, b] of it.segments) {
            for (let p = a; p <= b; p++) {
              const nt = map.get(p);
              if (!nt) continue;
              const c = document.createElementNS(SVG_NS, 'circle');
              c.setAttribute('cx', String(nt.x));
              c.setAttribute('cy', String(nt.y));
              c.setAttribute('r', R);
              c.setAttribute('fill', it.color);
              c.setAttribute('data-key', it.key);
              layer.appendChild(c);
            }
          }
        }
        svg.insertBefore(layer, svg.firstChild);
        setStatus('ok');
      })
      .catch(() => !cancelled && setStatus('none'));
    return () => { cancelled = true; };
  }, [url, featByPos, items]);

  useEffect(() => {
    const layer = hostRef.current?.querySelector('#feat-layer');
    if (!layer) return;
    layer.querySelectorAll('circle').forEach((c) => {
      const k = c.getAttribute('data-key');
      c.setAttribute('opacity', selected == null ? '0.42' : k === selected ? '0.85' : '0.1');
    });
  }, [selected, status]);

  if (status === 'none') return <Centered>no 2D structure available</Centered>;
  return <div ref={hostRef} className="flex h-full w-full items-center justify-center" />;
}

// One track row: label on the left (click an inactive track to make it active — like the
// protein track switcher), square boxes laid out along the sequence, coloured per item.
function FeatureTrack({ label, info, items, length, active, selected, note, onActivate, onHover, onToggle }: { label: string; info?: string; items: TrackItem[]; length: number; active: boolean; selected: string | null; note?: string | null; onActivate: () => void; onHover: (k: string | null) => void; onToggle: (k: string) => void }) {
  const pct = (x: number) => `${(x / length) * 100}%`;
  // Measure the bar so a box only prints its name when the text fits (~6px/char at 10px).
  const barRef = useRef<HTMLDivElement>(null);
  const [barPx, setBarPx] = useState(0);
  useEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const measure = () => setBarPx(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const pxPerRes = barPx > 0 ? barPx / length : 0;
  const fits = (text: string, residues: number) => pxPerRes > 0 && residues * pxPerRes >= text.length * 6 + 6;
  return (
    <div
      onClick={onActivate}
      className={
        'flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 transition-colors ' +
        (active ? 'bg-neutral-100 ring-1 ring-inset ring-neutral-300' : 'hover:bg-neutral-50')
      }
    >
      <div className={`flex w-16 shrink-0 items-center gap-1 text-[11px] ${active ? 'font-medium text-neutral-800' : 'text-neutral-500'}`}>
        <span className="min-w-0 truncate" title={label}>{label}</span>
        {info && <span className="ml-auto" onClick={(e) => e.stopPropagation()}><InfoTip text={info} /></span>}
      </div>
      <div ref={barRef} className="relative h-6 flex-1">
        <div className="absolute inset-x-0 top-1 bottom-1 bg-neutral-200" />
        {note && <div className="absolute inset-y-0 left-2 flex items-center text-[10px] italic text-neutral-400">{note}</div>}
        {items.flatMap((it) => {
          // Print the name only on the widest segment (so a two-stranded stem isn't doubled).
          let wide = 0;
          it.segments.forEach((s, i) => { if (s[1] - s[0] > it.segments[wide][1] - it.segments[wide][0]) wide = i; });
          const hot = active && selected === it.key;
          const dim = active && selected !== null && !hot;
          return it.segments.map((s, i) => (
            <div
              key={`${it.key}-${i}`}
              onMouseEnter={active ? () => onHover(it.key) : undefined}
              onMouseLeave={active ? () => onHover(null) : undefined}
              onClick={active ? (e) => { e.stopPropagation(); onToggle(it.key); } : undefined}
              title={`${it.name}${it.sub ? ` · ${it.sub}` : ''} (${s[0]}–${s[1]})`}
              className={'absolute top-1 bottom-1 flex items-center justify-center overflow-hidden text-[10px] font-medium text-[#fff] transition-opacity ' + (active ? 'cursor-pointer' : '')}
              style={{ left: pct(s[0] - 1), width: pct(s[1] - s[0] + 1), backgroundColor: it.color, opacity: active ? (dim ? 0.25 : 1) : 0.5 }}
            >
              {i === wide && fits(it.name, s[1] - s[0] + 1) && it.name}
            </div>
          ));
        })}
      </div>
    </div>
  );
}

// A switchable "Modifications" track from MODOMICS modified nucleotides (rRNA + tRNA). Always
// built so the track stays in the stack like the protein viewer's tracks; an mRNA has no
// catalogued modifications, so its bar reads "no data". `undefined` = still loading.
export function modificationsLayer(mods: RnaModification[] | null | undefined): Layer {
  return {
    id: 'modifications', label: 'Modifications', nameHeader: 'modification', subHeader: 'symbol',
    source: 'MODOMICS modified nucleotides', info: SOURCE_INFO.rnaModifications, loading: mods === undefined,
    items: (mods ?? []).map((m) => ({ key: `mod-${m.pos}`, color: ACCENT4, name: m.name.replace(/-5'-monophosphate$/, ''), sub: m.symbol, length: 1, unit: 'nt', segments: [[m.pos, m.pos]], link: null })),
  };
}

// A switchable "Variants" track from the genome-panel natural nucleotide variants. Always built
// (empty → "no data"). `undefined` = still loading.
export function variantsLayer(v: Variants | null | undefined, taxid: string): Layer {
  return {
    id: 'variants', label: 'Variants', nameHeader: 'variant', subHeader: 'genomes',
    source: v ? `natural variants across ${v.n} genomes` : 'natural variants across the genome panel',
    info: getSourceInfo('variants', taxid), loading: v === undefined,
    items: (v?.sites ?? []).map(([pos, ref, alt, count]) => ({ key: `var-${pos}`, color: ACCENT1, name: `${ref}→${alt}`, sub: `${count}/${v!.n}`, length: 1, unit: 'nt', segments: [[pos, pos]], link: null })),
  };
}

// E. coli DNA methylation, computed from the sequence into one "Modifications" track: Dam
// (GATC → N6-methyladenine) + Dcm (CCWGG → 5-methylcytosine). Both in the ACCENT4 (green)
// modification family, kept distinct by depth — Dam = accent4, Dcm = a darker green. The
// methylated base sits at offset +2 in each motif. No external data needed.
const DAM_COLOR = ACCENT4;
const DCM_COLOR = shade(ACCENT4, 0.34);
export function dnaModificationsLayer(seq: string | null, taxid: string): Layer {
  const s = (seq ?? '').toUpperCase().replace(/U/g, 'T');
  const items: TrackItem[] = [];
  for (let i = 0; i + 4 <= s.length; i++) if (s.startsWith('GATC', i)) items.push({ key: `dam-${i + 2}`, color: DAM_COLOR, name: 'Dam', sub: 'GATC → N6-methyladenine', length: 1, unit: 'bp', segments: [[i + 2, i + 2]], link: null });
  for (let i = 0; i + 5 <= s.length; i++) { const m = s.slice(i, i + 5); if (m[0] === 'C' && m[1] === 'C' && (m[2] === 'A' || m[2] === 'T') && m[3] === 'G' && m[4] === 'G') items.push({ key: `dcm-${i + 2}`, color: DCM_COLOR, name: 'Dcm', sub: 'CCWGG → 5-methylcytosine', length: 1, unit: 'bp', segments: [[i + 2, i + 2]], link: null }); }
  items.sort((a, b) => a.segments[0][0] - b.segments[0][0]);
  return { id: 'modifications', label: 'Modifications', nameHeader: 'modification', subHeader: 'motif', source: 'computed Dam (GATC) + Dcm (CCWGG) methylation motifs', info: getSourceInfo('dnaModifications', taxid), items };
}

// Fetch a feature's nucleotide variants and combine with the computed DNA methylation track.
// Both tracks are always present (empty → "no data"), like the protein viewer's track stack.
export function useDnaFeatureLayers(taxid: string, uniqID: string, seq: string | null): Layer[] {
  const [variants, setVariants] = useState<Variants | null | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    setVariants(undefined);
    fetch(`/api/organism/${taxid}/features/${encodeURIComponent(uniqID)}/variants`)
      .then((r) => (r.ok ? r.json() : null)).then((d) => !cancelled && setVariants(d ?? null)).catch(() => !cancelled && setVariants(null));
    return () => { cancelled = true; };
  }, [taxid, uniqID]);
  return useMemo(() => [variantsLayer(variants, taxid), dnaModificationsLayer(seq, taxid)], [variants, seq, taxid]);
}

// Fetch a feature's nucleotide variants + RNA modifications and build their switchable layers.
// Shared by the structure-less mRNA (RnaInfoSection) and DNA (NucleotideTracks) viewers.
export function useNtFeatureLayers(taxid: string, uniqID: string): Layer[] {
  const [variants, setVariants] = useState<Variants | null | undefined>(undefined);
  const [rnaMods, setRnaMods] = useState<RnaModification[] | null | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    setVariants(undefined); setRnaMods(undefined);
    fetch(`/api/organism/${taxid}/features/${encodeURIComponent(uniqID)}/variants`)
      .then((r) => (r.ok ? r.json() : null)).then((d) => !cancelled && setVariants(d ?? null)).catch(() => !cancelled && setVariants(null));
    fetch(`/api/organism/${taxid}/features/${encodeURIComponent(uniqID)}/rna-modifications`)
      .then((r) => (r.ok ? r.json() : null)).then((d) => !cancelled && setRnaMods(d ?? null)).catch(() => !cancelled && setRnaMods(null));
    return () => { cancelled = true; };
  }, [taxid, uniqID]);
  // Both tracks always present (empty → "no data"), mirroring the protein viewer's track stack.
  return useMemo(() => [variantsLayer(variants, taxid), modificationsLayer(rnaMods)], [variants, rnaMods, taxid]);
}

// Shared hover/lock/active-layer state + the derived sequence-highlight maps, used by every
// feature-track viewer (RNA structure panel, plus the structure-less DNA / mRNA tracks).
export function useNtTracks(layers: Layer[], length: number, seq: string | null) {
  const [hovered, setHovered] = useState<string | null>(null);
  const [locked, setLocked] = useState<string | null>(null);
  const [activeLayer, setActiveLayer] = useState<string | null>(null);
  // A new feature delivers a fresh `layers` identity — drop any stale selection/active id.
  useEffect(() => { setHovered(null); setLocked(null); setActiveLayer(null); }, [layers]);
  const active = layers.find((l) => l.id === activeLayer) ?? layers[0] ?? null;
  const items = active?.items ?? [];
  const selected = hovered ?? locked;
  const toggleLock = (key: string) => setLocked((cur) => (cur === key ? null : key));
  const switchLayer = (lid: string) => { setActiveLayer(lid); setHovered(null); setLocked(null); };
  const residueSpan = useMemo(() => {
    const arr = new Array<number>(length + 1).fill(-1);
    items.forEach((it, i) => it.segments.forEach(([a, b]) => { for (let p = a; p <= b && p <= length; p++) arr[p] = i; }));
    return arr;
  }, [items, length]);
  const highlights = useMemo(() => items.map((it) => ({ key: it.key, color: it.color })), [items]);
  const copyItem = (key: string) => {
    const it = items.find((x) => x.key === key);
    if (it && seq) navigator.clipboard?.writeText(it.segments.map(([a, b]) => seq.slice(a - 1, b)).join('-')).catch(() => {});
  };
  return { active, items, selected, setHovered, switchLayer, toggleLock, residueSpan, highlights, copyItem };
}

// The "Features" block: the stack of switchable tracks + a 1..length axis + the active layer's
// detail table + a provenance footer. Stateless — selection state is owned by the caller (so it
// can sync hover with a sequence view and/or a structure window).
export function FeaturePanel({ layers, active, length, selected, onActivate, onHover, onToggle }: { layers: Layer[]; active: Layer | null; length: number; selected: string | null; onActivate: (id: string) => void; onHover: (k: string | null) => void; onToggle: (k: string) => void }) {
  if (!layers.length || !active) return null;
  // Empty-track note, like the protein viewer: "loading…" while fetching, else "no data".
  const emptyNote = (l: Layer) => (l.items.length ? null : l.loading ? 'loading…' : 'no data');
  return (
    <div className="space-y-1 pt-2">
      <SectionLabel>Features</SectionLabel>
      <div className="space-y-1">
        {layers.map((layer) => (
          <FeatureTrack
            key={layer.id}
            label={layer.label}
            info={layer.info}
            items={layer.items}
            length={length}
            active={layer.id === active.id}
            selected={selected}
            note={emptyNote(layer)}
            onActivate={() => onActivate(layer.id)}
            onHover={onHover}
            onToggle={onToggle}
          />
        ))}
      </div>
      <div className="relative ml-16 h-3 text-[10px] text-neutral-400">
        <span className="absolute left-0">1</span>
        <span className="absolute right-0">{length}</span>
      </div>
      {/* The detail table + provenance footer only apply when the active track has data. */}
      {active.items.length > 0 && (
        <>
          <FeatureTable layer={active} selected={selected} onHover={onHover} onToggle={onToggle} />
          <div className="text-[10px] text-neutral-400">{active.label.toLowerCase()}: {active.source}</div>
        </>
      )}
    </div>
  );
}

// A "sequence" header (copy-all) over the interactive SequenceView, hover-synced to the tracks.
export function InteractiveSequence({ seq, tickInterval, residueSpan, highlights, selected, onHover, onCopyItem, carried }: { seq: string; tickInterval?: number; residueSpan: number[]; highlights: Array<{ key: string; color: string }>; selected: string | null; onHover: (k: string | null) => void; onCopyItem: (k: string) => void; carried?: SeqRegion | null }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const copyAll = () => navigator.clipboard?.writeText(seq).then(() => {
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1500);
  }).catch(() => {});
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-neutral-500">
          sequence
          <button type="button" onClick={copyAll} title="copy full sequence" className="cursor-pointer text-neutral-400 hover:text-neutral-700">
            <CopyIcon />
          </button>
        </div>
        {copied && <span className="text-xs text-neutral-400">copied ✓</span>}
      </div>
      <SequenceView seq={seq} tickInterval={tickInterval} residueSpan={residueSpan} highlights={highlights} hovered={selected} onHover={onHover} onCopy={onCopyItem} carried={carried ?? null} />
    </div>
  );
}

// A structure-less interactive track viewer: an interactive sequence beside its feature tracks +
// table, hover-synced — the protein/RNA viewer minus the 3D window. Used for the DNA panel and a
// CDS's mRNA, where variants / modifications are the only features and there is no folded model.
export function NucleotideTracks({ seq, length, layers, tickInterval = 30, carried }: { seq: string | null; length: number; layers: Layer[]; tickInterval?: number; carried?: SeqRegion | null }) {
  const t = useNtTracks(layers, length, seq);
  if (!seq) return <Field label="sequence" value={<NoData />} />;
  return (
    <div className="grid grid-cols-1 gap-x-6 gap-y-4 lg:grid-cols-2 lg:items-start">
      <InteractiveSequence seq={seq} tickInterval={tickInterval} residueSpan={t.residueSpan} highlights={t.highlights} selected={t.selected} onHover={t.setHovered} onCopyItem={t.copyItem} carried={carried} />
      <div className="space-y-2">
        {layers.length ? (
          <FeaturePanel layers={layers} active={t.active} length={length} selected={t.selected} onActivate={t.switchLayer} onHover={t.setHovered} onToggle={t.toggleLock} />
        ) : (
          <div className="text-xs italic text-neutral-400">no variant or modification features</div>
        )}
      </div>
    </div>
  );
}

function FeatureTable({ layer, selected, onHover, onToggle }: { layer: Layer; selected: string | null; onHover: (k: string | null) => void; onToggle: (k: string) => void }) {
  const range = (s: [number, number]) => (s[0] === s[1] ? `${s[0]}` : `${s[0]}–${s[1]}`);
  return (
    <TableScroller>
      <table className="w-full text-xs">
        <thead className="text-left text-neutral-500">
          <tr>
            <th className="px-2 py-1 font-medium">{layer.nameHeader}</th>
            <th className="px-2 py-1 font-medium">{layer.subHeader}</th>
            <th className="px-2 py-1 font-medium">length</th>
            <th className="px-2 py-1 font-medium">positions</th>
          </tr>
        </thead>
        <tbody>
          {layer.items.map((it) => {
            const isSel = selected === it.key;
            const dim = selected !== null && !isSel;
            return (
              <tr
                key={it.key}
                onMouseEnter={() => onHover(it.key)}
                onMouseLeave={() => onHover(null)}
                onClick={() => onToggle(it.key)}
                className={`cursor-pointer border-t border-neutral-100 ${isSel ? 'bg-neutral-100' : 'hover:bg-neutral-50'}`}
                style={{ opacity: dim ? 0.5 : 1 }}
              >
                <td className="px-2 py-1 whitespace-nowrap">
                  <span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm align-middle" style={{ backgroundColor: it.color }} />
                  {it.link ? (
                    <a href={it.link} target="_blank" rel="noreferrer" title="RNA 3D Hub loop" className="underline decoration-neutral-300 hover:decoration-neutral-700" onClick={(e) => e.stopPropagation()}>
                      {it.name}
                    </a>
                  ) : (
                    it.name
                  )}
                </td>
                <td className="px-2 py-1 text-neutral-600">{it.sub ?? '—'}</td>
                <td className="px-2 py-1 font-mono text-neutral-600">{it.length} {it.unit}</td>
                <td className="px-2 py-1 font-mono text-neutral-500">{it.segments.map(range).join(', ')}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </TableScroller>
  );
}

// All of this RNA's molecular interactions (RNAInter sRNA↔mRNA / RNA↔protein, IntAct rRNA↔
// protein, …), grouped by evidence DB. Partners with a uniqID link to their entry; hover shows
// the detection method / score.
const RNA_DB_LABEL: Record<string, string> = { RNAInter: 'RNAInter', IntAct: 'IntAct', STRING: 'STRING' };
function RnaInteractions({ interactions, chrom, rnaGene }: { interactions: Interactions | null | undefined; chrom: string; rnaGene: boolean }) {
  const { taxid } = useParams<{ taxid: string }>();
  if (interactions === undefined) return <span className="text-xs text-neutral-400">loading…</span>;
  const dbOf = (p: Interactions['partners'][number]) => p.db ?? 'STRING';
  // Only interactions on THIS molecule's RNA: RNAInter edges where it was the RNA participant
  // (a CDS can appear as its protein too), plus — for a genuine RNA gene — its IntAct/STRING.
  // For a CDS, STRING/IntAct are the protein's interactions and belong to the protein panel.
  const rnaLevel = interactions
    ? interactions.partners.filter((p) => (dbOf(p) === 'RNAInter' ? p.onRna === true : rnaGene))
    : [];
  if (rnaLevel.length === 0) return <NoData />;
  // Plain wrapped chip list (no row-title column — that's the Relationships-panel style); the
  // evidence DB and detection method ride along in each chip's tooltip.
  const order = ['RNAInter', 'IntAct', 'STRING'];
  const partners = [...rnaLevel].sort((a, b) => order.indexOf(dbOf(a)) - order.indexOf(dbOf(b)));
  return (
    <ul className="flex flex-wrap gap-1">
      {partners.map((p, i) => {
        const title = [RNA_DB_LABEL[dbOf(p)] ?? dbOf(p), p.method, p.evidence ? `${p.evidence} record${p.evidence > 1 ? 's' : ''}` : null, p.score ? `score ${p.score.toFixed(2)}` : null].filter(Boolean).join(' · ');
        const cls = 'rounded px-1.5 py-0.5 text-xs bg-neutral-100 text-neutral-700';
        return (
          <li key={`${p.name}-${i}`}>
            {p.uniqID ? (
              <Link to={`/o/${taxid}/c/${encodeURIComponent(chrom)}/entry/${p.uniqID}`} title={title} className={`${cls} hover:brightness-95`}><span className="font-mono">{p.name}</span></Link>
            ) : (
              <span title={title} className={cls}><span className="font-mono">{p.name}</span></span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function SoLineage({ lineage, fallback }: { lineage: string[]; fallback: string | null }) {
  if (lineage && lineage.length > 0) return <Breadcrumb levels={lineage.map((t) => [t])} />;
  if (fallback) return <span className="text-sm">{fallback}</span>;
  return <NoData />;
}
