#!/bin/sh
# Test-Editor: macht den State ungültig, damit die Schemaprüfung zuschlägt.
sed "s/^state: .*/state: nonsense/" "$1" > "$1.new" && mv "$1.new" "$1"
