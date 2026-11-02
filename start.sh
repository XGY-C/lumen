#!/usr/bin/env bash
# One-click launcher for Git Bash / macOS / Linux.
# The actual logic lives in scripts/dev.mjs so both entry points behave the same.
set -euo pipefail
cd "$(dirname "$0")"
exec node scripts/dev.mjs "$@"
