# uniOme

A local-first annotation-database browser (v1: *E. coli* K-12). React + Vite frontend,
Fastify + DuckDB API, shared TypeScript types — an npm-workspaces monorepo.

## Setup (fresh clone)

```bash
npm install      # install all workspace deps
npm run setup    # download + unpack organism data from the GitHub Release (needs `gh`, authed)
npm run dev      # API on :4000, web on :5173
```

Open http://localhost:5173. `npm run setup` needs the GitHub CLI (`gh auth login`) —
the repo (and its data Release) is private. Everything is local thereafter.

## Data: one archive per organism

Each organism is a self-contained folder `resources/<org>/` (its `*_DB.csv`, the fetched
`proteins/`, and any future org-specific resources). To keep the repo small while still
shipping the data, **the whole folder is packed into one archive per organism and
distributed as a GitHub Release asset** — not committed:

```
resources/<org>/                      working copy (gitignored)
resources/_assets/<org>.tar.gz        the packed archive (gitignored; uploaded to the Release)
Release "assets": <org>.tar.gz        ← the distributed unit, one per organism
```

`npm run setup` ([scripts/unpack-assets.mjs](scripts/unpack-assets.mjs)) downloads every
`<org>.tar.gz` from the Release (via `gh`) and extracts each into `resources/`. It's
idempotent — organisms already present are skipped. **Adding an organism = drop in its
release archive; the next `setup` picks it up.**

The only thing committed under `resources/` is `_shared/cath-names.json` — a CATH
code→name *build cache* shared across organism fetches (the app never reads it; names are
baked into each domain JSON).

## Refreshing / adding data (maintainers)

```bash
# 1. build resources/<org>/proteins/ from the external services (TED + AlphaFold)
npm run fetch-assets                  # E. coli; or: node scripts/fetch-protein-assets.mjs <taxid> [<acc>...]
# 2. pack each org folder -> resources/_assets/<org>.tar.gz
npm run pack-assets                   # or: node scripts/pack-assets.mjs <taxid>
# 3. publish to the Release
gh release upload assets resources/_assets/*.tar.gz --clobber
```

Notes:
- `fetch-protein-assets.mjs` is resumable (skips files already on disk, retries TED
  rate-limits with backoff) and reads CDS accessions from the org's `*_DB.csv`.
- Structures are BinaryCIF (`.bcif`) — ~2.3× smaller than text `.cif`, lossless, and
  load natively in Mol\*.
- Delete `resources/_shared/cath-names.json` to force CATH names to refresh.
