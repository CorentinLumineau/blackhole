# Fixture V-Codes

Minimal `blackhole-vcodes.md`-shaped table for the leg-B scan: one plain row, and one row whose
key bundles sub-codes, so the fixture exercises key expansion as well as family ownership.

| Code | Rule | Severity | Primary enforcement site |
|------|------|----------|--------------------------|
| V-FAKE-01 | A documented code whose family the table owns | WARN | fixture.check.ts |
| V-BUNDLE-01/02 | A bundled key expanding to two whole codes | WARN | fixture.check.ts |
