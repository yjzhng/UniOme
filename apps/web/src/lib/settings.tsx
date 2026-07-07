import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

// User settings for which types of annotation data to show. Persisted to localStorage; every key
// defaults to ON (show everything) so a fresh user sees the full app. The settings window
// (SettingsModal) lists these sections in a left panel and their items as toggles on the right; the
// entry page gates each section/field on the matching key.
export interface DataToggle { key: string; label: string; hint?: string }
export interface SettingsSection { key: string; title: string; items: DataToggle[] }

// Left-panel sections → right-panel toggles. The first item of each section is its master ("show the
// whole section"); the rest are granular data types within it.
export const SETTINGS_SECTIONS: SettingsSection[] = [
  { key: 'home', title: 'Home explorers', items: [
    { key: 'home.coverage', label: 'Annotation coverage' },
    { key: 'home.browser', label: 'Genome browser' },
    { key: 'home.multiome', label: 'Multiome explorer' },
    { key: 'home.relationships', label: 'Gene relationships' },
    { key: 'home.pathway', label: 'Pathway explorer' },
    { key: 'home.regulation', label: 'Regulation explorer' },
  ] },
  { key: 'general', title: 'General', items: [
    { key: 'general', label: 'Show General section' },
    { key: 'function', label: 'Function' },
    { key: 'pathway', label: 'Pathway' },
    { key: 'essentiality', label: 'Essentiality' },
    { key: 'conservation', label: 'Conservation' },
    { key: 'mutation', label: 'Mutation frequency' },
    { key: 'expression', label: 'Expression' },
    { key: 'localisation', label: 'Localisation' },
  ] },
  { key: 'regulation', title: 'Regulation', items: [
    { key: 'regulation', label: 'Show Regulation section' },
    { key: 'operon', label: 'Operon' },
    { key: 'regulon', label: 'Regulon' },
    { key: 'sigmulon', label: 'Sigmulon' },
    { key: 'modulon', label: 'Modulon' },
    { key: 'regmap', label: 'Regulatory map' },
  ] },
  { key: 'product', title: 'Gene product', items: [
    { key: 'product', label: 'Structure & sequence viewer' },
  ] },
  { key: 'relationships', title: 'Relationships', items: [
    { key: 'relationships', label: 'Interactions, similarity & networks' },
  ] },
];

const ALL_KEYS = Array.from(new Set(SETTINGS_SECTIONS.flatMap((s) => s.items.map((i) => i.key))));
const STORAGE_KEY = 'uniome.dataSettings';

type State = Record<string, boolean>;

function load(): State {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') as State;
    return { ...saved };
  } catch { return {}; }
}

interface SettingsCtx {
  state: State;
  enabled: (key: string) => boolean;
  toggle: (key: string) => void;
  setAll: (value: boolean) => void;
}

const Ctx = createContext<SettingsCtx | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>(load);
  // Persist on every change. Functional updates below avoid a stale-closure clobber when two toggles
  // fire before a re-render (rapid clicks / Show-all).
  useEffect(() => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* ignore */ } }, [state]);
  // A key is enabled unless explicitly turned off — so new data types default to visible.
  const enabled = useCallback((key: string) => state[key] !== false, [state]);
  const toggle = useCallback((key: string) => setState((prev) => ({ ...prev, [key]: prev[key] === false })), []);
  const setAll = useCallback((value: boolean) => setState(Object.fromEntries(ALL_KEYS.map((k) => [k, value]))), []);
  const value = useMemo(() => ({ state, enabled, toggle, setAll }), [state, enabled, toggle, setAll]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSettings(): SettingsCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useSettings must be used within a SettingsProvider');
  return c;
}
