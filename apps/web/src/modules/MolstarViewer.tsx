import { useEffect, useRef } from 'react';
import { createPluginUI } from 'molstar/lib/mol-plugin-ui';
import { renderReact18 } from 'molstar/lib/mol-plugin-ui/react18';
import { DefaultPluginUISpec } from 'molstar/lib/mol-plugin-ui/spec';
import type { PluginUIContext } from 'molstar/lib/mol-plugin-ui/context';
import { Script } from 'molstar/lib/mol-script/script';
import { StructureSelection, StructureElement, StructureProperties } from 'molstar/lib/mol-model/structure';
import { setStructureOverpaint } from 'molstar/lib/mol-plugin-state/helpers/structure-overpaint';
import { Color } from 'molstar/lib/mol-util/color';
import 'molstar/build/viewer/molstar.css';

export interface DomainColor {
  id: string;
  segments: Array<[number, number]>;
  color: string; // hex like "#2563eb"
}

interface Props {
  structureUrl: string;
  domains: DomainColor[];
  hovered: string | null;
  onHover: (id: string | null) => void;
  onHoverResidue?: (res: number | null) => void;
}

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

export default function MolstarViewer({
  structureUrl,
  domains,
  hovered,
  onHover,
  onHoverResidue,
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
          return dom ? `${comp} ${seq} · ${dom.id}` : `${comp} ${seq}`;
        },
      });

      const data = await plugin.builders.data.download({ url: structureUrl, isBinary: true });
      const traj = await plugin.builders.structure.parseTrajectory(data, 'mmcif');
      await plugin.builders.structure.hierarchy.applyPreset(traj, 'default');

      const structures = plugin.managers.structure.hierarchy.current.structures;
      const struct = structures[0];
      structureRef.current = struct?.cell.obj?.data;
      const components = struct?.components ?? [];

      // Uniform gray base, then overpaint each domain with its palette colour.
      await plugin.managers.structure.component.updateRepresentationsTheme(components, {
        color: 'uniform',
        colorParams: { value: Color(BASE_GRAY) },
      });
      for (const d of domains) {
        await setStructureOverpaint(
          plugin,
          components,
          lightColor(d.color),
          async (s) => rangeLoci(s, d.segments)
        );
      }

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
        const id =
          domainsRef.current.find((d) => d.segments.some(([s, en]) => seq >= s && seq <= en))?.id ??
          null;
        onHoverRef.current(id);
        onHoverResidueRef.current?.(seq);
      });
    })();

    return () => {
      disposed = true;
      (localPlugin ?? pluginRef.current)?.dispose();
      pluginRef.current = null;
      structureRef.current = null;
      host.remove();
    };
  }, [structureUrl]);

  // Hover sync: with nothing hovered every domain is light; on hover the active one
  // darkens and the rest fade back. Only repaint domains whose target colour changed
  // (tracked in appliedRef) so moving between domains touches just the two affected.
  const appliedRef = useRef<Map<string, number>>(new Map());
  useEffect(() => {
    const plugin = pluginRef.current;
    const structure = structureRef.current;
    if (!plugin || !structure) return;
    const components = plugin.managers.structure.hierarchy.current.structures[0]?.components ?? [];
    const target = (d: DomainColor) =>
      hovered == null ? lightColor(d.color) : d.id === hovered ? darkColor(d.color) : fadedColor(d.color);
    (async () => {
      for (const d of domains) {
        const col = target(d);
        if (appliedRef.current.get(d.id) === col) continue;
        appliedRef.current.set(d.id, col);
        await setStructureOverpaint(plugin, components, col, async (s) => rangeLoci(s, d.segments));
      }
    })();
  }, [hovered, domains]);

  return <div ref={parentRef} className="relative h-72 w-full overflow-hidden rounded" />;
}
