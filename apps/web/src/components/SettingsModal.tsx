import { useState } from 'react';
import { SETTINGS_SECTIONS, useSettings } from '../lib/settings';
import { RELEASES_URL, type UpdateInfo } from '../lib/useUpdateCheck';
import { useDataStatus, type OrgDataStatus } from '../lib/useDataStatus';
import { useOrgDownload, progressLabel } from '../lib/orgDownload';

// A small blue notification dot (update available).
function Dot() {
  return <span className="h-2 w-2 shrink-0 rounded-full bg-blue-500" aria-label="update available" />;
}

const fmtDate = (iso: string | null) => (iso ? iso.slice(0, 10) : '—');

// One organism-data row in About: shows the data date, and — the user's choice, not forced — an
// Update button when the Release has newer data. Updating re-downloads (progress inline) and reloads.
function DataRow({ d, reload }: { d: OrgDataStatus; reload: () => void }) {
  const { progress, start } = useOrgDownload(d.taxid, d.bytes, reload);
  const updating = !!progress && progress.phase !== 'error';
  return (
    <li className="flex items-center justify-between gap-3 text-sm">
      <span className="min-w-0 truncate text-neutral-700">{d.label}</span>
      <span className="flex shrink-0 items-center gap-2 text-xs text-neutral-500 tabular-nums">
        {updating ? (
          <span className="text-neutral-600">{progressLabel(progress!)}</span>
        ) : (
          <>
            <span>data {fmtDate(d.localDate)}</span>
            {d.updateAvailable && (
              <button type="button" onClick={start} title={`newer data published ${fmtDate(d.latestDate)}`}
                className="cursor-pointer rounded bg-blue-600 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-blue-500">Update</button>
            )}
          </>
        )}
      </span>
    </li>
  );
}

// A pill toggle switch. Controlled: `on` + `onClick`.
function Switch({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onClick}
      className={'relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors ' + (on ? 'bg-neutral-800' : 'bg-neutral-300')}
    >
      <span className={'inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ' + (on ? 'translate-x-4' : 'translate-x-0.5')} />
    </button>
  );
}

// Settings window: left panel lists sections, right panel shows toggle switches for each data type in
// the selected section. Everything is persisted (data toggles in lib/settings; dark mode in its own
// `uniome.theme` key), so settings survive across sessions.
export function SettingsModal({ onClose, dark, onToggleDark, update, silenced, onToggleSilence }: { onClose: () => void; dark: boolean; onToggleDark: () => void; update: UpdateInfo; silenced: boolean; onToggleSilence: () => void }) {
  const { enabled, toggle } = useSettings();
  const APPEARANCE = 'appearance';
  const ABOUT = 'about';
  const [activeKey, setActiveKey] = useState(APPEARANCE);
  const isAppearance = activeKey === APPEARANCE;
  const isAbout = activeKey === ABOUT;
  const active = SETTINGS_SECTIONS.find((s) => s.key === activeKey) ?? SETTINGS_SECTIONS[0];
  const navItems = [
    { key: APPEARANCE, title: 'Appearance', dot: false },
    ...SETTINGS_SECTIONS.map((s) => ({ key: s.key, title: s.title, dot: false })),
    { key: ABOUT, title: 'About', dot: update.updateAvailable && !silenced },
  ];
  const title = isAppearance ? 'Appearance' : isAbout ? 'About' : active.title;
  const { rows: dataRows, reload: reloadData } = useDataStatus(isAbout); // per-organism data version + update

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
      onClick={onClose}
    >
      <div
        className="flex h-[70vh] max-h-[560px] w-full max-w-2xl overflow-hidden rounded-lg border border-neutral-300 bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Left: section nav */}
        <nav className="w-44 shrink-0 border-r border-neutral-200 bg-neutral-50 p-2">
          <div id="settings-title" className="px-2 py-1.5 font-mono text-sm font-semibold text-neutral-900">Settings</div>
          <div className="mt-1 space-y-0.5">
            {navItems.map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => setActiveKey(s.key)}
                className={'flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors ' + (s.key === activeKey ? 'bg-neutral-200 font-medium text-neutral-900' : 'text-neutral-600 hover:bg-neutral-100')}
              >
                <span>{s.title}</span>
                {s.dot && <Dot />}
              </button>
            ))}
          </div>
        </nav>

        {/* Right: toggles for the active section */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-2.5">
            <h2 className="text-sm font-semibold text-neutral-800">{title}</h2>
            <button type="button" onClick={onClose} aria-label="close settings" className="cursor-pointer rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {isAppearance ? (
              <ul className="divide-y divide-neutral-100">
                <li className="flex items-center justify-between gap-4 py-2.5">
                  <span className="text-sm text-neutral-800">Dark mode</span>
                  <Switch on={dark} onClick={onToggleDark} label="dark mode" />
                </li>
              </ul>
            ) : isAbout ? (
              <div className="space-y-4 text-sm">
                <div>
                  <div className="font-mono text-base font-semibold text-neutral-900">UniOme</div>
                  <div className="text-neutral-500">version {update.current}</div>
                </div>
                {update.updateAvailable ? (
                  <div className="rounded border border-blue-200 bg-blue-50 p-3">
                    <div className="flex items-center gap-2 font-medium text-blue-900"><Dot /> Update available — v{update.latest}</div>
                    <a href={update.releaseUrl} target="_blank" rel="noreferrer" className="mt-1.5 inline-block text-blue-800 underline hover:text-blue-600">Download the latest release →</a>
                  </div>
                ) : update.latest ? (
                  <div className="text-neutral-600">You're on the latest version (v{update.latest}).</div>
                ) : (
                  <div className="text-neutral-500">Checking for updates…</div>
                )}
                <div>
                  <a href={RELEASES_URL} target="_blank" rel="noreferrer" className="text-neutral-700 underline hover:text-neutral-900">All releases on GitHub →</a>
                </div>

                {/* Organism data versions: the date this install downloaded each org, + a flag if the
                    Release has newer data since. Data updates independently of the app. */}
                <div className="border-t border-neutral-100 pt-3">
                  <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-500">Organism data</div>
                  {dataRows === null ? (
                    <div className="text-xs text-neutral-400">checking…</div>
                  ) : dataRows.length === 0 ? (
                    <div className="text-xs text-neutral-500">No organism data downloaded yet.</div>
                  ) : (
                    <ul className="space-y-1.5">
                      {dataRows.map((d) => (
                        <DataRow key={d.taxid} d={d} reload={reloadData} />
                      ))}
                    </ul>
                  )}
                  {dataRows?.some((d) => d.updateAvailable) && (
                    <p className="mt-2 text-xs text-neutral-400">Updating re-downloads that organism's annotations (replacing your copy); nothing else is affected.</p>
                  )}
                </div>

                <div className="flex items-center justify-between gap-4 border-t border-neutral-100 pt-3">
                  <span className="text-sm text-neutral-800">Silence update notifications
                    <span className="block text-xs text-neutral-500">Hide the dot on the settings button; you can still check here.</span>
                  </span>
                  <Switch on={silenced} onClick={onToggleSilence} label="silence update notifications" />
                </div>
                <p className="text-xs text-neutral-400">Updates install manually: download the new .dmg and drag it to Applications. Your organism data is kept.</p>
              </div>
            ) : (
              <>
                <p className="mb-3 text-xs text-neutral-500">Choose which data to include and show for this section.</p>
                <ul className="divide-y divide-neutral-100">
                  {active.items.map((it) => {
                    const on = enabled(it.key);
                    // A section master shares the section's key ("Show General section"); its granular
                    // items are indented under it. Sections without a master (e.g. Home explorers) list peers.
                    const isMaster = it.key === active.key;
                    const hasMaster = active.items[0]?.key === active.key;
                    return (
                      <li key={it.key} className={'flex items-center justify-between gap-4 py-2.5 ' + (isMaster ? 'font-medium' : hasMaster ? 'pl-3' : '')}>
                        <span className={'text-sm ' + (on ? 'text-neutral-800' : 'text-neutral-400')}>{it.label}</span>
                        <Switch on={on} onClick={() => toggle(it.key)} label={it.label} />
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
