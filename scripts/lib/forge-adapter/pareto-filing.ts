import type { ForgeAdapter, ForgeIssue } from './types.ts';
import { paretoLabel, paretoPriority, reconcileParetoLabels, upsertParetoLine } from '../pareto.ts';

// One wrapper over the ForgeAdapter issue/label verbs, so every forge writes the same `Pareto:`
// body line and `pareto:P1..P4` label (V-PARETO-02) without a per-adapter edit. Adapter errors
// propagate: a filing that cannot be labelled is never silently left unlabelled.

type Scoring = { gain: number; effort: number };

export async function issueCreateWithPareto(
  adapter: ForgeAdapter,
  params: { title: string; body: string; labels?: string[] },
  scoring: Scoring,
): Promise<ForgeIssue> {
  const label = paretoLabel(paretoPriority(scoring.gain, scoring.effort));
  return adapter.issueCreate({
    title: params.title,
    body: upsertParetoLine(params.body, scoring),
    labels: [...(params.labels ?? []).filter((l) => !l.startsWith('pareto:')), label],
  });
}

export async function rescoreIssue(adapter: ForgeAdapter, issue: Pick<ForgeIssue, 'number' | 'body' | 'labels'>, scoring: Scoring): Promise<void> {
  const body = upsertParetoLine(issue.body, scoring);
  if (body !== issue.body) await adapter.issueEdit(issue.number, { body });
  const { add, remove } = reconcileParetoLabels(issue.labels.map((l) => l.name), paretoPriority(scoring.gain, scoring.effort));
  const entity = { type: 'issue' as const, number: issue.number };
  if (remove.length) await adapter.labelRemove(entity, remove);
  if (add.length) await adapter.labelAdd(entity, add);
}
