# Haemophilus influenzae Rd KW20 (serotype d) — org-specific resources (taxid 71421)

**Current state (2026-07-26):** registered, **not yet built**. Catalog tile + `organism.json` in place; awaiting the prokDB **core** annotation DB before Tier 0 enrich.
AMR relevance: WHO Medium (ampicillin-R). Onboarding wave: **3** — Wave 3 (strain-divergent / RefSeq-suppressed — bespoke crosswalks).

## Reference genome & cross-database IDs (verified during planning)

| field | value |
|---|---|
| reference strain | Rd KW20 (serotype d) |
| strain taxid (tile `taxid`) | 71421 |
| `speciesTaxid` | 727 |
| `keggid` | `hin` |
| `refAssembly` | GCA_000027305.1 |
| `stringSpecies` | 71421 |
| `paxdbSpecies` | — (absent) |
| locus_tag scheme | `HI_####` |

**Join caveat.** ⚠ RefSeq assembly GCF_000027305.1 is **suppressed** (frameshift issues); source from **GenBank GCA_000027305.1** (chromosome NC_000907.1 is still widely used). KEGG (`hin`) + STRING both use Rd KW20 `HI_####` → clean KEGG↔STRING. PaxDb has no H. influenzae dataset.

Expression sources: PaxDb — **no dataset** (expression protein layer unavailable); iModulonDB — **not yet checked** (per-org Tier 2 research).

## Onboarding checklist

- [ ] **Prereq (upstream):** prokDB core DB deposited at `resources/71421_Hi/71421_Hi_DB.csv` (built against GCA_000027305.1 so locus_tags match `HI_####`).
- [ ] **Tier 0** enrich → `resources/71421_Hi/core/71421_Hi_DB.csv` → restart API → tile `ready`.
- [ ] **Tier 1** general resources (`--general-only`): AlphaFold, domains, STRING interactions, seq/struct similarity, reactions, KEGG pathway maps.
- [ ] **Tier 2** org-specific (`build.mjs` + `--org-only`): conservation/variants, RNA modifications, expression, essentiality, regulation.
- [ ] **Publish**: `npm run pack-assets -- 71421` → host → set `available:true`/`url`/`bytes`.

## Build commands

```bash
# Tier 0 (needs the prokDB core CSV in place first):
python scripts/enrich/enrich.py 71421 Hi --core resources/71421_Hi/71421_Hi_DB.csv --out resources/71421_Hi/core/71421_Hi_DB.csv
npm run build-organism -- 71421 --general-only   # Tier 1
node scripts/organisms/71421_Hi/build.mjs 71421  # Tier 2 (after build.mjs is scaffolded)
```
