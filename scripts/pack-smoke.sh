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
SERVER_PID=""
cleanup() {
  if [ -n "$SERVER_PID" ]; then
    kill -KILL "$SERVER_PID" 2>/dev/null || true
  fi
  rm -rf "$T"
}
trap cleanup EXIT

# Dateiliste exakt
EXPECTED="package/LICENSE
package/README.md
package/dist/cli.js
package/package.json"
LISTING="$(tar -tzf "$TARBALL" | grep -v '/$' | LC_ALL=C sort)"
ACTUAL="$(printf '%s\n' "$LISTING" | grep -v '^package/dist/ui/' || true)"
[ "$ACTUAL" = "$EXPECTED" ] || fail "Dateiliste weicht ab:
$ACTUAL"
UI_FILES="$(printf '%s\n' "$LISTING" | grep '^package/dist/ui/' || true)"
printf '%s\n' "$UI_FILES" | grep -qx 'package/dist/ui/index.html' || fail "dist/ui/index.html fehlt im Tarball"
printf '%s\n' "$UI_FILES" | grep -qx 'package/dist/ui/theme.js' || fail "dist/ui/theme.js fehlt im Tarball"
printf '%s\n' "$UI_FILES" | grep -qx 'package/dist/ui/favicon.svg' || fail "dist/ui/favicon.svg fehlt im Tarball"
STRAY="$(printf '%s\n' "$UI_FILES" | grep -vx -e 'package/dist/ui/index.html' -e 'package/dist/ui/theme.js' -e 'package/dist/ui/favicon.svg' -e 'package/dist/ui/assets/.*' || true)"
[ -z "$STRAY" ] || fail "Unerwartete Dateien unter dist/ui:
$STRAY"

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

# UI starten: stdout in eine FIFO, erste Zeile lesen
mkfifo "$T/ui.out"
"$BACKE" ui --port 0 >"$T/ui.out" 2>"$T/ui.err" &
SERVER_PID=$!
exec 3<"$T/ui.out"
START_LINE=""
read -r -t 20 START_LINE <&3 || { cat "$T/ui.err" >&2; fail "backe ui meldete keine Start-Zeile"; }
printf '%s\n' "$START_LINE" | grep -Eq '^backe ui: http://127\.0\.0\.1:[0-9]+/\?token=[0-9a-f]{64}$' ||
  fail "Start-Zeile weicht ab: $START_LINE"
START_URL="${START_LINE#backe ui: }"
BASE="${START_URL%%/\?*}"
PORT="${BASE##*:}"

JAR="$T/cookies.txt"
HEAD="$(curl -sS -o /dev/null -D - -c "$JAR" -w 'status=%{http_code}\n' "$START_URL")" || fail "Start-URL nicht abrufbar"
printf '%s' "$HEAD" | grep -q '^status=303$' || fail "Start-URL liefert kein 303: $HEAD"
printf '%s' "$HEAD" | tr -d '\r' | grep -qi "^set-cookie: backe_ui_$PORT=" || fail "Set-Cookie backe_ui_$PORT fehlt: $HEAD"

ROOT_HEADERS="$T/root.headers"
curl -sS -b "$JAR" -D "$ROOT_HEADERS" -o "$T/root.html" -w '%{http_code}' "$BASE/" >"$T/root.status" || fail "/ nicht abrufbar"
[ "$(cat "$T/root.status")" = "200" ] || fail "/ liefert Status $(cat "$T/root.status")"
grep -q '<div id="root">' "$T/root.html" || fail "/ enthält kein <div id=\"root\">"
grep -q 'src="/theme.js"' "$T/root.html" || fail "/ lädt /theme.js nicht"
CSP="$(tr -d '\r' <"$ROOT_HEADERS" | sed -n 's/^[Cc]ontent-[Ss]ecurity-[Pp]olicy: //p')"
WANT_CSP="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
[ "$CSP" = "$WANT_CSP" ] || fail "CSP weicht ab: $CSP"

BACKLOGS="$(curl -sS -f -b "$JAR" "$BASE/api/backlogs")" || fail "/api/backlogs nicht abrufbar"
printf '%s' "$BACKLOGS" | node -e '
const j = JSON.parse(require("fs").readFileSync(0, "utf8"));
const e = j.backlogs.find((b) => b.name === "smoke");
if (!e || e.prefix !== "sm") process.exit(1);
' || fail "/api/backlogs ohne Eintrag smoke/sm: $BACKLOGS"

kill -TERM "$SERVER_PID"
SERVER_RC=0
wait "$SERVER_PID" || SERVER_RC=$?
SERVER_PID=""
exec 3<&-
[ "$SERVER_RC" -eq 0 ] || fail "backe ui endete mit Exit-Code $SERVER_RC"

echo "pack-smoke: ok $VERSION"
