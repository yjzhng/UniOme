import { createReadStream, createWriteStream, mkdirSync, rmSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { resourcesRoot } from './resources.js';
import { catalogEntry, resolveArchiveUrl } from './catalog.js';

// Server-side, per-organism data download + extract, with progress. Drives the home-page tiles'
// "Download data" button: the browser triggers it (POST) and watches progress over SSE.
export interface DownloadProgress {
  taxid: string;
  phase: 'downloading' | 'extracting' | 'done' | 'error';
  received: number;
  total: number;
  message?: string;
}

const states = new Map<string, DownloadProgress>();
const subscribers = new Map<string, Set<(p: DownloadProgress) => void>>();

function emit(p: DownloadProgress): void {
  states.set(p.taxid, p);
  const subs = subscribers.get(p.taxid);
  if (subs) for (const fn of subs) { try { fn(p); } catch { /* a bad subscriber shouldn't break the download */ } }
}

export function getProgress(taxid: string): DownloadProgress | undefined {
  return states.get(taxid);
}

export function isActive(taxid: string): boolean {
  const st = states.get(taxid);
  return !!st && (st.phase === 'downloading' || st.phase === 'extracting');
}

export function subscribeProgress(taxid: string, fn: (p: DownloadProgress) => void): () => void {
  let set = subscribers.get(taxid);
  if (!set) { set = new Set(); subscribers.set(taxid, set); }
  set.add(fn);
  return () => { set!.delete(fn); };
}

// Stream a source (http/https/file/local path) to destFile, reporting bytes.
async function fetchToFile(source: string, destFile: string, onBytes: (seen: number, total: number) => void): Promise<void> {
  if (/^https?:\/\//.test(source)) {
    const res = await fetch(source);
    if (!res.ok || !res.body) throw new Error(`download failed (${res.status})`);
    const total = Number(res.headers.get('content-length')) || 0;
    let seen = 0;
    const body = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]);
    body.on('data', (c: Buffer) => { seen += c.length; onBytes(seen, total); });
    await pipeline(body, createWriteStream(destFile));
  } else {
    const src = source.replace(/^file:\/\//, '');
    const total = statSync(src).size;
    let seen = 0;
    const rs = createReadStream(src);
    rs.on('data', (c: Buffer | string) => { seen += c.length; onBytes(seen, total); });
    await pipeline(rs, createWriteStream(destFile));
  }
}

function extractTarGz(tarFile: string, destDir: string): Promise<void> {
  return new Promise((res, rej) => {
    const p = spawn('tar', ['-xzf', tarFile, '-C', destDir], { stdio: 'inherit' });
    p.on('error', rej);
    p.on('exit', (code) => (code === 0 ? res() : rej(new Error(`tar exited ${code}`))));
  });
}

// Begin downloading an organism (no-op if already running). Resolves when started; progress and
// completion are reported via emit()/subscribers, not the returned promise.
export async function startDownload(taxid: string): Promise<void> {
  if (isActive(taxid)) return;
  const entry = catalogEntry(taxid);
  if (!entry) { emit({ taxid, phase: 'error', received: 0, total: 0, message: 'organism not in catalog' }); return; }
  if (!entry.available || !entry.url) { emit({ taxid, phase: 'error', received: 0, total: 0, message: 'organism not available for download' }); return; }

  const root = resourcesRoot();
  const staging = resolve(root, '_assets');
  const tarFile = resolve(staging, `${entry.folder}.tar.gz`);
  const source = resolveArchiveUrl(entry.url);
  const known = entry.bytes ?? 0;

  emit({ taxid, phase: 'downloading', received: 0, total: known });
  try {
    mkdirSync(staging, { recursive: true });
    await fetchToFile(source, tarFile, (received, total) =>
      emit({ taxid, phase: 'downloading', received, total: total || known })
    );
    emit({ taxid, phase: 'extracting', received: known, total: known });
    await extractTarGz(tarFile, root); // archive contains <folder>/… → resources/<folder>/
    rmSync(tarFile, { force: true });
    emit({ taxid, phase: 'done', received: known, total: known });
  } catch (err) {
    rmSync(tarFile, { force: true }); // drop a partial archive so a retry starts clean
    emit({ taxid, phase: 'error', received: 0, total: known, message: err instanceof Error ? err.message : String(err) });
  }
}
