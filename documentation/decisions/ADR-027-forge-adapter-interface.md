---
type: adr
status: accepted
review_trigger: "on forge adapter implementation (#679+)"
created: 2026-08-29
last_updated: 2026-08-29
related:
  - documentation/decisions/ADR-005-pr-merge-gate-dependency-ordering.md
  - src/references/forge-sync.md
  - src/references/config-template.md
---

# ADR-027 — Forge Adapter Interface and Config Schema v2

## Status

Accepted — 2026-08-29.

## Context

Blackhole's campaign machinery shells out to the GitHub CLI (`gh`) exclusively. The
`config-template.md` schema pins `"forge": "github"` as the only supported v1 value. Repositories
hosted on Gitea or GitLab cannot use the native queue/ledger/forge-sync loop — a `gh` session
authenticated to github.com against a Gitea-origin remote silently targets the wrong host/API
(reported in #676).

Measured blast radius at routing time:

| Surface | Count |
|---------|-------|
| `gh` call sites in `src/references/` | 73 across 20 files |
| `gh` call sites in `scripts/` | 6 across 5 files (`forge.ts`, `doctor.ts`, `ci-diagnosis.ts`, etc.) |

Child issues #679–#682 implement the adapter; **this ADR defines the contract only** — no runtime
code ships here.

## Decision

Introduce a **forge adapter** — a thin, backend-specific module per forge (`github`, `gitea`,
`gitlab`) that exposes a normalized TypeScript interface. All campaign `gh` call sites route
through the adapter in #679; Gitea (`tea`) and GitLab (`glab`) backends plug into the same seam
in #680/#681.

### Config schema v2

The `forge` field in `.blackhole/config.json` accepts:

```json
"forge": "github" | "gitea" | "gitlab"
```

| Value | CLI | Notes |
|-------|-----|-------|
| `github` | `gh` | Default; behavior-preserving for existing campaigns |
| `gitea` | `tea` | Self-hosted Gitea instances |
| `gitlab` | `glab` | GitLab.com or self-managed |

**Resolution order** (detection child #682 implements; specified here):

1. Explicit `config.json` `forge` value — **always wins** when set to a valid enum member.
2. Otherwise, infer from `git remote get-url origin` host patterns (see Detection table below).
3. If inference fails or is ambiguous → bootstrap **fails loudly** with a user-visible error;
   never default silently to `github` on a non-GitHub origin.

**Mismatch guard**: when both explicit `forge` and detected origin disagree (e.g.
`forge: "github"` but origin is `git.dev.example.lan/...`), bootstrap **must refuse** with an
error naming both values — this is the #676 failure mode the adapter layer must prevent.

### Detection table (origin URL → forge type)

| Pattern | Forge |
|---------|-------|
| `github.com`, `github.enterprise` | `github` |
| Host/path conventions for Gitea (`/gitea/`, known Gitea host list in config optional future) | `gitea` |
| `gitlab.com`, `gitlab.` subdomain patterns | `gitlab` |

Exact heuristics are implementation detail of #682; the **contract** is: detection is
best-effort from origin, explicit config overrides, mismatch is fatal.

### Adapter interface

Module location (implementation child #679): `scripts/lib/forge-adapter/` with
`index.ts` re-exporting `createForgeAdapter(config): ForgeAdapter`.

```typescript
/** Supported forge backends */
export type ForgeType = 'github' | 'gitea' | 'gitlab';

/** Normalized issue record — adapter contract, not any one CLI's raw JSON */
export interface ForgeIssue {
  number: number;
  title: string;
  body: string;
  labels: Array<{ name: string }>;
  milestone: { title: string } | null;
  state: 'OPEN' | 'CLOSED';
}

/** Normalized pull/merge request */
export interface ForgePr {
  number: number;
  title: string;
  body: string;
  headRefName: string;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  mergedAt: string | null;
}

export interface ForgeCheck {
  name: string;
  status: 'QUEUED' | 'IN_PROGRESS' | 'COMPLETED';
  conclusion: 'SUCCESS' | 'FAILURE' | 'NEUTRAL' | 'CANCELLED' | 'SKIPPED' | 'ACTION_REQUIRED' | null;
}

export interface ForgeAuthStatus {
  ok: boolean;
  forge: ForgeType;
  host: string | null;
  detail?: string;
}

export interface IssueListFilter {
  state?: 'open' | 'closed' | 'all';
  labels?: string[];
  milestone?: string;
  limit?: number;
}

export interface IssueCreateParams {
  title: string;
  body: string;
  labels?: string[];
}

export interface IssueEditParams {
  title?: string;
  body?: string;
}

export interface PrCreateParams {
  title: string;
  body: string;
  head: string;
  base: string;
}

export interface ForgeAdapter {
  readonly forge: ForgeType;

  /** Step 1 equivalent in forge-sync.md — must verify CLI + auth + host alignment */
  authStatus(): Promise<ForgeAuthStatus>;

  issueList(filter: IssueListFilter): Promise<ForgeIssue[]>;
  issueCreate(params: IssueCreateParams): Promise<ForgeIssue>;
  issueEdit(number: number, params: IssueEditParams): Promise<void>;
  issueComment(number: number, body: string): Promise<void>;

  prList(filter?: { state?: 'open' | 'closed' | 'all'; limit?: number }): Promise<ForgePr[]>;
  prView(number: number): Promise<ForgePr>;
  prCreate(params: PrCreateParams): Promise<ForgePr>;
  prComment(number: number, body: string): Promise<void>;

  labelAdd(entity: { type: 'issue' | 'pr'; number: number }, labels: string[]): Promise<void>;
  labelRemove(entity: { type: 'issue' | 'pr'; number: number }, labels: string[]): Promise<void>;

  /** CI/check rollup for merge-gate.md § 3 polling */
  prChecks(number: number): Promise<ForgeCheck[]>;
}
```

### JSON normalization strategy

Each backend CLI exposes JSON output (`gh --json`, `tea --json`, `glab --output json`), but field
names and nesting differ. **Normalization happens inside the adapter** — callers never branch on
forge type.

| Capability | GitHub (`gh`) | Gitea (`tea`) | GitLab (`glab`) |
|------------|---------------|---------------|-----------------|
| PR vocabulary | `pr` | `pull` / `pull request` | `merge_request` → mapped to `ForgePr` |
| Issue list | `gh issue list --json` | `tea issues list --json` | `glab issue list --output json` |
| CI status | `gh pr checks` | `tea actions` / workflow status | `glab ci status` / pipeline |
| Auth | `gh auth status` | `tea login status` | `glab auth status` |

The adapter maps each backend's response into the normalized types above. Fields absent on a
backend return sensible defaults (`null`, empty array) and document limitations in backend-specific
unit tests — callers must not assume GitHub-only fields leak through.

### Auth and host resolution

`authStatus()` **must** verify:

1. The backend CLI binary is on `PATH`.
2. The CLI reports an authenticated session.
3. The authenticated host matches the repository's `origin` remote host (or `config.repo` when
   set).

A `gh` session to github.com **must not** satisfy `authStatus()` when `forge` is `gitea` or
`gitlab`, even if `gh` happens to be installed. Each backend probes only its own CLI.

On failure, return `{ ok: false, forge, host, detail }` — forge-sync Step 1 fails fast with the
`detail` string; no silent fallback to another backend.

### Call-site routing (#679 scope)

After #679 lands, **no direct `gh` invocation** remains outside `scripts/lib/forge-adapter/`
backends and their tests. A CI check (`scripts/checks/forge-adapter-routing.check.ts`, child
#679) greps for bare `gh` in `src/references/` (generated copies) and `scripts/` excluding the
adapter directory.

Reference markdown in `src/references/` continues to document operations conceptually; generated
build output may retain `gh` in prose examples until a follow-up docs pass — runtime code and
`scripts/` are the enforcement surface.

## Consequences

### Positive

- Single seam for multi-forge support; Gitea/GitLab children add backends without touching 79
  call sites again.
- Normalized types make campaign logic forge-agnostic.
- Explicit mismatch guard prevents the #676 silent-wrong-host failure mode.

### Negative / risks

- Three CLIs to test and maintain; parity gaps surface as adapter bugs, not caller bugs.
- Reference markdown still mentions `gh` until a dedicated docs sweep — acceptable; runtime is
  gated.

### Follow-up children (already filed)

| Issue | Scope |
|-------|-------|
| #679 | GitHub adapter + call-site routing |
| #680 | Gitea (`tea`) backend |
| #681 | GitLab (`glab`) backend |
| #682 | Detection, doctor.ts, setup docs |

## Alternatives considered

| Option | Rejected because |
|--------|------------------|
| `gh` compatibility shim for Gitea/GitLab | Does not exist; `gh` has no meaningful cross-forge mode |
| Single universal CLI wrapper script | Loses typed contract; harder to test per-backend edge cases |
| Implement all backends in one PR | Exceeds one reviewable unit; #676 split already accepted |
