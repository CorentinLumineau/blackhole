import { read, type CheckResult } from './check-utils.ts';

// V-HINT-01 — the slash-command `argument-hint` in `src/SKILL.md` lists every owner-facing mode,
// and only those. "Owner-facing" is not a judgment call: it is the first word of every backticked
// mode in the first column of the `## Modes` table. Flags (`--abandon`, `--unattended`) and
// placeholders (`#N`, `[kind]`) are not modes, so each side is compared by first word.

const SKILL = 'src/SKILL.md';

/** The first word of each `|`-separated alternative of `argument-hint: "[a | b c | d]"`. */
export function hintModes(doc: string): string[] {
  const hint = doc.match(/^argument-hint:\s*"\[(.*)\]"\s*$/m);
  if (!hint) return [];
  return hint[1]
    .split('|')
    .map((alt) => alt.trim().split(/\s+/)[0] ?? '')
    .filter((w) => w !== '' && !w.startsWith('-') && !w.startsWith('['));
}

/** The first word of every backticked mode in the first column of the `## Modes` table, in order, deduplicated. */
export function modesTableModes(doc: string): string[] {
  const lines = doc.split('\n');
  const start = lines.findIndex((l) => /^##\s+Modes\s*$/.test(l));
  if (start < 0) return [];
  const out: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,2}\s/.test(line)) break;
    if (!line.startsWith('|')) continue;
    const first = line.split('|')[1] ?? '';
    for (const [, code] of first.matchAll(/`([^`]+)`/g)) {
      const word = code.trim().split(/\s+/)[0];
      if (word && !out.includes(word)) out.push(word);
    }
  }
  return out;
}

/** Every disagreement between the hint and the Modes table, table side first. */
export function findHintDrift(doc: string): string[] {
  const hint = hintModes(doc);
  const table = modesTableModes(doc);
  if (!/^argument-hint:/m.test(doc)) return [`${SKILL} has no argument-hint`];
  if (!table.length) return [`${SKILL} has no Modes table rows`];
  return [
    ...table.filter((m) => !hint.includes(m)).map((m) => `mode "${m}" is in the Modes table but not in argument-hint`),
    ...hint.filter((m) => !table.includes(m)).map((m) => `argument-hint lists "${m}", which the Modes table does not have`),
  ];
}

export const checkSkillModesHint = (): CheckResult => {
  const drift = findHintDrift(read(SKILL));
  return drift.length ? { id: 'V-HINT-01', ok: false, detail: drift.join('; ') } : { id: 'V-HINT-01', ok: true };
};

export const runChecks = (): CheckResult[] => [checkSkillModesHint()];
