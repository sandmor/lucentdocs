# Lucentdocs

Monorepo for the Lucentdocs writing app.

| Package | Role |
|---------|------|
| `apps/api` | Express + tRPC backend, Yjs, job workers |
| `apps/web` | Vite + React frontend |
| `packages/core` | Rust native module (`@lucentdocs/core`) — SQLite storage, embeddings prep, markdown |
| `packages/shared` | Shared TypeScript types and config |

## Prerequisites

- [Bun](https://bun.sh)
- Rust toolchain (`rustup`)
- Linux: `libsqlite3-dev` and `pkg-config` (for the default native build)

## Quick start

```bash
bun install
cp .env.example .env   # edit as needed
bun run dev            # builds @lucentdocs/core, then starts the API with watch
```

The web app is served by the API in development. See `.env.example` for configuration.

## Native storage (`packages/core`)

All SQLite I/O runs in Rust and is exposed to Node/Bun via NAPI. TypeScript uses thin adapters in `apps/api/src/infrastructure/rust/`. Vector search uses `sqlite-vec`, compiled into the native module (no npm platform packages).

Build the native addon:

```bash
cd packages/core
npm run build              # links system SQLite (default)
npm run build:bundled      # embeds SQLite when pkg-config is unavailable or cross-compiling
```

Cross-compiled targets (musl, aarch64 Linux, Android) use bundled SQLite; the nightly CI workflow passes `--features sqlite-bundled` for those matrix entries automatically. Musl cross-builds also need `packages/core/musl_compat.h` on the compiler include path (CI sets this via `CFLAGS_<target>`).

## Testing

```bash
bun run test
```

Tests use isolated data under `data-test/` (`LUCENTDOCS_TEST_MODE=1`). In-memory test databases write temp files to `apps/api/tmp/` by default. If `/tmp` is a small tmpfs and fills up, set `TMPDIR` or `LUCENTDOCS_MEM_DB_DIR` to a path on disk.

## Production

```bash
bun run build
bun run serve
```

## Docker deployment

```bash
cp .env.example .env   # edit as needed
docker compose up -d
```

Pulls [`sandmor/lucentdocs:latest`](https://hub.docker.com/r/sandmor/lucentdocs). The app is at `http://localhost:5677`. Data persists in the `lucentdocs-data` volume. Compose sets `HOST`, `NODE_ENV`, `LUCENTDOCS_DATA_DIR`, and `QDRANT_URL` for the container.

Optional Qdrant (`qdrant/qdrant:latest`): set `VECTOR_STORAGE=qdrant` in `.env`, then:

```bash
docker compose --profile qdrant up -d
```

### CI image publishing

The [Docker workflow](.github/workflows/docker.yml) builds on pull requests and pushes to [Docker Hub](https://hub.docker.com/r/sandmor/lucentdocs) on pushes to `master` and version tags (`v*`).

Set these repository secrets:

| Secret | Value |
|--------|-------|
| `DOCKER_USERNAME` | Docker Hub username |
| `DOCKER_PASSWORD` | Docker Hub access token |

On `master`, published tags include `latest` and `sha-<short-sha>`. Version tags (for example `v1.2.3`) also receive semver tags.

## Other commands

```bash
bun run typecheck
bun run lint
bun run format
```
