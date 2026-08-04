import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ChromosomeInfo } from '@uniome/shared';
import type { Coverage } from '@uniome/shared';
import { fetchJSONWithRetry } from '../lib/api';
import { OrganismGlyph } from '../components/OrganismGlyph';
import { DataUseModal, hasAcceptedDataUse, LEGAL_ROUTE } from '../components/DataUseNotice';
import { ScoreRing, overallCoverageScore } from '../modules/CoverageHeatmap';
import { useOrgDownload, ProgressBar, mb } from '../lib/orgDownload';

// One row of /api/catalog. `status` drives the tile:
//   ready     → data on disk, links into the organism page (carries its chromosomes)
//   available → backend ready, not downloaded → Download button + progress
//   planned   → tile only, "not yet supported"
// Only taxid/nickname/keggid are known before download; shortName/scientificName/strain are
// DB-derived and therefore null until the organism is ready (the tile falls back to nickname).
interface CatalogOrg {
  taxid: string;
  nickname: string | null;
  keggid: string | null;
  name: string | null;
  amr: string | null;  // AMR priority level: critical | high | medium | model
  gram: string | null; // Gram stain: positive | negative
  status: 'ready' | 'available' | 'planned';
  shortName: string | null;
  scientificName: string | null;
  strain: string | null;
  bytes: number | null;
  chromosomes: ChromosomeInfo[];
}

// Label before the DB exists: the registry name, else the nickname, else the taxid.
const seedLabel = (o: CatalogOrg) => o.name || o.nickname || `taxid ${o.taxid}`;

// Home hierarchy: two sections — Model species (top), then AMR pathogens grouped by priority tier
// (Critical/High/Medium), each split into Gram-negative / Gram-positive subgroups. Anything without a
// recognised pathogen tier is a model/reference strain. Gram-unknown tiles sort last.
const PATHOGEN_TIERS = ['critical', 'high', 'medium'] as const;
const TIER_LABEL: Record<string, string> = { critical: 'Critical priority', high: 'High priority', medium: 'Medium priority' };
const GRAM_ORDER = ['negative', 'positive', 'other'] as const;
const GRAM_LABEL: Record<string, string> = { negative: 'Gram-negative', positive: 'Gram-positive', other: 'Other' };
const tierKey = (o: CatalogOrg) => (o.amr && (PATHOGEN_TIERS as readonly string[]).includes(o.amr) ? o.amr : 'model');
const gramKey = (o: CatalogOrg) => (o.gram === 'positive' ? 'positive' : o.gram === 'negative' ? 'negative' : 'other');
const byLabel = (a: CatalogOrg, b: CatalogOrg) => (a.shortName ?? seedLabel(a)).localeCompare(b.shortName ?? seedLabel(b));

// One priority tier's tiles, split into Gram subgroups.
function GramGrid({ orgs, onDownloaded, guardDownload }: { orgs: CatalogOrg[]; onDownloaded: () => void; guardDownload: (start: () => void) => void }) {
  return (
    <>
      {GRAM_ORDER.map((gram) => {
        const inGram = orgs.filter((o) => gramKey(o) === gram).sort(byLabel);
        if (inGram.length === 0) return null;
        return (
          <div key={gram} className="space-y-2">
            <div className="text-[11px] font-medium uppercase tracking-wide text-neutral-500">{GRAM_LABEL[gram]}</div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {inGram.map((o) => <OrganismTile key={o.taxid} org={o} onDownloaded={onDownloaded} guardDownload={guardDownload} />)}
            </div>
          </div>
        );
      })}
    </>
  );
}

export default function HomePage() {
  const [orgs, setOrgs] = useState<CatalogOrg[] | null>(null);
  // Pending download action, held while the first-time data-use notice is shown.
  const [pendingDownload, setPendingDownload] = useState<(() => void) | null>(null);

  const refresh = useCallback(() => {
    fetchJSONWithRetry<CatalogOrg[]>('/api/catalog')
      .then(setOrgs)
      .catch(() => setOrgs([]));
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  // Run a download immediately if the user has already accepted the data-use notice, else stash it
  // and open the modal; the modal's Agree button both persists the acceptance and runs the action.
  const guardDownload = useCallback((start: () => void) => {
    if (hasAcceptedDataUse()) start();
    else setPendingDownload(() => start);
  }, []);

  return (
    <main className="mx-auto max-w-5xl px-4 py-10 space-y-6">
      <header className="space-y-1">
        <h1 className="font-mono text-lg font-semibold">Organisms</h1>
        <p className="text-sm text-neutral-600">
          Pick a prokaryote to start browsing its annotation database.
        </p>
      </header>
      {orgs === null ? (
        <div className="text-sm text-neutral-500">loading…</div>
      ) : orgs.length === 0 ? (
        <div className="text-sm text-neutral-500">no organisms available</div>
      ) : (
        <div className="space-y-10">
          {(() => {
            const model = orgs.filter((o) => tierKey(o) === 'model').sort(byLabel);
            const pathogens = orgs.filter((o) => tierKey(o) !== 'model');
            return (
              <>
                {model.length > 0 && (
                  <section className="space-y-3">
                    <h2 className="border-b border-neutral-300 pb-1 font-mono text-base font-semibold text-neutral-900">Model species</h2>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      {model.map((o) => <OrganismTile key={o.taxid} org={o} onDownloaded={refresh} guardDownload={guardDownload} />)}
                    </div>
                  </section>
                )}
                {pathogens.length > 0 && (
                  <section className="space-y-5">
                    <h2 className="border-b border-neutral-300 pb-1 font-mono text-base font-semibold text-neutral-900">AMR pathogens</h2>
                    {PATHOGEN_TIERS.map((tier) => {
                      const inTier = pathogens.filter((o) => tierKey(o) === tier);
                      if (inTier.length === 0) return null;
                      return (
                        <div key={tier} className="space-y-3">
                          <h3 className="font-mono text-sm font-semibold text-neutral-700">{TIER_LABEL[tier]}</h3>
                          <GramGrid orgs={inTier} onDownloaded={refresh} guardDownload={guardDownload} />
                        </div>
                      );
                    })}
                  </section>
                )}
              </>
            );
          })()}
        </div>
      )}

      <footer className="border-t border-neutral-200 pt-4 text-xs text-neutral-500">
        Data is redistributed for academic, non-commercial use under each source's own license —
        see the{' '}
        <Link className="underline hover:text-neutral-700" to={LEGAL_ROUTE}>
          data licenses, citations &amp; data-use notice
        </Link>.
      </footer>

      {pendingDownload && (
        <DataUseModal
          onAccept={() => { const run = pendingDownload; setPendingDownload(null); run(); }}
          onCancel={() => setPendingDownload(null)}
        />
      )}
    </main>
  );
}

function OrganismTile({ org, onDownloaded, guardDownload }: { org: CatalogOrg; onDownloaded: () => void; guardDownload: (start: () => void) => void }) {
  if (org.status === 'ready') return <PresentTile org={org} />;
  if (org.status === 'available') return <DownloadTile org={org} onDownloaded={onDownloaded} guardDownload={guardDownload} />;
  return <PlannedTile org={org} />;
}

function SeedMeta({ org }: { org: CatalogOrg }) {
  return (
    <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-neutral-400">
      <span>taxid {org.taxid}</span>
      {org.keggid && <span>KEGG {org.keggid}</span>}
    </div>
  );
}

function PlannedTile({ org }: { org: CatalogOrg }) {
  return (
    <div className="flex items-center gap-4 rounded border border-dashed border-neutral-200 bg-neutral-50 p-4 opacity-70">
      <OrganismGlyph taxid={org.taxid} className="h-16 w-16 shrink-0 text-neutral-300" />
      <div className="min-w-0">
        <div className="font-mono text-base font-semibold text-neutral-500 [word-spacing:-0.2em]">{seedLabel(org)}</div>
        <SeedMeta org={org} />
        <div className="mt-2">
          <span className="inline-block rounded bg-neutral-200 px-2 py-1 text-xs font-medium text-neutral-500">
            not yet supported
          </span>
        </div>
      </div>
    </div>
  );
}

function PresentTile({ org }: { org: CatalogOrg }) {
  const first = org.chromosomes[0];
  const totalFeatures = org.chromosomes.reduce((s, c) => s + c.featureCount, 0);
  const totalLength = org.chromosomes.reduce((s, c) => s + c.length, 0);

  // Overall annotation coverage (average across all info fields), shown as a ring on the tile.
  const [overall, setOverall] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/organism/${org.taxid}/coverage`)
      .then((r) => (r.ok ? r.json() : null))
      .then((cov: Coverage | null) => { if (!cancelled && cov?.sections?.length) setOverall(overallCoverageScore(cov)); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [org.taxid]);

  return (
    <Link
      to={first ? `/o/${org.taxid}/c/${encodeURIComponent(first.id)}` : `/`}
      className="group flex items-center gap-4 rounded border border-neutral-300 bg-white p-4 transition-colors hover:border-neutral-700 hover:bg-neutral-50"
    >
      <OrganismGlyph taxid={org.taxid} className="h-16 w-16 shrink-0 text-neutral-400 transition-colors group-hover:text-neutral-700" />
      <div className="min-w-0 flex-1">
        <div className="font-mono text-base font-semibold text-neutral-900 [word-spacing:-0.2em]">{org.shortName ?? seedLabel(org)}</div>
        <div className="text-sm text-neutral-700">
          <em>{org.scientificName}</em> {org.strain}
        </div>
        <div className="mt-2 space-y-0.5 text-xs text-neutral-500">
          <div className="flex flex-wrap gap-x-3">
            <span>taxid {org.taxid}</span>
            <span>{org.chromosomes.length} chromosome{org.chromosomes.length === 1 ? '' : 's'}</span>
          </div>
          <div className="flex flex-wrap gap-x-3">
            <span>{(totalLength / 1_000_000).toFixed(2)} Mb total</span>
            <span>{totalFeatures.toLocaleString()} features</span>
          </div>
        </div>
      </div>
      {overall != null && (
        <div className="flex shrink-0 flex-col items-center gap-0.5">
          <ScoreRing score={overall} label={`overall annotation coverage: ${Math.round(overall * 100)}% (average across fields)`} />
          <span className="text-[10px] text-neutral-500">annotation</span>
        </div>
      )}
    </Link>
  );
}

function DownloadTile({ org, onDownloaded, guardDownload }: { org: CatalogOrg; onDownloaded: () => void; guardDownload: (start: () => void) => void }) {
  const { progress, start } = useOrgDownload(org.taxid, org.bytes, onDownloaded);
  const errored = progress?.phase === 'error';

  return (
    <div className="flex items-center gap-4 rounded border border-dashed border-neutral-300 bg-neutral-50 p-4">
      <OrganismGlyph taxid={org.taxid} className="h-16 w-16 shrink-0 text-neutral-400" />
      <div className="min-w-0 flex-1">
        <div className="font-mono text-base font-semibold text-neutral-700 [word-spacing:-0.2em]">{seedLabel(org)}</div>
        <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-neutral-500">
          <span>taxid {org.taxid}</span>
          {org.keggid && <span>KEGG {org.keggid}</span>}
          {org.bytes ? <span>{mb(org.bytes)} download</span> : null}
        </div>

        <div className="mt-3">
        {!progress || errored ? (
          <>
            <button
              type="button"
              onClick={() => guardDownload(start)}
              className="cursor-pointer rounded bg-neutral-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-700"
            >
              {errored ? 'Retry download' : 'Download data'}
            </button>
            {errored && <div className="mt-1.5 text-xs text-red-600">{progress?.message || 'download failed'}</div>}
          </>
        ) : (
          <ProgressBar progress={progress} />
        )}
        </div>
      </div>
    </div>
  );
}
