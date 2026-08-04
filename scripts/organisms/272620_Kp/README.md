# Klebsiella pneumoniae subsp. pneumoniae MGH 78578 — org-specific resources (taxid 272620)

**Current state (2026-07-26):** registered, **not yet built**. Catalog tile + `organism.json` in place; awaiting the prokDB **core** annotation DB before Tier 0 enrich.
AMR relevance: WHO Critical (carbapenem/3GC-R Enterobacterales), ESKAPE, CDC urgent. Onboarding wave: **2** — Wave 2 (RefSeq-reannotated — join RefSeq on old_locus_tag).

## Reference genome & cross-database IDs (verified during planning)

| field | value |
|---|---|
| reference strain | subsp. pneumoniae MGH 78578 |
| strain taxid (tile `taxid`) | 272620 |
| `speciesTaxid` | 573 |
| `keggid` | `kpn` |
| `refAssembly` | GCF_000016305.1 |
| `stringSpecies` | 272620 |
| `paxdbSpecies` | — (absent) |
| locus_tag scheme | `KPN_#####` |

**Join caveat.** KEGG + STRING use `KPN_#####`; RefSeq reannotation demoted it to `old_locus_tag` (`KPN_RS#####` primary) → **join RefSeq on `old_locus_tag`**. NCBI's species reference is HS11286 (`kpm`) — MGH 78578 chosen to match KEGG+STRING. PaxDb: no confirmed dataset (verify in the PaxDb browser before relying on expression).

Expression sources: PaxDb — **no dataset** (expression protein layer unavailable); iModulonDB — **not yet checked** (per-org Tier 2 research).

## Onboarding checklist

- [ ] **Prereq (upstream):** prokDB core DB deposited at `resources/272620_Kp/272620_Kp_DB.csv` (built against GCF_000016305.1 so locus_tags match `KPN_#####`).
- [ ] **Tier 0** enrich → `resources/272620_Kp/core/272620_Kp_DB.csv` → restart API → tile `ready`.
- [ ] **Tier 1** general resources (`--general-only`): AlphaFold, domains, STRING interactions, seq/struct similarity, reactions, KEGG pathway maps.
- [ ] **Tier 2** org-specific (`build.mjs` + `--org-only`): conservation/variants, RNA modifications, expression, essentiality, regulation.
- [ ] **Publish**: `npm run pack-assets -- 272620` → host → set `available:true`/`url`/`bytes`.

## Build commands

```bash
# Tier 0 (needs the prokDB core CSV in place first):
python scripts/enrich/enrich.py 272620 Kp --core resources/272620_Kp/272620_Kp_DB.csv --out resources/272620_Kp/core/272620_Kp_DB.csv
npm run build-organism -- 272620 --general-only   # Tier 1
node scripts/organisms/272620_Kp/build.mjs 272620  # Tier 2 (after build.mjs is scaffolded)
```
