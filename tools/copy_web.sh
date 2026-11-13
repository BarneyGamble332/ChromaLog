#!/bin/bash
# Kopiert die Web-App (ohne Tests, Firmware und Werkzeuge) in einen Zielordner – für die Linux- und die Android-Version.
set -e
HERE="$(cd "$(dirname "$0")/.." && pwd)"; DEST="${1:?Zielordner angeben}"
rm -rf "$DEST"; mkdir -p "$DEST"
cp "$HERE/index.html" "$DEST/"; cp -r "$HERE/css" "$HERE/js" "$HERE/fonts" "$DEST/"
echo "Web-App nach $DEST kopiert"
