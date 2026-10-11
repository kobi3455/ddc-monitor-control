#!/usr/bin/env bash
# Builds the zip that is uploaded to extensions.gnome.org.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"
UUID="ddc-control@kobi3455.github.io"
ZIP="$UUID.shell-extension.zip"

gnome-extensions pack --force \
    --extra-source=ddc.js \
    --extra-source=libs \
    --extra-source=LICENSE \
    .

echo "Created $ZIP:"
unzip -Z1 "$ZIP" | sed 's/^/  /'
