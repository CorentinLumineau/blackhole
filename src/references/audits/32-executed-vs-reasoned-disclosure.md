---
section: Executed vs. Reasoned Verification Disclosure
vcodes: []
---
### Executed vs. Reasoned Verification Disclosure (ADR-036, issue #815)

*   Set `verification_mode` (`executed`/`reasoned`) on findings; emit `verification_legs[]` for clean security-mode legs (`worker-schemas.md` § Reviewer) — never license to bypass `with-test-lock`. A `reasoned` leg surfaces, never blocks, at merge (`V-SEC-12`).
