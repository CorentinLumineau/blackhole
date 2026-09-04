// Shared verify primitives — `CheckResult` wire type, repo `root`, and `read()` helper.
// Dependency blast-radius (29 direct consumers): documentation/reference/check-utils-blast-radius.md
import * as fs from 'fs';
import * as path from 'path';
import { expandIncludes } from '../lib/build/content.ts';

export const root = path.resolve(import.meta.dirname, '..', '..');

export type CheckResult = { id: string; ok: boolean; detail?: string };

// Reads a repo-relative source file as the compiled tree will see it: `{{INCLUDE:<dir>/*}}`
// markers (ADR-034) are expanded, so a content assertion against a shell file keeps measuring the
// agent's whole prose rather than silently narrowing to whatever stayed in the shell. A file with
// no marker is returned byte-identically, so every pre-ADR-034 call site is unaffected.
export const read = (rel: string) =>
  expandIncludes(fs.readFileSync(path.join(root, rel), 'utf-8'), path.join(root, rel));
