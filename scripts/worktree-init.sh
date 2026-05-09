#!/usr/bin/env bash
# v1.2.x B4 — bootstrap a fresh git worktree.
#
# When `git worktree add ...` creates a new working tree, it shares the
# repository (.git) with the main worktree but starts with an empty
# checked-out tree — node_modules/ is gitignored, so it's NOT shared.
# Subagents that operate via `isolation: "worktree"` need to run
# `npm ci` before any tsc / vitest / build command will succeed.
#
# Usage (run once per fresh worktree, from the worktree root):
#   bash scripts/worktree-init.sh
#
# Idempotent: re-running on an already-installed worktree is fast (npm ci
# checks the lockfile + node_modules state).

set -euo pipefail

cd "$(dirname "$0")/.."  # repo root

if [ ! -d chrome-extension ]; then
  echo "[worktree-init] chrome-extension/ missing — wrong worktree root?" >&2
  exit 1
fi

echo "[worktree-init] installing chrome-extension/node_modules via npm ci…"
cd chrome-extension
npm ci --no-audit --no-fund --silent

echo "[worktree-init] done. Run 'cd chrome-extension && npm run test' to verify."
