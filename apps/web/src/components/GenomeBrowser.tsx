import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useMatch, useNavigate } from 'react-router-dom';
import type { ChromosomeInfo, Feature, FeatureSummary, FeatureType } from '@uniome/shared';
// The shared tab10 theme palette — distinguishable, neutral semantics.
import { PALETTE as CAT_PALETTE, THEME } from '../lib/theme';

const NO_CAT = '—';

type ColorMode = 'type' | 'KG_PC';

function categoryOf(f: { type: FeatureType; KG_PC: string[] }, mode: ColorMode): string {
  if (mode === 'type') return f.type;
  return f.KG_PC[0] ?? NO_CAT;
}

function categoriesOf(f: { type: FeatureType; KG_PC: string[] }, mode: ColorMode): string[] {
  if (mode === 'type') return [f.type];
  return f.KG_PC.length > 0 ? f.KG_PC : [NO_CAT];
}

function colorOf(
  cat: string,
  mode: ColorMode,
  catColors: Map<string, string>,
  typeColors: Map<string, string>
): string {
  if (mode === 'type') return typeColors.get(cat) ?? '#a3a3a3';
  if (cat === NO_CAT) return '#a3a3a3';
  return catColors.get(cat) ?? '#a3a3a3';
}

const TRACK_HEIGHT = 18;
const STRAND_GAP = 4;
const RULER_HEIGHT = 24;
const PADDING = 16;
const MIN_FEATURE_PX = 1;
const FADE_PX = 20;

interface View {
  from: number;
  to: number;
}

function formatBp(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${n}`;
}

function formatTick(value: number, step: number): string {
  if (step >= 1_000_000) {
    const dec = step % 1_000_000 === 0 ? 0 : 1;
    return `${(value / 1_000_000).toFixed(dec)}M`;
  }
  if (step >= 1_000) {
    const dec = step % 1_000 === 0 ? 0 : 1;
    return `${(value / 1_000).toFixed(dec)}k`;
  }
  return value.toLocaleString();
}

function chooseTickStep(spanBp: number, widthPx: number): number {
  const targetTicks = Math.max(4, Math.min(12, Math.floor(widthPx / 90)));
  const rough = spanBp / targetTicks;
  const pow = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / pow;
  const nice = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
  return nice * pow;
}

export default function GenomeBrowser({
  taxid,
  chromosomes,
  activeChromId,
  onSelectChrom,
  condensed = false,
  showTitle = false,
  focusId,
  onPick,
}: {
  taxid: string;
  chromosomes: ChromosomeInfo[];
  activeChromId: string;
  onSelectChrom: (chromId: string) => void;
  condensed?: boolean;
  showTitle?: boolean;
  // Highlight this gene as selected (used on the organism home, where there's no /entry/:id URL).
  focusId?: string;
  // Decouple selection from navigation: when provided, clicking a feature reports it (or null to
  // deselect) instead of navigating. The organism home uses this to select-without-leaving; the
  // entry navigator passes one that navigates. Omitted ⇒ the legacy navigate-to-entry behaviour.
  onPick?: (g: { uniqID: string; gene: string; chrom: string } | null) => void;
}) {
  const chromosome =
    chromosomes.find((c) => c.id === activeChromId) ?? chromosomes[0];
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);

  // Per-chromosome view state, scoped to current taxid.
  const [viewByChrom, setViewByChrom] = useState<Record<string, View>>({});
  const view: View =
    viewByChrom[chromosome.id] ?? { from: 1, to: Math.min(50_000, chromosome.length) };
  const setView = (next: View | ((prev: View) => View)) => {
    setViewByChrom((prev) => {
      const cur = prev[chromosome.id] ?? { from: 1, to: Math.min(50_000, chromosome.length) };
      const v = typeof next === 'function' ? (next as (p: View) => View)(cur) : next;
      return { ...prev, [chromosome.id]: v };
    });
  };

  // Circular topology: the molecule has no ends, so the window may pan past the
  // origin and straddle it. We model a straddling window in an "unwrapped" frame
  // where from ∈ [1, L] and to may exceed L (positions > L wrap back to to - L).
  // Linear chromosomes keep the classic clamped [1, L] window.
  const isCircular = chromosome.topology === 'circular';
  const L = chromosome.length;
  const MIN_VIEW_SPAN = 30;
  const wrapBp = (bp: number) => (((Math.round(bp) - 1) % L) + L) % L + 1;
  // Build a view from a desired left edge + span, honoring topology.
  const makeView = (fromRaw: number, spanRaw: number): View => {
    const span = Math.max(MIN_VIEW_SPAN, Math.min(L, Math.round(spanRaw)));
    if (isCircular) {
      const from = wrapBp(fromRaw);
      return { from, to: from + span - 1 };
    }
    let from = Math.round(fromRaw);
    let to = from + span - 1;
    if (from < 1) { from = 1; to = from + span - 1; }
    if (to > L) { to = L; from = Math.max(1, to - span + 1); }
    return { from, to };
  };

  const [features, setFeatures] = useState<FeatureSummary[]>([]);
  const [hover, setHover] = useState<{ f: FeatureSummary; x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState<{ x: number; from: number; to: number } | null>(null);
  const nav = useNavigate();

  // Smooth zoom: rendered content is frozen at the start view; an SVG transform
  // on the wrapper <g> animates per frame to morph it toward the target view.
  // Transform is React state so it stays in sync with the render cycle (no
  // intermediate paints with a mismatched transform). Continuous gestures
  // (pan/drag/wheel) call setView directly with no animation.
  const animFrameRef = useRef<number | null>(null);
  const prefetchCtrlRef = useRef<AbortController | null>(null);
  const [animFreeze, setAnimFreezeState] = useState<{
    startView: View;
    features: FeatureSummary[];
  } | null>(null);
  const [animTransform, setAnimTransformState] = useState<{ tx: number; scale: number } | null>(
    null
  );
  // Refs mirror the state so effectiveView() always sees the most recent value,
  // even when read inside an event handler whose closure was created before the
  // latest RAF setAnimTransform commit.
  const animFreezeRef = useRef<typeof animFreeze>(null);
  const animTransformRef = useRef<typeof animTransform>(null);
  const setAnimFreeze: typeof setAnimFreezeState = (next) => {
    animFreezeRef.current = typeof next === 'function' ? (next as (p: typeof animFreeze) => typeof animFreeze)(animFreezeRef.current) : next;
    setAnimFreezeState(animFreezeRef.current);
  };
  const setAnimTransform: typeof setAnimTransformState = (next) => {
    animTransformRef.current = typeof next === 'function' ? (next as (p: typeof animTransform) => typeof animTransform)(animTransformRef.current) : next;
    setAnimTransformState(animTransformRef.current);
  };
  const ZOOM_ANIM_MS = 300;

  // Shift a feature's coordinates into the unwrapped frame (used for the low side
  // of an origin-straddling window, which renders at genomic position + L).
  function shiftFeature(f: FeatureSummary, delta: number): FeatureSummary {
    return {
      ...f,
      start: f.start + delta,
      end: f.end + delta,
      ...(f.segments
        ? { segments: f.segments.map(([s, e]) => [s + delta, e + delta] as [number, number]) }
        : {}),
    };
  }

  async function fetchRange(from: number, to: number, signal: AbortSignal): Promise<FeatureSummary[]> {
    const res = await fetch(
      `/api/organism/${taxid}/features?chrom=${encodeURIComponent(chromosome.id)}&from=${Math.round(
        from
      )}&to=${Math.round(to)}`,
      { signal }
    );
    if (!res.ok) return [];
    return (await res.json()) as FeatureSummary[];
  }

  // Fetch the features for a view, transparently handling an origin-straddling
  // circular window by querying both sides of the seam and merging.
  async function fetchFeaturesForView(v: View, signal: AbortSignal): Promise<FeatureSummary[]> {
    if (isCircular && v.to > L) {
      const [hi, lo] = await Promise.all([
        fetchRange(v.from, L, signal),
        fetchRange(1, v.to - L, signal),
      ]);
      // A feature straddling the origin can come back from both queries; keep the
      // high-side copy so each uniqID renders once (stable React key).
      const hiIds = new Set(hi.map((f) => f.uniqID));
      const loOnly = lo.filter((f) => !hiIds.has(f.uniqID)).map((f) => shiftFeature(f, L));
      return [...hi, ...loOnly];
    }
    return fetchRange(v.from, Math.min(L, v.to), signal);
  }

  async function prefetchTargetFeatures(target: View): Promise<FeatureSummary[] | null> {
    const ctrl = new AbortController();
    if (prefetchCtrlRef.current) prefetchCtrlRef.current.abort();
    prefetchCtrlRef.current = ctrl;
    try {
      return await fetchFeaturesForView(target, ctrl.signal);
    } catch {
      return null;
    } finally {
      if (prefetchCtrlRef.current === ctrl) prefetchCtrlRef.current = null;
    }
  }

  // If a zoom animation is in progress, derive the "effective" view that's currently
  // on screen by inverting the active transform. This lets consecutive zoom clicks
  // compound off the current visual state instead of snapping back to the original.
  function effectiveView(): View {
    const f = animFreezeRef.current;
    const t = animTransformRef.current;
    if (f && t) {
      const sSpan = f.startView.to - f.startView.from + 1;
      const curSpan = sSpan / t.scale;
      const curFrom = f.startView.from - (t.tx * curSpan) / innerWidth;
      return {
        from: Math.round(curFrom),
        to: Math.round(curFrom + curSpan - 1),
      };
    }
    return view;
  }

  async function animateView(target: View) {
    // Cancel any in-flight animation BEFORE reading state so the captured
    // effective view reflects the last painted frame.
    if (animFrameRef.current !== null) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    const startView = effectiveView();
    const startSpan = startView.to - startView.from + 1;
    const targetSpan = target.to - target.from + 1;

    // For zoom-out, the target view contains features that aren't in the current
    // features list. Pre-fetch so the animation has everything in place.
    let frozenFeatures = features;
    if (targetSpan > startSpan) {
      const data = await prefetchTargetFeatures(target);
      if (data === null) return; // aborted by a later animateView call
      frozenFeatures = data;
      setFeatures(data);
    }

    setAnimFreeze({ startView, features: frozenFeatures });
    setAnimTransform({ tx: 0, scale: 1 });

    const startTime = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - startTime) / ZOOM_ANIM_MS);
      const e = 1 - Math.pow(1 - p, 3); // ease-out cubic
      // Interpolated "current" view between startView and target.
      const fromI = startView.from + (target.from - startView.from) * e;
      const toI = startView.to + (target.to - startView.to) * e;
      const spanI = toI - fromI + 1;
      // Transform that maps coords rendered in startView's frame onto the
      // current interpolated view's frame: scale by Span_s / Span_i, then
      // translate so startView.from lands at fromI.
      const scale = startSpan / spanI;
      const tx = ((startView.from - fromI) / spanI) * innerWidth;
      if (p < 1) {
        setAnimTransform({ tx, scale });
        animFrameRef.current = requestAnimationFrame(step);
      } else {
        animFrameRef.current = null;
        // Final atomic commit: drop the freeze, swap to live view, clear the
        // transform — all in one React batch so the browser never paints an
        // intermediate frame with mismatched transform.
        setAnimFreeze(null);
        setAnimTransform(null);
        setView(target);
      }
    };
    animFrameRef.current = requestAnimationFrame(step);
  }
  useEffect(() => {
    return () => {
      if (animFrameRef.current !== null) cancelAnimationFrame(animFrameRef.current);
      if (prefetchCtrlRef.current) prefetchCtrlRef.current.abort();
    };
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0].contentRect.width;
      setWidth(Math.max(400, Math.floor(w)));
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // Reset cached views when switching organism.
  useEffect(() => {
    setViewByChrom({});
  }, [taxid]);

  const entryMatch = useMatch('/o/:taxid/c/:chrom/entry/:id');
  const entryId = focusId ?? entryMatch?.params.id;
  const location = useLocation();
  const [selected, setSelected] = useState<Feature | null>(null);
  const [colorMode, setColorMode] = useState<ColorMode>('type');
  const [catList, setCatList] = useState<string[]>([]);
  const [typeList, setTypeList] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch(`/api/organism/${taxid}/categories/KG_PC`).then((r) => (r.ok ? r.json() : [])),
      fetch(`/api/organism/${taxid}/categories/type`).then((r) => (r.ok ? r.json() : [])),
    ])
      .then(([cats, types]: [string[], string[]]) => {
        if (cancelled) return;
        setCatList(cats);
        setTypeList(types);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [taxid]);
  const catColors = useMemo(() => {
    const m = new Map<string, string>();
    catList.forEach((c, i) => m.set(c, CAT_PALETTE[i % CAT_PALETTE.length]));
    return m;
  }, [catList]);
  const typeColors = useMemo(() => {
    const m = new Map<string, string>();
    typeList.forEach((t, i) => m.set(t, CAT_PALETTE[i % CAT_PALETTE.length]));
    return m;
  }, [typeList]);
  const [highlightedCats, setHighlightedCats] = useState<Set<string>>(new Set());
  useEffect(() => setHighlightedCats(new Set()), [colorMode]);
  const catsAlpha = (cs: string[]) =>
    highlightedCats.size === 0 || cs.some((c) => highlightedCats.has(c)) ? 1 : 0.05;

  const STRIPE_BAND = 8;
  const patternId = (colors: string[]) => 'pat-' + colors.map((c) => c.replace('#', '')).join('-');
  const patterns = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const f of features) {
      const cats = categoriesOf(f, colorMode);
      if (cats.length < 2) continue;
      const colors = cats.map((c) => colorOf(c, colorMode, catColors, typeColors));
      const id = patternId(colors);
      if (!m.has(id)) m.set(id, colors);
    }
    return m;
  }, [features, colorMode, catColors]);
  function featureFill(f: FeatureSummary): string {
    const cats = categoriesOf(f, colorMode);
    if (cats.length === 1) return colorOf(cats[0], colorMode, catColors, typeColors);
    const colors = cats.map((c) => colorOf(c, colorMode, catColors, typeColors));
    return `url(#${patternId(colors)})`;
  }
  function toggleCat(c: string) {
    setHighlightedCats((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
  }
  useEffect(() => {
    if (!entryId) {
      setSelected(null);
      return;
    }
    const fromSearch = (location.state as { from?: string } | null)?.from === 'search';
    let cancelled = false;
    fetch(`/api/organism/${taxid}/features/${encodeURIComponent(entryId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((f: Feature | null) => {
        if (cancelled) return;
        setSelected(f);
        if (!f?.coord) return;
        const center = (f.coord.start + f.coord.end) / 2;
        if (fromSearch) {
          const len = f.coord.end - f.coord.start + 1;
          const spanTarget = Math.max(2000, len * 10);
          animateView(makeView(center - spanTarget / 2, spanTarget));
          return;
        }
        // Skip the auto-recenter if any part of the gene is already in view —
        // the user can see the feature they clicked (e.g. when inspecting a
        // boundary at high zoom). Only recenter when the gene is fully off-screen.
        if (f.coord.end >= view.from && f.coord.start <= view.to) return;
        const sp = view.to - view.from + 1;
        animateView(makeView(center - sp / 2, sp));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [entryId, taxid, chromosome.length, location.state]);

  useEffect(() => {
    const ctrl = new AbortController();
    fetchFeaturesForView(view, ctrl.signal)
      .then(setFeatures)
      .catch(() => {});
    return () => ctrl.abort();
  }, [view.from, view.to, taxid, chromosome.id]);

  const innerWidth = width - PADDING * 2;
  const span = view.to - view.from + 1;
  // During a zoom animation, render content in the frozen "start view" coordinate frame.
  // The wrapper <g> gets a transform applied per frame (via animGroupRef) to morph it
  // toward the target view.
  const renderView = animFreeze?.startView ?? view;
  const renderFeatures = animFreeze?.features ?? features;
  const renderSpan = renderView.to - renderView.from + 1;
  const bpToPx = (bp: number) => ((bp - renderView.from) / renderSpan) * innerWidth;

  const tickStep = useMemo(() => chooseTickStep(renderSpan, innerWidth), [renderSpan, innerWidth]);
  const ticks = useMemo(() => {
    const arr: number[] = [];
    if (isCircular && renderView.to > L) {
      // Straddling the origin: anchor ticks to genomic multiples of step on BOTH
      // sides of the seam so the wrapped side reads step/2·step/… (origin-aligned),
      // then map back into the extended frame (low side sits at genomic + L). The
      // origin itself is labelled by the "ori" marker, so the genomic-0 tick is
      // skipped — leaving exactly one step between "ori" and the first tick.
      // Keep the last high-side tick at least half a step clear of the seam so its
      // label doesn't crowd "ori"; likewise the low side starts a full step out.
      const hiFirst = Math.ceil(renderView.from / tickStep) * tickStep;
      for (let g = hiFirst; g <= L - tickStep / 2; g += tickStep) arr.push(g);
      const loEnd = renderView.to - L;
      for (let g = tickStep; g <= loEnd; g += tickStep) arr.push(g + L);
      return arr;
    }
    const first = Math.ceil(renderView.from / tickStep) * tickStep;
    for (let t = first; t <= renderView.to; t += tickStep) arr.push(t);
    return arr;
  }, [renderView.from, renderView.to, tickStep, isCircular, L]);

  const plusRows = renderFeatures.filter((f) => f.strand === '+');
  const minusRows = renderFeatures.filter((f) => f.strand === '-');

  // Ruler is hidden when condensed; collapse its height so the track sits near the top.
  const rulerH = condensed ? 4 : RULER_HEIGHT;
  const plusY = rulerH;
  const minusY = rulerH + TRACK_HEIGHT + STRAND_GAP;
  const totalHeight = rulerH + TRACK_HEIGHT * 2 + STRAND_GAP + PADDING;

  // The edge fade means "there's more sequence beyond this edge". It's suppressed when
  // the whole chromosome is in view (nothing beyond) or when a linear end is reached;
  // on a circular molecule any partial view continues past both edges.
  const wholeVisible = span >= chromosome.length;
  const fadeLeft = !wholeVisible && (isCircular || view.from > 1);
  const fadeRight = !wholeVisible && (isCircular || view.to < chromosome.length);
  function fadeAlpha(innerX: number): number {
    const svgX = innerX + PADDING;
    let a = 1;
    if (fadeRight) {
      const d = width - svgX;
      if (d < FADE_PX) a = Math.min(a, Math.max(0, d / FADE_PX));
    }
    if (fadeLeft) {
      const d = svgX;
      if (d < FADE_PX) a = Math.min(a, Math.max(0, d / FADE_PX));
    }
    return a;
  }

  const svgRef = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    function handler(e: WheelEvent) {
      e.preventDefault();
      const rect = el!.getBoundingClientRect();
      const mx = e.clientX - rect.left - PADDING;
      const ratio = Math.max(0, Math.min(1, mx / innerWidth));
      const cursorBp = view.from + ratio * span;
      const factor = e.deltaY < 0 ? 1 / 1.2 : 1.2;
      const newSpan = Math.max(30, Math.min(chromosome.length, span * factor));
      setView(makeView(cursorBp - ratio * newSpan, newSpan));
    }
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, [view.from, view.to, span, innerWidth, chromosome.length]);

  function onMouseDown(e: React.MouseEvent<SVGSVGElement>) {
    setDragging({ x: e.clientX, from: view.from, to: view.to });
  }
  function onMouseMove(e: React.MouseEvent<SVGSVGElement>) {
    if (!dragging) return;
    const dx = e.clientX - dragging.x;
    const spanPan = dragging.to - dragging.from + 1;
    const dBp = -(dx / innerWidth) * spanPan;
    setView(makeView(dragging.from + dBp, spanPan));
  }
  function onMouseUp() {
    setDragging(null);
  }

  const COORD_RE = /^(\d[\d,]*)\s*(?:[-..]+\s*(\d[\d,]*))?$/;
  const looksLikeCoord = (s: string) => COORD_RE.test(s.trim());
  function jumpToCoord(input: string): boolean {
    const m = COORD_RE.exec(input.trim());
    if (!m) return false;
    const a = Number(m[1].replace(/,/g, ''));
    const b = m[2] ? Number(m[2].replace(/,/g, '')) : a + 5000;
    animateView({ from: Math.max(1, Math.min(a, b)), to: Math.min(chromosome.length, Math.max(a, b)) });
    return true;
  }

  // Combined search/coord input
  const [q, setQ] = useState('');
  const [results, setResults] = useState<FeatureSummary[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchBoxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!q.trim() || looksLikeCoord(q)) {
      setResults([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      const res = await fetch(`/api/organism/${taxid}/search?q=${encodeURIComponent(q)}`, {
        signal: ctrl.signal,
      });
      if (res.ok) setResults(await res.json());
    }, 120);
    return () => {
      ctrl.abort();
      clearTimeout(t);
    };
  }, [q, taxid]);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (searchBoxRef.current && !searchBoxRef.current.contains(e.target as Node)) setSearchOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);
  function pickResult(r: FeatureSummary) {
    setSearchOpen(false);
    setQ('');
    nav(`/o/${taxid}/c/${encodeURIComponent(r.chrom)}/entry/${r.uniqID}`, { state: { from: 'search' } });
  }
  function handleSearchKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return;
    const value = (e.target as HTMLInputElement).value;
    if (looksLikeCoord(value)) {
      if (jumpToCoord(value)) {
        setQ('');
        setSearchOpen(false);
      }
      return;
    }
    if (results.length > 0) pickResult(results[0]);
  }

  // During a zoom animation, override the active chrom's view in the map with
  // the live effective view so the overview band tracks the animation in real time.
  const viewByChromForOverview = animFreeze
    ? { ...viewByChrom, [chromosome.id]: effectiveView() }
    : viewByChrom;

  // One row of feature glyph(s). Multi-segment features (joins / origin-spanning
  // genes) draw one box per block; single-block features fall back to [start,end].
  function renderFeatureRow(f: FeatureSummary, rowY: number) {
    const blocks = f.segments ?? [[f.start, f.end]];
    const rects = blocks.map(([s, e]) => {
      const bx = bpToPx(s);
      return { x: bx, w: Math.max(MIN_FEATURE_PX, bpToPx(e) - bx) };
    });
    const x = Math.min(...rects.map((r) => r.x));
    const xEnd = Math.max(...rects.map((r) => r.x + r.w));
    const w = xEnd - x;
    const cats = categoriesOf(f, colorMode);
    const cAlpha = catsAlpha(cats);
    const interactive = cAlpha === 1;
    // Fade based on the center of the visible portion, not the feature's geometric
    // center. Otherwise a glyph wider than the viewport has its midpoint off-screen
    // and disappears.
    const visLeft = Math.max(0, x);
    const visRight = Math.min(innerWidth, xEnd);
    const alpha = animFreeze
      ? cAlpha
      : visRight > visLeft
        ? fadeAlpha((visLeft + visRight) / 2) * cAlpha
        : 0;
    const showLabel = !animFreeze && f.gene && w >= f.gene.length * 6 + 8;
    const onClick = interactive
      ? () => {
          const deselect = selected?.uniqID === f.uniqID;
          if (onPick) {
            onPick(deselect ? null : { uniqID: f.uniqID, gene: f.gene || f.locus_tag || f.uniqID, chrom: f.chrom });
            return;
          }
          nav(deselect ? `/o/${taxid}/c/${encodeURIComponent(f.chrom)}` : `/o/${taxid}/c/${encodeURIComponent(f.chrom)}/entry/${f.uniqID}`);
        }
      : undefined;
    return (
      <g key={f.uniqID} opacity={alpha}>
        {rects.map((r, i) => (
          <rect
            key={i}
            x={r.x}
            y={rowY + 2}
            width={r.w}
            height={TRACK_HEIGHT - 4}
            fill={featureFill(f)}
            fillOpacity={0.85}
            onMouseEnter={interactive ? (e) => setHover({ f, x: e.clientX, y: e.clientY }) : undefined}
            onMouseMove={interactive ? (e) => setHover({ f, x: e.clientX, y: e.clientY }) : undefined}
            onMouseLeave={interactive ? () => setHover(null) : undefined}
            onClick={onClick}
            pointerEvents={interactive ? 'auto' : 'none'}
            style={{ cursor: interactive ? 'pointer' : 'default' }}
          />
        ))}
        {showLabel && (
          <text
            x={x + w / 2}
            y={rowY + TRACK_HEIGHT / 2 + 3}
            fontSize={9}
            fill="white"
            textAnchor="middle"
            pointerEvents="none"
          >
            {f.gene}
          </text>
        )}
      </g>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-4">
        <OverviewBar
          compact={condensed}
          chromosomes={chromosomes}
          activeChromId={chromosome.id}
          viewByChrom={viewByChromForOverview}
          featuresInActive={features.length}
          onJump={(chromId, ratio) => {
            const c = chromosomes.find((x) => x.id === chromId);
            if (!c) return;
            const v = viewByChrom[c.id] ?? { from: 1, to: Math.min(50_000, c.length) };
            const sp = v.to - v.from + 1;
            const center = Math.round(ratio * c.length);
            const half = Math.round(sp / 2);
            let from: number;
            let to: number;
            if (c.topology === 'circular') {
              // No ends to clamp to — center on the click and let the window wrap.
              from = ((center - half - 1) % c.length + c.length) % c.length + 1;
              to = from + sp - 1;
            } else {
              from = Math.max(1, center - half);
              to = Math.min(c.length, from + sp - 1);
              if (to === c.length) from = Math.max(1, to - sp + 1);
            }
            if (c.id === chromosome.id) {
              animateView({ from, to });
            } else {
              setViewByChrom((prev) => ({ ...prev, [c.id]: { from, to } }));
            }
          }}
          onSetView={(chromId, from, to) =>
            setViewByChrom((prev) => ({ ...prev, [chromId]: { from, to } }))
          }
          onSelectChrom={onSelectChrom}
        />
        <div className="ml-auto flex items-end gap-2 text-xs">
        <div className="relative" ref={searchBoxRef}>
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setSearchOpen(true);
            }}
            onFocus={() => setSearchOpen(true)}
            onKeyDown={handleSearchKey}
            placeholder="gene / locus / id / coord"
            className="w-72 rounded border border-neutral-300 bg-white px-2 py-0.5 text-xs focus:border-neutral-500 focus:outline-none"
          />
          {searchOpen && results.length > 0 && !looksLikeCoord(q) && (
            <ul className="absolute right-0 z-20 mt-1 max-h-80 w-96 overflow-auto rounded border border-neutral-200 bg-white shadow-sm">
              {results.map((r) => (
                <li key={r.uniqID}>
                  <button
                    onClick={() => pickResult(r)}
                    className="flex w-full items-baseline gap-2 px-2 py-1 text-left text-xs hover:bg-neutral-100"
                  >
                    <span className="font-mono font-medium">{r.gene || r.locus_tag || r.uniqID}</span>
                    <span className="text-neutral-500">{r.type}</span>
                    <span className="font-mono text-[10px] text-neutral-400">{r.chrom}</span>
                    <span className="ml-auto truncate text-neutral-600">{r.product}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <button
          onClick={() => animateView({ from: 1, to: chromosome.length })}
          className="rounded border border-neutral-300 px-2 py-0.5 text-xs hover:bg-neutral-100"
        >
          whole
        </button>
        <button
          onClick={() => {
            const ev = effectiveView();
            const evSpan = ev.to - ev.from + 1;
            const ns = Math.max(30, evSpan / 4);
            // Focus on the selected gene only when it would still fit inside the
            // post-zoom view. If the gene is larger than the new view (user is
            // zoomed in inside the gene), respect the current view center so the
            // boundary they're inspecting stays in view.
            const viewCenter = (ev.from + ev.to) / 2;
            const geneMid =
              selected?.coord && selected.chrom === chromosome.id
                ? (selected.coord.start + selected.coord.end) / 2
                : null;
            const geneLen =
              selected?.coord && selected.chrom === chromosome.id
                ? selected.coord.end - selected.coord.start + 1
                : null;
            const c =
              geneMid !== null && geneLen !== null && geneLen <= ns
                ? geneMid
                : viewCenter;
            animateView(makeView(c - ns / 2, ns));
          }}
          className="rounded border border-neutral-300 px-2 py-0.5 text-xs hover:bg-neutral-100"
        >
          +
        </button>
        <button
          onClick={() => {
            const ev = effectiveView();
            const evSpan = ev.to - ev.from + 1;
            const ns = Math.min(chromosome.length, evSpan * 4);
            // Same rule as the + button: focus on the selected gene only when it
            // fits in the post-zoom view; otherwise respect the current pan.
            const viewCenter = (ev.from + ev.to) / 2;
            const geneMid =
              selected?.coord && selected.chrom === chromosome.id
                ? (selected.coord.start + selected.coord.end) / 2
                : null;
            const geneLen =
              selected?.coord && selected.chrom === chromosome.id
                ? selected.coord.end - selected.coord.start + 1
                : null;
            const c =
              geneMid !== null && geneLen !== null && geneLen <= ns
                ? geneMid
                : viewCenter;
            animateView(makeView(c - ns / 2, ns));
          }}
          className="rounded border border-neutral-300 px-2 py-0.5 text-xs hover:bg-neutral-100"
        >
          −
        </button>
        </div>
      </div>

      <div className="relative w-full pt-2">
        {/* The rounded border lives on this wrapper, not the <svg>: a CSS width:100% <svg> with a
            differing width attribute is scaled like a replaced element (horizontally, not vertically),
            which would stretch a border-radius set on the svg into an ellipse. overflow-hidden clips
            the track content to the proper rounded corners. */}
        <div ref={containerRef} className="overflow-hidden rounded border border-neutral-200 bg-white">
        <svg
          ref={svgRef}
          width={width}
          height={totalHeight}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={() => {
            setDragging(null);
            setHover(null);
          }}
          className="block w-full select-none"
          style={{ cursor: dragging ? 'grabbing' : 'grab' }}
        >
          <g transform={`translate(${PADDING},0)`}>
            {/* baselines + strand labels stay outside the animation group so they
                always span the full SVG width and stay at fixed pixel sizes. */}
            {!condensed && <line x1={0} x2={innerWidth} y1={RULER_HEIGHT - 4} y2={RULER_HEIGHT - 4} className="stroke-neutral-300" />}
            <line x1={0} x2={innerWidth} y1={plusY + TRACK_HEIGHT / 2} y2={plusY + TRACK_HEIGHT / 2} className="stroke-neutral-200" />
            <line x1={0} x2={innerWidth} y1={minusY + TRACK_HEIGHT / 2} y2={minusY + TRACK_HEIGHT / 2} className="stroke-neutral-200" />
            {!animFreeze && (
              <>
                <text x={-6} y={plusY + TRACK_HEIGHT / 2 + 3} fontSize={10} className="fill-neutral-500" textAnchor="end">+</text>
                <text x={-6} y={minusY + TRACK_HEIGHT / 2 + 3} fontSize={10} className="fill-neutral-500" textAnchor="end">−</text>
              </>
            )}

            {/* animation target: content rendered in renderView's frame; the transform
                animates toward the target view during the animation step. */}
            <g
              transform={
                animTransform
                  ? `translate(${animTransform.tx},0) scale(${animTransform.scale},1)`
                  : undefined
              }
            >
              {selected?.coord && (() => {
                const sx = bpToPx(selected.coord.start);
                const sxEnd = bpToPx(selected.coord.end);
                const sw = Math.max(1, sxEnd - sx);
                return (
                  <rect
                    x={sx}
                    y={0}
                    width={sw}
                    height={totalHeight}
                    fill={colorOf(categoryOf(selected, colorMode), colorMode, catColors, typeColors)}
                    opacity={0.18}
                    onClick={() => (onPick ? onPick(null) : nav(`/o/${taxid}/c/${encodeURIComponent(selected.chrom)}`))}
                    style={{ cursor: 'pointer' }}
                  />
                );
              })()}
              {!condensed && ticks.map((t) => (
                <g key={t} transform={`translate(${bpToPx(t)},0)`}>
                  <line y1={RULER_HEIGHT - 8} y2={RULER_HEIGHT - 4} className="stroke-neutral-400" />
                  {!animFreeze && (
                    <text y={RULER_HEIGHT - 10} fontSize={10} className="fill-neutral-600" textAnchor="middle">
                      {formatTick(isCircular ? wrapBp(t) : t, tickStep)}
                    </text>
                  )}
                </g>
              ))}

              {/* Origin seam: drawn when a circular window straddles the L→1 wrap.
                  Spans the full height so the wrap point is unmistakable. */}
              {isCircular && renderView.to > L && (
                <g transform={`translate(${bpToPx(L + 0.5)},0)`}>
                  <line
                    y1={0}
                    y2={totalHeight}
                    className="stroke-neutral-400"
                    strokeDasharray="3 2"
                  />
                  {!animFreeze && !condensed && (
                    <text y={RULER_HEIGHT - 10} fontSize={9} className="fill-neutral-500" textAnchor="middle">
                      ori
                    </text>
                  )}
                </g>
              )}

              {plusRows.map((f) => renderFeatureRow(f, plusY))}
              {minusRows.map((f) => renderFeatureRow(f, minusY))}
            </g>
          </g>

          <defs>
            <linearGradient id="fadeRight" x1="0" x2="1" y1="0" y2="0">
              <stop offset="0%" stopColor="#737373" stopOpacity="0" />
              <stop offset="100%" stopColor="#737373" stopOpacity="0.7" />
            </linearGradient>
            <linearGradient id="fadeLeft" x1="1" x2="0" y1="0" y2="0">
              <stop offset="0%" stopColor="#737373" stopOpacity="0" />
              <stop offset="100%" stopColor="#737373" stopOpacity="0.7" />
            </linearGradient>
            {Array.from(patterns.entries()).map(([id, colors]) => (
              <pattern
                key={id}
                id={id}
                width={colors.length * STRIPE_BAND}
                height={STRIPE_BAND}
                patternUnits="userSpaceOnUse"
                patternTransform="rotate(45)"
              >
                {colors.map((c, i) => (
                  <rect key={i} x={i * STRIPE_BAND} y={0} width={STRIPE_BAND} height={STRIPE_BAND} fill={c} />
                ))}
              </pattern>
            ))}
          </defs>
          {fadeRight && (
            <rect
              x={width - FADE_PX}
              y={0}
              width={FADE_PX}
              height={totalHeight}
              fill="url(#fadeRight)"
              pointerEvents="none"
            />
          )}
          {fadeLeft && (
            <rect
              x={0}
              y={0}
              width={FADE_PX}
              height={totalHeight}
              fill="url(#fadeLeft)"
              pointerEvents="none"
            />
          )}
        </svg>
        </div>

        {hover && (
          <div
            className="pointer-events-none fixed z-20 rounded border border-neutral-200 bg-white px-2 py-1 text-xs shadow-sm"
            style={{ left: hover.x + 12, top: hover.y + 12 }}
          >
            <div className="font-mono font-semibold">{hover.f.gene || hover.f.locus_tag || hover.f.uniqID}</div>
            <div className="text-neutral-600">{hover.f.product}</div>
            <div className="text-neutral-500">
              {hover.f.type} · {hover.f.start.toLocaleString()}..{hover.f.end.toLocaleString()} ({hover.f.strand})
            </div>
          </div>
        )}
      </div>

      {showTitle && selected && (
        <button
          type="button"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          title="back to top"
          className="flex w-full items-baseline gap-2 border-t border-neutral-200 pt-1.5 text-left text-xs"
        >
          <span className="font-mono text-sm font-semibold text-neutral-900">
            {selected.gene || selected.locus_tag || selected.uniqID}
          </span>
          {selected.locus_tag && selected.locus_tag !== selected.gene && (
            <span className="shrink-0 font-mono text-neutral-400">{selected.locus_tag}</span>
          )}
          <span className="shrink-0 text-neutral-500">{selected.type}</span>
          <span className="truncate text-neutral-600">{selected.product}</span>
          {selected.coord && (
            <span className="ml-auto shrink-0 font-mono text-[11px] text-neutral-400">
              {selected.coord.start.toLocaleString()}..{selected.coord.end.toLocaleString()} ({selected.coord.strand})
            </span>
          )}
        </button>
      )}

      {!condensed && (
        <div className="flex flex-wrap items-center gap-3">
          <ColorModeToggle value={colorMode} onChange={setColorMode} />
          <Legend
            mode={colorMode}
            features={features}
            typeList={typeList}
            highlighted={highlightedCats}
            onToggle={toggleCat}
            catColors={catColors}
            typeColors={typeColors}
          />
        </div>
      )}
    </div>
  );
}

type OverviewDragMode = 'pan' | 'left' | 'right';

const OVERVIEW_REF_WIDTH = 340;
const OVERVIEW_MIN_WIDTH = 80;

function rowWidth(c: ChromosomeInfo, maxLen: number): number {
  if (maxLen <= 1 || c.length <= 1) return OVERVIEW_REF_WIDTH;
  const ratio = Math.log(c.length) / Math.log(maxLen);
  return Math.max(OVERVIEW_MIN_WIDTH, Math.round(OVERVIEW_REF_WIDTH * ratio));
}

function OverviewBar({
  chromosomes,
  activeChromId,
  viewByChrom,
  featuresInActive,
  onJump,
  onSetView,
  onSelectChrom,
  compact = false,
}: {
  chromosomes: ChromosomeInfo[];
  activeChromId: string;
  viewByChrom: Record<string, View>;
  featuresInActive: number;
  onJump: (chromId: string, ratio: number) => void;
  onSetView: (chromId: string, from: number, to: number) => void;
  onSelectChrom: (chromId: string) => void;
  compact?: boolean;
}) {
  const maxLen = Math.max(...chromosomes.map((c) => c.length), 1);
  const maxNameChars = Math.max(...chromosomes.map((c) => c.id.length), 1);
  return (
    <div className="flex flex-col gap-2">
      {chromosomes.map((c) => {
        const w = rowWidth(c, maxLen);
        const active = c.id === activeChromId;
        const v = viewByChrom[c.id] ?? { from: 1, to: Math.min(50_000, c.length) };
        return (
          <OverviewRow
            key={c.id}
            chromosome={c}
            width={w}
            labelChars={maxNameChars}
            view={v}
            active={active}
            featuresInActive={active ? featuresInActive : null}
            onJump={(ratio) => onJump(c.id, ratio)}
            onSetView={(from, to) => onSetView(c.id, from, to)}
            onActivate={() => onSelectChrom(c.id)}
            compact={compact}
          />
        );
      })}
    </div>
  );
}

function OverviewRow({
  chromosome,
  width: W,
  labelChars,
  view,
  active,
  featuresInActive,
  onJump,
  onSetView,
  onActivate,
  compact = false,
}: {
  chromosome: ChromosomeInfo;
  width: number;
  labelChars: number;
  view: View;
  active: boolean;
  featuresInActive: number | null;
  onJump: (ratio: number) => void;
  onSetView: (from: number, to: number) => void;
  onActivate: () => void;
  compact?: boolean;
}) {
  // Compact: just the name + position bar — no ruler/ticks, no summary line.
  const RULER_H = compact ? 0 : 12;
  const BAR_H = 14;
  const GAP = compact ? 0 : 2;
  const H = RULER_H + GAP + BAR_H;
  const MIN_SPAN = 30;
  const HANDLE_W = 6;

  const ticks = useMemo(() => {
    const step = chooseTickStep(chromosome.length, W);
    const arr: number[] = [];
    for (let t = step; t < chromosome.length; t += step) arr.push(t);
    return arr;
  }, [chromosome.length, W]);

  const Lc = chromosome.length;
  const isCirc = chromosome.topology === 'circular';
  const wrap = (bp: number) => (((Math.round(bp) - 1) % Lc) + Lc) % Lc + 1;
  const fromPx = (view.from / Lc) * W;
  const toPx = (view.to / Lc) * W;
  const barY = RULER_H + GAP;
  const barW = Math.max(2, toPx - fromPx);
  // A circular window can straddle the origin (to > L); the viewport band then
  // wraps from the right edge back around to the left.
  const straddle = isCirc && view.to > Lc;
  const pieces = straddle
    ? [
        { x: fromPx, w: Math.max(2, W - fromPx) },
        { x: 0, w: Math.max(2, ((view.to - Lc) / Lc) * W) },
      ]
    : [{ x: fromPx, w: barW }];

  const [drag, setDrag] = useState<{
    mode: OverviewDragMode;
    startClientX: number;
    startFrom: number;
    startTo: number;
    moved: boolean;
  } | null>(null);

  useEffect(() => {
    if (!drag) return;
    function onMove(e: MouseEvent) {
      const dxPx = e.clientX - drag!.startClientX;
      const dxBp = Math.round((dxPx / W) * chromosome.length);
      if (dxPx !== 0) drag!.moved = true;
      let from = drag!.startFrom;
      let to = drag!.startTo;
      if (drag!.mode === 'pan') {
        const span = drag!.startTo - drag!.startFrom;
        if (isCirc) {
          // Wrap around the origin instead of clamping at the ends.
          from = wrap(drag!.startFrom + dxBp);
          to = from + span;
          onSetView(from, to);
          return;
        }
        from = drag!.startFrom + dxBp;
        to = drag!.startTo + dxBp;
        if (from < 1) {
          from = 1;
          to = from + span;
        }
        if (to > chromosome.length) {
          to = chromosome.length;
          from = to - span;
        }
      } else if (drag!.mode === 'left') {
        if (isCirc) {
          // Move the window's start (from ∈ [1, L]); the end (to, possibly > L)
          // stays put. Bound so the span stays within [MIN_SPAN, L].
          const lo = Math.max(1, drag!.startTo - Lc);
          const hi = Math.min(Lc, drag!.startTo - MIN_SPAN);
          from = Math.max(lo, Math.min(hi, drag!.startFrom + dxBp));
        } else {
          from = Math.max(1, Math.min(to - MIN_SPAN, drag!.startFrom + dxBp));
        }
      } else if (drag!.mode === 'right') {
        if (isCirc) {
          // Move the window's end; let it cross the origin (to > L) up to a full turn.
          to = Math.max(drag!.startFrom + MIN_SPAN, Math.min(drag!.startFrom + Lc, drag!.startTo + dxBp));
        } else {
          to = Math.min(chromosome.length, Math.max(from + MIN_SPAN, drag!.startTo + dxBp));
        }
      }
      onSetView(from, to);
    }
    function onUp() {
      setDrag(null);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [drag, W, chromosome.length, onSetView]);

  function startDrag(mode: OverviewDragMode) {
    return (e: React.MouseEvent<SVGElement>) => {
      if (!active) return;
      e.stopPropagation();
      e.preventDefault();
      setDrag({
        mode,
        startClientX: e.clientX,
        startFrom: view.from,
        startTo: view.to,
        moved: false,
      });
    };
  }

  function handleSvgClick(e: React.MouseEvent<SVGSVGElement>) {
    if (drag) return;
    if (!active) {
      onActivate();
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / W));
    onJump(ratio);
  }

  const stopClick = (e: React.MouseEvent) => e.stopPropagation();
  const panCursor = drag?.mode === 'pan' ? 'grabbing' : 'grab';

  return (
    <div
      className="grid items-end gap-x-5 gap-y-1"
      style={{ gridTemplateColumns: 'auto auto' }}
    >
      <button
        type="button"
        onClick={active ? undefined : onActivate}
        style={{ minWidth: `${labelChars}ch` }}
        className={
          'truncate text-left font-mono text-xs leading-none ' +
          (active
            ? 'cursor-default font-semibold text-neutral-900'
            : 'cursor-pointer text-neutral-500 hover:text-neutral-800')
        }
        title={chromosome.topology ? `${chromosome.id} · ${chromosome.topology}` : chromosome.id}
      >
        {chromosome.topology && (
          <span aria-label={chromosome.topology} className="mr-1 text-neutral-400">
            {chromosome.topology === 'circular' ? '◯' : '—'}
          </span>
        )}
        {chromosome.id}
      </button>
      <svg
        width={W}
        height={H}
        onClick={handleSvgClick}
        className={'block ' + (active ? 'cursor-pointer' : 'cursor-pointer')}
        style={{ overflow: 'visible' }}
      >
        {!compact && ticks.map((t) => (
          <g key={t} transform={`translate(${(t / chromosome.length) * W},0)`}>
            <line y1={RULER_H - 6} y2={RULER_H - 2} stroke={active ? '#a3a3a3' : '#d4d4d4'} />
            <text
              y={RULER_H - 7}
              fontSize={9}
              fill={active ? '#737373' : '#a3a3a3'}
              textAnchor="middle"
            >
              {formatBp(t)}
            </text>
          </g>
        ))}
        <rect
          x={0}
          y={barY}
          width={W}
          height={BAR_H}
          className={`${active ? 'fill-neutral-100' : 'fill-neutral-50'} ${active ? 'stroke-neutral-300' : 'stroke-neutral-200'}`}
        />
        {pieces.map((p, i) => (
          <rect
            key={i}
            x={p.x}
            y={barY}
            width={p.w}
            height={BAR_H}
            fill={THEME}
            opacity={active ? 0.7 : 0.25}
            onMouseDown={startDrag('pan')}
            onClick={active ? stopClick : undefined}
            style={{ cursor: active ? panCursor : 'pointer' }}
          />
        ))}
        {/* Resize handles grab the window's start (from) and end (to). When the
            window straddles the origin the two edges live on opposite sides of the
            band: 'from' on the right piece, 'to' on the left piece. */}
        {active && (
          <>
            <rect
              x={fromPx - HANDLE_W / 2}
              y={barY - 1}
              width={HANDLE_W}
              height={BAR_H + 2}
              fill="transparent"
              onMouseDown={startDrag('left')}
              onClick={stopClick}
              style={{ cursor: 'ew-resize' }}
            />
            <rect
              x={(straddle ? ((view.to - Lc) / Lc) * W : fromPx + barW) - HANDLE_W / 2}
              y={barY - 1}
              width={HANDLE_W}
              height={BAR_H + 2}
              fill="transparent"
              onMouseDown={startDrag('right')}
              onClick={stopClick}
              style={{ cursor: 'ew-resize' }}
            />
          </>
        )}
      </svg>
      {!compact && active && featuresInActive !== null && (
        <span className="col-start-2 justify-self-end text-[11px] leading-none text-neutral-500">
          {formatBp(view.to - view.from + 1)}/{formatBp(chromosome.length)} · {featuresInActive}/{chromosome.featureCount}
        </span>
      )}
    </div>
  );
}

function ColorModeToggle({ value, onChange }: { value: ColorMode; onChange: (m: ColorMode) => void }) {
  return (
    <label className="flex items-center gap-1 text-xs text-neutral-600">
      <span className="text-neutral-500">color by</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as ColorMode)}
        className="cursor-pointer rounded border border-neutral-300 bg-white px-1.5 py-0.5 text-xs focus:border-neutral-500 focus:outline-none"
      >
        <option value="type">type</option>
        <option value="KG_PC">KG_PC</option>
      </select>
    </label>
  );
}

function Legend({
  mode,
  features,
  typeList,
  highlighted,
  onToggle,
  catColors,
  typeColors,
}: {
  mode: ColorMode;
  features: FeatureSummary[];
  typeList: string[];
  highlighted: Set<string>;
  onToggle: (c: string) => void;
  catColors: Map<string, string>;
  typeColors: Map<string, string>;
}) {
  const items = useMemo<string[]>(() => {
    if (mode === 'type') return typeList;
    const seen = new Set<string>();
    for (const f of features) for (const c of categoriesOf(f, mode)) seen.add(c);
    return Array.from(seen).sort((a, b) => (a === NO_CAT ? 1 : b === NO_CAT ? -1 : a.localeCompare(b)));
  }, [mode, features, typeList]);
  const anySelected = highlighted.size > 0;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-600">
      {items.map((c) => {
        const active = !anySelected || highlighted.has(c);
        return (
          <button
            key={c}
            type="button"
            onClick={() => onToggle(c)}
            className={
              'flex cursor-pointer items-center gap-1 rounded px-1 py-0.5 hover:bg-neutral-100 ' +
              (active ? '' : 'opacity-40')
            }
            title={c}
          >
            <span className="inline-block h-3 w-3 rounded-sm" style={{ background: colorOf(c, mode, catColors, typeColors) }} />
            <span className="max-w-[180px] truncate">{c}</span>
          </button>
        );
      })}
      {mode === 'KG_PC' && items.length === 0 && (
        <span className="text-neutral-400">no KG_PC annotations in view</span>
      )}
    </div>
  );
}
