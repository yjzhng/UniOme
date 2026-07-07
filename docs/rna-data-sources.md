# RNA annotation pipeline — data sources & per-species config

How the RNA viewer's data is built, and **exactly what to change to apply it to another
organism**. Everything is produced by [`scripts/general/fetch-rna-assets.mjs`](../scripts/general/fetch-rna-assets.mjs)
(download-once, serve-local) into `resources/<taxid>_<name>/rna/`, served by
[`apps/api/src/rna.ts`](../apps/api/src/rna.ts), rendered by
[`apps/web/src/modules/RnaPanel.tsx`](../apps/web/src/modules/RnaPanel.tsx).

The whole pipeline keys off an **RNAcentral URS**, resolved by **exact sequence** (md5) — no
name/coordinate/fuzzy matching.

## Data sources

| Aspect | Database / endpoint | Keyed by | RNA types | Notes |
|---|---|---|---|---|
| **URS resolution** | RNAcentral `/api/v1/rna?md5=<md5>&taxid=<taxid>` | `md5(seq.toUpperCase().replace(/U/g,'T'))` + taxid | all | md5 is of the **DNA-alphabet** (U→T) uppercase sequence — a naive RNA md5 won't match RNAcentral's stored md5. |
| **Species record + SO** | EBI Search `ebisearch/ws/rest/rnacentral/entry/<URS>_<taxid>?fields=so_rna_type_name,rna_type,description` | `URS_taxid` | all | Returns an entry **only if a real species record exists** (NOT lineage-matched). Carries the SO `so_rna_type_name` lineage. `query=<bare URS>` returns 0 — must use the full `URS_taxid`. |
| **2D structure** | RNAcentral `/api/v1/rna/<URS>/2d/<taxid>/` (trailing slash) | URS + taxid | any with an R2DT template | Returns dot-bracket + `model_id` + `layout` (SVG). The SVG `<g><title>P (position.label in template: T.X)` encodes **template position** T per nucleotide. |
| **3D structure** | RNAcentral `/api/v1/rna/<URS>/xrefs` (filter `database:"PDBe"`) → RCSB `https://models.rcsb.org/<pdb>.bcif` | URS → PDB id + chain | sparse (structure-backed only) | `database=` filter is ignored; `page_size>~500` returns the HTML SPA (cap 500, guard content-type). BGSU/PDBe chain ≠ stored chain sometimes; Mol* isolates the chain. |
| **Rfam family** (Family track) | RNAcentral `/api/v1/rna/<URS>/rfam-hits/?format=json` | URS (bare) | all | RF accession + `short_name` + `rfam_clan` + hit region (`sequence_start`/`sequence_stop`). |
| **2D motifs** (Motifs track) | decoded locally from the dot-bracket | sequence position | all with 2D | stems / hairpin / internal / bulge / multiloop (K-way) / pseudoknot / ends (`decodeFeatures`). |
| **3D-observed loops** | BGSU RNA 3D Hub `https://rna.bgsu.edu/rna3dhub/loops/download/<PDB>` (CSV) | PDB + chain | structure-backed | loop ids `HL_/IL_/J3_…`; unit-id format `PDB|model|chain|res|num`. Flags a 2D loop as `observed3d`. NR-rep classification + named motifs are NOT used (sparse, often unnamed). |
| **Functional regions** (Arms/Domains tracks) | R2DT template numbering (parsed from the 2D SVG `<title>`s) + per-family rules | template position → arm/domain | family-specific (below) | `templateMap` + `functionalRegions`. |
| **Helix numbering** (Helices track) | RiboVision tables `https://raw.githubusercontent.com/RiboZones/RiboVision/master/Tables/EC_SSU_3D.csv` + `EC_LSU_3D.csv` | E. coli residue (`resNum`) → `Helix_Num` | rRNA (16S/23S/5S) | `loadHelixTables`. LSU file: skip the type-declaration row (non-numeric `resNum`); `ChainID` A=23S, B=5S. Helix ids are bare (`1`,`44`,`25a`,`5S1`); h/H prefix applied in code. NOT present in the R2DT SVG. |

## Family-specific functional logic (`functionalRegions` in the fetch script)

| Rfam acc | RNA | Tracks produced | Numbering source |
|---|---|---|---|
| `RF00005` | tRNA | **Arms**: acceptor stem, D-arm, anticodon arm, anticodon (triplet), variable loop, T-arm | **Sprinzl** ranges, from template positions (universal across tRNAs) |
| `RF00177` | bacterial 16S rRNA | **Domains** (5′/central/3′-major/3′-minor) + **Helices** | domain boundaries (E. coli SSU numbering) + RiboVision SSU |
| `RF02541` | bacterial 23S rRNA | **Helices** | RiboVision LSU (chain A) |
| `RF00001` | 5S rRNA | **Helices** | RiboVision LSU (chain B) |

Tracks rendered in `RnaPanel`, top→bottom: **Family → Arms/Domains → Helices → Motifs**.

## Organism-specific / hardcoded values — the only things to reconfigure

All live in [`scripts/general/fetch-rna-assets.mjs`](../scripts/general/fetch-rna-assets.mjs):

1. **Resource folder + taxid** — `resources/<taxid>_<name>/` with `<...>_DB.csv`; taxid is the script's first arg. (E. coli K-12 = `83333`.)
2. **Fallback taxids** — `MG1655 = '511145'` (the genome-annotated strain) and `ECOLI_SPECIES = '562'` (the species). The resolver probes `[orgTaxid, MG1655, ECOLI_SPECIES]` for a real species record. → Replace with the new organism's **genome-annotated-strain taxid** + **species taxid**.
3. **16S domain boundaries** — in `functionalRegions` under `RF00177`: `≤560 / 561–912 / 913–1396 / ≥1397` (E. coli SSU numbering). → Another organism's 16S needs its own boundaries (or drop the Domains track and keep Helices).
4. **RiboVision helix tables** — `EC_SSU_3D.csv` / `EC_LSU_3D.csv` (`EC_` = E. coli). RiboVision ships other organisms (`TT`, `HM`, `SC`, `DM`, `HS`, `PF`). → Swap the `EC_` prefix in `loadHelixTables` for the target, or skip helices.
5. **Rfam family → logic switch** — `RF00005 / RF00177 / RF02541 / RF00001` in `functionalRegions`. These are **bacterial** rRNA families. → Eukaryotes/archaea use different families (e.g. `RF01960` euk SSU, `RF02543` euk LSU); extend the switch.

**Reusable as-is (not organism-specific):** md5 resolution, the species/SO probe, 2D & 3D fetch, Rfam-hits/Family track, dot-bracket motif decoding, 3D-Hub loops, and the **Sprinzl tRNA arm ranges** (universal).

## Adding a new species (checklist)

1. Drop `resources/<taxid>_<name>/<taxid>_<name>_DB.csv` in place.
2. Set the two fallback taxids (#2) to the new organism's genome-strain + species taxid.
3. If it has rRNA you want annotated: set the 16S domain boundaries (#3) and point the helix tables (#4) at the right RiboVision organism (or skip those tracks).
4. Extend the Rfam→logic switch (#5) for any non-bacterial rRNA families.
5. Run `node scripts/general/fetch-rna-assets.mjs <taxid>` (resumable; concurrency 5). Verify `resolution breakdown` shows 0 misses.

## Verified run (E. coli K-12, taxid 83333)

216/216 RNA features resolved (145 under 83333 + 71 via the 511145 fallback), 0 misses.
Feature assets for the **126** features that have an R2DT 2D layout (the other 46 — mostly
sRNAs with no template — show info + "no 2D structure"). Functional tracks: Arms ×47 (tRNAs),
Domains ×6 + Helices ×16 (rRNAs).
