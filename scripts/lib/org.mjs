// Shared helpers for the build/fetch scripts. Anchored to THIS file's location, so the
// resolved paths are identical no matter how deep the importing script lives (scripts/,
// scripts/general/, scripts/organisms/<org>/). Previously every script inlined its own
// copy of `RESOURCES` + `orgFolder` — this is the single source of truth.
import { readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

// Repo-root resources tree (scripts/lib -> ../../resources), overridable via UNIOME_RESOURCES
// (the same env the API/desktop build honors, so scripts can target a packaged data dir).
export const RESOURCES = process.env.UNIOME_RESOURCES
  ? resolve(process.env.UNIOME_RESOURCES)
  : resolve(here, '../../resources');

// taxid -> the organism's folder NAME under resources/ (e.g. '83333' -> '83333_Ec').
// Matches the API's discovery convention (organisms.ts): a top-level dir named `<taxid>_<nick>`.
export function orgFolder(taxid) {
  const m = readdirSync(RESOURCES, { withFileTypes: true }).find(
    (e) => e.isDirectory() && new RegExp(`^${taxid}_`).test(e.name)
  );
  if (!m) throw new Error(`no resources folder for taxid ${taxid}`);
  return m.name;
}

// taxid -> absolute path to the organism folder.
export function orgDir(taxid) {
  return resolve(RESOURCES, orgFolder(taxid));
}

// Absolute path to the organism's annotation DB, preferring the enriched working copy under
// <org>/core/ (what the API ingests) over the org-root prokDB core. Mirrors organisms.ts#findDbPath.
export function findDb(taxid) {
  const folder = orgDir(taxid);
  for (const dir of [resolve(folder, 'core'), folder]) {
    try {
      const file = readdirSync(dir).find((f) => /_DB\.csv$/i.test(f));
      if (file) return resolve(dir, file);
    } catch { /* no such dir */ }
  }
  throw new Error(`no *_DB.csv for taxid ${taxid} (checked core/ and root)`);
}
