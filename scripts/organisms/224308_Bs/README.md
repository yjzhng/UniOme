# B. subtilis subsp. subtilis str. 168 — org-specific resources (taxid 224308)

**Current state (2026-06-26):** browsable locally — **Tier 0 + Tier 1 + most of Tier 2 built**.
- ✅ **Tier 0 enriched** → `core/224308_Bs_DB.csv` (4,659 features w/ coord, chrom `NC_000964.3`,
  4,215,606 bp circular). Source prokDB core had 4,671 rows; 12 UP-only (no genome match) filtered at ingest.
- ✅ **Tier 1 (general)** built: AlphaFold structures (~4,287), domains/InterPro/CDD, RNA, interactions
  (STRING 224308), seq-sim (2,124) + struct-sim, KEGG pathways (**116 maps + `bsu01100` overview, 723
  genes located**), reactions (1,131 enzymes).
- 🔶 **Tier 2 (org-specific):**
  - ✅ **conservation** → 4,659 loci (RefSeq 60-genome panel π recompute, ref `NC_000964.3`, median π 0.0135)
  - ✅ **variants** → 4,507 loci, 553,805 variant sites (same panel)
  - ✅ **RNA modifications** → 20 rRNA + 39 tRNA genes (MODOMICS *Bacillus subtilis*)
  - ✅ **expression** → 4,014 protein (PaxDb 224308) + 4,325 transcript (iModulonDB `b_subtilis/modulome`)
  - ✅ **essentiality** → DEG1001 / Kobayashi 2003 genome-wide knockout (271 essential; mapped via UniProt
    accession since DEG1001 has no BSU locus key). SubtiWiki / Koo 2017 noted as an upgrade path.
  - ✅ **regulation** → SubtiWiki v5 REST (243 regulons w/ activator/repressor direction, 220 regulators,
    19 sigma factors, 2,297 operons; `BSU`-keyed) + iModulonDB `b_subtilis/modulome` modulons (72). 3,651
    genes. See `build-regulation.mjs`.
  - ✅ **regulatory map** (positional) → DBTBS (per-operon promoters/TFBS/terminators, sequence-anchored to
    NC_000964.3). 1,734 genes, 4,273 features (1,663 promoters w/ sigma, 1,492 TFBS w/ effect, 1,118
    terminators). See `build-regulatory-map.mjs`. (SubtiWiki v5 REST exposes no positional coords → DBTBS.)
  - ✅ **mutability** → Tanneur 2025 (NAR) mutation-accumulation BPS, MMR-deficient genotypes, on AL009126.3
    (= NC_000964.3). 4,659 loci. See `build-mutation.mjs`.

Locally the tile shows **ready** (data on disk); `available:false` in `organism.json` until packed + hosted.

## Identifiers

| Field | Value |
|---|---|
| strain taxid | `224308` (B. subtilis subsp. subtilis str. 168) |
| species taxid | `1423` (Bacillus subtilis) |
| KEGG org (`keggid`) | `bsu` |
| RefSeq chrom / ref assembly | `NC_000964.3` / `GCF_000009045.1` (GenBank `AL009126.3`) |
| STRING / PaxDb species | `224308` / `224308` |
| iModulonDB | `b_subtilis` / `modulome` |

**Locus-tag caveat:** our RefSeq loci are `BSU_#####` (underscore). KEGG (`bsu`) and PaxDb key the same
genes as `BSU#####` (no underscore), while iModulonDB keeps the underscore. The general builders bridge
this with an underscore-stripped **alias** (see `build-pathway-maps.mjs` / `build-expression.mjs`) — this
is why the first Tier-1 pathway pass located 0 genes until the alias was added.

## Build commands

```bash
# Tier 0 enrich (done):
python scripts/enrich/enrich.py 224308 Bs \
  --core resources/224308_Bs/224308_Bs_DB.csv --out resources/224308_Bs/core/224308_Bs_DB.csv
npm run build-organism -- 224308 --general-only   # Tier 1 (done)
node scripts/organisms/224308_Bs/build.mjs 224308 # Tier 2 (conservation, variants, RNA mods, expression, essentiality, regulation, regulatory-map, mutation)
```

## Remaining / not built

- [x] ~~regulation (TF/operon)~~ — built (SubtiWiki v5 REST + iModulonDB modulons).
- [x] ~~regulatory map (positional)~~ — built (DBTBS, sequence-anchored to NC_000964.3).
- [x] ~~mutation frequency~~ — built (Tanneur 2025 MA-line BPS).
- [ ] pack + host; set `url`/`available:true`/`bytes` in `organism.json`.
