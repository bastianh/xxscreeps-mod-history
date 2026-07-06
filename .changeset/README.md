# Changesets

This folder is managed by [changesets](https://github.com/changesets/changesets).
Each version bump and changelog entry starts as a changeset file here.

## Adding a changeset

When you make a change that should ship in a release, run:

```sh
pnpm changeset
```

Pick the affected packages, the bump type (patch / minor / major) and write a
short summary. This creates a markdown file in `.changeset/` that you commit
alongside your change.

## Releasing (automated)

On every push to `main`, the `Release` GitHub Action either:

- opens/updates a **"Version Packages"** PR that consumes the pending
  changesets, bumps versions and updates each package's `CHANGELOG.md`; or
- when that PR is merged, builds and runs `changeset publish` to publish the
  changed packages to npm and tag the release.

See <https://github.com/changesets/changesets/blob/main/docs/intro-to-using-changesets.md>.
