#!/usr/bin/env bash
# Installiert einen fertigen Tarball wie ein Nutzer und fährt den Kernablauf
# gegen ein Bare-Remote. Aufruf: bash scripts/pack-smoke.sh <tarball>
set -euo pipefail

fail() {
  echo "pack-smoke: $*" >&2
  exit 1
}

[ $# -eq 1 ] || fail "Aufruf: pack-smoke.sh <tarball>"
[ -f "$1" ] || fail "Tarball nicht gefunden: $1"
TARBALL="$(cd "$(dirname "$1")" && pwd -P)/$(basename "$1")"

T="$(mktemp -d)"
T="$(cd "$T" && pwd -P)"
trap 'rm -rf "$T"' EXIT

# Dateiliste exakt
EXPECTED="package/LICENSE
package/README.md
package/dist/cli.js
package/package.json"
ACTUAL="$(tar -tzf "$TARBALL" | LC_ALL=C sort)"
[ "$ACTUAL" = "$EXPECTED" ] || fail "Dateiliste weicht ab:
$ACTUAL"

PKG_JSON="$(tar -xOf "$TARBALL" package/package.json)"
NAME="$(printf '%s' "$PKG_JSON" | node -p 'JSON.parse(require("fs").readFileSync(0,"utf8")).name')"
[ -n "$NAME" ] || fail "Paketname nicht lesbar"

# Isolation wie in den Tests
mkdir -p "$T/home"
export HOME="$T/home"
export BACKE_HOME="$T/home/.backe"
export GIT_CONFIG_GLOBAL=/dev/null
export GIT_CONFIG_NOSYSTEM=1
export XDG_CONFIG_HOME=/dev/null/xdg
export BACKE_USER=smoke
export NO_COLOR=1

npm install --prefix "$T/inst" --no-audit --no-fund "$TARBALL" >"$T/npm.log" 2>&1 ||
  { cat "$T/npm.log" >&2; fail "npm install des Tarballs gescheitert"; }

BACKE="$T/inst/node_modules/.bin/backe"
[ -x "$BACKE" ] || fail "Binary fehlt: $BACKE"

VERSION="$(node -p "require('$T/inst/node_modules/$NAME/package.json').version")"
GOT="$("$BACKE" --version)" || fail "backe --version gescheitert"
[ "$GOT" = "$VERSION" ] || fail "--version '$GOT' != package.json '$VERSION'"

git init --bare -q -b main "$T/remote.git" || fail "Bare-Remote nicht anlegbar"
ssh-keygen -q -t ed25519 -N '' -f "$T/key" >/dev/null || fail "ssh-keygen gescheitert"

run() { "$@" >"$T/out.log" 2>&1 || { cat "$T/out.log" >&2; fail "gescheitert: $*"; }; }

run "$BACKE" init "$T/wc" --name smoke --prefix sm --remote "$T/remote.git" --key "$T/key.pub" --user-name Smoke
cd "$T/wc"
run "$BACKE" config set backlogs.smoke.sync.mode manual
ID="$("$BACKE" new -t "Smoke-Test")" || fail "new gescheitert"
[ -n "$ID" ] || fail "new lieferte keine ID"
run "$BACKE" issue claim "$ID"
run "$BACKE" mv "$ID" review --reason "Smoke"
run "$BACKE" sync
run "$BACKE" verify

SHOWN="$("$BACKE" show "$ID" --json --fields state,assignee)" || fail "show gescheitert"
[ "$SHOWN" = '{"state":"review","assignee":"smoke"}' ] || fail "show liefert '$SHOWN'"

LOG="$(git -C "$T/remote.git" log --format=%s main)" || fail "Remote-Log nicht lesbar"
WANT="issue move $ID review
issue claim $ID
issue create $ID
init smoke"
[ "$LOG" = "$WANT" ] || fail "Remote-Log weicht ab:
$LOG"

echo "pack-smoke: ok $VERSION"
