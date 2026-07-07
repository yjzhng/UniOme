import { useEffect, useRef, useState, type ReactNode } from 'react';
import SmilesDrawer from 'smiles-drawer';
import type { Reaction, ReactionParticipant } from '@uniome/shared';

const RHEA_URL = (id: string) => `https://www.rhea-db.org/rhea/${id.replace(/^RHEA:/, '')}`;
const EC_URL = (ec: string) => `https://enzyme.expasy.org/EC/${ec}`;

// All molecules are drawn at one fixed atomic scale (constant bond length), like a proper chemical
// drawing — each SVG sizes to its molecule's natural extent, so a lone ion is small and a
// nucleotide is large. BOND = desired on-screen px per bond; PAD = on-screen px of margin.
const BOND = 14;
const PAD = 4;
// smiles-drawer's default geometry (used so its hardcoded proportions stay correct, see below).
const LIB_BONDLENGTH = 30;
const SCALE = BOND / LIB_BONDLENGTH;
// A single molecule never exceeds this height (px); a larger one scales down to fit (aspect kept).
const MAX_MOL_H = 130;
const drawable = (p: ReactionParticipant) => !!p.smiles && !p.rgroup;

// A rough pre-draw box (heavy-atom estimate) so the lazy placeholder reserves ~the right space
// before the molecule is drawn (smiles-drawer then sets the exact natural size).
const ATOM_RE = /(\[[^\]]*\]|Br|Cl|[BCNOFPSI]|[bcnops])/g;
function placeholderSize(smiles: string): number {
  const n = (smiles.match(ATOM_RE) ?? []).length || 1;
  return Math.max(24, Math.min(150, Math.round(18 + 17 * Math.sqrt(n))));
}

// The reaction viewer: a protein's catalysed reactions, each as a 2D structural depiction
// (substrates ⇌ products) drawn client-side from SMILES, fitting within its column (scrolls
// horizontally when a reaction is wide). Reactions with no drawable structures fall back to the
// typeset equation; the text equation is never shown alongside the structures.
export function ReactionView({ reactions }: { reactions: Reaction[] }) {
  return (
    <ul className="min-w-0 space-y-2">
      {reactions.map((rx, i) => {
        const hasStructures = [...(rx.left ?? []), ...(rx.right ?? [])].some(drawable);
        return (
          <li key={rx.rhea ?? i} className="min-w-0">
            {hasStructures ? (
              <ReactionStructure reaction={rx} />
            ) : (
              <div className="text-[11px] leading-snug"><ReactionEquation reaction={rx} /></div>
            )}
            <ReactionLinks rx={rx} />
          </li>
        );
      })}
    </ul>
  );
}

function ReactionLinks({ rx }: { rx: Reaction }) {
  if (!rx.rhea && !rx.ec) return null;
  return (
    <div className="mt-1 whitespace-nowrap text-[10px]">
      {rx.rhea && <a href={RHEA_URL(rx.rhea)} target="_blank" rel="noreferrer" className="text-neutral-400 underline decoration-neutral-300 hover:text-neutral-700">{rx.rhea}</a>}
      {rx.rhea && rx.ec && <span className="text-neutral-300"> · </span>}
      {rx.ec && <a href={EC_URL(rx.ec)} target="_blank" rel="noreferrer" className="text-neutral-400 underline decoration-neutral-300 hover:text-neutral-700">EC {rx.ec}</a>}
    </div>
  );
}

// Substrate structures + ⇌ + product structures. Wraps to multiple lines when wide (chemical
// convention) rather than scrolling; operators (+ / ⇌) are spaced from the molecules by the gap.
type Part = { op: string | null; arrow?: boolean; p: ReactionParticipant };
const isTiny = (p: ReactionParticipant) => drawable(p) && heavyAtoms(p.smiles!) <= 1;

function ReactionStructure({ reaction }: { reaction: Reaction }) {
  const seq: Part[] = [];
  (reaction.left ?? []).forEach((p, i) => seq.push({ op: i > 0 ? '+' : null, p }));
  (reaction.right ?? []).forEach((p, i) => seq.push({ op: i > 0 ? '+' : '⇌', arrow: i === 0, p }));

  // Group into non-wrapping units. A tiny species (H⁺, H₂O, …) is appended to the preceding unit
  // rather than starting its own, so it never ends up as a lone item on a new line (a "widow") —
  // it always wraps together with the molecule before it.
  const units: Part[][] = [];
  for (const item of seq) {
    if (units.length && !item.arrow && isTiny(item.p)) units[units.length - 1].push(item);
    else units.push([item]);
  }

  return (
    <div className="rxbox flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded border border-neutral-200 bg-white px-2 py-1.5">
      {units.map((parts, i) => <Unit key={i} parts={parts} />)}
    </div>
  );
}

// A non-wrapping run of operator+participant pairs (one molecule, plus any tiny species trailing it).
function Unit({ parts }: { parts: Part[] }) {
  return (
    <span className="inline-flex max-w-full shrink-0 items-center gap-x-3">
      {parts.flatMap((it, i) => [
        it.op ? <Op key={`o${i}`} arrow={it.arrow}>{it.op}</Op> : null,
        <Participant key={`p${i}`} p={it.p} />,
      ]).filter(Boolean)}
    </span>
  );
}

function Op({ children, arrow }: { children: ReactNode; arrow?: boolean }) {
  return <span className={`shrink-0 select-none text-neutral-400 ${arrow ? 'text-xs' : 'text-[10px]'}`}>{children}</span>;
}

function heavyAtoms(smiles: string): number {
  return (smiles.match(ATOM_RE) ?? []).length;
}

function Participant({ p }: { p: ReactionParticipant }) {
  const coeff = p.name.match(/^(\d+)\s+/)?.[1] ?? null;
  const label = p.name.replace(/^\d+\s+/, '');
  // A single-atom species (H+, H2O, NH4+) is unreadable as a 2D drawing, so show its typeset
  // formula instead; generic / R-group participants (no structure) show a name chip.
  const tiny = drawable(p) && heavyAtoms(p.smiles!) <= 1;
  if (!drawable(p) || tiny) {
    return (
      <span className="flex shrink-0 items-center gap-0.5" title={p.name}>
        {coeff && <span className="text-[10px] font-medium text-neutral-500">{coeff}</span>}
        {tiny ? (
          <span className="whitespace-nowrap text-[11px] text-neutral-700">{formatSpecies(label)}</span>
        ) : (
          <span className="rounded bg-neutral-100 px-1 py-0.5 text-[10px] text-neutral-600">{label}</span>
        )}
      </span>
    );
  }
  return (
    <span className="flex shrink-0 items-center gap-0.5" title={p.name}>
      {coeff && <span className="text-[10px] font-medium text-neutral-500">{coeff}</span>}
      <span className="flex flex-col items-center">
        <Molecule smiles={p.smiles!} />
        <span className="max-w-[110px] truncate text-center text-[9px] leading-tight text-neutral-500">{label}</span>
      </span>
    </span>
  );
}

// One molecule, lazily drawn (when scrolled into view) from SMILES into an inline SVG. With a
// fixed `scale`, smiles-drawer sets the SVG's display size to the molecule's natural extent, so
// every molecule shares the same bond length.
function Molecule({ smiles }: { smiles: string }) {
  const ref = useRef<SVGSVGElement>(null);
  const [seen, setSeen] = useState(false);
  const [failed, setFailed] = useState(false);
  const ph = placeholderSize(smiles);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { setSeen(true); io.disconnect(); }
    }, { rootMargin: '120px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (!seen) return;
    const el = ref.current;
    if (!el) return;
    setFailed(false);
    el.replaceChildren();
    try {
      // Draw at the library's default geometry and shrink the whole drawing uniformly via `scale`,
      // so every proportion — including the stereo-wedge width, whose `3.0 + fontSizeLarge/4`
      // formula is hardcoded in drawing units — scales down too. (Setting bondLength directly
      // shrinks the bonds but leaves that constant, making wedges look oversized.) Options in
      // drawing units (padding/bondThickness) are divided by SCALE to land at the intended px.
      const drawer = new SmilesDrawer.SvgDrawer({
        scale: SCALE,
        bondThickness: 0.8 / SCALE,
        padding: PAD / SCALE,
        compactDrawing: false,
        terminalCarbons: true,
      });
      SmilesDrawer.parse(smiles, (tree) => {
        try {
          drawer.draw(tree, el, 'light');
          // Keep the fixed scale for normal molecules, but bound a big one (e.g. murE's
          // UDP-MurNAc-peptide) to the column width AND a max height, preserving aspect — so a
          // single giant molecule doesn't tower over its row and leave a massive wrapped gap.
          const vb = el.viewBox.baseVal;
          const natW = SCALE * vb.width;
          const natH = SCALE * vb.height;
          const box = el.closest('.rxbox') as HTMLElement | null;
          const availW = box ? Math.max(40, box.clientWidth - 16 - 24) : natW; // px-2 padding + operator
          const f = Math.min(1, availW / natW, MAX_MOL_H / natH);
          el.style.width = `${Math.round(natW * f)}px`;
          el.style.height = `${Math.round(natH * f)}px`;
        } catch { setFailed(true); }
      }, () => setFailed(true));
    } catch { setFailed(true); }
  }, [seen, smiles]);
  if (failed) return <span className="flex items-center justify-center text-[10px] italic text-neutral-300" style={{ width: ph, height: ph }}>—</span>;
  // width/height attributes only reserve pre-draw space; smiles-drawer sets the exact size on draw.
  return <svg ref={ref} width={ph} height={ph} className="block" />;
}

// Typeset equation (fallback when a reaction has no drawable structures): charges as superscripts,
// formula digits as subscripts, ⇌ between the two sides.
function ReactionEquation({ reaction }: { reaction: Reaction }) {
  const left = reaction.left ?? [];
  const right = reaction.right ?? [];
  if (!left.length || !right.length) return <span className="text-neutral-700">{reaction.name.replace(/\.$/, '')}</span>;
  return (
    <span className="text-neutral-700">
      <EqSide participants={left} />
      <span className="mx-1.5 text-neutral-400">⇌</span>
      <EqSide participants={right} />
    </span>
  );
}

function EqSide({ participants }: { participants: ReactionParticipant[] }) {
  return (
    <>
      {participants.map((p, i) => (
        <span key={i}>
          {i > 0 && <span className="text-neutral-400"> + </span>}
          {formatSpecies(p.name)}
        </span>
      ))}
    </>
  );
}

function formatSpecies(s: string): ReactNode {
  let core = s;
  let charge: string | null = null;
  const m = core.match(/\((\d*)([+-])\)\s*$/);
  if (m) { charge = (m[1] || '') + m[2]; core = core.slice(0, m.index).trimEnd(); }
  const nodes: ReactNode[] = [];
  let buf = '';
  for (let i = 0; i < core.length; i++) {
    const ch = core[i];
    const prev = core[i - 1];
    if (/\d/.test(ch) && prev !== undefined && /[A-Za-z)]/.test(prev)) {
      let j = i; let run = '';
      while (j < core.length && /\d/.test(core[j])) { run += core[j]; j++; }
      const after = core[j];
      if (after === undefined || /[A-Za-z]/.test(after)) {
        if (buf) { nodes.push(buf); buf = ''; }
        nodes.push(<sub key={i}>{run}</sub>);
        i = j - 1;
        continue;
      }
    }
    buf += ch;
  }
  if (buf) nodes.push(buf);
  if (charge) nodes.push(<sup key="charge">{charge}</sup>);
  return <>{nodes}</>;
}
