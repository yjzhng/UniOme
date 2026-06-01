import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ChromosomeInfo } from '@uniome/shared';
import { fetchJSONWithRetry } from '../lib/api';

interface OrganismSummary {
  taxid: string;
  shortName: string;
  scientificName: string;
  strain: string;
  chromosomes: ChromosomeInfo[];
}

export default function HomePage() {
  const [organisms, setOrganisms] = useState<OrganismSummary[] | null>(null);

  useEffect(() => {
    fetchJSONWithRetry<OrganismSummary[]>('/api/organisms')
      .then(setOrganisms)
      .catch(() => setOrganisms([]));
  }, []);

  return (
    <main className="mx-auto max-w-5xl px-4 py-10 space-y-6">
      <header className="space-y-1">
        <h1 className="font-mono text-lg font-semibold">Organisms</h1>
        <p className="text-sm text-neutral-600">
          Pick a prokaryote to start browsing its annotation database.
        </p>
      </header>
      {organisms === null ? (
        <div className="text-sm text-neutral-500">loading…</div>
      ) : organisms.length === 0 ? (
        <div className="text-sm text-neutral-500">no organisms available</div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {organisms.map((o) => (
            <OrganismTile key={o.taxid} org={o} />
          ))}
        </div>
      )}
    </main>
  );
}

function OrganismTile({ org }: { org: OrganismSummary }) {
  const first = org.chromosomes[0];
  const totalFeatures = org.chromosomes.reduce((s, c) => s + c.featureCount, 0);
  const totalLength = org.chromosomes.reduce((s, c) => s + c.length, 0);
  return (
    <Link
      to={first ? `/o/${org.taxid}/c/${encodeURIComponent(first.id)}` : `/`}
      className="block rounded border border-neutral-300 bg-white p-4 transition-colors hover:border-neutral-700 hover:bg-neutral-50"
    >
      <div className="font-mono text-base font-semibold text-neutral-900">{org.shortName}</div>
      <div className="text-sm text-neutral-700">
        <em>{org.scientificName}</em> {org.strain}
      </div>
      <div className="mt-2 space-y-0.5 text-xs text-neutral-500">
        <div className="flex flex-wrap gap-x-3">
          <span>taxid {org.taxid}</span>
          <span>
            {org.chromosomes.length} chromosome{org.chromosomes.length === 1 ? '' : 's'}
          </span>
        </div>
        <div className="flex flex-wrap gap-x-3">
          <span>{(totalLength / 1_000_000).toFixed(2)} Mb total</span>
          <span>{totalFeatures.toLocaleString()} features</span>
        </div>
      </div>
    </Link>
  );
}
