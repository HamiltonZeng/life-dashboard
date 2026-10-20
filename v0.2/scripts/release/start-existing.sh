#!/bin/sh
set -eu
here=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
compose(){ sh "$here/compose-existing.sh" "$@"; }
compose up -d --wait --pull never --no-build postgres
compose run --rm --no-deps --pull never tools node_modules/.bin/tsx packages/db/src/migrate.ts
compose run --rm --no-deps --pull never tools node_modules/.bin/tsx packages/db/src/seed.ts
compose up -d --wait --pull never --no-build api web gateway
