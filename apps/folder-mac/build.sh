#!/bin/bash
set -euo pipefail

source_dir="$(cd "$(dirname "$0")" && pwd)"
app_origin="${1:-http://127.0.0.1:3000}"
output_dir="${2:-$source_dir/build}"
download_dir="${3:-$source_dir/../web/public}"
app_bundle="$output_dir/Harborway Folder Intake.app"
mkdir -p "$app_bundle/Contents/MacOS" "$download_dir"
cp "$source_dir/Info.plist" "$app_bundle/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :HarborwayWebOrigin $app_origin" "$app_bundle/Contents/Info.plist"

for architecture in arm64 x86_64; do
  xcrun --sdk macosx swiftc -O -target "$architecture-apple-macosx13.0" \
    "$source_dir/Monitor.swift" "$source_dir/main.swift" -o "$output_dir/HarborwayFolderIntake-$architecture"
done
xcrun lipo -create "$output_dir/HarborwayFolderIntake-arm64" "$output_dir/HarborwayFolderIntake-x86_64" \
  -output "$app_bundle/Contents/MacOS/HarborwayFolderIntake"
codesign --force --sign "${HARBORWAY_MAC_SIGN_IDENTITY:--}" "$app_bundle"
archive="$download_dir/harborway-folder-intake-mac.zip"
temporary="$(mktemp "$download_dir/.harborway-folder-archive.XXXXXX")"
trap 'rm -f "$temporary"' EXIT
ditto -c -k --keepParent "$app_bundle" "$temporary"
mv "$temporary" "$archive"
printf 'Built %s\n' "$archive"
