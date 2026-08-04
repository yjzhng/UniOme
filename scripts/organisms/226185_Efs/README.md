# Enterococcus faecalis V583 — org-specific resources (taxid 226185)

**Current state (2026-07-26):** registered, **not yet built**. Catalog tile + `organism.json` in place; awaiting the prokDB **core** annotation DB before Tier 0 enrich.
AMR relevance: CDC serious (VRE). Onboarding wave: **2** — Wave 2 (RefSeq-reannotated — join RefSeq on old_locus_tag).

## Reference genome & cross-database IDs (verified during planning)

| field | value |
|---|---|
| reference strain | V583 |
| strain taxid (tile `taxid`) | 226185 |
| `speciesTaxid` | 1351 |
| `keggid` | `efa` |
| `refAssembly` | GCF_000007785.1 |
| `stringSpecies` | 226185 |
| `paxdbSpecies` | — (absent) |
| locus_tag scheme | `EF####` |

**Join caveat.** KEGG writes `EF####`; RefSeq primary is `EF_RS#####` (old_locus_tag `EF####`) → **join RefSeq on `old_locus_tag`**. STRING writes `EF_####` **with** an underscore — normalize the underscore when joining KEGG↔STRING. PaxDb absent.

Expression sources: PaxDb — **no dataset** (expression protein layer unavailable); iModulonDB — **not yet checked** (per-org Tier 2 research).

## Onboarding checklist

- [ ] **Prereq (upstream):** prokDB core DB deposited at `resources/226185_Efs/226185_Efs_DB.csv` (built against GCF_000007785.1 so locus_tags match `EF####`).
- [ ] **Tier 0** enrich → `resources/226185_Efs/core/226185_Efs_DB.csv` → restart API → tile `ready`.
- [ ] **Tier 1** general resources (`--general-only`): AlphaFold, domains, STRING interactions, seq/struct similarity, reactions, KEGG pathway maps.
- [ ] **Tier 2** org-specific (`build.mjs` + `--org-only`): conservation/variants, RNA modifications, expression, essentiality, regulation.
- [ ] **Publish**: `npm run pack-assets -- 226185` → host → set `available:true`/`url`/`bytes`.

## Build commands

```bash
# Tier 0 (needs the prokDB core CSV in place first):
python scripts/enrich/enrich.py 226185 Efs --core resources/226185_Efs/226185_Efs_DB.csv --out resources/226185_Efs/core/226185_Efs_DB.csv
npm run build-organism -- 226185 --general-only   # Tier 1
node scripts/organisms/226185_Efs/build.mjs 226185  # Tier 2 (after build.mjs is scaffolded)
```
