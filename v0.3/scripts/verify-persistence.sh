#!/bin/sh
echo 'This inherited orchestration entry is disabled in v0.3; use scripts/start-existing.sh or scripts/verify-preparation.sh.' >&2
exit 2
set -eu
cd "$(dirname "$0")/.."
docker compose up -d --wait postgres
docker compose run --rm tools corepack pnpm exec tsx scripts/persistence.ts prepare
docker compose up -d --force-recreate --wait postgres
docker compose run --rm tools corepack pnpm exec tsx scripts/persistence.ts verify
