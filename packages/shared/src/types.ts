import type { ParsedCoord } from './coord.js';

export type FeatureType = string;

export type GeneticLevel = 'DNA' | 'RNA' | 'PROT';

// Derived from the type name so new feature types (data-driven) just work:
//   CDS                            → DNA + RNA + Protein
//   *RNA  (rRNA, tRNA, ncRNA, …)  → DNA + RNA
//   anything else                  → DNA only
// If a future type needs an exception, override here.
export function typeLevels(type: string): GeneticLevel[] {
  if (type === 'CDS') return ['DNA', 'RNA', 'PROT'];
  if (/rna/i.test(type)) return ['DNA', 'RNA'];
  return ['DNA'];
}

export type SourceTag = 'RS' | 'GB' | 'UP';

export interface Feature {
  uniqID: string;
  source: SourceTag[];
  GeneID: string;
  locus_tag: string;
  UniProtID: string;
  type: FeatureType;
  chrom: string;
  coord: ParsedCoord | null;
  gene: string;
  product: string;
  KG_FG: string[];
  KG_FM: string[];
  KG_PC: string[];
  KG_PG: string[];
  KG_PW: string[];
  UP_FM: string[];
  UP_PW: string[];
  UP_KW: string[];
  localisation: string | null; // subcellular localisation of the functional product (DeepLocPro), via org_DB.csv
  len: number | null;
  seq: string | null;
  rna_len: number | null;
  rna_seq: string | null;
  prot_len: number | null;
  prot_seq: string | null;
}

export interface FeatureSummary {
  uniqID: string;
  locus_tag: string;
  gene: string;
  product: string;
  type: FeatureType;
  chrom: string;
  start: number;
  end: number;
  strand: '+' | '-';
  KG_PC: string[];
  // Present only for multi-segment (join/order) features — e.g. spliced genes or
  // a feature that wraps a circular origin. Each entry is an [start, end] block in
  // genomic coordinates. Omitted for the common single-block case, where [start,end]
  // is the whole feature.
  segments?: Array<[number, number]>;
}

export type ChromTopology = 'circular' | 'linear';

// Protein domain annotation (e.g. from TED — The Encyclopedia of Domains).
// Downloaded once into resources/ and served locally; never queried at view time.
export interface ProteinDomain {
  id: string; // e.g. "TED01"
  // Residue blocks in protein coordinates. >1 block = a discontinuous domain.
  segments: Array<[number, number]>;
  cath: string | null; // CATH superfamily code, e.g. "3.40.50.300"
  cathName: string | null; // human-readable CATH superfamily name
  plddt: number | null; // mean AlphaFold pLDDT over the domain
}

export interface ProteinDomains {
  acc: string; // UniProt accession
  length: number | null; // max residue covered (fallback for the track scale)
  source: string; // provenance, e.g. "TED"
  domains: ProteinDomain[];
}

// InterPro representative domains (from EBI InterPro). Downloaded once into resources/
// and served locally. These are InterPro's own representative-domain selection (the
// `representative` match locations), matching the protein page's domain view.
export interface InterproDomain {
  id: string; // accession — integrated InterPro entry (IPR…) when available, else member db
  db: string; // entry database for the link: "InterPro" or a member db (cathgene3d, ssf, …)
  name: string | null; // entry name, e.g. "P-loop containing nucleotide triphosphate hydrolases"
  // Residue blocks in protein coordinates. >1 block = a discontinuous match.
  segments: Array<[number, number]>;
}

export interface ProteinInterproDomains {
  acc: string; // UniProt accession
  length: number | null; // max residue covered (fallback for the track scale)
  source: string; // provenance, e.g. "InterPro"
  domains: InterproDomain[];
}

// CDD (NCBI Conserved Domain Database) conserved-residue motifs — the curated sites
// within a CDD model (e.g. "Walker B motif", "ATP binding site"), via InterPro's
// residue-level annotations. Shows the actual conserved residues, not just the domain
// envelope.
export interface CddMotif {
  entry: string; // CDD model accession, e.g. "cd00009"
  entryName: string | null; // model short name, e.g. "AAA"
  description: string; // motif/site name, e.g. "ATP binding site"
  // Conserved residue positions, contiguous runs merged into ranges (often discontinuous).
  segments: Array<[number, number]>;
}

// A CDD model's domain match on the protein — drawn faint behind its motifs to show
// where they sit within the domain.
export interface CddModel {
  entry: string; // CDD accession, e.g. "cd00009"
  name: string | null;
  segments: Array<[number, number]>;
}

// EBI Complex Portal membership for a protein — drives the viewer's STATE (curated quaternary
// assembly) and COMPLEX (composition) fields. One entry per complex the protein participates in.
export interface ProteinComplexMember {
  id: string; // participant id (UniProt acc / RNAcentral URS / ChEBI)
  kind: 'protein' | 'RNA' | 'ligand';
  name: string; // gene/molecule name (or the id when unresolved)
  uniqID: string | null; // our feature, when the participant maps to one
  stoich: string; // stoichiometry within the complex ('' when unspecified)
}
export interface ProteinComplex {
  ac: string; // Complex Portal accession, e.g. "CPX-28"
  name: string;
  link: string;
  assembly: string | null; // STATE: curated assembly, e.g. "Homodimer", "Heterotetramer"
  pdbId: string | null; // representative PDB structure of the whole complex, when one exists
  classes: string[]; // COMPLEX: molecule kinds present, e.g. ["protein","RNA"]
  members: ProteinComplexMember[]; // the OTHER participants (excludes this protein)
}
export type ProteinComplexes = ProteinComplex[];

// Expression level for a feature: protein abundance (PaxDb, ppm) and/or transcript level
// (iModulonDB modulome, mean log-TPM). `pct` is the 0–100 percentile rank within the organism.
export interface ExpressionValue { value: number; pct: number; norm?: number } // norm = value min-max-normalised to [0,1] (log scale for protein), for the dumbbell + distribution
export interface Expression { protein?: ExpressionValue; transcript?: ExpressionValue }

// Genome-wide value distributions per metric (small histograms) so a gene's score can be shown in
// context. Each `bins` array is the count of loci per equal-width bin over the metric's 0–1 score.
// `essentialityEcocyc` is instead the genome-wide count per categorical call (for a stacked bar).
export interface Distributions {
  protein: number[];
  transcript: number[];
  mutation: number[];
  conservation: number[];
  essentialityCrispri: { lb: number[]; m9: number[] }; // two distributions: rich (LB) + minimal (M9)
  essentialityEcocyc: { 'non-essential': number; 'conditional-starvation': number; essential: number };
  essentialityTnseq: Record<string, number>; // categorical Tn-seq: genome-wide count per call (verdict → count)
}

// One gene as a point in the multiome explorer: identity + the six genome-wide 0–1 scores that drive
// the scatter axes (null where the gene has no value for that metric). Scores are the same min-max
// normalised positions used by the per-gene distributions, so a point's place is comparable to the
// field views. essLb/essM9 oriented so essential = high; conservation high = conserved. Percentile
// thresholds are mapped to the corresponding score quantile client-side.
export interface MultiomePoint {
  uniqID: string;
  gene: string;
  locus_tag: string;
  type: string;
  chrom: string;
  kgpc: string | null; // top KEGG pathway class, for colouring
  essLb: number | null;
  essM9: number | null;
  mutability: number | null;
  conservation: number | null;
  protein: number | null;
  transcript: number | null;
}
export type Multiome = MultiomePoint[];

// Relationship explorer — a clustered genes×genes heatmap. One of these relationship types drives the
// pairwise value; the matrix is over the top-N most-related genes for that type.
// Top-level categories mirror the entry-page Relationships panels; the actual data source within a
// category is the `source` query param (interaction DB / domain index / regulon|modulon / KEGG kind).
export type RelationshipType = 'interaction' | 'molecular' | 'regulation' | 'cellular';
// Overview = the FULL matrix in a global clustered gene order, downsampled to a bins×bins thumbnail
// (a static image), plus the full ordered gene list. The detail view is a contiguous WINDOW of that
// order (a square block on the diagonal), so the viewport maps to a box on the overview.
export interface RelationshipOverview {
  type: RelationshipType;
  total: number; // number of genes in the global order
  genes: { uniqID: string; gene: string; chrom: string }[]; // full, in global order
  bins: number[][]; // bins×bins, 0–1 normalised to the global max
}
export interface RelationshipWindow {
  rowOffset: number; // clamped row-window start in the global order
  colOffset: number; // clamped col-window start (≠ rowOffset → off-diagonal block)
  n: number; // window size (rows = cols)
  matrix: number[][]; // rows × cols, 0–1 normalised to the global max; 0 where row gene === col gene
}

// Cluster-level view of the relationship graph: the label-propagation communities surfaced as
// first-class clusters. `contact`/`enrichment` are the cluster×cluster meta-matrices (diagonal =
// internal density / self-enrichment). Genes are the kept clusters concatenated in cluster order,
// each block pre-sorted hubs-first, so a cluster's genes = genes.slice(offset, offset+size).
export interface RelationshipCluster {
  id: number; // index into clusters[] / the contact matrices
  label: string; // hub gene name ("rpsA cluster")
  size: number;
  offset: number; // start of this cluster's block in `genes`
  density: number; // internal density, 0–1 normalised across clusters
  topClass: string | null; // dominant KEGG top-class among members (for colour)
}
export interface RelationshipClusters {
  type: RelationshipType;
  genes: { uniqID: string; gene: string; chrom: string }[]; // kept clusters, cluster order, hubs-first
  clusters: RelationshipCluster[];
  contact: number[][]; // cluster×cluster density, 0–1 normalised to the matrix max
  enrichment: number[][]; // cluster×cluster enrichment vs degree-null, 0–1 normalised
}
export interface RelationshipBridge {
  a: { uniqID: string; gene: string; chrom: string; deg: number }; // deg = global weighted degree (Σ edge weights graph-wide)
  b: { uniqID: string; gene: string; chrom: string; deg: number };
  w: number; // raw edge weight (relationship strength)
}
export interface RelationshipBridges {
  pairs: RelationshipBridge[]; // strongest gene pairs between the two clusters (or within one)
}

// One source's essentiality verdict. `call`: essential = no growth / strong depletion on rich
// (LB); conditional = fine on rich but not minimal (auxotroph); else non-essential. EcoCyc carries
// `noGrowth`/`total` conditions; CRISPRi carries `lb`/`m9` median fitness log-ratios.
// `conditional-starvation` = essential only in minimal medium (auxotroph, rescued by nutrients);
// `conditional-fastgrowth` = essential only in rich medium (rescued by slow growth). EcoCyc only
// distinguishes the starvation kind.
export type EssentialityVerdict = 'essential' | 'conditional-starvation' | 'conditional-fastgrowth' | 'non-essential';
export interface EssentialityCall {
  call: EssentialityVerdict;
  source?: string; // categorical sources (Tn-seq etc.): provenance label shown in the UI, e.g. "Sassetti 2003 (Tn-seq)"
  noGrowth?: number; // EcoCyc: conditions with no growth
  total?: number; // EcoCyc: total knockout-growth conditions
  media?: string[]; // EcoCyc: minimal media the knockout fails on (conditional-starvation), e.g. ["M9/glucose"]
  lb?: number | null; // CRISPRi: median fitness in LB (rich), log-ratio
  m9?: number | null; // CRISPRi: median fitness in M9 (minimal), log-ratio
  scoreLb?: number; // CRISPRi: LB depletion normalised to [0,1] (1 = most essential), for the distribution
  scoreM9?: number; // CRISPRi: M9 depletion normalised to [0,1]
  pctLb?: number; // CRISPRi: LB depletion percentile rank 0–100 (for threshold-based classification)
  pctM9?: number; // CRISPRi: M9 depletion percentile rank 0–100
}

// Gene/RNA essentiality from whichever sources an organism has, switchable in the UI. Two render
// kinds: categorical (EcoCyc knockout-growth, Tn-seq) → a stacked genome-wide bar; fitness (genome-wide
// CRISPRi screen, all loci incl. RNA) → two normalised distributions. E. coli has EcoCyc + CRISPRi;
// Tn-seq organisms (e.g. M. tuberculosis) have tnseq only.
export interface Essentiality {
  ecocyc?: EssentialityCall;
  crispri?: EssentialityCall;
  tnseq?: EssentialityCall;
}

// One source's per-locus sequence CONSERVATION, measured as natural diversity. `pct` is the
// genome-wide percentile of the variability metric (high pct = more variable = LESS conserved; the
// UI inverts it for a low/med/high *conservation* chip). diversity: nucleotide diversity π + SNP
// density from a panel of E. coli genomes aligned to MG1655. enterobase: distinct-allele count per
// locus across the EnteroBase isolate collection.
export interface ConservationCall {
  pct: number;
  score?: number; // conservation score in [0,1] (1 = most conserved), for the distribution marker
  pi?: number; // diversity: nucleotide diversity π
  snpDensity?: number; // diversity: variable sites / callable sites
  alleles?: number; // enterobase: distinct alleles for this locus
}

// Per-locus conservation from up to two sources, switchable in the UI (default diversity/π):
// computed nucleotide diversity and EnteroBase allele diversity.
export interface Conservation {
  diversity?: ConservationCall;
  enterobase?: ConservationCall;
}

// One source's per-locus MUTATION FREQUENCY — the intrinsic, experimentally-measured mutation rate
// (distinct from conservation, which is natural diversity). `pct` is the genome-wide percentile of
// the rate (drives the low/med/high chip). mmr: mutation-accumulation + WGS of MMR-defective E. coli
// (Foster 2018) — substitution events per locus and rate per kb.
export interface MutationCall {
  pct: number;
  rate: number; // events/kb min-max normalised to [0,1] across loci
  events: number; // substitution events accumulated in this locus
  ratePerKb: number; // events per kb (raw)
}

// Per-locus mutation frequency from one or more experimental sources (currently the MMR-defective
// mutation-accumulation landscape).
export interface Mutation {
  mmr?: MutationCall;
}

// Per-locus natural nucleotide variants from the E. coli genome panel (build-variants.mjs), in the
// feature's own 5'→3' orientation. A site is [position (1-based in the feature), ref base, alt base,
// count of panel genomes carrying the alt]. `n` is the panel size.
export type VariantSite = [number, string, string, number];
export interface Variants { n: number; sites: VariantSite[] }

// Per-RNA modified nucleotides from MODOMICS (analogue of protein PTMs). `pos` is 1-based in the
// RNA; `symbol` is the MODOMICS single-letter code; `name` the modification name.
export interface RnaModification { pos: number; symbol: string; name: string }

// Within-genome similarity to other features — by sequence (BLAST % identity) and by structure
// (Foldseek TM-score). Members link to their entry.
// kgpc/pathway/func are display strings looked up from the member's own annotation (KEGG top
// pathway class + lowest-level pathway/function terms), so the similarity table can show what each
// hit actually does, not just how similar it is.
// `tmscore` (structural) is the consolidated S = √(qTM·tTM). `altPose` flags a hit whose global
// superposition is poor (low S) but whose alignment covers most of both chains and is locally
// accurate — i.e. the same parts in a different relative arrangement/conformation.
export interface SimilarMember { uniqID: string; gene: string; identity?: number; coverage?: number; tmscore?: number; altPose?: boolean; kgpc?: string | null; pathway?: string | null; func?: string | null }
export interface SimilarData { sequence: SimilarMember[]; structural: SimilarMember[] }

// A KEGG pathway rendered from its KGML: real x,y layout coords (graphics CENTRE + w/h), gene boxes
// mapped to our features (often several isozymes per box), compound/ortholog nodes, links to other
// pathways, and directed reactions (substrate→product compound entry ids). The entry page draws the
// canonical metabolic diagram and overlays the focal gene's interactions/similarity onto it.
export interface PathwayGeneRef { uniqID: string; locus_tag: string; gene: string }
export interface PathwayNode { id: string; x: number; y: number; w: number; h: number; label: string }
export interface PathwayGeneBox extends PathwayNode { genes: PathwayGeneRef[] }
export interface PathwayMapLink extends PathwayNode { pathwayId: string; via: string[] } // via = bridging compound entry-ids
// `enzyme` = the entry id of the gene/ortholog box that catalyses this reaction (KGML reaction id),
// so the renderer can route the edge substrate→enzyme→product (the box sits ON the pathway line).
// `ref` = a reaction filled in from KEGG's reference map (a step the organism lacks an enzyme for), so
// its metabolites are still connected; drawn faded in the UI.
export interface PathwayReaction { enzyme: string | null; substrates: string[]; products: string[]; reversible: boolean; ref?: boolean }
export interface PathwayMap {
  id: string;
  name: string;
  bounds: { w: number; h: number };
  genes: PathwayGeneBox[];
  compounds: PathwayNode[];
  orthologs: PathwayNode[];
  maps: PathwayMapLink[];
  reactions: PathwayReaction[];
}
export interface PathwayRef { id: string; name: string }

// The KEGG BRITE (br08901) pathway taxonomy for an organism, restricted to the pathways it has a
// detailed map for: super-section (e.g. "Metabolism") → category (e.g. "Carbohydrate metabolism") →
// pathway. Powers the home-page Pathways browser's taxonomy tree. `genes` = how many of our genes the
// pathway contains (a size hint shown as a badge).
export interface PathwayTaxonomyNode { id: string; name: string; genes: number }
export interface PathwayTaxonomyCategory { name: string; pathways: PathwayTaxonomyNode[] }
export interface PathwayTaxonomySection { name: string; categories: PathwayTaxonomyCategory[] }
export interface PathwayTaxonomy { sections: PathwayTaxonomySection[] }

// Global / overview metabolic maps (KEGG eco011xx/012xx — "Metabolic pathways" etc.) draw enzymes as
// POLYLINES (edges) and metabolites as small dots (nodes) over a whole-cell network layout — a
// different shape from the detailed box maps above. `color` is KEGG's fgcolor (metabolism-category
// hue); `genes` are our E. coli genes catalysing that edge (empty = reference-only step).
// `nodes` = the substrate/product COMPOUND entry-ids this enzyme edge connects (from the KGML reaction);
// `subs`/`prods` keep them separate (for arrow direction), `reversible` from the reaction type.
// `color` = the line's DOMINANT metabolism category (for the network line + territory shading, a visual
// bulk indicator). `cats` = EVERY metabolism category the line's genes belong to (annotation membership) —
// selection highlights by this full set, so the territory never gates which genes are members.
export interface OverviewGeneLine { id: string; pts: [number, number][]; label: string; color: string; cats?: string[]; reaction: string | null; genes: PathwayGeneRef[]; nodes: string[]; subs: string[]; prods: string[]; reversible: boolean }
export interface OverviewCompound { id: string; x: number; y: number; label: string }
// Territory shading: a metabolism category's area as one or more closed outline loops (smoothed from a
// cell grid). Multiple loops = disjoint islands + holes, filled even-odd. `color` is the category hue.
export interface OverviewTerritory { color: string; loops: [number, number][][] }
// A metabolism-category label at the centre of its largest contiguous territory, wrapped to fit its
// width. `cx`/`cy` = centre (map units), `fs` = font size (map units), `lines` = pre-wrapped text.
export interface OverviewRegion { label: string; cx: number; cy: number; color: string; fs: number; lines: string[] }
export interface OverviewMap {
  id: string;
  name: string;
  bounds: { w: number; h: number };
  genes: OverviewGeneLine[];
  compounds: OverviewCompound[];
  territory: OverviewTerritory[];
  regions: OverviewRegion[];
}
export interface OverviewRef { id: string; name: string; genes: number; compounds: number }

// PDBe SIFTS chain → UniProt mapping for a complex structure, resolved to our features so the
// subunit table can label chains by gene and link them. Keyed by author chain id (auth_asym_id).
export type ComplexChainMap = Record<string, { acc: string; gene: string | null; uniqID: string | null }>;

export interface ProteinCddMotifs {
  acc: string;
  length: number | null;
  source: string; // "CDD"
  models: CddModel[]; // domain envelopes (context)
  motifs: CddMotif[];
}

// Intrinsically disordered regions — MobiDB-lite consensus.
export interface ProteinDisorder {
  acc: string;
  length: number | null;
  source: string; // "MobiDB-lite"
  regions: Array<[number, number]>; // residue ranges
}

// Sequence variants — UniProt natural variants + mutagenesis sites.
export interface ProteinVariant {
  type: string; // "VARIANT" (natural) | "MUTAGEN" (experimental)
  begin: number;
  end: number;
  original: string | null; // wild-type residue(s)
  variation: string | null; // substituted residue(s)
  description: string | null;
}

export interface ProteinVariants {
  acc: string;
  length: number | null;
  source: string; // "UniProt"
  variants: ProteinVariant[];
}

// Post-translational modifications — UniProt PTM features.
export interface ProteinModification {
  type: string; // "MOD_RES" | "CARBOHYD" | "LIPID" | "CROSSLNK" | "DISULFID"
  begin: number;
  end: number;
  description: string | null;
}

export interface ProteinModifications {
  acc: string;
  length: number | null;
  source: string; // "UniProt"
  modifications: ProteinModification[];
}

// One side's participant in a reaction: the equation token (e.g. "L-glutamate", "2 H2O"), its
// ChEBI id, and the 2D structure SMILES (attached by the API from the per-organism ChEBI index).
export interface ReactionParticipant {
  name: string;
  chebi: string | null;
  smiles?: string | null;
  rgroup?: boolean; // generic/R-group structure — not a concrete drawable molecule
}

// Catalysed reaction (enzyme catalytic activity) from UniProt, cross-referenced to Rhea, with its
// participants split into substrates (left) and products (right) for structural rendering.
export interface Reaction {
  name: string; // reaction equation, e.g. "ATP + L-glutamate = ADP + phosphate + ..."
  rhea: string | null; // Rhea master id, e.g. "RHEA:14321"
  ec: string | null; // EC number, e.g. "6.3.1.2"
  left?: ReactionParticipant[]; // substrates
  right?: ReactionParticipant[]; // products
}

export interface ProteinReactions {
  acc: string;
  source: string; // "UniProt / Rhea"
  reactions: Reaction[];
}

// ── RNA annotation (Phase 1: structure + Sequence Ontology) ──────────────────
// RNA features are keyed on an RNAcentral URS id, resolved once at build time from
// the feature's gene/locus_tag (the RNA analogue of UniProtID for proteins). All
// assets are downloaded once into resources/ and served locally; never queried at
// view time. RNA has no AlphaFold-equivalent universal predicted-3D DB, so 2D
// (secondary structure) is the default structural view and 3D (PDBe) is sparse/optional.

// Sequence Ontology classification of the molecule — RNAcentral's so_rna_type_name,
// an ordered lineage from general → specific, e.g.
// ["ncRNA","sncRNA","small_regulatory_ncRNA","tmRNA"]. The last entry is the most
// specific SO type.
export interface RnaSoClassification {
  lineage: string[];
  rnaType: string | null; // coarse INSDC type, e.g. "tmRNA"
}

// Experimental 3D structure (PDBe), discovered via RNAcentral xrefs. Most ncRNAs have
// none. The .bcif is downloaded into rna/structures/ (gitignored, large) like proteins.
export interface RnaPdbStructure {
  pdbId: string; // 4-char PDB id, e.g. "3IYR"
  chain: string | null; // chain / optional_id
  title: string | null;
  resolution: string | null; // e.g. "2.85" (Å)
  method: string | null; // e.g. "X-RAY DIFFRACTION", "ELECTRON MICROSCOPY"
}

// The resolved RNAcentral identity + SO classification for one feature. Also the
// availability probe: its presence means the feature has RNA assets. The per-organism
// index (rna/index.json) maps feature uniqID → urs so the API can resolve a feature.
export interface RnaEntry {
  uniqID: string; // source feature key
  urs: string; // RNAcentral URS id, e.g. "URS000037602E"
  taxid: string; // species taxid for the URS / 2D layout
  description: string | null;
  length: number | null; // RNAcentral sequence length
  so: RnaSoClassification;
  has2d: boolean; // a 2D (R2DT) layout was fetched
  pdb: RnaPdbStructure | null; // best experimental 3D, if any
}

// 2D (secondary) structure from R2DT / RNAcentral. The SVG layout is stored alongside
// as <urs>.svg and served separately; this carries the metadata + dot-bracket.
export interface RnaSecondaryStructure {
  urs: string;
  taxid: string;
  dotBracket: string | null; // Vienna notation
  templateId: string | null; // R2DT/Rfam template used, e.g. "RF00023"
  source: string | null; // template provenance, e.g. "rfam", "crw", "ribovision"
  hasSvg: boolean;
}

// One annotated structural element of an RNA, decoded from the secondary structure. Like a
// protein domain/motif: `key` is the hover-sync handle shared by the feature track, the
// table, the sequence, the 2D layout and the 3D model. `segments` are 1-based sequence
// ranges (a stem has two — its 5′ and 3′ strands). For these RNAs the sequence position
// equals the PDB chain's residue number, so the same segments drive 2D and 3D highlighting.
//
// `family` groups elements for naming + colour (Stem N / Loop N / Junction N); `type` is the
// finer classification (helix / hairpin / internal / bulge / "4-way" / …).
export type RnaFeatureFamily = 'stem' | 'loop' | 'junction' | 'pseudoknot' | 'end';

export interface RnaFeature {
  key: string;
  family: RnaFeatureFamily;
  element: string; // display name, e.g. "Stem 1", "Loop 2", "Junction 1", "3′ end"
  type: string; // finer type, e.g. "helix", "hairpin", "internal", "bulge", "4-way"
  length: number;
  unit: 'bp' | 'nt';
  segments: Array<[number, number]>;
  observed3d: string | null; // RNA 3D Hub loop id, when this loop is seen in the experimental structure
}

// A functional region (the biological layer): tRNA arms, rRNA domains, etc. Unlike the
// structural `RnaFeature`s (decoded from topology), these are transferred from the R2DT
// template's standardized numbering (Sprinzl for tRNA, E. coli SSU numbering for 16S).
export interface RnaRegion {
  key: string;
  label: string; // e.g. "Acceptor stem", "Anticodon arm", "5′ domain"
  detail: string | null; // e.g. the anticodon triplet
  length: number;
  unit: 'nt' | 'bp';
  segments: Array<[number, number]>;
}

// A functional layer = a named track of regions (e.g. "Arms", "Domains", "Helices").
export interface RnaRegionLayer {
  label: string;
  regions: RnaRegion[];
}

export interface RnaFeatures {
  urs: string;
  taxid: string;
  length: number | null;
  // Rfam family/clan + hit region (from RNAcentral rfam-hits) — drives the Family track.
  rfam: { acc: string; id: string; clan: string | null; rnaType: string | null; start: number | null; end: number | null } | null;
  features: RnaFeature[]; // structural motifs (Motifs track)
  regionLayers: RnaRegionLayer[]; // functional tracks (Arms / Domains / Helices), family-specific
}

// Molecular interactions, type-routed at ingest: protein → STRING (functional association),
// RNA/sRNA → RegulonDB (regulatory). Partners carry a resolved uniqID for in-app linking.
export interface InteractionPartner {
  name: string;
  uniqID: string | null;
  db?: 'STRING' | 'IntAct' | 'RNAInter'; // evidence DB; absent/STRING = STRING (default)
  score?: number; // STRING / RNAInter confidence score (0–1)
  physical?: boolean; // STRING: backed by experimental/curated evidence
  channels?: Record<string, number>; // STRING evidence sub-scores
  method?: string | null; // IntAct / RNAInter: a representative detection method
  evidence?: number; // IntAct / RNAInter: number of supporting interaction records
  onRna?: boolean; // RNAInter: this feature participated AS RNA (vs as its protein product)
  function?: string | null; // RegulonDB: 'activator' | 'repressor' | null
  kind?: string;
}
export interface Interactions {
  uniqID: string;
  gene: string;
  molecularType: string; // 'protein' or the RNA type
  source: string;
  kind: 'association';
  partners: InteractionPartner[];
}

// The focal gene's interaction ego-network as a true graph: the focal + its (top-scoring) partners
// as nodes, and ALL edges among that node set — including neighbour↔neighbour edges (the induced
// subgraph, assembled from each node's own interaction file) — so clusters are visible, not a star.
export interface InteractionNetworkEdge {
  source: string; // uniqID
  target: string; // uniqID
  score: number; // 0–1, strongest evidence for the pair
  db: 'STRING' | 'IntAct' | 'RNAInter'; // db of the strongest evidence
  physical: boolean; // any STRING experimental/curated evidence
  dbs: string[]; // all evidence DBs supporting the pair
  method: string | null;
}
export interface InteractionNetwork {
  focal: string; // uniqID of the focal gene
  nodes: { uniqID: string; gene: string; kgpc: string | null }[]; // kgpc = top KEGG pathway class, for colouring
  edges: InteractionNetworkEdge[];
}

// Unified REGULATION record (RegulonDB + iModulonDB) — distinct from molecular interactions.
// Control edges (both directions) PLUS the -on memberships shown under the DNA "REGULATION"
// group. Regulon membership is NOT stored: it's inferred from `regulatedBy` (one regulon per
// regulator). Operon / sigmulon / modulon are orthogonal groupings, kept here too.
export interface RegulationEdge {
  name: string;
  uniqID: string | null;
  function: string | null; // 'activator' | 'repressor' | 'dual' | null
  regulatorType?: string; // 'TF' | 'sRNA' (on regulatedBy edges)
  link?: string | null; // source-DB regulon page (on regulatedBy edges)
}
export interface RegulationOperon {
  name: string;
  link: string | null; // RegulonDB operon page
  members: { name: string; uniqID: string | null }[];
}
export interface RegulationSigmulon {
  name: string; // sigma factor (RpoD, RpoS, FliA, …)
  uniqID: string | null; // the sigma factor's own gene, if resolvable
  link: string | null; // RegulonDB sigmulon page
}
export interface RegulationModulon {
  name: string; // iModulon name
  regulator: string | null; // raw regulator string (may be slash-joined, e.g. "FucR/AllR/AraC")
  regulators?: { name: string; uniqID: string | null }[]; // split + resolved to genome features
  function: string | null;
  link: string | null; // iModulonDB iModulon page
}
export interface Regulation {
  uniqID: string;
  gene: string;
  source: string;
  regulatedBy: RegulationEdge[]; // incoming regulators = the regulon membership
  regulates: RegulationEdge[]; // outgoing targets (empty for non-regulators)
  operons: RegulationOperon[];
  sigmulons: RegulationSigmulon[];
  modulons: RegulationModulon[];
}

// One positional regulatory element acting on a gene (RegulonDB), for the gene's regulatory map:
// promoters, transcription-factor binding sites (with effect) and terminators, in chromosome
// coordinates. The activator/repressor effect is joined from the regulatory network.
export interface RegulatoryFeature {
  kind: 'promoter' | 'tf_binding_site' | 'translational_tf_binding_site' | 'terminator';
  name: string; // promoter name, or the TF for a binding site
  start: number; // chromosome coordinate (1-based)
  end: number;
  strand: '+' | '-';
  effect: 'activator' | 'repressor' | 'dual' | null;
  sigma?: string[]; // promoters: the σ factor(s) that recognise this promoter (RegulonDB sigmulons)
}
// A neighbouring gene shown for context on the map: an operon co-member or a flanking gene.
export interface RegulatoryContextGene {
  uniqID: string;
  gene: string;
  start: number;
  end: number;
  strand: '+' | '-';
  operon: boolean; // true = operon co-member; false = flanking gene
}
// A gene's regulatory map: its positional regulatory elements + its gene neighbourhood.
export interface RegulatoryMap {
  features: RegulatoryFeature[];
  context: RegulatoryContextGene[];
}

// The global regulator overlap network (Regulation explorer): nodes = regulators (a transcription factor /
// sRNA / small molecule, sized by regulon size), edges = shared-target overlap between two regulators
// (`jaccard` = normalized overlap, the layout weight; `shared` = raw shared-target count, for display).
// `a`/`b` index into `regulators`. `uniqID` is the regulator's own gene (null for small molecules/complexes).
export interface RegulationNetworkNode { name: string; uniqID: string | null; type: string; size: number }
export interface RegulationNetworkEdge { a: number; b: number; shared: number; jaccard: number }
export interface RegulationNetwork { regulators: RegulationNetworkNode[]; edges: RegulationNetworkEdge[] }
// A single regulon's targets, by regulator name (drill-down + pairwise shared/unique compare).
export interface Regulon { name: string; targets: { name: string; uniqID: string | null }[] }

// The complete regulator → target edge list for the static global regulatory network. Compact/index-based:
// `edges[].r` indexes `regulators`, `edges[].t` indexes `targets`; `m` = mode ('a'ctivator / 'r'epressor /
// 'd'ual / '' unknown). `size` = a regulator's out-degree (its regulon size), for node radius.
export interface RegulationEdges {
  regulators: { name: string; uniqID: string | null; type: string; size: number }[];
  targets: { u: string; g: string }[];
  edges: { r: number; t: number; m: string }[];
}

// Annotation-coverage summary (org home heatmap): per info section/field, how many of the applicable
// genes are annotated. `applicable` is the right denominator (all loci / CDS / RNA) for that field.
export interface CoverageField { key: string; label: string; annotated: number; applicable: number }
export interface CoverageSection { name: string; fields: CoverageField[] }
export interface Coverage { total: number; cds: number; rna: number; sections: CoverageSection[] }

// Co-members a gene shares via its -ons (the Relationships "shared -on" views): genes in the
// same operon, regulons (one group per regulator), and modulons (one group per modulon).
export interface SharedGroup {
  name: string;
  link?: string | null; // source-DB page for the -on (regulon / modulon)
  regulatorType?: string | null; // shared regulon
  regulator?: string | null; // shared modulon
  // Palette index of this feature in the gene's protein/RNA viewer feature table, so the
  // Relationships row can show a colour square matching the viewer. null = no square.
  colorIndex?: number | null;
  members: { name: string; uniqID: string | null }[];
}
// Shared pathway / function (KEGG): one group per shared lowest-level term → member genes.
export interface RelatedMember {
  uniqID: string;
  gene: string;
  locus_tag: string;
  product: string;
  chrom: string;
}
export interface RelatedGroup {
  name: string;
  members: RelatedMember[];
}

export interface RelatedData {
  sharedPathway: RelatedGroup[];
  sharedFunction: RelatedGroup[];
}

export interface SharedRelationships {
  uniqID: string;
  sharedOperon: SharedGroup[]; // one group per operon (usually 1) → co-member genes
  sharedRegulon: SharedGroup[];
  sharedModulon: SharedGroup[];
  sharedDomainTed: SharedGroup[]; // one group per CATH superfamily (TED) → genes sharing it
  sharedDomainInterpro: SharedGroup[]; // one group per InterPro domain → genes sharing it
  sharedMotif: SharedGroup[]; // one group per CDD motif (protein) → genes sharing it
  sharedFamily: SharedGroup[]; // one group per Rfam family (RNA) → genes sharing it
}

export interface ChromosomeInfo {
  id: string;
  length: number;
  featureCount: number;
  // Replicon topology from the DB's chrom_topo column. Undefined when the
  // source DB doesn't provide it (older organisms predate the column).
  topology?: ChromTopology;
}
