#!/bin/sh
echo 'This inherited orchestration entry is disabled in v0.3; use scripts/start-existing.sh or scripts/verify-preparation.sh.' >&2
exit 2
# Portable, offline candidate project; deliberately cannot select the main Compose project.
set -eu
app=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
: "${LIFE_DASHBOARD_DEPENDENCIES:?Set the absolute existing v0.2 dependency root}"
[ -d "$LIFE_DASHBOARD_DEPENDENCIES/node_modules/.pnpm" ] || { echo 'Existing dependencies missing; no installer will run.' >&2; exit 2; }
[ -f "$app/.secrets/development.env" ] || { echo 'Initialize new checkout privately with scripts/init.mjs; existing credentials must be retained.' >&2; exit 2; }
export LIFE_DASHBOARD_DEPENDENCIES
exec docker compose --project-name life-dashboard-v0-2-release --project-directory "$app" -f "$app/compose.yaml" -f "$app/infra/release/existing.compose.yaml" "$@"
