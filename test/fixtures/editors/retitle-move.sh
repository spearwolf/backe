#!/bin/sh
# Test-Editor: neuer Titel und State todo in einem Edit (zwei Operationen, ein Batch-Commit).
sed -e "s/^title: .*/title: Titel und State/" -e "s/^state: .*/state: todo/" "$1" > "$1.new" && mv "$1.new" "$1"
