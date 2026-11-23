#!/usr/bin/env bash
# Release in einem Schritt (backe.md §2.21): wartet, bis release-please den Release-PR auf den
# gepushten Stand von main gezogen hat, und schaltet für ihn den automatischen Squash-Merge ein.
# GitHub mergt, sobald die CI grün ist; danach veröffentlicht release.yml auf npm.
set -euo pipefail

BRANCH=release-please--branches--main--components--backe

say() { printf 'release: %s\n' "$*"; }
fail() { printf 'release: %s\n' "$*" >&2; exit 1; }

command -v gh >/dev/null || fail "gh fehlt (GitHub CLI)"

git fetch -q origin main
local_head=$(git rev-parse HEAD)
remote_head=$(git rev-parse origin/main)
if [ "$(git branch --show-current)" != main ]; then
  fail "nicht auf main"
fi
if [ "$local_head" != "$remote_head" ]; then
  if git merge-base --is-ancestor "$remote_head" "$local_head"; then
    fail "lokale Commits sind noch nicht gepusht: erst git push origin main"
  fi
  fail "main weicht von origin/main ab: erst git pull --rebase origin main"
fi

# Der release-please-Job des letzten Pushs muss durch sein, sonst trägt der PR noch einen alten Stand.
run=""
for _ in $(seq 1 20); do
  run=$(gh run list --workflow release.yml --commit "$remote_head" --event push --limit 1 \
    --json databaseId --jq '.[0].databaseId // empty')
  [ -n "$run" ] && break
  sleep 3
done
[ -n "$run" ] || fail "kein Release-Lauf für ${remote_head:0:7} gefunden"
say "warte auf release-please für ${remote_head:0:7} …"
job=""
for _ in $(seq 1 60); do
  job=$(gh run view "$run" --json jobs \
    --jq '.jobs[] | select(.name=="release-please") | select(.status=="completed") | .conclusion')
  [ -n "$job" ] && break
  sleep 5
done
[ "$job" = success ] || fail "release-please ist nicht durchgelaufen (${job:-Zeitüberschreitung}): gh run view $run"

pr=$(gh pr list --state open --head "$BRANCH" --json number,title,url --jq '.[0] // empty')
if [ -z "$pr" ]; then
  say "nichts zu releasen: seit der letzten Version gibt es keinen feat-, fix- oder perf-Commit"
  exit 0
fi
number=$(jq -r .number <<<"$pr")
title=$(jq -r .title <<<"$pr")
url=$(jq -r .url <<<"$pr")

gh pr merge "$number" --auto --squash >/dev/null
say "$title — Auto-Merge an: $url"
say "GitHub mergt, sobald die CI grün ist; danach veröffentlicht release.yml auf npm"
