# Data provenance & build methodology — *E. coli* K-12

How UniOme's data is produced, stored, and shipped. For the **license and citation** of each
source, see [data-attribution.md](data-attribution.md); for the **usage terms**, see
[data-use-notice.md](data-use-notice.md).

Every dataset is fetched/computed **once at build time** ([`../scripts/`](../scripts/): `build-*`
derive, `fetch-*` download) and served from local files under `resources/<org>/`. API loaders are in
[`../apps/api/src/`](../apps/api/src/).

The tables below use **_E. coli_ K-12 (taxid 83333)** as the worked example; the same pipeline
produces the other released organisms (*M. tuberculosis* H37Rv, *S. aureus* NCTC 8325,
*B. subtilis* 168), with sources marked *general* re-running by taxid and *org-specific* sources
swapped per organism.

## How the data ships — one archive per organism

Each organism is a self-contained folder `resources/<org>/` (its `*_DB.csv`, the fetched
`proteins/`, and any org-specific resources). To keep the repo small while still shipping the data,
**the whole folder is packed into one archive per organism and distributed as a GitHub Release
asset** — not committed:

```
resources/<org>/                      working copy (gitignored)
resources/_assets/<org>.tar.gz        the packed archive (gitignored; uploaded to the Release)
Release "assets": <org>.tar.gz        ← the distributed unit, one per organism
```

`npm run setup` ([`../scripts/unpack-assets.mjs`](../scripts/unpack-assets.mjs)) downloads every
`<org>.tar.gz` from the public Release and extracts each into `resources/`. It's idempotent —
organisms already present are skipped. **Adding an organism = drop in its release archive; the next
`setup` picks it up.** The only thing committed under `resources/` is `_shared/cath-names.json` — a
CATH code→name *build cache* (the app never reads it; names are baked into each domain JSON).

## Storage states

How each dataset is stored on disk:

| State | What it is |
|-------|-----------|
| **CSV core** | `83333_Ec_DB.csv` — the canonical per-feature table; parsed once at startup into in-memory `Map`s (uniqID / locus_tag / UniProtID / gene). |
| **per-gene JSON** | one JSON per gene/protein/RNA, lazy-loaded on request. |
| **aggregated JSON** | a single JSON keyed by id, read once and cached. |
| **`.bcif`** | BinaryCIF 3D structures (AlphaFold / PDBe), cached locally (gitignored). |
| **SVG** | R2DT RNA secondary-structure layouts. |

**Method** legend: REST = REST API · GraphQL · bulk = bulk file download · compute = derived locally ·
scrape = HTML scrape. **Scope**: *general* = universal resource queried by taxid/accession (re-runs for
any organism); *org-specific* = curated for E. coli or a narrow taxon (won't generalise).

## Core annotation

The 16 core annotation columns come from the **prokDB** pipeline (sibling repo); UniOme adds the
genome-level columns via [`../scripts/enrich/`](../scripts/enrich/) (vendors prokDB's modules, writes the
enriched working DB the API loads to `<org>/core/`, leaving the org-root `<…>_DB.csv` as the prokDB core).

| Columns | Produced by | Source | Scope | State |
|---------|-------------|--------|-------|-------|
| The 16 core cols: `uniqID`, `GeneID`, `locus_tag`, `UniProtID`, `type`, `localz`, `gene`, `product`, KEGG `KG_*`, UniProt `UP_*` | **prokDB** | RefSeq / GenBank / UniProt / KEGG / DeepLocPro | general | **CSV core** (`<…>_DB.csv`) |
| `source`, `chrom`/`chrom_len`/`chrom_topo`, `coord`, `seq`/`len`, `rna_seq`/`rna_len`, `prot_seq`/`prot_len`, `species`/`strain`/`org` | **UniOme** | NCBI RefSeq genome + UniProt / translation | general | `<org>/core/` |
| Chromosome reference sequence | UniOme | NCBI RefSeq genome (`NC_000913.3`) | general | `genome/<org>_genome.{csv,fasta}` |

## General-section fields (per-gene scalars)

| Data | Source | Scope | Method | State |
|------|--------|-------|--------|-------|
| Function / pathway terms | KEGG (in core CSV `KG_*`) | general | — (in core) | CSV core |
| Localisation | DeepLocPro prediction (core CSV `localz`) | general | — (in core) | CSV core |
| Essentiality — knockout growth | EcoCyc / BioCyc web services (`websvc.biocyc.org`) | org-specific | REST | aggregated `essentiality/ecocyc.json` |
| Essentiality — CRISPRi fitness (LB & M9) | HT-CRISPRi screen tables (GitHub `hsrishi/HT-CRISPRi`) | org-specific | bulk + compute | aggregated `essentiality/crispri.json` |
| Conservation — nucleotide diversity (π) | Panel of RefSeq genomes (NCBI `datasets`) aligned to MG1655 (MUMmer) | general | compute | aggregated `conservation/diversity.json` |
| Conservation — allele diversity | EnteroBase | org-specific | compute | aggregated `conservation/enterobase.json` |
| Mutation frequency | Foster et al. 2018 MMR-defective mutation-accumulation list (IU ScholarWorks) | org-specific | bulk + compute | aggregated `mutation/mmr.json` |
| Expression — protein abundance | PaxDb 5.0 integrated *E. coli* (`pax-db.org`) | general | bulk | aggregated `expression.json` |
| Expression — transcript level | iModulonDB modulome (`imodulondb.org`) | org-specific | REST | aggregated `expression.json` |

## Protein structure & features

| Data | Source | Scope | Method | State |
|------|--------|-------|--------|-------|
| 3D structure | AlphaFold DB (`alphafold.ebi.ac.uk`) | general | REST + bulk | per-protein `.bcif` `proteins/structures/<acc>.bcif` |
| Domains (TED/CATH) | TED (`ted.cathdb.info`); CATH names via API + scrape | general | REST (+ scrape) | per-protein `proteins/domains/<acc>.json` + index |
| Domains (InterPro) | InterPro (`ebi.ac.uk/interpro`) | general | REST | per-protein `proteins/interpro/<acc>.json` + index |
| Motifs (CDD) | CDD via InterPro | general | REST | per-protein `proteins/cdd/<acc>.json` + index |
| Intrinsic disorder (IDR) | MobiDB (`mobidb.org`) | general | REST | per-protein `proteins/disorder/<acc>.json` |
| Variants (protein) | UniProt natural variants | general | REST | per-protein `proteins/variants/<acc>.json` |
| Modifications (PTM) | UniProt | general | REST | per-protein `proteins/modifications/<acc>.json` |
| Complexes (protein) | EBI Complex Portal ComplexTAB (`ftp.ebi.ac.uk`) | general | bulk | aggregated `proteins/complexes.json` |
| Complex 3D structures / chains | RCSB (`models.rcsb.org`) + PDBe SIFTS | general | REST (on-demand cache) | `.bcif` + `_assets/complex_chains/<pdbId>.json` |

## RNA features

| Data | Source | Scope | Method | State |
|------|--------|-------|--------|-------|
| RNAcentral identity (URS) + classification | RNAcentral (`rnacentral.org`) + EBI Search | general | REST (MD5 exact-match) | `rna/index.json`, per-RNA `rna/entries/<urs>.json` |
| 2D secondary structure + layout | R2DT via RNAcentral | general | REST | `rna/2d/<urs>.{json,svg}` |
| Structural features (stems/loops/Rfam) | RNAcentral Rfam hits; RiboVision / RNA 3D Hub | general | REST + bulk | per-RNA `rna/features/<urs>.json` |
| 3D structure | RCSB / PDBe (`models.rcsb.org`) | general | REST + bulk | per-RNA `.bcif` `rna/structures/<urs>.bcif` |
| Modifications (modified nucleotides) | MODOMICS (`genesilico.pl/modomics`) | general | REST + compute | aggregated `rna/modifications.json` |
| Complexes (RNA) | EBI Complex Portal | general | bulk | aggregated `rna/complexes.json` |

## Relationships

| Data | Source | Scope | Method | State |
|------|--------|-------|--------|-------|
| Interactions — physical / predicted | STRING (`string-db.org`); IntAct (`ebi.ac.uk/intact`) | general | REST | per-gene `interactions/<uniqID>.json` |
| Interactions — RNA (sRNA↔mRNA, RNA↔protein) | RNAInter (`rnainter.org`) | general | bulk | merged into `interactions/<uniqID>.json` |
| Sequence similarity (within-genome) | local protein sequences | general | compute (blastp all-vs-all) | aggregated `proteins/seq_similar.json` |
| Structural similarity (within-genome) | local AlphaFold structures | general | compute (Foldseek TM-align) | aggregated `proteins/struct_similar.json` |
| Shared domains / family co-members | local domain / Rfam indexes | general | compute | `proteins/*_members.json`, `relationship/{family,gene_family}.json` |
| Shared pathway / function co-members | KEGG terms in core CSV | general | compute | `relationship/{pathway,function}_members.json` |
| Regulation — regulons, operons, sigmulons | RegulonDB (`regulondb.ccg.unam.mx`) | org-specific | GraphQL | per-gene `regulation/<uniqID>.json` + indexes |
| Regulation — modulons | iModulonDB / precise1k k12 modulome (GitHub) | org-specific | bulk | per-gene `regulation/<uniqID>.json` + index |
| Regulatory map (promoters, TFBS, terminators) | RegulonDB | org-specific | GraphQL | aggregated `regulation/regulatory-map.json` |

## Reactions & chemistry

| Data | Source | Scope | Method | State |
|------|--------|-------|--------|-------|
| Catalytic activities (reactions) | UniProt catalytic-activity (Rhea cross-refs) | general | REST | aggregated `proteins/reactions.json` |
| Reaction participant structures (SMILES) | Rhea (`rhea-db.org`) → ChEBI (`ebi.ac.uk/chebi`) | general | REST | aggregated `proteins/chebi.json` |
| ChEBI Kekulé SMILES | PubChem PUG (`pubchem.ncbi.nlm.nih.gov`) | general | REST | aggregated `proteins/chebi.json` |

## Pathway & genome maps

| Data | Source | Scope | Method | State |
|------|--------|-------|--------|-------|
| KEGG pathway maps (detailed) | KEGG (`rest.kegg.jp`, KGML) | general | REST | per-pathway `pathway/maps/<id>.json` + index |
| Metabolic overview map (`eco01100`) | KEGG KGML + reference (`ko*`) reaction merge | general | REST + compute | `pathway/overview/<id>.json` + index |
| Non-gene genome features (promoters, terminators, mobile elements, *oriC*) | RegulonDB + NCBI EFETCH feature table | org-specific | GraphQL + REST | `genome/83333_Ec_genome.csv` |

## Refreshing / adding data (maintainers)

```bash
# 0. enrich the prokDB core DB -> resources/<org>/core/<…>_DB.csv   (../scripts/enrich/README.md)
# 1. build all derived data (general resources, then org-specific sources):
npm run build-organism -- <taxid>     # e.g. 83333; `--list` prints the plan, `--general-only` etc.
# 2. pack each org folder -> resources/_assets/<org>.tar.gz
npm run pack-assets                   # or: node scripts/pack-assets.mjs <taxid>
# 3. publish to the Release
gh release upload assets resources/_assets/*.tar.gz --clobber
```

The scripts are organised by how well their source generalises — `../scripts/general/` (any organism
by taxid) vs `../scripts/organisms/<org>/` (curated/org-specific sources). See
[`../scripts/README.md`](../scripts/README.md) for the layout and the add-an-organism walkthrough.
`npm run fetch-assets` (or `node scripts/general/fetch-protein-assets.mjs <taxid> [<acc>...]`) runs
the protein-asset fetch alone.

Notes:
- `fetch-protein-assets.mjs` is resumable (skips files already on disk, retries TED rate-limits with
  backoff) and reads CDS accessions from the org's `*_DB.csv`.
- Structures are BinaryCIF (`.bcif`) — ~2.3× smaller than text `.cif`, lossless, and load natively in Mol\*.
- Delete `resources/_shared/cath-names.json` to force CATH names to refresh.
