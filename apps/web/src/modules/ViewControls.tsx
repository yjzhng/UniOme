import { type MouseEvent as ReactMouseEvent } from 'react';

// Zoom-in / zoom-out / reset-to-fit controls overlaid on a pannable canvas (the network graphs and
// the pathway map). Always shown; reset returns to the auto-fit view.
export function ViewControls({ onZoomIn, onZoomOut, onReset, className = 'right-1 top-1' }: { onZoomIn: () => void; onZoomOut: () => void; onReset: () => void; className?: string }) {
  const btn = 'flex h-5 w-5 items-center justify-center rounded border border-neutral-200 bg-white/90 text-neutral-500 hover:bg-neutral-50 hover:text-neutral-800';
  const click = (fn: () => void) => (e: ReactMouseEvent) => { e.stopPropagation(); fn(); };
  return (
    <div className={`absolute z-10 flex flex-col gap-0.5 ${className}`}>
      <button type="button" title="zoom in" onClick={click(onZoomIn)} className={btn}>
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><line x1="6" y1="2.5" x2="6" y2="9.5" /><line x1="2.5" y1="6" x2="9.5" y2="6" /></svg>
      </button>
      <button type="button" title="zoom out" onClick={click(onZoomOut)} className={btn}>
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><line x1="2.5" y1="6" x2="9.5" y2="6" /></svg>
      </button>
      <button type="button" title="reset view" onClick={click(onReset)} className={btn}>
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 4V2.4A.4.4 0 0 1 2.4 2H4M8 2h1.6a.4.4 0 0 1 .4.4V4M10 8v1.6a.4.4 0 0 1-.4.4H8M4 10H2.4a.4.4 0 0 1-.4-.4V8" /></svg>
      </button>
    </div>
  );
}
