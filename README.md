# uniOme

A local-first annotation-database browser (v1: *E. coli* K-12). React + Vite frontend,
Fastify + DuckDB API, shared TypeScript types — an npm-workspaces monorepo.

## Setup (fresh clone)

```bash
npm install          # install all workspace deps
npm run fetch-assets # download AlphaFold structures into resources/ (see below)
npm run dev          # API on :4000, web on :5173
```

Open http://localhost:5173.

## Data: what ships in git vs. what you fetch

Protein domain/structure data is **downloaded once and served locally** — uniOme never
calls external services at view time. Two tiers:

| Data | Source | In git? | How it gets there |
|---|---|---|---|
| Annotation DB (`resources/<org>/*_DB.csv`) | — | ✅ committed | with the clone |
| Domain annotations (`resources/<org>/proteins/*.domains.json`) | TED | ✅ committed (small, ~12 MB) | with the clone |
| CATH name cache (`resources/cath-names.json`) | CATH | ✅ committed | with the clone |
| **3D structures** (`resources/<org>/proteins/structures/*.cif`) | AlphaFold | ❌ **gitignored** (~1.6 GB) | **`npm run fetch-assets`** |

So after a `git clone`/`git pull` everything works **except** the 3D structure panel,
until you run `npm run fetch-assets`. That command:

- reads the CDS UniProt accessions from the organism's `*_DB.csv`,
- **skips** anything already on disk (so it only downloads the missing structures —
  the committed domain JSONs are not re-fetched),
- is **resumable** and safe to re-run / interrupt (retries rate-limits with backoff).

Without structures the viewer still shows the sequence, domain track, and domain table;
each protein's 3D panel just reads "no AlphaFold structure available" until fetched.

### Re-fetching / other organisms

```bash
node scripts/fetch-protein-assets.mjs <taxid>            # all CDS proteins for an organism
node scripts/fetch-protein-assets.mjs <taxid> <acc> ...  # specific UniProt accessions
```

Delete `resources/cath-names.json` to force CATH names to refresh.
