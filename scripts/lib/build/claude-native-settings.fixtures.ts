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

/** A PATH holding only the tools the wrapper needs — deliberately no `jq`. */
export const pathWithoutJq = (binDir: string): string => {
  fs.mkdirSync(binDir, { recursive: true });
  for (const tool of ['bun', 'git', 'mktemp', 'date', 'tail', 'tr', 'mv', 'rm', 'mkdir', 'bash']) {
    const resolved = Bun.which(tool);
    if (!resolved) throw new Error(`test setup: ${tool} not found on PATH`);
    fs.symlinkSync(resolved, path.join(binDir, tool));
  }
  return binDir;
};
