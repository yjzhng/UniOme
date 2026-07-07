import { useEffect, useRef, useState } from 'react';
import { createPluginUI } from 'molstar/lib/mol-plugin-ui';
import { renderReact18 } from 'molstar/lib/mol-plugin-ui/react18';
import { DefaultPluginUISpec } from 'molstar/lib/mol-plugin-ui/spec';
import type { PluginUIContext } from 'molstar/lib/mol-plugin-ui/context';
import { Script } from 'molstar/lib/mol-script/script';
import { MolScriptBuilder as MS } from 'molstar/lib/mol-script/language/builder';
import { StructureSelection, StructureElement, StructureProperties } from 'molstar/lib/mol-model/structure';
import { OrderedSet } from 'molstar/lib/mol-data/int';
import {
  setStructureOverpaint,
  clearStructureOverpaint,
} from 'molstar/lib/mol-plugin-state/helpers/structure-overpaint';
import { Color } from 'molstar/lib/mol-util/color';
import { useDarkMode } from '../lib/theme';
import 'molstar/build/viewer/molstar.css';

export interface DomainColor {
  id: string;
  segments: Array<[number, number]>;
  color: string; // hex like "#2563eb"
  label?: string; // friendly name for the hover label (defaults to id)
  // Subunit mode: when set, this entry selects a whole chain (auth/label asym id) instead of
  // residue ranges — so the same light/dark/faded highlight logic colours complex subunits.
  chain?: string;
  // Ligand mode: when set, this entry selects every instance of a chemical component
  // (label_comp_id), so bound ligands can be coloured/highlighted like subunits.
  comp?: string;
}

// A subunit of a complex structure, emitted up so the panel can build the subunit table/tracks.
export interface Subunit {
  chain: string; // auth_asym_id
  label: string; // entity description (molecule name) or the chain id
  length: number; // max auth_seq_id in the chain (the track axis length)
}

// A bound ligand (non-polymer chemical component) of a complex structure.
export interface Ligand {
  comp: string; // label_comp_id, e.g. "ADP"
  count: number; // number of copies in the structure
}

// A subunit's contact residues (within 5 Å), split by what they interact with.
export interface ChainContacts {
  protein: Array<[number, number]>; // residues near another protein chain
  nucleic: Array<[number, number]>; // residues near a nucleic-acid chain
  ligand: Array<[number, number]>; // residues near a ligand
}

interface Props {
  structureUrl: string;
  // Hover/highlight units (domains, pLDDT regions, or — in subunit mode — chains): hovering one
  // brightens it and fades the rest; the hovered unit's id is reported back.
  domains: DomainColor[];
  // Optional full-coverage base colouring (the pLDDT heatmap). When given, the whole
  // model is painted by these; `domains` are used only for the hover highlight on top.
  baseColors?: DomainColor[];
  hovered: string | null;
  onHover: (id: string | null) => void;
  onHoverResidue?: (res: number | null) => void;
  // Per-residue pLDDT (AlphaFold confidence, stored in the B-factor column), indexed
  // by auth_seq_id. Emitted once the structure has loaded.
  onPlddt?: (byResidue: Array<number | undefined>) => void;
  // Subunit mode (complex assemblies): the chains + bound ligands of the loaded structure.
  onSubunits?: (subunits: Subunit[]) => void;
  onLigands?: (ligands: Ligand[]) => void;
  // The selected subunit's chain: its contact residues get the 3D emphasis. `interfaceChains`
  // lists chains whose contact ranges should be computed + reported (for the per-subunit tracks).
  // Contacts (within 5 Å) are split into protein / nucleic / ligand interacting.
  interfaceChain?: string | null;
  interfaceChains?: string[];
  onContacts?: (chain: string, contacts: ChainContacts) => void;
  // Hovering a specific contact track emphasises just that kind's residues for that chain, in the
  // given colour (overrides the whole-subunit emphasis from `interfaceChain`).
  emphasis?: { chain: string; kind: 'protein' | 'nucleic' | 'ligand'; color: string } | null;
  // Tailwind height class for the viewer box (default 'h-72'). Lets callers (e.g. the RNA
  // panel) match the 2D box height without affecting the protein viewer.
  heightClass?: string;
  // When set, render only this chain (auth/label asym id) instead of the full assembly —
  // for RNA structures that are whole complexes containing the RNA as one chain.
  chain?: string | null;
}

const INTERFACE_COLOR = Color(0xb91c1c); // interface residues emphasised within a subunit

const BASE_GRAY = 0xd4d4d4;

// Mix a hex colour toward a target (0xffffff / 0x000000) by amt (0..1) → Mol* Color.
function mix(hex: string, target: number, amt: number): number {
  const n = parseInt(hex.replace('#', ''), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const t = [(target >> 16) & 255, (target >> 8) & 255, target & 255];
  const m = c.map((v, i) => Math.round(v + (t[i] - v) * amt));
  return (m[0] << 16) | (m[1] << 8) | m[2];
}
// Domains sit in a light tint; the hovered one darkens for a clear pop while the
// rest fade further back so only the active domain stands out.
const lightColor = (hex: string) => Color(mix(hex, 0xffffff, 0.5));
const darkColor = (hex: string) => Color(mix(hex, 0x000000, 0.12));
const fadedColor = (hex: string) => Color(mix(hex, 0xffffff, 0.82));
const solidColor = (hex: string) => Color(parseInt(hex.replace('#', ''), 16));

// Loci for a set of residue ranges (auth_seq_id matches UniProt/TED numbering).
function rangeLoci(structure: any, segments: Array<[number, number]>) {
  const sel = Script.getStructureSelection(
    (Q) =>
      Q.struct.generator.atomGroups({
        'residue-test': Q.core.logic.or(
          segments.map(([s, e]) =>
            Q.core.rel.inRange([Q.struct.atomProperty.macromolecular.auth_seq_id(), s, e])
          )
        ),
      }),
    structure
  );
  return StructureSelection.toLociWithSourceUnits(sel);
}

// Loci for a whole chain (matched by author or label asym id).
function chainLoci(structure: any, chain: string) {
  const sel = Script.getStructureSelection(
    (Q) =>
      Q.struct.generator.atomGroups({
        'chain-test': Q.core.logic.or([
          Q.core.rel.eq([Q.struct.atomProperty.macromolecular.auth_asym_id(), chain]),
          Q.core.rel.eq([Q.struct.atomProperty.macromolecular.label_asym_id(), chain]),
        ]),
      }),
    structure
  );
  return StructureSelection.toLociWithSourceUnits(sel);
}

// Loci for every instance of a chemical component (a bound ligand).
function compLoci(structure: any, comp: string) {
  const sel = Script.getStructureSelection(
    (Q) => Q.struct.generator.atomGroups({ 'residue-test': Q.core.rel.eq([Q.struct.atomProperty.macromolecular.label_comp_id(), comp]) }),
    structure
  );
  return StructureSelection.toLociWithSourceUnits(sel);
}

// The colouring loci for a DomainColor: a ligand component, a whole chain, else residue ranges.
const lociFor = (structure: any, d: DomainColor) =>
  d.comp ? compLoci(structure, d.comp) : d.chain ? chainLoci(structure, d.chain) : rangeLoci(structure, d.segments);

const SUBTYPE_PROTEIN = ['polypeptide(L)', 'polypeptide(D)'];
const SUBTYPE_NUCLEIC = ['polyribonucleotide', 'polydeoxyribonucleotide', 'polydeoxyribonucleotide/polyribonucleotide hybrid', 'peptide nucleic acid'];

// Loci for a chain's contact residues (within `radius` Å, whole residues), by interaction kind:
//  • protein/nucleic — polymer residues of `chain` near ANOTHER chain of that subtype
//  • ligand          — polymer residues of `chain` near any non-polymer (ligand) atom
function contactLoci(structure: any, chain: string, kind: 'protein' | 'nucleic' | 'ligand', radius = 5) {
  const prop = (Q: any) => Q.struct.atomProperty.macromolecular;
  const inChain = (Q: any) =>
    Q.struct.generator.atomGroups({ 'chain-test': Q.core.rel.eq([prop(Q).auth_asym_id(), chain]), 'entity-test': Q.core.rel.eq([prop(Q).entityType(), 'polymer']) });
  const target = (Q: any) => {
    if (kind === 'ligand') {
      return Q.struct.generator.atomGroups({ 'entity-test': Q.core.logic.and([Q.core.rel.neq([prop(Q).entityType(), 'polymer']), Q.core.rel.neq([prop(Q).entityType(), 'water'])]) });
    }
    const subs = kind === 'protein' ? SUBTYPE_PROTEIN : SUBTYPE_NUCLEIC;
    return Q.struct.generator.atomGroups({
      'chain-test': Q.core.rel.neq([prop(Q).auth_asym_id(), chain]),
      'entity-test': Q.core.logic.or(subs.map((s) => Q.core.rel.eq([prop(Q).entitySubtype(), s]))),
    });
  };
  const sel = Script.getStructureSelection(
    // `within`/`wholeResidues` take a `{ 0: <query>, … }` dict; Mol*'s within types are incomplete.
    (Q) => Q.struct.modifier.wholeResidues({ 0: (Q.struct.filter.within as any)({ 0: inChain(Q), target: target(Q), 'max-radius': radius }) }),
    structure
  );
  return StructureSelection.toLociWithSourceUnits(sel);
}

// Loci for ALL of a chain's contact residues (near anything that isn't this chain or water) —
// the 3D emphasis when a subunit is selected.
function allContactLoci(structure: any, chain: string, radius = 5) {
  const prop = (Q: any) => Q.struct.atomProperty.macromolecular;
  const inChain = (Q: any) =>
    Q.struct.generator.atomGroups({ 'chain-test': Q.core.rel.eq([prop(Q).auth_asym_id(), chain]), 'entity-test': Q.core.rel.eq([prop(Q).entityType(), 'polymer']) });
  const others = (Q: any) =>
    Q.struct.generator.atomGroups({ 'chain-test': Q.core.rel.neq([prop(Q).auth_asym_id(), chain]), 'entity-test': Q.core.rel.neq([prop(Q).entityType(), 'water']) });
  const sel = Script.getStructureSelection(
    (Q) => Q.struct.modifier.wholeResidues({ 0: (Q.struct.filter.within as any)({ 0: inChain(Q), target: others(Q), 'max-radius': radius }) }),
    structure
  );
  return StructureSelection.toLociWithSourceUnits(sel);
}

// Collect the distinct auth_seq_id of a loci into ascending contiguous ranges.
function lociResidueRanges(loci: any): Array<[number, number]> {
  if (!loci || loci.kind !== 'element-loci') return [];
  const seqs = new Set<number>();
  const loc = StructureElement.Location.create(loci.structure);
  for (const e of loci.elements) {
    loc.unit = e.unit;
    OrderedSet.forEach(e.indices, (idx: number) => {
      loc.element = e.unit.elements[idx];
      seqs.add(StructureProperties.residue.auth_seq_id(loc));
    });
  }
  const sorted = [...seqs].sort((a, b) => a - b);
  const ranges: Array<[number, number]> = [];
  for (const s of sorted) {
    const last = ranges[ranges.length - 1];
    if (last && s === last[1] + 1) last[1] = s;
    else ranges.push([s, s]);
  }
  return ranges;
}

export default function MolstarViewer({
  structureUrl,
  domains,
  baseColors,
  hovered,
  onHover,
  onHoverResidue,
  onPlddt,
  onSubunits,
  onLigands,
  interfaceChain = null,
  interfaceChains,
  onContacts,
  emphasis = null,
  heightClass = 'h-72',
  chain = null,
}: Props) {
  const parentRef = useRef<HTMLDivElement>(null);
  const pluginRef = useRef<PluginUIContext | null>(null);
  const structureRef = useRef<any>(null);
  // Latest domains, read inside the hover subscription without re-subscribing.
  const domainsRef = useRef<DomainColor[]>(domains);
  domainsRef.current = domains;
  const onHoverRef = useRef(onHover);
  onHoverRef.current = onHover;
  const onHoverResidueRef = useRef(onHoverResidue);
  onHoverResidueRef.current = onHoverResidue;
  const onPlddtRef = useRef(onPlddt);
  onPlddtRef.current = onPlddt;
  const onSubunitsRef = useRef(onSubunits);
  onSubunitsRef.current = onSubunits;
  const onContactsRef = useRef(onContacts);
  onContactsRef.current = onContacts;
  const onLigandsRef = useRef(onLigands);
  onLigandsRef.current = onLigands;
  const interfaceChainsKey = (interfaceChains ?? []).join(',');
  // Cache of computed contacts per chain (lazy: only the rep/selected chains computed).
  const contactsCacheRef = useRef<Map<string, ChainContacts>>(new Map());
  // Flips true once the structure is loaded and the gray base is painted, gating the
  // colouring effect below.
  const [ready, setReady] = useState(false);
  // Match the WebGL canvas background to the app theme (it's not Tailwind, so set it via the API).
  const dark = useDarkMode();
  useEffect(() => { pluginRef.current?.canvas3d?.setProps({ renderer: { backgroundColor: Color(dark ? 0x1a1a1c : 0xffffff) } }); }, [dark, ready]);
  // Colouring state (also reset by the mount cleanup on a new structure).
  const appliedRef = useRef<Map<string, number>>(new Map());
  const paintSigRef = useRef('');
  const setSigRef = useRef('');

  // Mount the plugin + load/colour the structure. Re-runs when the URL changes.
  useEffect(() => {
    if (!parentRef.current) return;
    // Each run gets its own host element so React 18 StrictMode's double-invoke
    // (and any URL change) can't have two plugins racing on one container.
    const host = document.createElement('div');
    host.style.position = 'relative';
    host.style.width = '100%';
    host.style.height = '100%';
    parentRef.current.appendChild(host);

    let disposed = false;
    let localPlugin: PluginUIContext | null = null;
    (async () => {
      const spec = DefaultPluginUISpec();
      const plugin = await createPluginUI({
        target: host,
        spec: {
          ...spec,
          layout: { initial: { isExpanded: false, showControls: false } },
        },
        render: renderReact18,
      });
      localPlugin = plugin;
      if (disposed) {
        plugin.dispose();
        return;
      }
      pluginRef.current = plugin;
      // Replace Mol*'s verbose default hover label (the big "…GLU 298 [+74 residues] |
      // UNP P03004 …" box that obscured the model) with a concise one: just the
      // residue under the cursor, plus its domain when applicable, e.g. "GLU 298 · TED03".
      plugin.managers.lociLabels.clearProviders();
      plugin.managers.lociLabels.addProvider({
        label: (loci: any) => {
          if (loci.kind !== 'element-loci' || StructureElement.Loci.isEmpty(loci)) return undefined;
          const loc = StructureElement.Loci.getFirstLocation(loci);
          if (!loc) return undefined;
          const seq = StructureProperties.residue.auth_seq_id(loc);
          const comp = StructureProperties.atom.label_comp_id(loc);
          const dom = domainsRef.current.find((d) => d.segments.some(([s, en]) => seq >= s && seq <= en));
          return dom ? `${comp} ${seq} · ${dom.label ?? dom.id}` : `${comp} ${seq}`;
        },
      });

      const data = await plugin.builders.data.download({ url: structureUrl, isBinary: true });
      const traj = await plugin.builders.structure.parseTrajectory(data, 'mmcif');

      // Chain isolation: RNA experimental structures are usually whole complexes (a
      // ribosome, an RNA–protein complex) that merely *contain* the RNA of interest as
      // one chain. When `chain` is given, build just that chain; otherwise apply the full
      // default preset (proteins). Both then share the same colour/hover machinery below.
      if (chain) {
        const model = await plugin.builders.structure.createModel(traj);
        const structure = await plugin.builders.structure.createStructure(model);
        const chainExpr = MS.struct.generator.atomGroups({
          // Match either author or label chain id — RNAcentral's PDBe xref chain may be either.
          'chain-test': MS.core.logic.or([
            MS.core.rel.eq([MS.struct.atomProperty.macromolecular.auth_asym_id(), chain]),
            MS.core.rel.eq([MS.struct.atomProperty.macromolecular.label_asym_id(), chain]),
          ]),
        });
        const comp = await plugin.builders.structure.tryCreateComponentFromExpression(
          structure,
          chainExpr,
          'rna-chain',
          { label: `chain ${chain}` }
        );
        if (comp) await plugin.builders.structure.representation.addRepresentation(comp, { type: 'cartoon' });
      } else {
        await plugin.builders.structure.hierarchy.applyPreset(traj, 'default');
        // Guarantee bound ligands are visibly rendered (ball-and-stick) even when the default
        // preset omits them — so complex assemblies show their cofactors/ligands.
        const s0 = plugin.managers.structure.hierarchy.current.structures[0];
        if (s0?.cell) {
          try {
            const lig = await plugin.builders.structure.tryCreateComponentStatic(s0.cell, 'ligand');
            if (lig) {
              await plugin.builders.structure.representation.addRepresentation(lig, { type: 'ball-and-stick' });
              // A faint surface around each ligand to show its pocket-filling shape.
              await plugin.builders.structure.representation.addRepresentation(lig, { type: 'gaussian-surface', typeParams: { alpha: 0.3 } });
            }
          } catch (err) {
            console.error('[MolstarViewer] ligand representation failed', err);
          }
        }
      }

      const struct = plugin.managers.structure.hierarchy.current.structures[0];
      structureRef.current = struct?.cell.obj?.data;
      const components = struct?.components ?? [];

      // Pull per-residue pLDDT from the B-factor column (auth_seq_id-indexed) for the
      // low-confidence-region track. One value per residue — first atom seen wins.
      const structure = structureRef.current;
      if (structure && onPlddtRef.current) {
        const byResidue: Array<number | undefined> = [];
        const loc = StructureElement.Location.create(structure);
        for (const unit of structure.units) {
          loc.unit = unit;
          const { elements } = unit;
          for (let i = 0; i < elements.length; i++) {
            loc.element = elements[i];
            const seq = StructureProperties.residue.auth_seq_id(loc);
            if (byResidue[seq] === undefined) {
              byResidue[seq] = StructureProperties.atom.B_iso_or_equiv(loc);
            }
          }
        }
        onPlddtRef.current(byResidue);
      }

      // Subunit list (complex assemblies): distinct chains, their entity description, and the
      // chain's max residue (track axis length).
      if (structure && (onSubunitsRef.current || onLigandsRef.current)) {
        const info = new Map<string, { label: string; length: number }>(); // polymer chains
        const ligands = new Map<string, number>(); // non-polymer comp → count of residues
        let lastComp = '';
        const loc = StructureElement.Location.create(structure);
        for (const unit of structure.units) {
          loc.unit = unit;
          const { elements } = unit;
          for (let i = 0; i < elements.length; i++) {
            loc.element = elements[i];
            const etype = StructureProperties.entity.type(loc);
            if (etype === 'polymer') {
              const ch = StructureProperties.chain.auth_asym_id(loc);
              const seq = StructureProperties.residue.auth_seq_id(loc);
              let e = info.get(ch);
              if (!e) {
                const desc = StructureProperties.entity.pdbx_description(loc);
                e = { label: (desc && desc[0]) || ch, length: 0 };
                info.set(ch, e);
              }
              if (seq > e.length) e.length = seq;
            } else if (etype !== 'water') {
              // count one per ligand residue (atoms of the same residue share comp+seq+chain)
              const comp = StructureProperties.atom.label_comp_id(loc);
              const key = `${comp}|${StructureProperties.chain.auth_asym_id(loc)}|${StructureProperties.residue.auth_seq_id(loc)}`;
              if (key !== lastComp) { ligands.set(comp, (ligands.get(comp) ?? 0) + 1); lastComp = key; }
            }
          }
        }
        onSubunitsRef.current?.(
          [...info]
            .map(([chain, v]) => ({ chain, label: v.label, length: v.length }))
            .sort((a, b) => a.chain.localeCompare(b.chain, undefined, { numeric: true }))
        );
        onLigandsRef.current?.([...ligands].map(([comp, count]) => ({ comp, count })).sort((a, b) => a.comp.localeCompare(b.comp)));
      }

      // Uniform gray base; the colouring effect below overpaints the active track's
      // spans on top (and re-paints from scratch whenever the track changes).
      await plugin.managers.structure.component.updateRepresentationsTheme(components, {
        color: 'uniform',
        colorParams: { value: Color(BASE_GRAY) },
      });

      // 3D → track: report the domain under the cursor on hover.
      plugin.behaviors.interaction.hover.subscribe((e: any) => {
        const loci = e?.current?.loci;
        if (!loci || loci.kind !== 'element-loci' || StructureElement.Loci.isEmpty(loci)) {
          onHoverRef.current(null);
          onHoverResidueRef.current?.(null);
          return;
        }
        const loc = StructureElement.Loci.getFirstLocation(loci);
        if (!loc) {
          onHoverRef.current(null);
          onHoverResidueRef.current?.(null);
          return;
        }
        const seq = StructureProperties.residue.auth_seq_id(loc);
        const subunitMode = domainsRef.current.some((d) => d.chain || d.comp);
        const id = subunitMode
          ? (StructureProperties.entity.type(loc) === 'polymer'
              ? StructureProperties.chain.auth_asym_id(loc)
              : `lig:${StructureProperties.atom.label_comp_id(loc)}`)
          : domainsRef.current.find((d) => d.segments.some(([s, en]) => seq >= s && seq <= en))?.id ?? null;
        onHoverRef.current(id);
        onHoverResidueRef.current?.(seq);
      });

      // A manually-built single chain isn't auto-framed; reset the camera onto it.
      if (chain) plugin.canvas3d?.requestCameraReset();
      if (!disposed) setReady(true);
    })();

    return () => {
      disposed = true;
      setReady(false);
      appliedRef.current.clear();
      contactsCacheRef.current.clear();
      paintSigRef.current = '';
      setSigRef.current = '';
      (localPlugin ?? pluginRef.current)?.dispose();
      pluginRef.current = null;
      structureRef.current = null;
      host.remove();
    };
  }, [structureUrl, chain]);

  // Colouring + hover sync. Two modes:
  //  • base mode (pLDDT): the whole model is painted faint by `baseColors` (the
  //    confidence heatmap); hovering a region darkens it and fades the rest.
  //  • span mode (domains): each span is light, the hovered one darkens, the rest fade.
  // `paintSig` captures everything that affects the picture (hover + colours), so the
  // frequent re-renders that only change array identity are skipped. On a real change
  // the overpaint is cleared and repainted; in span mode `appliedRef` then lets a hover
  // move repaint just the two affected spans.
  useEffect(() => {
    const plugin = pluginRef.current;
    const structure = structureRef.current;
    if (!ready || !plugin || !structure) return;
    const components = plugin.managers.structure.hierarchy.current.structures[0]?.components ?? [];
    const colsSig = (cs: DomainColor[]) => cs.map((d) => `${d.id}:${d.color}`).join('|');
    const setSig = colsSig(domains) + '#' + (baseColors ? colsSig(baseColors) : '');
    const emphSig = emphasis ? `${emphasis.chain}:${emphasis.kind}:${emphasis.color}` : '';
    const paintSig = `${hovered}|${interfaceChain}|${emphSig}@${setSig}`;
    if (paintSig === paintSigRef.current) return; // nothing visible changed
    paintSigRef.current = paintSig;
    const setChanged = setSig !== setSigRef.current;
    setSigRef.current = setSig;

    let cancelled = false;
    (async () => {
      if (baseColors) {
        // Base mode — few segments, so clear + repaint wholesale on each change.
        await clearStructureOverpaint(plugin, components);
        if (cancelled) return;
        appliedRef.current.clear();
        for (const b of baseColors) {
          await setStructureOverpaint(
            plugin,
            components,
            hovered == null ? lightColor(b.color) : fadedColor(b.color),
            async (s) => rangeLoci(s, b.segments)
          );
          if (cancelled) return;
        }
        if (hovered != null) {
          const r = domains.find((d) => d.id === hovered);
          if (r) {
            await setStructureOverpaint(plugin, components, darkColor(r.color), async (s) =>
              rangeLoci(s, r.segments)
            );
          }
        }
        return;
      }

      // Span / subunit mode. On a set change wipe stale colours first, then delta-paint.
      // (In subunit mode each entry carries a `chain` and `lociFor` selects the whole chain.)
      // Subunit mode keeps the selected chain light so its dark interface residues stand out;
      // span mode darkens the hovered span as before.
      const subunitMode = domains.some((d) => d.chain || d.comp);
      const target = (d: DomainColor) =>
        // Ligands stay solid (vivid) so they're always visible; darken when selected.
        d.comp
          ? d.id === hovered ? darkColor(d.color) : solidColor(d.color)
          : hovered == null
            ? lightColor(d.color)
            : d.id === hovered
              ? subunitMode ? lightColor(d.color) : darkColor(d.color)
              : fadedColor(d.color);
      if (setChanged) {
        await clearStructureOverpaint(plugin, components);
        if (cancelled) return;
        appliedRef.current.clear();
      }
      for (const d of domains) {
        const col = target(d);
        // Always repaint when a subunit is emphasised (it may have overpainted a chain last run).
        if (!interfaceChain && appliedRef.current.get(d.id) === col) continue;
        appliedRef.current.set(d.id, col);
        await setStructureOverpaint(plugin, components, col, async (s) => lociFor(s, d));
        if (cancelled) return;
      }
      // Hovering a specific contact track emphasises just that kind's residues (in the track
      // colour); otherwise a selected subunit emphasises all its contact residues (its colour).
      if (emphasis) {
        try {
          await setStructureOverpaint(plugin, components, solidColor(emphasis.color), async (s) => contactLoci(s, emphasis.chain, emphasis.kind));
          if (cancelled) return;
        } catch (err) {
          console.error('[MolstarViewer] contact emphasis failed', emphasis, err);
        }
      } else if (interfaceChain && !interfaceChain.startsWith('lig:')) {
        try {
          const sel = domains.find((d) => d.id === interfaceChain);
          await setStructureOverpaint(plugin, components, sel ? darkColor(sel.color) : INTERFACE_COLOR, async (s) => allContactLoci(s, interfaceChain));
          if (cancelled) return;
        } catch (err) {
          console.error('[MolstarViewer] contact emphasis failed for chain', interfaceChain, err);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hovered, domains, baseColors, ready, interfaceChain, emphasis?.chain, emphasis?.kind, emphasis?.color]);

  // Compute + report interface ranges for the per-subunit tracks (one rep chain each). Cached,
  // so each chain is computed once; failures degrade to an empty range list.
  useEffect(() => {
    const structure = structureRef.current;
    if (!ready || !structure || !interfaceChains?.length) return;
    let cancelled = false;
    (async () => {
      for (const ch of interfaceChains) {
        if (cancelled) return;
        if (!contactsCacheRef.current.has(ch)) {
          let contacts: ChainContacts = { protein: [], nucleic: [], ligand: [] };
          try {
            contacts = {
              protein: lociResidueRanges(contactLoci(structure, ch, 'protein')),
              nucleic: lociResidueRanges(contactLoci(structure, ch, 'nucleic')),
              ligand: lociResidueRanges(contactLoci(structure, ch, 'ligand')),
            };
          } catch (err) {
            console.error('[MolstarViewer] contact computation failed for chain', ch, err);
          }
          contactsCacheRef.current.set(ch, contacts);
          onContactsRef.current?.(ch, contacts);
        }
        await Promise.resolve(); // yield between chains so the UI stays responsive
      }
    })();
    return () => { cancelled = true; };
    // interfaceChainsKey captures the set's identity.
  }, [ready, interfaceChainsKey]);

  return <div ref={parentRef} className={`relative ${heightClass} w-full overflow-hidden rounded`} />;
}
