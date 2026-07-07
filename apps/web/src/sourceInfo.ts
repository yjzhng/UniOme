import { useParams } from 'react-router-dom';

// Central registry of external-data-source descriptions for the field (i) tooltips. Each entry is a
// short "what source + how it's parsed" note, surfaced via the Field `info` prop / <InfoTip>.
//
// Most sources are organism-agnostic (UniProt, RNAcentral, BLAST/Foldseek, ComplexPortal, MODOMICS,
// the protein/RNA tracks) and live in SOURCE_INFO as a single string. The ORG-SPECIFIC sources differ
// per organism — KEGG code, essentiality screen, expression datasets, the conservation/variants
// reference genome, regulation DB — so SOURCE_INFO holds a GENERIC default and ORG_SOURCE_INFO holds
// per-taxid overrides. Resolve with getSourceInfo(field, taxid) or the useSourceInfo() hook.
export const SOURCE_INFO = {
  // --- General section (org-specific defaults; see ORG_SOURCE_INFO for per-organism text) ---
  function:
    'KEGG BRITE functional hierarchy for this organism, read from the annotation table.',
  pathway:
    'KEGG pathway hierarchy for this organism, read from the annotation table.',
  expression:
    'Protein abundance (PaxDb, integrated ppm) and/or transcript level (iModulonDB modulome, mean log-TPM), each min-max-normalised across the genome; the curves are the genome-wide distributions and the dot marks this gene. Sources vary by organism.',
  essentiality:
    'Gene essentiality from whichever genome-wide screen the organism has (knockout-growth, CRISPRi fitness, or transposon-insertion Tn-seq). essential = required for growth (on rich medium); conditional = required only in minimal medium.',
  mutation:
    'Intrinsic mutation rate from mutation-accumulation sequencing of mismatch-repair-defective lines — only available for organisms with such a dataset.',
  conservation:
    'Per-locus nucleotide diversity π from a panel of ~60 complete genomes of the species aligned to the reference with MUMmer (low π = highly conserved; the chip is inverted to read as conservation).',

  // --- Protein / RNA panels (organism-agnostic) ---
  uniprot: 'UniProt annotation for this protein (keywords, family, pathway).',
  reactions:
    'Catalysed reactions from UniProt curated catalytic-activity annotations, each cross-referenced to a Rhea reaction (RHEA:…) and an EC number. Expand a reaction for its 2D structures, drawn from ChEBI participant SMILES. Enzymes only; non-catalytic proteins show no data.',
  complexes:
    'EBI Complex Portal: curated complexes this molecule belongs to, with quaternary state and composition. Parsed from the per-species ComplexTAB.',
  interactionsProtein:
    'Physical interactors from IntAct (experimental, via PSICQUIC) and STRING (functional associations, keyed by the STRING id taxid.locus).',
  rnacentral:
    'RNAcentral identifier resolved by sequence, with Sequence Ontology classification (via EBI Search).',
  localisation:
    'Predicted subcellular localisation of the functional product. For proteins, DeepLocPro (prokaryote-specific predictor; classes: cytoplasm, cytoplasmic membrane, periplasm, outer membrane, cell wall & surface, extracellular). Shown at the General level for whichever is the functional product.',
  interactionsRna:
    'RNA interactions from RNAInter (sRNA↔mRNA, RNA↔protein) plus IntAct/STRING where applicable, mapped by NCBI GeneID / gene symbol.',

  // --- Relationships (regulation entries are org-specific; see ORG_SOURCE_INFO) ---
  regulation:
    'Regulatory network (transcription factors, sigma factors, operons, modulons) — built only for organisms with a curated regulation source.',
  regulatoryMap:
    'Positional regulatory architecture (promoter(s), transcription-factor binding sites) drawn 5′→3′ — built only for organisms with a positional regulation source.',
  sharedRegulation:
    'Genes sharing an operon / regulon / modulon — built only for organisms with a curated regulation source.',
  sharedPathway: 'Genes sharing a KEGG pathway / functional term.',
  pathwayMap:
    'The KEGG pathway diagram (KGML layout) the gene is in, with the focal gene’s physical interactors and structural / sequence homologs highlighted among its co-pathway enzymes.',
  sharedDomain:
    'Genes sharing an InterPro / TED domain or CDD motif (from the per-protein domain assets).',
  sharedFamily: 'RNA genes sharing an Rfam family.',
  seqSimilarity:
    'Within-genome paralogs by all-vs-all BLAST (blastp) of the genome’s protein sequences; shown as % identity.',
  structSimilarity:
    'Within-genome structural homologs by all-vs-all Foldseek TM-align of the AlphaFold structures; shown as TM-score.',
  variants:
    'Natural nucleotide variants across a panel of ~60 complete genomes of the species aligned to the reference (MUMmer). Each tick is a variable position in the feature; opacity scales with how many genomes carry the alternate allele.',
  rnaModifications:
    'Modified nucleotides (pseudouridine, methylations, …) from MODOMICS, mapped onto the RNA by local sequence context. Covers rRNA + tRNA (mRNA/sRNA modifications are uncharacterised in bacteria).',
  dnaModifications:
    'DNA methylation motifs computed from the genome sequence; the motif set is organism-specific.',

  // --- Protein feature tracks (organism-agnostic) ---
  track_domains:
    'Domains: TED (AlphaFold-based consensus domains, named by CATH superfamily) or InterPro representative domains — switch source with ▾.',
  track_motifs:
    'Motifs: conserved-residue sites from NCBI CDD (binding / catalytic residues), drawn over the faint CDD domain-model envelope.',
  track_idrs:
    'IDRs: intrinsically disordered regions from MobiDB-lite, or low-confidence (pLDDT < 70) regions derived from the AlphaFold model — switch with ▾.',
  track_variants:
    'Variants: UniProt natural variants + mutagenesis sites.',
  track_modifications:
    'Modifications: UniProt post-translational modifications (disulfide bonds, glycosylation, lipidation, modified residues).',

  // --- RNA feature tracks (organism-agnostic) ---
  track_rnaFamily:
    'Family: Rfam family assignment (covariation model) for this RNA, via RNAcentral.',
  track_rnaStructure:
    'Structure elements: secondary-structure motifs (stems / loops / junctions) from the R2DT 2D layout, and 3D-observed loops from RNA 3D Hub.',
  track_rnaRegions:
    'Functional regions: named RNA domains / arms annotated for this RNA family.',
} satisfies Record<string, string>;

export type SourceField = keyof typeof SOURCE_INFO;

// Per-organism overrides for the org-specific source fields, keyed by taxid. Only the fields that
// actually differ from the generic SOURCE_INFO default are listed; non-E.-coli organisms have no
// mutation/regulation/DNA-modification data, so those keep the generic "only for some organisms" text.
const ORG_SOURCE_INFO: Record<string, Partial<Record<SourceField, string>>> = {
  // E. coli K-12 MG1655
  '83333': {
    function: 'KEGG BRITE functional hierarchy (KEGG organism code "eco"), read from the annotation table.',
    pathway: 'KEGG pathway hierarchy (KEGG organism code "eco"), read from the annotation table.',
    expression:
      'Protein abundance from PaxDb (511145, integrated ppm) and transcript level from the iModulonDB e_coli modulome (PRECISE, mean log-TPM). Each min-max-normalised across the genome; the curves are the genome-wide distributions and the dots mark this gene.',
    essentiality:
      'EcoCyc gene knockout-growth observations (default) + a genome-wide CRISPRi fitness screen (LB rich / M9 minimal), switchable with ▾. essential = no growth / strong depletion on rich; conditional = depleted only on minimal.',
    mutation:
      'Intrinsic mutation rate from mutation-accumulation + whole-genome sequencing of MMR-defective E. coli (Foster 2018). Substitution events in the locus are counted (hotspot recurrences kept), per kb, min-max-normalised to 0–1.',
    conservation:
      'Per-locus nucleotide diversity π from ~60 complete E. coli genomes aligned to MG1655 (NC_000913.3) with MUMmer (low π = highly conserved; chip inverted to read as conservation). Optional 2nd source: EnteroBase allele diversity.',
    variants:
      'Natural nucleotide variants across ~60 complete E. coli genomes aligned to MG1655 (NC_000913.3). Each tick is a variable position; opacity scales with how many genomes carry the alternate allele.',
    regulation: 'Regulatory network from RegulonDB (transcription factors, sigma factors, operons) and iModulonDB modulons.',
    regulatoryMap:
      'Positional regulatory architecture from RegulonDB: promoter(s) (transcription start) and TF binding sites (coloured by activator/repressor effect, joined from the regulatory network), drawn 5′→3′. Terminators appear only in the positional genome table.',
    sharedRegulation: 'Co-members sharing a RegulonDB operon/regulon or an iModulonDB modulon.',
    dnaModifications:
      'E. coli DNA methylation motifs computed from the sequence: Dam (GATC → N6-methyladenine) and Dcm (CCWGG → 5-methylcytosine).',
  },
  // S. aureus NCTC 8325
  '93061': {
    function: 'KEGG BRITE functional hierarchy (KEGG organism code "sao"), read from the annotation table.',
    pathway: 'KEGG pathway hierarchy (KEGG organism code "sao"), read from the annotation table.',
    expression:
      'Protein abundance from PaxDb (S. aureus NCTC 8325, 93061). Transcript level is not built — iModulonDB’s S. aureus compendium is USA300-keyed and needs a strain crosswalk to our NCTC 8325 (SAOUHSC_) loci.',
    essentiality:
      'Genome-wide transposon-insertion (Tn-seq) essentiality — DEG1061 / Coe 2019, keyed by SAOUHSC_ locus. essential = insertions strongly depleted (gene required for growth).',
    conservation:
      'Per-locus nucleotide diversity π from ~60 complete S. aureus genomes aligned to NCTC 8325 (NC_007795.1) with MUMmer (low π = highly conserved; chip inverted to read as conservation).',
    variants:
      'Natural nucleotide variants across ~60 complete S. aureus genomes aligned to NCTC 8325 (NC_007795.1). Each tick is a variable position; opacity scales with carrier count.',
  },
  // M. tuberculosis H37Rv
  '83332': {
    function: 'KEGG BRITE functional hierarchy (KEGG organism code "mtu"), read from the annotation table.',
    pathway: 'KEGG pathway hierarchy (KEGG organism code "mtu"), read from the annotation table.',
    expression:
      'Protein abundance from PaxDb (83332) and transcript level from the iModulonDB m_tuberculosis modulome (mean log-TPM). Both Rv-keyed, joining directly to our H37Rv genome.',
    essentiality:
      'Genome-wide transposon-insertion (Tn-seq) essentiality — MtbTnDB / Sassetti 2003 in-vitro essential genes, keyed by Rv number.',
    conservation:
      'Per-locus nucleotide diversity π from ~60 complete M. tuberculosis genomes aligned to H37Rv (NC_000962.3) with MUMmer. M. tuberculosis is highly clonal, so π is low across the genome.',
    variants:
      'Natural nucleotide variants across ~60 complete M. tuberculosis genomes aligned to H37Rv (NC_000962.3). Each tick is a variable position; opacity scales with carrier count.',
  },
  // B. subtilis subsp. subtilis str. 168
  '224308': {
    function: 'KEGG BRITE functional hierarchy (KEGG organism code "bsu"), read from the annotation table.',
    pathway: 'KEGG pathway hierarchy (KEGG organism code "bsu"), read from the annotation table.',
    expression:
      'Protein abundance from PaxDb (224308) and transcript level from the iModulonDB b_subtilis modulome (mean log-TPM). Both keyed by BSU locus.',
    essentiality:
      'Genome-wide gene-knockout essentiality — DEG1001 / Kobayashi 2003, keyed by BSU locus. essential = gene required for growth on rich medium.',
    conservation:
      'Per-locus nucleotide diversity π from ~60 complete B. subtilis genomes aligned to strain 168 (NC_000964.3) with MUMmer (low π = highly conserved; chip inverted to read as conservation).',
    variants:
      'Natural nucleotide variants across ~60 complete B. subtilis genomes aligned to strain 168 (NC_000964.3). Each tick is a variable position; opacity scales with carrier count.',
  },
};

// Resolve a field's tooltip for an organism: the per-taxid override if one exists, else the generic
// default. `taxid` undefined (e.g. outside an organism route) → the generic default.
export function getSourceInfo(field: SourceField, taxid?: string): string {
  return (taxid && ORG_SOURCE_INFO[taxid]?.[field]) || SOURCE_INFO[field];
}

// Hook form for components under an organism route: returns a resolver bound to the current taxid, so
// nested fields (e.g. the entry page's regulation rows) don't need taxid threaded through props.
export function useSourceInfo(): (field: SourceField) => string {
  const { taxid } = useParams();
  return (field) => getSourceInfo(field, taxid);
}
