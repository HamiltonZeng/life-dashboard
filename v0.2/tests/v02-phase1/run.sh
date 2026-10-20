#!/bin/sh
set -eu
script_dir=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
common_git=$(git -C "$script_dir" rev-parse --path-format=absolute --git-common-dir)
shared_root="$(dirname "$common_git")/v0.2"
workspace="$shared_root/.runtime/worktrees/deepseek/v0.2"
wrapper="$shared_root/scripts/agents/compose.sh"
overlay="$workspace/tests/v02-phase1/compose.browser.yaml"
artifacts="$workspace/.runtime/test-artifacts/v02-phase1-deepseek"
[ -f "$overlay" ] || { echo 'DeepSeek worktree does not contain the acceptance suite.' >&2; exit 2; }
mkdir -p "$artifacts"
printf '{"status":"RUNNING"}\n' > "$artifacts/run.json"
failed=0
step() {
  name=$1
  shift
  if "$@" > "$artifacts/$name.log" 2>&1; then
    printf '%s PASS\n' "$name"
  else
    code=$?
    printf '%s FAIL (exit %s; see %s/%s.log)\n' "$name" "$code" "$artifacts" "$name"
    failed=1
  fi
}
# No installation, pulling, main-project invocation, or main database access.
# Migration must precede any server or suite that reads the new tables.
if ! sh "$wrapper" deepseek --profile test up -d --wait --pull never --no-build postgres-test > "$artifacts/database.log" 2>&1; then
  printf '{"status":"FAIL","reason":"database unavailable"}\n' > "$artifacts/run.json"
  exit 1
fi
if ! sh "$wrapper" deepseek run --rm --no-deps --pull never test node_modules/.bin/tsx packages/db/src/migrate.ts > "$artifacts/migration.log" 2>&1; then
  printf '{"status":"FAIL","reason":"migration failed"}\n' > "$artifacts/run.json"
  exit 1
fi
step checks sh "$wrapper" deepseek run --rm --no-deps --pull never tools sh -c 'node_modules/.bin/tsc --noEmit && node_modules/.bin/tsx --test tests/*.test.ts tests/ai/*.test.ts && node_modules/.bin/tsx apps/web/scripts/verify-web.ts && node scripts/build-web.mjs'
step baseline-integration sh "$wrapper" deepseek run --rm --no-deps --pull never test sh -c 'node_modules/.bin/tsx --test --test-concurrency=1 tests/integration/*.test.ts'
step api sh "$wrapper" deepseek run --rm --no-deps --pull never -e PHASE1_ACCEPTANCE=deepseek test node_modules/.bin/tsx --test --test-concurrency=1 tests/v02-phase1/api.test.ts
if sh "$wrapper" deepseek -f "$overlay" --profile test up -d --wait --pull never --no-build api web gateway > "$artifacts/start.log" 2>&1; then
  step browser sh "$wrapper" deepseek -f "$overlay" --profile test run --rm --no-deps --pull never browser
else
  printf 'browser infrastructure FAIL; see %s/start.log\n' "$artifacts"
  failed=1
fi
if [ "$failed" -eq 0 ]; then
  step restart-prepare sh "$wrapper" deepseek -f "$overlay" --profile test run --rm --no-deps --pull never -e PHASE1_RESTART_MODE=prepare browser node_modules/.bin/tsx --test tests/v02-phase1/restart.test.ts
  step service-restart sh "$wrapper" deepseek -f "$overlay" --profile test restart api web
  step service-ready sh "$wrapper" deepseek -f "$overlay" --profile test up -d --wait --pull never --no-build api web gateway
  step restart-check sh "$wrapper" deepseek -f "$overlay" --profile test run --rm --no-deps --pull never -e PHASE1_RESTART_MODE=check browser node_modules/.bin/tsx --test tests/v02-phase1/restart.test.ts
fi
if [ "$failed" -eq 0 ]; then status=PASS; else status=FAIL; fi
printf '{"status":"%s","exit_code":%s,"required_skips_allowed":false}\n' "$status" "$failed" > "$artifacts/run.json"
# Reproduce reports first; failure is never converted into a successful exit.
exit "$failed"
