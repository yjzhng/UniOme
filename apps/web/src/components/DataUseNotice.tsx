// Academic-use acknowledgment gate shown before the first organism-data download.
// UniOme redistributes third-party data under each source's own license (see docs/data-attribution.md);
// several sources (KEGG especially) are academic/non-commercial only. The user must affirm academic,
// non-commercial use once; the choice is remembered so downloads afterward don't re-prompt.
import { useState } from 'react';
import { Link } from 'react-router-dom';

const STORAGE_KEY = 'uniome.dataUseAcceptedAt';
// The full terms are rendered in-app at the /legal route (bundled from repo-root docs/), so they
// work offline and don't depend on a GitHub URL, push state, or branch name. Navigate in-place with
// react-router (NOT target="_blank"): a new window in the Electron shell would duplicate the app.
export const LEGAL_ROUTE = '/legal';

export function hasAcceptedDataUse(): boolean {
  try { return !!localStorage.getItem(STORAGE_KEY); } catch { return false; }
}

function rememberAccepted() {
  try { localStorage.setItem(STORAGE_KEY, new Date().toISOString()); } catch { /* ignore */ }
}

// Modal asking the user to confirm academic/non-commercial use before the first download.
// onAccept persists the acknowledgment then runs; onCancel dismisses without downloading.
export function DataUseModal({ onAccept, onCancel }: { onAccept: () => void; onCancel: () => void }) {
  const [ack, setAck] = useState(false);

  const accept = () => { rememberAccepted(); onAccept(); };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="datause-title"
      onClick={onCancel}
    >
      <div
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-lg border border-neutral-300 bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="datause-title" className="font-mono text-base font-semibold text-neutral-900">
          Data use notice — academic use
        </h2>
        <div className="mt-3 space-y-3 text-sm text-neutral-700">
          <p>
            The organism data is provided for <strong>academic, non-commercial research and
            educational use only</strong>. UniOme does not own this data — it redistributes datasets
            derived from external databases <strong>under each source's own license</strong>.
          </p>
          <p>
            Some sources restrict redistribution and non-academic use. In particular,{' '}
            <strong>KEGG</strong>-derived data (the <code>KG_*</code> annotation columns and pathway
            maps) is copyright Kanehisa Laboratories and free for academic viewing only; commercial
            or redistribution use requires a KEGG license. EcoCyc, EnteroBase, DeepLocPro, and the
            Foster/HT-CRISPRi datasets are likewise academic/non-commercial.
          </p>
          <p>
            You are responsible for complying with each source's terms and for citing the sources you
            use. See the{' '}
            <Link className="underline hover:text-neutral-900" to={LEGAL_ROUTE} onClick={onCancel}>
              per-source licenses &amp; citations
            </Link>{' '}
            and the{' '}
            <Link className="underline hover:text-neutral-900" to={LEGAL_ROUTE} onClick={onCancel}>
              full data-use notice
            </Link>. Data is provided "as is", without warranty, and not for clinical use.
          </p>
          <label className="flex items-start gap-2 pt-1 text-sm text-neutral-800">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={ack}
              onChange={(e) => setAck(e.target.checked)}
            />
            <span>
              I confirm my use is academic and non-commercial, and I will comply with each data
              source's license and cite the sources I use.
            </span>
          </label>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="cursor-pointer rounded border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={accept}
            disabled={!ack}
            className="cursor-pointer rounded bg-neutral-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Agree &amp; download
          </button>
        </div>
      </div>
    </div>
  );
}
