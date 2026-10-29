#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
name=life-dashboard-compact-verify
dir=.runtime/compact/verification
mkdir -p "$dir"
# Dedicated database in tmpfs. No development credentials or real model access.
docker run -d --name "$name" --pull never --network none --add-host postgres-test:127.0.0.1 \
 --tmpfs /var/lib/postgresql --tmpfs /tmp -v "$PWD/$dir:/workspace/.runtime" \
 -e COMPACT_MODE=database -e NODE_ENV=test -e DATABASE_HOST=postgres-test \
 -e DATABASE_NAME=life_dashboard_v03_test -e POSTGRES_DB=life_dashboard_v03_test \
 -e POSTGRES_PASSWORD=synthetic-test-password -e LOCAL_LOGIN_SECRET=compact-synthetic-secret-at-least-32-characters \
 -e PHASE3_ACCEPTANCE=codex-phase3 -e ACCEPTANCE_PROJECT=life-dashboard-v0-3 \
 -e PHASE2_ACCEPTANCE=codex -e V03_AI_ENABLED=0 life-dashboard:compact-2026-10-24 > "$dir/container-id.txt"
cleanup(){ docker logs "$name" > "$dir/services.log" 2>&1 || true; docker rm -f "$name" >/dev/null; }
trap cleanup EXIT
i=0
until [ "$(docker inspect -f '{{.State.Health.Status}}' "$name")" = healthy ]; do
 i=$((i+1)); [ "$i" -lt 90 ] || { echo 'Isolated database did not become ready' >&2; exit 1; }; sleep 1
done
docker exec "$name" sh -c 'node_modules/.bin/tsc --noEmit && node_modules/.bin/tsx --test --test-concurrency=1 tests/v03-phase2/*.test.ts tests/v03-phase1/schedule.test.ts tests/v03-phase1/gateway.test.ts && node_modules/.bin/tsx apps/web/scripts/verify-web.ts && node_modules/.bin/tsx --test apps/web/tests/*.test.ts' > "$dir/checks.log" 2>&1
if [ -n "${COMPACT_RESTORE_DUMP:-}" ]; then
 docker exec "$name" createdb -U life_dashboard compact_restore
 docker exec -i "$name" pg_restore --exit-on-error --no-owner -U life_dashboard -d compact_restore < "$COMPACT_RESTORE_DUMP"
 docker exec "$name" psql -U life_dashboard -d compact_restore -Atc 'SELECT (SELECT count(*) FROM users),(SELECT count(*) FROM records),(SELECT count(*) FROM schema_migrations),(SELECT count(*) FROM wallet_ledger)' > "$dir/restored-counts.txt"
fi
echo "Compact image checks passed: $dir/checks.log"
