import { useEffect, useRef, useState } from 'react';

// In-app "server console": a header toggle that opens a bottom drawer streaming the API server's
// log (via the /api/_logs SSE endpoint). Replaces the need for a visible terminal window in the
// desktop app. Self-contained — connects lazily on first open; the server replays its buffer.
interface LogLine { t: number; level: string; msg: string }

export function ConsolePanel() {
  const [open, setOpen] = useState(false);
  const [started, setStarted] = useState(false);
  const [lines, setLines] = useState<LogLine[]>([]);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!started) return;
    const es = new EventSource('/api/_logs');
    es.onmessage = (e) => {
      try {
        const l = JSON.parse(e.data) as LogLine;
        setLines((prev) => (prev.length > 999 ? [...prev.slice(-999), l] : [...prev, l]));
      } catch { /* ignore malformed frame */ }
    };
    return () => es.close();
  }, [started]);

  // Stick to the bottom as new lines arrive while open.
  useEffect(() => {
    if (open && bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [lines, open]);

  const toggle = () => { setOpen((v) => !v); if (!started) setStarted(true); };
  const levelClass = (lv: string) =>
    lv === 'error' ? 'text-red-400' : lv === 'warn' ? 'text-amber-400' : 'text-neutral-300';
  const hhmmss = (t: number) => new Date(t).toLocaleTimeString();

  return (
    <>
      <button
        type="button"
        onClick={toggle}
        aria-label="server console"
        title="server console"
        className={
          'flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded ' +
          (open ? 'bg-neutral-200 text-neutral-800' : 'text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800')
        }
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <polyline points="4 17 10 11 4 5" />
          <line x1="12" y1="19" x2="20" y2="19" />
        </svg>
      </button>
      {open && (
        <div className="fixed inset-x-0 bottom-0 z-50 h-56 border-t border-neutral-700 bg-neutral-900 text-neutral-200 shadow-[0_-4px_16px_rgba(0,0,0,0.25)]">
          <div className="flex items-center justify-between border-b border-neutral-700 px-3 py-1 text-[11px] text-neutral-400">
            <span className="font-mono">server console</span>
            <div className="flex items-center gap-3">
              <button type="button" onClick={() => setLines([])} className="cursor-pointer hover:text-neutral-100">clear</button>
              <button type="button" onClick={() => setOpen(false)} aria-label="close console" className="cursor-pointer hover:text-neutral-100">✕</button>
            </div>
          </div>
          <div ref={bodyRef} className="h-[calc(14rem-1.75rem)] overflow-auto px-3 py-1.5 font-mono text-[11px] leading-relaxed">
            {lines.length === 0 ? (
              <div className="text-neutral-500">waiting for server output…</div>
            ) : (
              lines.map((l, i) => (
                <div key={i} className="whitespace-pre-wrap break-words">
                  <span className="text-neutral-600">{hhmmss(l.t)} </span>
                  <span className={levelClass(l.level)}>{l.msg}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </>
  );
}
