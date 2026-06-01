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
  const path = resolve(RESOURCES, org.config.folder, 'proteins', `${acc}.domains.json`);
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as ProteinDomains;
  } catch {
    return null;
  }
}

// Path to the locally-stored AlphaFold mmCIF for a protein, or null if absent.
// Structures are gitignored (large) and produced by scripts/fetch-protein-assets.mjs.
export function proteinStructurePath(taxid: string, acc: string): string | null {
  if (!ACC_RE.test(acc)) return null;
  const org = getOrganism(taxid);
  if (!org) return null;
  const path = resolve(RESOURCES, org.config.folder, 'proteins', 'structures', `${acc}.cif`);
  return existsSync(path) ? path : null;
}
