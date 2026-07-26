import * as fs from 'fs';
import * as path from 'path';
import { PHASE_NAMES, PHASE_PLAYBOOK_FILES } from '../build.ts';
import { walkMdFilesAbs } from './links.check.ts';

// ADR-007 T5/R2' — playbook.check.ts: cross-cutting playbook/harness self-consistency checks
// (split from the former catch-all check file, issue #322). Phase names referenced consistently, V-codes
// referenced somewhere, in-flight queue issues have plan artifacts, SKILL.md modes match phase
// playbooks, claude-code-native.md stays harness-neutral above its appendix — grouped because
// each independently verifies "the harness's own playbook machinery says what it does".

const root = path.resolve(import.meta.dirname, '..', '..');
const srcDir = path.join(root, 'src');

export type CheckResult = { id: string; ok: boolean; detail?: string };

const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf-8');

// V-PHASE-01: Phase playbooks reference consistent phase names
const checkPhaseNames = (): CheckResult => {
  const missing: string[] = [];

  for (const pb of PHASE_PLAYBOOK_FILES) {
    const content = read(`src/references/${pb}`);
    const hits = PHASE_NAMES.filter((p) => content.includes(p));
    if (hits.length === 0) missing.push(`${pb}: no phase name references`);
  }

  const queueDag = read('src/references/queue-dag.md');
  for (const p of PHASE_NAMES) {
    if (!queueDag.includes(`\`${p}\``)) missing.push(`queue-dag.md: missing phase ${p}`);
  }

  if (missing.length) return { id: 'V-PHASE-01', ok: false, detail: missing.join('; ') };
  return { id: 'V-PHASE-01', ok: true };
};

// V-VCODE-01: V-codes referenced in agents or phases
const checkVcodeReferences = (): CheckResult => {
  const vcodesContent = read('src/references/blackhole-vcodes.md');
  const codeMatches = [...vcodesContent.matchAll(/\| (V-[A-Z]+-\d+)/g)];
  const codes = new Set(codeMatches.map((m) => m[1]));

  const refDir = path.join(srcDir, 'references');
  const agentDir = path.join(srcDir, 'agents');
  const corpus = [
    ...walkMdFilesAbs(refDir).map((f) => fs.readFileSync(f, 'utf-8')),
    ...walkMdFilesAbs(agentDir).map((f) => fs.readFileSync(f, 'utf-8')),
  ].join('\n');

  const unreferenced: string[] = [];
  for (const code of codes) {
    if (!corpus.includes(code)) unreferenced.push(code);
  }

  if (unreferenced.length > codes.size * 0.5) {
    return { id: 'V-VCODE-01', ok: false, detail: `Many unreferenced codes: ${unreferenced.slice(0, 5).join(', ')}...` };
  }
  return { id: 'V-VCODE-01', ok: true };
};

const PLAN_REQUIRED_PHASES = new Set(['plan', 'implement', 'review']);

const parseCampaignDirArg = (): string | null => {
  const argv = process.argv.slice(2);
  const idx = argv.indexOf('--campaign-dir');
  if (idx === -1 || idx + 1 >= argv.length) return null;
  return argv[idx + 1];
};

const resolveCampaignPaths = () => {
  const campaignDirArg = parseCampaignDirArg();
  const campaignDir = campaignDirArg
    ? path.resolve(campaignDirArg)
    : path.join(root, 'fixtures');
  const queueFile = campaignDirArg
    ? path.join(campaignDir, 'queue.json')
    : path.join(campaignDir, 'queue.example.json');
  return { campaignDir, queueFile };
};

// V-PLAN-01: In-flight plan/implement/review entries require plans/issue-N.md
const checkPlanArtifacts = (): CheckResult => {
  const { campaignDir, queueFile } = resolveCampaignPaths();

  if (!fs.existsSync(queueFile)) {
    return { id: 'V-PLAN-01', ok: true };
  }

  let queue: { issues?: Record<string, { phase?: string; status?: string }> };
  try {
    queue = JSON.parse(fs.readFileSync(queueFile, 'utf-8'));
  } catch {
    return { id: 'V-PLAN-01', ok: false, detail: `${path.relative(root, queueFile)}: invalid JSON` };
  }

  if (!queue.issues || typeof queue.issues !== 'object') {
    return { id: 'V-PLAN-01', ok: true };
  }

  const errors: string[] = [];
  for (const [id, issue] of Object.entries(queue.issues)) {
    if (!issue || typeof issue !== 'object') continue;
    if (issue.status !== 'in-flight') continue;
    if (!issue.phase || !PLAN_REQUIRED_PHASES.has(issue.phase)) continue;

    const planPath = path.join(campaignDir, 'plans', `issue-${id}.md`);
    if (!fs.existsSync(planPath)) {
      errors.push(`issue #${id} (${issue.phase}): missing ${path.relative(root, planPath)}`);
    }
  }

  if (errors.length) return { id: 'V-PLAN-01', ok: false, detail: errors.join('; ') };
  return { id: 'V-PLAN-01', ok: true };
};

// V-SKILL-01: SKILL.md modes match phase playbooks
const checkSkillModes = (): CheckResult => {
  const skill = read('src/SKILL.md');
  const required = ['run', 'status', 'handle', 'plan', 'implement', 'review', 'campaign-audit'];
  const missing = required.filter((m) => !skill.includes(m));

  const phaseFiles = ['phase-handle', 'phase-plan', 'phase-implement', 'phase-review', 'phase-loop'];
  const missingPhases = phaseFiles.filter((p) => !skill.includes(p));

  if (missing.length || missingPhases.length) {
    return {
      id: 'V-SKILL-01',
      ok: false,
      detail: `missing modes: ${missing.join(', ')}; missing phase refs: ${missingPhases.join(', ')}`,
    };
  }
  return { id: 'V-SKILL-01', ok: true };
};

// V-HARNESS-01: claude-code-native.md core stays harness-neutral (no tool tokens outside the
// per-harness mapping appendix). The appendix (marked by APPENDIX_MARKER) and everything after it
// are where harness-specific primitive names belong; the core sections above the marker must stay
// generic so non-Claude harnesses reading this doc aren't confronted with Claude-only vocabulary.
export const HARNESS_TOKENS = [
  'Workflow tool',
  'AskUserQuestion',
  'pipeline(',
  'parallel(',
  'resumeFromRunId',
  'subagentStop',
];

export const APPENDIX_MARKER = '## Per-harness mapping appendix';

export const findHarnessTokenLeaks = (content: string, tokens: string[] = HARNESS_TOKENS): string[] => {
  const markerIndex = content.indexOf(APPENDIX_MARKER);
  const core = markerIndex === -1 ? content : content.slice(0, markerIndex);

  const leaks: string[] = [];
  for (const line of core.split('\n')) {
    for (const token of tokens) {
      if (line.includes(token)) leaks.push(`${token}@${line.trim()}`);
    }
  }
  return leaks;
};

const checkClaudeCodeNativeNeutrality = (): CheckResult => {
  const content = read('src/references/claude-code-native.md');
  const leaks = findHarnessTokenLeaks(content);

  if (leaks.length) return { id: 'V-HARNESS-01', ok: false, detail: `harness token leak(s) before appendix: ${leaks.join('; ')}` };
  return { id: 'V-HARNESS-01', ok: true };
};

// ADR-007 T5/R2': domain entrypoint — see agents.check.ts's runChecks doc comment for the shared
// contract (pure, no side effects, glob-discovered by scripts/verify.ts).
export const runChecks = (): CheckResult[] => [
  checkPhaseNames(),
  checkVcodeReferences(),
  checkPlanArtifacts(),
  checkSkillModes(),
  checkClaudeCodeNativeNeutrality(),
];
