---
type: plan
status: current
review_trigger: "on file change"
created: 2026-09-02
last_updated: 2026-09-02
related:
  [
    scripts/verify.model-routing-effort.test.ts,
    scripts/build.test.ts,
    src/references/model-routing.md,
  ]
---

# Plan: Fix stale `unverified` assertion in `verify.model-routing-effort.test.ts` (issue #746)

## Objective

`main` is red on the full suite (`a5372de7`): `scripts/verify.model-routing-effort.test.ts`'s
last test (`documents skills.sh/generic as inherit with unverified flag`, lines 65-69) fails
because it still expects the pre-#742 wording:

```
error: expect(received).toMatch(expected)
Expected substring or pattern: /unverified/i
Received: "### skills.sh / generic … **Effort policy:** `inherit` (session) — same fallback as model
when the harness exposes no model override … **Verified** by `scripts/build.test.ts`'s
`applyPlatformConditionals` `skills`-target model-ladder test; do not assume portable effort
tokens beyond the generic tier mapping it checks."
8 pass, 1 fail
```

**Root cause, confirmed against the actual diff (`git show a9026b3c -- src/references/model-routing.md`)**:
PR #742 (issue #713) added a real build-harness integration test in `scripts/build.test.ts`
(`describe('applyPlatformConditionals')`, the `'skills target resolves model-routing.md: ...
(R-20 harness integration)'` test) and, in the same commit, replaced `model-routing.md`'s
self-declared

> **Unverified** until a harness integration test exists; do not assume portable effort tokens.

with a citation to that new test:

> **Verified** by `scripts/build.test.ts`'s `applyPlatformConditionals` `skills`-target
> model-ladder test; do not assume portable effort tokens beyond the generic tier mapping it
> checks.

That was #713's whole acceptance criterion, and it shipped correctly — **the prose in
`model-routing.md` is not the bug and must not be touched or reverted.**
`scripts/verify.model-routing-effort.test.ts` was outside #742's own Touch-Paths (its diff
touched `documentation/INDEX.md`, two review-artifact files, the `model-routing.md` compile
targets, and `scripts/build.test.ts` — never this file), so the stale `/unverified/i` assertion
was never updated. The fix is scoped entirely to this one test file.

**Design decision — the replacement assertion, not just a word swap.** The test's origin
(issue #469) asserts one thing: the `skills.sh` effort policy is `inherit`, and that claim's
*provenance* is stated rather than assumed. Before #742 the provenance was an admission of
uncertainty ("Unverified"); after #742 it is a citation to a real, currently-existing test. The
intent is *better* satisfied now, not violated — so the replacement assertion must pin the new
provenance mechanism, not merely accept whatever prose is present:

- A **tautological** fix would just swap `/unverified/i` for `/verified/i` (or any synonym).
  That passes on any prose containing the word "Verified" — including a lie. It would not
  catch a future edit that keeps the word "Verified" while deleting the citation, or that cites
  a test that no longer exists.
- The **real guard** implemented below instead checks two independent things that must both
  hold: (1) `model-routing.md`'s `{{#skills}}` block still names the specific citation target
  (`scripts/build.test.ts`, `applyPlatformConditionals`) — not just the word "Verified"; and
  (2) `scripts/build.test.ts` **still contains** a test matching that exact citation (its
  description string, and the literal `'skills'` target argument it passes to
  `applyPlatformConditionals`). Point (2) is what makes this a cross-file coherence check
  instead of a single-file tautology: if a future PR deletes or renames the cited
  `build.test.ts` test without updating the `model-routing.md` citation (or vice versa), this
  test fails — exactly the "provenance claim deleted or weakened" failure mode issue #746 asks
  the assertion to guard against. A `not.toMatch(/unverified/i)` assertion is kept too, so a
  regression back to the old self-declared-uncertain wording (with or without a simultaneous
  fake citation) is also caught.
- **The test's name changes.** `'documents skills.sh/generic as inherit with unverified flag'`
  is now factually false — nothing is unverified — and was the literal false premise that made
  `main` red. Rename to
  `'documents skills.sh/generic effort policy as inherit, backed by a live build.test.ts
  citation (issue #746)'` (issue number in the test name only, per this repo's comment-discipline
  convention — never in an inline comment body).

## Touch-Paths

- `scripts/verify.model-routing-effort.test.ts`

No other file changes. In particular: do not edit `src/references/model-routing.md` (its
prose is correct and is the thing being guarded, not the bug) and do not edit
`scripts/build.test.ts` (the cited test already exists and is correct — this plan's new
assertions read it, never write it).

## Replacement Assertion

```ts
test('documents skills.sh/generic effort policy as inherit, backed by a live build.test.ts citation (issue #746)', () => {
  const skillsBlock = content.match(/\{\{#skills\}\}([\s\S]*?)\{\{\/skills\}\}/)?.[1] ?? '';
  expect(skillsBlock).toMatch(/inherit/i);
  expect(skillsBlock).not.toMatch(/unverified/i);
  expect(skillsBlock).toMatch(/scripts\/build\.test\.ts/);
  expect(skillsBlock).toMatch(/applyPlatformConditionals/);

  // The citation must resolve to real, currently-existing coverage, not just a claim in
  // prose: the cited build.test.ts test must still exist and still target 'skills'.
  const buildTestContent = fs.readFileSync(path.join(root, 'scripts/build.test.ts'), 'utf-8');
  expect(buildTestContent).toMatch(/skills target resolves model-routing\.md/);
  expect(buildTestContent).toContain("'skills'");
});
```

No new imports needed — `fs`, `path`, and `root` are already declared at the top of the file
and used by the surrounding tests.

## Verification

1. `bun test scripts/verify.model-routing-effort.test.ts` before the change reproduces the
   quoted red state exactly.
2. `bun test scripts/verify.model-routing-effort.test.ts` after the change: `9 pass, 0 fail`.
3. `bun test` (full suite): 0 failures.
4. `bun run verify`: exit 0.
5. Diff touches only `scripts/verify.model-routing-effort.test.ts`.
