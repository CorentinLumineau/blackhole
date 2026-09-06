import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { root, type CheckResult } from './check-utils.ts';

// control-char.check.ts: V-CTRLCHAR-01 — closes the gap that let PR #944 ship a `.ts` file with
// a literal NUL byte used as a Map-key delimiter. The byte made the whole file binary, invisible
// to `gh pr diff`/GitHub's web diff, and every automated signal (tests, CI, `bun run verify`)
// stayed green. Scope is the file-level byte class only: NUL and the always-illegal C0 control
// range (0x00-0x08, 0x0B, 0x0C, 0x0E-0x1F), excluding tab/newline/CR. Position-sensitive
// control-character legality (e.g. a newline illegal only inside a markdown table cell) is
// #940's job, not this check's.
//
// Design Decision D1 (.blackhole/plans/issue-945.md): binary-asset exemption uses
// `.gitattributes`' `binary` attribute via `git check-attr`, never git's own live per-file
// binary heuristic (`git diff --numstat` / `git grep -I`) — that heuristic reports a real binary
// asset and a NUL-corrupted text file identically, because a NUL byte near the start of the
// buffer is precisely what makes git call a file binary. Excluding on that heuristic would
// silently exempt the exact PR #944 shape this check exists to catch.
//
// Design Decision D2: raw-byte scanning (`fs.readFileSync(path)`, no encoding argument) — never
// decoded-string scanning, which would silently replace an invalid multi-byte sequence elsewhere
// in the file with U+FFFD rather than surfacing it.

// git ls-files / git check-attr output for this repo's tracked-file count is well under a
// megabyte; this ceiling only guards against a pathological future tree, mirroring the DoS
// mitigation in the Threat Model (a hang/crash from an oversized subprocess buffer, not from
// per-file content).
const GIT_SPAWN_MAX_BUFFER = 200 * 1024 * 1024;

export const listTrackedFiles = (repoRoot: string = root): string[] => {
  const result = spawnSync('git', ['ls-files', '-z'], {
    cwd: repoRoot,
    encoding: 'utf-8',
    maxBuffer: GIT_SPAWN_MAX_BUFFER,
  });
  if (result.status !== 0) {
    throw new Error(`git ls-files failed in ${repoRoot}: ${result.stderr}`);
  }
  return result.stdout.split('\0').filter((p) => p.length > 0);
};

// `git check-attr --stdin -z binary` emits NUL-delimited `<path>\0<attrname>\0<value>\0` triples
// for every path fed on stdin (also NUL-delimited under `-z`) — verified empirically against a
// scratch repo during planning (Design Decision D1). Only `value === 'set'` is a deliberate,
// diff-visible exemption; `unspecified`/`unset` are not.
export const findGitAttributeExemptions = (repoRoot: string, paths: string[]): Set<string> => {
  const exempted = new Set<string>();
  if (paths.length === 0) return exempted;

  const input = paths.map((p) => `${p}\0`).join('');
  const result = spawnSync('git', ['check-attr', '--stdin', '-z', 'binary'], {
    cwd: repoRoot,
    encoding: 'utf-8',
    input,
    maxBuffer: GIT_SPAWN_MAX_BUFFER,
  });
  if (result.status !== 0) {
    throw new Error(`git check-attr failed in ${repoRoot}: ${result.stderr}`);
  }

  const fields = result.stdout.split('\0');
  for (let i = 0; i + 2 < fields.length; i += 3) {
    const [filePath, , value] = [fields[i], fields[i + 1], fields[i + 2]];
    if (value === 'set') exempted.add(filePath);
  }
  return exempted;
};

const isDisallowedControlByte = (byte: number): boolean =>
  (byte >= 0x00 && byte <= 0x08) || byte === 0x0b || byte === 0x0c || (byte >= 0x0e && byte <= 0x1f);

export type ControlCharHit = { line: number; byte: number };

export const scanBufferForControlChars = (buf: Buffer): ControlCharHit[] => {
  const hits: ControlCharHit[] = [];
  let line = 1;
  for (let i = 0; i < buf.length; i++) {
    const byte = buf[i];
    if (byte === 0x0a) {
      line++;
      continue;
    }
    if (isDisallowedControlByte(byte)) hits.push({ line, byte });
  }
  return hits;
};

export type ControlCharViolation = { file: string; line: number; byte: number };

export const findControlCharViolations = (repoRoot: string = root): ControlCharViolation[] => {
  const tracked = listTrackedFiles(repoRoot);
  const exempted = findGitAttributeExemptions(repoRoot, tracked);
  const violations: ControlCharViolation[] = [];

  for (const relPath of tracked) {
    if (exempted.has(relPath)) continue;

    let buf: Buffer;
    try {
      buf = fs.readFileSync(path.join(repoRoot, relPath));
    } catch {
      // DoS mitigation (Threat Model): a dangling symlink, submodule gitlink, or other
      // anomalous tracked path is skipped rather than failing the whole check.
      continue;
    }

    for (const hit of scanBufferForControlChars(buf)) {
      violations.push({ file: relPath, line: hit.line, byte: hit.byte });
    }
  }

  return violations;
};

const formatViolation = (v: ControlCharViolation): string =>
  `${v.file}:${v.line} (0x${v.byte.toString(16).padStart(2, '0')})`;

const checkControlChar = (): CheckResult => {
  const violations = findControlCharViolations(root);
  if (violations.length === 0) return { id: 'V-CTRLCHAR-01', ok: true };

  const shown = violations.slice(0, 10).map(formatViolation).join(', ');
  const more = violations.length > 10 ? ` (+${violations.length - 10} more)` : '';
  return { id: 'V-CTRLCHAR-01', ok: false, detail: `${shown}${more}` };
};

// ADR-007 T5/R2': domain entrypoint — see adr-status.check.ts's runChecks doc comment for the
// shared contract (pure, no side effects, glob-discovered by scripts/verify.ts).
export const runChecks = (): CheckResult[] => [checkControlChar()];
