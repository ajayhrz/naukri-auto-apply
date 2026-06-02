#!/usr/bin/env bash
# Run node under xvfb on Linux CI; pass through on macOS agents.
set -euo pipefail
if command -v xvfb-run >/dev/null 2>&1; then
  exec xvfb-run -a node "$@"
else
  exec node "$@"
fi
