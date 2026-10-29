#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
umask 077
backup_dir=".runtime/backups/phase2-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$backup_dir" .runtime/test-artifacts/v03-phase2
# This operates only the v0.3 compose project. Never use down -v or remove old images.
docker compose exec -T postgres psql -U life_dashboard -d life_dashboard_v03 -Atc 'SELECT name,checksum FROM schema_migrations ORDER BY name' > "$backup_dir/migrations-before.txt"
docker compose stop api worker web gateway
docker compose exec -T postgres pg_dump -U life_dashboard -d life_dashboard_v03 -Fc > "$backup_dir/development-before.dump"
shasum -a 256 "$backup_dir/development-before.dump" > "$backup_dir/sha256.txt"
sh scripts/start-existing.sh
docker compose run --rm --no-deps --pull never tools node scripts/preparation-smoke.mjs
docker compose ps --format json > .runtime/test-artifacts/v03-phase2/containers.json
printf '%s\n' "$backup_dir" > .runtime/test-artifacts/v03-phase2/backup-path.txt
