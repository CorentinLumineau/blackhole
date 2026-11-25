import { expandVcodeTableKey } from './check-common.ts';
import { markdownHeadings, sectionEnd } from './markdown-headings.ts';

// On-demand stubs (issue #1387): an agent shell keeps one `###` stub per module whose body is Read
// only when its `Load when` line holds. These pure checks prove a stub still carries what makes it
// load, because a stub that loses its trigger or Read path silently turns the module off. Shared by
// the reviewer audit modules (V-AUDIT-01) and the planner track modules (V-AUDIT-02).

// `section` is the module's `section:` frontmatter, the key a stub heading is matched on; `track`
// is the planner track modules' `track:` frontmatter.
export type StubModule = { file: string; vcodes: string[]; section?: string; track?: string };

// A stub heading carries the module's `section:` text, optionally followed by a ` (`V-...`)` code
// suffix, so `§ <Section>` citations resolve against it exactly as they did against the inlined body.
export const stubMatchesSection = (headingText: string, section: string): boolean =>
  headingText === section || headingText.startsWith(`${section} (`);

// Every V-code a stub names, compact slash forms (`V-BETA-01/02`) expanded like the table keys.
const codesNamedIn = (text: string): Set<string> =>
  new Set([...text.matchAll(/V-[A-Z0-9-]*[A-Z]-\d+(?:\/\d+)*/g)].flatMap((m) => expandVcodeTableKey(m[0])));

export const stubBody = (lines: string[], stub: ReturnType<typeof markdownHeadings>[number]): string =>
  lines.slice(stub.line, sectionEnd(markdownHeadings(lines), stub, lines.length)).join('\n');

// Leg D — one `###` stub in the reviewer source per on-demand module. Pure over the source text so
// the fixture tests can break each property on its own.
export const findOnDemandStubDrift = (
  reviewerSrc: string,
  modules: StubModule[],
  agentFile = 'reviewer.md',
  moduleDir = 'audit-modules',
): string[] => {
  const lines = reviewerSrc.split('\n');
  const headings = markdownHeadings(lines).filter((h) => h.level === 3);
  const errors: string[] = [];
  for (const m of modules) {
    if (!m.section) {
      errors.push(`${m.file}: no \`section:\` frontmatter, so its stub cannot be matched`);
      continue;
    }
    const stubs = headings.filter((h) => stubMatchesSection(h.text.replace(/`/g, ''), m.section!));
    if (stubs.length !== 1) {
      errors.push(stubs.length === 0 ? `${m.file}: no stub heading for section "${m.section}" in ${agentFile}` : `${m.file}: ${stubs.length} stubs for section "${m.section}" in ${agentFile}`);
      continue;
    }
    const body = stubBody(lines, stubs[0]);
    if (!/\*\*Load when\*\*:/.test(body)) errors.push(`${m.file}: stub has no \`Load when\` trigger line`);
    if (!body.includes(`references/${moduleDir}/${m.file}`)) errors.push(`${m.file}: stub has no \`Read\` path to references/${moduleDir}/${m.file}`);
    const named = codesNamedIn(body);
    for (const code of m.vcodes) if (!named.has(code)) errors.push(`${m.file}: stub does not name ${code}`);
  }
  return errors;
};


// V-AUDIT-02 — `src/agents/planner.md` keeps one stub per track module. On top of the shared stub
// shape, a directive-only track's `Load when` must name its exact `track: <name>` directive: that
// line is the only place the planner learns which spawn directive loads the module.
export const DIRECTIVE_ONLY_TRACKS = ['skip', 'design', 'brainstorm'];

export const findPlannerTrackDrift = (plannerSrc: string, modules: StubModule[]): string[] => {
  const lines = plannerSrc.split('\n');
  const headings = markdownHeadings(lines).filter((h) => h.level === 3);
  const directiveErrors = modules
    .filter((m) => m.section && DIRECTIVE_ONLY_TRACKS.includes(m.track ?? ''))
    .flatMap((m) => {
      const stub = headings.find((h) => stubMatchesSection(h.text.replace(/`/g, ''), m.section!));
      if (!stub) return []; // reported by findOnDemandStubDrift
      const load = stubBody(lines, stub).split('\n').find((l) => l.includes('**Load when**:')) ?? '';
      return load.includes(`\`track: ${m.track}\``) ? [] : [`${m.file}: stub \`Load when\` does not name the \`track: ${m.track}\` directive`];
    });
  return [...findOnDemandStubDrift(plannerSrc, modules, 'planner.md', 'planner-tracks'), ...directiveErrors];
};
