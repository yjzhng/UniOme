# Streptococcus pyogenes M1 GAS SF370 (Group A strep) — org-specific resources (taxid 160490)

**Current state (2026-07-26):** registered, **not yet built**. Catalog tile + `organism.json` in place; awaiting the prokDB **core** annotation DB before Tier 0 enrich.
AMR relevance: WHO Medium, CDC concerning (macrolide-R GAS). Onboarding wave: **3** — Wave 3 (strain-divergent / RefSeq-suppressed — bespoke crosswalks).

## Reference genome & cross-database IDs (verified during planning)

| field | value |
|---|---|
| reference strain | M1 GAS SF370 (Group A strep) |
| strain taxid (tile `taxid`) | 160490 |
| `speciesTaxid` | 1314 |
| `keggid` | `spy` |
| `refAssembly` | GCF_000006785.2 |
| `stringSpecies` | 1314 |
| `paxdbSpecies` | 1314 |
| locus_tag scheme | `SPy_####` |

**Join caveat.** ⚠ Strain-divergent. KEGG (`spy`) + RefSeq = SF370 (`SPy_####`). STRING v12 and PaxDb use species taxid 1314 but their proteome is strain **NGAS322** (`SD89_#####`, GenBank CP010449.1). STRING/PaxDb will **not** join on locus_tag with SF370 — map `SD89_`↔`SPy_` via UniProt/orthology, or mark interactions/expression N/A. No SF370-based STRING/PaxDb set exists.

Expression sources: PaxDb `1314` (present); iModulonDB — **not yet checked** (per-org Tier 2 research).

## Onboarding checklist

- [ ] **Prereq (upstream):** prokDB core DB deposited at `resources/160490_Spy/160490_Spy_DB.csv` (built against GCF_000006785.2 so locus_tags match `SPy_####`).
- [ ] **Tier 0** enrich → `resources/160490_Spy/core/160490_Spy_DB.csv` → restart API → tile `ready`.
- [ ] **Tier 1** general resources (`--general-only`): AlphaFold, domains, STRING interactions, seq/struct similarity, reactions, KEGG pathway maps.
- [ ] **Tier 2** org-specific (`build.mjs` + `--org-only`): conservation/variants, RNA modifications, expression, essentiality, regulation.
- [ ] **Publish**: `npm run pack-assets -- 160490` → host → set `available:true`/`url`/`bytes`.

## Build commands

```bash
# Tier 0 (needs the prokDB core CSV in place first):
python scripts/enrich/enrich.py 160490 Spy --core resources/160490_Spy/160490_Spy_DB.csv --out resources/160490_Spy/core/160490_Spy_DB.csv
npm run build-organism -- 160490 --general-only   # Tier 1
node scripts/organisms/160490_Spy/build.mjs 160490  # Tier 2 (after build.mjs is scaffolded)
```
