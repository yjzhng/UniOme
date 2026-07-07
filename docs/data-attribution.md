# Data sources — licenses & attribution

UniOme's own code is MIT-licensed ([LICENSE](../LICENSE)). **The biological data is not
UniOme's** — every dataset bundled in the organism archives (the GitHub Release assets
`resources/<org>.tar.gz`) is fetched or derived from an external database, and **each source
retains its own license and citation requirements.** This file records those terms so that
downstream users credit each source and comply with its license.

Redistributing derived data does **not** relicense it: a source under CC BY 4.0 stays CC BY 4.0
in the archive; a source that forbids redistribution is not made redistributable by being
packed into `<org>.tar.gz`. Where a source restricts redistribution, that is flagged below and
summarised in the [Redistribution watch-list](#-redistribution-watch-list).

> Confidence: **HIGH** = read directly from the provider's license/terms page or LICENSE file.
> **NEEDS-VERIFY** = license inferred (site was JS-only, unreachable, or the identifier lives in
> the resource paper rather than a dedicated page); confirm with the provider before relying on it.
> Licenses change — re-check before a commercial release. Last researched 2026-07-06.

## ⚠️ Redistribution watch-list

These sources are bundled in the current release but their terms **restrict redistribution and/or
commercial use**. A public GitHub Release that redistributes their derived data may fall outside
the free/academic grant. Review (and, where noted, obtain a license or author permission) before
relying on the release for anything beyond private academic use:

| Source | What's derived from it | Restriction | Action |
|--------|------------------------|-------------|--------|
| **KEGG** | core CSV `KG_*` columns; all pathway maps (`pathway/…`) | Proprietary (Kanehisa Labs). Website free for academic *viewing*; hosting/redistributing KEGG data needs the paid **KEGG FTP academic subscription** (service-provider license). Commercial use needs a Pathway Solutions license. | Obtain a KEGG FTP/service license, or drop KEGG-derived data from the redistributed archive. |
| **EcoCyc / BioCyc** | essentiality (knockout growth) | SRI academic license: **internal, non-commercial** use only; no automatic downstream redistribution rights even for the free "Open" DBs. | Confirm with SRI, or serve only via live API rather than bundling. |
| **EnteroBase** | conservation (allele diversity) | **Academic-use-only**; commercial use requires a University of Warwick license; redistribution only with attribution + stated modifications. | Keep academic; carry attribution; get Warwick license for commercial use. |
| **DeepLocPro** | core CSV `localz` (localisation) | **CC BY-NC-SA 4.0** — non-commercial + share-alike (viral). | Non-commercial use only; derivative data must stay CC BY-NC-SA. |
| **Foster et al. 2018** | mutation frequency | Deposit has **no license** ("may be protected by copyright") → all-rights-reserved. | Use the published papers / public NCBI SRA (SRP013707) instead of redistributing the deposit, or seek permission. |
| **HT-CRISPRi** (`hsrishi/HT-CRISPRi`) | essentiality (CRISPRi LB/M9 fitness) | GitHub repo has **no LICENSE** → all-rights-reserved. | Request author permission before redistributing derived data. |
| **MODOMICS** | RNA modifications | No data-license on site; "free for research purposes" → research-only, redistribution unverified. | Confirm with curators; treat as research-only. |
| **RNAInter** | RNA interactions | No data-license published on site; terms unverified. | Confirm with authors before redistributing. |
| **RegulonDB** | regulation (regulons/operons/promoters/TFBS), non-gene genome features | Citation-required academic terms; exact data-license identifier unconfirmed (terms page TLS error). | Cite RegulonDB; verify the data license before commercial re-release. |
| **BioCyc** (Mtb operons) | *M. tuberculosis* regulation (operons) | **Restricted SRI subscription/academic license**; the Mtb PGDBs are subscription-only → redistribution not permitted, commercial excluded. | Confirm the specific Mtb-PGDB tier with SRI, or serve via live API rather than bundling. |
| **AureoWiki / SubtiWiki / DBTBS** | *S. aureus* & *B. subtilis* regulation & crosswalk | Sites publish **no data license**; their descriptive papers are **CC BY-NC / CC BY-NC-ND** (non-commercial). | Non-commercial use; attribute; confirm site data terms with maintainers before commercial redistribution. |
| **MtbTnDB / RegPrecise** | Mtb & Sa essentiality / regulation | Sites publish **no data license** (citation request only). | Attribute to the underlying papers; confirm with maintainers before redistributing. |
| **Kobayashi 2003** (via DEG) | *B. subtilis* essentiality | PNAS article, **© NAS, no CC** → all-rights-reserved. | Cite; seek PNAS permission before redistributing the table; commercial restricted. |

Everything else — including *M. tuberculosis* **Minch & Rustad 2015** and the **MTB Network Portal**
dataset (both CC BY 4.0) and *B. subtilis* **Tanneur et al. 2025** (CC BY 4.0) — is redistributable
with attribution, or is public domain (CC0 / US-Gov). See the per-source tables and
[References](../README.md#references) below.

## Core annotation

| Source | License | Redistribution / commercial | Primary citation | Conf. |
|--------|---------|-----------------------------|------------------|-------|
| **NCBI RefSeq / GenBank / E-utilities / datasets** — [ncbi.nlm.nih.gov](https://www.ncbi.nlm.nih.gov/) | US-Gov **public domain** (SPDX `NCBI-PD`) — [usage policy](https://www.ncbi.nlm.nih.gov/home/about/policies/) | Permitted; no commercial restriction from NCBI. *Caveat:* individual submitter records may carry their own IP; acknowledgment to NLM requested. | O'Leary NA et al., "Reference sequence (RefSeq) database at NCBI," *NAR* 44(D1):D733 (2016), [10.1093/nar/gkv1189](https://doi.org/10.1093/nar/gkv1189); Sayers EW et al., "GenBank," *NAR* (annual). | HIGH |
| **UniProt** — [uniprot.org](https://www.uniprot.org) | **CC BY 4.0** — [uniprot.org/help/license](https://www.uniprot.org/help/license) | Permitted incl. commercial, with attribution. | The UniProt Consortium, "UniProt: the Universal Protein Knowledgebase in 2025," *NAR* 53(D1):D609, [10.1093/nar/gkae1010](https://doi.org/10.1093/nar/gkae1010) | HIGH |
| **KEGG** ⚠️ — [kegg.jp](https://www.kegg.jp/) | **Proprietary** (Kanehisa Labs) — [legal](https://www.kegg.jp/kegg/legal.html) | ⚠️ Redistribution needs paid academic FTP/service license; commercial needs Pathway Solutions license. See watch-list. | Kanehisa M et al., "KEGG: biological systems database as a model of the real world," *NAR* 53:D672 (2025), [10.1093/nar/gkae909](https://doi.org/10.1093/nar/gkae909) | HIGH |
| **DeepLocPro** ⚠️ — [github.com/Jaimomar99/deeplocpro](https://github.com/Jaimomar99/deeplocpro) | **CC BY-NC-SA 4.0** — repo LICENSE | ⚠️ Non-commercial + share-alike. See watch-list. | Moreno J et al., "Predicting the subcellular location of prokaryotic proteins with DeepLocPro," *Bioinformatics* 40(12):btae677 (2024), [10.1093/bioinformatics/btae677](https://doi.org/10.1093/bioinformatics/btae677) | HIGH |

## General-section fields (essentiality / conservation / mutation / expression)

| Source | License | Redistribution / commercial | Primary citation | Conf. |
|--------|---------|-----------------------------|------------------|-------|
| **EcoCyc / BioCyc** ⚠️ — [ecocyc.org](https://ecocyc.org/) | Proprietary academic (SRI) — [academic license](https://ecocyc.org/ptools-academic-license.shtml) | ⚠️ Internal, non-commercial; redistribution restricted. See watch-list. | Keseler IM et al., "The EcoCyc Database in 2021," *Front. Microbiol.* 12:711077 (2021), [10.3389/fmicb.2021.711077](https://doi.org/10.3389/fmicb.2021.711077) | HIGH |
| **HT-CRISPRi** ⚠️ — [github.com/hsrishi/HT-CRISPRi](https://github.com/hsrishi/HT-CRISPRi) | **No license** (all rights reserved) | ⚠️ Redistribution not granted. See watch-list. | Bhattacharyya RP et al., "Systematic genome-wide querying of coding and non-coding functional elements in *E. coli* using CRISPRi," *bioRxiv* (2020), [10.1101/2020.03.04.975888](https://doi.org/10.1101/2020.03.04.975888) | HIGH (no-license); citation NEEDS-VERIFY (journal version?) |
| **NCBI RefSeq genome panel** (conservation π, MUMmer) | US-Gov **public domain** | Permitted. | (per-genome RefSeq accessions; NCBI `datasets`) | HIGH |
| **EnteroBase** ⚠️ — [enterobase.warwick.ac.uk](https://enterobase.warwick.ac.uk) | **Academic-use-only** custom terms — [terms](https://enterobase.warwick.ac.uk/terms) | ⚠️ No commercial use w/o Warwick license; attribution + stated modifications required. See watch-list. | Dyer NP et al., "EnteroBase in 2025," *NAR* (2024), [10.1093/nar/gkae902](https://doi.org/10.1093/nar/gkae902) | HIGH |
| **Foster et al. mutation-accumulation** ⚠️ — [hdl.handle.net/2022/20340](https://hdl.handle.net/2022/20340) | **No open license** (all rights reserved) | ⚠️ Deposit redistribution not granted; use papers / SRA SRP013707. See watch-list. | Foster PL et al., *Genetics* 209(4):1029 (2018), [10.1534/genetics.118.301237](https://doi.org/10.1534/genetics.118.301237); *PNAS* 112:E5990 (2015), [10.1073/pnas.1512136112](https://doi.org/10.1073/pnas.1512136112) | HIGH |
| **PaxDb** — [pax-db.org](https://pax-db.org) | **CC BY 4.0** (v6.0 resource-wide) | Permitted incl. commercial, with attribution. | Huang Q et al., "PaxDb v6.0," *NAR* 54(D1):D427 (2026), [10.1093/nar/gkaf1066](https://doi.org/10.1093/nar/gkaf1066) | HIGH |
| **iModulonDB / PRECISE-1K** — [imodulondb.org](https://imodulondb.org) · [github.com/SBRG/precise1k](https://github.com/SBRG/precise1k) | Repo **MIT**; journal article CC BY-NC | MIT data/code redistributable with attribution; note the paper text is non-commercial. | Lamoureux CR et al., "A multi-scale expression and regulation knowledge base for *E. coli*," *NAR* 51(19):10176 (2023), [10.1093/nar/gkad750](https://doi.org/10.1093/nar/gkad750) | HIGH (repo/citation); NEEDS-VERIFY (site terms) |

## Protein structure & features

| Source | License | Redistribution / commercial | Primary citation | Conf. |
|--------|---------|-----------------------------|------------------|-------|
| **AlphaFold DB** — [alphafold.ebi.ac.uk](https://alphafold.ebi.ac.uk) | **CC BY 4.0** — [License-Disclaimer](https://alphafold.ebi.ac.uk/assets/License-Disclaimer.pdf) | Permitted incl. commercial, with attribution. Predictions "as-is", not for clinical use. | Varadi M et al., "AlphaFold Protein Structure Database in 2024," *NAR* 52(D1):D368 (2024), [10.1093/nar/gkad1011](https://doi.org/10.1093/nar/gkad1011); Jumper J et al., *Nature* 596:583 (2021), [10.1038/s41586-021-03819-2](https://doi.org/10.1038/s41586-021-03819-2) | HIGH |
| **TED** — [ted.cathdb.info](https://ted.cathdb.info/) | **CC BY 4.0** — [Zenodo 10848710](https://zenodo.org/records/10848710) | Permitted incl. commercial, with attribution (also respect AlphaFold terms upstream). | Lau AM et al., "Exploring structural diversity across the protein universe with The Encyclopedia of Domains," *Science* 386:eadq4946 (2024), [10.1126/science.adq4946](https://doi.org/10.1126/science.adq4946) | HIGH |
| **CATH** — [cathdb.info](https://www.cathdb.info/) | **CC BY 4.0** — site footer | Permitted incl. commercial, with attribution. | Waman VP et al., "CATH v4.4," *NAR* 53(D1):D348 (2025), [10.1093/nar/gkae1087](https://doi.org/10.1093/nar/gkae1087) | HIGH |
| **InterPro** (incl. CDD via InterPro) — [ebi.ac.uk/interpro](https://www.ebi.ac.uk/interpro/) | **CC BY 4.0** — [about/license](https://www.ebi.ac.uk/interpro/about/license/) | Permitted incl. commercial, with attribution. Member DBs may add terms. | Blum M et al., "InterPro: the protein sequence classification resource in 2025," *NAR* 53(D1):D444 (2025), [10.1093/nar/gkae1082](https://doi.org/10.1093/nar/gkae1082) | HIGH |
| **CDD** (NCBI, direct) — [ncbi.nlm.nih.gov/Structure/cdd](https://www.ncbi.nlm.nih.gov/Structure/cdd/cdd.shtml) | US-Gov **public domain**; imported models (Pfam/SMART/COG) keep source terms | Permitted; check imported-model terms if redistributing those PSSMs. | Wang J et al., "The conserved domain database in 2023," *NAR* 51(D1):D384 (2023), [10.1093/nar/gkac1096](https://doi.org/10.1093/nar/gkac1096) | HIGH |
| **MobiDB** — [mobidb.org](https://mobidb.org) | **CC BY 4.0** (per resource paper) | Permitted incl. commercial, with attribution. (`mobidb.mobi` is an unrelated product — ignore.) | Piovesan D et al., "MobiDB in 2025," *NAR* 53(D1) (2025), [10.1093/nar/gkae969](https://doi.org/10.1093/nar/gkae969) | NEEDS-VERIFY (no dedicated data-terms page) |
| **EBI Complex Portal** — [ebi.ac.uk/complexportal](https://www.ebi.ac.uk/complexportal/) | **CC0 1.0** (data); Apache 2.0 (software) | Public domain — unrestricted; citation courtesy. | Balu S et al., "Complex Portal 2025," *NAR* 53(D1):D644 (2025), [10.1093/nar/gkae1085](https://doi.org/10.1093/nar/gkae1085) | HIGH |
| **RCSB PDB** (`models.rcsb.org`) — [rcsb.org](https://www.rcsb.org/) | **CC0 1.0** for archive/API data — [usage policy](https://www.rcsb.org/pages/usage-policy) | Public domain — unrestricted; attribution to structure authors encouraged. | Cite by PDB ID + structure DOI; resource: RCSB PDB, *NAR* 53(D1):D564 (2025), [10.1093/nar/gkae1091](https://doi.org/10.1093/nar/gkae1091) | HIGH |
| **PDBe / SIFTS** — [ebi.ac.uk/pdbe/docs/sifts](https://www.ebi.ac.uk/pdbe/docs/sifts/) | EMBL-EBI Terms of Use (no explicit CC id); derived from PDB (CC0) + UniProt (CC BY) | Reuse/redistribution permitted, no blanket NC restriction; attribute. | Dana JM, Gutmanas A et al., "SIFTS: updated Structure Integration with Function, Taxonomy and Sequences resource," *NAR* 47:D482 (2019), [10.1093/nar/gky1114](https://doi.org/10.1093/nar/gky1114) | NEEDS-VERIFY (exact id) |
| **UniProt** — variants / PTMs (see Core annotation) | **CC BY 4.0** | As above. | (as UniProt above) | HIGH |

## RNA features

| Source | License | Redistribution / commercial | Primary citation | Conf. |
|--------|---------|-----------------------------|------------------|-------|
| **RNAcentral** — [rnacentral.org](https://rnacentral.org) | **CC0 1.0** — [rnacentral.org/license](https://rnacentral.org/license) | Public domain — unrestricted; attribution requested (courtesy). | The RNAcentral Consortium, "RNAcentral 2021," *NAR* (2021), [10.1093/nar/gkaa921](https://doi.org/10.1093/nar/gkaa921) | HIGH |
| **R2DT** — [github.com/rnacentral/R2DT](https://github.com/rnacentral/R2DT) | **Apache 2.0** (software); diagrams distributed via RNAcentral **CC0** | Permitted incl. commercial (retain notices); generated diagrams are CC0. | Sweeney BA et al., "R2DT…," *Nat. Commun.* 12:3494 (2021), [10.1038/s41467-021-23555-5](https://doi.org/10.1038/s41467-021-23555-5) | HIGH |
| **Rfam** — [rfam.org](https://rfam.org) | **CC0 1.0** — [docs.rfam.org](https://docs.rfam.org/en/latest/) | Public domain — unrestricted; credit primary sources as courtesy. | Ontiveros-Palacios N et al., "Rfam 15," *NAR* 53(D1):D258 (2025), [10.1093/nar/gkae1023](https://doi.org/10.1093/nar/gkae1023) | HIGH |
| **MODOMICS** ⚠️ — [genesilico.pl/modomics](https://genesilico.pl/modomics/) | No explicit data license ("free for research purposes") | ⚠️ Research-only; redistribution unverified. See watch-list. | Cappannini A et al., "MODOMICS… 2025 update," *NAR* 54(D1):D219 (2025), [10.1093/nar/gkaf1284](https://doi.org/10.1093/nar/gkaf1284) | NEEDS-VERIFY |
| RNA 3D structure — **RCSB / PDBe** | **CC0 1.0** | As RCSB above. | (as RCSB above) | HIGH |
| RNA complexes — **EBI Complex Portal** | **CC0 1.0** | As Complex Portal above. | (as Complex Portal above) | HIGH |

## Relationships

| Source | License | Redistribution / commercial | Primary citation | Conf. |
|--------|---------|-----------------------------|------------------|-------|
| **STRING** — [string-db.org](https://string-db.org/) | **CC BY 4.0** — [access](https://string-db.org/cgi/access) | Permitted incl. commercial, with attribution + noting modifications. | Szklarczyk D et al., "The STRING database in 2023," *NAR* 51:D638 (2023), [10.1093/nar/gkac1000](https://doi.org/10.1093/nar/gkac1000) | HIGH |
| **IntAct** — [ebi.ac.uk/intact](https://www.ebi.ac.uk/intact/) | **CC BY 4.0** (data); Apache 2.0 (software) | Permitted incl. commercial, with attribution. | del Toro N et al., "The IntAct database," *NAR* 50:D648 (2022), [10.1093/nar/gkab1006](https://doi.org/10.1093/nar/gkab1006) | HIGH |
| **RNAInter** ⚠️ — [rnainter.org](http://www.rnainter.org) | No explicit data license | ⚠️ Redistribution unverified. See watch-list. | Kang J et al., "RNAInter v4.0," *NAR* 50(D1):D326 (2022), [10.1093/nar/gkab997](https://doi.org/10.1093/nar/gkab997) | NEEDS-VERIFY |
| **RegulonDB** ⚠️ — [regulondb.ccg.unam.mx](https://regulondb.ccg.unam.mx) | Code Apache 2.0; data citation-required academic terms | ⚠️ Cite RegulonDB; data-license id unconfirmed. See watch-list. | Salgado H et al., "RegulonDB v12.0," *NAR* 52(D1):D255 (2024), [10.1093/nar/gkad1072](https://doi.org/10.1093/nar/gkad1072) | NEEDS-VERIFY |
| **iModulonDB / PRECISE-1K** (modulons) | Repo MIT; article CC BY-NC | See General-section row above. | (as iModulonDB above) | HIGH (repo) |
| Sequence / structural similarity (blastp, Foldseek) | computed locally from UniProt (CC BY) + AlphaFold (CC BY) inputs | Inherit inputs' CC BY 4.0. | Foldseek: van Kempen M et al., *Nat. Biotechnol.* 42:243 (2024), [10.1038/s41587-023-01773-0](https://doi.org/10.1038/s41587-023-01773-0) | HIGH |

## Reactions & chemistry

| Source | License | Redistribution / commercial | Primary citation | Conf. |
|--------|---------|-----------------------------|------------------|-------|
| **Rhea** — [rhea-db.org](https://www.rhea-db.org/) | **CC BY 4.0** | Permitted incl. commercial, with attribution. | Bansal P et al., "Rhea, the reaction knowledgebase in 2022," *NAR* 50:D693 (2022), [10.1093/nar/gkab1016](https://doi.org/10.1093/nar/gkab1016) | HIGH (NEEDS-VERIFY exact terms-page URL) |
| **ChEBI** — [ebi.ac.uk/chebi](https://www.ebi.ac.uk/chebi/) | **CC BY 4.0** — [about](https://www.ebi.ac.uk/chebi/aboutChebiForward.do) | Permitted incl. commercial, with attribution. (Pre-2013 releases were CC BY-NC.) | Hastings J et al., "ChEBI in 2016," *NAR* 44:D1214 (2016), [10.1093/nar/gkv1031](https://doi.org/10.1093/nar/gkv1031) | HIGH |
| **PubChem** — [pubchem.ncbi.nlm.nih.gov](https://pubchem.ncbi.nlm.nih.gov/) | Mostly US-Gov public domain; **depositor records may be copyrighted** | Generally permitted; respect per-depositor rights for contributed content. | Kim S et al., "PubChem 2025 update," *NAR* 53(D1):D1516 (2025), [10.1093/nar/gkae1059](https://doi.org/10.1093/nar/gkae1059) | HIGH (caveat); NEEDS-VERIFY (blanket reuse) |

## Pathway & genome maps

| Source | License | Redistribution / commercial | Primary citation | Conf. |
|--------|---------|-----------------------------|------------------|-------|
| **KEGG** (pathway maps, KGML, overview) ⚠️ | **Proprietary** | ⚠️ See KEGG in Core annotation + watch-list. | (as KEGG above) | HIGH |
| **RegulonDB** (non-gene genome features) ⚠️ | citation-required academic terms | ⚠️ See RegulonDB above + watch-list. | (as RegulonDB above) | NEEDS-VERIFY |
| **NCBI EFETCH** (feature table) | US-Gov **public domain** | Permitted. | (as NCBI above) | HIGH |

## Organism-specific sources — other species

The tables above use *E. coli* K-12 as the worked example. The general sources (UniProt, AlphaFold,
KEGG, STRING, PaxDb, iModulonDB, RNAcentral, etc.) apply to every released organism; the
**org-specific** sources below supply essentiality / regulation / regulatory-map / mutation for
*M. tuberculosis* H37Rv, *S. aureus* NCTC 8325, and *B. subtilis* 168.

Key finding from verification: **most of these database *sites* publish no explicit data-reuse
license** — they only request citation. Where that's the case, redistribution of their derived data
is **not affirmatively granted**; reuse leans on the underlying paper's license (the journal-article
license is *not* a license on the database's data). The primary papers behind them are mostly
CC BY / CC BY-NC / CC BY-NC-ND. Treat every **NEEDS-VERIFY** row as "attribute + confirm with the
maintainer before redistributing." Full citations for all papers are in [References](../README.md#references).

| Organism | Source | Data-reuse license | Redistribution / commercial | Used for | Conf. |
|----------|--------|--------------------|-----------------------------|----------|-------|
| *M. tuberculosis* | **MtbTnDB** — [github.com/ajinich/mtb_tn_db](https://github.com/ajinich/mtb_tn_db) | **No LICENSE file** on repo; data aggregated from published Tn-seq papers | ⚠️ Not granted by any license — reuse rides on the source papers (Sassetti 2003). | essentiality (Tn-seq) | HIGH (no license); reuse NEEDS-VERIFY |
| *M. tuberculosis* | **MTB Network Portal** — [networks.systemsbiology.net/mtb](http://networks.systemsbiology.net/mtb/) | Dataset published as *Sci. Data* descriptor under **CC BY 4.0** (Turkarslan 2015); portal site itself states no terms | ✅ Redistribution/commercial with attribution (the CC BY dataset). | regulation (TRN) | HIGH (dataset); site terms NEEDS-VERIFY |
| *M. tuberculosis* | **BioCyc** operons ⚠️ — [biocyc.org](https://biocyc.org) | **Restricted SRI subscription / academic license** ([subscription terms](https://biocyc.org/subscription-terms.shtml)) — Mtb PGDBs are on the subscription site | ⚠️ **Redistribution NOT permitted** without an SRI license; commercial excluded. See watch-list. | regulation (operons) | HIGH (restricted); exact Mtb-tier NEEDS-VERIFY |
| *M. tuberculosis* | **Minch & Rustad 2015** ChIP-seq | **CC BY 4.0** (Nature Communications) | ✅ Redistribution/commercial with attribution. | regulatory map (TFBS/TSS) | HIGH |
| *S. aureus* | **DEG** — [tubic.org/deg](http://origin.tubic.org/deg/) | Site terms unreachable (403); **data used = Coe 2019, CC BY 4.0** (PLoS Pathog.); DEG paper CC BY | ✅ Coe data redistributable with attribution; DEG *site* terms unconfirmed. | essentiality (Tn-seq, DEG1061) | HIGH (Coe); DEG site NEEDS-VERIFY |
| *S. aureus* | **RegPrecise** — [regprecise.lbl.gov](https://regprecise.lbl.gov) | **No explicit data license** (© + citation request); paper CC BY 2.0 (BMC) | ⚠️ Redistribution not affirmatively granted on-site. | regulation & regulatory map | NEEDS-VERIFY (site); paper HIGH |
| *S. aureus* | **AureoWiki** ⚠️ — [aureowiki.med.uni-greifswald.de](https://aureowiki.med.uni-greifswald.de) | **No site license**; descriptive paper **CC BY-NC-ND 4.0** (no commercial, no derivatives) | ⚠️ Paper is NC + ND; site data terms unconfirmed. | ortholog crosswalk (N315→NCTC 8325) | NEEDS-VERIFY (site); paper HIGH |
| *B. subtilis* | **DEG** — [tubic.org/deg](http://origin.tubic.org/deg/) | Data used = **Kobayashi 2003 (© NAS, no CC)** | ⚠️ Redistribution needs PNAS permission; commercial restricted. | essentiality (knockout, DEG1001) | HIGH |
| *B. subtilis* | **SubtiWiki** — [subtiwiki.uni-goettingen.de](https://subtiwiki.uni-goettingen.de) | **No site license**; descriptive paper **CC BY-NC 4.0** | ⚠️ Paper is NC; site data terms unconfirmed. | regulation (regulons/operons/sigma) | NEEDS-VERIFY (site); paper HIGH |
| *B. subtilis* | **DBTBS** — [dbtbs.hgc.jp](https://dbtbs.hgc.jp) | **No site license**; paper **CC BY-NC 2.0 UK** | ⚠️ Paper is NC; site data terms unconfirmed. | regulatory map (promoters/TFBS/terminators) | NEEDS-VERIFY (site); paper HIGH |
| *B. subtilis* | **Tanneur et al. 2025** — [NAR gkaf147](https://doi.org/10.1093/nar/gkaf147) | **CC BY 4.0** (NAR open access) | ✅ Redistribution/commercial with attribution. | mutation frequency (MA-line BPS) | HIGH |

---

### How to comply, in short

- **Keep this file (and [LICENSE](../LICENSE)) in every redistribution** of the data archives.
- **Cite every source you actually use** in any publication — the primary citations are listed above.
- **Before a commercial release or a non-academic redistribution,** clear the watch-list items:
  KEGG (license), EcoCyc/BioCyc (incl. Mtb operons), EnteroBase (Warwick license), DeepLocPro
  (non-commercial), Foster, HT-CRISPRi (author permission), MODOMICS, RNAInter, RegulonDB, and the
  other-species sites with no data license (AureoWiki, SubtiWiki, DBTBS, MtbTnDB, RegPrecise) plus
  Kobayashi 2003.
- Items marked **NEEDS-VERIFY** were not confirmable from a single authoritative page (general
  sources checked 2026-07-06, organism-specific sources 2026-07-07); re-check the linked source
  before relying on the stated terms. For the other-species databases specifically, the *site* often
  has no data license while the *paper* does — cite the paper and confirm data-reuse with the
  maintainer before redistributing.

*This document is a good-faith engineering summary of publicly stated terms, not legal advice.*
