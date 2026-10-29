#!/bin/sh
echo 'This inherited orchestration entry is disabled in v0.3; use scripts/start-existing.sh or scripts/verify-preparation.sh.' >&2
exit 2
set -eu
cd "$(dirname "$0")/../.."
artifacts=.runtime/test-artifacts/stage3-final
mkdir -p "$artifacts/tmp"
rm -f "$artifacts/acceptance.json" "$artifacts/browser.log" "$artifacts/restart.log"
printf '{"status":"RUNNING"}\n' > "$artifacts/run.json"
compose() { docker compose -f compose.release.yaml "$@"; }
cleanup() { result=$?; if [ "$result" -eq 0 ]; then status=PASS; else status=FAIL; fi; printf '{"status":"%s","exit_code":%s}\n' "$status" "$result" > "$artifacts/run.json"; compose logs --no-color > "$artifacts/services.log" 2>&1 || true; compose down --remove-orphans > "$artifacts/cleanup.log" 2>&1 || true; }
trap cleanup EXIT
# Fresh isolated project only. No development DB, secrets, ports or browser profile.
compose down --remove-orphans
docker compose run --rm --no-deps tools node scripts/release/install-probe.mjs > "$artifacts/install.log" 2>&1 || { cat "$artifacts/install.log"; exit 1; }
cat "$artifacts/install.log"
docker compose run --rm --no-deps -e AI_PROVIDER=mock tools sh -c 'corepack pnpm typecheck && corepack pnpm test && corepack pnpm verify:web && corepack pnpm build:web && corepack pnpm contracts:export && corepack pnpm audit --prod' > "$artifacts/checks.log" 2>&1 || { cat "$artifacts/checks.log"; exit 1; }
cat "$artifacts/checks.log"
docker compose --profile test run --rm -e AI_PROVIDER=mock test > "$artifacts/integration.log" 2>&1 || { cat "$artifacts/integration.log"; exit 1; }
cat "$artifacts/integration.log"
compose up -d --wait postgres
compose run --rm init
compose up -d --wait api web gateway
compose run --rm browser > "$artifacts/browser.log" 2>&1 || { cat "$artifacts/browser.log"; exit 1; }
cat "$artifacts/browser.log"
compose restart api web
compose up -d --wait api web gateway
compose run --rm browser node_modules/.bin/tsx --test tests/release/restart.test.ts > "$artifacts/restart.log" 2>&1 || { cat "$artifacts/restart.log"; exit 1; }
cat "$artifacts/restart.log"
printf 'v0.1 MVP: A01–A16 PASS, no required skips. Evidence: %s\n' "$artifacts"
