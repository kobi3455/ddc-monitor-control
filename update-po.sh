#!/usr/bin/env bash
# Regenerates the translation template and merges new strings into the
# existing translations. Run it after changing any user-visible text.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"
DOMAIN="ddc-control@kobi3455.github.io"
POT="po/$DOMAIN.pot"

xgettext --from-code=UTF-8 --language=JavaScript \
    --keyword=_ --keyword=N_ --add-comments=Translators: \
    --package-name="DDC Monitor Control" \
    --msgid-bugs-address="https://github.com/kobi3455/ddc-monitor-control/issues" \
    --output="$POT" \
    extension.js ddc.js prefs.js

for po in po/*.po; do
    [[ -e "$po" ]] || continue
    msgmerge --quiet --update --backup=none "$po" "$POT"
    printf '%s: ' "$po"
    msgfmt --check --statistics --output-file=/dev/null "$po"
done
