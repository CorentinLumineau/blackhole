import { createGitHubAdapter } from './lib/forge-adapter/index.ts';

export type GhStep = {
  name: string;
  conclusion: string | null;
  number: number;
};

export type GhJob = {
  id: number;
  name: string;
  conclusion: string | null;
  run_id: number;
  steps?: GhStep[];
};

export type FailingJob = {
  id: number;
  name: string;
  conclusion: string;
  workflowName: string;
  runId: number;
};

export type StepLog = {
  jobId: number;
  jobName: string;
  stepName: string;
  log: string;
};

export type DiagnosisResult = {
  classification: 'genuine' | 'environment';
  failing_jobs: FailingJob[];
  step_logs: StepLog[];
  run_ids: number[];
};

export type GhRunner = {
  getPrHeadSha: (pr: number, repo: string) => Promise<string>;
  listWorkflowRuns: (sha: string, repo: string) => Promise<
    { id: number; name: string; head_sha: string; conclusion: string | null }[]
  >;
  listJobs: (runId: number, repo: string) => Promise<GhJob[]>;
  getJobLog: (jobId: number, repo: string) => Promise<string>;
  getFailedRunLog: (runId: number, repo: string) => Promise<string>;
};

export const ENVIRONMENT_PATTERNS: { id: string; pattern: RegExp }[] = [
  { id: 'disk-oom', pattern: /no space left on device|ENOMEM|out of memory|\bOOM\b/i },
  {
    id: 'network-timeout',
    pattern: /ETIMEDOUT|ECONNRESET|registry timeout|network timeout|i\/o timeout/i,
  },
  {
    id: 'runner-setup',
    pattern: /Error setting up runner|runner .+ not found|setup-node.*failed|npm ERR! code/i,
  },
];

const LOG_FALLBACK_TAIL = 200;

export function isVercelPreviewCheck(name: string): boolean {
  return /^Vercel/i.test(name);
}

export function passesContextCheck(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (/^(#|\/\/)/.test(trimmed)) return false;
  if (/^(example|fixture):/i.test(trimmed)) return false;
  if (/^\s*["'`].*["'`]\s*$/.test(trimmed)) return false;
  return true;
}

export function pickFailedStep(steps: GhStep[]): GhStep | null {
  const failed = steps.filter((step) => step.conclusion === 'failure');
  if (failed.length === 0) return null;
  return failed[0];
}

export function isolateStepLog(fullLog: string, stepName: string): string {
  const groupStart = `##[group]${stepName}`;
  const altGroupStart = `##[group]Run ${stepName}`;
  const lines = fullLog.split('\n');
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.includes(groupStart) || line.includes(altGroupStart) || line.includes(stepName)) {
      if (line.includes('##[group]')) {
        start = i + 1;
        break;
      }
    }
  }

  if (start >= 0) {
    const chunk: string[] = [];
    for (let i = start; i < lines.length; i += 1) {
      if (lines[i].includes('##[endgroup]')) break;
      chunk.push(lines[i]);
    }
    if (chunk.length > 0) {
      return chunk.join('\n').trim();
    }
  }

  const tail = lines.slice(-LOG_FALLBACK_TAIL);
  return tail.join('\n').trim();
}

export function listFailingJobs(jobs: GhJob[]): GhJob[] {
  return jobs.filter(
    (job) => job.conclusion === 'failure' && !isVercelPreviewCheck(job.name),
  );
}

export function classifyStepLogs(stepLogs: StepLog[]): 'genuine' | 'environment' {
  for (const step of stepLogs) {
    for (const line of step.log.split('\n')) {
      if (!passesContextCheck(line)) continue;
      for (const { pattern } of ENVIRONMENT_PATTERNS) {
        if (pattern.test(line)) return 'environment';
      }
    }
  }
  return 'genuine';
}

export function createGhRunner(repo?: string): GhRunner {
  const adapter = createGitHubAdapter(repo ?? '');
  return {
    async getPrHeadSha(pr, repoName) {
      const gh = repoName ? createGitHubAdapter(repoName) : adapter;
      return gh.getPrHeadSha(pr);
    },
    async listWorkflowRuns(sha, repoName) {
      const gh = repoName ? createGitHubAdapter(repoName) : adapter;
      return gh.listWorkflowRuns(sha);
    },
    async listJobs(runId, repoName) {
      const gh = repoName ? createGitHubAdapter(repoName) : adapter;
      return gh.listWorkflowJobs(runId);
    },
    async getJobLog(jobId, repoName) {
      const gh = repoName ? createGitHubAdapter(repoName) : adapter;
      return gh.getJobLog(jobId);
    },
    async getFailedRunLog(runId, repoName) {
      const gh = repoName ? createGitHubAdapter(repoName) : adapter;
      return gh.getFailedRunLog(runId);
    },
  };
}

async function fetchStepLog(
  job: GhJob,
  repo: string,
  runner: GhRunner,
  notes: string[],
): Promise<StepLog | null> {
  const failedStep = pickFailedStep(job.steps ?? []);
  const stepName = failedStep?.name ?? job.name;

  try {
    const fullLog = await runner.getJobLog(job.id, repo);
    const isolated = isolateStepLog(fullLog, stepName);
    if (isolated) {
      return { jobId: job.id, jobName: job.name, stepName, log: isolated };
    }
  } catch {
    // fall through to run-level failed log
  }

  notes.push(
    `step-log fallback: using gh run view --log-failed for job ${job.id} (${job.name})`,
  );
  const fallbackLog = await runner.getFailedRunLog(job.run_id, repo);
  const lines = fallbackLog.split('\n').slice(-LOG_FALLBACK_TAIL);
  return {
    jobId: job.id,
    jobName: job.name,
    stepName,
    log: lines.join('\n').trim(),
  };
}

export async function diagnoseCi(
  pr: number,
  repo: string,
  runner: GhRunner = createGhRunner(),
): Promise<DiagnosisResult> {
  const notes: string[] = [];
  const headSha = await runner.getPrHeadSha(pr, repo);
  const runs = await runner.listWorkflowRuns(headSha, repo);
  const failedRuns = runs.filter((run) => run.conclusion === 'failure');
  const runIds = [...new Set(failedRuns.map((run) => run.id))];

  const failingJobs: FailingJob[] = [];
  const stepLogs: StepLog[] = [];

  for (const run of failedRuns) {
    const jobs = await runner.listJobs(run.id, repo);
    for (const job of listFailingJobs(jobs)) {
      failingJobs.push({
        id: job.id,
        name: job.name,
        conclusion: job.conclusion ?? 'failure',
        workflowName: run.name,
        runId: run.id,
      });
      const stepLog = await fetchStepLog(job, repo, runner, notes);
      if (stepLog) stepLogs.push(stepLog);
    }
  }

  if (notes.length > 0) {
    for (const note of notes) {
      console.error(note);
    }
  }

  return {
    classification: classifyStepLogs(stepLogs),
    failing_jobs: failingJobs,
    step_logs: stepLogs,
    run_ids: runIds,
  };
}

function parseArgs(argv: string[]): { pr: number; repo: string } {
  let pr: number | null = null;
  let repo = '';

  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--pr' && argv[i + 1]) {
      pr = Number(argv[i + 1]);
      i += 1;
    } else if (argv[i] === '--repo' && argv[i + 1]) {
      repo = argv[i + 1];
      i += 1;
    }
  }

  if (!pr || Number.isNaN(pr)) {
    console.error('Usage: bun run scripts/ci-diagnosis.ts --pr <n> [--repo owner/name]');
    process.exit(1);
  }

  if (!repo) {
    try {
      repo = createGitHubAdapter('').resolveDefaultRepo();
    } catch {
      console.error('Could not resolve default repo; pass --repo owner/name');
      process.exit(1);
    }
  }

  return { pr, repo };
}

async function main() {
  const { pr, repo } = parseArgs(process.argv.slice(2));
  const result = await diagnoseCi(pr, repo);
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  });
}
