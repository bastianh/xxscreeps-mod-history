# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A room history / replay recording mod for the [xxscreeps](https://github.com/laverdet/xxscreeps)
server. It records per-tick room state and serves it back in the gzipped-chunk
format the screeps client's replay viewer expects. Storage backends are split
into separate publishable packages so users only pull in the deps they use.

## Commands

```sh
pnpm install
pnpm build      # tsc --build (strict) across all packages, then copies config.schema.json into core/dist
pnpm build:ci   # same, but tsc --noCheck (used by CI, which has no sibling xxscreeps checkout)
pnpm watch      # tsc --build --watch
pnpm clean      # tsc --build --clean
pnpm test       # pnpm build + node:test suite in packages/core/test
pnpm test:ci    # pnpm build:ci + node:test (CI variant)
pnpm changeset  # add a changeset (versioning/changelog); see "Releasing"
```

`tsc --build` (strict) plus the `node:test` suite under `packages/core/test`
are the checks. There is no linter configured.

## Releasing

Versioning/publishing is automated with [changesets](https://github.com/changesets/changesets):

- Author changes with a committed `.changeset/*.md` (`pnpm changeset`).
- `.github/workflows/release.yml` (push to `main`) runs `changesets/action`: it
  opens/updates a **"Version Packages"** PR, and on merge runs `pnpm release`
  (`build:ci` + `changeset publish`) to publish changed packages and tag them.
- `.github/workflows/ci.yml` runs `pnpm test:ci` on PRs/pushes.
- Because CI has no sibling xxscreeps checkout, publishing builds with
  `tsc --noCheck` — the emitted `.d.ts` still reference the real `xxscreeps/*`
  types (correct for host consumers). Package `prepack` scripts also use
  `--noCheck` so `changeset publish` never needs the sibling. Strict
  typechecking only runs locally. `.npmrc` sets `auto-install-peers=false` so the
  mismatched published `xxscreeps` sources don't get installed and shadow either
  the sibling types (local) or the emit (CI).
- Needs an `NPM_TOKEN` repo secret; `GITHUB_TOKEN` is automatic.

## Monorepo layout

pnpm workspace, all packages publish to npm under their own names:

- `packages/core` → **`xxscreeps-mod-history`** — the mod itself plus the bundled
  `file` storage backend. All other packages depend on it (`workspace:^`).
- `packages/sqlite` → `@xxscreeps-mod-history/sqlite` (`better-sqlite3`)
- `packages/postgres` → `@xxscreeps-mod-history/postgres` (`pg`)
- `packages/s3` → `@xxscreeps-mod-history/s3` (`@aws-sdk/client-s3`)

Note the published name mismatch: packages are `xxscreeps-mod-history` /
`@xxscreeps-mod-history/*`, but log prefixes and a few strings in code say
`[screepsmod-history]` / `@screepsmod-history`. The repo dir is `screepsmod-history`.

## How a package becomes an xxscreeps mod

Each package's `package.json` has `"xxscreeps": true` and a `src/index.ts`
exporting a `manifest` (`provides`/`dependencies`). Users list packages under
`mods:` in `.screepsrc.yaml`. The host server imports `dist/index.js` to read the
manifest, then imports `dist/backend.js` / `dist/config.js` per the manifest's
`provides`. Backend packages declare `dependencies: ['xxscreeps-mod-history']` so
core loads (and registers its storage registry) first.

## Architecture (core)

The whole mod lives in two `hooks.register` calls in `packages/core/src/backend.ts`:

1. **Capture loop** (`backendReady` hook) — subscribes to the shard's `tick`
   channel. Each tick: claims a best-effort single-writer lease in shard data,
   reads `activeRoomsKey`, loads each room, and renders its objects.
2. **HTTP endpoints** (`middleware` hook) — serves chunks to the replay viewer
   and injects `historyChunkSize` into `/api/version`'s `serverData`.

Key flow and invariants:

- **Rendering** (`render.ts`): objects are rendered through xxscreeps' own
  backend `Render` symbol inside `runOneShot`, producing the exact `_id`-keyed
  map the live room socket sends — so replays match the live view. It reaches
  into xxscreeps internals (`room['#objects']`, `Render`) via bracket/`as any`
  access; these are intentional and fragile against upstream changes.
- **Chunking** (`chunk.ts` + `backend.ts`): ticks are grouped into chunks of
  `chunkSize` (default 100). The chunk's base tick (`time - time % chunkSize`)
  stores the **full** room state; every later tick stores a **shallow** diff.
- **The diff format is dictated by the client**, not us. The replay viewer
  applies each tick with a *deep recursive merge* (`_.merge(state[id], diff[id])`;
  verified in the reference angular client's `build.min.js`). So `getDiff` emits
  the full new value of a changed property **plus explicit `null` tombstones for
  any key dropped since the previous tick**, recursively — a dropped key is only
  cleared by an explicit `null`. Removed object → `null`; added object → full
  value. Without the tombstones, finished actions keep animating in replay (e.g.
  `actionLog.upgradeController` rendered as `{}` on the idle tick deep-merges to
  a no-op and the upgrade animation never stops). Arrays are replaced wholesale.
- A chunk flushes when its final tick is recorded, when a room goes inactive, or
  when the room jumps to a new base. Retention sweep runs every `cleanupInterval`
  ticks, pruning chunks with base < `time - keepTicks`.

## Storage backends

`storage.ts` defines the `HistoryStorage` interface (`save`/`load`/`cleanup`,
optional `[Symbol.asyncDispose]`) and a name→factory `registry`. Backends call
`registerHistoryStorage(name, factory)` at import time; core resolves the one
named by `history.storage` lazily after all mods register. A chunk is an opaque
gzipped JSON blob keyed by `(room, base)`.

To add a backend: new package, `manifest` depending on `xxscreeps-mod-history`,
and a `backend.ts` that implements `HistoryStorage` and calls
`registerHistoryStorage`. Config fields it needs go on `HistoryOptions` in
`storage.ts` and into `core/config.schema.json`.

## Types

`types.ts` is a hand-maintained mirror of the client's wire contract
(`screeps-connectivity` `src/types/{api,game}.ts`) so this repo has no cross-repo
type dependency. If the client's replay format changes, update it here.

## xxscreeps dependency

`xxscreeps` is an **optional peer dependency** provided by the host server at
runtime. For local typechecking it resolves via a tsconfig `paths` mapping to a
sibling checkout: `../../../xxscreeps/packages/xxscreeps/dist/*`. That build must
exist for `pnpm build` to typecheck. `.npmrc` sets `node-linker=hoisted` so the
flat `node_modules` lets every workspace package resolve those shared types.

## Config

Defaults live in `core/config.ts` (`defaults.history`) and are mirrored as JSON
Schema in `core/config.schema.json` (copied into `dist` on build — keep the two
in sync). User config is the `history:` block in `.screepsrc.yaml`.
