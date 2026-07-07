import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { FeatureSummary } from '@uniome/shared';

// Standalone gene / locus / ID type-ahead for the organism home page. Picking a result jumps
// straight to that gene's entry page — the primary "I already know the gene" entry point, distinct
// from exploring via the three interactive modules below it.
export function GeneSearch({ taxid, onPick, compact }: { taxid: string; onPick?: (g: { chrom: string; uniqID: string; gene: string }) => void; compact?: boolean }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<FeatureSummary[]>([]);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const nav = useNavigate();

  useEffect(() => {
    if (!q.trim()) {
      setResults([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/organism/${taxid}/search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
        if (res.ok) setResults(await res.json());
      } catch {
        /* aborted */
      }
    }, 120);
    return () => {
      ctrl.abort();
      clearTimeout(t);
    };
  }, [q, taxid]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const pick = (r: FeatureSummary) => {
    setOpen(false);
    setQ('');
    // On the home page (onPick provided) a search just selects the gene; otherwise open its entry.
    if (onPick) onPick({ chrom: r.chrom, uniqID: r.uniqID, gene: r.gene || r.locus_tag || r.uniqID });
    else nav(`/o/${taxid}/c/${encodeURIComponent(r.chrom)}/entry/${r.uniqID}`, { state: { from: 'search' } });
  };

  return (
    <div ref={boxRef} className={compact ? 'relative w-48' : 'relative w-full max-w-xl'}>
      <input
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => { if (e.key === 'Enter' && results.length) pick(results[0]); }}
        placeholder={compact ? 'search gene / id…' : 'search a gene, locus tag, or UniProt ID…'}
        className={compact
          ? 'w-full rounded-full border border-neutral-300 bg-white px-3 py-1 text-xs focus:border-neutral-500 focus:outline-none'
          : 'w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none'}
      />
      {open && results.length > 0 && (
        <ul className={`absolute right-0 z-30 mt-1 max-h-96 overflow-auto rounded-lg border border-neutral-200 bg-white shadow-lg ${compact ? 'w-80' : 'left-0 right-0'}`}>
          {results.map((r) => (
            <li key={r.uniqID}>
              <button
                type="button"
                onClick={() => pick(r)}
                className="flex w-full items-baseline gap-2 px-3 py-1.5 text-left text-xs hover:bg-neutral-100"
              >
                <span className="font-mono font-medium">{r.gene || r.locus_tag || r.uniqID}</span>
                <span className="text-neutral-500">{r.type}</span>
                <span className="ml-auto truncate text-neutral-600">{r.product}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
