// smiles-drawer ships no types; we use a tiny surface (SvgDrawer + parse).
declare module 'smiles-drawer' {
  const SmilesDrawer: {
    SvgDrawer: new (options?: Record<string, unknown>) => {
      // draw(data, target, themeName?, weights?, infoOnly?, …)
      draw: (tree: unknown, target: SVGElement | string, theme?: string) => void;
    };
    parse: (smiles: string, success: (tree: unknown) => void, error?: (err: unknown) => void) => void;
  };
  export default SmilesDrawer;
}
