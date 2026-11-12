import { afterAll, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildStatusReport } from './report.ts';
import { computeStatusAlerts, newestStateWrite, readStatusAlerts, STALE_AFTER_HOURS, stateAgeHours } from './staleness.ts';
import { loadCampaignState } from './state.ts';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const NOW = '2026-11-12T12:00:00.000Z';
const OLD = '2026-11-11T19:00:00.000Z'; // 17 h before NOW

describe('staleness helper', () => {
  test('the threshold is 2 hours', () => {
    expect(STALE_AFTER_HOURS).toBe(2);
  });

  test('newestStateWrite picks the latest parseable timestamp and ignores garbage', () => {
    expect(newestStateWrite('2026-11-11T10:00:00Z', '2026-11-12T01:00:00Z', 'nope', null)).toBe('2026-11-12T01:00:00Z');
    expect(newestStateWrite(undefined, 'nope')).toBeNull();
  });

  test('stateAgeHours rounds to one decimal and is null without a timestamp', () => {
    expect(stateAgeHours(OLD, NOW)).toBe(17);
    expect(stateAgeHours('2026-11-12T10:15:00.000Z', NOW)).toBe(1.8);
    expect(stateAgeHours(null, NOW)).toBeNull();
  });
});

describe('computeStatusAlerts', () => {
  const base = { checkpointRefreshedAt: OLD, queueRefreshedAt: null, nowIso: NOW, statusPageEnabled: true, artifactPublished: true, publishExpected: true };

  test('a 17 h-old checkpoint yields the stale alert naming the age and threshold', () => {
    const alerts = computeStatusAlerts(base);
    expect(alerts.map((a) => a.kind)).toEqual(['stale_state']);
    expect(alerts[0].message).toContain('17h ago');
    expect(alerts[0].message).toContain(`${STALE_AFTER_HOURS}h`);
  });

  test('a fresh checkpoint and a published page yield nothing', () => {
    expect(computeStatusAlerts({ ...base, checkpointRefreshedAt: '2026-11-12T11:30:00.000Z' })).toEqual([]);
  });

  test('the newer of checkpoint and queue decides staleness, same as the banner', () => {
    expect(computeStatusAlerts({ ...base, queueRefreshedAt: '2026-11-12T11:59:00.000Z' })).toEqual([]);
  });

  test('page enabled and never published yields the never-published alert; disabled yields nothing', () => {
    const fresh = { ...base, checkpointRefreshedAt: '2026-11-12T11:59:00.000Z', artifactPublished: false };
    expect(computeStatusAlerts(fresh).map((a) => a.kind)).toEqual(['page_never_published']);
    expect(computeStatusAlerts({ ...fresh, statusPageEnabled: false })).toEqual([]);
  });

  test('a harness that never publishes an artifact is not nagged', () => {
    const fresh = { ...base, checkpointRefreshedAt: '2026-11-12T11:59:00.000Z', artifactPublished: false, publishExpected: false };
    expect(computeStatusAlerts(fresh)).toEqual([]);
  });

  test('the never-published hint does not tell the owner to run the command that is already running', () => {
    const fresh = { ...base, checkpointRefreshedAt: '2026-11-12T11:59:00.000Z', artifactPublished: false };
    const msg = computeStatusAlerts(fresh)[0].message;
    expect(msg).not.toContain('bun run status');
    expect(msg).toContain('status-page.md');
  });

  test('no state write time at all is reported as stale, never silent', () => {
    const alerts = computeStatusAlerts({ ...base, checkpointRefreshedAt: null });
    expect(alerts[0].kind).toBe('stale_state');
    expect(alerts[0].message).toContain('no write time');
  });
});

describe('readStatusAlerts and the report against a campaign directory', () => {
  const dirs: string[] = [];
  function campaign(opts: { checkpointAt: string; artifact: boolean; statusPage?: boolean; host?: string }): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-stale-'));
    dirs.push(dir);
    const config = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'fixtures/config.example.json'), 'utf-8'));
    if (opts.statusPage !== undefined) config.status_page = { enabled: opts.statusPage };
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(config));
    const queue = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'fixtures/queue.example.json'), 'utf-8'));
    queue.refreshed_at = opts.checkpointAt;
    fs.writeFileSync(path.join(dir, 'queue.json'), JSON.stringify(queue));
    fs.copyFileSync(path.join(REPO_ROOT, 'fixtures/findings-ledger.example.json'), path.join(dir, 'findings-ledger.json'));
    fs.writeFileSync(
      path.join(dir, 'campaign-checkpoint.md'),
      `---\nrefreshed_at: ${opts.checkpointAt}\norchestrator_turn_id: 4\n---\n\n## Notes\n\nx\n`,
    );
    if (opts.host) fs.writeFileSync(path.join(dir, 'run-context.json'), JSON.stringify({ context: { host: { value: opts.host } } }));
    if (opts.artifact) fs.writeFileSync(path.join(dir, 'status-artifact.json'), '{"url":"https://claude.ai/artifact/x","created_at":"2026-11-01T00:00:00Z"}');
    return dir;
  }
  afterAll(() => {
    for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
  });

  test('17 h-old checkpoint: the helper and --json both expose the stale line; schema_version unchanged', () => {
    const dir = campaign({ checkpointAt: OLD, artifact: true, host: 'claude' });
    const state = loadCampaignState(dir);
    expect(readStatusAlerts(dir, state, NOW).map((a) => a.kind)).toEqual(['stale_state']);
    const report = buildStatusReport({
      ...state,
      forge: { openIssues: 0, openPrs: 0, ok: true },
      paceLine: null,
      hostNotes: [],
      generatedAt: NOW,
      publish: { artifactPublished: true, publishExpected: true },
    });
    expect(report.schema_version).toBe(1);
    expect(report.alerts.map((a) => a.kind)).toEqual(['stale_state']);
    expect(report.state.kind).toBe('stale');
  });

  test('no status-artifact.json on Claude Code with the page enabled (the default) gives the never-published alert', () => {
    const dir = campaign({ checkpointAt: '2026-11-12T11:59:00.000Z', artifact: false, host: 'claude' });
    expect(readStatusAlerts(dir, loadCampaignState(dir), NOW).map((a) => a.kind)).toEqual(['page_never_published']);
  });

  test('no never-published alert on a non-Claude host or when the host is unknown', () => {
    for (const host of ['cursor', undefined]) {
      const dir = campaign({ checkpointAt: '2026-11-12T11:59:00.000Z', artifact: false, host });
      expect(readStatusAlerts(dir, loadCampaignState(dir), NOW)).toEqual([]);
    }
  });

  test('page disabled in config: nothing, even without the artifact file', () => {
    const dir = campaign({ checkpointAt: '2026-11-12T11:59:00.000Z', artifact: false, statusPage: false, host: 'claude' });
    expect(readStatusAlerts(dir, loadCampaignState(dir), NOW)).toEqual([]);
  });

  describe('the CLI output contract', () => {
    const run = (dir: string, ...args: string[]) => {
      const r = Bun.spawnSync(['bun', 'run', path.join(REPO_ROOT, 'scripts/campaign-status.ts'), '--campaign-dir', dir, '--no-gh', ...args], {
        cwd: dir,
      });
      return { out: r.stdout.toString(), err: r.stderr.toString() };
    };

    test('text dashboard prints the alert lines on stdout, before the dashboard', () => {
      const dir = campaign({ checkpointAt: OLD, artifact: false, host: 'claude' });
      const { out } = run(dir);
      expect(out).toContain('Campaign state last written');
      expect(out).toContain('Status page never published');
      expect(out.indexOf('Campaign state last written')).toBeLessThan(out.indexOf('Queue'));
    });

    test('--html keeps stdout to the page path and sends the alerts to stderr', () => {
      const dir = campaign({ checkpointAt: OLD, artifact: false, host: 'claude' });
      const target = path.join(dir, 'page.html');
      const { out, err } = run(dir, '--html', '--out', target);
      expect(out.trim()).toBe(target);
      expect(err).toContain('Campaign state last written');
      expect(err).toContain('Status page never published');
      expect(fs.existsSync(target)).toBe(true);
    });

    test('--json keeps stdout parseable and exposes the alerts', () => {
      const dir = campaign({ checkpointAt: OLD, artifact: false, host: 'claude' });
      const { out } = run(dir, '--json');
      const parsed = JSON.parse(out);
      expect(parsed.alerts.map((a: { kind: string }) => a.kind)).toEqual(['stale_state', 'page_never_published']);
      expect(parsed.schema_version).toBe(1);
    });
  });
});
