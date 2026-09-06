---
section: TDD & Testing Baselines
vcodes: [V-TEST-01, V-TEST-02, V-TEST-05]
---
### TDD & Testing Baselines
*   **TDD Workflow (`V-TEST-01/02`)**: Audit the tests. Verify that new logic is covered by unit/widget/integration tests, and that tests were written first (TDD workflow).
*   **Assertion Quality (`V-TEST-05`)**: Verify that assertions are meaningful (asserting behavioral correctness, edge cases, expected errors) rather than trivial existence checks.
*   **New-File Test-Pairing Backstop (`V-TEST-01/02`, issue #876)**: compute `git diff --name-only
    --diff-filter=A <base>...<head>` (added files), `git diff --name-only <base>...<head>`
    (touched files), and `git ls-tree -r --name-only <base>` (base-tree files), then run
    `scripts/new-file-test-pairing.ts --added-files <added> --touched-files <touched>
    --base-tree-files <base-tree>` (`scripts/checks/new-file-test-pairing.check.ts`'s
    `findUnpairedNewSourceFiles`). It prints an advisory `CheckResult` — structurally `ok: true`
    always (never blocking on its own), mirroring the V-TEST-09 Hooks-Claim Audit's mechanical
    backstop. A non-empty `detail` naming a file with a decidable test-pairing convention is
    concrete evidence supporting a `V-TEST-01`/`V-TEST-02` `BLOCK` finding for that file, unless
    the PR names a specific test file and assertion that exercises the new code (see the Iron
    Law's "existing black-box/integration suite covers this indirectly" anti-rationalization
    row). An empty result, or one where no decidable convention exists for the file's directory,
    is **not itself a pass** — it means this backstop had no computable signal one way or the
    other; the reviewer's existing narrative TDD-Workflow judgment above still applies in full.
