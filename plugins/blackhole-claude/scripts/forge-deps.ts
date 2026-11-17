import type { PrLanding, PrLandingState } from './lib/forge-adapter/pr-landing.ts';

const DEP_LINE_RE =
  /^(?:blocked by|depends on|after)\s+#(\d+)(?:\s+merges)?\s*$/i;

const EPIC_PARENT_RE = /^part of\s+#\d+\s*$/i;

export function parseDependsFromBody(body: string): number[] {
  const seen = new Set<number>();
  const deps: number[] = [];

  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    if (EPIC_PARENT_RE.test(trimmed)) continue;

    const match = trimmed.match(DEP_LINE_RE);
    if (match) {
      const num = Number(match[1]);
      if (!seen.has(num)) {
        seen.add(num);
        deps.push(num);
      }
    }
  }

  return deps;
}

/** Same keywords as `DEP_LINE_RE`, naming a PR in another repo: `Depends on owner/repo#N`. */
const CROSS_REPO_DEP_LINE_RE =
  /^(?:blocked by|depends on|after)\s+([A-Za-z0-9][\w.-]*\/[\w.-]+)#(\d+)(?:\s+merges)?\s*$/i;

/** A dependency on pull request `number` of `repo` (`owner/repo`) on the campaign's forge. */
export type CrossRepoDep = { repo: string; number: number };

/**
 * The cross-repo dependency lines of an issue body, in order, deduped. These live only in the
 * body (no queue.json field): `mergeDependsIntoBody` never matches them, so a same-repo
 * write-back keeps them. A line that is not exactly `<keyword> owner/repo#N` is ignored.
 */
export function parseCrossRepoDepsFromBody(body: string): CrossRepoDep[] {
  const seen = new Set<string>();
  const deps: CrossRepoDep[] = [];
  for (const line of body.split('\n')) {
    const match = line.trim().match(CROSS_REPO_DEP_LINE_RE);
    if (!match) continue;
    const dep = { repo: match[1], number: Number(match[2]) };
    const key = `${dep.repo}#${dep.number}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deps.push(dep);
  }
  return deps;
}

/** Why a cross-repo dependency is still unmet: its PR's landing, or `unreadable` when the forge read failed. */
export type CrossRepoDepState = Exclude<PrLandingState, 'merged'> | 'unreadable';

export type CrossRepoBlocker = { issue: number; dep: CrossRepoDep; state: CrossRepoDepState };

/** Reads the landing of PR `number` in `repo`; null when it cannot be read. */
export type CrossRepoLandingReader = (repo: string, number: number) => PrLanding | null;

/**
 * The unmet cross-repo dependencies of `issues`. Only the other repo's forge merged state
 * satisfies one; an unreadable PR (null or a throwing read) stays a blocker, never satisfied.
 */
export function crossRepoBlockers(issues: { number: number; body: string }[], read: CrossRepoLandingReader): CrossRepoBlocker[] {
  const blockers: CrossRepoBlocker[] = [];
  for (const issue of issues) {
    for (const dep of parseCrossRepoDepsFromBody(issue.body)) {
      let landing: PrLanding | null;
      try {
        landing = read(dep.repo, dep.number);
      } catch {
        landing = null;
      }
      if (landing?.state === 'merged') continue;
      blockers.push({ issue: issue.number, dep, state: landing ? landing.state : 'unreadable' });
    }
  }
  return blockers;
}

const BLOCKER_REASON: Record<CrossRepoDepState, string> = {
  open: 'not merged yet',
  'closed-unmerged': 'closed without merging',
  unreadable: 'merged state unreadable, treated as unmet',
};

/** The blocker text of one unmet dependency, as a "Merge next" item names it. */
export function crossRepoBlockerText(b: CrossRepoBlocker): string {
  return `waits on ${b.dep.repo}#${b.dep.number} (cross-repo, ${BLOCKER_REASON[b.state]})`;
}

function isDepLine(line: string): boolean {
  return DEP_LINE_RE.test(line.trim());
}

function isCanonicalDepLine(line: string): boolean {
  return /^Blocked by #\d+$/.test(line.trim());
}

function formatDepLine(issueNum: number): string {
  return `Blocked by #${issueNum}`;
}

function findDependenciesSection(lines: string[]): { start: number; end: number } | null {
  for (let i = 0; i < lines.length; i++) {
    if (/^##\s+dependencies\s*$/i.test(lines[i].trim())) {
      let end = lines.length;
      for (let j = i + 1; j < lines.length; j++) {
        if (/^##\s+/.test(lines[j])) {
          end = j;
          break;
        }
      }
      return { start: i, end };
    }
  }
  return null;
}

export function mergeDependsIntoBody(body: string, dependsOn: number[]): string {
  const targetDeps = [...new Set(dependsOn)].sort((a, b) => a - b);
  const existingDeps = [...parseDependsFromBody(body)].sort((a, b) => a - b);

  const depsUnchanged =
    targetDeps.length === existingDeps.length &&
    targetDeps.every((d, i) => d === existingDeps[i]);

  if (depsUnchanged) {
    const hasAlias = body.split('\n').some((line) => isDepLine(line) && !isCanonicalDepLine(line));
    if (!hasAlias) return body;
  }

  const lines = body.split('\n');
  const nonDepLines: string[] = [];
  for (const line of lines) {
    if (isDepLine(line)) continue;
    nonDepLines.push(line);
  }

  const depLines = targetDeps.map(formatDepLine);

  if (depLines.length === 0) {
    return trimTrailingBlankLines(nonDepLines).join('\n');
  }

  const section = findDependenciesSection(nonDepLines);

  if (section) {
    const before = nonDepLines.slice(0, section.start + 1);
    // Everything strictly between the header and the next section that isn't
    // a dependency line (already filtered out above) — freeform prose,
    // blank lines, etc. This must be preserved, not discarded (V-FIX-01: the
    // prior slice-and-replace approach silently dropped non-dep content).
    const preserved = nonDepLines.slice(section.start + 1, section.end);
    const after = nonDepLines.slice(section.end);
    const result = [...before, ...depLines, ...preserved, ...after];
    return trimTrailingBlankLines(result).join('\n');
  }

  const result = [...nonDepLines];
  if (result.length > 0 && result[result.length - 1] !== '') {
    result.push('');
  }
  result.push('## Dependencies', ...depLines);
  return trimTrailingBlankLines(result).join('\n');
}

function trimTrailingBlankLines(lines: string[]): string[] {
  const out = [...lines];
  while (out.length > 0 && out[out.length - 1] === '') {
    out.pop();
  }
  return out;
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on('data', (chunk) => chunks.push(chunk as Buffer));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    process.stdin.on('error', reject);
  });
}

function parseDepsArg(raw: string): number[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number)
    .filter((n) => !Number.isNaN(n));
}

if (import.meta.main) {
  const cmd = process.argv[2];

  if (cmd === 'merge-body') {
    let depsArg = '';
    for (let i = 3; i < process.argv.length; i++) {
      if (process.argv[i] === '--deps' && process.argv[i + 1]) {
        depsArg = process.argv[i + 1];
        break;
      }
    }

    const deps = parseDepsArg(depsArg);
    const body = await readStdin();
    const merged = mergeDependsIntoBody(body, deps);
    process.stdout.write(merged);
    if (!merged.endsWith('\n')) {
      process.stdout.write('\n');
    }
  } else {
    console.error('Usage: bun scripts/forge-deps.ts merge-body --deps 11,12 < body.md');
    process.exit(1);
  }
}
