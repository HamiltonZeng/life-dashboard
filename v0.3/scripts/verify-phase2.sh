#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
artifacts=.runtime/test-artifacts/v03-phase2
mkdir -p "$artifacts"
# The inherited suite includes F01--F04 and guards every synthetic database reset.
sh scripts/verify-phase1.sh > "$artifacts/phase1-regression.log" 2>&1
docker compose run --rm --no-deps --pull never test sh -c 'node_modules/.bin/tsx packages/db/src/migrate.ts && node_modules/.bin/tsx --test --test-concurrency=1 tests/v03-phase2/*.test.ts' > "$artifacts/integration.log" 2>&1
docker compose run --rm --no-deps --pull never tools node_modules/.bin/tsx scripts/real-api-phase2.ts > "$artifacts/real-api-default.log" 2>&1
printf 'Phase 2 offline backend checks passed: %s\n' "$artifacts"
