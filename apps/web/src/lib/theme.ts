import { useEffect, useState } from 'react';

// ── Unified colour theme ─────────────────────────────────────────────────────────────────────────
// One tab10 categorical palette + a primary "theme" hue and four semantic accents, all drawn from
// tab10 so the whole site reads as one family. Where each applies:
//   PALETTE  — genome-browser features, structure-viewer domain/motif tracks, relationship-table categories
//   THEME    — primary hue (tab10 blue)
//   ACCENT1  — genome overview, General-panel level fields (essentiality/mutability/conservedness/
//              expression/function/pathway), variant tracks (protein/RNA/DNA)
//   ACCENT2  — localisation (General field + protein panel)
//   ACCENT3  — intrinsic-disorder (mobiDB IDR) in the structure viewer
//   ACCENT4  — modification tracks (protein PTM, RNA mods, DNA Dam/Dcm)
export const PALETTE = ['#4e79a7', '#f28e2c', '#e15759', '#76b7b2', '#59a14f', '#edc949', '#af7aa1', '#ff9da7', '#9c755f', '#bab0ab'] as const;
export const paletteHex = (i: number) => PALETTE[((i % PALETTE.length) + PALETTE.length) % PALETTE.length];

export const THEME = '#4e79a7';   // tab10 blue
export const ACCENT1 = '#e15759'; // tab10 red
export const ACCENT2 = '#f28e2c'; // tab10 orange
export const ACCENT3 = '#af7aa1'; // tab10 purple
export const ACCENT4 = '#59a14f'; // tab10 green

// mix a #rrggbb hex toward a target hex by fraction t (0..1) — for monochrome intensity ramps
export function mix(hex: string, target: string, t: number): string {
  const a = parseInt(hex.slice(1), 16), b = parseInt(target.slice(1), 16);
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  const r = Math.round(ar + (br - ar) * t), g = Math.round(ag + (bg - ag) * t), bl = Math.round(ab + (bb - ab) * t);
  return `#${((1 << 24) + (r << 16) + (g << 8) + bl).toString(16).slice(1)}`;
}
export const tint = (hex: string, t: number) => mix(hex, '#ffffff', t); // toward white
export const shade = (hex: string, t: number) => mix(hex, '#000000', t); // toward black

// Tracks the current dark-mode state (the `dark` class on <html>, toggled in the header). For
// non-Tailwind surfaces that can't use the palette flip — e.g. the Mol* WebGL canvas or an embedded
// SVG — so they can recolour when the theme toggles. Observes the class via MutationObserver.
export function useDarkMode(): boolean {
  const [dark, setDark] = useState(() => typeof document !== 'undefined' && document.documentElement.classList.contains('dark'));
  useEffect(() => {
    const el = document.documentElement;
    const obs = new MutationObserver(() => setDark(el.classList.contains('dark')));
    obs.observe(el, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);
  return dark;
}
