"""
utils/merge.py — Merge stage helpers.

Provides:
  merge_genome(rs_df, gb_df, up_df, log)       -> pd.DataFrame  Stage 1: genome union
  merge_annotation(base_df, up_df, gb_df, log) -> pd.DataFrame  Stage 2: UniProt join
  merge_deeploc(merged, dl_file, log)          -> pd.DataFrame  Stage 3: DL join (optional)
  merge_kegg(merged, kg_file, log)             -> pd.DataFrame  Stage 4: KEGG join (optional)
"""

import os
import re
from collections import Counter

import pandas as pd


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _fmt_table(headers: list, rows: list, indent: str = "  ") -> list:
    """Format a table with auto-justified column widths.
    Returns a list of strings: header line, separator, data lines."""
    cols = len(headers)
    widths = [len(h) for h in headers]
    for row in rows:
        for i, cell in enumerate(row):
            widths[i] = max(widths[i], len(str(cell)))

    def _row_str(cells):
        parts = [str(c).ljust(widths[i]) if i < cols - 1 else str(c)
                 for i, c in enumerate(cells)]
        return indent + "  ".join(parts)

    hdr = _row_str(headers)
    sep = indent + "-" * (len(hdr) - len(indent))
    return [hdr, sep] + [_row_str(r) for r in rows]


def _build_fuzzy_cascade(canonical_tags) -> tuple:
    """Pre-compute lookup structures for the locus_tag fuzzy match cascade.

    Returns:
      ci_map  : {lower_tag → canonical_tag}  — tier 1: case-insensitive
      norm_map: {norm_tag  → canonical_tag}  — tier 3: underscore-normalised
    """
    ci_map: dict = {}
    norm_map: dict = {}
    for t in canonical_tags:
        low = t.lower()
        if low not in ci_map:
            ci_map[low] = t
        norm = low.replace("_", "")
        if norm not in norm_map:
            norm_map[norm] = t
    return ci_map, norm_map


_PREFIX_STRIP_RE = re.compile(r"^[A-Z]{2,6}_(?=.*[A-Za-z])")


def _fuzzy_locus_match(query_tag: str,
                        ci_map: dict,
                        norm_map: dict,
                        query_alt_tokens: list = None,
                        alt_src_map: dict = None,
                        ) -> tuple:
    """Match a single locus_tag using a 4-tier fuzzy cascade.

    Tiers:
      'ci'     — case-insensitive match of query_tag (or any query_alt_token)
      'alt'    — query_tag appears in alt_src_map (source has it as an alt identifier)
      'fuzzy'  — query_tag with underscores stripped matches a canonical tag
      'prefix' — query_tag stripped of a leading species-code prefix (e.g. CELE_)
                 matches a canonical tag. Only fires when the stripped suffix
                 contains at least one alphabetic character (avoids matching
                 bare numeric suffixes like '00010').

    Returns (matched_canonical_tag, match_type) or (None, None).
    """
    qlow = query_tag.lower()
    if qlow in ci_map:
        return ci_map[qlow], "ci"
    if query_alt_tokens:
        for tok in query_alt_tokens:
            if tok.lower() in ci_map:
                return ci_map[tok.lower()], "alt"
    if alt_src_map and qlow in alt_src_map:
        return alt_src_map[qlow], "alt"
    qnorm = qlow.replace("_", "")
    if qnorm in norm_map:
        return norm_map[qnorm], "fuzzy"
    m = _PREFIX_STRIP_RE.match(query_tag)
    if m:
        stripped = query_tag[m.end():].lower()
        if stripped in ci_map:
            return ci_map[stripped], "prefix"
    return None, None


def _build_alt_map(up_df: pd.DataFrame) -> dict:
    """Build a mapping from lowercased alt locus tags to UP rows.

    Tokens from locus_tag (space/slash split) and locus_alt are treated as
    candidate alt keys. Ambiguous tags (multiple UP entries) are discarded.
    Returns dict: lower_token -> Series (one UP row).
    """
    def _tokens(raw) -> list:
        if not isinstance(raw, str) or not raw.strip():
            return []
        return [t.strip() for tok in raw.split() for t in tok.split("/") if t.strip()]

    alt_map: dict = {}
    for _, row in up_df.dropna(subset=["locus_tag"]).iterrows():
        for token in _tokens(row.get("locus_tag", "")) + _tokens(row.get("locus_alt", "")):
            alt_map.setdefault(token.lower(), []).append(row)
    return {k: v[0] for k, v in alt_map.items() if len(v) == 1}


def _base_tag(ltag: str) -> str:
    """Strip trailing variant suffix (e.g. A, B2, .1) to get the base locus tag.
    Restricts to at most 2 trailing digits so numeric-body tags like BSU00010
    are not truncated."""
    return re.sub(r'([A-Z]\d{0,2}|\.\d+)$', '', ltag)


# ---------------------------------------------------------------------------
# Stage 1 — Genome union
# ---------------------------------------------------------------------------

def merge_genome(rs_df: pd.DataFrame,
                 gb_df: pd.DataFrame,
                 up_df: pd.DataFrame,
                 log: dict) -> pd.DataFrame:
    """Build the genome base by taking the union of features from RS, GB, and UP.

    The base has one row per (locus_tag, rna_id, protein_id) feature — so
    alt-spliced loci (multiple CDS/mRNA per locus_tag) emit multiple rows.

    Row content comes from the highest-priority source: RS > GB > UP.
    A 'source' column records which sources contain each feature (e.g. "RS, GB, UP").
    UP-only entries are given type='CDS' (UniProt is protein-only).
    All locus_tag comparisons are case-insensitive.
    """
    rs_lower = {str(t).lower(): str(t) for t in rs_df["locus_tag"].dropna()}
    gb_lower = {str(t).lower(): str(t) for t in gb_df["locus_tag"].dropna()}

    up_notnull = up_df.dropna(subset=["locus_tag"])

    def _lt_tokens(raw) -> list:
        if not isinstance(raw, str) or not raw.strip():
            return []
        return [t.strip() for tok in raw.split() for t in tok.split("/") if t.strip()]

    # Composite isoform key for matching one RS row to one GB row.
    # Uses coord (not protein_id / rna_id) because RS/GB use different accession
    # namespaces (NP_/YP_ vs AAC_/UMR_, NM_ vs N/A) for the same coordinate-defined feature.
    def _iso_key(r) -> tuple:
        return (str(r.get("locus_tag", "") or "").lower(),
                str(r.get("type",  "") or ""),
                str(r.get("coord", "") or ""))

    # Pre-build fuzzy cascade from RS/GB canonical tags
    s1_ci_map, s1_norm_map = _build_fuzzy_cascade(
        list(rs_lower.values()) + list(gb_lower.values()))

    n_up_ci = n_up_alt = n_up_fuzzy = n_up_prefix = 0
    up_alt_resolves: set = set()

    for _, row in up_notnull.iterrows():
        lt_tokens = _lt_tokens(row["locus_tag"])
        if not lt_tokens:
            continue
        full_low = row["locus_tag"].strip().lower()
        if full_low in s1_ci_map:
            n_up_ci += 1
            continue
        alt_raw = str(row.get("locus_alt", "")) if pd.notna(row.get("locus_alt", "")) else ""
        _, match_type = _fuzzy_locus_match(
            lt_tokens[0], s1_ci_map, s1_norm_map,
            query_alt_tokens=lt_tokens[1:] + _lt_tokens(alt_raw))
        if match_type:
            up_alt_resolves.add(lt_tokens[0].lower())
            if match_type in ("ci", "alt"):
                n_up_alt += 1
            elif match_type == "fuzzy":
                n_up_fuzzy += 1
            elif match_type == "prefix":
                n_up_prefix += 1

    # UP "primary-token" map: primary locus_tag → UP row (de-duped, skips cascade-resolved tokens)
    up_primary_set: set = set()
    up_lower:    dict = {}
    up_row_map:  dict = {}
    for _, row in up_notnull.iterrows():
        lt_tokens = _lt_tokens(row["locus_tag"])
        if not lt_tokens:
            continue
        primary = lt_tokens[0]
        low = primary.lower()
        up_primary_set.add(low)
        if low not in up_lower and low not in up_alt_resolves:
            up_lower[low]    = primary
            up_row_map[low]  = row

    # Index GB rows by isoform key for O(1) lookup during RS pass
    gb_by_key: dict = {}
    for _, gr in gb_df.iterrows():
        gb_by_key.setdefault(_iso_key(gr), []).append(gr)

    def _make_row(r, sources):
        return {"GeneID":     r.get("GeneID", "")     if pd.notna(r.get("GeneID", ""))     else "",
                "locus_tag":  str(r.get("locus_tag", "")),
                "rna_id":     r.get("rna_id",     "") if pd.notna(r.get("rna_id",     "")) else "",
                "protein_id": r.get("protein_id", "") if pd.notna(r.get("protein_id", "")) else "",
                "type":          r.get("type",    "")       if pd.notna(r.get("type",    ""))       else "",
                "gene":          r.get("gene",    "")       if pd.notna(r.get("gene",    ""))       else "",
                "product":       r.get("product", "")       if pd.notna(r.get("product", ""))       else "",
                "chrom":         r.get("chrom",      ""),
                "chrom_topo":    r.get("chrom_topo", ""),
                "chrom_len":     r.get("chrom_len",  ""),
                "species":       r.get("species",   ""),
                "strain":        r.get("strain",    ""),
                "org":           r.get("org",       ""),
                "coord":         r.get("coord",     ""),
                "len":           r.get("len",       ""),
                "seq":           r.get("seq",       ""),
                "source":        ", ".join(sources)}

    matched_gb_keys: set = set()
    result_rows = []

    # Pass 1: one row per RS feature
    for _, r in rs_df.iterrows():
        ltag = str(r.get("locus_tag", "") or "").strip()
        if not ltag:
            continue
        k = _iso_key(r)
        sources = ["RS"]
        if k in gb_by_key:
            sources.append("GB")
            matched_gb_keys.add(k)
        if ltag.lower() in up_primary_set:
            sources.append("UP")
        result_rows.append(_make_row(r, sources))

    # Pass 2: GB features not matched to any RS feature
    for _, g in gb_df.iterrows():
        ltag = str(g.get("locus_tag", "") or "").strip()
        if not ltag:
            continue
        k = _iso_key(g)
        if k in matched_gb_keys:
            continue
        sources = ["GB"]
        if ltag.lower() in up_primary_set:
            sources.append("UP")
        result_rows.append(_make_row(g, sources))

    # Pass 3: UP-only entries (primary token not in RS or GB locus_tag set)
    for low, primary in up_lower.items():
        if low in rs_lower or low in gb_lower:
            continue
        r = up_row_map[low]
        result_rows.append({
            "GeneID": "", "locus_tag": primary,
            "rna_id": "", "protein_id": "",
            "type": "CDS",
            "gene":    r["gene"]    if pd.notna(r.get("gene", ""))    else "",
            "product": r["product"] if pd.notna(r.get("product", "")) else "",
            "chrom": "", "chrom_topo": "", "chrom_len": "",
            "species": "", "strain": "", "org": "",
            "coord": "", "len": "", "seq": "",
            "source": "UP",
        })

    base = pd.DataFrame(result_rows,
                        columns=["GeneID", "locus_tag", "rna_id", "protein_id",
                                 "type", "gene", "product",
                                 "chrom", "chrom_topo", "chrom_len",
                                 "species", "strain", "org",
                                 "coord", "len", "seq", "source"])

    for src, cnt in sorted(Counter(r["source"] for r in result_rows).items()):
        print(f"  {src}: {cnt} entries")
    print(f"  Total: {len(base)}")

    n_up_only  = len(up_lower)
    n_up_total = len(up_notnull)
    msg = (f"Stage 1 UP resolution ({n_up_total} UP entries): "
           f"{n_up_ci} CI, {n_up_alt} alt/secondary-token, {n_up_fuzzy} fuzzy (underscore norm), "
           f"{n_up_prefix} prefix-strip, {n_up_only} UP-only (no RS/GB match)")
    print(f"  {msg}")
    log["result"].append(msg)
    if n_up_fuzzy:
        log["edge"].append(
            f"Stage 1 fuzzy matches (underscore norm): {n_up_fuzzy} UP entries matched "
            f"RS/GB after stripping underscores — annotation deferred to Stage 2 fuzzy pass. "
            f"RS/GB locus_tag format retained as canonical.")

    return base


# ---------------------------------------------------------------------------
# Stage 2 — UniProt annotation join
# ---------------------------------------------------------------------------

def merge_annotation(base_df: pd.DataFrame,
                     up_df: pd.DataFrame,
                     gb_df: pd.DataFrame,
                     log: dict) -> pd.DataFrame:
    """LEFT JOIN UniProt onto the genome base by locus_tag.

    Falls back through a fuzzy cascade for unmatched rows.
    For CDS features, UP gene/product overwrite RS values when non-blank.
    Non-CDS features keep RS annotation as-is.
    """
    up_cols = ["locus_tag", "UniProtID", "reviewed", "gene", "product",
               "UP_FM", "UP_KW", "UP_PW"]
    if "locus_alt" in up_df.columns:
        up_cols.append("locus_alt")
    for c in ("prot_len", "prot_seq"):
        if c in up_df.columns:
            up_cols.append(c)

    up_join = (
        up_df.dropna(subset=["locus_tag"])[up_cols]
        .rename(columns={"gene": "gene_UP", "product": "product_UP"})
        # Dedup by locus_tag so multi-isoform base rows (locus_tag with N rows)
        # don't fan out into N×M cross-products if UP also has duplicates.
        .drop_duplicates(subset=["locus_tag"], keep="first")
    )

    result = base_df.merge(up_join, on="locus_tag", how="left")

    # Fuzzy cascade for rows still unmatched after primary join
    up_ci_map, up_norm_map = _build_fuzzy_cascade(up_join["locus_tag"])
    up_idx       = up_join.drop_duplicates(subset=["locus_tag"]).set_index("locus_tag")
    alt_src_map  = {k: v["locus_tag"] for k, v in _build_alt_map(up_df).items()}
    up_ann_cols  = ["UniProtID", "reviewed", "gene_UP", "product_UP", "UP_FM", "UP_KW", "UP_PW"]
    for c in ("prot_len", "prot_seq"):
        if c in up_join.columns:
            up_ann_cols.append(c)

    # Protein-ID override: when an RS protein_id (NP_/YP_) is cross-referenced
    # by a UP entry's refseq_ids, prefer that UP entry over a locus_tag-only
    # match. This attaches isoform-specific UP entries to the specific isoform
    # row whose protein_id matches.
    proteid_to_uid: dict = {}
    if "refseq_ids" in up_df.columns:
        # drop=False so UniProtID remains as a column for up_row.get() lookups
        up_by_uid = up_join.drop_duplicates(subset=["UniProtID"]).set_index("UniProtID", drop=False)
        for _, ur in up_df.iterrows():
            uid  = ur.get("UniProtID")
            rids = str(ur.get("refseq_ids", "") or "")
            if not uid or not rids or uid not in up_by_uid.index:
                continue
            for rid in rids.split(";"):
                rid = rid.strip()
                if rid:
                    proteid_to_uid.setdefault(rid, uid)
    n_pid_match = n_pid_override = 0
    if proteid_to_uid and "protein_id" in result.columns:
        for idx, row in result.iterrows():
            pid = str(row.get("protein_id", "") or "").strip()
            if not pid or pid not in proteid_to_uid:
                continue
            target_uid = proteid_to_uid[pid]
            cur_uid    = row.get("UniProtID")
            if pd.notna(cur_uid) and cur_uid == target_uid:
                continue  # already matched correctly
            up_row = up_by_uid.loc[target_uid]
            for col in up_ann_cols:
                result.at[idx, col] = up_row.get(col, "")
            src = result.at[idx, "source"]
            if "UP" not in str(src).split(", "):
                result.at[idx, "source"] = str(src) + ", UP"
            if pd.isna(cur_uid):
                n_pid_match += 1
            else:
                n_pid_override += 1

    cascade_matches: dict = {"ci": [], "alt": [], "fuzzy": [], "prefix": []}

    for idx, row in result[result["UniProtID"].isna()].iterrows():
        matched_up_tag, match_type = _fuzzy_locus_match(
            row["locus_tag"], up_ci_map, up_norm_map, alt_src_map=alt_src_map)
        if matched_up_tag and matched_up_tag in up_idx.index:
            up_row = up_idx.loc[matched_up_tag]
            for col in up_ann_cols:
                result.at[idx, col] = up_row.get(col, "")
            src = result.at[idx, "source"]
            if "UP" not in str(src).split(", "):
                result.at[idx, "source"] = str(src) + ", UP"
            cascade_matches[match_type].append(
                (row["locus_tag"], matched_up_tag,
                 up_row.get("gene_UP", ""), up_row.get("product_UP", "")))

    # Log cascade detail
    _tier_labels = {"ci":     "Case-insensitive matches",
                    "alt":    "Alt locus_tag matches",
                    "fuzzy":  "Fuzzy matches — underscore normalisation",
                    "prefix": "Fuzzy matches — species-code prefix stripped (e.g. CELE_)"}
    n_cascade = sum(len(v) for v in cascade_matches.values())
    if n_cascade:
        # Dedup before set_index so multi-isoform locus_tags don't break .at[] lookups
        gb_lookup = (gb_df.drop_duplicates(subset=["locus_tag"], keep="first")
                          .set_index("locus_tag")[["gene", "product"]]
                          .rename(columns={"gene": "gene_GB", "product": "product_GB"}))
        rs_lookup = (base_df.drop_duplicates(subset=["locus_tag"], keep="first")
                            .set_index("locus_tag")[["gene", "product"]]
                            .rename(columns={"gene": "gene_RS", "product": "product_RS"}))
        for mtype, matches in cascade_matches.items():
            if not matches:
                continue
            log["edge"].append(f"\n{_tier_labels[mtype]} ({len(matches)}):")
            tbl_rows = []
            for rs_tag, up_tag, g_up, p_up in matches:
                g_rs = rs_lookup.at[rs_tag, "gene_RS"] if rs_tag in rs_lookup.index else ""
                p_rs = rs_lookup.at[rs_tag, "product_RS"] if rs_tag in rs_lookup.index else ""
                g_gb = gb_lookup.at[rs_tag, "gene_GB"] if rs_tag in gb_lookup.index else ""
                p_gb = gb_lookup.at[rs_tag, "product_GB"] if rs_tag in gb_lookup.index else ""
                tbl_rows.append((rs_tag, up_tag,
                                 *["" if pd.isna(v) else str(v)
                                   for v in [g_rs, g_gb, g_up, p_rs, p_gb, p_up]]))
            log["edge"].extend(_fmt_table(
                ["locus_tag", "UP_tag", "gene_RS", "gene_GB", "gene_UP",
                 "product_RS", "product_GB", "product_UP"],
                tbl_rows))

    n_ci, n_alt, n_fuzzy, n_pref = (len(cascade_matches[t]) for t in ("ci", "alt", "fuzzy", "prefix"))
    print(f"  Fuzzy cascade (UP): {n_ci} CI, {n_alt} alt-token, {n_fuzzy} underscore-norm, {n_pref} prefix-strip")
    if n_cascade:
        log["result"].append(
            f"Fuzzy cascade (UP): {n_ci} CI, {n_alt} alt-token, {n_fuzzy} underscore-norm, {n_pref} prefix-strip")
    if n_pid_match or n_pid_override:
        msg = (f"Protein_id cross-ref (UP refseq_ids): {n_pid_match} new matches, "
               f"{n_pid_override} overrides of locus_tag match")
        print(f"  {msg}")
        log["result"].append(msg)

    # Overwrite gene/product for CDS rows where UP has richer annotation
    is_cds           = result["type"] == "CDS"
    gene_up_nonempty = result["gene_UP"].fillna("") != ""
    prod_up_nonempty = result["product_UP"].fillna("") != ""
    result.loc[is_cds & gene_up_nonempty, "gene"]    = result.loc[is_cds & gene_up_nonempty,    "gene_UP"]
    result.loc[is_cds & prod_up_nonempty, "product"] = result.loc[is_cds & prod_up_nonempty, "product_UP"]

    drop_cols = ["gene_UP", "product_UP"] + (["locus_alt"] if "locus_alt" in result.columns else [])
    result = result.drop(columns=drop_cols)

    n_matched  = result["UniProtID"].notna().sum()
    n_void_up  = up_df["locus_tag"].isna().sum()
    print(f"  UniProtID matched: {n_matched}/{len(result)} DB entries "
          f"({n_matched / len(result) * 100:.1f}%)")
    log["result"].append(
        f"UniProtID matched: {n_matched}/{len(result)} DB entries "
        f"({n_matched / len(result) * 100:.1f}%)  [{n_void_up} UP entries had no locus_tag]")
    return result


# ---------------------------------------------------------------------------
# Stage 3 — DeepLocPro join (optional)
# ---------------------------------------------------------------------------

def merge_deeploc(merged: pd.DataFrame, dl_file: str, log: dict) -> pd.DataFrame:
    """LEFT JOIN DeepLocPro localisation predictions onto merged by UniProtID."""
    if not os.path.exists(dl_file):
        print("Stage 3 — DL merge: skipped (_DL.csv not found).")
        log["result"].append("DL merge: skipped (_DL.csv not found).")
        return merged

    dl_df  = pd.read_csv(dl_file)[["UniProtID", "localz"]]
    merged = merged.merge(dl_df, on="UniProtID", how="left")
    n_dl   = merged["localz"].notna().sum()
    msg    = f"DL merge: {n_dl}/{len(merged)} entries matched."
    print(f"Stage 3 — {msg}")
    log["result"].append(msg)
    return merged


# ---------------------------------------------------------------------------
# Stage 4 — KEGG join (optional)
# ---------------------------------------------------------------------------

def merge_kegg(merged: pd.DataFrame, kg_file: str, log: dict) -> pd.DataFrame:
    """LEFT JOIN KEGG pathway/family annotations onto merged by locus_tag.

    Falls back through a fuzzy cascade for unmatched rows (handles BSU_/BSU-style
    locus_tag format differences between RS/GB and KEGG).
    """
    if not os.path.exists(kg_file):
        print("Stage 4 — KG merge: skipped (_KG.csv not found).")
        log["result"].append("KG merge: skipped (_KG.csv not found).")
        return merged

    kg_cols = ["KG_FM", "KG_FG", "KG_PC", "KG_PG", "KG_PW"]
    kg_df   = pd.read_csv(kg_file)[["locus_tag"] + kg_cols]
    # Dedup KG by locus_tag so multi-isoform base rows don't fan out
    kg_join = kg_df.drop_duplicates(subset=["locus_tag"], keep="first")
    merged  = merged.merge(kg_join, on="locus_tag", how="left")

    # Fuzzy fallback for rows still unmatched after primary join
    kg_unmatched = merged["KG_FM"].isna() & merged["KG_PW"].isna()
    n_fuzzy_kg   = 0
    if kg_unmatched.any():
        kg_ci_map, kg_norm_map = _build_fuzzy_cascade(kg_df["locus_tag"])
        kg_idx = kg_df.drop_duplicates(subset=["locus_tag"]).set_index("locus_tag")
        for idx, row in merged[kg_unmatched].iterrows():
            matched_kg_tag, _ = _fuzzy_locus_match(row["locus_tag"], kg_ci_map, kg_norm_map)
            if matched_kg_tag and matched_kg_tag in kg_idx.index:
                for col in kg_cols:
                    merged.at[idx, col] = kg_idx.at[matched_kg_tag, col]
                n_fuzzy_kg += 1

    n_kg_pw    = (merged["KG_PW"].notna() & (merged["KG_PW"] != "")).sum()
    n_kg_fm    = (merged["KG_FM"].notna() & (merged["KG_FM"] != "")).sum()
    n_kg       = ((merged["KG_PW"].notna() & (merged["KG_PW"] != "")) |
                  (merged["KG_FM"].notna() & (merged["KG_FM"] != ""))).sum()
    fuzzy_note = f", {n_fuzzy_kg} via fuzzy match" if n_fuzzy_kg else ""
    msg        = (f"KG merge: {n_kg}/{len(merged)} entries matched "
                  f"({n_kg_pw} with pathway, {n_kg_fm} with family{fuzzy_note}).")
    print(f"Stage 4 — {msg}")
    log["result"].append(msg)
    return merged
