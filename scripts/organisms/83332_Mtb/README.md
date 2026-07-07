# M. tuberculosis H37Rv — org-specific resources (taxid 83332)

**Current state (2026-06-26):** browsable locally — Tier 0 + Tier 1 + most of Tier 2 built.
- ✅ **Tier 0 enriched** → `core/83332_Mtb_DB.csv` (4,149 features w/ coord, chrom `NC_000962.3`).
- ✅ **Tier 1 (general)** built: AlphaFold structures (3,990), domains/InterPro/CDD, RNA, interactions
  (4,031; STRING 83332), KEGG pathways (132 maps + `mtu01100` overview), seq-sim (2,153) + struct-sim (3,053).
- ✅ **Tier 2 (org-specific):**
  - ✅ **expression** → PaxDb 83332 (3,406 protein) + iModulonDB `m_tuberculosis/modulome` (3,906 transcript)
  - ✅ **essentiality** → MtbTnDB Sassetti 2003 (614 essential) — **now renders** (the essentiality UI was
    generalized to a source-agnostic schema: categorical Tn-seq sources draw a stacked genome-wide bar)
  - ✅ **conservation** → 4,136 loci (RefSeq 60-genome panel π recompute, ref `NC_000962.3`; Mtb is clonal,
    median π ≈ 0.0003) + **variants** → 3,704 loci (same panel)
  - ✅ **regulation** → MTB Network Portal TRN (210 regulators, 12 sigma factors, Rv-keyed) + BioCyc operons
    (2,517) + iModulonDB modulons (80), via the `modulome_mtb` bundle. 4,071 genes. See `build-regulation.mjs`.
    Caveat: the TRN is ChIP/binding-based → no activator/repressor direction (edge `function` is null).
  - ✅ **regulatory map** (positional) → Minch/Rustad 2015 (Nat Commun) ChIP-seq peaks on H37Rv (NC_000962.3).
    3,523 genes, 16,374 features (TFBS + TSS/promoter); effect from the TFOE expression sign. See `build-regulatory-map.mjs`.
  - ⬜ RNA modifications — skipped (MODOMICS empty for Mtb); mutability — no mutation-accumulation dataset
    exists for Mtb (clinical/in-vivo rates only; the one MA study is *M. smegmatis*)

Locally the tile shows **ready** (data on disk). It's still `available:false` in `organism.json` — to make it
downloadable for others: `npm run pack-assets -- 83332` → host the archive → set `url`/`available`/`bytes`.

Everything joins on **Rv numbers** (= our H37Rv `locus_tag`), so no strain crosswalk is needed — Mtb is clean.

## Verified Tier 2 sources (smoke-tested 2026-06-25)

| Resource | Status | Source (verified) |
|---|---|---|
| **expression** | ✅ built | iModulonDB `m_tuberculosis/modulome` (transcript, Rv-keyed) + PaxDb `83332` (protein). [build-expression.mjs](build-expression.mjs); ids in `organism.json` (`imodulonOrg`/`imodulonDataset`/`paxdbSpecies`). 3,964 features. |
| **essentiality** | 🔶 data built, **not rendered** | MtbTnDB `github.com/ajinich/mtb_tn_db` → `data/SI_datasets/SI_bin.csv`. **Caveat:** that matrix is per-study/conditional (dnaA flagged in only 1/40 cols) — a naive all-study vote is wrong. [build-essentiality.mjs](build-essentiality.mjs) uses the one clean in-vitro essential column `2003A_Sassetti` (614 essential, incl. dnaA) → `essentiality/tnseq.json`. **Upgrade:** DeJesus 2017 Table S3 (ES/ESD/GD/GA/NE per Rv) is the gold standard but its XLSX is NCBI hotlink-blocked + OA package 404s. **Blocker to display:** the API/web essentiality field is hardcoded to E. coli's EcoCyc+CRISPRi (labels, 3-category bar, LB/M9 dists) — needs a generic source generalization. |
| **conservation / variants** | ✅ method, not built | Same RefSeq genome-panel π recompute as E. coli (MUMmer); swap species + reference `NC_000962.3`. No external API. |
| **regulation (TF/operon)** | ⚠️ to verify | RegPrecise reachable (`regprecise.lbl.gov` `download.jsp` + tax collections cover Mtb); MTB Network Portal; Mycobrowser. Per-genome export format + locus map **not yet verified**. |
| **RNA modifications** | ❌ skip | MODOMICS returns **empty** for *M. tuberculosis* (`{}`). |
| **mutation frequency** | ❌ skip | No MA-line analog (drug-resistance variant DBs are a different concept). |

Notes: **Mycobrowser** has no structured essentiality column in its bulk TSV (the "essential" text is prose in
Function/Comments); **OGEE** was unreachable (connection timeout) at smoke-test time.

## Build commands

```bash
# Tier 0 enrich (done):
python scripts/enrich/enrich.py 83332 Mtb --core resources/83332_Mtb/83332_Mtb_DB.csv --out resources/83332_Mtb/core/83332_Mtb_DB.csv
npm run build-organism -- 83332 --general-only   # Tier 1 (done)
node scripts/organisms/83332_Mtb/build.mjs 83332 # Tier 2 (expression, essentiality, conservation, variants, regulation, regulatory-map)
```

## Remaining

- [x] ~~essentiality **UI generalization**~~ — done: the essentiality field is now source-agnostic
  (shared `Essentiality.tnseq` + a generic categorical bar in `EssentialityField.tsx`), so `tnseq.json` renders.
- [x] ~~conservation/variants~~ — done (general `build-conservation.mjs`/`build-variants.mjs`, manifest-driven).
- [x] ~~regulation~~ — built (MTB Network Portal TRN + BioCyc operons + iModulonDB modulons; see above).
- [x] ~~regulatory map (positional)~~ — built (Minch/Rustad 2015 ChIP-seq peaks on H37Rv).
- [ ] (optional) upgrade essentiality source to DeJesus 2017 once reliable XLSX access exists
- [ ] (optional) add edge direction to regulation if a directional Mtb TRN becomes available
- [ ] pack + host archive; set `url`/`available:true`/`bytes` in `organism.json`
