#!/usr/bin/env python3
"""
enrich.py — UniOme core-DB enrichment.

Takes a CORE annotation DB (the 16-column CSV produced by the prokDB pipeline, a sibling repo) and adds
the genome-level columns UniOme needs — coords, sequences, chromosome, `source` provenance, organism
metadata — producing the full working `<taxid>_<org>_DB.csv` that the API ingests.

Those columns are generated **exactly as prokDB does**: this script reuses prokDB's own code, VENDORED
verbatim under `utils/` (`ncbi.parse_gbff`, `merge.merge_genome` / `merge.merge_annotation`,
`uniprot.fetch_uniprot`). It re-runs prokDB's genome (RS + GB GBFF) + UniProt stages and LEFT-joins the
resulting genome columns onto the core DB by `locus_tag` — so prokDB stays a pure annotation producer and
UniOme owns the genome-level enrichment. To re-sync the vendored copies after a prokDB change:
    cp ../prokDB/scripts/utils/{ncbi,merge,uniprot}.py scripts/enrich/utils/

The org-root `<…>_DB.csv` stays the untouched prokDB core (the input); the enriched working DB is
written under `<org>/core/`, which is the copy the API ingests (organisms.ts prefers `<org>/core/`).

Usage:
  python scripts/enrich/enrich.py <taxid> <org_nickname> \\
      --core  resources/<taxid>_<org>/<taxid>_<org>_DB.csv \\
      --out   resources/<taxid>_<org>/core/<taxid>_<org>_DB.csv \\
      [--cache <dir>] [--api-key <NCBI_KEY>]

Requires: biopython, pandas, requests  (see requirements.txt).
"""
import argparse
import os
import re
import sys

import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from utils.ncbi import (ASSEMBLY_SOURCE_MAP, get_reference_accession,  # noqa: E402
                        download_gbff, extract_gbff, parse_gbff)
from utils.uniprot import fetch_uniprot                                # noqa: E402
from utils.merge import merge_genome, merge_annotation                 # noqa: E402

# Genome-level columns UniOme adds to the core DB — everything in the working DB that is NOT a core prokDB
# column. Produced by the vendored modules, identically to prokDB's own pipeline.
UNIOME_COLS = ["source", "species", "strain", "org", "chrom", "chrom_topo", "chrom_len",
               "rna_id", "protein_id", "coord", "len", "seq", "rna_len", "rna_seq",
               "prot_len", "prot_seq"]

# Final working-DB column order — matches prokDB's DB_COLS / the current 83333_Ec_DB.csv exactly.
DB_COLS = ["uniqID", "source", "species", "strain", "org", "chrom", "chrom_topo", "chrom_len",
           "GeneID", "locus_tag", "rna_id", "protein_id", "UniProtID",
           "type", "localz", "gene", "product",
           "KG_FG", "KG_FM", "KG_PC", "KG_PG", "KG_PW",
           "UP_FM", "UP_PW", "UP_KW",
           "coord", "len", "seq", "rna_len", "rna_seq", "prot_len", "prot_seq"]


def gbff_df(taxid, assembly, cache_dir, api_key):
    """Download + parse a GBFF assembly into prokDB's source DataFrame (cached, like prokDB's `build`)."""
    os.makedirs(cache_dir, exist_ok=True)
    gbf = os.path.join(cache_dir, f"{taxid}_{assembly}.gbff")
    if os.path.exists(gbf):
        print(f"Using cached GBFF: {gbf} ({os.path.getsize(gbf) / 1e6:.1f} MB)")
        with open(gbf, "rb") as fh:
            data = fh.read()
    else:
        acc = get_reference_accession(taxid, ASSEMBLY_SOURCE_MAP[assembly], api_key)
        data = extract_gbff(download_gbff(acc, api_key))
        with open(gbf, "wb") as fh:
            fh.write(data)
    return parse_gbff(data)


def up_df_cached(taxid, cache_dir):
    """Fetch UniProt (cached as CSV so re-runs are cheap)."""
    os.makedirs(cache_dir, exist_ok=True)
    up_csv = os.path.join(cache_dir, f"{taxid}_UP.csv")
    if os.path.exists(up_csv):
        print(f"Using cached UniProt: {up_csv}")
        return pd.read_csv(up_csv)
    df = fetch_uniprot(taxid)
    df.to_csv(up_csv, index=False)
    return df


# Natural sort key (copied from prokDB's cmd_merge: T0001 < T0002 < T00010), used to reproduce the
# row order prokDB assigned uniqIDs in — so multi-CDS isoform rows line up with the right core row.
def _nat_key(s):
    return [int(c) if c.isdigit() else c.lower() for c in re.split(r"(\d+)", str(s))]


def enrich(core_df, rs_df, gb_df, up_df, log):
    """Generate the UniOme-specific columns (prokDB stages 1–2 + transcription) and align them onto the
    core DB. Pure (no I/O) so it's unit-testable with synthetic frames."""
    base = merge_genome(rs_df, gb_df, up_df, log)
    merged = merge_annotation(base, up_df, gb_df, log)  # finalises `source`, attaches prot_seq/prot_len

    # Transcribe genomic DNA → RNA (T→U), exactly as prokDB's merge step.
    seq_col = merged["seq"].fillna("").astype(str) if "seq" in merged.columns else pd.Series([""] * len(merged))
    merged["rna_seq"] = seq_col.str.translate(str.maketrans("Tt", "Uu"))
    merged["rna_len"] = seq_col.map(lambda s: len(s) if s else "")

    # Reproduce prokDB's natural-sort of the genome rows, so a locus's isoforms appear in the SAME order
    # prokDB assigned its uniqIDs in. ~10 E. coli loci (mrcB etc.) have multiple CDS isoforms — duplicate
    # locus_tags with distinct coords/protein_ids — so the genome rows are aligned to the core DB by
    # (locus_tag, within-locus occurrence), NOT locus_tag alone (which would collapse isoforms to one).
    merged = merged.iloc[merged["locus_tag"].map(_nat_key).argsort()].reset_index(drop=True)
    merged["_iso"] = merged.groupby("locus_tag", sort=False).cumcount()

    core = core_df.drop(columns=[c for c in UNIOME_COLS if c in core_df.columns], errors="ignore").copy()
    core["_iso"] = core.groupby("locus_tag", sort=False).cumcount()  # core is in uniqID (= sorted) order
    out = core.merge(merged[["locus_tag", "_iso"] + UNIOME_COLS], on=["locus_tag", "_iso"], how="left")
    out = out[[c for c in DB_COLS if c in out.columns]].fillna("")
    return out


def main():
    ap = argparse.ArgumentParser(description="Enrich a prokDB core DB with UniOme genome columns.")
    ap.add_argument("tax_id")
    ap.add_argument("org_nickname")
    ap.add_argument("--core", required=True, help="core DB CSV (prokDB output)")
    ap.add_argument("--out", required=True, help="working DB CSV to write")
    ap.add_argument("--cache", help="cache dir for GBFF/UniProt (default: <out dir>/_enrich_cache)")
    ap.add_argument("--api-key", default=os.environ.get("NCBI_API_KEY"))
    args = ap.parse_args()

    cache = args.cache or os.path.join(os.path.dirname(os.path.abspath(args.out)), "_enrich_cache")
    log = {"record": [], "result": [], "edge": [], "summary": []}

    print("Fetching genome (RefSeq) ...")
    rs_df = gbff_df(args.tax_id, "RS", cache, args.api_key)
    print("Fetching genome (GenBank) ...")
    gb_df = gbff_df(args.tax_id, "GB", cache, args.api_key)
    print("Fetching UniProt ...")
    up_df = up_df_cached(args.tax_id, cache)

    core = pd.read_csv(args.core, dtype=str).fillna("")
    out = enrich(core, rs_df, gb_df, up_df, log)

    n_missing = int((out["coord"] == "").sum()) if "coord" in out.columns else 0
    if n_missing:
        print(f"  NOTE: {n_missing}/{len(out)} core rows got no genome match by locus_tag "
              f"(UP-only rows, or drift between the core DB and the re-fetched genome).", file=sys.stderr)

    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    out.to_csv(args.out, index=False)
    print(f"Wrote {args.out} ({len(out)} rows, {len(out.columns)} cols).")


if __name__ == "__main__":
    main()
