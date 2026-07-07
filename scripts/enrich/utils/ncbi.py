"""
utils/ncbi.py — NCBI Datasets API helpers.

Provides:
  get_reference_accession(tax_id, assembly_source, api_key) -> str
  download_gbff(accession, api_key)                         -> bytes  (zip)
  extract_gbff(zip_bytes)                                   -> bytes  (raw GBFF)
  parse_gbff(gbff_bytes)                                    -> pd.DataFrame
"""

import io
import re
import sys
import zipfile

import pandas as pd
import requests
from Bio import SeqIO

NCBI_API_BASE = "https://api.ncbi.nlm.nih.gov/datasets/v2"

ASSEMBLY_SOURCE_MAP = {
    "GB": "genbank",
    "RS": "refseq",
}


def get_reference_accession(tax_id: str, assembly_source: str, api_key: str | None) -> str:
    """Return the best available assembly accession for a given taxonomy ID.

    Query cascade (stops at first non-empty result):
      1. reference_only=true          — NCBI-designated reference genome
      2. assembly_level=Complete Genome — any complete genome for this taxon
      3. assembly_level=Chromosome    — chromosome-level assembly
      4. no filter                    — best available assembly

    The NCBI reference designation is always on the RefSeq (GCF_) entry.
    For GenBank, we fetch the RefSeq reference and return its paired GCA_ accession.
    """
    url = f"{NCBI_API_BASE}/genome/taxon/{tax_id}/dataset_report"
    base_params: dict = {"page_size": 1}
    if api_key:
        base_params["api_key"] = api_key

    query_tiers = [
        {"filters.reference_only": "true",               "label": "reference"},
        {"filters.assembly_level": "Complete Genome",    "label": "complete genome"},
        {"filters.assembly_level": "Chromosome",         "label": "chromosome-level"},
    ]

    report = None
    matched_label = ""
    for tier in query_tiers:
        label = tier.pop("label")
        params = {**base_params, **tier}
        resp = requests.get(url, params=params, timeout=60)
        resp.raise_for_status()
        reports = resp.json().get("reports", [])
        if reports:
            report = reports[0]
            matched_label = label
            break

    if report is None:
        sys.exit(
            f"Error: No complete or chromosome-level assembly found for taxonomy ID {tax_id}. "
            f"Check that the tax_id is strain-level (not species-level) and that a genome "
            f"exists for this strain in NCBI."
        )

    if matched_label != "reference":
        print(f"Note: No NCBI-designated reference assembly for taxid {tax_id}; "
              f"using {matched_label} assembly for the same strain. "
              f"Verify that locus tags are consistent with your UniProt/KEGG data.")

    if assembly_source == "refseq":
        accession = report["accession"]  # GCF_
    else:
        accession = report.get("paired_accession") or report.get(
            "assembly_info", {}
        ).get("paired_assembly", {}).get("accession")
        if not accession:
            sys.exit(
                f"Error: No paired GenBank (GCA_) accession found for the reference assembly {report['accession']}."
            )

    print(f"Found {matched_label} assembly: {accession}")
    return accession


def download_gbff(accession: str, api_key: str | None) -> bytes:
    """Download the GBFF genome package ZIP and return raw bytes."""
    url = f"{NCBI_API_BASE}/genome/accession/{accession}/download"
    params = {"include_annotation_type": "GENOME_GBFF"}
    if api_key:
        params["api_key"] = api_key

    print(f"Downloading GBFF for {accession} ...")
    resp = requests.get(url, params=params, stream=True, timeout=300)
    resp.raise_for_status()

    chunks = []
    for chunk in resp.iter_content(chunk_size=1024 * 1024):
        chunks.append(chunk)
    data = b"".join(chunks)
    print(f"Download complete ({len(data) / 1e6:.1f} MB).")
    return data


def _format_coord(loc) -> str:
    """Format a BioPython FeatureLocation/CompoundLocation as a GBFF-style string.

    Examples: '190..255', 'complement(190..255)', 'join(1..50,100..200)'.
    Uses 1-based inclusive coordinates. Fuzzy endpoints rendered as '<1' / '>100'.
    """
    def _pos(p, is_start):
        v = int(p) + 1 if is_start else int(p)
        cls = type(p).__name__
        prefix = "<" if cls == "BeforePosition" else (">" if cls == "AfterPosition" else "")
        return f"{prefix}{v}"

    def _span(fl):
        return f"{_pos(fl.start, True)}..{_pos(fl.end, False)}"

    parts = getattr(loc, "parts", [loc])
    if len(parts) == 1:
        body = _span(parts[0])
    else:
        op = getattr(loc, "operator", "join")
        body = f"{op}(" + ",".join(_span(p) for p in parts) + ")"

    if loc.strand == -1:
        return f"complement({body})"
    return body


def extract_gbff(zip_bytes: bytes) -> bytes:
    """Extract the .gbff file contents from the NCBI Datasets ZIP package.

    If the ZIP contains multiple .gbff files, they are concatenated in the order
    they appear in the archive (matches NCBI's bundled output for multi-replicon
    assemblies).
    """
    parts = []
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        gbff_files = [n for n in zf.namelist() if n.endswith(".gbff")]
        for name in gbff_files:
            with zf.open(name) as fh:
                parts.append(fh.read())
    return b"".join(parts)


def parse_gbff(gbff_bytes: bytes) -> pd.DataFrame:
    """
    Parse gene features from raw GBFF file bytes.

    Returns a DataFrame with columns:
        GeneID, locus_tag, rna_id, protein_id, type, gene, product,
        chrom, chrom_topo, chrom_len, species, strain, org, coord, len, seq

    Features without a locus_tag are skipped with a warning to stderr.
    For genes with multiple isoforms (alt splicing), each unique
    (locus_tag, rna_id|protein_id, coord) tuple is kept as a separate row.
    """
    rows = []
    skipped = 0

    print(f"Parsing GBFF ({len(gbff_bytes) / 1e6:.1f} MB) ...")
    text = io.TextIOWrapper(io.BytesIO(gbff_bytes), encoding="utf-8")

    for record in SeqIO.parse(text, "genbank"):
        chrom       = record.id
        chrom_topo  = record.annotations.get("topology", "")
        try:
            chrom_len = len(record.seq)
        except Exception:
            chrom_len = ""
        full_org    = ""
        gbff_strain = ""
        for feat in record.features:
            if feat.type == "source":
                full_org    = feat.qualifiers.get("organism", [""])[0]
                gbff_strain = feat.qualifiers.get("strain",   [""])[0]
                break
        if not full_org:
            full_org = record.annotations.get("organism", "")

        # species = first two words (binomial: genus + species); strain = remainder
        # (with surrounding brackets/parens stripped).
        words   = full_org.split()
        species = " ".join(words[:2])
        strain  = " ".join(words[2:])
        strain  = re.sub(r"[()\[\]]", "", strain).strip()
        # Sanity check: GBFF strain qualifier should appear within derived strain
        if gbff_strain and strain and gbff_strain not in strain:
            print(f"  WARNING: GBFF strain '{gbff_strain}' not found in derived "
                  f"strain '{strain}' for species '{species}' ({chrom}).",
                  file=sys.stderr)

        # org = abbreviated binomial + GBFF strain qualifier (e.g. "E. coli K-12")
        sp_parts = species.split(" ", 1)
        if len(sp_parts) == 2 and sp_parts[0]:
            org = f"{sp_parts[0][0]}. {sp_parts[1]}"
        else:
            org = species
        if gbff_strain:
            org = f"{org} {gbff_strain}".strip()

        # Queue of pending mRNA rna_ids per locus, to inherit
        # onto the next CDS for the same locus (GBFF emits mRNA
        # immediately before its paired CDS, so FIFO pairing works
        # for alt-spliced loci too).
        mrna_pending: dict = {}

        for feature in record.features:
            ftype = feature.type

            if ftype in ("gene", "source", "repeat_region", "STS",
                         "rep_origin", "exon", "intron"):
                continue

            qualifiers = feature.qualifiers

            locus_tag_list = qualifiers.get("locus_tag")
            if not locus_tag_list:
                loc = str(feature.location)
                print(
                    f"  WARNING: Feature type '{ftype}' at {loc} has no locus_tag — skipping.",
                    file=__import__("sys").stderr,
                )
                skipped += 1
                continue

            locus_tag = locus_tag_list[0]

            gene_id = ""
            for xref in qualifiers.get("db_xref", []):
                if xref.startswith("GeneID:"):
                    gene_id = xref.split(":", 1)[1]
                    break

            try:
                nt_seq = str(feature.extract(record.seq)).upper()
            except Exception:
                nt_seq = ""

            rna_id     = qualifiers.get("transcript_id", [""])[0]
            protein_id = qualifiers.get("protein_id",    [""])[0]

            if ftype == "mRNA" and rna_id:
                # Queue this rna_id to be inherited by the next CDS
                # of the same locus
                mrna_pending.setdefault(locus_tag, []).append(rna_id)
            elif ftype == "CDS" and not rna_id:
                pending = mrna_pending.get(locus_tag, [])
                if pending:
                    rna_id = pending.pop(0)

            rows.append(
                {
                    "GeneID": gene_id,
                    "locus_tag": locus_tag,
                    "rna_id":     rna_id,
                    "protein_id": protein_id,
                    "type": ftype,
                    "gene": qualifiers.get("gene", [""])[0],
                    "product": qualifiers.get("product", [""])[0],
                    "chrom": chrom,
                    "chrom_topo": chrom_topo,
                    "chrom_len": chrom_len,
                    "species": species,
                    "strain": strain,
                    "org": org,
                    "coord": _format_coord(feature.location),
                    "len": len(nt_seq) if nt_seq else "",
                    "seq": nt_seq,
                }
            )

    if skipped:
        print(
            f"WARNING: {skipped} feature(s) skipped due to missing locus_tag.",
            file=sys.stderr,
        )

    df = pd.DataFrame(rows, columns=["GeneID", "locus_tag", "rna_id", "protein_id",
                                     "type", "gene", "product",
                                     "chrom", "chrom_topo", "chrom_len",
                                     "species", "strain", "org",
                                     "coord", "len", "seq"])
    n_raw = len(df)

    # For loci where any CDS row exists, drop all non-CDS rows. This removes
    # companion mRNA features (eukaryotic protein-coding genes) and descriptive
    # misc_feature annotations (e.g. fragment ranges on interrupted prophage
    # CDSs). The CDS row carries the protein_id, joined coord, and translation.
    loci_with_cds = set(df.loc[df["type"] == "CDS", "locus_tag"].dropna())
    df = df[~((df["type"] != "CDS") & (df["locus_tag"].isin(loci_with_cds)))]

    # Dedup: keep distinct (locus_tag, rna_id, protein_id, type, coord) tuples.
    # For prokaryotes this leaves one row per locus_tag (no isoforms);
    # for eukaryotes with alt splicing it keeps one row per RNA/protein isoform.
    df = df.drop_duplicates(
        subset=["locus_tag", "rna_id", "protein_id", "type", "coord"], keep="first"
    ).reset_index(drop=True)

    n_dropped = n_raw - len(df)
    n_locus   = df["locus_tag"].nunique()
    n_isoform = (df.groupby("locus_tag").size() > 1).sum()
    print(f"Parsed {len(df)} feature entries from GBFF "
          f"({n_locus} unique locus_tags, {n_isoform} with multiple isoforms, "
          f"{n_dropped} duplicate/housekeeping features dropped).")
    return df
