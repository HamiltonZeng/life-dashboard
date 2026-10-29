#!/bin/sh
echo 'This inherited orchestration entry is disabled in v0.3; use scripts/start-existing.sh or scripts/verify-preparation.sh.' >&2
exit 2
set -eu
agent=${1-}
case "$agent" in codex|gemini|deepseek) ;; *) echo 'Usage: compose.sh codex|gemini|deepseek <compose arguments>' >&2; exit 2;; esac
shift
script_dir=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
common_git=$(git -C "$script_dir" rev-parse --path-format=absolute --git-common-dir)
project_root=$(dirname "$common_git")
shared_root="$project_root/v0.2"
workspace="$shared_root/.runtime/worktrees/$agent/v0.2"
[ -f "$workspace/compose.yaml" ] || { echo "Missing agent worktree: $workspace" >&2; exit 1; }
export LIFE_DASHBOARD_SHARED_ROOT="$shared_root"
exec docker compose --project-name "life-dashboard-v0-2-$agent" --project-directory "$workspace" -f "$workspace/compose.yaml" -f "$shared_root/infra/agents/$agent.compose.yaml" "$@"
