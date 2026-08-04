# Shigella flexneri 2a str. 301 — org-specific resources (taxid 198214)

**Current state (2026-07-26):** registered, **not yet built**. Catalog tile + `organism.json` in place; awaiting the prokDB **core** annotation DB before Tier 0 enrich.
AMR relevance: WHO High, CDC serious. Onboarding wave: **1** — Wave 1 (clean locus_tag join — build first).

## Reference genome & cross-database IDs (verified during planning)

| field | value |
|---|---|
| reference strain | 2a str. 301 |
| strain taxid (tile `taxid`) | 198214 |
| `speciesTaxid` | 623 |
| `keggid` | `sfl` |
| `refAssembly` | GCF_000006925.2 |
| `stringSpecies` | 198214 |
| `paxdbSpecies` | 198214 |
| locus_tag scheme | `SF####` |

**Join caveat.** Clean — RefSeq keeps `SF####` as primary; KEGG/STRING/PaxDb all on `SF####`.

Expression sources: PaxDb `198214` (present); iModulonDB — **not yet checked** (per-org Tier 2 research).

## Onboarding checklist

- [ ] **Prereq (upstream):** prokDB core DB deposited at `resources/198214_Sf/198214_Sf_DB.csv` (built against GCF_000006925.2 so locus_tags match `SF####`).
- [ ] **Tier 0** enrich → `resources/198214_Sf/core/198214_Sf_DB.csv` → restart API → tile `ready`.
- [ ] **Tier 1** general resources (`--general-only`): AlphaFold, domains, STRING interactions, seq/struct similarity, reactions, KEGG pathway maps.
- [ ] **Tier 2** org-specific (`build.mjs` + `--org-only`): conservation/variants, RNA modifications, expression, essentiality, regulation.
- [ ] **Publish**: `npm run pack-assets -- 198214` → host → set `available:true`/`url`/`bytes`.

## Build commands

```bash
# Tier 0 (needs the prokDB core CSV in place first):
python scripts/enrich/enrich.py 198214 Sf --core resources/198214_Sf/198214_Sf_DB.csv --out resources/198214_Sf/core/198214_Sf_DB.csv
npm run build-organism -- 198214 --general-only   # Tier 1
node scripts/organisms/198214_Sf/build.mjs 198214  # Tier 2 (after build.mjs is scaffolded)
```
