# Neisseria gonorrhoeae FA 1090 — org-specific resources (taxid 242231)

**Current state (2026-07-26):** registered, **not yet built**. Catalog tile + `organism.json` in place; awaiting the prokDB **core** annotation DB before Tier 0 enrich.
AMR relevance: WHO High, CDC urgent. Onboarding wave: **2** — Wave 2 (RefSeq-reannotated — join RefSeq on old_locus_tag).

## Reference genome & cross-database IDs (verified during planning)

| field | value |
|---|---|
| reference strain | FA 1090 |
| strain taxid (tile `taxid`) | 242231 |
| `speciesTaxid` | 485 |
| `keggid` | `ngo` |
| `refAssembly` | GCF_000006845.1 |
| `stringSpecies` | 242231 |
| `paxdbSpecies` | — (absent) |
| locus_tag scheme | `NGO_####` |

**Join caveat.** KEGG + STRING use `NGO_####`; RefSeq primary is `NGO_RS#####` → **join RefSeq on `old_locus_tag`**. PaxDb has no gonorrhoeae dataset (only N. meningitidis 122586).

Expression sources: PaxDb — **no dataset** (expression protein layer unavailable); iModulonDB — **not yet checked** (per-org Tier 2 research).

## Onboarding checklist

- [ ] **Prereq (upstream):** prokDB core DB deposited at `resources/242231_Ng/242231_Ng_DB.csv` (built against GCF_000006845.1 so locus_tags match `NGO_####`).
- [ ] **Tier 0** enrich → `resources/242231_Ng/core/242231_Ng_DB.csv` → restart API → tile `ready`.
- [ ] **Tier 1** general resources (`--general-only`): AlphaFold, domains, STRING interactions, seq/struct similarity, reactions, KEGG pathway maps.
- [ ] **Tier 2** org-specific (`build.mjs` + `--org-only`): conservation/variants, RNA modifications, expression, essentiality, regulation.
- [ ] **Publish**: `npm run pack-assets -- 242231` → host → set `available:true`/`url`/`bytes`.

## Build commands

```bash
# Tier 0 (needs the prokDB core CSV in place first):
python scripts/enrich/enrich.py 242231 Ng --core resources/242231_Ng/242231_Ng_DB.csv --out resources/242231_Ng/core/242231_Ng_DB.csv
npm run build-organism -- 242231 --general-only   # Tier 1
node scripts/organisms/242231_Ng/build.mjs 242231  # Tier 2 (after build.mjs is scaffolded)
```
