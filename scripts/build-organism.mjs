#!/usr/bin/env node
// One-command (re)build of an organism's derived data. Encodes the canonical pipeline order:
// general resources first (taxid-parameterized, any organism), then the organism's own
// org-specific source parsers (scripts/organisms/<folder>/build.mjs).
//
//   node scripts/build-organism.mjs <taxid> [flags]
//   npm run build-organism -- <taxid> [flags]
//
// Flags:
//   --list              print the plan and exit (no execution) — also the living pipeline doc
//   --dry-run           print each command as it would run, but don't run it
//   --only a,b          run only these steps (by name)
//   --skip a,b          run all steps except these
//   --from <name>       start at this step (skip everything before it)
//   --general-only      skip the org-specific phase
//   --org-only          skip the general phase
//   --continue          keep going if a step fails (default: stop at first failure)
//
// PREREQUISITE: the organism folder resources/<taxid>_<nick>/ must already exist with its
// core DB enriched (scripts/enrich/ — see its README). This script builds the DERIVED data
// (indexes, structures, source parses) on top of that DB.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { orgFolder, orgDir } from './lib/org.mjs';
import { loadOrganismManifest } from './lib/manifest.mjs';

const here = dirname(fileURLToPath(import.meta.url));

// General phase: universal resources, re-run for any organism by taxid. Order matters —
// asset fetches before the indexes that read those assets.
function generalSteps(taxid, manifest) {
  const g = (f) => resolve(here, 'general', f);
  return [
    // fetch raw assets first
    { name: 'fetch-protein-assets', cmd: g('fetch-protein-assets.mjs'), args: [taxid] },
    { name: 'fetch-rna-assets', cmd: g('fetch-rna-assets.mjs'), args: [taxid] },
    { name: 'fetch-interactions', cmd: g('fetch-interactions.mjs'), args: [taxid] },
    { name: 'fetch-rnainter', cmd: g('fetch-rnainter.mjs'), args: [taxid] },
    // indexes / computed over the fetched assets + the DB
    { name: 'build-domain-index', cmd: g('build-domain-index.mjs'), args: [taxid] },
    { name: 'build-complex-index', cmd: g('build-complex-index.mjs'), args: [taxid] },
    { name: 'build-rna-family-index', cmd: g('build-rna-family-index.mjs'), args: [taxid] },
    { name: 'build-relationships', cmd: g('build-relationships.mjs'), args: [taxid] },
    { name: 'build-seq-similarity', cmd: g('build-seq-similarity.mjs'), args: [taxid] },
    { name: 'build-struct-similarity', cmd: g('build-struct-similarity.mjs'), args: [taxid] },
    { name: 'build-reactions', cmd: g('build-reactions.mjs'), args: [taxid] },
    { name: 'build-reaction-structures', cmd: g('build-reaction-structures.mjs'), args: [taxid] },
    { name: 'build-chebi-kekule', cmd: g('build-chebi-kekule.mjs'), args: [taxid] },
    // KEGG needs the org's 3-letter code (org-specific param for a general source)
    { name: 'build-pathway-maps', cmd: g('build-pathway-maps.mjs'), args: [taxid, manifest.keggid].filter(Boolean) },
    // pathway taxonomy tree (BRITE br08901), grouping the maps built above
    { name: 'build-pathway-taxonomy', cmd: g('build-pathway-taxonomy.mjs'), args: [taxid, manifest.keggid].filter(Boolean) },
  ];
}

function parseFlags(argv) {
  const flags = { only: null, skip: null, from: null };
  const bools = ['list', 'dry-run', 'general-only', 'org-only', 'continue'];
  for (const b of bools) flags[b.replace('-', '')] = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--list') flags.list = true;
    else if (a === '--dry-run') flags.dryrun = true;
    else if (a === '--general-only') flags.generalonly = true;
    else if (a === '--org-only') flags.orgonly = true;
    else if (a === '--continue') flags.continue = true;
    else if (a === '--only') flags.only = (argv[++i] || '').split(',').filter(Boolean);
    else if (a === '--skip') flags.skip = (argv[++i] || '').split(',').filter(Boolean);
    else if (a === '--from') flags.from = argv[++i];
    else console.warn(`[build-organism] ignoring unknown flag: ${a}`);
  }
  return flags;
}

function selectSteps(steps, flags) {
  let out = steps;
  if (flags.from) {
    const i = out.findIndex((s) => s.name === flags.from);
    if (i === -1) throw new Error(`--from: no step named "${flags.from}"`);
    out = out.slice(i);
  }
  if (flags.only) out = out.filter((s) => flags.only.includes(s.name));
  if (flags.skip) out = out.filter((s) => !flags.skip.includes(s.name));
  return out;
}

function main() {
  const taxid = process.argv[2];
  if (!taxid || taxid.startsWith('--')) {
    console.error('usage: node scripts/build-organism.mjs <taxid> [--list|--dry-run|--only|--skip|--from|--general-only|--org-only|--continue]');
    process.exit(2);
  }
  const flags = parseFlags(process.argv.slice(3));

  const folder = orgFolder(taxid); // throws if the organism folder is missing
  const orgScriptDir = resolve(here, 'organisms', folder);
  const manifest = loadOrganismManifest(taxid); // merged: tile registry (keggid) + org infra config
  const orgBuild = resolve(orgScriptDir, 'build.mjs');

  let steps = [];
  if (!flags.orgonly) steps.push(...selectSteps(generalSteps(taxid, manifest), flags));
  const hasOrgBuild = existsSync(orgBuild);
  if (!flags.generalonly && hasOrgBuild) {
    steps.push({ name: 'org-specific', cmd: orgBuild, args: [taxid], phase: 'org' });
  }

  console.log(`[build-organism] ${folder} (taxid ${taxid}) — ${steps.length} step(s)`);
  if (!flags.generalonly && !hasOrgBuild) {
    console.log(`[build-organism] note: no scripts/organisms/${folder}/build.mjs — org-specific phase skipped`);
  }
  if (flags.list) {
    for (const s of steps) console.log(`  • ${s.name}: node ${s.cmd.replace(here + '/', 'scripts/')} ${s.args.join(' ')}`);
    return;
  }

  for (const s of steps) {
    const display = `node ${s.cmd.replace(here + '/', 'scripts/')} ${s.args.join(' ')}`;
    console.log(`\n[build-organism] ▶ ${s.name}: ${display}`);
    if (flags.dryrun) continue;
    const r = spawnSync('node', [s.cmd, ...s.args], { stdio: 'inherit' });
    if (r.status !== 0) {
      console.error(`[build-organism] ✗ ${s.name} exited ${r.status}`);
      if (!flags.continue) process.exit(r.status || 1);
    }
  }
  console.log(`\n[build-organism] done — outputs under ${orgDir(taxid)}`);
}

main();
