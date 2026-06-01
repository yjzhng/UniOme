import { Fragment, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { typeLevels, type Feature, type FeatureSummary, type GeneticLevel } from '@uniome/shared';
import ModulePanel, { hasModulesForLevel } from '../modules/ModulePanel';

interface RelatedData {
  sharedPathway: FeatureSummary[];
  sharedFunction: FeatureSummary[];
}

export default function EntryPage() {
  const { id, taxid, chrom } = useParams<{ id: string; taxid: string; chrom: string }>();
  const [feature, setFeature] = useState<Feature | null>(null);
  const [related, setRelated] = useState<RelatedData | null>(null);
  const [siblings, setSiblings] = useState<Feature[]>([]);
  const [notFound, setNotFound] = useState(false);
  const [selectedLevel, setSelectedLevel] = useState<GeneticLevel>('DNA');

  useEffect(() => {
    if (!id) return;
    setFeature(null);
    setRelated(null);
    setSiblings([]);
    setNotFound(false);
    setSelectedLevel('DNA');
    fetch(`/api/organism/${taxid}/features/${encodeURIComponent(id)}`)
      .then(async (r) => {
        if (r.status === 404) {
          setNotFound(true);
          return null;
        }
        return r.json();
      })
      .then((f) => setFeature(f));
    fetch(`/api/organism/${taxid}/features/${encodeURIComponent(id)}/related`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setRelated);
    fetch(`/api/organism/${taxid}/features/${encodeURIComponent(id)}/siblings`)
      .then((r) => (r.ok ? r.json() : []))
      .then(setSiblings)
      .catch(() => {});
  }, [id, taxid]);

  if (notFound)
    return (
      <main className="mx-auto max-w-7xl px-4 py-8">
        <div className="text-sm">
          not found.{' '}
          <Link to={taxid && chrom ? `/o/${taxid}/c/${chrom}` : '/'} className="underline">
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
  const activeLevel = availableLevels.includes(selectedLevel) ? selectedLevel : availableLevels[0];

  return (
    <main className="mx-auto max-w-7xl px-4 py-4 space-y-4">
      <EntryHeader feature={feature} />
      <GeneralSection feature={feature} />
      <Dendrogram
        feature={feature}
        siblings={siblings}
        taxid={taxid ?? ''}
        active={activeLevel}
        onSelect={setSelectedLevel}
      />
      <LevelView feature={feature} taxid={taxid ?? ''} activeLevel={activeLevel} />
      <RelationshipsSection related={related} />
    </main>
  );
}

// The active level's info section, with any visualization modules for that level
// shown alongside it on the right half. Falls back to full-width when a level has
// no modules (DNA / RNA today).
function LevelView({
  feature,
  taxid,
  activeLevel,
}: {
  feature: Feature;
  taxid: string;
  activeLevel: GeneticLevel;
}) {
  const ctx = { feature, taxid };
  const section =
    activeLevel === 'DNA' ? (
      <DnaSection feature={feature} />
    ) : activeLevel === 'RNA' ? (
      <RnaSection feature={feature} />
    ) : (
      <ProteinSection feature={feature} />
    );

  if (!hasModulesForLevel(activeLevel, ctx)) return section;
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start">
      <div>{section}</div>
      <ModulePanel level={activeLevel} ctx={ctx} />
    </div>
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

  // All features sharing this locus_tag — current + siblings.
  const all = [f, ...siblings];
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

  const NODE_H = 40;
  const ROW_GAP = 14;
  const ROW = NODE_H + ROW_GAP;
  const COL_GAP = 56;
  const NODE_MIN_W = 100;
  const NODE_CHAR_W = 7.5; // approx mono-12 char width
  const NODE_PADDING = 20;
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
  const svgH = totalHeight;
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
    <div className="overflow-x-auto rounded border border-neutral-200 bg-white p-3">
      <svg width={svgW} height={svgH} className="block">
        {rnaLayout.map(({ row, startRow, count }, i) => {
          const cy = rowCenter(startRow + (count - 1) / 2);
          return (
            <Connector
              key={`dna-rna-${i}`}
              x1={dnaX + dnaColW}
              y1={dnaY}
              x2={rnaX}
              y2={cy}
            />
          );
        })}
        {rnaLayout.flatMap(({ row, startRow }) =>
          row.proteins.map((p, j) => {
            const cyR = rowCenter(startRow + (row.proteins.length - 1) / 2);
            const cyP = rowCenter(startRow + j);
            return (
              <Connector
                key={`rna-prot-${row.key}-${p.uniqID}`}
                x1={rnaX + rnaColW}
                y1={cyR}
                x2={protX}
                y2={cyP}
              />
            );
          })
        )}

        <DendroNode
          x={dnaX}
          y={dnaY - NODE_H / 2}
          width={dnaColW}
          height={NODE_H}
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
                level="Protein"
                label={label}
                active={isActive}
                isCurrentLocus={isCurrent}
                onClick={() => clickFeature(p)}
              />
            );
          })
        )}
      </svg>
    </div>
  );
}

function Connector({ x1, y1, x2, y2 }: { x1: number; y1: number; x2: number; y2: number }) {
  const midX = (x1 + x2) / 2;
  return (
    <path
      d={`M ${x1} ${y1} L ${midX} ${y1} L ${midX} ${y2} L ${x2} ${y2}`}
      fill="none"
      stroke="#a3a3a3"
      strokeWidth={1.5}
    />
  );
}

function DendroNode({
  x,
  y,
  width,
  height,
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
  level: string;
  label: string;
  active: boolean;
  isCurrentLocus: boolean;
  onClick: () => void;
}) {
  const fill = active ? '#171717' : 'white';
  const stroke = isCurrentLocus ? '#171717' : '#d4d4d4';
  const strokeWidth = isCurrentLocus ? 1.5 : 1;
  const labelColor = active ? 'white' : '#171717';
  const subColor = active ? '#a3a3a3' : '#737373';
  const display = label;
  return (
    <g onClick={onClick} style={{ cursor: 'pointer' }}>
      <rect x={x} y={y} width={width} height={height} rx={4} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />
      <text x={x + 10} y={y + 15} fontSize={10} fill={subColor}>
        {level}
      </text>
      <text
        x={x + 10}
        y={y + 31}
        fontSize={12}
        fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
        fill={labelColor}
        fontWeight={isCurrentLocus ? 600 : 400}
      >
        {display}
      </text>
    </g>
  );
}

function EntryHeader({ feature: f }: { feature: Feature }) {
  const coordStr = f.coord
    ? `${f.coord.start.toLocaleString()}..${f.coord.end.toLocaleString()} (${f.coord.strand})`
    : '— no genomic mapping';
  return (
    <header className="border-b border-neutral-200 pb-3 space-y-1">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-neutral-500">
        <span className="font-mono">{f.locus_tag || f.uniqID}</span>
        <span className="font-mono">{coordStr}</span>
      </div>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="font-mono text-2xl font-semibold tracking-tight">
          {f.gene || f.locus_tag || f.uniqID}
        </h1>
        <span className="text-sm text-neutral-500">{f.type}</span>
      </div>
      <p className="text-sm text-neutral-700">{f.product || <em>no product description</em>}</p>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-neutral-600">
        <span>source: {f.source.join(', ') || '—'}</span>
      </div>
    </header>
  );
}

function Section({ title, level, children }: { title: string; level?: GeneticLevel; children: React.ReactNode }) {
  return (
    <section className="rounded border border-neutral-200 bg-white">
      <header className="flex items-baseline gap-2 border-b-2 border-neutral-800 px-3 py-2">
        <h2 className="text-sm font-semibold text-neutral-900">{title}</h2>
        {level && <span className="text-xs text-neutral-400">{level}</span>}
      </header>
      <div className="px-3 py-3 space-y-2">{children}</div>
    </section>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_1fr] items-baseline gap-3 text-sm">
      <div className="text-xs uppercase tracking-wide text-neutral-500">{label}</div>
      <div className="text-neutral-800">{value}</div>
    </div>
  );
}

function Placeholder() {
  return <span className="text-xs italic text-neutral-400">not yet ingested</span>;
}

type ChipSource = 'KG' | 'UP';

const CHIP_CLASS: Record<ChipSource, string> = {
  KG: 'bg-amber-100 text-amber-900',
  UP: 'bg-sky-100 text-sky-900',
};

function chipClass(source?: ChipSource) {
  return source ? CHIP_CLASS[source] : 'bg-neutral-100 text-neutral-700';
}

function TagList({ tags, source }: { tags: string[]; source?: ChipSource }) {
  if (tags.length === 0) return <Placeholder />;
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

function Breadcrumb({ levels, source }: { levels: string[][]; source?: ChipSource }) {
  const nonEmpty = levels.filter((l) => l.length > 0);
  if (nonEmpty.length === 0) return <Placeholder />;
  return (
    <div className="flex flex-wrap items-center gap-x-1 gap-y-1">
      {nonEmpty.map((level, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="text-neutral-400">›</span>}
          <span className="flex flex-wrap items-center gap-x-1 gap-y-1">
            {level.map((v, j) => (
              <Fragment key={`${v}-${j}`}>
                {j > 0 && <span className="text-neutral-300">/</span>}
                <span className={`rounded px-1.5 py-0.5 text-xs ${chipClass(source)}`}>{v}</span>
              </Fragment>
            ))}
          </span>
        </Fragment>
      ))}
    </div>
  );
}

function GeneralSection({ feature: f }: { feature: Feature }) {
  return (
    <Section title="General">
      <Field label="function" value={<Breadcrumb levels={[f.KG_FG, f.KG_FM]} source="KG" />} />
      <Field label="pathway" value={<Breadcrumb levels={[f.KG_PC, f.KG_PG, f.KG_PW]} source="KG" />} />
      <Field label="essentiality" value={<Placeholder />} />
      <Field label="mutation freq" value={<Placeholder />} />
      <Field label="conservation" value={<Placeholder />} />
    </Section>
  );
}

function SeqBlock({ seq, unit }: { seq: string | null; unit: 'bp' | 'nt' | 'aa' }) {
  if (!seq) return <Placeholder />;
  const lines: string[] = [];
  for (let i = 0; i < seq.length; i += 60) lines.push(seq.slice(i, i + 60));
  return (
    <pre className="max-h-40 overflow-auto whitespace-pre rounded bg-neutral-50 p-2 font-mono text-xs leading-relaxed text-neutral-800">
      {lines.join('\n')}
      {'\n'}
      <span className="text-neutral-400">— {seq.length.toLocaleString()} {unit}</span>
    </pre>
  );
}

function DnaSection({ feature: f }: { feature: Feature }) {
  return (
    <Section title="DNA level" level="DNA">
      <Field label="uniqID" value={<span className="font-mono">{f.uniqID}</span>} />
      <Field label="GeneID" value={f.GeneID ? <span className="font-mono">{f.GeneID}</span> : <Placeholder />} />
      <Field label="gene name" value={f.gene || <Placeholder />} />
      <Field label="length" value={f.len !== null ? `${f.len.toLocaleString()} bp` : <Placeholder />} />
      <Field label="sequence" value={<SeqBlock seq={f.seq} unit="bp" />} />
      <Field label="structure" value={<Placeholder />} />
      <Field label="variants" value={<Placeholder />} />
      <Field label="modifications" value={<Placeholder />} />
      <Field label="interactions" value={<Placeholder />} />
    </Section>
  );
}

function RnaSection({ feature: f }: { feature: Feature }) {
  const rnaName = f.type === 'CDS' ? f.gene : f.product || f.gene;
  return (
    <Section title="RNA level" level="RNA">
      <Field label="name" value={rnaName || <Placeholder />} />
      <Field label="id" value={<Placeholder />} />
      <Field label="length" value={f.rna_len !== null ? `${f.rna_len.toLocaleString()} nt` : <Placeholder />} />
      <Field label="sequence" value={<SeqBlock seq={f.rna_seq} unit="nt" />} />
      <Field label="2° structure" value={<Placeholder />} />
      <Field label="variants" value={<Placeholder />} />
      <Field label="modifications" value={<Placeholder />} />
      <Field label="interactions" value={<Placeholder />} />
      <Field label="reactions" value={<Placeholder />} />
    </Section>
  );
}

function ProteinSection({ feature: f }: { feature: Feature }) {
  return (
    <Section title="Protein level" level="PROT">
      <Field label="name" value={f.product || <Placeholder />} />
      <Field
        label="id"
        value={
          f.UniProtID ? (
            <a
              href={`https://www.uniprot.org/uniprotkb/${f.UniProtID}`}
              target="_blank"
              rel="noreferrer"
              className="font-mono underline decoration-neutral-300 hover:decoration-neutral-700"
            >
              {f.UniProtID}
            </a>
          ) : (
            <Placeholder />
          )
        }
      />
      <Field label="keywords" value={<TagList tags={f.UP_KW} source="UP" />} />
      <Field label="family" value={<TagList tags={f.UP_FM} source="UP" />} />
      <Field label="pathway" value={<TagList tags={f.UP_PW} source="UP" />} />
      <Field label="length" value={f.prot_len !== null ? `${f.prot_len.toLocaleString()} aa` : <Placeholder />} />
      <Field label="interactions" value={<Placeholder />} />
      <Field label="reactions" value={<Placeholder />} />
      <Field label="variants" value={<Placeholder />} />
      <Field label="modifications" value={<Placeholder />} />
    </Section>
  );
}

function RelationshipsSection({ related }: { related: RelatedData | null }) {
  return (
    <Section title="Relationships">
      <RelatedList label="shared pathway" items={related?.sharedPathway ?? []} />
      <RelatedList label="shared function" items={related?.sharedFunction ?? []} />
      <Field label="seq similarity" value={<Placeholder />} />
      <Field label="shared domains" value={<Placeholder />} />
      <Field label="shared operons/modulons" value={<Placeholder />} />
      <Field label="shared regulatory elements" value={<Placeholder />} />
    </Section>
  );
}

function RelatedList({ label, items }: { label: string; items: FeatureSummary[] }) {
  const { taxid } = useParams<{ taxid: string }>();
  return (
    <Field
      label={label}
      value={
        items.length === 0 ? (
          <Placeholder />
        ) : (
          <ul className="flex flex-wrap gap-1">
            {items.map((r) => (
              <li key={r.uniqID}>
                <Link
                  to={`/o/${taxid}/c/${encodeURIComponent(r.chrom)}/entry/${r.uniqID}`}
                  className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs hover:bg-neutral-200"
                  title={`${r.chrom} · ${r.product}`}
                >
                  <span className="font-mono">{r.gene || r.locus_tag || r.uniqID}</span>
                </Link>
              </li>
            ))}
          </ul>
        )
      }
    />
  );
}
