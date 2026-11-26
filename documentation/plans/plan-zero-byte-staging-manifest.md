---
type: plan
summary: "Make staging manifest writes atomic through one script and make a zero-byte manifest block the carry instead of skipping it (issue 1652)"
status: current
review_trigger: "on file change"
created: 2026-11-26
last_updated: 2026-11-26
---

# Plan: atomic staging manifest writes

Issue #1652. Producers append to `.blackhole/staged/<N>/manifest.json` through `scripts/stage-manifest.ts append` (`.tmp` then `mv`, validated, refuses a zero-byte or unparseable existing manifest). The carry step's exit 1 on a zero-byte or unparseable manifest becomes a blocking failure for the implementer, not a skip. Tests first: lib unit tests, CLI test, carry CLI message test.
