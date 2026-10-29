#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
docker compose up -d --wait postgres
docker compose run --rm tools corepack pnpm exec tsx scripts/persistence.ts prepare
docker compose up -d --force-recreate --wait postgres
docker compose run --rm tools corepack pnpm exec tsx scripts/persistence.ts verify
