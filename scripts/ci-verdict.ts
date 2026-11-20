import { parseFlags, unknownFlagKeys } from './lib/argv-flags.ts';
import * as fs from 'fs';
import { readJsonFile } from './lib/fs.ts';
import { checksFromSnapshot, ciVerdict, requiredChecksFromConfig, unconfiguredSkipWarning } from './lib/merge-gate/ci-verdict.ts';

// Merge-gate CI verdict from a checks snapshot file (ADR-050). Exit 0 green, 1 red, 3 pending,
// 2 usage; the verdict JSON is printed either way.

const USAGE = 'Usage: bun run scripts/ci-verdict.ts --checks <file> [--required <check name>]... [--config <path>]\n' +
  '  --required: exact check name that must have run and succeeded (repeatable; overrides merge_ready.required_checks)\n' +
  '  --config: campaign config to read merge_ready.required_checks from (default .blackhole/config.json)\n' +
  '  <file>: REST or GitHub MCP check-runs JSON, a combined-status JSON, both merged, or a ForgeCheck[] array';

// parseFlags keeps one value per key, so the repeatable --required is collected here. A --required
// without a usable value (last token, followed by a flag, or empty) is a usage error, never a
// silently skipped evidence check: the merge gate must fail closed.
const requiredFromArgv = (argv: string[]): string[] | null => {
  const names: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] !== '--required') continue;
    const value = argv[i + 1];
    if (value === undefined || value === '' || value.startsWith('--')) return null;
    names.push(value);
    i++;
  }
  return names;
};

const main = (): number => {
  const argv = process.argv.slice(2);
  const flags = parseFlags(argv);
  if (unknownFlagKeys(flags, ['checks', 'required', 'config']).length || typeof flags.checks !== 'string') {
    console.error(USAGE);
    return 2;
  }
  const flagRequired = requiredFromArgv(argv);
  if (flagRequired === null) {
    console.error(USAGE);
    return 2;
  }
  let result;
  try {
    const configPath = typeof flags.config === 'string' ? flags.config : '.blackhole/config.json';
    const requiredChecks = flagRequired.length > 0 ? flagRequired
      : requiredChecksFromConfig(fs.existsSync(configPath) ? (readJsonFile(configPath, configPath) as Record<string, unknown>) : {});
    const checks = checksFromSnapshot(readJsonFile(flags.checks, flags.checks));
    const warning = unconfiguredSkipWarning(checks, { requiredChecks });
    if (warning) console.error(warning);
    result = ciVerdict(checks, { requiredChecks });
  } catch (error) {
    console.error(`${(error as Error).message}\n${USAGE}`);
    return 2;
  }
  console.log(JSON.stringify(result));
  return result.verdict === 'green' ? 0 : result.verdict === 'red' ? 1 : 3;
};

if (import.meta.main) process.exit(main());
