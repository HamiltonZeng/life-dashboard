#!/bin/sh
set -eu
script_dir=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
workspace=$(CDPATH= cd -- "$script_dir/../.." && pwd)
common_git=$(git -C "$workspace" rev-parse --path-format=absolute --git-common-dir)
shared_root="$(dirname "$common_git")/v0.2"
wrapper="$shared_root/scripts/agents/compose.sh"
# Browser infrastructure is deliberately confined to Gemini 18182 and its test DB.
[ "$workspace" = "$shared_root/.runtime/worktrees/gemini/v0.2" ] || { echo 'Run this UI entry from the Gemini isolated worktree only.' >&2; exit 2; }
overlay="$workspace/tests/v02-phase2/compose.browser.yaml"
artifacts="$workspace/.runtime/test-artifacts/v02-phase2-web"
mkdir -p "$artifacts"
printf '{"status":"RUNNING"}\n' > "$artifacts/run.json"
failed=0
step(){ name=$1; shift; if "$@" > "$artifacts/$name.log" 2>&1; then printf '%s PASS\n' "$name"; else code=$?; printf '%s FAIL (exit %s, see %s/%s.log)\n' "$name" "$code" "$artifacts" "$name"; failed=1; fi; }
step checks sh "$wrapper" gemini run --rm --no-deps --pull never tools sh -c 'node_modules/.bin/tsc --noEmit && node scripts/build-web.mjs && node_modules/.bin/tsx apps/web/scripts/verify-web.ts && node_modules/.bin/tsx --test apps/web/tests/phase2.test.ts'
step database sh "$wrapper" gemini --profile test up -d --wait --pull never --no-build postgres-test
step migration sh "$wrapper" gemini run --rm --no-deps --pull never test node_modules/.bin/tsx packages/db/src/migrate.ts
step server sh "$wrapper" gemini -f "$overlay" --profile test up -d --wait --pull never --no-build api web gateway
step legacy-browser sh "$wrapper" gemini -f "$overlay" --profile test run --rm --no-deps --pull never browser node_modules/.bin/tsx --test tests/v02-phase2/legacy-browser.ts
step browser sh "$wrapper" gemini -f "$overlay" --profile test run --rm --no-deps --pull never browser
if [ "$failed" -eq 0 ]; then
 step restart-prepare sh "$wrapper" gemini -f "$overlay" --profile test run --rm --no-deps --pull never browser node_modules/.bin/tsx tests/v02-phase2/browser-restart.ts prepare
 step restart sh "$wrapper" gemini -f "$overlay" --profile test restart api web
 step ready sh "$wrapper" gemini -f "$overlay" --profile test up -d --wait --pull never --no-build api web gateway
 step restart-check sh "$wrapper" gemini -f "$overlay" --profile test run --rm --no-deps --pull never browser node_modules/.bin/tsx tests/v02-phase2/browser-restart.ts check
fi
if [ "$failed" -eq 0 ]; then status=PASS; else status=FAIL; fi
printf '{"status":"%s","exit_code":%s,"scope":"gemini-isolated-ui","required_skips_allowed":false,"real_mobile_device":false}\n' "$status" "$failed" > "$artifacts/run.json"
exit "$failed"
