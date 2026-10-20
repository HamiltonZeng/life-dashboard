#!/bin/sh
set -eu
exec sh "$(CDPATH= cd -- "$(dirname "$0")/../v02-phase3" && pwd)/run.sh" "$@"
