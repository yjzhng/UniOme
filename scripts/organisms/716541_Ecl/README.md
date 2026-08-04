# Enterobacter cloacae subsp. cloacae ATCC 13047 (type strain) — org-specific resources (taxid 716541)

**Current state (2026-07-26):** registered, **not yet built**. Catalog tile + `organism.json` in place; awaiting the prokDB **core** annotation DB before Tier 0 enrich.
AMR relevance: ESKAPE ("E"). Onboarding wave: **2** — Wave 2 (RefSeq-reannotated — join RefSeq on old_locus_tag).

## Reference genome & cross-database IDs (verified during planning)

| field | value |
|---|---|
| reference strain | subsp. cloacae ATCC 13047 (type strain) |
| strain taxid (tile `taxid`) | 716541 |
| `speciesTaxid` | 550 |
| `keggid` | `enc` |
| `refAssembly` | GCF_000025565.1 |
| `stringSpecies` | 716541 |
| `paxdbSpecies` | — (absent) |
| locus_tag scheme | `ECL_#####` |

**Join caveat.** KEGG + STRING use `ECL_#####`; RefSeq demoted it to `old_locus_tag` → **join RefSeq on `old_locus_tag`**. ATCC 13047 (`enc`) chosen as the stable complex anchor; if the target is specifically *E. hormaechei* (158836) there is no single canonical KEGG genome. PaxDb: no confirmed dataset.

Expression sources: PaxDb — **no dataset** (expression protein layer unavailable); iModulonDB — **not yet checked** (per-org Tier 2 research).

## Onboarding checklist

- [ ] **Prereq (upstream):** prokDB core DB deposited at `resources/716541_Ecl/716541_Ecl_DB.csv` (built against GCF_000025565.1 so locus_tags match `ECL_#####`).
- [ ] **Tier 0** enrich → `resources/716541_Ecl/core/716541_Ecl_DB.csv` → restart API → tile `ready`.
- [ ] **Tier 1** general resources (`--general-only`): AlphaFold, domains, STRING interactions, seq/struct similarity, reactions, KEGG pathway maps.
- [ ] **Tier 2** org-specific (`build.mjs` + `--org-only`): conservation/variants, RNA modifications, expression, essentiality, regulation.
- [ ] **Publish**: `npm run pack-assets -- 716541` → host → set `available:true`/`url`/`bytes`.

## Build commands

```bash
# Tier 0 (needs the prokDB core CSV in place first):
python scripts/enrich/enrich.py 716541 Ecl --core resources/716541_Ecl/716541_Ecl_DB.csv --out resources/716541_Ecl/core/716541_Ecl_DB.csv
npm run build-organism -- 716541 --general-only   # Tier 1
node scripts/organisms/716541_Ecl/build.mjs 716541  # Tier 2 (after build.mjs is scaffolded)
```
