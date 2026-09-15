#!/bin/bash
# Compile an isolated native preview. No dependencies or production app changes.
set -euo pipefail

study_dir="$(cd "$(dirname "$0")" && pwd)"
repo_dir="$(cd "$study_dir/../../.." && pwd)"
app_version="$(plutil -extract version raw -o - "$repo_dir/package.json")"
build_dir="$(mktemp -d -t lyre-design)"
trap 'rm -rf "$build_dir"' EXIT
app_dir="$build_dir/Lyre Design Study.app"
mkdir -p "$app_dir/Contents/MacOS" "$app_dir/Contents/Resources"
cp "$repo_dir/assets/brand/icon-rounded.png" "$app_dir/Contents/Resources/LyreIcon.png"
cat > "$app_dir/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>ai.hexly.lyre.design-study</string>
<key>CFBundleName</key><string>Lyre Design Study</string>
<key>CFBundleExecutable</key><string>LyreDesignStudy</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>$app_version</string>
<key>CFBundleVersion</key><string>1</string>
<key>NSHighResolutionCapable</key><true/>
<key>NSPrincipalClass</key><string>NSApplication</string>
<key>LSMinimumSystemVersion</key><string>15.0</string>
</dict></plist>
PLIST

export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
source_files=()
while IFS= read -r source; do
    source_files+=("$source")
done < <(rg --files "$repo_dir/apps/macos/Lyre" -g '*.swift' -g '!LyreEntryPoint.swift')
xcrun swiftc -D DEBUG -parse-as-library -swift-version 6 -O \
    -target "$(uname -m)-apple-macos15.0" \
    -module-cache-path "$build_dir/module-cache" \
    "${source_files[@]}" "$study_dir/Preview.swift" -o "$app_dir/Contents/MacOS/LyreDesignStudy"

if [[ $# -gt 0 && "$1" == "--interactive" ]]; then
    "$app_dir/Contents/MacOS/LyreDesignStudy"
else
    output_dir="$study_dir/screenshots"
    if [[ $# -gt 0 ]]; then output_dir="$1"; fi
    "$app_dir/Contents/MacOS/LyreDesignStudy" --render "$output_dir"
fi
