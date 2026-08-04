import { useEffect, useState } from 'react';

// Per-organism data "version" (a date) + whether the Release has newer data than this install has.
// local = when this install downloaded the org (from /api/catalog's dataDate, stamped on download).
// latest = the release asset's updatedAt (bumps when the maintainer re-uploads <folder>.tar.gz).
const REPO = 'yjzhng/UniOme';

export interface OrgDataStatus {
  taxid: string;
  label: string;
  bytes: number | null;
  localDate: string | null;
  latestDate: string | null;
  updateAvailable: boolean;
}

interface CatalogRow {
  taxid: string; status: string; folder: string; dataDate: string | null; bytes: number | null;
  shortName: string | null; name: string | null; nickname: string | null;
}

// `active` gates the fetch so it only runs while the About tab is open. `reload` re-runs it (e.g. after
// an update finishes, so the row's date/flag refresh).
export function useDataStatus(active: boolean): { rows: OrgDataStatus[] | null; reload: () => void } {
  const [rows, setRows] = useState<OrgDataStatus[] | null>(null);
  const [nonce, setNonce] = useState(0);
  const reload = () => setNonce((n) => n + 1);
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    (async () => {
      try {
        const cat = (await (await fetch('/api/catalog')).json()) as CatalogRow[];
        const ready = cat.filter((o) => o.status === 'ready');
        const assetDate: Record<string, string> = {};
        try {
          const rel = await (await fetch(`https://api.github.com/repos/${REPO}/releases/tags/assets`, { headers: { Accept: 'application/vnd.github+json' } })).json();
          for (const a of (rel?.assets ?? []) as { name: string; updated_at: string }[]) assetDate[a.name] = a.updated_at;
        } catch { /* offline → no latest, so nothing flagged */ }
        const out: OrgDataStatus[] = ready.map((o) => {
          const latestDate = assetDate[`${o.folder}.tar.gz`] ?? null;
          const localDate = o.dataDate ?? null;
          const updateAvailable = !!latestDate && !!localDate && new Date(latestDate).getTime() > new Date(localDate).getTime();
          return { taxid: o.taxid, label: o.shortName || o.name || o.nickname || o.taxid, bytes: o.bytes, localDate, latestDate, updateAvailable };
        });
        if (!cancelled) setRows(out);
      } catch { if (!cancelled) setRows([]); }
    })();
    return () => { cancelled = true; };
  }, [active, nonce]);
  return { rows, reload };
}
