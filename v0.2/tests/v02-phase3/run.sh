#!/bin/sh
# Sole release acceptance entry. Never uses another agent's worktree or persistent database.
set -eu
app=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
common_git=$(git -C "$app" rev-parse --path-format=absolute --git-common-dir)
shared="$(dirname "$common_git")/v0.2"
[ "$app" = "$shared/.runtime/worktrees/codex/v0.2" ] || { echo 'Run in the Codex release worktree; see docs/v02-phase3/README.md' >&2; exit 2; }
wrapper="$shared/scripts/agents/compose.sh"
compose(){ sh "$wrapper" codex -f "$app/tests/v02-phase3/compose.yaml" "$@"; }
artifacts="$app/.runtime/test-artifacts/v02-phase3"
mkdir -p "$artifacts"
printf '{"status":"RUNNING"}\n' > "$artifacts/run.json"
# Historical source is extracted read-only into private fixtures, never checked out over current files.
for spec in 'e6ff267 phase1-upgrade' 'd9ab408 phase2-compat'; do
 set -- $spec
 mkdir -p "$app/.runtime/$2"
 git -C "$app/.." archive "$1" v0.2/packages v0.2/apps/api/src v0.2/package.json | tar -x -C "$app/.runtime/$2"
 [ -e "$app/.runtime/$2/v0.2/node_modules" ] || ln -s ../../../node_modules "$app/.runtime/$2/v0.2/node_modules"
done
failed=0
step(){ name=$1; shift; if "$@" > "$artifacts/$name.log" 2>&1; then printf '%s PASS\n' "$name"; else code=$?; printf '%s FAIL (exit %s; %s/%s.log)\n' "$name" "$code" "$artifacts" "$name"; failed=1; fi; }
cli(){ compose run --rm --no-deps --pull never -e APP_PROFILE=development -e APP_ORIGIN=http://localhost:18080 api-test "$@"; }
step database compose --profile test up -d --wait --pull never --no-build postgres-test
step migration cli node_modules/.bin/tsx packages/db/src/migrate.ts
step checks cli sh -c 'node_modules/.bin/tsc --noEmit && node_modules/.bin/tsx --test tests/*.test.ts tests/ai/*.test.ts && node scripts/build-web.mjs && node_modules/.bin/tsx apps/web/scripts/verify-web.ts && node_modules/.bin/tsx --test apps/web/tests/*.test.ts && node_modules/.bin/tsx scripts/export-contracts.ts'
step integration cli node_modules/.bin/tsx --test --test-concurrency=1 tests/integration/*.test.ts
step phase1 cli node_modules/.bin/tsx --test --test-concurrency=1 tests/v02-phase1/api.test.ts
step phase2 cli node_modules/.bin/tsx --test --test-concurrency=1 tests/v02-phase2/*.test.ts
step phase3 cli node_modules/.bin/tsx --test --test-concurrency=1 tests/v02-phase3/defects.test.ts tests/v02-phase3/edges.test.ts
step benchmark cli node_modules/.bin/tsx tests/v02-phase3/benchmark.ts
step server compose up -d --wait --pull never --no-build --force-recreate api-test web-test gateway-test
step legacy-browser compose run --rm --no-deps --pull never browser-test node_modules/.bin/tsx --test tests/web/legacy-browser.ts
step browser-rate-window compose restart api-test
step phase2-browser compose run --rm --no-deps --pull never browser-test node_modules/.bin/tsx --test tests/web/phase2-browser.ts
step new-browser-rate-window compose restart api-test
step phase3-browser compose run --rm --no-deps --pull never browser-test
step restart-rate-window compose restart api-test
step legacy-restart-prepare compose run --rm --no-deps --pull never -e PHASE1_RESTART_MODE=prepare browser-test node_modules/.bin/tsx --test tests/web/legacy-restart.ts
step restart-prepare compose run --rm --no-deps --pull never browser-test node_modules/.bin/tsx tests/web/restart.ts prepare
step restart compose restart api-test web-test
step ready compose up -d --wait --pull never --no-build api-test web-test gateway-test
step restart-check compose run --rm --no-deps --pull never browser-test node_modules/.bin/tsx tests/web/restart.ts check
step legacy-restart-check compose run --rm --no-deps --pull never -e PHASE1_RESTART_MODE=check browser-test node_modules/.bin/tsx --test tests/web/legacy-restart.ts
if [ "$failed" -eq 0 ]; then status=PASS; else status=FAIL; fi
printf '{"status":"%s","exit_code":%s,"project":"life-dashboard-v0-2-codex","core_skips_allowed":false,"real_mobile_device":false}\n' "$status" "$failed" > "$artifacts/run.json"
exit "$failed"
