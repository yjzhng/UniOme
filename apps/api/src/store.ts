import type { Feature, FeatureSummary } from '@uniome/shared';

function toSummary(f: Feature): FeatureSummary {
  return {
    uniqID: f.uniqID,
    locus_tag: f.locus_tag,
    gene: f.gene,
    product: f.product,
    type: f.type,
    chrom: f.chrom,
    start: f.coord?.start ?? 0,
    end: f.coord?.end ?? 0,
    strand: f.coord?.strand ?? '+',
    KG_PC: f.KG_PC,
    // Only carry per-block geometry when there's more than one block; the renderer
    // falls back to [start,end] otherwise. Lets origin-spanning joins draw as two
    // pieces instead of a bar flattened across the whole molecule.
    ...(f.coord && f.coord.segments.length > 1 ? { segments: f.coord.segments } : {}),
  };
}

export class FeatureStore {
  private byUniqID = new Map<string, Feature>();
  private byLocusTag = new Map<string, Feature>();
  private byUniProtID = new Map<string, Feature>();
  private byGeneID = new Map<string, Feature>();
  private byGene = new Map<string, Feature>();
  private byChrom = new Map<string, Feature[]>();
  readonly all: Feature[];

  constructor(features: Feature[]) {
    this.all = features;
    for (const f of features) {
      this.byUniqID.set(f.uniqID, f);
      if (f.locus_tag) this.byLocusTag.set(f.locus_tag, f);
      if (f.UniProtID) this.byUniProtID.set(f.UniProtID, f);
      if (f.GeneID) this.byGeneID.set(f.GeneID, f);
      if (f.gene) this.byGene.set(f.gene.toLowerCase(), f);
      if (f.chrom && f.coord) {
        let arr = this.byChrom.get(f.chrom);
        if (!arr) {
          arr = [];
          this.byChrom.set(f.chrom, arr);
        }
        arr.push(f);
      }
    }
  }

  find(id: string): Feature | undefined {
    return (
      this.byUniqID.get(id) ??
      this.byLocusTag.get(id) ??
      this.byUniProtID.get(id) ??
      this.byGeneID.get(id) ??
      this.byGene.get(id.toLowerCase())
    );
  }

  inRange(chrom: string, from: number, to: number): FeatureSummary[] {
    const out: FeatureSummary[] = [];
    const list = this.byChrom.get(chrom) ?? [];
    for (const f of list) {
      if (!f.coord) continue;
      // Overlap against each block, not the flattened [start,end] envelope. An
      // origin-spanning join flattens to [1,length] and would otherwise match
      // every window; per-block testing keeps it to the windows it really touches.
      const blocks = f.coord.segments;
      if (!blocks.some(([s, e]) => e >= from && s <= to)) continue;
      out.push(toSummary(f));
    }
    return out;
  }

  search(q: string, limit = 20): FeatureSummary[] {
    const needle = q.toLowerCase();
    const out: FeatureSummary[] = [];
    for (const f of this.all) {
      const hay = `${f.uniqID} ${f.GeneID} ${f.locus_tag} ${f.UniProtID} ${f.gene} ${f.product}`.toLowerCase();
      if (hay.includes(needle)) {
        out.push(toSummary(f));
        if (out.length >= limit) break;
      }
    }
    return out;
  }

  siblings(id: string): Feature[] {
    const base = this.find(id);
    if (!base || !base.locus_tag) return [];
    return this.all.filter((f) => f.locus_tag === base.locus_tag && f.uniqID !== base.uniqID);
  }

  distinct(field: 'KG_PC' | 'type'): string[] {
    const s = new Set<string>();
    if (field === 'type') {
      for (const f of this.all) if (f.type) s.add(f.type);
    } else {
      for (const f of this.all) for (const v of f[field]) s.add(v);
    }
    return Array.from(s).sort((a, b) => a.localeCompare(b));
  }

}
