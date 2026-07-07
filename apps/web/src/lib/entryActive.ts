import { createContext, useContext } from 'react';

// True when the surrounding entry view is the one currently on screen. The entry pool keeps recently
// viewed genes mounted (so revisiting is instant + exactly as left), but heavy WebGL viewers (Mol*)
// must render ONLY for the active view — browsers cap live WebGL contexts (~8–16), so ~20 mounted 3D
// viewers would crash. Defaults to true so a viewer used outside the pool still renders normally.
export const EntryActiveContext = createContext(true);
export const useEntryActive = () => useContext(EntryActiveContext);
