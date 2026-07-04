# Release checklist

## Before prepare

- [ ] `main` is up to date
- [ ] `bun run build` passes
- [ ] Semver bump agreed with user

## Notes file

- [ ] `.github/releases/vX.Y.Z.md` exists
- [ ] Product-focused (features, flow, install) — not internal audit changelog
- [ ] No references to external projects
- [ ] Install commands match README
- [ ] Mermaid diagram renders (if included)

## Mechanical

- [ ] `package.json` version matches tag (without `v`)
- [ ] `bun run release validate vX.Y.Z` passes
- [ ] Committed on `main` and pushed
- [ ] `bun run release tag vX.Y.Z`
- [ ] `bun run release push vX.Y.Z`

## After CI

- [ ] `gh release view vX.Y.Z` — body matches notes file
- [ ] Release title reasonable
