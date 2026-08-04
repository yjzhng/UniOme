# Campylobacter jejuni NCTC 11168 (= ATCC 700819) — org-specific resources (taxid 192222)

**Current state (2026-07-26):** registered, **not yet built**. Catalog tile + `organism.json` in place; awaiting the prokDB **core** annotation DB before Tier 0 enrich.
AMR relevance: CDC serious. Onboarding wave: **1** — Wave 1 (clean locus_tag join — build first).

## Reference genome & cross-database IDs (verified during planning)

| field | value |
|---|---|
| reference strain | NCTC 11168 (= ATCC 700819) |
| strain taxid (tile `taxid`) | 192222 |
| `speciesTaxid` | 197 |
| `keggid` | `cje` |
| `refAssembly` | GCF_000009085.1 |
| `stringSpecies` | 192222 |
| `paxdbSpecies` | 192222 |
| locus_tag scheme | `Cj####` |

**Join caveat.** Clean — all four DBs on `Cj####`. speciesTaxid is 197; the genome node is strain 192222. Use `cje` (not the re-sequenced `cjb` BN148).

Expression sources: PaxDb `192222` (present); iModulonDB — **not yet checked** (per-org Tier 2 research).

## Onboarding checklist

- [ ] **Prereq (upstream):** prokDB core DB deposited at `resources/192222_Cj/192222_Cj_DB.csv` (built against GCF_000009085.1 so locus_tags match `Cj####`).
- [ ] **Tier 0** enrich → `resources/192222_Cj/core/192222_Cj_DB.csv` → restart API → tile `ready`.
- [ ] **Tier 1** general resources (`--general-only`): AlphaFold, domains, STRING interactions, seq/struct similarity, reactions, KEGG pathway maps.
- [ ] **Tier 2** org-specific (`build.mjs` + `--org-only`): conservation/variants, RNA modifications, expression, essentiality, regulation.
- [ ] **Publish**: `npm run pack-assets -- 192222` → host → set `available:true`/`url`/`bytes`.

## Build commands

```bash
# Tier 0 (needs the prokDB core CSV in place first):
python scripts/enrich/enrich.py 192222 Cj --core resources/192222_Cj/192222_Cj_DB.csv --out resources/192222_Cj/core/192222_Cj_DB.csv
npm run build-organism -- 192222 --general-only   # Tier 1
node scripts/organisms/192222_Cj/build.mjs 192222  # Tier 2 (after build.mjs is scaffolded)
```
