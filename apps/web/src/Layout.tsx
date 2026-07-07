import { Link, Outlet, useMatch, useNavigate } from 'react-router-dom';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ChromosomeInfo, RelationshipType } from '@uniome/shared';
import GenomeBrowser from './components/GenomeBrowser';
import { prefetchMultiome } from './modules/MultiomeExplorer';
import { GeneSearch } from './components/GeneSearch';
import { ThresholdProvider } from './lib/thresholds';
import { FavouritesProvider, FavouriteBar } from './lib/favourites';
import { SettingsProvider } from './lib/settings';
import { SettingsModal } from './components/SettingsModal';
import { fetchJSONWithRetry } from './lib/api';

export interface OrganismSummary {
  taxid: string;
  shortName: string;
  scientificName: string;
  strain: string;
  chromosomes: ChromosomeInfo[];
}

// The gene currently selected in this organism, surfaced in the title bar and persisted across
// home ↔ entry navigation. Carries its chrom so the toggle can link back to it from anywhere.
export interface SelectedGene {
  chrom: string;
  uniqID: string;
  gene: string;
}

// Org-level data the Layout already loads, shared with the organism home page (BrowserPage) via the
// router Outlet context so it doesn't re-fetch. The entry page uses `setSelected` to report the gene
// it loaded (so the title-bar toggle/label stay in sync).
// The relationship-explorer view (type/source/selected cell), lifted to the Layout so it persists when
// the user leaves the home page for an entry (or another entry) and comes back. Cached data re-fetches,
// but the user's selections are restored.
export interface RelView {
  type: RelationshipType;
  source: string;
  sel: { a: number; b: number } | null;
}
export const DEFAULT_REL_VIEW: RelView = { type: 'interaction', source: 'all', sel: null };

export interface OrgHomeContext {
  taxid: string;
  chrom?: string;
  organisms: OrganismSummary[];
  chromosomes: ChromosomeInfo[];
  currentOrg?: OrganismSummary;
  activeChrom?: ChromosomeInfo;
  selected: SelectedGene | null;
  setSelected: (s: SelectedGene | null) => void;
  relView: RelView;
  setRelView: (v: RelView) => void;
}

export default function Layout() {
  const orgMatch = useMatch('/o/:taxid/c/:chrom/*');
  const taxid = orgMatch?.params.taxid;
  const chrom = orgMatch?.params.chrom ? decodeURIComponent(orgMatch.params.chrom) : undefined;
  const entryMatch = useMatch('/o/:taxid/c/:chrom/entry/:id');
  const entryHomeMatch = useMatch('/o/:taxid/c/:chrom/entry'); // the entry page with no gene selected
  const entryIdInUrl = entryMatch?.params.id;
  const onEntryHome = !!entryHomeMatch; // the entry page with no gene → nothing selected
  const onEntry = !!entryMatch || onEntryHome;

  const [chromosomes, setChromosomes] = useState<ChromosomeInfo[]>([]);
  const [organisms, setOrganisms] = useState<OrganismSummary[]>([]);
  // The selected gene persists across home ↔ entry navigation (and is shown in the title bar). The
  // entry page reports it on load via the Outlet context; cleared only when the organism changes.
  const [selected, setSelected] = useState<SelectedGene | null>(null);
  const [relView, setRelView] = useState<RelView>(DEFAULT_REL_VIEW);
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
    setSelected(null); // a different organism's gene is no longer the selection
    setRelView(DEFAULT_REL_VIEW); // its cluster indices are per-organism
  }, [taxid]);

  // Warm the (large) multiome payload as soon as you're in an organism — on any page — so it's
  // cached/in-flight by the time you reach the home page, instead of loading lazily on arrival.
  useEffect(() => {
    if (taxid) prefetchMultiome(taxid);
  }, [taxid]);

  // Remember the organism-home scroll position and restore it when you toggle back from an entry, so
  // the home page doesn't jump. The home page remounts on return and its modules reload, so a
  // ResizeObserver pins the saved position (pre-paint) as the content grows back; it releases after it
  // settles or the user scrolls. We restore even when the saved position is the top (target 0): the
  // entry page leaves the window scrolled down and React Router doesn't reset it, so without an explicit
  // scroll-to-target the window would stay clamped at the home page's bottom.
  const homeScrollRef = useRef(0);
  useEffect(() => { homeScrollRef.current = 0; }, [taxid]); // new organism → forget the old home scroll
  useEffect(() => {
    if (onEntry || !taxid) return;
    const onScroll = () => { homeScrollRef.current = window.scrollY; };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [onEntry, taxid]);
  useLayoutEffect(() => {
    if (onEntry || !taxid) return;
    const target = homeScrollRef.current;
    let done = false;
    const pin = () => { if (!done && Math.abs(window.scrollY - target) > 1) window.scrollTo(0, target); };
    const stop = () => { if (done) return; done = true; ro.disconnect(); clearTimeout(timer); window.removeEventListener('wheel', stop); window.removeEventListener('touchmove', stop); window.removeEventListener('keydown', stop); };
    pin();
    const ro = new ResizeObserver(() => pin());
    ro.observe(document.body);
    const timer = window.setTimeout(stop, 1200);
    window.addEventListener('wheel', stop, { passive: true });
    window.addEventListener('touchmove', stop, { passive: true });
    window.addEventListener('keydown', stop);
    return stop;
  }, [onEntry, taxid]);

  // The no-gene entry route means the selection was cleared (a deselect) → drop the title-bar label.
  useEffect(() => {
    if (onEntryHome) setSelected(null);
  }, [onEntryHome]);

  const handleSelectChrom = (chromId: string) => {
    if (!taxid) return;
    if (selected && selected.chrom === chromId) {
      nav(`/o/${taxid}/c/${encodeURIComponent(chromId)}/entry/${selected.uniqID}`);
    } else {
      nav(`/o/${taxid}/c/${encodeURIComponent(chromId)}`);
    }
  };

  // Picking a gene (favourite chip, search, hyperlink) always opens that gene's entry page — from the
  // home page too. The entry page then applies its own per-gene scroll memory (top if unseen, last
  // position if seen). The title-bar selection is reported by the entry view once it loads.
  const selectGene = (g: { taxid: string; chrom: string; uniqID: string; gene: string }) => {
    nav(`/o/${g.taxid}/c/${encodeURIComponent(g.chrom)}/entry/${g.uniqID}`);
  };

  const currentOrg = organisms.find((o) => o.taxid === taxid);
  const activeChrom =
    chromosomes.find((c) => c.id === chrom) ?? chromosomes[0];
  const [orgMenuOpen, setOrgMenuOpen] = useState(false);
  const orgMenuRef = useRef<HTMLDivElement>(null);
  // Dark mode: toggles a `dark` class on <html> (init'd pre-render in index.html), persisted.
  const [dark, setDark] = useState(() => typeof document !== 'undefined' && document.documentElement.classList.contains('dark'));
  const toggleDark = () => setDark((v) => { const n = !v; document.documentElement.classList.toggle('dark', n); try { localStorage.setItem('uniome.theme', n ? 'dark' : 'light'); } catch { /* ignore */ } return n; });
  const [settingsOpen, setSettingsOpen] = useState(false);
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
    <SettingsProvider>
    <FavouritesProvider>
    <ThresholdProvider>
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-2">
          <Link to="/" className="font-mono text-sm font-semibold tracking-tight">
            UniOme
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
                <ul className="absolute left-0 z-40 mt-1 max-h-80 w-72 overflow-auto rounded border border-neutral-200 bg-white shadow-sm">
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
          {/* Home / entry toggle + the selected gene, right of the organism. Home = the org home
              page (browser + explorers); entry = the selected gene, or the empty entry view when
              none is selected. The selection persists across the toggle. Distinct from the UniOme
              logo, which goes to the organism list. */}
          {taxid && (() => {
            const c = encodeURIComponent(chrom ?? activeChrom?.id ?? '');
            const entryTo = selected
              ? `/o/${taxid}/c/${encodeURIComponent(selected.chrom)}/entry/${selected.uniqID}`
              : `/o/${taxid}/c/${c}/entry`;
            const tab = 'rounded-full px-2.5 py-0.5 transition-colors';
            const active = ' bg-white font-medium text-neutral-900 shadow-sm';
            const idle = ' text-neutral-500 hover:text-neutral-800';
            return (
              <>
                <div className="flex shrink-0 items-center gap-0.5 rounded-full border border-neutral-200 bg-neutral-50 p-0.5 text-[11px]">
                  <Link to={`/o/${taxid}/c/${c}`} className={tab + (onEntry ? idle : active)}>home</Link>
                  <Link to={entryTo} className={tab + (onEntry ? active : idle)}>entry</Link>
                </div>
                {selected && (
                  <Link to={entryTo} title="go to the selected gene" className="shrink-0 font-mono text-xs font-bold text-neutral-800 hover:text-neutral-900">
                    {selected.gene}
                  </Link>
                )}
              </>
            );
          })()}
          {taxid && <FavouriteBar onPick={selectGene} />}
          {/* Persistent gene search — selects on the home page, opens on the entry page (same
              mode-aware rule as the favourites). */}
          {taxid && <div className="ml-auto shrink-0"><GeneSearch taxid={taxid} compact onPick={(g) => selectGene({ taxid, ...g })} /></div>}
          {/* Trailing controls: just the settings gear (dark mode + data toggles live inside it).
              ml-auto on the home page, where there's no search bar to push it right. */}
          <button type="button" onClick={() => setSettingsOpen(true)} aria-label="settings" title="settings"
            className={'flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 ' + (taxid ? '' : 'ml-auto')}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
        </div>
      </header>
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} dark={dark} onToggleDark={toggleDark} />}
      {/* Per-gene genome-browser navigator: only on the entry page (with or without a gene selected).
          Not sticky — the sticky header above stays put while this scrolls away. Picking a feature
          opens its entry; clicking the selected one deselects → the no-gene entry view. The organism
          home renders the modules full-size in the page body instead (see BrowserPage). */}
      {taxid && onEntry && (
        <div className="border-b border-neutral-200 bg-neutral-50">
          <div className="mx-auto max-w-7xl px-4 py-3">
            {chromosomes.length > 0 && activeChrom ? (
              <GenomeBrowser
                taxid={taxid}
                chromosomes={chromosomes}
                activeChromId={activeChrom.id}
                onSelectChrom={handleSelectChrom}
                focusId={entryIdInUrl}
                onPick={(g) => nav(g
                  ? `/o/${taxid}/c/${encodeURIComponent(g.chrom)}/entry/${g.uniqID}`
                  : `/o/${taxid}/c/${encodeURIComponent(chrom ?? activeChrom.id)}/entry`)}
              />
            ) : (
              <div className="text-xs text-neutral-500">loading chromosomes…</div>
            )}
          </div>
        </div>
      )}
      <Outlet context={{ taxid: taxid ?? '', chrom, organisms, chromosomes, currentOrg, activeChrom, selected, setSelected, relView, setRelView } satisfies OrgHomeContext} />
    </div>
    </ThresholdProvider>
    </FavouritesProvider>
    </SettingsProvider>
  );
}
