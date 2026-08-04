# Streptococcus agalactiae 2603V/R (Group B strep, serotype V) — org-specific resources (taxid 208435)

**Current state (2026-07-26):** registered, **not yet built**. Catalog tile + `organism.json` in place; awaiting the prokDB **core** annotation DB before Tier 0 enrich.
AMR relevance: WHO Medium (penicillin-resistant GBS). Onboarding wave: **1** — Wave 1 (clean locus_tag join — build first).

## Reference genome & cross-database IDs (verified during planning)

| field | value |
|---|---|
| reference strain | 2603V/R (Group B strep, serotype V) |
| strain taxid (tile `taxid`) | 208435 |
| `speciesTaxid` | 1311 |
| `keggid` | `sag` |
| `refAssembly` | GCF_000007265.1 |
| `stringSpecies` | 208435 |
| `paxdbSpecies` | 208435 |
| locus_tag scheme | `SAG####` |

**Join caveat.** Consistent on 2603V/R across KEGG/STRING/PaxDb (`SAG####`). RefSeq presents `SAG_RS#####` with `old_locus_tag=SAG####` → join RefSeq on `old_locus_tag`. NEM316 is a separate KEGG genome (`san`) — do not mix.

Expression sources: PaxDb `208435` (present); iModulonDB — **not yet checked** (per-org Tier 2 research).

## Onboarding checklist

- [ ] **Prereq (upstream):** prokDB core DB deposited at `resources/208435_Sag/208435_Sag_DB.csv` (built against GCF_000007265.1 so locus_tags match `SAG####`).
- [ ] **Tier 0** enrich → `resources/208435_Sag/core/208435_Sag_DB.csv` → restart API → tile `ready`.
- [ ] **Tier 1** general resources (`--general-only`): AlphaFold, domains, STRING interactions, seq/struct similarity, reactions, KEGG pathway maps.
- [ ] **Tier 2** org-specific (`build.mjs` + `--org-only`): conservation/variants, RNA modifications, expression, essentiality, regulation.
- [ ] **Publish**: `npm run pack-assets -- 208435` → host → set `available:true`/`url`/`bytes`.

## Build commands

```bash
# Tier 0 (needs the prokDB core CSV in place first):
python scripts/enrich/enrich.py 208435 Sag --core resources/208435_Sag/208435_Sag_DB.csv --out resources/208435_Sag/core/208435_Sag_DB.csv
npm run build-organism -- 208435 --general-only   # Tier 1
node scripts/organisms/208435_Sag/build.mjs 208435  # Tier 2 (after build.mjs is scaffolded)
```
