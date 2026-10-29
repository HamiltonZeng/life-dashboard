#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
# Host orchestrator: every project tool runs inside Docker. The curl step only checks
# the local Caddy entry point; it does not exercise authenticated browser flows.
echo '== backend: typecheck, unit, build, contracts, audit, isolated PostgreSQL integration =='
sh scripts/verify-backend.sh
echo '== web: S0-B/S1 rendering, storage and submission-state suite (Docker) =='
docker compose run --rm --no-deps tools corepack pnpm verify:web
echo '== unified entry: pages, assets, health, unauthenticated boundary =='
artifact_dir=.runtime/test-artifacts/stage2-final
mkdir -p "$artifact_dir"
http_log="$artifact_dir/http.log"
: > "$http_log"
for path in / /tasks /metrics /achievements /records /settings /dist/app.js /packages/ui/dist/index.js /health/ready; do
  result=$(curl -sS -o /dev/null -w '%{http_code} %{content_type}' "http://localhost:18080$path")
  code=${result%% *}
  printf '%s -> %s\n' "$path" "$result" | tee -a "$http_log"
  [ "$code" = '200' ] || { echo "verify-all: unexpected status for $path" >&2; exit 1; }
done
code=$(curl -sS -o /dev/null -w '%{http_code}' http://localhost:18080/api/v1/me)
printf 'unauth /api/v1/me -> %s\n' "$code" | tee -a "$http_log"
[ "$code" = '401' ] || { echo 'verify-all: unauthenticated boundary is not 401' >&2; exit 1; }
echo "verify-all: ok (http evidence: $http_log)" 
