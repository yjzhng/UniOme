import { useCallback, useEffect, useRef, useState } from 'react';

// Shared organism-data download driver: POST to start, then stream progress over SSE. Used for a
// first download (home-page tile) and a re-download/update (settings About) alike — the server
// overwrites the folder + re-stamps the date either way.
export interface Progress { phase: 'downloading' | 'extracting' | 'done' | 'error'; received: number; total: number; message?: string }

export const mb = (b: number) => `${(b / 1_000_000).toFixed(0)} MB`;

export function useOrgDownload(taxid: string, bytes: number | null, onDone: () => void) {
  const [progress, setProgress] = useState<Progress | null>(null);
  const esRef = useRef<EventSource | null>(null);
  useEffect(() => () => esRef.current?.close(), []); // close the stream on unmount
  const start = useCallback(() => {
    setProgress({ phase: 'downloading', received: 0, total: bytes ?? 0 });
    fetch(`/api/organism/${taxid}/download`, { method: 'POST' }).catch(() => {});
    const es = new EventSource(`/api/organism/${taxid}/download/events`);
    esRef.current = es;
    es.onmessage = (e) => {
      let p: Progress;
      try { p = JSON.parse(e.data) as Progress; } catch { return; }
      setProgress(p);
      if (p.phase === 'done') { es.close(); onDone(); window.setTimeout(() => setProgress(null), 1500); } // refresh, then clear
      else if (p.phase === 'error') es.close();
    };
    es.onerror = () => { es.close(); setProgress((p) => p ?? { phase: 'error', received: 0, total: 0, message: 'connection lost' }); };
  }, [taxid, bytes, onDone]);
  return { progress, start };
}

// Full progress bar + status line (home-page download tile).
export function ProgressBar({ progress }: { progress: Progress }) {
  const pct = progress.total > 0 ? Math.min(100, (progress.received / progress.total) * 100) : null;
  const downloading = progress.phase === 'downloading';
  const extracting = progress.phase === 'extracting';
  return (
    <div className="space-y-1">
      <div className="h-1.5 w-full overflow-hidden rounded bg-neutral-200">
        <div className={'h-full bg-neutral-800 transition-[width] duration-200 ' + (extracting && pct == null ? 'animate-pulse w-full' : '')} style={pct != null ? { width: `${pct}%` } : undefined} />
      </div>
      <div className="text-xs text-neutral-500">
        {downloading ? (pct != null ? `Downloading… ${mb(progress.received)} / ${mb(progress.total)} (${pct.toFixed(0)}%)` : `Downloading… ${mb(progress.received)}`)
          : extracting ? 'Extracting…' : 'Done'}
      </div>
    </div>
  );
}

// One-line status for a compact place (settings About): "Downloading 45%" / "Extracting…".
export function progressLabel(progress: Progress): string {
  const pct = progress.total > 0 ? Math.min(100, Math.round((progress.received / progress.total) * 100)) : null;
  if (progress.phase === 'downloading') return pct != null ? `Downloading… ${pct}%` : `Downloading… ${mb(progress.received)}`;
  if (progress.phase === 'extracting') return 'Extracting…';
  if (progress.phase === 'done') return 'Done';
  return progress.message || 'failed';
}
