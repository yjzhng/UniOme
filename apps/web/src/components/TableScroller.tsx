import { useEffect, useRef, useState } from 'react';

// Scrollable container for a detail <table>. Gives any child table an opaque sticky header
// (the background must sit on the <th> cells, applied here via arbitrary variants, or rows
// bleed through the header on scroll) plus grey scroll-fade affordances at the top/bottom
// edges signalling "more rows beyond". Shared by the protein and RNA feature tables.
export function TableScroller({ children, maxH = 'max-h-56' }: { children: React.ReactNode; maxH?: string }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ up: false, down: false });
  const [headerH, setHeaderH] = useState(0);

  const update = () => {
    const el = scrollRef.current;
    if (!el) return;
    const up = el.scrollTop > 1;
    const down = Math.ceil(el.scrollTop + el.clientHeight) < el.scrollHeight - 1;
    setEdge((prev) => (prev.up === up && prev.down === down ? prev : { up, down }));
    const h = (el.querySelector('thead') as HTMLElement | null)?.offsetHeight ?? 0;
    setHeaderH((prev) => (prev === h ? prev : h));
  };

  // Recompute on content changes (the guarded setStates above avoid a render loop) and on
  // resize. Scroll is handled by the inline onScroll.
  useEffect(() => {
    update();
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  });

  return (
    <div className="relative">
      <div
        ref={scrollRef}
        onScroll={update}
        className={`${maxH} overflow-auto rounded border border-neutral-200 [&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:border-b [&_th]:border-neutral-200 [&_th]:bg-neutral-50 [&_td:first-child]:pl-2 [&_th:first-child]:pl-2 [&_td:last-child]:pr-2 [&_th:last-child]:pr-2`}
      >
        {children}
      </div>
      {edge.up && <div className="pointer-events-none absolute inset-x-0 h-4 bg-gradient-to-b from-neutral-200 to-transparent" style={{ top: headerH }} />}
      {edge.down && <div className="pointer-events-none absolute inset-x-0 bottom-0 h-4 rounded-b bg-gradient-to-t from-neutral-200 to-transparent" />}
    </div>
  );
}
