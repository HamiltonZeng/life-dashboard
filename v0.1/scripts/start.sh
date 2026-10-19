#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
docker run --rm -v "$PWD:/workspace" -w /workspace node:24-bookworm-slim@sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5 node scripts/init.mjs
docker compose run --rm tools corepack pnpm install --frozen-lockfile
docker compose up -d --wait postgres
docker compose run --rm tools corepack pnpm db:migrate
docker compose run --rm tools corepack pnpm db:seed
docker compose up -d --wait api web gateway
