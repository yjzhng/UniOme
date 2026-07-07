import { Link } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
// The legal docs are bundled from their single source of truth in repo-root docs/ (via Vite ?raw),
// so the page works offline and never depends on a GitHub URL / push state / branch name.
import dataUseNotice from '../../../../docs/data-use-notice.md?raw';
import dataLicenses from '../../../../docs/data-attribution.md?raw';

// Render bundled markdown with GFM tables, styled with the app's neutral palette (auto-flips in
// dark mode). Relative/anchor links in the source (../LICENSE, sibling .md, #anchors) are shown as
// plain text — everything they'd point to is on this page or in the repo — while http(s) links open
// out. This keeps the rendered notice free of dead in-app links.
function Markdown({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: (p) => <h1 className="mt-6 mb-3 font-mono text-xl font-semibold text-neutral-900" {...p} />,
        h2: (p) => <h2 className="mt-6 mb-2 border-b border-neutral-200 pb-1 font-mono text-lg font-semibold text-neutral-900" {...p} />,
        h3: (p) => <h3 className="mt-4 mb-2 font-semibold text-neutral-800" {...p} />,
        p: (p) => <p className="my-2 text-sm leading-relaxed text-neutral-700" {...p} />,
        ul: (p) => <ul className="my-2 list-disc space-y-1 pl-6 text-sm text-neutral-700" {...p} />,
        ol: (p) => <ol className="my-2 list-decimal space-y-1 pl-6 text-sm text-neutral-700" {...p} />,
        li: (p) => <li className="leading-relaxed" {...p} />,
        blockquote: (p) => <blockquote className="my-3 border-l-4 border-neutral-300 bg-neutral-50 px-3 py-2 text-sm text-neutral-600" {...p} />,
        code: (p) => <code className="rounded bg-neutral-100 px-1 py-0.5 font-mono text-xs text-neutral-800" {...p} />,
        a: ({ href, children }) =>
          href && /^https?:/.test(href) ? (
            <a className="text-neutral-900 underline hover:text-neutral-600" href={href} target="_blank" rel="noreferrer">{children}</a>
          ) : (
            <span className="font-medium text-neutral-800">{children}</span>
          ),
        table: (p) => (
          <div className="my-3 overflow-x-auto">
            <table className="w-full border-collapse text-xs" {...p} />
          </div>
        ),
        th: (p) => <th className="border border-neutral-300 bg-neutral-100 px-2 py-1 text-left align-top font-semibold text-neutral-800" {...p} />,
        td: (p) => <td className="border border-neutral-200 px-2 py-1 align-top text-neutral-700" {...p} />,
        hr: () => <hr className="my-6 border-neutral-200" />,
      }}
    >
      {children}
    </ReactMarkdown>
  );
}

export default function LegalPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <Link to="/" className="text-sm text-neutral-500 underline hover:text-neutral-800">← Back to organisms</Link>
      <section className="mt-4">
        <Markdown>{dataUseNotice}</Markdown>
      </section>
      <hr className="my-10 border-neutral-300" />
      <section>
        <Markdown>{dataLicenses}</Markdown>
      </section>
    </main>
  );
}
