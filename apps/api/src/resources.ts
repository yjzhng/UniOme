import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Single source of truth for the resources root. Honors UNIOME_RESOURCES — set by the desktop
// shell to a writable user-data dir, since the packaged code is read-only inside the asar and the
// ~GB of organism data lives outside it. Falls back to the in-tree resources/ for repo dev.
//
// Env-first and lazy on purpose: import.meta.url is only evaluated on the dev fallback path, so
// when the server is bundled to CommonJS for packaging (where import.meta.url isn't available) and
// UNIOME_RESOURCES is set before load, this never touches it.
export function resourcesRoot(): string {
  if (process.env.UNIOME_RESOURCES) return resolve(process.env.UNIOME_RESOURCES);
  const here = fileURLToPath(new URL('.', import.meta.url));
  return resolve(here, '../../../resources');
}
