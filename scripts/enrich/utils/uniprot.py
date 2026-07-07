"""
utils/uniprot.py — UniProt REST API helpers.

Provides:
  fetch_uniprot(tax_id) -> pd.DataFrame

Columns returned (one row per UniProt entry):
  UniProtID   — UniProt accession (e.g. P9WNW3)
  locus_tag   — ordered locus names, space-joined (slash-joins within a name left intact)
  locus_alt   — ORF names (alternative identifiers, space-separated); used as fallback in merge
  reviewed    — "reviewed" (Swiss-Prot) or "unreviewed" (TrEMBL)
  gene        — primary gene name
  product     — recommended protein name only (no EC numbers, no alternatives)
  UP_FM       — protein family (from similarity comment, "Belongs to the X" → "X")
  UP_KW       — keywords, semicolon-separated
  UP_PW       — pathway(s), semicolon-separated
  prot_len    — protein sequence length (amino acids)
  prot_seq    — protein amino-acid sequence
  refseq_ids  — RefSeq protein cross-references (NP_/YP_/WP_/XP_…), semicolon-separated

Sorted by locus_tag before saving.
"""

import re

import pandas as pd
import requests

UNIPROT_API_BASE = "https://rest.uniprot.org/uniprotkb/search"

# Fields requested from the API (drives what JSON sections are returned)
FIELDS = "accession,gene_oln,gene_orf,gene_primary,protein_name,protein_families,keyword,cc_pathway,sequence,xref_refseq"


def _extract_entry(entry: dict) -> dict:
    """Extract flat annotation fields from a single UniProt JSON entry."""

    # UniProtID
    uniprot_id = entry.get("primaryAccession", "")

    # reviewed status ("unreviewed" must be checked first — it contains the substring "reviewed")
    entry_type = entry.get("entryType", "")
    reviewed = "unreviewed" if "unreviewed" in entry_type.lower() else "reviewed"

    # locus_tag: all ordered locus names, space-joined (slash-joins left intact)
    locus_tags = []
    for gene_obj in entry.get("genes", []):
        for oln in gene_obj.get("orderedLocusNames", []):
            val = oln.get("value", "").strip()
            if val:
                locus_tags.append(val)

    # ORF names — used as locus_alt when OLN exists; promoted to locus_tag
    # when OLN is empty (e.g. metazoans like C. elegans store WormBase sequence
    # names in orfNames rather than orderedLocusNames).
    orf_names = []
    for gene_obj in entry.get("genes", []):
        for orf in gene_obj.get("orfNames", []):
            val = orf.get("value", "").strip()
            if val:
                orf_names.append(val)

    if locus_tags:
        locus_tag = " ".join(locus_tags)
        locus_alt = " ".join(orf_names)
    else:
        locus_tag = " ".join(orf_names)
        locus_alt = ""

    # primary gene name
    gene = ""
    for gene_obj in entry.get("genes", []):
        gn = gene_obj.get("geneName", {}).get("value", "").strip()
        if gn:
            gene = gn
            break

    # product: recommendedName.fullName.value only; fall back to submittedNames
    protein_desc = entry.get("proteinDescription", {})
    rec = protein_desc.get("recommendedName", {})
    product = rec.get("fullName", {}).get("value", "").strip()
    if not product:
        sub = protein_desc.get("submittedNames", [])
        if sub:
            product = sub[0].get("fullName", {}).get("value", "").strip()

    # UP_FM: from SIMILARITY comment; strip leading "Belongs to the "
    up_fm_parts = []
    # UP_PW: from PATHWAY comments
    up_pw_parts = []
    for comment in entry.get("comments", []):
        ctype = comment.get("commentType", "")
        texts = [t.get("value", "") for t in comment.get("texts", [])]
        if ctype == "SIMILARITY":
            for t in texts:
                t = re.sub(r"^Belongs to the\s+", "", t, flags=re.IGNORECASE).strip()
                if t:
                    up_fm_parts.append(t)
        elif ctype == "PATHWAY":
            for t in texts:
                if t:
                    t = re.sub(r":\s*step\s+\d+/\d+", "", t, flags=re.IGNORECASE).strip()
                    if t:
                        up_pw_parts.append(t)

    # Dedup while preserving first-seen order (some pathways are listed once
    # per step in UniProt, which collapse to the same string after stripping
    # ': step N/M' — e.g. thrA has methionine and threonine pathways each
    # listed twice).
    def _dedup(seq):
        out, seen = [], set()
        for v in seq:
            if v and v not in seen:
                seen.add(v); out.append(v)
        return out

    up_fm = "; ".join(_dedup(up_fm_parts))
    up_pw = "; ".join(_dedup(up_pw_parts))

    # UP_KW: keyword names, semicolon-separated
    up_kw = ";".join(_dedup(k.get("name", "") for k in entry.get("keywords", [])))

    # protein sequence
    prot_seq = entry.get("sequence", {}).get("value", "")
    prot_len = len(prot_seq) if prot_seq else ""

    # RefSeq protein cross-references (NP_, YP_, WP_, XP_); used by the merge
    # to attach isoform-specific UP entries to specific RS protein_ids.
    refseq_ids: list = []
    for xref in entry.get("uniProtKBCrossReferences", []):
        if xref.get("database") == "RefSeq":
            rid = (xref.get("id") or "").strip()
            if rid and rid not in refseq_ids:
                refseq_ids.append(rid)

    return {
        "UniProtID":   uniprot_id,
        "locus_tag":   locus_tag,
        "locus_alt":   locus_alt,
        "reviewed":    reviewed,
        "gene":        gene,
        "product":     product,
        "UP_FM":       up_fm,
        "UP_KW":       up_kw,
        "UP_PW":       up_pw,
        "prot_len":    prot_len,
        "prot_seq":    prot_seq,
        "refseq_ids":  ";".join(refseq_ids),
    }


def fetch_uniprot(tax_id: str) -> pd.DataFrame:
    """
    Fetch all UniProt entries for a given NCBI taxonomy ID.

    Returns a DataFrame with one row per UniProt entry. Slash-joined or
    space-separated locus_tag values are preserved as-is; expansion for
    joining happens downstream at merge time.
    """
    print("Fetching UniProt entries ...")
    params = {
        "query":  f"taxonomy_id:{tax_id}",
        "format": "json",
        "fields": FIELDS,
        "size":   500,
    }

    rows = []
    url = UNIPROT_API_BASE

    import time as _time
    while url:
        # UniProt occasionally returns slow/timed-out responses; retry with
        # exponential backoff before giving up.
        resp = None
        for attempt in range(4):
            try:
                resp = requests.get(url, params=params, timeout=180)
                resp.raise_for_status()
                break
            except (requests.exceptions.ReadTimeout,
                    requests.exceptions.ConnectionError,
                    requests.exceptions.HTTPError) as e:
                if attempt == 3:
                    raise
                wait = 2 ** attempt * 5
                print(f"  UniProt request failed ({type(e).__name__}); retrying in {wait}s ...")
                _time.sleep(wait)
        data = resp.json()

        for entry in data.get("results", []):
            rows.append(_extract_entry(entry))

        link_header = resp.headers.get("Link", "")
        match = re.search(r'<([^>]+)>;\s*rel="next"', link_header)
        url = match.group(1) if match else None
        params = {}

    COLS = ["UniProtID", "locus_tag", "locus_alt", "reviewed", "gene", "product",
            "UP_FM", "UP_KW", "UP_PW", "prot_len", "prot_seq", "refseq_ids"]
    df = pd.DataFrame(rows, columns=COLS)

    # Drop entries with blank locus_tag, then sort
    n_before = len(df)
    df = df[df["locus_tag"].notna() & (df["locus_tag"].str.strip() != "")]
    n_dropped = n_before - len(df)
    if n_dropped:
        print(f"  Dropped {n_dropped} entries with blank locus_tag.")

    def _nat_key(s):
        return [int(c) if c.isdigit() else c.lower()
                for c in re.split(r"(\d+)", str(s))]

    df = df.iloc[df["locus_tag"].map(_nat_key).argsort()].reset_index(drop=True)

    print(f"Fetched {len(df)} UniProt entries.")
    return df
