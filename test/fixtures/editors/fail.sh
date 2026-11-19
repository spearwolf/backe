#!/bin/sh
# Test-Editor: ändert die Datei und scheitert dann mit Exit 1.
sed "s/^title: .*/title: Nie gespeichert/" "$1" > "$1.new" && mv "$1.new" "$1"
exit 1
