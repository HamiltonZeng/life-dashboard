#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
artifacts=.runtime/test-artifacts/v03-phase1
mkdir -p "$artifacts"
docker compose --profile test run --rm --no-deps --pull never test node_modules/.bin/tsx --eval "import {guardSynthetic} from './tests/v02-phase3/guard.ts';guardSynthetic();"
docker compose --profile test up -d --wait --pull never --no-build postgres-test
docker compose run --rm --no-deps --pull never tools sh -c 'node_modules/.bin/tsc --noEmit && node_modules/.bin/tsx scripts/export-contracts.ts && node scripts/build-web.mjs && node_modules/.bin/tsx --test tests/*.test.ts tests/ai/*.test.ts tests/v03-phase1/schedule.test.ts tests/v03-phase1/gateway.test.ts && node_modules/.bin/tsx apps/web/scripts/verify-web.ts && node_modules/.bin/tsx --test apps/web/tests/*.test.ts' > "$artifacts/checks.log" 2>&1
# Read-only historical fixtures from local Git, isolated from all running source trees.
for spec in 'e6ff267 phase1-upgrade' 'd9ab408 phase2-compat'; do
 set -- $spec
 mkdir -p ".runtime/$2"
 git -C .. archive "$1" v0.2/packages v0.2/apps/api/src v0.2/package.json | tar -x -C ".runtime/$2"
 [ -L ".runtime/$2/v0.2/node_modules" ] || ln -s ../../../node_modules ".runtime/$2/v0.2/node_modules"
done
docker compose run --rm --no-deps --pull never test sh -c 'node_modules/.bin/tsx packages/db/src/migrate.ts && node_modules/.bin/tsx packages/db/src/migrate.ts && node_modules/.bin/tsx --test --test-concurrency=1 tests/integration/*.test.ts tests/v02-phase1/api.test.ts tests/v02-phase2/*.test.ts tests/v02-phase3/defects.test.ts tests/v02-phase3/edges.test.ts tests/v03-phase1/planning.test.ts tests/v03-phase1/closeout.test.ts' > "$artifacts/integration.log" 2>&1
docker compose run --rm --no-deps --pull never -v "$(pwd)/../design/v0.3:/design:ro" -e DESIGN_VALIDATION_OUTPUT=/workspace/.runtime/test-artifacts/v03-phase1/design-contracts.json tools node /design/contracts/validate.mjs
printf 'Phase 1 offline checks passed. Evidence: %s\n' "$artifacts"
