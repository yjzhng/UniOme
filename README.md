# UniOme

A local-first annotation-database browser for prokaryotes. Browse per-gene annotation, protein/RNA
structure and features, interactions, regulation, pathways, and more — served entirely from local
files, no database server.

Organisms currently available (more added over time):

- *Escherichia coli* K-12
- *Mycobacterium tuberculosis* H37Rv
- *Staphylococcus aureus* NCTC 8325
- *Bacillus subtilis* 168

## Quickstart — install the app (macOS)

1. Download the `.dmg` from the [latest release](https://github.com/yjzhng/UniOme/releases/latest) — `arm64` (Apple Silicon) or `x64` (Intel).
2. Open it and drag **UniOme** to Applications.
3. **First launch**:
   - **macOS 15 (Sequoia) or newer:** double-click UniOme → "not opened" alert appears → open  **System Settings → Privacy & Security**, scroll down, and click **Open Anyway**
   - **macOS 14 or older:** **right-click** UniOme → **Open** → **Open** in the dialog.
4. After that it opens normally

> [!NOTE]
> Alternative gatekeeper fixes via terminal
> 1. ```brew install --cask``` (once a cask exists)
> 2. ```xattr -dr com.apple.quarantine /Applications/UniOme.app``` (once installed)

## Run from source (developers)

Needs [Node.js](https://nodejs.org) + git.

- **Native window (macOS):** clone the repo, double-click `UniOme.app` — see [apps/desktop/README.md](apps/desktop/README.md).
- **Browser / any OS:** `npm install && npm run setup && npm run dev` → http://localhost:5173

## Licensing & data

- **UniOme's source code is MIT-licensed** — see [LICENSE](LICENSE).
- **The biological data is not.** UniOme redistributes datasets derived from ~30 external databases;
  **each keeps its own license and citation terms**, and several restrict redistribution/commercial
  use (KEGG, EcoCyc, EnteroBase, DeepLocPro, Foster, HT-CRISPRi). The data is provided for academic,
  non-commercial use. Read before relying on it:
  - [docs/data-use-notice.md](docs/data-use-notice.md) — data-use terms & disclaimer
  - [docs/data-attribution.md](docs/data-attribution.md) — per-source license, redistribution terms, and the citation to credit ([redistribution watch-list](docs/data-attribution.md#-redistribution-watch-list))

## Documentation

| Doc | What's in it |
|-----|--------------|
| [docs/data-provenance.md](docs/data-provenance.md) | How each dataset is produced, stored, and shipped; the build/refresh pipeline for maintainers |
| [docs/data-attribution.md](docs/data-attribution.md) | Per-source licenses, redistribution terms, and primary citations |
| [docs/data-use-notice.md](docs/data-use-notice.md) | Academic-use terms & disclaimer |
| [docs/rna-data-sources.md](docs/rna-data-sources.md) | RNA viewer build pipeline + how to port it to another organism |
| [scripts/README.md](scripts/README.md) | Data-build scripts layout + add-an-organism walkthrough |
| [apps/desktop/README.md](apps/desktop/README.md) | Desktop (Electron) app |

## Data sources & tools

UniOme integrates data from the databases below and cites them via [CITATION.cff](CITATION.cff);
**per-source licenses and the exact papers to cite are in [docs/data-attribution.md](docs/data-attribution.md).**

### Shared across all organisms

**Sequence & core annotation:** [NCBI RefSeq/GenBank](https://www.ncbi.nlm.nih.gov/refseq/) ·
[UniProt](https://www.uniprot.org) · [KEGG](https://www.kegg.jp) ·
[DeepLocPro](https://github.com/Jaimomar99/deeplocpro) · prokDB (sibling pipeline)

**Protein structure & features:** [AlphaFold DB](https://alphafold.ebi.ac.uk) ·
[TED](https://ted.cathdb.info) · [CATH](https://www.cathdb.info) ·
[InterPro](https://www.ebi.ac.uk/interpro/) · [CDD](https://www.ncbi.nlm.nih.gov/Structure/cdd/cdd.shtml) ·
[MobiDB](https://mobidb.org) · [EBI Complex Portal](https://www.ebi.ac.uk/complexportal/) ·
[RCSB PDB](https://www.rcsb.org) · [PDBe / SIFTS](https://www.ebi.ac.uk/pdbe/)

**RNA:** [RNAcentral](https://rnacentral.org) · [R2DT](https://rnacentral.org/r2dt) ·
[Rfam](https://rfam.org) · [MODOMICS](https://genesilico.pl/modomics/)

**Interactions & chemistry:** [STRING](https://string-db.org) · [IntAct](https://www.ebi.ac.uk/intact/) ·
[RNAInter](http://www.rnainter.org) · [Rhea](https://www.rhea-db.org) ·
[ChEBI](https://www.ebi.ac.uk/chebi/) · [PubChem](https://pubchem.ncbi.nlm.nih.gov)

**Expression & conservation:** [PaxDb](https://pax-db.org) (protein abundance) ·
[iModulonDB](https://imodulondb.org) (transcript / modulons) · NCBI RefSeq genome panels (computed π & variants)

### Organism-specific sources

Essentiality, regulation, positional regulatory maps, and mutation differ per organism:

- ***E. coli* K-12:** [EcoCyc / BioCyc](https://ecocyc.org) & [HT-CRISPRi](https://github.com/hsrishi/HT-CRISPRi) (essentiality) ·
  [RegulonDB](https://regulondb.ccg.unam.mx) (regulation, regulatory map, genome features) ·
  [EnteroBase](https://enterobase.warwick.ac.uk) (allele conservation) ·
  [Foster et al. 2018](https://hdl.handle.net/2022/20340) (mutation)
- ***M. tuberculosis* H37Rv:** [MtbTnDB](https://github.com/ajinich/mtb_tn_db) (Sassetti 2003 Tn-seq essentiality) ·
  [MTB Network Portal](http://networks.systemsbiology.net/mtb/) & [BioCyc](https://biocyc.org) operons (regulation) ·
  [Minch & Rustad 2015](https://doi.org/10.1038/ncomms6829) ChIP-seq (regulatory map)
- ***S. aureus* NCTC 8325:** [DEG](http://origin.tubic.org/deg/) (Coe 2019 Tn-seq essentiality) ·
  [RegPrecise](https://regprecise.lbl.gov) & [AureoWiki](https://aureowiki.med.uni-greifswald.de) (regulation & regulatory map)
- ***B. subtilis* 168:** [DEG](http://origin.tubic.org/deg/) (Kobayashi 2003 knockout essentiality) ·
  [SubtiWiki](https://subtiwiki.uni-goettingen.de) (regulation) · [DBTBS](https://dbtbs.hgc.jp) (regulatory map) ·
  Tanneur et al. 2025 (mutation)

### Computational tools

[Mol\*](https://molstar.org) (structure viewer) · [Foldseek](https://github.com/steineggerlab/foldseek)
(structural similarity) · BLAST+ (sequence similarity) · MUMmer (genome alignment)

## References

Primary citations for every integrated data source, alphabetical by first author. Database data carry their own licenses (see [docs/data-attribution.md](docs/data-attribution.md)); these are the works to cite.

Balu, S., Huget, S., Meldal, B. H. M., Orchard, S., & Hermjakob, H. (2025). Complex Portal 2025: predicted human complexes and enhanced visualisation tools for the comparison of orthologous and paralogous complexes. *Nucleic Acids Research, 53*(D1), D644–D650. https://doi.org/10.1093/nar/gkae1085

Bansal, P., Morgat, A., Axelsen, K. B., Muthukrishnan, V., Coudert, E., Aimo, L., … Bridge, A. (2022). Rhea, the reaction knowledgebase in 2022. *Nucleic Acids Research, 50*(D1), D693–D700. https://doi.org/10.1093/nar/gkab1016

Bhattacharyya, R. P., Grad, Y. H., & Hung, D. T. (2020). *Systematic genome-wide querying of coding and non-coding functional elements in E. coli using CRISPRi* [Preprint]. bioRxiv. https://doi.org/10.1101/2020.03.04.975888

Blum, M., et al. (2025). InterPro: the protein sequence classification resource in 2025. *Nucleic Acids Research, 53*(D1), D444–D456. https://doi.org/10.1093/nar/gkae1082

Cappannini, A., et al. (2025). MODOMICS: a database of RNA modifications and related information. 2025 update. *Nucleic Acids Research, 54*(D1), D219. https://doi.org/10.1093/nar/gkaf1284

Coe, K. A., Lee, W., Stone, M. C., Komazin-Meredith, G., Meredith, T. C., Grad, Y. H., & Walker, S. (2019). Multi-strain Tn-Seq reveals common daptomycin resistance determinants in *Staphylococcus aureus*. *PLoS Pathogens, 15*(11), e1007862. https://doi.org/10.1371/journal.ppat.1007862

Dana, J. M., Gutmanas, A., Tyagi, N., Qi, G., O'Donovan, C., Martin, M., & Velankar, S. (2019). SIFTS: updated Structure Integration with Function, Taxonomy and Sequences resource. *Nucleic Acids Research, 47*(D1), D482–D489. https://doi.org/10.1093/nar/gky1114

del Toro, N., et al. (2022). The IntAct database: efficient access to fine-grained molecular interaction data. *Nucleic Acids Research, 50*(D1), D648–D653. https://doi.org/10.1093/nar/gkab1006

Dyer, N. P., et al. (2024). EnteroBase in 2025: exploring the genomic epidemiology of bacterial pathogens. *Nucleic Acids Research.* https://doi.org/10.1093/nar/gkae902

Foster, P. L., Lee, H., Popodi, E., Townes, J. P., & Tang, H. (2015). Determinants of spontaneous mutation in the bacterium *Escherichia coli* as revealed by whole-genome sequencing. *Proceedings of the National Academy of Sciences, 112*(44), E5990–E5999. https://doi.org/10.1073/pnas.1512136112

Fuchs, S., Mehlan, H., Bernhardt, J., Hennig, A., Michalik, S., Surmann, K., … Mäder, U. (2018). AureoWiki — The repository of the *Staphylococcus aureus* research and annotation community. *International Journal of Medical Microbiology, 308*(6), 558–568. https://doi.org/10.1016/j.ijmm.2017.11.011

Hastings, J., Owen, G., Dekker, A., Ennis, M., Kale, N., Muthukrishnan, V., … Steinbeck, C. (2016). ChEBI in 2016: Improved services and an expanding collection of metabolites. *Nucleic Acids Research, 44*(D1), D1214–D1219. https://doi.org/10.1093/nar/gkv1031

Huang, Q., Szklarczyk, D., Oehninger, J., & von Mering, C. (2026). PaxDb v6.0: reprocessed, LLM-selected, curated protein abundance data across organisms. *Nucleic Acids Research, 54*(D1), D427–D439. https://doi.org/10.1093/nar/gkaf1066

Jumper, J., Evans, R., Pritzel, A., Green, T., Figurnov, M., Ronneberger, O., … Hassabis, D. (2021). Highly accurate protein structure prediction with AlphaFold. *Nature, 596*, 583–589. https://doi.org/10.1038/s41586-021-03819-2

Kanehisa, M., Furumichi, M., Sato, Y., Matsuura, Y., & Ishiguro-Watanabe, M. (2025). KEGG: biological systems database as a model of the real world. *Nucleic Acids Research, 53*(D1), D672–D677. https://doi.org/10.1093/nar/gkae909

Kang, J., et al. (2022). RNAInter v4.0: RNA interactome repository with redefined confidence scoring system and improved accessibility. *Nucleic Acids Research, 50*(D1), D326–D332. https://doi.org/10.1093/nar/gkab997

Karp, P. D., Billington, R., Caspi, R., Fulcher, C. A., Latendresse, M., Kothari, A., … Subhraveti, P. (2019). The BioCyc collection of microbial genomes and metabolic pathways. *Briefings in Bioinformatics, 20*(4), 1085–1093. https://doi.org/10.1093/bib/bbx085

Keseler, I. M., et al. (2021). The EcoCyc database in 2021. *Frontiers in Microbiology, 12*, 711077. https://doi.org/10.3389/fmicb.2021.711077

Kim, S., Chen, J., Cheng, T., Gindulyte, A., He, J., He, S., … Bolton, E. E. (2025). PubChem 2025 update. *Nucleic Acids Research, 53*(D1), D1516–D1525. https://doi.org/10.1093/nar/gkae1059

Kobayashi, K., Ehrlich, S. D., Albertini, A., Amati, G., Andersen, K. K., Arnaud, M., … Ogasawara, N. (2003). Essential *Bacillus subtilis* genes. *Proceedings of the National Academy of Sciences, 100*(8), 4678–4683. https://doi.org/10.1073/pnas.0730515100

Lamoureux, C. R., Decker, K. T., Sastry, A. V., Rychel, K., Gao, Y., McConn, J. L., Zielinski, D. C., & Palsson, B. O. (2023). A multi-scale expression and regulation knowledge base for *Escherichia coli*. *Nucleic Acids Research, 51*(19), 10176–10193. https://doi.org/10.1093/nar/gkad750

Lau, A. M., Bordin, N., Kandathil, S. M., Sillitoe, I., Waman, V. P., Wells, J., Orengo, C., & Jones, D. T. (2024). Exploring structural diversity across the protein universe with The Encyclopedia of Domains. *Science, 386*(6721), eadq4946. https://doi.org/10.1126/science.adq4946

Luo, H., Lin, Y., Gao, F., Zhang, C.-T., & Zhang, R. (2014). DEG 10, an update of the database of essential genes that includes both protein-coding genes and noncoding genomic elements. *Nucleic Acids Research, 42*(D1), D574–D580. https://doi.org/10.1093/nar/gkt1131

Minch, K. J., Rustad, T. R., Peterson, E. J. R., Winkler, J., Reiss, D. J., Ma, S., … Sherman, D. R. (2015). The DNA-binding network of *Mycobacterium tuberculosis*. *Nature Communications, 6*, 5829. https://doi.org/10.1038/ncomms6829

Moreno, J., Nielsen, H., Winther, O., & Teufel, F. (2024). Predicting the subcellular location of prokaryotic proteins with DeepLocPro. *Bioinformatics, 40*(12), btae677. https://doi.org/10.1093/bioinformatics/btae677

Novichkov, P. S., Kazakov, A. E., Ravcheev, D. A., Leyn, S. A., Kovaleva, G. Y., Sutormin, R. A., … Rodionov, D. A. (2013). RegPrecise 3.0 — A resource for genome-scale exploration of transcriptional regulation in bacteria. *BMC Genomics, 14*, 745. https://doi.org/10.1186/1471-2164-14-745

O'Leary, N. A., et al. (2016). Reference sequence (RefSeq) database at NCBI: current status, taxonomic expansion, and functional annotation. *Nucleic Acids Research, 44*(D1), D733–D745. https://doi.org/10.1093/nar/gkv1189

Ontiveros-Palacios, N., et al. (2025). Rfam 15: RNA families database in 2025. *Nucleic Acids Research, 53*(D1), D258–D267. https://doi.org/10.1093/nar/gkae1023

Pedreira, T., Elfmann, C., & Stülke, J. (2022). The current state of SubtiWiki, the database for the model organism *Bacillus subtilis*. *Nucleic Acids Research, 50*(D1), D875–D882. https://doi.org/10.1093/nar/gkab943

Piovesan, D., et al. (2025). MobiDB in 2025: integrating ensemble properties and function annotations for intrinsically disordered proteins. *Nucleic Acids Research, 53*(D1). https://doi.org/10.1093/nar/gkae969

The RNAcentral Consortium. (2021). RNAcentral 2021: secondary structure integration, improved sequence search and new member databases. *Nucleic Acids Research, 49*(D1), D212–D220. https://doi.org/10.1093/nar/gkaa921

Salgado, H., et al. (2024). RegulonDB v12.0: a comprehensive resource of transcriptional regulation in *E. coli* K-12. *Nucleic Acids Research, 52*(D1), D255–D264. https://doi.org/10.1093/nar/gkad1072

Sassetti, C. M., Boyd, D. H., & Rubin, E. J. (2003). Genes required for mycobacterial growth defined by high density mutagenesis. *Molecular Microbiology, 48*(1), 77–84. https://doi.org/10.1046/j.1365-2958.2003.03425.x

Sehnal, D., Bittrich, S., Deshpande, M., Svobodová, R., Berka, K., Bazgier, V., … Rose, A. S. (2021). Mol* Viewer: modern web app for 3D visualization and analysis of large biomolecular structures. *Nucleic Acids Research, 49*(W1), W431–W437. https://doi.org/10.1093/nar/gkab314

Sierro, N., Makita, Y., de Hoon, M., & Nakai, K. (2008). DBTBS: A database of transcriptional regulation in *Bacillus subtilis* containing upstream intergenic conservation information. *Nucleic Acids Research, 36*(Suppl. 1), D93–D96. https://doi.org/10.1093/nar/gkm910

Szklarczyk, D., et al. (2023). The STRING database in 2023: protein–protein association networks and functional enrichment analyses for any sequenced genome of interest. *Nucleic Acids Research, 51*(D1), D638–D646. https://doi.org/10.1093/nar/gkac1000

Tanneur, I., Dervyn, E., Guérin, C., Kon Kam King, G., Jules, M., & Nicolas, P. (2025). The mutational landscape of *Bacillus subtilis* conditional hypermutators shows how proofreading skews DNA polymerase error rates. *Nucleic Acids Research, 53*(5), gkaf147. https://doi.org/10.1093/nar/gkaf147

Turkarslan, S., Peterson, E. J. R., Rustad, T. R., Minch, K. J., Reiss, D. J., Morrison, R., … Baliga, N. S. (2015). A comprehensive map of genome-wide gene regulation in *Mycobacterium tuberculosis*. *Scientific Data, 2*, 150010. https://doi.org/10.1038/sdata.2015.10

The UniProt Consortium. (2025). UniProt: the Universal Protein Knowledgebase in 2025. *Nucleic Acids Research, 53*(D1), D609–D617. https://doi.org/10.1093/nar/gkae1010

van Kempen, M., Kim, S. S., Tumescheit, C., Mirdita, M., Lee, J., Gilchrist, C. L. M., Söding, J., & Steinegger, M. (2024). Fast and accurate protein structure search with Foldseek. *Nature Biotechnology, 42*, 243–246. https://doi.org/10.1038/s41587-023-01773-0

Varadi, M., et al. (2024). AlphaFold Protein Structure Database in 2024: providing structure coverage for over 214 million protein sequences. *Nucleic Acids Research, 52*(D1), D368–D375. https://doi.org/10.1093/nar/gkad1011

Waman, V. P., et al. (2025). CATH v4.4: major expansion of CATH by experimental and predicted structural data. *Nucleic Acids Research, 53*(D1), D348–D356. https://doi.org/10.1093/nar/gkae1087

Wang, J., Chitsaz, F., Derbyshire, M. K., Gonzales, N. R., Gwadz, M., Lu, S., … Marchler-Bauer, A. (2023). The conserved domain database in 2023. *Nucleic Acids Research, 51*(D1), D384–D388. https://doi.org/10.1093/nar/gkac1096
