#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"

export NODE_ENV="test"
export PLOTLINE_TEST_MODE="1"
export HOST="${PLOTLINE_TEST_HOST:-127.0.0.1}"
export PORT="${PLOTLINE_TEST_PORT:-5678}"
export PLOTLINE_DATA_DIR="${PLOTLINE_TEST_DATA_DIR:-data-test}"

bun run ./src/test/reset-data-dir.ts
bun test src/
