# xxscreeps-mod-history

Room history / replay recording for the [xxscreeps](https://github.com/laverdet/xxscreeps)
server. It records per-tick room state and serves it in the chunk format the
client's replay viewer expects, with **pluggable storage backends** kept in
separate packages so you only install the dependencies you actually use.

## Packages

| Package | Backend | Extra dependency |
| --- | --- | --- |
| `xxscreeps-mod-history` | filesystem (built in) | — |
| `@xxscreeps-mod-history/sqlite` | SQLite | `better-sqlite3` |
| `@xxscreeps-mod-history/postgres` | PostgreSQL | `pg` |
| `@xxscreeps-mod-history/s3` | S3 / object storage | `@aws-sdk/client-s3` |

## How it works

- A backend-side capture loop runs each tick (`backendReady` hook). For every
  active room it renders the objects through xxscreeps' own backend render
  pipeline — the exact same output the live room socket sends — so replays match
  the live view.
- Ticks are grouped into chunks (`chunkSize`, default 100). The chunk's base
  tick stores the full room state; the rest store shallow per-object diffs, the
  format the client's `HistoryPlayer.applyDiff` consumes.
- Chunks are gzipped JSON, stored by `(room, base)` through the configured
  backend, and pruned beyond `keepTicks`.
- The replay viewer fetches them via:
  - `GET /room-history/<shard>/<room>/<base>.json` (sharded)
  - `GET /room-history?room=<room>&time=<tick>` (private server)

## Usage

Install the core mod and the backend you want, then add both to your
`.screepsrc.yaml`:

```yaml
mods:
  - xxscreeps-mod-history
  - '@xxscreeps-mod-history/sqlite'

history:
  storage: sqlite            # file | sqlite | postgres | s3
  path: ./screeps/history.db # file backend: directory; sqlite: db file
  chunkSize: 100
  keepTicks: 200000
  cleanupInterval: 1000
  capture: true
```

### Backend-specific options

| Backend | Required | Notes |
| --- | --- | --- |
| `file` | `path` (directory) | gzipped chunks at `<path>/<room>/<base>.json.gz` |
| `sqlite` | `path` (db file) | single `history(room, base, data, ts)` table |
| `postgres` | `url` *or* `HISTORY_POSTGRES_URL` env | connection string (env keeps the password out of plaintext config); table auto-created |
| `s3` | `bucket` | plus `prefix`, `region`, `endpoint` (s3-compatible) |

If you run more than one backend process, keep a single writer: leave
`capture: true` on one and set `capture: false` on the others (a best-effort
lease also guards against double writes).

## Development

```sh
pnpm install
pnpm build      # tsc --build (strict) across all packages + copies config.schema.json
pnpm test       # builds, then runs the node:test suite
```

Types resolve against a local xxscreeps checkout via `tsconfig` path mapping
(`../../../xxscreeps/packages/xxscreeps/dist`); at runtime xxscreeps is an
optional peer dependency provided by the host server. CI has no such checkout,
so `pnpm build:ci` / `pnpm test:ci` transpile with `tsc --noCheck` — the strict
typecheck runs locally where the sibling checkout exists.

## Releasing

Versioning and publishing are automated with
[changesets](https://github.com/changesets/changesets).

1. With your change, add a changeset describing it and the bump type:

   ```sh
   pnpm changeset
   ```

   Commit the generated `.changeset/*.md` file alongside your code.

2. On push to `main`, the **Release** workflow opens (or updates) a
   **"Version Packages"** PR that consumes the pending changesets, bumps
   versions and writes each package's `CHANGELOG.md`.
3. Merging that PR builds and runs `changeset publish`, publishing the changed
   packages to npm and tagging the release.

Publishing requires an `NPM_TOKEN` repository secret (an npm automation token
without publish-time 2FA). `GITHUB_TOKEN` is provided automatically.
