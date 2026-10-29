#!/bin/sh
echo 'This inherited orchestration entry is disabled in v0.3; use scripts/start-existing.sh or scripts/verify-preparation.sh.' >&2
exit 2
set -eu
agent=${1-}
case "$agent" in codex|gemini|deepseek) ;; *) echo 'Usage: prepare.sh codex|gemini|deepseek' >&2; exit 2;; esac
script_dir=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
common_git=$(git -C "$script_dir" rev-parse --path-format=absolute --git-common-dir)
shared_root="$(dirname "$common_git")/v0.2"
workspace="$shared_root/.runtime/worktrees/$agent/v0.2"
[ -d "$shared_root/node_modules/.pnpm" ] || { echo 'Shared installed dependencies are missing.' >&2; exit 1; }
[ -f "$workspace/scripts/init.mjs" ] || { echo 'Agent worktree is not ready.' >&2; exit 1; }
# This writes only the isolated worktree's directories and random local credentials.
docker run --rm --pull never --network none -v "$workspace:/workspace" -w /workspace node:24-bookworm-slim@sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5 node scripts/init.mjs
"$script_dir/compose.sh" "$agent" run --rm --no-deps --pull never tools node -e 'for(const name of ["typescript","tsx","pg","fastify"]){require.resolve(name);}console.log("Shared dependencies resolve; no install required.");'
