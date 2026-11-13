#!/bin/sh
# Connect a trusted local legacy checkout without importing it into Git.
set -eu
repo=$(CDPATH='' cd "$(dirname "$0")/.." && pwd)
legacy=$(CDPATH='' cd "${1:-"$repo/../cdc_excel_matcher_v1"}" && pwd)
if [ "$legacy" = "$repo" ] || [ ! -f "$legacy/services/permit_exporter.py" ]; then
    printf '%s\n' 'Supply the original local CDC matcher checkout.' >&2
    exit 2
fi
umask 077
cd "$repo"
mkdir -p reference data/defaults services/templates
for path in examples reference/shipping_work; do
    if [ -d "$legacy/$path" ] && [ ! -e "$path" ] && [ ! -L "$path" ]; then
        mkdir -m 700 "$path"
        cp -R "$legacy/$path/." "$path/"
    fi
done
# Legacy preferences, templates and translation databases can be modified by Streamlit.
# Copy these to ignored local paths so writes never affect the original.
for path in data/defaults/default_cdc_master.xlsx data/defaults/settings.json \
    data/verified_translations.json data/verified_translations.sqlite3 \
    services/templates/permit_template_default.xlsx; do
    if [ -f "$legacy/$path" ] && [ ! -e "$path" ] && [ ! -L "$path" ]; then
        (set -C; cat "$legacy/$path" > "$path")
    fi
done
printf '%s\n' 'Local legacy fixtures available. Existing files and shipment records were left intact.'
