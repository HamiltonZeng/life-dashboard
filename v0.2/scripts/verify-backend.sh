#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
# The capture script and every project tool run inside Docker. No paid provider calls.
docker compose run --rm --no-deps -e AI_PROVIDER=mock tools node scripts/verify-checks.mjs
docker compose --profile test run --rm -e AI_PROVIDER=mock test node scripts/verify-checks.mjs integration
