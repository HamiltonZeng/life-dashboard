#!/bin/sh
set -eu
script_dir=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
common_git=$(git -C "$script_dir" rev-parse --path-format=absolute --git-common-dir)
shared_root="$(dirname "$common_git")/v0.2"
workspace="$shared_root/.runtime/worktrees/codex/v0.2"
wrapper="$shared_root/scripts/agents/compose.sh"
artifacts="$workspace/.runtime/test-artifacts/v02-phase2-codex"
mkdir -p "$artifacts"
printf '{"status":"RUNNING"}\n' > "$artifacts/run.json"
failed=0
step(){ name=$1; shift; if "$@" > "$artifacts/$name.log" 2>&1; then printf '%s PASS\n' "$name"; else code=$?; printf '%s FAIL (exit %s; %s/%s.log)\n' "$name" "$code" "$artifacts" "$name"; failed=1; fi; }
step database sh "$wrapper" codex --profile test up -d --wait --pull never --no-build postgres-test
step migration sh "$wrapper" codex run --rm --no-deps --pull never test node_modules/.bin/tsx packages/db/src/migrate.ts
step checks sh "$wrapper" codex run --rm --no-deps --pull never tools sh -c 'node_modules/.bin/tsc --noEmit && node_modules/.bin/tsx --test tests/*.test.ts tests/ai/*.test.ts && node_modules/.bin/tsx scripts/export-contracts.ts'
step integration sh "$wrapper" codex run --rm --no-deps --pull never test sh -c 'node_modules/.bin/tsx --test --test-concurrency=1 tests/integration/*.test.ts'
step phase2 sh "$wrapper" codex run --rm --no-deps --pull never -e PHASE2_ACCEPTANCE=codex test sh -c 'node_modules/.bin/tsx --test --test-concurrency=1 tests/v02-phase2/*.test.ts'
if [ "$failed" -eq 0 ]; then status=PASS; else status=FAIL; fi
printf '{"status":"%s","exit_code":%s,"scope":"backend-only","required_skips_allowed":false}\n' "$status" "$failed" > "$artifacts/run.json"
exit "$failed"
