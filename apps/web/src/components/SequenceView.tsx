import { useLayoutEffect, useRef, useState } from 'react';

// One monospace sequence viewer shared by the DNA, RNA and protein panels. Renders the
// sequence with a position ruler: line length adapts to the box width, faint tick marks
// run across the top every `tickInterval` units, and a left gutter marks each line's start
// position. Fills its container — no horizontal overflow. Length is intentionally NOT
// shown here; every panel already has a dedicated "length" field.
//
// An optional highlight layer (protein domains today, RNA features later) tints residues
// and syncs hover/click. Without it, lines render as plain text (one node per line) — cheap
// for long nucleotide sequences.

// One tinted stretch, addressed by `key`. `color` is a resolved hex (the caller decides the
// palette); the viewer applies its own alpha for the rest/hovered/dimmed states.
export interface SeqHighlight {
  key: string;
  color: string; // e.g. "#4e79a7"
}

export interface SequenceViewProps {
  seq: string;
  // Ruler tick spacing in residues/nt/bp (default 10).
  tickInterval?: number;
  // Highlight layer. Passing `highlights` (even empty) enables per-character rendering and
  // the hovered-residue marker; omitting it renders plain lines.
  residueSpan?: number[]; // position (1-based) → index into `highlights`, or -1
  highlights?: SeqHighlight[];
  hovered?: string | null; // currently-highlighted key
  hoveredResidue?: number | null; // position to mark (e.g. the residue under the 3D cursor)
  onHover?: (key: string | null) => void;
  onCopy?: (key: string) => void; // click a highlighted stretch
  // A region carried from another central-dogma level (mapped into this sequence's
  // coordinates) — tinted as a background so you can see where it falls here.
  carried?: { segments: Array<[number, number]>; color: string } | null;
  // Click a carried nucleotide to copy that region's subsequence.
  onCarriedCopy?: () => void;
}

export function SequenceView({
  seq,
  tickInterval = 10,
  residueSpan,
  highlights,
  hovered = null,
  hoveredResidue = null,
  onHover,
  onCopy,
  carried = null,
  onCarriedCopy,
}: SequenceViewProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const probeRef = useRef<HTMLSpanElement>(null);
  const [perLine, setPerLine] = useState(50);
  const [charW, setCharW] = useState(7.2);
  const digits = String(seq.length).length;
  const interactive = highlights !== undefined || carried != null;
  // 1-based positions covered by the carried region.
  const carriedSet = (() => {
    if (!carried) return null;
    const s = new Set<number>();
    for (const [a, b] of carried.segments) for (let p = a; p <= b; p++) s.add(p);
    return s;
  })();

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
  for (let c = tickInterval; c <= perLine; c += tickInterval) tickCols.push(c);

  return (
    <div ref={boxRef} className="rounded bg-neutral-50 p-2 font-mono text-xs leading-relaxed text-neutral-500">
      <span ref={probeRef} aria-hidden className="invisible absolute">
        ABCDEFGHIJ
      </span>
      {/* top column ruler: faint number + short tick every `tickInterval` units */}
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
          {interactive ? (
            <div className="whitespace-pre">
              {seq
                .slice(start, start + perLine)
                .split('')
                .map((ch, k) => {
                  const pos = start + k + 1;
                  // Residue under the 3D cursor: solid pink fill so it reads over any tint.
                  const red = pos === hoveredResidue;
                  const si = residueSpan?.[pos] ?? -1;
                  const h = si < 0 ? null : highlights?.[si];
                  if (h == null) {
                    // No feature here — show the carried cross-level region (if any) as a tint,
                    // clickable to copy that region's subsequence.
                    const onCarry = carriedSet?.has(pos);
                    const carryBg = onCarry ? carried!.color + '66' : undefined;
                    const bg = red ? '#ff6699' : carryBg;
                    const clickable = onCarry && !!onCarriedCopy;
                    return (
                      <span
                        key={k}
                        onClick={clickable ? onCarriedCopy : undefined}
                        title={clickable ? 'click to copy region' : undefined}
                        className={clickable ? 'cursor-pointer' : undefined}
                        style={bg ? { backgroundColor: bg, color: red ? '#fff' : undefined } : undefined}
                      >
                        {ch}
                      </span>
                    );
                  }
                  const hot = hovered === h.key;
                  // Fainter overall; the hovered stretch rises, the rest fade back.
                  const alpha = hovered == null ? '40' : hot ? '66' : '14';
                  return (
                    <span
                      key={k}
                      onMouseEnter={() => onHover?.(h.key)}
                      onMouseLeave={() => onHover?.(null)}
                      onClick={() => onCopy?.(h.key)}
                      title={onCopy ? `click to copy ${h.key} sequence` : undefined}
                      className={onCopy ? 'cursor-pointer' : undefined}
                      style={{
                        backgroundColor: red ? '#ff6699' : h.color + alpha,
                        color: red ? '#fff' : hot ? '#262626' : undefined,
                      }}
                    >
                      {ch}
                    </span>
                  );
                })}
            </div>
          ) : (
            <div className="whitespace-pre text-neutral-700">{seq.slice(start, start + perLine)}</div>
          )}
        </div>
      ))}
    </div>
  );
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

// A sequence on its own line under a "sequence" label, with a copy-all button and (when a
// region is carried in from a higher level) click-to-copy that region. Used for the plain
// DNA / mRNA sequences; the rich protein/RNA panels build their own copy header.
export function CopyableSequence({ seq, tickInterval, carried }: { seq: string; tickInterval?: number; carried?: { segments: Array<[number, number]>; color: string } | null }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const copy = (text: string) => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  };
  const onCarriedCopy = carried ? () => copy(carried.segments.map(([a, b]) => seq.slice(a - 1, b)).join('-')) : undefined;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-neutral-500">
          sequence
          <button type="button" onClick={() => copy(seq)} title="copy full sequence" className="cursor-pointer text-neutral-400 hover:text-neutral-700">
            <CopyIcon />
          </button>
        </div>
        {copied && <span className="text-xs text-neutral-400">copied ✓</span>}
      </div>
      <SequenceView seq={seq} tickInterval={tickInterval} carried={carried} onCarriedCopy={onCarriedCopy} />
    </div>
  );
}
