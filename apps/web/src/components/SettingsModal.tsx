import { useState } from 'react';
import { SETTINGS_SECTIONS, useSettings } from '../lib/settings';

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
export function SettingsModal({ onClose, dark, onToggleDark }: { onClose: () => void; dark: boolean; onToggleDark: () => void }) {
  const { enabled, toggle, setAll } = useSettings();
  const APPEARANCE = 'appearance';
  const [activeKey, setActiveKey] = useState(APPEARANCE);
  const isAppearance = activeKey === APPEARANCE;
  const active = SETTINGS_SECTIONS.find((s) => s.key === activeKey) ?? SETTINGS_SECTIONS[0];
  const navItems = [{ key: APPEARANCE, title: 'Appearance' }, ...SETTINGS_SECTIONS.map((s) => ({ key: s.key, title: s.title }))];

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
                className={'w-full rounded px-2 py-1.5 text-left text-sm transition-colors ' + (s.key === activeKey ? 'bg-neutral-200 font-medium text-neutral-900' : 'text-neutral-600 hover:bg-neutral-100')}
              >
                {s.title}
              </button>
            ))}
          </div>
          <div className="mt-3 border-t border-neutral-200 pt-2">
            <button type="button" onClick={() => setAll(true)} className="w-full rounded px-2 py-1 text-left text-xs text-neutral-500 hover:bg-neutral-100">Show all</button>
            <button type="button" onClick={() => setAll(false)} className="w-full rounded px-2 py-1 text-left text-xs text-neutral-500 hover:bg-neutral-100">Hide all</button>
          </div>
        </nav>

        {/* Right: toggles for the active section */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-2.5">
            <h2 className="text-sm font-semibold text-neutral-800">{isAppearance ? 'Appearance' : active.title}</h2>
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
