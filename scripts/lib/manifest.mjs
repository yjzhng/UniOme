import { readdirSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RESOURCES } from './org.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const ORGANISMS = resolve(here, '..', 'organisms');

// Tile registry: resources/organism-catalog.json — taxid, nickname, keggid (honors UNIOME_CATALOG).
function catalogPath() {
  return process.env.UNIOME_CATALOG
    ? resolve(process.env.UNIOME_CATALOG)
    : resolve(RESOURCES, 'organism-catalog.json');
}

function tile(taxid) {
  try {
    const tiles = JSON.parse(readFileSync(catalogPath(), 'utf8')).organisms ?? [];
    return tiles.find((t) => String(t.taxid) === String(taxid)) ?? {};
  } catch {
    return {};
  }
}

// Org infra config: scripts/organisms/<taxid>_*/organism.json — cross-DB ids + availability.
function orgConfig(taxid) {
  let folder;
  try {
    folder = readdirSync(ORGANISMS).find((n) => new RegExp(`^${taxid}_`).test(n));
  } catch {
    return {};
  }
  if (!folder) return {};
  try {
    return JSON.parse(readFileSync(resolve(ORGANISMS, folder, 'organism.json'), 'utf8'));
  } catch {
    return {};
  }
}

// Merged per-organism IDs for the build scripts: keggid/nickname from the tile registry +
// stringSpecies/speciesTaxid/paxdbSpecies (and availability) from the org infra folder. {} if none.
export function loadOrganismManifest(taxid) {
  return { ...tile(taxid), ...orgConfig(taxid) };
}
