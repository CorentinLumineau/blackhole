import { expandVcodeTableKey } from './check-common.ts';
import { markdownHeadings, sectionEnd } from './markdown-headings.ts';

// On-demand stubs: an agent shell keeps one `###` stub per module whose body is Read
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

// Leg D — one stub in the agent shell per on-demand module. Pure over the source text so the
// fixture tests can break each property on its own. The shape names the shell, module directory
// and heading level: the reviewer and planner use `###` stubs, the implementer's gates `##`.
export type StubShape = { shell: string; modulesDir: string; level: number };
export const REVIEWER_STUB_SHAPE: StubShape = { shell: 'reviewer.md', modulesDir: 'audit-modules', level: 3 };
export const PLANNER_STUB_SHAPE: StubShape = { shell: 'planner.md', modulesDir: 'planner-tracks', level: 3 };
// The implementer's on-demand gates: bodies under `references/gate-modules/`, one `##` stub each in
// `src/agents/implementer.md`. `agents.check.ts` (V-GATE-01) runs the drift rule over them.
export const IMPLEMENTER_GATE_STUB_SHAPE: StubShape = { shell: 'implementer.md', modulesDir: 'gate-modules', level: 2 };
export const ONDEMAND_GATE_MODULE_DIR = 'src/references/gate-modules';

export const findOnDemandStubDrift = (shellSrc: string, modules: StubModule[], shape: StubShape = REVIEWER_STUB_SHAPE): string[] => {
  const lines = shellSrc.split('\n');
  const headings = markdownHeadings(lines).filter((h) => h.level === shape.level);
  const errors: string[] = [];
  for (const m of modules) {
    if (!m.section) {
      errors.push(`${m.file}: no \`section:\` frontmatter, so its stub cannot be matched`);
      continue;
    }
    const stubs = headings.filter((h) => stubMatchesSection(h.text.replace(/`/g, ''), m.section!));
    if (stubs.length !== 1) {
      errors.push(stubs.length === 0 ? `${m.file}: no stub heading for section "${m.section}" in ${shape.shell}` : `${m.file}: ${stubs.length} stubs for section "${m.section}" in ${shape.shell}`);
      continue;
    }
    const body = stubBody(lines, stubs[0]);
    const readPath = `references/${shape.modulesDir}/${m.file}`;
    if (!/\*\*Load when\*\*:/.test(body)) errors.push(`${m.file}: stub has no \`Load when\` trigger line`);
    if (!body.includes(readPath)) errors.push(`${m.file}: stub has no \`Read\` path to ${readPath}`);
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
  return [...findOnDemandStubDrift(plannerSrc, modules, PLANNER_STUB_SHAPE), ...directiveErrors];
};

// `planner.md` is a shell: its Design Track subsections 4.1-4.8 live in the Design module, so a
// `planner.md` §4.x citation names a section that no longer exists in that file.
const STALE_PLANNER_SECTION = /`?planner\.md`? ?§ ?(4\.\d+)/g;

export const findStalePlannerSectionCitations = (texts: Record<string, string>): string[] =>
  Object.entries(texts).flatMap(([file, text]) =>
    [...text.matchAll(STALE_PLANNER_SECTION)].map(
      (m) => `${file}: \`planner.md\` §${m[1]} no longer resolves, cite \`planner-tracks/04-design-track.md\` §${m[1]}`,
    ),
  );
