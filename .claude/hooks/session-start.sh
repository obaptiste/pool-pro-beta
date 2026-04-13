#!/bin/bash
set -euo pipefail

# Only run in remote (Claude Code on the web) environments
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

echo "==> Installing dependencies for pool-pro-beta..."
cd "${CLAUDE_PROJECT_DIR:-$(dirname "$(dirname "$(realpath "$0")")")}"

# Install all npm dependencies (uses package-lock.json for reproducibility)
npm install

echo "==> Dependencies installed successfully."
