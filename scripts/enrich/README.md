# Core-DB enrichment

Turns a **core annotation DB** (the 16-column CSV produced by the **prokDB** pipeline — a sibling repo)
into the full working `<taxid>_<org>_DB.csv` the UniOme API ingests, by adding the genome-level columns
UniOme needs:

```
source, species, strain, org, chrom, chrom_topo, chrom_len,
rna_id, protein_id, coord, len, seq, rna_len, rna_seq, prot_len, prot_seq
```

These are generated **exactly the way prokDB generates them** — `utils/{ncbi,merge,uniprot}.py` are
**vendored verbatim from prokDB** (`prokDB/scripts/utils/`). The driver re-runs prokDB's genome
(RefSeq + GenBank GBFF via NCBI Datasets) and UniProt stages, then LEFT-joins the genome columns onto
the core DB by `locus_tag`. So prokDB stays a pure annotation producer; UniOme owns the genome enrichment.

## Layout

The org-root `<taxid>_<org>_DB.csv` stays the **untouched prokDB core** (the enrichment input); the
enriched working DB is written under **`<org>/core/`**, and that's the copy the API loads (the API's
`findDbPath` prefers `<org>/core/<…>_DB.csv` over the org root — see [apps/api/src/organisms.ts]):

```
resources/83333_Ec/83333_Ec_DB.csv         ← prokDB core (16 cols, original input)
resources/83333_Ec/core/83333_Ec_DB.csv    ← enriched working DB (32 cols, what the app ingests)
```

## Run

```bash
pip install -r scripts/enrich/requirements.txt        # biopython, pandas, requests
python scripts/enrich/enrich.py <taxid> <org_nickname> \
    --core resources/<taxid>_<org>/<taxid>_<org>_DB.csv \
    --out  resources/<taxid>_<org>/core/<taxid>_<org>_DB.csv
# e.g. E. coli (using prokDB's conda env, which has biopython/pandas/requests):
../prokDB/env/prokDB/bin/python scripts/enrich/enrich.py 83333 Ec \
    --core resources/83333_Ec/83333_Ec_DB.csv \
    --out  resources/83333_Ec/core/83333_Ec_DB.csv
```

GBFF + UniProt fetches are cached under `<out dir>/_enrich_cache/` (or `--cache <dir>`), so re-runs are
cheap. An NCBI API key (`--api-key` or `$NCBI_API_KEY`) raises rate limits but isn't required.

## Keeping in sync with prokDB

The vendored modules must track prokDB. After a prokDB change to its GBFF/UniProt/merge logic:

```bash
cp ../prokDB/scripts/utils/{ncbi,merge,uniprot}.py scripts/enrich/utils/
```

## Verifying identity

Slice the current full `83333_Ec_DB.csv` down to the 16 core columns (simulating prokDB's core output),
run `enrich.py`, and diff the result against the original full DB — they should match (modulo any NCBI/
UniProt data drift since the original was built).
