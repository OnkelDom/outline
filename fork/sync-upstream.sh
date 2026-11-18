#!/usr/bin/env bash
# Rebase this fork's own commits onto the latest upstream Outline.
#
# The fork keeps upstream history untouched and carries its changes as a
# small stack of commits on top (their subjects start with "fork:"). This
# script fetches upstream, replays that stack onto it and, if asked, pushes the
# result. Run it from a clean working tree:
#
#   fork/sync-upstream.sh            # rebase the current branch, no push
#   fork/sync-upstream.sh --push     # rebase and push with --force-with-lease
#   fork/sync-upstream.sh --list     # only list the fork's own commits
#
# Environment: UPSTREAM_URL (default https://github.com/outline/outline.git),
# UPSTREAM_BRANCH (default main).
set -euo pipefail

UPSTREAM_URL="${UPSTREAM_URL:-https://github.com/outline/outline.git}"
UPSTREAM_BRANCH="${UPSTREAM_BRANCH:-main}"
MODE="${1:-}"

cd "$(git rev-parse --show-toplevel)"

if ! git remote get-url upstream >/dev/null 2>&1; then
  echo "Adding remote 'upstream' -> $UPSTREAM_URL"
  git remote add upstream "$UPSTREAM_URL"
fi

git fetch upstream "$UPSTREAM_BRANCH"
BASE="upstream/$UPSTREAM_BRANCH"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"

echo
echo "Fork commits on $BRANCH that are not in $BASE:"
git log --oneline --reverse "$BASE..HEAD"
echo

if [[ "$MODE" == "--list" ]]; then
  exit 0
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "error: working tree is not clean; commit or stash first" >&2
  exit 1
fi

BACKUP="backup/$BRANCH-$(date +%Y%m%d-%H%M%S)"
git branch "$BACKUP"
echo "Saved the current state as $BACKUP"

if ! git rebase "$BASE"; then
  cat >&2 <<MSG

The rebase stopped on a conflict. Resolve it, then run:
  git add <files> && git rebase --continue
Or go back to the previous state with:
  git rebase --abort
The state before the rebase is kept in $BACKUP.
MSG
  exit 1
fi

echo
echo "Rebased $BRANCH onto $BASE. Check it before deploying:"
echo "  yarn install && yarn tsc && yarn test server/utils/DocxHelper.test.ts"

if [[ "$MODE" == "--push" ]]; then
  git push --force-with-lease origin "$BRANCH"
fi
