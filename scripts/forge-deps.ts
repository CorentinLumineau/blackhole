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
