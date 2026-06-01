import { Link, Outlet, useMatch, useNavigate } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import type { ChromosomeInfo } from '@uniome/shared';
import GenomeBrowser from './components/GenomeBrowser';
import { fetchJSONWithRetry } from './lib/api';

interface OrganismSummary {
  taxid: string;
  shortName: string;
  scientificName: string;
  strain: string;
  chromosomes: ChromosomeInfo[];
}

export default function Layout() {
  const orgMatch = useMatch('/o/:taxid/c/:chrom/*');
  const taxid = orgMatch?.params.taxid;
  const chrom = orgMatch?.params.chrom ? decodeURIComponent(orgMatch.params.chrom) : undefined;
  const entryMatch = useMatch('/o/:taxid/c/:chrom/entry/:id');
  const entryIdInUrl = entryMatch?.params.id;

  const [chromosomes, setChromosomes] = useState<ChromosomeInfo[]>([]);
  const [organisms, setOrganisms] = useState<OrganismSummary[]>([]);
  const [lastEntryByChrom, setLastEntryByChrom] = useState<Record<string, string>>({});
  const nav = useNavigate();

  useEffect(() => {
    fetchJSONWithRetry<OrganismSummary[]>('/api/organisms')
      .then(setOrganisms)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!taxid) {
      setChromosomes([]);
      return;
    }
    setChromosomes([]);
    fetch(`/api/organism/${taxid}/chromosomes`)
      .then((r) => (r.ok ? r.json() : []))
      .then(setChromosomes)
      .catch(() => {});
  }, [taxid]);

  useEffect(() => {
    setLastEntryByChrom({});
  }, [taxid]);

  const prevChromRef = useRef<string | undefined>(undefined);
  const prevEntryRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (entryIdInUrl && chrom) {
      setLastEntryByChrom((prev) =>
        prev[chrom] === entryIdInUrl ? prev : { ...prev, [chrom]: entryIdInUrl }
      );
    } else if (
      !entryIdInUrl &&
      chrom &&
      prevEntryRef.current &&
      prevChromRef.current === chrom
    ) {
      // Same chrom, entry went away → user deselected; forget the remembered entry
      setLastEntryByChrom((prev) => {
        if (!(chrom in prev)) return prev;
        const next = { ...prev };
        delete next[chrom];
        return next;
      });
    }
    prevChromRef.current = chrom;
    prevEntryRef.current = entryIdInUrl;
  }, [entryIdInUrl, chrom]);

  const handleSelectChrom = (chromId: string) => {
    if (!taxid) return;
    const remembered = lastEntryByChrom[chromId];
    if (remembered) {
      nav(`/o/${taxid}/c/${encodeURIComponent(chromId)}/entry/${remembered}`);
    } else {
      nav(`/o/${taxid}/c/${encodeURIComponent(chromId)}`);
    }
  };

  const currentOrg = organisms.find((o) => o.taxid === taxid);
  const activeChrom =
    chromosomes.find((c) => c.id === chrom) ?? chromosomes[0];
  const [orgMenuOpen, setOrgMenuOpen] = useState(false);
  const orgMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (orgMenuRef.current && !orgMenuRef.current.contains(e.target as Node)) {
        setOrgMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  return (
    <div className="min-h-screen">
      <header className="relative z-20 border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-2">
          <Link to="/" className="font-mono text-sm font-semibold tracking-tight">
            uniOme
          </Link>
          {currentOrg && (
            <div className="relative" ref={orgMenuRef}>
              <button
                type="button"
                onClick={() => setOrgMenuOpen((v) => !v)}
                className="flex cursor-pointer items-center gap-1 text-xs text-neutral-500 hover:text-neutral-800"
              >
                <span>{currentOrg.shortName}</span>
                <span aria-hidden className="text-[10px]">▾</span>
              </button>
              {orgMenuOpen && (
                <ul className="absolute left-0 z-30 mt-1 max-h-80 w-72 overflow-auto rounded border border-neutral-200 bg-white shadow-sm">
                  {organisms.map((o) => {
                    const first = o.chromosomes[0];
                    const active = o.taxid === taxid;
                    return (
                      <li key={o.taxid}>
                        <button
                          type="button"
                          disabled={!first}
                          onClick={() => {
                            setOrgMenuOpen(false);
                            if (!first) return;
                            if (o.taxid === taxid) return;
                            nav(`/o/${o.taxid}/c/${encodeURIComponent(first.id)}`);
                          }}
                          className={
                            'flex w-full flex-col items-start gap-0.5 px-2 py-1.5 text-left text-xs ' +
                            (active ? 'bg-neutral-100' : 'hover:bg-neutral-100')
                          }
                        >
                          <span className={'font-mono ' + (active ? 'font-semibold text-neutral-900' : 'text-neutral-800')}>
                            {o.shortName}
                          </span>
                          <span className="text-[10px] text-neutral-500">
                            <em>{o.scientificName}</em> · {o.chromosomes.length} chrom
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </div>
      </header>
      {taxid && (
        <div className="sticky top-0 z-10 border-b border-neutral-200 bg-neutral-50/95 backdrop-blur">
          <div className="mx-auto max-w-7xl px-4 py-3">
            {chromosomes.length > 0 && activeChrom ? (
              <GenomeBrowser
                taxid={taxid}
                chromosomes={chromosomes}
                activeChromId={activeChrom.id}
                onSelectChrom={handleSelectChrom}
              />
            ) : (
              <div className="text-xs text-neutral-500">loading chromosomes…</div>
            )}
          </div>
        </div>
      )}
      <Outlet />
    </div>
  );
}
