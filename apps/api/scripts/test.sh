#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"

export NODE_ENV="test"
export LUCENTDOCS_TEST_MODE="1"
export HOST="${LUCENTDOCS_TEST_HOST:-127.0.0.1}"
export PORT="${LUCENTDOCS_TEST_PORT:-5678}"
export LUCENTDOCS_DATA_DIR="${LUCENTDOCS_TEST_DATA_DIR:-data-test}"

bun run ./src/test/reset-data-dir.ts
bun test src/
