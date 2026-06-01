import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ProteinDomains } from '@uniome/shared';
import type { EntryModule, ModuleContext } from './types';

// Mol* is large; only pull it in when a protein with a structure is actually viewed.
const MolstarViewer = lazy(() => import('./MolstarViewer'));

// TED's domain palette (Tableau 10) — shared by track + table + the 3D model.
const DOMAIN_PALETTE = [
  '#4e79a7', '#f28e2c', '#e15759', '#76b7b2', '#59a14f',
  '#edc949', '#af7aa1', '#ff9da7', '#9c755f', '#bab0ab',
];

type Status = 'loading' | 'ok' | 'empty' | 'error';

function Placeholder({ children }: { children: React.ReactNode }) {
  return <div className="py-6 text-center text-xs italic text-neutral-400">{children}</div>;
}

// Glue the last two words with a non-breaking space so a wrapped name never leaves a
// single word stranded on its own line.
function avoidWidow(s: string): string {
  const i = s.lastIndexOf(' ');
  return i === -1 ? s : `${s.slice(0, i)} ${s.slice(i + 1)}`;
}

// Pick a "nice" ruler step (~5 ticks) for a protein of `length` residues.
function niceStep(length: number): number {
  const rough = length / 5;
  const pow = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / pow;
  const nice = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
  return Math.max(1, nice * pow);
}

function ProteinDomainViewerComponent({ feature, taxid }: ModuleContext) {
  const acc = feature.UniProtID;
  const [data, setData] = useState<ProteinDomains | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [hovered, setHovered] = useState<string | null>(null);
  const [hasStructure, setHasStructure] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [hoveredResidue, setHoveredResidue] = useState<number | null>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const structureUrl = acc ? `/api/organism/${taxid}/protein/${encodeURIComponent(acc)}/structure` : '';

  useEffect(() => {
    if (!acc) {
      setStatus('empty');
      return;
    }
    let cancelled = false;
    setStatus('loading');
    setData(null);
    fetch(`/api/organism/${taxid}/protein/${encodeURIComponent(acc)}/domains`)
      .then((r) => (r.status === 404 ? null : r.ok ? r.json() : Promise.reject(new Error())))
      .then((d: ProteinDomains | null) => {
        if (cancelled) return;
        if (!d) setStatus('empty');
        else {
          setData(d);
          setStatus('ok');
        }
      })
      .catch(() => {
        if (!cancelled) setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [acc, taxid]);

  // Probe whether a local structure exists before mounting the heavy 3D viewer.
  useEffect(() => {
    if (!acc) {
      setHasStructure(false);
      return;
    }
    let cancelled = false;
    setHasStructure(false);
    fetch(structureUrl, { method: 'HEAD' })
      .then((r) => {
        if (!cancelled) setHasStructure(r.ok);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [acc, structureUrl]);

  const length = useMemo(() => {
    if (feature.prot_len) return feature.prot_len;
    if (data?.length) return data.length;
    const maxRes = data ? Math.max(1, ...data.domains.flatMap((d) => d.segments.map((s) => s[1]))) : 1;
    return maxRes;
  }, [feature.prot_len, data]);

  if (!acc) return <Placeholder>no UniProt mapping for this entry</Placeholder>;
  if (status === 'loading') return <Placeholder>loading domains…</Placeholder>;
  if (status === 'error') return <Placeholder>failed to load domains</Placeholder>;
  if (status === 'empty' || !data) return <Placeholder>domains not yet ingested for {acc}</Placeholder>;

  const colorOf = (i: number) => DOMAIN_PALETTE[i % DOMAIN_PALETTE.length];
  const domainColors = data.domains.map((d, i) => ({
    id: d.id,
    segments: d.segments,
    color: colorOf(i),
  }));
  const pct = (x: number) => `${(x / length) * 100}%`;
  const dimmed = (id: string) => hovered !== null && hovered !== id;

  // residueDomain[r] = index of the domain covering residue r (1-based), or -1.
  const residueDomain = new Array<number>(length + 1).fill(-1);
  data.domains.forEach((d, i) =>
    d.segments.forEach(([s, e]) => {
      for (let r = s; r <= e && r <= length; r++) residueDomain[r] = i;
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
  // Clicking a domain's residues copies that domain's sequence (segments joined).
  const copyDomain = (d: ProteinDomains['domains'][number]) => {
    if (feature.prot_seq) {
      copyText(d.segments.map(([s, e]) => feature.prot_seq!.slice(s - 1, e)).join(''), d.id);
    }
  };
  const copyFull = () => {
    if (feature.prot_seq) copyText(feature.prot_seq, 'full sequence');
  };

  const step = niceStep(length);
  const ticks: number[] = [];
  for (let t = 0; t <= length; t += step) ticks.push(t);
  if (ticks[ticks.length - 1] !== length) ticks.push(length);

  return (
    <div className="space-y-4">
      {/* AlphaFold 3D structure, coloured by the same domain palette + hover-synced. */}
      {hasStructure ? (
        <Suspense
          fallback={
            <div className="flex h-72 items-center justify-center rounded bg-neutral-50 text-xs italic text-neutral-400">
              loading 3D viewer…
            </div>
          }
        >
          <MolstarViewer
            structureUrl={structureUrl}
            domains={domainColors}
            hovered={hovered}
            onHover={setHovered}
            onHoverResidue={setHoveredResidue}
          />
        </Suspense>
      ) : (
        <div className="flex h-40 items-center justify-center rounded border border-dashed border-neutral-300 bg-neutral-50 text-xs italic text-neutral-400">
          no AlphaFold structure available
        </div>
      )}

      {/* Protein sequence, residues highlighted by their domain colour. Residues/line
          adjust to the box width; a left ruler marks line-start positions; clicking a
          domain's residues copies that domain's sequence. */}
      {feature.prot_seq && (
        <div>
          <div className="mb-1 flex items-center justify-between text-xs text-neutral-500">
            <span className="inline-flex items-center gap-1.5">
              Sequence
              <button
                type="button"
                onClick={copyFull}
                title="copy full sequence"
                className="cursor-pointer text-neutral-400 hover:text-neutral-700"
              >
                <CopyIcon />
              </button>
            </span>
            {copied && <span className="text-neutral-400">copied {copied} ✓</span>}
          </div>
          <SequenceView
            seq={feature.prot_seq}
            residueDomain={residueDomain}
            domains={data.domains}
            colorOf={colorOf}
            hovered={hovered}
            hoveredResidue={hoveredResidue}
            onHover={setHovered}
            onCopy={copyDomain}
          />
        </div>
      )}

      {/* Domain track with domain boxes */}
      <div>
        <div className="mb-1 text-xs text-neutral-500">TED Consensus Domain</div>
        <div className="relative h-7 select-none">
          {/* Grey track for unassigned regions; coloured domain boxes overlay it. */}
          <div className="absolute inset-x-0 top-1 bottom-1 bg-neutral-200" />
          {data.domains.map((d, i) =>
            d.segments.map(([s, e], j) => {
              const wide = (e - s + 1) / length > 0.08;
              return (
                <div
                  key={`${d.id}-${j}`}
                  onMouseEnter={() => setHovered(d.id)}
                  onMouseLeave={() => setHovered(null)}
                  title={`${d.id} · ${s}–${e}${d.cath ? ` · ${d.cath}` : ''}`}
                  className="absolute top-1 bottom-1 flex items-center justify-center overflow-hidden text-[10px] font-medium text-white transition-opacity"
                  style={{
                    left: pct(s - 1),
                    width: pct(e - s + 1),
                    background: colorOf(i),
                    opacity: dimmed(d.id) ? 0.25 : 1,
                  }}
                >
                  {wide && d.id}
                </div>
              );
            })
          )}
        </div>
        {/* aa ruler */}
        <div className="relative mt-1 h-4">
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

      {/* Domain table */}
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
          {data.domains.map((d, i) => {
            const len = d.segments.reduce((acc2, [s, e]) => acc2 + (e - s + 1), 0);
            const ranges = d.segments.map(([s, e]) => `${s}–${e}`).join(', ');
            return (
              <tr
                key={d.id}
                onMouseEnter={() => setHovered(d.id)}
                onMouseLeave={() => setHovered(null)}
                className={
                  'border-b border-neutral-100 transition-colors ' +
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

      <div className="text-[10px] text-neutral-400">
        domains: {data.source} (The Encyclopedia of Domains)
      </div>
    </div>
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

// Monospace sequence with a top column ruler and a left line-start ruler. Residues/line
// are derived from the measured box width (a hidden 10-char probe gives the character
// width), so the layout fills the column yet still carries position rulers.
function SequenceView({
  seq,
  residueDomain,
  domains,
  colorOf,
  hovered,
  hoveredResidue,
  onHover,
  onCopy,
}: {
  seq: string;
  residueDomain: number[];
  domains: ProteinDomains['domains'];
  colorOf: (i: number) => string;
  hovered: string | null;
  hoveredResidue: number | null;
  onHover: (id: string | null) => void;
  onCopy: (d: ProteinDomains['domains'][number]) => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const probeRef = useRef<HTMLSpanElement>(null);
  const [perLine, setPerLine] = useState(50);
  const [charW, setCharW] = useState(7.2);
  const digits = String(seq.length).length;

  useLayoutEffect(() => {
    const box = boxRef.current;
    const probe = probeRef.current;
    if (!box || !probe) return;
    const recompute = () => {
      const cw = probe.getBoundingClientRect().width / 10;
      if (!cw) return;
      setCharW(cw);
      const contentW = box.clientWidth - 16; // p-2 (8px each side)
      const gutterW = digits * cw + 8; // ruler number + mr-2
      setPerLine(Math.max(10, Math.floor((contentW - gutterW) / cw)));
    };
    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(box);
    return () => ro.disconnect();
  }, [digits]);

  const lineStarts: number[] = [];
  for (let i = 0; i < seq.length; i += perLine) lineStarts.push(i);
  const tickCols: number[] = [];
  for (let c = 20; c <= perLine; c += 20) tickCols.push(c);

  return (
    <div ref={boxRef} className="rounded bg-neutral-50 p-2 font-mono text-xs leading-relaxed text-neutral-500">
      <span ref={probeRef} aria-hidden className="invisible absolute">
        ABCDEFGHIJ
      </span>
      {/* top column ruler: faint number + short tick centred on every 20th residue */}
      <div className="flex">
        <span className="mr-2 shrink-0" style={{ width: `${digits}ch` }} />
        <div className="relative h-4 flex-1">
          {tickCols.map((c) => (
            <div
              key={c}
              className="absolute bottom-0 flex select-none flex-col items-center text-neutral-300"
              style={{ left: (c - 0.5) * charW, transform: 'translateX(-50%)' }}
            >
              <span className="text-[11px] leading-none">{c}</span>
              <span className="mt-px h-[3px] w-px bg-neutral-300" />
            </div>
          ))}
        </div>
      </div>
      {lineStarts.map((start) => (
        <div key={start} className="flex">
          <span
            className="mr-2 shrink-0 select-none text-right text-neutral-300"
            style={{ width: `${digits}ch` }}
          >
            {start + 1}
          </span>
          <div className="whitespace-pre">
            {seq
              .slice(start, start + perLine)
              .split('')
              .map((ch, k) => {
                const pos = start + k + 1;
                // Residue under the 3D cursor: solid red fill (matches Mol*'s outline)
                // so it reads clearly over any domain colour.
                const red = pos === hoveredResidue;
                const di = residueDomain[pos];
                if (di < 0) {
                  return (
                    <span key={k} style={red ? { backgroundColor: '#ff6699', color: '#fff' } : undefined}>
                      {ch}
                    </span>
                  );
                }
                const d = domains[di];
                const hot = hovered === d.id;
                // Fainter overall: resting tint sits below the old default, and the
                // hovered domain rises to it (with the rest fading further back).
                const alpha = hovered == null ? '40' : hot ? '66' : '14';
                return (
                  <span
                    key={k}
                    onMouseEnter={() => onHover(d.id)}
                    onMouseLeave={() => onHover(null)}
                    onClick={() => onCopy(d)}
                    title={`click to copy ${d.id} sequence`}
                    className="cursor-pointer"
                    style={{
                      backgroundColor: red ? '#ff6699' : colorOf(di) + alpha,
                      color: red ? '#fff' : hot ? '#262626' : undefined,
                    }}
                  >
                    {ch}
                  </span>
                );
              })}
          </div>
        </div>
      ))}
    </div>
  );
}

export const proteinDomainViewer: EntryModule = {
  id: 'protein-domains',
  title: 'Structure & domains',
  level: 'PROT',
  isAvailable: ({ feature }) => Boolean(feature.UniProtID),
  Component: ProteinDomainViewerComponent,
};
