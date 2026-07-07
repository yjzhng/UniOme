# The tiered organism pipeline

How an organism goes from "just a taxid" to a fully browsable tile in UniOme. Three tiers, built in
order. Each tier is independently useful — the app renders whatever is present.

## Where things live

| Path | What | Committed? |
|---|---|---|
| `resources/organism-catalog.json` | Tile registry: `{ taxid, nickname, keggid }` per org ("add tile") | ✅ yes |
| `scripts/organisms/<taxid>_<nick>/organism.json` | Org infra config: cross-DB ids + availability/download | ✅ yes |
| `scripts/organisms/<taxid>_<nick>/README.md` | **Source of truth** for that org's state | ✅ yes |
| `scripts/organisms/<taxid>_<nick>/build.mjs` | Optional Tier 2 orchestrator (org-specific source parsers) | ✅ yes |
| `resources/<taxid>_<nick>/<taxid>_<nick>_DB.csv` | The prokDB **core** DB (16 annotation cols) — the input | ❌ ignored (distributed as a release archive) |
| `resources/<taxid>_<nick>/core/<taxid>_<nick>_DB.csv` | The **enriched** working DB the API ingests | ❌ ignored |
| `resources/<taxid>_<nick>/{proteins,rna,interactions,pathway,relationship,_assets}/` | Tier 1/2 derived data | ❌ ignored |

The catalog stores only what's known at registration. Display name / species / strain are **derived from
the enriched DB**, never stored. Cross-DB ids (STRING/PaxDb species, KEGG `keggid`) are research knowledge,
not derivable from the taxid — they go in `organism.json` / the catalog.

## Lifecycle (how the home tile reads)

`planned` (tile only, or `available:false`) → `available` (`available:true` + `url`, not on disk yet) →
`ready` (enriched DB discovered on disk). The API discovers organisms **at startup** by scanning
`resources/` for a `*_DB.csv` (prefers `core/`), so a newly built org needs an **API restart** to appear.

## Tier 0 — enrich the core DB (`scripts/enrich/enrich.py`)

Takes the prokDB core CSV (a sibling repo's annotation output) and LEFT-joins UniOme's genome-level
columns onto it by `locus_tag`: `coord`, `seq`, `chrom`, `source` provenance (RS/GB/UP), species/strain,
protein & RNA seqs. It re-runs prokDB's own genome (RefSeq + GenBank GBFF) + UniProt stages via vendored
code (`scripts/enrich/utils/`), so prokDB stays a pure annotation producer and UniOme owns the genome
enrichment. Output → `resources/<org>/core/<org>_DB.csv`. **This alone makes the tile `ready` and
browsable.** UP-only rows (no genome match) are filtered at ingest.

```bash
python scripts/enrich/enrich.py <taxid> <Nick> \
  --core resources/<taxid>_<Nick>/<taxid>_<Nick>_DB.csv \
  --out  resources/<taxid>_<Nick>/core/<taxid>_<Nick>_DB.csv
# deps: scripts/enrich/requirements.txt (biopython, pandas, requests) — use scripts/enrich/.venv
```

## Tier 1 — general resources (`npm run build-organism -- <taxid> --general-only`)

Universal, taxid-parameterized — works for any organism. Order matters (asset fetches before the indexes
that read them). From `scripts/general/`, the canonical order is:

1. **fetch** raw assets: `fetch-protein-assets` (AlphaFold structures), `fetch-rna-assets`,
   `fetch-interactions` (STRING), `fetch-rnainter`
2. **build** indexes over the assets + DB: `build-domain-index` (InterPro/CDD), `build-complex-index`,
   `build-rna-family-index`, `build-relationships`, `build-seq-similarity` (BLAST), `build-struct-similarity`
   (Foldseek), `build-reactions`, `build-reaction-structures`, `build-chebi-kekule`
3. **build-pathway-maps** — KEGG, needs the org's 3-letter `keggid` (e.g. `eco`, `sao`, `mtu`, `bsu`)

## Tier 2 — org-specific sources (`npm run build-organism -- <taxid> --org-only`)

Per-organism source builders, orchestrated by `scripts/organisms/<org>/build.mjs`. Two flavours:

- **Shared, manifest-driven** (live in `scripts/general/`, invoked from each org's `build.mjs`): these are
  the same method for any organism, parameterized by `organism.json` / the enriched DB —
  `build-conservation` + `build-variants` (RefSeq genome-panel π recompute via MUMmer; needs
  `speciesTaxid` + `refAssembly`), `build-rna-modifications` (MODOMICS, keyed by the DB's `species`),
  `build-expression` (PaxDb `paxdbSpecies` + iModulonDB `imodulonOrg`/`imodulonDataset`). They read the
  **enriched** DB via `findDb` (the genome columns coord/rna_seq/species live only in `core/`).
- **Org-specific parsers** (live in `scripts/organisms/<org>/`): essentiality (DEG / Tn-seq tables —
  `tnseq.json` per the source-agnostic schema the UI renders), regulation (RegulonDB / RegPrecise /
  SubtiWiki), and anything pinned to one curated source.

**Locus-tag crosswalks.** A source may key genes differently from our RefSeq `locus_tag`: KEGG and PaxDb
drop the B. subtilis underscore (`BSU00010` vs our `BSU_00010`) — bridged by an underscore-stripped alias
in `build-pathway-maps`/`build-expression`; iModulonDB/DEG may be a different strain (S. aureus USA300 vs
our NCTC 8325) — needs a gene-symbol/UniProt crosswalk, or pick a directly-keyed source (we used DEG's
`SAOUHSC_`-keyed Coe 2019 for Sa essentiality).

`scripts/build-organism.mjs` runs **general then org-specific**; `--list` prints the live plan,
`--general-only` / `--org-only` pick a phase, `--only/--skip/--from` select steps. Prerequisite: the org
folder must already exist with its Tier 0 core DB enriched.

## Publishing

Once built: pack the org's `resources/<org>/` into an archive, host it (GitHub Release asset), then set
`available:true` + `url` + `bytes` in `organism.json`. `npm run setup` restores archives for end users.

## Adding a new organism — checklist

1. Deposit the prokDB core DB at `resources/<taxid>_<Nick>/<taxid>_<Nick>_DB.csv`.
2. Add the tile to `resources/organism-catalog.json` (`taxid`, `nickname`, `keggid`).
3. Write `scripts/organisms/<taxid>_<Nick>/organism.json` (`stringSpecies`, `speciesTaxid`,
   `paxdbSpecies`, `available:false`) and a `README.md`.
4. Run Tier 0 enrich → restart the API → the tile goes `ready`.
5. (Optional) give it a morphology glyph in `apps/web/src/components/OrganismGlyph.tsx`.
6. Build Tier 1, then Tier 2, then publish.
