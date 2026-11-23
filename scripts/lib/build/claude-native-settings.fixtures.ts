import { expect } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { readJsonFile } from '../fs.ts';
import { computeMergedSettings } from './claude-native-settings.ts';

// Shared helpers for running the generated `.claude/settings.json` PreToolUse wrapper command
// against a stub validator in a temp project dir.

export const bashCommand = (): string => {
  const merged = computeMergedSettings({}) as {
    hooks: { PreToolUse: { matcher: string; hooks: { command: string }[] }[] };
  };
  const entry = merged.hooks.PreToolUse.find((e) => e.matcher === 'Bash');
  if (!entry) throw new Error('test setup: no Bash matcher in computeMergedSettings({})');
  return entry.hooks[0].command;
};

export const initGitRepo = (projectDir: string): void => {
  Bun.spawnSync({ cmd: ['git', 'init', '--quiet'], cwd: projectDir });
  Bun.spawnSync({
    cmd: ['git', 'config', 'user.email', 'test@example.com'],
    cwd: projectDir,
  });
  Bun.spawnSync({ cmd: ['git', 'config', 'user.name', 'test'], cwd: projectDir });
  fs.writeFileSync(path.join(projectDir, 'README'), 'fixture\n');
  Bun.spawnSync({ cmd: ['git', 'add', 'README'], cwd: projectDir });
  Bun.spawnSync({ cmd: ['git', 'commit', '--quiet', '-m', 'init'], cwd: projectDir });
};

export const fileChangesCommand = (): string => {
  const merged = computeMergedSettings({}) as {
    hooks: { PreToolUse: { matcher: string; hooks: { command: string }[] }[] };
  };
  const entry = merged.hooks.PreToolUse.find((e) => e.matcher === 'Write|Edit');
  if (!entry) throw new Error('test setup: no Write|Edit matcher in computeMergedSettings({})');
  return entry.hooks[0].command;
};

export const runWrapperWithStubExit = (
  projectDir: string,
  stubExitCode: number,
  command: string = bashCommand(),
  stubScript = 'validate-bash-command.js',
  envOverride: Record<string, string> = {},
): { exitCode: number | null; stderr: string } => {
  initGitRepo(projectDir);
  const hooksDir = path.join(projectDir, '.claude', 'hooks');
  fs.mkdirSync(hooksDir, { recursive: true });
  fs.writeFileSync(
    path.join(hooksDir, stubScript),
    `process.exit(${stubExitCode});\n`,
  );
  const proc = Bun.spawnSync({
    cmd: ['bash', '-c', command],
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir, ...envOverride },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  return { exitCode: proc.exitCode, stderr: proc.stderr.toString() };
};

export const hookEventFiles = (projectDir: string): Record<string, unknown>[] => {
  const dir = path.join(projectDir, '.blackhole', 'hook-events');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .map((f) => readJsonFile(path.join(dir, f), 'hook-event record') as Record<string, unknown>);
};

export const assertFailOpenRecord = (
  dir: string,
  events: Record<string, unknown>[],
  hook: string,
  tool: string | null,
): void => {
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    tier: 'error',
    decision: 'allow',
    pattern_id: 'hook-exec-failure',
    hook,
    tool,
  });
  expect(events[0].worktree).toBe(fs.realpathSync(dir));
  expect(String(events[0].detail).length).toBeGreaterThan(0);
};

const isExecutableFile = (p: string): boolean => {
  try {
    if (!fs.statSync(p).isFile()) return false;
    fs.accessSync(p, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

const startsWithShebang = (p: string): boolean => {
  const fd = fs.openSync(p, 'r');
  try {
    const head = Buffer.alloc(2);
    return fs.readSync(fd, head, 0, 2, 0) === 2 && head.toString('latin1') === '#!';
  } finally {
    fs.closeSync(fd);
  }
};

/**
 * Resolve `tool` to the first self-contained executable on `searchPath`: a `#!` script is skipped
 * when a later candidate is not one, because a shim that re-dispatches by PATH lookup (e.g. a
 * hosted session's `rm` guard that execs "the next rm on PATH") cannot run once symlinked into an
 * isolated PATH holding no other copy. Falls back to the first executable hit.
 */
export const resolveSelfContained = (tool: string, searchPath: string = process.env.PATH ?? ''): string | null => {
  const candidates = searchPath
    .split(path.delimiter)
    .filter((d) => d.length > 0)
    .map((d) => path.join(d, tool))
    .filter(isExecutableFile);
  return candidates.find((c) => !startsWithShebang(c)) ?? candidates[0] ?? null;
};

/** A PATH holding only the tools the wrapper needs — deliberately no `jq`. */
export const pathWithoutJq = (binDir: string): string => {
  fs.mkdirSync(binDir, { recursive: true });
  for (const tool of ['bun', 'git', 'mktemp', 'date', 'tail', 'tr', 'mv', 'rm', 'mkdir', 'bash', 'cat', 'sleep']) {
    const resolved = resolveSelfContained(tool);
    if (!resolved) throw new Error(`test setup: ${tool} not found on PATH`);
    fs.symlinkSync(resolved, path.join(binDir, tool));
  }
  return binDir;
};
