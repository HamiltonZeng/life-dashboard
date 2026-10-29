#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
compose(){ docker compose -f compose.yaml -f tests/v03-phase1/compose.yaml "$@"; }
cleanup(){ compose logs --no-color api-test worker-test web-test gateway-test > .runtime/test-artifacts/v03-phase1/browser-services.log 2>&1 || true; compose rm -sf api-test worker-test web-test gateway-test >/dev/null 2>&1 || true; }
trap cleanup EXIT
# Do not run concurrently with the backend acceptance: both use the one synthetic test DB.
compose --profile test up -d --wait --pull never --no-build postgres-test
compose run --rm --no-deps --pull never test node_modules/.bin/tsx tests/v03-phase1/init.ts
compose run --rm --no-deps --pull never tools node scripts/build-web.mjs
compose up -d --wait --pull never --no-build api-test web-test gateway-test worker-test
compose run --rm --no-deps --pull never browser-test
compose stop worker-test
compose run --rm --no-deps --pull never browser-test node_modules/.bin/tsx tests/v03-phase1/restart.ts prepare
compose restart api-test
compose up -d --wait --pull never --no-build api-test worker-test
compose run --rm --no-deps --pull never browser-test node_modules/.bin/tsx tests/v03-phase1/restart.ts check
