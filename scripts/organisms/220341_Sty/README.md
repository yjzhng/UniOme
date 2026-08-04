# Salmonella enterica CT18 (serovar Typhi, typhoidal) — org-specific resources (taxid 220341)

**Current state (2026-07-26):** registered, **not yet built**. Catalog tile + `organism.json` in place; awaiting the prokDB **core** annotation DB before Tier 0 enrich.
AMR relevance: WHO High, CDC serious. Onboarding wave: **2** — Wave 2 (RefSeq-reannotated — join RefSeq on old_locus_tag).

## Reference genome & cross-database IDs (verified during planning)

| field | value |
|---|---|
| reference strain | CT18 (serovar Typhi, typhoidal) |
| strain taxid (tile `taxid`) | 220341 |
| `speciesTaxid` | 28901 |
| `keggid` | `sty` |
| `refAssembly` | GCF_000195995.1 |
| `stringSpecies` | 220341 |
| `paxdbSpecies` | — (absent) |
| locus_tag scheme | `STY####` |

**Join caveat.** KEGG (`sty`) + RefSeq old scheme use `STY####`; RefSeq primary is now `STY_RS#####` → **join RefSeq on `old_locus_tag`**. STRING's external id for CT18 is a numeric GeneID → join STRING↔KEGG on `preferredName` (`STY####`), not the STRING id. Ty2 (`stt`) rejected: not a STRING species. PaxDb absent.

Expression sources: PaxDb — **no dataset** (expression protein layer unavailable); iModulonDB — **not yet checked** (per-org Tier 2 research).

## Onboarding checklist

- [ ] **Prereq (upstream):** prokDB core DB deposited at `resources/220341_Sty/220341_Sty_DB.csv` (built against GCF_000195995.1 so locus_tags match `STY####`).
- [ ] **Tier 0** enrich → `resources/220341_Sty/core/220341_Sty_DB.csv` → restart API → tile `ready`.
- [ ] **Tier 1** general resources (`--general-only`): AlphaFold, domains, STRING interactions, seq/struct similarity, reactions, KEGG pathway maps.
- [ ] **Tier 2** org-specific (`build.mjs` + `--org-only`): conservation/variants, RNA modifications, expression, essentiality, regulation.
- [ ] **Publish**: `npm run pack-assets -- 220341` → host → set `available:true`/`url`/`bytes`.

## Build commands

```bash
# Tier 0 (needs the prokDB core CSV in place first):
python scripts/enrich/enrich.py 220341 Sty --core resources/220341_Sty/220341_Sty_DB.csv --out resources/220341_Sty/core/220341_Sty_DB.csv
npm run build-organism -- 220341 --general-only   # Tier 1
node scripts/organisms/220341_Sty/build.mjs 220341  # Tier 2 (after build.mjs is scaffolded)
```
