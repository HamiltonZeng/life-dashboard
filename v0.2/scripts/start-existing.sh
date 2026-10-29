#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
# Reuse the installed tree and cached images; never run an installer here.
[ -d node_modules/.pnpm ] || { echo 'Existing dependencies are missing; stop and ask the integration owner.' >&2; exit 1; }
[ -f .secrets/development.env ] || { echo 'Existing private configuration is missing; refusing to replace credentials.' >&2; exit 1; }
docker compose up -d --wait --pull never --no-build postgres
docker compose run --rm --no-deps --pull never -e COREPACK_ENABLE_NETWORK=0 tools node_modules/.bin/tsx packages/db/src/migrate.ts
docker compose run --rm --no-deps --pull never -e COREPACK_ENABLE_NETWORK=0 tools node_modules/.bin/tsx packages/db/src/seed.ts
docker compose up -d --wait --pull never --no-build api web gateway
