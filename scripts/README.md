# Build & fetch scripts

Every dataset UniOme serves is fetched/computed **once at build time** and written to
`resources/<taxid>_<nick>/`, which the API then serves from local files. Scripts are split by
**how well the source generalizes across organisms**:

```
scripts/
  lib/org.mjs            shared helpers (RESOURCES, orgFolder/orgDir/findDb) — imported everywhere
  lib/manifest.mjs       merges a taxid's IDs: tile registry (resources/organism-catalog.json) + org config
  build-organism.mjs     one-command pipeline runner (general phase → org-specific phase)
  general/               taxid-parameterized; re-run for ANY organism by taxid
  organisms/<org>/       org-specific source parsers (pinned to a curated/narrow source)
    build.mjs            runs that organism's org-specific scripts
  pack-assets.mjs        infra: pack resources/<org>/ → one .tar.gz (all orgs)
  unpack-assets.mjs      infra: `npm run setup` restores org archives from the Release
  enrich/                core-DB enrichment (vendored from prokDB) — taxid-parameterized
```

The **general vs org-specific** split mirrors the `Scope` column in the root
[README provenance tables](../README.md#data-provenance--e-coli-k-12). A *general* script queries a
universal resource (UniProt, AlphaFold, KEGG, STRING, RNAcentral, …) and works for any organism by
swapping the taxid. An *org-specific* script is pinned to a curated/narrow source (EcoCyc,
RegulonDB, a strain-specific screen) and **cannot be reused for another organism** — a new organism
needs an analog source, i.e. a new script under its own `organisms/<org>/` folder.

## Adding / rebuilding an organism

```bash
# 0. enrich the prokDB core DB → resources/<org>/core/<…>_DB.csv   (see scripts/enrich/README.md)
# 1. build all derived data (general resources, then org-specific sources):
npm run build-organism -- <taxid>            # e.g. 83333
#    inspect the plan without running:
node scripts/build-organism.mjs <taxid> --list
#    subsets: --general-only | --org-only | --only a,b | --skip a,b | --from <step> | --continue
# 2. pack + publish:
npm run pack-assets
gh release upload assets resources/_assets/*.tar.gz --clobber
```

For a brand-new organism with no `organisms/<org>/` folder yet, the general phase still runs (you
get structures, domains, interactions, pathways, similarity, reactions for free); the org-specific
phase is skipped with a note until you add that organism's source parsers. See
[organisms/83333_Ec/README.md](organisms/83333_Ec/README.md) for what those parsers look like and
how to find analog sources per attribute.
