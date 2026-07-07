# S. aureus NCTC 8325 — org-specific resources (taxid 93061)

**Current state (2026-06-26):** browsable locally — Tier 0 + Tier 1 + part of Tier 2 built.
- ✅ **Tier 0 enriched** → `core/93061_Sa_DB.csv` (3,009 features w/ coord, chrom `NC_007795.1`).
- ✅ **Tier 1 (general)** built: AlphaFold structures (2,952), domains/InterPro/CDD, RNA, interactions
  (2,880; STRING 93061), KEGG pathways (107 maps + `sao01100` overview), seq-sim (1,239) + struct-sim (2,098).
- 🔶 **Tier 2 (org-specific):**
  - ✅ **essentiality** → DEG1061 / Coe 2019 genome-wide Tn-seq (286 essential, `SAOUHSC_`-keyed, no crosswalk)
  - ✅ **conservation** → 3,008 loci (RefSeq 60-genome panel π recompute, ref `NC_007795.1`, median π 0.0089)
    + **variants** → 2,956 loci, 184,873 sites (same panel)
  - ✅ **RNA modifications** → 5 rRNA genes (MODOMICS *Staphylococcus aureus*; tRNA contexts didn't map)
  - 🔶 **expression** → **protein only**: PaxDb 93061 (1,848 proteins, `SAOUHSC_`-keyed, in PaxDb's `latest`
    release not `5.0`). Transcript not built — iModulonDB `staph_precise108/165` is USA300-keyed → needs the
    USA300 → NCTC 8325 crosswalk.
  - ✅ **regulation** → RegPrecise (N315 regulons, 48 TF regulators w/ activator/repressor direction +
    operons) mapped to our `SAOUHSC_` loci via the AureoWiki N315→NCTC 8325 ortholog matrix. 549 genes. No
    sigma/modulon layer (no Sa source). Known gaps: SarA/MgrA/Rot absent from RegPrecise. See `build-regulation.mjs`.
  - ✅ **regulatory map** (positional) → RegPrecise binding-site **motifs** sequence-anchored to NC_007795.1
    (the N315 site offsets don't transfer, so each 14–20 bp motif is located uniquely within 600 bp of the
    orthologous gene). 505 genes, 708 TFBS (effect set). See `build-regulatory-map.mjs`.
  - ⬜ mutability — no mutation-accumulation dataset exists for S. aureus (only natural/clinical diversity,
    already covered by conservation/variants)

Locally the tile shows **ready** (data on disk); `available:false` in `organism.json` until packed + hosted.

**Strain caveat:** our genome is **NCTC 8325** (`SAOUHSC_` loci). The best transcriptomics/essentiality
datasets are **USA300** — so most Sa Tier 2 needs a USA300 → NCTC 8325 locus crosswalk (via gene symbol /
UniProt). This is the main difference from Mtb (which is clean Rv-keyed).

## Verified Tier 2 sources (smoke-tested 2026-06-25)

| Resource | Status | Source (verified) |
|---|---|---|
| **RNA modifications** | ✅ buildable | MODOMICS **has** *S. aureus* (modified rRNA/tRNA returned by `genesilico.pl/modomics/api/sequences/?organism=Staphylococcus%20aureus`). Cleanest Sa Tier 2 to build — mirror E. coli's `build-rna-modifications`. |
| **expression** | ⚠️ needs crosswalk | iModulonDB `s_aureus` datasets exist = `staph_precise108` / `staph_precise165`, **but USA300** (Poudel 2020). Gene-id format ≠ our `SAOUHSC_` → needs USA300→NCTC 8325 map. PaxDb has Sa (species `1280`). Not built. |
| **essentiality** | ⚠️ source TBD | **OGEE down** (conn timeout); old `ogee.medgenius.info` = 410. **DEG** reachable (`origin.tubic.org/deg`, has S. aureus). Best fit: a NCTC 8325-lineage Tn-seq table (Valentino 2014 / HG003, Chaudhuri 2009, Santiago 2015 — `SAOUHSC_`-keyed). Parse a supplementary table. Not built. |
| **conservation / variants** | ✅ method, not built | Same RefSeq genome-panel π recompute as E. coli (MUMmer); swap species + reference `NC_007795.1`. No external API. |
| **regulation (TF/operon)** | ⚠️ to verify | RegPrecise reachable (`download.jsp` + collections cover S. aureus); **AureoWiki** (curated SA). Export format + locus map not yet verified. Sparser than E. coli. |
| **mutation frequency** | ❌ skip | No MA-line analog. |

## Build commands

```bash
# Tier 0 enrich (done):
python scripts/enrich/enrich.py 93061 Sa --core resources/93061_Sa/93061_Sa_DB.csv --out resources/93061_Sa/core/93061_Sa_DB.csv
npm run build-organism -- 93061 --general-only   # Tier 1 (done)
node scripts/organisms/93061_Sa/build.mjs 93061  # Tier 2 (conservation, variants, RNA mods, expression, essentiality, regulation, regulatory-map)
```

## Remaining (Tier 2)

- [x] ~~RNA modifications~~ — built (MODOMICS Sa: 5 rRNA; tRNA didn't map)
- [x] ~~conservation/variants~~ — built (general `build-conservation.mjs`/`build-variants.mjs`, ref `NC_007795.1`)
- [x] ~~essentiality~~ — built (DEG1061 / Coe 2019 Tn-seq, `SAOUHSC_`-keyed) and renders via the generalized UI
- [x] ~~expression (protein)~~ — built (PaxDb 93061, `latest` release; 1,848 proteins)
- [x] ~~regulation~~ — built (RegPrecise N315 → AureoWiki ortholog crosswalk → SAOUHSC_; 48 TF regulons)
- [x] ~~regulatory map (positional)~~ — built (RegPrecise motifs sequence-anchored to NC_007795.1; 708 TFBS)
- [ ] **expression (transcript)** — needs the USA300 → NCTC 8325 crosswalk for iModulonDB `staph_precise108`
  (set `imodulonOrg`/`imodulonDataset` once a SAUSA300_ → SAOUHSC_ map exists)
- [ ] **regulation** — verify RegPrecise/AureoWiki export
- [ ] pack + host; set `url`/`available:true`/`bytes` in `organism.json`
