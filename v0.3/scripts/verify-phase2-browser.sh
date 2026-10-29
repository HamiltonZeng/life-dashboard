#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
mkdir -p .runtime/test-artifacts/v03-phase2
compose(){ docker compose -f compose.yaml -f tests/v03-phase2/compose.yaml "$@"; }
cleanup(){ compose logs --no-color api-test worker-test web-test gateway-test > .runtime/test-artifacts/v03-phase2/browser-services.log 2>&1 || true; compose rm -sf api-test worker-test web-test gateway-test >/dev/null 2>&1 || true; }
trap cleanup EXIT
compose --profile test up -d --wait --pull never --no-build postgres-test
compose run --rm --no-deps --pull never test node_modules/.bin/tsx tests/v03-phase2/init.ts
compose run --rm --no-deps --pull never tools node scripts/build-web.mjs
compose up -d --wait --pull never --no-build api-test web-test gateway-test worker-test
compose run --rm --no-deps --pull never browser-test
compose run --rm --no-deps --pull never browser-test node_modules/.bin/tsx tests/v03-phase2/closeout-browser.ts
compose stop worker-test
compose run --rm --no-deps --pull never browser-test node_modules/.bin/tsx tests/v03-phase2/restart.ts prepare
compose restart api-test
compose up -d --wait --pull never --no-build api-test worker-test
compose run --rm --no-deps --pull never browser-test node_modules/.bin/tsx tests/v03-phase2/restart.ts check
