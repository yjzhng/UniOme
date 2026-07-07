import { useNavigate, useOutletContext } from 'react-router-dom';
import GenomeBrowser from '../components/GenomeBrowser';
import { MultiomeExplorer } from '../modules/MultiomeExplorer';
import { RelationshipExplorer } from '../modules/RelationshipExplorer';
import { PathwayBrowser } from '../modules/PathwayBrowser';
import { RegulationExplorer } from '../modules/RegulationExplorer';
import { CoverageHeatmap } from '../modules/CoverageHeatmap';
import { GeneSearch } from '../components/GeneSearch';
import { useSettings } from '../lib/settings';
import type { OrgHomeContext } from '../Layout';

// The organism home page: org info + a gene search bar, then the three interactive modules at full
// size (genome browser, multiome explorer, relationship explorer). Selecting a gene in any of them —
// or via the search bar — navigates to that gene's entry page (which carries the compact sticky
// navigator). This keeps the modules roomy here instead of crammed into the narrow top navigator.
export default function BrowserPage() {
  const { taxid, chromosomes, currentOrg, activeChrom, selected, relView, setRelView } = useOutletContext<OrgHomeContext>();
  const { enabled } = useSettings();
  const nav = useNavigate();

  // Picking a gene in any module (or the search bar) opens its entry page; the entry page then applies
  // its per-gene scroll memory (top if unseen, last position if seen). `selected` still drives the
  // cross-module highlight so the last-viewed gene stays marked when you toggle back to the home page.
  const openGene = (g: { chrom: string; uniqID: string } | null) => {
    if (g) nav(`/o/${taxid}/c/${encodeURIComponent(g.chrom)}/entry/${g.uniqID}`);
  };

  if (!chromosomes.length || !activeChrom) {
    return (
      <main className="mx-auto max-w-7xl px-4 py-10">
        <div className="text-sm text-neutral-500">loading…</div>
      </main>
    );
  }

  const totalFeatures = chromosomes.reduce((s, c) => s + c.featureCount, 0);
  const totalLength = chromosomes.reduce((s, c) => s + c.length, 0);

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 space-y-6">
      <header className="space-y-1">
        <h1 className="font-mono text-xl font-semibold text-neutral-900">{currentOrg?.shortName ?? taxid}</h1>
        {currentOrg && (
          <p className="text-sm text-neutral-600">
            <em>{currentOrg.scientificName}</em> {currentOrg.strain}
          </p>
        )}
        <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-neutral-500">
          <span>taxid {taxid}</span>
          <span>{chromosomes.length} chromosome{chromosomes.length === 1 ? '' : 's'}</span>
          <span>{(totalLength / 1_000_000).toFixed(2)} Mb</span>
          <span>{totalFeatures.toLocaleString()} features</span>
        </div>
      </header>

      <GeneSearch taxid={taxid} onPick={openGene} />

      {enabled('home.coverage') && (
        <HomeSection title="Annotation coverage" desc="how much of each section of information is annotated across the genome">
          <CoverageHeatmap taxid={taxid} />
        </HomeSection>
      )}

      {/* Clicking a gene in any module opens its entry page; the last-viewed gene stays highlighted
          across all three (via `selected`) when you toggle back here. */}
      {enabled('home.browser') && (
        <HomeSection title="Genome browser" desc="browse features along the chromosome — click a feature to open it">
          <GenomeBrowser
            taxid={taxid}
            chromosomes={chromosomes}
            activeChromId={activeChrom.id}
            onSelectChrom={(id) => nav(`/o/${taxid}/c/${encodeURIComponent(id)}`)}
            focusId={selected?.uniqID}
            onPick={openGene}
          />
        </HomeSection>
      )}

      {enabled('home.multiome') && (
        <HomeSection title="Multiome explorer" desc="navigate genes by essentiality, conservation, mutability & expression">
          <MultiomeExplorer taxid={taxid} focusId={selected?.uniqID} onPick={openGene} />
        </HomeSection>
      )}

      {enabled('home.relationships') && (
        <HomeSection title="Gene relationships" desc="find genes by shared interactions, domains, pathways & regulation">
          <RelationshipExplorer taxid={taxid} focusId={selected?.uniqID} onPick={openGene} view={relView} onView={setRelView} />
        </HomeSection>
      )}

      {enabled('home.pathway') && (
        <HomeSection title="Pathway explorer" desc="browse KEGG metabolic pathways by category — pick one to see its map; click a box to open that gene">
          <PathwayBrowser taxid={taxid} chrom={activeChrom.id} />
        </HomeSection>
      )}

      {enabled('home.regulation') && (
        <HomeSection title="Regulation explorer" desc="the global regulatory network — which factors regulate what, and how their targets overlap; click a regulator to compare regulons">
          <RegulationExplorer taxid={taxid} chrom={activeChrom.id} />
        </HomeSection>
      )}
    </main>
  );
}

function HomeSection({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <div>
        <h2 className="text-sm font-semibold text-neutral-900">{title}</h2>
        <p className="text-xs text-neutral-500">{desc}</p>
      </div>
      <div className="rounded border border-neutral-200 bg-white p-3">{children}</div>
    </section>
  );
}
