#!/bin/sh
echo 'This inherited orchestration entry is disabled in v0.3; use scripts/start-existing.sh or scripts/verify-preparation.sh.' >&2
exit 2
set -eu
agent=${1-}
script_dir=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
"$script_dir/prepare.sh" "$agent"
"$script_dir/compose.sh" "$agent" up -d --wait --pull never --no-build postgres
"$script_dir/compose.sh" "$agent" run --rm --no-deps --pull never tools node_modules/.bin/tsx packages/db/src/migrate.ts
"$script_dir/compose.sh" "$agent" run --rm --no-deps --pull never tools node_modules/.bin/tsx packages/db/src/seed.ts
"$script_dir/compose.sh" "$agent" up -d --wait --pull never --no-build api web gateway
