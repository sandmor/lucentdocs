#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"

export NODE_ENV="test"
export HOST="${HOST:-127.0.0.1}"
export PORT="${PORT:-5678}"
export PLOTLINE_DATA_DIR="${PLOTLINE_DATA_DIR:-data-test}"

bun run ./src/test/reset-data-dir.ts
bun test src/
