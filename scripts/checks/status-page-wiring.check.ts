import { read, type CheckResult } from './check-utils.ts';

// V-STATUSPAGE-01: every section a `run` actually walks cites status-page.md.
//
// The refresh procedure lives in one file. An agent follows the sections it is routed through,
// not the files that happen to exist, so a duty stated only in status-page.md is a duty no run
// reaches. A citation elsewhere in the same document does not count: SKILL.md's Modes table has
// always cited the page for `status` mode while Phase 0 and the run-mode turn end did not.

export type StatusPageWiringDocs = {
  skill: string;
  coordinator: string;
  native: string;
  statusPage: string;
};

const CITATION = 'status-page.md';

// The section starting at the first heading that begins with `heading`, up to the next heading
// of the same or a higher level. Empty when the heading is absent.
export const sectionOf = (doc: string, heading: string): string => {
  const level = heading.match(/^#+/)?.[0].length ?? 0;
  const lines = doc.split('\n');
  const start = lines.findIndex((line) => line.startsWith(heading));
  if (start === -1 || level === 0) return '';
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => {
    const hashes = line.match(/^(#+) /)?.[1].length ?? 0;
    return hashes > 0 && hashes <= level;
  });
  const body = end === -1 ? rest : rest.slice(0, end);
  return [lines[start], ...body, ''].join('\n');
};

const RUN_PATH_SECTIONS: ReadonlyArray<{
  doc: keyof StatusPageWiringDocs;
  file: string;
  heading: string;
  label: string;
}> = [
  { doc: 'skill', file: 'SKILL.md', heading: '## Phase 0', label: 'Phase 0' },
  { doc: 'skill', file: 'SKILL.md', heading: '## Orchestration', label: 'Orchestration' },
  { doc: 'coordinator', file: 'coordinator.md', heading: '### Bootstrap preflight', label: 'Bootstrap preflight' },
  { doc: 'coordinator', file: 'coordinator.md', heading: '### Campaign visibility', label: 'Campaign visibility' },
  { doc: 'native', file: 'claude-code-native.md', heading: '## Bootstrap gate ownership', label: 'Bootstrap gate ownership' },
  { doc: 'native', file: 'claude-code-native.md', heading: '## Turn-end step', label: 'Turn-end step' },
];

export const findStatusPageWiringGaps = (docs: StatusPageWiringDocs): string[] => {
  const gaps: string[] = [];

  for (const { doc, file, heading, label } of RUN_PATH_SECTIONS) {
    if (!sectionOf(docs[doc], heading).includes(CITATION)) {
      gaps.push(`${file} § ${label} does not cite ${CITATION}`);
    }
  }

  // Pattern C runs rolling waves: the main chat hands the turn back while workers are still
  // running, so a refresh tied only to "no worker in flight" never fires during a busy campaign.
  const turnEnd = sectionOf(docs.native, '## Turn-end step');
  if (turnEnd.includes(CITATION) && !/in flight/i.test(turnEnd)) {
    gaps.push('claude-code-native.md § Turn-end step does not cover a hand-back with workers in flight');
  }

  const when = sectionOf(docs.statusPage, '## When to refresh');
  if (!/campaign start/i.test(when)) {
    gaps.push('status-page.md § When to refresh has no campaign-start row');
  }
  if (!/in flight/i.test(when)) {
    gaps.push('status-page.md § When to refresh has no in-flight hand-back row');
  }

  return gaps;
};

export const checkStatusPageWiring = (): CheckResult => {
  const gaps = findStatusPageWiringGaps({
    skill: read('src/SKILL.md'),
    coordinator: read('src/agents/coordinator.md'),
    native: read('src/references/claude-code-native.md'),
    statusPage: read('src/references/status-page.md'),
  });
  if (gaps.length) return { id: 'V-STATUSPAGE-01', ok: false, detail: gaps.join('; ') };
  return { id: 'V-STATUSPAGE-01', ok: true };
};

// Domain entrypoint: see agents.check.ts's runChecks doc comment for the shared contract.
export const runChecks = (): CheckResult[] => [checkStatusPageWiring()];
