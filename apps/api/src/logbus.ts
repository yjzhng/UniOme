// In-process log bus: captures the server's console output into a ring buffer and fans it out to
// subscribers (the /api/_logs SSE stream). This is what backs the app's in-window "Console" tab —
// so the desktop app needs no visible terminal, yet the server log is still inspectable.
//
// Imported first in index.ts so the console patch is installed before any other module logs at
// load time (e.g. the organism-load summary).
export interface LogLine { t: number; level: string; msg: string }

const BUFFER_MAX = 1000;
const buffer: LogLine[] = [];
const subscribers = new Set<(l: LogLine) => void>();

function fmt(a: unknown): string {
  if (typeof a === 'string') return a;
  if (a instanceof Error) return a.stack || a.message;
  try { return JSON.stringify(a); } catch { return String(a); }
}

let installed = false;
function install(): void {
  if (installed) return;
  installed = true;
  for (const level of ['log', 'info', 'warn', 'error'] as const) {
    const orig = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      const line: LogLine = { t: Date.now(), level, msg: args.map(fmt).join(' ') };
      buffer.push(line);
      if (buffer.length > BUFFER_MAX) buffer.shift();
      for (const s of subscribers) { try { s(line); } catch { /* a bad subscriber shouldn't break logging */ } }
      orig(...args); // still write to real stdout/stderr (the launcher log file)
    };
  }
}

install();

export function logHistory(): LogLine[] { return buffer.slice(); }

export function subscribeLogs(fn: (l: LogLine) => void): () => void {
  subscribers.add(fn);
  return () => { subscribers.delete(fn); };
}
