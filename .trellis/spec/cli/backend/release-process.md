# Release Process

> Release, versioning, docs, and npm publishing rules for the Trellis monorepo.

---

## Overview

Trellis publishes two npm packages from one git tag:

| Package | Role | Published by |
|---|---|---|
| `trellis-hgl` | User-facing CLI | GitHub Actions only |
| `trellis-hgl-core` | Programmatic core APIs used by the CLI and external integrations | GitHub Actions only |

The package pair is version-locked. Every published version must exist for both packages with the exact same version and npm dist-tag.

---

## CI-only publishing

Official npm publishing must happen through `.github/workflows/publish.yml`.

Do not run `npm publish` or `pnpm publish` locally for official Trellis packages. Local machines may run `pnpm pack`, `release-preflight`, tests, lint, typecheck, and dry-run checks, but not package publication.

If a CI publish looks partial or inconsistent:

1. Inspect the GitHub Actions publish run.
2. Verify public npm visibility:
   ```bash
   npm view trellis-hgl@<version> version dist-tags --json --registry=https://registry.npmjs.org/
   npm view trellis-hgl-core@<version> version dist-tags --json --registry=https://registry.npmjs.org/
   ```
3. Fix the workflow or release scripts.
4. Re-run the CI path or move the tag after the fix when the same version is still the intended release artifact.

Do not compensate by publishing one missing package locally. That creates a release artifact without CI provenance and hides the workflow failure from the next release.

The publish workflow must verify both packages after publish with:

```bash
node packages/cli/scripts/release-preflight.js verify-npm --package all
```

---

## Version invariants

| Invariant | Rule |
|---|---|
| Shared version | `packages/cli/package.json` and `packages/core/package.json` must have the same `version`. |
| Shared tag | Git tag `v<version>` must match both package versions. |
| Shared npm dist-tag | `latest` for all published versions. |
| Source dependency | CLI source depends on core with `workspace:*`. |
| Packed dependency | Published CLI package must depend on `trellis-hgl-core` with the exact release version. |

`packages/cli/scripts/release-preflight.js` is the source of truth for these checks.

Required gates:

```bash
node packages/cli/scripts/release-preflight.js check-versions
node packages/cli/scripts/release-preflight.js verify-packed-cli
node packages/cli/scripts/release-preflight.js publish-plan
```

---

## Branch and release tracks

| Track | Branch pattern | Version pattern | npm tag | Notes |
|---|---|---|---|---|
| Stable | `main` | `X.Y.Z` | `latest` | Patch/minor/major GA releases. |
| Beta | `feat/vX.Y.Z-beta` or equivalent long-lived beta branch | `X.Y.Z-beta.N` | `latest` | Feature incubation. CLI and core still publish beta versions, but the npm dist-tag remains `latest`. |
| RC | release candidate branch or the stabilized beta branch | `X.Y.Z-rc.N` | `latest` | Pre-GA validation. CLI and core still publish rc versions, but the npm dist-tag remains `latest`. |
| GA promotion | stable release branch / `main` | `X.Y.Z` | `latest` | Stable releases also publish as `latest`. |

A new beta cycle starts from the current stable/release baseline and uses the next minor or major version, for example `0.6.0-beta.0` after `0.5.x`. It does not continue an older beta line after that line has moved to RC or GA.

Stable fixes normally flow from `main` to beta/rc by cherry-pick. Beta-only features do not flow back to `main` by cherry-pick; rewrite them as stable-ready commits when needed.

---

## Docs-site lifecycle

The docs-site root path holds the current stable docs. Beta and RC content live under `beta/` and `rc/`.

| Transition | Script | When |
|---|---|---|
| Start a new beta | `docs-site/scripts/docs-beta-start.sh` | Before the first `pnpm release:beta` for a new minor/major, for example `0.6.0-beta.0`. |
| Beta to RC | `docs-site/scripts/docs-beta-to-rc.sh` | Before the first `pnpm release:rc`, for example `0.6.0-rc.0`. |
| RC to GA | `docs-site/scripts/docs-promote.sh` | Before `pnpm release:promote`. |

Per-patch beta, RC, or GA releases do not run these lifecycle scripts. They add changelog MDX files, update `docs-site/docs.json`, commit the docs-site submodule first, then bump the submodule pointer in the main repo.

Full docs details live in `.trellis/spec/docs-site/docs/release-lifecycle.md`.

---

## Submodule commit ordering

When a release touches `docs-site` or `marketplace`, commit and push the submodule first, then commit the submodule pointer in the main repo.

Correct order:

```bash
cd docs-site
git add . && git commit -m "docs: changelog v<version>" && git push origin main

cd ..
git add docs-site
git commit -m "chore: bump docs-site for v<version>"
git push origin <branch>
```

`packages/cli/scripts/release.js` excludes `docs-site` and `marketplace` from its automatic pre-release staging so submodule pointer changes cannot be hidden inside a generic release commit.

---

## Manifest continuity across branches

Each release branch maintains its own `packages/cli/src/migrations/manifests/<version>.json`. The CLI update logic walks the manifest chain between `fromVersion` and `toVersion`, so every published version that a user can upgrade through must have a local manifest on the release branch.

When a stable patch manifest is missing from a beta branch:

```bash
git show main:packages/cli/src/migrations/manifests/<version>.json \
  > packages/cli/src/migrations/manifests/<version>.json
git add packages/cli/src/migrations/manifests/<version>.json
git commit -m "chore: restore manifest <version> from main"
```

Restore published manifests deliberately. Do not auto-merge whole manifest directories across release branches, because branch-specific manifests can mention files that do not exist on the other branch.

---

## Release command sequence

The root release scripts delegate to the CLI package:

```bash
pnpm release
pnpm release:beta
pnpm release:rc
pnpm release:promote
```

`packages/cli/scripts/release.js` runs:

1. `check-manifest-continuity`
2. `check-docs-changelog --type beta|rc|promote` for prerelease/promotion tracks when `docs-site/` exists in the current checkout; if the docs-site worktree is absent, the guard warns and skips.
3. core tests
4. CLI tests
5. pre-release commit excluding `docs-site` and `marketplace`
6. `bump-versions.js <type>` to update both package versions together
7. `release-preflight check-versions`
8. version commit with the version string as the commit message
9. git tag `v<version>`
10. push branch and tags
11. GitHub Actions publish workflow builds, tests, packs, publishes, and verifies both packages

The release script does not publish locally. The pushed tag is what starts official npm publication.

---

## Publish workflow sequence

`.github/workflows/publish.yml` runs on `v*` tag push and GitHub Release publication. The `v*` tag path is the primary release acceptance path; GitHub Release publication remains an additional trigger source. The workflow is idempotent for reruns on the same tag.

The checkout step must use `actions/checkout@v4` with `fetch-depth: 0` and `submodules: recursive`, because the release test suite reads workflow files from the `marketplace` submodule.

Required order:

1. checkout repository history and required submodules
2. install dependencies
3. `release-preflight check-versions --require-tag`
4. `pnpm typecheck`
5. `pnpm test`
6. `pnpm build`
7. `release-preflight verify-packed-cli`
8. `release-preflight publish-plan --github`
9. `release-preflight pack-publish-artifacts`
10. publish `trellis-hgl-core` if missing
11. publish `trellis-hgl` if missing
12. `release-preflight verify-published-cli-manifest`
13. `release-preflight verify-npm --package all`

Core publishes first because the CLI package depends on the exact core version in the packed artifact.

---

## Pre-release checklist

- [ ] Worktree is clean except intentional release changes.
- [ ] Relevant coding specs have been read.
- [ ] Manifest exists for the target version.
- [ ] If `docs-site/` exists in the current checkout, English and Chinese docs-site changelogs exist and match 1:1.
- [ ] If `docs-site/` exists in the current checkout, `docs-site/docs.json` points to the new changelog.
- [ ] If `docs-site/` exists in the current checkout, submodule commits are pushed before main repo pointer commits.
- [ ] `node packages/cli/scripts/release-preflight.js check-versions` passes.
- [ ] `node packages/cli/scripts/release-preflight.js verify-packed-cli` passes.
- [ ] `pnpm lint && pnpm typecheck && pnpm test` pass or the blocker is recorded.
- [ ] Breaking releases include `migrationGuide` and `aiInstructions` in the manifest.
- [ ] Official package publication is left to CI.

---

## Cross-references

- Core/CLI code ownership and package boundaries: `trellis-core-sdk.md`
- Manifest format and migration types: `migrations.md`
- Docs lifecycle: `.trellis/spec/docs-site/docs/release-lifecycle.md`
- Native dependency policy: `quality-guidelines.md`
