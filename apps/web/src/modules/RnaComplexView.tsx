import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import type { ProteinComplex, ComplexChainMap } from '@uniome/shared';
import type { DomainColor, Subunit, Ligand, ChainContacts } from './MolstarViewer';
import { paletteHex, SubunitSection, SubunitTable } from './ProteinDomainViewer';

const MolstarViewer = lazy(() => import('./MolstarViewer'));
const STRUCT_H = 'h-[26rem]';

type Emphasis = { chain: string; kind: 'protein' | 'nucleic' | 'ligand'; color: string } | null;

// RNA complex view: the Mol* subunit viewer + per-subunit contact tracks + chain table for ONE
// complex (selection lives in the RNA panel, matching the protein heuristic). Reuses the shared
// SubunitSection / SubunitTable and the MolstarViewer subunit mode.
export function RnaComplexView({ taxid, chrom, active }: { taxid: string; chrom: string; active: ProteinComplex }) {
  const viewerUrl = active?.pdbId ? `/api/organism/${taxid}/protein/complex-structure/${active.pdbId}` : null;

  const [subunits, setSubunits] = useState<Subunit[]>([]);
  const [ligands, setLigands] = useState<Ligand[]>([]);
  const [subHover, setSubHover] = useState<string | null>(null);
  const [subLock, setSubLock] = useState<string | null>(null);
  const [contactsByChain, setContactsByChain] = useState<Record<string, ChainContacts>>({});
  const [contactEmphasis, setContactEmphasis] = useState<Emphasis>(null);
  const [chainMap, setChainMap] = useState<ComplexChainMap>({});

  useEffect(() => {
    setSubunits([]); setLigands([]); setSubHover(null); setSubLock(null); setContactsByChain({}); setContactEmphasis(null);
  }, [viewerUrl]);
  useEffect(() => {
    const pdb = active?.pdbId;
    if (!pdb) { setChainMap({}); return; }
    let cancelled = false;
    fetch(`/api/organism/${taxid}/protein/complex-chains/${pdb}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => !cancelled && setChainMap(d ?? {}))
      .catch(() => {});
    return () => { cancelled = true; };
  }, [active?.pdbId, taxid]);

  const selectedSubunit = subHover ?? subLock;
  const uniqueSubunits = useMemo(() => {
    const m = new Map<string, { key: string; label: string; gene: string | null; uniqID: string | null; chains: string[]; length: number; colorIndex: number }>();
    for (const s of subunits) {
      const mp = chainMap[s.chain];
      const key = mp?.gene || s.label || s.chain;
      let e = m.get(key);
      if (!e) { e = { key, label: s.label, gene: mp?.gene ?? null, uniqID: mp?.uniqID ?? null, chains: [], length: 0, colorIndex: m.size }; m.set(key, e); }
      e.chains.push(s.chain); e.length = Math.max(e.length, s.length);
    }
    return [...m.values()];
  }, [subunits, chainMap]);
  const chainColor = useMemo(() => {
    const m = new Map<string, string>();
    uniqueSubunits.forEach((u) => u.chains.forEach((c) => m.set(c, paletteHex(u.colorIndex))));
    return m;
  }, [uniqueSubunits]);
  const subunitColors = useMemo<DomainColor[]>(
    () => subunits.map((s) => ({ id: s.chain, chain: s.chain, color: chainColor.get(s.chain) ?? paletteHex(0), label: s.label, segments: [] })),
    [subunits, chainColor]
  );
  const ligandColor = useMemo(() => {
    const m = new Map<string, string>();
    ligands.forEach((l, i) => m.set(l.comp, paletteHex(uniqueSubunits.length + i)));
    return m;
  }, [ligands, uniqueSubunits.length]);
  const viewerDomains = useMemo<DomainColor[]>(
    () => [...subunitColors, ...ligands.map((l) => ({ id: `lig:${l.comp}`, comp: l.comp, color: ligandColor.get(l.comp) ?? '#b45309', label: l.comp, segments: [] }))],
    [subunitColors, ligands, ligandColor]
  );
  const interfaceChainsToCompute = useMemo(() => uniqueSubunits.slice(0, 24).map((u) => u.chains[0]), [uniqueSubunits]);

  return (
    <div className="space-y-2">
      {viewerUrl ? (
        <Suspense fallback={<div className={`flex ${STRUCT_H} items-center justify-center rounded bg-neutral-50 text-xs italic text-neutral-400`}>loading 3D viewer…</div>}>
          <MolstarViewer
            structureUrl={viewerUrl}
            heightClass={STRUCT_H}
            domains={viewerDomains}
            hovered={selectedSubunit}
            onHover={setSubHover}
            onSubunits={setSubunits}
            onLigands={setLigands}
            interfaceChain={selectedSubunit}
            interfaceChains={interfaceChainsToCompute}
            onContacts={(ch, c) => setContactsByChain((m) => ({ ...m, [ch]: c }))}
            emphasis={contactEmphasis}
          />
        </Suspense>
      ) : (
        <div className={`flex ${STRUCT_H} items-center justify-center rounded border border-dashed border-neutral-300 bg-neutral-50 text-xs italic text-neutral-400`}>no structure available for this complex</div>
      )}
      <p className="truncate text-[11px] text-neutral-500">
        <a href={active.link} target="_blank" rel="noreferrer" className="underline decoration-neutral-300 hover:decoration-neutral-700">{active.name}</a>
        {active.assembly ? ` · ${active.assembly}` : ''}{active.pdbId ? <> · PDB <span className="font-mono">{active.pdbId}</span></> : ' · no structure'}
      </p>
      {viewerUrl && subunits.length > 0 && (
        <>
          <div className="space-y-2">
            {uniqueSubunits.map((u) => {
              const rep = u.chains[0];
              const isSel = selectedSubunit !== null && u.chains.includes(selectedSubunit);
              const faded = contactEmphasis ? contactEmphasis.chain !== rep : selectedSubunit !== null ? !isSel : false;
              const activeKind = contactEmphasis && contactEmphasis.chain === rep ? contactEmphasis.kind : null;
              return (
                <SubunitSection
                  key={u.key}
                  name={u.gene || u.label}
                  uniqID={u.uniqID}
                  chrom={chrom}
                  chain={rep}
                  color={paletteHex(u.colorIndex)}
                  length={u.length}
                  contacts={contactsByChain[rep]}
                  active={isSel}
                  faded={faded}
                  activeKind={activeKind}
                  onHover={() => setSubHover(rep)}
                  onLeave={() => { setSubHover(null); setContactEmphasis(null); }}
                  onClick={() => setSubLock((cur) => (cur === rep ? null : rep))}
                  onEmphasis={setContactEmphasis}
                />
              );
            })}
          </div>
          <SubunitTable
            subunits={subunits}
            colors={subunitColors}
            ligands={ligands}
            ligandColor={ligandColor}
            contactsByChain={contactsByChain}
            chainMap={chainMap}
            chrom={chrom}
            selected={selectedSubunit}
            onHover={setSubHover}
            onToggle={(c) => setSubLock((cur) => (cur === c ? null : c))}
          />
        </>
      )}
    </div>
  );
}
