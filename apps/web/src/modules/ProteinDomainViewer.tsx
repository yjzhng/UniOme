import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { FC } from 'react';
import type {
  Feature,
  ProteinDomains,
  ProteinInterproDomains,
  ProteinCddMotifs,
  ProteinDisorder,
  ProteinVariant,
  ProteinVariants,
  ProteinModifications,
  ProteinComplexes,
  ComplexChainMap,
  Interactions,
} from '@uniome/shared';
import { Link, useParams } from 'react-router-dom';
import { Field, InfoTip, NoData as FieldNoData, Section, TagList } from '../components/Fields';
import { useEntryActive } from '../lib/entryActive';
import { LocalisationField } from '../components/LocalisationField';
import { ExpressionBar } from '../components/ExpressionField';
import { SOURCE_INFO } from '../sourceInfo';
import { SequenceView } from '../components/SequenceView';
import { TableScroller } from '../components/TableScroller';

// Mol* is large; only pull it in when a protein with a structure is actually viewed.
const MolstarViewer = lazy(() => import('./MolstarViewer'));
import type { DomainColor, Subunit, Ligand, ChainContacts } from './MolstarViewer';

// Per-interaction-kind track colours (protein-interacting uses the subunit's own colour).
const NUCLEIC_CONTACT_COLOR = '#0d9488'; // teal
const LIGAND_CONTACT_COLOR = '#d97706'; // amber

// Shared tab10 theme palette — used by feature (domain/motif) spans that don't carry an explicit
// colour, so a span's colour is consistent across the track, sequence and 3D model.
import { paletteHex, ACCENT1, ACCENT3, ACCENT4 } from '../lib/theme';
export { paletteHex };

// ---------------------------------------------------------------------------
// Feature-track framework
//
// Like a genome browser stacks one track per chromosome, the protein view stacks a
// few tracks (Domains, Conserved motifs, Disordered regions). A track has one or more
// *sources* and a switch to pick between them (e.g. Domains: TED | InterPro); the
// active source supplies the track's spans. Clicking a track makes it *active*,
// switching the sequence + 3D-model colouring to its spans.
//
// Adding a source = add a ProteinSource to a track in TRACKS. Its load() turns whatever
// the API returns into FeatureSpans (+ an optional detail Table); a source can instead
// derive its spans from the loaded structure (pLDDT).
// ---------------------------------------------------------------------------

// One annotated stretch of the protein: a domain, a low-confidence region, a single
// modified/variant residue ([p, p]), etc. `key` is the hover-sync handle shared by
// the active track, the sequence and the 3D model. Colour is `color` if set, else the
// palette entry at `colorIndex`.
export interface FeatureSpan {
  key: string;
  segments: Array<[number, number]>; // residue blocks; >1 = discontinuous
  label: string | null; // shown inside a wide track box
  title: string; // tooltip
  colorIndex: number;
  color?: string; // explicit hex override (e.g. pLDDT confidence bands)
}

const spanHex = (s: FeatureSpan) => s.color ?? paletteHex(s.colorIndex);

// Mix a hex colour toward white by `amt` (0..1) — used to render pLDDT colours faint.
function mixWhite(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v + (255 - v) * amt));
  return `#${((ch[0] << 16) | (ch[1] << 8) | ch[2]).toString(16).padStart(6, '0')}`;
}

// Helpers handed to a track's detail Table so its rows hover-sync and colour-match
// the rest of the views.
export interface TrackTableProps {
  hovered: string | null; // effective highlight (transient hover or pinned selection)
  setHovered: (key: string | null) => void; // set the transient hover
  onToggle: (key: string) => void; // click a row to pin/unpin the selection
  colorOf: (i: number) => string;
  dimmed: (key: string) => boolean;
}

// A run of consecutive residues sharing a colour — for tracks rendered as a
// per-residue heatmap (pLDDT) rather than discrete feature boxes.
export interface GradientRun {
  start: number;
  end: number;
  color: string;
}

// What a feature type's load() resolves to once it has data.
export interface LoadedTrack {
  spans: FeatureSpan[];
  length: number | null; // scale hint (max residue), if the source knows it
  source: string | null; // provenance footer, e.g. "TED (The Encyclopedia of Domains)"
  Table?: FC<TrackTableProps>; // optional per-feature detail table
  // When set, the track bar renders a continuous per-residue pLDDT heatmap behind its
  // `spans` (the detected low regions). The sequence + 3D still use span colour, so a
  // region reads as one colour everywhere; only the track shows the full map.
  gradient?: GradientRun[];
  // Spans can overlap (e.g. InterPro domains aren't mutually exclusive) → draw the
  // track boxes semi-transparent so overlaps are visible.
  translucent?: boolean;
  // Faint, non-interactive context boxes drawn behind the spans in the track bar only
  // (e.g. the CDD domain envelope behind its conserved-residue motifs).
  backdrops?: Array<{ segments: Array<[number, number]>; color: string; title: string }>;
}

// One data source for a track. A track may have several (e.g. Domains: TED | InterPro)
// and offer a switch to toggle between them.
export interface ProteinSource {
  id: string;
  label: string; // shown in the source switch (e.g. "TED")
  // Fetch + normalise for one protein. null = no data. Omitted for sources whose spans
  // are derived from the structure instead (see `fromPlddt`).
  load?(ctx: { taxid: string; acc: string; feature: Feature }): Promise<LoadedTrack | null>;
  // Derive spans from the loaded structure's per-residue pLDDT (AlphaFold B-factor).
  fromPlddt?: boolean;
}

// A stacked track. Its active source supplies the spans; clicking the track makes it
// the active layer (drives the sequence + 3D colouring).
export interface ProteinTrack {
  id: string;
  label: string; // track label (e.g. "Domains")
  sources: ProteinSource[]; // ≥1; a switch appears when >1
  info?: string; // data-source tooltip text
}

// --- Sources -------------------------------------------------------------------

// TED consensus domains.
const tedSource: ProteinSource = {
  id: 'ted',
  label: 'TED',
  async load({ taxid, acc }) {
    const r = await fetch(`/api/organism/${taxid}/protein/${encodeURIComponent(acc)}/domains`);
    if (r.status === 404) return null;
    if (!r.ok) throw new Error('domains fetch failed');
    const data = (await r.json()) as ProteinDomains | null;
    if (!data?.domains?.length) return null;
    const spans: FeatureSpan[] = data.domains.map((d, i) => ({
      key: d.id,
      segments: d.segments,
      label: d.id,
      title: `${d.id} · ${d.segments.map(([s, e]) => `${s}–${e}`).join(', ')}${d.cath ? ` · ${d.cath}` : ''}`,
      colorIndex: i,
    }));
    return {
      spans,
      length: data.length,
      source: `${data.source} (The Encyclopedia of Domains)`,
      Table: (props) => <DomainTable domains={data.domains} {...props} />,
    };
  },
};

// InterPro representative domains.
const interproSource: ProteinSource = {
  id: 'interpro',
  label: 'InterPro',
  async load({ taxid, acc }) {
    const r = await fetch(`/api/organism/${taxid}/protein/${encodeURIComponent(acc)}/interpro`);
    if (r.status === 404) return null;
    if (!r.ok) throw new Error('interpro fetch failed');
    const data = (await r.json()) as ProteinInterproDomains | null;
    if (!data?.domains?.length) return null;
    const spans: FeatureSpan[] = data.domains.map((d, i) => ({
      key: `${d.id}#${i}`,
      segments: d.segments,
      label: d.id,
      title: `${d.id}${d.name ? ` · ${d.name}` : ''} · ${d.segments.map(([s, e]) => `${s}–${e}`).join(', ')}`,
      colorIndex: i,
    }));
    return {
      spans,
      length: data.length,
      source: 'InterPro (representative domains)',
      translucent: true,
      Table: (props) => <InterproTable domains={data.domains} {...props} />,
    };
  },
};

// CDD conserved-residue motifs — the curated sites within each CDD model (binding
// sites, Walker motifs, …), coloured per model and drawn translucent (sites can sit
// close / overlap between models).
const cddSource: ProteinSource = {
  id: 'cdd',
  label: 'CDD',
  async load({ taxid, acc }) {
    const r = await fetch(`/api/organism/${taxid}/protein/${encodeURIComponent(acc)}/cdd`);
    if (r.status === 404) return null;
    if (!r.ok) throw new Error('cdd fetch failed');
    const data = (await r.json()) as ProteinCddMotifs | null;
    if (!data?.motifs?.length) return null;
    // Colour by CDD model so a model's sites (and its envelope) share a colour. Index
    // by first appearance in the motifs (matching CddTable), then any model-only entry.
    const modelIdx = new Map<string, number>();
    const idxOf = (entry: string) => {
      if (!modelIdx.has(entry)) modelIdx.set(entry, modelIdx.size);
      return modelIdx.get(entry)!;
    };
    const spans: FeatureSpan[] = data.motifs.map((m, i) => ({
      key: `cdd-${i}`,
      segments: m.segments,
      label: m.description,
      title: `${m.entry}${m.entryName ? ` (${m.entryName})` : ''} · ${m.description} · ${m.segments
        .map(([s, e]) => `${s}–${e}`)
        .join(', ')}`,
      colorIndex: idxOf(m.entry),
    }));
    // Faint domain-model envelopes behind the motifs, coloured to match.
    const backdrops = (data.models ?? []).map((m) => ({
      segments: m.segments,
      color: paletteHex(idxOf(m.entry)),
      title: `${m.entry}${m.name ? ` (${m.name})` : ''} domain · ${m.segments
        .map(([s, e]) => `${s}–${e}`)
        .join(', ')}`,
    }));
    return {
      spans,
      length: data.length,
      source: 'CDD conserved residues (NCBI Conserved Domain Database)',
      translucent: true,
      backdrops,
      Table: (props) => <CddTable motifs={data.motifs} {...props} />,
    };
  },
};

// Disordered regions — MobiDB-lite consensus. One semantic (disorder), so one colour.
const DISORDER_COLOR = ACCENT3; // intrinsic disorder (mobiDB) — tab10 purple
const mobidbSource: ProteinSource = {
  id: 'mobidb',
  label: 'MobiDB',
  async load({ taxid, acc }) {
    const r = await fetch(`/api/organism/${taxid}/protein/${encodeURIComponent(acc)}/disorder`);
    if (r.status === 404) return null;
    if (!r.ok) throw new Error('disorder fetch failed');
    const data = (await r.json()) as ProteinDisorder | null;
    if (!data?.regions?.length) return null;
    const spans: FeatureSpan[] = data.regions.map(([s, e], i) => ({
      key: `dis-${i}`,
      segments: [[s, e]],
      label: null,
      title: `Disordered ${s}–${e}`,
      colorIndex: i,
      color: DISORDER_COLOR,
    }));
    return {
      spans,
      length: data.length,
      source: `${data.source} (intrinsic disorder)`,
      Table: (props) => <DisorderTable regions={data.regions} {...props} />,
    };
  },
};

// Low pLDDT regions — derived from the AlphaFold model's per-residue confidence
// (B-factor), no fetch needed.
const plddtSource: ProteinSource = {
  id: 'plddt',
  label: 'pLDDT',
  fromPlddt: true,
};

// Sequence variants — UniProt natural variants + mutagenesis sites. One semantic, one
// colour; point features so they don't overlap meaningfully.
const VARIANT_COLOR = ACCENT1; // variants — tab10 red
const VARIANT_TYPE_LABEL: Record<string, string> = {
  VARIANT: 'natural',
  MUTAGEN: 'mutagen',
  VAR_SEQ: 'isoform',
};
const variantType = (t: string) => VARIANT_TYPE_LABEL[t] ?? t.toLowerCase();
// Compact change string. No replacement = a deletion → "missing". A single-residue
// substitution shows "L26M"; a range replacement shows the (truncated) new sequence.
function variantChange(v: ProteinVariant): string {
  if (!v.variation) return 'missing';
  if (v.begin === v.end) return `${v.original ?? ''}${v.begin}${v.variation}`;
  return `→ ${v.variation.length > 12 ? v.variation.slice(0, 12) + '…' : v.variation}`;
}
const variantPos = (v: ProteinVariant) => (v.begin === v.end ? `${v.begin}` : `${v.begin}–${v.end}`);
const variantSource: ProteinSource = {
  id: 'uniprot-variants',
  label: 'UniProt',
  async load({ taxid, acc }) {
    const r = await fetch(`/api/organism/${taxid}/protein/${encodeURIComponent(acc)}/variants`);
    if (r.status === 404) return null;
    if (!r.ok) throw new Error('variants fetch failed');
    const data = (await r.json()) as ProteinVariants | null;
    if (!data?.variants?.length) return null;
    const spans: FeatureSpan[] = data.variants.map((v, i) => {
      const change = variantChange(v);
      return {
        key: `var-${i}`,
        segments: [[v.begin, v.end]],
        label: change,
        title: `${variantType(v.type)} ${variantPos(v)} · ${change}${v.description ? ` · ${v.description}` : ''}`,
        colorIndex: i,
        color: VARIANT_COLOR,
      };
    });
    return {
      spans,
      length: data.length,
      source: 'UniProt (natural variants + mutagenesis)',
      Table: (props) => <VariantTable variants={data.variants} {...props} />,
    };
  },
};

// Post-translational modifications — UniProt PTM features.
const MOD_COLOR = ACCENT4; // modifications (PTM) — tab10 green
const PTM_TYPE_LABEL: Record<string, string> = {
  DISULFID: 'Disulfide bond',
  CROSSLNK: 'Cross-link',
  CARBOHYD: 'Glycosylation',
  LIPID: 'Lipidation',
  MOD_RES: 'Modified residue',
};
// Disulfides / cross-links pair two (often distant) residues — render both endpoints
// as points, never the span between them.
const isPtmBond = (type: string, begin: number, end: number) =>
  (type === 'DISULFID' || type === 'CROSSLNK') && end > begin;
const ptmName = (m: { type: string; description: string | null }) =>
  m.description?.split(';')[0] || PTM_TYPE_LABEL[m.type] || m.type;
const modificationSource: ProteinSource = {
  id: 'uniprot-ptm',
  label: 'UniProt',
  async load({ taxid, acc }) {
    const r = await fetch(`/api/organism/${taxid}/protein/${encodeURIComponent(acc)}/modifications`);
    if (r.status === 404) return null;
    if (!r.ok) throw new Error('modifications fetch failed');
    const data = (await r.json()) as ProteinModifications | null;
    if (!data?.modifications?.length) return null;
    const spans: FeatureSpan[] = data.modifications.map((m, i) => {
      const bond = isPtmBond(m.type, m.begin, m.end);
      const name = ptmName(m);
      return {
        key: `mod-${i}`,
        segments: bond
          ? [
              [m.begin, m.begin],
              [m.end, m.end],
            ]
          : [[m.begin, m.end]],
        label: name,
        title: bond
          ? `${m.begin}↔${m.end} · ${name}`
          : `${m.begin}${m.end > m.begin ? `–${m.end}` : ''} · ${name}`,
        colorIndex: i,
        color: MOD_COLOR,
      };
    });
    return {
      spans,
      length: data.length,
      source: 'UniProt (PTMs)',
      Table: (props) => <ModificationTable modifications={data.modifications} {...props} />,
    };
  },
};

// --- Tracks (stacked, in order) ------------------------------------------------
// Three tracks; two offer a source switch. Defaults are the first source of each
// (TED, CDD, MobiDB).
const TRACKS: ProteinTrack[] = [
  { id: 'domains', label: 'Domains', sources: [tedSource, interproSource], info: SOURCE_INFO.track_domains },
  { id: 'motifs', label: 'Motifs', sources: [cddSource], info: SOURCE_INFO.track_motifs },
  { id: 'disorder', label: 'IDRs', sources: [mobidbSource, plddtSource], info: SOURCE_INFO.track_idrs },
  { id: 'variants', label: 'Variants', sources: [variantSource], info: SOURCE_INFO.track_variants },
  { id: 'modifications', label: 'Modifications', sources: [modificationSource], info: SOURCE_INFO.track_modifications },
];

const defaultSources = (): Record<string, string> =>
  Object.fromEntries(TRACKS.map((t) => [t.id, t.sources[0].id]));

type Status = 'loading' | 'ok' | 'empty' | 'error';
interface TrackState {
  status: Status;
  track: LoadedTrack | null;
}
const LOADING: TrackState = { status: 'loading', track: null };
const EMPTY: TrackState = { status: 'empty', track: null };

// AlphaFold's standard per-residue pLDDT colour scale (highest band first).
const PLDDT_SCALE = [
  { min: 90, color: '#0053D6' }, // very high
  { min: 70, color: '#65CBF3' }, // confident
  { min: 50, color: '#FFDB13' }, // low
  { min: 0, color: '#FF7D45' }, // very low
];
const plddtColor = (v: number) => (PLDDT_SCALE.find((b) => v >= b.min) ?? PLDDT_SCALE[3]).color;
// A region is "very low" when its mean is <50, else "low" — one verdict (and one
// colour) per region, by its average score.
const regionSevere = (r: PlddtRegion) => r.mean < 50;
const regionColor = (r: PlddtRegion) => plddtColor(r.mean);

interface PlddtRegion {
  start: number;
  end: number;
  mean: number;
}

// Map per-residue pLDDT (B-factor) into: a full-length colour heatmap (`gradient`, for
// the track only) and the distinct continuous regions scoring < 70 (`spans`). A region
// is a maximal run of consecutive residues below 70 — not split at the 50 boundary — so
// there are a few clean regions, each coloured by its average score.
function buildPlddtTrack(plddt: Array<number | undefined>): LoadedTrack | null {
  const n = plddt.length;

  // Run-length-encode the per-residue colours into heatmap segments.
  const gradient: GradientRun[] = [];
  for (let r = 1; r < n; r++) {
    const v = plddt[r];
    if (v === undefined) continue;
    const c = plddtColor(v);
    const last = gradient[gradient.length - 1];
    if (last && last.color === c && last.end === r - 1) last.end = r;
    else gradient.push({ start: r, end: r, color: c });
  }
  if (gradient.length === 0) return null; // no pLDDT at all → nothing to show

  // Distinct continuous regions below 70.
  const regions: PlddtRegion[] = [];
  let cur: { start: number; end: number; sum: number; count: number } | null = null;
  const flush = () => {
    if (cur) regions.push({ start: cur.start, end: cur.end, mean: cur.sum / cur.count });
    cur = null;
  };
  for (let r = 1; r < n; r++) {
    const v = plddt[r];
    if (v === undefined || v >= 70) {
      flush();
      continue;
    }
    if (cur && cur.end === r - 1) {
      cur.end = r;
      cur.sum += v;
      cur.count += 1;
    } else {
      flush();
      cur = { start: r, end: r, sum: v, count: 1 };
    }
  }
  flush();

  const spans: FeatureSpan[] = regions.map((r, i) => ({
    key: `plddt-${i}`,
    segments: [[r.start, r.end]],
    label: null,
    title: `Low pLDDT ${r.start}–${r.end} · mean ${Math.round(r.mean)}`,
    colorIndex: i,
    color: regionColor(r), // one colour per region (by mean) for seq + 3D fill
  }));
  return {
    spans,
    length: n - 1,
    source: 'pLDDT from the AlphaFold model (B-factor); regions = continuous runs < 70',
    gradient,
    Table: (props) => <PlddtTable regions={regions} {...props} />,
  };
}

function TrackPlaceholder({ children }: { children: React.ReactNode }) {
  return <div className="py-6 text-center text-xs italic text-neutral-400">{children}</div>;
}

// A small uppercase section label (SEQUENCE / STRUCTURE / FEATURES), styled to match
// the info field titles on the left.
function SectionLabel({ className = '', children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={`text-xs uppercase tracking-wide text-neutral-500 ${className}`}>{children}</div>
  );
}

// Combined complexes field — one row per Complex Portal complex this protein is in, with the
// curated quaternary state, the (linked) complex name, and its composition types.
// Composition-type tags follow the central-dogma colour scheme (DNA green, RNA blue,
// protein purple); ligands stay amber (outside the dogma).
const CLASS_TAG: Record<string, string> = {
  DNA: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  RNA: 'bg-sky-50 text-sky-800 dark:bg-sky-950 dark:text-sky-300',
  protein: 'bg-violet-50 text-violet-800 dark:bg-violet-950 dark:text-violet-300',
  ligand: 'bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
};
// The combined complexes table also drives the structure viewer: clicking a row that has a 3D
// structure (the AlphaFold monomer, or a complex with a PDB assembly) shows it. `selected` is
// the active state ('' = monomer, else the complex ac); the active row is highlighted.
export function ComplexTable({
  complexes, acc, hasMonomer, selected, onSelect,
  monomerName = 'AlphaFold', monomerLink, monomerClass = 'protein',
}: { complexes: ProteinComplexes | null; acc: string | null; hasMonomer: boolean; selected: string; onSelect: (ac: string) => void; monomerName?: string; monomerLink?: string | null; monomerClass?: string }) {
  // Every state is selectable; the viewer shows the structure when it exists, else a placeholder.
  const rows = [
    { key: 'monomer', ac: '', state: 'Monomer', name: monomerName, classes: [monomerClass], link: monomerLink ?? (acc ? `https://alphafold.ebi.ac.uk/entry/${acc}` : null), title: hasMonomer ? `${monomerName} structure` : 'no structure', selectable: true },
    ...(complexes ?? []).map((c) => ({ key: c.ac, ac: c.ac, state: c.assembly ?? '—', name: c.name, classes: c.classes, link: c.link, title: `${c.ac}${c.pdbId ? ` · PDB ${c.pdbId}` : ' · no structure'}`, selectable: true })),
  ];
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-left text-[10px] uppercase tracking-wide text-neutral-400">
          <th className="pr-2 font-medium">#</th>
          <th className="pr-3 font-medium">state</th>
          <th className="pr-3 font-medium">name</th>
          <th className="font-medium">type</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => {
          const active = r.selectable && selected === r.ac;
          return (
            <tr
              key={r.key}
              onClick={r.selectable ? () => onSelect(r.ac) : undefined}
              title={r.selectable ? 'show this structure' : undefined}
              className={
                'border-t border-neutral-100 align-top ' +
                (active ? 'bg-neutral-100' : r.selectable ? 'cursor-pointer hover:bg-neutral-50' : '')
              }
            >
              <td className={`py-0.5 pr-2 tabular-nums ${active ? 'font-medium text-neutral-800' : 'text-neutral-400'}`}>{i + 1}</td>
              <td className="py-0.5 pr-3 text-neutral-700">{r.state === '—' ? <span className="text-neutral-400">—</span> : r.state}</td>
              <td className="py-0.5 pr-3">
                {r.link ? (
                  <a href={r.link} target="_blank" rel="noreferrer" title={r.title} onClick={(e) => e.stopPropagation()} className="underline decoration-neutral-300 hover:decoration-neutral-700">{r.name}</a>
                ) : (
                  <span title={r.title}>{r.name}</span>
                )}
              </td>
              <td className="py-0.5">
                <span className="flex flex-wrap gap-0.5">
                  {r.classes.map((k) => (
                    <span key={k} className={`rounded px-1 py-px text-[10px] ${CLASS_TAG[k] ?? 'bg-neutral-100 text-neutral-600'}`}>{k}</span>
                  ))}
                </span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// interactions field — IntAct physical interactors as a plain chip list. Partners that are also
// a co-member of one of this protein's Complex Portal complexes are highlighted (violet), so a
// stable complex partner stands out from a transient interactor.
function ProteinInteractions({ interactions, complexes, chrom }: { interactions: Interactions | null | undefined; complexes: ProteinComplexes | null; chrom: string }) {
  const { taxid } = useParams<{ taxid: string }>();
  if (interactions === undefined) return <span className="text-xs text-neutral-400">loading…</span>;
  const intact = (interactions?.partners ?? []).filter((p) => p.db === 'IntAct');
  if (intact.length === 0) return <FieldNoData />;
  // uniqID → a complex this protein shares with that partner (for highlight + tooltip).
  const inComplex = new Map<string, string>();
  for (const c of complexes ?? []) for (const m of c.members) if (m.uniqID && !inComplex.has(m.uniqID)) inComplex.set(m.uniqID, c.name);
  const partners = [...intact].sort((a, b) => Number(!!(b.uniqID && inComplex.has(b.uniqID))) - Number(!!(a.uniqID && inComplex.has(a.uniqID))));
  const anyComplex = partners.some((p) => p.uniqID && inComplex.has(p.uniqID));
  return (
    <div className="space-y-1">
      <ul className="flex flex-wrap gap-1">
        {partners.map((p, i) => {
          const cx = p.uniqID ? inComplex.get(p.uniqID) : undefined;
          const title = [cx ? `complex: ${cx}` : null, p.method, p.evidence ? `${p.evidence} record${p.evidence > 1 ? 's' : ''}` : null].filter(Boolean).join(' · ');
          const cls = `rounded px-1.5 py-0.5 text-xs ${cx ? 'bg-violet-100 text-violet-900' : 'bg-neutral-100 text-neutral-700'}`;
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
      {anyComplex && (
        <div className="flex items-center gap-1 text-[10px] text-neutral-400">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-violet-100" /> shares a complex
        </div>
      )}
    </div>
  );
}

// One contact track: a label + a bar over the subunit's residue axis with contact residues
// drawn as boxes (like the monomer motif track). Hovering emphasises that kind in the 3D model.
function ContactTrack({ label, color, length, regions, dim, onHover, onLeave }: { label: string; color: string; length: number; regions: Array<[number, number]>; dim: boolean; onHover: () => void; onLeave: () => void }) {
  const pct = (x: number) => `${(x / Math.max(length, 1)) * 100}%`;
  const n = regions.reduce((acc, [a, b]) => acc + (b - a + 1), 0);
  return (
    <div
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
      className={'flex items-stretch gap-2 rounded transition-opacity hover:bg-neutral-100 ' + (dim ? 'opacity-30' : '')}
    >
      <div className="w-16 shrink-0 self-center truncate text-right text-[10px] leading-none text-neutral-400" title={`${label}: ${n} residues`}>{label}</div>
      <div className="relative h-3.5 flex-1">
        <div className="absolute inset-0 bg-neutral-200" />
        {regions.map(([a, b], i) => (
          <div key={i} className="absolute inset-y-0" style={{ left: pct(a - 1), width: pct(b - a + 1), backgroundColor: color }} />
        ))}
      </div>
    </div>
  );
}

// A subunit section: header (selectable, links to the gene) + its protein / nucleic / ligand
// contact tracks (only the kinds with contacts are shown).
export function SubunitSection({
  name, uniqID, chrom, chain, color, length, contacts, active, faded, activeKind, onHover, onLeave, onClick, onEmphasis,
}: {
  name: string;
  uniqID: string | null;
  chrom: string;
  chain: string;
  color: string;
  length: number;
  contacts?: ChainContacts;
  active: boolean;
  faded: boolean; // dim the whole section (another subunit/track is emphasised)
  activeKind: 'protein' | 'nucleic' | 'ligand' | null; // the emphasised kind within this section
  onHover: () => void;
  onLeave: () => void;
  onClick: () => void;
  onEmphasis: (e: { chain: string; kind: 'protein' | 'nucleic' | 'ligand'; color: string } | null) => void;
}) {
  const { taxid } = useParams<{ taxid: string }>();
  const kinds: Array<{ label: 'protein' | 'nucleic' | 'ligand'; color: string; regions: Array<[number, number]> }> = contacts
    ? [
        { label: 'protein' as const, color, regions: contacts.protein },
        { label: 'nucleic' as const, color: NUCLEIC_CONTACT_COLOR, regions: contacts.nucleic },
        { label: 'ligand' as const, color: LIGAND_CONTACT_COLOR, regions: contacts.ligand },
      ].filter((k) => k.regions.length > 0)
    : [];
  return (
    <div
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
      onClick={onClick}
      className={'cursor-pointer rounded px-1 py-0.5 transition-all ' + (active ? 'bg-neutral-100 ring-1 ring-inset ring-neutral-300 ' : 'hover:bg-neutral-50 ') + (faded ? 'opacity-40' : '')}
    >
      <div className="mb-0.5 flex items-center gap-1.5 text-[11px]">
        <span className="inline-block h-3 w-3 shrink-0" style={{ background: color }} />
        {uniqID ? (
          <Link to={`/o/${taxid}/c/${encodeURIComponent(chrom)}/entry/${uniqID}`} onClick={(e) => e.stopPropagation()} className="truncate underline decoration-neutral-300 hover:decoration-neutral-700">{name}</Link>
        ) : (
          <span className="truncate" title={name}>{name}</span>
        )}
      </div>
      {!contacts ? (
        <div className="ml-16 text-[10px] italic text-neutral-300">computing contacts…</div>
      ) : kinds.length === 0 ? (
        <div className="ml-16 text-[10px] italic text-neutral-300">no contacts</div>
      ) : (
        <div>
          {kinds.map((k) => (
            <ContactTrack
              key={k.label}
              label={k.label}
              color={k.color}
              length={length}
              regions={k.regions}
              dim={activeKind !== null && k.label !== activeKind}
              onHover={() => onEmphasis({ chain, kind: k.label, color: k.color })}
              onLeave={() => onEmphasis(null)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// Subunit detail table (complex mode): one row per chain, colour-swatched, with its interface
// residues. Mirrors the monomer feature tables' hover/pin styling; row hover/click drives the 3D.
export function SubunitTable({
  subunits, colors, ligands, ligandColor, contactsByChain, chainMap, chrom, selected, onHover, onToggle,
}: {
  subunits: Subunit[];
  colors: DomainColor[];
  ligands: Ligand[];
  ligandColor: Map<string, string>;
  contactsByChain: Record<string, ChainContacts>;
  chainMap: ComplexChainMap;
  chrom: string;
  selected: string | null;
  onHover: (c: string | null) => void;
  onToggle: (c: string) => void;
}) {
  const { taxid } = useParams<{ taxid: string }>();
  const count = (rs: Array<[number, number]>) => rs.reduce((n, [a, b]) => n + (b - a + 1), 0);
  // Compact contact summary: protein·nucleic·ligand residue counts (omit zero kinds).
  const contactSummary = (c?: ChainContacts) => {
    if (!c) return null;
    const parts = [
      c.protein.length ? `${count(c.protein)}p` : '',
      c.nucleic.length ? `${count(c.nucleic)}n` : '',
      c.ligand.length ? `${count(c.ligand)}l` : '',
    ].filter(Boolean);
    return parts.length ? parts.join(' · ') : 'none';
  };
  return (
    <TableScroller>
      <table className="w-full text-xs [&_td]:align-top">
        <thead>
          <tr className="border-b border-neutral-200 text-left text-neutral-500">
            <th className="w-12 py-1 pr-3 font-medium">chain</th>
            <th className="py-1 pr-3 font-medium">subunit</th>
            <th className="w-24 py-1 font-medium">contacts</th>
          </tr>
        </thead>
        <tbody>
          {subunits.map((s, i) => {
            const sel = selected === s.chain;
            const dim = selected !== null && !sel;
            const summary = contactSummary(contactsByChain[s.chain]);
            const mapped = chainMap[s.chain];
            // Prefer the resolved gene name (linked) over the structure's entity description.
            const name = mapped?.gene || s.label;
            return (
              <tr
                key={s.chain}
                onMouseEnter={() => onHover(s.chain)}
                onMouseLeave={() => onHover(null)}
                onClick={() => onToggle(s.chain)}
                className={'cursor-pointer border-b border-neutral-100 transition-colors ' + (sel ? 'bg-neutral-100' : 'hover:bg-neutral-50')}
                style={{ opacity: dim ? 0.5 : 1 }}
              >
                <td className="w-12 py-1 pr-3 whitespace-nowrap">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="inline-block h-3 w-3 shrink-0" style={{ background: colors[i]?.color }} />
                    <span className="font-mono">{s.chain}</span>
                  </span>
                </td>
                <td className="py-1 pr-3">
                  {mapped?.uniqID ? (
                    <Link to={`/o/${taxid}/c/${encodeURIComponent(chrom)}/entry/${mapped.uniqID}`} title={s.label} onClick={(e) => e.stopPropagation()} className="inline-block max-w-[14rem] truncate align-bottom underline decoration-neutral-300 hover:decoration-neutral-700">{name}</Link>
                  ) : (
                    <span title={s.label} className="inline-block max-w-[14rem] truncate align-bottom">{name}</span>
                  )}
                </td>
                <td className="w-24 py-1 whitespace-nowrap text-neutral-600">
                  {summary === null ? <span className="text-neutral-400">—</span> : summary === 'none' ? <span className="text-neutral-400">none</span> : summary}
                </td>
              </tr>
            );
          })}
          {/* Bound ligands — selectable rows that highlight every copy in 3D. */}
          {ligands.map((l) => {
            const id = `lig:${l.comp}`;
            const sel = selected === id;
            const dim = selected !== null && !sel;
            return (
              <tr
                key={id}
                onMouseEnter={() => onHover(id)}
                onMouseLeave={() => onHover(null)}
                onClick={() => onToggle(id)}
                className={'cursor-pointer border-b border-neutral-100 transition-colors ' + (sel ? 'bg-neutral-100' : 'hover:bg-neutral-50')}
                style={{ opacity: dim ? 0.5 : 1 }}
              >
                <td className="w-12 py-1 pr-3 whitespace-nowrap">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="inline-block h-3 w-3 shrink-0" style={{ background: ligandColor.get(l.comp) }} />
                    <span className="text-[10px] uppercase tracking-wide text-neutral-400">lig</span>
                  </span>
                </td>
                <td className="py-1 pr-3"><span className="font-mono">{l.comp}</span></td>
                <td className="w-24 py-1 whitespace-nowrap text-neutral-600">×{l.count}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </TableScroller>
  );
}

// Glue the last two words with a non-breaking space so a wrapped name never leaves a
// single word stranded on its own line.
function avoidWidow(s: string): string {
  const i = s.lastIndexOf(' ');
  return i === -1 ? s : `${s.slice(0, i)} ${s.slice(i + 1)}`;
}

// Pick a "nice" ruler step (~5 ticks) for a protein of `length` residues.
function niceStep(length: number): number {
  const rough = length / 5;
  const pow = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / pow;
  const nice = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
  return Math.max(1, nice * pow);
}

// The protein-level entry panel: one shared bordered section with protein info +
// sequence on the left and the interactive structure/feature viewer on the right.
// Category + active-track + hover state is owned here so the left-column sequence
// stays in sync with the right-column 3D model and stacked tracks.
export function ProteinPanel({
  feature,
  taxid,
  carried = null,
  onRegion,
}: {
  feature: Feature;
  taxid: string;
  carried?: { segments: Array<[number, number]>; color: string } | null;
  onRegion?: (segments: Array<[number, number]> | null, color: string | null) => void;
}) {
  const acc = feature.UniProtID;
  const entryActive = useEntryActive(); // gate the WebGL viewer to the on-screen entry (pool keep-alive)
  // Per-track active source (e.g. domains: 'ted' | 'interpro').
  const [sourceByTrack, setSourceByTrack] = useState<Record<string, string>>(defaultSources);
  const [activeTrackId, setActiveTrackId] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, TrackState>>({});
  const [hovered, setHovered] = useState<string | null>(null);
  // A clicked table row pins the selection so the highlight persists after the mouse
  // leaves; the effective highlight is the transient hover or, failing that, the pin.
  const [locked, setLocked] = useState<string | null>(null);
  const [hasStructure, setHasStructure] = useState(false);
  const [plddt, setPlddt] = useState<Array<number | undefined> | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [hoveredResidue, setHoveredResidue] = useState<number | null>(null);
  const [complexes, setComplexes] = useState<ProteinComplexes | null>(null);
  const [interactions, setInteractions] = useState<Interactions | null | undefined>(undefined);
  // Structure-viewer state toggle: null = default, '' = AlphaFold monomer, 'CPX-…' = that
  // complex's experimental PDB assembly.
  const [activeComplex, setActiveComplex] = useState<string | null>(null);
  // Subunit mode (when a complex structure is shown): chains emitted by the viewer, the selected
  // subunit (hover/pin) that drives the 3D highlight, and its lazily-computed interface residues.
  const [subunits, setSubunits] = useState<Subunit[]>([]);
  const [subHover, setSubHover] = useState<string | null>(null);
  const [subLock, setSubLock] = useState<string | null>(null);
  const [contactsByChain, setContactsByChain] = useState<Record<string, ChainContacts>>({});
  const [contactEmphasis, setContactEmphasis] = useState<{ chain: string; kind: 'protein' | 'nucleic' | 'ligand'; color: string } | null>(null);
  const [ligands, setLigands] = useState<Ligand[]>([]);
  const [chainMap, setChainMap] = useState<ComplexChainMap>({});
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Measured pixel width of the track bar, so a box can hide its label when the text
  // wouldn't fit (responsive — the column width varies).
  const barRef = useRef<HTMLDivElement>(null);
  const [barPx, setBarPx] = useState(0);
  useLayoutEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const measure = () => setBarPx(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [acc]);
  const structureUrl = acc ? `/api/organism/${taxid}/protein/${encodeURIComponent(acc)}/structure` : '';

  // Complex states with an experimental PDB structure → the structure-viewer toggle. Selecting
  // one swaps the 3D model to that complex's assembly; '' / default shows the AlphaFold monomer.
  const complexStates = useMemo(() => (complexes ?? []).filter((c) => c.pdbId), [complexes]);
  // Default state: the monomer when it has a structure, else the first complex that does.
  const selectedComplex = activeComplex ?? (hasStructure ? '' : complexStates[0]?.ac ?? '');
  // The active complex may be one WITHOUT a PDB structure (selectable in the table) — then the
  // viewer shows a placeholder rather than silently falling back to the monomer model.
  const activeCx = (complexes ?? []).find((c) => c.ac === selectedComplex) ?? null;
  const viewerUrl = activeCx?.pdbId ? `/api/organism/${taxid}/protein/complex-structure/${activeCx.pdbId}` : structureUrl;
  const structureAvailable = activeCx ? !!activeCx.pdbId : hasStructure;
  // Subunit mode is on when a complex assembly is shown; one palette colour per chain, the
  // effective selection = live hover or the pinned subunit.
  const subunitMode = !!activeCx?.pdbId;
  const selectedSubunit = subHover ?? subLock;
  // Group chains into unique subunits (by gene, else entity name) — one palette colour and one
  // feature track per unique subunit; homo-oligomer copies share a colour.
  const uniqueSubunits = useMemo(() => {
    const map = new Map<string, { key: string; label: string; gene: string | null; uniqID: string | null; chains: string[]; length: number; colorIndex: number }>();
    for (const s of subunits) {
      const m = chainMap[s.chain];
      const key = m?.gene || s.label || s.chain;
      let e = map.get(key);
      if (!e) { e = { key, label: s.label, gene: m?.gene ?? null, uniqID: m?.uniqID ?? null, chains: [], length: 0, colorIndex: map.size }; map.set(key, e); }
      e.chains.push(s.chain);
      e.length = Math.max(e.length, s.length);
    }
    return [...map.values()];
  }, [subunits, chainMap]);
  const chainColor = useMemo(() => {
    const m = new Map<string, string>();
    uniqueSubunits.forEach((u) => u.chains.forEach((c) => m.set(c, paletteHex(u.colorIndex))));
    return m;
  }, [uniqueSubunits]);
  const subunitColors = useMemo<DomainColor[]>(
    () => subunits.map((s) => ({ id: s.chain, chain: s.chain, color: chainColor.get(s.chain) ?? paletteHex(0), label: s.label, segments: [] })),
    [subunits, chainColor]
  );
  // Ligands get palette colours continuing after the subunits; coloured + highlightable in 3D.
  const ligandColor = useMemo(() => {
    const m = new Map<string, string>();
    ligands.forEach((l, i) => m.set(l.comp, paletteHex(uniqueSubunits.length + i)));
    return m;
  }, [ligands, uniqueSubunits.length]);
  const viewerDomains = useMemo<DomainColor[]>(
    () => [
      ...subunitColors,
      ...ligands.map((l) => ({ id: `lig:${l.comp}`, comp: l.comp, color: ligandColor.get(l.comp) ?? '#b45309', label: l.comp, segments: [] })),
    ],
    [subunitColors, ligands, ligandColor]
  );
  // Interface ranges to precompute for the tracks: one representative chain per unique subunit,
  // capped so a huge assembly doesn't compute dozens of interfaces at once.
  const interfaceChainsToCompute = useMemo(() => uniqueSubunits.slice(0, 24).map((u) => u.chains[0]), [uniqueSubunits]);
  // Reset subunit state whenever the shown structure changes.
  useEffect(() => {
    setSubunits([]); setSubHover(null); setSubLock(null); setContactsByChain({}); setContactEmphasis(null); setLigands([]);
  }, [viewerUrl]);
  // PDBe SIFTS chain → gene/uniqID for the active complex, so subunits show gene names + links.
  useEffect(() => {
    const pdb = activeCx?.pdbId;
    if (!pdb) { setChainMap({}); return; }
    let cancelled = false;
    fetch(`/api/organism/${taxid}/protein/complex-chains/${pdb}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => !cancelled && setChainMap(d ?? {}))
      .catch(() => {});
    return () => { cancelled = true; };
  }, [activeCx?.pdbId, taxid]);

  const activeSource = (t: ProteinTrack) =>
    t.sources.find((s) => s.id === sourceByTrack[t.id]) ?? t.sources[0];

  // Reset to defaults when the protein changes (panels stay mounted across level switches,
  // so this only fires on a genuinely new entry — not on switching levels).
  useEffect(() => {
    setSourceByTrack(defaultSources());
    setActiveTrackId(null);
    setHovered(null);
    setLocked(null);
    setActiveComplex(null);
  }, [acc]);

  // Load each track's active (fetch-backed) source. Re-runs when the protein or a
  // source selection changes; pLDDT-derived sources are resolved in stateFor.
  useEffect(() => {
    if (!acc) {
      setResults({});
      return;
    }
    let cancelled = false;
    const jobs = TRACKS.map((t) => ({ t, src: activeSource(t) })).filter(({ src }) => src.load);
    setResults((prev) => {
      const next = { ...prev };
      for (const { t } of jobs) next[t.id] = LOADING;
      return next;
    });
    Promise.all(
      jobs.map(({ t, src }) =>
        src
          .load!({ taxid, acc, feature })
          .then((track) => ({ id: t.id, state: { status: (track ? 'ok' : 'empty') as Status, track } }))
          .catch(() => ({ id: t.id, state: { status: 'error' as Status, track: null } }))
      )
    ).then((rs) => {
      if (cancelled) return;
      setResults((prev) => {
        const next = { ...prev };
        rs.forEach((r) => (next[r.id] = r.state));
        return next;
      });
      setActiveTrackId((cur) => cur ?? rs.find((r) => r.state.status === 'ok')?.id ?? TRACKS[0].id);
    });
    return () => {
      cancelled = true;
    };
    // `feature`/`activeSource` are stable for a given acc + sourceByTrack.
  }, [acc, taxid, sourceByTrack]);

  // Probe whether a local structure exists before mounting the heavy 3D viewer.
  useEffect(() => {
    if (!acc) {
      setHasStructure(false);
      return;
    }
    let cancelled = false;
    setHasStructure(false);
    setPlddt(null);
    fetch(structureUrl, { method: 'HEAD' })
      .then((r) => {
        if (!cancelled) setHasStructure(r.ok);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [acc, structureUrl]);

  // Complex Portal membership → STATE (assembly) + COMPLEX (composition) info fields.
  useEffect(() => {
    if (!acc) { setComplexes(null); return; }
    let cancelled = false;
    setComplexes(null);
    fetch(`/api/organism/${taxid}/protein/${encodeURIComponent(acc)}/complexes`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => !cancelled && setComplexes(d))
      .catch(() => {});
    return () => { cancelled = true; };
  }, [acc, taxid]);

  // Molecular interactions (IntAct partners) for the interactions field.
  useEffect(() => {
    let cancelled = false;
    setInteractions(undefined);
    fetch(`/api/organism/${taxid}/features/${encodeURIComponent(feature.uniqID)}/interactions`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => !cancelled && setInteractions(d))
      .catch(() => !cancelled && setInteractions(null));
    return () => { cancelled = true; };
  }, [feature.uniqID, taxid]);

  // Low-pLDDT regions are derived from the structure, not fetched.
  const plddtTrack = useMemo(() => (plddt ? buildPlddtTrack(plddt) : null), [plddt]);

  // Resolve a track to its current state (fetch result of its active source, or the
  // pLDDT-derived track).
  const stateFor = (t: ProteinTrack): TrackState => {
    if (activeSource(t).fromPlddt) {
      if (!hasStructure) return EMPTY;
      if (!plddt) return LOADING;
      return plddtTrack ? { status: 'ok', track: plddtTrack } : EMPTY;
    }
    return results[t.id] ?? LOADING;
  };

  const trackStates = TRACKS.map((t) => ({ track: t, state: stateFor(t) }));
  const activeTrackDef = TRACKS.find((t) => t.id === activeTrackId) ?? null;
  const activeState = activeTrackDef ? stateFor(activeTrackDef) : EMPTY;
  const activeLoaded = activeState.status === 'ok' ? activeState.track : null;
  const spans = activeLoaded?.spans ?? [];

  // Shared coordinate scale across every track (one protein → one axis).
  const length = useMemo(() => {
    if (feature.prot_len) return feature.prot_len;
    const spanEnds = trackStates.flatMap((ts) =>
      (ts.state.track?.spans ?? []).flatMap((s) => s.segments.map((seg) => seg[1]))
    );
    const trackLens = trackStates.map((ts) => ts.state.track?.length ?? 0);
    return Math.max(1, ...spanEnds, ...trackLens);
    // trackStates is derived from these; recompute when any track data or selection changes.
  }, [feature.prot_len, results, plddtTrack, hasStructure, activeTrackId, sourceByTrack]);

  // Unified 3D-hover label for a feature residue: the feature's own name (TED01,
  // IPR…, a CDD site description) or a positional "region N" for unnamed regions
  // (disorder, pLDDT) — numbered like their detail tables. Mol* shows "GLU 298 · <this>".
  const spanColors = spans.map((s, i) => ({
    id: s.key,
    segments: s.segments,
    color: spanHex(s),
    label: s.label ?? `region ${i + 1}`,
  }));
  // For a heatmap track (pLDDT), colour the whole 3D model by the per-residue map:
  // group the gradient runs by colour into full-coverage band segments. The regions
  // (spanColors) then drive only the hover highlight on top.
  const baseColors = useMemo(() => {
    const g = activeLoaded?.gradient;
    if (!g) return undefined;
    const byColor = new Map<string, Array<[number, number]>>();
    for (const run of g) {
      const segs = byColor.get(run.color) ?? [];
      segs.push([run.start, run.end]);
      byColor.set(run.color, segs);
    }
    return [...byColor].map(([color, segments]) => ({ id: `band-${color}`, segments, color }));
  }, [activeLoaded]);
  const pct = (x: number) => `${(x / length) * 100}%`;
  // Effective highlight: live hover wins, else the pinned (clicked) selection.
  const selected = hovered ?? locked;
  const toggleLock = (key: string) => setLocked((cur) => (cur === key ? null : key));
  const dimmed = (key: string) => selected !== null && selected !== key;

  // Carry the pinned span's residue region up to the entry page → propagates (×3) to the
  // RNA and DNA levels. `spans` is stable for a given track; null-emit is a no-op.
  const onRegionRef = useRef(onRegion);
  onRegionRef.current = onRegion;
  useEffect(() => {
    const s = locked ? spans.find((x) => x.key === locked) : null;
    onRegionRef.current?.(s ? s.segments : null, s ? spanHex(s) : null);
  }, [locked, spans]);

  // residueSpan[r] = index of the active span covering residue r (1-based), or -1.
  const residueSpan = new Array<number>(length + 1).fill(-1);
  spans.forEach((s, i) =>
    s.segments.forEach(([start, end]) => {
      for (let r = start; r <= end && r <= length; r++) residueSpan[r] = i;
    })
  );

  const copyText = (text: string, label: string) => {
    navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setCopied(label);
        clearTimeout(copiedTimer.current);
        copiedTimer.current = setTimeout(() => setCopied(null), 1500);
      })
      .catch(() => {});
  };
  // Clicking a span's residues copies that span's sequence (segments joined).
  const copySpan = (s: FeatureSpan) => {
    if (feature.prot_seq) {
      copyText(s.segments.map(([a, b]) => feature.prot_seq!.slice(a - 1, b)).join('-'), s.key);
    }
  };
  const copyFull = () => {
    if (feature.prot_seq) copyText(feature.prot_seq, 'full sequence');
  };

  // aa ruler: label the ends, then round ticks in between, dropping any within half a
  // step of an end so labels don't overlap.
  const step = niceStep(length);
  const minGap = step / 2;
  const ticks: number[] = [1];
  for (let t = step; t < length; t += step) {
    if (t - 1 >= minGap && length - t >= minGap) ticks.push(t);
  }
  ticks.push(length);

  const Table = activeLoaded?.Table;

  return (
    <Section title="Protein level" level="PROT">
      {/* TOP ZONE — name / id / size / expression / localisation (left) · annotations (right). */}
      <div className="grid grid-cols-1 gap-x-6 gap-y-2 lg:grid-cols-2 lg:items-start">
        <div className="space-y-2">
          <Field label="name" value={feature.product || <FieldNoData />} />
          <Field
            label="id"
            value={
              acc ? (
                <a
                  href={`https://www.uniprot.org/uniprotkb/${acc}`}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono underline decoration-neutral-300 hover:decoration-neutral-700"
                >
                  {acc}
                </a>
              ) : (
                <FieldNoData />
              )
            }
          />
          <Field
            label="length"
            value={feature.prot_len !== null ? `${feature.prot_len.toLocaleString()} aa` : <FieldNoData />}
          />
          <ExpressionBar taxid={taxid} uniqID={feature.uniqID} kind="protein" />
          <LocalisationField value={feature.localisation} compact />
        </div>
        <div className="space-y-2">
          <Field label="keywords" info={SOURCE_INFO.uniprot} value={<TagList tags={feature.UP_KW} source="UP" />} />
          <Field label="family" info={SOURCE_INFO.uniprot} value={<TagList tags={feature.UP_FM} source="UP" />} />
          <Field label="pathway" info={SOURCE_INFO.uniprot} value={<TagList tags={feature.UP_PW} source="UP" />} />
        </div>
      </div>

      {/* MIDDLE ZONE — reactions, full width (placeholder until ingested). */}
      <div className="space-y-1">
        <SectionLabel>Reactions</SectionLabel>
        <div className="flex h-16 items-center justify-center rounded border border-dashed border-neutral-300 bg-neutral-50 text-xs italic text-neutral-400">no data</div>
      </div>

      {/* BOTTOM ZONE — complexes / interactions / sequence (left) · structure + feature tracks/table (right). */}
      <div className="grid grid-cols-1 gap-x-6 gap-y-4 lg:grid-cols-2 lg:items-start">
        <div className="space-y-2">
          <Field label="complexes" info={SOURCE_INFO.complexes} value={<ComplexTable complexes={complexes} acc={acc} hasMonomer={hasStructure} selected={selectedComplex} onSelect={setActiveComplex} />} />
          <Field label="interactions" info={SOURCE_INFO.interactionsProtein} value={<ProteinInteractions interactions={interactions} complexes={complexes} chrom={feature.chrom} />} />
          {/* Protein sequence, residues highlighted by the active track's spans. Residues/line
              adjust to the box width; clicking a span's residues copies that span's sequence. */}
          {feature.prot_seq && (
            <div className="pt-1">
              <div className="mb-1 flex items-center justify-between">
                <SectionLabel className="inline-flex items-center gap-1.5">
                  Sequence
                  <button
                    type="button"
                    onClick={copyFull}
                    title="copy full sequence"
                    className="cursor-pointer text-neutral-400 hover:text-neutral-700"
                  >
                    <CopyIcon />
                  </button>
                </SectionLabel>
                {copied && <span className="text-xs text-neutral-400">copied {copied} ✓</span>}
              </div>
              <SequenceView
                seq={feature.prot_seq}
                tickInterval={20}
                residueSpan={residueSpan}
                highlights={spans.map((s) => ({ key: s.key, color: spanHex(s) }))}
                hovered={selected}
                hoveredResidue={hoveredResidue}
                onHover={setHovered}
                onCopy={(key) => {
                  const s = spans.find((x) => x.key === key);
                  if (s) copySpan(s);
                }}
                carried={carried}
              />
            </div>
          )}
        </div>

        {/* Right: structure + stacked feature tracks. */}
        <div className="space-y-4">
          {!acc ? (
            <TrackPlaceholder>no UniProt mapping for this entry</TrackPlaceholder>
          ) : (
            <>
              {/* STRUCTURE — AlphaFold 3D model, coloured by the active track +
                  hover-synced. Emits per-residue pLDDT for the low-pLDDT source. */}
              <div>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <SectionLabel>Structure</SectionLabel>
                  {complexes && complexes.length > 0 && (
                    <select
                      value={selectedComplex}
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
                {structureAvailable && !entryActive ? (
                <div className="flex h-72 items-center justify-center rounded border border-dashed border-neutral-200 bg-neutral-50 text-xs italic text-neutral-300">3D viewer paused — return to this gene to view</div>
              ) : structureAvailable ? (
                <Suspense
                  fallback={
                    <div className="flex h-72 items-center justify-center rounded bg-neutral-50 text-xs italic text-neutral-400">
                      loading 3D viewer…
                    </div>
                  }
                >
                  {/* Complex assemblies: subunit mode (colour by chain, interface residues);
                      monomer: residue-level domain/pLDDT overlays. */}
                  <MolstarViewer
                    structureUrl={viewerUrl}
                    domains={subunitMode ? viewerDomains : activeCx ? [] : spanColors}
                    baseColors={subunitMode || activeCx ? undefined : baseColors}
                    hovered={subunitMode ? selectedSubunit : activeCx ? null : selected}
                    onHover={subunitMode ? setSubHover : setHovered}
                    onHoverResidue={subunitMode || activeCx ? undefined : setHoveredResidue}
                    onPlddt={subunitMode || activeCx ? undefined : setPlddt}
                    onSubunits={subunitMode ? setSubunits : undefined}
                    onLigands={subunitMode ? setLigands : undefined}
                    interfaceChain={subunitMode ? selectedSubunit : null}
                    interfaceChains={subunitMode ? interfaceChainsToCompute : undefined}
                    onContacts={subunitMode ? (ch, c) => setContactsByChain((m) => ({ ...m, [ch]: c })) : undefined}
                    emphasis={subunitMode ? contactEmphasis : null}
                  />
                </Suspense>
              ) : (
                <div className="flex h-72 items-center justify-center rounded border border-dashed border-neutral-300 bg-neutral-50 text-xs italic text-neutral-400">
                  {activeCx ? 'no structure available for this complex' : 'no AlphaFold structure available'}
                </div>
                )}
                <p className="mt-1 truncate text-[11px] text-neutral-500">
                  {activeCx
                    ? <>{activeCx.pdbId ? <>PDB <span className="font-mono">{activeCx.pdbId}</span> · </> : null}{activeCx.name}{activeCx.assembly ? ` · ${activeCx.assembly}` : ''}</>
                    : hasStructure ? 'AlphaFold predicted monomer' : null}
                </p>
              </div>

              {subunitMode ? (
                /* SUBUNITS — one row per chain of the complex; hover/click highlights it in 3D
                   and emphasises its interface residues (computed lazily on selection). */
                <div>
                  <SectionLabel className="mb-1">Subunits</SectionLabel>
                  {subunits.length === 0 ? (
                    <div className="text-xs italic text-neutral-400">resolving subunits…</div>
                  ) : (
                    <>
                      {/* Per unique subunit: a section with protein / nucleic / ligand contact tracks. */}
                      <div className="mb-4 space-y-2">
                        {uniqueSubunits.map((u) => {
                          const rep = u.chains[0];
                          const isSel = selectedSubunit !== null && u.chains.includes(selectedSubunit);
                          // Mirror the 3D fade: when a track or subunit is active, the rest fade.
                          const faded = contactEmphasis ? contactEmphasis.chain !== rep : selectedSubunit !== null ? !isSel : false;
                          const activeKind = contactEmphasis && contactEmphasis.chain === rep ? contactEmphasis.kind : null;
                          return (
                            <SubunitSection
                              key={u.key}
                              name={u.gene || u.label}
                              uniqID={u.uniqID}
                              chrom={feature.chrom}
                              chain={rep}
                              color={paletteHex(u.colorIndex)}
                              length={u.length}
                              contacts={contactsByChain[rep]}
                              active={isSel}
                              faded={faded}
                              activeKind={activeKind}
                              onHover={() => setSubHover(rep)}
                              onLeave={() => { setSubHover(null); setContactEmphasis(null); }}
                              onClick={() => setSubLock((cur) => (cur === rep ? null : rep))}
                              onEmphasis={setContactEmphasis}
                            />
                          );
                        })}
                      </div>
                      <SubunitTable
                        subunits={subunits}
                        colors={subunitColors}
                        ligands={ligands}
                        ligandColor={ligandColor}
                        contactsByChain={contactsByChain}
                        chainMap={chainMap}
                        chrom={feature.chrom}
                        selected={selectedSubunit}
                        onHover={setSubHover}
                        onToggle={(c) => setSubLock((cur) => (cur === c ? null : c))}
                      />
                      <div className="mt-1 text-[10px] text-neutral-400">
                        contact residues (within 5 Å):{' '}
                        <span style={{ color: 'var(--color-neutral-600)' }}>protein</span> ·{' '}
                        <span style={{ color: NUCLEIC_CONTACT_COLOR }}>nucleic</span> ·{' '}
                        <span style={{ color: LIGAND_CONTACT_COLOR }}>ligand</span>
                      </div>
                    </>
                  )}
                </div>
              ) : activeCx ? (
                /* A complex is selected but has no structure — don't fall back to monomer
                   features (they don't describe the chosen state). */
                <div>
                  <SectionLabel className="mb-1">Subunits</SectionLabel>
                  <div className="text-xs italic text-neutral-400">no structure available for this complex</div>
                </div>
              ) : (
              <>
              {/* FEATURES — stacked tracks. Title sits left of the bar with a ▾ source
                  picker when >1 source; click a track to make it the active layer. */}
              <div>
                <SectionLabel className="mb-1">Features</SectionLabel>
                <div className="space-y-1">
                {trackStates.map(({ track, state }) => (
                  <TrackRow
                    key={track.id}
                    label={track.label}
                    info={track.info}
                    sources={track.sources}
                    sourceId={sourceByTrack[track.id]}
                    onSelectSource={(sid) =>
                      setSourceByTrack((m) => (m[track.id] === sid ? m : { ...m, [track.id]: sid }))
                    }
                    state={state}
                    active={track.id === activeTrackId}
                    length={length}
                    pct={pct}
                    pxPerResidue={barPx > 0 ? barPx / length : 0}
                    hovered={selected}
                    setHovered={setHovered}
                    onToggle={toggleLock}
                    onActivate={() => {
                      setActiveTrackId(track.id);
                      setHovered(null);
                      setLocked(null);
                    }}
                  />
                ))}
                {/* Shared aa ruler, aligned under the track bars. */}
                <div className="flex items-center gap-2 px-1">
                  <div className="w-22 shrink-0" />
                  <div ref={barRef} className="relative h-4 flex-1">
                    {ticks.map((t) => (
                      <div
                        key={t}
                        className="absolute top-0 -translate-x-1/2 text-[10px] text-neutral-400"
                        style={{ left: pct(t) }}
                      >
                        {t}
                      </div>
                    ))}
                  </div>
                </div>
                </div>
              </div>

              {/* Active track's detail table + provenance. */}
              {activeState.status === 'ok' && Table && (
                <TableScroller>
                  <Table
                    hovered={selected}
                    setHovered={setHovered}
                    onToggle={toggleLock}
                    colorOf={paletteHex}
                    dimmed={dimmed}
                  />
                </TableScroller>
              )}
              {activeState.status === 'ok' && activeLoaded?.source && (
                <div className="text-[10px] text-neutral-400">
                  {activeTrackDef?.label.toLowerCase()}: {activeLoaded.source}
                </div>
              )}
              </>
              )}
            </>
          )}
        </div>
      </div>
    </Section>
  );
}

// A small ▾ dropdown (advanced) to pick a track's data source (e.g. TED | InterPro).
// Sits just right of the track title; clicking it neither activates the track nor
// dismisses anything else until a source is chosen or the user clicks away.
function SourceMenu({
  sources,
  active,
  onSelect,
}: {
  sources: ProteinSource[];
  active: string;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  return (
    <span ref={ref} className="relative shrink-0" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        title="data source"
        onClick={() => setOpen((o) => !o)}
        className={
          'flex h-3.5 w-3.5 items-center justify-center rounded text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700 ' +
          (open ? 'bg-neutral-200 text-neutral-700' : '')
        }
      >
        <svg viewBox="0 0 8 8" width="7" height="7" aria-hidden>
          <path d="M1 2.5 L4 6 L7 2.5 Z" fill="currentColor" />
        </svg>
      </button>
      {open && (
        <div className="absolute left-0 top-full z-10 mt-0.5 min-w-[5rem] rounded border border-neutral-200 bg-white py-0.5 shadow-md">
          {sources.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => {
                onSelect(s.id);
                setOpen(false);
              }}
              className={
                'block w-full px-2 py-0.5 text-left text-[11px] ' +
                (s.id === active ? 'font-medium text-neutral-900' : 'text-neutral-600 hover:bg-neutral-100')
              }
            >
              {s.label}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

// One stacked track: a label gutter (with the ▾ source picker) + a bar of coloured
// spans along the aa axis. Only the active track wires hover into the shared state
// (mirrored by the sequence + 3D model); inactive tracks sit dimmed.
function TrackRow({
  label,
  info,
  sources,
  sourceId,
  onSelectSource,
  state,
  active,
  length,
  pct,
  pxPerResidue,
  hovered,
  setHovered,
  onToggle,
  onActivate,
}: {
  label: string;
  info?: string;
  sources: ProteinSource[];
  sourceId: string;
  onSelectSource: (id: string) => void;
  state: TrackState;
  active: boolean;
  length: number;
  pct: (x: number) => string;
  pxPerResidue: number;
  hovered: string | null;
  setHovered: (key: string | null) => void;
  onToggle: (key: string) => void;
  onActivate: () => void;
}) {
  const spans = state.status === 'ok' && state.track ? state.track.spans : [];
  const gradient = state.status === 'ok' ? state.track?.gradient : undefined;
  const translucent = state.status === 'ok' ? Boolean(state.track?.translucent) : false;
  const backdrops = state.status === 'ok' ? state.track?.backdrops : undefined;
  // Show a box's label only when the text actually fits its width (~6px/char at the
  // 10px label font). Falls back to a coarse fraction before the bar is measured.
  const labelFits = (text: string | null, residues: number) =>
    !!text &&
    (pxPerResidue ? residues * pxPerResidue >= text.length * 6 + 6 : residues / length > 0.08);
  const note =
    state.status === 'loading'
      ? 'loading…'
      : state.status === 'error'
        ? 'failed to load'
        : state.status === 'empty'
          ? 'no data'
          : gradient && spans.length === 0
            ? 'no regions < 70'
            : null;
  return (
    <div
      onClick={onActivate}
      className={
        'flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 transition-colors ' +
        (active ? 'bg-neutral-100 ring-1 ring-inset ring-neutral-300' : 'hover:bg-neutral-50')
      }
    >
      <div className="flex w-22 shrink-0 items-center gap-1">
        <span
          className={'truncate text-xs ' + (active ? 'font-medium text-neutral-800' : 'text-neutral-500')}
          title={label}
        >
          {label}
        </span>
        {sources.length > 1 && <SourceMenu sources={sources} active={sourceId} onSelect={onSelectSource} />}
        {info && <span className="ml-auto" onClick={(e) => e.stopPropagation()}><InfoTip text={info} /></span>}
      </div>
      <div className="relative h-6 flex-1">
        <div className="absolute inset-x-0 top-1 bottom-1 bg-neutral-200" />
        {note && (
          <div className="absolute inset-y-0 left-2 flex items-center text-[10px] italic text-neutral-400">
            {note}
          </div>
        )}

        {/* Faint context backdrops behind the spans (e.g. CDD domain envelopes). */}
        {backdrops?.map((b, i) =>
          b.segments.map(([start, end], j) => (
            <div
              key={`bd-${i}-${j}`}
              title={b.title}
              className="absolute top-1 bottom-1"
              style={{
                left: pct(start - 1),
                width: pct(end - start + 1),
                background: b.color,
                opacity: active ? 0.16 : 0.1,
              }}
            />
          ))
        )}

        {gradient ? (
          <>
            {/* Heatmap: full-length pLDDT colour map, kept faint. Fades further when a
                region is hovered so the highlighted region stands out. */}
            {gradient.map((g, i) => (
              <div
                key={`g-${i}`}
                className="absolute top-1 bottom-1 transition-opacity"
                style={{
                  left: pct(g.start - 1),
                  width: pct(g.end - g.start + 1),
                  background: mixWhite(g.color, 0.55),
                  opacity: active ? (hovered !== null ? 0.3 : 1) : 0.55,
                }}
              />
            ))}
            {/* Low regions as filled boxes; hovering brightens one + dims the rest
                (same logic as the domain track), no outline. */}
            {spans.map((s) =>
              s.segments.map(([start, end], j) => {
                const hot = active && hovered === s.key;
                const dim = active && hovered !== null && hovered !== s.key;
                return (
                  <div
                    key={`${s.key}-${j}`}
                    onMouseEnter={active ? () => setHovered(s.key) : undefined}
                    onMouseLeave={active ? () => setHovered(null) : undefined}
                    onClick={active ? (e) => { e.stopPropagation(); onToggle(s.key); } : undefined}
                    title={s.title}
                    className={'absolute top-1 bottom-1 transition-opacity ' + (active ? 'cursor-pointer' : '')}
                    style={{
                      left: pct(start - 1),
                      width: pct(end - start + 1),
                      background: mixWhite(spanHex(s), hot ? 0.15 : 0.45),
                      opacity: active ? (dim ? 0.3 : 1) : 0.55,
                    }}
                  />
                );
              })
            )}
          </>
        ) : (
          spans.map((s) =>
            s.segments.map(([start, end], j) => {
              const dim = active && hovered !== null && hovered !== s.key;
              // Translucent tracks (overlapping spans) draw semi-transparent so overlaps
              // show through; solid otherwise.
              const restOpacity = translucent ? 0.7 : 1;
              return (
                <div
                  key={`${s.key}-${j}`}
                  onMouseEnter={active ? () => setHovered(s.key) : undefined}
                  onMouseLeave={active ? () => setHovered(null) : undefined}
                  onClick={active ? (e) => { e.stopPropagation(); onToggle(s.key); } : undefined}
                  title={s.title}
                  className={'absolute top-1 bottom-1 flex items-center justify-center overflow-hidden text-[10px] font-medium text-[#fff] transition-opacity ' + (active ? 'cursor-pointer' : '')}
                  style={{
                    left: pct(start - 1),
                    width: pct(end - start + 1),
                    background: spanHex(s),
                    opacity: active ? (dim ? 0.25 : restOpacity) : translucent ? 0.45 : 0.55,
                  }}
                >
                  {labelFits(s.label, end - start + 1) && s.label}
                </div>
              );
            })
          )
        )}
      </div>
    </div>
  );
}

// TED domain detail table — the reference implementation of a track's detail view.
function DomainTable({
  domains,
  hovered,
  setHovered,
  onToggle,
  colorOf,
  dimmed,
}: { domains: ProteinDomains['domains'] } & TrackTableProps) {
  return (
    <table className="w-full text-xs [&_td]:align-top">
      <thead>
        <tr className="border-b border-neutral-200 text-left text-neutral-500">
          <th className="py-1 pr-6 font-medium">Domain</th>
          <th className="py-1 pr-4 font-medium">CATH family</th>
          <th className="py-1 pr-4 font-medium">Res</th>
          <th className="py-1 pr-4 font-medium">Len</th>
          <th className="py-1 font-medium">pLDDT</th>
        </tr>
      </thead>
      <tbody>
        {domains.map((d, i) => {
          const len = d.segments.reduce((acc2, [s, e]) => acc2 + (e - s + 1), 0);
          const ranges = d.segments.map(([s, e]) => `${s}–${e}`).join(', ');
          return (
            <tr
              key={d.id}
              onMouseEnter={() => setHovered(d.id)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => onToggle(d.id)}
              className={
                'cursor-pointer border-b border-neutral-100 transition-colors ' +
                (hovered === d.id ? 'bg-neutral-100' : 'hover:bg-neutral-50')
              }
            >
              <td className="py-1 pr-6">
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className="inline-block h-3 w-3"
                    style={{ background: colorOf(i), opacity: dimmed(d.id) ? 0.25 : 1 }}
                  />
                  <span className="font-mono">{d.id}</span>
                </span>
              </td>
              <td className="py-1 pr-4">
                {d.cath ? (
                  <a
                    href={`https://www.cathdb.info/version/latest/superfamily/${d.cath}`}
                    target="_blank"
                    rel="noreferrer"
                    title={d.cath}
                    className="underline decoration-neutral-300 hover:decoration-neutral-700"
                  >
                    {d.cathName ? avoidWidow(d.cathName) : <span className="font-mono">{d.cath}</span>}
                  </a>
                ) : (
                  <span className="text-neutral-400">—</span>
                )}
              </td>
              <td className="py-1 pr-4 font-mono whitespace-nowrap">{ranges}</td>
              <td className="py-1 pr-4">{len}</td>
              <td className="py-1">{d.plddt ?? '—'}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// InterPro representative domain detail table.
function InterproTable({
  domains,
  hovered,
  setHovered,
  onToggle,
  colorOf,
  dimmed,
}: { domains: ProteinInterproDomains['domains'] } & TrackTableProps) {
  return (
    <table className="w-full text-xs [&_td]:align-top">
      <thead>
        <tr className="border-b border-neutral-200 text-left text-neutral-500">
          <th className="py-1 pr-6 font-medium">Domain</th>
          <th className="py-1 pr-4 font-medium">Name</th>
          <th className="py-1 pr-4 font-medium">Res</th>
          <th className="py-1 font-medium">Len</th>
        </tr>
      </thead>
      <tbody>
        {domains.map((d, i) => {
          const key = `${d.id}#${i}`;
          const len = d.segments.reduce((acc2, [s, e]) => acc2 + (e - s + 1), 0);
          const ranges = d.segments.map(([s, e]) => `${s}–${e}`).join(', ');
          return (
            <tr
              key={key}
              onMouseEnter={() => setHovered(key)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => onToggle(key)}
              className={
                'cursor-pointer border-b border-neutral-100 transition-colors ' +
                (hovered === key ? 'bg-neutral-100' : 'hover:bg-neutral-50')
              }
            >
              <td className="py-1 pr-6">
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className="inline-block h-3 w-3"
                    style={{ background: colorOf(i), opacity: dimmed(key) ? 0.25 : 1 }}
                  />
                  <a
                    href={`https://www.ebi.ac.uk/interpro/entry/${d.db}/${d.id}/`}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono underline decoration-neutral-300 hover:decoration-neutral-700"
                  >
                    {d.id}
                  </a>
                </span>
              </td>
              <td className="py-1 pr-4">{d.name ? avoidWidow(d.name) : <span className="text-neutral-400">—</span>}</td>
              <td className="py-1 pr-4 font-mono whitespace-nowrap">{ranges}</td>
              <td className="py-1">{len}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// CDD conserved-residue motif detail table.
function CddTable({
  motifs,
  hovered,
  setHovered,
  onToggle,
  colorOf,
  dimmed,
}: { motifs: ProteinCddMotifs['motifs'] } & TrackTableProps) {
  const modelIdx = new Map<string, number>();
  motifs.forEach((m) => {
    if (!modelIdx.has(m.entry)) modelIdx.set(m.entry, modelIdx.size);
  });
  return (
    <table className="w-full table-fixed text-xs [&_td]:align-top">
      <colgroup>
        <col style={{ width: '40%' }} />
        <col style={{ width: '20%' }} />
        <col style={{ width: '30%' }} />
        <col style={{ width: '10%' }} />
      </colgroup>
      <thead>
        <tr className="border-b border-neutral-200 text-left text-neutral-500">
          <th className="py-1 pr-3 font-medium">Motif</th>
          <th className="py-1 pr-3 font-medium">Model</th>
          <th className="py-1 pr-3 font-medium">Res</th>
          <th className="py-1 font-medium">Len</th>
        </tr>
      </thead>
      <tbody>
        {motifs.map((m, i) => {
          const key = `cdd-${i}`;
          const len = m.segments.reduce((acc2, [s, e]) => acc2 + (e - s + 1), 0);
          const ranges = m.segments.map(([s, e]) => `${s}–${e}`).join(', ');
          return (
            <tr
              key={key}
              onMouseEnter={() => setHovered(key)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => onToggle(key)}
              className={
                'cursor-pointer border-b border-neutral-100 transition-colors ' +
                (hovered === key ? 'bg-neutral-100' : 'hover:bg-neutral-50')
              }
            >
              <td className="py-1 pr-3">
                <span className="flex items-start gap-1.5">
                  <span
                    className="mt-0.5 inline-block h-3 w-3 shrink-0"
                    style={{ background: colorOf(modelIdx.get(m.entry) ?? 0), opacity: dimmed(key) ? 0.25 : 1 }}
                  />
                  <span>{m.description}</span>
                </span>
              </td>
              <td className="py-1 pr-3">
                <a
                  href={`https://www.ebi.ac.uk/interpro/entry/cdd/${m.entry}/`}
                  target="_blank"
                  rel="noreferrer"
                  title={m.entryName ?? undefined}
                  className="font-mono underline decoration-neutral-300 hover:decoration-neutral-700"
                >
                  {m.entry}
                </a>
              </td>
              <td className="py-1 pr-3 font-mono break-words">{ranges}</td>
              <td className="py-1">{len}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// Disordered region detail table — one row per MobiDB-lite region.
function DisorderTable({
  regions,
  hovered,
  setHovered,
  onToggle,
  dimmed,
}: { regions: Array<[number, number]> } & TrackTableProps) {
  return (
    <table className="w-full text-xs [&_td]:align-top">
      <thead>
        <tr className="border-b border-neutral-200 text-left text-neutral-500">
          <th className="py-1 pr-6 font-medium">Region</th>
          <th className="py-1 pr-4 font-medium">Res</th>
          <th className="py-1 font-medium">Len</th>
        </tr>
      </thead>
      <tbody>
        {regions.map(([s, e], i) => {
          const key = `dis-${i}`;
          return (
            <tr
              key={key}
              onMouseEnter={() => setHovered(key)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => onToggle(key)}
              className={
                'cursor-pointer border-b border-neutral-100 transition-colors ' +
                (hovered === key ? 'bg-neutral-100' : 'hover:bg-neutral-50')
              }
            >
              <td className="py-1 pr-6">
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className="inline-block h-3 w-3"
                    style={{ background: DISORDER_COLOR, opacity: dimmed(key) ? 0.25 : 1 }}
                  />
                  <span className="font-mono">{i + 1}</span>
                </span>
              </td>
              <td className="py-1 pr-4 font-mono whitespace-nowrap">
                {s}–{e}
              </td>
              <td className="py-1">{e - s + 1}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// Sequence-variant detail table (UniProt natural variants, mutagenesis, isoforms).
function VariantTable({
  variants,
  hovered,
  setHovered,
  onToggle,
  dimmed,
}: { variants: ProteinVariants['variants'] } & TrackTableProps) {
  return (
    <table className="w-full table-fixed text-xs [&_td]:align-top">
      <colgroup>
        <col style={{ width: '12%' }} />
        <col style={{ width: '16%' }} />
        <col style={{ width: '18%' }} />
        <col style={{ width: '54%' }} />
      </colgroup>
      <thead>
        <tr className="border-b border-neutral-200 text-left text-neutral-500">
          <th className="py-1 pr-3 font-medium">Pos</th>
          <th className="py-1 pr-3 font-medium">Type</th>
          <th className="py-1 pr-3 font-medium">Change</th>
          <th className="py-1 font-medium">Description</th>
        </tr>
      </thead>
      <tbody>
        {variants.map((v, i) => {
          const key = `var-${i}`;
          const change = variantChange(v);
          return (
            <tr
              key={key}
              onMouseEnter={() => setHovered(key)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => onToggle(key)}
              className={
                'cursor-pointer border-b border-neutral-100 transition-colors ' +
                (hovered === key ? 'bg-neutral-100' : 'hover:bg-neutral-50')
              }
            >
              <td className="py-1 pr-3">
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className="inline-block h-3 w-3 shrink-0"
                    style={{ background: VARIANT_COLOR, opacity: dimmed(key) ? 0.25 : 1 }}
                  />
                  <span className="font-mono">{variantPos(v)}</span>
                </span>
              </td>
              <td className="py-1 pr-3">{variantType(v.type)}</td>
              <td className="py-1 pr-3 font-mono">{change || '—'}</td>
              <td className="py-1 text-neutral-700">{v.description || <span className="text-neutral-400">—</span>}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// PTM / modification detail table.
function ModificationTable({
  modifications,
  hovered,
  setHovered,
  onToggle,
  dimmed,
}: { modifications: ProteinModifications['modifications'] } & TrackTableProps) {
  return (
    <table className="w-full table-fixed text-xs [&_td]:align-top">
      <colgroup>
        <col style={{ width: '14%' }} />
        <col style={{ width: '86%' }} />
      </colgroup>
      <thead>
        <tr className="border-b border-neutral-200 text-left text-neutral-500">
          <th className="py-1 pr-3 font-medium">Pos</th>
          <th className="py-1 font-medium">Modification</th>
        </tr>
      </thead>
      <tbody>
        {modifications.map((m, i) => {
          const key = `mod-${i}`;
          const bond = isPtmBond(m.type, m.begin, m.end);
          const pos =
            m.begin === m.end ? `${m.begin}` : bond ? `${m.begin}↔${m.end}` : `${m.begin}–${m.end}`;
          return (
            <tr
              key={key}
              onMouseEnter={() => setHovered(key)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => onToggle(key)}
              className={
                'cursor-pointer border-b border-neutral-100 transition-colors ' +
                (hovered === key ? 'bg-neutral-100' : 'hover:bg-neutral-50')
              }
            >
              <td className="py-1 pr-3">
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className="inline-block h-3 w-3 shrink-0"
                    style={{ background: MOD_COLOR, opacity: dimmed(key) ? 0.25 : 1 }}
                  />
                  <span className="font-mono">{pos}</span>
                </span>
              </td>
              <td className="py-1 text-neutral-700">{ptmName(m)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// Low-pLDDT region detail table — one row per continuous run < 70.
function PlddtTable({
  regions,
  hovered,
  setHovered,
  onToggle,
  dimmed,
}: { regions: PlddtRegion[] } & TrackTableProps) {
  if (regions.length === 0) {
    return <div className="text-xs italic text-neutral-400">no regions below pLDDT 70</div>;
  }
  return (
    <table className="w-full text-xs [&_td]:align-top">
      <thead>
        <tr className="border-b border-neutral-200 text-left text-neutral-500">
          <th className="py-1 pr-6 font-medium">Region</th>
          <th className="py-1 pr-4 font-medium">Confidence</th>
          <th className="py-1 pr-4 font-medium">Res</th>
          <th className="py-1 pr-4 font-medium">Len</th>
          <th className="py-1 font-medium">Mean pLDDT</th>
        </tr>
      </thead>
      <tbody>
        {regions.map((r, i) => {
          const key = `plddt-${i}`;
          const severe = regionSevere(r);
          return (
            <tr
              key={key}
              onMouseEnter={() => setHovered(key)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => onToggle(key)}
              className={
                'cursor-pointer border-b border-neutral-100 transition-colors ' +
                (hovered === key ? 'bg-neutral-100' : 'hover:bg-neutral-50')
              }
            >
              <td className="py-1 pr-6">
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className="inline-block h-3 w-3"
                    style={{ background: regionColor(r), opacity: dimmed(key) ? 0.25 : 1 }}
                  />
                  <span className="font-mono">{i + 1}</span>
                </span>
              </td>
              <td className="py-1 pr-4">{severe ? 'very low' : 'low'}</td>
              <td className="py-1 pr-4 font-mono whitespace-nowrap">
                {r.start}–{r.end}
              </td>
              <td className="py-1 pr-4">{r.end - r.start + 1}</td>
              <td className="py-1">{Math.round(r.mean)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function CopyIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

