# Pseudomonas aeruginosa PAO1 — org-specific resources (taxid 208964)

**Current state (2026-07-26):** registered, **not yet built**. Catalog tile + `organism.json` in place; awaiting the prokDB **core** annotation DB before Tier 0 enrich.
AMR relevance: WHO High, ESKAPE, CDC serious. Onboarding wave: **1** — Wave 1 (clean locus_tag join — build first).

## Reference genome & cross-database IDs (verified during planning)

| field | value |
|---|---|
| reference strain | PAO1 |
| strain taxid (tile `taxid`) | 208964 |
| `speciesTaxid` | 287 |
| `keggid` | `pae` |
| `refAssembly` | GCF_000006765.1 |
| `stringSpecies` | 208964 |
| `paxdbSpecies` | 208964 |
| locus_tag scheme | `PA####` |

**Join caveat.** Clean — KEGG/RefSeq/STRING/PaxDb all key on `PA####` (RefSeq keeps `PA####` as primary `locus_tag`). No crosswalk needed. The reference case.

Expression sources: PaxDb `208964` (present); iModulonDB — **not yet checked** (per-org Tier 2 research).

## Onboarding checklist

- [ ] **Prereq (upstream):** prokDB core DB deposited at `resources/208964_Pa/208964_Pa_DB.csv` (built against GCF_000006765.1 so locus_tags match `PA####`).
- [ ] **Tier 0** enrich → `resources/208964_Pa/core/208964_Pa_DB.csv` → restart API → tile `ready`.
- [ ] **Tier 1** general resources (`--general-only`): AlphaFold, domains, STRING interactions, seq/struct similarity, reactions, KEGG pathway maps.
- [ ] **Tier 2** org-specific (`build.mjs` + `--org-only`): conservation/variants, RNA modifications, expression, essentiality, regulation.
- [ ] **Publish**: `npm run pack-assets -- 208964` → host → set `available:true`/`url`/`bytes`.

## Build commands

```bash
# Tier 0 (needs the prokDB core CSV in place first):
python scripts/enrich/enrich.py 208964 Pa --core resources/208964_Pa/208964_Pa_DB.csv --out resources/208964_Pa/core/208964_Pa_DB.csv
npm run build-organism -- 208964 --general-only   # Tier 1
node scripts/organisms/208964_Pa/build.mjs 208964  # Tier 2 (after build.mjs is scaffolded)
```
