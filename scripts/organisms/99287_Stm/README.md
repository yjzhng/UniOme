# Salmonella enterica LT2 (non-typhoidal Salmonella) — org-specific resources (taxid 99287)

**Current state (2026-07-26):** registered, **not yet built**. Catalog tile + `organism.json` in place; awaiting the prokDB **core** annotation DB before Tier 0 enrich.
AMR relevance: WHO High, CDC serious. Onboarding wave: **1** — Wave 1 (clean locus_tag join — build first).

## Reference genome & cross-database IDs (verified during planning)

| field | value |
|---|---|
| reference strain | LT2 (non-typhoidal Salmonella) |
| strain taxid (tile `taxid`) | 99287 |
| `speciesTaxid` | 28901 |
| `keggid` | `stm` |
| `refAssembly` | GCF_000006945.2 |
| `stringSpecies` | 99287 |
| `paxdbSpecies` | 99287 |
| locus_tag scheme | `STM####` |

**Join caveat.** Clean — RefSeq keeps `STM####` as primary `locus_tag`; KEGG/STRING/PaxDb all use `STM####`. Best-aligned Salmonella. (SL1344 rejected: absent from STRING/PaxDb.)

Expression sources: PaxDb `99287` (present); iModulonDB — **not yet checked** (per-org Tier 2 research).

## Onboarding checklist

- [ ] **Prereq (upstream):** prokDB core DB deposited at `resources/99287_Stm/99287_Stm_DB.csv` (built against GCF_000006945.2 so locus_tags match `STM####`).
- [ ] **Tier 0** enrich → `resources/99287_Stm/core/99287_Stm_DB.csv` → restart API → tile `ready`.
- [ ] **Tier 1** general resources (`--general-only`): AlphaFold, domains, STRING interactions, seq/struct similarity, reactions, KEGG pathway maps.
- [ ] **Tier 2** org-specific (`build.mjs` + `--org-only`): conservation/variants, RNA modifications, expression, essentiality, regulation.
- [ ] **Publish**: `npm run pack-assets -- 99287` → host → set `available:true`/`url`/`bytes`.

## Build commands

```bash
# Tier 0 (needs the prokDB core CSV in place first):
python scripts/enrich/enrich.py 99287 Stm --core resources/99287_Stm/99287_Stm_DB.csv --out resources/99287_Stm/core/99287_Stm_DB.csv
npm run build-organism -- 99287 --general-only   # Tier 1
node scripts/organisms/99287_Stm/build.mjs 99287  # Tier 2 (after build.mjs is scaffolded)
```
