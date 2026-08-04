import { createContext, Fragment, useContext, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

// A small persistent set of favourite genes, shown as chips in the title-bar favourite bar and toggled
// by the star button on an entry page. Identity = taxid + uniqID; chrom + gene are kept for navigation
// + the chip label. Favourites are **organism-specific** (the bar shows only the current organism's,
// and the max applies per organism) and **persist between sessions** (one localStorage list holds
// every organism's favourites; the bar filters by taxid).
export type Fav = { taxid: string; chrom: string; uniqID: string; gene: string };
export const FAV_MAX = 8; // per organism
const KEY = 'uniome.favourites';
const same = (a: { taxid: string; uniqID: string }, taxid: string, uniqID: string) => a.taxid === taxid && a.uniqID === uniqID;

type Ctx = {
  favs: Fav[]; // all organisms' favourites (unfiltered); callers filter by taxid via forOrg
  forOrg: (taxid: string) => Fav[]; // this organism's favourites, in order
  has: (taxid: string, uniqID: string) => boolean;
  toggle: (f: Fav) => void;
  remove: (taxid: string, uniqID: string) => void;
  move: (taxid: string, from: number, to: number) => void; // reorder within one organism's chips
  clear: (taxid: string) => void; // clear only this organism's favourites
  full: boolean;
};
const C = createContext<Ctx | null>(null);

function load(): Fav[] {
  try { const a = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(a) ? a : []; } catch { return []; }
}

export function FavouritesProvider({ children }: { children: ReactNode }) {
  const [favs, setFavs] = useState<Fav[]>(load);
  const [full, setFull] = useState(false); // 0.5s "bar is full" flash when an add is rejected
  const flashTimer = useRef<number | null>(null);
  const save = (next: Fav[]) => { setFavs(next); try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* ignore */ } };
  const forOrg = (taxid: string) => favs.filter((f) => f.taxid === taxid);
  const has = (taxid: string, uniqID: string) => favs.some((f) => same(f, taxid, uniqID));
  const toggle = (f: Fav) => {
    if (favs.some((x) => same(x, f.taxid, f.uniqID))) save(favs.filter((x) => !same(x, f.taxid, f.uniqID)));
    else if (forOrg(f.taxid).length < FAV_MAX) save([...favs, f]); // per-organism limit
    else { setFull(true); if (flashTimer.current) clearTimeout(flashTimer.current); flashTimer.current = window.setTimeout(() => setFull(false), 500); } // full → flash, don't add
  };
  const remove = (taxid: string, uniqID: string) => save(favs.filter((x) => !same(x, taxid, uniqID)));
  // Reorder within one organism's chips: `from`/`to` index into that organism's filtered list; we map
  // them back to the global slots that organism occupies so other organisms' order is untouched.
  const move = (taxid: string, from: number, to: number) => {
    const slots = favs.map((f, i) => (f.taxid === taxid ? i : -1)).filter((i) => i >= 0);
    if (from === to || from < 0 || to < 0 || from >= slots.length || to >= slots.length) return;
    const sub = slots.map((i) => favs[i]);
    const [item] = sub.splice(from, 1);
    sub.splice(to, 0, item);
    const next = favs.slice();
    slots.forEach((gi, k) => { next[gi] = sub[k]; });
    save(next);
  };
  const clear = (taxid: string) => save(favs.filter((f) => f.taxid !== taxid));
  return <C.Provider value={{ favs, forOrg, has, toggle, remove, move, clear, full }}>{children}</C.Provider>;
}

export function useFavourites(): Ctx {
  return useContext(C) ?? { favs: [], forOrg: () => [], has: () => false, toggle: () => {}, remove: () => {}, move: () => {}, clear: () => {}, full: false };
}

// The favourite bar — centred in the title bar (always rendered so it reserves the middle slot and
// pushes the navigator switch to the right). A background pill marks its position: a ★ on the left, a
// clear-all on the right, and the gene chips in between (min ~3 wide, growing to FAV_MAX). Click a
// chip to jump to that gene; the small ✕ removes one.
// `onPick` decides what a chip click does (the Layout makes it mode-aware: select on the home page,
// navigate on the entry page). Without it, a chip just navigates to the gene's entry.
// `taxid` scopes the bar to one organism — only its favourites show, and reorder/clear act on it alone.
export function FavouriteBar({ onPick, taxid }: { onPick?: (f: Fav) => void; taxid: string }) {
  const { forOrg, remove, move, clear, full } = useFavourites();
  const favs = forOrg(taxid);
  const nav = useNavigate();
  const open = (f: Fav) => (onPick ? onPick(f) : nav(`/o/${f.taxid}/c/${encodeURIComponent(f.chrom)}/entry/${f.uniqID}`));
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  // The insertion gap (0..favs.length) the dragged chip would drop into — drawn as a bar between chips.
  const [overGap, setOverGap] = useState<number | null>(null);
  const Bar = <span className="h-4 w-0.5 shrink-0 self-center rounded bg-amber-400" />;
  return (
    <div className="flex min-w-0 flex-1 justify-center px-2">
      <div className={`inline-flex max-w-full items-center gap-1.5 rounded-full border bg-neutral-100 px-2 py-1 transition-colors ${full ? 'border-red-500' : 'border-transparent'}`}>
        <span title="favourites" aria-hidden className={`shrink-0 text-sm leading-none ${favs.length ? 'text-amber-400' : 'text-neutral-400 dark:text-neutral-500'}`}>{favs.length ? '★' : '☆'}</span>
        <div
          className="flex min-w-[9rem] flex-nowrap items-center justify-center gap-x-2 overflow-x-auto"
          onDragOver={(e) => { if (dragIdx !== null) e.preventDefault(); }}
          onDrop={(e) => { e.preventDefault(); if (dragIdx !== null && overGap !== null) move(taxid, dragIdx, overGap <= dragIdx ? overGap : overGap - 1); setDragIdx(null); setOverGap(null); }}
        >
          {favs.length === 0 ? (
            <span className="text-[11px] text-neutral-400">no favourites yet</span>
          ) : (
            <>
              {favs.map((f, i) => (
                <Fragment key={`${f.taxid}:${f.uniqID}`}>
                  {dragIdx !== null && overGap === i && Bar}
                  <span
                    draggable
                    onDragStart={(e) => { setDragIdx(i); e.dataTransfer.effectAllowed = 'move'; }}
                    onDragOver={(e) => { if (dragIdx === null) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; const r = e.currentTarget.getBoundingClientRect(); const g = e.clientX < r.left + r.width / 2 ? i : i + 1; if (overGap !== g) setOverGap(g); }}
                    onDragEnd={() => { setDragIdx(null); setOverGap(null); }}
                    title="drag to reorder"
                    className={`relative inline-flex shrink-0 cursor-grab items-center rounded-full border border-neutral-200 bg-white px-2 py-0.5 text-[11px] hover:bg-neutral-50 ${dragIdx === i ? 'opacity-40' : ''}`}
                  >
                    <button type="button" title={`select ${f.gene || f.uniqID}`} onClick={() => open(f)}
                      className="cursor-pointer font-mono text-neutral-700 hover:text-neutral-900">{f.gene || f.uniqID}</button>
                    <button type="button" title="remove favourite" onClick={() => remove(f.taxid, f.uniqID)}
                      className="absolute -right-0.5 -top-0.5 flex h-2.5 w-2.5 cursor-pointer items-center justify-center rounded-full border border-neutral-300 bg-white text-[6px] leading-none text-neutral-400 shadow-sm hover:border-neutral-400 hover:text-neutral-800">✕</button>
                  </span>
                </Fragment>
              ))}
              {dragIdx !== null && overGap === favs.length && Bar}
            </>
          )}
        </div>
        <button type="button" title="clear this organism's favourites" onClick={() => clear(taxid)} disabled={!favs.length}
          className={`shrink-0 cursor-pointer rounded px-1 text-[10px] transition-colors disabled:cursor-default disabled:opacity-30 ${full ? 'text-red-500' : 'text-neutral-400 hover:text-neutral-700'}`}>clear</button>
      </div>
    </div>
  );
}
