import { parseFlags, unknownFlagKeys } from './lib/argv-flags.ts';
import { readJsonFile } from './lib/fs.ts';
import { classifyTrunkRed, parseTrunkRedPrs } from './lib/trunk-red.ts';

// Cross-PR trunk-red classification (ci-diagnosis.md § Trunk-red). Exit 0 per-pr, 1 trunk-red,
// 2 usage or malformed input; the result JSON is printed on 0 and 1.

const USAGE = 'Usage: bun run scripts/trunk-red.ts --prs <file>\n' +
  '  <file>: JSON array of { pr, failingChecks: ci-diagnosis failing_checks[], touchedFiles: string[] }';

const main = (): number => {
  const flags = parseFlags(process.argv.slice(2));
  if (unknownFlagKeys(flags, ['prs']).length || typeof flags.prs !== 'string') {
    console.error(USAGE);
    return 2;
  }
  let result;
  try {
    result = classifyTrunkRed(parseTrunkRedPrs(readJsonFile(flags.prs, flags.prs)));
  } catch (error) {
    console.error(`${(error as Error).message}\n${USAGE}`);
    return 2;
  }
  console.log(JSON.stringify(result));
  return result.classification === 'trunk-red' ? 1 : 0;
};

if (import.meta.main) process.exit(main());
