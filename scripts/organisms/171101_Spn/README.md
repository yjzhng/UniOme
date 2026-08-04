# Streptococcus pneumoniae R6 — org-specific resources (taxid 171101)

**Current state (2026-07-26):** registered, **not yet built**. Catalog tile + `organism.json` in place; awaiting the prokDB **core** annotation DB before Tier 0 enrich.
AMR relevance: WHO Medium, CDC serious. Onboarding wave: **1** — Wave 1 (clean locus_tag join — build first).

## Reference genome & cross-database IDs (verified during planning)

| field | value |
|---|---|
| reference strain | R6 |
| strain taxid (tile `taxid`) | 171101 |
| `speciesTaxid` | 1313 |
| `keggid` | `spr` |
| `refAssembly` | GCF_000007045.1 |
| `stringSpecies` | 171101 |
| `paxdbSpecies` | 171101 |
| locus_tag scheme | `spr####` |

**Join caveat.** Standardised on **R6** (`spr`, taxid 171101) for a clean 4-way join — STRING v12 and PaxDb both anchor on R6, not KEGG's default TIGR4 (`spn`, `SP_`). If TIGR4 is ever required, STRING/PaxDb must be ortholog-mapped `SP_`↔`spr`. R6 is an avirulent lab derivative of D39 (`spd`).

Expression sources: PaxDb `171101` (present); iModulonDB — **not yet checked** (per-org Tier 2 research).

## Onboarding checklist

- [ ] **Prereq (upstream):** prokDB core DB deposited at `resources/171101_Spn/171101_Spn_DB.csv` (built against GCF_000007045.1 so locus_tags match `spr####`).
- [ ] **Tier 0** enrich → `resources/171101_Spn/core/171101_Spn_DB.csv` → restart API → tile `ready`.
- [ ] **Tier 1** general resources (`--general-only`): AlphaFold, domains, STRING interactions, seq/struct similarity, reactions, KEGG pathway maps.
- [ ] **Tier 2** org-specific (`build.mjs` + `--org-only`): conservation/variants, RNA modifications, expression, essentiality, regulation.
- [ ] **Publish**: `npm run pack-assets -- 171101` → host → set `available:true`/`url`/`bytes`.

## Build commands

```bash
# Tier 0 (needs the prokDB core CSV in place first):
python scripts/enrich/enrich.py 171101 Spn --core resources/171101_Spn/171101_Spn_DB.csv --out resources/171101_Spn/core/171101_Spn_DB.csv
npm run build-organism -- 171101 --general-only   # Tier 1
node scripts/organisms/171101_Spn/build.mjs 171101  # Tier 2 (after build.mjs is scaffolded)
```
