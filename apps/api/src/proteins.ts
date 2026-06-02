import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ProteinDomains } from '@uniome/shared';
import { getOrganism } from './organisms.js';

const here = fileURLToPath(new URL('.', import.meta.url));
const RESOURCES = resolve(here, '../../../resources');

// UniProt accessions are alphanumeric (+ rare dashes for isoforms). Reject anything
// else so the value can't escape the proteins/ directory.
const ACC_RE = /^[A-Za-z0-9-]+$/;

// Read the locally-stored domain annotations for a protein, or null if the organism
// or file isn't present. Pure disk read — no external calls.
export function loadProteinDomains(taxid: string, acc: string): ProteinDomains | null {
  if (!ACC_RE.test(acc)) return null;
  const org = getOrganism(taxid);
  if (!org) return null;
  const path = resolve(RESOURCES, org.config.folder, 'proteins', 'domains', `${acc}.json`);
  try {
    const data = JSON.parse(readFileSync(path, 'utf8')) as ProteinDomains;
    // TED returns domains unsorted; order them by TED id (TED01, TED02, …) so the
    // table, track and sequence read consistently.
    const idNum = (d: ProteinDomains['domains'][number]) => {
      const m = /(\d+)/.exec(d.id);
      return m ? Number(m[1]) : Infinity;
    };
    data.domains?.sort((a, b) => idNum(a) - idNum(b));
    return data;
  } catch {
    return null;
  }
}

// Path to the locally-stored AlphaFold structure (BinaryCIF) for a protein, or null if
// absent. Structures are gitignored (large) and produced by scripts/fetch-protein-assets.mjs.
export function proteinStructurePath(taxid: string, acc: string): string | null {
  if (!ACC_RE.test(acc)) return null;
  const org = getOrganism(taxid);
  if (!org) return null;
  const path = resolve(RESOURCES, org.config.folder, 'proteins', 'structures', `${acc}.bcif`);
  return existsSync(path) ? path : null;
}
