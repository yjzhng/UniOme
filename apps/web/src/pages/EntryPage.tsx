import { useEffect, useLayoutEffect, useMemo, useRef, useState, Fragment, type ReactNode, type CSSProperties } from 'react';
import { Link, useNavigate, useOutletContext, useParams } from 'react-router-dom';
import type { OrgHomeContext } from '../Layout';
import { typeLevels, type Feature, type GeneticLevel, type Interactions, type Regulation, type SharedRelationships, type SharedGroup, type RelatedData, type SimilarData, type SimilarMember } from '@uniome/shared';
import { ProteinPanel, paletteHex } from '../modules/ProteinDomainViewer';
import { RnaPanel, RNA_FAMILY_COLOR, useDnaFeatureLayers, useNtTracks, FeaturePanel, InteractiveSequence } from '../modules/RnaPanel';
import { RegulatoryMapSection, sigmaFull } from '../modules/RegulatoryMap';
import { InteractionNetwork } from '../modules/InteractionNetwork';
import { SharedNetwork } from '../modules/SharedNetwork';
import { PathwaySection } from '../modules/OverviewMap';
import { kgpcColor, NET_PLACEHOLDER_H } from '../modules/networkParts';
import { ACCENT, ACCENT_CHIP, THEME_CHIP, Breadcrumb, Field, InfoTip, LoadingBox, NoData, Placeholder, Section } from '../components/Fields';
import { SOURCE_INFO, useSourceInfo } from '../sourceInfo';
import { useFavourites } from '../lib/favourites';
import { useSettings } from '../lib/settings';
import { ExpressionDumbbell } from '../components/ExpressionField';
import { LocalisationField } from '../components/LocalisationField';
import { EssentialityField } from '../components/EssentialityField';
import { ConservationField } from '../components/ConservationField';
import { MutationField } from '../components/MutationField';
import { EntryActiveContext } from '../lib/entryActive';

// EntryPage keeps recently-viewed genes mounted in a small LRU pool, showing only the active one.
// Revisiting a gene is then instant and EXACTLY as it was left (active tab, sources, scroll) — no
// refetch, no state reset. The heavy 3D viewer is gated to the active view (EntryActiveContext) so a
// poolful of mounted Mol* viewers doesn't exceed the browser's WebGL-context limit.
const RECENT = 20;

export default function EntryPage() {
  const params = useParams();
  const taxid = params.taxid, chrom = params.chrom;
  const id = params['*'] || undefined; // splat route: '' (no selection) or the gene uniqID
  const { setSelected } = useOutletContext<OrgHomeContext>();
  const [recent, setRecent] = useState<string[]>([]);
  const scrolls = useRef<Map<string, number>>(new Map());

  useEffect(() => { setRecent([]); scrolls.current.clear(); }, [taxid]); // new organism → fresh pool
  useEffect(() => { if (id) setRecent((prev) => (prev[0] === id ? prev : [id, ...prev.filter((x) => x !== id)].slice(0, RECENT))); }, [id]);

  // Per-view scroll: remember the active view's scroll continuously, restore the target's on switch.
  useEffect(() => {
    if (!id) return;
    const onScroll = () => scrolls.current.set(id, window.scrollY);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [id]);
  useLayoutEffect(() => { if (id) window.scrollTo(0, scrolls.current.get(id) ?? 0); }, [id]);

  // Keep the pool mounted even with no gene selected (the empty view shows over it), so deselecting
  // and re-selecting a recent gene is still instant. Always include the active id so there's no blank.
  const list = id && !recent.includes(id) ? [id, ...recent].slice(0, RECENT) : recent;
  return (
    <>
      {!id && <EmptyEntry />}
      {list.map((rid) => (
        <EntryActiveContext.Provider key={rid} value={rid === id}>
          <div hidden={rid !== id}>
            <EntryView id={rid} taxid={taxid ?? ''} chrom={chrom ?? ''} active={rid === id} setSelected={setSelected} />
          </div>
        </EntryActiveContext.Provider>
      ))}
    </>
  );
}

// The entry route with no gene selected (/entry): the sticky genome-browser navigator above is shown
// by the Layout — pick a feature there (or search) to populate this view.
function EmptyEntry() {
  return (
    <main className="mx-auto max-w-7xl px-4 py-16">
      <div className="text-center text-sm text-neutral-500">
        no gene selected — pick a feature in the genome browser above, or use the organism home to search and explore.
      </div>
    </main>
  );
}

// One kept-alive gene view. Its `id` is fixed for the instance's lifetime, so it fetches once and
// retains all its UI state; `active` gates the 3D viewer + the title-bar selection report.
function EntryView({ id, taxid, chrom, active, setSelected }: { id: string; taxid: string; chrom: string; active: boolean; setSelected: (s: { chrom: string; uniqID: string; gene: string } | null) => void }) {
  const [feature, setFeature] = useState<Feature | null>(null);
  // `undefined` = still loading (→ placeholder), `null` = loaded but no data / 404 (→ "no data").
  const [related, setRelated] = useState<RelatedData | null | undefined>(undefined);
  const [interactions, setInteractions] = useState<Interactions | null>(null);
  const [regulation, setRegulation] = useState<Regulation | null>(null);
  const [shared, setShared] = useState<SharedRelationships | null | undefined>(undefined);
  const [similar, setSimilar] = useState<SimilarData | null>(null);
  const [siblings, setSiblings] = useState<Feature[]>([]);
  const [notFound, setNotFound] = useState(false);
  const { enabled } = useSettings(); // which annotation sections/fields to show (Settings window)
  // null = no explicit choice yet → default to the final functional product (see below).
  const [selectedLevel, setSelectedLevel] = useState<GeneticLevel | null>(null);
  // A region pinned at one level, in canonical CDS-local nucleotide coordinates (DNA/RNA
  // position; protein residue × 3), carried across level switches to show the matching span.
  const [carried, setCarried] = useState<CarriedRegion | null>(null);

  // `id` is fixed for this instance → this runs once on mount; the loaded data is retained for the
  // life of the pool entry, so revisiting the gene needs no refetch.
  useEffect(() => {
    fetch(`/api/organism/${taxid}/features/${encodeURIComponent(id)}`)
      .then(async (r) => { if (r.status === 404) { setNotFound(true); return null; } return r.json(); })
      .then((f) => { if (f) setFeature(f); });
    fetch(`/api/organism/${taxid}/features/${encodeURIComponent(id)}/related`).then((r) => (r.ok ? r.json() : null)).then(setRelated).catch(() => {});
    fetch(`/api/organism/${taxid}/features/${encodeURIComponent(id)}/interactions`).then((r) => (r.ok ? r.json() : null)).then(setInteractions).catch(() => {});
    fetch(`/api/organism/${taxid}/features/${encodeURIComponent(id)}/regulation`).then((r) => (r.ok ? r.json() : null)).then(setRegulation).catch(() => {});
    fetch(`/api/organism/${taxid}/features/${encodeURIComponent(id)}/shared`).then((r) => (r.ok ? r.json() : null)).then(setShared).catch(() => {});
    fetch(`/api/organism/${taxid}/features/${encodeURIComponent(id)}/similar`).then((r) => (r.ok ? r.json() : null)).then(setSimilar).catch(() => {});
    fetch(`/api/organism/${taxid}/features/${encodeURIComponent(id)}/siblings`).then((r) => (r.ok ? r.json() : [])).then(setSiblings).catch(() => {});
  }, [id, taxid]);

  // While active, report the gene to the Layout so the title-bar toggle/label track it (and the
  // selection persists when toggling to the organism home). Hidden views must not clobber it.
  useEffect(() => {
    if (active && feature) setSelected({ chrom: feature.chrom, uniqID: feature.uniqID, gene: feature.gene || feature.locus_tag || feature.uniqID });
  }, [active, feature, setSelected]);

  if (notFound)
    return (
      <main className="mx-auto max-w-7xl px-4 py-8">
        <div className="text-sm">
          not found.{' '}
          <Link to={taxid && chrom ? `/o/${taxid}/c/${chrom}` : '/'} className="underline decoration-neutral-300 hover:decoration-neutral-700">
            back to browser
          </Link>
        </div>
      </main>
    );

  if (!feature)
    return (
      <main className="mx-auto max-w-7xl px-4 py-8">
        <div className="text-sm text-neutral-500">loading…</div>
      </main>
    );

  const availableLevels = typeLevels(feature.type);
  // Default to the final functional product — the highest available level (PROT for CDS,
  // RNA for ncRNA, DNA otherwise) — unless the user has explicitly picked a level.
  const activeLevel =
    selectedLevel && availableLevels.includes(selectedLevel)
      ? selectedLevel
      : availableLevels[availableLevels.length - 1];

  return (
    <main className="mx-auto max-w-7xl px-4 py-4 space-y-4">
      <EntryHeader feature={feature} />
      {enabled('general') && <GeneralSection feature={feature} />}
      {enabled('regulation') && <RegulationSection feature={feature} regulation={regulation} chrom={chrom ?? ''} />}
      {enabled('product') && (
        <Section title="Gene product" anchor>
          <Dendrogram
            feature={feature}
            siblings={siblings}
            taxid={taxid ?? ''}
            active={activeLevel}
            onSelect={setSelectedLevel}
          />
          <LevelView
            feature={feature}
            taxid={taxid ?? ''}
            levels={availableLevels}
            activeLevel={activeLevel}
            carried={carried}
            onCarry={setCarried}
          />
        </Section>
      )}
      {enabled('relationships') && <RelationshipsSection feature={feature} related={related} interactions={interactions} regulation={regulation} shared={shared} similar={similar} chrom={chrom ?? ''} />}
    </main>
  );
}

// A region carried between central-dogma levels, in canonical CDS-local nucleotide coords.
export interface Region {
  segments: Array<[number, number]>;
  color: string;
}
interface CarriedRegion extends Region {
  level: GeneticLevel; // the level it was pinned at (mapped into the others; null on its own)
}

// Protein residues ↔ CDS-local nucleotides (residue r ↔ nt 3r-2..3r); RNA/DNA positions
// are already nucleotides. (For these E. coli features DNA len == rna_len == 3·prot+3.)
const toNt = (level: GeneticLevel, segs: Array<[number, number]>): Array<[number, number]> =>
  level === 'PROT' ? segs.map(([a, b]) => [3 * a - 2, 3 * b]) : segs;
const fromNt = (level: GeneticLevel, nt: Array<[number, number]>): Array<[number, number]> =>
  level === 'PROT' ? nt.map(([a, b]) => [Math.ceil(a / 3), Math.ceil(b / 3)]) : nt;

// All available levels are mounted at once and merely hidden when inactive, so a panel's
// state (selection, loaded structure) survives switching — no remount, no Mol* reload, and
// the pin clears only when the user deselects it. A region pinned at one level is carried
// into the others (mapped into each level's coordinates).
function LevelView({
  feature,
  taxid,
  levels,
  activeLevel,
  carried,
  onCarry,
}: {
  feature: Feature;
  taxid: string;
  levels: GeneticLevel[];
  activeLevel: GeneticLevel;
  carried: CarriedRegion | null;
  onCarry: (r: CarriedRegion | null) => void;
}) {
  return (
    <>
      {levels.map((level) => {
        const onRegion = (segs: Array<[number, number]> | null, color: string | null) =>
          onCarry(segs && color ? { segments: toNt(level, segs), color, level } : null);
        const incoming: Region | null =
          carried && carried.level !== level
            ? { segments: fromNt(level, carried.segments), color: carried.color }
            : null;
        const panel =
          level === 'DNA' ? (
            <DnaSection feature={feature} carried={incoming} />
          ) : level === 'RNA' ? (
            <RnaPanel feature={feature} taxid={taxid} carried={incoming} onRegion={onRegion} />
          ) : (
            <ProteinPanel feature={feature} taxid={taxid} carried={incoming} onRegion={onRegion} />
          );
        return (
          <div key={level} hidden={level !== activeLevel}>
            {panel}
          </div>
        );
      })}
    </>
  );
}

function Dendrogram({
  feature: f,
  siblings,
  taxid,
  active,
  onSelect,
}: {
  feature: Feature;
  siblings: Feature[];
  taxid: string;
  active: GeneticLevel;
  onSelect: (l: GeneticLevel) => void;
}) {
  const nav = useNavigate();
  const levels = typeLevels(f.type);
  if (levels.length === 0) return null;

  // All features sharing this locus_tag — current + siblings. Order by genomic position
  // (uniqID tiebreak, coord-less UP-only rows last) so node order is stable regardless of
  // which sibling is currently selected — switching RNAs must not reshuffle the rows.
  const byGenomePos = (a: Feature, b: Feature) =>
    (a.coord?.start ?? Infinity) - (b.coord?.start ?? Infinity) || a.uniqID.localeCompare(b.uniqID);
  const all = [f, ...siblings].sort(byGenomePos);
  const cdsList = all.filter((r) => r.type === 'CDS');
  const otherRnas = all.filter((r) => r.type !== 'CDS' && typeLevels(r.type).includes('RNA'));

  const dnaLabel = f.locus_tag || f.gene || f.uniqID;
  const geneNm = f.gene || dnaLabel;

  interface RnaRow {
    key: string;
    label: string;
    sublabel: string;
    feature?: Feature; // undefined for the synthetic mRNA node
    isCurrent: boolean;
    proteins: Feature[];
  }
  const rnaRows: RnaRow[] = [];
  if (cdsList.length > 0) {
    rnaRows.push({
      key: '_mrna',
      label: `${geneNm} mRNA`,
      sublabel: cdsList.length > 1 ? `mRNA · ${cdsList.length} ORFs` : 'mRNA',
      feature: undefined,
      isCurrent: f.type === 'CDS',
      proteins: cdsList,
    });
  }
  for (const rna of otherRnas) {
    rnaRows.push({
      key: rna.uniqID,
      label: rna.product || rna.gene || rna.uniqID,
      sublabel: rna.type,
      feature: rna,
      isCurrent: rna.uniqID === f.uniqID,
      proteins: [],
    });
  }

  const NODE_H = 42;
  const ROW_GAP = 16;
  const ROW = NODE_H + ROW_GAP;
  const COL_GAP = 64;
  const NODE_MIN_W = 104;
  const NODE_CHAR_W = 7.5; // approx mono-12 char width
  const NODE_PADDING = 24; // left inset (shared by icon + label) + right gap
  const HEADER_H = 26; // band above the nodes for the column headers (DNA / RNA / Protein)
  const PAD = 6; // margin so node drop-shadows / borders aren't clipped at the svg edges
  const nodeWidth = (label: string) =>
    Math.max(NODE_MIN_W, Math.round(label.length * NODE_CHAR_W + NODE_PADDING));

  const rnaRowCounts = rnaRows.map((r) => Math.max(1, r.proteins.length));
  let cumul = 0;
  const rnaLayout = rnaRows.map((r, i) => {
    const start = cumul;
    const count = rnaRowCounts[i];
    cumul += count;
    return { row: r, startRow: start, count };
  });
  const totalRows = Math.max(1, cumul);
  const totalHeight = totalRows * ROW - ROW_GAP;

  const showRna = rnaRows.length > 0;
  const showProt = cdsList.length > 0;

  // Per-column width = max of the column's label widths (or 100 px min).
  const dnaColW = nodeWidth(dnaLabel);
  const rnaColW = showRna
    ? Math.max(NODE_MIN_W, ...rnaRows.map((r) => nodeWidth(r.label)))
    : 0;
  const protColW = showProt
    ? Math.max(
        NODE_MIN_W,
        ...cdsList.map((p) => nodeWidth(p.UniProtID || p.gene || p.uniqID))
      )
    : 0;

  const dnaX = 0;
  const rnaX = dnaColW + COL_GAP;
  const protX = rnaX + rnaColW + COL_GAP;
  const svgW = showProt ? protX + protColW : showRna ? rnaX + rnaColW : dnaColW;
  const svgH = totalHeight + HEADER_H;
  const dnaY = totalHeight / 2;

  function rowCenter(rowIdx: number): number {
    return rowIdx * ROW + NODE_H / 2;
  }

  function clickFeature(target: Feature) {
    if (target.uniqID === f.uniqID) {
      onSelect(target.type === 'CDS' ? 'PROT' : 'RNA');
    } else {
      nav(`/o/${taxid}/c/${encodeURIComponent(target.chrom)}/entry/${target.uniqID}`);
    }
  }

  return (
    <div className="overflow-x-auto">
      <svg width={svgW + PAD * 2} height={svgH + PAD * 2} className="block">
        <defs>
          <filter id="dendroShadow" x="-20%" y="-20%" width="140%" height="160%">
            <feDropShadow dx="0" dy="1" stdDeviation="1.1" floodColor="#0f172a" floodOpacity="0.12" />
          </filter>
        </defs>

        <g transform={`translate(${PAD}, ${PAD})`}>
        {/* Column headers (central-dogma flow, left → right). */}
        <ColumnHeader x={dnaX + dnaColW / 2} tone="DNA">DNA</ColumnHeader>
        {showRna && <ColumnHeader x={rnaX + rnaColW / 2} tone="RNA">RNA</ColumnHeader>}
        {showProt && <ColumnHeader x={protX + protColW / 2} tone="PROT">Protein</ColumnHeader>}

        <g transform={`translate(0, ${HEADER_H})`}>
          {rnaLayout.map(({ count, startRow }, i) => {
            const cy = rowCenter(startRow + (count - 1) / 2);
            return <Connector key={`dna-rna-${i}`} x1={dnaX + dnaColW} y1={dnaY} x2={rnaX} y2={cy} tone="RNA" />;
          })}
          {rnaLayout.flatMap(({ row, startRow }) =>
            row.proteins.map((p, j) => {
              const cyR = rowCenter(startRow + (row.proteins.length - 1) / 2);
              const cyP = rowCenter(startRow + j);
              return <Connector key={`rna-prot-${row.key}-${p.uniqID}`} x1={rnaX + rnaColW} y1={cyR} x2={protX} y2={cyP} tone="PROT" />;
            })
          )}

          <DendroNode
            x={dnaX}
            y={dnaY - NODE_H / 2}
            width={dnaColW}
            height={NODE_H}
            tone="DNA"
            level="DNA"
            label={dnaLabel}
            active={active === 'DNA'}
            isCurrentLocus
            onClick={() => onSelect('DNA')}
          />

          {rnaLayout.map(({ row, startRow, count }) => {
            const cy = rowCenter(startRow + (count - 1) / 2);
            const isActive = row.isCurrent && active === 'RNA';
            return (
              <DendroNode
                key={`rna-node-${row.key}`}
                x={rnaX}
                y={cy - NODE_H / 2}
                width={rnaColW}
                height={NODE_H}
                tone="RNA"
                level={row.sublabel}
                label={row.label}
                active={isActive}
                isCurrentLocus={row.isCurrent}
                onClick={() => {
                  if (row.feature) {
                    clickFeature(row.feature);
                  } else if (f.type === 'CDS') {
                    onSelect('RNA');
                  } else if (cdsList.length > 0) {
                    clickFeature(cdsList[0]);
                  }
                }}
              />
            );
          })}

          {rnaLayout.flatMap(({ row, startRow }) =>
            row.proteins.map((p, j) => {
              const cyP = rowCenter(startRow + j);
              const isCurrent = p.uniqID === f.uniqID;
              const isActive = isCurrent && active === 'PROT';
              const label = p.UniProtID || p.gene || p.uniqID;
              return (
                <DendroNode
                  key={p.uniqID}
                  x={protX}
                  y={cyP - NODE_H / 2}
                  width={protColW}
                  height={NODE_H}
                  tone="PROT"
                  level="Protein"
                  label={label}
                  active={isActive}
                  isCurrentLocus={isCurrent}
                  onClick={() => clickFeature(p)}
                />
              );
            })
          )}
        </g>
        </g>
      </svg>
    </div>
  );
}

// Central-dogma level palette — a restrained accent + tint per level.
type LevelTone = 'DNA' | 'RNA' | 'PROT';
const LEVEL_TONE: Record<LevelTone, { accent: string; tint: string }> = {
  DNA: { accent: ACCENT.teal, tint: '#ccfbf1' }, // teal
  RNA: { accent: ACCENT.blue, tint: '#dbeafe' }, // blue
  PROT: { accent: ACCENT.indigo, tint: '#e0e7ff' }, // indigo
};

function ColumnHeader({ x, tone, children }: { x: number; tone: LevelTone; children: string }) {
  return (
    <text x={x} y={15} textAnchor="middle" fontSize={10} fontWeight={700} letterSpacing={1} fill={LEVEL_TONE[tone].accent} style={{ textTransform: 'uppercase' }}>
      {children}
    </text>
  );
}

// Per-level glyph centred at (cx, cy): DNA = double helix, RNA = single (strand) helix,
// Protein = solid circle. ~12px, drawn in the level's accent colour.
function LevelIcon({ x, cy, tone }: { x: number; cy: number; tone: LevelTone }) {
  const c = LEVEL_TONE[tone].accent;
  if (tone === 'PROT') return <circle cx={x + 3.2} cy={cy} r={3.2} fill={c} />;
  const cx = x + 7; // helix spans x … x+14 (left edge at x, shared with the label below)
  const A = 4; // vertical amplitude; strands span cx-7 … cx+7, crossing at the quarter points
  // A full sine: top-left → bottom-mid → top-right (horizontal tangents at the extremes).
  const strandA = `M ${cx - 7} ${cy - A} C ${cx - 3.2} ${cy - A} ${cx - 3.8} ${cy + A} ${cx} ${cy + A} C ${cx + 3.8} ${cy + A} ${cx + 3.2} ${cy - A} ${cx + 7} ${cy - A}`;
  // Its vertical mirror — the second strand, half a period out of phase.
  const strandB = `M ${cx - 7} ${cy + A} C ${cx - 3.2} ${cy + A} ${cx - 3.8} ${cy - A} ${cx} ${cy - A} C ${cx + 3.8} ${cy - A} ${cx + 3.2} ${cy + A} ${cx + 7} ${cy + A}`;
  if (tone === 'RNA') return <path d={strandA} fill="none" stroke={c} strokeWidth={1.2} strokeLinecap="round" />;
  return (
    <g fill="none" stroke={c} strokeLinecap="round">
      <path d={strandA} strokeWidth={1.2} />
      <path d={strandB} strokeWidth={1.2} />
      {/* rungs where the strands are farthest apart: the two ends and the middle */}
      <line x1={cx - 7} y1={cy - A + 0.6} x2={cx - 7} y2={cy + A - 0.6} strokeWidth={0.8} />
      <line x1={cx} y1={cy - A + 0.6} x2={cx} y2={cy + A - 0.6} strokeWidth={0.8} />
      <line x1={cx + 7} y1={cy - A + 0.6} x2={cx + 7} y2={cy + A - 0.6} strokeWidth={0.8} />
    </g>
  );
}

// A smooth horizontal S-curve between two column nodes, faintly tinted toward the target level.
function Connector({ x1, y1, x2, y2, tone }: { x1: number; y1: number; x2: number; y2: number; tone: LevelTone }) {
  const dx = (x2 - x1) * 0.5;
  return (
    <path
      d={`M ${x1} ${y1} C ${x1 + dx} ${y1} ${x2 - dx} ${y2} ${x2} ${y2}`}
      fill="none"
      stroke={LEVEL_TONE[tone].accent}
      strokeOpacity={0.4}
      strokeWidth={1.5}
    />
  );
}

function DendroNode({
  x,
  y,
  width,
  height,
  tone,
  level,
  label,
  active,
  isCurrentLocus,
  onClick,
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  tone: LevelTone;
  level: string;
  label: string;
  active: boolean;
  isCurrentLocus: boolean;
  onClick: () => void;
}) {
  const t = LEVEL_TONE[tone];
  const fill = active ? t.tint : 'white';
  const stroke = active ? t.accent : '#e5e5e5';
  const strokeWidth = active ? 1.5 : 1;
  const subColor = t.accent;
  const iconX = x + 12; // shared left edge for the icon and the gene name below it
  const subX = iconX + (tone === 'PROT' ? 6.4 : 14) + 4; // type label sits just past the icon
  return (
    <g onClick={onClick} className="cursor-pointer transition-opacity hover:opacity-80">
      <rect x={x} y={y} width={width} height={height} rx={7} fill={fill} stroke={stroke} strokeWidth={strokeWidth} filter="url(#dendroShadow)" />
      <LevelIcon x={iconX} cy={y + 13} tone={tone} />
      <text x={subX} y={y + 16} fontSize={9.5} fontWeight={600} fill={subColor}>
        {level}
      </text>
      <text
        x={iconX}
        y={y + 32}
        fontSize={12}
        fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
        fill="#171717"
        fontWeight={isCurrentLocus ? 600 : 400}
      >
        {label}
      </text>
    </g>
  );
}

function EntryHeader({ feature: f }: { feature: Feature }) {
  const { taxid, chrom } = useParams<{ taxid: string; chrom: string }>();
  const { has, toggle, full } = useFavourites();
  const isFav = !!taxid && has(taxid, f.uniqID); // adding while at FAV_MAX is rejected → `full` flashes red for 1s
  const onStar = () => taxid && toggle({ taxid, chrom: chrom ? decodeURIComponent(chrom) : '', uniqID: f.uniqID, gene: f.gene || f.locus_tag || f.uniqID });
  const coordStr = f.coord
    ? `${f.coord.start.toLocaleString()}..${f.coord.end.toLocaleString()} (${f.coord.strand})`
    : '— no genomic mapping';
  return (
    <header id="entry-header" className="border-b border-neutral-200 pb-3 space-y-1">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-neutral-500">
        <span className="font-mono">{f.locus_tag || f.uniqID}</span>
        <span className="font-mono">{coordStr}</span>
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <button type="button" onClick={onStar} aria-pressed={isFav} title={isFav ? 'remove from favourites' : 'add to favourites'}
          className={`cursor-pointer text-2xl leading-none transition-colors ${full ? 'text-red-500' : isFav ? 'text-amber-400 hover:text-amber-500' : 'text-neutral-300 hover:text-neutral-500'}`}>
          {isFav ? '★' : '☆'}
        </button>
        <h1 className="font-mono text-2xl font-semibold tracking-tight">
          {f.gene || f.locus_tag || f.uniqID}
        </h1>
        <span className="self-baseline text-sm text-neutral-500">{f.type}</span>
      </div>
      <p className="text-sm text-neutral-700">{f.product || <em>no product description</em>}</p>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-neutral-600">
        <span>source: {f.source.join(', ') || '—'}</span>
      </div>
    </header>
  );
}

function GeneralSection({ feature: f }: { feature: Feature }) {
  const { taxid } = useParams<{ taxid: string }>();
  const info = useSourceInfo();
  const { enabled } = useSettings();
  return (
    <Section title="General" anchor>
      {enabled('function') && <Field label="function" info={info('function')} value={<Breadcrumb levels={[f.KG_FG, f.KG_FM]} chip={THEME_CHIP} />} />}
      {enabled('pathway') && <Field label="pathway" info={info('pathway')} value={<Breadcrumb levels={[f.KG_PC, f.KG_PG, f.KG_PW]} chip={THEME_CHIP} />} />}
      <div className="grid grid-cols-1 gap-x-6 gap-y-2 pt-3 lg:grid-cols-2 lg:items-start">
        {/* Left: how important / how variable. */}
        <div className="min-w-0 space-y-2">
          {enabled('essentiality') && <EssentialityField taxid={taxid ?? ''} uniqID={f.uniqID} type={f.type} />}
          {enabled('mutation') && <MutationField taxid={taxid ?? ''} uniqID={f.uniqID} />}
          {enabled('conservation') && <ConservationField taxid={taxid ?? ''} uniqID={f.uniqID} />}
        </div>
        {/* Right: how much + where. (localisation synced from the functional product.) */}
        <div className="min-w-0 space-y-2">
          {enabled('expression') && <ExpressionDumbbell taxid={taxid ?? ''} uniqID={f.uniqID} />}
          {enabled('localisation') && <LocalisationField value={f.localisation} />}
        </div>
      </div>
    </Section>
  );
}

// Regulation as its own panel (below General): operon/regulon/sigmulon/modulon membership + the
// regulatory map. Lifted out of the DNA-level section so it's always visible, not level-gated.
function RegulationSection({ feature: f, regulation, chrom }: { feature: Feature; regulation: Regulation | null; chrom: string }) {
  const { taxid } = useParams<{ taxid: string }>();
  const { enabled } = useSettings();
  // The -on memberships (tighter label column + wider inter-column gaps for breathing room). Passed
  // as the left panel of the regulatory map, which renders the SVG on top and (fields | table) below.
  const fields = (
    <div className="min-w-0 space-y-2" style={{ ['--field-label']: '80px', ['--field-gap']: '1.25rem' } as CSSProperties}>
      {enabled('operon') && <OnNameField label="operon" entries={regulation && regulation.operons.map((op) => ({ name: op.name, link: op.link }))} />}
      {enabled('regulon') && <RegulonField regulation={regulation} chrom={chrom} />}
      {enabled('sigmulon') && <SigmulonField regulation={regulation} chrom={chrom} />}
      {enabled('modulon') && <OnNameField label="modulon" entries={regulation && regulation.modulons.map((m) => ({ name: m.name, link: m.link, title: [m.regulator, m.function].filter(Boolean).join(' · ') || undefined }))} />}
    </div>
  );
  return (
    <Section title="Regulation" anchor>
      {/* Regulatory-map SVG only when 'regmap' is on; otherwise just the -on membership fields. */}
      {enabled('regmap')
        ? <RegulatoryMapSection taxid={taxid ?? ''} feature={f} leftPanel={fields} regulators={regulation?.regulatedBy ?? null} />
        : fields}
    </Section>
  );
}

function DnaSection({ feature: f, carried }: { feature: Feature; carried: Region | null }) {
  const { taxid } = useParams<{ taxid: string }>();
  const layers = useDnaFeatureLayers(taxid ?? '', f.uniqID, f.seq);
  const length = f.len ?? (f.seq?.length ?? 1);
  const t = useNtTracks(layers, length, f.seq);
  return (
    <Section title="DNA level" level="DNA">
      {/* Mirrors the mRNA panel: metadata + interactions + feature tracks (left), sequence (right). */}
      <div className="grid grid-cols-1 gap-x-6 gap-y-4 lg:grid-cols-2 lg:items-start">
        <div className="min-w-0 space-y-2">
          <Field label="uniqID" value={<span className="font-mono">{f.uniqID}</span>} />
          <Field label="GeneID" value={f.GeneID ? <span className="font-mono">{f.GeneID}</span> : <NoData />} />
          <Field label="gene name" value={f.gene || <NoData />} />
          <Field label="length" value={f.len !== null ? `${f.len.toLocaleString()} bp` : <NoData />} />
          <Field label="interactions" value={<Placeholder />} />
          {f.seq && layers.length ? (
            <FeaturePanel layers={layers} active={t.active} length={length} selected={t.selected} onActivate={t.switchLayer} onHover={t.setHovered} onToggle={t.toggleLock} />
          ) : (
            <div className="text-xs italic text-neutral-400">no variant or methylation features</div>
          )}
        </div>
        <div className="min-w-0">
          {f.seq ? (
            <InteractiveSequence seq={f.seq} tickInterval={30} residueSpan={t.residueSpan} highlights={t.highlights} selected={t.selected} onHover={t.setHovered} onCopyItem={t.copyItem} carried={carried} />
          ) : (
            <Field label="sequence" value={<NoData />} />
          )}
        </div>
      </div>
    </Section>
  );
}

// Sigmulon = the σ factor(s) transcribing this gene, as blue chips matching the σ-factor boxes on
// the regulatory map (σ notation, sky styling). Links to the σ factor's own gene entry.
const SIGMA_CHIP = 'rounded px-1.5 py-0.5 text-xs ' + ACCENT_CHIP.indigo;
function SigmulonField({ regulation, chrom }: { regulation: Regulation | null; chrom: string }) {
  const { taxid } = useParams<{ taxid: string }>();
  const info = useSourceInfo();
  if (!regulation || regulation.sigmulons.length === 0) return <Field label="sigmulon" info={info('regulation')} value={<NoData />} />;
  return (
    <Field label="sigmulon" info={info('regulation')} value={
      <ul className="flex flex-wrap gap-1">
        {regulation.sigmulons.map((s) => {
          const label = sigmaFull(s.name);
          const to = s.uniqID ? `/o/${taxid}/c/${encodeURIComponent(chrom)}/entry/${s.uniqID}` : null;
          return (
            <li key={s.name} title={s.name}>
              {to ? <Link to={to} className={`${SIGMA_CHIP} hover:brightness-95`}><span className="font-mono">{label}</span></Link>
                : s.link ? <a href={s.link} target="_blank" rel="noreferrer" className={`${SIGMA_CHIP} hover:brightness-95`}><span className="font-mono">{label}</span></a>
                : <span className={SIGMA_CHIP}><span className="font-mono">{label}</span></span>}
            </li>
          );
        })}
      </ul>
    } />
  );
}

// Effect → chip colour: activator green, repressor rose, dual amber, unknown neutral.
const effectCls = (fn: string | null) => {
  const s = (fn ?? '').toLowerCase();
  return s.includes('dual') ? ACCENT_CHIP.amber
    : s.includes('activ') ? ACCENT_CHIP.green
    : s.includes('repress') ? ACCENT_CHIP.red
    : 'bg-neutral-100 text-neutral-700';
};
// Generic parser-artifact "regulator" names from RegulonDB to drop.
const REG_JUNK = new Set(['activator', 'repressor', 'protein', 'fragment', 'regulator', 'activity']);
type RegRec = { name: string; uniqID: string | null; link: string | null; type?: string; fns: Set<string> };

// REGULON membership = the distinct regulators acting on this gene (from regulatedBy), as effect-
// coloured chips. Split into gene-encoded regulators that link to their own entry (protein TF / sRNA)
// vs. regulators with no gene to map to (small molecules like ppGpp, complexes, or unresolved names).
function RegulonField({ regulation, chrom }: { regulation: Regulation | null; chrom: string }) {
  const { taxid } = useParams<{ taxid: string }>();
  const info = useSourceInfo();
  if (!regulation) return <Field label="regulon" info={info('regulation')} value={<NoData />} />;
  const byName = new Map<string, RegRec>();
  for (const e of regulation.regulatedBy) {
    if (REG_JUNK.has(e.name.toLowerCase())) continue;
    const m = byName.get(e.name) ?? { name: e.name, uniqID: e.uniqID ?? null, link: e.link ?? null, type: e.regulatorType, fns: new Set<string>() };
    if (e.function) m.fns.add(e.function.toLowerCase());
    if (!m.uniqID && e.uniqID) m.uniqID = e.uniqID;
    if (!m.link && e.link) m.link = e.link;
    byName.set(e.name, m);
  }
  const regs = [...byName.values()];
  if (!regs.length) return <Field label="regulon" info={info('regulation')} value={<NoData />} />;
  // Combine each regulator's effect across edges: both activation+repression ⇒ dual.
  const effectOf = (fns: Set<string>) => ((fns.has('activator') && fns.has('repressor')) || fns.has('dual') ? 'dual' : fns.has('activator') ? 'activator' : fns.has('repressor') ? 'repressor' : null);
  const toChip = (r: RegRec): ChipModel => {
    const fn = effectOf(r.fns);
    return {
      key: r.name,
      name: r.name,
      to: r.uniqID ? `/o/${taxid}/c/${encodeURIComponent(chrom)}/entry/${r.uniqID}` : null,
      href: r.uniqID ? undefined : (r.link ?? undefined),
      title: [fn, r.type].filter(Boolean).join(' · ') || 'regulator',
      cls: effectCls(fn),
    };
  };
  return (
    <Field label="regulon" info={info('regulation')} value={
      <RelGrid labelCol="max-content" groups={[
        { key: 'reg', label: <Descriptor>regulator</Descriptor>, chips: regs.filter((r) => r.uniqID).map(toChip) },
        { key: 'other', label: <Descriptor>other</Descriptor>, chips: regs.filter((r) => !r.uniqID).map(toChip) },
      ]} />
    } />
  );
}

// A DNA-panel "-on" membership field: the -on NAME(s) only, as source-DB entry links.
// `entries` is null while loading; both null and an empty array render the shared "no data" state.
function OnNameField({ label, entries }: { label: string; entries: { name: string; link: string | null; title?: string }[] | null | false }) {
  const info = useSourceInfo();
  if (!entries) return <Field label={label} info={info('regulation')} value={<NoData />} />;
  if (entries.length === 0) return <Field label={label} info={info('regulation')} value={<NoData />} />;
  return (
    <Field
      label={label}
      info={info('regulation')}
      value={
        <ul className="flex flex-wrap gap-x-3 gap-y-1">
          {entries.map((e) => (
            <li key={e.name}><OnLink name={e.name} link={e.link} title={e.title} /></li>
          ))}
        </ul>
      }
    />
  );
}

function RelationshipsSection({ feature, related, interactions, regulation, shared, similar, chrom }: { feature: Feature; related: RelatedData | null | undefined; interactions: Interactions | null; regulation: Regulation | null; shared: SharedRelationships | null | undefined; similar: SimilarData | null; chrom: string }) {
  // The final functional product decides which structural rows are relevant: protein entries
  // show domains/motif, RNA entries show family. (DNA-only features show neither.)
  const levels = typeLevels(feature.type);
  const product = levels[levels.length - 1];
  // Each relationship facet is a tab rather than a stacked section, so the page stays compact and
  // only the active facet's networks/maps mount (and fetch).
  const tabs: { title: string; node: ReactNode }[] = [
    { title: 'Interaction', node: <InteractionsField interactions={interactions} chrom={chrom} /> },
    { title: 'Molecular features', node: (
      <div className="space-y-3">
        <SharedDomainField feature={feature} product={product} shared={shared} chrom={chrom} />
        <SimilarField label="similar sequence" members={similar?.sequence ?? null} chrom={chrom} metric="identity" />
        <SimilarField label="similar structure" members={similar?.structural ?? null} chrom={chrom} metric="tmscore" />
      </div>
    ) },
    { title: 'Regulation', node: (
      <div className="space-y-3">
        <SharedOnField label="same operon" kind="operon" groups={shared?.sharedOperon ?? null} chrom={chrom} />
        <RegulationField regulation={regulation} chrom={chrom} />
        <SharedRegulationField feature={feature} shared={shared} chrom={chrom} />
      </div>
    ) },
    { title: 'Cellular functions', node: (
      <div className="space-y-3">
        <SharedActivityField feature={feature} related={related} chrom={chrom} />
      </div>
    ) },
  ];
  const [tab, setTab] = useState(0);
  // The pathway map sits below the tabs and is shared across facets; it highlights the gene set of the
  // ACTIVE facet — interactors, shared molecular features, co-regulated genes, or co-pathway genes — so
  // switching tabs re-projects the focal gene's relationships onto the metabolic map.
  const geneSet = useMemo(() => {
    const s = new Set<string>();
    const addGroups = (...groups: ({ members: { uniqID: string | null }[] }[] | undefined)[]) => {
      for (const g of groups) for (const grp of g ?? []) for (const m of grp.members) if (m.uniqID) s.add(m.uniqID);
    };
    switch (tabs[tab].title) {
      case 'Interaction':
        for (const p of interactions?.partners ?? []) if (p.uniqID) s.add(p.uniqID);
        break;
      case 'Molecular features':
        addGroups(shared?.sharedDomainTed, shared?.sharedDomainInterpro, shared?.sharedMotif, shared?.sharedFamily);
        for (const m of similar?.sequence ?? []) s.add(m.uniqID);
        for (const m of similar?.structural ?? []) s.add(m.uniqID);
        break;
      case 'Regulation':
        addGroups(shared?.sharedOperon, shared?.sharedRegulon, shared?.sharedModulon);
        break;
      case 'Cellular functions':
        addGroups(related?.sharedPathway, related?.sharedFunction);
        break;
    }
    return s;
  }, [tab, interactions, shared, similar, related]);
  return (
    <Section title="Relationships" anchor>
      <div className="mb-3 flex flex-wrap gap-x-4 border-b border-neutral-200">
        {tabs.map((t, i) => (
          <button key={t.title} type="button" onClick={() => setTab(i)}
            className={`-mb-px whitespace-nowrap border-b-2 px-0.5 pb-1.5 text-xs font-medium uppercase tracking-wide ${tab === i ? 'border-neutral-800 text-neutral-800' : 'border-transparent text-neutral-400 hover:text-neutral-600'}`}>
            {t.title}
          </button>
        ))}
      </div>
      {tabs[tab].node}
      <div className="mt-4 space-y-1 border-t border-neutral-200 pt-3">
        <div className="flex items-center gap-1 text-xs uppercase tracking-wide text-neutral-500">pathway map · <span className="lowercase">{tabs[tab].title}</span> gene set <InfoTip text={SOURCE_INFO.pathwayMap} /></div>
        <PathwaySection focalId={feature.uniqID} chrom={chrom} geneSet={geneSet} />
      </div>
    </Section>
  );
}

// Shared regulon / modulon as an overlap network (same model as shared domains): genes clustered by
// clique-per-regulator, coloured by how many of the focal's regulons/modulons they co-belong to.
function SharedRegulationField({ feature, shared, chrom }: { feature: Feature; shared: SharedRelationships | null | undefined; chrom: string }) {
  const info = useSourceInfo();
  const sources = [
    { type: 'regulon', groups: shared?.sharedRegulon ?? [] },
    { type: 'modulon', groups: shared?.sharedModulon ?? [] },
  ].filter((s) => s.groups.length);
  return (
    <div className="space-y-1 pt-1">
      <div className="flex items-center gap-1 text-xs uppercase tracking-wide text-neutral-500">co-regulation <InfoTip text={info('sharedRegulation')} /></div>
      {sources.length ? <SharedNetwork focalId={feature.uniqID} focalGene={feature.gene || feature.locus_tag || feature.uniqID} chrom={chrom} sources={sources} unit="regulator" maxMembers={5000} /> : shared === undefined ? <LoadingBox height={NET_PLACEHOLDER_H} label="loading network…" /> : <LoadingBox loading={false} label="no data" height={NET_PLACEHOLDER_H} />}
    </div>
  );
}

// Shared structural features (protein domains/motifs, RNA families) as a full-width network: the
// focus is the SET OVERLAP between each feature's gene set — which genes share all of the focal's
// domains vs only one. Sources (TED / InterPro / Motif, or Family for RNA) are togglable.
function SharedDomainField({ feature, product, shared, chrom }: { feature: Feature; product: string; shared: SharedRelationships | null | undefined; chrom: string }) {
  const sources = (product === 'PROT'
    ? [{ type: 'TED', groups: shared?.sharedDomainTed }, { type: 'InterPro', groups: shared?.sharedDomainInterpro }, { type: 'Motif', groups: shared?.sharedMotif }]
    : product === 'RNA'
      ? [{ type: 'Family', groups: shared?.sharedFamily }]
      : []
  ).flatMap((s) => (s.groups && s.groups.length ? [{ type: s.type, groups: s.groups }] : []));
  const label = product === 'RNA' ? 'shared family' : 'shared domains';
  const info = product === 'RNA' ? SOURCE_INFO.sharedFamily : SOURCE_INFO.sharedDomain;
  return (
    <div className="space-y-1 pt-1">
      <div className="flex items-center gap-1 text-xs uppercase tracking-wide text-neutral-500">{label} <InfoTip text={info} /></div>
      {sources.length ? <SharedNetwork focalId={feature.uniqID} focalGene={feature.gene || feature.locus_tag || feature.uniqID} chrom={chrom} sources={sources} /> : shared === undefined ? <LoadingBox height={NET_PLACEHOLDER_H} label="loading network…" /> : <LoadingBox loading={false} label="no data" height={NET_PLACEHOLDER_H} />}
    </div>
  );
}

// Shared pathway / function as an overlap network (same model as shared domains): genes clustered
// by clique-per-term, coloured by how many of the focal's KEGG terms they share — which co-members
// share 1 pathway/function vs several. Toggle pathway ↔ function.
function SharedActivityField({ feature, related, chrom }: { feature: Feature; related: RelatedData | null | undefined; chrom: string }) {
  const toGroups = (gs: RelatedData['sharedPathway']): SharedGroup[] =>
    gs.map((g) => ({ name: g.name, members: g.members.map((m) => ({ name: m.gene || m.locus_tag || m.uniqID, uniqID: m.uniqID })) }));
  const sources = [
    { type: 'pathway', groups: toGroups(related?.sharedPathway ?? []) },
    { type: 'function', groups: toGroups(related?.sharedFunction ?? []) },
  ].filter((s) => s.groups.length);
  return (
    <div className="space-y-1 pt-1">
      <div className="flex items-center gap-1 text-xs uppercase tracking-wide text-neutral-500">shared pathway / function <InfoTip text={SOURCE_INFO.sharedPathway} /></div>
      {sources.length ? <SharedNetwork focalId={feature.uniqID} focalGene={feature.gene || feature.locus_tag || feature.uniqID} chrom={chrom} sources={sources} unit="term" /> : related === undefined ? <LoadingBox height={NET_PLACEHOLDER_H} label="loading network…" /> : <LoadingBox loading={false} label="no data" height={NET_PLACEHOLDER_H} />}
    </div>
  );
}

// Shared "-on" co-members: one subgroup row per -on, titled by its OnLink entry (auto-width
// column → member lists align), members as gene pills. Uniform across operon/regulon/modulon.
function SharedOnField({ label, kind, groups, chrom, swatch }: { label: string; kind: 'operon' | 'regulon' | 'modulon' | 'domain'; groups: SharedGroup[] | null; chrom: string; swatch?: 'protein' | 'family' }) {
  const { taxid } = useParams<{ taxid: string }>();
  const srcInfo = useSourceInfo();
  const info = kind === 'domain' ? (swatch === 'family' ? SOURCE_INFO.sharedFamily : SOURCE_INFO.sharedDomain) : srcInfo('sharedRegulation');
  if (!groups) return <Field label={label} info={info} value={<NoData />} />;
  const nonEmpty = groups.filter((g) => g.members.length > 0);
  if (nonEmpty.length === 0) return <Field label={label} info={info} value={<NoData />} />;
  // Colour square matching the feature's colour in the protein/RNA viewer feature table:
  // protein rows use the viewer palette index; the RNA family track has a single fixed colour.
  const swatchHex = (g: SharedGroup): string | null =>
    swatch === 'family' ? RNA_FAMILY_COLOR : swatch === 'protein' ? paletteHex(g.colorIndex ?? 0) : null;
  const relGroups: RelGroup[] = nonEmpty.map((g) => ({
    key: g.name,
    label: (
      <span className="flex max-w-full items-start gap-1.5">
        {swatchHex(g) && <span className="mt-0.5 inline-block h-3 w-3 shrink-0" style={{ background: swatchHex(g)! }} />}
        <OnLink name={g.name} link={g.link ?? null} title={(kind === 'regulon' ? g.regulatorType : g.regulator) ?? undefined} />
      </span>
    ),
    chips: g.members.map((m) => ({
      key: m.uniqID ?? m.name,
      name: m.name,
      to: m.uniqID ? `/o/${taxid}/c/${encodeURIComponent(chrom)}/entry/${m.uniqID}` : null,
      title: '',
      cls: 'bg-neutral-100 text-neutral-700',
    })),
  }));
  return <Field label={label} info={info} value={<RelGrid groups={relGroups} />} />;
}

interface ChipModel { key: string; name: string; to: string | null; title: string; cls: string; href?: string }

// A named "-on" entry. Rendered as the app's standard external link (mono + subtle underline,
// like a protein-domain or URS link) so it reads as an *entry*, visually distinct from the
// member-gene pills it groups.
function OnLink({ name, link, title }: { name: string; link: string | null; title?: string }) {
  // Wrap long entry titles onto multiple lines (rather than truncate) so the subgroup column
  // stays narrow instead of widening to fit the longest name.
  const base = 'inline-block max-w-full break-words align-bottom font-mono text-xs';
  return link ? (
    <a href={link} target="_blank" rel="noreferrer" title={title ?? name} className={`${base} underline decoration-neutral-300 hover:decoration-neutral-700`}>{name}</a>
  ) : (
    <span title={title ?? name} className={base}>{name}</span>
  );
}

// A Relationships subgroup: a label cell (plain descriptor like "physical"/"activated by", or a
// linked -on entry like ppGpp) + its member chips.
interface RelGroup { key: string; label: ReactNode; chips: ChipModel[] }

// Plain-text subgroup descriptor (for evidence/direction categories).
function Descriptor({ children }: { children: ReactNode }) {
  return <span className="text-[10px] uppercase tracking-wide text-neutral-400">{children}</span>;
}

// Unified 2-column grid for every Relationships field: subgroup column (auto-width, so all
// member lists align) + member chips. Long lists capped with a "+N more" tail. null when empty.
function RelGrid({ groups, cap = 40, labelCol = 'minmax(0, 10rem)' }: { groups: RelGroup[]; cap?: number; labelCol?: string }) {
  const rows = groups.filter((g) => g.chips.length > 0);
  if (rows.length === 0) return null;
  return (
    <div className="grid items-start gap-x-[var(--field-gap,0.5rem)] gap-y-1" style={{ gridTemplateColumns: `${labelCol} 1fr` }}>
      {rows.map((g) => (
        <Fragment key={g.key}>
          <div className="min-w-0 self-start">{g.label}</div>
          <ul className="flex flex-wrap gap-1">
            {g.chips.slice(0, cap).map((c) => (
              <li key={c.key}>
                {c.to ? (
                  <Link to={c.to} title={c.title} className={`rounded px-1.5 py-0.5 text-xs hover:brightness-95 ${c.cls}`}><span className="font-mono">{c.name}</span></Link>
                ) : c.href ? (
                  <a href={c.href} target="_blank" rel="noreferrer" title={c.title} className={`rounded px-1.5 py-0.5 text-xs hover:brightness-95 ${c.cls}`}><span className="font-mono">{c.name}</span></a>
                ) : (
                  <span title={c.title} className={`rounded px-1.5 py-0.5 text-xs ${c.cls}`}><span className="font-mono">{c.name}</span></span>
                )}
              </li>
            ))}
            {g.chips.length > cap && <li className="self-center px-1 text-[11px] text-neutral-400">+{g.chips.length - cap} more</li>}
          </ul>
        </Fragment>
      ))}
    </div>
  );
}

// Within-genome similarity (sequence / structure) as a table: each hit's similarity metric
// (% identity / TM-score) alongside what it actually does — KEGG class swatch + lowest-level
// pathway and function terms — so paralogs sharing a fold but a different role are easy to spot.
function SimilarField({ label, members, chrom, metric }: { label: string; members: SimilarMember[] | null; chrom: string; metric: 'identity' | 'tmscore' }) {
  const { taxid } = useParams<{ taxid: string }>();
  const info = metric === 'identity' ? SOURCE_INFO.seqSimilarity : SOURCE_INFO.structSimilarity;
  // Both similarity sources are wired (sequence = BLAST, structural = Foldseek) → absent is "no data".
  if (members === null || members.length === 0) return <Field label={label} info={info} value={<NoData />} />;
  const metricHead = metric === 'identity' ? 'identity' : 'TM-score';
  return (
    <div className="space-y-1 pt-1">
      <div className="flex items-center gap-1 text-xs uppercase tracking-wide text-neutral-500">{label} <InfoTip text={info} /></div>
      <div className="max-h-80 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-white text-left text-neutral-500">
            <tr>
              <th className="px-2 py-1 font-medium">gene</th>
              <th className="px-2 py-1 font-medium">{metricHead}</th>
              <th className="px-2 py-1 font-medium">class</th>
              <th className="px-2 py-1 font-medium">pathway</th>
              <th className="px-2 py-1 font-medium">function</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.uniqID} className="border-t border-neutral-100 hover:bg-neutral-50">
                <td className="px-2 py-1 whitespace-nowrap">
                  <Link to={`/o/${taxid}/c/${encodeURIComponent(chrom)}/entry/${m.uniqID}`} className="font-mono underline decoration-neutral-300 hover:decoration-neutral-700">{m.gene}</Link>
                </td>
                <td className="px-2 py-1 font-mono text-neutral-500 whitespace-nowrap" title={metric === 'identity' && m.coverage != null ? `${m.coverage}% coverage` : undefined}>
                  {metric === 'identity' ? (m.identity != null ? `${m.identity}%` : '—') : (m.tmscore != null ? m.tmscore.toFixed(2) : '—')}
                  {m.altPose && <span className="ml-1.5 rounded bg-amber-100 px-1 py-0.5 text-[9px] font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300" title="same domains, different relative arrangement: the alignment covers most of both chains and is locally accurate, but they don't superpose globally (low TM)">alt pose</span>}
                </td>
                <td className="px-2 py-1 whitespace-nowrap text-neutral-600">
                  {m.kgpc ? <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-sm" style={{ background: kgpcColor(m.kgpc) }} />{m.kgpc}</span> : '—'}
                </td>
                <td className="px-2 py-1 text-neutral-600"><div className="max-w-[200px] truncate" title={m.pathway ?? undefined}>{m.pathway ?? '—'}</div></td>
                <td className="px-2 py-1 text-neutral-600"><div className="max-w-[200px] truncate" title={m.func ?? undefined}>{m.func ?? '—'}</div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Interactions = molecular only (STRING): physical (experimental/curated) vs predicted, on
// separate rows. Score shown on hover; partners with a uniqID link to their entry.
function InteractionsField({ interactions, chrom }: { interactions: Interactions | null; chrom: string }) {
  // The molecular-interaction network. Rendered full-width (label on its own line) rather than in the
  // narrow label/value column, so the network + table have room. Same footprint when there are no
  // interactions (a same-size placeholder box), so the section is consistent across genes. (The
  // endpoint 404s → `interactions` null for no-data; a static box covers both that and the brief load.)
  const empty = !interactions || interactions.partners.length === 0;
  return (
    <div className="space-y-1 pt-1">
      <div className="flex items-center gap-1 text-xs uppercase tracking-wide text-neutral-500">
        interactions
        <InfoTip text={SOURCE_INFO.interactionsProtein} />
      </div>
      {empty
        ? <LoadingBox loading={false} label="no interactions" height={NET_PLACEHOLDER_H} />
        : <InteractionNetwork uniqID={interactions.uniqID} chrom={chrom} />}
    </div>
  );
}

// Regulation = regulatory relationships (RegulonDB), distinct from molecular interactions.
// Split by function into rows: incoming activated by / repressed by, outgoing activates /
// represses (dual regulators appear in both; unspecified function falls to a generic row).
function splitByFunction(edges: Regulation['regulatedBy']) {
  const act: Regulation['regulatedBy'] = [], rep: typeof act = [], other: typeof act = [];
  for (const e of edges) {
    const fn = (e.function ?? '').toLowerCase();
    let placed = false;
    if (fn.includes('activ') || fn.includes('dual')) { act.push(e); placed = true; }
    if (fn.includes('repress') || fn.includes('dual')) { rep.push(e); placed = true; }
    if (!placed) other.push(e);
  }
  return { act, rep, other };
}
function RegulationField({ regulation, chrom }: { regulation: Regulation | null; chrom: string }) {
  const { taxid } = useParams<{ taxid: string }>();
  const info = useSourceInfo();
  if (!regulation || (regulation.regulatedBy.length === 0 && regulation.sigmulons.length === 0 && regulation.modulons.length === 0)) {
    return <Field label="transcriptional factors" info={info('regulation')} value={<NoData />} />;
  }
  const fnCls = (fn: string | null) =>
    (fn ?? '').includes('activ') ? ACCENT_CHIP.green
    : (fn ?? '').includes('repress') ? ACCENT_CHIP.red
    : 'bg-neutral-100 text-neutral-700';
  const toChip = (e: Regulation['regulatedBy'][number], dir: string): ChipModel => ({
    key: `${dir}-${e.name}-${e.function ?? ''}`,
    name: e.name,
    to: e.uniqID ? `/o/${taxid}/c/${encodeURIComponent(chrom)}/entry/${e.uniqID}` : null,
    title: [e.function, e.regulatorType].filter(Boolean).join(' · ') || 'regulatory',
    cls: fnCls(e.function),
  });
  const inc = splitByFunction(regulation.regulatedBy);
  const sigma: ChipModel[] = regulation.sigmulons.map((s) => ({
    key: `sig-${s.name}`,
    name: s.name,
    to: s.uniqID ? `/o/${taxid}/c/${encodeURIComponent(chrom)}/entry/${s.uniqID}` : null,
    title: 'sigma factor',
    cls: ACCENT_CHIP.indigo,
  }));
  // Modulon regulators (iModulonDB) — the inferred TF(s) of each modulon this gene belongs to,
  // split into individual genes (resolved to genome features) and deduped. Each links to its
  // entry when resolved, else to the modulon page.
  const modSeen = new Set<string>();
  const modulon: ChipModel[] = regulation.modulons.flatMap((m) =>
    (m.regulators ?? []).filter((r) => !modSeen.has(r.name.toLowerCase()) && modSeen.add(r.name.toLowerCase())).map((r) => ({
      key: `mod-${r.name}`,
      name: r.name,
      to: r.uniqID ? `/o/${taxid}/c/${encodeURIComponent(chrom)}/entry/${r.uniqID}` : null,
      href: r.uniqID ? undefined : m.link ?? undefined,
      title: `modulon: ${m.name}`,
      cls: ACCENT_CHIP.amber,
    }))
  );
  return (
    <Field
      label="transcriptional factors"
      info={info('regulation')}
      value={
        <RelGrid groups={[
          { key: 'act', label: <Descriptor>activator</Descriptor>, chips: inc.act.map((e) => toChip(e, 'act')) },
          { key: 'rep', label: <Descriptor>repressor</Descriptor>, chips: inc.rep.map((e) => toChip(e, 'rep')) },
          { key: 'sigma', label: <Descriptor>sigma factor</Descriptor>, chips: sigma },
          { key: 'modulon', label: <Descriptor>modulon regulator</Descriptor>, chips: modulon },
          { key: 'other', label: <Descriptor>regulator</Descriptor>, chips: inc.other.map((e) => toChip(e, 'other')) },
        ]} />
      }
    />
  );
}

