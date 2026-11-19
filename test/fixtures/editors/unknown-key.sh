#!/bin/sh
# Test-Editor: hängt einen unbekannten Front-Matter-Key an.
awk '{ print } /^id: /{ print "colour: red" }' "$1" > "$1.new" && mv "$1.new" "$1"
