#!/usr/bin/env bun
import * as fs from 'fs';
import * as path from 'path';
import { parseFlags } from './lib/argv-flags.ts';
import { readJsonFile } from './lib/fs.ts';
import { createForgeAdapter } from './lib/forge-adapter/index.ts';
import { isForgeType, resolveForgeForRepo } from './lib/forge-detection.ts';
import { syncPrDependencies } from './lib/pr-dependencies.ts';

// Two-way PR-dependency sync (forge-sync.md § 6.8): mirrors each open queue PR's dependencies
// onto the forge (stack first, native "blocked by" otherwise, PR-body line as the fallback) and
// reads the forge's back into `depends_on`. Prints the plan as JSON. With `--apply` it writes the
// forge and the updated queue to `--out`, which the orchestrator installs through the
// state-write-guard; it never writes the live queue.json. Exit 0 clean, 1 some PR failed, 2 usage.

const USAGE =
  'Usage: bun run scripts/pr-deps-sync.ts --campaign-dir <.blackhole> [--apply --out <queue.json.tmp>]';

async function main(): Promise<number> {
  const flags = parseFlags(process.argv.slice(2));
  const dir = typeof flags['campaign-dir'] === 'string' ? flags['campaign-dir'] : null;
  const apply = flags.apply === true;
  const out = typeof flags.out === 'string' ? flags.out : null;
  if (!dir || (apply && !out)) {
    console.error(USAGE);
    return 2;
  }
  const config = readJsonFile(path.join(dir, 'config.json'), 'config.json') as { repo?: string; forge?: string };
  const queuePath = path.join(dir, 'queue.json');
  const queue = readJsonFile(queuePath, 'queue.json') as Parameters<typeof syncPrDependencies>[1];
  if (!config.repo) {
    console.error('config.json has no repo');
    return 2;
  }
  const resolved = resolveForgeForRepo(path.dirname(path.resolve(dir)), config.forge);
  const forge = resolved.ok ? resolved.forge : config.forge && isForgeType(config.forge) ? config.forge : 'github';
  const adapter = createForgeAdapter({ repo: config.repo, forge });
  // Gitea's repo string may carry the host; dependency refs name `owner/name`.
  const repo = config.repo.split('/').slice(-2).join('/');
  const result = await syncPrDependencies(adapter, queue, { apply, repo, queuePath });
  if (result.queue && out) fs.writeFileSync(out, `${JSON.stringify(result.queue, null, 2)}\n`);
  console.log(JSON.stringify({ rows: result.rows, errors: result.errors }, null, 2));
  const bodyOnly = result.rows.filter((r) => !r.native).map((r) => `#${r.issue}`);
  if (bodyOnly.length) console.error(`no native dependency feature (HTTP 404/410) for ${bodyOnly.join(', ')}: their edges are PR-body lines`);
  return result.errors.length ? 1 : 0;
}

if (import.meta.main) process.exitCode = await main();
