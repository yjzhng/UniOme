# Enterococcus faecium DO (= TX0016) — org-specific resources (taxid 333849)

**Current state (2026-07-26):** registered, **not yet built**. Catalog tile + `organism.json` in place; awaiting the prokDB **core** annotation DB before Tier 0 enrich.
AMR relevance: WHO High, ESKAPE, CDC serious (VRE). Onboarding wave: **3** — Wave 3 (strain-divergent / RefSeq-suppressed — bespoke crosswalks).

## Reference genome & cross-database IDs (verified during planning)

| field | value |
|---|---|
| reference strain | DO (= TX0016) |
| strain taxid (tile `taxid`) | 333849 |
| `speciesTaxid` | 1352 |
| `keggid` | `efu` |
| `refAssembly` | GCF_000174395.2 |
| `stringSpecies` | 1352 |
| `paxdbSpecies` | — (absent) |
| locus_tag scheme | `HMPREF0351_#####` |

**Join caveat.** ⚠ No strain aligns all four DBs. KEGG (`efu`) = DO (`HMPREF0351_#####`); RefSeq demoted it to `old_locus_tag`. STRING = species taxid 1352 built on a different assembly (`AL014_#####`); PaxDb has no faecium. Expect STRING interactions to need an ortholog crosswalk and expression to be N/A. Alt KEGG genomes: Aus0004 (`efc`), Aus0085 (`efau`).

Expression sources: PaxDb — **no dataset** (expression protein layer unavailable); iModulonDB — **not yet checked** (per-org Tier 2 research).

## Onboarding checklist

- [ ] **Prereq (upstream):** prokDB core DB deposited at `resources/333849_Efm/333849_Efm_DB.csv` (built against GCF_000174395.2 so locus_tags match `HMPREF0351_#####`).
- [ ] **Tier 0** enrich → `resources/333849_Efm/core/333849_Efm_DB.csv` → restart API → tile `ready`.
- [ ] **Tier 1** general resources (`--general-only`): AlphaFold, domains, STRING interactions, seq/struct similarity, reactions, KEGG pathway maps.
- [ ] **Tier 2** org-specific (`build.mjs` + `--org-only`): conservation/variants, RNA modifications, expression, essentiality, regulation.
- [ ] **Publish**: `npm run pack-assets -- 333849` → host → set `available:true`/`url`/`bytes`.

## Build commands

```bash
# Tier 0 (needs the prokDB core CSV in place first):
python scripts/enrich/enrich.py 333849 Efm --core resources/333849_Efm/333849_Efm_DB.csv --out resources/333849_Efm/core/333849_Efm_DB.csv
npm run build-organism -- 333849 --general-only   # Tier 1
node scripts/organisms/333849_Efm/build.mjs 333849  # Tier 2 (after build.mjs is scaffolded)
```
