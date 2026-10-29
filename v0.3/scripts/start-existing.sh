#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
docker run --rm --pull never --network none --entrypoint node -v "$PWD:/workspace" -w /workspace life-dashboard:compact-2026-10-24 scripts/init.mjs
docker compose up -d --wait --pull never --no-build app
