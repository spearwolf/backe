#!/bin/sh
# Test-Editor: retitle.sh --title <neuer titel> <datei>
# Die Argumente vor der Datei zeigen, dass BACKE_EDITOR ein Kommando mit Argumenten sein darf.
[ "$1" = "--title" ] || exit 64
sed "s/^title: .*/title: $2/" "$3" > "$3.new" && mv "$3.new" "$3"
