#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
mkdir -p .runtime/test-artifacts/preparation
# Fail before migrations or reset tests if the isolated environment is misconfigured.
docker compose --profile test run --rm --no-deps --pull never test node --input-type=module -e '
import assert from "node:assert/strict";
for (const [key,value] of Object.entries({ACCEPTANCE_PROJECT:"life-dashboard-v0-3",NODE_ENV:"test",DATABASE_HOST:"postgres-test",DATABASE_NAME:"life_dashboard_v03_test"})) assert.equal(process.env[key],value);
console.log("v0.3 synthetic database guard passed");'
docker compose run --rm --no-deps --pull never tools sh -c 'node_modules/.bin/tsc --noEmit && node_modules/.bin/tsx --test tests/*.test.ts tests/ai/*.test.ts && node_modules/.bin/tsx apps/web/scripts/verify-web.ts && node_modules/.bin/tsx --test apps/web/tests/*.test.ts'
docker compose --profile test up -d --wait --pull never --no-build postgres-test
docker compose --profile test run --rm --no-deps --pull never -e PHASE3_ACCEPTANCE=codex-phase3 -e ACCEPTANCE_PROJECT=life-dashboard-v0-3 -e PHASE2_ACCEPTANCE=codex test sh -c 'node_modules/.bin/tsx packages/db/src/migrate.ts && node_modules/.bin/tsx --test --test-concurrency=1 tests/integration/*.test.ts'
