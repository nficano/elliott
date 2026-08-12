#!/usr/bin/env sh
# Install the repo's tracked git hooks (.githooks/) as core.hooksPath so the
# pre-push quality gate is active for every contributor after `bun install`.
# Idempotent; safe to run repeatedly.
#
# Guarded to be a no-op when elliott is consumed as a dependency: its `prepare`
# lifecycle also runs inside a consumer's node_modules (a consumer installs
# elliott as a git dep), and we must never repoint the consumer's hooksPath.
set -eu

# Skip when running inside a node_modules tree (installed as a dependency).
case "$PWD" in
  */node_modules/*) exit 0 ;;
esac

# Only proceed inside a git working tree that actually ships the hooks dir.
[ -d .githooks ] || exit 0
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

git config core.hooksPath .githooks
echo "elliott: git hooks installed (core.hooksPath=.githooks)"
