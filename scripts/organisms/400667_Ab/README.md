# Acinetobacter baumannii ATCC 17978 — org-specific resources (taxid 400667)

**Current state (2026-07-26):** registered, **not yet built**. Catalog tile + `organism.json` in place; awaiting the prokDB **core** annotation DB before Tier 0 enrich.
AMR relevance: WHO Critical (carbapenem-R), ESKAPE, CDC urgent. Onboarding wave: **3** — Wave 3 (strain-divergent / RefSeq-suppressed — bespoke crosswalks).

## Reference genome & cross-database IDs (verified during planning)

| field | value |
|---|---|
| reference strain | ATCC 17978 |
| strain taxid (tile `taxid`) | 400667 |
| `speciesTaxid` | 470 |
| `keggid` | `acb` |
| `refAssembly` | GCA_000015425.1 |
| `stringSpecies` | 400667 |
| `paxdbSpecies` | — (absent) |
| locus_tag scheme | `A1S_####` |

**Join caveat.** ⚠ RefSeq assembly for KEGG's ATCC 17978 (GCF_000015425.1) is **suppressed**; source the genome from **GenBank GCA_000015425.1** (CP000521, carries `A1S_####`). KEGG (`acb`) + STRING both use `A1S_####`, so KEGG↔STRING join cleanly. NCBI's species reference moved to ATCC 19606 (different tags) — do not use. PaxDb absent. Weakest organism for a consistent 4-way join.

Expression sources: PaxDb — **no dataset** (expression protein layer unavailable); iModulonDB — **not yet checked** (per-org Tier 2 research).

## Onboarding checklist

- [ ] **Prereq (upstream):** prokDB core DB deposited at `resources/400667_Ab/400667_Ab_DB.csv` (built against GCA_000015425.1 so locus_tags match `A1S_####`).
- [ ] **Tier 0** enrich → `resources/400667_Ab/core/400667_Ab_DB.csv` → restart API → tile `ready`.
- [ ] **Tier 1** general resources (`--general-only`): AlphaFold, domains, STRING interactions, seq/struct similarity, reactions, KEGG pathway maps.
- [ ] **Tier 2** org-specific (`build.mjs` + `--org-only`): conservation/variants, RNA modifications, expression, essentiality, regulation.
- [ ] **Publish**: `npm run pack-assets -- 400667` → host → set `available:true`/`url`/`bytes`.

## Build commands

```bash
# Tier 0 (needs the prokDB core CSV in place first):
python scripts/enrich/enrich.py 400667 Ab --core resources/400667_Ab/400667_Ab_DB.csv --out resources/400667_Ab/core/400667_Ab_DB.csv
npm run build-organism -- 400667 --general-only   # Tier 1
node scripts/organisms/400667_Ab/build.mjs 400667  # Tier 2 (after build.mjs is scaffolded)
```
