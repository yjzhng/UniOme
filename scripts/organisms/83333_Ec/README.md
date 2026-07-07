# E. coli K-12 — org-specific source parsers (taxid 83333)

Every script here is pinned to a **curated or E.-coli-only source** and does **not** generalize.
A new organism does not reuse these — it needs *analog* sources of the same attribute, wired as a
new `scripts/organisms/<org>/` folder. Run them via the runner (general phase first):

```bash
npm run build-organism -- 83333            # full pipeline
node scripts/organisms/83333_Ec/build.mjs  # just this org's scripts (standalone)
```

| Script | Attribute | Source (E. coli-specific) | Why it won't generalize |
|---|---|---|---|
| `build-essentiality.mjs` | essentiality | EcoCyc / BioCyc web services | curated for E. coli; CDS-only; b-number keyed |
| `build-essentiality-crispri.mjs` | essentiality (fallback) | HT-CRISPRi screen, K-12 MG1655 | one strain's screen tables |
| `build-conservation.mjs` | conservation (π) | panel of RefSeq E. coli genomes vs MG1655 (MUMmer) | species-specific genome panel + reference |
| `build-variants.mjs` | natural variants | same E. coli genome panel | same panel |
| `build-mutation.mjs` | mutation frequency | Foster et al. 2018 MMR-defective MA lines | one study, MG1655 coordinates |
| `build-genome-features.mjs` | non-gene genome features | RegulonDB + RefSeq feature table | RegulonDB is E. coli-only |
| `build-regulatory-map.mjs` | promoters / TFBS / terminators | RegulonDB (GraphQL) | RegulonDB is E. coli-only |
| `fetch-regulation.mjs` | regulons / operons / modulons | RegulonDB · iModulonDB precise1k | E. coli-only networks |
| `build-expression.mjs` | expression | PaxDb (general) + iModulonDB `e_coli` (org) | net org-specific via iModulon org code |
| `build-rna-modifications.mjs` | RNA modified nucleotides | MODOMICS (`organism=Escherichia coli`) | per-organism MODOMICS query |

This folder's [`organism.json`](organism.json) holds this organism's cross-database IDs (STRING/PaxDb
species ids) + the availability/download info (`available`, `url`, `bytes`), read by the build
scripts via `scripts/lib/manifest.mjs` and by the app for the download tile. The tile identifiers
(`taxid`, `nickname`, `keggid`) live in [`resources/organism-catalog.json`](../../../resources/organism-catalog.json).
The RefSeq assembly is resolved from the taxid by `enrich.py` and the chromosome id lands in the
DB's `chrom` column, so neither is stored.

## Finding analog sources for a new organism

| Attribute | E. coli source | General fallback / where to look for another organism |
|---|---|---|
| essentiality | EcoCyc | OGEE / DEG aggregators; a genome-wide Tn-seq/TraDIS screen for that strain |
| conservation | RefSeq genome panel | same recipe, swap the species + reference assembly (resolved from the taxid, as `enrich.py` does) |
| mutation freq | Foster MA study | usually none — leave unpopulated unless a comparable MA/WGS study exists |
| regulation | RegulonDB | organism-specific regulatory DB if any (most lack one); else CollecTF/curated TFBS |
| expression | iModulonDB e_coli | iModulonDB if the organism is hosted; else a GEO/ArrayExpress compendium |
| RNA modifications | MODOMICS E. coli query | MODOMICS by organism name (coverage varies sharply) |

When in doubt, leave the attribute unbuilt — the API and UI already degrade gracefully when a
`resources/<org>/<attribute>/…` file is absent.
