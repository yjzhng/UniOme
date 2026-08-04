# Clostridioides difficile 630 (PCR-ribotype 012) — org-specific resources (taxid 272563)

**Current state (2026-07-26):** registered, **not yet built**. Catalog tile + `organism.json` in place; awaiting the prokDB **core** annotation DB before Tier 0 enrich.
AMR relevance: CDC urgent. Onboarding wave: **2** — Wave 2 (RefSeq-reannotated — join RefSeq on old_locus_tag).

## Reference genome & cross-database IDs (verified during planning)

| field | value |
|---|---|
| reference strain | 630 (PCR-ribotype 012) |
| strain taxid (tile `taxid`) | 272563 |
| `speciesTaxid` | 1496 |
| `keggid` | `cdf` |
| `refAssembly` | GCF_000009205.2 |
| `stringSpecies` | 272563 |
| `paxdbSpecies` | — (absent) |
| locus_tag scheme | `CD630_#####` |

**Join caveat.** KEGG (`cdf`) + RefSeq + STRING all use reannotated `CD630_#####`. The original 2006 Sanger scheme was `CD####` — join on `CD630_#####`. 630Derm is a separate genome (`pdf`). PaxDb has no C. difficile dataset.

Expression sources: PaxDb — **no dataset** (expression protein layer unavailable); iModulonDB — **not yet checked** (per-org Tier 2 research).

## Onboarding checklist

- [ ] **Prereq (upstream):** prokDB core DB deposited at `resources/272563_Cd/272563_Cd_DB.csv` (built against GCF_000009205.2 so locus_tags match `CD630_#####`).
- [ ] **Tier 0** enrich → `resources/272563_Cd/core/272563_Cd_DB.csv` → restart API → tile `ready`.
- [ ] **Tier 1** general resources (`--general-only`): AlphaFold, domains, STRING interactions, seq/struct similarity, reactions, KEGG pathway maps.
- [ ] **Tier 2** org-specific (`build.mjs` + `--org-only`): conservation/variants, RNA modifications, expression, essentiality, regulation.
- [ ] **Publish**: `npm run pack-assets -- 272563` → host → set `available:true`/`url`/`bytes`.

## Build commands

```bash
# Tier 0 (needs the prokDB core CSV in place first):
python scripts/enrich/enrich.py 272563 Cd --core resources/272563_Cd/272563_Cd_DB.csv --out resources/272563_Cd/core/272563_Cd_DB.csv
npm run build-organism -- 272563 --general-only   # Tier 1
node scripts/organisms/272563_Cd/build.mjs 272563  # Tier 2 (after build.mjs is scaffolded)
```
