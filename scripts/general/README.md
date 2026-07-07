# General scripts (any organism, by taxid)

Each script here queries a **universal resource** and is parameterized by taxid:
`node scripts/general/<script>.mjs <taxid>`. Output goes under `resources/<taxid>_<nick>/`.
They re-run unchanged for a new organism — this is the data you get "for free" when adding one.

| Script | Source | Output |
|---|---|---|
| `fetch-protein-assets.mjs` | AlphaFold DB · TED/CATH · InterPro · CDD · MobiDB · UniProt variants/PTM · Complex Portal | `proteins/{structures,domains,interpro,cdd,disorder,variants,modifications}/`, `proteins/complexes.json` |
| `fetch-rna-assets.mjs` | RNAcentral · R2DT · Rfam · RCSB/PDBe · MODOMICS | `rna/{index.json,entries,2d,features,structures}` |
| `fetch-interactions.mjs` | STRING · IntAct | per-gene `interactions/<uniqID>.json` |
| `fetch-rnainter.mjs` | RNAInter (bulk) | merged into `interactions/<uniqID>.json` |
| `build-domain-index.mjs` | local TED/InterPro/CDD assets | `proteins/{domain_members,gene_domains,…}.json` |
| `build-complex-index.mjs` | local Complex Portal data | complex membership index |
| `build-rna-family-index.mjs` | local Rfam hits | `relationship/{family,gene_family}.json` |
| `build-relationships.mjs` | KEGG terms in core CSV | `relationship/{pathway,function}_members.json` |
| `build-seq-similarity.mjs` | local protein seqs (blastp all-vs-all) | `proteins/seq_similar.json` |
| `build-struct-similarity.mjs` | local AlphaFold structures (Foldseek TM-align) | `proteins/struct_similar.json` |
| `build-reactions.mjs` | UniProt catalytic activity → Rhea | `proteins/reactions.json` |
| `build-reaction-structures.mjs` | Rhea → ChEBI | `proteins/chebi.json` |
| `build-chebi-kekule.mjs` | PubChem PUG | rewrites `proteins/chebi.json` |
| `build-pathway-maps.mjs` | KEGG KGML (org code) | `pathway/{maps,overview}/` |

**External tools** some scripts need on `$PATH`: `blastp` (seq-similarity), `foldseek`
(struct-similarity). Asset fetches must run before the indexes that read them — the
[`build-organism`](../build-organism.mjs) runner encodes that order.

## Generalization TODOs

Per-organism IDs are merged by [`lib/manifest.mjs`](../lib/manifest.mjs) from the tile registry
([`resources/organism-catalog.json`](../../resources/organism-catalog.json) — `keggid`) and the org
infra config (`organisms/<org>/organism.json` — `stringSpecies` etc.):

- `build-pathway-maps.mjs` — KEGG org code from `keggid` (passed by the runner; defaults to `eco`).
- `fetch-interactions.mjs` — STRING species from `stringSpecies`; IntAct self-partner filter from `{taxid, stringSpecies, speciesTaxid}`. Errors if `stringSpecies` is missing.
- `build-expression.mjs` (org-specific folder) — PaxDb species `511145` is still hardcoded; cf. `manifest.paxdbSpecies` (org-specific source, ported per organism anyway).
