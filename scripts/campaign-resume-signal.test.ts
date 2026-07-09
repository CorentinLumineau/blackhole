import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  buildDedupeKey,
  checkpointInFlightWorkersNonEmpty,
  checkpointReadySetNonEmpty,
  detectStaleBarrier,
  DOORBELL_MESSAGE,
  evaluateResumeHook,
  hasUserGate,
  hasWorkRemaining,
  mergeResumeRequest,
  resolveCampaignAgent,
  writeResumeRequestAtomic,
  type ResumeRequest,
} from './campaign-resume-signal';

const root = path.resolve(import.meta.dirname, '..');
const fixturesDir = path.join(root, 'fixtures/resume-signal');

const readFixture = (name: string) =>
  JSON.parse(fs.readFileSync(path.join(fixturesDir, name), 'utf-8'));

const readTextFixture = (name: string) =>
  fs.readFileSync(path.join(fixturesDir, name), 'utf-8');

describe('resolveCampaignAgent', () => {
  test('resolves orchestrator from subagent_type', () => {
    expect(resolveCampaignAgent({ subagent_type: 'orchestrator' })).toBe('orchestrator');
  });

  test('resolves worker from description fallback', () => {
    expect(resolveCampaignAgent({ description: 'blackhole implementer for #154' })).toBe(
      'implementer',
    );
  });

  test('returns null for non-campaign agents', () => {
    expect(resolveCampaignAgent({ subagent_type: 'generalPurpose' })).toBeNull();
  });
});

describe('resume gates', () => {
  test('detects user gate from awaiting-plan notes', () => {
    const queue = readFixture('queue-user-blocked.json');
    expect(hasUserGate(queue.issues)).toBe(true);
  });

  test('work remains from ready issues', () => {
    const queue = readFixture('queue-work-remaining.json');
    expect(hasWorkRemaining(queue)).toBe(true);
  });

  test('work remains from checkpoint ready set', () => {
    const checkpoint = readTextFixture('checkpoint-with-work.md');
    expect(checkpointReadySetNonEmpty(checkpoint)).toBe(true);
    expect(hasWorkRemaining({ issues: {} }, checkpoint)).toBe(true);
  });

  test('detects non-empty in-flight workers section', () => {
    const checkpoint = readTextFixture('checkpoint-stale-barrier.md');
    expect(checkpointInFlightWorkersNonEmpty(checkpoint)).toBe(true);
  });
});

describe('detectStaleBarrier', () => {
  test('true when checkpoint lists workers and router JSON validates', () => {
    const input = readFixture('hook-worker-stop.json');
    const checkpoint = readTextFixture('checkpoint-stale-barrier.md');
    expect(detectStaleBarrier(input, 'router', checkpoint)).toBe(true);
  });
});

describe('mergeResumeRequest', () => {
  test('dedupes within coalesce window for same dedupe_key', () => {
    const now = new Date('2026-07-09T12:00:00.000Z');
    const existing: ResumeRequest = {
      version: 1,
      requested_at: '2026-07-09T11:59:55.000Z',
      reason: 'orchestrator_turn_complete',
      target: 'coordinator',
      dedupe_key: 'turn-12',
      coalesce_until: '2026-07-09T12:00:05.000Z',
      stopping_agent: 'orchestrator',
      queue_refreshed_at: '2026-07-09T11:59:00.000Z',
      orchestrator_turn_id: 12,
    };
    const next: ResumeRequest = {
      ...existing,
      requested_at: '2026-07-09T12:00:00.000Z',
      coalesce_until: '2026-07-09T12:00:05.000Z',
    };
    const merged = mergeResumeRequest(existing, next, now);
    expect(merged.requested_at).toBe('2026-07-09T12:00:00.000Z');
    expect(merged.dedupe_key).toBe('turn-12');
  });
});

describe('buildDedupeKey', () => {
  test('uses turn id for orchestrator complete', () => {
    expect(buildDedupeKey('orchestrator_turn_complete', 12, { issues: {} })).toBe('turn-12');
  });

  test('uses stale-wave hash for stale barrier', () => {
    const key = buildDedupeKey('stale_barrier', 12, { issues: { '301': {}, '275': {} } });
    expect(key).toMatch(/^stale-wave-12-[0-9a-f]{8}$/);
  });
});

describe('evaluateResumeHook integration', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'resume-signal-'));
    fs.writeFileSync(
      path.join(tmpDir, 'queue.json'),
      JSON.stringify(readFixture('queue-work-remaining.json'), null, 2),
    );
    fs.writeFileSync(path.join(tmpDir, 'campaign-checkpoint.md'), readTextFixture('checkpoint-with-work.md'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('orchestrator stop writes file and requests doorbell', () => {
    const input = readFixture('hook-orchestrator-stop.json');
    const result = evaluateResumeHook(input, tmpDir, new Date('2026-07-09T12:00:00.000Z'));
    expect(result.action).toBe('file_and_doorbell');
    expect(fs.existsSync(path.join(tmpDir, 'resume-request.json'))).toBe(true);
    const record = JSON.parse(fs.readFileSync(path.join(tmpDir, 'resume-request.json'), 'utf-8'));
    expect(record.target).toBe('coordinator');
    expect(record.reason).toBe('orchestrator_turn_complete');
    expect(record.dedupe_key).toBe('turn-12');
  });

  test('user-blocked queue produces no resume', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'queue.json'),
      JSON.stringify(readFixture('queue-user-blocked.json'), null, 2),
    );
    const input = readFixture('hook-orchestrator-stop.json');
    const result = evaluateResumeHook(input, tmpDir);
    expect(result.action).toBe('none');
    expect(fs.existsSync(path.join(tmpDir, 'resume-request.json'))).toBe(false);
  });

  test('worker stale barrier writes file only', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'campaign-checkpoint.md'),
      readTextFixture('checkpoint-stale-barrier.md'),
    );
    const input = readFixture('hook-worker-stop.json');
    const result = evaluateResumeHook(input, tmpDir, new Date('2026-07-09T12:00:00.000Z'));
    expect(result.action).toBe('file_only');
    const record = JSON.parse(fs.readFileSync(path.join(tmpDir, 'resume-request.json'), 'utf-8'));
    expect(record.reason).toBe('stale_barrier');
    expect(record.stopping_agent).toBe('router');
  });

  test('worker stop with ready work but no in-flight workers produces no resume', () => {
    const input = readFixture('hook-worker-stop.json');
    const result = evaluateResumeHook(input, tmpDir, new Date('2026-07-09T12:00:00.000Z'));
    expect(result.action).toBe('none');
    expect(fs.existsSync(path.join(tmpDir, 'resume-request.json'))).toBe(false);
  });

  test('error status pass-through', () => {
    const input = { ...readFixture('hook-orchestrator-stop.json'), status: 'error' };
    const result = evaluateResumeHook(input, tmpDir);
    expect(result.action).toBe('none');
  });

  test('atomic write leaves no tmp file', () => {
    const record: ResumeRequest = {
      version: 1,
      requested_at: '2026-07-09T12:00:00.000Z',
      reason: 'orchestrator_turn_complete',
      target: 'coordinator',
      dedupe_key: 'turn-1',
      coalesce_until: '2026-07-09T12:00:05.000Z',
      stopping_agent: 'orchestrator',
      queue_refreshed_at: '2026-07-09T11:59:00.000Z',
      orchestrator_turn_id: 1,
    };
    writeResumeRequestAtomic(tmpDir, record);
    expect(fs.existsSync(path.join(tmpDir, 'resume-request.json'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'resume-request.json.tmp'))).toBe(false);
  });
});

describe('DOORBELL_MESSAGE', () => {
  test('mentions resume-request.json and coordinator flow', () => {
    expect(DOORBELL_MESSAGE).toContain('resume-request.json');
    expect(DOORBELL_MESSAGE).toContain('bun run status');
  });
});

describe('runHook CLI fail-open', () => {
  const scriptPath = path.join(root, 'scripts/campaign-resume-signal.ts');

  async function runHookCli(stdin: string, campaignDir: string) {
    const proc = Bun.spawn({
      cmd: ['bun', 'run', scriptPath, '--hook', '--campaign-dir', campaignDir],
      stdin: new Blob([stdin]),
      stdout: 'pipe',
      stderr: 'pipe',
      cwd: root,
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    return { exitCode, stdout, stderr };
  }

  function assertFailOpen(
    result: { exitCode: number; stdout: string; stderr: string },
    campaignDir: string,
  ) {
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('');
    expect(result.stdout).not.toContain('followup_message');
    expect(fs.existsSync(path.join(campaignDir, 'resume-request.json'))).toBe(false);
  }

  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'resume-hook-cli-'));
  });

  afterEach(() => {
    fs.chmodSync(tmpDir, 0o700);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('malformed stdin JSON exits 0 without doorbell or resume-request.json', async () => {
    const result = await runHookCli('{not json', tmpDir);
    assertFailOpen(result, tmpDir);
    expect(result.stderr).toContain('stdin JSON parse failed');
  });

  test('empty stdin exits 0 without doorbell or resume-request.json', async () => {
    const result = await runHookCli('', tmpDir);
    assertFailOpen(result, tmpDir);
  });

  test('top-level catch exits 0 without doorbell or resume-request.json', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'queue.json'),
      JSON.stringify(readFixture('queue-work-remaining.json'), null, 2),
    );
    fs.writeFileSync(
      path.join(tmpDir, 'campaign-checkpoint.md'),
      readTextFixture('checkpoint-with-work.md'),
    );
    fs.chmodSync(tmpDir, 0o555);

    const hookInput = JSON.stringify(readFixture('hook-orchestrator-stop.json'));
    const result = await runHookCli(hookInput, tmpDir);
    assertFailOpen(result, tmpDir);
    expect(result.stderr).toContain('resume hook error:');
  });
});
